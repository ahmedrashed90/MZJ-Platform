import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { getSql } from "../_db.js";
import { ensureMarketingSchema } from "../_marketing-schema.js";
import {
  booleanValue,
  clean,
  dateValue,
  isRecord,
  numberValue,
  parseBody,
  queryText,
  recordArray,
  requireMarketingPermission,
  requireMarketingUser,
  stringArray,
  type MarketingUser,
} from "../_marketing-utils.js";
import { createDownloadUrl, createUploadUrl, mediaStorageConfigured } from "../_media-storage.js";

const MAX_FILE_SIZE = 100 * 1024 * 1024;
type Sql = ReturnType<typeof getSql>;
type JsonRecord = Record<string, unknown>;
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function toJsonValue(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (isRecord(value)) {
    const result: { [key: string]: JsonValue } = {};
    for (const [key, entry] of Object.entries(value)) result[key] = toJsonValue(entry);
    return result;
  }
  return null;
}

type CampaignProgressRow = {
  campaign_id: string;
  progress: number;
  departments_count: number;
  tasks_count: number;
  received_count: number;
  completed_count: number;
};

type CampaignBaseRow = {
  id: string;
  source_kind: "campaign" | "agenda";
  campaign_code: string;
  name: string;
  campaign_type: string | null;
  objective: string | null;
  content_request: string | null;
  campaign_date: string | null;
  publish_start: string;
  publish_end: string;
  agenda_month: string | null;
  status: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type TaskRow = {
  id: string;
  campaign_id: string;
  creative_instance_id: string;
  template_task_id: string | null;
  task_no: string;
  task_kind: "template" | "execution";
  status: string;
  progress: number;
  due_date: string | null;
  received_at: string | null;
  completed_at: string | null;
  final_file_id: string | null;
  admin_notes: string | null;
  campaign_name: string;
  campaign_code: string;
  source_kind: "campaign" | "agenda";
  creative_name: string;
  creative_short_code: string;
  instance_code: string;
  department_id: string;
  department_name: string;
  assigned_to: string;
  assigned_name: string;
  content_writer_id: string;
  content_writer_name: string;
  template_status: string | null;
};

function safeSegment(value: unknown, fallback: string) {
  return clean(value).normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || fallback;
}

function storageKey(ownerType: string, ownerId: string, fileName: string) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `marketing/${safeSegment(ownerType, "file")}/${year}/${month}/${safeSegment(ownerId, "owner")}/${crypto.randomUUID()}-${safeSegment(fileName, "file.bin")}`;
}

