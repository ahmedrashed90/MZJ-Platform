import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getSql } from "../_db.js";
import { requireMarketingUser, requirePermission, hasMarketingPermission, isMarketingAdmin } from "./auth.js";
import { writeMarketingAudit } from "./services/audit.js";
import { allocateCampaignCode } from "./services/campaign-code.js";
import { createPairKey } from "./services/pair.js";
import { calculateTaskProgress, average } from "./services/progress.js";
import { assertTaskTransition } from "./services/task-transitions.js";
import { createDownloadUrl, createUploadUrl, mediaStorageConfigured } from "../_media-storage.js";

function text(value: unknown, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}
function nullable(value: unknown, max = 2000) {
  const result = text(value, max);
  return result || null;
}
function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function booleanValue(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}
function arrayValue<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}
function queryText(value: string | string[] | undefined) {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}
async function body(request: VercelRequest) {
  if (request.body && typeof request.body === "object") return request.body as Record<string, any>;
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  return {} as Record<string, any>;
}
function pageInfo(request: VercelRequest) {
  const page = Math.max(1, numberValue(queryText(request.query.page), 1));
  const pageSize = Math.min(100, Math.max(10, numberValue(queryText(request.query.pageSize), 25)));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
function errorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : String(error || "");
  const known: Record<string, string> = {
    CAMPAIGN_TYPE_NOT_FOUND: "نوع الحملة غير موجود أو غير فعال",
    TASK_TRANSITION_NOT_ALLOWED: "لا يمكن نقل المهمة بين هاتين الحالتين",
    TASK_REVIEW_PERMISSION_REQUIRED: "هذه الخطوة تحتاج صلاحية المراجعة أو الإجراء الإداري",
    TASK_NOT_ASSIGNED_TO_USER: "المهمة غير مسندة إلى المستخدم الحالي",
    FINAL_FILE_REQUIRED: "لا يمكن إنهاء المهمة قبل وجود الملف النهائي",
    CAMPAIGN_NOT_READY: "الحملة غير مكتملة ولا يمكن تحريرها للنشر",
    DUPLICATE_PAIR: "يوجد ربط مكرر بين الكرييتيف والمستخدم التنفيذي وكاتب المحتوى",
    CAMPAIGN_DATES_REQUIRED: "تاريخ بداية ونهاية النشر مطلوبان",
    CAMPAIGN_DATE_RANGE_INVALID: "تاريخ البداية لا يمكن أن يكون بعد تاريخ النهاية",
    CREATIVE_REQUIRED: "يجب إضافة كرييتيف واحد على الأقل",
    EXECUTION_ASSIGNMENT_REQUIRED: "يجب إضافة مستخدم تنفيذي لكل كرييتيف",
    BUDGET_REQUIRED: "يجب إضافة صف ميزانية واحد على الأقل",
    BUDGET_PLATFORM_REQUIRED: "يجب اختيار منصة واحدة على الأقل لكل صف ميزانية",
    SCHEDULE_REQUIRED: "يجب إضافة عنصر واحد على الأقل إلى جدول النشر",
    SCHEDULE_TARGET_REQUIRED: "يجب اختيار منصة ونوع نشر لكل عنصر في جدول النشر",
    USE_TEMPLATE_REVIEW: "اعتماد Task Template يتم من شاشة المراجعة فقط",
    MARKETING_MEDIA_STORAGE_NOT_CONFIGURED: "تخزين ملفات التسويق R2 غير مضبوط في متغيرات البيئة",
    FILE_TYPE_NOT_ALLOWED: "نوع الملف غير مسموح به",
    TEMPLATE_FILE_TYPE_NOT_ALLOWED: "Task Template يجب أن يكون XLSX أو XLS أو CSV",
    FILE_SIZE_NOT_ALLOWED: "حجم الملف غير مسموح به",
    FILE_MIME_NOT_ALLOWED: "نوع محتوى الملف غير مسموح به",
    INVALID_FILE_ROLE: "دور الملف غير صحيح",
    TASK_FILE_ACCESS_DENIED: "لا تملك صلاحية الوصول إلى ملف هذه المهمة",
    INVALID_TASK_STORAGE_KEY: "مسار تخزين الملف غير صالح",
    FINAL_FILE_REQUIRES_EXECUTION_TASK: "الملف النهائي يرفع على مهمة تنفيذ فقط",
    TEMPLATE_FILE_REQUIRES_CONTENT_TASK: "Task Template يرفع على مهمة المحتوى فقط",
    TASK_FILE_NOT_FOUND: "ملف المهمة غير موجود",
    TEMPLATE_VERSION_NOT_FOUND: "نسخة Task Template غير موجودة",
  };
  return known[code] || "تعذر تنفيذ العملية المطلوبة داخل نظام التسويق";
}

function canSeeAllMarketingRecords(user: any) {
  return isMarketingAdmin(user)
    || hasMarketingPermission(user, "marketing.campaigns.manage")
    || hasMarketingPermission(user, "marketing.tasks.review")
    || hasMarketingPermission(user, "marketing.tasks.admin_actions");
}

async function meta(sql: ReturnType<typeof getSql>, user: any) {
  const canAssignUsers = isMarketingAdmin(user) || hasMarketingPermission(user, "marketing.campaigns.manage");
  const userDirectoryScope = canAssignUsers ? sql`` : sql`and u.id=${user.id}::uuid`;
  const [users, departments, campaignTypes, creatives, platforms, postTypes, funnels, workflowActions, attendanceSettings] = await Promise.all([
    sql<any[]>`
      select u.id::text,u.full_name,u.email,u.can_receive_tasks,
        coalesce(array_agg(distinct d.code) filter(where d.id is not null),'{}') as department_codes,
        coalesce(array_agg(distinct d.name) filter(where d.id is not null),'{}') as departments
      from core.users u
      left join core.user_departments ud on ud.user_id=u.id
      left join core.departments d on d.id=ud.department_id
      where u.is_active=true and (u.can_receive_tasks=true or d.system_code='marketing') ${userDirectoryScope}
      group by u.id order by u.full_name
    `,
    sql<any[]>`select id::text,code,name from core.departments where is_active=true and system_code='marketing' order by name`,
    sql<any[]>`select id::text,code,name,prefix,sort_order from marketing.campaign_types where is_active=true order by sort_order,name`,
    sql<any[]>`select id::text,code,name,primary_department_code,requires_final_file,sort_order from marketing.creative_catalog where is_active=true order by sort_order,name`,
    sql<any[]>`select id::text,code,name,sort_order,capabilities from marketing.platform_catalog where is_active=true order by sort_order,name`,
    sql<any[]>`select id::text,platform_id::text,code,name,dimensions,sort_order from marketing.platform_post_types where is_active=true order by sort_order,name`,
    sql<any[]>`select id::text,code,name,sort_order from marketing.funnels where is_active=true order by sort_order,name`,
    sql<any[]>`select id::text,department_code,code,name,sort_order,weight,is_admin_only,is_required from marketing.workflow_actions where is_active=true order by department_code,sort_order`,
    sql<any[]>`select work_start::text,work_end::text,grace_minutes,heartbeat_seconds,offline_after_minutes,idle_after_minutes,timezone from marketing.attendance_settings where id=true`,
  ]);
  return {
    ok: true,
    users,
    departments,
    campaignTypes,
    creatives,
    platforms,
    postTypes,
    funnels,
    workflowActions,
    attendanceSettings: attendanceSettings[0] || null,
    access: {
      admin: isMarketingAdmin(user),
      manageCampaigns: hasMarketingPermission(user, "marketing.campaigns.manage"),
      reviewTasks: hasMarketingPermission(user, "marketing.tasks.review"),
      manageSettings: hasMarketingPermission(user, "marketing.settings.manage"),
      manageAttendance: hasMarketingPermission(user, "marketing.attendance.manage"),
    },
  };
}

async function dashboard(sql: ReturnType<typeof getSql>, user: any) {
  const canSeeAll = canSeeAllMarketingRecords(user);
  const taskScope = canSeeAll ? sql`` : sql`and (t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid)`;
  const campaignScope = canSeeAll ? sql`` : sql`and exists (select 1 from marketing.tasks scoped_task where scoped_task.campaign_id=c.id and (scoped_task.assigned_to=${user.id}::uuid or scoped_task.paired_content_user_id=${user.id}::uuid))`;
  const [campaignStats, taskStats, lateTasks, campaigns, tasks] = await Promise.all([
    sql<any[]>`
      select count(*)::int as total,
        count(*) filter(where status='ready_for_publish')::int as ready,
        count(*) filter(where status='completed')::int as completed,
        count(*) filter(where due_at<now() and status not in ('completed','archived','cancelled'))::int as delayed
      from marketing.campaigns c where c.is_deleted=false ${campaignScope}
    `,
    sql<any[]>`
      select count(*)::int as total,
        count(*) filter(where status in ('pending_template','blocked_by_template','ready'))::int as new_count,
        count(*) filter(where status in ('received','in_progress'))::int as active_count,
        count(*) filter(where status='changes_requested')::int as changes_count,
        count(*) filter(where status='under_review' or status='template_submitted')::int as review_count,
        count(*) filter(where status in ('completed','content_done','template_approved'))::int as completed_count
      from marketing.tasks t where 1=1 ${taskScope}
    `,
    sql<any[]>`
      select t.id::text,t.status,t.task_type,t.due_at,c.name as campaign_name,c.campaign_code,cr.instance_code,cr.creative_type,u.full_name as assigned_to_name
      from marketing.tasks t join marketing.campaigns c on c.id=t.campaign_id
      left join marketing.creatives cr on cr.id=t.creative_id left join core.users u on u.id=t.assigned_to
      where t.due_at<now() and t.status not in ('completed','content_done','cancelled') ${taskScope}
      order by t.due_at asc limit 12
    `,
    sql<any[]>`
      select c.id::text,c.campaign_code,c.name,c.source_type,c.status,c.starts_at,c.ends_at,c.due_at,
        count(distinct cr.id)::int as creative_count,count(distinct t.id)::int as task_count
      from marketing.campaigns c left join marketing.creatives cr on cr.campaign_id=c.id
      left join marketing.tasks t on t.campaign_id=c.id
      where c.is_deleted=false ${campaignScope} group by c.id order by c.updated_at desc limit 8
    `,
    sql<any[]>`
      select t.id::text,t.task_type,t.status,t.due_at,t.requires_final_file,t.assigned_to::text,
        c.name as campaign_name,c.campaign_code,cr.creative_type,cr.instance_code,u.full_name as assigned_to_name,
        (select count(*)::int from marketing.task_files f where f.task_id=t.id and f.is_active=true and f.file_role='final') as active_final_files,
        (select coalesce(sum(a.weight),0) from marketing.task_actions a where a.task_id=t.id and a.status='completed') as action_weight_done,
        (select coalesce(sum(a.weight),0) from marketing.task_actions a where a.task_id=t.id) as action_weight_total
      from marketing.tasks t join marketing.campaigns c on c.id=t.campaign_id
      left join marketing.creatives cr on cr.id=t.creative_id left join core.users u on u.id=t.assigned_to
      where 1=1 ${taskScope}
      order by t.updated_at desc limit 12
    `,
  ]);
  const taskRows = tasks.map((row: any) => ({ ...row, progress_percent: calculateTaskProgress(row) }));
  return { ok: true, campaignStats: campaignStats[0], taskStats: taskStats[0], lateTasks, campaigns, tasks: taskRows };
}

