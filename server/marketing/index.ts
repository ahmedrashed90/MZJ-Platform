import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { requireUser, requestIp, type SessionUser } from "../_auth.js";
import { canAccessSystem, hasPermission } from "../../shared/system-access.js";
import { getSystemAccess } from "../_access-control.js";
import { ensureAccessControlSchema } from "../_access-control-schema.js";
import { completePhotographyRequest } from "../operations/index.js";
import { ensureMarketingSchema } from "../_marketing-schema.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { buildMarketingStorageKey, createDownloadUrl, createUploadUrl, mediaStorageConfigured } from "../_media-storage.js";
import { emitMarketingNotification } from "../_notifications.js";
import { decryptPlatformToken, publicPlatformConnection } from "../_platform-connections.js";
import { createOpaqueTicket, getZohoFileInfo, getZohoRuntime, parseZohoUploadResult, ticketHash } from "../_zoho-workdrive.js";

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
function validateTemplateData(value: unknown) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const keys = Object.keys(input);
  const unknown = keys.filter((key) => !TEMPLATE_FIELDS.includes(key as any));
  const missing = TEMPLATE_FIELDS.filter((key) => !Object.prototype.hasOwnProperty.call(input, key));
  if (unknown.length || missing.length) throw new Error("ملف Task Template لا يطابق الحقول المعتمدة في النظام");
  const output = cleanTemplateData(input);
  const required = ["proposedName", "goal", "mainMessage", "hook", "mainScript", "cta"];
  const empty = required.filter((key) => !clean(output[key]));
  if (empty.length) throw new Error("ملف Task Template ناقص بيانات إلزامية. راجع المعاينة وأعد الرفع");
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
async function requireTaskTemplateUploadAccess(sql: ReturnType<typeof getSql>, user: SessionUser, taskId: string) {
  if (!taskId) throw new Error("رقم التاسك مطلوب");
  const [task] = await sql<any[]>`
    select t.id::text,t.task_kind,t.source_type,t.source_id::text,t.assigned_to::text,t.paired_content_user_id::text,
      t.task_template_id::text,tt.file_id::text as template_file_id
    from marketing.tasks t
    left join marketing.task_templates tt on tt.id=t.task_template_id
    where t.id=${taskId}::uuid and t.is_deleted=false
  `;
  if (!task || task.task_kind !== "task_template") throw new Error("Task Template غير موجود");
  if (!await canAccessMarketingTask(sql, user, taskId)) throw new Error("لا توجد صلاحية للوصول إلى هذا التكليف");
  const permission = task.template_file_id ? "marketing.task_template.reupload" : "marketing.task_template.upload";
  if (!hasPermission(user, permission)) throw new Error("لا توجد صلاحية لرفع Task Template");
  return task;
}

