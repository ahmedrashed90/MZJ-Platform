import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { getSql } from "../_db.js";
import { requireUser, requestIp, type SessionUser } from "../_auth.js";
import { canAccessSystem, hasPermission } from "../../shared/system-access.js";
import { getSystemAccess } from "../_access-control.js";
import { completePhotographyRequest } from "../operations/index.js";
import { ensureMarketingSchema } from "../_marketing-schema.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { buildMarketingStorageKey, createDownloadUrl, createUploadUrl, mediaStorageConfigured } from "../_media-storage.js";

function clean(value: unknown) { return String(value ?? "").trim(); }
function bodyObject(request: VercelRequest) {
  if (request.body && typeof request.body === "object") return request.body as Record<string, any>;
  if (typeof request.body === "string") { try { return JSON.parse(request.body || "{}"); } catch { return {}; } }
  return {};
}
function bool(value: unknown) { return value === true || value === "true" || value === 1 || value === "1"; }
function numberValue(value: unknown, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function arrayValue<T = any>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }
function dbJson(value: unknown): any { return JSON.parse(JSON.stringify(value ?? null)); }
const TEMPLATE_FIELDS = ["proposedName", "goal", "mainMessage", "hook", "mainScript", "cta", "caption", "hashtags"] as const;
function cleanTemplateData(value: unknown) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const output: Record<string, string> = {};
  for (const key of TEMPLATE_FIELDS) if (Object.prototype.hasOwnProperty.call(input, key)) output[key] = clean(input[key]);
  return output;
}
function marketingAccess(user: SessionUser) { return getSystemAccess(user, "marketing"); }
function canViewAllTasks(user: SessionUser) { return hasPermission(user, "marketing.task.view_all") && marketingAccess(user).dataScope === "all"; }
function marketingDepartmentCodes(user: SessionUser) { const codes = marketingAccess(user).departmentCodes; return codes.length ? codes : ["__no_department__"]; }
async function canAccessMarketingEntity(sql: ReturnType<typeof getSql>, user: SessionUser, sourceType: string, sourceId: string) {
  const access = marketingAccess(user);
  if (access.dataScope === "all") return true;
  const departmentCodes = marketingDepartmentCodes(user);
  const createdByMe = access.dataScope === "created_by_me";
  const departmentScoped = ["department", "departments", "branch_and_department"].includes(access.dataScope);
  const [visible] = await sql<any[]>`
    select 1
    where exists (
      select 1 from marketing.tasks t
      where t.source_type=${sourceType} and t.source_id=${sourceId}::uuid and t.is_deleted=false
        and (
          t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid
          or (${departmentScoped}=true and exists (
            select 1 from core.user_departments ud join core.departments d on d.id=ud.department_id
            where ud.user_id in (t.assigned_to,t.paired_content_user_id) and d.code in ${sql(departmentCodes)}
          ))
        )
    ) or (${createdByMe}=true and exists (
      select 1 from marketing.campaigns c where ${sourceType}='campaign' and c.id=${sourceId}::uuid and c.created_by=${user.id}::uuid
      union all
      select 1 from marketing.agendas a where ${sourceType}='agenda' and a.id=${sourceId}::uuid and a.created_by=${user.id}::uuid
    ))
    limit 1
  `;
  return Boolean(visible);
}
async function assertMarketingEntityAccess(sql: ReturnType<typeof getSql>, user: SessionUser, sourceType: string, sourceId: string) {
  if (!sourceId || !await canAccessMarketingEntity(sql, user, sourceType, sourceId)) throw new Error("السجل خارج نطاق بياناتك");
}
async function canAccessMarketingTask(sql: ReturnType<typeof getSql>, user: SessionUser, taskId: string) {
  const access = marketingAccess(user);
  if (access.dataScope === "all") return true;
  const departmentCodes = marketingDepartmentCodes(user);
  const createdByMe = access.dataScope === "created_by_me";
  const departmentScoped = ["department", "departments", "branch_and_department"].includes(access.dataScope);
  const [visible] = await sql<any[]>`
    select 1 from marketing.tasks t
    where t.id=${taskId}::uuid and t.is_deleted=false and (
      t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid
      or (${departmentScoped}=true and exists (
        select 1 from core.user_departments ud join core.departments d on d.id=ud.department_id
        where ud.user_id in (t.assigned_to,t.paired_content_user_id) and d.code in ${sql(departmentCodes)}
      ))
      or (${createdByMe}=true and (
        exists(select 1 from marketing.campaigns c where t.source_type='campaign' and c.id=t.source_id and c.created_by=${user.id}::uuid)
        or exists(select 1 from marketing.agendas a where t.source_type='agenda' and a.id=t.source_id and a.created_by=${user.id}::uuid)
      ))
    ) limit 1
  `;
  return Boolean(visible);
}
function canUseMarketing(user: SessionUser) { return canAccessSystem(user, "marketing"); }
function safeCode(value: unknown) { return clean(value).toUpperCase().replace(/[^A-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48); }
function isoDate(value: unknown) { const text = clean(value); return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null; }
function sourceTable(sourceType: string) { return sourceType === "agenda" ? "marketing.agendas" : "marketing.campaigns"; }
function tokenKey() {
  return crypto.createHash("sha256").update(clean(process.env.MZJ_TOKEN_ENCRYPTION_KEY || process.env.SESSION_SECRET || process.env.MZJ_SETUP_KEY || "mzj-platform-local-development-key")).digest();
}
function encryptToken(value: unknown) {
  const text = clean(value); if (!text) return null;
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", tokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}
function decryptToken(value: unknown) {
  const text = clean(value); if (!text) return "";
  const data = Buffer.from(text, "base64url"); const iv = data.subarray(0, 12); const tag = data.subarray(12, 28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", tokenKey(), iv); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
}
function publicConnection(row: any) {
  return {
    platform: row.platform, connected: Boolean(row.connected), status: row.status, state: row.state, source: row.source,
    accountId: row.account_id || "", accountName: row.account_name || "", pageId: row.page_id || "", pageName: row.page_name || "",
    igUserId: row.ig_user_id || "", username: row.username || "", pages: row.pages || [],
    hasToken: Boolean(row.access_token_encrypted || row.user_access_token_encrypted || row.page_access_token_encrypted),
    tokenStored: Boolean(row.access_token_encrypted || row.user_access_token_encrypted || row.page_access_token_encrypted),
    connectedAtIso: row.connected_at || null, updatedAtIso: row.updated_at || null,
  };
}
async function audit(sql: ReturnType<typeof getSql>, user: SessionUser, action: string, entityType: string, entityId: string | null, afterData?: unknown, beforeData?: unknown, ip?: string | null) {
  await sql`insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,before_data,after_data,ip_address) values (${user.id}::uuid,'marketing',${action},${entityType},${entityId},${beforeData ? sql.json(dbJson(beforeData)) : null},${afterData ? sql.json(dbJson(afterData)) : null},${ip || null})`;
}

async function marketingMeta(sql: ReturnType<typeof getSql>, user: SessionUser) {
  const [users, departments, actions, creativeTypes, campaignTypes, platforms, postTypes, funnels] = await Promise.all([
    sql<any[]>`
      select u.id::text,u.full_name,u.email,u.mobile,u.is_active,u.can_receive_tasks
      from core.users u
      where u.is_active=true and exists(select 1 from core.user_systems us where us.user_id=u.id and us.system_code='marketing' and us.is_enabled=true)
      order by u.full_name
    `,
    sql<any[]>`
      select d.id::text,d.name,d.is_content,d.is_active,
        coalesce(
          json_agg(
            json_build_object('id',u.id::text,'fullName',u.full_name,'email',u.email)
            order by u.full_name
          ) filter(where u.id is not null),
          '[]'::json
        ) as users
      from marketing.departments d
      left join marketing.department_users du on du.department_id=d.id
      left join core.users u on u.id=du.user_id and u.is_active=true and exists(select 1 from core.user_systems us where us.user_id=u.id and us.system_code='marketing' and us.is_enabled=true)
      where d.is_active=true
      group by d.id
      order by d.is_content desc,d.name
    `,
    sql<any[]>`select a.id::text,a.department_id::text,d.name as department_name,a.name,a.percentage::float,a.admin_only,a.sort_order from marketing.assignment_actions a join marketing.departments d on d.id=a.department_id where a.is_active=true order by d.name,a.sort_order,a.created_at`,
    sql<any[]>`select c.id::text,c.name,c.short_code,c.primary_department_id::text,d.name as primary_department_name,c.is_active from marketing.creative_types c left join marketing.departments d on d.id=c.primary_department_id where c.is_active=true order by c.name`,
    sql<any[]>`select id::text,name,short_code,code_prefix,sequence_value,is_active from marketing.campaign_types where is_active=true order by name`,
    sql<any[]>`select id::text,code,name,is_active from marketing.platforms where is_active=true order by name`,
    sql<any[]>`select p.id::text,p.platform_id::text,p.name,p.width,p.height from marketing.platform_post_types p where p.is_active=true order by p.name`,
    sql<any[]>`select id::text,name,active,source,created_at from marketing.funnels where active=true order by created_at`,
  ]);
  const connections = await sql<any[]>`select * from marketing.platform_connections order by platform`;
  return { ok: true, users, departments, actions, creativeTypes, campaignTypes, platforms, postTypes, funnels, connections: connections.map(publicConnection), permissions: { effective: user.permissions.filter((code) => code.startsWith("marketing.")) } };
}

async function loadOperationsCars(sql: ReturnType<typeof getSql>) {
  return sql<any[]>`
    select v.id::text,v.vin,v.car_name,v.statement,v.model_year,v.exterior_color,v.interior_color,
      v.location_id::text,l.code as location_code,l.name as location_name,l.branch_code,
      v.status_code,coalesce(vs.name,v.status_code) as status_name,
      coalesce(v.photographed,false) as photographed,v.photographed_at,
      coalesce(a.financial_approved,false) as financial_approved,
      coalesce(a.administrative_approved,false) as administrative_approved,
      coalesce(req.active_requests,0)::int as active_transfer_requests,
      coalesce(ms.content_usage,'[]'::jsonb) as content_usage
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id
    left join operations.vehicle_statuses vs on vs.code=v.status_code
    left join lateral (
      select va.financial_approved,va.administrative_approved
      from operations.vehicle_approvals va
      where va.vehicle_id=v.id and va.is_active=true
      order by va.cycle_no desc limit 1
    ) a on true
    left join lateral (
      select count(*)::int as active_requests
      from operations.transfer_request_vehicles rv
      join operations.transfer_requests r on r.id=rv.transfer_request_id
      where rv.vehicle_id=v.id and r.is_deleted=false and r.cancelled_at is null and r.status<>'completed'
    ) req on true
    left join marketing.stock_vehicle_state ms on ms.vehicle_id=v.id
    where v.is_deleted=false and v.archived_at is null and coalesce(v.is_inventory_active,true)=true
    order by v.car_name,v.statement,v.exterior_color,v.interior_color,v.vin
  `;
}

async function nextCampaignCode(sql: ReturnType<typeof getSql>, campaignTypeId: string) {
  return sql.begin(async (tx) => {
    const [type] = await tx<any[]>`select * from marketing.campaign_types where id=${campaignTypeId}::uuid and is_active=true for update`;
    if (!type) throw new Error("نوع الحملة غير موجود");
    const sequence = Number(type.sequence_value || 0) + 1;
    await tx`update marketing.campaign_types set sequence_value=${sequence},updated_at=now() where id=${campaignTypeId}::uuid`;
    const now = new Date(); const year = now.getUTCFullYear(); const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    return `${safeCode(type.code_prefix || type.short_code)}-${year}-${month}-${String(sequence).padStart(3, "0")}`;
  });
}

function contentDepartmentId(metaDepartments: any[]) { return clean(metaDepartments.find((item) => item.is_content)?.id); }

async function createTasksForCreative(tx: any, input: { sourceType: "campaign" | "agenda"; sourceId: string; campaignId?: string | null; agendaId?: string | null; sourceCode: string; sourceName: string; creativeId: string; creativeIndex: number; creativeName: string; creativeType: string; contentDepartmentId: string; contentAssignments: any[]; primaryDepartmentId?: string; primaryAssignments: any[]; optionalAssignments: any[]; requiredFromContent?: string }) {
  const templates = new Map<string, string>();
  let templateIndex = 0;
  for (const content of input.contentAssignments) {
    const contentUserId = clean(content.userId); if (!contentUserId) continue;
    templateIndex += 1;
    const taskNo = `${safeCode(input.sourceCode || input.sourceName)}_${input.sourceId.slice(0,8).toUpperCase()}_TPL_${input.creativeIndex}_${templateIndex}`;
    const [template] = await tx<any[]>`
      insert into marketing.task_templates(source_type,source_id,creative_id,content_user_id,task_no,status,progress,due_on,department_note,template_data)
      values (${input.sourceType},${input.sourceId}::uuid,${input.creativeId}::uuid,${contentUserId}::uuid,${taskNo},'not_started',0,${isoDate(content.dueOn)},${clean(content.note)||null},${tx.json(dbJson({ sourceName: input.sourceName, sourceCode: input.sourceCode, creativeName: input.creativeName, creativeType: input.creativeType, requiredFromContent: input.requiredFromContent || "" }))})
      returning id::text
    `;
    templates.set(contentUserId, template.id);
    await tx`
      insert into marketing.tasks(campaign_id,agenda_id,source_type,source_id,creative_id,department_code,department_id,assigned_to,paired_content_user_id,task_template_id,task_kind,title,status,due_at,progress,note)
      values (${input.campaignId ? tx`${input.campaignId}::uuid` : null},${input.agendaId ? tx`${input.agendaId}::uuid` : null},${input.sourceType},${input.sourceId}::uuid,${input.creativeId}::uuid,'content',${input.contentDepartmentId ? tx`${input.contentDepartmentId}::uuid` : null},${contentUserId}::uuid,${contentUserId}::uuid,${template.id}::uuid,'task_template',${`Task Template - ${input.creativeName}`},'required',${isoDate(content.dueOn)},0,${clean(content.note)||null})
    `;
  }
  const groups = [
    { departmentId: clean(input.primaryDepartmentId), assignments: input.primaryAssignments },
    ...arrayValue(input.optionalAssignments).map((group: any) => ({ departmentId: clean(group.departmentId), assignments: arrayValue(group.assignments) })),
  ];
  let taskIndex = 0;
  for (const group of groups) {
    if (!group.departmentId) continue;
    for (const assignment of arrayValue(group.assignments)) {
      const assignedTo = clean(assignment.userId); if (!assignedTo) continue;
      for (const contentUserId of arrayValue<string>(assignment.contentUserIds).map(clean).filter(Boolean)) {
        const templateId = templates.get(contentUserId); if (!templateId) continue;
        taskIndex += 1;
        const [task] = await tx<any[]>`
          insert into marketing.tasks(campaign_id,agenda_id,source_type,source_id,creative_id,department_code,department_id,assigned_to,paired_content_user_id,task_template_id,task_kind,title,status,due_at,progress,note)
          values (${input.campaignId ? tx`${input.campaignId}::uuid` : null},${input.agendaId ? tx`${input.agendaId}::uuid` : null},${input.sourceType},${input.sourceId}::uuid,${input.creativeId}::uuid,'execution',${group.departmentId}::uuid,${assignedTo}::uuid,${contentUserId}::uuid,${templateId}::uuid,'execution',${`${input.creativeName} - تنفيذ ${taskIndex}`},'required',${isoDate(assignment.dueOn)},0,${clean(assignment.note)||null})
          returning id::text
        `;
        await tx`insert into marketing.task_action_progress(task_id,action_id) select ${task.id}::uuid,id from marketing.assignment_actions where department_id=${group.departmentId}::uuid and is_active=true on conflict do nothing`;
      }
    }
  }
}

async function createCampaign(sql: ReturnType<typeof getSql>, body: Record<string, any>, user: SessionUser) {
  const campaignTypeId = clean(body.campaignTypeId); const name = clean(body.name); const start = isoDate(body.publishStart); const end = isoDate(body.publishEnd);
  if (!campaignTypeId || !name || !start || !end) throw new Error("بيانات الحملة الأساسية غير مكتملة");
  const code = clean(body.campaignCode) || await nextCampaignCode(sql, campaignTypeId);
  const meta = await marketingMeta(sql, user); const contentId = contentDepartmentId(meta.departments);
  return sql.begin(async (tx) => {
    const [campaign] = await tx<any[]>`
      insert into marketing.campaigns(campaign_code,name,campaign_type_id,campaign_type,objective,status,campaign_date,publish_start,publish_end,starts_at,ends_at,required_from_content,payload,progress,created_by)
      select ${code},${name},ct.id,ct.name,${clean(body.objective)||null},'required',${isoDate(body.campaignDate)||new Date().toISOString().slice(0,10)},${start},${end},${start}::date,${end}::date,${clean(body.requiredFromContent)||null},${tx.json(dbJson(body))},0,${user.id}::uuid
      from marketing.campaign_types ct where ct.id=${campaignTypeId}::uuid
      returning id::text,campaign_code,name
    `;
    if (!campaign) throw new Error("نوع الحملة غير صحيح");
    const creativeMap = new Map<string, string>();
    let creativeIndex = 0;
    for (const rawCreative of arrayValue(body.creatives)) {
      creativeIndex += 1;
      const creativeTypeId = clean(rawCreative.creativeTypeId);
      const [creativeType] = await tx<any[]>`select c.*,d.name as department_name from marketing.creative_types c left join marketing.departments d on d.id=c.primary_department_id where c.id=${creativeTypeId}::uuid`;
      if (!creativeType) continue;
      const tempId = clean(rawCreative.tempId || rawCreative.id || `creative-${creativeIndex}`);
      const instanceCode = `${safeCode(creativeType.short_code)}${String(creativeIndex).padStart(2,"0")}`;
      const [creative] = await tx<any[]>`
        insert into marketing.creatives(campaign_id,creative_type,creative_type_id,quantity,status,instance_code,name,primary_department_id,cars,content_assignments,primary_assignments,optional_assignments,platform_assignments,notes)
        values (${campaign.id}::uuid,${creativeType.name},${creativeTypeId}::uuid,${Math.max(1,numberValue(rawCreative.quantity,1))},'required',${instanceCode},${creativeType.name},${creativeType.primary_department_id},${tx.json(dbJson(arrayValue(rawCreative.cars)))},${tx.json(dbJson(arrayValue(rawCreative.contentAssignments)))},${tx.json(dbJson(arrayValue(rawCreative.primaryAssignments)))},${tx.json(dbJson(arrayValue(rawCreative.optionalAssignments)))},${tx.json(dbJson(arrayValue(rawCreative.platforms)))},${tx.json(dbJson(rawCreative.notes || {}))}) returning id::text
      `;
      creativeMap.set(tempId, creative.id);
      await createTasksForCreative(tx, { sourceType: "campaign", sourceId: campaign.id, campaignId: campaign.id, sourceCode: code, sourceName: name, creativeId: creative.id, creativeIndex, creativeName: creativeType.name, creativeType: creativeType.name, contentDepartmentId: contentId, contentAssignments: arrayValue(rawCreative.contentAssignments), primaryDepartmentId: clean(creativeType.primary_department_id), primaryAssignments: arrayValue(rawCreative.primaryAssignments), optionalAssignments: arrayValue(rawCreative.optionalAssignments), requiredFromContent: clean(body.requiredFromContent) });
    }
    for (const budget of arrayValue(body.budgets)) {
      const creativeId = creativeMap.get(clean(budget.creativeTempId)) || null;
      const amounts = arrayValue(budget.platformAmounts); const total = amounts.reduce((sum, item: any) => sum + numberValue(item.amount), 0);
      await tx`insert into marketing.budget_items(campaign_id,funnel_id,creative_id,ads_count,content_goal,expected_goal,platform_amounts,total) values (${campaign.id}::uuid,${clean(budget.funnelId) ? tx`${clean(budget.funnelId)}::uuid` : null},${creativeId ? tx`${creativeId}::uuid` : null},${Math.max(1,numberValue(budget.adsCount,1))},${clean(budget.contentGoal)||null},${clean(budget.expectedGoal)||null},${tx.json(dbJson(amounts))},${total})`;
    }
    for (const item of arrayValue(body.schedule)) {
      const creativeId = creativeMap.get(clean(item.creativeTempId)); if (!creativeId || !isoDate(item.date)) continue;
      const executionTasks = await tx<any[]>`select id::text from marketing.tasks where creative_id=${creativeId}::uuid and task_kind='execution' and is_deleted=false order by created_at`;
      const scheduleTasks = executionTasks.length ? executionTasks : [{ id: null }];
      for (const scheduleTask of scheduleTasks) {
        const [scheduleGroup] = await tx<any[]>`select gen_random_uuid()::text as id`;
        for (const platform of arrayValue(item.platforms)) for (const postTypeId of arrayValue<string>(platform.postTypeIds)) {
          await tx`insert into marketing.publish_schedule(group_id,source_type,source_id,creative_id,task_id,publish_date,platform_id,post_type_id) values (${scheduleGroup.id}::uuid,'campaign',${campaign.id}::uuid,${creativeId}::uuid,${scheduleTask.id ? tx`${scheduleTask.id}::uuid` : null},${isoDate(item.date)},${clean(platform.platformId)}::uuid,${clean(postTypeId)}::uuid)`;
        }
      }
    }
    await audit(tx as any,user,"campaign_created","campaign",campaign.id,{ code,name },undefined,undefined);
    return { ok: true, id: campaign.id, code, message: "تم إنشاء الحملة والتاسكات" };
  });
}

function datesBetween(start: string, end: string) {
  const output: string[] = []; const date = new Date(`${start}T00:00:00Z`); const last = new Date(`${end}T00:00:00Z`);
  while (date <= last && output.length < 370) { output.push(date.toISOString().slice(0,10)); date.setUTCDate(date.getUTCDate()+1); }
  return output;
}

async function createAgenda(sql: ReturnType<typeof getSql>, body: Record<string, any>, user: SessionUser) {
  const name = clean(body.name); const start = isoDate(body.publishStart); const end = isoDate(body.publishEnd); const monthKey = clean(body.monthKey);
  if (!name || !start || !end || !monthKey) throw new Error("بيانات الأجندة الأساسية غير مكتملة");
  const meta = await marketingMeta(sql,user); const contentId = contentDepartmentId(meta.departments);
  return sql.begin(async (tx) => {
    const [agenda] = await tx<any[]>`insert into marketing.agendas(name,month_key,publish_start,publish_end,status,payload,progress,created_by) values (${name},${monthKey},${start},${end},'required',${tx.json(dbJson(body))},0,${user.id}::uuid) returning id::text`;
    let creativeIndex = 0;
    for (const day of arrayValue(body.days)) {
      const dayDate = isoDate(day.date); if (!dayDate) continue;
      for (const rawCreative of arrayValue(day.creatives)) {
        const quantity = Math.max(1,numberValue(rawCreative.quantity,1));
        for (let instance=0; instance<quantity; instance += 1) {
          creativeIndex += 1;
          const creativeTypeId = clean(rawCreative.creativeTypeId);
          const [creativeType] = await tx<any[]>`select * from marketing.creative_types where id=${creativeTypeId}::uuid`;
          if (!creativeType) continue;
          const instanceCode = `${safeCode(creativeType.short_code)}${String(creativeIndex).padStart(2,"0")}`;
          const [creative] = await tx<any[]>`
            insert into marketing.creatives(agenda_id,creative_type,creative_type_id,quantity,status,instance_code,name,primary_department_id,cars,content_assignments,primary_assignments,optional_assignments,platform_assignments,schedule_day,notes)
            values (${agenda.id}::uuid,${creativeType.name},${creativeTypeId}::uuid,1,'required',${instanceCode},${creativeType.name},${creativeType.primary_department_id},${tx.json(dbJson(arrayValue(rawCreative.cars)))},${tx.json(dbJson(arrayValue(rawCreative.contentAssignments)))},${tx.json(dbJson(arrayValue(rawCreative.primaryAssignments)))},${tx.json(dbJson(arrayValue(rawCreative.optionalAssignments)))},${tx.json(dbJson(arrayValue(rawCreative.platforms)))},${dayDate},${tx.json(dbJson(rawCreative.notes || {}))}) returning id::text
          `;
          await createTasksForCreative(tx,{ sourceType:"agenda",sourceId:agenda.id,agendaId:agenda.id,sourceCode:monthKey,sourceName:name,creativeId:creative.id,creativeIndex,creativeName:creativeType.name,creativeType:creativeType.name,contentDepartmentId:contentId,contentAssignments:arrayValue(rawCreative.contentAssignments),primaryDepartmentId:clean(creativeType.primary_department_id),primaryAssignments:arrayValue(rawCreative.primaryAssignments),optionalAssignments:arrayValue(rawCreative.optionalAssignments),requiredFromContent:"" });
          const executionTasks = await tx<any[]>`select id::text from marketing.tasks where creative_id=${creative.id}::uuid and task_kind='execution' and is_deleted=false order by created_at`;
          const scheduleTasks = executionTasks.length ? executionTasks : [{ id: null }];
          for (const scheduleTask of scheduleTasks) {
            const [scheduleGroup] = await tx<any[]>`select gen_random_uuid()::text as id`;
            for (const platform of arrayValue(rawCreative.platforms)) for (const postTypeId of arrayValue<string>(platform.postTypeIds)) {
              await tx`insert into marketing.publish_schedule(group_id,source_type,source_id,creative_id,task_id,publish_date,platform_id,post_type_id) values (${scheduleGroup.id}::uuid,'agenda',${agenda.id}::uuid,${creative.id}::uuid,${scheduleTask.id ? tx`${scheduleTask.id}::uuid` : null},${dayDate},${clean(platform.platformId)}::uuid,${clean(postTypeId)}::uuid)`;
            }
          }
        }
      }
    }
    await audit(tx as any,user,"agenda_created","agenda",agenda.id,{ name,monthKey },undefined,undefined);
    return { ok:true,id:agenda.id,message:"تم إنشاء الأجندة والتاسكات" };
  });
}

async function recalculateProgress(sql: any, sourceType: string, sourceId: string) {
  const rows = await sql<any[]>`
    select coalesce(t.department_id::text,'content') as department_id,avg(t.progress)::float as progress
    from marketing.tasks t where t.source_type=${sourceType} and t.source_id=${sourceId}::uuid and t.is_deleted=false
    group by coalesce(t.department_id::text,'content')
  `;
  const progress = rows.length ? rows.reduce((sum:number,row:any)=>sum+numberValue(row.progress),0)/rows.length : 0;
  if (sourceType === "agenda") await sql`update marketing.agendas set progress=${progress},status=case when ${progress}>=100 then 'ready_publish' else status end,updated_at=now() where id=${sourceId}::uuid`;
  else await sql`update marketing.campaigns set progress=${progress},status=case when ${progress}>=100 then 'ready_publish' else status end,updated_at=now() where id=${sourceId}::uuid`;
  return progress;
}

async function dashboard(sql: ReturnType<typeof getSql>, user: SessionUser) {
  const access = marketingAccess(user);
  const unrestricted = access.dataScope === "all";
  const createdByMe = access.dataScope === "created_by_me";
  const departmentScoped = ["department", "departments", "branch_and_department"].includes(access.dataScope);
  const departmentCodes = marketingDepartmentCodes(user);
  const taskFilter = unrestricted
    ? sql`true`
    : sql`(
      t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid
      or (${departmentScoped}=true and exists(
        select 1 from core.user_departments ud join core.departments cd on cd.id=ud.department_id
        where ud.user_id in (t.assigned_to,t.paired_content_user_id) and cd.code in ${sql(departmentCodes)}
      ))
      or (${createdByMe}=true and (
        exists(select 1 from marketing.campaigns x where t.source_type='campaign' and x.id=t.source_id and x.created_by=${user.id}::uuid)
        or exists(select 1 from marketing.agendas x where t.source_type='agenda' and x.id=t.source_id and x.created_by=${user.id}::uuid)
      ))
    )`;
  const tasks = await sql<any[]>`
    select t.id::text,t.source_type,t.source_id::text,t.task_kind,t.title,t.status,t.progress::float,t.due_at,t.received_at,t.note,
      t.assigned_to::text,u.full_name as assigned_name,t.paired_content_user_id::text,cu.full_name as content_user_name,
      d.id::text as department_id,d.name as department_name,c.name as creative_name,c.instance_code,
      coalesce(cam.name,ag.name) as source_name,cam.campaign_code,tt.status as template_status,tt.approved_data,
      f.id::text as final_file_id,f.original_name as final_file_name
    from marketing.tasks t
    left join core.users u on u.id=t.assigned_to left join core.users cu on cu.id=t.paired_content_user_id
    left join marketing.departments d on d.id=t.department_id left join marketing.creatives c on c.id=t.creative_id
    left join marketing.campaigns cam on t.source_type='campaign' and cam.id=t.source_id
    left join marketing.agendas ag on t.source_type='agenda' and ag.id=t.source_id
    left join marketing.task_templates tt on tt.id=t.task_template_id left join marketing.files f on f.id=t.final_file_id
    where t.is_deleted=false and ${taskFilter}
    order by t.received_at nulls first,t.due_at nulls last,t.created_at
  `;
  const entities = await sql<any[]>`
    select 'campaign' as source_type,c.id::text,c.name,c.campaign_code as code,c.status,c.progress::float,c.publish_start,c.publish_end,c.created_at
    from marketing.campaigns c
    where c.is_deleted=false and c.archived_at is null and (
      ${unrestricted}=true or (${createdByMe}=true and c.created_by=${user.id}::uuid)
      or exists(select 1 from marketing.tasks t where t.source_type='campaign' and t.source_id=c.id and t.is_deleted=false and ${taskFilter})
    )
    union all
    select 'agenda',a.id::text,a.name,a.month_key,a.status,a.progress::float,a.publish_start,a.publish_end,a.created_at
    from marketing.agendas a
    where a.archived_at is null and (
      ${unrestricted}=true or (${createdByMe}=true and a.created_by=${user.id}::uuid)
      or exists(select 1 from marketing.tasks t where t.source_type='agenda' and t.source_id=a.id and t.is_deleted=false and ${taskFilter})
    )
    order by created_at desc
  `;
  return { ok:true, required: tasks.filter((task)=>!task.received_at), received: tasks.filter((task)=>task.received_at), entities, permissions:user.permissions.filter((code)=>code.startsWith("marketing.")) };
}

async function databaseRows(sql: ReturnType<typeof getSql>, user: SessionUser) {
  const access = marketingAccess(user);
  const unrestricted = access.dataScope === "all";
  const createdByMe = access.dataScope === "created_by_me";
  const departmentScoped = ["department", "departments", "branch_and_department"].includes(access.dataScope);
  const departmentCodes = marketingDepartmentCodes(user);
  const rows = await sql<any[]>`
    select 'campaign' as source_type,c.id::text,c.campaign_date as record_date,c.campaign_code as code,c.name,coalesce(ct.name,c.campaign_type) as type,c.objective,c.publish_start,c.publish_end,c.status,c.progress::float,c.archived_at,c.created_at,
      (select count(*)::int from marketing.tasks t where t.source_type='campaign' and t.source_id=c.id and t.is_deleted=false) as tasks_count,
      (select count(*)::int from marketing.tasks t where t.source_type='campaign' and t.source_id=c.id and t.progress>=100 and t.is_deleted=false) as completed_count,
      c.result_file_id::text,coalesce(jsonb_array_length(c.links),0)::int as links_count
    from marketing.campaigns c left join marketing.campaign_types ct on ct.id=c.campaign_type_id
    where c.is_deleted=false and (
      ${unrestricted}=true or (${createdByMe}=true and c.created_by=${user.id}::uuid)
      or exists(select 1 from marketing.tasks t where t.source_type='campaign' and t.source_id=c.id and t.is_deleted=false and (
        t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid
        or (${departmentScoped}=true and exists(select 1 from core.user_departments ud join core.departments d on d.id=ud.department_id where ud.user_id in(t.assigned_to,t.paired_content_user_id) and d.code in ${sql(departmentCodes)}))
      ))
    )
    union all
    select 'agenda',a.id::text,a.created_at::date,a.month_key,a.name,'أجندة',null,a.publish_start,a.publish_end,a.status,a.progress::float,a.archived_at,a.created_at,
      (select count(*)::int from marketing.tasks t where t.source_type='agenda' and t.source_id=a.id and t.is_deleted=false),
      (select count(*)::int from marketing.tasks t where t.source_type='agenda' and t.source_id=a.id and t.progress>=100 and t.is_deleted=false),
      a.result_file_id::text,coalesce(jsonb_array_length(a.links),0)::int
    from marketing.agendas a
    where ${unrestricted}=true or (${createdByMe}=true and a.created_by=${user.id}::uuid)
      or exists(select 1 from marketing.tasks t where t.source_type='agenda' and t.source_id=a.id and t.is_deleted=false and (
        t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid
        or (${departmentScoped}=true and exists(select 1 from core.user_departments ud join core.departments d on d.id=ud.department_id where ud.user_id in(t.assigned_to,t.paired_content_user_id) and d.code in ${sql(departmentCodes)}))
      ))
    order by created_at desc
  `;
  return { ok:true,rows };
}

async function entityDetail(sql: ReturnType<typeof getSql>, sourceType: string, id: string, user: SessionUser) {
  await assertMarketingEntityAccess(sql,user,sourceType,id);
  const [entity] = sourceType === "agenda"
    ? await sql<any[]>`select 'agenda' as source_type,a.*,a.id::text,a.result_file_id::text from marketing.agendas a where a.id=${id}::uuid`
    : await sql<any[]>`select 'campaign' as source_type,c.*,c.id::text,c.campaign_type_id::text,c.result_file_id::text,ct.name as campaign_type_name from marketing.campaigns c left join marketing.campaign_types ct on ct.id=c.campaign_type_id where c.id=${id}::uuid and c.is_deleted=false`;
  if (!entity) throw new Error("السجل غير موجود");
  const [creatives,tasks,budgets,schedule,reviewHistory,files] = await Promise.all([
    sql<any[]>`select c.*,c.id::text,c.campaign_id::text,c.agenda_id::text,c.creative_type_id::text,c.primary_department_id::text,ct.name as creative_type_name,d.name as primary_department_name from marketing.creatives c left join marketing.creative_types ct on ct.id=c.creative_type_id left join marketing.departments d on d.id=c.primary_department_id where (${sourceType}='campaign' and c.campaign_id=${id}::uuid) or (${sourceType}='agenda' and c.agenda_id=${id}::uuid) order by c.created_at`,
    sql<any[]>`select t.*,t.id::text,t.source_id::text,t.department_id::text,t.assigned_to::text,t.paired_content_user_id::text,t.task_template_id::text,u.full_name as assigned_name,cu.full_name as content_user_name,d.name as department_name,c.name as creative_name,tt.status as template_status,tt.template_data,tt.approved_data,tt.file_id::text as template_file_id,ff.original_name as final_file_name from marketing.tasks t left join core.users u on u.id=t.assigned_to left join core.users cu on cu.id=t.paired_content_user_id left join marketing.departments d on d.id=t.department_id left join marketing.creatives c on c.id=t.creative_id left join marketing.task_templates tt on tt.id=t.task_template_id left join marketing.files ff on ff.id=t.final_file_id where t.source_type=${sourceType} and t.source_id=${id}::uuid and t.is_deleted=false order by d.name,u.full_name`,
    sourceType === "campaign" ? sql<any[]>`select b.*,b.id::text,b.funnel_id::text,b.creative_id::text,f.name as funnel_name,c.name as creative_name from marketing.budget_items b left join marketing.funnels f on f.id=b.funnel_id left join marketing.creatives c on c.id=b.creative_id where b.campaign_id=${id}::uuid order by b.created_at` : Promise.resolve([]),
    sql<any[]>`select s.*,s.id::text,s.platform_id::text,s.post_type_id::text,p.name as platform_name,pt.name as post_type_name,c.name as creative_name,c.instance_code from marketing.publish_schedule s left join marketing.platforms p on p.id=s.platform_id left join marketing.platform_post_types pt on pt.id=s.post_type_id left join marketing.creatives c on c.id=s.creative_id where s.source_type=${sourceType} and s.source_id=${id}::uuid order by s.publish_date,p.name,pt.name`,
    sql<any[]>`select h.*,h.id::text,h.task_template_id::text from marketing.task_review_history h join marketing.task_templates tt on tt.id=h.task_template_id where tt.source_type=${sourceType} and tt.source_id=${id}::uuid order by h.created_at desc`,
    sql<any[]>`select f.*,f.id::text from marketing.files f where f.source_type=${sourceType} and f.source_id=${id}::uuid order by f.created_at desc`,
  ]);
  return { ok:true,entity,creatives,tasks,budgets,schedule,reviewHistory,files };
}

async function taskDetail(sql: ReturnType<typeof getSql>, id: string, user: SessionUser) {
  const [task] = await sql<any[]>`
    select t.*,t.id::text,t.source_id::text,t.department_id::text,t.assigned_to::text,t.paired_content_user_id::text,t.task_template_id::text,
      u.full_name as assigned_name,cu.full_name as content_user_name,d.name as department_name,c.name as creative_name,c.cars,c.instance_code,
      coalesce(cam.name,ag.name) as source_name,cam.campaign_code,cam.campaign_date,cam.campaign_type,cam.objective,cam.required_from_content,
      coalesce(cam.publish_start,ag.publish_start) as campaign_start,coalesce(cam.publish_end,ag.publish_end) as campaign_end,
      tt.task_no,tt.status as template_status,tt.progress as template_progress,tt.due_on as template_due_on,tt.department_note as template_department_note,tt.admin_note,tt.template_data,tt.approved_data,tt.file_id::text as template_file_id,
      ff.original_name as final_file_name
    from marketing.tasks t left join core.users u on u.id=t.assigned_to left join core.users cu on cu.id=t.paired_content_user_id left join marketing.departments d on d.id=t.department_id left join marketing.creatives c on c.id=t.creative_id
    left join marketing.campaigns cam on t.source_type='campaign' and cam.id=t.source_id left join marketing.agendas ag on t.source_type='agenda' and ag.id=t.source_id
    left join marketing.task_templates tt on tt.id=t.task_template_id left join marketing.files ff on ff.id=t.final_file_id
    where t.id=${id}::uuid and t.is_deleted=false
  `;
  if (!task) throw new Error("التاسك غير موجود");
  if (!await canAccessMarketingTask(sql,user,id)) throw new Error("لا توجد صلاحية لعرض التاسك");
  const actionsPromise = task.department_id
    ? sql<any[]>`select a.id::text,a.name,a.percentage::float,a.admin_only,a.sort_order,coalesce(p.completed,false) as completed,p.completed_at,u.full_name as completed_by_name from marketing.assignment_actions a left join marketing.task_action_progress p on p.action_id=a.id and p.task_id=${id}::uuid left join core.users u on u.id=p.completed_by where a.department_id=${task.department_id}::uuid and a.is_active=true order by a.sort_order,a.created_at`
    : Promise.resolve([] as any[]);
  const [actions,history] = await Promise.all([
    actionsPromise,
    task.task_template_id ? sql<any[]>`select h.*,h.id::text from marketing.task_review_history h where h.task_template_id=${task.task_template_id}::uuid order by h.created_at desc` : Promise.resolve([]),
  ]);
  return {
    ok:true,task,actions,history,
    permissions:{
      canDownloadTemplate:hasPermission(user,"marketing.task_template.download"),
      canUploadTemplate:hasPermission(user,task.template_file_id?"marketing.task_template.reupload":"marketing.task_template.upload"),
      canApproveTemplate:hasPermission(user,"marketing.task_template.approve"),
      canRejectTemplate:hasPermission(user,"marketing.task_template.reject"),
      canExecuteAction:hasPermission(user,"marketing.assignment_action.execute"),
      canExecuteAdminAction:hasPermission(user,"marketing.assignment_action.admin"),
      canUploadFinal:hasPermission(user,"marketing.task.final_file.upload"),
      canDownloadFile:hasPermission(user,"marketing.file.download"),
    }
  };
}

async function saveDepartment(sql: ReturnType<typeof getSql>, body: any, user: SessionUser) {
  const id=clean(body.id),name=clean(body.name),userIds=arrayValue<string>(body.userIds).map(clean).filter(Boolean); if(!name)throw new Error("اسم القسم مطلوب");
  return sql.begin(async(tx)=>{ const [row]=id?await tx<any[]>`update marketing.departments set name=${name},is_content=${bool(body.isContent)},updated_at=now() where id=${id}::uuid returning *,id::text`:await tx<any[]>`insert into marketing.departments(name,is_content,created_by) values(${name},${bool(body.isContent)},${user.id}::uuid) returning *,id::text`; await tx`delete from marketing.department_users where department_id=${row.id}::uuid`; for(const userId of userIds)await tx`insert into marketing.department_users(department_id,user_id) values(${row.id}::uuid,${userId}::uuid) on conflict do nothing`; return{ok:true,row,message:"تم حفظ القسم"};});
}
async function saveAssignmentAction(sql: ReturnType<typeof getSql>, body:any){const id=clean(body.id),departmentId=clean(body.departmentId),name=clean(body.name),percentage=numberValue(body.percentage);if(!departmentId||!name)throw new Error("بيانات إجراء التكليف غير مكتملة");const [sum]=await sql<any[]>`select coalesce(sum(percentage),0)::float as total from marketing.assignment_actions where department_id=${departmentId}::uuid and is_active=true and (${id}='' or id<>nullif(${id},'')::uuid)`;if(Number(sum?.total||0)+percentage>100.001)throw new Error("مجموع نسب إجراءات القسم لا يمكن أن يتجاوز 100%");const [row]=id?await sql<any[]>`update marketing.assignment_actions set department_id=${departmentId}::uuid,name=${name},percentage=${percentage},admin_only=${bool(body.adminOnly)},sort_order=${numberValue(body.sortOrder)},updated_at=now() where id=${id}::uuid returning *,id::text`:await sql<any[]>`insert into marketing.assignment_actions(department_id,name,percentage,admin_only,sort_order) values(${departmentId}::uuid,${name},${percentage},${bool(body.adminOnly)},${numberValue(body.sortOrder)}) returning *,id::text`;return{ok:true,row,message:"تم حفظ إجراء التكليف"};}
async function saveCreativeType(sql:ReturnType<typeof getSql>,body:any){const id=clean(body.id),name=clean(body.name),shortCode=safeCode(body.shortCode),departmentId=clean(body.primaryDepartmentId);if(!name||!shortCode||!departmentId)throw new Error("بيانات الكرييتيف غير مكتملة");const[row]=id?await sql<any[]>`update marketing.creative_types set name=${name},short_code=${shortCode},primary_department_id=${departmentId}::uuid,updated_at=now() where id=${id}::uuid returning *,id::text`:await sql<any[]>`insert into marketing.creative_types(name,short_code,primary_department_id) values(${name},${shortCode},${departmentId}::uuid) returning *,id::text`;return{ok:true,row,message:"تم حفظ الكرييتيف"};}
async function saveCampaignType(sql:ReturnType<typeof getSql>,body:any){const id=clean(body.id),name=clean(body.name),shortCode=safeCode(body.shortCode),prefix=safeCode(body.codePrefix);if(!name||!shortCode||!prefix)throw new Error("بيانات نوع الحملة غير مكتملة");const[row]=id?await sql<any[]>`update marketing.campaign_types set name=${name},short_code=${shortCode},code_prefix=${prefix},updated_at=now() where id=${id}::uuid returning *,id::text`:await sql<any[]>`insert into marketing.campaign_types(name,short_code,code_prefix) values(${name},${shortCode},${prefix}) returning *,id::text`;return{ok:true,row,message:"تم حفظ نوع الحملة"};}
async function savePlatform(sql:ReturnType<typeof getSql>,body:any){const id=clean(body.id),name=clean(body.name),code=safeCode(body.code||name).toLowerCase(),postTypes=arrayValue(body.postTypes);if(!name||!code)throw new Error("اسم المنصة مطلوب");return sql.begin(async(tx)=>{const[row]=id?await tx<any[]>`update marketing.platforms set name=${name},code=${code},updated_at=now() where id=${id}::uuid returning *,id::text`:await tx<any[]>`insert into marketing.platforms(name,code) values(${name},${code}) returning *,id::text`;await tx`update marketing.platform_post_types set is_active=false,updated_at=now() where platform_id=${row.id}::uuid`;for(const item of postTypes){const postName=clean(item.name);if(!postName)continue;await tx`insert into marketing.platform_post_types(platform_id,name,width,height,is_active) values(${row.id}::uuid,${postName},${numberValue(item.width)||null},${numberValue(item.height)||null},true) on conflict(platform_id,name) do update set width=excluded.width,height=excluded.height,is_active=true,updated_at=now()`;}return{ok:true,row,message:"تم حفظ المنصة وأنواع النشر"};});}
async function savePackage(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){const id=clean(body.id),name=clean(body.name),category=clean(body.category);if(!name||!category)throw new Error("اسم الباقة والتصنيف مطلوبان");const features=arrayValue(body.careFeatures).map(clean).filter(Boolean);const[row]=id?await sql<any[]>`update marketing.packages set name=${name},category=${category},price=${numberValue(body.price)},cash_discount=${numberValue(body.cashDiscount)},registration_fees=${bool(body.registrationFees)},insurance=${bool(body.insurance)},issuance_fees=${bool(body.issuanceFees)},care_features=${sql.json(dbJson(features))},delivery_home=${bool(body.deliveryHome)},delivery_region=${bool(body.deliveryRegion)},updated_at=now() where id=${id}::uuid returning *,id::text`:await sql<any[]>`insert into marketing.packages(name,category,price,cash_discount,registration_fees,insurance,issuance_fees,care_features,delivery_home,delivery_region,created_by) values(${name},${category},${numberValue(body.price)},${numberValue(body.cashDiscount)},${bool(body.registrationFees)},${bool(body.insurance)},${bool(body.issuanceFees)},${sql.json(dbJson(features))},${bool(body.deliveryHome)},${bool(body.deliveryRegion)},${user.id}::uuid) returning *,id::text`;return{ok:true,row,message:"تم حفظ الباقة"};}
async function softDeleteSetting(sql:ReturnType<typeof getSql>,body:any){const entity=clean(body.entity),id=clean(body.id);const allowed:Record<string,string>={department:"marketing.departments",action:"marketing.assignment_actions",creative_type:"marketing.creative_types",campaign_type:"marketing.campaign_types",platform:"marketing.platforms",package:"marketing.packages"};const table=allowed[entity];if(!table||!id)throw new Error("بيانات الحذف غير صحيحة");await sql.unsafe(`update ${table} set is_active=false,updated_at=now() where id=$1::uuid`,[id]);return{ok:true,message:"تم الحذف"};}

async function receiveTask(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){const id=clean(body.id);if(!hasPermission(user,"marketing.task.receive"))throw new Error("لا توجد صلاحية لاستلام التاسك");const[task]=await sql<any[]>`select *,id::text,source_id::text,assigned_to::text from marketing.tasks where id=${id}::uuid and is_deleted=false`;if(!task)throw new Error("التاسك غير موجود");if(!await canAccessMarketingTask(sql,user,id))throw new Error("لا توجد صلاحية لاستلام التاسك");await sql`update marketing.tasks set received_at=coalesce(received_at,now()),status=case when status='required' then 'received' else status end,updated_at=now() where id=${id}::uuid`;if(task.task_kind==='task_template')await sql`update marketing.task_templates set received_at=coalesce(received_at,now()),updated_at=now() where id=${task.task_template_id}::uuid`;await recalculateProgress(sql,task.source_type,task.source_id);return{ok:true,message:"تم الاستلام"};}
async function uploadTemplate(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const taskId=clean(body.taskId),fileId=clean(body.fileId),data=cleanTemplateData(body.templateData);
  const[task]=await sql<any[]>`select *,id::text,source_id::text,assigned_to::text,task_template_id::text from marketing.tasks where id=${taskId}::uuid and task_kind='task_template'`;
  if(!task)throw new Error("Task Template غير موجود");
  const uploadPermission=task.template_file_id?"marketing.task_template.reupload":"marketing.task_template.upload";
  if(!hasPermission(user,uploadPermission))throw new Error("لا توجد صلاحية لرفع Task Template");
  if(!await canAccessMarketingTask(sql,user,taskId))throw new Error("لا توجد صلاحية لرفع الملف");
  await sql.begin(async tx=>{
    await tx`update marketing.task_templates set file_id=${fileId}::uuid,template_data=template_data||${tx.json(dbJson(data))},status='under_review',progress=50,updated_at=now() where id=${task.task_template_id}::uuid`;
    await tx`update marketing.tasks set progress=50,status='under_review',updated_at=now() where id=${taskId}::uuid`;
    await tx`insert into marketing.task_review_history(task_template_id,action,after_data,actor_id,actor_name) values(${task.task_template_id}::uuid,'uploaded',${tx.json(dbJson(data))},${user.id}::uuid,${user.fullName})`;
  });
  await recalculateProgress(sql,task.source_type,task.source_id);
  return{ok:true,message:"تم رفع Task Template وإرساله للمراجعة"};
}
async function reviewTemplate(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const templateId=clean(body.templateId),action=clean(body.reviewAction),note=clean(body.note),data=cleanTemplateData(body.data);
  const permission=action==='approve'?'marketing.task_template.approve':'marketing.task_template.reject';
  if(!hasPermission(user,permission))throw new Error("لا توجد صلاحية لمراجعة Task Template");
  const[template]=await sql<any[]>`select *,id::text,source_id::text from marketing.task_templates where id=${templateId}::uuid`;
  if(!template)throw new Error("Task Template غير موجود");
  let status=template.status,progress=numberValue(template.progress);
  if(action==='approve'){status='approved';progress=100;}
  else if(action==='request_edit'){status='revision_requested';progress=50;}
  else if(action==='reject'){status='rejected';progress=0;}
  else if(action==='edit'){status='under_review';progress=50;}
  else throw new Error("إجراء المراجعة غير صحيح");
  await sql.begin(async tx=>{
    await tx`insert into marketing.task_review_history(task_template_id,action,note,before_data,after_data,actor_id,actor_name) values(${templateId}::uuid,${action},${note||null},${tx.json(dbJson(template))},${tx.json(dbJson(data))},${user.id}::uuid,${user.fullName})`;
    await tx`update marketing.task_templates set status=${status},progress=${progress},admin_note=${note||null},template_data=case when ${action} in ('edit','approve') then template_data||${tx.json(dbJson(data))} else template_data end,approved_data=case when ${action}='approve' then template_data||${tx.json(dbJson(data))} else approved_data end,reviewed_by=${user.id}::uuid,reviewed_at=now(),updated_at=now() where id=${templateId}::uuid`;
    await tx`update marketing.tasks set status=${status},progress=${progress},updated_at=now() where task_template_id=${templateId}::uuid and task_kind='task_template'`;
    if(action==='approve')await tx`update marketing.tasks set approved_template_data=(select approved_data from marketing.task_templates where id=${templateId}::uuid),updated_at=now() where task_template_id=${templateId}::uuid and task_kind='execution'`;
  });
  await recalculateProgress(sql,template.source_type,template.source_id);
  return{ok:true,message:action==='approve'?"تم اعتماد التعليمات":"تم حفظ إجراء المراجعة"};
}
async function toggleTaskAction(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const taskId=clean(body.taskId),actionId=clean(body.actionId),completed=bool(body.completed);
  const[record]=await sql<any[]>`select t.id::text,t.source_type,t.source_id::text,t.assigned_to::text,a.admin_only,tt.status as template_status from marketing.tasks t join marketing.assignment_actions a on a.id=${actionId}::uuid left join marketing.task_templates tt on tt.id=t.task_template_id where t.id=${taskId}::uuid and t.is_deleted=false`;
  if(!record)throw new Error("الإجراء أو التاسك غير موجود");
  if(record.template_status!=='approved')throw new Error("في انتظار اعتماد Task Template");
  const actionPermission=record.admin_only?"marketing.assignment_action.admin":"marketing.assignment_action.execute";
  if(!hasPermission(user,actionPermission))throw new Error(record.admin_only?"هذا الإجراء يحتاج صلاحية إجراء إداري":"لا توجد صلاحية لتنفيذ إجراء التكليف");
  if(!await canAccessMarketingTask(sql,user,taskId))throw new Error("لا توجد صلاحية لتنفيذ الإجراء");
  await sql`insert into marketing.task_action_progress(task_id,action_id,completed,completed_by,completed_at) values(${taskId}::uuid,${actionId}::uuid,${completed},${completed?sql`${user.id}::uuid`:null},${completed?sql`now()`:null}) on conflict(task_id,action_id) do update set completed=excluded.completed,completed_by=excluded.completed_by,completed_at=excluded.completed_at`;
  const[sum]=await sql<any[]>`select coalesce(sum(a.percentage) filter(where p.completed),0)::float as progress,count(a.id)::int as actions from marketing.assignment_actions a left join marketing.task_action_progress p on p.action_id=a.id and p.task_id=${taskId}::uuid where a.department_id=(select department_id from marketing.tasks where id=${taskId}::uuid) and a.is_active=true`;
  const progress=Math.min(100,numberValue(sum?.progress));
  await sql`update marketing.tasks set progress=${progress},status=case when ${progress}>=100 then 'completed' when ${progress}>0 then 'in_progress' when received_at is not null then 'received' else 'required' end,completed_at=case when ${progress}>=100 then now() else null end,updated_at=now() where id=${taskId}::uuid`;
  await recalculateProgress(sql,record.source_type,record.source_id);
  return{ok:true,progress,message:"تم تحديث إجراء التكليف"};
}
async function attachFinalFile(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){const taskId=clean(body.taskId),fileId=clean(body.fileId);if(!hasPermission(user,"marketing.task.final_file.upload"))throw new Error("لا توجد صلاحية لرفع الملف النهائي");const[task]=await sql<any[]>`select t.*,t.id::text,t.source_id::text,t.assigned_to::text,tt.status as template_status from marketing.tasks t left join marketing.task_templates tt on tt.id=t.task_template_id where t.id=${taskId}::uuid`;if(!task)throw new Error("التاسك غير موجود");if(task.task_kind==='execution'&&task.template_status!=='approved')throw new Error("في انتظار اعتماد Task Template");if(!await canAccessMarketingTask(sql,user,taskId))throw new Error("لا توجد صلاحية لرفع الملف");await sql`update marketing.tasks set final_file_id=${fileId}::uuid,updated_at=now() where id=${taskId}::uuid`;const[count]=await sql<any[]>`select count(*)::int as count from marketing.assignment_actions where department_id=${task.department_id} and is_active=true`;if(Number(count?.count||0)===0)await sql`update marketing.tasks set progress=100,status='completed',completed_at=now() where id=${taskId}::uuid`;await recalculateProgress(sql,task.source_type,task.source_id);return{ok:true,message:"تم رفع الملف النهائي"};}

async function prepareUpload(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){if(!hasPermission(user,"marketing.file.upload"))throw new Error("لا توجد صلاحية لرفع الملفات");if(!mediaStorageConfigured())throw new Error("تخزين الملفات R2 غير مضبوط في المنصة");const category=clean(body.category),sourceType=clean(body.sourceType),sourceId=clean(body.sourceId),taskId=clean(body.taskId),fileName=clean(body.fileName)||"file.bin",mimeType=clean(body.mimeType)||"application/octet-stream",fileSize=numberValue(body.fileSize)||null;if(!category)throw new Error("نوع الملف مطلوب");if(taskId&&!await canAccessMarketingTask(sql,user,taskId))throw new Error("التاسك خارج نطاق بياناتك");if(sourceId&&!taskId)await assertMarketingEntityAccess(sql,user,sourceType,sourceId);const storageKey=buildMarketingStorageKey({category,sourceType,sourceId,taskId,fileName});const[file]=await sql<any[]>`insert into marketing.files(storage_key,original_name,mime_type,file_size,category,source_type,source_id,task_id,status,uploaded_by) values(${storageKey},${fileName},${mimeType},${fileSize},${category},${sourceType||null},${sourceId?sql`${sourceId}::uuid`:null},${taskId?sql`${taskId}::uuid`:null},'uploading',${user.id}::uuid) returning *,id::text`;return{ok:true,fileId:file.id,storageKey,uploadUrl:createUploadUrl(storageKey,900)};}
async function markFileReady(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  if(!hasPermission(user,"marketing.file.upload"))throw new Error("لا توجد صلاحية لتحديث الملف");
  const fileId=clean(body.fileId);
  const rows=hasPermission(user,"marketing.file.view_others")
    ? await sql<any[]>`update marketing.files set status='ready',updated_at=now() where id=${fileId}::uuid returning id::text`
    : await sql<any[]>`update marketing.files set status='ready',updated_at=now() where id=${fileId}::uuid and uploaded_by=${user.id}::uuid returning id::text`;
  if(!rows.length)throw new Error("الملف غير موجود أو لا توجد صلاحية لتحديثه");
  return{ok:true,message:"تم حفظ الملف"};
}
async function fileDownload(sql:ReturnType<typeof getSql>,id:string,user:SessionUser){if(!mediaStorageConfigured())throw new Error("تخزين الملفات R2 غير مضبوط");const[file]=await sql<any[]>`select *,id::text,source_id::text,task_id::text,uploaded_by::text from marketing.files where id=${id}::uuid and status='ready'`;if(!file)throw new Error("الملف غير موجود");if(!hasPermission(user,"marketing.file.view_others")){const allowed=file.task_id?await canAccessMarketingTask(sql,user,file.task_id):file.source_id?await canAccessMarketingEntity(sql,user,clean(file.source_type),file.source_id):file.uploaded_by===user.id;if(!allowed)throw new Error("الملف خارج نطاق بياناتك");}return{ok:true,url:createDownloadUrl(file.storage_key,900),file:{id:file.id,name:file.original_name,mimeType:file.mime_type,size:file.file_size}};}

async function publishPrep(sql:ReturnType<typeof getSql>,user:SessionUser) {
  const access=marketingAccess(user),unrestricted=access.dataScope==='all',departmentScoped=['department','departments','branch_and_department'].includes(access.dataScope),departmentCodes=marketingDepartmentCodes(user),createdByMe=access.dataScope==='created_by_me';
  const rows=await sql<any[]>`
    with representatives as (
      select distinct on (group_id) *
      from marketing.publish_schedule
      order by group_id,created_at,id
    )
    select
      r.group_id::text as id,
      r.group_id::text,
      r.source_type,
      r.source_id::text,
      r.creative_id::text,
      r.task_id::text,
      r.publish_date,
      r.caption,
      r.hashtags,
      aggregate_data.status,
      aggregate_data.schedule_ids,
      aggregate_data.platform_name,
      aggregate_data.post_type_name,
      coalesce(platform_data.platforms,'[]'::jsonb) as platforms,
      c.name as creative_name,
      c.instance_code,
      coalesce(cam.name,ag.name) as source_name,
      t.progress::float,
      t.final_file_id::text,
      f.original_name as final_file_name,
      t.department_id::text,
      d.name as department_name,
      u.full_name as assigned_name
    from representatives r
    left join lateral (
      select
        array_agg(ps.id::text order by ps.created_at,ps.id) as schedule_ids,
        case when bool_and(ps.status='published') then 'published' when bool_or(ps.status='failed') then 'failed' else 'waiting' end as status,
        string_agg(distinct p.name,'، ') as platform_name,
        string_agg(distinct pt.name,'، ') as post_type_name
      from marketing.publish_schedule ps
      left join marketing.platforms p on p.id=ps.platform_id
      left join marketing.platform_post_types pt on pt.id=ps.post_type_id
      where ps.group_id=r.group_id
    ) aggregate_data on true
    left join lateral (
      select jsonb_agg(jsonb_build_object('platformId',grouped.platform_id,'postTypeIds',grouped.post_type_ids) order by grouped.platform_name) as platforms
      from (
        select ps.platform_id::text as platform_id,max(p.name) as platform_name,jsonb_agg(ps.post_type_id::text order by pt.name) as post_type_ids
        from marketing.publish_schedule ps
        left join marketing.platforms p on p.id=ps.platform_id
        left join marketing.platform_post_types pt on pt.id=ps.post_type_id
        where ps.group_id=r.group_id
        group by ps.platform_id
      ) grouped
    ) platform_data on true
    left join marketing.creatives c on c.id=r.creative_id
    left join marketing.campaigns cam on r.source_type='campaign' and cam.id=r.source_id
    left join marketing.agendas ag on r.source_type='agenda' and ag.id=r.source_id
    left join lateral(
      select x.* from marketing.tasks x
      where x.id=r.task_id or (r.task_id is null and x.creative_id=r.creative_id and x.task_kind='execution' and x.is_deleted=false)
      order by case when x.id=r.task_id then 0 else 1 end,x.updated_at desc
      limit 1
    )t on true
    left join marketing.departments d on d.id=t.department_id
    left join core.users u on u.id=t.assigned_to
    left join marketing.files f on f.id=t.final_file_id
    where ${unrestricted}=true
      or t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid
      or (${departmentScoped}=true and exists(select 1 from core.user_departments ud join core.departments cd on cd.id=ud.department_id where ud.user_id in(t.assigned_to,t.paired_content_user_id) and cd.code in ${sql(departmentCodes)}))
      or (${createdByMe}=true and (cam.created_by=${user.id}::uuid or ag.created_by=${user.id}::uuid))
    order by r.publish_date,r.created_at
  `;
  return{ok:true,rows};
}
async function savePublishPrep(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  if(!hasPermission(user,"marketing.publish_prep.manage"))throw new Error("لا توجد صلاحية لإدارة تجهيز النشر");
  const id=clean(body.id),publishDate=isoDate(body.publishDate),platforms=arrayValue(body.platforms);
  const[current]=await sql<any[]>`select * from marketing.publish_schedule where group_id=${id}::uuid or id=${id}::uuid order by created_at limit 1`;
  if(!current)throw new Error("تاسك تجهيز النشر غير موجود");
  await assertMarketingEntityAccess(sql,user,clean(current.source_type),clean(current.source_id));
  if(!publishDate)throw new Error("تاريخ النشر مطلوب");
  const combinations=platforms.flatMap((platform:any)=>arrayValue<string>(platform.postTypeIds).map((postTypeId)=>({platformId:clean(platform.platformId),postTypeId:clean(postTypeId)}))).filter((item:any)=>item.platformId&&item.postTypeId);
  if(!combinations.length){const platformId=clean(body.platformId),postTypeId=clean(body.postTypeId);if(platformId&&postTypeId)combinations.push({platformId,postTypeId});}
  if(!combinations.length)throw new Error("اختر منصة ونوع نشر واحد على الأقل");
  await sql.begin(async tx=>{
    await tx`delete from marketing.publish_schedule where group_id=${current.group_id}`;
    for(const item of combinations)await tx`insert into marketing.publish_schedule(group_id,source_type,source_id,creative_id,task_id,publish_date,platform_id,post_type_id,caption,hashtags,status) values(${current.group_id},${current.source_type},${current.source_id},${current.creative_id},${current.task_id},${publishDate},${item.platformId}::uuid,${item.postTypeId}::uuid,${clean(body.caption)||null},${clean(body.hashtags)||null},'waiting')`;
  });
  return{ok:true,message:"تم حفظ تجهيز النشر"};
}

async function graphRequest(path:string,method:"GET"|"POST",token:string,params:Record<string,any>={}){const version=clean(process.env.META_GRAPH_VERSION)||"v20.0";const url=new URL(`https://graph.facebook.com/${version}${path}`);const body=new URLSearchParams();for(const[key,value]of Object.entries(params)){if(value===undefined||value===null||value==='')continue;const text=typeof value==='object'?JSON.stringify(value):String(value);if(method==='GET')url.searchParams.set(key,text);else body.set(key,text);}if(method==='GET')url.searchParams.set('access_token',token);else body.set('access_token',token);const response=await fetch(url.toString(),{method,body:method==='POST'?body:undefined});const payload=await response.json().catch(()=>({}));if(!response.ok||payload.error)throw new Error(payload.error?.message||`Meta API error ${response.status}`);return payload;}
function looksVideo(file:any){return /video|mp4|mov|webm/i.test(`${file?.mime_type||''} ${file?.original_name||''}`);}
function normalizePostType(value:unknown){const text=clean(value).toLowerCase();if(text.includes('story')||text.includes('ستوري'))return'story';if(text.includes('reel')||text.includes('short')||text.includes('ريل'))return'reel';if(text.includes('photo')||text.includes('image')||text.includes('بوست صور')||text.includes('صورة'))return'photo_post';return text;}
async function uploadFacebookStoryVideo(uploadUrl:string,token:string,mediaUrl:string){const response=await fetch(uploadUrl,{method:'POST',headers:{Authorization:`OAuth ${token}`,file_url:mediaUrl}});const payload=await response.json().catch(()=>({}));if(!response.ok||(payload as any).error)throw new Error((payload as any).error?.message||`تعذر رفع فيديو Story على Facebook (${response.status})`);return payload;}
async function publishScheduleItem(sql:ReturnType<typeof getSql>,schedule:any,user:SessionUser){
  const[conn]=await sql<any[]>`select * from marketing.platform_connections where platform=${schedule.platform_code}`;
  if(!conn||!conn.connected)throw new Error(`منصة ${schedule.platform_name||schedule.platform_code} غير مربوطة`);
  const[file]=await sql<any[]>`select * from marketing.files where id=${schedule.final_file_id}::uuid and status='ready'`;
  if(!file)throw new Error("الملف النهائي غير موجود");
  const mediaUrl=createDownloadUrl(file.storage_key,3600),caption=[clean(schedule.caption),clean(schedule.hashtags)].filter(Boolean).join("\n\n"),postType=normalizePostType(schedule.post_type_name);
  let result:any;
  if(schedule.platform_code==='facebook'){
    const pageId=clean(conn.page_id),token=decryptToken(conn.page_access_token_encrypted||conn.access_token_encrypted||conn.user_access_token_encrypted);
    if(!pageId||!token)throw new Error("بيانات Facebook غير مكتملة");
    if(postType==='story'){
      if(looksVideo(file)){
        const start=await graphRequest(`/${pageId}/video_stories`,'POST',token,{upload_phase:'start'});
        const videoId=start.video_id||start.id,uploadUrl=start.upload_url||start.uploadUrl;
        if(!videoId||!uploadUrl)throw new Error("تعذر بدء رفع فيديو Story على Facebook");
        const upload=await uploadFacebookStoryVideo(uploadUrl,token,mediaUrl);
        const finish=await graphRequest(`/${pageId}/video_stories`,'POST',token,{upload_phase:'finish',video_id:videoId});
        result={start,upload,publish:finish};
      }else{
        const photo=await graphRequest(`/${pageId}/photos`,'POST',token,{url:mediaUrl,published:false});
        const photoId=photo.id||photo.photo_id;
        if(!photoId)throw new Error("تعذر رفع صورة Story على Facebook");
        const publish=await graphRequest(`/${pageId}/photo_stories`,'POST',token,{photo_id:photoId});
        result={upload:photo,publish};
      }
    }else if(looksVideo(file))result=await graphRequest(`/${pageId}/videos`,'POST',token,{file_url:mediaUrl,description:caption});
    else result=await graphRequest(`/${pageId}/photos`,'POST',token,{url:mediaUrl,caption,published:true});
  }else if(schedule.platform_code==='instagram'){
    const igId=clean(conn.ig_user_id||conn.account_id),token=decryptToken(conn.page_access_token_encrypted||conn.access_token_encrypted||conn.user_access_token_encrypted);
    if(!igId||!token)throw new Error("بيانات Instagram غير مكتملة");
    const params:any={caption};
    if(postType==='story'){
      params.media_type='STORIES';
      if(looksVideo(file))params.video_url=mediaUrl;else params.image_url=mediaUrl;
    }else if(looksVideo(file)||postType==='reel'){
      params.video_url=mediaUrl;params.media_type='REELS';params.share_to_feed=true;
    }else params.image_url=mediaUrl;
    const container=await graphRequest(`/${igId}/media`,'POST',token,params);
    const creationId=container.id||container.creation_id;
    if(!creationId)throw new Error("تعذر إنشاء ملف النشر على Instagram");
    const publish=await graphRequest(`/${igId}/media_publish`,'POST',token,{creation_id:creationId});
    result={create:container,publish};
  }else throw new Error("المنصة غير مدعومة");
  await sql.begin(async tx=>{
    await tx`update marketing.publish_schedule set status='published',published_at=now(),publish_result=${tx.json(dbJson(result))},updated_at=now() where id=${schedule.id}::uuid`;
    await tx`insert into marketing.publish_logs(schedule_id,platform,status,result,published_by) values(${schedule.id}::uuid,${schedule.platform_code},'published',${tx.json(dbJson(result))},${user.id}::uuid)`;
  });
  return result;
}
async function publishNow(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  if(!hasPermission(user,"marketing.publish.now"))throw new Error("لا توجد صلاحية للنشر الفعلي");
  const ids=arrayValue<string>(body.ids).map(clean).filter(Boolean);
  if(!ids.length)throw new Error("حدد تاسكات النشر");
  const results=[];
  for(const id of ids){
    const[schedule]=await sql<any[]>`
      select s.*,s.id::text,p.code as platform_code,p.name as platform_name,pt.name as post_type_name,coalesce(direct_task.final_file_id,fallback_task.final_file_id)::text as final_file_id
      from marketing.publish_schedule s
      join marketing.platforms p on p.id=s.platform_id
      left join marketing.platform_post_types pt on pt.id=s.post_type_id
      left join marketing.tasks direct_task on direct_task.id=s.task_id
      left join lateral(
        select x.final_file_id from marketing.tasks x
        where s.task_id is null and x.creative_id=s.creative_id and x.task_kind='execution' and x.final_file_id is not null and x.is_deleted=false
        order by x.updated_at desc limit 1
      )fallback_task on true
      where s.id=${id}::uuid
    `;
    if(!schedule){results.push({id,ok:false,error:"تاسك النشر غير موجود"});continue;}
    try{await assertMarketingEntityAccess(sql,user,clean(schedule.source_type),clean(schedule.source_id));const result=await publishScheduleItem(sql,schedule,user);results.push({id,ok:true,result});}
    catch(error:any){await sql`insert into marketing.publish_logs(schedule_id,platform,status,error,published_by) values(${id}::uuid,${schedule.platform_code||''},'failed',${clean(error?.message)},${user.id}::uuid)`;results.push({id,ok:false,error:clean(error?.message)});}
  }
  return{ok:true,results,message:"تم تنفيذ طلب النشر"};
}
async function saveResultFile(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){if(!hasPermission(user,"marketing.file.upload"))throw new Error("لا توجد صلاحية لرفع ملف النتائج");const sourceType=clean(body.sourceType),id=clean(body.id),fileId=clean(body.fileId);await assertMarketingEntityAccess(sql,user,sourceType,id);if(sourceType==='agenda')await sql`update marketing.agendas set result_file_id=${fileId}::uuid,updated_at=now() where id=${id}::uuid`;else await sql`update marketing.campaigns set result_file_id=${fileId}::uuid,updated_at=now() where id=${id}::uuid`;return{ok:true,message:"تم حفظ ملف النتائج"};}
async function saveLinks(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){const sourceType=clean(body.sourceType),permission=sourceType==='agenda'?"marketing.agenda.edit":"marketing.campaign.edit";if(!hasPermission(user,permission))throw new Error("لا توجد صلاحية لتعديل الروابط");const id=clean(body.id),links=arrayValue(body.links).filter((item:any)=>clean(item.platform)&&clean(item.url));await assertMarketingEntityAccess(sql,user,sourceType,id);if(sourceType==='agenda')await sql`update marketing.agendas set links=${sql.json(dbJson(links))},updated_at=now() where id=${id}::uuid`;else await sql`update marketing.campaigns set links=${sql.json(dbJson(links))},updated_at=now() where id=${id}::uuid`;return{ok:true,message:"تم حفظ روابط الحملة"};}
async function archiveEntity(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){if(!hasPermission(user,"marketing.campaign.archive"))throw new Error("لا توجد صلاحية لأرشفة الحملة");const sourceType=clean(body.sourceType),id=clean(body.id);await assertMarketingEntityAccess(sql,user,sourceType,id);const[entity]=sourceType==='agenda'?await sql<any[]>`select result_file_id::text,links from marketing.agendas where id=${id}::uuid`:await sql<any[]>`select result_file_id::text,links from marketing.campaigns where id=${id}::uuid`;if(!entity)throw new Error("السجل غير موجود");const missing=[];if(!entity.result_file_id)missing.push("ملف نتائج الحملة");if(!arrayValue(entity.links).length)missing.push("روابط الحملة");if(missing.length)throw new Error(`لا يمكن أرشفة الحملة. الناقص: ${missing.join(" + ")}`);if(sourceType==='agenda')await sql`update marketing.agendas set archived_at=now(),archived_by=${user.id}::uuid,status='archived',updated_at=now() where id=${id}::uuid`;else await sql`update marketing.campaigns set archived_at=now(),archived_by=${user.id}::uuid,status='archived',updated_at=now() where id=${id}::uuid`;return{ok:true,message:"تمت الأرشفة"};}
async function deleteEntity(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){const sourceType=clean(body.sourceType),id=clean(body.id);const permission=sourceType==='agenda'?'marketing.agenda.delete':'marketing.campaign.delete';if(!hasPermission(user,permission))throw new Error("لا توجد صلاحية لمسح السجل");await assertMarketingEntityAccess(sql,user,sourceType,id);if(sourceType==='agenda')await sql`delete from marketing.agendas where id=${id}::uuid`;else await sql`update marketing.campaigns set is_deleted=true,updated_at=now() where id=${id}::uuid`;return{ok:true,message:"تم المسح"};}

async function monitoring(sql:ReturnType<typeof getSql>,user:SessionUser){
  const access=marketingAccess(user),unrestricted=access.dataScope==='all',createdByMe=access.dataScope==='created_by_me',departmentScoped=['department','departments','branch_and_department'].includes(access.dataScope),departmentCodes=marketingDepartmentCodes(user);
  const taskFilter=unrestricted?sql`true`:sql`(t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid or (${departmentScoped}=true and exists(select 1 from core.user_departments ud join core.departments cd on cd.id=ud.department_id where ud.user_id in(t.assigned_to,t.paired_content_user_id) and cd.code in ${sql(departmentCodes)})) or (${createdByMe}=true and (exists(select 1 from marketing.campaigns c where t.source_type='campaign' and c.id=t.source_id and c.created_by=${user.id}::uuid) or exists(select 1 from marketing.agendas a where t.source_type='agenda' and a.id=t.source_id and a.created_by=${user.id}::uuid))))`;
  const[totals,statuses,delayed,employees,departments,entities]=await Promise.all([
    sql<any[]>`with visible_tasks as(select t.* from marketing.tasks t where t.is_deleted=false and ${taskFilter}) select count(distinct source_id) filter(where source_type='campaign')::int as campaigns,count(distinct source_id) filter(where source_type='campaign' and status<>'archived')::int as active_campaigns,count(distinct source_id) filter(where source_type='agenda')::int as agendas,count(*)::int as tasks,count(*) filter(where due_at<now() and progress<100)::int as delayed,count(*) filter(where progress=0)::int as waiting,count(*) filter(where progress>0 and progress<100)::int as active,coalesce(avg(progress),0)::float as progress from visible_tasks`,
    sql<any[]>`select t.status,count(*)::int as count from marketing.tasks t where t.is_deleted=false and ${taskFilter} group by t.status order by count(*) desc`,
    sql<any[]>`select t.id::text,t.title,t.due_at,t.progress::float,u.full_name,d.name as department_name,coalesce(cam.name,ag.name) as source_name,greatest(0,current_date-t.due_at::date)::int as delay_days from marketing.tasks t left join core.users u on u.id=t.assigned_to left join marketing.departments d on d.id=t.department_id left join marketing.campaigns cam on t.source_type='campaign' and cam.id=t.source_id left join marketing.agendas ag on t.source_type='agenda' and ag.id=t.source_id where t.is_deleted=false and ${taskFilter} and t.due_at<now() and t.progress<100 order by t.due_at`,
    sql<any[]>`select u.id::text,u.full_name,count(t.id)::int as tasks,coalesce(avg(t.progress),0)::float as progress,count(*) filter(where t.due_at<now() and t.progress<100)::int as delayed,coalesce(sum(greatest(0,current_date-t.due_at::date)) filter(where t.due_at<now() and t.progress<100),0)::int as delay_days from core.users u join marketing.tasks t on t.assigned_to=u.id and t.is_deleted=false and ${taskFilter} group by u.id order by progress desc`,
    sql<any[]>`select d.id::text,d.name,count(t.id)::int as tasks,coalesce(avg(t.progress),0)::float as progress from marketing.departments d left join marketing.tasks t on t.department_id=d.id and t.is_deleted=false and ${taskFilter} where d.is_active=true group by d.id order by d.name`,
    sql<any[]>`select 'campaign' as source_type,c.id::text,c.name,c.progress::float,c.status from marketing.campaigns c where c.is_deleted=false and c.archived_at is null and (${unrestricted}=true or (${createdByMe}=true and c.created_by=${user.id}::uuid) or exists(select 1 from marketing.tasks t where t.source_type='campaign' and t.source_id=c.id and t.is_deleted=false and ${taskFilter})) union all select 'agenda',a.id::text,a.name,a.progress::float,a.status from marketing.agendas a where a.archived_at is null and (${unrestricted}=true or (${createdByMe}=true and a.created_by=${user.id}::uuid) or exists(select 1 from marketing.tasks t where t.source_type='agenda' and t.source_id=a.id and t.is_deleted=false and ${taskFilter})) order by progress desc`
  ]);
  return{ok:true,totals:totals[0]||{},statuses,delayed,employees,departments,entities};
}
async function calendarData(sql:ReturnType<typeof getSql>,user:SessionUser){
  const access=marketingAccess(user),unrestricted=access.dataScope==='all',createdByMe=access.dataScope==='created_by_me',departmentScoped=['department','departments','branch_and_department'].includes(access.dataScope),departmentCodes=marketingDepartmentCodes(user);
  const rows=await sql<any[]>`select s.id::text,s.publish_date,s.status,p.name as platform_name,pt.name as post_type_name,c.name as creative_name,c.instance_code,coalesce(cam.name,ag.name) as source_name,u.full_name as assigned_name,coalesce(uc.color,'#6c3329') as user_color from marketing.publish_schedule s left join marketing.platforms p on p.id=s.platform_id left join marketing.platform_post_types pt on pt.id=s.post_type_id left join marketing.creatives c on c.id=s.creative_id left join marketing.campaigns cam on s.source_type='campaign' and cam.id=s.source_id left join marketing.agendas ag on s.source_type='agenda' and ag.id=s.source_id left join lateral(select assigned_to,paired_content_user_id from marketing.tasks t where t.id=s.task_id or (s.task_id is null and t.creative_id=s.creative_id and t.task_kind='execution' and t.is_deleted=false) order by case when t.id=s.task_id then 0 else 1 end,t.created_at limit 1)t on true left join core.users u on u.id=t.assigned_to left join marketing.user_colors uc on uc.user_id=u.id where ${unrestricted}=true or t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid or (${departmentScoped}=true and exists(select 1 from core.user_departments ud join core.departments cd on cd.id=ud.department_id where ud.user_id in(t.assigned_to,t.paired_content_user_id) and cd.code in ${sql(departmentCodes)})) or (${createdByMe}=true and (cam.created_by=${user.id}::uuid or ag.created_by=${user.id}::uuid)) order by s.publish_date`;
  return{ok:true,rows};
}
async function receiptCalendar(sql:ReturnType<typeof getSql>,user:SessionUser){
  const access=marketingAccess(user),unrestricted=access.dataScope==='all',createdByMe=access.dataScope==='created_by_me',departmentScoped=['department','departments','branch_and_department'].includes(access.dataScope),departmentCodes=marketingDepartmentCodes(user);
  const rows=await sql<any[]>`select t.id::text,t.received_at,t.source_type,coalesce(cam.name,ag.name) as source_name,c.name as creative_name,u.full_name,d.name as department_name,coalesce(uc.color,'#6c3329') as user_color from marketing.tasks t left join marketing.campaigns cam on t.source_type='campaign' and cam.id=t.source_id left join marketing.agendas ag on t.source_type='agenda' and ag.id=t.source_id left join marketing.creatives c on c.id=t.creative_id left join core.users u on u.id=t.assigned_to left join marketing.departments d on d.id=t.department_id left join marketing.user_colors uc on uc.user_id=u.id where t.received_at is not null and t.is_deleted=false and (${unrestricted}=true or t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid or (${departmentScoped}=true and exists(select 1 from core.user_departments ud join core.departments cd on cd.id=ud.department_id where ud.user_id in(t.assigned_to,t.paired_content_user_id) and cd.code in ${sql(departmentCodes)})) or (${createdByMe}=true and (cam.created_by=${user.id}::uuid or ag.created_by=${user.id}::uuid))) order by t.received_at`;
  return{ok:true,rows};
}

async function attendanceData(sql:ReturnType<typeof getSql>,user:SessionUser,request:VercelRequest){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const value=(type:string)=>parts.find((part)=>part.type===type)?.value||'';
  const todayKey=`${value('year')}-${value('month')}-${value('day')}`;
  const from=isoDate(request.query.from)||todayKey;
  const to=isoDate(request.query.to)||from;
  const departmentId=clean(request.query.departmentId);
  const requestedUserId=clean(request.query.userId);
  const userId=hasPermission(user,"marketing.attendance.manage")?requestedUserId:user.id;
  const status=clean(request.query.status);
  const [settings]=await sql<any[]>`select * from marketing.attendance_settings where singleton=true`;
  const today=await sql<any[]>`
    select u.id::text,u.full_name,
      string_agg(distinct d.name,'، ' order by d.name) as department_name,
      r.check_in,r.check_out,r.delay_minutes,r.work_minutes,r.status,
      coalesce(max(p.last_activity_at)>now()-interval '5 minutes',false) as online,
      max(p.last_activity_at) as last_activity_at,
      max(p.last_activity_type) as last_activity_type
    from core.users u
    join marketing.department_users du on du.user_id=u.id
    join marketing.departments d on d.id=du.department_id and d.is_active=true
    left join marketing.attendance_records r on r.user_id=u.id and r.attendance_date=(now() at time zone 'Asia/Riyadh')::date
    left join marketing.presence_status p on p.user_id=u.id
    where u.is_active=true and (${hasPermission(user,"marketing.attendance.manage")} or u.id=${user.id}::uuid)
    group by u.id,u.full_name,r.check_in,r.check_out,r.delay_minutes,r.work_minutes,r.status
    order by u.full_name`;
  const reportUsers=await sql<any[]>`
    select u.id::text,u.full_name,u.email,string_agg(distinct d.name,'، ' order by d.name) as department_name
    from core.users u
    join marketing.department_users du on du.user_id=u.id
    join marketing.departments d on d.id=du.department_id and d.is_active=true
    where u.is_active=true
      and (${departmentId}='' or exists(select 1 from marketing.department_users fdu where fdu.user_id=u.id and fdu.department_id=${departmentId||null}::uuid))
      and (${userId}='' or u.id=${userId||null}::uuid)
    group by u.id,u.full_name,u.email
    order by u.full_name`;
  const rawRows=await sql<any[]>`
    select r.*,r.id::text,r.user_id::text,r.attendance_date::text as attendance_date,u.full_name,
      string_agg(distinct d.name,'، ' order by d.name) as department_name
    from marketing.attendance_records r
    join core.users u on u.id=r.user_id
    left join marketing.department_users du on du.user_id=u.id
    left join marketing.departments d on d.id=du.department_id
    where r.attendance_date between ${from}::date and ${to}::date
      and (${departmentId}='' or exists(select 1 from marketing.department_users fdu where fdu.user_id=u.id and fdu.department_id=${departmentId||null}::uuid))
      and (${userId}='' or u.id=${userId||null}::uuid)
    group by r.id,u.id,u.full_name
    order by r.attendance_date desc,u.full_name`;
  const [effective]=await sql<any[]>`
    select min(r.attendance_date)::text as effective_from
    from marketing.attendance_records r
    where r.attendance_date between ${from}::date and ${to}::date
      and exists(select 1 from marketing.department_users du where du.user_id=r.user_id)`;
  const effectiveFrom=clean(effective?.effective_from);
  const reportDays=effectiveFrom?datesBetween(effectiveFrom>from?effectiveFrom:from,to):[];
  const recordsByUserDay=new Map<string,any>();
  for(const row of rawRows)recordsByUserDay.set(`${row.user_id}:${clean(row.attendance_date).slice(0,10)}`,row);
  let summary=reportUsers.map((employee:any)=>{
    const records=reportDays.map((day)=>recordsByUserDay.get(`${employee.id}:${day}`)).filter(Boolean);
    const present=records.length;
    const absent=Math.max(0,reportDays.length-present);
    const lateCount=records.filter((row:any)=>numberValue(row.delay_minutes)>0).length;
    const lateTotal=records.reduce((sum:number,row:any)=>sum+numberValue(row.delay_minutes),0);
    const noCheckout=records.filter((row:any)=>row.check_in&&!row.check_out).length;
    const workTotal=records.reduce((sum:number,row:any)=>sum+numberValue(row.work_minutes),0);
    const employeeStatus=lateCount?'late':present&&noCheckout?'no_checkout':present&&absent?'partial':present?'present':'absent';
    return{user_id:employee.id,full_name:employee.full_name,email:employee.email,department_name:employee.department_name,status:employeeStatus,present,absent,late_count:lateCount,late_total:lateTotal,no_checkout:noCheckout,work_total:workTotal};
  });
  if(status==='present')summary=summary.filter((row:any)=>row.present>0);
  if(status==='late')summary=summary.filter((row:any)=>row.late_count>0);
  if(status==='absent')summary=summary.filter((row:any)=>row.absent>0);
  if(status==='no_checkout')summary=summary.filter((row:any)=>row.no_checkout>0);
  const includedUsers=new Set(summary.map((row:any)=>row.user_id));
  const rows:any[]=[];
  for(const employee of reportUsers){
    if(!includedUsers.has(employee.id))continue;
    for(const day of reportDays){
      const record=recordsByUserDay.get(`${employee.id}:${day}`);
      if(status==='absent'){
        if(!record)rows.push({id:`${employee.id}:${day}`,user_id:employee.id,attendance_date:day,full_name:employee.full_name,department_name:employee.department_name,status:'absent',check_in:null,check_out:null,delay_minutes:0,work_minutes:0});
        continue;
      }
      if(!record)continue;
      if(status==='late'&&numberValue(record.delay_minutes)<=0)continue;
      if(status==='no_checkout'&&(!record.check_in||record.check_out))continue;
      rows.push({...record,status:record.check_in&&!record.check_out?'no_checkout':numberValue(record.delay_minutes)>0?'late':'present'});
    }
  }
  rows.sort((a,b)=>String(b.attendance_date).localeCompare(String(a.attendance_date))||String(a.full_name).localeCompare(String(b.full_name),'ar'));
  const totals=summary.reduce((acc:any,row:any)=>({present:acc.present+row.present,absent:acc.absent+row.absent,lateCount:acc.lateCount+row.late_count,lateTotal:acc.lateTotal+row.late_total,noCheckout:acc.noCheckout+row.no_checkout,workTotal:acc.workTotal+row.work_total}),{present:0,absent:0,lateCount:0,lateTotal:0,noCheckout:0,workTotal:0});
  const [mine]=await sql<any[]>`select *,id::text from marketing.attendance_records where user_id=${user.id}::uuid and attendance_date=(now() at time zone 'Asia/Riyadh')::date`;
  return{ok:true,settings:settings||{},today,rows,summary,totals,effectiveFrom,mine:mine||null,canManage:hasPermission(user,"marketing.attendance.manage")};
}
async function attendanceAction(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const action=clean(body.attendanceAction);
  if(action==='ping'){
    await sql`insert into marketing.presence_status(user_id,online,last_activity_at,last_activity_type,updated_at) values(${user.id}::uuid,true,now(),${clean(body.activityType)||'فتح سيستم التسويق'},now()) on conflict(user_id) do update set online=true,last_activity_at=now(),last_activity_type=excluded.last_activity_type,updated_at=now()`;
    return{ok:true};
  }
  if(action==='save_settings'){
    if(!hasPermission(user,"marketing.attendance.manage"))throw new Error("لا توجد صلاحية لإدارة إعدادات الدوام");
    await sql`update marketing.attendance_settings set work_start=${clean(body.workStart)}::time,work_end=${clean(body.workEnd)}::time,grace_minutes=${Math.max(0,numberValue(body.graceMinutes))},updated_by=${user.id}::uuid,updated_at=now() where singleton=true`;
    return{ok:true,message:"تم حفظ إعدادات الدوام"};
  }
  if(action==='check_in'){
    const [row]=await sql<any[]>`
      with settings as(select work_start,grace_minutes from marketing.attendance_settings where singleton=true), calculated as(
        select greatest(0,floor(extract(epoch from (((now() at time zone 'Asia/Riyadh')::time)-(work_start+(grace_minutes||' minutes')::interval)))/60))::int as delay_minutes from settings
      )
      insert into marketing.attendance_records(user_id,attendance_date,check_in,delay_minutes,status)
      select ${user.id}::uuid,(now() at time zone 'Asia/Riyadh')::date,now(),delay_minutes,case when delay_minutes>0 then 'late' else 'present' end from calculated
      on conflict(user_id,attendance_date) do update set
        check_in=coalesce(marketing.attendance_records.check_in,excluded.check_in),
        delay_minutes=case when marketing.attendance_records.check_in is null then excluded.delay_minutes else marketing.attendance_records.delay_minutes end,
        status=case when marketing.attendance_records.check_in is null then excluded.status else marketing.attendance_records.status end,
        updated_at=now()
      returning *,id::text`;
    return{ok:true,row,message:"تم تسجيل الحضور"};
  }
  if(action==='check_out'){
    const [row]=await sql<any[]>`update marketing.attendance_records set check_out=now(),work_minutes=greatest(0,floor(extract(epoch from (now()-check_in))/60))::int,status=case when status='late' then 'late' else 'present' end,updated_at=now() where user_id=${user.id}::uuid and attendance_date=(now() at time zone 'Asia/Riyadh')::date and check_in is not null returning *,id::text`;
    if(!row)throw new Error("يجب تسجيل الحضور أولًا");
    return{ok:true,row,message:"تم تسجيل الانصراف"};
  }
  throw new Error("إجراء الحضور غير صحيح");
}

async function stockData(sql:ReturnType<typeof getSql>,user:SessionUser){
  const requestAccessFilter=marketingAccess(user).dataScope==="all"||hasPermission(user,"marketing.photo_request.complete")?sql`true`:sql`r.requested_by=${user.id}::uuid`;
  const [cars,requests,locations]=await Promise.all([
    loadOperationsCars(sql),
    sql<any[]>`
      select r.id::text,r.request_no,r.status,r.requested_by::text,r.requested_by_name,r.requested_at,r.completed_at,r.note,r.cancelled_at,
        sl.name as source_location_name,dl.name as destination_location_name,
        (r.requested_by=${user.id}::uuid and r.status='vehicle_received' and r.cancelled_at is null) as can_complete,
        coalesce((
          select json_agg(json_build_object(
            'vehicleId',v.id::text,
            'vin',v.vin,
            'carName',v.car_name,
            'statement',v.statement,
            'note',rv.item_note
          ) order by v.vin)
          from operations.transfer_request_vehicles rv
          join operations.vehicles v on v.id=rv.vehicle_id
          where rv.transfer_request_id=r.id
        ),'[]'::json) as vehicles,
        coalesce((
          select json_agg(json_build_object(
            'id',e.id::text,
            'stage',e.stage,
            'action',e.action,
            'note',e.note,
            'actorName',e.actor_name,
            'createdAt',e.created_at
          ) order by e.created_at)
          from operations.transfer_request_events e
          where e.transfer_request_id=r.id
        ),'[]'::json) as events
      from operations.transfer_requests r
      left join operations.locations sl on sl.id=r.source_location_id
      left join operations.locations dl on dl.id=r.destination_location_id
      where r.request_kind='photography' and r.is_deleted=false and ${requestAccessFilter}
      order by r.requested_at desc
    `,
    sql<any[]>`select id::text,code,name,branch_code from operations.locations where is_active=true order by sort_order,name`,
  ]);
  return{ok:true,cars,requests,locations};
}

async function createPhotoRequest(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const vehicles=arrayValue(body.vehicles).map((item:any)=>({vehicleId:clean(item.vehicleId),note:clean(item.note)})).filter((item:any)=>item.vehicleId);
  const destinationLocationId=clean(body.destinationLocationId);
  if(!vehicles.length)throw new Error("اختر سيارة واحدة على الأقل");
  if(!destinationLocationId)throw new Error("اختر المكان المستهدف");
  const uniqueIds=[...new Set(vehicles.map((item:any)=>item.vehicleId))];
  if(uniqueIds.length!==vehicles.length)throw new Error("لا يمكن اختيار السيارة نفسها أكثر من مرة");
  return sql.begin(async tx=>{
    const[destination]=await tx<any[]>`select id::text,code,name,branch_code from operations.locations where id=${destinationLocationId}::uuid and is_active=true`;
    if(!destination)throw new Error("المكان المستهدف غير صحيح");
    const cars:any[]=[];
    for(const item of vehicles){
      const[v]=await tx<any[]>`
        select v.*,v.id::text,l.code as location_code,l.branch_code
        from operations.vehicles v left join operations.locations l on l.id=v.location_id
        where v.id=${item.vehicleId}::uuid and v.is_deleted=false and v.archived_at is null
        for update of v
      `;
      if(!v)throw new Error("إحدى السيارات غير موجودة");
      if(String(v.location_id)===destinationLocationId)throw new Error(`السيارة ${v.vin} موجودة بالفعل في المكان المستهدف`);
      const[active]=await tx<any[]>`select r.request_no from operations.transfer_request_vehicles rv join operations.transfer_requests r on r.id=rv.transfer_request_id where rv.vehicle_id=${item.vehicleId}::uuid and r.is_deleted=false and r.cancelled_at is null and r.status<>'completed' limit 1`;
      if(active)throw new Error(`السيارة ${v.vin} مرتبطة بطلب نشط ${active.request_no}`);
      cars.push({...v,itemNote:item.note});
    }
    const source=cars[0];
    if(cars.some((vehicle)=>String(vehicle.location_id)!==String(source.location_id)))throw new Error("يجب أن تكون كل سيارات طلب التصوير في المكان المصدر نفسه");
    const[sequence]=await tx<any[]>`select nextval('operations.transfer_request_no_seq')::bigint as n`;
    const requestNo=`PH-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${String(sequence?.n||1).padStart(6,'0')}`;
    const[request]=await tx<any[]>`
      insert into operations.transfer_requests(request_no,department_code,transfer_type,request_kind,source_location_id,destination_location_id,status,requested_by,requested_by_name,requested_by_role,requested_by_branch,source_branch_code,destination_branch_code,note)
      values(${requestNo},'marketing','photography','photography',${source.location_id},${destinationLocationId}::uuid,'created',${user.id}::uuid,${user.fullName},${user.roles[0]||'مستخدم التسويق'},${user.branches[0]||null},${source.branch_code||source.location_code||null},${destination.branch_code||destination.code||null},${clean(body.note)||null})
      returning *,id::text
    `;
    for(const car of cars)await tx`insert into operations.transfer_request_vehicles(transfer_request_id,vehicle_id,source_location_id,source_status,item_note) values(${request.id}::uuid,${car.id}::uuid,${car.location_id},${car.status_code},${car.itemNote||null})`;
    await tx`insert into operations.transfer_request_events(transfer_request_id,stage,action,note,actor_id,actor_name,actor_role,actor_branch,after_data) values(${request.id}::uuid,'created','created',${clean(body.note)||null},${user.id}::uuid,${user.fullName},${user.roles[0]||'مستخدم التسويق'},${user.branches[0]||null},${tx.json(dbJson({requestKind:'photography',destinationLocationId,vehicles}))})`;
    return{ok:true,request,message:"تم إنشاء طلب التصوير"};
  });
}



async function userColors(sql:ReturnType<typeof getSql>){const rows=await sql<any[]>`select u.id::text,u.full_name,u.email,coalesce(c.color,'#6c3329') as color from core.users u left join marketing.user_colors c on c.user_id=u.id where u.is_active=true and (exists(select 1 from marketing.department_users du where du.user_id=u.id) or exists(select 1 from core.user_departments ud join core.departments d on d.id=ud.department_id where ud.user_id=u.id and d.code='marketing')) order by u.full_name`;return{ok:true,rows};}
async function saveUserColors(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){if(!hasPermission(user,"settings.marketing.manage"))throw new Error("لا توجد صلاحية لإدارة ألوان المستخدمين");for(const item of arrayValue(body.colors)){const userId=clean(item.userId),color=clean(item.color);if(!userId||!/^#[0-9a-fA-F]{6}$/.test(color))continue;await sql`insert into marketing.user_colors(user_id,color,updated_by,updated_at) values(${userId}::uuid,${color},${user.id}::uuid,now()) on conflict(user_id) do update set color=excluded.color,updated_by=excluded.updated_by,updated_at=now()`;}return{ok:true,message:"تم حفظ ألوان المسؤولين"};}

async function platformConnections(sql:ReturnType<typeof getSql>){const rows=await sql<any[]>`select * from marketing.platform_connections order by platform`;return{ok:true,connections:rows.map(publicConnection)};}
async function saveConnection(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){if(!hasPermission(user,"marketing.connections.manage"))throw new Error("لا توجد صلاحية لإدارة ربط المنصات");const platform=clean(body.platform).toLowerCase();if(!['facebook','instagram'].includes(platform))throw new Error("المنصة غير مدعومة");const connected=body.connected===undefined?true:bool(body.connected);await sql`insert into marketing.platform_connections(platform,connected,status,state,source,account_id,account_name,page_id,page_name,ig_user_id,username,pages,access_token_encrypted,user_access_token_encrypted,page_access_token_encrypted,connected_at,updated_at,updated_by) values(${platform},${connected},${connected?'connected':'disconnected'},${connected?'ready':'idle'},'postgresql-manual-migration',${clean(body.accountId)||null},${clean(body.accountName)||null},${clean(body.pageId)||null},${clean(body.pageName)||null},${clean(body.igUserId)||null},${clean(body.username)||null},${sql.json(dbJson(arrayValue(body.pages)))},${clean(body.accessToken)?encryptToken(body.accessToken):null},${clean(body.userAccessToken)?encryptToken(body.userAccessToken):null},${clean(body.pageAccessToken)?encryptToken(body.pageAccessToken):null},${connected?sql`now()`:null},now(),${user.id}::uuid) on conflict(platform) do update set connected=excluded.connected,status=excluded.status,state=excluded.state,source=excluded.source,account_id=excluded.account_id,account_name=excluded.account_name,page_id=excluded.page_id,page_name=excluded.page_name,ig_user_id=excluded.ig_user_id,username=excluded.username,pages=excluded.pages,access_token_encrypted=coalesce(excluded.access_token_encrypted,marketing.platform_connections.access_token_encrypted),user_access_token_encrypted=coalesce(excluded.user_access_token_encrypted,marketing.platform_connections.user_access_token_encrypted),page_access_token_encrypted=coalesce(excluded.page_access_token_encrypted,marketing.platform_connections.page_access_token_encrypted),connected_at=coalesce(excluded.connected_at,marketing.platform_connections.connected_at),updated_at=now(),updated_by=excluded.updated_by`;return{ok:true,message:"تم حفظ ربط المنصة داخل PostgreSQL"};}
async function disconnectConnection(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){if(!hasPermission(user,"marketing.connections.manage"))throw new Error("لا توجد صلاحية لإدارة ربط المنصات");const platform=clean(body.platform);await sql`update marketing.platform_connections set connected=false,status='disconnected',state='idle',access_token_encrypted=null,user_access_token_encrypted=null,page_access_token_encrypted=null,updated_at=now(),updated_by=${user.id}::uuid where platform=${platform}`;return{ok:true,message:"تم فصل الربط"};}
async function migrateConnectionEnv(sql:ReturnType<typeof getSql>,user:SessionUser){if(!hasPermission(user,"marketing.connections.manage"))throw new Error("لا توجد صلاحية لإدارة ربط المنصات");const userToken=clean(process.env.META_USER_ACCESS_TOKEN||process.env.META_ACCESS_TOKEN),pageToken=clean(process.env.META_PAGE_ACCESS_TOKEN||process.env.META_SYSTEM_PAGE_TOKEN),pageId=clean(process.env.META_DEFAULT_PAGE_ID||process.env.META_PAGE_ID),pageName=clean(process.env.META_PAGE_NAME),igId=clean(process.env.META_IG_USER_ID),username=clean(process.env.META_IG_USERNAME);if(!userToken&&!pageToken)throw new Error("لا توجد توكنات Meta حالية في متغيرات البيئة");await saveConnection(sql,{platform:'facebook',connected:true,userAccessToken:userToken,accessToken:userToken,pageAccessToken:pageToken,accountId:pageId,accountName:pageName,pageId,pageName},user);if(igId)await saveConnection(sql,{platform:'instagram',connected:true,userAccessToken:userToken,accessToken:userToken,pageAccessToken:pageToken,accountId:igId,accountName:username,igUserId:igId,username,pageId,pageName},user);return{ok:true,message:"تم نقل التوكنات الحالية إلى PostgreSQL"};}

async function createRawFolders(body:any){const url=clean(process.env.MZJ_RAW_API_URL)||'http://152.239.121.92:8080/api/create-raw-folders';const token=clean(process.env.MZJ_RAW_API_TOKEN);if(!token)throw new Error("MZJ_RAW_API_TOKEN غير مضبوط");const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-api-token':token},body:JSON.stringify(body.payload||body)});const payload=await response.json().catch(()=>({}));if(!response.ok||payload.ok===false)throw new Error(payload.message||"تعذر إنشاء فولدرات الخام");return payload;}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  try {
    await ensureOperationsSchema(); await ensureMarketingSchema();
    const user = await requireUser(request,response); if(!user)return;
    if(!canUseMarketing(user))return response.status(403).json({ok:false,error:"لا توجد صلاحية لدخول سيستم التسويق"});
    const sql=getSql(); const resource=clean(request.query.resource)||"dashboard";
    if(request.method==='GET'){
      if(resource==='meta')return response.status(200).json({...await marketingMeta(sql,user),cars:(hasPermission(user,'marketing.campaign.create')||hasPermission(user,'marketing.agenda.create'))?await loadOperationsCars(sql):[]});
      if(resource==='dashboard')return response.status(200).json(await dashboard(sql,user));
      if(resource==='database')return response.status(200).json(await databaseRows(sql,user));
      if(resource==='entity')return response.status(200).json(await entityDetail(sql,clean(request.query.sourceType),clean(request.query.id),user));
      if(resource==='task')return response.status(200).json(await taskDetail(sql,clean(request.query.id),user));
      if(resource==='packages')return response.status(200).json({ok:true,rows:await sql<any[]>`select *,id::text from marketing.packages where is_active=true order by category,name`});
      if(resource==='publish_prep')return response.status(200).json(await publishPrep(sql,user));
      if(resource==='monitoring')return response.status(200).json(await monitoring(sql,user));
      if(resource==='calendar')return response.status(200).json(await calendarData(sql,user));
      if(resource==='receipt_calendar')return response.status(200).json(await receiptCalendar(sql,user));
      if(resource==='attendance')return response.status(200).json(await attendanceData(sql,user,request));
      if(resource==='stock')return response.status(200).json(await stockData(sql,user));
      if(resource==='user_colors')return response.status(200).json(await userColors(sql));
      if(resource==='platform_connections')return response.status(200).json(await platformConnections(sql));
      if(resource==='file')return response.status(200).json(await fileDownload(sql,clean(request.query.id),user));
      if(resource==='campaign_code'){if(!hasPermission(user,'marketing.campaign.create'))return response.status(403).json({ok:false,message:'لا توجد صلاحية لإنشاء حملة'});return response.status(200).json({ok:true,code:await nextCampaignCode(sql,clean(request.query.campaignTypeId))});}
      return response.status(404).json({ok:false,error:"المورد المطلوب غير موجود"});
    }
    if(request.method!=='POST')return response.status(405).json({ok:false,error:"Method not allowed"});
    const body=bodyObject(request),action=clean(body.action); let result:any;
    if(action==='create_campaign')result=await createCampaign(sql,body,user);
    else if(action==='create_agenda')result=await createAgenda(sql,body,user);
    else if(action==='save_department')result=await saveDepartment(sql,body,user);
    else if(action==='save_assignment_action')result=await saveAssignmentAction(sql,body);
    else if(action==='save_creative_type')result=await saveCreativeType(sql,body);
    else if(action==='save_campaign_type')result=await saveCampaignType(sql,body);
    else if(action==='save_platform')result=await savePlatform(sql,body);
    else if(action==='delete_setting')result=await softDeleteSetting(sql,body);
    else if(action==='save_package')result=await savePackage(sql,body,user);
    else if(action==='receive_task')result=await receiveTask(sql,body,user);
    else if(action==='upload_template')result=await uploadTemplate(sql,body,user);
    else if(action==='review_template')result=await reviewTemplate(sql,body,user);
    else if(action==='toggle_task_action')result=await toggleTaskAction(sql,body,user);
    else if(action==='attach_final_file')result=await attachFinalFile(sql,body,user);
    else if(action==='prepare_upload')result=await prepareUpload(sql,body,user);
    else if(action==='mark_file_ready')result=await markFileReady(sql,body,user);
    else if(action==='save_publish_prep')result=await savePublishPrep(sql,body,user);
    else if(action==='publish_now')result=await publishNow(sql,body,user);
    else if(action==='save_result_file')result=await saveResultFile(sql,body,user);
    else if(action==='save_links')result=await saveLinks(sql,body,user);
    else if(action==='archive_entity')result=await archiveEntity(sql,body,user);
    else if(action==='delete_entity')result=await deleteEntity(sql,body,user);
    else if(action==='attendance')result=await attendanceAction(sql,body,user);
    else if(action==='create_photo_request')result=await createPhotoRequest(sql,body,user);
    else if(action==='complete_photo_request')result=await completePhotographyRequest(sql,clean(body.id),user,clean(body.note));
    else if(action==='save_user_colors')result=await saveUserColors(sql,body,user);
    else if(action==='save_connection')result=await saveConnection(sql,body,user);
    else if(action==='disconnect_connection')result=await disconnectConnection(sql,body,user);
    else if(action==='migrate_connection_env')result=await migrateConnectionEnv(sql,user);
    else if(action==='create_raw_folders')result=await createRawFolders(body);
    else throw new Error("الإجراء غير مدعوم");
    await audit(sql,user,action,'marketing',clean(result?.id||body.id)||null,result,undefined,requestIp(request)).catch(()=>undefined);
    return response.status(200).json(result);
  } catch(error:any){console.error('Marketing API failed',error);const message=clean(error?.message)||"تعذر تنفيذ العملية";const status=/صلاحية|مدير النظام/.test(message)?403:/غير موجود/.test(message)?404:400;return response.status(status).json({ok:false,error:message});}
}