async function listCampaigns(sql: ReturnType<typeof getSql>, request: VercelRequest, user: any) {
  const { page, pageSize, offset } = pageInfo(request);
  const search = text(queryText(request.query.search), 200);
  const status = text(queryText(request.query.status), 80);
  const sourceType = text(queryText(request.query.sourceType), 30);
  const pattern = `%${search}%`;
  const recordScope = canSeeAllMarketingRecords(user) ? sql`` : sql`and exists (select 1 from marketing.tasks scoped_task where scoped_task.campaign_id=c.id and (scoped_task.assigned_to=${user.id}::uuid or scoped_task.paired_content_user_id=${user.id}::uuid))`;
  const filters = sql`
    c.is_deleted=false ${recordScope}
    ${search ? sql`and (c.name ilike ${pattern} or c.campaign_code ilike ${pattern})` : sql``}
    ${status ? sql`and c.status=${status}` : sql``}
    ${sourceType ? sql`and c.source_type=${sourceType}` : sql``}
  `;
  const [rows, countRows] = await Promise.all([
    sql<any[]>`
      select c.id::text,c.campaign_code,c.name,c.source_type,c.campaign_type,c.objective,c.status,c.starts_at,c.ends_at,c.due_at,c.created_at,c.updated_at,
        u.full_name as created_by_name,count(distinct cr.id)::int as creative_count,count(distinct t.id)::int as task_count,
        count(distinct t.id) filter(where t.status in ('completed','content_done','template_approved'))::int as completed_task_count
      from marketing.campaigns c left join core.users u on u.id=c.created_by
      left join marketing.creatives cr on cr.campaign_id=c.id left join marketing.tasks t on t.campaign_id=c.id
      where ${filters} group by c.id,u.id order by c.updated_at desc limit ${pageSize} offset ${offset}
    `,
    sql<{ total: number }[]>`select count(*)::int as total from marketing.campaigns c where ${filters}`,
  ]);
  return { ok: true, campaigns: rows.map((row: any) => ({ ...row, progress_percent: row.task_count ? Math.round((row.completed_task_count / row.task_count) * 100) : 0 })), total: countRows[0]?.total || 0, page, pageSize };
}

async function campaignDetail(sql: ReturnType<typeof getSql>, id: string, user: any) {
  const recordScope = canSeeAllMarketingRecords(user) ? sql`` : sql`and exists (select 1 from marketing.tasks scoped_task where scoped_task.campaign_id=c.id and (scoped_task.assigned_to=${user.id}::uuid or scoped_task.paired_content_user_id=${user.id}::uuid))`;
  const [campaign] = await sql<any[]>`select c.*,c.id::text,u.full_name as created_by_name from marketing.campaigns c left join core.users u on u.id=c.created_by where c.id=${id}::uuid and c.is_deleted=false ${recordScope}`;
  if (!campaign) return null;
  const [creatives, assignments, writerLinks, tasks, budgets, budgetPlatforms, schedule, scheduleTargets, vehicles, agenda] = await Promise.all([
    sql<any[]>`select cr.*,cr.id::text,cc.name as catalog_name from marketing.creatives cr left join marketing.creative_catalog cc on cc.id=cr.catalog_creative_id where cr.campaign_id=${id}::uuid order by cr.instance_no`,
    sql<any[]>`select a.*,a.id::text,a.creative_id::text,a.user_id::text,u.full_name as user_name from marketing.campaign_creative_execution_assignments a join core.users u on u.id=a.user_id where a.campaign_id=${id}::uuid order by a.created_at`,
    sql<any[]>`select l.*,l.id::text,l.creative_id::text,l.execution_assignment_id::text,l.content_user_id::text,u.full_name as content_user_name from marketing.assignment_writer_links l join core.users u on u.id=l.content_user_id where l.campaign_id=${id}::uuid order by l.created_at`,
    sql<any[]>`
      select t.*,t.id::text,t.creative_id::text,t.assigned_to::text,t.paired_content_user_id::text,u.full_name as assigned_to_name,
        (select count(*)::int from marketing.task_files f where f.task_id=t.id and f.is_active=true and f.file_role='final') as active_final_files,
        (select coalesce(sum(a.weight),0) from marketing.task_actions a where a.task_id=t.id and a.status='completed') as action_weight_done,
        (select coalesce(sum(a.weight),0) from marketing.task_actions a where a.task_id=t.id) as action_weight_total
      from marketing.tasks t left join core.users u on u.id=t.assigned_to
      where t.campaign_id=${id}::uuid order by t.created_at
    `,
    sql<any[]>`select b.*,b.id::text,b.creative_id::text,f.name as funnel_name from marketing.campaign_budget_items b left join marketing.funnels f on f.id=b.funnel_id where b.campaign_id=${id}::uuid order by b.sort_order`,
    sql<any[]>`select bp.*,bp.id::text,bp.budget_item_id::text,p.name as platform_name from marketing.campaign_budget_platforms bp join marketing.campaign_budget_items b on b.id=bp.budget_item_id join marketing.platform_catalog p on p.id=bp.platform_id where b.campaign_id=${id}::uuid`,
    sql<any[]>`select s.*,s.id::text,s.creative_id::text from marketing.publish_schedule_items s where s.campaign_id=${id}::uuid order by s.publish_at`,
    sql<any[]>`select st.*,st.id::text,st.schedule_item_id::text,p.name as platform_name,pt.name as post_type_name from marketing.publish_schedule_targets st join marketing.publish_schedule_items s on s.id=st.schedule_item_id join marketing.platform_catalog p on p.id=st.platform_id join marketing.platform_post_types pt on pt.id=st.post_type_id where s.campaign_id=${id}::uuid`,
    sql<any[]>`select v.*,v.id::text,v.creative_id::text,v.operations_vehicle_id::text from marketing.creative_vehicle_links v where v.campaign_id=${id}::uuid`,
    sql<any[]>`select a.*,a.id::text from marketing.agendas a where a.campaign_id=${id}::uuid`,
  ]);
  return {
    ...campaign,
    creatives,
    assignments,
    writerLinks,
    tasks: tasks.map((row: any) => ({ ...row, progress_percent: calculateTaskProgress(row) })),
    budgets: budgets.map((item: any) => ({ ...item, platforms: budgetPlatforms.filter((row: any) => row.budget_item_id === item.id) })),
    schedule: schedule.map((item: any) => ({ ...item, targets: scheduleTargets.filter((row: any) => row.schedule_item_id === item.id) })),
    vehicles,
    agenda: agenda[0] || null,
  };
}