async function requireFinalFileUploadAccess(sql: ReturnType<typeof getSql>, user: SessionUser, taskId: string) {
  if (!hasPermission(user, "marketing.task.final_file.upload")) throw new Error("لا توجد صلاحية لرفع الملف النهائي");
  const [task] = await sql<any[]>`
    select t.id::text,t.task_kind,t.source_type,t.source_id::text,t.assigned_to::text,tt.status as template_status
    from marketing.tasks t
    left join marketing.task_templates tt on tt.id=t.task_template_id
    where t.id=${taskId}::uuid and t.is_deleted=false
  `;
  if (!task) throw new Error("التاسك غير موجود");
  if (!await canAccessMarketingTask(sql, user, taskId)) throw new Error("لا توجد صلاحية للوصول إلى هذا التكليف");
  if (task.task_kind === "execution" && task.template_status !== "approved") throw new Error("في انتظار اعتماد Task Template");
  return task;
}
function canUseMarketing(user: SessionUser) { return canAccessSystem(user, "marketing"); }
function safeCode(value: unknown) { return clean(value).toUpperCase().replace(/[^A-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48); }
function zohoFinalFileName(originalName: unknown, sourceType: unknown, sourceId: unknown, taskId: unknown, groupId: unknown, orderIndex: number) {
  const raw=(clean(originalName)||`file-${orderIndex+1}`).replace(/[\/\\\u0000-\u001f]/g,"-");
  const dot=raw.lastIndexOf(".");
  const extension=dot>0&&dot<raw.length-1?raw.slice(dot).slice(0,24):"";
  const stem=(extension?raw.slice(0,dot):raw).trim()||`file-${orderIndex+1}`;
  const prefix=`${clean(sourceType)==='agenda'?'agenda':'campaign'}-${clean(sourceId).slice(0,8)}-${clean(taskId).slice(0,8)}-${clean(groupId).slice(0,8)}-${String(orderIndex+1).padStart(2,'0')}-`;
  return `${prefix}${stem.slice(0,Math.max(20,180-prefix.length-extension.length))}${extension}`;
}
function isoDate(value: unknown) { const text = clean(value); return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null; }
function sourceTable(sourceType: string) { return sourceType === "agenda" ? "marketing.agendas" : "marketing.campaigns"; }
async function audit(sql: ReturnType<typeof getSql>, user: SessionUser, action: string, entityType: string, entityId: string | null, afterData?: unknown, beforeData?: unknown, ip?: string | null) {
  await sql`insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,before_data,after_data,ip_address) values (${user.id}::uuid,'marketing',${action},${entityType},${entityId},${beforeData ? sql.json(dbJson(beforeData)) : null},${afterData ? sql.json(dbJson(afterData)) : null},${ip || null})`;
}

async function marketingMeta(sql: ReturnType<typeof getSql>, user: SessionUser) {
  // Keep marketing metadata mirrored without crashing when an older database
  // contains the same marketing name under a different legacy ID. Existing
  // metadata wins until the user edits it, while missing canonical IDs are
  // inserted only when their normalized name is not already represented.
  await sql`
    update marketing.departments md
    set name=d.name,is_active=d.is_active,updated_at=greatest(md.updated_at,d.updated_at)
    from core.departments d
    where d.id=md.id and d.system_code='marketing'
      and not exists(
        select 1 from marketing.departments conflicting_name
        where conflicting_name.id<>md.id
          and lower(btrim(conflicting_name.name))=lower(btrim(d.name))
      )
  `;
  await sql`
    insert into marketing.departments(id,name,is_content,is_active,created_at,updated_at)
    select d.id,d.name,false,d.is_active,d.created_at,d.updated_at
    from core.departments d
    where d.system_code='marketing'
      and not exists(select 1 from marketing.departments by_id where by_id.id=d.id)
      and not exists(
        select 1 from marketing.departments by_name
        where lower(btrim(by_name.name))=lower(btrim(d.name))
      )
    on conflict(id) do update set name=excluded.name,is_active=excluded.is_active,updated_at=greatest(marketing.departments.updated_at,excluded.updated_at)
  `;

  // Recover the single canonical content department ID. Older data can keep the
  // user membership on the correct department while the is_content flag points
  // to another row. Prefer the established content department name only as a
  // repair fallback, then persist the chosen UUID so every screen uses the same ID.
  const [contentDepartment] = await sql<any[]>`
    select md.id::text
    from marketing.departments md
    join core.departments cd on cd.id=md.id and cd.system_code='marketing'
    left join lateral (
      select count(*)::int as members
      from core.user_system_departments usd
      where usd.system_code='marketing' and usd.department_id=md.id
    ) membership on true
    where md.is_active=true and cd.is_active=true
      and (
        md.is_content=true
        or replace(lower(btrim(cd.name)), ' ', '') in ('قسمالمحتوى','المحتوى','content','contentdepartment')
      )
    order by
      case when replace(lower(btrim(cd.name)), ' ', '') in ('قسمالمحتوى','المحتوى','content','contentdepartment') then 0 else 1 end,
      md.is_content desc,
      coalesce(membership.members,0) desc,
      md.created_at,
      md.id
    limit 1
  `;
  const contentDepartmentIdValue=clean(contentDepartment?.id);
  if(contentDepartmentIdValue){
    await sql`
      update marketing.departments
      set is_content=(id=${contentDepartmentIdValue}::uuid),updated_at=case when is_content is distinct from (id=${contentDepartmentIdValue}::uuid) then now() else updated_at end
      where is_content=true or id=${contentDepartmentIdValue}::uuid
    `;
  }
  const [users, departments, actions, creativeTypes, campaignTypes, platforms, postTypes, funnels] = await Promise.all([
    sql<any[]>`
      select u.id::text,u.full_name,u.email,u.mobile,u.is_active,u.can_receive_tasks
      from core.users u
      where u.is_active=true
        and coalesce(u.disabled_reason,'') not like 'ACCOUNT_DELETED:%'
      order by u.full_name
    `,
    sql<any[]>`
      select d.id::text,cd.name,d.is_content,(d.is_active and cd.is_active) as is_active,
        coalesce(
          json_agg(
            json_build_object('id',u.id::text,'fullName',u.full_name,'email',u.email)
            order by u.full_name
          ) filter(where u.id is not null),
          '[]'::json
        ) as users
      from marketing.departments d
      join core.departments cd on cd.id=d.id and cd.system_code='marketing'
      left join core.user_system_departments usd on usd.department_id=d.id and usd.system_code='marketing'
      left join core.users u on u.id=usd.user_id and u.is_active=true and coalesce(u.disabled_reason,'') not like 'ACCOUNT_DELETED:%'
      where d.is_active=true and cd.is_active=true
      group by d.id,cd.name,cd.is_active
      order by d.is_content desc,cd.name
    `,
    sql<any[]>`select a.id::text,a.department_id::text,cd.name as department_name,a.name,a.percentage::float,a.admin_only,a.sort_order from marketing.assignment_actions a join core.departments cd on cd.id=a.department_id and cd.system_code='marketing' where a.is_active=true order by cd.name,a.sort_order,a.created_at`,
    sql<any[]>`select c.id::text,c.name,c.short_code,c.primary_department_id::text,cd.name as primary_department_name,c.is_active from marketing.creative_types c left join core.departments cd on cd.id=c.primary_department_id and cd.system_code='marketing' where c.is_active=true order by c.name`,
    sql<any[]>`select id::text,name,short_code,code_prefix,sequence_value,is_active from marketing.campaign_types where is_active=true order by name`,
    sql<any[]>`select id::text,code,name,is_active from marketing.platforms where is_active=true order by name`,
    sql<any[]>`select p.id::text,p.platform_id::text,p.name,p.width,p.height from marketing.platform_post_types p where p.is_active=true order by p.name`,
    sql<any[]>`select id::text,name,active,source,created_at from marketing.funnels where active=true order by created_at`,
  ]);
  const connections = await sql<any[]>`select * from marketing.platform_connections order by platform`;
  return { ok: true, users, departments, contentDepartmentId: contentDepartmentIdValue, actions, creativeTypes, campaignTypes, platforms, postTypes, funnels, connections: connections.map(publicPlatformConnection), permissions: { effective: user.permissions.filter((code) => code.startsWith("marketing.")) } };
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

async function allocateCampaignCode(tx: any, campaignTypeId: string, requestedCode?: string | null) {
  const [type] = await tx<any[]>`select * from marketing.campaign_types where id=${campaignTypeId}::uuid and is_active=true for update`;
  if (!type) throw new Error("نوع الحملة غير موجود");

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const base = `${safeCode(type.code_prefix || type.short_code)}-${year}-${month}-`;
  const requested = clean(requestedCode);

  if (requested && requested.startsWith(base)) {
    const [duplicate] = await tx<any[]>`select 1 from marketing.campaigns where campaign_code=${requested} limit 1`;
    if (!duplicate) {
      const requestedSequence = Number(requested.slice(base.length));
      if (Number.isInteger(requestedSequence) && requestedSequence > Number(type.sequence_value || 0)) {
        await tx`update marketing.campaign_types set sequence_value=${requestedSequence},updated_at=now() where id=${campaignTypeId}::uuid`;
      }
      return requested;
    }
  }

  const [existing] = await tx<any[]>`
    select coalesce(max((substring(campaign_code from '([0-9]+)$'))::int),0)::int as max_sequence
    from marketing.campaigns
    where campaign_code like ${`${base}%`}
  `;
  const sequence = Math.max(Number(type.sequence_value || 0), Number(existing?.max_sequence || 0)) + 1;
  await tx`update marketing.campaign_types set sequence_value=${sequence},updated_at=now() where id=${campaignTypeId}::uuid`;
  return `${base}${String(sequence).padStart(3, "0")}`;
}

async function nextCampaignCode(sql: ReturnType<typeof getSql>, campaignTypeId: string) {
  return sql.begin(async (tx) => allocateCampaignCode(tx, campaignTypeId));
}

function contentDepartmentId(meta: { contentDepartmentId?: string; departments: any[] }) { return clean(meta.contentDepartmentId || meta.departments.find((item) => item.is_content)?.id); }

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
  if (!templates.size) throw new Error(`اختر كاتب محتوى واحدًا على الأقل داخل ${input.creativeName}`);

  const contentUserIds = Array.from(templates.keys());
  const groups = [
    { departmentId: clean(input.primaryDepartmentId), assignments: input.primaryAssignments },
    ...arrayValue(input.optionalAssignments).map((group: any) => ({ departmentId: clean(group.departmentId), assignments: arrayValue(group.assignments) })),
  ];
  const linkedTemplateUsers = new Set<string>();
  let taskIndex = 0;
  for (const group of groups) {
    if (!group.departmentId) continue;
    for (const assignment of arrayValue(group.assignments)) {
      const assignedTo = clean(assignment.userId); if (!assignedTo) continue;
      const explicitLinks = arrayValue<string>(assignment.contentUserIds)
        .map(clean)
        .filter((contentUserId) => Boolean(contentUserId) && templates.has(contentUserId));
      const linkedContentUserIds = explicitLinks.length
        ? Array.from(new Set(explicitLinks))
        : contentUserIds.length === 1
          ? [contentUserIds[0]]
          : [];

      for (const contentUserId of linkedContentUserIds) {
        const templateId = templates.get(contentUserId); if (!templateId) continue;
        taskIndex += 1;
        linkedTemplateUsers.add(contentUserId);
        const [task] = await tx<any[]>`
          insert into marketing.tasks(campaign_id,agenda_id,source_type,source_id,creative_id,department_code,department_id,assigned_to,paired_content_user_id,task_template_id,task_kind,title,status,due_at,progress,note)
          values (${input.campaignId ? tx`${input.campaignId}::uuid` : null},${input.agendaId ? tx`${input.agendaId}::uuid` : null},${input.sourceType},${input.sourceId}::uuid,${input.creativeId}::uuid,'execution',${group.departmentId}::uuid,${assignedTo}::uuid,${contentUserId}::uuid,${templateId}::uuid,'execution',${`${input.creativeName} - تنفيذ ${taskIndex}`},'required',${isoDate(assignment.dueOn)},0,${clean(assignment.note)||null})
          returning id::text
        `;
        await tx`insert into marketing.task_action_progress(task_id,action_id) select ${task.id}::uuid,id from marketing.assignment_actions where department_id=${group.departmentId}::uuid and is_active=true on conflict do nothing`;
      }
    }
  }

  if (!taskIndex) throw new Error(`اختر يوزرًا تنفيذيًا واربطه بكاتب المحتوى داخل ${input.creativeName}`);
  const unlinkedContentUser = contentUserIds.find((contentUserId) => !linkedTemplateUsers.has(contentUserId));
  if (unlinkedContentUser) throw new Error(`يجب ربط كل Task Template بتاسك تنفيذي داخل ${input.creativeName}`);
}

async function createCampaign(sql: ReturnType<typeof getSql>, body: Record<string, any>, user: SessionUser) {
  const campaignTypeId = clean(body.campaignTypeId); const name = clean(body.name); const start = isoDate(body.publishStart); const end = isoDate(body.publishEnd);
  if (!campaignTypeId || !name || !start || !end) throw new Error("بيانات الحملة الأساسية غير مكتملة");
  const meta = await marketingMeta(sql, user); const contentId = contentDepartmentId(meta);
  return sql.begin(async (tx) => {
    let code = await allocateCampaignCode(tx, campaignTypeId, clean(body.campaignCode));
    let campaign: any = null;
    for (let attempt = 0; attempt < 3 && !campaign; attempt += 1) {
      [campaign] = await tx<any[]>`
        insert into marketing.campaigns(campaign_code,name,campaign_type_id,campaign_type,objective,status,campaign_date,publish_start,publish_end,starts_at,ends_at,required_from_content,payload,progress,created_by)
        select ${code},${name},ct.id,ct.name,${clean(body.objective)||null},'required',${isoDate(body.campaignDate)||new Date().toISOString().slice(0,10)},${start},${end},${start}::date,${end}::date,${clean(body.requiredFromContent)||null},${tx.json(dbJson({ ...body, campaignCode: code }))},0,${user.id}::uuid
        from marketing.campaign_types ct where ct.id=${campaignTypeId}::uuid and ct.is_active=true
        on conflict(campaign_code) do nothing
        returning id::text,campaign_code,name
      `;
      if (!campaign) code = await allocateCampaignCode(tx, campaignTypeId);
    }
    if (!campaign) throw new Error("تعذر إنشاء كود حملة فريد. أعد المحاولة مرة أخرى");
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
  const meta = await marketingMeta(sql,user); const contentId = contentDepartmentId(meta);
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
          const contentAssignmentMap = new Map<string, any>();
          for (const assignment of arrayValue(rawCreative.contentAssignments)) {
            const userId = clean(assignment.userId);
            if (!userId) continue;
            contentAssignmentMap.set(userId, { ...assignment, userId });
          }
          const contentAssignments = [...contentAssignmentMap.values()];
          const contentUserIds = contentAssignments.map((item: any) => clean(item.userId)).filter(Boolean);
          if (!contentUserIds.length) throw new Error(`اختر يوزر قسم المحتوى للكرييتيف ${creativeType.name}`);

          const normalizeExecutionAssignments = (assignments: any[]) => {
            const assignmentMap = new Map<string, any>();
            for (const assignment of arrayValue(assignments)) {
              const userId = clean(assignment.userId);
              if (!userId) continue;
              const linked = arrayValue<string>(assignment.contentUserIds).map(clean).filter((id) => contentUserIds.includes(id));
              const existing = assignmentMap.get(userId);
              assignmentMap.set(userId, {
                ...(existing || assignment),
                ...assignment,
                userId,
                contentUserIds: [...new Set([...(existing?.contentUserIds || []), ...linked])],
              });
            }
            return [...assignmentMap.values()];
          };
          const primaryAssignments = normalizeExecutionAssignments(rawCreative.primaryAssignments);
          const optionalAssignments = arrayValue(rawCreative.optionalAssignments).map((group: any) => ({
            ...group,
            assignments: normalizeExecutionAssignments(group.assignments),
          }));
          const executionAssignments = [
            ...primaryAssignments,
            ...optionalAssignments.flatMap((group: any) => arrayValue(group.assignments)),
          ];
          if (!executionAssignments.length) throw new Error(`اختر يوزرًا تنفيذيًا للكرييتيف ${creativeType.name}`);
          const coveredContentUsers = new Set(executionAssignments.flatMap((assignment: any) => arrayValue<string>(assignment.contentUserIds).map(clean).filter(Boolean)));
          const missingContentUsers = contentUserIds.filter((id: string) => !coveredContentUsers.has(id));
          if (missingContentUsers.length && executionAssignments.length === 1) {
            executionAssignments[0].contentUserIds = [...new Set([...arrayValue<string>(executionAssignments[0].contentUserIds).map(clean).filter(Boolean), ...missingContentUsers])];
          } else if (missingContentUsers.length) {
            throw new Error(`كل Task Template يجب ربطه بتاسك تنفيذي داخل ${creativeType.name}`);
          }
          const instanceCode = `${safeCode(creativeType.short_code)}${String(creativeIndex).padStart(2,"0")}`;
          const [creative] = await tx<any[]>`
            insert into marketing.creatives(agenda_id,creative_type,creative_type_id,quantity,status,instance_code,name,primary_department_id,cars,content_assignments,primary_assignments,optional_assignments,platform_assignments,schedule_day,notes)
            values (${agenda.id}::uuid,${creativeType.name},${creativeTypeId}::uuid,1,'required',${instanceCode},${creativeType.name},${creativeType.primary_department_id},${tx.json(dbJson(arrayValue(rawCreative.cars)))},${tx.json(dbJson(contentAssignments))},${tx.json(dbJson(primaryAssignments))},${tx.json(dbJson(optionalAssignments))},${tx.json(dbJson(arrayValue(rawCreative.platforms)))},${dayDate},${tx.json(dbJson(rawCreative.notes || {}))}) returning id::text
          `;
          await createTasksForCreative(tx,{ sourceType:"agenda",sourceId:agenda.id,agendaId:agenda.id,sourceCode:monthKey,sourceName:name,creativeId:creative.id,creativeIndex,creativeName:creativeType.name,creativeType:creativeType.name,contentDepartmentId:contentId,contentAssignments,primaryDepartmentId:clean(creativeType.primary_department_id),primaryAssignments,optionalAssignments,requiredFromContent:"" });
          const templatesWithoutExecution = await tx<any[]>`
            select tt.id::text
            from marketing.task_templates tt
            where tt.creative_id=${creative.id}::uuid
              and not exists (
                select 1 from marketing.tasks execution_task
                where execution_task.task_template_id=tt.id
                  and execution_task.task_kind='execution'
                  and execution_task.is_deleted=false
              )
          `;
          if (templatesWithoutExecution.length) throw new Error(`كل Task Template يجب أن يكون معه تاسك تنفيذي داخل ${creativeType.name}`);
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
  const [completion] = await sql<any[]>`
    select count(*)::int as total,
      count(*) filter(where
        (t.task_kind='task_template' and t.progress>=100 and t.status='approved')
        or
        (t.task_kind='execution' and t.progress>=100 and t.status='completed' and t.completed_at is not null)
      )::int as ready
    from marketing.tasks t
    where t.source_type=${sourceType} and t.source_id=${sourceId}::uuid and t.is_deleted=false
  `;
  const progress = rows.length ? rows.reduce((sum:number,row:any)=>sum+numberValue(row.progress),0)/rows.length : 0;
  const readyForPublishing = Number(completion?.total || 0) > 0 && Number(completion?.total || 0) === Number(completion?.ready || 0);
  if (sourceType === "agenda") await sql`
    update marketing.agendas
    set progress=${progress},
      status=case
        when status in ('publishing','archived') then status
        when ${readyForPublishing} then 'ready_publish'
        when status='ready_publish' then 'required'
        else status
      end,
      updated_at=now()
    where id=${sourceId}::uuid
  `;
  else await sql`
    update marketing.campaigns
    set progress=${progress},
      status=case
        when status in ('publishing','archived') then status
        when ${readyForPublishing} then 'ready_publish'
        when status='ready_publish' then 'required'
        else status
      end,
      updated_at=now()
    where id=${sourceId}::uuid
  `;
  return progress;
}

async function moveEntityToPublishing(sql: ReturnType<typeof getSql>, body: any, user: SessionUser) {
  const sourceType = clean(body.sourceType);
  const sourceId = clean(body.sourceId);
  if (!['campaign','agenda'].includes(sourceType) || !sourceId) throw new Error("بيانات الحملة أو الأجندة غير مكتملة");
  const canMove = hasPermission(user,"marketing.publish_prep.manage")
    || (sourceType === 'campaign' && hasPermission(user,"marketing.campaign.edit"))
    || (sourceType === 'agenda' && hasPermission(user,"marketing.agenda.edit"));
  if (!canMove) throw new Error("لا توجد صلاحية لنقل الحملة أو الأجندة إلى قسم النشر");
  await assertMarketingEntityAccess(sql,user,sourceType,sourceId);
  await recalculateProgress(sql,sourceType,sourceId);

  const [entity] = sourceType === 'campaign'
    ? await sql<any[]>`select id::text,name,status,progress::float from marketing.campaigns where id=${sourceId}::uuid and is_deleted=false and archived_at is null`
    : await sql<any[]>`select id::text,name,status,progress::float from marketing.agendas where id=${sourceId}::uuid and archived_at is null`;
  if (!entity) throw new Error("الحملة أو الأجندة غير موجودة");
  if (entity.status === 'publishing') return { ok:true, id:sourceId, message:"الحملة أو الأجندة موجودة بالفعل في قسم النشر" };
  if (numberValue(entity.progress) < 100 || entity.status !== 'ready_publish') {
    throw new Error("لا يمكن النقل إلى قسم النشر قبل اكتمال Task Template وإنهاء كل التاسكات التنفيذية بنسبة 100%");
  }

  if (sourceType === 'campaign') await sql`update marketing.campaigns set status='publishing',updated_at=now() where id=${sourceId}::uuid`;
  else await sql`update marketing.agendas set status='publishing',updated_at=now() where id=${sourceId}::uuid`;
  return { ok:true, id:sourceId, message:`تم نقل ${sourceType === 'campaign' ? 'الحملة' : 'الأجندة'} إلى قسم النشر` };
}

async function dashboardVersion(sql: ReturnType<typeof getSql>) {
  const [row] = await sql<any[]>`
    select greatest(
      coalesce((select max(updated_at) from marketing.tasks),'epoch'::timestamptz),
      coalesce((select max(updated_at) from marketing.task_templates),'epoch'::timestamptz),
      coalesce((select max(updated_at) from marketing.campaigns),'epoch'::timestamptz),
      coalesce((select max(updated_at) from marketing.agendas),'epoch'::timestamptz),
      coalesce((select max(updated_at) from marketing.user_colors),'epoch'::timestamptz)
    )::text as version
  `;
  return clean(row?.version);
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
  const liveSourceFilter = sql`(
    (t.source_type='campaign' and exists(
      select 1 from marketing.campaigns source_campaign
      where source_campaign.id=t.source_id
        and source_campaign.is_deleted=false
        and source_campaign.archived_at is null
    ))
    or
    (t.source_type='agenda' and exists(
      select 1 from marketing.agendas source_agenda
      where source_agenda.id=t.source_id
        and source_agenda.archived_at is null
    ))
  )`;
  const tasks = await sql<any[]>`
    select t.id::text,t.source_type,t.source_id::text,t.task_kind,t.title,t.status,t.progress::float,t.due_at,t.received_at,t.completed_at,t.completed_by::text,t.note,
      done_by.full_name as completed_by_name,t.assigned_to::text,u.full_name as assigned_name,auc.color as assigned_user_color,
      t.paired_content_user_id::text,cu.full_name as content_user_name,cuc.color as content_user_color,
      d.id::text as department_id,d.name as department_name,c.name as creative_name,c.instance_code,
      coalesce(cam.name,ag.name) as source_name,cam.campaign_code,tt.status as template_status,tt.approved_data,
      f.id::text as final_file_id,f.original_name as final_file_name,
      (t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid or ${canViewAllTasks(user)}=true) as can_complete_task
    from marketing.tasks t
    left join core.users u on u.id=t.assigned_to left join core.users cu on cu.id=t.paired_content_user_id
    left join core.users done_by on done_by.id=t.completed_by
    left join marketing.user_colors auc on auc.user_id=t.assigned_to
    left join marketing.user_colors cuc on cuc.user_id=t.paired_content_user_id
    left join marketing.departments d on d.id=t.department_id left join marketing.creatives c on c.id=t.creative_id
    left join marketing.campaigns cam on t.source_type='campaign' and cam.id=t.source_id
    left join marketing.agendas ag on t.source_type='agenda' and ag.id=t.source_id
    left join marketing.task_templates tt on tt.id=t.task_template_id left join marketing.files f on f.id=t.final_file_id
    where t.is_deleted=false and ${liveSourceFilter} and ${taskFilter}
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
  const version = await dashboardVersion(sql);
  const completed = tasks.filter((task)=>task.status==='completed' && task.completed_at);
  return {
    ok:true,
    version,
    required:tasks.filter((task)=>!task.received_at && task.status!=='completed'),
    received:tasks.filter((task)=>task.received_at && task.status!=='completed'),
    completed,
    entities,
    permissions:user.permissions.filter((code)=>code.startsWith("marketing.")),
  };
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
    sourceType === "campaign" ? sql<any[]>`
      select b.*,b.id::text,b.funnel_id::text,b.creative_id::text,f.name as funnel_name,c.name as creative_name,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'platformId',part.value->>'platformId',
            'platformName',coalesce(p.name,'منصة غير معروفة'),
            'amount',coalesce(nullif(part.value->>'amount','')::numeric,0)
          ) order by p.name)
          from jsonb_array_elements(coalesce(b.platform_amounts,'[]'::jsonb)) part(value)
          left join marketing.platforms p on p.id::text=part.value->>'platformId'
        ),'[]'::jsonb) as platform_details
      from marketing.budget_items b
      left join marketing.funnels f on f.id=b.funnel_id
      left join marketing.creatives c on c.id=b.creative_id
      where b.campaign_id=${id}::uuid
      order by b.created_at
    ` : Promise.resolve([]),
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
      coalesce(fm.primary_name,ff.original_name) as final_file_name,coalesce(fm.file_count,case when ff.id is null then 0 else 1 end)::int as final_file_count,coalesce(fm.files,'[]'::jsonb) as final_files,done_by.full_name as completed_by_name
    from marketing.tasks t left join core.users u on u.id=t.assigned_to left join core.users cu on cu.id=t.paired_content_user_id left join core.users done_by on done_by.id=t.completed_by left join marketing.departments d on d.id=t.department_id left join marketing.creatives c on c.id=t.creative_id
    left join marketing.campaigns cam on t.source_type='campaign' and cam.id=t.source_id left join marketing.agendas ag on t.source_type='agenda' and ag.id=t.source_id
    left join marketing.task_templates tt on tt.id=t.task_template_id left join marketing.files ff on ff.id=t.final_file_id
    left join lateral (
      select count(*)::int as file_count,min(f.original_name) filter(where f.order_index=0) as primary_name,
        jsonb_agg(jsonb_build_object('id',f.id::text,'name',f.original_name,'mimeType',f.mime_type,'size',f.file_size,'orderIndex',f.order_index) order by f.order_index,f.created_at) as files
      from marketing.files f
      where t.final_media_group_id is not null and f.final_media_group_id=t.final_media_group_id and f.status='ready'
    ) fm on true
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
      canUnapproveTemplate:hasPermission(user,"marketing.task_template.approve"),
      canRejectTemplate:hasPermission(user,"marketing.task_template.reject"),
      canViewFeedback:hasPermission(user,"marketing.task_template.view_feedback") || task.assigned_to===user.id || task.paired_content_user_id===user.id,
      canExecuteAction:hasPermission(user,"marketing.assignment_action.execute"),
      canExecuteAdminAction:hasPermission(user,"marketing.assignment_action.admin"),
      canUploadFinal:hasPermission(user,"marketing.task.final_file.upload"),
      canDownloadFile:hasPermission(user,"marketing.file.download"),
      canCompleteTask:task.assigned_to===user.id || task.paired_content_user_id===user.id || canViewAllTasks(user),
    }
  };
}

async function saveDepartment(sql: ReturnType<typeof getSql>, body: any, user: SessionUser) {
  const requestedId=clean(body.id);
  const name=clean(body.name);
  const userIds=[...new Set(arrayValue<string>(body.userIds).map(clean).filter(Boolean))];
  if(!name)throw new Error("اسم القسم مطلوب");
  try {
    const result=await sql.begin(async(tx)=>{
      const activeUsers=userIds.length?await tx<any[]>`
        select id::text from core.users
        where id in ${tx(userIds)} and is_active=true and coalesce(disabled_reason,'') not like 'ACCOUNT_DELETED:%'
      `:[];
      if(activeUsers.length!==userIds.length)throw new Error("يوجد مستخدم غير فعال أو غير موجود ضمن الاختيار");

      let departmentId=requestedId;
      let row:any;
      let reused=false;
      if(bool(body.isContent)){
        await tx`update marketing.departments set is_content=false,updated_at=now() where is_content=true and (${requestedId}='' or id<>nullif(${requestedId},'')::uuid)`;
      }
      if(departmentId){
        const [existing]=await tx<any[]>`
          select md.id::text,cd.name,md.is_content,md.is_active
          from marketing.departments md join core.departments cd on cd.id=md.id
          where md.id=${departmentId}::uuid and cd.system_code='marketing'
        `;
        if(!existing)throw new Error("قسم التسويق غير موجود");
        const [duplicate]=await tx<any[]>`
          select md.id::text
          from marketing.departments md
          join core.departments cd on cd.id=md.id and cd.system_code='marketing'
          where md.id<>${departmentId}::uuid
            and lower(btrim(cd.name))=lower(btrim(${name}))
          limit 1
        `;
        if(duplicate)throw new Error("يوجد قسم تسويق آخر بنفس الاسم");
        await tx`update core.departments set name=${name},is_active=true,updated_at=now() where id=${departmentId}::uuid and system_code='marketing'`;
        [row]=await tx<any[]>`update marketing.departments set name=${name},is_content=${bool(body.isContent)},is_active=true,updated_at=now() where id=${departmentId}::uuid returning id::text,name,is_content,is_active`;
      }else{
        const [existingMarketing]=await tx<any[]>`
          select md.id::text
          from marketing.departments md
          join core.departments cd on cd.id=md.id and cd.system_code='marketing'
          where lower(btrim(md.name))=lower(btrim(${name}))
             or lower(btrim(cd.name))=lower(btrim(${name}))
          order by md.created_at
          limit 1
        `;
        const [existingCore]=existingMarketing?[]:await tx<any[]>`
          select id::text
          from core.departments
          where system_code='marketing' and lower(btrim(name))=lower(btrim(${name}))
          order by is_active desc,created_at
          limit 1
        `;
        departmentId=clean(existingMarketing?.id||existingCore?.id);
        reused=Boolean(departmentId);

        if(departmentId){
          await tx`update core.departments set name=${name},is_active=true,updated_at=now() where id=${departmentId}::uuid and system_code='marketing'`;
          [row]=await tx<any[]>`
            insert into marketing.departments(id,name,is_content,is_active,created_by)
            values(${departmentId}::uuid,${name},${bool(body.isContent)},true,${user.id}::uuid)
            on conflict(id) do update set name=excluded.name,is_content=excluded.is_content,is_active=true,updated_at=now()
            returning id::text,name,is_content,is_active
          `;
        }else{
          departmentId=crypto.randomUUID();
          const code=`marketing_${departmentId.replace(/-/g,"").slice(0,16)}`;
          await tx`insert into core.departments(id,code,name,system_code,is_active) values(${departmentId}::uuid,${code},${name},'marketing',true)`;
          [row]=await tx<any[]>`insert into marketing.departments(id,name,is_content,is_active,created_by) values(${departmentId}::uuid,${name},${bool(body.isContent)},true,${user.id}::uuid) returning id::text,name,is_content,is_active`;
        }
      }

      const previous=await tx<any[]>`select user_id::text from core.user_system_departments where system_code='marketing' and department_id=${departmentId}::uuid`;
      const previousIds=previous.map((item:any)=>clean(item.user_id));
      const affected=[...new Set([...previousIds,...userIds])];

      await tx`delete from core.user_system_departments where system_code='marketing' and department_id=${departmentId}::uuid and not (user_id::text = any(${userIds}::text[]))`;
      for(const userId of userIds){
        await tx`insert into core.user_system_departments(user_id,system_code,department_id,is_primary) values(${userId}::uuid,'marketing',${departmentId}::uuid,false) on conflict(user_id,system_code,department_id) do nothing`;
      }

      for(const userId of affected){
        await tx`delete from core.user_departments ud where ud.user_id=${userId}::uuid and ud.department_id=${departmentId}::uuid and not exists(select 1 from core.user_system_departments usd where usd.user_id=ud.user_id and usd.department_id=ud.department_id)`;
        await tx`insert into core.user_departments(user_id,department_id,is_primary) select ${userId}::uuid,${departmentId}::uuid,bool_or(is_primary) from core.user_system_departments where user_id=${userId}::uuid and department_id=${departmentId}::uuid group by user_id,department_id on conflict(user_id,department_id) do update set is_primary=excluded.is_primary`;
        await tx`update core.users set permission_version=permission_version+1,updated_at=now() where id=${userId}::uuid`;
        await tx`delete from core.sessions where user_id=${userId}::uuid`;
      }
      return{row,departmentId,previousIds,reused:!requestedId&&reused};
    });
    await audit(sql,user,requestedId?"department_updated":result.reused?"department_reused":"department_created","department",result.departmentId,{name,isContent:bool(body.isContent),userIds},requestedId?{userIds:result.previousIds}:undefined);
    return{ok:true,row:result.row,message:result.reused?"تم ربط القسم الموجود وحفظ يوزراته فعليًا":"تم حفظ القسم وربط الأقسام المسموحة للمستخدمين فعليًا"};
  } catch (failure) {
    const error=failure as Error & { code?: string; constraint_name?: string; constraint?: string };
    const constraint=clean(error.constraint_name||error.constraint);
    if(error.code==='23505'&&constraint.includes('departments_name_key'))throw new Error("يوجد قسم بنفس الاسم؛ افتح القسم الموجود وعدّل يوزراته بدل إنشاء نسخة مكررة");
    throw failure;
  }
}

async function saveAssignmentAction(sql: ReturnType<typeof getSql>, body:any){const id=clean(body.id),departmentId=clean(body.departmentId),name=clean(body.name),percentage=numberValue(body.percentage);if(!departmentId||!name)throw new Error("بيانات إجراء التكليف غير مكتملة");const [sum]=await sql<any[]>`select coalesce(sum(percentage),0)::float as total from marketing.assignment_actions where department_id=${departmentId}::uuid and is_active=true and (${id}='' or id<>nullif(${id},'')::uuid)`;if(Number(sum?.total||0)+percentage>100.001)throw new Error("مجموع نسب إجراءات القسم لا يمكن أن يتجاوز 100%");const [row]=id?await sql<any[]>`update marketing.assignment_actions set department_id=${departmentId}::uuid,name=${name},percentage=${percentage},admin_only=${bool(body.adminOnly)},sort_order=${numberValue(body.sortOrder)},updated_at=now() where id=${id}::uuid returning *,id::text`:await sql<any[]>`insert into marketing.assignment_actions(department_id,name,percentage,admin_only,sort_order) values(${departmentId}::uuid,${name},${percentage},${bool(body.adminOnly)},${numberValue(body.sortOrder)}) returning *,id::text`;return{ok:true,row,message:"تم حفظ إجراء التكليف"};}
async function saveCreativeType(sql:ReturnType<typeof getSql>,body:any){const id=clean(body.id),name=clean(body.name),shortCode=safeCode(body.shortCode),departmentId=clean(body.primaryDepartmentId);if(!name||!shortCode||!departmentId)throw new Error("بيانات الكرييتيف غير مكتملة");const[row]=id?await sql<any[]>`update marketing.creative_types set name=${name},short_code=${shortCode},primary_department_id=${departmentId}::uuid,updated_at=now() where id=${id}::uuid returning *,id::text`:await sql<any[]>`insert into marketing.creative_types(name,short_code,primary_department_id) values(${name},${shortCode},${departmentId}::uuid) returning *,id::text`;return{ok:true,row,message:"تم حفظ الكرييتيف"};}
async function saveCampaignType(sql:ReturnType<typeof getSql>,body:any){const id=clean(body.id),name=clean(body.name),shortCode=safeCode(body.shortCode),prefix=safeCode(body.codePrefix);if(!name||!shortCode||!prefix)throw new Error("بيانات نوع الحملة غير مكتملة");const[row]=id?await sql<any[]>`update marketing.campaign_types set name=${name},short_code=${shortCode},code_prefix=${prefix},updated_at=now() where id=${id}::uuid returning *,id::text`:await sql<any[]>`insert into marketing.campaign_types(name,short_code,code_prefix) values(${name},${shortCode},${prefix}) returning *,id::text`;return{ok:true,row,message:"تم حفظ نوع الحملة"};}
async function savePlatform(sql:ReturnType<typeof getSql>,body:any){const id=clean(body.id),name=clean(body.name),code=safeCode(body.code||name).toLowerCase(),postTypes=arrayValue(body.postTypes);if(!name||!code)throw new Error("اسم المنصة مطلوب");return sql.begin(async(tx)=>{const[row]=id?await tx<any[]>`update marketing.platforms set name=${name},code=${code},updated_at=now() where id=${id}::uuid returning *,id::text`:await tx<any[]>`insert into marketing.platforms(name,code) values(${name},${code}) returning *,id::text`;await tx`update marketing.platform_post_types set is_active=false,updated_at=now() where platform_id=${row.id}::uuid`;for(const item of postTypes){const postName=clean(item.name);if(!postName)continue;await tx`insert into marketing.platform_post_types(platform_id,name,width,height,is_active) values(${row.id}::uuid,${postName},${numberValue(item.width)||null},${numberValue(item.height)||null},true) on conflict(platform_id,name) do update set width=excluded.width,height=excluded.height,is_active=true,updated_at=now()`;}return{ok:true,row,message:"تم حفظ المنصة وأنواع النشر"};});}
async function packageSettings(sql:ReturnType<typeof getSql>){
  const[categories,salesTypes]=await Promise.all([
    sql<any[]>`select id::text,name,sort_order from marketing.package_categories where is_active=true order by sort_order,name`,
    sql<any[]>`select id::text,name,sort_order from marketing.package_sales_types where is_active=true order by sort_order,name`,
  ]);
  return{ok:true,categories,salesTypes};
}

async function savePackageLookup(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  if(!hasPermission(user,"settings.marketing.manage"))throw new Error("لا توجد صلاحية لإدارة إعدادات الباقات");
  const lookupType=clean(body.lookupType),id=clean(body.id),name=clean(body.name),sortOrder=Math.trunc(numberValue(body.sortOrder));
  if(!name)throw new Error("اسم القيمة مطلوب");
  const config=lookupType==='category'
    ?{table:'marketing.package_categories',label:'التصنيف'}
    :lookupType==='sales_type'
      ?{table:'marketing.package_sales_types',label:'نوع المبيعات'}
      :null;
  if(!config)throw new Error("نوع الإعداد غير صحيح");
  const duplicate=await sql.unsafe<any[]>(`select id::text from ${config.table} where lower(btrim(name))=lower(btrim($1)) and ($2::text='' or id<>$2::uuid) limit 1`,[name,id]);
  if(duplicate.length)throw new Error(`${config.label} موجود بالفعل`);
  const rows=id
    ?await sql.unsafe<any[]>(`update ${config.table} set name=$1,sort_order=$2,is_active=true,updated_at=now() where id=$3::uuid returning id::text,name,sort_order`,[name,sortOrder,id])
    :await sql.unsafe<any[]>(`insert into ${config.table}(name,sort_order,created_by) values($1,$2,$3::uuid) returning id::text,name,sort_order`,[name,sortOrder,user.id]);
  return{ok:true,row:rows[0],message:`تم حفظ ${config.label}`};
}

async function savePackage(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const id=clean(body.id),name=clean(body.name),categoryId=clean(body.categoryId),salesTypeId=clean(body.salesTypeId);
  if(!name||!categoryId||!salesTypeId)throw new Error("اسم الباقة والتصنيف والمبيعات مطلوبة");
  const[[category],[salesType]]=await Promise.all([
    sql<any[]>`select id::text,name from marketing.package_categories where id=${categoryId}::uuid and is_active=true`,
    sql<any[]>`select id::text,name from marketing.package_sales_types where id=${salesTypeId}::uuid and is_active=true`,
  ]);
  if(!category)throw new Error("التصنيف المحدد غير موجود");
  if(!salesType)throw new Error("نوع المبيعات المحدد غير موجود");
  const features=arrayValue(body.careFeatures).map(clean).filter(Boolean);
  const[row]=id
    ?await sql<any[]>`update marketing.packages set name=${name},category=${category.name},category_id=${categoryId}::uuid,sales_type=${salesType.name},sales_type_id=${salesTypeId}::uuid,price=${numberValue(body.price)},cash_discount=${numberValue(body.cashDiscount)},registration_fees=${bool(body.registrationFees)},insurance=${bool(body.insurance)},issuance_fees=${bool(body.issuanceFees)},care_features=${sql.json(dbJson(features))},delivery_home=${bool(body.deliveryHome)},delivery_region=${bool(body.deliveryRegion)},updated_at=now() where id=${id}::uuid returning *,id::text,category_id::text,sales_type_id::text`
    :await sql<any[]>`insert into marketing.packages(name,category,category_id,sales_type,sales_type_id,price,cash_discount,registration_fees,insurance,issuance_fees,care_features,delivery_home,delivery_region,created_by) values(${name},${category.name},${categoryId}::uuid,${salesType.name},${salesTypeId}::uuid,${numberValue(body.price)},${numberValue(body.cashDiscount)},${bool(body.registrationFees)},${bool(body.insurance)},${bool(body.issuanceFees)},${sql.json(dbJson(features))},${bool(body.deliveryHome)},${bool(body.deliveryRegion)},${user.id}::uuid) returning *,id::text,category_id::text,sales_type_id::text`;
  return{ok:true,row,message:"تم حفظ الباقة"};
}
async function softDeleteSetting(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){const entity=clean(body.entity),id=clean(body.id);if((entity==='package_category'||entity==='package_sales_type')&&!hasPermission(user,"settings.marketing.manage"))throw new Error("لا توجد صلاحية لإدارة إعدادات الباقات");if(!id)throw new Error("بيانات الحذف غير صحيحة");if(entity==='package_category'){const[used]=await sql<any[]>`select count(*)::int as count from marketing.packages where is_active=true and category_id=${id}::uuid`;if(Number(used?.count||0)>0)throw new Error("لا يمكن حذف التصنيف لأنه مستخدم داخل باقات حالية");}if(entity==='package_sales_type'){const[used]=await sql<any[]>`select count(*)::int as count from marketing.packages where is_active=true and sales_type_id=${id}::uuid`;if(Number(used?.count||0)>0)throw new Error("لا يمكن حذف نوع المبيعات لأنه مستخدم داخل باقات حالية");}if(entity==='department'){await sql.begin(async tx=>{const users=await tx<any[]>`select user_id::text from core.user_system_departments where system_code='marketing' and department_id=${id}::uuid`;await tx`update marketing.departments set is_active=false,updated_at=now() where id=${id}::uuid`;await tx`update core.departments set is_active=false,updated_at=now() where id=${id}::uuid and system_code='marketing'`;await tx`delete from core.user_system_departments where system_code='marketing' and department_id=${id}::uuid`;for(const item of users){await tx`delete from core.user_departments where user_id=${item.user_id}::uuid and department_id=${id}::uuid and not exists(select 1 from core.user_system_departments where user_id=${item.user_id}::uuid and department_id=${id}::uuid)`;await tx`update core.users set permission_version=permission_version+1,updated_at=now() where id=${item.user_id}::uuid`;await tx`delete from core.sessions where user_id=${item.user_id}::uuid`;}});return{ok:true,message:"تم حذف القسم وإزالة عضويته من التسويق فقط"};}const allowed:Record<string,string>={action:"marketing.assignment_actions",creative_type:"marketing.creative_types",campaign_type:"marketing.campaign_types",platform:"marketing.platforms",package:"marketing.packages",package_category:"marketing.package_categories",package_sales_type:"marketing.package_sales_types"};const table=allowed[entity];if(!table)throw new Error("بيانات الحذف غير صحيحة");await sql.unsafe(`update ${table} set is_active=false,updated_at=now() where id=$1::uuid`,[id]);return{ok:true,message:"تم الحذف"};}

async function receiveTask(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){const id=clean(body.id);if(!hasPermission(user,"marketing.task.receive"))throw new Error("لا توجد صلاحية لاستلام التاسك");const[task]=await sql<any[]>`select *,id::text,source_id::text,assigned_to::text from marketing.tasks where id=${id}::uuid and is_deleted=false`;if(!task)throw new Error("التاسك غير موجود");if(!await canAccessMarketingTask(sql,user,id))throw new Error("لا توجد صلاحية لاستلام التاسك");await sql`update marketing.tasks set received_at=coalesce(received_at,now()),status=case when status='required' then 'received' else status end,updated_at=now() where id=${id}::uuid`;if(task.task_kind==='task_template')await sql`update marketing.task_templates set received_at=coalesce(received_at,now()),updated_at=now() where id=${task.task_template_id}::uuid`;await recalculateProgress(sql,task.source_type,task.source_id);return{ok:true,message:"تم الاستلام"};}
async function uploadTemplate(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const taskId=clean(body.taskId),fileId=clean(body.fileId),data=validateTemplateData(body.templateData);
  const task=await requireTaskTemplateUploadAccess(sql,user,taskId);
  const[file]=await sql<any[]>`select id::text,category,task_id::text,status,uploaded_by::text from marketing.files where id=${fileId}::uuid`;
  if(!file||file.category!=="task-template"||file.task_id!==taskId||file.status!=="ready")throw new Error("ملف Task Template غير صالح أو غير مرتبط بهذا التكليف");
  if(file.uploaded_by!==user.id&&!hasPermission(user,"marketing.file.view_others"))throw new Error("لا توجد صلاحية لاستخدام هذا الملف");
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
  const permission=action==='approve'||action==='unapprove'?'marketing.task_template.approve':'marketing.task_template.reject';
  if(!hasPermission(user,permission))throw new Error("لا توجد صلاحية لمراجعة Task Template");
  const[template]=await sql<any[]>`select *,id::text,source_id::text,file_id::text from marketing.task_templates where id=${templateId}::uuid`;
  if(!template)throw new Error("Task Template غير موجود");
  if(action==='unapprove'){
    if(template.status!=='approved')throw new Error("يمكن إلغاء اعتماد Task Template المعتمد فقط");
    if(!note)throw new Error("اكتب سبب إلغاء الاعتماد");
    await sql.begin(async tx=>{
      await tx`insert into marketing.task_review_history(task_template_id,action,note,before_data,after_data,actor_id,actor_name) values(${templateId}::uuid,'unapproved',${note},${tx.json(dbJson(template))},${tx.json({status:'not_started',fileId:null})},${user.id}::uuid,${user.fullName})`;
      await tx`update marketing.task_templates set status='not_started',progress=0,admin_note=${note},template_data='{}'::jsonb,approved_data='{}'::jsonb,file_id=null,reviewed_by=${user.id}::uuid,reviewed_at=now(),updated_at=now() where id=${templateId}::uuid`;
      await tx`update marketing.tasks set status='required',progress=0,completed_at=null,completed_by=null,final_file_id=null,approved_template_data='{}'::jsonb,updated_at=now() where task_template_id=${templateId}::uuid and is_deleted=false`;
      await tx`delete from marketing.task_action_progress where task_id in (select id from marketing.tasks where task_template_id=${templateId}::uuid and task_kind='execution' and is_deleted=false)`;
    });
    await recalculateProgress(sql,template.source_type,template.source_id);
    return{ok:true,message:"تم إلغاء اعتماد Task Template وإعادة التاسكات إلى انتظار الرفع"};
  }
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
    if(action==='approve')await tx`update marketing.tasks set approved_template_data=(select approved_data from marketing.task_templates where id=${templateId}::uuid),status=case when status='required' then 'required' else status end,updated_at=now() where task_template_id=${templateId}::uuid and task_kind='execution'`;
  });
  await recalculateProgress(sql,template.source_type,template.source_id);
  return{ok:true,message:action==='approve'?"تم اعتماد التعليمات":"تم حفظ إجراء المراجعة"};
}
async function toggleTaskAction(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const taskId=clean(body.taskId),actionId=clean(body.actionId),completed=bool(body.completed);
  const[record]=await sql<any[]>`select t.id::text,t.source_type,t.source_id::text,t.assigned_to::text,t.status as task_status,a.admin_only,tt.status as template_status from marketing.tasks t join marketing.assignment_actions a on a.id=${actionId}::uuid left join marketing.task_templates tt on tt.id=t.task_template_id where t.id=${taskId}::uuid and t.is_deleted=false`;
  if(!record)throw new Error("الإجراء أو التاسك غير موجود");
  if(record.task_status==='completed')throw new Error("التاسك منتهي ولا يمكن تعديل إجراءاته");
  if(record.template_status!=='approved')throw new Error("في انتظار اعتماد Task Template");
  const actionPermission=record.admin_only?"marketing.assignment_action.admin":"marketing.assignment_action.execute";
  if(!hasPermission(user,actionPermission))throw new Error(record.admin_only?"هذا الإجراء يحتاج صلاحية إجراء إداري":"لا توجد صلاحية لتنفيذ إجراء التكليف");
  if(!await canAccessMarketingTask(sql,user,taskId))throw new Error("لا توجد صلاحية لتنفيذ الإجراء");
  await sql`insert into marketing.task_action_progress(task_id,action_id,completed,completed_by,completed_at) values(${taskId}::uuid,${actionId}::uuid,${completed},${completed?sql`${user.id}::uuid`:null},${completed?sql`now()`:null}) on conflict(task_id,action_id) do update set completed=excluded.completed,completed_by=excluded.completed_by,completed_at=excluded.completed_at`;
  const[sum]=await sql<any[]>`select coalesce(sum(a.percentage) filter(where p.completed),0)::float as progress,count(a.id)::int as actions from marketing.assignment_actions a left join marketing.task_action_progress p on p.action_id=a.id and p.task_id=${taskId}::uuid where a.department_id=(select department_id from marketing.tasks where id=${taskId}::uuid) and a.is_active=true`;
  const progress=Math.min(100,numberValue(sum?.progress));
  await sql`update marketing.tasks set progress=${progress},status=case when ${progress}>=100 then 'ready_to_complete' when ${progress}>0 then 'in_progress' when received_at is not null then 'received' else 'required' end,completed_at=null,completed_by=null,updated_at=now() where id=${taskId}::uuid`;
  await recalculateProgress(sql,record.source_type,record.source_id);
  return{ok:true,progress,message:"تم تحديث إجراء التكليف"};
}
async function completeTask(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const taskId=clean(body.taskId);
  if(!taskId)throw new Error("رقم التاسك مطلوب");
  const[task]=await sql<any[]>`
    select t.id::text,t.source_type,t.source_id::text,t.task_kind,t.status,t.progress::float,t.received_at,
      t.assigned_to::text,t.paired_content_user_id::text
    from marketing.tasks t
    where t.id=${taskId}::uuid and t.is_deleted=false
  `;
  if(!task)throw new Error("التاسك غير موجود");
  if(task.task_kind!=='execution')throw new Error("إنهاء التاسك متاح للتاسكات التنفيذية فقط");
  if(!await canAccessMarketingTask(sql,user,taskId))throw new Error("لا توجد صلاحية لإنهاء التاسك");
  const assignedUser=task.assigned_to===user.id || task.paired_content_user_id===user.id;
  if(!assignedUser&&!canViewAllTasks(user))throw new Error("لا توجد صلاحية لإنهاء هذا التاسك");
  if(task.status==='completed')return{ok:true,message:"التاسك موجود بالفعل ضمن التاسكات المنتهية"};
  if(!task.received_at)throw new Error("يجب استلام التاسك أولًا");
  if(numberValue(task.progress)<100)throw new Error("لا يمكن إنهاء التاسك قبل وصول نسبة الإنجاز إلى 100%");
  await sql`update marketing.tasks set status='completed',completed_at=now(),completed_by=${user.id}::uuid,updated_at=now() where id=${taskId}::uuid`;
  await recalculateProgress(sql,task.source_type,task.source_id);
  return{ok:true,message:"تم إنهاء التاسك ونقله إلى قائمة التاسكات المنتهية"};
}

async function attachFinalFile(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const taskId=clean(body.taskId),fileId=clean(body.fileId);
  const task=await requireFinalFileUploadAccess(sql,user,taskId);
  const[file]=await sql<any[]>`select id::text,category,task_id::text,status,uploaded_by::text from marketing.files where id=${fileId}::uuid`;
  if(!file||file.category!=="final-file"||file.task_id!==taskId||file.status!=="ready")throw new Error("الملف النهائي غير صالح أو غير مرتبط بهذا التكليف");
  if(file.uploaded_by!==user.id&&!hasPermission(user,"marketing.file.view_others"))throw new Error("لا توجد صلاحية لاستخدام هذا الملف");
  await sql`update marketing.tasks set final_file_id=${fileId}::uuid,updated_at=now() where id=${taskId}::uuid`;
  const[count]=await sql<any[]>`select count(*)::int as count from marketing.assignment_actions where department_id=(select department_id from marketing.tasks where id=${taskId}::uuid) and is_active=true`;
  if(Number(count?.count||0)===0)await sql`update marketing.tasks set progress=100,status='ready_to_complete',completed_at=null,completed_by=null,updated_at=now() where id=${taskId}::uuid`;
  await recalculateProgress(sql,task.source_type,task.source_id);
  return{ok:true,message:"تم رفع الملف النهائي"};
}


async function prepareFinalUpload(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const taskId=clean(body.taskId);
  const task=await requireFinalFileUploadAccess(sql,user,taskId);
  const requested=arrayValue<any>(body.files).map((item,index)=>({
    name:clean(item?.name)||`file-${index+1}`,
    mimeType:clean(item?.mimeType)||"application/octet-stream",
    size:Math.max(0,numberValue(item?.size)),
    orderIndex:index,
  }));
  if(!requested.length)throw new Error("اختر الملف النهائي أولًا");
  if(requested.length>30)throw new Error("الحد الأقصى 30 صورة داخل مجموعة النشر الواحدة");
  const isVideo=(item:any)=>item.mimeType.startsWith('video/')||/\.(mp4|mov|m4v|webm)$/i.test(item.name);
  const isImage=(item:any)=>item.mimeType.startsWith('image/')||/\.(jpe?g|png|webp|gif|heic|heif)$/i.test(item.name);
  if(requested.some((item)=>!isVideo(item)&&!isImage(item)))throw new Error("الملف النهائي يجب أن يكون صورة أو فيديو");
  const videoCount=requested.filter(isVideo).length;
  if(videoCount&&requested.length!==1)throw new Error("الفيديو أو الريل يُرفع كملف واحد فقط. الصور يمكن رفعها ككاروسيل مرتب");
  if(requested.some((item)=>item.size<=0))throw new Error("يوجد ملف فارغ ضمن الاختيار");
  if(requested.some((item)=>item.size>50*1024*1024*1024))throw new Error("حجم الملف يتجاوز الحد المدعوم في Zoho WorkDrive");
  const mediaKind=videoCount?'video':requested.length>1?'carousel':'image';
  const runtime=await getZohoRuntime(sql);
  const uploads:any[]=[];
  await sql`delete from marketing.zoho_upload_tickets where expires_at<now()`;
  const group=await sql.begin(async tx=>{
    const[groupRow]=await tx<any[]>`
      insert into marketing.final_media_groups(task_id,media_kind,file_count,status,is_active,created_by)
      values(${taskId}::uuid,${mediaKind},${requested.length},'uploading',false,${user.id}::uuid)
      returning id::text
    `;
    for(const item of requested){
      const[file]=await tx<any[]>`
        insert into marketing.files(storage_key,original_name,mime_type,file_size,category,source_type,source_id,task_id,status,uploaded_by,storage_provider,final_media_group_id,order_index)
        values(${`zoho:${groupRow.id}:${globalThis.crypto.randomUUID()}`},${item.name},${item.mimeType},${item.size},'final-file',${task.source_type},${task.source_id}::uuid,${taskId}::uuid,'uploading',${user.id}::uuid,'zoho',${groupRow.id}::uuid,${item.orderIndex})
        returning id::text
      `;
      const ticket=createOpaqueTicket(),uploadId=`proxy-${globalThis.crypto.randomUUID()}`;
      const zohoFileName=zohoFinalFileName(item.name,task.source_type,task.source_id,taskId,groupRow.id,item.orderIndex);
      await tx`
        insert into marketing.zoho_upload_tickets(ticket_hash,file_id,final_media_group_id,task_id,file_name,mime_type,file_size,parent_folder_id,upload_id,status,expires_at,created_by)
        values(${ticketHash(ticket)},${file.id}::uuid,${groupRow.id}::uuid,${taskId}::uuid,${zohoFileName},${item.mimeType},${item.size},${runtime.rootFolderId},${uploadId},'prepared',now()+interval '2 hours',${user.id}::uuid)
      `;
      uploads.push({
        ticket,
        fileId:file.id,
        orderIndex:item.orderIndex,
        originalFileName:item.name,
        fileName:zohoFileName,
        mimeType:item.mimeType,
        fileSize:item.size,
      });
    }
    return groupRow;
  });
  return{ok:true,groupId:group.id,mediaKind,uploads};
}

function cleanUploadBase64(value:unknown){
  return clean(value).replace(/^data:[^;]+;base64,/,"").replace(/\s+/g,"");
}

async function uploadFinalFileProxy(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const ticket=clean(body.ticket);
  if(!ticket)throw new Error("بيانات رفع Zoho غير مكتملة");
  const[row]=await sql<any[]>`
    select z.*,z.file_id::text,z.final_media_group_id::text,z.task_id::text,z.created_by::text
    from marketing.zoho_upload_tickets z
    where z.ticket_hash=${ticketHash(ticket)} and z.expires_at>now() and z.status in ('prepared','uploading')
  `;
  if(!row)throw new Error("جلسة رفع الملف منتهية أو غير صالحة");
  await requireFinalFileUploadAccess(sql,user,row.task_id);
  if(row.created_by!==user.id&&!canViewAllTasks(user))throw new Error("جلسة الرفع لا تخص هذا المستخدم");

  const base64=cleanUploadBase64(body.fileData||body.base64);
  if(!base64)throw new Error("بيانات الملف المرفوع غير موجودة");
  let buffer:Buffer;
  try{buffer=Buffer.from(base64,'base64');}catch{throw new Error("تعذر قراءة بيانات الملف المرفوع");}
  if(!buffer.length)throw new Error("الملف المرفوع فارغ");
  const expectedSize=Number(row.file_size||0);
  if(expectedSize&&Math.abs(buffer.length-expectedSize)>Math.max(1024,Math.ceil(expectedSize*0.01)))throw new Error("حجم الملف المرفوع لا يطابق الملف المحدد");

  const runtime=await getZohoRuntime(sql);
  const uploadBytes=new Uint8Array(buffer.byteLength);
  uploadBytes.set(buffer);
  const blob=new Blob([uploadBytes],{type:clean(row.mime_type)||clean(body.mimeType)||'application/octet-stream'});
  const form=new FormData();
  form.append('filename',clean(row.file_name)||clean(body.fileName)||'file');
  form.append('override-name-exist','false');
  form.append('parent_id',clean(row.parent_folder_id)||runtime.rootFolderId);
  form.append('content',blob,clean(row.file_name)||clean(body.fileName)||'file');
  await sql`update marketing.zoho_upload_tickets set status='uploading' where ticket_hash=${ticketHash(ticket)}`;

  const response=await fetch(`${runtime.apiDomain}/workdrive/api/v1/upload`,{
    method:'POST',
    headers:{Authorization:`Zoho-oauthtoken ${runtime.accessToken}`,Accept:'application/vnd.api+json'},
    body:form,
  });
  const text=await response.text();
  let payload:any={};
  try{payload=text?JSON.parse(text):{};}catch{payload={raw:text};}
  if(!response.ok||payload?.errors){
    const first=Array.isArray(payload?.errors)?payload.errors[0]:payload?.error;
    const message=clean(first?.title||first?.detail||first||payload?.message)||`تعذر رفع الملف إلى Zoho (${response.status})`;
    await sql.begin(async tx=>{
      await tx`update marketing.zoho_upload_tickets set status='failed',completed_at=now() where ticket_hash=${ticketHash(ticket)}`;
      await tx`update marketing.files set status='failed',upload_error=${message},updated_at=now() where id=${row.file_id}::uuid`;
      await tx`update marketing.final_media_groups set status='failed',updated_at=now() where id=${row.final_media_group_id}::uuid`;
    });
    throw new Error(message);
  }

  const parsed=parseZohoUploadResult(payload);
  if(!parsed.resourceId)throw new Error("Zoho لم يرجع معرف الملف بعد اكتمال الرفع");
  let fileInfo:any={};
  try{fileInfo=await getZohoFileInfo(sql,parsed.resourceId);}catch{fileInfo={};}
  const externalUrl=clean(fileInfo.permalink||parsed.permalink)||null;
  const finalName=clean(fileInfo.fileName||parsed.fileName||row.file_name);
  await sql.begin(async tx=>{
    await tx`
      update marketing.files
      set status='ready',storage_provider='zoho',external_id=${parsed.resourceId},external_parent_id=${clean(fileInfo.parentId||parsed.parentId||row.parent_folder_id)},external_url=${externalUrl},original_name=${finalName||row.file_name},upload_error=null,updated_at=now()
      where id=${row.file_id}::uuid
    `;
    await tx`update marketing.zoho_upload_tickets set status='completed',completed_at=now() where ticket_hash=${ticketHash(ticket)}`;
    const[counts]=await tx<any[]>`
      select count(*)::int as total,count(*) filter(where status='ready')::int as ready
      from marketing.files where final_media_group_id=${row.final_media_group_id}::uuid
    `;
    if(Number(counts?.total||0)>0&&Number(counts?.total||0)===Number(counts?.ready||0))await tx`update marketing.final_media_groups set status='ready',updated_at=now() where id=${row.final_media_group_id}::uuid`;
  });
  return{ok:true,fileId:row.file_id,groupId:row.final_media_group_id,resourceId:parsed.resourceId,fileName:finalName};
}

async function cancelFinalUpload(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const groupId=clean(body.groupId);
  if(!groupId)throw new Error("مجموعة الرفع غير محددة");
  const[group]=await sql<any[]>`select id::text,task_id::text,created_by::text,status from marketing.final_media_groups where id=${groupId}::uuid`;
  if(!group)throw new Error("مجموعة الرفع غير موجودة");
  await requireFinalFileUploadAccess(sql,user,group.task_id);
  if(group.created_by!==user.id&&!canViewAllTasks(user))throw new Error("لا توجد صلاحية لإلغاء هذه العملية");
  await sql.begin(async tx=>{
    await tx`update marketing.zoho_upload_tickets set status='cancelled',completed_at=now() where final_media_group_id=${groupId}::uuid and status in ('prepared','uploading')`;
    await tx`update marketing.files set status='cancelled',upload_error='تم إلغاء الرفع بواسطة المستخدم',updated_at=now() where final_media_group_id=${groupId}::uuid and status='uploading'`;
    await tx`update marketing.final_media_groups set status='cancelled',is_active=false,updated_at=now() where id=${groupId}::uuid`;
  });
  return{ok:true,message:"تم إلغاء رفع الملف النهائي"};
}

async function attachFinalMediaGroup(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const taskId=clean(body.taskId),groupId=clean(body.groupId);
  const task=await requireFinalFileUploadAccess(sql,user,taskId);
  const[group]=await sql<any[]>`
    select g.*,g.id::text,g.task_id::text
    from marketing.final_media_groups g
    where g.id=${groupId}::uuid and g.task_id=${taskId}::uuid
  `;
  if(!group)throw new Error("مجموعة الملف النهائي غير موجودة");
  const files=await sql<any[]>`
    select id::text,original_name,mime_type,file_size,order_index,status,external_id
    from marketing.files
    where final_media_group_id=${groupId}::uuid
    order by order_index,created_at,id
  `;
  if(!files.length||files.some((file:any)=>file.status!=='ready'||!clean(file.external_id)))throw new Error("لم يكتمل رفع كل الملفات إلى Zoho WorkDrive");
  if(files.length!==Number(group.file_count||0))throw new Error("عدد الملفات المرفوعة لا يطابق مجموعة النشر");
  const firstFileId=clean(files[0]?.id);
  await sql.begin(async tx=>{
    await tx`update marketing.final_media_groups set is_active=false,updated_at=now() where task_id=${taskId}::uuid and id<>${groupId}::uuid`;
    await tx`update marketing.final_media_groups set is_active=true,status='ready',updated_at=now() where id=${groupId}::uuid`;
    await tx`update marketing.tasks set final_media_group_id=${groupId}::uuid,final_file_id=${firstFileId}::uuid,updated_at=now() where id=${taskId}::uuid`;
    const[count]=await tx<any[]>`select count(*)::int as count from marketing.assignment_actions where department_id=(select department_id from marketing.tasks where id=${taskId}::uuid) and is_active=true`;
    if(Number(count?.count||0)===0)await tx`update marketing.tasks set progress=100,status='ready_to_complete',completed_at=null,completed_by=null,updated_at=now() where id=${taskId}::uuid`;
  });
  await recalculateProgress(sql,task.source_type,task.source_id);
  return{ok:true,message:files.length>1?`تم رفع ${files.length} صور نهائية بالترتيب على Zoho WorkDrive`:`تم رفع الملف النهائي على Zoho WorkDrive`,groupId,files};
}

async function prepareUpload(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  if(!mediaStorageConfigured())throw new Error("تخزين الملفات R2 غير مضبوط في المنصة");
  const category=clean(body.category),sourceType=clean(body.sourceType),sourceId=clean(body.sourceId),taskId=clean(body.taskId),fileName=clean(body.fileName)||"file.bin",mimeType=clean(body.mimeType)||"application/octet-stream",fileSize=numberValue(body.fileSize)||null;
  if(!category)throw new Error("نوع الملف مطلوب");
  if(category==="task-template")await requireTaskTemplateUploadAccess(sql,user,taskId);
  else if(category==="final-file")await requireFinalFileUploadAccess(sql,user,taskId);
  else{
    if(!hasPermission(user,"marketing.file.upload"))throw new Error("لا توجد صلاحية لرفع الملفات");
    if(taskId&&!await canAccessMarketingTask(sql,user,taskId))throw new Error("التاسك خارج نطاق بياناتك");
    if(sourceId&&!taskId)await assertMarketingEntityAccess(sql,user,sourceType,sourceId);
  }
  const storageKey=buildMarketingStorageKey({category,sourceType,sourceId,taskId,fileName});
  const[file]=await sql<any[]>`insert into marketing.files(storage_key,original_name,mime_type,file_size,category,source_type,source_id,task_id,status,uploaded_by) values(${storageKey},${fileName},${mimeType},${fileSize},${category},${sourceType||null},${sourceId?sql`${sourceId}::uuid`:null},${taskId?sql`${taskId}::uuid`:null},'uploading',${user.id}::uuid) returning *,id::text`;
  return{ok:true,fileId:file.id,storageKey,uploadUrl:createUploadUrl(storageKey,900)};
}

async function markFileReady(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const fileId=clean(body.fileId);
  const[file]=await sql<any[]>`select id::text,category,task_id::text,source_type,source_id::text,status,uploaded_by::text from marketing.files where id=${fileId}::uuid`;
  if(!file)throw new Error("الملف غير موجود");
  if(file.uploaded_by!==user.id&&!hasPermission(user,"marketing.file.view_others"))throw new Error("لا توجد صلاحية لتحديث الملف");
  if(file.category==="task-template")await requireTaskTemplateUploadAccess(sql,user,file.task_id);
  else if(file.category==="final-file")await requireFinalFileUploadAccess(sql,user,file.task_id);
  else{
    if(!hasPermission(user,"marketing.file.upload"))throw new Error("لا توجد صلاحية لتحديث الملف");
    if(file.task_id&&!await canAccessMarketingTask(sql,user,file.task_id))throw new Error("التاسك خارج نطاق بياناتك");
    if(file.source_id&&!file.task_id)await assertMarketingEntityAccess(sql,user,clean(file.source_type),file.source_id);
  }
  const rows=await sql<any[]>`update marketing.files set status='ready',updated_at=now() where id=${fileId}::uuid and status='uploading' returning id::text`;
  if(!rows.length)throw new Error(file.status==="ready"?"تم حفظ الملف مسبقًا":"تعذر تحديث حالة الملف");
  return{ok:true,message:"تم حفظ الملف"};
}
async function fileDownload(sql:ReturnType<typeof getSql>,id:string,user:SessionUser){
  const[file]=await sql<any[]>`select *,id::text,source_id::text,task_id::text,uploaded_by::text from marketing.files where id=${id}::uuid and status='ready'`;
  if(!file)throw new Error("الملف غير موجود");
  if(!hasPermission(user,"marketing.file.view_others")){
    const allowed=file.task_id?await canAccessMarketingTask(sql,user,file.task_id):file.source_id?await canAccessMarketingEntity(sql,user,clean(file.source_type),file.source_id):file.uploaded_by===user.id;
    if(!allowed)throw new Error("الملف خارج نطاق بياناتك");
  }
  if(clean(file.storage_provider)==='zoho'){
    if(!clean(file.external_id))throw new Error("معرف ملف Zoho غير موجود");
    const info=await getZohoFileInfo(sql,clean(file.external_id));
    const url=clean(info.permalink||file.external_url||info.downloadUrl);
    if(!url)throw new Error("Zoho لم يرجع رابط فتح للملف");
    return{ok:true,url,file:{id:file.id,name:file.original_name,mimeType:file.mime_type,size:file.file_size,provider:'zoho'}};
  }
  if(!mediaStorageConfigured())throw new Error("تخزين الملفات R2 غير مضبوط");
  return{ok:true,url:createDownloadUrl(file.storage_key,900),file:{id:file.id,name:file.original_name,mimeType:file.mime_type,size:file.file_size,provider:'r2'}};
}

async function publishPrep(sql:ReturnType<typeof getSql>,user:SessionUser) {
  const access=marketingAccess(user),unrestricted=access.dataScope==='all',departmentScoped=['department','departments','branch_and_department'].includes(access.dataScope),departmentCodes=marketingDepartmentCodes(user),createdByMe=access.dataScope==='created_by_me';
  const rows=await sql<any[]>`
    select
      coalesce(schedule_row.group_id::text,t.id::text) as id,
      schedule_row.group_id::text,
      t.source_type,
      t.source_id::text,
      t.creative_id::text,
      t.id::text as task_id,
      t.task_kind,
      t.status as task_status,
      t.completed_at,
      schedule_row.publish_date,
      coalesce(
        nullif(schedule_row.caption,''),
        nullif(t.approved_template_data->>'caption',''),
        case when tt.status='approved' then nullif(tt.approved_data->>'caption','') end
      ) as caption,
      coalesce(
        nullif(schedule_row.hashtags,''),
        nullif(t.approved_template_data->>'hashtags',''),
        case when tt.status='approved' then nullif(tt.approved_data->>'hashtags','') end
      ) as hashtags,
      coalesce(aggregate_data.status,'waiting') as status,
      coalesce(aggregate_data.schedule_ids,array[]::text[]) as schedule_ids,
      aggregate_data.platform_name,
      aggregate_data.post_type_name,
      coalesce(error_data.publish_errors,'[]'::jsonb) as publish_errors,
      coalesce(platform_data.platforms,'[]'::jsonb) as platforms,
      c.name as creative_name,
      c.instance_code,
      coalesce(cam.name,ag.name) as source_name,
      t.progress::float,
      t.final_file_id::text,
      t.final_media_group_id::text,
      coalesce(fm.primary_name,f.original_name) as final_file_name,
      coalesce(fm.file_count,case when f.id is null then 0 else 1 end)::int as final_file_count,
      coalesce(fm.files,'[]'::jsonb) as final_files,
      t.department_id::text,
      d.name as department_name,
      u.full_name as assigned_name
    from marketing.tasks t
    join marketing.creatives c on c.id=t.creative_id
    left join marketing.campaigns cam on t.source_type='campaign' and cam.id=t.source_id
    left join marketing.agendas ag on t.source_type='agenda' and ag.id=t.source_id
    left join lateral (
      select ps.group_id,ps.publish_date,ps.caption,ps.hashtags,ps.created_at
      from marketing.publish_schedule ps
      where ps.task_id=t.id
      order by ps.updated_at desc,ps.created_at desc,ps.id desc
      limit 1
    ) schedule_row on true
    left join lateral (
      select
        array_agg(ps.id::text order by ps.created_at,ps.id) as schedule_ids,
        case when bool_and(ps.status='published') then 'published' when bool_or(ps.status='failed') then 'failed' else 'waiting' end as status,
        string_agg(distinct p.name,'، ') as platform_name,
        string_agg(distinct pt.name,'، ') as post_type_name
      from marketing.publish_schedule ps
      left join marketing.platforms p on p.id=ps.platform_id
      left join marketing.platform_post_types pt on pt.id=ps.post_type_id
      where schedule_row.group_id is not null and ps.group_id=schedule_row.group_id
    ) aggregate_data on true
    left join lateral (
      select jsonb_agg(jsonb_build_object('platformId',grouped.platform_id,'postTypeIds',grouped.post_type_ids) order by grouped.platform_name) as platforms
      from (
        select ps.platform_id::text as platform_id,max(p.name) as platform_name,jsonb_agg(ps.post_type_id::text order by pt.name) as post_type_ids
        from marketing.publish_schedule ps
        left join marketing.platforms p on p.id=ps.platform_id
        left join marketing.platform_post_types pt on pt.id=ps.post_type_id
        where schedule_row.group_id is not null and ps.group_id=schedule_row.group_id
        group by ps.platform_id
      ) grouped
    ) platform_data on true
    left join lateral (
      select coalesce(jsonb_agg(jsonb_build_object(
        'scheduleId',latest.schedule_id,
        'platformName',latest.platform_name,
        'postTypeName',latest.post_type_name,
        'error',latest.error
      ) order by latest.platform_name,latest.post_type_name),'[]'::jsonb) as publish_errors
      from (
        select distinct on (pl.schedule_id)
          pl.schedule_id::text as schedule_id,pl.status,pl.error,p.name as platform_name,pt.name as post_type_name,pl.created_at
        from marketing.publish_logs pl
        join marketing.publish_schedule eps on eps.id=pl.schedule_id
        left join marketing.platforms p on p.id=eps.platform_id
        left join marketing.platform_post_types pt on pt.id=eps.post_type_id
        where schedule_row.group_id is not null and eps.group_id=schedule_row.group_id
        order by pl.schedule_id,pl.created_at desc,pl.id desc
      ) latest
      where latest.status='failed' and nullif(latest.error,'') is not null
    ) error_data on true
    left join marketing.departments d on d.id=t.department_id
    left join core.users u on u.id=t.assigned_to
    left join marketing.task_templates tt on tt.id=t.task_template_id
    left join marketing.files f on f.id=t.final_file_id
    left join lateral (
      select count(*)::int as file_count,min(gf.original_name) filter(where gf.order_index=0) as primary_name,
        jsonb_agg(jsonb_build_object('id',gf.id::text,'name',gf.original_name,'mimeType',gf.mime_type,'size',gf.file_size,'orderIndex',gf.order_index) order by gf.order_index,gf.created_at) as files
      from marketing.files gf
      where t.final_media_group_id is not null and gf.final_media_group_id=t.final_media_group_id and gf.status='ready'
    ) fm on true
    where t.task_kind='execution'
      and t.is_deleted=false
      and (
        (t.source_type='campaign' and cam.id is not null and cam.is_deleted=false and cam.archived_at is null and cam.status in ('ready_publish','publishing'))
        or (t.source_type='agenda' and ag.id is not null and ag.archived_at is null and ag.status in ('ready_publish','publishing'))
      )
      and (
        ${unrestricted}=true
        or t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid
        or (${departmentScoped}=true and exists(select 1 from core.user_departments ud join core.departments cd on cd.id=ud.department_id where ud.user_id in(t.assigned_to,t.paired_content_user_id) and cd.code in ${sql(departmentCodes)}))
        or (${createdByMe}=true and (cam.created_by=${user.id}::uuid or ag.created_by=${user.id}::uuid))
      )
    order by coalesce(schedule_row.publish_date,t.due_at::date,cam.publish_start,ag.publish_start),t.created_at,t.id
  `;
  return{ok:true,rows};
}
async function savePublishPrep(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  if(!hasPermission(user,"marketing.publish_prep.manage"))throw new Error("لا توجد صلاحية لإدارة تجهيز النشر");
  const id=clean(body.id),requestedTaskId=clean(body.taskId),publishDate=isoDate(body.publishDate),platforms=arrayValue(body.platforms);
  const[current]=id?await sql<any[]>`select * from marketing.publish_schedule where group_id=${id}::uuid or id=${id}::uuid order by updated_at desc,created_at desc limit 1`:[];
  const taskId=requestedTaskId||clean(current?.task_id);
  if(!taskId)throw new Error("التاسك التنفيذي المرتبط غير موجود");
  const[executionTask]=await sql<any[]>`
    select t.id::text,t.source_type,t.source_id::text,t.creative_id::text
    from marketing.tasks t
    left join marketing.campaigns cam on t.source_type='campaign' and cam.id=t.source_id
    left join marketing.agendas ag on t.source_type='agenda' and ag.id=t.source_id
    where t.id=${taskId}::uuid and t.task_kind='execution' and t.is_deleted=false
      and (
        (t.source_type='campaign' and cam.id is not null and cam.is_deleted=false and cam.archived_at is null and cam.status in ('ready_publish','publishing'))
        or (t.source_type='agenda' and ag.id is not null and ag.archived_at is null and ag.status in ('ready_publish','publishing'))
      )
    limit 1
  `;
  if(!executionTask)throw new Error("التاسك التنفيذي المرتبط غير موجود في قسم النشر");
  await assertMarketingEntityAccess(sql,user,clean(executionTask.source_type),clean(executionTask.source_id));
  if(!publishDate)throw new Error("تاريخ النشر مطلوب");
  const normalizedPlatforms=platforms.map((platform:any)=>({
    platformId:clean(platform?.platformId),
    postTypeIds:[...new Set(arrayValue<string>(platform?.postTypeIds).map(clean).filter(Boolean))],
  })).filter((platform:any)=>platform.platformId);
  if(normalizedPlatforms.some((platform:any)=>!platform.postTypeIds.length))throw new Error("حدد نوع نشر لكل منصة مختارة");
  const combinations=normalizedPlatforms.flatMap((platform:any)=>platform.postTypeIds.map((postTypeId:string)=>({platformId:platform.platformId,postTypeId})));
  if(!combinations.length){const platformId=clean(body.platformId),postTypeId=clean(body.postTypeId);if(platformId&&postTypeId)combinations.push({platformId,postTypeId});}
  if(!combinations.length)throw new Error("اختر منصة ونوع نشر واحد على الأقل");
  const groupId=clean(current?.group_id)||clean((await sql<any[]>`select gen_random_uuid()::text as id`)[0]?.id);
  if(!groupId)throw new Error("تعذر إنشاء مجموعة تجهيز النشر");
  await sql.begin(async tx=>{
    await tx`delete from marketing.publish_schedule where group_id=${groupId}::uuid`;
    for(const item of combinations)await tx`insert into marketing.publish_schedule(group_id,source_type,source_id,creative_id,task_id,publish_date,platform_id,post_type_id,caption,hashtags,status) values(${groupId}::uuid,${executionTask.source_type},${executionTask.source_id}::uuid,${executionTask.creative_id}::uuid,${executionTask.id}::uuid,${publishDate},${item.platformId}::uuid,${item.postTypeId}::uuid,${clean(body.caption)||null},${clean(body.hashtags)||null},'waiting')`;
  });
  return{ok:true,message:"تم حفظ تجهيز النشر"};
}

async function graphRequest(path:string,method:"GET"|"POST",token:string,params:Record<string,any>={}){const version=clean(process.env.META_GRAPH_VERSION)||"v25.0";const url=new URL(`https://graph.facebook.com/${version}${path}`);const body=new URLSearchParams();for(const[key,value]of Object.entries(params)){if(value===undefined||value===null||value==='')continue;const text=typeof value==='object'?JSON.stringify(value):String(value);if(method==='GET')url.searchParams.set(key,text);else body.set(key,text);}if(method==='GET')url.searchParams.set('access_token',token);else body.set('access_token',token);const response=await fetch(url.toString(),{method,body:method==='POST'?body:undefined});const payload=await response.json().catch(()=>({}));if(!response.ok||payload.error)throw new Error(payload.error?.message||`Meta API error ${response.status}`);return payload;}
function looksVideo(file:any){return /video|mp4|mov|webm/i.test(`${file?.mime_type||''} ${file?.original_name||''}`);}
function normalizePostType(value:unknown){const text=clean(value).toLowerCase();if(text.includes('story')||text.includes('ستوري'))return'story';if(text.includes('reel')||text.includes('short')||text.includes('ريل'))return'reel';if(text.includes('photo')||text.includes('image')||text.includes('بوست صور')||text.includes('صورة'))return'photo_post';return text;}
async function uploadFacebookStoryVideo(uploadUrl:string,token:string,mediaUrl:string){const response=await fetch(uploadUrl,{method:'POST',headers:{Authorization:`OAuth ${token}`,file_url:mediaUrl}});const payload=await response.json().catch(()=>({}));if(!response.ok||(payload as any).error)throw new Error((payload as any).error?.message||`تعذر رفع فيديو Story على Facebook (${response.status})`);return payload;}
async function finalMediaFilesForSchedule(sql:ReturnType<typeof getSql>,schedule:any){
  if(clean(schedule.final_media_group_id)){
    const[group]=await sql<any[]>`select file_count,status from marketing.final_media_groups where id=${schedule.final_media_group_id}::uuid`;
    const files=await sql<any[]>`
      select * from marketing.files
      where final_media_group_id=${schedule.final_media_group_id}::uuid and status='ready'
      order by order_index,created_at,id
    `;
    if(!group||group.status!=='ready'||files.length!==Number(group.file_count||0))throw new Error("لم يكتمل رفع كل ملفات النشر إلى Zoho WorkDrive");
    if(files.length)return files;
  }
  if(!clean(schedule.final_file_id))return[];
  const[file]=await sql<any[]>`select * from marketing.files where id=${schedule.final_file_id}::uuid and status='ready'`;
  return file?[file]:[];
}
async function finalMediaDeliveryUrl(sql:ReturnType<typeof getSql>,file:any){
  if(clean(file.storage_provider)==='zoho'){
    if(!clean(file.external_id))throw new Error(`معرف ملف Zoho ${clean(file.original_name)||''} غير موجود`);
    const info=await getZohoFileInfo(sql,clean(file.external_id));
    const url=clean(info.downloadUrl||info.permalink||file.external_url);
    if(!url)throw new Error(`تعذر تجهيز رابط ملف Zoho ${clean(file.original_name)||''}`);
    return url;
  }
  if(!clean(file.storage_key))throw new Error(`مسار الملف النهائي ${clean(file.original_name)||''} غير موجود`);
  return createDownloadUrl(file.storage_key,7200);
}
async function publishScheduleItem(sql:ReturnType<typeof getSql>,schedule:any,user:SessionUser){
  if(!clean(schedule.publish_date))throw new Error("ميعاد النشر غير موجود");
  if(!clean(schedule.platform_code))throw new Error("منصة النشر غير محددة");
  if(!clean(schedule.post_type_name))throw new Error(`نوع النشر غير محدد لمنصة ${schedule.platform_name||schedule.platform_code}`);
  if(!clean(schedule.caption))throw new Error("الكابشن غير موجود");
  if(!clean(schedule.hashtags))throw new Error("الهاشتاج غير موجود");
  const[conn]=await sql<any[]>`select * from marketing.platform_connections where platform=${schedule.platform_code}`;
  if(!conn||!conn.connected)throw new Error(`منصة ${schedule.platform_name||schedule.platform_code} غير مربوطة`);
  const files=await finalMediaFilesForSchedule(sql,schedule);
  if(!files.length)throw new Error("الملف النهائي غير موجود");
  const videos=files.filter(looksVideo);
  if(videos.length>1||(videos.length&&files.length>1))throw new Error("الفيديو أو الريل يجب أن يكون ملفًا واحدًا فقط");
  const mediaUrls=[];
  for(const file of files)mediaUrls.push(await finalMediaDeliveryUrl(sql,file));
  const file=files[0],mediaUrl=mediaUrls[0],caption=[clean(schedule.caption),clean(schedule.hashtags)].filter(Boolean).join("\n\n"),postType=normalizePostType(schedule.post_type_name);
  const multipleImages=files.length>1;
  if(multipleImages&&(postType==='story'||postType==='reel'))throw new Error("نوع النشر المحدد لا يقبل مجموعة صور. اختر Carousel أو منشور صور");
  let result:any;
  if(schedule.platform_code==='facebook'){
    const pageId=clean(conn.page_id),token=decryptPlatformToken(conn.page_access_token_encrypted||conn.access_token_encrypted||conn.user_access_token_encrypted);
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
    else if(multipleImages){
      const uploads=[];
      for(const url of mediaUrls)uploads.push(await graphRequest(`/${pageId}/photos`,'POST',token,{url,published:false}));
      const mediaIds=uploads.map((item:any)=>clean(item.id||item.photo_id)).filter(Boolean);
      if(mediaIds.length!==mediaUrls.length)throw new Error("تعذر تجهيز كل صور المنشور على Facebook");
      const publish=await graphRequest(`/${pageId}/feed`,'POST',token,{message:caption,attached_media:mediaIds.map((media_fbid:string)=>({media_fbid}))});
      result={uploads,publish};
    }else result=await graphRequest(`/${pageId}/photos`,'POST',token,{url:mediaUrl,caption,published:true});
  }else if(schedule.platform_code==='instagram'){
    const igId=clean(conn.ig_user_id||conn.account_id),token=decryptPlatformToken(conn.page_access_token_encrypted||conn.access_token_encrypted||conn.user_access_token_encrypted);
    if(!igId||!token)throw new Error("بيانات Instagram غير مكتملة");
    if(multipleImages){
      const children=[];
      for(const url of mediaUrls){
        const child=await graphRequest(`/${igId}/media`,'POST',token,{image_url:url,is_carousel_item:true});
        const childId=clean(child.id||child.creation_id);
        if(!childId)throw new Error("تعذر تجهيز إحدى صور Carousel على Instagram");
        children.push(childId);
      }
      const container=await graphRequest(`/${igId}/media`,'POST',token,{media_type:'CAROUSEL',children:children.join(','),caption});
      const creationId=container.id||container.creation_id;
      if(!creationId)throw new Error("تعذر إنشاء Carousel على Instagram");
      const publish=await graphRequest(`/${igId}/media_publish`,'POST',token,{creation_id:creationId});
      result={children,create:container,publish};
    }else{
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
    }
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
      select s.*,s.id::text,p.code as platform_code,p.name as platform_name,pt.name as post_type_name,
        coalesce(direct_task.final_file_id,fallback_task.final_file_id)::text as final_file_id,
        coalesce(direct_task.final_media_group_id,fallback_task.final_media_group_id)::text as final_media_group_id
      from marketing.publish_schedule s
      join marketing.platforms p on p.id=s.platform_id
      left join marketing.platform_post_types pt on pt.id=s.post_type_id
      left join marketing.tasks direct_task on direct_task.id=s.task_id
      left join lateral(
        select x.final_file_id,x.final_media_group_id from marketing.tasks x
        where s.task_id is null and x.creative_id=s.creative_id and x.task_kind='execution' and (x.final_file_id is not null or x.final_media_group_id is not null) and x.is_deleted=false
        order by x.updated_at desc limit 1
      )fallback_task on true
      where s.id=${id}::uuid
    `;
    if(!schedule){results.push({id,ok:false,error:"تاسك النشر غير موجود",platformName:"منصة غير معروفة",postTypeName:""});continue;}
    try{
      await assertMarketingEntityAccess(sql,user,clean(schedule.source_type),clean(schedule.source_id));
      const result=await publishScheduleItem(sql,schedule,user);
      results.push({id,ok:true,result,platform:schedule.platform_code,platformName:schedule.platform_name,postTypeName:schedule.post_type_name});
    }catch(error:any){
      const errorMessage=clean(error?.message)||"تعذر تنفيذ النشر بدون تفاصيل إضافية";
      await sql.begin(async tx=>{
        await tx`update marketing.publish_schedule set status='failed',publish_result=${tx.json(dbJson({error:errorMessage,failedAt:new Date().toISOString()}))},updated_at=now() where id=${id}::uuid`;
        await tx`insert into marketing.publish_logs(schedule_id,platform,status,error,published_by) values(${id}::uuid,${schedule.platform_code||''},'failed',${errorMessage},${user.id}::uuid)`;
      });
      results.push({id,ok:false,error:errorMessage,platform:schedule.platform_code,platformName:schedule.platform_name,postTypeName:schedule.post_type_name});
    }
  }
  return{ok:true,results,message:"تم تنفيذ طلب النشر"};
}
async function saveResultFile(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){if(!hasPermission(user,"marketing.file.upload"))throw new Error("لا توجد صلاحية لرفع ملف النتائج");const sourceType=clean(body.sourceType),id=clean(body.id),fileId=clean(body.fileId);await assertMarketingEntityAccess(sql,user,sourceType,id);if(sourceType==='agenda')await sql`update marketing.agendas set result_file_id=${fileId}::uuid,updated_at=now() where id=${id}::uuid`;else await sql`update marketing.campaigns set result_file_id=${fileId}::uuid,updated_at=now() where id=${id}::uuid`;return{ok:true,message:"تم حفظ ملف النتائج"};}
async function saveLinks(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){const sourceType=clean(body.sourceType),permission=sourceType==='agenda'?"marketing.agenda.edit":"marketing.campaign.edit";if(!hasPermission(user,permission))throw new Error("لا توجد صلاحية لتعديل الروابط");const id=clean(body.id),links=arrayValue(body.links).filter((item:any)=>clean(item.platform)&&clean(item.url));await assertMarketingEntityAccess(sql,user,sourceType,id);if(sourceType==='agenda')await sql`update marketing.agendas set links=${sql.json(dbJson(links))},updated_at=now() where id=${id}::uuid`;else await sql`update marketing.campaigns set links=${sql.json(dbJson(links))},updated_at=now() where id=${id}::uuid`;return{ok:true,message:"تم حفظ روابط الحملة"};}
async function archiveEntity(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){if(!hasPermission(user,"marketing.campaign.archive"))throw new Error("لا توجد صلاحية لأرشفة الحملة");const sourceType=clean(body.sourceType),id=clean(body.id);await assertMarketingEntityAccess(sql,user,sourceType,id);const[entity]=sourceType==='agenda'?await sql<any[]>`select result_file_id::text,links from marketing.agendas where id=${id}::uuid`:await sql<any[]>`select result_file_id::text,links from marketing.campaigns where id=${id}::uuid`;if(!entity)throw new Error("السجل غير موجود");const missing=[];if(!entity.result_file_id)missing.push("ملف نتائج الحملة");if(!arrayValue(entity.links).length)missing.push("روابط الحملة");if(missing.length)throw new Error(`لا يمكن أرشفة الحملة. الناقص: ${missing.join(" + ")}`);if(sourceType==='agenda')await sql`update marketing.agendas set archived_at=now(),archived_by=${user.id}::uuid,status='archived',updated_at=now() where id=${id}::uuid`;else await sql`update marketing.campaigns set archived_at=now(),archived_by=${user.id}::uuid,status='archived',updated_at=now() where id=${id}::uuid`;return{ok:true,message:"تمت الأرشفة"};}
async function deleteEntity(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){const sourceType=clean(body.sourceType),id=clean(body.id);const permission=sourceType==='agenda'?'marketing.agenda.delete':'marketing.campaign.delete';if(!hasPermission(user,permission))throw new Error("لا توجد صلاحية لمسح السجل");await assertMarketingEntityAccess(sql,user,sourceType,id);if(sourceType==='agenda')await sql`delete from marketing.agendas where id=${id}::uuid`;else await sql`update marketing.campaigns set is_deleted=true,updated_at=now() where id=${id}::uuid`;return{ok:true,message:"تم المسح"};}

async function monitoring(sql:ReturnType<typeof getSql>,user:SessionUser){
  const access=marketingAccess(user),unrestricted=access.dataScope==='all',createdByMe=access.dataScope==='created_by_me',departmentScoped=['department','departments','branch_and_department'].includes(access.dataScope),departmentCodes=marketingDepartmentCodes(user);
  const liveSourceFilter=sql`(
    (t.source_type='campaign' and exists(
      select 1 from marketing.campaigns source_campaign
      where source_campaign.id=t.source_id and source_campaign.is_deleted=false and source_campaign.archived_at is null
    ))
    or
    (t.source_type='agenda' and exists(
      select 1 from marketing.agendas source_agenda
      where source_agenda.id=t.source_id and source_agenda.archived_at is null
    ))
  )`;
  const accessTaskFilter=unrestricted?sql`true`:sql`(t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid or (${departmentScoped}=true and exists(select 1 from core.user_departments ud join core.departments cd on cd.id=ud.department_id where ud.user_id in(t.assigned_to,t.paired_content_user_id) and cd.code in ${sql(departmentCodes)})) or (${createdByMe}=true and (exists(select 1 from marketing.campaigns c where t.source_type='campaign' and c.id=t.source_id and c.created_by=${user.id}::uuid) or exists(select 1 from marketing.agendas a where t.source_type='agenda' and a.id=t.source_id and a.created_by=${user.id}::uuid))))`;
  const taskFilter=sql`(${liveSourceFilter} and ${accessTaskFilter})`;
  const[totals,statuses,delayed,employees,departments,entities]=await Promise.all([
    sql<any[]>`with visible_tasks as(select t.* from marketing.tasks t where t.is_deleted=false and ${taskFilter}) select count(distinct source_id) filter(where source_type='campaign')::int as campaigns,count(distinct source_id) filter(where source_type='campaign' and status<>'archived')::int as active_campaigns,count(distinct source_id) filter(where source_type='agenda')::int as agendas,count(*)::int as tasks,count(*) filter(where due_at<now() and progress<100)::int as delayed,count(*) filter(where progress=0)::int as waiting,count(*) filter(where progress>0 and progress<100)::int as active,coalesce(avg(progress),0)::float as progress from visible_tasks`,
    sql<any[]>`select t.status,count(*)::int as count from marketing.tasks t where t.is_deleted=false and ${taskFilter} group by t.status order by count(*) desc`,
    sql<any[]>`select t.id::text,t.title,t.due_at,t.progress::float,u.full_name,d.name as department_name,coalesce(cam.name,ag.name) as source_name,greatest(0,current_date-t.due_at::date)::int as delay_days from marketing.tasks t left join core.users u on u.id=t.assigned_to left join marketing.departments d on d.id=t.department_id left join marketing.campaigns cam on t.source_type='campaign' and cam.id=t.source_id left join marketing.agendas ag on t.source_type='agenda' and ag.id=t.source_id where t.is_deleted=false and ${taskFilter} and t.due_at<now() and t.progress<100 order by t.due_at`,
    sql<any[]>`select u.id::text,u.full_name,count(t.id)::int as tasks,coalesce(avg(t.progress),0)::float as progress,count(*) filter(where t.due_at<now() and t.progress<100)::int as delayed,coalesce(sum(greatest(0,current_date-t.due_at::date)) filter(where t.due_at<now() and t.progress<100),0)::int as delay_days from core.users u join marketing.tasks t on t.assigned_to=u.id and t.is_deleted=false and ${taskFilter} group by u.id order by progress desc`,
    sql<any[]>`select d.id::text,d.name,count(t.id)::int as tasks,coalesce(avg(t.progress),0)::float as progress from marketing.departments d left join marketing.tasks t on t.department_id=d.id and t.is_deleted=false and ${taskFilter} where d.is_active=true group by d.id having count(t.id)>0 order by d.name`,
    sql<any[]>`select 'campaign' as source_type,c.id::text,c.name,c.progress::float,c.status from marketing.campaigns c where c.is_deleted=false and c.archived_at is null and (${unrestricted}=true or (${createdByMe}=true and c.created_by=${user.id}::uuid) or exists(select 1 from marketing.tasks t where t.source_type='campaign' and t.source_id=c.id and t.is_deleted=false and ${taskFilter})) union all select 'agenda',a.id::text,a.name,a.progress::float,a.status from marketing.agendas a where a.archived_at is null and (${unrestricted}=true or (${createdByMe}=true and a.created_by=${user.id}::uuid) or exists(select 1 from marketing.tasks t where t.source_type='agenda' and t.source_id=a.id and t.is_deleted=false and ${taskFilter})) order by progress desc`
  ]);
  return{ok:true,totals:totals[0]||{},statuses,delayed,employees,departments,entities};
}
async function calendarData(sql:ReturnType<typeof getSql>,user:SessionUser){
  const access=marketingAccess(user),unrestricted=access.dataScope==='all',createdByMe=access.dataScope==='created_by_me',departmentScoped=['department','departments','branch_and_department'].includes(access.dataScope),departmentCodes=marketingDepartmentCodes(user);
  const rows=await sql<any[]>`
    select
      min(s.id::text) as id,
      s.publish_date,
      max(s.status) as status,
      t.source_type,
      p.name as platform_name,
      string_agg(distinct pt.name,'، ' order by pt.name) as post_type_name,
      c.name as creative_name,
      c.instance_code,
      coalesce(cam.name,ag.name) as source_name,
      t.id::text as task_id,
      t.title as task_title,
      u.full_name as assigned_name,
      coalesce(uc.color,'#6c3329') as user_color
    from marketing.publish_schedule s
    join marketing.tasks t on t.id=s.task_id and t.task_kind='execution' and t.is_deleted=false
    left join marketing.platforms p on p.id=s.platform_id
    left join marketing.platform_post_types pt on pt.id=s.post_type_id
    left join marketing.creatives c on c.id=s.creative_id
    left join marketing.campaigns cam on t.source_type='campaign' and cam.id=t.source_id
    left join marketing.agendas ag on t.source_type='agenda' and ag.id=t.source_id
    left join core.users u on u.id=t.assigned_to
    left join marketing.user_colors uc on uc.user_id=u.id
    where (
      (t.source_type='campaign' and cam.id is not null and cam.is_deleted=false and cam.archived_at is null)
      or (t.source_type='agenda' and ag.id is not null and ag.archived_at is null)
    ) and (
      ${unrestricted}=true
      or t.assigned_to=${user.id}::uuid
      or t.paired_content_user_id=${user.id}::uuid
      or (${departmentScoped}=true and exists(
        select 1 from core.user_departments ud
        join core.departments cd on cd.id=ud.department_id
        where ud.user_id in(t.assigned_to,t.paired_content_user_id) and cd.code in ${sql(departmentCodes)}
      ))
      or (${createdByMe}=true and (cam.created_by=${user.id}::uuid or ag.created_by=${user.id}::uuid))
    )
    group by s.publish_date,t.source_type,p.name,c.name,c.instance_code,cam.name,ag.name,t.id,t.title,u.full_name,uc.color
    order by s.publish_date,coalesce(cam.name,ag.name),t.title,p.name
  `;
  return{ok:true,rows};
}
async function receiptCalendar(sql:ReturnType<typeof getSql>,user:SessionUser){
  const access=marketingAccess(user),unrestricted=access.dataScope==='all',createdByMe=access.dataScope==='created_by_me',departmentScoped=['department','departments','branch_and_department'].includes(access.dataScope),departmentCodes=marketingDepartmentCodes(user);
  const rows=await sql<any[]>`
    select
      t.id::text,
      t.received_at,
      t.source_type,
      t.task_kind,
      t.title,
      coalesce(cam.name,ag.name) as source_name,
      c.name as creative_name,
      c.instance_code,
      u.full_name,
      d.name as department_name,
      coalesce(uc.color,'#6c3329') as user_color
    from marketing.tasks t
    left join marketing.campaigns cam on t.source_type='campaign' and cam.id=t.source_id
    left join marketing.agendas ag on t.source_type='agenda' and ag.id=t.source_id
    left join marketing.creatives c on c.id=t.creative_id
    left join core.users u on u.id=t.assigned_to
    left join marketing.departments d on d.id=t.department_id
    left join marketing.user_colors uc on uc.user_id=u.id
    where t.received_at is not null and t.is_deleted=false and t.task_kind='execution'
      and (
        (t.source_type='campaign' and cam.id is not null and cam.is_deleted=false and cam.archived_at is null)
        or (t.source_type='agenda' and ag.id is not null and ag.archived_at is null)
      )
      and (
      ${unrestricted}=true
      or t.assigned_to=${user.id}::uuid
      or t.paired_content_user_id=${user.id}::uuid
      or (${departmentScoped}=true and exists(
        select 1 from core.user_departments ud
        join core.departments cd on cd.id=ud.department_id
        where ud.user_id in(t.assigned_to,t.paired_content_user_id) and cd.code in ${sql(departmentCodes)}
      ))
      or (${createdByMe}=true and (cam.created_by=${user.id}::uuid or ag.created_by=${user.id}::uuid))
    )
    order by t.received_at
  `;
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
    join core.user_system_departments du on du.user_id=u.id and du.system_code='marketing'
    join marketing.departments d on d.id=du.department_id and d.is_active=true
    left join marketing.attendance_records r on r.user_id=u.id and r.attendance_date=(now() at time zone 'Asia/Riyadh')::date
    left join marketing.presence_status p on p.user_id=u.id
    where u.is_active=true and (${hasPermission(user,"marketing.attendance.manage")} or u.id=${user.id}::uuid)
    group by u.id,u.full_name,r.check_in,r.check_out,r.delay_minutes,r.work_minutes,r.status
    order by u.full_name`;
  const reportUsers=await sql<any[]>`
    select u.id::text,u.full_name,u.email,string_agg(distinct d.name,'، ' order by d.name) as department_name
    from core.users u
    join core.user_system_departments du on du.user_id=u.id and du.system_code='marketing'
    join marketing.departments d on d.id=du.department_id and d.is_active=true
    where u.is_active=true
      and (${departmentId}='' or exists(select 1 from core.user_system_departments fdu where fdu.user_id=u.id and fdu.system_code='marketing' and fdu.department_id=${departmentId||null}::uuid))
      and (${userId}='' or u.id=${userId||null}::uuid)
    group by u.id,u.full_name,u.email
    order by u.full_name`;
  const rawRows=await sql<any[]>`
    select r.*,r.id::text,r.user_id::text,r.attendance_date::text as attendance_date,u.full_name,
      string_agg(distinct d.name,'، ' order by d.name) as department_name
    from marketing.attendance_records r
    join core.users u on u.id=r.user_id
    left join core.user_system_departments du on du.user_id=u.id and du.system_code='marketing'
    left join marketing.departments d on d.id=du.department_id
    where r.attendance_date between ${from}::date and ${to}::date
      and (${departmentId}='' or exists(select 1 from core.user_system_departments fdu where fdu.user_id=u.id and fdu.system_code='marketing' and fdu.department_id=${departmentId||null}::uuid))
      and (${userId}='' or u.id=${userId||null}::uuid)
    group by r.id,u.id,u.full_name
    order by r.attendance_date desc,u.full_name`;
  const [effective]=await sql<any[]>`
    select min(r.attendance_date)::text as effective_from
    from marketing.attendance_records r
    where r.attendance_date between ${from}::date and ${to}::date
      and exists(select 1 from core.user_system_departments du where du.user_id=r.user_id and du.system_code='marketing')`;
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



async function userColors(sql:ReturnType<typeof getSql>){const rows=await sql<any[]>`select u.id::text,u.full_name,u.email,coalesce(c.color,'#6c3329') as color from core.users u left join marketing.user_colors c on c.user_id=u.id where u.is_active=true and coalesce(u.disabled_reason,'') not like 'ACCOUNT_DELETED:%' and exists(select 1 from core.user_system_departments du where du.user_id=u.id and du.system_code='marketing') order by u.full_name`;return{ok:true,rows};}
async function saveUserColors(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){if(!hasPermission(user,"settings.marketing.manage"))throw new Error("لا توجد صلاحية لإدارة ألوان المستخدمين");for(const item of arrayValue(body.colors)){const userId=clean(item.userId),color=clean(item.color);if(!userId||!/^#[0-9a-fA-F]{6}$/.test(color))continue;await sql`insert into marketing.user_colors(user_id,color,updated_by,updated_at) values(${userId}::uuid,${color},${user.id}::uuid,now()) on conflict(user_id) do update set color=excluded.color,updated_by=excluded.updated_by,updated_at=now()`;}return{ok:true,message:"تم حفظ ألوان المسؤولين"};}

function rawApiToken(){
  const configured=clean(process.env.MZJ_RAW_API_TOKEN||process.env.MZJ_RAW_SECRET||process.env.RAW_API_TOKEN);
  if(configured)return configured;
  if(clean(process.env.MZJ_RAW_ALLOW_LEGACY_TOKEN).toLowerCase()==='false')return'';
  return'MZJ_RAW_SECRET_2026_CHANGE_ME';
}
async function createRawFolders(body:any){
  const url=clean(process.env.MZJ_RAW_API_URL)||'http://152.239.121.92:8080/api/create-raw-folders';
  const token=rawApiToken();
  if(!token)throw new Error("بيانات ربط سيرفر فولدرات الخام غير مكتملة");
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-api-token':token,authorization:`Bearer ${token}`},body:JSON.stringify(body.payload||body),signal:controller.signal});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||payload.ok===false)throw new Error(payload.message||payload.error||`تعذر إنشاء فولدرات الخام (${response.status})`);
    return payload;
  }catch(error:any){
    if(error?.name==='AbortError')throw new Error("انتهت مهلة الاتصال بسيرفر فولدرات الخام");
    throw error;
  }finally{clearTimeout(timeout);}
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  try {
    await ensureAccessControlSchema(); await ensureOperationsSchema(); await ensureMarketingSchema();
    const user = await requireUser(request,response); if(!user)return;
    if(!canUseMarketing(user))return response.status(403).json({ok:false,error:"لا توجد صلاحية لدخول سيستم التسويق"});
    const sql=getSql(); const resource=clean(request.query.resource)||"dashboard";
    if(request.method==='GET'){
      if(resource==='meta')return response.status(200).json({...await marketingMeta(sql,user),cars:(hasPermission(user,'marketing.campaign.create')||hasPermission(user,'marketing.agenda.create'))?await loadOperationsCars(sql):[]});
      if(resource==='dashboard')return response.status(200).json(await dashboard(sql,user));
      if(resource==='dashboard_version')return response.status(200).json({ok:true,version:await dashboardVersion(sql)});
      if(resource==='database')return response.status(200).json(await databaseRows(sql,user));
      if(resource==='entity')return response.status(200).json(await entityDetail(sql,clean(request.query.sourceType),clean(request.query.id),user));
      if(resource==='task')return response.status(200).json(await taskDetail(sql,clean(request.query.id),user));
      if(resource==='packages')return response.status(200).json({ok:true,rows:await sql<any[]>`select p.*,p.id::text,p.category_id::text,p.sales_type_id::text,coalesce(c.name,p.category) as category_name,coalesce(s.name,p.sales_type,'—') as sales_type_name from marketing.packages p left join marketing.package_categories c on c.id=p.category_id left join marketing.package_sales_types s on s.id=p.sales_type_id where p.is_active=true order by coalesce(c.sort_order,999),coalesce(s.sort_order,999),p.name`});
      if(resource==='package_settings')return response.status(200).json(await packageSettings(sql));
      if(resource==='publish_prep')return response.status(200).json(await publishPrep(sql,user));
      if(resource==='monitoring')return response.status(200).json(await monitoring(sql,user));
      if(resource==='calendar')return response.status(200).json(await calendarData(sql,user));
      if(resource==='receipt_calendar')return response.status(200).json(await receiptCalendar(sql,user));
      if(resource==='attendance')return response.status(200).json(await attendanceData(sql,user,request));
      if(resource==='stock')return response.status(200).json(await stockData(sql,user));
      if(resource==='user_colors')return response.status(200).json(await userColors(sql));
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
    else if(action==='delete_setting')result=await softDeleteSetting(sql,body,user);
    else if(action==='save_package')result=await savePackage(sql,body,user);
    else if(action==='save_package_lookup')result=await savePackageLookup(sql,body,user);
    else if(action==='receive_task')result=await receiveTask(sql,body,user);
    else if(action==='upload_template')result=await uploadTemplate(sql,body,user);
    else if(action==='review_template')result=await reviewTemplate(sql,body,user);
    else if(action==='toggle_task_action')result=await toggleTaskAction(sql,body,user);
    else if(action==='complete_task')result=await completeTask(sql,body,user);
    else if(action==='move_to_publishing')result=await moveEntityToPublishing(sql,body,user);
    else if(action==='attach_final_file')result=await attachFinalFile(sql,body,user);
    else if(action==='prepare_final_upload')result=await prepareFinalUpload(sql,body,user);
    else if(action==='upload_final_file_proxy')result=await uploadFinalFileProxy(sql,body,user);
    else if(action==='cancel_final_upload')result=await cancelFinalUpload(sql,body,user);
    else if(action==='attach_final_media_group')result=await attachFinalMediaGroup(sql,body,user);
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
    else if(action==='create_raw_folders')result=await createRawFolders(body);
    else throw new Error("الإجراء غير مدعوم");
    await audit(sql,user,action,'marketing',clean(result?.id||body.id)||null,result,undefined,requestIp(request)).catch(()=>undefined);
    await emitMarketingNotification(user, action, body, result).catch((error) => console.error("Marketing notification failed", error));
    return response.status(200).json(result);
  } catch(error:any){console.error('Marketing API failed',error);const message=clean(error?.message)||"تعذر تنفيذ العملية";const status=/صلاحية|مدير النظام/.test(message)?403:/غير موجود/.test(message)?404:400;return response.status(status).json({ok:false,error:message});}
}
