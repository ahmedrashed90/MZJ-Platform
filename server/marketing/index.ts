import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes } from "node:crypto";
import { getSql } from "../_db.js";
import { requireUser, type SessionUser } from "../_auth.js";
import { buildSystemMediaStorageKey, createDownloadUrl, createUploadUrl, mediaStorageConfigured } from "../_media-storage.js";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };
type UnknownRecord = Record<string, unknown>;
type SqlRow = Record<string, unknown>;

class MarketingError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: JsonValue) {
    super(message);
  }
}

function clean(value: unknown) { return String(value ?? "").trim(); }
function asRecord(value: unknown): UnknownRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {}; }
function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function asBoolean(value: unknown) { return value === true || value === "true" || value === 1 || value === "1"; }
function asNumber(value: unknown, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function nullableText(value: unknown) { const result = clean(value); return result || null; }
function parseBody(request: VercelRequest): UnknownRecord {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) return asRecord(request.body);
  if (typeof request.body === "string") { try { return asRecord(JSON.parse(request.body)); } catch { return {}; } }
  return {};
}
function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") {
    const result: JsonObject = {};
    for (const [key, item] of Object.entries(value as UnknownRecord)) result[key] = toJsonValue(item);
    return result;
  }
  return clean(value);
}
function isAdmin(user: SessionUser) { return user.roleCodes.some((code) => ["admin", "system_admin"].includes(code)); }
function hasPermission(user: SessionUser, permission: string) { return isAdmin(user) || user.permissions.includes(permission); }
function canViewMarketing(user: SessionUser) {
  return isAdmin(user)
    || user.departmentCodes.includes("marketing")
    || user.permissions.some((permission) => permission.startsWith("marketing."));
}
function requirePermission(user: SessionUser, permission: string) {
  if (!hasPermission(user, permission)) throw new MarketingError(403, "FORBIDDEN", "لا تملك صلاحية تنفيذ هذا الإجراء");
}
function ensureUuid(value: unknown, label: string) {
  const text = clean(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new MarketingError(400, "VALIDATION_ERROR", `${label} غير صحيح`);
  return text;
}
function dateOnly(value: unknown, label: string, required = false) {
  const text = clean(value);
  if (!text && !required) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new MarketingError(400, "VALIDATION_ERROR", `${label} غير صحيح`);
  return text;
}
function pageValues(request: VercelRequest) {
  const page = Math.max(1, Math.floor(asNumber(request.query.page, 1)));
  const pageSize = Math.max(1, Math.min(500, Math.floor(asNumber(request.query.pageSize, 50))));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
function userCanSeeTask(user: SessionUser, row: SqlRow) {
  return isAdmin(user) || hasPermission(user, "marketing.templates.review") || clean(row.assigned_to) === user.id;
}
function randomAgendaSuffix() { return randomBytes(5).toString("base64url").replace(/[^A-Z0-9]/gi, "").slice(0, 6).toUpperCase().padEnd(6, "X"); }

async function assertSchema() {
  const sql = getSql();
  const [row] = await sql<{ ready: boolean }[]>`select to_regclass('marketing.departments') is not null and to_regclass('marketing.creative_instances') is not null and to_regclass('marketing.template_submissions') is not null as ready`;
  if (!row?.ready) throw new MarketingError(503, "MARKETING_SCHEMA_REQUIRED", "شغّل ملف database/marketing_native_rebuild.sql أولًا");
}

async function loadMeta(user: SessionUser) {
  const sql = getSql();
  const [departments, creatives, campaignTypes, funnels, platforms, requestStatuses, packageCategories, users] = await Promise.all([
    sql<SqlRow[]>`
      select d.id::text,d.code,d.name,d.is_content,d.is_active,d.sort_order,
        coalesce((select json_agg(json_build_object('id',u.id::text,'full_name',u.full_name,'email',u.email,'sort_order',du.sort_order) order by du.sort_order,u.full_name)
          from marketing.department_users du join core.users u on u.id=du.user_id and u.is_active=true where du.department_id=d.id),'[]') as users,
        coalesce((select json_agg(json_build_object('id',a.id::text,'name',a.name,'progress_percent',a.progress_percent,'admin_only',a.admin_only,'is_active',a.is_active,'sort_order',a.sort_order) order by a.sort_order,a.name)
          from marketing.assignment_actions a where a.department_id=d.id),'[]') as actions
      from marketing.departments d order by d.sort_order,d.name
    `,
    sql<SqlRow[]>`select c.id::text,c.name,c.short_code,c.primary_department_id::text,d.name as primary_department_name,c.is_active,c.sort_order from marketing.creative_catalog c join marketing.departments d on d.id=c.primary_department_id order by c.sort_order,c.name`,
    sql<SqlRow[]>`select id::text,name,code_prefix,is_active,sort_order from marketing.campaign_types order by sort_order,name`,
    sql<SqlRow[]>`select id::text,name,is_active,sort_order from marketing.funnels order by sort_order,name`,
    sql<SqlRow[]>`
      select p.id::text,p.code,p.name,p.is_active,p.sort_order,
        coalesce((select json_agg(json_build_object('id',t.id::text,'name',t.name,'width',t.width,'height',t.height,'is_active',t.is_active,'sort_order',t.sort_order) order by t.sort_order,t.name) from marketing.platform_post_types t where t.platform_id=p.id),'[]') as post_types
      from marketing.platforms p order by p.sort_order,p.name
    `,
    sql<SqlRow[]>`select id::text,code,name,is_terminal,is_active,sort_order from marketing.request_statuses order by sort_order,name`,
    sql<SqlRow[]>`select id::text,name,is_active,sort_order from marketing.package_categories order by sort_order,name`,
    sql<SqlRow[]>`select u.id::text,u.full_name,u.email,u.can_receive_tasks,coalesce(array_agg(distinct d.code) filter(where d.id is not null),'{}') as department_codes from core.users u left join core.user_departments ud on ud.user_id=u.id left join core.departments d on d.id=ud.department_id where u.is_active=true group by u.id order by u.full_name`,
  ]);
  return {
    ok: true,
    departments,
    creatives,
    campaignTypes,
    funnels,
    platforms,
    requestStatuses,
    packageCategories,
    users,
    permissions: {
      isAdmin: isAdmin(user),
      canView: canViewMarketing(user),
      canManage: hasPermission(user, "marketing.manage"),
      canManageSettings: hasPermission(user, "marketing.settings.manage"),
      canReviewTemplates: hasPermission(user, "marketing.templates.review"),
      canExecuteTasks: hasPermission(user, "marketing.tasks.execute"),
      canManagePackages: hasPermission(user, "marketing.packages.manage"),
      canManageRequests: hasPermission(user, "marketing.requests.manage"),
    },
  };
}

async function campaignCodePreview(request: VercelRequest) {
  const sql = getSql();
  const campaignTypeId = ensureUuid(request.query.campaignTypeId, "نوع الحملة");
  const campaignDate = dateOnly(request.query.campaignDate, "تاريخ الحملة", true) as string;
  const [type] = await sql<SqlRow[]>`select code_prefix from marketing.campaign_types where id=${campaignTypeId}::uuid and is_active=true`;
  if (!type) throw new MarketingError(404, "NOT_FOUND", "نوع الحملة غير متاح");
  const baseCode = `${clean(type.code_prefix).toUpperCase()}-${campaignDate.slice(0, 7)}`;
  const [counter] = await sql<{ last_sequence: number }[]>`select last_sequence from marketing.campaign_code_counters where base_code=${baseCode}`;
  const sequence = Math.max(1, Math.floor(asNumber(counter?.last_sequence, 0)) + 1);
  return { ok: true, campaignCode: sequence === 1 ? baseCode : `${baseCode}-${String(sequence).padStart(2, "0")}` };
}

async function campaignRows(request: VercelRequest, user: SessionUser) {
  const sql = getSql();
  const { page, pageSize, offset } = pageValues(request);
  const search = clean(request.query.search);
  const kind = clean(request.query.kind);
  const status = clean(request.query.status);
  const from = clean(request.query.from);
  const to = clean(request.query.to);
  const archived = clean(request.query.archived) === "true";
  const pattern = `%${search}%`;
  const canSeeAll = isAdmin(user) || hasPermission(user, "marketing.manage");
  const where = sql`
    c.deleted_at is null
    and (${archived}=true and c.archived_at is not null or ${archived}=false and c.archived_at is null)
    and (${search}='' or c.name ilike ${pattern} or c.campaign_code ilike ${pattern} or coalesce(ct.name,'') ilike ${pattern})
    and (${kind}='' or c.source_kind=${kind})
    and (${status}='' or c.status=${status} or c.workflow_stage=${status})
    and (${from}='' or c.created_at::date>=${from}::date)
    and (${to}='' or c.created_at::date<=${to}::date)
    and (${canSeeAll}=true or c.created_by=${user.id}::uuid or exists(select 1 from marketing.tasks t where t.campaign_id=c.id and t.assigned_to=${user.id}::uuid))
  `;
  const [count] = await sql<{ total: number }[]>`select count(*)::int as total from marketing.campaigns c left join marketing.campaign_types ct on ct.id=c.campaign_type_id where ${where}`;
  const rows = await sql<SqlRow[]>`
    select c.id::text,c.source_kind,c.campaign_code,c.name,c.campaign_date,c.publish_start_date,c.publish_end_date,c.objective,c.content_brief,c.status,c.workflow_stage,c.created_at,c.updated_at,c.archived_at,
      ct.name as campaign_type_name,u.full_name as created_by_name,
      (select count(*)::int from marketing.creative_instances i where i.campaign_id=c.id) as instances_count,
      (select count(*)::int from marketing.tasks t where t.campaign_id=c.id) as tasks_count,
      (select count(*)::int from marketing.tasks t where t.campaign_id=c.id and t.actual_received_at is not null) as received_tasks_count,
      (select count(*)::int from marketing.tasks t where t.campaign_id=c.id and t.progress=100) as completed_tasks_count
    from marketing.campaigns c
    left join marketing.campaign_types ct on ct.id=c.campaign_type_id
    left join core.users u on u.id=c.created_by
    where ${where}
    order by c.created_at desc limit ${pageSize} offset ${offset}
  `;
  return { ok: true, rows, total: Number(count?.total || 0), page, pageSize };
}

async function taskRowsForCampaign(campaignId: string) {
  const sql = getSql();
  return sql<SqlRow[]>`
    select t.id::text,t.task_no,t.campaign_id::text,t.instance_id::text,t.task_kind,t.department_id::text,d.name as department_name,t.assigned_to::text,u.full_name as assigned_to_name,
      t.content_writer_id::text,w.full_name as content_writer_name,t.template_task_id::text,t.status,t.progress,t.due_date,t.actual_received_at,t.completed_at,t.admin_note,t.rejection_reason,t.final_file_name,t.final_storage_key,
      i.instance_code,cc.name as creative_name,cc.short_code,
      coalesce((select json_agg(json_build_object('id',a.id::text,'name',a.name,'progress_percent',a.progress_percent,'admin_only',a.admin_only,'completed_at',a.completed_at,'completed_by',a.completed_by::text) order by a.sort_order,a.name) from marketing.task_action_items a where a.task_id=t.id),'[]') as actions,
      coalesce((select json_agg(json_build_object('id',s.id::text,'version_no',s.version_no,'file_name',s.file_name,'storage_key',s.storage_key,'template_data',s.template_data,'review_status',s.review_status,'review_note',s.review_note,'submitted_at',s.submitted_at,'reviewed_at',s.reviewed_at) order by s.version_no desc) from marketing.template_submissions s where s.template_task_id=t.id),'[]') as submissions,
      coalesce((select s.template_data from marketing.template_submissions s where s.template_task_id=coalesce(t.template_task_id,t.id) and s.review_status='approved' order by s.version_no desc limit 1),'{}'::jsonb) as approved_template_data
    from marketing.tasks t
    join marketing.creative_instances i on i.id=t.instance_id
    join marketing.creative_catalog cc on cc.id=i.creative_id
    join marketing.departments d on d.id=t.department_id
    join core.users u on u.id=t.assigned_to
    join core.users w on w.id=t.content_writer_id
    where t.campaign_id=${campaignId}::uuid
    order by d.sort_order,i.sequence_no,t.task_kind,t.task_no
  `;
}

function calculateCampaignProgress(tasks: SqlRow[]) {
  const departmentGroups = new Map<string, number[]>();
  for (const task of tasks) {
    const departmentId = clean(task.department_id);
    if (!departmentId) continue;
    const values = departmentGroups.get(departmentId) || [];
    values.push(asNumber(task.progress));
    departmentGroups.set(departmentId, values);
  }
  if (!departmentGroups.size) return 0;
  let total = 0;
  for (const values of departmentGroups.values()) total += values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  return Math.round((total / departmentGroups.size) * 100) / 100;
}

async function campaignDetail(id: string, user: SessionUser) {
  const sql = getSql();
  const [campaign] = await sql<SqlRow[]>`
    select c.*,c.id::text,c.campaign_type_id::text,ct.name as campaign_type_name,u.full_name as created_by_name,
      (select count(*)::int from marketing.creative_instances i where i.campaign_id=c.id) as instances_count,
      (select count(*)::int from marketing.tasks t where t.campaign_id=c.id) as tasks_count,
      (select count(*)::int from marketing.tasks t where t.campaign_id=c.id and t.actual_received_at is not null) as received_tasks_count,
      (select count(*)::int from marketing.tasks t where t.campaign_id=c.id and t.progress=100) as completed_tasks_count
    from marketing.campaigns c left join marketing.campaign_types ct on ct.id=c.campaign_type_id left join core.users u on u.id=c.created_by
    where c.id=${id}::uuid and c.deleted_at is null
  `;
  if (!campaign) throw new MarketingError(404, "NOT_FOUND", "الحملة أو الأجندة غير موجودة");
  const canSeeAll = isAdmin(user) || hasPermission(user, "marketing.manage");
  const hasAssignedTask = Boolean((await sql`select 1 from marketing.tasks where campaign_id=${id}::uuid and assigned_to=${user.id}::uuid limit 1`)[0]);
  const canSee = canSeeAll || clean(campaign.created_by) === user.id || hasAssignedTask;
  if (!canSee) throw new MarketingError(403, "FORBIDDEN", "لا تملك صلاحية عرض هذه البيانات");
  const [allInstances, budgetItems, schedule, allTasks, links, agendaDays] = await Promise.all([
    sql<SqlRow[]>`
      select i.id::text,i.campaign_id::text,i.agenda_day_id::text,i.sequence_no,i.instance_code,i.content_received_date,i.content_notes,i.is_complete,
        i.creative_id::text,cc.name as creative_name,cc.short_code,cc.primary_department_id::text,pd.name as primary_department_name,
        ad.agenda_date,
        coalesce((select json_agg(json_build_object('user_id',w.user_id::text,'full_name',u.full_name,'due_date',w.due_date,'notes',w.notes) order by u.full_name) from marketing.instance_content_writers w join core.users u on u.id=w.user_id where w.instance_id=i.id),'[]') as writers,
        coalesce((select json_agg(json_build_object('id',x.id::text,'department_id',x.department_id::text,'department_name',d.name,'is_primary',x.is_primary,'due_date',x.due_date,'notes',x.notes,'assignments',coalesce((select json_agg(json_build_object('id',a.id::text,'executive_user_id',a.executive_user_id::text,'executive_name',eu.full_name,'content_writer_id',a.content_writer_id::text,'content_writer_name',cw.full_name,'due_date',a.due_date) order by eu.full_name,cw.full_name) from marketing.instance_assignments a join core.users eu on eu.id=a.executive_user_id join core.users cw on cw.id=a.content_writer_id where a.instance_department_id=x.id),'[]'::json)) order by x.is_primary desc,d.sort_order) from marketing.instance_departments x join marketing.departments d on d.id=x.department_id where x.instance_id=i.id),'[]') as departments,
        coalesce((select json_agg(json_build_object('id',v.id::text,'vin',v.vin,'car_name',v.car_name,'statement',v.statement,'exterior_color',v.exterior_color,'interior_color',v.interior_color,'model_year',v.model_year,'location_name',l.name) order by v.vin) from marketing.instance_vehicles iv join operations.vehicles v on v.id=iv.vehicle_id left join operations.locations l on l.id=v.location_id where iv.instance_id=i.id),'[]') as vehicles,
        coalesce((select json_agg(json_build_object('platform_id',p.id::text,'platform_name',p.name,'post_type_id',pt.id::text,'post_type_name',pt.name,'width',pt.width,'height',pt.height) order by p.sort_order,pt.sort_order) from marketing.instance_platform_posts ip join marketing.platforms p on p.id=ip.platform_id join marketing.platform_post_types pt on pt.id=ip.post_type_id where ip.instance_id=i.id),'[]') as posts
      from marketing.creative_instances i join marketing.creative_catalog cc on cc.id=i.creative_id join marketing.departments pd on pd.id=cc.primary_department_id left join marketing.agenda_days ad on ad.id=i.agenda_day_id
      where i.campaign_id=${id}::uuid order by coalesce(ad.agenda_date,date '1900-01-01'),i.sequence_no
    `,
    sql<SqlRow[]>`
      select b.id::text,b.funnel_id::text,f.name as funnel_name,b.instance_id::text,i.instance_code,cc.name as creative_name,b.ads_count,b.content_goal,b.expected_goal,b.sort_order,
        coalesce((select json_agg(json_build_object('platform_id',p.id::text,'platform_name',p.name,'amount',v.amount) order by p.sort_order) from marketing.budget_platform_values v join marketing.platforms p on p.id=v.platform_id where v.budget_item_id=b.id),'[]') as platform_values
      from marketing.budget_items b left join marketing.funnels f on f.id=b.funnel_id join marketing.creative_instances i on i.id=b.instance_id join marketing.creative_catalog cc on cc.id=i.creative_id where b.campaign_id=${id}::uuid order by b.sort_order,b.created_at
    `,
    sql<SqlRow[]>`
      select s.id::text,s.publish_date,s.instance_id::text,i.instance_code,cc.name as creative_name,
        coalesce((select json_agg(json_build_object('platform_id',p.id::text,'platform_name',p.name,'post_type_id',pt.id::text,'post_type_name',pt.name) order by p.sort_order,pt.sort_order) from marketing.publish_schedule_posts sp join marketing.platforms p on p.id=sp.platform_id join marketing.platform_post_types pt on pt.id=sp.post_type_id where sp.schedule_item_id=s.id),'[]') as posts
      from marketing.publish_schedule_items s join marketing.creative_instances i on i.id=s.instance_id join marketing.creative_catalog cc on cc.id=i.creative_id where s.campaign_id=${id}::uuid order by s.publish_date,i.sequence_no
    `,
    taskRowsForCampaign(id),
    sql<SqlRow[]>`select l.id::text,l.url,l.created_at,l.platform_id::text,p.name as platform_name from marketing.campaign_links l join marketing.platforms p on p.id=l.platform_id where l.campaign_id=${id}::uuid order by l.created_at desc`,
    sql<SqlRow[]>`select id::text,agenda_date,sort_order from marketing.agenda_days where campaign_id=${id}::uuid order by agenda_date`,
  ]);
  const progress = calculateCampaignProgress(allTasks);
  if (canSeeAll || clean(campaign.created_by) === user.id) {
    return { ok: true, campaign, instances: allInstances, budgetItems, schedule, tasks: allTasks, links, agendaDays, progress };
  }
  const tasks = allTasks.filter((task) => clean(task.assigned_to) === user.id);
  const visibleInstanceIds = new Set(tasks.map((task) => clean(task.instance_id)).filter(Boolean));
  const linkedWriterIds = new Set(tasks.map((task) => clean(task.content_writer_id)).filter(Boolean));
  const instances = allInstances
    .filter((instance) => visibleInstanceIds.has(clean(instance.id)))
    .map((instance) => {
      const writers = asArray(instance.writers).map(asRecord).filter((writer) => linkedWriterIds.has(clean(writer.user_id)));
      const departments = asArray(instance.departments).map(asRecord).map((department) => {
        const assignments = asArray(department.assignments).map(asRecord).filter((assignment) => clean(assignment.executive_user_id) === user.id || clean(assignment.content_writer_id) === user.id);
        return { ...department, assignments };
      }).filter((department) => asArray(department.assignments).length > 0);
      return { ...instance, writers, departments };
    });
  return { ok: true, campaign, instances, budgetItems, schedule, tasks, links, agendaDays, progress };
}

async function dashboard(user: SessionUser) {
  const sql = getSql();
  const canReview = isAdmin(user) || hasPermission(user, "marketing.templates.review");
  const canSeeAll = isAdmin(user) || hasPermission(user, "marketing.manage");
  const taskRows = await sql<SqlRow[]>`
    select t.id::text,t.task_no,t.campaign_id::text,t.instance_id::text,t.task_kind,t.department_id::text,d.name as department_name,t.assigned_to::text,u.full_name as assigned_to_name,t.content_writer_id::text,w.full_name as content_writer_name,t.template_task_id::text,t.status,t.progress,t.due_date,t.actual_received_at,t.completed_at,t.final_file_name,t.final_storage_key,
      c.source_kind,c.campaign_code,c.name as campaign_name,c.workflow_stage,c.status as campaign_status,i.instance_code,cc.name as creative_name,cc.short_code,
      exists(select 1 from marketing.template_submissions s where s.template_task_id=t.id and s.review_status='pending') as has_pending_submission,
      coalesce((select s.template_data from marketing.template_submissions s where s.template_task_id=coalesce(t.template_task_id,t.id) and s.review_status='approved' order by s.version_no desc limit 1),'{}'::jsonb) as approved_template_data,
      coalesce((select array_agg(distinct ip.platform_id::text) from marketing.instance_platform_posts ip where ip.instance_id=i.id),'{}') as platform_ids,
      coalesce((select json_agg(json_build_object('platform_id',p.id::text,'platform_name',p.name,'post_type_id',pt.id::text,'post_type_name',pt.name) order by p.sort_order,pt.sort_order) from marketing.instance_platform_posts ip join marketing.platforms p on p.id=ip.platform_id join marketing.platform_post_types pt on pt.id=ip.post_type_id where ip.instance_id=i.id),'[]') as publishing_posts,
      coalesce((select array_agg(distinct ps.publish_date::text order by ps.publish_date::text) from marketing.publish_schedule_items ps where ps.instance_id=i.id),'{}') as publish_dates
    from marketing.tasks t join marketing.campaigns c on c.id=t.campaign_id and c.deleted_at is null and c.archived_at is null
    join marketing.creative_instances i on i.id=t.instance_id join marketing.creative_catalog cc on cc.id=i.creative_id join marketing.departments d on d.id=t.department_id join core.users u on u.id=t.assigned_to join core.users w on w.id=t.content_writer_id
    where (${canSeeAll}=true or t.assigned_to=${user.id}::uuid or (${canReview}=true and t.task_kind='template'))
    order by d.sort_order,c.created_at desc,i.sequence_no,t.task_no
  `;
  const visibleTasks: SqlRow[] = taskRows.filter((row: SqlRow) => userCanSeeTask(user, row));
  const campaignIds: string[] = [...new Set(visibleTasks.map((row: SqlRow) => clean(row.campaign_id)).filter(Boolean))];
  const campaignCards: JsonObject[] = [];
  for (const campaignId of campaignIds) {
    const fullCampaignTasks = canSeeAll ? visibleTasks.filter((row: SqlRow) => clean(row.campaign_id) === campaignId) : await taskRowsForCampaign(campaignId);
    const visibleCampaignTasks = visibleTasks.filter((row: SqlRow) => clean(row.campaign_id) === campaignId);
    const sample = visibleCampaignTasks[0] || fullCampaignTasks[0] || {};
    const hasReceivedTask = fullCampaignTasks.some((row: SqlRow) => Boolean(row.actual_received_at));
    campaignCards.push({
      id: campaignId,
      name: clean(sample.campaign_name),
      code: clean(sample.campaign_code),
      sourceKind: clean(sample.source_kind),
      workflowStage: clean(sample.workflow_stage),
      progress: calculateCampaignProgress(fullCampaignTasks),
      taskCount: fullCampaignTasks.length,
      departmentCount: new Set(fullCampaignTasks.map((row: SqlRow) => clean(row.department_id))).size,
      hasReceivedTask,
    });
  }
  return {
    ok: true,
    tasks: visibleTasks,
    required: visibleTasks.filter((row: SqlRow) => !row.actual_received_at && clean(row.status) !== "completed"),
    readiness: campaignCards.filter((item) => clean(item.workflowStage) !== "publishing" && item.hasReceivedTask === true),
    publishing: campaignCards.filter((item) => clean(item.workflowStage) === "publishing"),
  };
}

async function stockRows(request: VercelRequest) {
  const sql = getSql();
  const search = clean(request.query.search);
  const pattern = `%${search}%`;
  const rows = await sql<SqlRow[]>`
    select v.id::text,v.vin,v.car_name,v.statement,v.exterior_color,v.interior_color,v.model_year,v.status_code,s.name as status_name,l.id::text as location_id,l.name as location_name
    from operations.vehicles v left join operations.locations l on l.id=v.location_id left join operations.vehicle_statuses s on s.code=v.status_code
    where v.is_deleted=false and v.archived_at is null and v.is_inventory_active=true and (${search}='' or v.vin ilike ${pattern} or coalesce(v.car_name,'') ilike ${pattern} or coalesce(v.statement,'') ilike ${pattern})
    order by v.vin limit 500
  `;
  return { ok: true, rows };
}

async function listPackages(request: VercelRequest) {
  const sql = getSql();
  const search = clean(request.query.search);
  const categoryId = clean(request.query.categoryId);
  const pattern = `%${search}%`;
  const rows = await sql<SqlRow[]>`
    select p.id::text,p.name,p.category_id::text,c.name as category_name,p.price,p.cash_discount_percent,p.registration_fee,p.insurance,p.issuance_fee,p.car_care_lines,p.delivery_type,p.is_active,p.created_at,p.updated_at
    from marketing.car_packages p join marketing.package_categories c on c.id=p.category_id
    where (${search}='' or p.name ilike ${pattern}) and (${categoryId}='' or p.category_id=${categoryId}::uuid)
    order by c.sort_order,p.created_at desc
  `;
  return { ok: true, rows };
}

async function listPhotoRequests(user: SessionUser) {
  const sql = getSql();
  const all = isAdmin(user) || hasPermission(user, "marketing.requests.manage");
  const rows = await sql<SqlRow[]>`
    select r.id::text,r.request_no,r.status,r.requested_by::text,r.requested_by_name,r.requested_by_branch,r.requested_at,r.photography_date,r.note,r.completed_at,r.updated_at,
      coalesce(json_agg(json_build_object('id',v.id::text,'vin',v.vin,'car_name',v.car_name,'statement',v.statement,'model_year',v.model_year,'exterior_color',v.exterior_color,'interior_color',v.interior_color,'location_name',l.name) order by v.vin) filter(where v.id is not null),'[]') as vehicles,
      coalesce((select json_agg(json_build_object('id',x.id::text,'old_status',x.old_status,'new_status',x.new_status,'photography_date',x.photography_date,'note',x.note,'changed_by_name',x.changed_by_name,'created_at',x.created_at) order by x.created_at desc) from operations.photography_request_updates x where x.request_id=r.id),'[]') as updates
    from operations.photography_requests r left join operations.photography_request_vehicles rv on rv.request_id=r.id left join operations.vehicles v on v.id=rv.vehicle_id left join operations.locations l on l.id=v.location_id
    where r.is_deleted=false and (${all}=true or r.requested_by=${user.id}::uuid)
    group by r.id order by r.requested_at desc
  `;
  return { ok: true, rows };
}

async function attendanceData(request: VercelRequest, user: SessionUser) {
  const sql = getSql();
  const from = clean(request.query.from) || new Date().toISOString().slice(0, 7) + "-01";
  const to = clean(request.query.to) || new Date().toISOString().slice(0, 10);
  const canSeeAll = isAdmin(user) || hasPermission(user, "marketing.manage");
  const [settings] = await sql<SqlRow[]>`select work_start::text,work_end::text,late_after_minutes,work_days,updated_at from marketing.attendance_settings where id=true`;
  const rows = await sql<SqlRow[]>`
    select a.id::text,a.user_id::text,u.full_name,a.attendance_date,a.check_in_at,a.check_out_at,a.last_activity_at,a.note
    from marketing.attendance_records a join core.users u on u.id=a.user_id
    where a.attendance_date between ${from}::date and ${to}::date and (${canSeeAll}=true or a.user_id=${user.id}::uuid)
    order by a.attendance_date desc,u.full_name
  `;
  const [today] = await sql<SqlRow[]>`select id::text,user_id::text,attendance_date,check_in_at,check_out_at,last_activity_at,note from marketing.attendance_records where user_id=${user.id}::uuid and attendance_date=current_date`;
  return { ok: true, settings: settings || null, rows, today: today || null };
}

async function listConnections() {
  const sql = getSql();
  const rows = await sql<SqlRow[]>`select c.id::text,c.platform_id::text,p.name as platform_name,p.code as platform_code,c.account_name,c.account_external_id,c.connection_status,c.metadata,c.connected_at,c.updated_at from marketing.platform_connections c join marketing.platforms p on p.id=c.platform_id order by p.sort_order,c.updated_at desc`;
  return { ok: true, rows };
}

async function saveSetting(body: UnknownRecord, user: SessionUser) {
  requirePermission(user, "marketing.settings.manage");
  const sql = getSql();
  const entity = clean(body.entity);
  const id = clean(body.id);
  const result = await sql.begin(async (tx) => {
    if (entity === "department") {
      const code = clean(body.code); const name = clean(body.name);
      if (!code || !name) throw new MarketingError(400, "VALIDATION_ERROR", "كود واسم القسم مطلوبان");
      const [row] = id
        ? await tx<SqlRow[]>`update marketing.departments set code=${code},name=${name},is_content=${asBoolean(body.isContent)},is_active=${body.isActive === undefined ? true : asBoolean(body.isActive)},sort_order=${asNumber(body.sortOrder)},updated_at=now() where id=${ensureUuid(id,"القسم")}::uuid returning *,id::text`
        : await tx<SqlRow[]>`insert into marketing.departments(code,name,is_content,is_active,sort_order,created_by) values(${code},${name},${asBoolean(body.isContent)},${body.isActive === undefined ? true : asBoolean(body.isActive)},${asNumber(body.sortOrder)},${user.id}::uuid) returning *,id::text`;
      if (!row) throw new MarketingError(404, "NOT_FOUND", "القسم غير موجود");
      await tx`delete from marketing.department_users where department_id=${clean(row.id)}::uuid`;
      for (const userId of asArray(body.userIds).map(clean).filter(Boolean)) await tx`insert into marketing.department_users(department_id,user_id) values(${clean(row.id)}::uuid,${ensureUuid(userId,"المستخدم")}::uuid) on conflict do nothing`;
      return row;
    }
    if (entity === "action") {
      const departmentId = ensureUuid(body.departmentId, "القسم"); const name = clean(body.name); const pct = asNumber(body.progressPercent);
      if (!name || pct < 0 || pct > 100) throw new MarketingError(400, "VALIDATION_ERROR", "اسم الإجراء ونسبته مطلوبان");
      const [row] = id
        ? await tx<SqlRow[]>`update marketing.assignment_actions set department_id=${departmentId}::uuid,name=${name},progress_percent=${pct},admin_only=${asBoolean(body.adminOnly)},is_active=${body.isActive === undefined ? true : asBoolean(body.isActive)},sort_order=${asNumber(body.sortOrder)},updated_at=now() where id=${ensureUuid(id,"الإجراء")}::uuid returning *,id::text`
        : await tx<SqlRow[]>`insert into marketing.assignment_actions(department_id,name,progress_percent,admin_only,is_active,sort_order) values(${departmentId}::uuid,${name},${pct},${asBoolean(body.adminOnly)},${body.isActive === undefined ? true : asBoolean(body.isActive)},${asNumber(body.sortOrder)}) returning *,id::text`;
      if (!row) throw new MarketingError(404, "NOT_FOUND", "الإجراء غير موجود");
      return row;
    }
    if (entity === "creative") {
      const name = clean(body.name); const shortCode = clean(body.shortCode); const departmentId = ensureUuid(body.primaryDepartmentId, "القسم الأساسي");
      if (!name || !shortCode) throw new MarketingError(400, "VALIDATION_ERROR", "اسم الكرييتيف والكود المختصر مطلوبان");
      const [row] = id
        ? await tx<SqlRow[]>`update marketing.creative_catalog set name=${name},short_code=${shortCode},primary_department_id=${departmentId}::uuid,is_active=${body.isActive === undefined ? true : asBoolean(body.isActive)},sort_order=${asNumber(body.sortOrder)},updated_at=now() where id=${ensureUuid(id,"الكرييتيف")}::uuid returning *,id::text`
        : await tx<SqlRow[]>`insert into marketing.creative_catalog(name,short_code,primary_department_id,is_active,sort_order) values(${name},${shortCode},${departmentId}::uuid,${body.isActive === undefined ? true : asBoolean(body.isActive)},${asNumber(body.sortOrder)}) returning *,id::text`;
      if (!row) throw new MarketingError(404, "NOT_FOUND", "الكرييتيف غير موجود");
      return row;
    }
    if (entity === "campaign_type") {
      const name = clean(body.name); const prefix = clean(body.codePrefix);
      if (!name || !prefix) throw new MarketingError(400, "VALIDATION_ERROR", "اسم النوع والكود مطلوبان");
      const [row] = id
        ? await tx<SqlRow[]>`update marketing.campaign_types set name=${name},code_prefix=${prefix},is_active=${body.isActive === undefined ? true : asBoolean(body.isActive)},sort_order=${asNumber(body.sortOrder)},updated_at=now() where id=${ensureUuid(id,"نوع الحملة")}::uuid returning *,id::text`
        : await tx<SqlRow[]>`insert into marketing.campaign_types(name,code_prefix,is_active,sort_order) values(${name},${prefix},${body.isActive === undefined ? true : asBoolean(body.isActive)},${asNumber(body.sortOrder)}) returning *,id::text`;
      if (!row) throw new MarketingError(404, "NOT_FOUND", "نوع الحملة غير موجود");
      return row;
    }
    if (entity === "funnel") {
      const name = clean(body.name); if (!name) throw new MarketingError(400, "VALIDATION_ERROR", "اسم Funnel مطلوب");
      const [row] = id
        ? await tx<SqlRow[]>`update marketing.funnels set name=${name},is_active=${body.isActive === undefined ? true : asBoolean(body.isActive)},sort_order=${asNumber(body.sortOrder)},updated_at=now() where id=${ensureUuid(id,"Funnel")}::uuid returning *,id::text`
        : await tx<SqlRow[]>`insert into marketing.funnels(name,is_active,sort_order) values(${name},${body.isActive === undefined ? true : asBoolean(body.isActive)},${asNumber(body.sortOrder)}) returning *,id::text`;
      if (!row) throw new MarketingError(404, "NOT_FOUND", "Funnel غير موجود");
      return row;
    }
    if (entity === "platform") {
      const code = clean(body.code); const name = clean(body.name); if (!code || !name) throw new MarketingError(400, "VALIDATION_ERROR", "اسم وكود المنصة مطلوبان");
      const [row] = id
        ? await tx<SqlRow[]>`update marketing.platforms set code=${code},name=${name},is_active=${body.isActive === undefined ? true : asBoolean(body.isActive)},sort_order=${asNumber(body.sortOrder)},updated_at=now() where id=${ensureUuid(id,"المنصة")}::uuid returning *,id::text`
        : await tx<SqlRow[]>`insert into marketing.platforms(code,name,is_active,sort_order) values(${code},${name},${body.isActive === undefined ? true : asBoolean(body.isActive)},${asNumber(body.sortOrder)}) returning *,id::text`;
      if (!row) throw new MarketingError(404, "NOT_FOUND", "المنصة غير موجودة");
      return row;
    }
    if (entity === "post_type") {
      const platformId = ensureUuid(body.platformId, "المنصة"); const name = clean(body.name); if (!name) throw new MarketingError(400, "VALIDATION_ERROR", "اسم نوع النشر مطلوب");
      const [row] = id
        ? await tx<SqlRow[]>`update marketing.platform_post_types set platform_id=${platformId}::uuid,name=${name},width=${asNumber(body.width) || null},height=${asNumber(body.height) || null},is_active=${body.isActive === undefined ? true : asBoolean(body.isActive)},sort_order=${asNumber(body.sortOrder)},updated_at=now() where id=${ensureUuid(id,"نوع النشر")}::uuid returning *,id::text`
        : await tx<SqlRow[]>`insert into marketing.platform_post_types(platform_id,name,width,height,is_active,sort_order) values(${platformId}::uuid,${name},${asNumber(body.width) || null},${asNumber(body.height) || null},${body.isActive === undefined ? true : asBoolean(body.isActive)},${asNumber(body.sortOrder)}) returning *,id::text`;
      if (!row) throw new MarketingError(404, "NOT_FOUND", "نوع النشر غير موجود");
      return row;
    }
    if (entity === "request_status") {
      const code = clean(body.code); const name = clean(body.name); if (!code || !name) throw new MarketingError(400, "VALIDATION_ERROR", "كود واسم الحالة مطلوبان");
      const [row] = id
        ? await tx<SqlRow[]>`update marketing.request_statuses set code=${code},name=${name},is_terminal=${asBoolean(body.isTerminal)},is_active=${body.isActive === undefined ? true : asBoolean(body.isActive)},sort_order=${asNumber(body.sortOrder)} where id=${ensureUuid(id,"الحالة")}::uuid returning *,id::text`
        : await tx<SqlRow[]>`insert into marketing.request_statuses(code,name,is_terminal,is_active,sort_order) values(${code},${name},${asBoolean(body.isTerminal)},${body.isActive === undefined ? true : asBoolean(body.isActive)},${asNumber(body.sortOrder)}) returning *,id::text`;
      if (!row) throw new MarketingError(404, "NOT_FOUND", "الحالة غير موجودة");
      return row;
    }
    if (entity === "package_category") {
      const name = clean(body.name); if (!name) throw new MarketingError(400, "VALIDATION_ERROR", "اسم التصنيف مطلوب");
      const [row] = id
        ? await tx<SqlRow[]>`update marketing.package_categories set name=${name},is_active=${body.isActive === undefined ? true : asBoolean(body.isActive)},sort_order=${asNumber(body.sortOrder)},updated_at=now() where id=${ensureUuid(id,"التصنيف")}::uuid returning *,id::text`
        : await tx<SqlRow[]>`insert into marketing.package_categories(name,is_active,sort_order) values(${name},${body.isActive === undefined ? true : asBoolean(body.isActive)},${asNumber(body.sortOrder)}) returning *,id::text`;
      if (!row) throw new MarketingError(404, "NOT_FOUND", "التصنيف غير موجود");
      return row;
    }
    throw new MarketingError(400, "UNSUPPORTED_ENTITY", "نوع الإعداد غير مدعوم");
  });
  await sql`insert into marketing.activity_log(user_id,action,entity_type,entity_id,after_data) values(${user.id}::uuid,'setting_saved',${entity},${clean(result.id)},${sql.json(toJsonValue(result))})`;
  return { ok: true, row: result };
}

async function deleteSetting(body: UnknownRecord, user: SessionUser) {
  requirePermission(user, "marketing.settings.manage");
  const sql = getSql(); const entity = clean(body.entity); const id = ensureUuid(body.id, "السجل");
  const map: Record<string, string> = {
    department: "marketing.departments", action: "marketing.assignment_actions", creative: "marketing.creative_catalog", campaign_type: "marketing.campaign_types", funnel: "marketing.funnels", platform: "marketing.platforms", post_type: "marketing.platform_post_types", request_status: "marketing.request_statuses", package_category: "marketing.package_categories",
  };
  const table = map[entity]; if (!table) throw new MarketingError(400, "UNSUPPORTED_ENTITY", "نوع الإعداد غير مدعوم");
  try { await sql.unsafe(`delete from ${table} where id=$1::uuid`, [id]); }
  catch { throw new MarketingError(409, "IN_USE", "لا يمكن حذف السجل لأنه مستخدم؛ قم بتعطيله بدلًا من ذلك"); }
  return { ok: true };
}

async function createCampaign(body: UnknownRecord, user: SessionUser) {
  requirePermission(user, "marketing.manage");
  const sql = getSql();
  const sourceKind = clean(body.sourceKind) === "agenda" ? "agenda" : "campaign";
  const name = clean(body.name);
  const campaignDate = dateOnly(body.campaignDate, "تاريخ الحملة", sourceKind === "campaign");
  const publishStartDate = dateOnly(body.publishStartDate, "بداية النشر", true) as string;
  const publishEndDate = dateOnly(body.publishEndDate, "نهاية النشر", true) as string;
  if (!name) throw new MarketingError(400, "VALIDATION_ERROR", sourceKind === "agenda" ? "اسم الأجندة مطلوب" : "اسم الحملة مطلوب");
  if (publishEndDate < publishStartDate) throw new MarketingError(400, "VALIDATION_ERROR", "نهاية النشر يجب ألا تسبق البداية");
  const instances = asArray(body.instances).map(asRecord);
  if (!instances.length) throw new MarketingError(400, "VALIDATION_ERROR", "أضف كرييتيف واحدًا على الأقل");
  const idempotencyKey = clean(body.idempotencyKey);
  if (!idempotencyKey) throw new MarketingError(400, "VALIDATION_ERROR", "مفتاح منع التكرار مطلوب");
  const result = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`marketing:create:${idempotencyKey}`},0))`;
    const [existingCampaign] = await tx<SqlRow[]>`select id::text,campaign_code from marketing.campaigns where idempotency_key=${idempotencyKey} and deleted_at is null limit 1`;
    if (existingCampaign) return { campaignId: clean(existingCampaign.id), campaignCode: clean(existingCampaign.campaign_code), duplicate: true };
    let campaignTypeId: string | null = null;
    let campaignCode = "";
    if (sourceKind === "campaign") {
      campaignTypeId = ensureUuid(body.campaignTypeId, "نوع الحملة");
      const [type] = await tx<SqlRow[]>`select code_prefix from marketing.campaign_types where id=${campaignTypeId}::uuid and is_active=true`;
      if (!type) throw new MarketingError(400, "VALIDATION_ERROR", "نوع الحملة غير متاح");
      const baseCode = `${clean(type.code_prefix).toUpperCase()}-${String(campaignDate || publishStartDate).slice(0, 7)}`;
      const [counter] = await tx<{ last_sequence: number }[]>`
        insert into marketing.campaign_code_counters(base_code,last_sequence)
        values(${baseCode},1)
        on conflict(base_code) do update set last_sequence=marketing.campaign_code_counters.last_sequence+1,updated_at=now()
        returning last_sequence
      `;
      const sequence = Math.max(1, Math.floor(asNumber(counter?.last_sequence, 1)));
      campaignCode = sequence === 1 ? baseCode : `${baseCode}-${String(sequence).padStart(2, "0")}`;
    } else campaignCode = `AGENDA-${publishStartDate.slice(0,7).replace("-","")}-${randomAgendaSuffix()}`;
    const [campaign] = await tx<SqlRow[]>`
      insert into marketing.campaigns(source_kind,idempotency_key,campaign_code,name,campaign_type_id,campaign_date,publish_start_date,publish_end_date,objective,content_brief,status,workflow_stage,created_by)
      values(${sourceKind},${idempotencyKey},${campaignCode},${name},${campaignTypeId}::uuid,${campaignDate},${publishStartDate}::date,${publishEndDate}::date,${nullableText(body.objective)},${nullableText(body.contentBrief)},'active','required',${user.id}::uuid)
      returning *,id::text
    `;
    const agendaDayIds = new Map<string, string>();
    if (sourceKind === "agenda") {
      const dayValues = [...new Set(instances.map((item) => dateOnly(item.agendaDate, "تاريخ يوم الأجندة", true) as string))].sort();
      for (const [index, day] of dayValues.entries()) {
        if (day < publishStartDate || day > publishEndDate) throw new MarketingError(400, "VALIDATION_ERROR", "يوجد يوم خارج فترة الأجندة");
        const [row] = await tx<SqlRow[]>`insert into marketing.agenda_days(campaign_id,agenda_date,sort_order) values(${clean(campaign.id)}::uuid,${day}::date,${index}) returning id::text`;
        agendaDayIds.set(day, clean(row.id));
      }
    }
    const instanceIds: string[] = [];
    for (const [index, instanceInput] of instances.entries()) {
      const creativeId = ensureUuid(instanceInput.creativeId, "الكرييتيف");
      const [creative] = await tx<SqlRow[]>`select c.id::text,c.primary_department_id::text,c.short_code,d.id::text as department_id,d.name as department_name from marketing.creative_catalog c join marketing.departments d on d.id=c.primary_department_id where c.id=${creativeId}::uuid and c.is_active=true`;
      if (!creative) throw new MarketingError(400, "VALIDATION_ERROR", "أحد الكرييتيفات غير متاح");
      const sequenceNo = index + 1; const instanceCode = `N${String(sequenceNo).padStart(2,"0")}`;
      const agendaDate = sourceKind === "agenda" ? dateOnly(instanceInput.agendaDate, "تاريخ يوم الأجندة", true) as string : null;
      const [instance] = await tx<SqlRow[]>`
        insert into marketing.creative_instances(campaign_id,agenda_day_id,creative_id,sequence_no,instance_code,content_received_date,content_notes,is_complete)
        values(${clean(campaign.id)}::uuid,${agendaDate ? agendaDayIds.get(agendaDate) || null : null}::uuid,${creativeId}::uuid,${sequenceNo},${instanceCode},${dateOnly(instanceInput.contentReceivedDate,"تاريخ استلام المحتوى")},${nullableText(instanceInput.contentNotes)},false)
        returning id::text
      `;
      const instanceId = clean(instance.id); instanceIds.push(instanceId);
      const [contentDepartment] = await tx<SqlRow[]>`select id::text from marketing.departments where is_content=true and is_active=true order by sort_order limit 1`;
      if (!contentDepartment) throw new MarketingError(500, "CONFIGURATION_ERROR", "قسم المحتوى غير مضبوط في إعدادات التسويق");
      const writers = asArray(instanceInput.writers).map(asRecord);
      if (!writers.length) throw new MarketingError(400, "VALIDATION_ERROR", `${instanceCode}: اختر كاتب محتوى واحدًا على الأقل`);
      const writerIds = new Set<string>();
      for (const writer of writers) {
        const writerId = ensureUuid(writer.userId, "كاتب المحتوى"); writerIds.add(writerId);
        const [writerMembership] = await tx`select 1 from marketing.department_users where department_id=${clean(contentDepartment.id)}::uuid and user_id=${writerId}::uuid`;
        if (!writerMembership) throw new MarketingError(400, "VALIDATION_ERROR", `${instanceCode}: كاتب المحتوى غير مرتبط بقسم المحتوى في الإعدادات`);
        await tx`insert into marketing.instance_content_writers(instance_id,user_id,due_date,notes) values(${instanceId}::uuid,${writerId}::uuid,${dateOnly(writer.dueDate,"موعد كاتب المحتوى")},${nullableText(writer.notes)})`;
      }
      const departments = asArray(instanceInput.departments).map(asRecord);
      const primaryExists = departments.some((item) => clean(item.departmentId) === clean(creative.primary_department_id));
      if (!primaryExists) throw new MarketingError(400, "VALIDATION_ERROR", `${instanceCode}: القسم الأساسي غير مكتمل`);
      const assignmentRecords: Array<{ id: string; departmentId: string; executiveUserId: string; contentWriterId: string; dueDate: string | null }> = [];
      for (const depInput of departments) {
        const departmentId = ensureUuid(depInput.departmentId, "القسم");
        const [department] = await tx<SqlRow[]>`select id::text,is_active,is_content from marketing.departments where id=${departmentId}::uuid`;
        if (!department || !asBoolean(department.is_active) || asBoolean(department.is_content)) throw new MarketingError(400, "VALIDATION_ERROR", `${instanceCode}: القسم التنفيذي غير متاح`);
        const isPrimary = departmentId === clean(creative.primary_department_id);
        const [instanceDepartment] = await tx<SqlRow[]>`insert into marketing.instance_departments(instance_id,department_id,is_primary,due_date,notes) values(${instanceId}::uuid,${departmentId}::uuid,${isPrimary},${dateOnly(depInput.dueDate,"موعد القسم")},${nullableText(depInput.notes)}) returning id::text`;
        const assignments = asArray(depInput.assignments).map(asRecord);
        if (!assignments.length) throw new MarketingError(400, "VALIDATION_ERROR", `${instanceCode}: اختر مسؤولًا واربطه بكاتب محتوى داخل كل قسم`);
        for (const assignment of assignments) {
          const executiveUserId = ensureUuid(assignment.executiveUserId, "المسؤول التنفيذي");
          const [executiveMembership] = await tx`select 1 from marketing.department_users where department_id=${departmentId}::uuid and user_id=${executiveUserId}::uuid`;
          if (!executiveMembership) throw new MarketingError(400, "VALIDATION_ERROR", `${instanceCode}: المسؤول التنفيذي غير مرتبط بالقسم في الإعدادات`);
          const contentWriterId = ensureUuid(assignment.contentWriterId, "كاتب المحتوى المرتبط");
          if (!writerIds.has(contentWriterId)) throw new MarketingError(400, "VALIDATION_ERROR", `${instanceCode}: كاتب المحتوى المرتبط غير مختار داخل نفس الكرييتيف`);
          const dueDate = dateOnly(assignment.dueDate, "موعد التسليم") || dateOnly(depInput.dueDate, "موعد القسم");
          const [assignmentRow] = await tx<SqlRow[]>`insert into marketing.instance_assignments(instance_department_id,executive_user_id,content_writer_id,due_date) values(${clean(instanceDepartment.id)}::uuid,${executiveUserId}::uuid,${contentWriterId}::uuid,${dueDate}) returning id::text`;
          assignmentRecords.push({ id: clean(assignmentRow.id), departmentId, executiveUserId, contentWriterId, dueDate });
        }
      }
      for (const vehicleId of [...new Set(asArray(instanceInput.vehicleIds).map(clean).filter(Boolean))]) {
        const validVehicleId = ensureUuid(vehicleId, "السيارة");
        const [vehicle] = await tx`select 1 from operations.vehicles where id=${validVehicleId}::uuid and is_deleted=false and archived_at is null`;
        if (!vehicle) throw new MarketingError(400, "VALIDATION_ERROR", `${instanceCode}: إحدى السيارات غير متاحة`);
        await tx`insert into marketing.instance_vehicles(instance_id,vehicle_id) values(${instanceId}::uuid,${validVehicleId}::uuid)`;
      }
      for (const post of asArray(instanceInput.posts).map(asRecord)) {
        const platformId = ensureUuid(post.platformId, "المنصة"); const postTypeId = ensureUuid(post.postTypeId, "نوع النشر");
        const [valid] = await tx`select 1 from marketing.platform_post_types where id=${postTypeId}::uuid and platform_id=${platformId}::uuid and is_active=true`;
        if (!valid) throw new MarketingError(400, "VALIDATION_ERROR", `${instanceCode}: نوع نشر غير تابع للمنصة`);
        await tx`insert into marketing.instance_platform_posts(instance_id,platform_id,post_type_id) values(${instanceId}::uuid,${platformId}::uuid,${postTypeId}::uuid) on conflict do nothing`;
      }
      const templateIds = new Map<string, string>();
      for (const writer of writers) {
        const writerId = ensureUuid(writer.userId, "كاتب المحتوى");
        const [seq] = await tx<{ n: number }[]>`select nextval('marketing.task_no_seq')::bigint as n`;
        const taskNo = `MKT-${String(seq?.n || 1).padStart(8,"0")}`;
        const [template] = await tx<SqlRow[]>`
          insert into marketing.tasks(task_no,campaign_id,instance_id,task_kind,department_id,assigned_to,content_writer_id,status,progress,due_date)
          values(${taskNo},${clean(campaign.id)}::uuid,${instanceId}::uuid,'template',${clean(contentDepartment.id)}::uuid,${writerId}::uuid,${writerId}::uuid,'new',0,${dateOnly(writer.dueDate,"موعد كاتب المحتوى")}) returning id::text
        `;
        templateIds.set(writerId, clean(template.id));
      }
      for (const assignment of assignmentRecords) {
        const [seq] = await tx<{ n: number }[]>`select nextval('marketing.task_no_seq')::bigint as n`;
        const taskNo = `MKT-${String(seq?.n || 1).padStart(8,"0")}`;
        const templateTaskId = templateIds.get(assignment.contentWriterId);
        if (!templateTaskId) throw new MarketingError(500, "DATA_ERROR", "تعذر ربط تاسك التنفيذ بـ Task Template الصحيحة");
        const [execution] = await tx<SqlRow[]>`
          insert into marketing.tasks(task_no,campaign_id,instance_id,task_kind,department_id,assigned_to,content_writer_id,template_task_id,assignment_id,status,progress,due_date)
          values(${taskNo},${clean(campaign.id)}::uuid,${instanceId}::uuid,'execution',${assignment.departmentId}::uuid,${assignment.executiveUserId}::uuid,${assignment.contentWriterId}::uuid,${templateTaskId}::uuid,${assignment.id}::uuid,'waiting_template',0,${assignment.dueDate}) returning id::text
        `;
        const actions = await tx<SqlRow[]>`select id::text,name,progress_percent,admin_only,sort_order from marketing.assignment_actions where department_id=${assignment.departmentId}::uuid and is_active=true order by sort_order,name`;
        const actionsTotal = actions.reduce((sum: number, action: SqlRow) => sum + asNumber(action.progress_percent), 0);
        if (!actions.length || Math.abs(actionsTotal - 100) > 0.001) throw new MarketingError(500, "CONFIGURATION_ERROR", `إجراءات القسم يجب أن تكون موجودة ومجموع نسبها 100%`);
        for (const action of actions) await tx`insert into marketing.task_action_items(task_id,source_action_id,name,progress_percent,admin_only,sort_order) values(${clean(execution.id)}::uuid,${clean(action.id)}::uuid,${clean(action.name)},${asNumber(action.progress_percent)},${asBoolean(action.admin_only)},${asNumber(action.sort_order)})`;
      }
      const [completion] = await tx<{ complete: boolean }[]>`
        select exists(select 1 from marketing.instance_content_writers where instance_id=${instanceId}::uuid)
          and exists(select 1 from marketing.instance_departments where instance_id=${instanceId}::uuid)
          and not exists(select 1 from marketing.instance_departments d where d.instance_id=${instanceId}::uuid and not exists(select 1 from marketing.instance_assignments a where a.instance_department_id=d.id)) as complete
      `;
      await tx`update marketing.creative_instances set is_complete=${Boolean(completion?.complete)},updated_at=now() where id=${instanceId}::uuid`;
    }
    for (const [index, item] of asArray(body.budgetItems).map(asRecord).entries()) {
      const instanceIndex = Math.floor(asNumber(item.instanceIndex, -1));
      const instanceId = instanceIds[instanceIndex]; if (!instanceId) throw new MarketingError(400, "VALIDATION_ERROR", "بند الميزانية مرتبط بكرييتيف غير موجود");
      const funnelId = nullableText(item.funnelId);
      if (funnelId) {
        ensureUuid(funnelId, "Funnel");
        const [funnel] = await tx`select 1 from marketing.funnels where id=${funnelId}::uuid and is_active=true`;
        if (!funnel) throw new MarketingError(400, "VALIDATION_ERROR", "Funnel غير متاح");
      }
      const [budget] = await tx<SqlRow[]>`insert into marketing.budget_items(campaign_id,funnel_id,instance_id,ads_count,content_goal,expected_goal,sort_order) values(${clean(campaign.id)}::uuid,${funnelId}::uuid,${instanceId}::uuid,${Math.max(0,Math.floor(asNumber(item.adsCount)))},${nullableText(item.contentGoal)},${nullableText(item.expectedGoal)},${index}) returning id::text`;
      for (const platformValue of asArray(item.platformValues).map(asRecord)) {
        const platformId = ensureUuid(platformValue.platformId,"منصة الميزانية");
        const [platform] = await tx`select 1 from marketing.platforms where id=${platformId}::uuid and is_active=true`;
        if (!platform) throw new MarketingError(400, "VALIDATION_ERROR", "إحدى منصات الميزانية غير متاحة");
        await tx`insert into marketing.budget_platform_values(budget_item_id,platform_id,amount) values(${clean(budget.id)}::uuid,${platformId}::uuid,${Math.max(0,asNumber(platformValue.amount))})`;
      }
    }
    const scheduleInputs = sourceKind === "agenda"
      ? instances.map((instance, instanceIndex) => ({ publishDate: instance.agendaDate, instanceIndex, posts: instance.posts }))
      : asArray(body.schedule).map(asRecord);
    for (const item of scheduleInputs) {
      const schedule = asRecord(item); const instanceIndex = Math.floor(asNumber(schedule.instanceIndex, -1)); const instanceId = instanceIds[instanceIndex];
      if (!instanceId) throw new MarketingError(400, "VALIDATION_ERROR", "منشور مرتبط بكرييتيف غير موجود");
      const publishDate = dateOnly(schedule.publishDate, "تاريخ النشر", true) as string;
      if (publishDate < publishStartDate || publishDate > publishEndDate) throw new MarketingError(400, "VALIDATION_ERROR", "يوجد منشور خارج فترة النشر");
      const [scheduleRow] = await tx<SqlRow[]>`insert into marketing.publish_schedule_items(campaign_id,publish_date,instance_id) values(${clean(campaign.id)}::uuid,${publishDate}::date,${instanceId}::uuid) returning id::text`;
      const schedulePosts = asArray(schedule.posts).map(asRecord);
      if (!schedulePosts.length) throw new MarketingError(400, "VALIDATION_ERROR", "كل منشور في جدول النشر يحتاج منصة ونوع نشر");
      for (const post of schedulePosts) {
        const platformId = ensureUuid(post.platformId,"المنصة"); const postTypeId = ensureUuid(post.postTypeId,"نوع النشر");
        const [validPost] = await tx`select 1 from marketing.platform_post_types where id=${postTypeId}::uuid and platform_id=${platformId}::uuid and is_active=true`;
        if (!validPost) throw new MarketingError(400, "VALIDATION_ERROR", "نوع نشر غير تابع للمنصة في جدول النشر");
        await tx`insert into marketing.publish_schedule_posts(schedule_item_id,platform_id,post_type_id) values(${clean(scheduleRow.id)}::uuid,${platformId}::uuid,${postTypeId}::uuid) on conflict do nothing`;
      }
    }
    const after: JsonObject = { campaignId: clean(campaign.id), campaignCode, idempotencyKey };
    await tx`insert into marketing.activity_log(user_id,action,entity_type,entity_id,after_data) values(${user.id}::uuid,'campaign_created',${sourceKind},${clean(campaign.id)},${tx.json(after)})`;
    return { campaignId: clean(campaign.id), campaignCode, duplicate: false };
  });
  return { ok: true, ...result };
}

async function taskAction(body: UnknownRecord, user: SessionUser) {
  const sql = getSql(); const action = clean(body.taskAction); const taskId = ensureUuid(body.taskId, "التاسك");
  const result = await sql.begin(async (tx) => {
    const [task] = await tx<SqlRow[]>`select *,id::text,assigned_to::text,template_task_id::text,campaign_id::text from marketing.tasks where id=${taskId}::uuid for update`;
    if (!task) throw new MarketingError(404, "NOT_FOUND", "التاسك غير موجود");
    const owner = clean(task.assigned_to) === user.id; const reviewer = isAdmin(user) || hasPermission(user, "marketing.templates.review");
    if (action === "receive") {
      if (!owner && !isAdmin(user)) throw new MarketingError(403, "FORBIDDEN", "التاسك غير مسند إليك");
      if (clean(task.status) === "waiting_template") throw new MarketingError(409, "TEMPLATE_PENDING", "لا يمكن استلام التاسك قبل اعتماد Task Template المرتبطة");
      if (task.actual_received_at) return task;
      const [updated] = await tx<SqlRow[]>`update marketing.tasks set actual_received_at=now(),status=case when task_kind='template' then 'received' else 'active' end,updated_at=now() where id=${taskId}::uuid returning *,id::text`;
      return updated;
    }
    if (action === "toggle_action") {
      if (!owner && !isAdmin(user)) throw new MarketingError(403, "FORBIDDEN", "التاسك غير مسند إليك");
      if (clean(task.task_kind) !== "execution") throw new MarketingError(400, "INVALID_TASK", "إجراءات التكليف متاحة للتاسكات التنفيذية فقط");
      if (!task.actual_received_at) throw new MarketingError(409, "NOT_RECEIVED", "اضغط تم الاستلام أولًا");
      const actionId = ensureUuid(body.actionId, "الإجراء");
      const [item] = await tx<SqlRow[]>`select *,id::text from marketing.task_action_items where id=${actionId}::uuid and task_id=${taskId}::uuid for update`;
      if (!item) throw new MarketingError(404, "NOT_FOUND", "إجراء التكليف غير موجود");
      if (asBoolean(item.admin_only) && !reviewer) throw new MarketingError(403, "FORBIDDEN", "هذا الإجراء متاح للأدمن فقط");
      const completed = !item.completed_at;
      if (completed) await tx`update marketing.task_action_items set completed_at=now(),completed_by=${user.id}::uuid where id=${actionId}::uuid`;
      else await tx`update marketing.task_action_items set completed_at=null,completed_by=null where id=${actionId}::uuid`;
      const [progressRow] = await tx<{ progress: number }[]>`select least(100,coalesce(sum(progress_percent) filter(where completed_at is not null),0))::numeric as progress from marketing.task_action_items where task_id=${taskId}::uuid`;
      const progress = asNumber(progressRow?.progress);
      const [updated] = await tx<SqlRow[]>`update marketing.tasks set progress=${progress},status=case when ${progress}>=100 then 'completed' else 'active' end,completed_at=case when ${progress}>=100 then coalesce(completed_at,now()) else null end,updated_at=now() where id=${taskId}::uuid returning *,id::text`;
      return updated;
    }
    if (action === "submit_template") {
      if (!owner && !isAdmin(user)) throw new MarketingError(403, "FORBIDDEN", "التاسك غير مسند إليك");
      if (clean(task.task_kind) !== "template") throw new MarketingError(400, "INVALID_TASK", "رفع Task Template متاح لتاسك الكاتب فقط");
      if (!task.actual_received_at) throw new MarketingError(409, "NOT_RECEIVED", "اضغط تم الاستلام أولًا");
      const [pending] = await tx`select 1 from marketing.template_submissions where template_task_id=${taskId}::uuid and review_status='pending' limit 1`;
      if (pending) throw new MarketingError(409, "SUBMISSION_PENDING", "توجد نسخة مرفوعة قيد المراجعة بالفعل");
      const [version] = await tx<{ version_no: number }[]>`select coalesce(max(version_no),0)::int+1 as version_no from marketing.template_submissions where template_task_id=${taskId}::uuid`;
      const templateData = toJsonValue(asRecord(body.templateData));
      if (!nullableText(body.storageKey) && Object.keys(asRecord(body.templateData)).length === 0) throw new MarketingError(400, "VALIDATION_ERROR", "أرفق ملف Task Template أو أدخل بياناتها");
      await tx`insert into marketing.template_submissions(template_task_id,version_no,storage_key,file_name,template_data,review_status,submitted_by) values(${taskId}::uuid,${version?.version_no || 1},${nullableText(body.storageKey)},${nullableText(body.fileName)},${tx.json(templateData)},'pending',${user.id}::uuid)`;
      const [updated] = await tx<SqlRow[]>`update marketing.tasks set status='template_review',admin_note=null,rejection_reason=null,updated_at=now() where id=${taskId}::uuid returning *,id::text`;
      return updated;
    }
    if (["approve_template","request_revision","reject_template"].includes(action)) {
      if (!reviewer) throw new MarketingError(403, "FORBIDDEN", "مراجعة Task Template متاحة لمدير النظام");
      if (clean(task.task_kind) !== "template") throw new MarketingError(400, "INVALID_TASK", "التاسك ليس Task Template");
      const [submission] = await tx<SqlRow[]>`select *,id::text from marketing.template_submissions where template_task_id=${taskId}::uuid and review_status='pending' order by version_no desc limit 1 for update`;
      if (!submission) throw new MarketingError(409, "NO_PENDING_SUBMISSION", "لا توجد نسخة معلقة للمراجعة");
      const note = nullableText(body.note);
      if ((action === "request_revision" || action === "reject_template") && !note) throw new MarketingError(400, "VALIDATION_ERROR", "ملاحظة المراجعة مطلوبة");
      const reviewStatus = action === "approve_template" ? "approved" : action === "request_revision" ? "revision_requested" : "rejected";
      await tx`update marketing.template_submissions set review_status=${reviewStatus},review_note=${note},reviewed_by=${user.id}::uuid,reviewed_at=now() where id=${clean(submission.id)}::uuid`;
      if (action === "approve_template") {
        await tx`update marketing.tasks set status='completed',progress=100,completed_at=now(),admin_note=null,rejection_reason=null,updated_at=now() where id=${taskId}::uuid`;
        await tx`update marketing.tasks set status=case when actual_received_at is null then 'new' else 'active' end,updated_at=now() where template_task_id=${taskId}::uuid and task_kind='execution' and status='waiting_template'`;
      } else if (action === "request_revision") await tx`update marketing.tasks set status='template_revision',admin_note=${note},updated_at=now() where id=${taskId}::uuid`;
      else await tx`update marketing.tasks set status='rejected',rejection_reason=${note},updated_at=now() where id=${taskId}::uuid`;
      const [updated] = await tx<SqlRow[]>`select *,id::text from marketing.tasks where id=${taskId}::uuid`;
      return updated;
    }
    if (action === "attach_final") {
      if (!owner && !isAdmin(user)) throw new MarketingError(403, "FORBIDDEN", "التاسك غير مسند إليك");
      if (clean(task.task_kind) !== "execution") throw new MarketingError(400, "INVALID_TASK", "الملف النهائي متاح للتاسك التنفيذي فقط");
      if (!task.actual_received_at) throw new MarketingError(409, "NOT_RECEIVED", "اضغط تم الاستلام أولًا");
      const storageKey = nullableText(body.storageKey); const fileName = nullableText(body.fileName);
      if (!storageKey || !fileName) throw new MarketingError(400, "VALIDATION_ERROR", "بيانات الملف النهائي غير مكتملة");
      const [updated] = await tx<SqlRow[]>`update marketing.tasks set final_storage_key=${storageKey},final_file_name=${fileName},updated_at=now() where id=${taskId}::uuid returning *,id::text`;
      return updated;
    }
    throw new MarketingError(400, "UNSUPPORTED_ACTION", "إجراء التاسك غير مدعوم");
  });
  await sql`insert into marketing.activity_log(user_id,action,entity_type,entity_id,after_data) values(${user.id}::uuid,${action},'task',${taskId},${sql.json(toJsonValue(result))})`;
  return { ok: true, task: result };
}

async function campaignAction(body: UnknownRecord, user: SessionUser) {
  const sql = getSql(); const action = clean(body.campaignAction); const campaignId = ensureUuid(body.campaignId, "الحملة");
  if (["archive","restore","delete","move_to_publish","save_result","add_link","create_raw_folders"].includes(action)) requirePermission(user, "marketing.manage");
  if (action === "move_to_publish") {
    const tasks = await taskRowsForCampaign(campaignId); const progress = calculateCampaignProgress(tasks);
    if (progress < 100) throw new MarketingError(409, "NOT_COMPLETE", "لا يمكن نقل الحملة إلى قسم النشر قبل اكتمالها 100%");
    await sql`update marketing.campaigns set workflow_stage='publishing',status='publishing',updated_at=now() where id=${campaignId}::uuid`;
    return { ok: true };
  }
  if (action === "archive") { await sql`update marketing.campaigns set archived_at=now(),archived_by=${user.id}::uuid,updated_at=now() where id=${campaignId}::uuid`; return { ok: true }; }
  if (action === "restore") { await sql`update marketing.campaigns set archived_at=null,archived_by=null,updated_at=now() where id=${campaignId}::uuid`; return { ok: true }; }
  if (action === "delete") { await sql`update marketing.campaigns set deleted_at=now(),deleted_by=${user.id}::uuid,updated_at=now() where id=${campaignId}::uuid`; return { ok: true }; }
  if (action === "save_result") { await sql`update marketing.campaigns set result_storage_key=${nullableText(body.storageKey)},result_file_name=${nullableText(body.fileName)},updated_at=now() where id=${campaignId}::uuid`; return { ok: true }; }
  if (action === "add_link") {
    const platformId = ensureUuid(body.platformId, "المنصة"); const url = clean(body.url); if (!/^https?:\/\//i.test(url)) throw new MarketingError(400, "VALIDATION_ERROR", "رابط الحملة غير صحيح");
    const [row] = await sql<SqlRow[]>`insert into marketing.campaign_links(campaign_id,platform_id,url,created_by) values(${campaignId}::uuid,${platformId}::uuid,${url},${user.id}::uuid) returning id::text`;
    return { ok: true, row };
  }
  if (action === "create_raw_folders") {
    const [campaign] = await sql<SqlRow[]>`select id::text,campaign_code,name,publish_start_date,raw_folders from marketing.campaigns where id=${campaignId}::uuid`;
    if (!campaign) throw new MarketingError(404, "NOT_FOUND", "الحملة غير موجودة");
    const instances = await sql<SqlRow[]>`select i.instance_code,c.name as creative_name,c.short_code from marketing.creative_instances i join marketing.creative_catalog c on c.id=i.creative_id where i.campaign_id=${campaignId}::uuid order by i.sequence_no`;
    const url = clean(process.env.MZJ_RAW_API_URL); const token = clean(process.env.MZJ_RAW_API_TOKEN);
    if (!url || !token) throw new MarketingError(503, "RAW_API_NOT_CONFIGURED", "متغيرات MZJ_RAW_API_URL و MZJ_RAW_API_TOKEN غير مضبوطة");
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-api-token": token }, body: JSON.stringify({ campaignCode: campaign.campaign_code, campaignName: campaign.name, publishStartDate: campaign.publish_start_date, creatives: instances }) });
    const text = await response.text(); let payload: JsonValue = {};
    try { payload = toJsonValue(text ? JSON.parse(text) : {}); } catch { payload = { ok: false, message: text || "Invalid raw server response" }; }
    if (!response.ok) throw new MarketingError(response.status, "RAW_API_ERROR", clean(asRecord(payload).message) || "تعذر إنشاء فولدرات الخام", payload);
    await sql`update marketing.campaigns set raw_folders=${sql.json(payload)},updated_at=now() where id=${campaignId}::uuid`;
    return { ok: true, rawFolders: payload };
  }
  throw new MarketingError(400, "UNSUPPORTED_ACTION", "إجراء الحملة غير مدعوم");
}

async function savePackage(body: UnknownRecord, user: SessionUser) {
  requirePermission(user, "marketing.packages.manage");
  const sql = getSql(); const id = clean(body.id); const name = clean(body.name); const categoryId = ensureUuid(body.categoryId, "التصنيف");
  if (!name) throw new MarketingError(400, "VALIDATION_ERROR", "اسم الباقة مطلوب");
  const careLines = asArray(body.carCareLines).map(clean).filter(Boolean);
  const [row] = id
    ? await sql<SqlRow[]>`update marketing.car_packages set name=${name},category_id=${categoryId}::uuid,price=${Math.max(0,asNumber(body.price))},cash_discount_percent=${Math.max(0,Math.min(100,asNumber(body.cashDiscountPercent)))},registration_fee=${asBoolean(body.registrationFee)},insurance=${asBoolean(body.insurance)},issuance_fee=${asBoolean(body.issuanceFee)},car_care_lines=${careLines},delivery_type=${clean(body.deliveryType)==='region'?'region':'home'},is_active=${body.isActive === undefined ? true : asBoolean(body.isActive)},updated_at=now() where id=${ensureUuid(id,"الباقة")}::uuid returning *,id::text`
    : await sql<SqlRow[]>`insert into marketing.car_packages(name,category_id,price,cash_discount_percent,registration_fee,insurance,issuance_fee,car_care_lines,delivery_type,is_active,created_by) values(${name},${categoryId}::uuid,${Math.max(0,asNumber(body.price))},${Math.max(0,Math.min(100,asNumber(body.cashDiscountPercent)))},${asBoolean(body.registrationFee)},${asBoolean(body.insurance)},${asBoolean(body.issuanceFee)},${careLines},${clean(body.deliveryType)==='region'?'region':'home'},${body.isActive === undefined ? true : asBoolean(body.isActive)},${user.id}::uuid) returning *,id::text`;
  if (!row) throw new MarketingError(404, "NOT_FOUND", "الباقة غير موجودة");
  return { ok: true, row };
}

async function createPhotoRequest(body: UnknownRecord, user: SessionUser) {
  const sql = getSql(); const vehicleIds = [...new Set(asArray(body.vehicleIds).map(clean).filter(Boolean))];
  if (!vehicleIds.length) throw new MarketingError(400, "VALIDATION_ERROR", "اختر سيارة واحدة على الأقل");
  const photographyDate = dateOnly(body.photographyDate, "تاريخ التصوير", true) as string;
  const result = await sql.begin(async (tx) => {
    for (const vehicleId of vehicleIds) {
      const validId = ensureUuid(vehicleId, "السيارة");
      const [vehicle] = await tx`select 1 from operations.vehicles where id=${validId}::uuid and is_deleted=false and archived_at is null`;
      if (!vehicle) throw new MarketingError(400, "VALIDATION_ERROR", "إحدى السيارات غير موجودة");
      const [active] = await tx<SqlRow[]>`select r.request_no from operations.photography_request_vehicles rv join operations.photography_requests r on r.id=rv.request_id where rv.vehicle_id=${validId}::uuid and r.is_deleted=false and r.status not in ('completed','cancelled') limit 1`;
      if (active) throw new MarketingError(409, "DUPLICATE_ACTIVE_REQUEST", `السيارة مرتبطة بطلب تصوير نشط ${clean(active.request_no)}`);
    }
    const requestNo = `PH-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const [request] = await tx<SqlRow[]>`insert into operations.photography_requests(request_no,status,requested_by,requested_by_name,requested_by_branch,photography_date,note,updated_by) values(${requestNo},'request_received',${user.id}::uuid,${user.fullName},${user.branches[0] || user.branchCodes[0] || null},${photographyDate}::date,${nullableText(body.note)},${user.id}::uuid) returning *,id::text`;
    for (const vehicleId of vehicleIds) await tx`insert into operations.photography_request_vehicles(request_id,vehicle_id) values(${clean(request.id)}::uuid,${vehicleId}::uuid)`;
    await tx`insert into operations.photography_request_updates(request_id,old_status,new_status,photography_date,note,changed_by,changed_by_name) values(${clean(request.id)}::uuid,null,'request_received',${photographyDate}::date,${nullableText(body.note)},${user.id}::uuid,${user.fullName})`;
    return request;
  });
  return { ok: true, request: result };
}

