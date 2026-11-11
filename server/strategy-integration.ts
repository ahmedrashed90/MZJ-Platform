import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, timingSafeEqual } from 'node:crypto';
import { getSql } from './_db.js';
import { loadUserProfile } from './_auth.js';
import { hasPermission, canAccessSystem } from '../shared/system-access.js';
import { supportsWorkMedia } from '../shared/marketing-workflow.js';
import { assertMarketingWorkflowReady } from './_marketing-workflow-schema.js';
import { createStrategyWorkflowTask, listStrategyApprovedProducts, createStrategyWorkflowAgenda, type StrategyWorkflowTaskInput, type StrategyAgendaInput } from './marketing/workflow.js';

// Dedicated, server-to-server API. Never proxy the ordinary Marketing API.
// READ can only SELECT approved fields. ASSIGN can only create a workflow task.
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(value: unknown): value is string { return typeof value === 'string' && uuidPattern.test(value); }
function stringValue(value: unknown, max: number): string {
  return typeof value === 'string' && value.length <= max ? value.trim() : '';
}
function sameToken(received: string, expected: string): boolean {
  if (received.length < 32 || expected.length < 32) return false;
  const first = createHash('sha256').update(received).digest();
  const second = createHash('sha256').update(expected).digest();
  return timingSafeEqual(first, second);
}
function readBearer(request: VercelRequest) {
  const raw = request.headers.authorization;
  if (typeof raw !== 'string') return '';
  const match = /^Bearer ([a-zA-Z0-9._~-]{32,512})$/.exec(raw);
  return match?.[1] || '';
}
function verifyScope(request: VercelRequest, scope: 'read' | 'assign'): boolean {
  const token = readBearer(request);
  const variable = scope === 'read' ? 'MZJ_STRATEGY_READ_KEY' : 'MZJ_STRATEGY_ASSIGN_KEY';
  const read = String(process.env.MZJ_STRATEGY_READ_KEY || '').trim();
  const write = String(process.env.MZJ_STRATEGY_ASSIGN_KEY || '').trim();
  if (!read || !write || read === write) return false;
  return sameToken(token, String(process.env[variable] || '').trim());
}
function bodyValue(request: VercelRequest): Record<string, unknown> | null {
  const candidate = typeof request.body === 'string' ? (() => { try { return JSON.parse(request.body); } catch { return null; } })() : request.body;
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : null;
}
function keysOnly(record: Record<string, unknown>, accepted: readonly string[]): boolean {
  return Object.keys(record).every(key => accepted.includes(key));
}
function normalizeAssignment(body: Record<string, unknown>): StrategyWorkflowTaskInput {
  if (!keysOnly(body, ['requestKey', 'typeId', 'name', 'source', 'items'])) throw Error('Unsupported assignment fields');
  const requestKey = body.requestKey, typeId = body.typeId, name = stringValue(body.name, 250);
  if (!isUuid(requestKey) || !isUuid(typeId) || !name) throw Error('Invalid assignment identification');
  const source = body.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw Error('Missing strategy source');
  const strategySource = source as Record<string, unknown>;
  if (!keysOnly(strategySource, ['planId', 'ideaCodes'])) throw Error('Invalid strategy source');
  const planId = stringValue(strategySource.planId, 120);
  const ideaCodes = strategySource.ideaCodes;
  if (!planId || !Array.isArray(ideaCodes) || ideaCodes.length < 1 || ideaCodes.length > 30 ||
      !ideaCodes.every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(value))) throw Error('Invalid strategy idea identifiers');
  const items = body.items;
  if (new Set(ideaCodes).size !== ideaCodes.length || !Array.isArray(items) || !items.length || items.length > 100) throw Error('Invalid assignment item count');
  const mappedCodes = new Set(ideaCodes as string[]);
  const clientKeys = new Set<string>();
  const normalizedItems: StrategyWorkflowTaskInput['items'] = items.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw Error('Invalid assignment item');
    const entry = item as Record<string, unknown>;
    if (!keysOnly(entry, ['clientKey', 'ideaCode', 'departmentId', 'assigneeId', 'deliveryMode', 'mediaKind', 'ideaName', 'idea', 'explanation', 'creativeTreatment', 'dueOn', 'formatIds'])) throw Error('Unsupported item fields');
    const clientKey = entry.clientKey, departmentId = entry.departmentId, assigneeId = entry.assigneeId;
    const mediaKind = entry.mediaKind;
    const ideaCode = stringValue(entry.ideaCode, 40);
    const deliveryMode = entry.deliveryMode === undefined ? 'files' : entry.deliveryMode;
    const ideaName = stringValue(entry.ideaName, 250), idea = stringValue(entry.idea, 20000), explanation = stringValue(entry.explanation || '', 20000);
    const creativeTreatment = stringValue(entry.creativeTreatment || '', 20000);
    const dueOn = stringValue(entry.dueOn, 10);
    const formatIds = entry.formatIds;
    if (!isUuid(clientKey) || !isUuid(departmentId) || !isUuid(assigneeId) || clientKeys.has(clientKey) ||
        (mediaKind !== 'image' && mediaKind !== 'video') || (deliveryMode !== 'files' && deliveryMode !== 'drive_link') ||
        (entry.ideaCode !== undefined && !mappedCodes.has(ideaCode)) || !ideaName || !idea ||
        !/^20\d\d-\d\d-\d\d$/.test(dueOn) || !Number.isFinite(Date.parse(`${dueOn}T12:00:00Z`)) || new Date(`${dueOn}T12:00:00Z`).toISOString().slice(0,10)!==dueOn ||
        !Array.isArray(formatIds) || !formatIds.length || formatIds.length > 30 || !formatIds.every(isUuid) || new Set(formatIds).size !== formatIds.length) {
      throw Error('Invalid assignment item values');
    }
    clientKeys.add(clientKey);
    return { clientKey, ideaCode: ideaCode || '', departmentId, assigneeId, deliveryMode, mediaKind, ideaName, idea, explanation, creativeTreatment, dueOn, formatIds };
  });
  // A reused idea is allowed in a NEW request, including a capture-only task.
  // Every executor must remain unique within each idea.
  const byIdea = new Map<string, typeof normalizedItems>();
  normalizedItems.forEach((item,index) => {
    const code = item.ideaCode || (items.length === ideaCodes.length ? String(ideaCodes[index]) : '');
    if (!mappedCodes.has(code)) throw Error('Assignment item has no matching idea code');
    const rows = byIdea.get(code) || []; rows.push(item); byIdea.set(code, rows);
  });
  if (byIdea.size !== ideaCodes.length || [...byIdea.values()].some(rows =>
      rows.length > 10 ||
      new Set(rows.map(row => row.assigneeId)).size !== rows.length)) throw Error('Invalid executors for strategy ideas');
  return { requestKey, typeId, name, source: { planId, ideaCodes }, items: normalizedItems };
}