async function createCampaign(sql: ReturnType<typeof getSql>, request: VercelRequest, user: any, payload: Record<string, any>) {
  return sql.begin(async (tx: any) => {
    const sourceType = text(payload.sourceType || "campaign", 20) === "agenda" ? "agenda" : "campaign";
    const campaignType = text(payload.campaignType || (sourceType === "agenda" ? "agenda" : "sales"), 80);
    const name = text(payload.name, 300);
    if (!name) throw new Error("CAMPAIGN_NAME_REQUIRED");
    const startsAt = nullable(payload.startsAt, 40);
    const endsAt = nullable(payload.endsAt, 40);
    if (!startsAt || !endsAt) throw new Error("CAMPAIGN_DATES_REQUIRED");
    const startsTime = new Date(startsAt).getTime();
    const endsTime = new Date(endsAt).getTime();
    if (!Number.isFinite(startsTime) || !Number.isFinite(endsTime) || startsTime > endsTime) throw new Error("CAMPAIGN_DATE_RANGE_INVALID");
    const creativeRows = arrayValue<Record<string, any>>(payload.creatives);
    const budgetRows = arrayValue<Record<string, any>>(payload.budgetItems);
    const scheduleRows = arrayValue<Record<string, any>>(payload.scheduleItems);
    if (!creativeRows.length) throw new Error("CREATIVE_REQUIRED");
    if (sourceType === "campaign" && !budgetRows.length) throw new Error("BUDGET_REQUIRED");
    if (!scheduleRows.length) throw new Error("SCHEDULE_REQUIRED");
    const campaignCode = await allocateCampaignCode(tx, campaignType, nullable(payload.requestDate, 20));
    const [campaign] = await tx<any[]>`
      insert into marketing.campaigns(campaign_code,name,campaign_type,objective,status,starts_at,ends_at,due_at,created_by,updated_by,source_type,content_brief,request_date)
      values (${campaignCode},${name},${campaignType},${nullable(payload.objective,2000)},'in_progress',${startsAt},${endsAt},${endsAt},${user.id}::uuid,${user.id}::uuid,${sourceType},${nullable(payload.contentBrief,10000)},${nullable(payload.requestDate,20)})
      returning id::text,campaign_code,name,status,source_type
    `;
    const creativeMap = new Map<string, string>();
    for (let index = 0; index < creativeRows.length; index += 1) {
      const input = creativeRows[index] || {};
      const clientKey = text(input.clientKey || `creative-${index + 1}`, 100);
      const [catalog] = input.catalogCreativeId
        ? await tx<any[]>`select id::text,code,name,primary_department_code,requires_final_file from marketing.creative_catalog where id=${text(input.catalogCreativeId,50)}::uuid`
        : await tx<any[]>`select id::text,code,name,primary_department_code,requires_final_file from marketing.creative_catalog where code=${text(input.creativeType || "post",80)} limit 1`;
      if (!catalog) throw new Error("CREATIVE_CATALOG_NOT_FOUND");
      const instanceNo = index + 1;
      const instanceCode = `${campaignCode}-${catalog.code.toUpperCase()}-${String(instanceNo).padStart(2, "0")}`;
      const [creative] = await tx<any[]>`
        insert into marketing.creatives(campaign_id,catalog_creative_id,creative_type,quantity,status,instance_no,instance_code,primary_department_code,metadata)
        values (${campaign.id}::uuid,${catalog.id}::uuid,${catalog.name},${Math.max(1,numberValue(input.quantity,1))},'in_progress',${instanceNo},${instanceCode},${text(input.primaryDepartmentCode || catalog.primary_department_code,80)},${tx.json(input.metadata || {})})
        returning id::text,instance_code
      `;
      creativeMap.set(clientKey, creative.id);
      for (const content of arrayValue(input.contentUsers)) {
        if (!text(content.userId,50)) continue;
        await tx`
          insert into marketing.campaign_creative_content_users(campaign_id,creative_id,user_id,due_at,notes)
          values (${campaign.id}::uuid,${creative.id}::uuid,${text(content.userId,50)}::uuid,${nullable(content.dueAt,40)},${nullable(content.notes,2000)})
          on conflict (creative_id,user_id) do update set due_at=excluded.due_at,notes=excluded.notes
        `;
      }
      for (const vehicle of arrayValue(input.vehicles)) {
        const operationId = nullable(vehicle.operationsVehicleId || vehicle.id, 50);
        await tx`
          insert into marketing.creative_vehicle_links(campaign_id,creative_id,operations_vehicle_id,inventory_identity,vehicle_snapshot)
          values (${campaign.id}::uuid,${creative.id}::uuid,${operationId},${nullable(vehicle.inventoryIdentity || vehicle.vin,200)},${tx.json(vehicle.snapshot || vehicle)})
          on conflict (creative_id,operations_vehicle_id) do nothing
        `;
      }
      const assignments = arrayValue<Record<string, any>>(input.executionAssignments);
      if (!assignments.length) throw new Error("EXECUTION_ASSIGNMENT_REQUIRED");
      for (const assignment of assignments) {
        const departmentCode = text(assignment.departmentCode || input.primaryDepartmentCode || catalog.primary_department_code,80);
        const executionUserId = text(assignment.userId,50);
        if (!departmentCode || !executionUserId) continue;
        const writerLinks = arrayValue(assignment.writerLinks);
        if (!writerLinks.length) throw new Error("WRITER_LINK_REQUIRED");
        const [assignmentRow] = await tx<any[]>`
          insert into marketing.campaign_creative_execution_assignments(campaign_id,creative_id,department_code,user_id,notes)
          values (${campaign.id}::uuid,${creative.id}::uuid,${departmentCode},${executionUserId}::uuid,${nullable(assignment.notes,2000)})
          on conflict (creative_id,department_code,user_id) do update set notes=excluded.notes
          returning id::text
        `;
        for (const writerLink of writerLinks) {
          const contentUserId = text(writerLink.contentUserId,50);
          if (!contentUserId) throw new Error("WRITER_LINK_REQUIRED");
          await tx`
            insert into marketing.campaign_creative_content_users(campaign_id,creative_id,user_id,due_at,notes)
            values (${campaign.id}::uuid,${creative.id}::uuid,${contentUserId}::uuid,${nullable(writerLink.dueAt,40)},${nullable(writerLink.notes,2000)})
            on conflict (creative_id,user_id) do update set due_at=excluded.due_at,notes=excluded.notes
          `;
          const pairKey = createPairKey(creative.id, departmentCode, executionUserId, contentUserId);
          const [existingPair] = await tx<any[]>`select id::text from marketing.assignment_writer_links where pair_key=${pairKey}`;
          if (existingPair) throw new Error("DUPLICATE_PAIR");
          await tx`
            insert into marketing.assignment_writer_links(campaign_id,creative_id,execution_assignment_id,content_user_id,writer_due_at,notes,pair_key)
            values (${campaign.id}::uuid,${creative.id}::uuid,${assignmentRow.id}::uuid,${contentUserId}::uuid,${nullable(writerLink.dueAt,40)},${nullable(writerLink.notes,2000)},${pairKey})
          `;
          const [contentTask] = await tx<any[]>`
            insert into marketing.tasks(campaign_id,creative_id,task_type,pair_key,department_code,assigned_to,paired_content_user_id,status,due_at,requires_final_file,updated_by)
            values (${campaign.id}::uuid,${creative.id}::uuid,'content_template',${pairKey},'content',${contentUserId}::uuid,${contentUserId}::uuid,'pending_template',${nullable(writerLink.dueAt,40)},false,${user.id}::uuid)
            returning id::text
          `;
          await tx`insert into marketing.task_templates(task_id,status) values (${contentTask.id}::uuid,'pending_template')`;
          const [executionTask] = await tx<any[]>`
            insert into marketing.tasks(campaign_id,creative_id,task_type,pair_key,department_code,assigned_to,paired_content_user_id,depends_on_task_id,status,due_at,requires_final_file,updated_by)
            values (${campaign.id}::uuid,${creative.id}::uuid,'execution',${pairKey},${departmentCode},${executionUserId}::uuid,${contentUserId}::uuid,${contentTask.id}::uuid,'blocked_by_template',${nullable(writerLink.dueAt || assignment.dueAt,40)},${booleanValue(catalog.requires_final_file)},${user.id}::uuid)
            returning id::text
          `;
          let actions = await tx<any[]>`select code,name,sort_order,weight,is_admin_only,is_required from marketing.workflow_actions where department_code=${departmentCode} and is_active=true order by sort_order`;
          if (!actions.length) {
            actions = [
              { code: "receive", name: "استلام المهمة", sort_order: 10, weight: 10, is_admin_only: false, is_required: true },
              { code: "execute", name: "تنفيذ المطلوب", sort_order: 20, weight: 70, is_admin_only: false, is_required: true },
              { code: "review", name: "المراجعة النهائية", sort_order: 30, weight: 20, is_admin_only: true, is_required: true },
            ];
          }
          for (const action of actions) {
            await tx`
              insert into marketing.task_actions(task_id,action_code,name,sort_order,weight,is_admin_only,is_required)
              values (${executionTask.id}::uuid,${action.code},${action.name},${action.sort_order},${action.weight},${action.is_admin_only},${action.is_required})
            `;
          }
        }
      }
    }
    for (let index = 0; index < budgetRows.length; index += 1) {
      const item = budgetRows[index] || {};
      const creativeId = creativeMap.get(text(item.creativeClientKey,100)) || nullable(item.creativeId,50);
      const budgetPlatforms = arrayValue<Record<string, any>>(item.platforms);
      if (!creativeId) throw new Error("CREATIVE_REQUIRED");
      if (!budgetPlatforms.length) throw new Error("BUDGET_PLATFORM_REQUIRED");
      const [budget] = await tx<any[]>`
        insert into marketing.campaign_budget_items(campaign_id,creative_id,funnel_id,ads_count,content_goal,expected_target,row_total,sort_order)
        values (${campaign.id}::uuid,${creativeId},${nullable(item.funnelId,50)},${Math.max(0,numberValue(item.adsCount,0))},${nullable(item.contentGoal,1000)},${nullable(item.expectedTarget,1000)},${Math.max(0,numberValue(item.rowTotal,0))},${index})
        returning id::text
      `;
      for (const platform of budgetPlatforms) {
        await tx`
          insert into marketing.campaign_budget_platforms(budget_item_id,platform_id,amount)
          values (${budget.id}::uuid,${text(platform.platformId,50)}::uuid,${Math.max(0,numberValue(platform.amount,0))})
        `;
      }
    }
    for (const item of scheduleRows) {
      const creativeId = creativeMap.get(text(item.creativeClientKey,100)) || text(item.creativeId,50);
      const publishAt = text(item.publishAt,50);
      const targets = arrayValue<Record<string, any>>(item.targets);
      if (!creativeId || !publishAt || !targets.length || targets.some((target) => !text(target.platformId,50) || !text(target.postTypeId,50))) throw new Error("SCHEDULE_TARGET_REQUIRED");
      const [schedule] = await tx<any[]>`
        insert into marketing.publish_schedule_items(campaign_id,creative_id,publish_at,notes,created_by)
        values (${campaign.id}::uuid,${creativeId}::uuid,${publishAt},${nullable(item.notes,1000)},${user.id}::uuid)
        returning id::text
      `;
      for (const target of targets) {
        await tx`
          insert into marketing.publish_schedule_targets(schedule_item_id,platform_id,post_type_id,dimensions)
          values (${schedule.id}::uuid,${text(target.platformId,50)}::uuid,${text(target.postTypeId,50)}::uuid,${nullable(target.dimensions,100)})
          on conflict do nothing
        `;
      }
    }
    if (sourceType === "agenda") {
      await tx`
        insert into marketing.agendas(campaign_id,month_key,name,starts_on,ends_on,created_by)
        values (${campaign.id}::uuid,${text(payload.monthKey || String(payload.startsAt || "").slice(0,7),20)},${name},${text(payload.startsAt,20)},${text(payload.endsAt,20)},${user.id}::uuid)
      `;
    }
    await writeMarketingAudit(tx, request, user, "campaign.create", sourceType, campaign.id, null, { campaignCode, name, sourceType, creativeCount: creativeRows.length });
    return campaign;
  });
}

async function listTasks(sql: ReturnType<typeof getSql>, request: VercelRequest, user: any) {
  const { page, pageSize, offset } = pageInfo(request);
  const status = text(queryText(request.query.status),80);
  const department = text(queryText(request.query.department),80);
  const campaignId = text(queryText(request.query.campaignId),50);
  const admin = isMarketingAdmin(user) || hasMarketingPermission(user,"marketing.tasks.admin_actions") || hasMarketingPermission(user,"marketing.tasks.review");
  const scope = admin ? sql`` : sql`and (t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid)`;
  const rows = await sql<any[]>`
    select t.*,t.id::text,t.campaign_id::text,t.creative_id::text,t.assigned_to::text,t.paired_content_user_id::text,t.depends_on_task_id::text,
      c.name as campaign_name,c.campaign_code,c.source_type,cr.creative_type,cr.instance_code,u.full_name as assigned_to_name,cu.full_name as content_user_name,
      (select count(*)::int from marketing.task_files f where f.task_id=t.id and f.is_active=true and f.file_role='final') as active_final_files,
      (select coalesce(sum(a.weight),0) from marketing.task_actions a where a.task_id=t.id and a.status='completed') as action_weight_done,
      (select coalesce(sum(a.weight),0) from marketing.task_actions a where a.task_id=t.id) as action_weight_total
    from marketing.tasks t join marketing.campaigns c on c.id=t.campaign_id and c.is_deleted=false
    left join marketing.creatives cr on cr.id=t.creative_id left join core.users u on u.id=t.assigned_to left join core.users cu on cu.id=t.paired_content_user_id
    where 1=1 ${scope} ${status ? sql`and t.status=${status}` : sql``} ${department ? sql`and t.department_code=${department}` : sql``} ${campaignId ? sql`and t.campaign_id=${campaignId}::uuid` : sql``}
    order by t.updated_at desc limit ${pageSize} offset ${offset}
  `;
  return { ok:true,tasks:rows.map((row: any)=>({...row,progress_percent:calculateTaskProgress(row)})),page,pageSize };
}

