import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, timingSafeEqual } from 'node:crypto';
import { getSql } from './_db.js';
import { loadUserProfile } from './_auth.js';
import { hasPermission, canAccessSystem } from '../shared/system-access.js';
import { supportsWorkMedia } from '../shared/marketing-workflow.js';
import { assertMarketingWorkflowReady } from './_marketing-workflow-schema.js';
import { createStrategyWorkflowTask } from './marketing/workflow.js';

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
function normalizeAssignment(body: Record<string, unknown>) {
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
  if (new Set(ideaCodes).size !== ideaCodes.length || !Array.isArray(items) || ideaCodes.length !== items.length) throw Error('Strategy ideas must match assignment items');
  if (!Array.isArray(items) || !items.length || items.length > 30) throw Error('Invalid assignment item count');
  const clientKeys = new Set<string>();
  const normalizedItems = items.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw Error('Invalid assignment item');
    const entry = item as Record<string, unknown>;
    if (!keysOnly(entry, ['clientKey', 'departmentId', 'assigneeId', 'mediaKind', 'ideaName', 'idea', 'explanation', 'dueOn', 'formatIds'])) throw Error('Unsupported item fields');
    const clientKey = entry.clientKey, departmentId = entry.departmentId, assigneeId = entry.assigneeId;
    const mediaKind = entry.mediaKind;
    const ideaName = stringValue(entry.ideaName, 250), idea = stringValue(entry.idea, 20000), explanation = stringValue(entry.explanation || '', 20000);
    const dueOn = stringValue(entry.dueOn, 10);
    const formatIds = entry.formatIds;
    if (!isUuid(clientKey) || !isUuid(departmentId) || !isUuid(assigneeId) || clientKeys.has(clientKey) ||
        (mediaKind !== 'image' && mediaKind !== 'video') || !ideaName || !idea ||
        !/^20\d\d-\d\d-\d\d$/.test(dueOn) || !Number.isFinite(Date.parse(`${dueOn}T12:00:00Z`)) || new Date(`${dueOn}T12:00:00Z`).toISOString().slice(0,10)!==dueOn ||
        !Array.isArray(formatIds) || !formatIds.length || formatIds.length > 30 || !formatIds.every(isUuid) || new Set(formatIds).size !== formatIds.length) {
      throw Error('Invalid assignment item values');
    }
    clientKeys.add(clientKey);
    return { clientKey, departmentId, assigneeId, mediaKind, ideaName, idea, explanation, dueOn, formatIds };
  });
  return { requestKey, typeId, name, source: { planId, ideaCodes }, items: normalizedItems };
}

export default async function strategyIntegrationHandler(request: VercelRequest, response: VercelResponse, resource: string) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const method = String(request.method || 'GET').toUpperCase();
  const isRead = method === 'GET' && ['stock', 'executors', 'catalog', 'assignments'].includes(resource);
  const isAssignment = method === 'POST' && resource === 'assignments';
  if (!isRead && !isAssignment) {
    response.setHeader('Allow', resource === 'assignments' ? 'GET, POST' : 'GET');
    return response.status(405).json({ ok: false, error: 'Only designated read endpoints and assignment creation are allowed' });
  }
  if (!verifyScope(request, isRead ? 'read' : 'assign')) return response.status(401).json({ ok: false, error: 'Unauthorized integration request' });
  try {
    const sql = getSql();
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
    if (JSON.stringify(body).length > 100000) return response.status(413).json({ ok:false,error:'Assignment payload is too large' });
    const input = normalizeAssignment(body);
    const actorId = String(process.env.MZJ_STRATEGY_INTEGRATION_USER_ID || '').trim();
    if (!isUuid(actorId)) return response.status(503).json({ ok:false,error:'Integration task creator is not configured' });
    const user = await loadUserProfile(actorId);
    if (!user || !canAccessSystem(user,'marketing') || !hasPermission(user,'marketing.task.create')) {
      return response.status(403).json({ ok:false,error:'Integration user cannot create Marketing tasks' });
    }
    await assertMarketingWorkflowReady(sql);
    const result = await createStrategyWorkflowTask(sql,input,user);
    return response.status(result.existed ? 200 : 201).json(result);
  } catch (error: any) {
    const message = String(error?.message || 'Integration failed');
    const invalid = /^Invalid|^Missing|^Unsupported|^Valid taskId|^JSON object/.test(message);
    if (!invalid) console.error('Strategy integration request failed', { resource, code: error?.code || null });
    return response.status(invalid ? 400 : 500).json({ ok:false,error: invalid ? message : 'Unable to complete the integration request' });
  }
}