function normalizeAgenda(body: Record<string, unknown>): StrategyAgendaInput {
  if(!keysOnly(body,['requestKey','sourcePlanId','name','agendaFrom','agendaTo','entries']))throw Error('Unsupported agenda fields');
  const requestKey=body.requestKey, sourcePlanId=stringValue(body.sourcePlanId,120),name=stringValue(body.name,250);
  const agendaFrom=stringValue(body.agendaFrom,10),agendaTo=stringValue(body.agendaTo,10);
  const dates=(value:string)=>/^20\d\d-\d\d-\d\d$/.test(value)&&!Number.isNaN(Date.parse(value+'T12:00:00Z'))&&
    new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  if(!isUuid(requestKey)||!sourcePlanId||!name||!dates(agendaFrom)||!dates(agendaTo)||agendaFrom>agendaTo)throw Error('Invalid agenda identification');
  if(!Array.isArray(body.entries)||body.entries.length<1||body.entries.length>80)throw Error('Invalid agenda item count');
  const entries:StrategyAgendaInput['entries']=body.entries.map(value=>{
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid agenda item');
    const row=value as Record<string,unknown>;
    if(!keysOnly(row,['ideaCode','productId','date','platforms']))throw Error('Unsupported agenda item');
    const ideaCode=stringValue(row.ideaCode,44),productId=row.productId,date=stringValue(row.date,10);
    if(!/^[A-Za-z0-9_-]{3,44}$/.test(ideaCode)||!isUuid(productId)||!dates(date)||
      !Array.isArray(row.platforms)||row.platforms.length<1||row.platforms.length>15)throw Error('Invalid agenda item');
    const platforms= row.platforms.map(value=>{
      if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid platform');
      const platform=value as Record<string,unknown>;
      if(!keysOnly(platform,['platformId','postTypes'])||!isUuid(platform.platformId)||!Array.isArray(platform.postTypes)||
        platform.postTypes.length<1||platform.postTypes.length>30)throw Error('Invalid agenda platform');
      const postTypes=platform.postTypes.map(value=>{
        if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid post type');
        const post=value as Record<string,unknown>;
        if(!keysOnly(post,['postTypeId','budget'])||!isUuid(post.postTypeId)||post.budget!==0)throw Error('Invalid agenda post type');
        return {postTypeId:post.postTypeId as string,budget:0};
      });
      return {platformId:platform.platformId as string,postTypes};
    });
    return {ideaCode,productId,date,platforms};
  });
  const ids=entries.map(row=>row.productId);
  if(new Set(ids).size!==ids.length)throw Error('Invalid duplicate agenda items');
  return {requestKey,sourcePlanId,name,agendaFrom,agendaTo,entries};
}