async function transitionTask(sql: ReturnType<typeof getSql>, request: VercelRequest, user: any, payload: Record<string,any>) {
  return sql.begin(async (tx:any)=>{
    const taskId=text(payload.taskId,50); const nextStatus=text(payload.nextStatus,80);
    const [task]=await tx<any[]>`select *,id::text,assigned_to::text from marketing.tasks where id=${taskId}::uuid for update`;
    if(!task) throw new Error("TASK_NOT_FOUND");
    if(task.task_type === "content_template" && nextStatus === "template_approved") throw new Error("USE_TEMPLATE_REVIEW");
    assertTaskTransition(user,String(task.status),nextStatus,task.assigned_to);
    if(nextStatus==="completed" && task.requires_final_file){
      const [files]=await tx<any[]>`select count(*)::int as count from marketing.task_files where task_id=${taskId}::uuid and file_role='final' and is_active=true`;
      if(!files?.count) throw new Error("FINAL_FILE_REQUIRED");
    }
    await tx`update marketing.tasks set status=${nextStatus},received_at=case when ${nextStatus}='received' then coalesce(received_at,now()) else received_at end,completed_at=case when ${nextStatus} in ('completed','content_done') then now() else completed_at end,updated_by=${user.id}::uuid,updated_at=now(),lock_version=lock_version+1 where id=${taskId}::uuid`;
    if(task.task_type==="execution" && nextStatus==="completed"){
      const [file]=await tx<any[]>`select id::text from marketing.task_files where task_id=${taskId}::uuid and file_role='final' and is_active=true order by created_at desc limit 1`;
      const [template]=task.depends_on_task_id ? await tx<any[]>`
        select tt.approved_version_id::text,v.parsed_data
        from marketing.task_templates tt
        left join marketing.task_template_versions v on v.id=tt.approved_version_id
        where tt.task_id=${task.depends_on_task_id}::uuid
      ` : [];
      const parsed=template?.parsed_data && typeof template.parsed_data==="object" ? template.parsed_data : {};
      const caption=nullable(parsed.caption || parsed.Caption || parsed.message || parsed.primary_message,20000);
      const hashtags=Array.isArray(parsed.hashtags) ? parsed.hashtags.map((value: unknown)=>text(value,200)).filter(Boolean).join(" ") : nullable(parsed.hashtags,5000);
      const [prep]=await tx<any[]>`
        insert into marketing.publish_prep_items(campaign_id,source_task_id,creative_id,final_file_id,approved_template_version_id,caption,hashtags,status,schedule_identity)
        values (${task.campaign_id}::uuid,${taskId}::uuid,${task.creative_id}::uuid,${file?.id || null},${template?.approved_version_id || null},${caption},${hashtags},'ready',${`task:${taskId}`})
        on conflict (source_task_id) do update set final_file_id=excluded.final_file_id,approved_template_version_id=excluded.approved_template_version_id,caption=excluded.caption,hashtags=excluded.hashtags,status='ready',updated_at=now()
        returning id::text
      `;
      const scheduleTargets=await tx<any[]>`
        select st.id::text,st.platform_id::text,st.post_type_id::text,s.publish_at
        from marketing.publish_schedule_targets st
        join marketing.publish_schedule_items s on s.id=st.schedule_item_id
        where s.campaign_id=${task.campaign_id}::uuid and s.creative_id=${task.creative_id}::uuid
        order by s.publish_at,st.id
      `;
      for(const target of scheduleTargets){
        const idempotencyKey=createHash("sha256").update(`${prep.id}|${target.id}|${target.publish_at}`).digest("hex");
        await tx`
          insert into marketing.publish_targets(publish_prep_item_id,platform_id,post_type_id,publish_at,status,idempotency_key,schedule_target_id)
          values (${prep.id}::uuid,${target.platform_id}::uuid,${target.post_type_id}::uuid,${target.publish_at},'ready',${idempotencyKey},${target.id}::uuid)
          on conflict (idempotency_key) do update set publish_at=excluded.publish_at,status=case when marketing.publish_targets.status in ('published','publishing') then marketing.publish_targets.status else 'ready' end,updated_at=now()
        `;
      }
    }
    await writeMarketingAudit(tx,request,user,"task.transition","marketing_task",taskId,{status:task.status},{status:nextStatus,note:nullable(payload.note,2000)});
    return {id:taskId,status:nextStatus};
  });
}

async function updateTaskAction(sql: ReturnType<typeof getSql>, request: VercelRequest, user: any, payload: Record<string,any>) {
  return sql.begin(async (tx:any)=>{
    const actionId=text(payload.actionId,50); const completed=booleanValue(payload.completed);
    const [row]=await tx<any[]>`select a.*,a.id::text,t.assigned_to::text,t.status as task_status from marketing.task_actions a join marketing.tasks t on t.id=a.task_id where a.id=${actionId}::uuid for update`;
    if(!row) throw new Error("ACTION_NOT_FOUND");
    if(row.is_admin_only && !hasMarketingPermission(user,"marketing.tasks.admin_actions")) throw new Error("TASK_REVIEW_PERMISSION_REQUIRED");
    if(!row.is_admin_only && row.assigned_to!==user.id && !hasMarketingPermission(user,"marketing.tasks.admin_actions")) throw new Error("TASK_NOT_ASSIGNED_TO_USER");
    if(completed){
      const [blocked]=await tx<any[]>`select id::text from marketing.task_actions where task_id=${row.task_id}::uuid and is_required=true and sort_order<${row.sort_order} and status<>'completed' limit 1`;
      if(blocked) throw new Error("ACTION_ORDER_REQUIRED");
    }else{
      const [later]=await tx<any[]>`select id::text from marketing.task_actions where task_id=${row.task_id}::uuid and sort_order>${row.sort_order} and status='completed' limit 1`;
      if(later && !hasMarketingPermission(user,"marketing.tasks.admin_actions")) throw new Error("ACTION_HAS_LATER_COMPLETION");
    }
    const status=completed?"completed":"pending";
    await tx`update marketing.task_actions set status=${status},completed_by=${completed?user.id:null},completed_at=${completed?new Date().toISOString():null} where id=${actionId}::uuid`;
    await tx`insert into marketing.task_action_events(task_action_id,event_type,note,actor_id) values (${actionId}::uuid,${completed?"completed":"reopened"},${nullable(payload.note,1000)},${user.id}::uuid)`;
    if(row.task_status==="received" && completed) await tx`update marketing.tasks set status='in_progress',updated_at=now() where id=${row.task_id}::uuid`;
    await writeMarketingAudit(tx,request,user,"task.action","marketing_task_action",actionId,{status:row.status},{status});
    return {id:actionId,status};
  });
}

async function submitTemplate(sql: ReturnType<typeof getSql>, request: VercelRequest, user:any, payload:Record<string,any>){
  return sql.begin(async(tx:any)=>{
    const taskId=text(payload.taskId,50);
    const [task]=await tx<any[]>`select *,id::text,assigned_to::text,paired_content_user_id::text from marketing.tasks where id=${taskId}::uuid and task_type='content_template' for update`;
    if(!task) throw new Error("TASK_NOT_FOUND");
    if(task.assigned_to!==user.id && task.paired_content_user_id!==user.id && !hasMarketingPermission(user,"marketing.tasks.admin_actions")) throw new Error("TASK_NOT_ASSIGNED_TO_USER");
    const fileKey=text(payload.fileKey,700); const fileName=text(payload.fileName,300); const mimeType=text(payload.mimeType||"application/octet-stream",150); const fileSize=Math.max(0,numberValue(payload.fileSize,0));
    taskFilePolicy("template",fileName,mimeType,fileSize);
    if(!fileKey.startsWith(`marketing/tasks/${taskId}/template/`))throw new Error("INVALID_TASK_STORAGE_KEY");
    const [template]=await tx<any[]>`select id::text from marketing.task_templates where task_id=${taskId}::uuid`;
    const [version]=await tx<any[]>`
      insert into marketing.task_template_versions(template_id,version_no,original_file_key,original_file_name,mime_type,file_size,parsed_data,submitted_by)
      select ${template.id}::uuid,coalesce(max(version_no),0)+1,${fileKey},${fileName},${mimeType},${fileSize},${tx.json(payload.parsedData||{})},${user.id}::uuid
      from marketing.task_template_versions where template_id=${template.id}::uuid returning id::text,version_no
    `;
    await tx`update marketing.task_templates set status='submitted',updated_at=now() where id=${template.id}::uuid`;
    await tx`update marketing.tasks set status='template_submitted',updated_at=now(),updated_by=${user.id}::uuid where id=${taskId}::uuid`;
    await writeMarketingAudit(tx,request,user,"task_template.submit","marketing_task",taskId,null,{version:version.version_no});
    return version;
  });
}

async function reviewTemplate(sql: ReturnType<typeof getSql>, request: VercelRequest, user:any, payload:Record<string,any>){
  if(!hasMarketingPermission(user,"marketing.tasks.review") && !isMarketingAdmin(user)) throw new Error("TASK_REVIEW_PERMISSION_REQUIRED");
  return sql.begin(async(tx:any)=>{
    const taskId=text(payload.taskId,50); const decision=text(payload.decision,40);
    if(!["approved","changes_requested","rejected"].includes(decision)) throw new Error("INVALID_REVIEW_DECISION");
    const [template]=await tx<any[]>`
      select tt.id::text,tt.task_id::text,t.status,t.campaign_id::text from marketing.task_templates tt join marketing.tasks t on t.id=tt.task_id where tt.task_id=${taskId}::uuid for update
    `;
    if(!template) throw new Error("TASK_NOT_FOUND");
    const versionId=text(payload.versionId,50) || (await tx<any[]>`select id::text from marketing.task_template_versions where template_id=${template.id}::uuid order by version_no desc limit 1`)[0]?.id;
    if(!versionId) throw new Error("TEMPLATE_VERSION_NOT_FOUND");
    await tx`insert into marketing.task_template_reviews(template_id,version_id,decision,notes,field_notes,reviewed_by) values (${template.id}::uuid,${versionId}::uuid,${decision},${nullable(payload.notes,3000)},${tx.json(payload.fieldNotes||{})},${user.id}::uuid)`;
    if(decision==="approved"){
      await tx`update marketing.task_templates set status='approved',approved_version_id=${versionId}::uuid,updated_at=now() where id=${template.id}::uuid`;
      await tx`update marketing.tasks set status='template_approved',updated_at=now(),updated_by=${user.id}::uuid where id=${taskId}::uuid`;
      await tx`update marketing.tasks set status='ready',updated_at=now(),updated_by=${user.id}::uuid where depends_on_task_id=${taskId}::uuid and status='blocked_by_template'`;
    }else{
      await tx`update marketing.task_templates set status=${decision},updated_at=now() where id=${template.id}::uuid`;
      await tx`update marketing.tasks set status=${decision},updated_at=now(),updated_by=${user.id}::uuid where id=${taskId}::uuid`;
    }
    await writeMarketingAudit(tx,request,user,"task_template.review","marketing_task",taskId,{status:template.status},{decision,versionId});
    return {taskId,decision,versionId};
  });
}