async function photoRequestAction(body: UnknownRecord, user: SessionUser) {
  requirePermission(user, "marketing.requests.manage");
  const sql = getSql(); const id = ensureUuid(body.id, "الطلب"); const status = clean(body.status);
  const [valid] = await sql`select 1 from marketing.request_statuses where code=${status} and is_active=true`;
  if (!valid) throw new MarketingError(400, "VALIDATION_ERROR", "حالة الطلب غير صحيحة");
  const row = await sql.begin(async (tx) => {
    const [current] = await tx<SqlRow[]>`select *,id::text from operations.photography_requests where id=${id}::uuid and is_deleted=false for update`;
    if (!current) throw new MarketingError(404, "NOT_FOUND", "طلب التصوير غير موجود");
    const photographyDate = dateOnly(body.photographyDate,"تاريخ التصوير") || clean(current.photography_date) || null;
    const note = body.note === undefined ? nullableText(current.note) : nullableText(body.note);
    const [updated] = await tx<SqlRow[]>`update operations.photography_requests set status=${status},photography_date=${photographyDate}::date,note=${note},completed_at=case when ${status}='completed' then coalesce(completed_at,now()) else null end,updated_by=${user.id}::uuid,updated_at=now() where id=${id}::uuid returning *,id::text`;
    await tx`insert into operations.photography_request_updates(request_id,old_status,new_status,photography_date,note,changed_by,changed_by_name) values(${id}::uuid,${clean(current.status)},${status},${photographyDate}::date,${note},${user.id}::uuid,${user.fullName})`;
    return updated;
  });
  return { ok: true, row };
}

