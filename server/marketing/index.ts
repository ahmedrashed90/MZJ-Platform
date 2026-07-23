import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { getSql, type SqlExecutor } from "../_db.js";
import { requireUser, type SessionUser } from "../_auth.js";
import { ensureMarketingSchema } from "../_marketing-schema.js";
import { toDatabaseJson } from "../_database-json.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { createDownloadUrl, createUploadUrl, mediaStorageConfigured } from "../_media-storage.js";

function clean(value: unknown) { return String(value ?? "").trim(); }
function textOrNull(value: unknown) { const valueText = clean(value); return valueText || null; }
function bool(value: unknown) { return value === true || value === "true" || value === 1 || value === "1"; }
function numberValue(value: unknown, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function stringList(value: unknown) { return list(value).map(clean).filter(Boolean); }
function objectValue(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function parseBody(request: VercelRequest): Record<string, unknown> {
  if (request.body && typeof request.body === "object" && !Array.isArray(request.body)) return request.body as Record<string, unknown>;
  if (typeof request.body === "string") { try { return objectValue(JSON.parse(request.body)); } catch { return {}; } }
  return {};
}
function isAdmin(user: SessionUser) { return user.roleCodes.some((code) => ["admin", "system_admin"].includes(code)); }
function can(user: SessionUser, permission: string) { return isAdmin(user) || user.permissions.includes(permission); }
function requirePermission(user: SessionUser, response: VercelResponse, permission: string, message = "لا توجد لديك صلاحية لتنفيذ هذا الإجراء") {
  if (can(user, permission)) return true;
  response.status(403).json({ ok: false, error: message });
  return false;
}
function requireAnyPermission(user: SessionUser, response: VercelResponse, permissions: string[], message = "لا توجد لديك صلاحية لعرض هذه الصفحة") {
  if (permissions.some((permission) => can(user, permission))) return true;
  response.status(403).json({ ok: false, error: message });
  return false;
}
function safeSegment(value: unknown, fallback: string) {
  return clean(value).normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || fallback;
}
function marketingStorageKey(scope: string, entityId: string, fileName: string) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `marketing/${safeSegment(scope, "files")}/${yyyy}/${mm}/${safeSegment(entityId, "entity")}/${crypto.randomUUID()}-${safeSegment(fileName, "file.bin")}`;
}
function projectScope(sql: ReturnType<typeof getSql>, user: SessionUser, alias = "c") {
  if (isAdmin(user) || can(user, "marketing.project.edit") || can(user, "marketing.reports.view")) return sql`true`;
  return sql`(
    ${sql.unsafe(alias)}.created_by=${user.id}::uuid
    or exists(select 1 from marketing.tasks st where st.campaign_id=${sql.unsafe(alias)}.id and (st.assigned_to=${user.id}::uuid or st.content_writer_id=${user.id}::uuid))
  )`;
}
function userPermissions(user: SessionUser) {
  const names = [
    "marketing.view","marketing.project.create","marketing.project.edit","marketing.project.archive","marketing.project.delete",
    "marketing.task.receive","marketing.task.execute","marketing.template.upload","marketing.template.review",
    "marketing.publish.manage","marketing.package.manage","marketing.stock.view","marketing.photo_request.create",
    "marketing.photo_request.manage","marketing.reports.view","marketing.attendance.use","marketing.attendance.manage",
    "marketing.connections.manage","marketing.settings.manage",
  ];
  return Object.fromEntries(names.map((name) => [name, can(user, name)]));
}

async function loadMeta(sql: ReturnType<typeof getSql>, user: SessionUser) {
  const [departments, departmentUsers, actions, creativeTypes, campaignTypes, platforms, postTypes, categories, requestStatuses, users, attendanceSettings] = await Promise.all([
    sql`select id::text,code,name,is_content_department,is_active,sort_order from marketing.departments order by sort_order,name`,
    sql`select du.department_id::text,du.user_id::text,u.full_name,u.email,du.is_active from marketing.department_users du join core.users u on u.id=du.user_id where u.is_active=true order by u.full_name`,
    sql`select a.id::text,a.department_id::text,d.code as department_code,d.name as department_name,a.name,a.percentage::float,a.audience,a.is_required,a.is_active,a.sort_order from marketing.assignment_actions a join marketing.departments d on d.id=a.department_id order by d.sort_order,a.sort_order,a.name`,
    sql`select ct.id::text,ct.name,ct.short_code,ct.primary_department_id::text,d.code as primary_department_code,d.name as primary_department_name,ct.is_active,ct.sort_order from marketing.creative_types ct left join marketing.departments d on d.id=ct.primary_department_id order by ct.sort_order,ct.name`,
    sql`select id::text,name,short_code,code_prefix,is_active,sort_order,next_number::text from marketing.campaign_types order by sort_order,name`,
    sql`select id::text,code,name,is_active,sort_order from marketing.platforms order by sort_order,name`,
    sql`select pt.id::text,pt.platform_id::text,p.code as platform_code,p.name as platform_name,pt.name,pt.code,pt.dimensions,pt.is_active,pt.sort_order from marketing.platform_post_types pt join marketing.platforms p on p.id=pt.platform_id order by p.sort_order,pt.sort_order,pt.name`,
    sql`select id::text,name,is_active,sort_order from marketing.package_categories order by sort_order,name`,
    sql`select id::text,code,name,is_terminal,is_active,sort_order from marketing.request_statuses order by sort_order,name`,
    sql`select u.id::text,u.full_name,u.email,u.employee_no,u.can_receive_tasks,coalesce(array_agg(distinct d.code) filter(where d.id is not null),'{}') as department_codes from core.users u left join core.user_departments ud on ud.user_id=u.id left join core.departments d on d.id=ud.department_id where u.is_active=true group by u.id order by u.full_name`,
    sql`select work_start_time::text,work_end_time::text,grace_minutes,idle_after_minutes,offline_after_minutes,updated_at from marketing.attendance_settings where id='default'`,
  ]);
  return { ok: true, departments, departmentUsers, actions, creativeTypes, campaignTypes, platforms, postTypes, categories, requestStatuses, users, attendanceSettings: attendanceSettings[0] || null, permissions: userPermissions(user), currentUser: { id: user.id, fullName: user.fullName, roleCodes: user.roleCodes, departmentCodes: user.departmentCodes } };
}

async function dashboard(sql: ReturnType<typeof getSql>, user: SessionUser) {
  const scope = projectScope(sql, user, "c");
  const showAdminActions = isAdmin(user) || can(user, "marketing.settings.manage") || can(user, "marketing.project.edit") || can(user, "marketing.template.review");
  const taskScope = isAdmin(user) || can(user, "marketing.template.review") || can(user, "marketing.project.edit")
    ? sql`true`
    : sql`(t.assigned_to=${user.id}::uuid or t.content_writer_id=${user.id}::uuid)`;
  const [counts] = await sql`
    select
      count(*) filter(where c.is_deleted=false and c.archived_at is null)::int as projects,
      count(*) filter(where c.source_kind='campaign' and c.is_deleted=false and c.archived_at is null)::int as campaigns,
      count(*) filter(where c.source_kind='agenda' and c.is_deleted=false and c.archived_at is null)::int as agendas,
      count(*) filter(where c.stage='publishing' and c.is_deleted=false and c.archived_at is null)::int as publishing
    from marketing.campaigns c where ${scope}
  `;
  const taskRows = await sql`
    select t.id::text,t.task_no,t.task_kind,t.status,t.review_status,t.review_note,t.template_data,t.final_file_name,t.final_file_url,t.progress::float,t.due_at,t.received_at,t.completed_at,
      t.assigned_to::text,t.content_writer_id::text,t.template_task_id::text,t.department_id::text,t.department_code,
      au.full_name as assigned_name,cw.full_name as content_writer_name,d.name as department_name,
      c.id::text as campaign_id,c.name as project_name,c.campaign_code,c.source_kind,c.campaign_type,c.starts_on as project_starts_on,c.ends_on as project_ends_on,c.objective as project_objective,c.content_brief as project_content_brief,c.stage as project_stage,
      cr.id::text as creative_id,cr.instance_no,cr.creative_type,cr.short_code,cr.agenda_day,cr.content_due_at,cr.content_notes,cr.admin_notes,
      (select ia.notes from marketing.instance_assignments ia where ia.creative_id=t.creative_id and ia.department_id=t.department_id and ia.assigned_user_id=t.assigned_to and ia.content_writer_id=t.content_writer_id limit 1) as assignment_notes,
      coalesce((select json_agg(json_build_object('id',v.id::text,'vin',v.vin,'car_name',v.car_name,'statement',v.statement,'exterior_color',v.exterior_color,'interior_color',v.interior_color,'model_year',v.model_year,'location_name',l.name) order by v.vin) from marketing.instance_vehicles iv join operations.vehicles v on v.id=iv.vehicle_id left join operations.locations l on l.id=v.location_id where iv.creative_id=t.creative_id),'[]') as vehicles,
      coalesce((select json_agg(json_build_object('id',a.id::text,'name',a.name,'percentage',a.percentage::float,'completed',coalesce(ap.completed,false),'completed_at',ap.completed_at,'note',ap.note) order by a.sort_order)
        from marketing.assignment_actions a left join marketing.task_action_progress ap on ap.action_id=a.id and ap.task_id=t.id
        where a.department_id=t.department_id and a.is_active=true and (${showAdminActions}=true or a.audience in ('user','both'))),'[]') as actions,
      coalesce((select json_agg(json_build_object('id',u.id::text,'upload_kind',u.upload_kind,'file_name',u.file_name,'external_url',u.external_url,'version_no',u.version_no,'created_at',u.created_at) order by u.created_at desc) from marketing.task_uploads u where u.task_id=t.id),'[]') as uploads
    from marketing.tasks t
    join marketing.campaigns c on c.id=t.campaign_id
    left join marketing.creatives cr on cr.id=t.creative_id
    left join marketing.departments d on d.id=t.department_id
    left join core.users au on au.id=t.assigned_to
    left join core.users cw on cw.id=t.content_writer_id
    where c.is_deleted=false and c.archived_at is null and ${scope} and ${taskScope}
    order by case when t.status in ('required','waiting_template','revision_requested') then 0 when t.status in ('active','review') then 1 else 2 end,t.due_at nulls last,t.created_at
  `;
  const projects = await sql`
    select c.id::text,c.name,c.campaign_code,c.source_kind,c.status,c.stage,c.starts_on,c.ends_on,c.moved_to_publish_at,c.created_at,
      count(distinct t.id)::int as task_count,
      count(distinct t.department_id)::int as department_count,
      coalesce(round(avg(t.progress),2),0)::float as raw_task_progress,
      coalesce((select round(avg(dept_progress),2) from (
        select avg(tx.progress)::numeric as dept_progress from marketing.tasks tx where tx.campaign_id=c.id and tx.task_kind='execution' group by tx.department_id
      ) q),case when count(t.id)=0 then 0 else round(avg(t.progress),2) end,0)::float as progress
    from marketing.campaigns c left join marketing.tasks t on t.campaign_id=c.id
    where c.is_deleted=false and c.archived_at is null and ${scope}
    group by c.id order by c.created_at desc
  `;
  const pendingReviews = taskRows.filter((row) => row.task_kind === "template" && row.review_status === "pending_review").length;
  return { ok: true, counts: counts || { projects: 0, campaigns: 0, agendas: 0, publishing: 0 }, tasks: taskRows, projects, pendingReviews };
}

async function listProjects(sql: ReturnType<typeof getSql>, request: VercelRequest, user: SessionUser) {
  const search = clean(request.query.search);
  const kind = clean(request.query.kind);
  const stage = clean(request.query.stage);
  const archived = bool(request.query.archived);
  const pattern = `%${search}%`;
  const scope = projectScope(sql, user, "c");
  const rows = await sql`
    select c.id::text,c.campaign_code,c.name,c.source_kind,c.campaign_type,c.objective,c.content_brief,c.status,c.stage,c.campaign_date,c.starts_on,c.ends_on,
      c.created_at,c.updated_at,c.archived_at,c.moved_to_publish_at,c.raw_folders_created_at,u.full_name as created_by_name,
      count(distinct cr.id)::int as creative_count,count(distinct t.id)::int as task_count,
      coalesce((select round(avg(dept_progress),2) from (select avg(tx.progress)::numeric as dept_progress from marketing.tasks tx where tx.campaign_id=c.id and tx.task_kind='execution' group by tx.department_id) q),0)::float as progress
    from marketing.campaigns c left join core.users u on u.id=c.created_by left join marketing.creatives cr on cr.campaign_id=c.id left join marketing.tasks t on t.campaign_id=c.id
    where c.is_deleted=false and (${archived}=true and c.archived_at is not null or ${archived}=false and c.archived_at is null)
      and (${search}='' or c.name ilike ${pattern} or coalesce(c.campaign_code,'') ilike ${pattern} or coalesce(c.objective,'') ilike ${pattern})
      and (${kind}='' or c.source_kind=${kind}) and (${stage}='' or c.stage=${stage}) and ${scope}
    group by c.id,u.full_name order by c.created_at desc
  `;
  return { ok: true, rows };
}

async function projectDetail(sql: ReturnType<typeof getSql>, id: string, user: SessionUser) {
  const scope = projectScope(sql, user, "c");
  const showAdminActions = isAdmin(user) || can(user, "marketing.settings.manage") || can(user, "marketing.project.edit") || can(user, "marketing.template.review");
  const [project] = await sql`
    select c.*,c.id::text,c.created_by::text,c.campaign_type_id::text,ct.name as campaign_type_name,u.full_name as created_by_name
    from marketing.campaigns c left join marketing.campaign_types ct on ct.id=c.campaign_type_id left join core.users u on u.id=c.created_by
    where c.id=${id}::uuid and c.is_deleted=false and ${scope}
  `;
  if (!project) return null;
  const [creatives, assignments, vehicles, tasks, budget, schedule, links, files, activity] = await Promise.all([
    sql`select cr.*,cr.id::text,cr.campaign_id::text,cr.creative_type_id::text,ct.name as creative_type_name,ct.short_code as catalog_short_code,d.name as primary_department_name from marketing.creatives cr left join marketing.creative_types ct on ct.id=cr.creative_type_id left join marketing.departments d on d.id=ct.primary_department_id where cr.campaign_id=${id}::uuid order by cr.sort_order,cr.instance_no`,
    sql`select a.id::text,a.creative_id::text,a.department_id::text,a.assigned_user_id::text,a.content_writer_id::text,a.assignment_role,a.due_at,a.notes,a.is_optional,d.name as department_name,d.code as department_code,u.full_name as assigned_name,cw.full_name as content_writer_name from marketing.instance_assignments a join marketing.departments d on d.id=a.department_id join core.users u on u.id=a.assigned_user_id left join core.users cw on cw.id=a.content_writer_id where a.creative_id in(select id from marketing.creatives where campaign_id=${id}::uuid) order by d.sort_order,u.full_name,cw.full_name`,
    sql`select iv.creative_id::text,v.id::text as vehicle_id,v.vin,v.car_name,v.statement,v.exterior_color,v.interior_color,v.model_year,l.name as location_name from marketing.instance_vehicles iv join operations.vehicles v on v.id=iv.vehicle_id left join operations.locations l on l.id=v.location_id where iv.creative_id in(select id from marketing.creatives where campaign_id=${id}::uuid) order by v.vin`,
    sql`select t.*,t.id::text,t.campaign_id::text,t.creative_id::text,t.assigned_to::text,t.content_writer_id::text,t.template_task_id::text,t.department_id::text,au.full_name as assigned_name,cw.full_name as content_writer_name,d.name as department_name,c.name as project_name,c.campaign_code,c.source_kind,c.campaign_type,c.starts_on as project_starts_on,c.ends_on as project_ends_on,c.objective as project_objective,c.content_brief as project_content_brief,c.stage as project_stage,cr.instance_no,cr.creative_type,cr.short_code,cr.agenda_day,cr.content_due_at,cr.content_notes,cr.admin_notes,(select ia.notes from marketing.instance_assignments ia where ia.creative_id=t.creative_id and ia.department_id=t.department_id and ia.assigned_user_id=t.assigned_to and ia.content_writer_id=t.content_writer_id limit 1) as assignment_notes,coalesce((select json_agg(json_build_object('id',v.id::text,'vin',v.vin,'car_name',v.car_name,'statement',v.statement,'exterior_color',v.exterior_color,'interior_color',v.interior_color,'model_year',v.model_year,'location_name',l.name) order by v.vin) from marketing.instance_vehicles iv join operations.vehicles v on v.id=iv.vehicle_id left join operations.locations l on l.id=v.location_id where iv.creative_id=t.creative_id),'[]') as vehicles,coalesce((select json_agg(json_build_object('id',a.id::text,'name',a.name,'percentage',a.percentage::float,'completed',coalesce(ap.completed,false),'completed_at',ap.completed_at,'note',ap.note) order by a.sort_order) from marketing.assignment_actions a left join marketing.task_action_progress ap on ap.action_id=a.id and ap.task_id=t.id where a.department_id=t.department_id and a.is_active=true and (${showAdminActions}=true or a.audience in ('user','both'))),'[]') as actions,coalesce((select json_agg(json_build_object('id',up.id::text,'upload_kind',up.upload_kind,'file_name',up.file_name,'external_url',up.external_url,'storage_key',up.storage_key,'version_no',up.version_no,'uploaded_by_name',up.uploaded_by_name,'created_at',up.created_at) order by up.created_at desc) from marketing.task_uploads up where up.task_id=t.id),'[]') as uploads from marketing.tasks t join marketing.campaigns c on c.id=t.campaign_id left join core.users au on au.id=t.assigned_to left join core.users cw on cw.id=t.content_writer_id left join marketing.departments d on d.id=t.department_id left join marketing.creatives cr on cr.id=t.creative_id where t.campaign_id=${id}::uuid order by cr.sort_order,t.task_kind desc,t.created_at`,
    sql`select b.id::text,b.creative_id::text,b.platform_id::text,b.funnel,b.ad_count,b.content_goal,b.expected_goal,b.amount::float,b.notes,cr.instance_no,cr.creative_type,p.name as platform_name from marketing.budget_items b left join marketing.creatives cr on cr.id=b.creative_id left join marketing.platforms p on p.id=b.platform_id where b.campaign_id=${id}::uuid order by b.sort_order,b.created_at`,
    sql`select s.id::text,s.creative_id::text,s.platform_id::text,s.post_type_id::text,s.publish_date,s.publish_time::text,s.notes,s.status,cr.instance_no,cr.creative_type,p.name as platform_name,pt.name as post_type_name,pt.dimensions from marketing.publish_schedule s join marketing.creatives cr on cr.id=s.creative_id join marketing.platforms p on p.id=s.platform_id join marketing.platform_post_types pt on pt.id=s.post_type_id where s.campaign_id=${id}::uuid order by s.publish_date,s.publish_time,cr.instance_no`,
    sql`select l.id::text,l.platform_id::text,p.name as platform_name,l.url,l.created_at from marketing.project_links l left join marketing.platforms p on p.id=l.platform_id where l.campaign_id=${id}::uuid order by l.created_at desc`,
    sql`select f.id::text,f.file_kind,f.file_name,f.external_url,f.storage_key,f.mime_type,f.file_size,f.uploaded_by_name,f.created_at from marketing.project_files f where f.campaign_id=${id}::uuid order by f.created_at desc`,
    sql`select id::text,actor_name,action,entity_type,entity_id,details,created_at from marketing.activity_log where entity_id=${id} order by created_at desc limit 100`,
  ]);
  return { project, creatives, assignments, vehicles, tasks, budget, schedule, links, files, activity };
}

async function nextProjectCode(tx: SqlExecutor, kind: string, campaignTypeId: string | null, startDate: string) {
  if (kind === "agenda") {
    const [sequence] = await tx`select nextval('marketing.project_code_seq')::bigint as n`;
    const month = startDate ? startDate.slice(0, 7).replace("-", "") : new Date().toISOString().slice(0, 7).replace("-", "");
    return `AGENDA-${month}-${String(sequence?.n || 1).padStart(4, "0")}`;
  }
  if (campaignTypeId) {
    const [row] = await tx`select id::text,short_code,code_prefix,next_number::bigint as next_number from marketing.campaign_types where id=${campaignTypeId}::uuid and is_active=true for update`;
    if (!row) throw new Error("نوع الحملة غير صحيح");
    const year = (startDate || new Date().toISOString()).slice(0, 4);
    const number = Number(row.next_number || 1);
    await tx`update marketing.campaign_types set next_number=next_number+1,updated_at=now() where id=${row.id}::uuid`;
    return `${row.code_prefix}-${row.short_code}-${year}-${String(number).padStart(4, "0")}`;
  }
  const [sequence] = await tx`select nextval('marketing.project_code_seq')::bigint as n`;
  return `MZJ-CMP-${new Date().getUTCFullYear()}-${String(sequence?.n || 1).padStart(4, "0")}`;
}

async function createProject(sql: ReturnType<typeof getSql>, body: Record<string, unknown>, user: SessionUser) {
  const payload = objectValue(body.project);
  const kind = clean(payload.kind || body.kind) === "agenda" ? "agenda" : "campaign";
  const name = clean(payload.name);
  const startsOn = clean(payload.startsOn);
  const endsOn = clean(payload.endsOn);
  const campaignTypeId = textOrNull(payload.campaignTypeId);
  const instances = list(body.instances).map(objectValue);
  if (!name || !startsOn || !endsOn) throw new Error("اسم الحملة أو الأجندة وتاريخ البداية والنهاية مطلوبة");
  if (endsOn < startsOn) throw new Error("تاريخ النهاية يجب ألا يسبق البداية");
  if (!instances.length) throw new Error("أضف كرييتيف واحدًا على الأقل");
  const idempotencyKey = clean(body.idempotencyKey) || crypto.randomUUID();

  return sql.begin(async (tx) => {
    const [existing] = await tx`select id::text,campaign_code,name from marketing.campaigns where idempotency_key=${idempotencyKey}`;
    if (existing) return { ok: true, project: existing, duplicatePrevented: true, message: "تم منع تكرار الإنشاء وإرجاع السجل المحفوظ" };
    const code = await nextProjectCode(tx, kind, campaignTypeId, startsOn);
    const [campaignType] = campaignTypeId ? await tx`select name from marketing.campaign_types where id=${campaignTypeId}::uuid` : [null];
    const [project] = await tx`
      insert into marketing.campaigns(campaign_code,name,campaign_type,campaign_type_id,objective,content_brief,status,source_kind,stage,campaign_date,starts_on,ends_on,starts_at,ends_at,created_by,idempotency_key,metadata)
      values(${code},${name},${campaignType?.name || (kind === "agenda" ? "أجندة" : null)},${campaignTypeId}::uuid,${textOrNull(payload.objective)},${textOrNull(payload.contentBrief)},'active',${kind},'required',${textOrNull(payload.campaignDate)}::date,${startsOn}::date,${endsOn}::date,${startsOn}::date,${endsOn}::date,${user.id}::uuid,${idempotencyKey},${tx.json(toDatabaseJson(payload.metadata))})
      returning id::text,campaign_code,name,source_kind,stage
    `;

    let instanceIndex = 0;
    const creativeIdByClient = new Map<string, string>();
    for (const raw of instances) {
      instanceIndex += 1;
      const creativeTypeId = clean(raw.creativeTypeId);
      const [creativeType] = await tx`select ct.id::text,ct.name,ct.short_code,ct.primary_department_id::text,d.code as primary_department_code from marketing.creative_types ct left join marketing.departments d on d.id=ct.primary_department_id where ct.id=${creativeTypeId}::uuid and ct.is_active=true`;
      if (!creativeType) throw new Error(`نوع الكرييتيف غير صحيح في العنصر ${instanceIndex}`);
      const instanceNo = clean(raw.instanceNo) || `N${String(instanceIndex).padStart(2, "0")}`;
      const [creative] = await tx`
        insert into marketing.creatives(campaign_id,creative_type,creative_type_id,quantity,status,instance_no,short_code,agenda_day,content_due_at,content_notes,admin_notes,sort_order,metadata)
        values(${project.id}::uuid,${creativeType.name},${creativeType.id}::uuid,1,'pending',${instanceNo},${creativeType.short_code},${textOrNull(raw.agendaDay)}::date,${textOrNull(raw.contentDueAt)}::timestamptz,${textOrNull(raw.contentNotes)},${textOrNull(raw.adminNotes)},${instanceIndex},${tx.json(toDatabaseJson(raw.metadata))})
        returning id::text
      `;
      creativeIdByClient.set(clean(raw.clientId) || instanceNo, creative.id);
      const vehicleIds = [...new Set(stringList(raw.vehicleIds))];
      if (vehicleIds.length) {
        const validVehicles = await tx`select id::text from operations.vehicles where id in ${tx(vehicleIds)} and is_deleted=false and archived_at is null`;
        if (validVehicles.length !== vehicleIds.length) throw new Error(`إحدى السيارات المختارة غير موجودة أو مؤرشفة في ${instanceNo}`);
      }
      for (const vehicleId of vehicleIds) {
        await tx`insert into marketing.instance_vehicles(creative_id,vehicle_id) select ${creative.id}::uuid,v.id from operations.vehicles v where v.id=${vehicleId}::uuid and v.is_deleted=false on conflict do nothing`;
      }
      const contentWriterIds = [...new Set(stringList(raw.contentWriterIds))];
      if (!contentWriterIds.length) throw new Error(`اختر كاتب محتوى للـInstance ${instanceNo}`);
      const [contentDepartment] = await tx`select id::text,code from marketing.departments where is_content_department=true and is_active=true limit 1`;
      if (!contentDepartment) throw new Error("لم يتم تحديد قسم المحتوى داخل إعدادات التسويق");
      const templateByWriter = new Map<string, string>();
      for (const writerId of contentWriterIds) {
        const [writer] = await tx`select u.id::text,u.full_name from core.users u join marketing.department_users du on du.user_id=u.id and du.department_id=${contentDepartment.id}::uuid and du.is_active=true where u.id=${writerId}::uuid and u.is_active=true`;
        if (!writer) throw new Error("كاتب المحتوى المختار غير موجود");
        await tx`insert into marketing.instance_assignments(creative_id,department_id,assigned_user_id,content_writer_id,assignment_role,due_at,notes,is_optional) values(${creative.id}::uuid,${contentDepartment.id}::uuid,${writerId}::uuid,${writerId}::uuid,'content',${textOrNull(raw.contentDueAt)}::timestamptz,${textOrNull(raw.contentNotes)},false) on conflict do nothing`;
        const [seq] = await tx`select nextval('marketing.task_no_seq')::bigint as n`;
        const taskNo = `${instanceNo}-${creativeType.short_code}-CONTENT-${String(seq?.n || 1).padStart(7, "0")}`;
        const [task] = await tx`
          insert into marketing.tasks(task_no,campaign_id,creative_id,task_kind,department_id,department_code,assigned_to,content_writer_id,paired_content_user_id,status,due_at,review_status,metadata)
          values(${taskNo},${project.id}::uuid,${creative.id}::uuid,'template',${contentDepartment.id}::uuid,${contentDepartment.code},${writerId}::uuid,${writerId}::uuid,${writerId}::uuid,'required',${textOrNull(raw.contentDueAt)}::timestamptz,'not_submitted',${tx.json(toDatabaseJson({ instanceNo, creativeType: creativeType.name }))}) returning id::text
        `;
        templateByWriter.set(writerId, task.id);
      }
      const assignments = list(raw.assignments).map(objectValue);
      if (creativeType.primary_department_id && !assignments.some((assignment) => clean(assignment.departmentId) === creativeType.primary_department_id && clean(assignment.role) === "primary")) {
        throw new Error(`القسم الأساسي غير مكتمل في ${instanceNo}`);
      }
      for (const assignment of assignments) {
        const departmentId = clean(assignment.departmentId);
        const userId = clean(assignment.userId);
        const role = ["primary", "optional"].includes(clean(assignment.role)) ? clean(assignment.role) : "primary";
        const writerIds = [...new Set(stringList(assignment.contentWriterIds))].filter((id) => contentWriterIds.includes(id));
        if (!departmentId || !userId || !writerIds.length) throw new Error(`بيانات ربط اليوزر بالكاتب غير مكتملة في ${instanceNo}`);
        const [department] = await tx`select id::text,code,name from marketing.departments where id=${departmentId}::uuid and is_active=true`;
        const [assignee] = await tx`select u.id::text,u.full_name from core.users u join marketing.department_users du on du.user_id=u.id and du.department_id=${departmentId}::uuid and du.is_active=true where u.id=${userId}::uuid and u.is_active=true`;
        if (!department || !assignee) throw new Error(`القسم أو اليوزر غير صحيح في ${instanceNo}`);
        if (role === "primary" && departmentId !== creativeType.primary_department_id) throw new Error(`القسم الأساسي لا يطابق تعريف الكرييتيف في ${instanceNo}`);
        if (role === "optional" && departmentId === creativeType.primary_department_id) throw new Error(`القسم الأساسي يجب حفظه كقسم أساسي في ${instanceNo}`);
        for (const writerId of writerIds) {
          const templateTaskId = templateByWriter.get(writerId);
          if (!templateTaskId) throw new Error(`ارتباط الكاتب غير صحيح في ${instanceNo}`);
          await tx`insert into marketing.instance_assignments(creative_id,department_id,assigned_user_id,content_writer_id,assignment_role,due_at,notes,is_optional) values(${creative.id}::uuid,${department.id}::uuid,${userId}::uuid,${writerId}::uuid,${role},${textOrNull(assignment.dueAt)}::timestamptz,${textOrNull(assignment.notes)},${role === "optional"}) on conflict do nothing`;
          const [seq] = await tx`select nextval('marketing.task_no_seq')::bigint as n`;
          const taskNo = `${instanceNo}-${creativeType.short_code}-${department.code.toUpperCase()}-${String(seq?.n || 1).padStart(7, "0")}`;
          const [task] = await tx`
            insert into marketing.tasks(task_no,campaign_id,creative_id,task_kind,department_id,department_code,assigned_to,content_writer_id,paired_content_user_id,template_task_id,status,due_at,review_status,metadata)
            values(${taskNo},${project.id}::uuid,${creative.id}::uuid,'execution',${department.id}::uuid,${department.code},${userId}::uuid,${writerId}::uuid,${writerId}::uuid,${templateTaskId}::uuid,'waiting_template',${textOrNull(assignment.dueAt)}::timestamptz,'waiting_template',${tx.json(toDatabaseJson({ assignmentRole: role, instanceNo }))}) returning id::text
          `;
          await tx`
            insert into marketing.task_action_progress(task_id,action_id)
            select ${task.id}::uuid,a.id from marketing.assignment_actions a where a.department_id=${department.id}::uuid and a.is_active=true
            on conflict do nothing
          `;
        }
      }
    }
    for (const raw of list(body.budget).map(objectValue)) {
      const creativeId = creativeIdByClient.get(clean(raw.instanceClientId) || clean(raw.instanceNo)) || textOrNull(raw.creativeId);
      const platformId = clean(raw.platformId);
      if (!creativeId) throw new Error("كل بند ميزانية يجب أن يرتبط بـCreative Instance صحيحة");
      const [platform] = await tx`select id::text from marketing.platforms where id=${platformId}::uuid and is_active=true`;
      if (!platform) throw new Error("منصة بند الميزانية غير صحيحة أو غير فعالة");
      await tx`insert into marketing.budget_items(campaign_id,creative_id,funnel,platform_id,ad_count,content_goal,expected_goal,amount,notes,sort_order) values(${project.id}::uuid,${creativeId}::uuid,${clean(raw.funnel) || "عام"},${platform.id}::uuid,${Math.max(1, Math.round(numberValue(raw.adCount) || 1))},${textOrNull(raw.contentGoal)},${textOrNull(raw.expectedGoal)},${Math.max(0, numberValue(raw.amount))},${textOrNull(raw.notes)},${numberValue(raw.sortOrder)})`;
    }
    for (const raw of list(body.schedule).map(objectValue)) {
      const creativeId = creativeIdByClient.get(clean(raw.instanceClientId) || clean(raw.instanceNo)) || clean(raw.creativeId);
      const publishDate = clean(raw.publishDate);
      const platformId = clean(raw.platformId);
      const postTypeId = clean(raw.postTypeId);
      if (!creativeId || !publishDate || !platformId || !postTypeId) throw new Error("بيانات جدول النشر غير مكتملة");
      if (publishDate < startsOn || publishDate > endsOn) throw new Error("تاريخ النشر يجب أن يكون داخل فترة الحملة أو الأجندة");
      const [postType] = await tx`select pt.id::text,pt.platform_id::text from marketing.platform_post_types pt join marketing.platforms p on p.id=pt.platform_id where pt.id=${postTypeId}::uuid and pt.platform_id=${platformId}::uuid and pt.is_active=true and p.is_active=true`;
      if (!postType) throw new Error("نوع النشر لا يتبع المنصة المختارة أو غير فعال");
      await tx`insert into marketing.publish_schedule(campaign_id,creative_id,publish_date,publish_time,platform_id,post_type_id,notes) values(${project.id}::uuid,${creativeId}::uuid,${publishDate}::date,${textOrNull(raw.publishTime)}::time,${platformId}::uuid,${postType.id}::uuid,${textOrNull(raw.notes)}) on conflict do nothing`;
    }
    await tx`insert into marketing.activity_log(actor_id,actor_name,action,entity_type,entity_id,details) values(${user.id}::uuid,${user.fullName},'project_created','project',${project.id},${tx.json(toDatabaseJson({ kind, code, name, instances: instances.length }))})`;
    return { ok: true, project, message: kind === "agenda" ? "تم إنشاء الأجندة والتاسكات بدون تكرار" : "تم إنشاء الحملة والتاسكات بدون تكرار" };
  });
}

async function receiveTask(sql: ReturnType<typeof getSql>, body: Record<string, unknown>, user: SessionUser) {
  const id = clean(body.id);
  return sql.begin(async (tx) => {
    const [task] = await tx`select *,id::text,assigned_to::text,template_task_id::text from marketing.tasks where id=${id}::uuid for update`;
    if (!task) throw new Error("التاسك غير موجود");
    if (!isAdmin(user) && task.assigned_to !== user.id) throw new Error("هذا التاسك غير مسند إليك");
    if (task.received_at) return { ok: true, task, message: "تم تسجيل الاستلام سابقًا" };
    if (task.task_kind === "execution" && task.template_task_id) {
      const [template] = await tx`select review_status from marketing.tasks where id=${task.template_task_id}::uuid`;
      if (!template || template.review_status !== "approved") throw new Error("لا يمكن استلام التاسك التنفيذي قبل اعتماد Task Template المرتبطة");
    }
    const [updated] = await tx`update marketing.tasks set received_at=now(),received_by=${user.id}::uuid,status='active',updated_at=now() where id=${id}::uuid returning *,id::text`;
    await tx`insert into marketing.activity_log(actor_id,actor_name,action,entity_type,entity_id,details) values(${user.id}::uuid,${user.fullName},'task_received','task',${id},${tx.json(toDatabaseJson({ receivedAt: updated.received_at }))})`;
    return { ok: true, task: updated, message: "تم استلام التاسك وتسجيل التاريخ الفعلي" };
  });
}

async function submitTemplate(sql: ReturnType<typeof getSql>, body: Record<string, unknown>, user: SessionUser) {
  const id = clean(body.id);
  const templateData = objectValue(body.templateData);
  return sql.begin(async (tx) => {
    const [task] = await tx`select *,id::text,assigned_to::text from marketing.tasks where id=${id}::uuid and task_kind='template' for update`;
    if (!task) throw new Error("Task Template غير موجودة");
    if (!isAdmin(user) && task.assigned_to !== user.id) throw new Error("هذه Task Template غير مسندة إليك");
    if (!task.received_at) throw new Error("اضغط تم الاستلام قبل رفع Task Template");
    const [updated] = await tx`update marketing.tasks set template_data=${tx.json(toDatabaseJson(templateData))},review_status='pending_review',status='review',review_note=null,progress=100,updated_at=now() where id=${id}::uuid returning *,id::text`;
    await tx`insert into marketing.task_reviews(task_id,action,note,reviewer_id,reviewer_name,snapshot) values(${id}::uuid,'submitted',${textOrNull(body.note)},${user.id}::uuid,${user.fullName},${tx.json(toDatabaseJson(templateData))})`;
    await tx`insert into marketing.activity_log(actor_id,actor_name,action,entity_type,entity_id,details) values(${user.id}::uuid,${user.fullName},'template_submitted','task',${id},${tx.json(toDatabaseJson({ fields: Object.keys(templateData) }))})`;
    return { ok: true, task: updated, message: "تم رفع Task Template وإرسالها للمراجعة" };
  });
}

async function reviewTemplate(sql: ReturnType<typeof getSql>, body: Record<string, unknown>, user: SessionUser) {
  const id = clean(body.id);
  const reviewAction = clean(body.reviewAction);
  const note = clean(body.note);
  if (!["approve", "request_revision", "reject"].includes(reviewAction)) throw new Error("إجراء المراجعة غير صحيح");
  return sql.begin(async (tx) => {
    const [task] = await tx`select *,id::text from marketing.tasks where id=${id}::uuid and task_kind='template' for update`;
    if (!task) throw new Error("Task Template غير موجودة");
    if (reviewAction === "approve") {
      await tx`update marketing.tasks set review_status='approved',review_note=${note || null},status='completed',completed_at=coalesce(completed_at,now()),progress=100,updated_at=now() where id=${id}::uuid`;
      await tx`update marketing.tasks set template_data=${tx.json(toDatabaseJson(task.template_data || {}))},review_status='approved',status=case when received_at is null then 'required' else 'active' end,updated_at=now() where template_task_id=${id}::uuid`;
    } else if (reviewAction === "request_revision") {
      await tx`update marketing.tasks set review_status='revision_requested',review_note=${note || null},status='revision_requested',completed_at=null,updated_at=now() where id=${id}::uuid`;
      await tx`update marketing.tasks set review_status='waiting_template',status='waiting_template',template_data='{}'::jsonb,updated_at=now() where template_task_id=${id}::uuid`;
    } else {
      await tx`update marketing.tasks set review_status='rejected',review_note=${note || null},status='rejected',completed_at=null,updated_at=now() where id=${id}::uuid`;
      await tx`update marketing.tasks set review_status='rejected',status='waiting_template',template_data='{}'::jsonb,updated_at=now() where template_task_id=${id}::uuid`;
    }
    const dbAction = reviewAction === "approve" ? "approved" : reviewAction === "request_revision" ? "revision_requested" : "rejected";
    await tx`insert into marketing.task_reviews(task_id,action,note,reviewer_id,reviewer_name,snapshot) values(${id}::uuid,${dbAction},${note || null},${user.id}::uuid,${user.fullName},${tx.json(toDatabaseJson(task.template_data || {}))})`;
    await tx`insert into marketing.activity_log(actor_id,actor_name,action,entity_type,entity_id,details) values(${user.id}::uuid,${user.fullName},${`template_${dbAction}`},'task',${id},${tx.json(toDatabaseJson({ note }))})`;
    return { ok: true, message: reviewAction === "approve" ? "تم اعتماد Task Template وفتح التاسكات المرتبطة فقط" : reviewAction === "request_revision" ? "تم طلب تعديل نفس Task Template" : "تم رفض Task Template" };
  });
}

async function taskAction(sql: ReturnType<typeof getSql>, body: Record<string, unknown>, user: SessionUser) {
  const taskId = clean(body.taskId);
  const actionId = clean(body.actionId);
  const completed = bool(body.completed);
  return sql.begin(async (tx) => {
    const [task] = await tx`select *,id::text,assigned_to::text from marketing.tasks where id=${taskId}::uuid and task_kind='execution' for update`;
    if (!task) throw new Error("التاسك التنفيذي غير موجود");
    if (!isAdmin(user) && task.assigned_to !== user.id) throw new Error("هذا الإجراء غير متاح لهذا المستخدم");
    if (!task.received_at) throw new Error("اضغط تم الاستلام قبل تنفيذ إجراءات التكليف");
    if (task.status === "waiting_template") throw new Error("لا يمكن تنفيذ الإجراءات قبل اعتماد Task Template");
    const [assignmentAction] = await tx`select id::text,audience from marketing.assignment_actions where id=${actionId}::uuid and department_id=${task.department_id}::uuid and is_active=true`;
    if (!assignmentAction) throw new Error("إجراء التكليف غير موجود داخل قسم التاسك");
    const mayRunAdminAction = isAdmin(user) || can(user, "marketing.settings.manage") || can(user, "marketing.project.edit") || can(user, "marketing.template.review");
    if (assignmentAction.audience === "admin" && !mayRunAdminAction) throw new Error("هذا الإجراء متاح للإدارة فقط");
    await tx`insert into marketing.task_action_progress(task_id,action_id,completed,completed_by,completed_at,note,updated_at) values(${taskId}::uuid,${actionId}::uuid,${completed},${completed ? user.id : null}::uuid,${completed ? new Date().toISOString() : null}::timestamptz,${textOrNull(body.note)},now()) on conflict(task_id,action_id) do update set completed=excluded.completed,completed_by=excluded.completed_by,completed_at=excluded.completed_at,note=excluded.note,updated_at=now()`;
    const [progressRow] = await tx`select coalesce(sum(a.percentage) filter(where ap.completed),0)::float as progress,coalesce(sum(a.percentage),0)::float as total from marketing.assignment_actions a left join marketing.task_action_progress ap on ap.action_id=a.id and ap.task_id=${taskId}::uuid where a.department_id=${task.department_id}::uuid and a.is_active=true and a.is_required=true`;
    const progress = Number(progressRow?.total || 0) > 0 ? Math.min(100, Number(progressRow?.progress || 0) * 100 / Number(progressRow?.total || 100)) : 0;
    const status = progress >= 99.999 ? "completed" : task.received_at ? "active" : "required";
    const [updated] = await tx`update marketing.tasks set progress=${progress},status=${status},completed_at=${status === "completed" ? new Date().toISOString() : null}::timestamptz,updated_at=now() where id=${taskId}::uuid returning *,id::text`;
    return { ok: true, task: updated, message: "تم تحديث الإجراء وحساب التقدم من نسب الإعدادات" };
  });
}

async function moveToPublish(sql: ReturnType<typeof getSql>, id: string, user: SessionUser) {
  return sql.begin(async (tx) => {
    const [progress] = await tx`select coalesce((select round(avg(dept_progress),2) from (select avg(t.progress)::numeric as dept_progress from marketing.tasks t where t.campaign_id=${id}::uuid and t.task_kind='execution' group by t.department_id) q),0)::float as value`;
    if (Number(progress?.value || 0) < 99.99) throw new Error("لا يمكن النقل إلى قسم النشر قبل وصول كل الأقسام إلى 100%");
    const [project] = await tx`update marketing.campaigns set stage='publishing',moved_to_publish_at=now(),updated_at=now() where id=${id}::uuid and is_deleted=false returning id::text,name,campaign_code,stage`;
    if (!project) throw new Error("الحملة أو الأجندة غير موجودة");
    await tx`insert into marketing.activity_log(actor_id,actor_name,action,entity_type,entity_id,details) values(${user.id}::uuid,${user.fullName},'moved_to_publishing','project',${id},'{}'::jsonb)`;
    return { ok: true, project, message: "تم نقل الحملة فعليًا إلى قسم النشر" };
  });
}

async function projectStateAction(sql: ReturnType<typeof getSql>, body: Record<string, unknown>, user: SessionUser) {
  const id = clean(body.id);
  const stateAction = clean(body.stateAction);
  if (stateAction === "archive") {
    const [row] = await sql`update marketing.campaigns set archived_at=now(),archived_by=${user.id}::uuid,updated_at=now() where id=${id}::uuid and is_deleted=false returning id::text`;
    if (!row) throw new Error("السجل غير موجود");
    return { ok: true, message: "تمت الأرشفة" };
  }
  if (stateAction === "restore") {
    const [row] = await sql`update marketing.campaigns set archived_at=null,archived_by=null,updated_at=now() where id=${id}::uuid and is_deleted=false returning id::text`;
    if (!row) throw new Error("السجل غير موجود");
    return { ok: true, message: "تم الاسترجاع من الأرشيف" };
  }
  if (stateAction === "delete") {
    const [row] = await sql`update marketing.campaigns set is_deleted=true,deleted_at=now(),deleted_by=${user.id}::uuid,updated_at=now() where id=${id}::uuid and is_deleted=false returning id::text`;
    if (!row) throw new Error("السجل غير موجود");
    return { ok: true, message: "تم المسح وفق منطق الحذف الناعم" };
  }
  throw new Error("الإجراء غير مدعوم");
}

async function updateProject(sql: ReturnType<typeof getSql>, body: Record<string, unknown>, user: SessionUser) {
  const id = clean(body.id);
  const name = clean(body.name);
  const startsOn = clean(body.startsOn);
  const endsOn = clean(body.endsOn);
  const campaignTypeId = textOrNull(body.campaignTypeId);
  if (!id || !name || !startsOn || !endsOn) throw new Error("اسم المشروع وتاريخ البداية والنهاية مطلوبة");
  if (endsOn < startsOn) throw new Error("تاريخ النهاية يجب ألا يسبق البداية");
  const [current] = await sql`select id::text,source_kind from marketing.campaigns where id=${id}::uuid and is_deleted=false`;
  if (!current) throw new Error("الحملة أو الأجندة غير موجودة");
  const [campaignType] = campaignTypeId ? await sql`select id::text,name from marketing.campaign_types where id=${campaignTypeId}::uuid and is_active=true` : [null];
  if (campaignTypeId && !campaignType) throw new Error("نوع الحملة غير صحيح أو غير فعال");
  const [row] = await sql`
    update marketing.campaigns set
      name=${name},campaign_type_id=${campaignTypeId}::uuid,campaign_type=${campaignType?.name || (current.source_kind === "agenda" ? "أجندة" : null)},
      objective=${textOrNull(body.objective)},content_brief=${textOrNull(body.contentBrief)},campaign_date=${textOrNull(body.campaignDate) || startsOn}::date,
      starts_on=${startsOn}::date,ends_on=${endsOn}::date,starts_at=${startsOn}::date,ends_at=${endsOn}::date,updated_at=now()
    where id=${id}::uuid and is_deleted=false
    returning id::text,name,campaign_code,source_kind,starts_on,ends_on,updated_at
  `;
  await sql`insert into marketing.activity_log(actor_id,actor_name,action,entity_type,entity_id,details) values(${user.id}::uuid,${user.fullName},'project_updated','project',${id},${sql.json(toDatabaseJson({ name, startsOn, endsOn, campaignTypeId }))})`;
  return { ok: true, project: row, message: "تم تحديث بيانات الحملة أو الأجندة" };
}

async function saveProjectLink(sql: ReturnType<typeof getSql>, body: Record<string, unknown>, user: SessionUser) {
  const campaignId = clean(body.campaignId);
  const url = clean(body.url);
  if (!campaignId || !url) throw new Error("الحملة والرابط مطلوبان");
  const [row] = await sql`insert into marketing.project_links(campaign_id,platform_id,url,created_by) values(${campaignId}::uuid,${textOrNull(body.platformId)}::uuid,${url},${user.id}::uuid) returning id::text,url,created_at`;
  return { ok: true, row, message: "تمت إضافة الرابط" };
}

async function packages(sql: ReturnType<typeof getSql>, request: VercelRequest) {
  const search = clean(request.query.search);
  const categoryId = clean(request.query.categoryId);
  const pattern = `%${search}%`;
  const [rows, countRows] = await Promise.all([
    sql`select p.id::text,p.name,p.category_id::text,c.name as category_name,p.price::float,p.cash_discount_percent::float,p.registration_fee::float,p.insurance_fee::float,p.issuance_fee::float,p.care_items,p.delivery_home,p.delivery_region,p.metadata,p.is_active,p.created_at,p.updated_at from marketing.packages p left join marketing.package_categories c on c.id=p.category_id where p.is_active=true and (${categoryId}='' or p.category_id=${categoryId}::uuid) and (${search}='' or p.name ilike ${pattern} or coalesce(c.name,'') ilike ${pattern}) order by c.sort_order,p.name`,
    sql`select p.category_id::text as category_id,count(*)::int as count from marketing.packages p left join marketing.package_categories c on c.id=p.category_id where p.is_active=true and (${search}='' or p.name ilike ${pattern} or coalesce(c.name,'') ilike ${pattern}) group by p.category_id`,
  ]);
  const counts = Object.fromEntries(countRows.map((row) => [row.category_id, Number(row.count || 0)]));
  const total = countRows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  return { ok: true, rows, counts, total };
}

async function savePackage(sql: ReturnType<typeof getSql>, body: Record<string, unknown>, user: SessionUser) {
  const id = clean(body.id);
  const name = clean(body.name);
  const categoryId = clean(body.categoryId);
  if (!name || !categoryId) throw new Error("اسم الباقة والتصنيف مطلوبان");
  const values = {
    price: Math.max(0, numberValue(body.price)), discount: Math.max(0, numberValue(body.cashDiscountPercent)), registration: Math.max(0, numberValue(body.registrationFee)),
    insurance: Math.max(0, numberValue(body.insuranceFee)), issuance: Math.max(0, numberValue(body.issuanceFee)), careItems: stringList(body.careItems),
    deliveryHome: bool(body.deliveryHome), deliveryRegion: textOrNull(body.deliveryRegion), metadata: objectValue(body.metadata),
  };
  const [row] = id ? await sql`update marketing.packages set name=${name},category_id=${categoryId}::uuid,price=${values.price},cash_discount_percent=${values.discount},registration_fee=${values.registration},insurance_fee=${values.insurance},issuance_fee=${values.issuance},care_items=${values.careItems},delivery_home=${values.deliveryHome},delivery_region=${values.deliveryRegion},metadata=${sql.json(toDatabaseJson(values.metadata))},updated_at=now() where id=${id}::uuid returning id::text` : await sql`insert into marketing.packages(name,category_id,price,cash_discount_percent,registration_fee,insurance_fee,issuance_fee,care_items,delivery_home,delivery_region,metadata,created_by) values(${name},${categoryId}::uuid,${values.price},${values.discount},${values.registration},${values.insurance},${values.issuance},${values.careItems},${values.deliveryHome},${values.deliveryRegion},${sql.json(toDatabaseJson(values.metadata))},${user.id}::uuid) returning id::text`;
  return { ok: true, row, message: id ? "تم تحديث الباقة" : "تم إنشاء الباقة" };
}

async function deletePackage(sql: ReturnType<typeof getSql>, id: string) {
  const [row] = await sql`update marketing.packages set is_active=false,updated_at=now() where id=${id}::uuid returning id::text`;
  if (!row) throw new Error("الباقة غير موجودة");
  return { ok: true, message: "تم حذف الباقة" };
}

async function stock(sql: ReturnType<typeof getSql>, request: VercelRequest) {
  const search = clean(request.query.search);
  const pattern = `%${search}%`;
  const rows = await sql`
    select v.id::text,v.vin,v.car_name,v.statement,v.interior_color,v.exterior_color,v.model_year,v.status_code,s.name as status_name,l.name as location_name,l.code as location_code,
      exists(select 1 from operations.photography_request_vehicles prv join operations.photography_requests pr on pr.id=prv.request_id left join marketing.request_statuses rs on rs.code=pr.status where prv.vehicle_id=v.id and pr.is_deleted=false and not coalesce(rs.is_terminal,false)) as has_active_photo_request
    from operations.vehicles v left join operations.locations l on l.id=v.location_id left join operations.vehicle_statuses s on s.code=v.status_code
    where v.is_deleted=false and v.archived_at is null and v.is_inventory_active=true and v.status_code not in ('sold','delivered')
      and (${search}='' or v.vin ilike ${pattern} or coalesce(v.car_name,'') ilike ${pattern} or coalesce(v.statement,'') ilike ${pattern})
    order by v.created_at desc limit 1000
  `;
  return { ok: true, rows };
}

async function photoRequests(sql: ReturnType<typeof getSql>, request: VercelRequest, user: SessionUser) {
  const search = clean(request.query.search);
  const pattern = `%${search}%`;
  const unrestricted = isAdmin(user) || can(user, "marketing.photo_request.manage");
  const rows = await sql`
    select r.id::text,r.request_no,r.status,r.requested_by::text,r.requested_by_name,r.requested_by_branch,r.requested_at,r.photography_date,r.note,r.completed_at,
      coalesce(json_agg(json_build_object('vehicle_id',v.id::text,'vin',v.vin,'car_name',v.car_name,'statement',v.statement,'location_name',l.name) order by v.vin) filter(where v.id is not null),'[]') as vehicles,
      coalesce((select json_agg(json_build_object('id',e.id::text,'status',e.status,'actor_name',e.actor_name,'note',e.note,'created_at',e.created_at) order by e.created_at desc) from operations.photography_request_events e where e.request_id=r.id),'[]') as events
    from operations.photography_requests r left join operations.photography_request_vehicles rv on rv.request_id=r.id left join operations.vehicles v on v.id=rv.vehicle_id left join operations.locations l on l.id=v.location_id
    where r.is_deleted=false and (${unrestricted}=true or r.requested_by=${user.id}::uuid) and (${search}='' or coalesce(r.request_no,'') ilike ${pattern} or coalesce(r.requested_by_name,'') ilike ${pattern} or exists(select 1 from operations.photography_request_vehicles x join operations.vehicles vx on vx.id=x.vehicle_id where x.request_id=r.id and vx.vin ilike ${pattern}))
    group by r.id order by r.requested_at desc
  `;
  return { ok: true, rows };
}

async function createPhotoRequest(sql: ReturnType<typeof getSql>, body: Record<string, unknown>, user: SessionUser) {
  const vehicleIds = [...new Set(stringList(body.vehicleIds))];
  const photographyDate = clean(body.photographyDate);
  if (!vehicleIds.length || !photographyDate) throw new Error("اختر سيارة واحدة على الأقل وحدد تاريخ التصوير");
  return sql.begin(async (tx) => {
    const vehicles = await tx`select v.id::text,v.vin,v.car_name,l.name as location_name,l.branch_code from operations.vehicles v left join operations.locations l on l.id=v.location_id where v.id in ${tx(vehicleIds)} and v.is_deleted=false and v.archived_at is null`;
    if (vehicles.length !== vehicleIds.length) throw new Error("إحدى السيارات غير موجودة أو مؤرشفة");
    const [active] = await tx`select r.request_no,v.vin from operations.photography_request_vehicles rv join operations.photography_requests r on r.id=rv.request_id join operations.vehicles v on v.id=rv.vehicle_id left join marketing.request_statuses rs on rs.code=r.status where rv.vehicle_id in ${tx(vehicleIds)} and r.is_deleted=false and not coalesce(rs.is_terminal,false) limit 1`;
    if (active) throw new Error(`السيارة ${active.vin} مرتبطة بطلب تصوير نشط ${active.request_no}`);
    const [seq] = await tx`select nextval('marketing.photo_request_no_seq')::bigint as n`;
    const requestNo = `PH-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${String(seq?.n || 1).padStart(6,"0")}`;
    const [request] = await tx`insert into operations.photography_requests(request_no,status,requested_by,requested_by_name,requested_by_branch,photography_date,note) values(${requestNo},'request_received',${user.id}::uuid,${user.fullName},${user.branchCodes[0] || null},${photographyDate}::date,${textOrNull(body.note)}) returning id::text,request_no,status,photography_date,note,requested_at`;
    for (const vehicleId of vehicleIds) await tx`insert into operations.photography_request_vehicles(request_id,vehicle_id) values(${request.id}::uuid,${vehicleId}::uuid)`;
    await tx`insert into operations.photography_request_events(request_id,status,actor_id,actor_name,note,details) values(${request.id}::uuid,'request_received',${user.id}::uuid,${user.fullName},${textOrNull(body.note)},${tx.json(toDatabaseJson({ requestNo, vehicleIds }))})`;
    await tx`insert into marketing.activity_log(actor_id,actor_name,action,entity_type,entity_id,details) values(${user.id}::uuid,${user.fullName},'photo_request_created','photography_request',${request.id},${tx.json(toDatabaseJson({ requestNo, vehicleIds }))})`;
    return { ok: true, request, message: "تم إنشاء طلب التصوير في نفس سجل العمليات" };
  });
}

async function updatePhotoRequest(sql: ReturnType<typeof getSql>, body: Record<string, unknown>, user: SessionUser) {
  const id = clean(body.id);
  const status = clean(body.status);
  const [validStatus] = await sql`select code,is_terminal from marketing.request_statuses where code=${status} and is_active=true`;
  if (!validStatus) throw new Error("حالة الطلب غير صحيحة");
  const [row] = await sql`update operations.photography_requests set status=${status},photography_date=coalesce(${textOrNull(body.photographyDate)}::date,photography_date),note=coalesce(${textOrNull(body.note)},note),completed_at=case when ${bool(validStatus.is_terminal)} then coalesce(completed_at,now()) else null end where id=${id}::uuid and is_deleted=false returning id::text,request_no,status,photography_date,note,completed_at`;
  if (!row) throw new Error("طلب التصوير غير موجود");
  await sql`insert into operations.photography_request_events(request_id,status,actor_id,actor_name,note,details) values(${id}::uuid,${status},${user.id}::uuid,${user.fullName},${textOrNull(body.note)},${sql.json(toDatabaseJson({ requestNo: row.request_no, photographyDate: row.photography_date }))})`;
  await sql`insert into marketing.activity_log(actor_id,actor_name,action,entity_type,entity_id,details) values(${user.id}::uuid,${user.fullName},'photo_request_updated','photography_request',${id},${sql.json(toDatabaseJson({ status, note: textOrNull(body.note) }))})`;
  return { ok: true, request: row, message: "تم تحديث نفس طلب التصوير الظاهر في التسويق والعمليات" };
}

async function calendar(sql: ReturnType<typeof getSql>, request: VercelRequest, user: SessionUser) {
  const month = clean(request.query.month) || new Date().toISOString().slice(0, 7);
  const scope = projectScope(sql, user, "c");
  const rows = await sql`
    select t.id::text,t.task_no,t.task_kind,t.status,t.received_at,t.progress::float,u.full_name as assigned_name,c.name as project_name,c.campaign_code,c.source_kind,cr.instance_no,cr.creative_type,d.name as department_name
    from marketing.tasks t join marketing.campaigns c on c.id=t.campaign_id left join marketing.creatives cr on cr.id=t.creative_id left join core.users u on u.id=t.assigned_to left join marketing.departments d on d.id=t.department_id
    where t.received_at is not null and to_char(t.received_at,'YYYY-MM')=${month} and c.is_deleted=false and c.archived_at is null and ${scope}
    order by t.received_at,t.task_no
  `;
  const publishRows = await sql`select s.id::text,s.publish_date,s.publish_time::text,c.id::text as campaign_id,c.name as project_name,c.campaign_code,c.source_kind,cr.instance_no,cr.creative_type,p.name as platform_name,pt.name as post_type_name from marketing.publish_schedule s join marketing.campaigns c on c.id=s.campaign_id join marketing.creatives cr on cr.id=s.creative_id join marketing.platforms p on p.id=s.platform_id join marketing.platform_post_types pt on pt.id=s.post_type_id where to_char(s.publish_date,'YYYY-MM')=${month} and c.is_deleted=false and c.archived_at is null and ${scope} order by s.publish_date,s.publish_time`;
  return { ok: true, month, tasks: rows, publishSchedule: publishRows };
}

async function publishPrep(sql: ReturnType<typeof getSql>, request: VercelRequest, user: SessionUser) {
  const search = clean(request.query.search);
  const status = clean(request.query.status);
  const platformId = clean(request.query.platformId);
  const pattern = `%${search}%`;
  const scope = projectScope(sql, user, "c");
  const rows = await sql`
    select t.id::text,t.task_no,t.status,t.progress::float,t.final_file_name,t.final_file_url,t.completed_at,c.id::text as campaign_id,c.name as project_name,c.campaign_code,c.source_kind,c.stage,cr.instance_no,cr.creative_type,u.full_name as assigned_name,d.name as department_name,
      coalesce((select json_agg(distinct jsonb_build_object('platform_id',p.id::text,'platform_name',p.name,'post_type',pt.name,'publish_date',s.publish_date,'publish_time',s.publish_time::text)) from marketing.publish_schedule s join marketing.platforms p on p.id=s.platform_id join marketing.platform_post_types pt on pt.id=s.post_type_id where s.creative_id=t.creative_id),'[]') as publications,
      coalesce((select json_agg(json_build_object('id',up.id::text,'file_name',up.file_name,'external_url',up.external_url,'storage_key',up.storage_key,'created_at',up.created_at) order by up.created_at desc) from marketing.task_uploads up where up.task_id=t.id and up.upload_kind='final'),'[]') as files
    from marketing.tasks t join marketing.campaigns c on c.id=t.campaign_id left join marketing.creatives cr on cr.id=t.creative_id left join core.users u on u.id=t.assigned_to left join marketing.departments d on d.id=t.department_id
    where t.task_kind='execution' and c.is_deleted=false and c.archived_at is null and (${search}='' or c.name ilike ${pattern} or coalesce(c.campaign_code,'') ilike ${pattern} or coalesce(t.task_no,'') ilike ${pattern}) and (${status}='' or t.status=${status}) and (${platformId}='' or exists(select 1 from marketing.publish_schedule sx where sx.creative_id=t.creative_id and sx.platform_id=${platformId}::uuid)) and ${scope}
    order by coalesce(t.completed_at,t.updated_at) desc
  `;
  return { ok: true, rows };
}

async function reports(sql: ReturnType<typeof getSql>, request: VercelRequest, user: SessionUser) {
  const from = clean(request.query.from);
  const to = clean(request.query.to);
  const scope = projectScope(sql, user, "c");
  const [summary] = await sql`
    select count(distinct c.id)::int as projects,count(distinct c.id) filter(where c.source_kind='campaign')::int as campaigns,count(distinct c.id) filter(where c.source_kind='agenda')::int as agendas,count(distinct t.id)::int as tasks,count(distinct t.id) filter(where t.status='completed')::int as completed_tasks,count(distinct t.id) filter(where t.due_at<now() and t.status not in ('completed','rejected'))::int as delayed_tasks,coalesce(round(avg(t.progress),2),0)::float as average_progress,coalesce(sum(b.amount),0)::float as total_budget
    from marketing.campaigns c left join marketing.tasks t on t.campaign_id=c.id left join marketing.budget_items b on b.campaign_id=c.id
    where c.is_deleted=false and c.archived_at is null and (${from}='' or c.created_at::date>=${from}::date) and (${to}='' or c.created_at::date<=${to}::date) and ${scope}
  `;
  const departmentRows = await sql`
    select d.id::text,d.name,d.code,count(t.id)::int as tasks,count(t.id) filter(where t.status='completed')::int as completed,count(t.id) filter(where t.due_at<now() and t.status not in ('completed','rejected'))::int as delayed,coalesce(round(avg(t.progress),2),0)::float as progress
    from marketing.departments d left join marketing.tasks t on t.department_id=d.id left join marketing.campaigns c on c.id=t.campaign_id
    where d.is_active=true and (c.id is null or (c.is_deleted=false and c.archived_at is null and (${from}='' or c.created_at::date>=${from}::date) and (${to}='' or c.created_at::date<=${to}::date) and ${scope}))
    group by d.id order by d.sort_order,d.name
  `;
  const userRows = await sql`
    select u.id::text,u.full_name,d.name as department_name,count(t.id)::int as tasks,count(t.id) filter(where t.status='completed')::int as completed,count(t.id) filter(where t.due_at<now() and t.status not in ('completed','rejected'))::int as delayed,coalesce(round(avg(t.progress),2),0)::float as progress,min(t.due_at) filter(where t.status not in ('completed','rejected')) as nearest_due,max(t.received_at) as last_received
    from core.users u join marketing.tasks t on t.assigned_to=u.id join marketing.campaigns c on c.id=t.campaign_id left join marketing.departments d on d.id=t.department_id
    where c.is_deleted=false and c.archived_at is null and (${from}='' or c.created_at::date>=${from}::date) and (${to}='' or c.created_at::date<=${to}::date) and ${scope}
    group by u.id,d.name order by completed desc,u.full_name
  `;
  return { ok: true, summary: summary || {}, departments: departmentRows, users: userRows };
}

async function attendance(sql: ReturnType<typeof getSql>, request: VercelRequest, user: SessionUser) {
  const date = clean(request.query.date) || new Date().toISOString().slice(0, 10);
  const from = clean(request.query.from) || date;
  const to = clean(request.query.to) || date;
  const [settings] = await sql`select work_start_time::text,work_end_time::text,grace_minutes,idle_after_minutes,offline_after_minutes from marketing.attendance_settings where id='default'`;
  const todayRows = await sql`select ar.id::text,ar.user_id::text,u.full_name,u.email,ar.attendance_date,ar.check_in_at,ar.check_out_at,ar.status,ar.late_minutes,ar.work_minutes,p.last_seen_at,p.last_activity_at,p.last_page from marketing.attendance_records ar join core.users u on u.id=ar.user_id left join marketing.presence_status p on p.user_id=ar.user_id where ar.attendance_date=${date}::date order by ar.check_in_at`;
  const reportRows = can(user, "marketing.attendance.manage") ? await sql`select ar.id::text,ar.user_id::text,u.full_name,u.email,ar.attendance_date,ar.check_in_at,ar.check_out_at,ar.status,ar.late_minutes,ar.work_minutes from marketing.attendance_records ar join core.users u on u.id=ar.user_id where ar.attendance_date between ${from}::date and ${to}::date order by ar.attendance_date desc,u.full_name` : await sql`select ar.id::text,ar.user_id::text,u.full_name,u.email,ar.attendance_date,ar.check_in_at,ar.check_out_at,ar.status,ar.late_minutes,ar.work_minutes from marketing.attendance_records ar join core.users u on u.id=ar.user_id where ar.user_id=${user.id}::uuid and ar.attendance_date between ${from}::date and ${to}::date order by ar.attendance_date desc`;
  const [myRecord] = await sql`select id::text,user_id::text,attendance_date,check_in_at,check_out_at,status,late_minutes,work_minutes from marketing.attendance_records where user_id=${user.id}::uuid and attendance_date=current_date`;
  return { ok: true, settings, todayRows, reportRows, myRecord: myRecord || null };
}

async function attendanceAction(sql: ReturnType<typeof getSql>, body: Record<string, unknown>, user: SessionUser) {
  const attendanceAction = clean(body.attendanceAction);
  if (attendanceAction === "presence") {
    await sql`insert into marketing.presence_status(user_id,last_seen_at,last_activity_at,last_page,activity_type,device_info,updated_at) values(${user.id}::uuid,now(),now(),${textOrNull(body.lastPage)},${textOrNull(body.activityType)},${sql.json(toDatabaseJson(body.deviceInfo))},now()) on conflict(user_id) do update set last_seen_at=now(),last_activity_at=now(),last_page=excluded.last_page,activity_type=excluded.activity_type,device_info=excluded.device_info,updated_at=now()`;
    return { ok: true };
  }
  const [settings] = await sql`select work_start_time::text,work_end_time::text,grace_minutes from marketing.attendance_settings where id='default'`;
  if (attendanceAction === "check_in") {
    const [row] = await sql`
      insert into marketing.attendance_records(user_id,attendance_date,check_in_at,status,late_minutes,source,metadata)
      values(${user.id}::uuid,current_date,now(),case when localtime>(${settings.work_start_time}::time + (${settings.grace_minutes}::text || ' minutes')::interval) then 'late' else 'present' end,greatest(0,extract(epoch from(localtime-${settings.work_start_time}::time))/60::numeric-${settings.grace_minutes})::int,'marketing_system',${sql.json(toDatabaseJson(body.deviceInfo))})
      on conflict(user_id,attendance_date) do update set check_in_at=coalesce(marketing.attendance_records.check_in_at,excluded.check_in_at),status=case when marketing.attendance_records.check_in_at is null then excluded.status else marketing.attendance_records.status end,late_minutes=case when marketing.attendance_records.check_in_at is null then excluded.late_minutes else marketing.attendance_records.late_minutes end,updated_at=now()
      returning id::text,attendance_date,check_in_at,check_out_at,status,late_minutes,work_minutes
    `;
    return { ok: true, row, message: "تم تسجيل الحضور" };
  }
  if (attendanceAction === "check_out") {
    const [row] = await sql`update marketing.attendance_records set check_out_at=now(),status='checked_out',work_minutes=greatest(0,extract(epoch from(now()-check_in_at))/60)::int,updated_at=now() where user_id=${user.id}::uuid and attendance_date=current_date and check_in_at is not null returning id::text,attendance_date,check_in_at,check_out_at,status,late_minutes,work_minutes`;
    if (!row) throw new Error("يجب تسجيل الحضور أولًا");
    return { ok: true, row, message: "تم تسجيل الانصراف" };
  }
  throw new Error("إجراء الحضور غير صحيح");
}

async function connections(sql: ReturnType<typeof getSql>) {
  const rows = await sql`select p.id::text as platform_id,p.code,p.name,p.sort_order,c.id::text,c.connection_status,c.account_name,c.account_external_id,c.token_status,c.settings,c.connected_at,c.updated_at from marketing.platforms p left join marketing.platform_connections c on c.platform_id=p.id where p.is_active=true order by p.sort_order,p.name`;
  return { ok: true, rows };
}

async function saveConnection(sql: ReturnType<typeof getSql>, body: Record<string, unknown>, user: SessionUser) {
  const platformId = clean(body.platformId);
  const [row] = await sql`insert into marketing.platform_connections(platform_id,connection_status,account_name,account_external_id,token_status,settings,connected_by,connected_at,updated_at) values(${platformId}::uuid,${clean(body.connectionStatus) || "disconnected"},${textOrNull(body.accountName)},${textOrNull(body.accountExternalId)},${textOrNull(body.tokenStatus)},${sql.json(toDatabaseJson(body.settings))},${user.id}::uuid,case when ${clean(body.connectionStatus)}='connected' then now() else null end,now()) on conflict(platform_id) do update set connection_status=excluded.connection_status,account_name=excluded.account_name,account_external_id=excluded.account_external_id,token_status=excluded.token_status,settings=excluded.settings,connected_by=excluded.connected_by,connected_at=excluded.connected_at,updated_at=now() returning id::text,platform_id::text,connection_status,account_name,account_external_id,token_status,settings,connected_at,updated_at`;
  return { ok: true, row, message: "تم حفظ حالة ربط المنصة" };
}

async function settingsAction(sql: ReturnType<typeof getSql>, body: Record<string, unknown>, user: SessionUser) {
  const entity = clean(body.entity);
  const operation = clean(body.operation) || "save";
  const id = clean(body.id);
  if (entity === "department") {
    if (operation === "delete") { await sql`update marketing.departments set is_active=false,updated_at=now() where id=${id}::uuid`; return { ok: true, message: "تم تعطيل القسم" }; }
    const code = clean(body.code).toLowerCase().replace(/[^a-z0-9_]+/g, "_"); const name = clean(body.name);
    if (!code || !name) throw new Error("كود واسم القسم مطلوبان");
    if (bool(body.isContentDepartment)) await sql`update marketing.departments set is_content_department=false where is_content_department=true`;
    const [row] = id ? await sql`update marketing.departments set code=${code},name=${name},is_content_department=${bool(body.isContentDepartment)},is_active=${body.isActive !== false},sort_order=${numberValue(body.sortOrder)},updated_at=now() where id=${id}::uuid returning id::text` : await sql`insert into marketing.departments(code,name,is_content_department,is_active,sort_order) values(${code},${name},${bool(body.isContentDepartment)},${body.isActive !== false},${numberValue(body.sortOrder)}) returning id::text`;
    return { ok: true, row, message: "تم حفظ القسم" };
  }
  if (entity === "department_users") {
    const departmentId = clean(body.departmentId); const userIds = [...new Set(stringList(body.userIds))];
    await sql.begin(async (tx) => { await tx`delete from marketing.department_users where department_id=${departmentId}::uuid`; for (const userId of userIds) await tx`insert into marketing.department_users(department_id,user_id) values(${departmentId}::uuid,${userId}::uuid)`; });
    return { ok: true, message: "تم تحديث يوزرات القسم" };
  }
  if (entity === "action") {
    if (operation === "delete") { await sql`update marketing.assignment_actions set is_active=false,updated_at=now() where id=${id}::uuid`; return { ok: true, message: "تم تعطيل الإجراء" }; }
    const departmentId = clean(body.departmentId); const name = clean(body.name); const percentage = numberValue(body.percentage);
    if (!departmentId || !name || percentage < 0 || percentage > 100) throw new Error("بيانات الإجراء أو النسبة غير صحيحة");
    const [row] = id ? await sql`update marketing.assignment_actions set department_id=${departmentId}::uuid,name=${name},percentage=${percentage},audience=${clean(body.audience) || "user"},is_required=${body.isRequired !== false},is_active=${body.isActive !== false},sort_order=${numberValue(body.sortOrder)},updated_at=now() where id=${id}::uuid returning id::text` : await sql`insert into marketing.assignment_actions(department_id,name,percentage,audience,is_required,is_active,sort_order) values(${departmentId}::uuid,${name},${percentage},${clean(body.audience) || "user"},${body.isRequired !== false},${body.isActive !== false},${numberValue(body.sortOrder)}) returning id::text`;
    return { ok: true, row, message: "تم حفظ إجراء التكليف" };
  }
  if (entity === "creative_type") {
    if (operation === "delete") { await sql`update marketing.creative_types set is_active=false,updated_at=now() where id=${id}::uuid`; return { ok: true, message: "تم تعطيل الكرييتيف" }; }
    const name = clean(body.name); const shortCode = clean(body.shortCode); const departmentId = clean(body.primaryDepartmentId);
    if (!name || !shortCode || !departmentId) throw new Error("اسم الكرييتيف والكود والقسم الأساسي مطلوبة");
    const [row] = id ? await sql`update marketing.creative_types set name=${name},short_code=${shortCode},primary_department_id=${departmentId}::uuid,is_active=${body.isActive !== false},sort_order=${numberValue(body.sortOrder)},updated_at=now() where id=${id}::uuid returning id::text` : await sql`insert into marketing.creative_types(name,short_code,primary_department_id,is_active,sort_order) values(${name},${shortCode},${departmentId}::uuid,${body.isActive !== false},${numberValue(body.sortOrder)}) returning id::text`;
    return { ok: true, row, message: "تم حفظ الكرييتيف" };
  }
  if (entity === "campaign_type") {
    if (operation === "delete") { await sql`update marketing.campaign_types set is_active=false,updated_at=now() where id=${id}::uuid`; return { ok: true, message: "تم تعطيل نوع الحملة" }; }
    const name = clean(body.name); const shortCode = clean(body.shortCode); const prefix = clean(body.codePrefix) || "MZJ";
    if (!name || !shortCode) throw new Error("اسم وكود نوع الحملة مطلوبان");
    const [row] = id ? await sql`update marketing.campaign_types set name=${name},short_code=${shortCode},code_prefix=${prefix},is_active=${body.isActive !== false},sort_order=${numberValue(body.sortOrder)},updated_at=now() where id=${id}::uuid returning id::text` : await sql`insert into marketing.campaign_types(name,short_code,code_prefix,is_active,sort_order) values(${name},${shortCode},${prefix},${body.isActive !== false},${numberValue(body.sortOrder)}) returning id::text`;
    return { ok: true, row, message: "تم حفظ نوع الحملة" };
  }
  if (entity === "platform") {
    if (operation === "delete") { await sql`update marketing.platforms set is_active=false,updated_at=now() where id=${id}::uuid`; return { ok: true, message: "تم تعطيل المنصة" }; }
    const code = clean(body.code).toLowerCase().replace(/[^a-z0-9_]+/g, "_"); const name = clean(body.name);
    if (!code || !name) throw new Error("كود واسم المنصة مطلوبان");
    const [row] = id ? await sql`update marketing.platforms set code=${code},name=${name},is_active=${body.isActive !== false},sort_order=${numberValue(body.sortOrder)},updated_at=now() where id=${id}::uuid returning id::text` : await sql`insert into marketing.platforms(code,name,is_active,sort_order) values(${code},${name},${body.isActive !== false},${numberValue(body.sortOrder)}) returning id::text`;
    return { ok: true, row, message: "تم حفظ المنصة" };
  }
  if (entity === "post_type") {
    if (operation === "delete") { await sql`update marketing.platform_post_types set is_active=false,updated_at=now() where id=${id}::uuid`; return { ok: true, message: "تم تعطيل نوع النشر" }; }
    const platformId = clean(body.platformId); const code = clean(body.code); const name = clean(body.name);
    if (!platformId || !code || !name) throw new Error("المنصة واسم وكود نوع النشر مطلوبة");
    const [row] = id ? await sql`update marketing.platform_post_types set platform_id=${platformId}::uuid,name=${name},code=${code},dimensions=${textOrNull(body.dimensions)},is_active=${body.isActive !== false},sort_order=${numberValue(body.sortOrder)},updated_at=now() where id=${id}::uuid returning id::text` : await sql`insert into marketing.platform_post_types(platform_id,name,code,dimensions,is_active,sort_order) values(${platformId}::uuid,${name},${code},${textOrNull(body.dimensions)},${body.isActive !== false},${numberValue(body.sortOrder)}) returning id::text`;
    return { ok: true, row, message: "تم حفظ نوع النشر" };
  }
  if (entity === "category") {
    if (operation === "delete") { await sql`update marketing.package_categories set is_active=false,updated_at=now() where id=${id}::uuid`; return { ok: true, message: "تم تعطيل التصنيف" }; }
    const name = clean(body.name); if (!name) throw new Error("اسم التصنيف مطلوب");
    const [row] = id ? await sql`update marketing.package_categories set name=${name},is_active=${body.isActive !== false},sort_order=${numberValue(body.sortOrder)},updated_at=now() where id=${id}::uuid returning id::text` : await sql`insert into marketing.package_categories(name,is_active,sort_order) values(${name},${body.isActive !== false},${numberValue(body.sortOrder)}) returning id::text`;
    return { ok: true, row, message: "تم حفظ تصنيف الباقة" };
  }
  if (entity === "request_status") {
    if (operation === "delete") { await sql`update marketing.request_statuses set is_active=false,updated_at=now() where id=${id}::uuid`; return { ok: true, message: "تم تعطيل حالة الطلب" }; }
    const code = clean(body.code).toLowerCase().replace(/[^a-z0-9_]+/g, "_"); const name = clean(body.name);
    if (!code || !name) throw new Error("كود واسم الحالة مطلوبان");
    const [row] = id ? await sql`update marketing.request_statuses set code=${code},name=${name},is_terminal=${bool(body.isTerminal)},is_active=${body.isActive !== false},sort_order=${numberValue(body.sortOrder)},updated_at=now() where id=${id}::uuid returning id::text` : await sql`insert into marketing.request_statuses(code,name,is_terminal,is_active,sort_order) values(${code},${name},${bool(body.isTerminal)},${body.isActive !== false},${numberValue(body.sortOrder)}) returning id::text`;
    return { ok: true, row, message: "تم حفظ حالة الطلب" };
  }
  if (entity === "attendance_settings") {
    const [row] = await sql`update marketing.attendance_settings set work_start_time=${clean(body.workStartTime) || "16:00"}::time,work_end_time=${clean(body.workEndTime) || "21:00"}::time,grace_minutes=${Math.max(0,numberValue(body.graceMinutes))},idle_after_minutes=${Math.max(1,numberValue(body.idleAfterMinutes,5))},offline_after_minutes=${Math.max(2,numberValue(body.offlineAfterMinutes,10))},updated_by=${user.id}::uuid,updated_at=now() where id='default' returning work_start_time::text,work_end_time::text,grace_minutes,idle_after_minutes,offline_after_minutes`;
    return { ok: true, row, message: "تم حفظ مواعيد الدوام" };
  }
  throw new Error("نوع إعداد التسويق غير مدعوم");
}

async function prepareUpload(body: Record<string, unknown>) {
  if (!mediaStorageConfigured()) throw new Error("تخزين الملفات R2 غير مضبوط في متغيرات البيئة");
  const scope = clean(body.scope) || "task";
  const entityId = clean(body.entityId);
  const fileName = clean(body.fileName);
  if (!entityId || !fileName) throw new Error("معرّف السجل واسم الملف مطلوبان");
  const storageKey = marketingStorageKey(scope, entityId, fileName);
  return { ok: true, storageKey, uploadUrl: createUploadUrl(storageKey, 900), expiresIn: 900 };
}

async function registerUpload(sql: ReturnType<typeof getSql>, body: Record<string, unknown>, user: SessionUser) {
  const scope = clean(body.scope);
  const entityId = clean(body.entityId);
  const fileName = clean(body.fileName);
  const storageKey = textOrNull(body.storageKey);
  const externalUrl = textOrNull(body.externalUrl);
  if (!entityId || !fileName || (!storageKey && !externalUrl)) throw new Error("بيانات الملف غير مكتملة");
  if (scope === "task") {
    const uploadKind = clean(body.uploadKind) || "final";
    const [task] = await sql`select id::text,task_kind,assigned_to::text,received_at,status from marketing.tasks where id=${entityId}::uuid`;
    if (!task) throw new Error("التاسك غير موجود");
    if (!isAdmin(user) && task.assigned_to !== user.id) throw new Error("لا يمكنك رفع ملف داخل تاسك غير مسند إليك");
    if (!task.received_at) throw new Error("اضغط تم الاستلام قبل رفع الملفات");
    if (uploadKind === "final" && (task.task_kind !== "execution" || task.status === "waiting_template")) throw new Error("لا يمكن رفع الملف النهائي قبل اعتماد Task Template المرتبطة");
    if (uploadKind.startsWith("template") && task.task_kind !== "template") throw new Error("ملف Task Template يجب رفعه داخل تاسك المحتوى فقط");
    const [version] = await sql`select coalesce(max(version_no),0)::int+1 as next from marketing.task_uploads where task_id=${entityId}::uuid and upload_kind=${uploadKind}`;
    const [row] = await sql`insert into marketing.task_uploads(task_id,upload_kind,file_name,storage_key,external_url,mime_type,file_size,version_no,status,uploaded_by,uploaded_by_name,metadata) values(${entityId}::uuid,${uploadKind},${fileName},${storageKey},${externalUrl},${textOrNull(body.mimeType)},${numberValue(body.fileSize) || null},${version?.next || 1},'ready',${user.id}::uuid,${user.fullName},${sql.json(toDatabaseJson(body.metadata))}) returning id::text,task_id::text,upload_kind,file_name,storage_key,external_url,version_no,created_at`;
    if (uploadKind === "final") await sql`update marketing.tasks set final_file_name=${fileName},final_file_url=${externalUrl},updated_at=now() where id=${entityId}::uuid`;
    return { ok: true, row, message: "تم تسجيل الملف داخل التاسك الصحيح" };
  }
  if (scope === "project") {
    const [row] = await sql`insert into marketing.project_files(campaign_id,file_kind,file_name,storage_key,external_url,mime_type,file_size,uploaded_by,uploaded_by_name) values(${entityId}::uuid,${clean(body.fileKind) || "other"},${fileName},${storageKey},${externalUrl},${textOrNull(body.mimeType)},${numberValue(body.fileSize) || null},${user.id}::uuid,${user.fullName}) returning id::text,campaign_id::text,file_kind,file_name,storage_key,external_url,created_at`;
    return { ok: true, row, message: "تم تسجيل ملف الحملة" };
  }
  throw new Error("نطاق الملف غير صحيح");
}

async function fileDownload(sql: ReturnType<typeof getSql>, id: string, scope: string, user: SessionUser) {
  if (!mediaStorageConfigured()) throw new Error("تخزين الملفات R2 غير مضبوط");
  const access = projectScope(sql, user, "c");
  const [row] = scope === "project"
    ? await sql`select pf.id::text,pf.file_name,pf.storage_key,pf.external_url from marketing.project_files pf join marketing.campaigns c on c.id=pf.campaign_id where pf.id=${id}::uuid and c.is_deleted=false and ${access}`
    : await sql`select up.id::text,up.file_name,up.storage_key,up.external_url from marketing.task_uploads up join marketing.tasks t on t.id=up.task_id join marketing.campaigns c on c.id=t.campaign_id where up.id=${id}::uuid and c.is_deleted=false and ${access}`;
  if (!row) throw new Error("الملف غير موجود");
  return { ok: true, fileName: row.file_name, url: row.external_url || (row.storage_key ? createDownloadUrl(row.storage_key, 300) : null) };
}

async function createRawFolders(sql: ReturnType<typeof getSql>, body: Record<string, unknown>, user: SessionUser) {
  const campaignId = clean(body.campaignId);
  const [project] = await sql`select id::text,campaign_code,name,source_kind from marketing.campaigns where id=${campaignId}::uuid and is_deleted=false`;
  if (!project) throw new Error("الحملة أو الأجندة غير موجودة");
  const rawApiUrl = clean(process.env.MZJ_RAW_API_URL);
  const rawApiToken = clean(process.env.MZJ_RAW_API_TOKEN);
  if (!rawApiUrl || !rawApiToken) throw new Error("أضف MZJ_RAW_API_URL وMZJ_RAW_API_TOKEN لتفعيل إنشاء فولدرات الخام");
  const creatives = await sql`select instance_no,creative_type,short_code from marketing.creatives where campaign_id=${campaignId}::uuid order by sort_order`;
  const response = await fetch(rawApiUrl, { method: "POST", headers: { "content-type": "application/json", "x-api-token": rawApiToken }, body: JSON.stringify({ campaignId, campaignCode: project.campaign_code, campaignName: project.name, sourceKind: project.source_kind, creatives }) });
  const text = await response.text();
  let result: unknown = {};
  try { result = text ? JSON.parse(text) : {}; } catch { result = { message: text }; }
  if (!response.ok) throw new Error(clean(objectValue(result).message) || "تعذر إنشاء فولدرات الخام");
  await sql`update marketing.campaigns set raw_folders_created_at=now(),updated_at=now() where id=${campaignId}::uuid`;
  await sql`insert into marketing.activity_log(actor_id,actor_name,action,entity_type,entity_id,details) values(${user.id}::uuid,${user.fullName},'raw_folders_created','project',${campaignId},${sql.json(toDatabaseJson(result))})`;
  return { ok: true, result, message: "تم إنشاء فولدرات الخام والتسليم" };
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  try {
    await ensureOperationsSchema();
    await ensureMarketingSchema();
    const user = await requireUser(request, response);
    if (!user) return;
    if (!isAdmin(user) && !user.permissions.some((permission) => permission === "marketing.view" || permission.startsWith("marketing."))) {
      return response.status(403).json({ ok: false, error: "لا توجد صلاحية لفتح نظام التسويق" });
    }
    const sql = getSql();
    const resource = clean(request.query.resource) || "meta";

    if (request.method === "GET") {
      if (resource === "meta") return response.status(200).json(await loadMeta(sql, user));
      if (resource === "dashboard") return response.status(200).json(await dashboard(sql, user));
      if (resource === "projects") return response.status(200).json(await listProjects(sql, request, user));
      if (resource === "project") { const detail = await projectDetail(sql, clean(request.query.id), user); return detail ? response.status(200).json({ ok: true, ...detail }) : response.status(404).json({ ok: false, error: "الحملة أو الأجندة غير موجودة" }); }
      if (resource === "packages") return response.status(200).json(await packages(sql, request));
      if (resource === "stock") { if (!requirePermission(user, response, "marketing.stock.view")) return; return response.status(200).json(await stock(sql, request)); }
      if (resource === "photo_requests") { if (!requireAnyPermission(user, response, ["marketing.photo_request.create", "marketing.photo_request.manage"])) return; return response.status(200).json(await photoRequests(sql, request, user)); }
      if (resource === "calendar") return response.status(200).json(await calendar(sql, request, user));
      if (resource === "publish_prep") { if (!requireAnyPermission(user, response, ["marketing.publish.manage", "marketing.task.execute", "marketing.project.edit"])) return; return response.status(200).json(await publishPrep(sql, request, user)); }
      if (resource === "reports") { if (!requirePermission(user, response, "marketing.reports.view")) return; return response.status(200).json(await reports(sql, request, user)); }
      if (resource === "attendance") { if (!requireAnyPermission(user, response, ["marketing.attendance.use", "marketing.attendance.manage"])) return; return response.status(200).json(await attendance(sql, request, user)); }
      if (resource === "connections") { if (!requirePermission(user, response, "marketing.connections.manage")) return; return response.status(200).json(await connections(sql)); }
      if (resource === "file") return response.status(200).json(await fileDownload(sql, clean(request.query.id), clean(request.query.scope), user));
      return response.status(404).json({ ok: false, error: "المورد المطلوب غير موجود" });
    }

    if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
    const body = parseBody(request);
    const action = clean(body.action);
    let result: unknown;
    if (action === "create_project") { if (!requirePermission(user, response, "marketing.project.create")) return; result = await createProject(sql, body, user); }
    else if (action === "receive_task") { if (!requirePermission(user, response, "marketing.task.receive")) return; result = await receiveTask(sql, body, user); }
    else if (action === "submit_template") { if (!requirePermission(user, response, "marketing.template.upload")) return; result = await submitTemplate(sql, body, user); }
    else if (action === "review_template") { if (!requirePermission(user, response, "marketing.template.review")) return; result = await reviewTemplate(sql, body, user); }
    else if (action === "task_action") { if (!requirePermission(user, response, "marketing.task.execute")) return; result = await taskAction(sql, body, user); }
    else if (action === "move_to_publish") { if (!requirePermission(user, response, "marketing.publish.manage")) return; result = await moveToPublish(sql, clean(body.id), user); }
    else if (action === "project_state") { const permission = clean(body.stateAction) === "delete" ? "marketing.project.delete" : "marketing.project.archive"; if (!requirePermission(user, response, permission)) return; result = await projectStateAction(sql, body, user); }
    else if (action === "update_project") { if (!requirePermission(user, response, "marketing.project.edit")) return; result = await updateProject(sql, body, user); }
    else if (action === "save_project_link") { if (!requirePermission(user, response, "marketing.project.edit")) return; result = await saveProjectLink(sql, body, user); }
    else if (action === "save_package") { if (!requirePermission(user, response, "marketing.package.manage")) return; result = await savePackage(sql, body, user); }
    else if (action === "delete_package") { if (!requirePermission(user, response, "marketing.package.manage")) return; result = await deletePackage(sql, clean(body.id)); }
    else if (action === "create_photo_request") { if (!requirePermission(user, response, "marketing.photo_request.create")) return; result = await createPhotoRequest(sql, body, user); }
    else if (action === "update_photo_request") { if (!requirePermission(user, response, "marketing.photo_request.manage")) return; result = await updatePhotoRequest(sql, body, user); }
    else if (action === "attendance_action") { if (!requirePermission(user, response, "marketing.attendance.use")) return; result = await attendanceAction(sql, body, user); }
    else if (action === "save_connection") { if (!requirePermission(user, response, "marketing.connections.manage")) return; result = await saveConnection(sql, body, user); }
    else if (action === "settings_action") { if (!requirePermission(user, response, "marketing.settings.manage")) return; result = await settingsAction(sql, body, user); }
    else if (action === "prepare_upload") {
      const scope = clean(body.scope);
      const uploadKind = clean(body.uploadKind);
      const permission = scope === "project" ? "marketing.project.edit" : uploadKind === "final" ? "marketing.task.execute" : "marketing.template.upload";
      if (!requirePermission(user, response, permission)) return;
      result = await prepareUpload(body);
    }
    else if (action === "register_upload") {
      const scope = clean(body.scope);
      const uploadKind = clean(body.uploadKind);
      const permission = scope === "project" ? "marketing.project.edit" : uploadKind === "final" ? "marketing.task.execute" : "marketing.template.upload";
      if (!requirePermission(user, response, permission)) return;
      result = await registerUpload(sql, body, user);
    }
    else if (action === "create_raw_folders") { if (!requirePermission(user, response, "marketing.project.create")) return; result = await createRawFolders(sql, body, user); }
    else return response.status(400).json({ ok: false, error: "الإجراء غير مدعوم" });
    return response.status(200).json(result);
  } catch (error) {
    console.error("Marketing API failed", error);
    const message = error instanceof Error ? error.message : "تعذر تنفيذ العملية داخل نظام التسويق";
    return response.status(500).json({ ok: false, error: message });
  }
}