async function taskDetail(sql:ReturnType<typeof getSql>,taskId:string,user:any){
  const admin=isMarketingAdmin(user)||hasMarketingPermission(user,"marketing.tasks.admin_actions")||hasMarketingPermission(user,"marketing.tasks.review");
  const [task]=await sql<any[]>`
    select t.*,t.id::text,t.campaign_id::text,t.creative_id::text,t.assigned_to::text,t.paired_content_user_id::text,t.depends_on_task_id::text,
      c.name as campaign_name,c.campaign_code,cr.creative_type,cr.instance_code,u.full_name as assigned_to_name,cu.full_name as content_user_name
    from marketing.tasks t join marketing.campaigns c on c.id=t.campaign_id left join marketing.creatives cr on cr.id=t.creative_id left join core.users u on u.id=t.assigned_to left join core.users cu on cu.id=t.paired_content_user_id
    where t.id=${taskId}::uuid ${admin?sql``:sql`and (t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid)`}
  `;
  if(!task)return null;
  const [actions,files,template,versions,reviews]=await Promise.all([
    sql<any[]>`select *,id::text,completed_by::text from marketing.task_actions where task_id=${taskId}::uuid order by sort_order`,
    sql<any[]>`select *,id::text from marketing.task_files where task_id=${taskId}::uuid and is_active=true order by created_at desc`,
    sql<any[]>`select *,id::text,approved_version_id::text from marketing.task_templates where task_id=${taskId}::uuid`,
    sql<any[]>`select v.*,v.id::text from marketing.task_template_versions v join marketing.task_templates t on t.id=v.template_id where t.task_id=${taskId}::uuid order by v.version_no desc`,
    sql<any[]>`select r.*,r.id::text,u.full_name as reviewed_by_name from marketing.task_template_reviews r join marketing.task_templates t on t.id=r.template_id left join core.users u on u.id=r.reviewed_by where t.task_id=${taskId}::uuid order by r.reviewed_at desc`,
  ]);
  return {...task,actions,files,template:template[0]||null,versions,reviews};
}

function safeStorageFileName(value: unknown) {
  return text(value, 300).normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 180) || "file";
}

function taskFilePolicy(role: string, fileName: string, mimeType: string, fileSize: number) {
  const extension = fileName.toLowerCase().split(".").pop() || "";
  const templateExtensions = new Set(["xlsx", "xls", "csv"]);
  const blockedExtensions = new Set(["exe", "bat", "cmd", "com", "scr", "msi", "ps1", "js", "mjs", "cjs", "vbs", "jar"]);
  if (blockedExtensions.has(extension)) throw new Error("FILE_TYPE_NOT_ALLOWED");
  if (role === "template" && !templateExtensions.has(extension)) throw new Error("TEMPLATE_FILE_TYPE_NOT_ALLOWED");
  const maxSize = role === "template" ? 25 * 1024 * 1024 : 2 * 1024 * 1024 * 1024;
  if (!fileSize || fileSize < 1 || fileSize > maxSize) throw new Error("FILE_SIZE_NOT_ALLOWED");
  if (mimeType.includes("html") || mimeType.includes("javascript")) throw new Error("FILE_MIME_NOT_ALLOWED");
}

async function assertTaskFileAccess(sql: ReturnType<typeof getSql>, taskId: string, user: any) {
  const [task] = await sql<any[]>`select id::text,task_type,assigned_to::text,paired_content_user_id::text from marketing.tasks where id=${taskId}::uuid`;
  if (!task) throw new Error("TASK_NOT_FOUND");
  const permitted = task.assigned_to === user.id || task.paired_content_user_id === user.id || hasMarketingPermission(user, "marketing.tasks.admin_actions") || hasMarketingPermission(user, "marketing.tasks.review") || isMarketingAdmin(user);
  if (!permitted) throw new Error("TASK_FILE_ACCESS_DENIED");
  return task;
}

async function prepareTaskFileUpload(sql: ReturnType<typeof getSql>, user: any, payload: Record<string, any>) {
  if (!mediaStorageConfigured()) throw new Error("MARKETING_MEDIA_STORAGE_NOT_CONFIGURED");
  const taskId = text(payload.taskId, 50);
  const role = text(payload.fileRole || "final", 30);
  if (!new Set(["final", "template", "attachment"]).has(role)) throw new Error("INVALID_FILE_ROLE");
  const task = await assertTaskFileAccess(sql, taskId, user);
  if (role === "template" && task.task_type !== "content_template") throw new Error("TEMPLATE_FILE_REQUIRES_CONTENT_TASK");
  if (role === "final" && task.task_type !== "execution") throw new Error("FINAL_FILE_REQUIRES_EXECUTION_TASK");
  const originalName = text(payload.originalName, 300);
  const mimeType = text(payload.mimeType || "application/octet-stream", 150);
  const fileSize = Math.max(0, numberValue(payload.fileSize, 0));
  taskFilePolicy(role, originalName, mimeType, fileSize);
  const storageKey = `marketing/tasks/${taskId}/${role}/${randomUUID()}-${safeStorageFileName(originalName)}`;
  return { uploadUrl: createUploadUrl(storageKey, 900), storageKey, originalName, mimeType, fileSize, fileRole: role, expiresIn: 900 };
}

async function taskFileDownload(sql: ReturnType<typeof getSql>, user: any, fileId: string) {
  if (!mediaStorageConfigured()) throw new Error("MARKETING_MEDIA_STORAGE_NOT_CONFIGURED");
  const [file] = await sql<any[]>`
    select f.id::text,f.task_id::text,f.storage_key,f.original_name,f.mime_type,f.file_size
    from marketing.task_files f where f.id=${fileId}::uuid and f.is_active=true
  `;
  if (!file) throw new Error("TASK_FILE_NOT_FOUND");
  await assertTaskFileAccess(sql, file.task_id, user);
  if (!String(file.storage_key || "").startsWith(`marketing/tasks/${file.task_id}/`)) throw new Error("INVALID_TASK_STORAGE_KEY");
  return { id: file.id, originalName: file.original_name, mimeType: file.mime_type, fileSize: file.file_size, downloadUrl: createDownloadUrl(file.storage_key, 300), expiresIn: 300 };
}

async function templateVersionDownload(sql: ReturnType<typeof getSql>, user: any, versionId: string) {
  if (!mediaStorageConfigured()) throw new Error("MARKETING_MEDIA_STORAGE_NOT_CONFIGURED");
  const [version] = await sql<any[]>`
    select v.id::text,v.original_file_key,v.original_file_name,v.mime_type,v.file_size,t.task_id::text
    from marketing.task_template_versions v
    join marketing.task_templates t on t.id=v.template_id
    where v.id=${versionId}::uuid
  `;
  if (!version) throw new Error("TEMPLATE_VERSION_NOT_FOUND");
  await assertTaskFileAccess(sql, version.task_id, user);
  if (!String(version.original_file_key || "").startsWith(`marketing/tasks/${version.task_id}/template/`)) throw new Error("INVALID_TASK_STORAGE_KEY");
  return { id: version.id, originalName: version.original_file_name, mimeType: version.mime_type, fileSize: version.file_size, downloadUrl: createDownloadUrl(version.original_file_key, 300), expiresIn: 300 };
}

async function uploadFileMetadata(sql:ReturnType<typeof getSql>,request:VercelRequest,user:any,payload:Record<string,any>){
  const taskId=text(payload.taskId,50); const role=text(payload.fileRole||"final",30);
  const task=await assertTaskFileAccess(sql,taskId,user);
  const storageKey=text(payload.storageKey,700);
  const originalName=text(payload.originalName,300);
  const mimeType=text(payload.mimeType || "application/octet-stream",150);
  const fileSize=Math.max(0,numberValue(payload.fileSize,0));
  if(!new Set(["final","attachment"]).has(role))throw new Error("INVALID_FILE_ROLE");
  if(role==="final"&&task.task_type!=="execution")throw new Error("FINAL_FILE_REQUIRES_EXECUTION_TASK");
  taskFilePolicy(role,originalName,mimeType,fileSize);
  if(!storageKey.startsWith(`marketing/tasks/${taskId}/${role}/`))throw new Error("INVALID_TASK_STORAGE_KEY");
  const [file]=await sql<any[]>`
    insert into marketing.task_files(task_id,file_role,storage_key,original_name,mime_type,file_size,checksum,uploaded_by)
    values (${taskId}::uuid,${role},${storageKey},${originalName},${mimeType},${fileSize},${nullable(payload.checksum,200)},${user.id}::uuid)
    returning id::text,task_id::text,file_role,original_name,mime_type,file_size,created_at
  `;
  await writeMarketingAudit(sql,request,user,"task.file.upload","marketing_task",taskId,null,{fileId:file.id,fileRole:role,originalName:file.original_name});
  return file;
}

async function listPublishPrep(sql:ReturnType<typeof getSql>,user:any){
  const scope=canSeeAllMarketingRecords(user)?sql``:sql`and (source_task.assigned_to=${user.id}::uuid or source_task.paired_content_user_id=${user.id}::uuid)`;
  const rows=await sql<any[]>`
    select p.*,p.id::text,p.campaign_id::text,p.source_task_id::text,p.creative_id::text,c.name as campaign_name,c.campaign_code,cr.creative_type,cr.instance_code,f.original_name as final_file_name,
      coalesce(jsonb_agg(jsonb_build_object('id',t.id::text,'platform',pc.name,'postType',pt.name,'publishAt',t.publish_at,'status',t.status,'externalUrl',t.external_url)) filter(where t.id is not null),'[]'::jsonb) as targets
    from marketing.publish_prep_items p
    join marketing.tasks source_task on source_task.id=p.source_task_id
    join marketing.campaigns c on c.id=p.campaign_id
    join marketing.creatives cr on cr.id=p.creative_id
    left join marketing.task_files f on f.id=p.final_file_id
    left join marketing.publish_targets t on t.publish_prep_item_id=p.id
    left join marketing.platform_catalog pc on pc.id=t.platform_id
    left join marketing.platform_post_types pt on pt.id=t.post_type_id
    where 1=1 ${scope}
    group by p.id,c.id,cr.id,f.id order by p.updated_at desc
  `;
  return {ok:true,items:rows};
}

async function calendar(sql:ReturnType<typeof getSql>,request:VercelRequest,user:any){
  const month=text(queryText(request.query.month),7)||new Date().toISOString().slice(0,7);
  const start=`${month}-01`; const [year,monthNo]=month.split("-").map(Number); const next=`${monthNo===12?year+1:year}-${String(monthNo===12?1:monthNo+1).padStart(2,"0")}-01`;
  const allRecords=canSeeAllMarketingRecords(user);
  const scheduleScope=allRecords?sql``:sql`and exists (select 1 from marketing.tasks scoped_task where scoped_task.campaign_id=s.campaign_id and (scoped_task.assigned_to=${user.id}::uuid or scoped_task.paired_content_user_id=${user.id}::uuid))`;
  const prepScope=allRecords?sql``:sql`and (source_task.assigned_to=${user.id}::uuid or source_task.paired_content_user_id=${user.id}::uuid)`;
  const [schedule,prep]=await Promise.all([
    sql<any[]>`
      select st.id::text as schedule_target_id,s.id::text as schedule_item_id,s.publish_at,s.notes,c.id::text as campaign_id,c.name as campaign_name,c.campaign_code,cr.instance_code,cr.creative_type,
        p.name as platform_name,pt.name as post_type_name,st.dimensions
      from marketing.publish_schedule_items s
      join marketing.publish_schedule_targets st on st.schedule_item_id=s.id
      join marketing.campaigns c on c.id=s.campaign_id
      join marketing.creatives cr on cr.id=s.creative_id
      join marketing.platform_catalog p on p.id=st.platform_id
      join marketing.platform_post_types pt on pt.id=st.post_type_id
      where s.publish_at>=${start}::date and s.publish_at<${next}::date ${scheduleScope}
      order by s.publish_at,st.id
    `,
    sql<any[]>`
      select t.id::text,t.schedule_target_id::text,t.publish_at,t.status,t.external_url,p.schedule_identity,c.name as campaign_name,c.campaign_code,cr.instance_code,cr.creative_type,pc.name as platform_name,pt.name as post_type_name
      from marketing.publish_targets t
      join marketing.publish_prep_items p on p.id=t.publish_prep_item_id
      join marketing.tasks source_task on source_task.id=p.source_task_id
      join marketing.campaigns c on c.id=p.campaign_id
      join marketing.creatives cr on cr.id=p.creative_id
      join marketing.platform_catalog pc on pc.id=t.platform_id
      left join marketing.platform_post_types pt on pt.id=t.post_type_id
      where t.publish_at>=${start}::date and t.publish_at<${next}::date ${prepScope}
      order by t.publish_at
    `,
  ]);
  return {ok:true,month,schedule,prep};
}