async function attendanceAction(body: UnknownRecord, user: SessionUser) {
  const sql = getSql(); const action = clean(body.attendanceAction);
  if (action === "check_in") {
    const [row] = await sql<SqlRow[]>`insert into marketing.attendance_records(user_id,attendance_date,check_in_at,last_activity_at) values(${user.id}::uuid,current_date,now(),now()) on conflict(user_id,attendance_date) do update set check_in_at=coalesce(marketing.attendance_records.check_in_at,excluded.check_in_at),last_activity_at=now(),updated_at=now() returning *,id::text`;
    return { ok: true, row };
  }
  if (action === "check_out") {
    const [row] = await sql<SqlRow[]>`update marketing.attendance_records set check_out_at=now(),last_activity_at=now(),updated_at=now() where user_id=${user.id}::uuid and attendance_date=current_date returning *,id::text`;
    if (!row) throw new MarketingError(409, "NOT_CHECKED_IN", "سجل الحضور لليوم غير موجود");
    return { ok: true, row };
  }
  if (action === "activity") { await sql`update marketing.attendance_records set last_activity_at=now(),updated_at=now() where user_id=${user.id}::uuid and attendance_date=current_date`; return { ok: true }; }
  if (action === "save_settings") {
    requirePermission(user, "marketing.manage");
    const start = clean(body.workStart); const end = clean(body.workEnd); if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) throw new MarketingError(400, "VALIDATION_ERROR", "مواعيد الدوام غير صحيحة");
    const days = asArray(body.workDays).map((item) => Math.floor(asNumber(item))).filter((item) => item >= 0 && item <= 6);
    await sql`update marketing.attendance_settings set work_start=${start}::time,work_end=${end}::time,late_after_minutes=${Math.max(0,Math.floor(asNumber(body.lateAfterMinutes)))},work_days=${days},updated_by=${user.id}::uuid,updated_at=now() where id=true`;
    return { ok: true };
  }
  throw new MarketingError(400, "UNSUPPORTED_ACTION", "إجراء الحضور غير مدعوم");
}