function asId(value: unknown) {
  const id = clean(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : "";
}

function sourceLabel(value: string) {
  return value === "agenda" ? "أجندة" : "حملة";
}

function taskStatusLabel(status: string) {
  const labels: Record<string, string> = {
    waiting_receipt: "في انتظار الاستلام",
    active: "نشطة",
    template_review: "في انتظار مراجعة Task Template",
    revision_requested: "مطلوب تعديل",
    rejected: "مرفوضة",
    approved: "معتمدة",
    waiting_template: "في انتظار اعتماد Task Template",
    ready_to_receive: "جاهزة للاستلام",
    ready_file: "في انتظار الملف النهائي",
    completed: "تم الانتهاء",
  };
  return labels[status] || status;
}

async function loadCampaignProgress(sql: Sql, campaignIds?: string[]) {
  const rows = campaignIds?.length
    ? await sql<CampaignProgressRow[]>`
        with task_department as (
          select campaign_id,department_id,avg(progress)::numeric(7,2) as department_progress,count(*)::int as tasks_count,
            count(*) filter(where received_at is not null)::int as received_count,
            count(*) filter(where status in ('completed','approved'))::int as completed_count
          from marketing.tasks where campaign_id in ${sql(campaignIds)} group by campaign_id,department_id
        )
        select campaign_id::text,coalesce(avg(department_progress),0)::float8 as progress,count(*)::int as departments_count,
          sum(tasks_count)::int as tasks_count,sum(received_count)::int as received_count,sum(completed_count)::int as completed_count
        from task_department group by campaign_id
      `
    : await sql<CampaignProgressRow[]>`
        with task_department as (
          select campaign_id,department_id,avg(progress)::numeric(7,2) as department_progress,count(*)::int as tasks_count,
            count(*) filter(where received_at is not null)::int as received_count,
            count(*) filter(where status in ('completed','approved'))::int as completed_count
          from marketing.tasks group by campaign_id,department_id
        )
        select campaign_id::text,coalesce(avg(department_progress),0)::float8 as progress,count(*)::int as departments_count,
          sum(tasks_count)::int as tasks_count,sum(received_count)::int as received_count,sum(completed_count)::int as completed_count
        from task_department group by campaign_id
      `;
  return new Map(rows.map((row) => [row.campaign_id, row]));
}

async function loadMeta(sql: Sql, user: MarketingUser) {
  type DepartmentRow = { id: string; code: string; name: string; is_content: boolean; is_active: boolean; sort_order: number };
  type UserLinkRow = { department_id: string; user_id: string; full_name: string };
  type ActionRow = { id: string; department_id: string; name: string; code: string; progress_weight: number; admin_only: boolean; is_active: boolean; sort_order: number };
  type CreativeRow = { id: string; name: string; short_code: string; primary_department_id: string; department_name: string; is_active: boolean; sort_order: number };
  type CampaignTypeRow = { id: string; name: string; code: string; prefix: string; is_active: boolean; sort_order: number };
  type PlatformRow = { id: string; name: string; code: string; is_active: boolean; sort_order: number };
  type PublishTypeRow = { id: string; platform_id: string; name: string; dimensions: string | null; is_active: boolean; sort_order: number };
  type CategoryRow = { id: string; name: string; code: string; is_active: boolean; sort_order: number };
  type UserRow = { id: string; full_name: string; email: string | null; role_names: string; department_names: string; can_receive_tasks: boolean };
  type RequestStatusRow = { id: string; code: string; name: string; is_active: boolean; sort_order: number };

  const [departments, userLinks, actions, creatives, campaignTypes, platforms, publishTypes, packageCategories, users, requestStatuses] = await Promise.all([
    sql<DepartmentRow[]>`select id::text,code,name,is_content,is_active,sort_order from marketing.departments order by sort_order,name`,
    sql<UserLinkRow[]>`select du.department_id::text,du.user_id::text,u.full_name from marketing.department_users du join core.users u on u.id=du.user_id where u.is_active order by u.full_name`,
    sql<ActionRow[]>`select id::text,department_id::text,name,code,progress_weight::float8,is_active,admin_only,sort_order from marketing.assignment_actions order by sort_order,name`,
    sql<CreativeRow[]>`select c.id::text,c.name,c.short_code,c.primary_department_id::text,d.name as department_name,c.is_active,c.sort_order from marketing.creatives c join marketing.departments d on d.id=c.primary_department_id order by c.sort_order,c.name`,
    sql<CampaignTypeRow[]>`select id::text,name,code,prefix,is_active,sort_order from marketing.campaign_types order by sort_order,name`,
    sql<PlatformRow[]>`select id::text,name,code,is_active,sort_order from marketing.platforms order by sort_order,name`,
    sql<PublishTypeRow[]>`select id::text,platform_id::text,name,dimensions,is_active,sort_order from marketing.publish_types order by sort_order,name`,
    sql<CategoryRow[]>`select id::text,name,code,is_active,sort_order from marketing.package_categories order by sort_order,name`,
    sql<UserRow[]>`
      select u.id::text,u.full_name,u.email,u.can_receive_tasks,
        coalesce(string_agg(distinct r.name,'، '),'') as role_names,
        coalesce(string_agg(distinct d.name,'، '),'') as department_names
      from core.users u
      left join core.user_roles ur on ur.user_id=u.id left join core.roles r on r.id=ur.role_id
      left join core.user_departments ud on ud.user_id=u.id left join core.departments d on d.id=ud.department_id
      where u.is_active group by u.id order by u.full_name
    `,
    sql<RequestStatusRow[]>`select id::text,code,name,is_active,sort_order from marketing.request_statuses order by sort_order,name`,
  ]);

  return {
    ok: true,
    departments: departments.map((department) => ({
      ...department,
      users: userLinks.filter((item) => item.department_id === department.id),
      actions: actions.filter((item) => item.department_id === department.id),
    })),
    creatives,
    campaignTypes,
    platforms: platforms.map((platform) => ({ ...platform, publishTypes: publishTypes.filter((item) => item.platform_id === platform.id) })),
    packageCategories,
    requestStatuses,
    users,
    permissions: {
      admin: user.isAdmin,
      manageCampaigns: user.isAdmin || user.permissions.includes("marketing.campaigns.manage"),
      executeTasks: user.isAdmin || user.permissions.includes("marketing.tasks.execute"),
      reviewTemplates: user.isAdmin || user.permissions.includes("marketing.templates.review"),
      manageSettings: user.isAdmin || user.permissions.includes("marketing.settings.manage"),
      managePackages: user.isAdmin || user.permissions.includes("marketing.packages.manage"),
      manageRequests: user.isAdmin || user.permissions.includes("marketing.requests.manage"),
      viewReports: user.isAdmin || user.permissions.includes("marketing.reports.view"),
    },
    currentUserId: user.id,
  };
}

async function listTaskRows(sql: Sql, user: MarketingUser, mode: string) {
  const restrict = user.isAdmin ? sql`` : sql`and t.assigned_to=${user.id}::uuid`;
  let statusFilter = sql``;
  if (mode === "pending") statusFilter = sql`and t.received_at is null and t.status not in ('completed','approved','rejected')`;
  if (mode === "active") statusFilter = sql`and t.received_at is not null and t.status not in ('completed','approved','rejected')`;
  if (mode === "review") statusFilter = sql`and t.task_kind='template' and t.status='template_review'`;
  return sql<TaskRow[]>`
    select t.id::text,t.campaign_id::text,t.creative_instance_id::text,t.template_task_id::text,t.task_no,t.task_kind,t.status,t.progress::float8,
      t.due_date::text,t.received_at::text,t.completed_at::text,t.final_file_id::text,t.admin_notes,
      c.name as campaign_name,c.campaign_code,c.source_kind,cr.name as creative_name,cr.short_code as creative_short_code,ci.instance_code,
      d.id::text as department_id,d.name as department_name,t.assigned_to::text,au.full_name as assigned_name,
      t.content_writer_id::text,cu.full_name as content_writer_name,tt.status as template_status
    from marketing.tasks t
    join marketing.campaigns c on c.id=t.campaign_id and c.is_deleted=false and c.archived_at is null
    join marketing.creative_instances ci on ci.id=t.creative_instance_id
    join marketing.creatives cr on cr.id=ci.creative_id
    join marketing.departments d on d.id=t.department_id
    join core.users au on au.id=t.assigned_to
    join core.users cu on cu.id=t.content_writer_id
    left join marketing.tasks tt on tt.id=t.template_task_id
    where 1=1 ${restrict} ${statusFilter}
    order by coalesce(t.due_date,current_date+3650),t.created_at
  `;
}

async function dashboard(sql: Sql, user: MarketingUser) {
  const [pending, reviewTasks, activeTasks] = await Promise.all([
    listTaskRows(sql, user, "pending"),
    user.isAdmin || user.permissions.includes("marketing.templates.review") ? listTaskRows(sql, { ...user, isAdmin: true }, "review") : Promise.resolve([]),
    listTaskRows(sql, user, "active"),
  ]);
  type CampaignCard = CampaignBaseRow & { tasks_count: number };
  const campaignRows = await sql<CampaignCard[]>`
    select c.id::text,c.source_kind,c.campaign_code,c.name,ct.name as campaign_type,c.objective,c.content_request,c.campaign_date::text,
      c.publish_start::text,c.publish_end::text,c.agenda_month::text,c.status,c.archived_at::text,c.created_at::text,c.updated_at::text,
      count(t.id)::int as tasks_count
    from marketing.campaigns c left join marketing.campaign_types ct on ct.id=c.campaign_type_id
    left join marketing.tasks t on t.campaign_id=c.id
    where c.is_deleted=false and c.archived_at is null and c.status not in ('draft')
    group by c.id,ct.name order by c.updated_at desc
  `;
  const progressMap = await loadCampaignProgress(sql, campaignRows.map((row) => row.id));
  const cards = campaignRows.map((row) => ({ ...row, ...(progressMap.get(row.id) || { progress: 0, departments_count: 0, received_count: 0, completed_count: 0 }) }));
  const canManageCampaigns = user.isAdmin || user.permissions.includes("marketing.campaigns.manage");
  const readiness = canManageCampaigns ? cards.filter((row) => row.status !== "publish" && row.status !== "completed" && Number(row.received_count || 0) > 0) : [];
  const publishing = canManageCampaigns ? cards.filter((row) => row.status === "publish") : [];
  return {
    ok: true,
    pendingGroups: [...new Set(pending.map((task) => task.department_name))].map((departmentName) => ({
      departmentName,
      tasks: pending.filter((task) => task.department_name === departmentName).map((task) => ({ ...task, status_label: taskStatusLabel(task.status), source_label: sourceLabel(task.source_kind) })),
    })),
    reviewTasks: reviewTasks.map((task) => ({ ...task, status_label: taskStatusLabel(task.status) })),
    activeTasks: activeTasks.map((task) => ({ ...task, status_label: taskStatusLabel(task.status) })),
    readiness,
    publishing,
  };
}

async function listCampaigns(sql: Sql, request: VercelRequest) {
  const search = queryText(request.query.search);
  const kind = queryText(request.query.kind);
  const status = queryText(request.query.status);
  const archive = queryText(request.query.archive) === "1";
  const pattern = `%${search}%`;
  const rows = await sql<CampaignBaseRow[]>`
    select c.id::text,c.source_kind,c.campaign_code,c.name,ct.name as campaign_type,c.objective,c.content_request,c.campaign_date::text,
      c.publish_start::text,c.publish_end::text,c.agenda_month::text,c.status,c.archived_at::text,c.created_at::text,c.updated_at::text
    from marketing.campaigns c left join marketing.campaign_types ct on ct.id=c.campaign_type_id
    where c.is_deleted=false
      and (${archive}=true and c.archived_at is not null or ${archive}=false and c.archived_at is null)
      and (${search}='' or c.name ilike ${pattern} or c.campaign_code ilike ${pattern})
      and (${kind}='' or c.source_kind=${kind})
      and (${status}='' or c.status=${status})
    order by c.created_at desc
  `;
  const progressMap = await loadCampaignProgress(sql, rows.map((row) => row.id));
  return { ok: true, rows: rows.map((row) => ({ ...row, ...(progressMap.get(row.id) || { progress: 0, departments_count: 0, tasks_count: 0, received_count: 0, completed_count: 0 }) })) };
}

async function campaignDetail(sql: Sql, campaignId: string) {
  if (!campaignId) throw new Error("الحملة أو الأجندة غير موجودة");
  const [campaign] = await sql<CampaignBaseRow[]>`
    select c.id::text,c.source_kind,c.campaign_code,c.name,ct.name as campaign_type,c.objective,c.content_request,c.campaign_date::text,
      c.publish_start::text,c.publish_end::text,c.agenda_month::text,c.status,c.archived_at::text,c.created_at::text,c.updated_at::text
    from marketing.campaigns c left join marketing.campaign_types ct on ct.id=c.campaign_type_id where c.id=${campaignId}::uuid and c.is_deleted=false
  `;
  if (!campaign) throw new Error("الحملة أو الأجندة غير موجودة");
  const [instances, contentUsers, sections, sectionUsers, writerLinks, vehicles, instancePlatforms, instancePublishTypes, budgets, budgetPlatforms, schedule, schedulePlatforms, tasks, actions, submissions, files, links, days] = await Promise.all([
    sql<JsonRecord[]>`select ci.id::text,ci.agenda_day_id::text,ci.creative_id::text,ci.instance_no,ci.instance_code,ci.content_received_date::text,ci.content_notes,ci.primary_received_date::text,ci.primary_notes,ci.is_complete,cr.name as creative_name,cr.short_code,d.name as primary_department from marketing.creative_instances ci join marketing.creatives cr on cr.id=ci.creative_id join marketing.departments d on d.id=cr.primary_department_id where ci.campaign_id=${campaignId}::uuid order by ci.instance_no`,
    sql<JsonRecord[]>`select icu.creative_instance_id::text,icu.user_id::text,u.full_name,icu.due_date::text,icu.notes from marketing.instance_content_users icu join core.users u on u.id=icu.user_id join marketing.creative_instances ci on ci.id=icu.creative_instance_id where ci.campaign_id=${campaignId}::uuid order by u.full_name`,
    sql<JsonRecord[]>`select s.id::text,s.creative_instance_id::text,s.department_id::text,d.name as department_name,s.section_kind,s.received_date::text,s.notes,s.sort_order from marketing.instance_sections s join marketing.departments d on d.id=s.department_id join marketing.creative_instances ci on ci.id=s.creative_instance_id where ci.campaign_id=${campaignId}::uuid order by s.sort_order,d.name`,
    sql<JsonRecord[]>`select su.id::text,su.instance_section_id::text,su.user_id::text,u.full_name,su.due_date::text from marketing.section_users su join core.users u on u.id=su.user_id join marketing.instance_sections s on s.id=su.instance_section_id join marketing.creative_instances ci on ci.id=s.creative_instance_id where ci.campaign_id=${campaignId}::uuid order by u.full_name`,
    sql<JsonRecord[]>`select sw.section_user_id::text,sw.content_user_id::text,u.full_name,sw.due_date::text from marketing.section_user_writers sw join core.users u on u.id=sw.content_user_id join marketing.section_users su on su.id=sw.section_user_id join marketing.instance_sections s on s.id=su.instance_section_id join marketing.creative_instances ci on ci.id=s.creative_instance_id where ci.campaign_id=${campaignId}::uuid`,
    sql<JsonRecord[]>`select iv.creative_instance_id::text,v.id::text as vehicle_id,v.vin,v.car_name,v.statement,v.exterior_color,v.interior_color,v.model_year,l.name as location_name from marketing.instance_vehicles iv join operations.vehicles v on v.id=iv.vehicle_id left join operations.locations l on l.id=v.location_id join marketing.creative_instances ci on ci.id=iv.creative_instance_id where ci.campaign_id=${campaignId}::uuid order by v.vin`,
    sql<JsonRecord[]>`select ip.creative_instance_id::text,ip.platform_id::text,p.name as platform_name from marketing.instance_platforms ip join marketing.platforms p on p.id=ip.platform_id join marketing.creative_instances ci on ci.id=ip.creative_instance_id where ci.campaign_id=${campaignId}::uuid`,
    sql<JsonRecord[]>`select it.creative_instance_id::text,it.publish_type_id::text,pt.platform_id::text,pt.name,pt.dimensions from marketing.instance_publish_types it join marketing.publish_types pt on pt.id=it.publish_type_id join marketing.creative_instances ci on ci.id=it.creative_instance_id where ci.campaign_id=${campaignId}::uuid`,
    sql<JsonRecord[]>`select b.id::text,b.creative_instance_id::text,b.funnel,b.ads_count,b.content_goal,b.expected_goal,b.sort_order,ci.instance_code,cr.name as creative_name from marketing.budget_items b join marketing.creative_instances ci on ci.id=b.creative_instance_id join marketing.creatives cr on cr.id=ci.creative_id where b.campaign_id=${campaignId}::uuid order by b.sort_order`,
    sql<JsonRecord[]>`select bp.budget_item_id::text,bp.platform_id::text,p.name as platform_name,bp.amount::float8 from marketing.budget_item_platforms bp join marketing.platforms p on p.id=bp.platform_id join marketing.budget_items b on b.id=bp.budget_item_id where b.campaign_id=${campaignId}::uuid`,
    sql<JsonRecord[]>`select s.id::text,s.creative_instance_id::text,s.publish_date::text,s.sort_order,ci.instance_code,cr.name as creative_name from marketing.schedule_items s join marketing.creative_instances ci on ci.id=s.creative_instance_id join marketing.creatives cr on cr.id=ci.creative_id where s.campaign_id=${campaignId}::uuid order by s.publish_date,s.sort_order`,
    sql<JsonRecord[]>`select sp.schedule_item_id::text,sp.platform_id::text,p.name as platform_name,sp.publish_type_id::text,pt.name as publish_type_name,pt.dimensions from marketing.schedule_item_platforms sp join marketing.platforms p on p.id=sp.platform_id join marketing.publish_types pt on pt.id=sp.publish_type_id join marketing.schedule_items s on s.id=sp.schedule_item_id where s.campaign_id=${campaignId}::uuid`,
    sql<TaskRow[]>`
      select t.id::text,t.campaign_id::text,t.creative_instance_id::text,t.template_task_id::text,t.task_no,t.task_kind,t.status,t.progress::float8,t.due_date::text,t.received_at::text,t.completed_at::text,t.final_file_id::text,t.admin_notes,
        c.name as campaign_name,c.campaign_code,c.source_kind,cr.name as creative_name,cr.short_code as creative_short_code,ci.instance_code,d.id::text as department_id,d.name as department_name,
        t.assigned_to::text,au.full_name as assigned_name,t.content_writer_id::text,cu.full_name as content_writer_name,tt.status as template_status
      from marketing.tasks t join marketing.campaigns c on c.id=t.campaign_id join marketing.creative_instances ci on ci.id=t.creative_instance_id join marketing.creatives cr on cr.id=ci.creative_id join marketing.departments d on d.id=t.department_id join core.users au on au.id=t.assigned_to join core.users cu on cu.id=t.content_writer_id left join marketing.tasks tt on tt.id=t.template_task_id where t.campaign_id=${campaignId}::uuid order by ci.instance_no,d.sort_order,t.task_kind,t.task_no
    `,
    sql<JsonRecord[]>`select ta.task_id::text,ta.assignment_action_id::text,a.name,a.code,a.progress_weight::float8,a.admin_only,ta.completed,ta.completed_at::text,ta.notes from marketing.task_actions ta join marketing.assignment_actions a on a.id=ta.assignment_action_id join marketing.tasks t on t.id=ta.task_id where t.campaign_id=${campaignId}::uuid order by a.sort_order`,
    sql<JsonRecord[]>`select s.id::text,s.task_id::text,s.revision_no,s.file_id::text,s.parsed_data,s.status,s.submitted_at::text,s.reviewed_at::text,s.review_notes,u.full_name as submitted_by_name,ru.full_name as reviewed_by_name from marketing.template_submissions s join marketing.tasks t on t.id=s.task_id join core.users u on u.id=s.submitted_by left join core.users ru on ru.id=s.reviewed_by where t.campaign_id=${campaignId}::uuid order by s.task_id,s.revision_no desc`,
    sql<JsonRecord[]>`select f.id::text,f.owner_type,f.owner_id::text,f.original_name,f.mime_type,f.file_size,f.status,f.metadata,f.created_at::text,u.full_name as uploaded_by_name from marketing.files f join core.users u on u.id=f.uploaded_by where f.owner_id=${campaignId}::uuid or f.owner_id in (select id from marketing.tasks where campaign_id=${campaignId}::uuid) order by f.created_at desc`,
    sql<JsonRecord[]>`select l.id::text,l.platform_id::text,p.name as platform_name,l.url,l.created_at::text,u.full_name as created_by_name from marketing.campaign_links l join marketing.platforms p on p.id=l.platform_id join core.users u on u.id=l.created_by where l.campaign_id=${campaignId}::uuid order by l.created_at desc`,
    sql<JsonRecord[]>`select id::text,agenda_date::text,sort_order from marketing.agenda_days where campaign_id=${campaignId}::uuid order by agenda_date`,
  ]);
  const progress = (await loadCampaignProgress(sql, [campaignId])).get(campaignId) || { progress: 0, departments_count: 0, tasks_count: 0, received_count: 0, completed_count: 0 };
  return { ok: true, campaign: { ...campaign, ...progress }, instances, contentUsers, sections, sectionUsers, writerLinks, vehicles, instancePlatforms, instancePublishTypes, budgets, budgetPlatforms, schedule, schedulePlatforms, tasks: tasks.map((task) => ({ ...task, status_label: taskStatusLabel(task.status) })), actions, submissions, files, links, days };
}

async function stock(sql: Sql, request: VercelRequest) {
  const search = queryText(request.query.search);
  const pattern = `%${search}%`;
  type VehicleRow = { id: string; vin: string; car_name: string | null; statement: string | null; exterior_color: string | null; interior_color: string | null; model_year: string | null; location_name: string | null; status_code: string; active_photo_requests: number; content_uses: number };
  const rows = await sql<VehicleRow[]>`
    select v.id::text,v.vin,v.car_name,v.statement,v.exterior_color,v.interior_color,v.model_year,l.name as location_name,v.status_code,
      (select count(*)::int from operations.photography_request_vehicles prv join operations.photography_requests pr on pr.id=prv.request_id where prv.vehicle_id=v.id and pr.is_deleted=false and pr.status<>'completed') as active_photo_requests,
      (select count(*)::int from marketing.instance_vehicles iv where iv.vehicle_id=v.id) as content_uses
    from operations.vehicles v left join operations.locations l on l.id=v.location_id
    where v.is_deleted=false and coalesce(v.archived_at,null) is null
      and (${search}='' or v.vin ilike ${pattern} or coalesce(v.car_name,'') ilike ${pattern} or coalesce(v.statement,'') ilike ${pattern})
    order by v.updated_at desc limit 1000
  `;
  return { ok: true, rows };
}

async function photoRequests(sql: Sql, request: VercelRequest, user: MarketingUser) {
  const status = queryText(request.query.status);
  type PhotoRow = { id: string; request_no: string | null; status: string; requested_by_name: string | null; requested_at: string; photography_date: string | null; note: string | null; completed_at: string | null; vehicles: JsonRecord[] };
  const scope = user.isAdmin || user.permissions.includes("marketing.requests.manage") ? sql`` : sql`and pr.requested_by=${user.id}::uuid`;
  const rows = await sql<PhotoRow[]>`
    select pr.id::text,pr.request_no,pr.status,pr.requested_by_name,pr.requested_at::text,pr.photography_date::text,pr.note,pr.completed_at::text,
      coalesce(jsonb_agg(jsonb_build_object('id',v.id::text,'vin',v.vin,'car_name',v.car_name,'statement',v.statement,'location_name',l.name)) filter(where v.id is not null),'[]'::jsonb) as vehicles
    from operations.photography_requests pr
    left join operations.photography_request_vehicles prv on prv.request_id=pr.id
    left join operations.vehicles v on v.id=prv.vehicle_id
    left join operations.locations l on l.id=v.location_id
    where pr.is_deleted=false and (${status}='' or pr.status=${status}) ${scope}
    group by pr.id order by pr.requested_at desc
  `;
  return { ok: true, rows };
}

async function packages(sql: Sql, request: VercelRequest) {
  const search = queryText(request.query.search);
  const categoryId = asId(request.query.categoryId);
  const pattern = `%${search}%`;
  const rows = await sql<JsonRecord[]>`
    select p.id::text,p.name,p.category_id::text,c.name as category_name,c.code as category_code,p.price::float8,p.cash_discount::float8,
      p.registration_fee,p.insurance,p.issuance_fee,p.car_care_lines,p.delivery_mode,p.is_active,p.created_at::text,p.updated_at::text
    from marketing.packages p join marketing.package_categories c on c.id=p.category_id
    where (${search}='' or p.name ilike ${pattern}) and (${categoryId}='' or p.category_id=${categoryId}::uuid)
    order by c.sort_order,p.created_at desc
  `;
  return { ok: true, rows };
}

async function calendar(sql: Sql, request: VercelRequest, user: MarketingUser) {
  const month = queryText(request.query.month) || new Date().toISOString().slice(0, 7);
  const from = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
  const scope = user.isAdmin || user.permissions.includes("marketing.campaigns.manage") ? sql`` : sql`and t.assigned_to=${user.id}::uuid`;
  const rows = await sql<JsonRecord[]>`
    select t.id::text,t.task_no,t.received_at::text,t.status,t.progress::float8,c.id::text as campaign_id,c.source_kind,c.name as campaign_name,c.campaign_code,
      ci.instance_code,cr.name as creative_name,d.name as department_name,u.full_name as assigned_name,cu.full_name as content_writer_name
    from marketing.tasks t join marketing.campaigns c on c.id=t.campaign_id join marketing.creative_instances ci on ci.id=t.creative_instance_id join marketing.creatives cr on cr.id=ci.creative_id join marketing.departments d on d.id=t.department_id join core.users u on u.id=t.assigned_to join core.users cu on cu.id=t.content_writer_id
    where t.received_at>=${from}::date and t.received_at<${next}::date and c.is_deleted=false ${scope}
    order by t.received_at
  `;
  return { ok: true, month, rows };
}

async function reports(sql: Sql, request: VercelRequest) {
  const from = dateValue(request.query.from);
  const to = dateValue(request.query.to);
  const rows = await sql<JsonRecord[]>`
    select c.id::text,c.source_kind,c.campaign_code,c.name,c.status,c.publish_start::text,c.publish_end::text,c.created_at::text,
      count(distinct t.id)::int as tasks_count,count(distinct t.id) filter(where t.status in ('completed','approved'))::int as completed_tasks,
      count(distinct t.id) filter(where t.due_date<current_date and t.status not in ('completed','approved','rejected'))::int as delayed_tasks,
      count(distinct ci.id)::int as instances_count
    from marketing.campaigns c left join marketing.tasks t on t.campaign_id=c.id left join marketing.creative_instances ci on ci.campaign_id=c.id
    where c.is_deleted=false and (${from}='' or c.created_at::date>=${from}::date) and (${to}='' or c.created_at::date<=${to}::date)
    group by c.id order by c.created_at desc
  `;
  const progressMap = await loadCampaignProgress(sql, rows.map((row) => clean(row.id)));
  const employee = await sql<JsonRecord[]>`
    select u.id::text,u.full_name,d.name as department_name,count(t.id)::int as tasks_count,
      count(t.id) filter(where t.status in ('completed','approved'))::int as completed_count,
      count(t.id) filter(where t.due_date<current_date and t.status not in ('completed','approved','rejected'))::int as delayed_count,
      coalesce(avg(t.progress),0)::float8 as average_progress
    from marketing.tasks t join core.users u on u.id=t.assigned_to join marketing.departments d on d.id=t.department_id join marketing.campaigns c on c.id=t.campaign_id
    where c.is_deleted=false and (${from}='' or t.created_at::date>=${from}::date) and (${to}='' or t.created_at::date<=${to}::date)
    group by u.id,d.id order by u.full_name
  `;
  return { ok: true, campaigns: rows.map((row) => ({ ...row, ...(progressMap.get(clean(row.id)) || { progress: 0 }) })), employees: employee };
}

async function attendance(sql: Sql, request: VercelRequest, user: MarketingUser) {
  const month = queryText(request.query.month) || new Date().toISOString().slice(0, 7);
  const scope = user.isAdmin ? sql`` : sql`and a.user_id=${user.id}::uuid`;
  const rows = await sql<JsonRecord[]>`
    select a.id::text,a.user_id::text,u.full_name,a.attendance_date::text,a.check_in_at::text,a.check_out_at::text,a.status,a.notes
    from marketing.attendance a join core.users u on u.id=a.user_id where to_char(a.attendance_date,'YYYY-MM')=${month} ${scope} order by a.attendance_date desc,u.full_name
  `;
  return { ok: true, month, rows };
}

async function connections(sql: Sql) {
  const rows = await sql<JsonRecord[]>`
    select c.id::text,c.platform_id::text,p.name as platform_name,p.code as platform_code,c.connection_name,c.account_label,c.status,c.created_at::text,c.updated_at::text
    from marketing.platform_connections c join marketing.platforms p on p.id=c.platform_id order by p.sort_order,c.connection_name
  `;
  return { ok: true, rows };
}

async function publishPrep(sql: Sql, request: VercelRequest, user: MarketingUser) {
  const status = queryText(request.query.status);
  const platformId = asId(request.query.platformId);
  const departmentId = asId(request.query.departmentId);
  const search = queryText(request.query.search);
  const pattern = `%${search}%`;
  const scope = user.isAdmin || user.permissions.includes("marketing.campaigns.manage") ? sql`` : sql`and t.assigned_to=${user.id}::uuid`;
  const rows = await sql<JsonRecord[]>`
    select t.id::text,t.task_no,t.status,t.progress::float8,t.due_date::text,t.received_at::text,t.final_file_id::text,
      c.id::text as campaign_id,c.source_kind,c.name as campaign_name,c.campaign_code,ci.instance_code,cr.name as creative_name,
      d.id::text as department_id,d.name as department_name,u.full_name as assigned_name,cu.full_name as content_writer_name,
      f.original_name as final_file_name,
      coalesce(array_agg(distinct p.name) filter(where p.id is not null),'{}') as platforms
    from marketing.tasks t join marketing.campaigns c on c.id=t.campaign_id join marketing.creative_instances ci on ci.id=t.creative_instance_id join marketing.creatives cr on cr.id=ci.creative_id join marketing.departments d on d.id=t.department_id join core.users u on u.id=t.assigned_to join core.users cu on cu.id=t.content_writer_id left join marketing.files f on f.id=t.final_file_id left join marketing.instance_platforms ip on ip.creative_instance_id=ci.id left join marketing.platforms p on p.id=ip.platform_id
    where t.task_kind='execution' and c.is_deleted=false and c.archived_at is null ${scope}
      and (${status}='' or t.status=${status}) and (${departmentId}='' or d.id=${departmentId}::uuid)
      and (${platformId}='' or exists(select 1 from marketing.instance_platforms ix where ix.creative_instance_id=ci.id and ix.platform_id=${platformId}::uuid))
      and (${search}='' or t.task_no ilike ${pattern} or c.name ilike ${pattern} or cr.name ilike ${pattern} or u.full_name ilike ${pattern})
    group by t.id,c.id,ci.id,cr.id,d.id,u.id,cu.id,f.id order by coalesce(t.due_date,current_date+3650),t.created_at
  `;
  return { ok: true, rows };
}

async function taskDetail(sql: Sql, taskId: string, user: MarketingUser) {
  const [task] = await sql<TaskRow[]>`
    select t.id::text,t.campaign_id::text,t.creative_instance_id::text,t.template_task_id::text,t.task_no,t.task_kind,t.status,t.progress::float8,t.due_date::text,t.received_at::text,t.completed_at::text,t.final_file_id::text,t.admin_notes,
      c.name as campaign_name,c.campaign_code,c.source_kind,cr.name as creative_name,cr.short_code as creative_short_code,ci.instance_code,d.id::text as department_id,d.name as department_name,
      t.assigned_to::text,au.full_name as assigned_name,t.content_writer_id::text,cu.full_name as content_writer_name,tt.status as template_status
    from marketing.tasks t join marketing.campaigns c on c.id=t.campaign_id join marketing.creative_instances ci on ci.id=t.creative_instance_id join marketing.creatives cr on cr.id=ci.creative_id join marketing.departments d on d.id=t.department_id join core.users au on au.id=t.assigned_to join core.users cu on cu.id=t.content_writer_id left join marketing.tasks tt on tt.id=t.template_task_id where t.id=${taskId}::uuid
  `;
  if (!task) throw new Error("التاسك غير موجودة");
  const canViewTask = user.isAdmin || user.permissions.includes("marketing.campaigns.manage") || user.permissions.includes("marketing.templates.review") || task.assigned_to === user.id || task.content_writer_id === user.id;
  if (!canViewTask) throw new Error("لا توجد صلاحية لعرض هذه التاسك");
  const [campaign, instance, vehicles, actions, submissions, approvedTemplate, files] = await Promise.all([
    sql<JsonRecord[]>`select c.*,c.id::text,c.campaign_type_id::text,ct.name as campaign_type from marketing.campaigns c left join marketing.campaign_types ct on ct.id=c.campaign_type_id where c.id=${task.campaign_id}::uuid`,
    sql<JsonRecord[]>`select ci.*,ci.id::text,ci.agenda_day_id::text,ad.agenda_date::text from marketing.creative_instances ci left join marketing.agenda_days ad on ad.id=ci.agenda_day_id where ci.id=${task.creative_instance_id}::uuid`,
    sql<JsonRecord[]>`select v.id::text,v.vin,v.car_name,v.statement,v.exterior_color,v.interior_color,v.model_year,l.name as location_name from marketing.instance_vehicles iv join operations.vehicles v on v.id=iv.vehicle_id left join operations.locations l on l.id=v.location_id where iv.creative_instance_id=${task.creative_instance_id}::uuid`,
    sql<JsonRecord[]>`select ta.assignment_action_id::text,a.name,a.code,a.progress_weight::float8,a.admin_only,ta.completed,ta.completed_at::text,ta.notes from marketing.task_actions ta join marketing.assignment_actions a on a.id=ta.assignment_action_id where ta.task_id=${taskId}::uuid order by a.sort_order`,
    sql<JsonRecord[]>`select s.id::text,s.revision_no,s.file_id::text,s.parsed_data,s.status,s.submitted_at::text,s.reviewed_at::text,s.review_notes,f.original_name from marketing.template_submissions s join marketing.files f on f.id=s.file_id where s.task_id=${taskId}::uuid order by s.revision_no desc`,
    task.task_kind === "execution" && task.template_task_id ? sql<JsonRecord[]>`select s.id::text,s.parsed_data,s.file_id::text,s.revision_no,s.review_notes from marketing.template_submissions s where s.task_id=${task.template_task_id}::uuid and s.status='approved' order by s.revision_no desc limit 1` : Promise.resolve([]),
    sql<JsonRecord[]>`select id::text,owner_type,owner_id::text,original_name,mime_type,file_size,status,metadata,created_at::text from marketing.files where owner_id=${taskId}::uuid order by created_at desc`,
  ]);
  return { ok: true, task: { ...task, status_label: taskStatusLabel(task.status) }, campaign: campaign[0], instance: instance[0], vehicles, actions, submissions, approvedTemplate: approvedTemplate[0] || null, files };
}

async function saveSetting(sql: Sql, body: JsonRecord, user: MarketingUser) {
  const entity = clean(body.entity);
  const id = asId(body.id);
  if (entity === "department") {
    const name = clean(body.name); const code = clean(body.code).toLowerCase();
    if (!name || !code) throw new Error("اسم وكود القسم مطلوبان");
    const [row] = id
      ? await sql<{ id: string }[]>`update marketing.departments set name=${name},code=${code},is_content=${booleanValue(body.isContent)},is_active=${body.isActive !== false},sort_order=${numberValue(body.sortOrder)},updated_at=now() where id=${id}::uuid returning id::text`
      : await sql<{ id: string }[]>`insert into marketing.departments(name,code,is_content,is_active,sort_order) values(${name},${code},${booleanValue(body.isContent)},${body.isActive !== false},${numberValue(body.sortOrder)}) returning id::text`;
    if (!row) throw new Error("تعذر حفظ القسم");
    const userIds = stringArray(body.userIds).map(asId).filter(Boolean);
    await sql.begin(async (tx) => {
      await tx`delete from marketing.department_users where department_id=${row.id}::uuid`;
      for (const userId of userIds) await tx`insert into marketing.department_users(department_id,user_id) values(${row.id}::uuid,${userId}::uuid) on conflict do nothing`;
    });
    return { ok: true, id: row.id, message: "تم حفظ القسم" };
  }
  if (entity === "action") {
    const departmentId = asId(body.departmentId); const name = clean(body.name); const code = clean(body.code).toLowerCase(); const weight = numberValue(body.progressWeight);
    if (!departmentId || !name || !code || weight < 0 || weight > 100) throw new Error("بيانات إجراء التكليف غير مكتملة");
    const [row] = id
      ? await sql<{ id: string }[]>`update marketing.assignment_actions set department_id=${departmentId}::uuid,name=${name},code=${code},progress_weight=${weight},admin_only=${booleanValue(body.adminOnly)},is_active=${body.isActive !== false},sort_order=${numberValue(body.sortOrder)},updated_at=now() where id=${id}::uuid returning id::text`
      : await sql<{ id: string }[]>`insert into marketing.assignment_actions(department_id,name,code,progress_weight,admin_only,is_active,sort_order) values(${departmentId}::uuid,${name},${code},${weight},${booleanValue(body.adminOnly)},${body.isActive !== false},${numberValue(body.sortOrder)}) returning id::text`;
    return { ok: true, id: row?.id, message: "تم حفظ إجراء التكليف" };
  }
  if (entity === "creative") {
    const name = clean(body.name); const shortCode = clean(body.shortCode); const departmentId = asId(body.primaryDepartmentId);
    if (!name || !shortCode || !departmentId) throw new Error("بيانات الكرييتيف غير مكتملة");
    const [row] = id
      ? await sql<{ id: string }[]>`update marketing.creatives set name=${name},short_code=${shortCode},primary_department_id=${departmentId}::uuid,is_active=${body.isActive !== false},sort_order=${numberValue(body.sortOrder)},updated_at=now() where id=${id}::uuid returning id::text`
      : await sql<{ id: string }[]>`insert into marketing.creatives(name,short_code,primary_department_id,is_active,sort_order) values(${name},${shortCode},${departmentId}::uuid,${body.isActive !== false},${numberValue(body.sortOrder)}) returning id::text`;
    return { ok: true, id: row?.id, message: "تم حفظ الكرييتيف" };
  }
  if (entity === "campaignType") {
    const name = clean(body.name); const code = clean(body.code).toUpperCase(); const prefix = clean(body.prefix).toUpperCase() || "MZJ";
    if (!name || !code) throw new Error("بيانات نوع الحملة غير مكتملة");
    const [row] = id
      ? await sql<{ id: string }[]>`update marketing.campaign_types set name=${name},code=${code},prefix=${prefix},is_active=${body.isActive !== false},sort_order=${numberValue(body.sortOrder)},updated_at=now() where id=${id}::uuid returning id::text`
      : await sql<{ id: string }[]>`insert into marketing.campaign_types(name,code,prefix,is_active,sort_order) values(${name},${code},${prefix},${body.isActive !== false},${numberValue(body.sortOrder)}) returning id::text`;
    return { ok: true, id: row?.id, message: "تم حفظ نوع الحملة" };
  }
  if (entity === "platform") {
    const name = clean(body.name); const code = clean(body.code).toLowerCase();
    if (!name || !code) throw new Error("اسم وكود المنصة مطلوبان");
    return sql.begin(async (tx) => {
      const [row] = id
        ? await tx<{ id: string }[]>`update marketing.platforms set name=${name},code=${code},is_active=${body.isActive !== false},sort_order=${numberValue(body.sortOrder)},updated_at=now() where id=${id}::uuid returning id::text`
        : await tx<{ id: string }[]>`insert into marketing.platforms(name,code,is_active,sort_order) values(${name},${code},${body.isActive !== false},${numberValue(body.sortOrder)}) returning id::text`;
      if (!row) throw new Error("تعذر حفظ المنصة");
      await tx`delete from marketing.publish_types where platform_id=${row.id}::uuid`;
      for (const [index, item] of recordArray(body.publishTypes).entries()) {
        const typeName = clean(item.name); if (!typeName) continue;
        await tx`insert into marketing.publish_types(platform_id,name,dimensions,is_active,sort_order) values(${row.id}::uuid,${typeName},${clean(item.dimensions)||null},${item.isActive !== false},${numberValue(item.sortOrder,index*10+10)})`;
      }
      return { ok: true, id: row.id, message: "تم حفظ المنصة وأنواع النشر" };
    });
  }
  if (entity === "packageCategory") {
    const name = clean(body.name); const code = clean(body.code).toLowerCase();
    if (!name || !code) throw new Error("بيانات التصنيف غير مكتملة");
    const [row] = id
      ? await sql<{ id: string }[]>`update marketing.package_categories set name=${name},code=${code},is_active=${body.isActive !== false},sort_order=${numberValue(body.sortOrder)},updated_at=now() where id=${id}::uuid returning id::text`
      : await sql<{ id: string }[]>`insert into marketing.package_categories(name,code,is_active,sort_order) values(${name},${code},${body.isActive !== false},${numberValue(body.sortOrder)}) returning id::text`;
    return { ok: true, id: row?.id, message: "تم حفظ تصنيف الباقة" };
  }
  if (entity === "requestStatus") {
    const name = clean(body.name); const code = clean(body.code).toLowerCase();
    if (!name || !code) throw new Error("بيانات حالة الطلب غير مكتملة");
    const [row] = id
      ? await sql<{ id: string }[]>`update marketing.request_statuses set name=${name},code=${code},is_active=${body.isActive !== false},sort_order=${numberValue(body.sortOrder)},updated_at=now() where id=${id}::uuid returning id::text`
      : await sql<{ id: string }[]>`insert into marketing.request_statuses(name,code,is_active,sort_order) values(${name},${code},${body.isActive !== false},${numberValue(body.sortOrder)}) returning id::text`;
    return { ok: true, id: row?.id, message: "تم حفظ حالة الطلب" };
  }
  throw new Error("نوع الإعداد غير مدعوم");
}

async function disableSetting(sql: Sql, body: JsonRecord) {
  const entity = clean(body.entity); const id = asId(body.id);
  if (!id) throw new Error("السجل غير موجود");
  const tables: Record<string, string> = {
    department: "departments", action: "assignment_actions", creative: "creatives", campaignType: "campaign_types", platform: "platforms", packageCategory: "package_categories", requestStatus: "request_statuses",
  };
  const table = tables[entity];
  if (!table) throw new Error("نوع الإعداد غير مدعوم");
  await sql.unsafe(`update marketing.${table} set is_active=false,updated_at=now() where id=$1::uuid`, [id]);
  return { ok: true, message: "تم تعطيل السجل" };
}

async function createCampaign(sql: Sql, body: JsonRecord, user: MarketingUser) {
  const idempotencyKey = clean(body.idempotencyKey) || crypto.randomUUID();
  const sourceKind = clean(body.sourceKind) === "agenda" ? "agenda" : "campaign";
  const name = clean(body.name);
  const campaignTypeId = asId(body.campaignTypeId);
  const publishStart = dateValue(body.publishStart);
  const publishEnd = dateValue(body.publishEnd);
  if (!name || !publishStart || !publishEnd || publishEnd < publishStart) throw new Error("بيانات وتواريخ الحملة أو الأجندة غير مكتملة");
  const instancesInput: JsonRecord[] = sourceKind === "agenda"
    ? recordArray(body.days).flatMap((day) =>
        recordArray(day.instances).map((instance): JsonRecord => ({
          ...instance,
          agendaDate: dateValue(day.date),
        })),
      )
    : recordArray(body.instances);
  if (!instancesInput.length) throw new Error("أضف كرييتيفًا واحدًا على الأقل");

  return sql.begin(async (tx) => {
    const nextTaskNo = async (instanceCode: string, shortCode: string, kind: "template" | "execution") => {
      const [sequence] = await tx<{ value: number }[]>`select nextval('marketing.task_no_seq')::bigint as value`;
      const marker = kind === "template" ? "CONTENT" : "EXEC";
      const suffix = crypto.randomBytes(5).toString("hex").toUpperCase();
      return `${instanceCode}-${shortCode}-${marker}-${String(sequence?.value || 0).padStart(6, "0")}-${suffix}`;
    };

    const [existing] = await tx<{ id: string; campaign_code: string }[]>`select id::text,campaign_code from marketing.campaigns where idempotency_key=${idempotencyKey}`;
    if (existing) return { ok: true, id: existing.id, campaignCode: existing.campaign_code, duplicate: true, message: "تم إنشاء السجل من قبل" };

    let typeCode = sourceKind === "agenda" ? "AGENDA" : "GENERAL";
    let prefix = "MZJ";
    if (campaignTypeId) {
      const [type] = await tx<{ code: string; prefix: string }[]>`select code,prefix from marketing.campaign_types where id=${campaignTypeId}::uuid and is_active`;
      if (!type && sourceKind === "campaign") throw new Error("نوع الحملة غير موجود");
      if (type) { typeCode = type.code; prefix = type.prefix; }
    }
    const monthCode = publishStart.slice(0, 7);
    const baseCode = `${prefix}-${typeCode}-${monthCode}`;
    const [sameCount] = await tx<{ count: number }[]>`select count(*)::int as count from marketing.campaigns where campaign_code=${baseCode} or campaign_code like ${`${baseCode}-%`}`;
    const campaignCode = Number(sameCount?.count || 0) === 0 ? baseCode : `${baseCode}-${String(Number(sameCount?.count || 0) + 1).padStart(2, "0")}`;
    const [campaign] = await tx<{ id: string }[]>`
      insert into marketing.campaigns(idempotency_key,source_kind,campaign_code,name,campaign_type_id,objective,content_request,campaign_date,publish_start,publish_end,agenda_month,status,created_by)
      values(${idempotencyKey},${sourceKind},${campaignCode},${name},${campaignTypeId||null},${clean(body.objective)||null},${clean(body.contentRequest)||null},${dateValue(body.campaignDate)||null},${publishStart},${publishEnd},${dateValue(body.agendaMonth)||null},'active',${user.id}::uuid)
      returning id::text
    `;
    if (!campaign) throw new Error("تعذر إنشاء الحملة أو الأجندة");

    const dayMap = new Map<string, string>();
    if (sourceKind === "agenda") {
      const dates = [...new Set(instancesInput.map((item) => dateValue(item.agendaDate)).filter(Boolean))].sort();
      for (const [index, agendaDate] of dates.entries()) {
        const [day] = await tx<{ id: string }[]>`insert into marketing.agenda_days(campaign_id,agenda_date,sort_order) values(${campaign.id}::uuid,${agendaDate},${index}) returning id::text`;
        if (day) dayMap.set(agendaDate, day.id);
      }
    }

    const instanceMap = new Map<string, { id: string; instanceCode: string; shortCode: string; contentUsers: string[] }>();
    const contentDepartment = await tx<{ id: string }[]>`select id::text from marketing.departments where is_content=true and is_active order by sort_order limit 1`;
    if (!contentDepartment[0]) throw new Error("يجب تحديد قسم المحتوى من إعدادات التسويق");

    for (const [index, instanceInput] of instancesInput.entries()) {
      const clientKey = clean(instanceInput.clientKey) || `instance-${index+1}`;
      const creativeId = asId(instanceInput.creativeId);
      const [creative] = await tx<{ id: string; short_code: string; primary_department_id: string }[]>`select id::text,short_code,primary_department_id::text from marketing.creatives where id=${creativeId}::uuid and is_active`;
      if (!creative) throw new Error("أحد الكرييتيفات المختارة غير موجود");
      const instanceNo = index + 1;
      const instanceCode = `N${String(instanceNo).padStart(2, "0")}`;
      const agendaDate = dateValue(instanceInput.agendaDate);
      const [instance] = await tx<{ id: string }[]>`
        insert into marketing.creative_instances(campaign_id,agenda_day_id,creative_id,instance_no,instance_code,content_received_date,content_notes,primary_received_date,primary_notes,is_complete)
        values(${campaign.id}::uuid,${agendaDate ? dayMap.get(agendaDate) || null : null},${creative.id}::uuid,${instanceNo},${instanceCode},${dateValue(instanceInput.contentReceivedDate)||null},${clean(instanceInput.contentNotes)||null},${dateValue(instanceInput.primaryReceivedDate)||null},${clean(instanceInput.primaryNotes)||null},true)
        returning id::text
      `;
      if (!instance) throw new Error("تعذر إنشاء نسخة الكرييتيف");

      const contentUsers = recordArray(instanceInput.contentUsers);
      if (!contentUsers.length) throw new Error(`اختر كاتب محتوى للكرييتيف ${instanceCode}`);
      const contentUserIds: string[] = [];
      for (const contentUser of contentUsers) {
        const userId = asId(contentUser.userId); if (!userId) continue;
        contentUserIds.push(userId);
        await tx`insert into marketing.instance_content_users(creative_instance_id,user_id,due_date,notes) values(${instance.id}::uuid,${userId}::uuid,${dateValue(contentUser.dueDate)||null},${clean(contentUser.notes)||null})`;
      }
      if (!contentUserIds.length) throw new Error(`اختر كاتب محتوى صالحًا للكرييتيف ${instanceCode}`);

      const sections = recordArray(instanceInput.sections);
      const primarySections = sections.filter((section) => clean(section.kind) === "primary");
      if (!primarySections.length) sections.unshift({ departmentId: creative.primary_department_id, kind: "primary", receivedDate: instanceInput.primaryReceivedDate, notes: instanceInput.primaryNotes, users: [] });
      const sectionTaskLinks: Array<{ departmentId: string; userId: string; writerId: string; dueDate: string }> = [];
      for (const [sectionIndex, section] of sections.entries()) {
        const departmentId = asId(section.departmentId);
        if (!departmentId) continue;
        const kind = clean(section.kind) === "optional" ? "optional" : "primary";
        const [savedSection] = await tx<{ id: string }[]>`insert into marketing.instance_sections(creative_instance_id,department_id,section_kind,received_date,notes,sort_order) values(${instance.id}::uuid,${departmentId}::uuid,${kind},${dateValue(section.receivedDate)||null},${clean(section.notes)||null},${sectionIndex}) returning id::text`;
        if (!savedSection) continue;
        for (const sectionUser of recordArray(section.users)) {
          const userId = asId(sectionUser.userId); if (!userId) continue;
          const [savedUser] = await tx<{ id: string }[]>`insert into marketing.section_users(instance_section_id,user_id,due_date) values(${savedSection.id}::uuid,${userId}::uuid,${dateValue(sectionUser.dueDate)||null}) returning id::text`;
          if (!savedUser) continue;
          const writers = recordArray(sectionUser.writers);
          for (const writer of writers) {
            const writerId = asId(writer.userId); if (!writerId || !contentUserIds.includes(writerId)) continue;
            const dueDate = dateValue(writer.dueDate) || dateValue(sectionUser.dueDate);
            await tx`insert into marketing.section_user_writers(section_user_id,content_user_id,due_date) values(${savedUser.id}::uuid,${writerId}::uuid,${dueDate||null})`;
            sectionTaskLinks.push({ departmentId, userId, writerId, dueDate });
          }
        }
      }
      if (!sectionTaskLinks.length) throw new Error(`اربط اليوزرات التنفيذيين بكتاب المحتوى للكرييتيف ${instanceCode}`);

      for (const vehicleId of stringArray(instanceInput.vehicleIds).map(asId).filter(Boolean)) {
        await tx`insert into marketing.instance_vehicles(creative_instance_id,vehicle_id) values(${instance.id}::uuid,${vehicleId}::uuid) on conflict do nothing`;
      }
      for (const platformSelection of recordArray(instanceInput.platformSelections)) {
        const platformId = asId(platformSelection.platformId); if (!platformId) continue;
        await tx`insert into marketing.instance_platforms(creative_instance_id,platform_id) values(${instance.id}::uuid,${platformId}::uuid) on conflict do nothing`;
        for (const publishTypeId of stringArray(platformSelection.publishTypeIds).map(asId).filter(Boolean)) {
          await tx`insert into marketing.instance_publish_types(creative_instance_id,publish_type_id) values(${instance.id}::uuid,${publishTypeId}::uuid) on conflict do nothing`;
        }
      }

      const templateTaskIds = new Map<string, string>();
      for (const writerId of contentUserIds) {
        const content = contentUsers.find((item) => asId(item.userId) === writerId);
        const taskNo = await nextTaskNo(instanceCode, creative.short_code, "template");
        const [task] = await tx<{ id: string }[]>`
          insert into marketing.tasks(campaign_id,creative_instance_id,task_no,task_kind,department_id,assigned_to,content_writer_id,status,due_date)
          values(${campaign.id}::uuid,${instance.id}::uuid,${taskNo},'template',${contentDepartment[0].id}::uuid,${writerId}::uuid,${writerId}::uuid,'waiting_receipt',${dateValue(content?.dueDate)||dateValue(instanceInput.contentReceivedDate)||null}) returning id::text
        `;
        if (!task) throw new Error("تعذر إنشاء Task Template");
        templateTaskIds.set(writerId, task.id);
        await tx`insert into marketing.task_actions(task_id,assignment_action_id) select ${task.id}::uuid,id from marketing.assignment_actions where department_id=${contentDepartment[0].id}::uuid and is_active`;
      }
      for (const link of sectionTaskLinks) {
        const templateTaskId = templateTaskIds.get(link.writerId);
        if (!templateTaskId) throw new Error("تعذر ربط التاسك التنفيذية بالـTask Template الصحيحة");
        const taskNo = await nextTaskNo(instanceCode, creative.short_code, "execution");
        const [task] = await tx<{ id: string }[]>`
          insert into marketing.tasks(campaign_id,creative_instance_id,template_task_id,task_no,task_kind,department_id,assigned_to,content_writer_id,status,due_date)
          values(${campaign.id}::uuid,${instance.id}::uuid,${templateTaskId}::uuid,${taskNo},'execution',${link.departmentId}::uuid,${link.userId}::uuid,${link.writerId}::uuid,'waiting_template',${link.dueDate||null}) returning id::text
        `;
        if (!task) throw new Error("تعذر إنشاء التاسك التنفيذية");
        await tx`insert into marketing.task_actions(task_id,assignment_action_id) select ${task.id}::uuid,id from marketing.assignment_actions where department_id=${link.departmentId}::uuid and is_active`;
      }
      instanceMap.set(clientKey, { id: instance.id, instanceCode, shortCode: creative.short_code, contentUsers: contentUserIds });
    }

    for (const [index, budget] of recordArray(body.budgets).entries()) {
      const instance = instanceMap.get(clean(budget.clientInstanceKey)); if (!instance) continue;
      const [item] = await tx<{ id: string }[]>`insert into marketing.budget_items(campaign_id,creative_instance_id,funnel,ads_count,content_goal,expected_goal,sort_order) values(${campaign.id}::uuid,${instance.id}::uuid,${clean(budget.funnel)||"General"},${Math.max(1,numberValue(budget.adsCount,1))},${clean(budget.contentGoal)||null},${clean(budget.expectedGoal)||null},${index}) returning id::text`;
      if (!item) continue;
      for (const platform of recordArray(budget.platformAmounts)) {
        const platformId = asId(platform.platformId); if (!platformId) continue;
        await tx`insert into marketing.budget_item_platforms(budget_item_id,platform_id,amount) values(${item.id}::uuid,${platformId}::uuid,${Math.max(0,numberValue(platform.amount))})`;
      }
    }

    for (const [index, scheduleInput] of recordArray(body.schedule).entries()) {
      const instance = instanceMap.get(clean(scheduleInput.clientInstanceKey)); if (!instance) continue;
      const publishDate = dateValue(scheduleInput.publishDate); if (!publishDate || publishDate < publishStart || publishDate > publishEnd) throw new Error("يوجد تاريخ في جدول النشر خارج فترة الحملة");
      const [scheduleItem] = await tx<{ id: string }[]>`insert into marketing.schedule_items(campaign_id,creative_instance_id,publish_date,sort_order) values(${campaign.id}::uuid,${instance.id}::uuid,${publishDate},${index}) returning id::text`;
      if (!scheduleItem) continue;
      for (const selection of recordArray(scheduleInput.selections)) {
        const platformId = asId(selection.platformId); if (!platformId) continue;
        for (const publishTypeId of stringArray(selection.publishTypeIds).map(asId).filter(Boolean)) {
          await tx`insert into marketing.schedule_item_platforms(schedule_item_id,platform_id,publish_type_id) values(${scheduleItem.id}::uuid,${platformId}::uuid,${publishTypeId}::uuid) on conflict do nothing`;
        }
      }
    }

    await tx`insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data) values(${user.id}::uuid,'marketing',${sourceKind==='agenda'?'agenda_created':'campaign_created'},${sourceKind},${campaign.id},${tx.json(toJsonValue({ campaignCode, name, instances: instancesInput.length }))})`;
    return { ok: true, id: campaign.id, campaignCode, message: sourceKind === "agenda" ? "تم إنشاء الأجندة والتاسكات بنجاح" : "تم إنشاء الحملة والتاسكات بنجاح" };
  });
}

async function receiveTask(sql: Sql, body: JsonRecord, user: MarketingUser) {
  const taskId = asId(body.taskId); if (!taskId) throw new Error("التاسك غير موجودة");
  return sql.begin(async (tx) => {
    const [task] = await tx<{ id: string; task_kind: string; assigned_to: string; status: string; template_task_id: string | null; received_at: string | null }[]>`select id::text,task_kind,assigned_to::text,status,template_task_id::text,received_at::text from marketing.tasks where id=${taskId}::uuid for update`;
    if (!task) throw new Error("التاسك غير موجودة");
    if (!user.isAdmin && task.assigned_to !== user.id) throw new Error("هذه التاسك غير مسندة إليك");
    if (task.received_at) return { ok: true, message: "تم تسجيل الاستلام من قبل" };
    if (task.task_kind === "execution" && task.template_task_id) {
      const [template] = await tx<{ status: string }[]>`select status from marketing.tasks where id=${task.template_task_id}::uuid`;
      if (!template || !["approved","completed"].includes(template.status)) throw new Error("لا يمكن استلام التاسك قبل اعتماد Task Template المرتبطة");
    }
    const nextStatus = task.task_kind === "template" ? "active" : "active";
    await tx`update marketing.tasks set received_at=now(),status=${nextStatus},updated_at=now() where id=${taskId}::uuid`;
    return { ok: true, message: "تم تسجيل تاريخ ووقت الاستلام الفعلي" };
  });
}

async function prepareUpload(sql: Sql, body: JsonRecord, user: MarketingUser) {
  if (!mediaStorageConfigured()) throw new Error("تخزين الملفات R2 غير مضبوط في متغيرات النشر");
  const ownerType = clean(body.ownerType);
  const ownerId = asId(body.ownerId);
  const fileName = clean(body.fileName);
  const mimeType = clean(body.mimeType) || "application/octet-stream";
  const fileSize = numberValue(body.fileSize);
  if (!ownerType || !ownerId || !fileName) throw new Error("بيانات الملف غير مكتملة");
  if (fileSize > MAX_FILE_SIZE) throw new Error("حجم الملف أكبر من 100MB");
  if (ownerType === "task") {
    const [task] = await sql<{ assigned_to: string }[]>`select assigned_to::text from marketing.tasks where id=${ownerId}::uuid`;
    if (!task || (!user.isAdmin && task.assigned_to !== user.id)) throw new Error("لا توجد صلاحية لرفع ملف على هذه التاسك");
  } else if (ownerType === "campaign") {
    if (!user.isAdmin && !user.permissions.includes("marketing.campaigns.manage")) throw new Error("لا توجد صلاحية لرفع ملفات الحملة");
  } else {
    throw new Error("نوع مالك الملف غير مدعوم");
  }
  const key = storageKey(ownerType, ownerId, fileName);
  const [file] = await sql<{ id: string }[]>`insert into marketing.files(owner_type,owner_id,storage_key,original_name,mime_type,file_size,status,uploaded_by,metadata) values(${ownerType},${ownerId}::uuid,${key},${fileName},${mimeType},${fileSize||null},'uploading',${user.id}::uuid,${sql.json(toJsonValue(isRecord(body.metadata) ? body.metadata : {}))}) returning id::text`;
  if (!file) throw new Error("تعذر تجهيز رفع الملف");
  return { ok: true, fileId: file.id, uploadUrl: createUploadUrl(key, 900), expiresIn: 900 };
}

async function finishUpload(sql: Sql, body: JsonRecord, user: MarketingUser) {
  const fileId = asId(body.fileId); if (!fileId) throw new Error("الملف غير موجود");
  const [file] = await sql<{ id: string; uploaded_by: string }[]>`select id::text,uploaded_by::text from marketing.files where id=${fileId}::uuid`;
  if (!file || (!user.isAdmin && file.uploaded_by !== user.id)) throw new Error("الملف غير موجود أو غير مسموح");
  await sql`update marketing.files set status='ready',updated_at=now() where id=${fileId}::uuid`;
  return { ok: true, message: "تم رفع الملف" };
}

async function fileUrl(sql: Sql, fileId: string, user: MarketingUser) {
  if (!mediaStorageConfigured()) throw new Error("تخزين الملفات R2 غير مضبوط");
  const [file] = await sql<{ id: string; storage_key: string; original_name: string; owner_type: string; owner_id: string | null }[]>`select id::text,storage_key,original_name,owner_type,owner_id::text from marketing.files where id=${fileId}::uuid and status='ready'`;
  if (!file) throw new Error("الملف غير موجود");
  if (!user.isAdmin && file.owner_type === "task" && file.owner_id) {
    const [task] = await sql<{ assigned_to: string; content_writer_id: string }[]>`select assigned_to::text,content_writer_id::text from marketing.tasks where id=${file.owner_id}::uuid`;
    if (!task || (task.assigned_to !== user.id && task.content_writer_id !== user.id)) throw new Error("لا توجد صلاحية لفتح الملف");
  }
  return { ok: true, url: createDownloadUrl(file.storage_key, 300), fileName: file.original_name };
}

async function submitTemplate(sql: Sql, body: JsonRecord, user: MarketingUser) {
  const taskId = asId(body.taskId); const fileId = asId(body.fileId);
  if (!taskId || !fileId) throw new Error("بيانات Task Template غير مكتملة");
  return sql.begin(async (tx) => {
    const [task] = await tx<{ assigned_to: string; task_kind: string; status: string }[]>`select assigned_to::text,task_kind,status from marketing.tasks where id=${taskId}::uuid for update`;
    if (!task || task.task_kind !== "template") throw new Error("Task Template غير موجودة");
    if (!user.isAdmin && task.assigned_to !== user.id) throw new Error("هذه Task Template غير مسندة إليك");
    if (!["active","revision_requested","waiting_receipt"].includes(task.status)) throw new Error("حالة Task Template لا تسمح بالرفع");
    const [file] = await tx<{ id: string; status: string }[]>`select id::text,status from marketing.files where id=${fileId}::uuid and owner_id=${taskId}::uuid`;
    if (!file || file.status !== "ready") throw new Error("أكمل رفع الملف أولًا");
    const [revision] = await tx<{ revision: number }[]>`select coalesce(max(revision_no),0)::int+1 as revision from marketing.template_submissions where task_id=${taskId}::uuid`;
    const parsedData = isRecord(body.parsedData) ? body.parsedData : {};
    const [submission] = await tx<{ id: string }[]>`insert into marketing.template_submissions(task_id,revision_no,file_id,parsed_data,status,submitted_by) values(${taskId}::uuid,${revision?.revision||1},${fileId}::uuid,${tx.json(toJsonValue(parsedData))},'submitted',${user.id}::uuid) returning id::text`;
    await tx`update marketing.tasks set status='template_review',progress=50,received_at=coalesce(received_at,now()),updated_at=now() where id=${taskId}::uuid`;
    await tx`update marketing.task_actions ta set completed=true,completed_at=now(),completed_by=${user.id}::uuid,updated_at=now() from marketing.assignment_actions a where ta.assignment_action_id=a.id and ta.task_id=${taskId}::uuid and a.code='template_upload'`;
    return { ok: true, submissionId: submission?.id, message: "تم رفع Task Template وإرسالها للمراجعة" };
  });
}

async function reviewTemplate(sql: Sql, body: JsonRecord, user: MarketingUser) {
  const taskId = asId(body.taskId); const action = clean(body.reviewAction); const notes = clean(body.notes);
  if (!taskId || !["approve","request_revision","reject"].includes(action)) throw new Error("إجراء المراجعة غير صحيح");
  return sql.begin(async (tx) => {
    const [task] = await tx<{ id: string; task_kind: string; status: string }[]>`select id::text,task_kind,status from marketing.tasks where id=${taskId}::uuid for update`;
    if (!task || task.task_kind !== "template") throw new Error("Task Template غير موجودة");
    const [submission] = await tx<{ id: string }[]>`select id::text from marketing.template_submissions where task_id=${taskId}::uuid and status='submitted' order by revision_no desc limit 1 for update`;
    if (!submission) throw new Error("لا توجد نسخة معلقة للمراجعة");
    if (action === "approve") {
      await tx`update marketing.template_submissions set status='approved',reviewed_by=${user.id}::uuid,reviewed_at=now(),review_notes=${notes||null} where id=${submission.id}::uuid`;
      await tx`update marketing.tasks set status='approved',progress=100,completed_at=now(),admin_notes=${notes||null},updated_at=now() where id=${taskId}::uuid`;
      await tx`update marketing.task_actions ta set completed=true,completed_at=now(),completed_by=${user.id}::uuid,updated_at=now() from marketing.assignment_actions a where ta.assignment_action_id=a.id and ta.task_id=${taskId}::uuid and a.code='template_approval'`;
      await tx`update marketing.tasks set status='ready_to_receive',updated_at=now() where template_task_id=${taskId}::uuid and status='waiting_template'`;
    } else if (action === "request_revision") {
      await tx`update marketing.template_submissions set status='revision_requested',reviewed_by=${user.id}::uuid,reviewed_at=now(),review_notes=${notes||null} where id=${submission.id}::uuid`;
      await tx`update marketing.tasks set status='revision_requested',progress=50,admin_notes=${notes||null},updated_at=now() where id=${taskId}::uuid`;
    } else {
      await tx`update marketing.template_submissions set status='rejected',reviewed_by=${user.id}::uuid,reviewed_at=now(),review_notes=${notes||null} where id=${submission.id}::uuid`;
      await tx`update marketing.tasks set status='rejected',admin_notes=${notes||null},updated_at=now() where id=${taskId}::uuid`;
    }
    await tx`insert into marketing.task_reviews(task_id,submission_id,action,notes,actor_id) values(${taskId}::uuid,${submission.id}::uuid,${action},${notes||null},${user.id}::uuid)`;
    return { ok: true, message: action === "approve" ? "تم اعتماد Task Template وفتح التاسكات المرتبطة بها فقط" : action === "request_revision" ? "تم إرسال طلب التعديل لنفس التاسك" : "تم رفض Task Template" };
  });
}

async function updateTaskAction(sql: Sql, body: JsonRecord, user: MarketingUser) {
  const taskId = asId(body.taskId); const actionId = asId(body.actionId); const completed = booleanValue(body.completed);
  if (!taskId || !actionId) throw new Error("إجراء التكليف غير موجود");
  return sql.begin(async (tx) => {
    const [task] = await tx<{ assigned_to: string; task_kind: string; received_at: string | null; final_file_id: string | null }[]>`select assigned_to::text,task_kind,received_at::text,final_file_id::text from marketing.tasks where id=${taskId}::uuid for update`;
    if (!task || task.task_kind !== "execution") throw new Error("التاسك التنفيذية غير موجودة");
    if (!user.isAdmin && task.assigned_to !== user.id) throw new Error("هذه التاسك غير مسندة إليك");
    if (!task.received_at) throw new Error("اضغط تم الاستلام أولًا");
    const [action] = await tx<{ admin_only: boolean }[]>`select a.admin_only from marketing.task_actions ta join marketing.assignment_actions a on a.id=ta.assignment_action_id where ta.task_id=${taskId}::uuid and ta.assignment_action_id=${actionId}::uuid`;
    if (!action) throw new Error("إجراء التكليف غير موجود");
    if (action.admin_only && !user.isAdmin && !user.permissions.includes("marketing.templates.review")) throw new Error("هذا الإجراء متاح لمدير النظام فقط");
    await tx`update marketing.task_actions set completed=${completed},completed_at=${completed ? tx`now()` : null},completed_by=${completed ? user.id : null},notes=${clean(body.notes)||null},updated_at=now() where task_id=${taskId}::uuid and assignment_action_id=${actionId}::uuid`;
    const [progress] = await tx<{ progress: number }[]>`select coalesce(sum(a.progress_weight) filter(where ta.completed),0)::float8 as progress from marketing.task_actions ta join marketing.assignment_actions a on a.id=ta.assignment_action_id where ta.task_id=${taskId}::uuid and a.is_active`;
    const value = Math.min(100, Number(progress?.progress || 0));
    const nextStatus = value >= 100 ? (task.final_file_id ? "completed" : "ready_file") : "active";
    await tx`update marketing.tasks set progress=${value},status=${nextStatus},completed_at=case when ${nextStatus}='completed' then now() else null end,updated_at=now() where id=${taskId}::uuid`;
    return { ok: true, progress: value, status: nextStatus, message: "تم تحديث إجراء التكليف" };
  });
}

async function attachFinalFile(sql: Sql, body: JsonRecord, user: MarketingUser) {
  const taskId = asId(body.taskId); const fileId = asId(body.fileId);
  if (!taskId || !fileId) throw new Error("بيانات الملف النهائي غير مكتملة");
  return sql.begin(async (tx) => {
    const [task] = await tx<{ assigned_to: string; progress: number }[]>`select assigned_to::text,progress::float8 from marketing.tasks where id=${taskId}::uuid and task_kind='execution' for update`;
    if (!task || (!user.isAdmin && task.assigned_to !== user.id)) throw new Error("التاسك غير موجودة أو غير مسموح بها");
    const [file] = await tx<{ status: string }[]>`select status from marketing.files where id=${fileId}::uuid and owner_id=${taskId}::uuid`;
    if (!file || file.status !== "ready") throw new Error("أكمل رفع الملف أولًا");
    const completed = Number(task.progress) >= 100;
    await tx`update marketing.tasks set final_file_id=${fileId}::uuid,status=${completed?'completed':'active'},completed_at=${completed ? tx`now()` : null},updated_at=now() where id=${taskId}::uuid`;
    return { ok: true, message: "تم ربط الملف النهائي بالتاسك الصحيحة" };
  });
}

async function campaignAction(sql: Sql, body: JsonRecord, user: MarketingUser) {
  const campaignId = asId(body.campaignId); const action = clean(body.campaignAction);
  if (!campaignId) throw new Error("الحملة أو الأجندة غير موجودة");
  if (action === "archive") await sql`update marketing.campaigns set archived_at=now(),archived_by=${user.id}::uuid,updated_at=now() where id=${campaignId}::uuid and is_deleted=false`;
  else if (action === "restore") await sql`update marketing.campaigns set archived_at=null,archived_by=null,updated_at=now() where id=${campaignId}::uuid and is_deleted=false`;
  else if (action === "delete") await sql`update marketing.campaigns set is_deleted=true,deleted_at=now(),deleted_by=${user.id}::uuid,updated_at=now() where id=${campaignId}::uuid`;
  else if (action === "move_publish") {
    const progress = (await loadCampaignProgress(sql, [campaignId])).get(campaignId);
    if (Number(progress?.progress || 0) < 100) throw new Error("لا يمكن نقل الحملة إلى قسم النشر قبل اكتمالها 100%");
    await sql`update marketing.campaigns set status='publish',moved_to_publish_at=now(),updated_at=now() where id=${campaignId}::uuid and is_deleted=false`;
  } else throw new Error("إجراء الحملة غير مدعوم");
  return { ok: true, message: action === "move_publish" ? "تم نقل الحملة فعليًا إلى قسم النشر" : "تم تنفيذ الإجراء" };
}

async function savePackage(sql: Sql, body: JsonRecord, user: MarketingUser) {
  const id = asId(body.id); const name = clean(body.name); const categoryId = asId(body.categoryId);
  if (!name || !categoryId) throw new Error("اسم وتصنيف الباقة مطلوبان");
  const lines = stringArray(body.carCareLines);
  const [row] = id
    ? await sql<{ id: string }[]>`update marketing.packages set name=${name},category_id=${categoryId}::uuid,price=${Math.max(0,numberValue(body.price))},cash_discount=${Math.max(0,Math.min(100,numberValue(body.cashDiscount)))},registration_fee=${booleanValue(body.registrationFee)},insurance=${booleanValue(body.insurance)},issuance_fee=${booleanValue(body.issuanceFee)},car_care_lines=${lines},delivery_mode=${clean(body.deliveryMode)==='region'?'region':'home'},is_active=${body.isActive!==false},updated_at=now() where id=${id}::uuid returning id::text`
    : await sql<{ id: string }[]>`insert into marketing.packages(name,category_id,price,cash_discount,registration_fee,insurance,issuance_fee,car_care_lines,delivery_mode,is_active,created_by) values(${name},${categoryId}::uuid,${Math.max(0,numberValue(body.price))},${Math.max(0,Math.min(100,numberValue(body.cashDiscount)))},${booleanValue(body.registrationFee)},${booleanValue(body.insurance)},${booleanValue(body.issuanceFee)},${lines},${clean(body.deliveryMode)==='region'?'region':'home'},${body.isActive!==false},${user.id}::uuid) returning id::text`;
  return { ok: true, id: row?.id, message: "تم حفظ الباقة" };
}

async function createPhotoRequest(sql: Sql, body: JsonRecord, user: MarketingUser) {
  const vehicleIds = stringArray(body.vehicleIds).map(asId).filter(Boolean);
  const photographyDate = dateValue(body.photographyDate);
  if (!vehicleIds.length || !photographyDate) throw new Error("اختر سيارة واحدة على الأقل وحدد تاريخ التصوير");
  return sql.begin(async (tx) => {
    const [sequence] = await tx<{ value: number }[]>`select nextval('marketing.photo_request_no_seq')::bigint as value`;
    const requestNo = `PHOTO-${new Date().toISOString().slice(0,7).replace('-','')}-${String(sequence?.value||0).padStart(5,'0')}`;
    const [request] = await tx<{ id: string }[]>`insert into operations.photography_requests(request_no,status,requested_by,requested_by_name,requested_by_branch,photography_date,note) values(${requestNo},'request_received',${user.id}::uuid,${user.fullName},${user.branches.join('، ')||null},${photographyDate},${clean(body.note)||null}) returning id::text`;
    if (!request) throw new Error("تعذر إنشاء طلب التصوير");
    for (const vehicleId of vehicleIds) await tx`insert into operations.photography_request_vehicles(request_id,vehicle_id) values(${request.id}::uuid,${vehicleId}::uuid) on conflict do nothing`;
    return { ok: true, id: request.id, requestNo, message: "تم إنشاء طلب التصوير كسجل مشترك بين التسويق والعمليات" };
  });
}

async function updatePhotoRequest(sql: Sql, body: JsonRecord) {
  const requestId = asId(body.requestId); const status = clean(body.status); const photographyDate = dateValue(body.photographyDate);
  if (!requestId || !status) throw new Error("بيانات طلب التصوير غير مكتملة");
  const [valid] = await sql<{ exists: boolean }[]>`select exists(select 1 from marketing.request_statuses where code=${status} and is_active) as exists`;
  if (!valid?.exists) throw new Error("حالة الطلب غير معتمدة في إعدادات التسويق");
  await sql`update operations.photography_requests set status=${status},photography_date=${photographyDate||null},note=${clean(body.note)||null},completed_at=case when ${status}='completed' then now() else null end where id=${requestId}::uuid and is_deleted=false`;
  return { ok: true, message: "تم تحديث نفس سجل طلب التصوير في التسويق والعمليات" };
}

async function saveAttendance(sql: Sql, body: JsonRecord, user: MarketingUser) {
  const userId = asId(body.userId); const date = dateValue(body.date); if (!userId || !date) throw new Error("المستخدم والتاريخ مطلوبان");
  const checkIn = clean(body.checkIn); const checkOut = clean(body.checkOut);
  await sql`
    insert into marketing.attendance(user_id,attendance_date,check_in_at,check_out_at,status,notes,recorded_by)
    values(${userId}::uuid,${date},${checkIn ? `${date}T${checkIn}:00` : null},${checkOut ? `${date}T${checkOut}:00` : null},${clean(body.status)||'present'},${clean(body.notes)||null},${user.id}::uuid)
    on conflict(user_id,attendance_date) do update set check_in_at=excluded.check_in_at,check_out_at=excluded.check_out_at,status=excluded.status,notes=excluded.notes,recorded_by=excluded.recorded_by,updated_at=now()
  `;
  return { ok: true, message: "تم حفظ الحضور والانصراف" };
}

async function saveConnection(sql: Sql, body: JsonRecord, user: MarketingUser) {
  const id = asId(body.id); const platformId = asId(body.platformId); const connectionName = clean(body.connectionName);
  if (!platformId || !connectionName) throw new Error("بيانات ربط المنصة غير مكتملة");
  const credentials = isRecord(body.credentials) ? body.credentials : {};
  const [row] = id
    ? await sql<{ id: string }[]>`update marketing.platform_connections set platform_id=${platformId}::uuid,connection_name=${connectionName},account_label=${clean(body.accountLabel)||null},status=${clean(body.status)||'disconnected'},credentials=${sql.json(toJsonValue(credentials))},updated_at=now() where id=${id}::uuid returning id::text`
    : await sql<{ id: string }[]>`insert into marketing.platform_connections(platform_id,connection_name,account_label,status,credentials,created_by) values(${platformId}::uuid,${connectionName},${clean(body.accountLabel)||null},${clean(body.status)||'disconnected'},${sql.json(toJsonValue(credentials))},${user.id}::uuid) returning id::text`;
  return { ok: true, id: row?.id, message: "تم حفظ ربط المنصة" };
}

async function addCampaignLink(sql: Sql, body: JsonRecord, user: MarketingUser) {
  const campaignId = asId(body.campaignId); const platformId = asId(body.platformId); const url = clean(body.url);
  if (!campaignId || !platformId || !/^https?:\/\//i.test(url)) throw new Error("بيانات رابط الحملة غير صحيحة");
  const [row] = await sql<{ id: string }[]>`insert into marketing.campaign_links(campaign_id,platform_id,url,created_by) values(${campaignId}::uuid,${platformId}::uuid,${url},${user.id}::uuid) returning id::text`;
  return { ok: true, id: row?.id, message: "تم إضافة رابط الحملة" };
}

async function attachCampaignFile(sql: Sql, body: JsonRecord) {
  const campaignId = asId(body.campaignId); const fileId = asId(body.fileId); const fileKind = clean(body.fileKind) || "result";
  if (!campaignId || !fileId) throw new Error("بيانات ملف الحملة غير مكتملة");
  await sql`insert into marketing.campaign_files(campaign_id,file_id,file_kind) values(${campaignId}::uuid,${fileId}::uuid,${fileKind}) on conflict do nothing`;
  return { ok: true, message: "تم ربط الملف بالحملة" };
}

async function createRawFolders(sql: Sql, body: JsonRecord, user: MarketingUser) {
  const campaignId = asId(body.campaignId); if (!campaignId) throw new Error("الحملة أو الأجندة غير موجودة");
  const apiUrl = clean(process.env.MZJ_RAW_API_URL); const apiKey = clean(process.env.MZJ_RAW_API_KEY);
  if (!apiUrl) throw new Error("أضف MZJ_RAW_API_URL لتفعيل إنشاء فولدرات الخام على السيرفر");
  const detail = await campaignDetail(sql, campaignId);
  const instances = Array.isArray(detail.instances) ? detail.instances : [];
  const payload = {
    campaignCode: clean(detail.campaign.campaign_code),
    campaignName: clean(detail.campaign.name),
    publishStart: clean(detail.campaign.publish_start),
    instances: instances.map((item) => ({ instanceCode: clean(item.instance_code), creativeName: clean(item.creative_name), shortCode: clean(item.short_code) })),
  };
  const response = await fetch(apiUrl, { method: "POST", headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) }, body: JSON.stringify(payload) });
  const rawText = await response.text();
  let responseData: unknown = rawText;
  try { responseData = JSON.parse(rawText); } catch { /* keep text */ }
  await sql`insert into marketing.raw_folder_runs(campaign_id,status,response_data,created_by) values(${campaignId}::uuid,${response.ok?'success':'failed'},${sql.json(toJsonValue(isRecord(responseData) ? responseData : { raw: rawText }))},${user.id}::uuid)`;
  if (!response.ok) throw new Error("تعذر إنشاء فولدرات الخام على السيرفر");
  return { ok: true, message: "تم إنشاء فولدرات الخام والتسليم على السيرفر", result: responseData };
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  try {
    await ensureMarketingSchema();
    const user = await requireMarketingUser(request, response);
    if (!user) return;
    const sql = getSql();
    const action = queryText(request.query.action) || "dashboard";

    if (request.method === "GET") {
      if (action === "meta") return response.status(200).json(await loadMeta(sql, user));
      if (action === "dashboard") return response.status(200).json(await dashboard(sql, user));
      if (action === "campaigns") {
        if (!requireMarketingPermission(user, response, "marketing.campaigns.manage")) return;
        return response.status(200).json(await listCampaigns(sql, request));
      }
      if (action === "campaign_detail") {
        if (!requireMarketingPermission(user, response, "marketing.campaigns.manage")) return;
        return response.status(200).json(await campaignDetail(sql, asId(request.query.id)));
      }
      if (action === "task_detail") return response.status(200).json(await taskDetail(sql, asId(request.query.id), user));
      if (action === "stock") return response.status(200).json(await stock(sql, request));
      if (action === "photo_requests") return response.status(200).json(await photoRequests(sql, request, user));
      if (action === "packages") return response.status(200).json(await packages(sql, request));
      if (action === "calendar") return response.status(200).json(await calendar(sql, request, user));
      if (action === "reports") {
        if (!requireMarketingPermission(user, response, "marketing.reports.view")) return;
        return response.status(200).json(await reports(sql, request));
      }
      if (action === "attendance") return response.status(200).json(await attendance(sql, request, user));
      if (action === "connections") {
        if (!requireMarketingPermission(user, response, "marketing.settings.manage")) return;
        return response.status(200).json(await connections(sql));
      }
      if (action === "publish_prep") return response.status(200).json(await publishPrep(sql, request, user));
      if (action === "file_url") return response.status(200).json(await fileUrl(sql, asId(request.query.fileId), user));
      return response.status(404).json({ ok: false, error: "المورد المطلوب غير موجود" });
    }

    if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
    const body = parseBody(request);
    const postAction = clean(body.action);
    let result: unknown;
    if (postAction === "save_setting") {
      if (!requireMarketingPermission(user, response, "marketing.settings.manage")) return;
      result = await saveSetting(sql, body, user);
    } else if (postAction === "disable_setting") {
      if (!requireMarketingPermission(user, response, "marketing.settings.manage")) return;
      result = await disableSetting(sql, body);
    } else if (postAction === "create_campaign" || postAction === "create_agenda") {
      if (!requireMarketingPermission(user, response, "marketing.campaigns.manage")) return;
      result = await createCampaign(sql, { ...body, sourceKind: postAction === "create_agenda" ? "agenda" : "campaign" }, user);
    } else if (postAction === "receive_task") {
      result = await receiveTask(sql, body, user);
    } else if (postAction === "prepare_upload") {
      result = await prepareUpload(sql, body, user);
    } else if (postAction === "finish_upload") {
      result = await finishUpload(sql, body, user);
    } else if (postAction === "submit_template") {
      result = await submitTemplate(sql, body, user);
    } else if (postAction === "review_template") {
      if (!requireMarketingPermission(user, response, "marketing.templates.review")) return;
      result = await reviewTemplate(sql, body, user);
    } else if (postAction === "task_action") {
      result = await updateTaskAction(sql, body, user);
    } else if (postAction === "attach_final_file") {
      result = await attachFinalFile(sql, body, user);
    } else if (postAction === "campaign_action") {
      if (!requireMarketingPermission(user, response, "marketing.campaigns.manage")) return;
      result = await campaignAction(sql, body, user);
    } else if (postAction === "save_package") {
      if (!requireMarketingPermission(user, response, "marketing.packages.manage")) return;
      result = await savePackage(sql, body, user);
    } else if (postAction === "delete_package") {
      if (!requireMarketingPermission(user, response, "marketing.packages.manage")) return;
      await sql`update marketing.packages set is_active=false,updated_at=now() where id=${asId(body.id)}::uuid`;
      result = { ok: true, message: "تم تعطيل الباقة" };
    } else if (postAction === "create_photo_request") {
      result = await createPhotoRequest(sql, body, user);
    } else if (postAction === "update_photo_request") {
      if (!requireMarketingPermission(user, response, "marketing.requests.manage")) return;
      result = await updatePhotoRequest(sql, body);
    } else if (postAction === "save_attendance") {
      if (!user.isAdmin) return response.status(403).json({ ok: false, error: "الحضور والانصراف متاح لمدير النظام" });
      result = await saveAttendance(sql, body, user);
    } else if (postAction === "save_connection") {
      if (!requireMarketingPermission(user, response, "marketing.settings.manage")) return;
      result = await saveConnection(sql, body, user);
    } else if (postAction === "delete_connection") {
      if (!requireMarketingPermission(user, response, "marketing.settings.manage")) return;
      await sql`delete from marketing.platform_connections where id=${asId(body.id)}::uuid`;
      result = { ok: true, message: "تم حذف الربط" };
    } else if (postAction === "add_campaign_link") {
      if (!requireMarketingPermission(user, response, "marketing.campaigns.manage")) return;
      result = await addCampaignLink(sql, body, user);
    } else if (postAction === "attach_campaign_file") {
      if (!requireMarketingPermission(user, response, "marketing.campaigns.manage")) return;
      result = await attachCampaignFile(sql, body);
    } else if (postAction === "create_raw_folders") {
      if (!requireMarketingPermission(user, response, "marketing.campaigns.manage")) return;
      result = await createRawFolders(sql, body, user);
    } else {
      return response.status(400).json({ ok: false, error: "الإجراء غير مدعوم" });
    }
    return response.status(200).json(result);
  } catch (error) {
    console.error("Marketing API failed", error);
    const message = error instanceof Error ? error.message : "تعذر تنفيذ عملية التسويق";
    if (!response.headersSent) return response.status(400).json({ ok: false, error: message });
  }
}