async function receiptCalendar(sql:ReturnType<typeof getSql>,request:VercelRequest,user:any){
  const month=text(queryText(request.query.month),7)||new Date().toISOString().slice(0,7);
  const start=`${month}-01`; const [year,monthNo]=month.split("-").map(Number); const next=`${monthNo===12?year+1:year}-${String(monthNo===12?1:monthNo+1).padStart(2,"0")}-01`;
  const admin=isMarketingAdmin(user)||hasMarketingPermission(user,"marketing.tasks.admin_actions");
  const tasks=await sql<any[]>`
    select t.id::text,t.due_at,t.status,t.task_type,t.department_code,c.name as campaign_name,c.campaign_code,cr.instance_code,cr.creative_type,u.full_name as assigned_to_name
    from marketing.tasks t join marketing.campaigns c on c.id=t.campaign_id left join marketing.creatives cr on cr.id=t.creative_id left join core.users u on u.id=t.assigned_to
    where t.due_at>=${start}::date and t.due_at<${next}::date ${admin?sql``:sql`and (t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid)`} order by t.due_at
  `;
  return {ok:true,month,tasks};
}

async function packages(sql:ReturnType<typeof getSql>,request:VercelRequest,user:any){
  if(request.method==="GET")return {ok:true,packages:await sql<any[]>`select *,id::text from marketing.packages where is_active=true order by updated_at desc`};
  const payload=await body(request);
  if(request.method==="POST"){
    const [row]=await sql<any[]>`insert into marketing.packages(name,category,price,cash_discount_percent,registration_included,insurance_included,issuance_included,care_features,delivery_type,created_by,updated_by) values (${text(payload.name,300)},${text(payload.category,200)},${Math.max(0,numberValue(payload.price,0))},${Math.max(0,numberValue(payload.cashDiscountPercent,0))},${booleanValue(payload.registrationIncluded)},${booleanValue(payload.insuranceIncluded)},${booleanValue(payload.issuanceIncluded)},${arrayValue(payload.careFeatures).map((v)=>text(v,300))},${nullable(payload.deliveryType,100)},${user.id}::uuid,${user.id}::uuid) returning *,id::text`;
    await writeMarketingAudit(sql,request,user,"package.create","marketing_package",row.id,null,row); return {ok:true,package:row};
  }
  const id=text(payload.id,50); const [before]=await sql<any[]>`select *,id::text from marketing.packages where id=${id}::uuid`;
  if(request.method==="PATCH"){
    const [row]=await sql<any[]>`update marketing.packages set name=${text(payload.name||before.name,300)},category=${text(payload.category||before.category,200)},price=${numberValue(payload.price,before.price)},cash_discount_percent=${numberValue(payload.cashDiscountPercent,before.cash_discount_percent)},registration_included=${payload.registrationIncluded===undefined?before.registration_included:booleanValue(payload.registrationIncluded)},insurance_included=${payload.insuranceIncluded===undefined?before.insurance_included:booleanValue(payload.insuranceIncluded)},issuance_included=${payload.issuanceIncluded===undefined?before.issuance_included:booleanValue(payload.issuanceIncluded)},care_features=${payload.careFeatures===undefined?before.care_features:arrayValue(payload.careFeatures).map((v)=>text(v,300))},delivery_type=${payload.deliveryType===undefined?before.delivery_type:nullable(payload.deliveryType,100)},updated_by=${user.id}::uuid,updated_at=now() where id=${id}::uuid returning *,id::text`;
    await writeMarketingAudit(sql,request,user,"package.update","marketing_package",id,before,row); return {ok:true,package:row};
  }
  if(request.method==="DELETE"){
    await sql`update marketing.packages set is_active=false,updated_by=${user.id}::uuid,updated_at=now() where id=${id}::uuid`; await writeMarketingAudit(sql,request,user,"package.archive","marketing_package",id,before,{is_active:false}); return {ok:true};
  }
  return null;
}

async function attendance(sql:ReturnType<typeof getSql>,request:VercelRequest,user:any){
  const payload=request.method==="GET"?{}:await body(request);
  if(request.method==="GET"){
    const admin=isMarketingAdmin(user)||hasMarketingPermission(user,"marketing.attendance.manage");
    const records=await sql<any[]>`
      select r.*,r.id::text,r.user_id::text,u.full_name,p.state as presence_state,p.last_seen_at
      from marketing.attendance_records r join core.users u on u.id=r.user_id left join marketing.presence p on p.user_id=r.user_id
      where r.work_date between coalesce(${nullable(queryText(request.query.from),20)}::date,(now() at time zone 'Asia/Riyadh')::date-interval '30 day') and coalesce(${nullable(queryText(request.query.to),20)}::date,(now() at time zone 'Asia/Riyadh')::date)
      ${admin?sql``:sql`and r.user_id=${user.id}::uuid`} order by r.work_date desc,r.checked_in_at desc limit 500
    `;
    const [today]=await sql<any[]>`select *,id::text from marketing.attendance_records where user_id=${user.id}::uuid and work_date=(now() at time zone 'Asia/Riyadh')::date`;
    const [settings]=await sql<any[]>`select work_start::text,work_end::text,grace_minutes,heartbeat_seconds,offline_after_minutes,idle_after_minutes,timezone from marketing.attendance_settings where id=true`;
    return {ok:true,records,today:today||null,settings:settings||null,admin};
  }
  const action=text(payload.action,40);
  if(action==="heartbeat"){
    await sql`insert into marketing.presence(user_id,state,last_seen_at,last_activity_at,metadata) values (${user.id}::uuid,${text(payload.state||"online",20)},now(),now(),${sql.json(payload.metadata||{})}) on conflict (user_id) do update set state=excluded.state,last_seen_at=now(),last_activity_at=case when excluded.state='online' then now() else marketing.presence.last_activity_at end,metadata=excluded.metadata`;
    return {ok:true};
  }
  if(action==="checkin"){
    const [row]=await sql<any[]>`
      insert into marketing.attendance_records(user_id,work_date,checked_in_at,late_minutes,source,device_metadata)
      select ${user.id}::uuid,(now() at time zone s.timezone)::date,now(),greatest(0,floor(extract(epoch from ((now() at time zone s.timezone)::time-(s.work_start + make_interval(mins => s.grace_minutes))))/60)::int),${nullable(payload.source,80)},${sql.json(payload.metadata||{})}
      from marketing.attendance_settings s where s.id=true
      on conflict (user_id,work_date) do update set checked_in_at=coalesce(marketing.attendance_records.checked_in_at,excluded.checked_in_at),updated_at=now()
      returning *,id::text
    `;
    await writeMarketingAudit(sql,request,user,"attendance.checkin","marketing_attendance",row.id,null,row); return {ok:true,record:row};
  }
  if(action==="checkout"){
    const [row]=await sql<any[]>`update marketing.attendance_records set checked_out_at=now(),work_minutes=greatest(0,floor(extract(epoch from (now()-checked_in_at))/60)::int),updated_at=now() where user_id=${user.id}::uuid and work_date=(now() at time zone 'Asia/Riyadh')::date returning *,id::text`;
    await writeMarketingAudit(sql,request,user,"attendance.checkout","marketing_attendance",row?.id||null,null,row); return {ok:true,record:row||null};
  }
  if(action==="settings"){
    if(!hasMarketingPermission(user,"marketing.attendance.manage")&&!isMarketingAdmin(user))throw new Error("TASK_REVIEW_PERMISSION_REQUIRED");
    const [before]=await sql<any[]>`select * from marketing.attendance_settings where id=true`;
    const [row]=await sql<any[]>`update marketing.attendance_settings set work_start=${text(payload.workStart||before.work_start,20)}::time,work_end=${text(payload.workEnd||before.work_end,20)}::time,grace_minutes=${Math.max(0,numberValue(payload.graceMinutes,before.grace_minutes))},heartbeat_seconds=${Math.max(30,numberValue(payload.heartbeatSeconds,before.heartbeat_seconds))},offline_after_minutes=${Math.max(2,numberValue(payload.offlineAfterMinutes,before.offline_after_minutes))},idle_after_minutes=${Math.max(1,numberValue(payload.idleAfterMinutes,before.idle_after_minutes))},updated_by=${user.id}::uuid,updated_at=now() where id=true returning *`;
    await writeMarketingAudit(sql,request,user,"attendance.settings","marketing_settings","attendance",before,row); return {ok:true,settings:row};
  }
  throw new Error("INVALID_ATTENDANCE_ACTION");
}

async function stock(sql:ReturnType<typeof getSql>,request:VercelRequest){
  const {page,pageSize,offset}=pageInfo(request); const search=text(queryText(request.query.search),200); const pattern=`%${search}%`;
  const rows=await sql<any[]>`
    select v.id::text,v.vin,v.car_name,v.statement,v.agent_name,v.exterior_color,v.interior_color,v.model_year,v.status_code,l.name as location_name,
      count(distinct cv.id)::int as marketing_uses,count(distinct pr.id) filter(where pr.status not in ('cancelled','completed'))::int as open_photography_requests
    from operations.vehicles v left join operations.locations l on l.id=v.location_id left join marketing.creative_vehicle_links cv on cv.operations_vehicle_id=v.id left join marketing.photography_requests pr on pr.operations_vehicle_id=v.id
    where v.is_deleted=false ${search?sql`and (v.vin ilike ${pattern} or v.car_name ilike ${pattern} or v.statement ilike ${pattern} or v.exterior_color ilike ${pattern} or v.interior_color ilike ${pattern})`:sql``}
    group by v.id,l.id order by v.updated_at desc limit ${pageSize} offset ${offset}
  `;
  return {ok:true,vehicles:rows,page,pageSize,readOnly:true};
}