async function saveConnection(body: UnknownRecord, user: SessionUser) {
  requirePermission(user, "marketing.manage");
  const sql = getSql(); const id = clean(body.id); const platformId = ensureUuid(body.platformId, "المنصة");
  const metadata = toJsonValue(asRecord(body.metadata));
  const [row] = id
    ? await sql<SqlRow[]>`update marketing.platform_connections set platform_id=${platformId}::uuid,account_name=${nullableText(body.accountName)},account_external_id=${nullableText(body.accountExternalId)},connection_status=${clean(body.connectionStatus)||'disconnected'},metadata=${sql.json(metadata)},connected_by=${user.id}::uuid,connected_at=case when ${clean(body.connectionStatus)}='connected' then coalesce(connected_at,now()) else connected_at end,updated_at=now() where id=${ensureUuid(id,"الربط")}::uuid returning *,id::text`
    : await sql<SqlRow[]>`insert into marketing.platform_connections(platform_id,account_name,account_external_id,connection_status,metadata,connected_by,connected_at) values(${platformId}::uuid,${nullableText(body.accountName)},${nullableText(body.accountExternalId)},${clean(body.connectionStatus)||'disconnected'},${sql.json(metadata)},${user.id}::uuid,case when ${clean(body.connectionStatus)}='connected' then now() else null end) returning *,id::text`;
  if (!row) throw new MarketingError(404, "NOT_FOUND", "الربط غير موجود");
  return { ok: true, row };
}

