import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { ensureMarketingSchema } from "../_marketing-schema.js";
import { hasMarketingPermission, isMarketingAdmin, requireMarketingUser } from "../_marketing-auth.js";
import type { SessionUser } from "../_auth.js";

const CAMPAIGN_STATUSES = [
  "في انتظار اعتماد الهيكل",
  "في انتظار Task Template",
  "جاهز للتنفيذ",
  "تم الاستلام",
  "تجهيز النشر",
  "مجدولة",
  "مكتملة",
  "مؤرشفة",
] as const;

const DEPARTMENT_LABELS: Record<string, string> = {
  content: "قسم المحتوى",
  design: "التصميم",
  montage: "المونتاج",
  photography: "التصوير",
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolValue(value: unknown) {
  return value === true || value === "true" || value === "1" || value === 1;
}

function listValue(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function bodyOf(request: VercelRequest) {
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  return request.body ?? {};
}

function canManageCampaigns(user: SessionUser) {
  return hasMarketingPermission(user, "marketing.campaigns.manage");
}

function canApproveStructure(user: SessionUser) {
  return hasMarketingPermission(user, "marketing.structure.approve");
}

function canApproveTemplates(user: SessionUser) {
  return hasMarketingPermission(user, "marketing.templates.approve");
}

function canApproveTasks(user: SessionUser) {
  return hasMarketingPermission(user, "marketing.tasks.approve");
}

function canManagePublishing(user: SessionUser) {
  return hasMarketingPermission(user, "marketing.publishing.manage");
}

function canManageSettings(user: SessionUser) {
  return hasMarketingPermission(user, "marketing.settings.manage");
}

function safeDate(value: unknown) {
  const text = clean(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function slugPart(value: unknown) {
  return clean(value)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 90) || "بدون-اسم";
}

function campaignScope(sql: ReturnType<typeof getSql>, user: SessionUser, alias = "c") {
  if (isMarketingAdmin(user) || canManageCampaigns(user) || canApproveTasks(user) || canApproveTemplates(user)) return sql`true`;
  return sql`(
    ${sql(alias)}.created_by = ${user.id}::uuid
    or exists(select 1 from marketing.tasks mt where mt.campaign_id=${sql(alias)}.id and mt.assigned_to=${user.id}::uuid)
  )`;
}

async function meta(sql: ReturnType<typeof getSql>, user: SessionUser) {
  const [creativeTypes, platforms, users] = await Promise.all([
    sql<any[]>`select code,name,department_codes,is_active,sort_order from marketing.creative_type_settings where is_active=true order by sort_order,name`,
    sql<any[]>`select code,name,post_types,is_active,connection_status,sort_order,metadata from marketing.platform_settings where is_active=true order by sort_order,name`,
    sql<any[]>`
      select u.id::text,u.full_name,u.email,u.can_receive_tasks,
        coalesce(array_agg(distinct r.code) filter(where r.id is not null),'{}') as role_codes,
        coalesce(array_agg(distinct d.code) filter(where d.id is not null),'{}') as department_codes,
        coalesce(array_agg(distinct d.name) filter(where d.id is not null),'{}') as departments
      from core.users u
      left join core.user_roles ur on ur.user_id=u.id
      left join core.roles r on r.id=ur.role_id
      left join core.user_departments ud on ud.user_id=u.id
      left join core.departments d on d.id=ud.department_id
      where u.is_active=true and (u.can_receive_tasks=true or d.code='marketing' or r.code in ('admin','system_admin','marketing_user'))
      group by u.id
      order by u.full_name
    `,
  ]);
  return {
    ok: true,
    creativeTypes,
    platforms,
    users,
    campaignStatuses: CAMPAIGN_STATUSES,
    departmentLabels: DEPARTMENT_LABELS,
    access: {
      isAdmin: isMarketingAdmin(user),
      canManageCampaigns: canManageCampaigns(user),
      canApproveStructure: canApproveStructure(user),
      canApproveTemplates: canApproveTemplates(user),
      canApproveTasks: canApproveTasks(user),
      canManagePublishing: canManagePublishing(user),
      canManageSettings: canManageSettings(user),
    },
  };
}

async function dashboard(sql: ReturnType<typeof getSql>, user: SessionUser) {
  const scope = campaignScope(sql, user, "c");
  const [stats] = await sql<any[]>`
    select
      count(*)::int as campaigns,
      count(*) filter(where c.status='في انتظار اعتماد الهيكل')::int as awaiting_structure,
      count(*) filter(where c.status='في انتظار Task Template')::int as awaiting_templates,
      count(*) filter(where c.status='جاهز للتنفيذ')::int as ready_execution,
      count(*) filter(where c.status in ('تجهيز النشر','مجدولة'))::int as publishing,
      count(*) filter(where c.due_at<now() and c.status not in ('مكتملة','مؤرشفة'))::int as delayed
    from marketing.campaigns c
    where c.is_deleted=false and c.archived_at is null and ${scope}
  `;
  const campaigns = await sql<any[]>`
    select c.id::text,c.campaign_code,c.name,c.campaign_type,c.objective,c.status,c.starts_at,c.ends_at,c.due_at,c.budget_total,c.raw_root_path,c.created_at,c.updated_at,
      coalesce(x.creatives,0)::int as creatives,
      coalesce(x.tasks,0)::int as tasks,
      coalesce(x.done_tasks,0)::int as done_tasks,
      case when coalesce(x.tasks,0)=0 then 0 else round(100.0*coalesce(x.done_tasks,0)/x.tasks)::int end as progress
    from marketing.campaigns c
    left join lateral (
      select count(distinct cr.id)::int as creatives,count(distinct t.id)::int as tasks,
        count(distinct t.id) filter(where t.status in ('تاسك معتمد','تم الاستلام'))::int as done_tasks
      from marketing.creatives cr left join marketing.tasks t on t.creative_id=cr.id
      where cr.campaign_id=c.id
    ) x on true
    where c.is_deleted=false and c.archived_at is null and ${scope}
    order by c.updated_at desc
    limit 8
  `;
  const canReviewAllTasks = isMarketingAdmin(user) || canApproveTasks(user) || canApproveTemplates(user);
  const tasks = await sql<any[]>`
    select t.id::text,t.title,t.task_type,t.department_code,t.status,t.due_at,c.id::text as campaign_id,c.name as campaign_name,cr.name as creative_name
    from marketing.tasks t
    join marketing.campaigns c on c.id=t.campaign_id
    left join marketing.creatives cr on cr.id=t.creative_id
    where c.is_deleted=false and (${canReviewAllTasks}=true or t.assigned_to=${user.id}::uuid)
      and t.status not in ('تاسك معتمد','تم الاستلام')
    order by t.due_at nulls last,t.updated_at desc
    limit 8
  `;
  return { ok: true, stats, campaigns, tasks };
}

async function listCampaigns(sql: ReturnType<typeof getSql>, request: VercelRequest, user: SessionUser) {
  const q = clean(request.query.q);
  const status = clean(request.query.status);
  const pattern = `%${q}%`;
  const scope = campaignScope(sql, user, "c");
  const rows = await sql<any[]>`
    select c.id::text,c.campaign_code,c.name,c.campaign_type,c.objective,c.status,c.starts_at,c.ends_at,c.due_at,c.budget_total,c.raw_root_path,c.structure_approved_at,c.publish_ready_at,c.created_at,c.updated_at,
      creator.full_name as created_by_name,
      coalesce(x.creatives,0)::int as creatives,coalesce(x.tasks,0)::int as tasks,coalesce(x.done_tasks,0)::int as done_tasks,
      case when coalesce(x.tasks,0)=0 then 0 else round(100.0*coalesce(x.done_tasks,0)/x.tasks)::int end as progress
    from marketing.campaigns c
    left join core.users creator on creator.id=c.created_by
    left join lateral (
      select count(distinct cr.id)::int as creatives,count(distinct t.id)::int as tasks,
        count(distinct t.id) filter(where t.status in ('تاسك معتمد','تم الاستلام'))::int as done_tasks
      from marketing.creatives cr left join marketing.tasks t on t.creative_id=cr.id
      where cr.campaign_id=c.id
    ) x on true
    where c.is_deleted=false and (${status}='' or c.status=${status})
      and (${q}='' or concat_ws(' ',c.campaign_code,c.name,c.campaign_type,c.objective) ilike ${pattern})
      and ${scope}
    order by c.archived_at nulls first,c.updated_at desc
  `;
  return { ok: true, rows };
}

async function campaignDetail(sql: ReturnType<typeof getSql>, request: VercelRequest, user: SessionUser) {
  const id = clean(request.query.id);
  if (!id) throw new Error("CAMPAIGN_ID_REQUIRED");
  const scope = campaignScope(sql, user, "c");
  const [campaign] = await sql<any[]>`
    select c.*,c.id::text,c.created_by::text,c.updated_by::text,c.structure_approved_by::text,
      creator.full_name as created_by_name,approver.full_name as structure_approved_by_name
    from marketing.campaigns c
    left join core.users creator on creator.id=c.created_by
    left join core.users approver on approver.id=c.structure_approved_by
    where c.id=${id}::uuid and c.is_deleted=false and ${scope}
  `;
  if (!campaign) return { ok: false, notFound: true };
  const [creatives, tasks, publishing, activity] = await Promise.all([
    sql<any[]>`select *,id::text,campaign_id::text from marketing.creatives where campaign_id=${id}::uuid order by sort_order,created_at`,
    sql<any[]>`
      select t.*,t.id::text,t.campaign_id::text,t.creative_id::text,t.assigned_to::text,t.paired_content_user_id::text,t.approved_by::text,
        assignee.full_name as assigned_to_name,writer.full_name as paired_content_user_name,approver.full_name as approved_by_name,cr.name as creative_name,cr.instance_key
      from marketing.tasks t
      left join core.users assignee on assignee.id=t.assigned_to
      left join core.users writer on writer.id=t.paired_content_user_id
      left join core.users approver on approver.id=t.approved_by
      left join marketing.creatives cr on cr.id=t.creative_id
      where t.campaign_id=${id}::uuid
      order by t.sort_order,t.created_at
    `,
    sql<any[]>`
      select p.*,p.id::text,p.campaign_id::text,p.creative_id::text,cr.name as creative_name,ps.name as platform_name
      from marketing.publishing_items p
      join marketing.creatives cr on cr.id=p.creative_id
      left join marketing.platform_settings ps on ps.code=p.platform_code
      where p.campaign_id=${id}::uuid
      order by p.scheduled_at nulls last,p.created_at
    `,
    sql<any[]>`
      select a.*,u.full_name as user_name from marketing.activity_log a left join core.users u on u.id=a.user_id
      where a.campaign_id=${id}::uuid order by a.created_at desc limit 100
    `,
  ]);
  return { ok: true, campaign, creatives, tasks, publishing, activity };
}

function normalizeDepartment(input: any) {
  return {
    code: clean(input?.code),
    assignedUserId: clean(input?.assignedUserId) || null,
    pairedContentUserId: clean(input?.pairedContentUserId) || null,
    dueAt: safeDate(input?.dueAt),
    notes: clean(input?.notes),
  };
}

function normalizeCreative(input: any, index: number) {
  const instanceKey = clean(input?.instanceKey) || `creative-${Date.now()}-${index + 1}`;
  return {
    id: clean(input?.id) || null,
    instanceKey,
    creativeType: clean(input?.creativeType),
    name: clean(input?.name) || clean(input?.creativeType),
    description: clean(input?.description),
    cars: listValue(input?.cars).map((car) => ({
      uniqueSpecKey: clean(car?.uniqueSpecKey),
      name: clean(car?.name),
      exteriorColor: clean(car?.exteriorColor),
      interiorColor: clean(car?.interiorColor),
    })).filter((car) => car.name || car.uniqueSpecKey),
    departments: listValue(input?.departments).map(normalizeDepartment).filter((department) => department.code),
    budget: Math.max(0, numberValue(input?.budget)),
    sortOrder: numberValue(input?.sortOrder, index),
    publishPlan: listValue(input?.publishPlan).map((row) => ({
      platformCode: clean(row?.platformCode),
      postType: clean(row?.postType),
      scheduledAt: safeDate(row?.scheduledAt),
      caption: clean(row?.caption),
      hashtags: clean(row?.hashtags),
    })).filter((row) => row.platformCode && row.postType),
  };
}

async function saveCampaign(sql: ReturnType<typeof getSql>, request: VercelRequest, user: SessionUser) {
  if (!canManageCampaigns(user)) return { forbidden: true };
  const body = bodyOf(request);
  const id = clean(body.id) || null;
  const name = clean(body.name);
  const campaignCode = clean(body.campaignCode) || `MKT-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${String(Date.now()).slice(-5)}`;
  const campaignType = clean(body.campaignType);
  const objective = clean(body.objective);
  const brief = clean(body.brief);
  const startsAt = safeDate(body.startsAt);
  const endsAt = safeDate(body.endsAt);
  const dueAt = safeDate(body.dueAt);
  const creatives = listValue(body.creatives).map(normalizeCreative);
  if (!name) return { validation: "اسم الحملة مطلوب" };
  if (!objective) return { validation: "هدف الحملة مطلوب" };
  if (!creatives.length) return { validation: "أضف كرييتيف واحدًا على الأقل" };
  const instanceKeys = new Set<string>();
  for (const creative of creatives) {
    if (!creative.creativeType || !creative.name) return { validation: "نوع واسم كل كرييتيف مطلوبان" };
    if (instanceKeys.has(creative.instanceKey)) return { validation: `مفتاح الكرييتيف مكرر: ${creative.instanceKey}` };
    instanceKeys.add(creative.instanceKey);
    const contentDepartment = creative.departments.find((department) => department.code === "content");
    if (!contentDepartment?.assignedUserId) return { validation: `اختر كاتب المحتوى للكرييتيف: ${creative.name}` };
    if (!contentDepartment.dueAt) return { validation: `حدد موعد تسليم المحتوى للكرييتيف: ${creative.name}` };
    const missingAssignee = creative.departments.find((department) => department.code !== "content" && !department.assignedUserId);
    if (missingAssignee) return { validation: `اختر منفذ ${DEPARTMENT_LABELS[missingAssignee.code] || missingAssignee.code} للكرييتيف: ${creative.name}` };
  }
  const budgetTotal = creatives.reduce((sum, creative) => sum + creative.budget, 0);
  const yearMonth = (startsAt || new Date().toISOString()).slice(0, 7);
  const rawRootPath = clean(body.rawRootPath) || `Z:\\${yearMonth}\\${slugPart(name)}`;

  const saved = await sql.begin(async (tx) => {
    let campaign: any;
    if (id) {
      const [current] = await tx<any[]>`select * from marketing.campaigns where id=${id}::uuid and is_deleted=false for update`;
      if (!current) return { notFound: true };
      if (current.status !== "في انتظار اعتماد الهيكل") return { locked: true };
      [campaign] = await tx<any[]>`
        update marketing.campaigns set campaign_code=${campaignCode},name=${name},campaign_type=${campaignType || null},objective=${objective},brief=${brief || null},
          starts_at=${startsAt},ends_at=${endsAt},due_at=${dueAt},budget_total=${budgetTotal},raw_root_path=${rawRootPath},metadata=${tx.json(body.metadata || {})},
          updated_by=${user.id}::uuid,updated_at=now()
        where id=${id}::uuid
        returning *,id::text
      `;
      await tx`delete from marketing.publishing_items where campaign_id=${id}::uuid`;
      await tx`delete from marketing.tasks where campaign_id=${id}::uuid`;
      await tx`delete from marketing.creatives where campaign_id=${id}::uuid`;
      await tx`insert into marketing.activity_log(campaign_id,user_id,action,before_data,after_data) values(${id}::uuid,${user.id}::uuid,'campaign_updated',${tx.json(current)},${tx.json({ name,campaignCode,creatives:creatives.length,budgetTotal })})`;
    } else {
      [campaign] = await tx<any[]>`
        insert into marketing.campaigns(campaign_code,name,campaign_type,objective,brief,status,starts_at,ends_at,due_at,budget_total,raw_root_path,metadata,created_by,updated_by)
        values(${campaignCode},${name},${campaignType || null},${objective},${brief || null},'في انتظار اعتماد الهيكل',${startsAt},${endsAt},${dueAt},${budgetTotal},${rawRootPath},${tx.json(body.metadata || {})},${user.id}::uuid,${user.id}::uuid)
        returning *,id::text
      `;
      await tx`insert into marketing.activity_log(campaign_id,user_id,action,after_data) values(${campaign.id}::uuid,${user.id}::uuid,'campaign_created',${tx.json({ name,campaignCode,creatives:creatives.length,budgetTotal })})`;
    }

    for (const creative of creatives) {
      const folderCode = creative.instanceKey.toUpperCase();
      const rawPath = `${rawRootPath}\\${folderCode}\\01-RAW`;
      const outputPath = `${rawRootPath}\\${folderCode}\\02-OUTPUT`;
      const [row] = await tx<any[]>`
        insert into marketing.creatives(campaign_id,instance_key,creative_type,name,description,quantity,status,cars,departments,budget,sort_order,raw_path,output_path,metadata)
        values(${campaign.id}::uuid,${creative.instanceKey},${creative.creativeType},${creative.name},${creative.description || null},1,'في انتظار اعتماد الهيكل',${tx.json(creative.cars)},${tx.json(creative.departments)},${creative.budget},${creative.sortOrder},${rawPath},${outputPath},'{}'::jsonb)
        returning id::text
      `;
      for (const plan of creative.publishPlan) {
        await tx`
          insert into marketing.publishing_items(campaign_id,creative_id,platform_code,post_type,scheduled_at,caption,hashtags,status,created_by,updated_by)
          values(${campaign.id}::uuid,${row.id}::uuid,${plan.platformCode},${plan.postType},${plan.scheduledAt},${plan.caption || null},${plan.hashtags || null},'مسودة',${user.id}::uuid,${user.id}::uuid)
        `;
      }
    }
    return { campaign };
  });
  return saved;
}

async function deleteCampaign(sql: ReturnType<typeof getSql>, request: VercelRequest, user: SessionUser) {
  if (!canManageCampaigns(user)) return { forbidden: true };
  const id = clean(request.query.id) || clean(bodyOf(request).id);
  if (!id) return { validation: "الحملة غير محددة" };
  const [row] = await sql<any[]>`update marketing.campaigns set is_deleted=true,updated_by=${user.id}::uuid,updated_at=now() where id=${id}::uuid and is_deleted=false returning id::text,name`;
  if (!row) return { notFound: true };
  await sql`insert into marketing.activity_log(campaign_id,user_id,action,after_data) values(${id}::uuid,${user.id}::uuid,'campaign_deleted',${sql.json(row)})`;
  return { ok: true };
}

async function campaignAction(sql: ReturnType<typeof getSql>, request: VercelRequest, user: SessionUser) {
  const body = bodyOf(request);
  const campaignId = clean(body.campaignId);
  const action = clean(body.action);
  if (!campaignId || !action) return { validation: "الإجراء أو الحملة غير محدد" };

  if (action === "approve_structure") {
    if (!canApproveStructure(user)) return { forbidden: true };
    return sql.begin(async (tx) => {
      const [campaign] = await tx<any[]>`select * from marketing.campaigns where id=${campaignId}::uuid and is_deleted=false for update`;
      if (!campaign) return { notFound: true };
      if (campaign.status !== "في انتظار اعتماد الهيكل") return { validation: "تم اعتماد الهيكل مسبقًا أو تغيّرت حالة الحملة" };
      const creatives = await tx<any[]>`select * from marketing.creatives where campaign_id=${campaignId}::uuid order by sort_order,created_at`;
      if (!creatives.length) return { validation: "لا توجد كرييتيفات لاعتمادها" };
      let sortOrder = 0;
      for (const creative of creatives) {
        const departments = listValue(creative.departments);
        const content = departments.find((department) => clean(department?.code) === "content");
        if (!content?.assignedUserId) return { validation: `كاتب المحتوى غير محدد للكرييتيف ${creative.name}` };
        await tx`
          insert into marketing.tasks(campaign_id,creative_id,task_key,task_type,title,department_code,assigned_to,status,due_at,notes,sort_order,metadata)
          values(${campaignId}::uuid,${creative.id}::uuid,${`${creative.instance_key}:content:template`},'task_template',${`كتابة محتوى ${creative.name}`},'content',${content.assignedUserId}::uuid,'في انتظار Task Template',${safeDate(content.dueAt)},${clean(content.notes) || null},${sortOrder++},${tx.json({ creativeInstanceKey: creative.instance_key })})
        `;
        for (const department of departments.filter((item) => clean(item?.code) !== "content")) {
          const departmentCode = clean(department.code);
          if (!department.assignedUserId) return { validation: `منفذ ${DEPARTMENT_LABELS[departmentCode] || departmentCode} غير محدد للكرييتيف ${creative.name}` };
          await tx`
            insert into marketing.tasks(campaign_id,creative_id,task_key,task_type,title,department_code,assigned_to,paired_content_user_id,status,due_at,notes,sort_order,metadata)
            values(${campaignId}::uuid,${creative.id}::uuid,${`${creative.instance_key}:${departmentCode}:execution`},'execution',${`${DEPARTMENT_LABELS[departmentCode] || departmentCode} - ${creative.name}`},${departmentCode},${department.assignedUserId}::uuid,${content.assignedUserId}::uuid,'في الانتظار',null,${clean(department.notes) || null},${sortOrder++},${tx.json({ creativeInstanceKey: creative.instance_key, dueLockedUntilTemplateApproval: true })})
          `;
        }
        await tx`update marketing.creatives set status='في انتظار Task Template',updated_at=now() where id=${creative.id}::uuid`;
      }
      await tx`update marketing.campaigns set status='في انتظار Task Template',structure_approved_by=${user.id}::uuid,structure_approved_at=now(),updated_by=${user.id}::uuid,updated_at=now() where id=${campaignId}::uuid`;
      await tx`insert into marketing.activity_log(campaign_id,user_id,action,after_data) values(${campaignId}::uuid,${user.id}::uuid,'structure_approved',${tx.json({ tasksCreated: sortOrder })})`;
      return { ok: true };
    });
  }

  if (action === "move_to_publishing") {
    if (!canManagePublishing(user)) return { forbidden: true };
    return sql.begin(async (tx) => {
      const [campaign] = await tx<any[]>`select id::text,structure_approved_at from marketing.campaigns where id=${campaignId}::uuid and is_deleted=false for update`;
      if (!campaign) return { notFound: true };
      if (!campaign.structure_approved_at) return { validation: "اعتمد هيكل الحملة أولًا" };
      const [summary] = await tx<any[]>`
        select count(*)::int as tasks,
          count(*) filter(where (task_type='task_template' and status<>'تاسك معتمد') or (task_type='execution' and status<>'تم الاستلام'))::int as pending,
          (select count(*)::int from marketing.publishing_items where campaign_id=${campaignId}::uuid) as publishing
        from marketing.tasks where campaign_id=${campaignId}::uuid
      `;
      if (Number(summary?.tasks || 0) === 0) return { validation: "لا توجد تاسكات معتمدة لهذه الحملة" };
      if (Number(summary?.pending || 0) > 0) return { validation: "لا يمكن نقل الحملة للنشر قبل اعتماد كل Task Template واستلام كل تكليفات التنفيذ" };
      const hasPublishing = Number(summary?.publishing || 0) > 0;
      await tx`update marketing.campaigns set status=${hasPublishing ? "تجهيز النشر" : "مكتملة"},publish_ready_at=now(),updated_by=${user.id}::uuid,updated_at=now() where id=${campaignId}::uuid`;
      if (hasPublishing) {
        await tx`update marketing.publishing_items set status=case when scheduled_at is null then 'جاهز للجدولة' else 'مجدول' end,updated_by=${user.id}::uuid,updated_at=now() where campaign_id=${campaignId}::uuid and status='مسودة'`;
      }
      await tx`insert into marketing.activity_log(campaign_id,user_id,action,after_data) values(${campaignId}::uuid,${user.id}::uuid,${hasPublishing ? "moved_to_publishing" : "campaign_completed_without_publishing"},${tx.json({ publishingItems: Number(summary?.publishing || 0) })})`;
      return { ok: true, completed: !hasPublishing };
    });
  }

  if (action === "create_folders") {
    if (!canManageCampaigns(user)) return { forbidden: true };
    const [campaign] = await sql<any[]>`update marketing.campaigns set folder_created_at=now(),updated_by=${user.id}::uuid,updated_at=now() where id=${campaignId}::uuid and is_deleted=false returning id::text`;
    if (!campaign) return { notFound: true };
    await sql`insert into marketing.activity_log(campaign_id,user_id,action) values(${campaignId}::uuid,${user.id}::uuid,'folder_paths_confirmed')`;
    return { ok: true };
  }

  if (action === "archive") {
    if (!canManageCampaigns(user)) return { forbidden: true };
    const [campaign] = await sql<any[]>`update marketing.campaigns set status='مؤرشفة',archived_at=now(),updated_by=${user.id}::uuid,updated_at=now() where id=${campaignId}::uuid and is_deleted=false returning id::text`;
    if (!campaign) return { notFound: true };
    await sql`insert into marketing.activity_log(campaign_id,user_id,action) values(${campaignId}::uuid,${user.id}::uuid,'campaign_archived')`;
    return { ok: true };
  }

  return { validation: "إجراء الحملة غير معروف" };
}

async function listTasks(sql: ReturnType<typeof getSql>, request: VercelRequest, user: SessionUser) {
  const status = clean(request.query.status);
  const type = clean(request.query.type);
  const campaignId = clean(request.query.campaignId);
  const all = boolValue(request.query.all) && (isMarketingAdmin(user) || canApproveTasks(user) || canApproveTemplates(user));
  const rows = await sql<any[]>`
    select t.*,t.id::text,t.campaign_id::text,t.creative_id::text,t.assigned_to::text,t.paired_content_user_id::text,t.approved_by::text,
      c.name as campaign_name,c.campaign_code,c.status as campaign_status,cr.name as creative_name,cr.instance_key,cr.raw_path,cr.output_path,
      assignee.full_name as assigned_to_name,writer.full_name as paired_content_user_name,approver.full_name as approved_by_name
    from marketing.tasks t
    join marketing.campaigns c on c.id=t.campaign_id and c.is_deleted=false
    left join marketing.creatives cr on cr.id=t.creative_id
    left join core.users assignee on assignee.id=t.assigned_to
    left join core.users writer on writer.id=t.paired_content_user_id
    left join core.users approver on approver.id=t.approved_by
    where (${all}=true or t.assigned_to=${user.id}::uuid)
      and (${status}='' or t.status=${status}) and (${type}='' or t.task_type=${type})
      and (${campaignId}='' or t.campaign_id=${campaignId || null}::uuid)
    order by case t.status when 'مطلوب تعديل' then 0 when 'في انتظار الاعتماد' then 1 when 'جاهز للتنفيذ' then 2 else 3 end,t.due_at nulls last,t.updated_at desc
  `;
  return { ok: true, rows };
}

async function updateTask(sql: ReturnType<typeof getSql>, request: VercelRequest, user: SessionUser) {
  const body = bodyOf(request);
  const taskId = clean(body.taskId);
  const action = clean(body.action);
  if (!taskId || !action) return { validation: "التاسك أو الإجراء غير محدد" };
  return sql.begin(async (tx) => {
    const [task] = await tx<any[]>`select * from marketing.tasks where id=${taskId}::uuid for update`;
    if (!task) return { notFound: true };
    const isAssignee = task.assigned_to === user.id;
    const admin = isMarketingAdmin(user);

    if (action === "save_template" || action === "submit_template") {
      if (task.task_type !== "task_template") return { validation: "هذا التاسك ليس Task Template" };
      if (!isAssignee && !admin) return { forbidden: true };
      if (task.status === "تاسك معتمد") return { validation: "لا يمكن تعديل Task Template بعد اعتماده" };
      if (action === "submit_template" && !["في انتظار Task Template", "مطلوب تعديل"].includes(task.status)) return { validation: "Task Template ليس في حالة تسمح بالإرسال" };
      const templateData = body.templateData && typeof body.templateData === "object" ? body.templateData : {};
      if (action === "submit_template") {
        if (!clean(templateData.proposedName) || !clean(templateData.keyMessage) || !clean(templateData.baseScript)) {
          return { validation: "الاسم المقترح والرسالة الأساسية والسكريبت الأساسي مطلوبة قبل الإرسال" };
        }
      }
      const nextStatus = action === "submit_template" ? "في انتظار الاعتماد" : task.status === "مطلوب تعديل" ? "مطلوب تعديل" : "في انتظار Task Template";
      await tx`update marketing.tasks set template_data=${tx.json(templateData)},notes=${clean(body.notes) || null},status=${nextStatus},submitted_at=${action === "submit_template" ? new Date().toISOString() : task.submitted_at},updated_at=now() where id=${taskId}::uuid`;
      await tx`insert into marketing.activity_log(campaign_id,task_id,user_id,action,after_data) values(${task.campaign_id}::uuid,${taskId}::uuid,${user.id}::uuid,${action},${tx.json(templateData)})`;
      return { ok: true };
    }

    if (action === "approve_template" || action === "reject_template") {
      if (!canApproveTemplates(user)) return { forbidden: true };
      if (task.task_type !== "task_template") return { validation: "هذا التاسك ليس Task Template" };
      if (task.status !== "في انتظار الاعتماد") return { validation: "Task Template ليس بانتظار الاعتماد" };
      if (action === "reject_template") {
        await tx`update marketing.tasks set status='مطلوب تعديل',notes=${clean(body.notes) || task.notes},approved_at=null,approved_by=null,updated_at=now() where id=${taskId}::uuid`;
        await tx`update marketing.creatives set status='مطلوب تعديل',updated_at=now() where id=${task.creative_id}::uuid`;
        await tx`insert into marketing.activity_log(campaign_id,task_id,user_id,action,after_data) values(${task.campaign_id}::uuid,${taskId}::uuid,${user.id}::uuid,'template_rejected',${tx.json({ notes: clean(body.notes) })})`;
        return { ok: true };
      }
      await tx`update marketing.tasks set status='تاسك معتمد',approved_at=now(),approved_by=${user.id}::uuid,updated_at=now() where id=${taskId}::uuid`;
      await tx`update marketing.tasks set status='جاهز للتنفيذ',updated_at=now() where creative_id=${task.creative_id}::uuid and task_type='execution' and status='في الانتظار'`;
      const [creativeExecution] = await tx<any[]>`select count(*)::int as count from marketing.tasks where creative_id=${task.creative_id}::uuid and task_type='execution'`;
      await tx`update marketing.creatives set status=${Number(creativeExecution?.count || 0) === 0 ? "تم الاستلام" : "جاهز للتنفيذ"},updated_at=now() where id=${task.creative_id}::uuid`;
      const [workflow] = await tx<any[]>`
        select
          count(*) filter(where task_type='task_template' and status<>'تاسك معتمد')::int as pending_templates,
          count(*) filter(where (task_type='task_template' and status<>'تاسك معتمد') or (task_type='execution' and status<>'تم الاستلام'))::int as pending_all
        from marketing.tasks where campaign_id=${task.campaign_id}::uuid
      `;
      if (Number(workflow?.pending_all || 0) === 0) {
        await tx`update marketing.campaigns set status='تم الاستلام',updated_by=${user.id}::uuid,updated_at=now() where id=${task.campaign_id}::uuid`;
      } else if (Number(workflow?.pending_templates || 0) === 0) {
        await tx`update marketing.campaigns set status='جاهز للتنفيذ',updated_by=${user.id}::uuid,updated_at=now() where id=${task.campaign_id}::uuid`;
      }
      await tx`insert into marketing.activity_log(campaign_id,task_id,user_id,action) values(${task.campaign_id}::uuid,${taskId}::uuid,${user.id}::uuid,'template_approved')`;
      return { ok: true };
    }

    if (action === "set_due") {
      if (!canApproveTasks(user) && !canManageCampaigns(user)) return { forbidden: true };
      if (task.task_type !== "execution" || !["جاهز للتنفيذ", "مطلوب تعديل"].includes(task.status)) return { validation: "موعد التنفيذ يُحدد بعد اعتماد المحتوى فقط" };
      const dueAt = safeDate(body.dueAt);
      if (!dueAt) return { validation: "حدد موعد تنفيذ صالح" };
      await tx`update marketing.tasks set due_at=${dueAt},notes=${clean(body.notes) || task.notes},updated_at=now() where id=${taskId}::uuid`;
      return { ok: true };
    }

    if (action === "add_action") {
      if (task.task_type !== "execution") return { validation: "إجراءات التنفيذ متاحة لتكليفات التنفيذ فقط" };
      if (!isAssignee && !admin) return { forbidden: true };
      if (["في الانتظار", "تم الاستلام"].includes(task.status)) return { validation: "حالة التاسك لا تسمح بإضافة إجراء تنفيذ" };
      const text = clean(body.actionText);
      if (!text) return { validation: "اكتب الإجراء المنفذ" };
      const next = [...listValue(task.action_data), { text, at: new Date().toISOString(), userId: user.id, userName: user.fullName }];
      await tx`update marketing.tasks set action_data=${tx.json(next)},updated_at=now() where id=${taskId}::uuid`;
      return { ok: true };
    }

    if (action === "submit_execution") {
      if (task.task_type !== "execution") return { validation: "هذا ليس تكليف تنفيذ" };
      if (!isAssignee && !admin) return { forbidden: true };
      if (!["جاهز للتنفيذ", "مطلوب تعديل"].includes(task.status)) return { validation: "تكليف التنفيذ ليس في حالة تسمح برفع التسليم" };
      const finalFilePath = clean(body.finalFilePath);
      if (!finalFilePath) return { validation: "مسار أو رابط الملف النهائي مطلوب" };
      await tx`update marketing.tasks set final_file_path=${finalFilePath},final_file_name=${clean(body.finalFileName) || null},notes=${clean(body.notes) || task.notes},status='في انتظار الاعتماد',submitted_at=now(),updated_at=now() where id=${taskId}::uuid`;
      await tx`update marketing.creatives set status='في انتظار الاعتماد',updated_at=now() where id=${task.creative_id}::uuid`;
      await tx`insert into marketing.activity_log(campaign_id,task_id,user_id,action,after_data) values(${task.campaign_id}::uuid,${taskId}::uuid,${user.id}::uuid,'execution_submitted',${tx.json({ finalFilePath })})`;
      return { ok: true };
    }

    if (action === "approve_execution" || action === "reject_execution") {
      if (!canApproveTasks(user)) return { forbidden: true };
      if (task.task_type !== "execution") return { validation: "هذا ليس تكليف تنفيذ" };
      if (task.status !== "في انتظار الاعتماد") return { validation: "التسليم ليس بانتظار الاعتماد" };
      if (action === "reject_execution") {
        await tx`update marketing.tasks set status='مطلوب تعديل',notes=${clean(body.notes) || task.notes},approved_at=null,approved_by=null,updated_at=now() where id=${taskId}::uuid`;
        await tx`update marketing.creatives set status='مطلوب تعديل',updated_at=now() where id=${task.creative_id}::uuid`;
        await tx`insert into marketing.activity_log(campaign_id,task_id,user_id,action,after_data) values(${task.campaign_id}::uuid,${taskId}::uuid,${user.id}::uuid,'execution_rejected',${tx.json({ notes: clean(body.notes) })})`;
        return { ok: true };
      }
      await tx`update marketing.tasks set status='تم الاستلام',approved_at=now(),approved_by=${user.id}::uuid,completed_at=now(),updated_at=now() where id=${taskId}::uuid`;
      const [pendingCreative] = await tx<any[]>`select count(*)::int as count from marketing.tasks where creative_id=${task.creative_id}::uuid and task_type='execution' and status<>'تم الاستلام'`;
      if (Number(pendingCreative?.count || 0) === 0) await tx`update marketing.creatives set status='تم الاستلام',updated_at=now() where id=${task.creative_id}::uuid`;
      const [pendingWorkflow] = await tx<any[]>`
        select count(*)::int as count from marketing.tasks where campaign_id=${task.campaign_id}::uuid and (
          (task_type='task_template' and status<>'تاسك معتمد') or (task_type='execution' and status<>'تم الاستلام')
        )
      `;
      if (Number(pendingWorkflow?.count || 0) === 0) await tx`update marketing.campaigns set status='تم الاستلام',updated_by=${user.id}::uuid,updated_at=now() where id=${task.campaign_id}::uuid`;
      await tx`insert into marketing.activity_log(campaign_id,task_id,user_id,action) values(${task.campaign_id}::uuid,${taskId}::uuid,${user.id}::uuid,'execution_approved')`;
      return { ok: true };
    }

    return { validation: "إجراء التاسك غير معروف" };
  });
}

async function listAgenda(sql: ReturnType<typeof getSql>, request: VercelRequest, user: SessionUser) {
  const from = safeDate(request.query.from) || new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString();
  const to = safeDate(request.query.to) || new Date(new Date().getFullYear(), new Date().getMonth() + 2, 1).toISOString();
  const rows = await sql<any[]>`
    select a.*,a.id::text,a.owner_id::text,a.campaign_id::text,u.full_name as owner_name,c.name as campaign_name
    from marketing.agenda_items a left join core.users u on u.id=a.owner_id left join marketing.campaigns c on c.id=a.campaign_id
    where a.starts_at>=${from} and a.starts_at<${to} and (${isMarketingAdmin(user)}=true or a.owner_id is null or a.owner_id=${user.id}::uuid or a.created_by=${user.id}::uuid)
    order by a.starts_at
  `;
  return { ok: true, rows };
}

async function saveAgenda(sql: ReturnType<typeof getSql>, request: VercelRequest, user: SessionUser) {
  const body = bodyOf(request);
  const id = clean(body.id) || null;
  const title = clean(body.title);
  const startsAt = safeDate(body.startsAt);
  if (!title || !startsAt) return { validation: "عنوان وموعد الأجندة مطلوبان" };
  if (id) {
    const [row] = await sql<any[]>`
      update marketing.agenda_items set title=${title},item_type=${clean(body.itemType) || 'task'},starts_at=${startsAt},ends_at=${safeDate(body.endsAt)},owner_id=${clean(body.ownerId) || null}::uuid,campaign_id=${clean(body.campaignId) || null}::uuid,status=${clean(body.status) || 'مجدول'},notes=${clean(body.notes) || null},updated_by=${user.id}::uuid,updated_at=now()
      where id=${id}::uuid and (${isMarketingAdmin(user)}=true or created_by=${user.id}::uuid)
      returning id::text
    `;
    return row ? { ok: true, id: row.id } : { notFound: true };
  }
  const [row] = await sql<any[]>`
    insert into marketing.agenda_items(title,item_type,starts_at,ends_at,owner_id,campaign_id,status,notes,created_by,updated_by)
    values(${title},${clean(body.itemType) || 'task'},${startsAt},${safeDate(body.endsAt)},${clean(body.ownerId) || null}::uuid,${clean(body.campaignId) || null}::uuid,${clean(body.status) || 'مجدول'},${clean(body.notes) || null},${user.id}::uuid,${user.id}::uuid)
    returning id::text
  `;
  return { ok: true, id: row.id };
}

async function deleteAgenda(sql: ReturnType<typeof getSql>, request: VercelRequest, user: SessionUser) {
  const id = clean(request.query.id) || clean(bodyOf(request).id);
  const [row] = await sql<any[]>`delete from marketing.agenda_items where id=${id}::uuid and (${isMarketingAdmin(user)}=true or created_by=${user.id}::uuid) returning id::text`;
  return row ? { ok: true } : { notFound: true };
}

async function listPublishing(sql: ReturnType<typeof getSql>, request: VercelRequest, user: SessionUser) {
  const status = clean(request.query.status);
  const rows = await sql<any[]>`
    select p.*,p.id::text,p.campaign_id::text,p.creative_id::text,c.name as campaign_name,c.campaign_code,c.status as campaign_status,cr.name as creative_name,cr.output_path,ps.name as platform_name,ps.connection_status
    from marketing.publishing_items p
    join marketing.campaigns c on c.id=p.campaign_id and c.is_deleted=false
    join marketing.creatives cr on cr.id=p.creative_id
    left join marketing.platform_settings ps on ps.code=p.platform_code
    where (${status}='' or p.status=${status}) and ${campaignScope(sql,user,"c")}
    order by p.scheduled_at nulls last,p.updated_at desc
  `;
  return { ok: true, rows };
}

async function updatePublishing(sql: ReturnType<typeof getSql>, request: VercelRequest, user: SessionUser) {
  if (!canManagePublishing(user)) return { forbidden: true };
  const body = bodyOf(request);
  const id = clean(body.id);
  const action = clean(body.action) || "update";
  if (!id) return { validation: "عنصر النشر غير محدد" };
  const [current] = await sql<any[]>`select * from marketing.publishing_items where id=${id}::uuid`;
  if (!current) return { notFound: true };
  if (action === "mark_published") {
    await sql`update marketing.publishing_items set status='تم النشر',published_at=now(),external_post_id=${clean(body.externalPostId) || null},updated_by=${user.id}::uuid,updated_at=now() where id=${id}::uuid`;
  } else {
    const scheduledAt = safeDate(body.scheduledAt);
    const requestedStatus = clean(body.status);
    if (requestedStatus === "تم النشر") return { validation: "استخدم إجراء تم النشر لتسجيل النشر الفعلي" };
    const nextStatus = requestedStatus || (scheduledAt ? "مجدول" : current.status);
    await sql`update marketing.publishing_items set scheduled_at=${scheduledAt},caption=${clean(body.caption) || null},hashtags=${clean(body.hashtags) || null},media_path=${clean(body.mediaPath) || current.media_path},status=${nextStatus},updated_by=${user.id}::uuid,updated_at=now() where id=${id}::uuid`;
  }
  const [summary] = await sql<any[]>`select count(*)::int as total,count(*) filter(where status='تم النشر')::int as published,count(*) filter(where scheduled_at is not null or status='تم النشر')::int as scheduled from marketing.publishing_items where campaign_id=${current.campaign_id}::uuid`;
  const total = Number(summary?.total || 0);
  const published = Number(summary?.published || 0);
  const scheduled = Number(summary?.scheduled || 0);
  const campaignStatus = total > 0 && published === total ? "مكتملة" : total > 0 && scheduled === total ? "مجدولة" : "تجهيز النشر";
  await sql`update marketing.campaigns set status=${campaignStatus},updated_by=${user.id}::uuid,updated_at=now() where id=${current.campaign_id}::uuid`;
  return { ok: true };
}

async function settings(sql: ReturnType<typeof getSql>) {
  const [creativeTypes, platforms] = await Promise.all([
    sql<any[]>`select * from marketing.creative_type_settings order by sort_order,name`,
    sql<any[]>`select * from marketing.platform_settings order by sort_order,name`,
  ]);
  return { ok: true, creativeTypes, platforms };
}

async function saveSettings(sql: ReturnType<typeof getSql>, request: VercelRequest, user: SessionUser) {
  if (!canManageSettings(user)) return { forbidden: true };
  const body = bodyOf(request);
  const kind = clean(body.kind);
  if (kind === "creative_type") {
    const code = clean(body.code).toUpperCase();
    const name = clean(body.name);
    const departmentCodes = listValue(body.departmentCodes).map(clean).filter(Boolean);
    if (!code || !name || !departmentCodes.includes("content")) return { validation: "الكود والاسم وقسم المحتوى مطلوبة" };
    await sql`
      insert into marketing.creative_type_settings(code,name,department_codes,is_active,sort_order)
      values(${code},${name},${departmentCodes},${body.isActive !== false},${numberValue(body.sortOrder)})
      on conflict(code) do update set name=excluded.name,department_codes=excluded.department_codes,is_active=excluded.is_active,sort_order=excluded.sort_order,updated_at=now()
    `;
    return { ok: true };
  }
  if (kind === "platform") {
    const code = clean(body.code).toLowerCase();
    const name = clean(body.name);
    const postTypes = listValue(body.postTypes).map(clean).filter(Boolean);
    if (!code || !name) return { validation: "كود واسم المنصة مطلوبان" };
    await sql`
      insert into marketing.platform_settings(code,name,post_types,is_active,connection_status,sort_order,metadata)
      values(${code},${name},${postTypes},${body.isActive !== false},${clean(body.connectionStatus) || 'غير مربوط'},${numberValue(body.sortOrder)},${sql.json(body.metadata || {})})
      on conflict(code) do update set name=excluded.name,post_types=excluded.post_types,is_active=excluded.is_active,connection_status=excluded.connection_status,sort_order=excluded.sort_order,metadata=excluded.metadata,updated_at=now()
    `;
    return { ok: true };
  }
  return { validation: "نوع الإعداد غير معروف" };
}

function sendResult(response: VercelResponse, result: any, successStatus = 200) {
  if (result?.forbidden) return response.status(403).json({ ok: false, error: "لا تملك صلاحية تنفيذ هذا الإجراء" });
  if (result?.validation) return response.status(400).json({ ok: false, error: result.validation });
  if (result?.notFound || result?.notFound === true) return response.status(404).json({ ok: false, error: "العنصر المطلوب غير موجود" });
  if (result?.locked) return response.status(409).json({ ok: false, error: "لا يمكن تعديل الحملة بعد اعتماد الهيكل" });
  return response.status(successStatus).json(result?.ok === undefined ? { ok: true, ...result } : result);
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireMarketingUser(request, response);
  if (!user) return;
  const resource = clean(request.query.resource) || "dashboard";
  try {
    await ensureMarketingSchema();
    const sql = getSql();
    if (request.method === "GET") {
      if (resource === "meta") return response.status(200).json(await meta(sql, user));
      if (resource === "dashboard") return response.status(200).json(await dashboard(sql, user));
      if (resource === "campaigns") return response.status(200).json(await listCampaigns(sql, request, user));
      if (resource === "campaign") {
        const result = await campaignDetail(sql, request, user);
        return result.notFound ? response.status(404).json({ ok: false, error: "الحملة غير موجودة" }) : response.status(200).json(result);
      }
      if (resource === "tasks") return response.status(200).json(await listTasks(sql, request, user));
      if (resource === "agenda") return response.status(200).json(await listAgenda(sql, request, user));
      if (resource === "publishing") return response.status(200).json(await listPublishing(sql, request, user));
      if (resource === "settings") return response.status(200).json(await settings(sql));
    }
    if (request.method === "POST") {
      if (resource === "campaigns") return sendResult(response, await saveCampaign(sql, request, user), 201);
      if (resource === "campaign-action") return sendResult(response, await campaignAction(sql, request, user));
      if (resource === "agenda") return sendResult(response, await saveAgenda(sql, request, user), 201);
    }
    if (request.method === "PUT") {
      if (resource === "campaigns") return sendResult(response, await saveCampaign(sql, request, user));
      if (resource === "tasks") return sendResult(response, await updateTask(sql, request, user));
      if (resource === "agenda") return sendResult(response, await saveAgenda(sql, request, user));
      if (resource === "publishing") return sendResult(response, await updatePublishing(sql, request, user));
      if (resource === "settings") return sendResult(response, await saveSettings(sql, request, user));
    }
    if (request.method === "DELETE") {
      if (resource === "campaigns") return sendResult(response, await deleteCampaign(sql, request, user));
      if (resource === "agenda") return sendResult(response, await deleteAgenda(sql, request, user));
    }
    return response.status(405).json({ ok: false, error: "الطريقة أو مورد التسويق غير مدعوم" });
  } catch (error: any) {
    console.error("Marketing API failed", { resource, error });
    if (error?.code === "23505") return response.status(409).json({ ok: false, error: "كود الحملة أو مفتاح الكرييتيف مستخدم بالفعل" });
    if (error?.code === "22P02") return response.status(400).json({ ok: false, error: "معرّف غير صالح في الطلب" });
    if (error?.message === "CAMPAIGN_ID_REQUIRED") return response.status(400).json({ ok: false, error: "الحملة غير محددة" });
    return response.status(500).json({ ok: false, error: "تعذر تنفيذ طلب التسويق" });
  }
}