async function settings(sql:ReturnType<typeof getSql>,request:VercelRequest,user:any){
  if(request.method==="GET"){
    const [rows,connections]=await Promise.all([
      sql<any[]>`select key,case when is_secret then jsonb_build_object('masked',true) else value end as value,is_secret,updated_at from marketing.settings order by key`,
      sql<any[]>`select pc.id::text as platform_id,pc.code,pc.name,pc.capabilities,c.id::text as connection_id,c.account_id,c.account_name,c.connection_status,c.environment,c.token_expires_at,c.scopes,c.capabilities as connection_capabilities,c.last_refresh_at,c.last_error,c.updated_at from marketing.platform_catalog pc left join marketing.platform_connections c on c.platform_id=pc.id where pc.is_active=true order by pc.sort_order`,
    ]);
    return {ok:true,settings:Object.fromEntries(rows.map((row: any)=>[row.key,row.value])),connections};
  }
  if(!hasMarketingPermission(user,"marketing.settings.manage")&&!isMarketingAdmin(user))throw new Error("TASK_REVIEW_PERMISSION_REQUIRED");
  const payload=await body(request);
  for(const [key,value] of Object.entries(payload.values||{})){
    const safeKey=text(key,120); const isSecret=booleanValue((payload.secrets||{})[key]);
    if(isSecret && (value===undefined || value===null || value===""))continue;
    await sql`insert into marketing.settings(key,value,is_secret,updated_by,updated_at) values (${safeKey},${sql.json(value)},${isSecret},${user.id}::uuid,now()) on conflict (key) do update set value=excluded.value,is_secret=excluded.is_secret,updated_by=excluded.updated_by,updated_at=now()`;
  }
  await writeMarketingAudit(sql,request,user,"settings.update","marketing_settings","global",null,{keys:Object.keys(payload.values||{})});
  return {ok:true};
}

async function catalogs(sql:ReturnType<typeof getSql>,request:VercelRequest,user:any){
  if(request.method==="GET")return meta(sql,user);
  if(!hasMarketingPermission(user,"marketing.catalog.manage")&&!isMarketingAdmin(user))throw new Error("TASK_REVIEW_PERMISSION_REQUIRED");
  const payload=await body(request); const catalog=text(payload.catalog,50); const action=text(payload.action||"upsert",30);
  if(catalog==="creative"){
    if(action==="archive"){await sql`update marketing.creative_catalog set is_active=false,updated_at=now(),updated_by=${user.id}::uuid where id=${text(payload.id,50)}::uuid`;return {ok:true};}
    const [row]=await sql<any[]>`insert into marketing.creative_catalog(code,name,primary_department_code,requires_final_file,sort_order,created_by,updated_by) values (${text(payload.code,80)},${text(payload.name,200)},${text(payload.primaryDepartmentCode,80)},${booleanValue(payload.requiresFinalFile)},${numberValue(payload.sortOrder,0)},${user.id}::uuid,${user.id}::uuid) on conflict (code) do update set name=excluded.name,primary_department_code=excluded.primary_department_code,requires_final_file=excluded.requires_final_file,sort_order=excluded.sort_order,is_active=true,updated_by=excluded.updated_by,updated_at=now() returning *,id::text`; return {ok:true,item:row};
  }
  if(catalog==="workflow"){
    const [row]=await sql<any[]>`insert into marketing.workflow_actions(department_code,code,name,sort_order,weight,is_admin_only,is_required) values (${text(payload.departmentCode,80)},${text(payload.code,80)},${text(payload.name,200)},${numberValue(payload.sortOrder,0)},${numberValue(payload.weight,0)},${booleanValue(payload.isAdminOnly)},${payload.isRequired===undefined?true:booleanValue(payload.isRequired)}) on conflict (department_code,code) do update set name=excluded.name,sort_order=excluded.sort_order,weight=excluded.weight,is_admin_only=excluded.is_admin_only,is_required=excluded.is_required,is_active=true returning *,id::text`; return {ok:true,item:row};
  }
  if(catalog==="postType"){
    const [row]=await sql<any[]>`insert into marketing.platform_post_types(platform_id,code,name,dimensions,sort_order) values (${text(payload.platformId,50)}::uuid,${text(payload.code,80)},${text(payload.name,150)},${nullable(payload.dimensions,100)},${numberValue(payload.sortOrder,0)}) on conflict (platform_id,code) do update set name=excluded.name,dimensions=excluded.dimensions,sort_order=excluded.sort_order,is_active=true returning *,id::text`; return {ok:true,item:row};
  }
  throw new Error("UNKNOWN_CATALOG");
}

async function checklist(sql:ReturnType<typeof getSql>,request:VercelRequest,user:any){
  if(request.method==="GET")return {ok:true,projects:await sql<any[]>`select *,id::text from marketing.checklist_projects where created_by=${user.id}::uuid or ${isMarketingAdmin(user)} order by updated_at desc limit 100`};
  const payload=await body(request); const id=nullable(payload.id,50);
  if(id){const [row]=await sql<any[]>`update marketing.checklist_projects set name=${text(payload.name,200)},vehicle_name=${nullable(payload.vehicleName,200)},platform_code=${nullable(payload.platformCode,80)},post_type_code=${nullable(payload.postTypeCode,80)},dimensions=${nullable(payload.dimensions,80)},project_data=${sql.json(payload.projectData||{})},updated_by=${user.id}::uuid,updated_at=now() where id=${id}::uuid and (created_by=${user.id}::uuid or ${isMarketingAdmin(user)}) returning *,id::text`;return {ok:true,project:row};}
  const [row]=await sql<any[]>`insert into marketing.checklist_projects(name,vehicle_name,platform_code,post_type_code,dimensions,project_data,created_by,updated_by) values (${text(payload.name||"مشروع Checklist",200)},${nullable(payload.vehicleName,200)},${nullable(payload.platformCode,80)},${nullable(payload.postTypeCode,80)},${nullable(payload.dimensions,80)},${sql.json(payload.projectData||{})},${user.id}::uuid,${user.id}::uuid) returning *,id::text`;return {ok:true,project:row};
}

async function reportData(sql:ReturnType<typeof getSql>,request:VercelRequest){
  const from=nullable(queryText(request.query.from),20); const to=nullable(queryText(request.query.to),20);
  const rows=await sql<any[]>`
    select c.id::text,c.campaign_code,c.name,c.source_type,c.campaign_type,c.objective,c.status,c.starts_at,c.ends_at,c.created_at,c.updated_at,
      count(distinct cr.id)::int as creative_count,count(distinct t.id)::int as task_count,
      count(distinct t.id) filter(where t.status in ('completed','content_done','template_approved'))::int as completed_task_count,
      count(distinct p.id)::int as publish_item_count,count(distinct pt.id) filter(where pt.status='published')::int as published_target_count
    from marketing.campaigns c left join marketing.creatives cr on cr.campaign_id=c.id left join marketing.tasks t on t.campaign_id=c.id left join marketing.publish_prep_items p on p.campaign_id=c.id left join marketing.publish_targets pt on pt.publish_prep_item_id=p.id
    where c.is_deleted=false ${from?sql`and c.updated_at>=${from}::date`:sql``} ${to?sql`and c.updated_at<(${to}::date+interval '1 day')`:sql``}
    group by c.id order by c.updated_at desc
  `;
  return {ok:true,rows:rows.map((r: any)=>({...r,progress_percent:r.task_count?Math.round((r.completed_task_count/r.task_count)*100):0}))};
}

async function archiveOrRelease(sql:ReturnType<typeof getSql>,request:VercelRequest,user:any,payload:Record<string,any>){
  return sql.begin(async (tx: any) => {
    const id=text(payload.id,50); const action=text(payload.action,30);
    const [before]=await tx<any[]>`select *,id::text from marketing.campaigns where id=${id}::uuid and is_deleted=false for update`;
    if(!before)throw new Error("CAMPAIGN_NOT_FOUND");
    if(action==="archive"){
      await tx`update marketing.campaigns set status='archived',archived_at=now(),updated_by=${user.id}::uuid,updated_at=now() where id=${id}::uuid`;
    }else if(action==="release"){
      const [pending]=await tx<any[]>`select count(*)::int as count from marketing.tasks where campaign_id=${id}::uuid and ((task_type='execution' and status<>'completed') or (task_type='content_template' and status not in ('template_approved','content_done')))`;
      if(pending.count>0)throw new Error("CAMPAIGN_NOT_READY");
      await tx`update marketing.campaigns set status='ready_for_publish',updated_by=${user.id}::uuid,updated_at=now() where id=${id}::uuid`;
    }else throw new Error("UNKNOWN_CAMPAIGN_ACTION");
    await writeMarketingAudit(tx,request,user,`campaign.${action}`,"marketing_campaign",id,before,{status:action==="archive"?"archived":"ready_for_publish"});
    return {ok:true,id,status:action==="archive"?"archived":"ready_for_publish"};
  });
}

function deviceToken(request: VercelRequest) {
  const raw = request.headers["x-mzj-marketing-device-token"];
  return text(Array.isArray(raw) ? raw[0] : raw, 300);
}

async function requirePublisherDevice(sql: ReturnType<typeof getSql>, request: VercelRequest) {
  const token = deviceToken(request);
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [device] = await sql<any[]>`
    select id::text,name,is_active,last_seen_at,metadata
    from marketing.publisher_devices
    where token_hash=${tokenHash} and is_active=true
  `;
  return device || null;
}