async function mediaAction(request: VercelRequest, body: UnknownRecord, user: SessionUser) {
  if (!mediaStorageConfigured()) throw new MarketingError(503, "MEDIA_NOT_CONFIGURED", "تخزين الملفات R2 غير مضبوط");
  const sql = getSql(); const action = clean(body.mediaAction);
  if (action === "prepare_upload") {
    const contextId = ensureUuid(body.contextId, "السجل"); const fileName = clean(body.fileName) || "file.bin"; const mediaType = clean(body.mediaType) || "document";
    const storageKey = buildSystemMediaStorageKey({ systemCode: "marketing", contextId, fileName, mediaType });
    return { ok: true, storageKey, uploadUrl: createUploadUrl(storageKey, 900), expiresIn: 900 };
  }
  if (action === "download") {
    const storageKey = clean(body.storageKey); if (!storageKey.startsWith("marketing/")) throw new MarketingError(400, "VALIDATION_ERROR", "مفتاح الملف غير صحيح");
    return { ok: true, url: createDownloadUrl(storageKey, 300) };
  }
  void request; void sql; void user;
  throw new MarketingError(400, "UNSUPPORTED_ACTION", "إجراء الملف غير مدعوم");
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  try {
    const user = await requireUser(request, response); if (!user) return;
    await assertSchema();
    const resource = clean(request.query.resource) || "meta";
    if (request.method === "GET") {
      if (resource === "meta") return response.status(200).json(await loadMeta(user));
      if (!canViewMarketing(user)) throw new MarketingError(403, "FORBIDDEN", "لا تملك صلاحية عرض نظام التسويق");
      if (resource === "dashboard") return response.status(200).json(await dashboard(user));
      if (resource === "campaign_code_preview") return response.status(200).json(await campaignCodePreview(request));
      if (resource === "campaigns") return response.status(200).json(await campaignRows(request, user));
      if (resource === "campaign") return response.status(200).json(await campaignDetail(ensureUuid(request.query.id, "الحملة"), user));
      if (resource === "stock") return response.status(200).json(await stockRows(request));
      if (resource === "packages") return response.status(200).json(await listPackages(request));
      if (resource === "photo_requests") return response.status(200).json(await listPhotoRequests(user));
      if (resource === "attendance") return response.status(200).json(await attendanceData(request, user));
      if (resource === "connections") return response.status(200).json(await listConnections());
      return response.status(404).json({ ok: false, error: "Marketing resource not found" });
    }
    if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
    const body = parseBody(request); const action = clean(body.action);
    if (!canViewMarketing(user)) throw new MarketingError(403, "FORBIDDEN", "لا تملك صلاحية استخدام نظام التسويق");
    if (action === "save_setting") return response.status(200).json(await saveSetting(body, user));
    if (action === "delete_setting") return response.status(200).json(await deleteSetting(body, user));
    if (action === "create_campaign") return response.status(200).json(await createCampaign(body, user));
    if (action === "task_action") return response.status(200).json(await taskAction(body, user));
    if (action === "campaign_action") return response.status(200).json(await campaignAction(body, user));
    if (action === "save_package") return response.status(200).json(await savePackage(body, user));
    if (action === "delete_package") { requirePermission(user, "marketing.packages.manage"); await getSql()`delete from marketing.car_packages where id=${ensureUuid(body.id,"الباقة")}::uuid`; return response.status(200).json({ ok: true }); }
    if (action === "create_photo_request") return response.status(200).json(await createPhotoRequest(body, user));
    if (action === "photo_request_action") return response.status(200).json(await photoRequestAction(body, user));
    if (action === "attendance_action") return response.status(200).json(await attendanceAction(body, user));
    if (action === "save_connection") return response.status(200).json(await saveConnection(body, user));
    if (action === "delete_connection") { requirePermission(user, "marketing.manage"); await getSql()`delete from marketing.platform_connections where id=${ensureUuid(body.id,"الربط")}::uuid`; return response.status(200).json({ ok: true }); }
    if (action === "media_action") return response.status(200).json(await mediaAction(request, body, user));
    return response.status(400).json({ ok: false, error: "إجراء التسويق غير مدعوم" });
  } catch (error) {
    if (error instanceof MarketingError) return response.status(error.status).json({ ok: false, code: error.code, error: error.message, details: error.details });
    const code = clean((error as { code?: unknown }).code);
    if (code === "23505") return response.status(409).json({ ok: false, code: "DUPLICATE", error: "السجل موجود بالفعل" });
    if (code === "23503") return response.status(409).json({ ok: false, code: "IN_USE", error: "السجل مرتبط ببيانات أخرى ولا يمكن حذفه" });
    console.error("Marketing API failed", error);
    return response.status(500).json({ ok: false, error: "حدث خطأ داخل نظام التسويق" });
  }
}