export default async function strategyIntegrationHandler(request: VercelRequest, response: VercelResponse, resource: string) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const method = String(request.method || 'GET').toUpperCase();
  const isRead = method === 'GET' && ['stock', 'executors', 'catalog', 'assignments', 'agenda-products'].includes(resource);
  const isAssignment = method === 'POST' && resource === 'assignments';
  const isAgenda = method === 'POST' && resource === 'agenda';
  if (!isRead && !isAssignment && !isAgenda) {
    response.setHeader('Allow', ['assignments','agenda'].includes(resource) ? 'GET, POST' : 'GET');
    return response.status(405).json({ ok: false, error: 'Only designated read endpoints and assignment creation are allowed' });
  }
  if (!verifyScope(request, isRead ? 'read' : 'assign')) return response.status(401).json({ ok: false, error: 'Unauthorized integration request' });
  try {
    const sql = getSql();
    if (isRead && resource === 'agenda-products') {
      const actorId=String(process.env.MZJ_STRATEGY_INTEGRATION_USER_ID||'').trim();
      if(!isUuid(actorId))return response.status(503).json({ok:false,error:'Integration user is not configured'});
      const user=await loadUserProfile(actorId);
      if(!user || !canAccessSystem(user,'marketing') || !hasPermission(user,'marketing.products.view'))
        return response.status(403).json({ok:false,error:'Integration user cannot read approved products'});
      const payload=await listStrategyApprovedProducts(sql,user);
      return response.status(200).json(payload);
    }
    if (isRead) {
      const payload = await sql.begin(async tx => {
        await tx`set transaction read only`;
        await tx`set local statement_timeout = '10s'`;
        if (resource === 'stock') {
          // Exactly the five Stock tab fields; VIN, vehicle IDs and private metadata never leave this endpoint.
          const cars = await tx<any[]>`
            select distinct btrim(coalesce(v.car_name,'')) as car_name,
              btrim(coalesce(v.statement,'')) as statement,
              btrim(coalesce(v.model_year::text,'')) as model_year,
              btrim(coalesce(v.exterior_color,'')) as exterior_color,
              btrim(coalesce(v.interior_color,'')) as interior_color
            from operations.vehicles v
            where v.is_deleted=false and v.archived_at is null and coalesce(v.is_inventory_active,true)=true
            order by car_name,statement,model_year,exterior_color,interior_color`;
          return { ok: true, cars };
        }
        if (resource === 'executors') {
          const executors = await tx<any[]>`
            select distinct u.id::text as user_id,u.full_name,
              md.id::text as department_id,cd.name as department_name
            from marketing.departments md
            join core.departments cd on cd.id=md.id and cd.system_code='marketing' and cd.is_active=true
            join core.user_system_departments usd on usd.department_id=md.id and usd.system_code='marketing'
            join core.users u on u.id=usd.user_id and u.is_active=true
            join core.user_systems us on us.user_id=u.id and us.system_code='marketing' and us.is_enabled=true
            where md.is_active=true and coalesce(u.is_archived,false)=false
              and coalesce(u.disabled_reason,'') not like 'ACCOUNT_DELETED:%'
              and coalesce(u.can_receive_tasks,true)=true
            order by u.full_name,cd.name`;
          return { ok: true, executors };
        }
        if (resource === 'catalog') {
          const [types,formats] = await Promise.all([
            tx<any[]>`select id::text,name from marketing.campaign_types where is_active=true order by name`,
            tx<any[]>`select pt.id::text,pt.name,pt.width,pt.height,p.name as platform_name,p.code as platform_code
              from marketing.platform_post_types pt join marketing.platforms p on p.id=pt.platform_id
              where pt.is_active=true and p.is_active=true order by p.name,pt.name`,
          ]);
          return { ok: true, taskTypes: types, formats: formats.map(format => ({ ...format,
            mediaKinds: (['image','video'] as const).filter(kind => supportsWorkMedia(kind,format.name)) })) };
        }
        const actorId = String(process.env.MZJ_STRATEGY_INTEGRATION_USER_ID || '').trim();
        const taskId = typeof request.query.taskId === 'string' ? request.query.taskId : '';
        if (!isUuid(actorId) || !isUuid(taskId)) throw Error('Valid taskId is required');
        const [task] = await tx<any[]>`
          select t.id::text,t.task_no,t.name,t.status,t.created_at
          from marketing.work_tasks t
          where t.id=${taskId}::uuid and t.created_by=${actorId}::uuid and t.is_deleted=false
            and exists(select 1 from marketing.work_history h where h.task_id=t.id and h.action='strategy_assigned')`;
        if (!task) return { ok: false, error: 'Strategy assignment not found', notFound: true };
        const items = await tx<any[]>`
          select id::text,client_key::text,assigned_to::text,media_kind,idea_name,
            due_on::text,status,version
          from marketing.work_items where task_id=${taskId}::uuid order by sort_order`;
        return { ok: true, task, items };
      });
      if ('notFound' in payload && payload.notFound) return response.status(404).json({ ok:false,error:payload.error });
      return response.status(200).json(payload);
    }
    const body = bodyValue(request);
    if (!body) return response.status(400).json({ ok:false,error:'JSON object is required' });
    if (JSON.stringify(body).length > 100000) return response.status(413).json({ ok:false,error:'Integration payload is too large' });
    const input = isAgenda ? normalizeAgenda(body) : normalizeAssignment(body);
    const actorId = String(process.env.MZJ_STRATEGY_INTEGRATION_USER_ID || '').trim();
    if (!isUuid(actorId)) return response.status(503).json({ ok:false,error:'Integration task creator is not configured' });
    const user = await loadUserProfile(actorId);
    if (!user || !canAccessSystem(user,'marketing') ||
      !hasPermission(user,isAgenda?'marketing.agenda.create':'marketing.task.create') ||
      (isAgenda&&!hasPermission(user,'marketing.products.view'))) {
      return response.status(403).json({ ok:false,error:'Integration user lacks the required Marketing permission' });
    }
    await assertMarketingWorkflowReady(sql);
    const result = isAgenda ? await createStrategyWorkflowAgenda(sql,input as StrategyAgendaInput,user)
      : await createStrategyWorkflowTask(sql,input as StrategyWorkflowTaskInput,user);
    return response.status(result.existed ? 200 : 201).json(result);
  } catch (error: any) {
    const message = String(error?.message || 'Integration failed');
    const invalid = /^Invalid|^Missing|^Unsupported|^Valid taskId|^JSON object/.test(message);
    if (!invalid) console.error('Strategy integration request failed', { resource, code: error?.code || null });
    return response.status(invalid ? 400 : 500).json({ ok:false,error: invalid ? message : 'Unable to complete the integration request' });
  }
}