async function publisherRuntime(sql: ReturnType<typeof getSql>, request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  const device = await requirePublisherDevice(sql, request);
  if (!device) return response.status(401).json({ ok: false, error: "DEVICE_AUTH_FAILED" });
  const payload = await body(request);
  const action = text(queryText(request.query.action) || payload.action, 40);

  if (action === "heartbeat") {
    const metadata = payload && typeof payload === "object" ? payload : {};
    await sql`
      update marketing.publisher_devices
      set last_seen_at=now(), metadata=coalesce(metadata,'{}'::jsonb) || ${sql.json(metadata)}
      where id=${device.id}::uuid
    `;
    return response.status(200).json({ ok: true, deviceId: device.id, serverTime: new Date().toISOString() });
  }

  if (action === "import-plan") {
    const rootFolderName = text(payload.rootFolderName, 300);
    const jobs = arrayValue<Record<string, any>>(payload.jobs).slice(0, 1000);
    if (!rootFolderName || !jobs.length) return response.status(400).json({ ok: false, error: "IMPORT_PLAN_EMPTY" });
    const result = await sql.begin(async (tx: any) => {
      const [plan] = await tx<any[]>`
        insert into marketing.publisher_import_plans(device_id,root_folder_name,raw_plan,job_count)
        values (${device.id}::uuid,${rootFolderName},${tx.json({ rootFolderName, jobs })},${jobs.length})
        returning id::text,created_at
      `;
      const createdJobs: any[] = [];
      for (let index = 0; index < jobs.length; index += 1) {
        const item = jobs[index] || {};
        const sourceDay = text(item.sourceDay, 20);
        const postType = text(item.postType, 40);
        const caption = nullable(item.caption, 20000);
        const media = arrayValue<Record<string, any>>(item.media).slice(0, 100).map((file, fileIndex) => ({
          fileName: text(file.fileName, 500),
          localPath: text(file.localPath, 2000),
          order: Math.max(1, numberValue(file.order, fileIndex + 1)),
        })).filter((file) => file.fileName && file.localPath);
        if (!sourceDay || !postType || !media.length) continue;
        const idempotencyKey = createHash("sha256").update(`${device.id}|${rootFolderName}|${sourceDay}|${postType}|${JSON.stringify(media)}`).digest("hex");
        const [job] = await tx<any[]>`
          insert into marketing.publish_jobs(import_plan_id,device_id,source_day,post_type,caption,media,idempotency_key)
          values (${plan.id}::uuid,${device.id}::uuid,${sourceDay},${postType},${caption},${tx.json(media)},${idempotencyKey})
          on conflict (idempotency_key) do update set updated_at=now()
          returning id::text,status,source_day,post_type
        `;
        createdJobs.push(job);
      }
      await tx`update marketing.publisher_import_plans set job_count=${createdJobs.length},status=${createdJobs.length ? "imported" : "failed"} where id=${plan.id}::uuid`;
      await tx`update marketing.publisher_devices set last_seen_at=now() where id=${device.id}::uuid`;
      return { planId: plan.id, jobs: createdJobs };
    });
    return response.status(201).json({ ok: true, ...result });
  }

  if (action === "claim") {
    const leaseToken = randomBytes(32).toString("hex");
    const leaseHash = createHash("sha256").update(leaseToken).digest("hex");
    const [job] = await sql.begin(async (tx: any) => {
      const rows = await tx<any[]>`
        select id::text,source_day,post_type,caption,media,attempt_count
        from marketing.publish_jobs
        where device_id=${device.id}::uuid
          and (status='queued' or (status='leased' and lease_expires_at<now()))
        order by created_at
        for update skip locked
        limit 1
      `;
      if (!rows[0]) return [];
      return tx<any[]>`
        update marketing.publish_jobs
        set status='leased',lease_token_hash=${leaseHash},lease_expires_at=now()+interval '10 minutes',attempt_count=attempt_count+1,updated_at=now()
        where id=${rows[0].id}::uuid
        returning id::text,source_day,post_type,caption,media,attempt_count,lease_expires_at
      `;
    });
    return response.status(200).json({ ok: true, job: job ? { ...job, leaseToken } : null });
  }

  if (action === "result" || action === "fail") {
    const jobId = text(payload.jobId, 50);
    const leaseToken = text(payload.leaseToken, 300);
    if (!jobId || !leaseToken) return response.status(400).json({ ok: false, error: "LEASE_REQUIRED" });
    const leaseHash = createHash("sha256").update(leaseToken).digest("hex");
    const status = action === "result" ? "completed" : "failed";
    const [job] = await sql<any[]>`
      update marketing.publish_jobs
      set status=${status},result=${action === "result" ? sql.json(payload.result || {}) : null},last_error=${action === "fail" ? text(payload.error, 4000) : null},completed_at=${action === "result" ? sql`now()` : null},lease_token_hash=null,lease_expires_at=null,updated_at=now()
      where id=${jobId}::uuid and device_id=${device.id}::uuid and lease_token_hash=${leaseHash} and lease_expires_at>now()
      returning id::text,status
    `;
    if (!job) return response.status(409).json({ ok: false, error: "LEASE_INVALID_OR_EXPIRED" });
    return response.status(200).json({ ok: true, job });
  }

  return response.status(400).json({ ok: false, error: "UNKNOWN_AGENT_RUNTIME_ACTION" });
}

async function agent(sql:ReturnType<typeof getSql>,request:VercelRequest,user:any){
  if(!hasMarketingPermission(user,"marketing.publisher_agent.manage")&&!isMarketingAdmin(user))throw new Error("TASK_REVIEW_PERMISSION_REQUIRED");
  if(request.method==="GET")return {ok:true,devices:await sql<any[]>`select id::text,name,is_active,last_seen_at,metadata,created_at from marketing.publisher_devices order by created_at desc`};
  const payload=await body(request); const action=text(payload.action,30);
  if(action==="register"){
    const token=randomBytes(32).toString("hex"); const hash=createHash("sha256").update(token).digest("hex");
    const [device]=await sql<any[]>`insert into marketing.publisher_devices(name,token_hash,metadata,created_by) values (${text(payload.name,200)},${hash},${sql.json(payload.metadata||{})},${user.id}::uuid) returning id::text,name,created_at`;
    await writeMarketingAudit(sql,request,user,"publisher_device.register","marketing_publisher_device",device.id,null,{name:device.name}); return {ok:true,device,deviceToken:token};
  }
  if(action==="revoke"){await sql`update marketing.publisher_devices set is_active=false where id=${text(payload.id,50)}::uuid`;return {ok:true};}
  throw new Error("UNKNOWN_AGENT_ACTION");
}

export default async function marketingHandler(request: VercelRequest, response: VercelResponse) {
  const sql = getSql();
  const resource = text(queryText(request.query.resource) || "dashboard", 80);
  if (resource === "agent-runtime") return publisherRuntime(sql, request, response);
  const user = await requireMarketingUser(request, response);
  if (!user) return;
  try {
    if (request.method === "GET" && resource === "meta") return response.status(200).json(await meta(sql, user));
    if (request.method === "GET" && resource === "dashboard") {
      if (!requirePermission(response, user, "marketing.dashboard.view")) return;
      return response.status(200).json(await dashboard(sql, user));
    }
    if (request.method === "GET" && resource === "campaigns") {
      if (!requirePermission(response, user, "marketing.campaigns.view")) return;
      return response.status(200).json(await listCampaigns(sql, request, user));
    }
    if (request.method === "GET" && resource === "campaign") {
      if (!requirePermission(response, user, "marketing.campaigns.view")) return;
      const result = await campaignDetail(sql, text(queryText(request.query.id), 50), user);
      return result ? response.status(200).json({ ok: true, campaign: result }) : response.status(404).json({ ok: false, error: "الحملة غير موجودة" });
    }
    if (request.method === "POST" && resource === "campaigns") {
      if (!requirePermission(response, user, "marketing.campaigns.manage")) return;
      const result = await createCampaign(sql, request, user, await body(request));
      return response.status(201).json({ ok: true, campaign: result });
    }
    if (request.method === "PATCH" && resource === "campaign-action") {
      const payload = await body(request);
      const permission = text(payload.action, 30) === "release" ? "marketing.campaigns.release" : "marketing.campaigns.manage";
      if (!requirePermission(response, user, permission)) return;
      return response.status(200).json(await archiveOrRelease(sql, request, user, payload));
    }
    if (request.method === "GET" && resource === "tasks") {
      if (!requirePermission(response, user, "marketing.tasks.view")) return;
      return response.status(200).json(await listTasks(sql, request, user));
    }
    if (request.method === "GET" && resource === "task") {
      if (!requirePermission(response, user, "marketing.tasks.view")) return;
      const result=await taskDetail(sql,text(queryText(request.query.id),50),user); return result?response.status(200).json({ok:true,task:result}):response.status(404).json({ok:false,error:"المهمة غير موجودة"});
    }
    if (request.method === "PATCH" && resource === "task-transition") {
      if (!requirePermission(response, user, "marketing.tasks.work")) return;
      return response.status(200).json({ ok: true, task: await transitionTask(sql, request, user, await body(request)) });
    }
    if (request.method === "PATCH" && resource === "task-action") {
      if (!requirePermission(response, user, "marketing.tasks.work")) return;
      return response.status(200).json({ ok: true, action: await updateTaskAction(sql, request, user, await body(request)) });
    }
    if (request.method === "POST" && resource === "task-file-prepare") {
      if (!requirePermission(response, user, "marketing.tasks.work")) return;
      return response.status(200).json({ok:true,upload:await prepareTaskFileUpload(sql,user,await body(request))});
    }
    if (request.method === "GET" && resource === "task-file-download") {
      if (!requirePermission(response, user, "marketing.tasks.view")) return;
      return response.status(200).json({ok:true,file:await taskFileDownload(sql,user,text(queryText(request.query.id),50))});
    }
    if (request.method === "GET" && resource === "task-template-version-download") {
      if (!requirePermission(response, user, "marketing.tasks.view")) return;
      return response.status(200).json({ok:true,file:await templateVersionDownload(sql,user,text(queryText(request.query.id),50))});
    }
    if (request.method === "POST" && resource === "task-template-submit") {
      if (!requirePermission(response, user, "marketing.tasks.work")) return;
      return response.status(201).json({ok:true,version:await submitTemplate(sql,request,user,await body(request))});
    }
    if (request.method === "POST" && resource === "task-template-review") {
      if (!requirePermission(response, user, "marketing.tasks.review")) return;
      return response.status(200).json({ok:true,review:await reviewTemplate(sql,request,user,await body(request))});
    }
    if (request.method === "POST" && resource === "task-file") {
      if (!requirePermission(response, user, "marketing.tasks.work")) return;
      return response.status(201).json({ok:true,file:await uploadFileMetadata(sql,request,user,await body(request))});
    }
    if (request.method === "GET" && resource === "publish-prep") {
      if (!requirePermission(response, user, "marketing.publish_prep.view")) return;
      return response.status(200).json(await listPublishPrep(sql,user));
    }
    if (request.method === "GET" && resource === "calendar") {
      if (!requirePermission(response, user, "marketing.publish_prep.view")) return;
      return response.status(200).json(await calendar(sql,request,user));
    }
    if (request.method === "GET" && resource === "receipt-calendar") {
      if (!requirePermission(response, user, "marketing.tasks.view")) return;
      return response.status(200).json(await receiptCalendar(sql,request,user));
    }
    if (resource === "packages") {
      if(request.method!=="GET"&&!requirePermission(response,user,"marketing.packages.manage"))return;
      const result=await packages(sql,request,user); return response.status(request.method==="POST"?201:200).json(result);
    }
    if (resource === "attendance") {
      if (!requirePermission(response, user, "marketing.attendance.self")) return;
      return response.status(200).json(await attendance(sql,request,user));
    }
    if (request.method === "GET" && resource === "stock") {
      if(!requirePermission(response,user,"marketing.stock.view"))return; return response.status(200).json(await stock(sql,request));
    }
    if (resource === "settings") {
      if (request.method === "GET" && !requirePermission(response, user, "marketing.view")) return;
      return response.status(200).json(await settings(sql,request,user));
    }
    if (resource === "catalogs") {
      if (request.method === "GET" && !requirePermission(response, user, "marketing.view")) return;
      return response.status(200).json(await catalogs(sql,request,user));
    }
    if (resource === "checklist") {
      if (!requirePermission(response, user, "marketing.checklist.use")) return;
      return response.status(request.method==="POST"?201:200).json(await checklist(sql,request,user));
    }
    if (request.method === "GET" && resource === "reports") {
      if(!requirePermission(response,user,"marketing.reports.view"))return; return response.status(200).json(await reportData(sql,request));
    }
    if (resource === "agent") {
      if (!requirePermission(response, user, "marketing.publisher_agent.manage")) return;
      return response.status(200).json(await agent(sql,request,user));
    }
    return response.status(404).json({ ok: false, error: "مسار التسويق غير موجود", resource });
  } catch (error) {
    console.error("Marketing API error", { resource, error });
    return response.status(400).json({ ok: false, error: errorMessage(error), code: error instanceof Error ? error.message : "MARKETING_ERROR" });
  }
}
