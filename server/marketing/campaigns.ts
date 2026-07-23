import type { VercelRequest } from "@vercel/node";
import type { SessionUser } from "../_auth.js";
import { getSql } from "../_db.js";
import {
  MarketingError, allocateCampaignCode, arrayValue, audit, boolValue, buildPairKey, buildTaskCode,
  clean, dateValue, hasPermission, isAdmin, normalizeDepartment, numberValue, pageValues,
  recalculateCampaign, safeJson,
} from "./common.js";

type CampaignPayload = Record<string, any>;

type AssignmentInput = {
  departmentCode?: string;
  executionUserId?: string;
  contentUserId?: string;
  dueDate?: string;
  writerDueDate?: string;
  departmentNote?: string;
  contentNote?: string;
};

type CreativeInput = {
  clientId?: string;
  catalogId?: string;
  name?: string;
  primaryDepartmentCode?: string;
  notes?: string;
  metadata?: Record<string, any>;
  assignments?: AssignmentInput[];
  vehicleIds?: string[];
};

function assertCampaignManage(user: SessionUser) {
  if (!hasPermission(user, "marketing.campaigns.manage")) throw new MarketingError(403, "لا توجد لديك صلاحية إنشاء أو تعديل الحملات", "FORBIDDEN");
}

async function resolveWorkflow(tx: any, departmentCode: string) {
  return tx<any[]>`
    select id::text,name,sort_order,weight,is_admin_only,is_required
    from marketing.workflow_actions where department_code=${departmentCode} and is_active=true order by sort_order,id
  `;
}

async function insertCampaignGraph(tx: any, user: SessionUser, body: CampaignPayload, sourceType: "campaign" | "agenda", agendaId?: string) {
  const campaignData = body.campaign && typeof body.campaign === "object" ? body.campaign : body;
  const campaignTypeId = clean(campaignData.campaignTypeId || campaignData.campaign_type_id);
  const name = clean(campaignData.name || campaignData.campaignName || campaignData.campaign_name);
  const objective = clean(campaignData.objective || campaignData.goal || campaignData.campaign_goal);
  const contentBrief = clean(campaignData.contentBrief || campaignData.content_writer_brief);
  const campaignDate = dateValue(campaignData.campaignDate || campaignData.campaign_date) || new Date().toISOString().slice(0, 10);
  const publishStartDate = dateValue(campaignData.publishStartDate || campaignData.publish_start_date);
  const publishEndDate = dateValue(campaignData.publishEndDate || campaignData.publish_end_date);
  const structureDeadline = dateValue(campaignData.structureDeadline || campaignData.structure_deadline);
  const creatives = arrayValue<CreativeInput>(body.creatives);
  if (!campaignTypeId || !name || !publishStartDate || !publishEndDate) throw new MarketingError(400, "أكمل نوع الحملة والاسم وتاريخ بداية ونهاية النشر", "VALIDATION_ERROR");
  if (publishStartDate > publishEndDate) throw new MarketingError(400, "تاريخ بداية النشر يجب ألا يتجاوز تاريخ النهاية", "INVALID_DATE_RANGE");
  if (!creatives.length) throw new MarketingError(400, "اختر كرييتيف واحدًا على الأقل", "CREATIVE_REQUIRED");

  const allocated = await allocateCampaignCode(tx, campaignTypeId, sourceType);
  const [campaign] = await tx<any[]>`
    insert into marketing.campaigns(
      campaign_code,name,campaign_type,campaign_type_id,objective,content_brief,status,source_type,agenda_id,
      campaign_date,publish_start_date,publish_end_date,starts_at,ends_at,due_at,structure_deadline,created_by,updated_by
    ) values (
      ${allocated.code},${name},${allocated.type.name},${campaignTypeId}::uuid,${objective || null},${contentBrief || null},'draft',${sourceType},${agendaId || null},
      ${campaignDate}::date,${publishStartDate}::date,${publishEndDate}::date,${publishStartDate}::date,${publishEndDate}::date,${publishEndDate}::date,
      ${structureDeadline || null},${user.id}::uuid,${user.id}::uuid
    ) returning *,id::text
  `;

  const creativeMap = new Map<string, string>();
  let assignmentSerial = 1;
  for (let creativeIndex = 0; creativeIndex < creatives.length; creativeIndex += 1) {
    const input = creatives[creativeIndex];
    const catalogId = clean(input.catalogId);
    const [catalog] = catalogId ? await tx<any[]>`select id::text,name,short_code,primary_department_code from marketing.creative_catalog where id=${catalogId}::uuid and is_active=true` : [];
    if (!catalog && !clean(input.name)) throw new MarketingError(400, `الكرييتيف رقم ${creativeIndex + 1} غير صحيح`, "INVALID_CREATIVE");
    const creativeName = clean(input.name) || catalog.name;
    const departmentCode = normalizeDepartment(input.primaryDepartmentCode || catalog?.primary_department_code);
    const instanceNo = creativeIndex + 1;
    const instanceCode = `N${String(instanceNo).padStart(2, "0")}-${clean(catalog?.short_code || creativeName).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 22) || "CREATIVE"}`;
    const [creative] = await tx<any[]>`
      insert into marketing.creatives(campaign_id,catalog_creative_id,creative_type,quantity,status,instance_no,instance_code,creative_name,primary_department_code,notes,metadata)
      values (${campaign.id}::uuid,${catalogId || null},${creativeName},1,'pending',${instanceNo},${instanceCode},${creativeName},${departmentCode},${clean(input.notes) || null},${tx.json(safeJson(input.metadata || {}))})
      returning *,id::text
    `;
    creativeMap.set(clean(input.clientId) || String(creativeIndex), creative.id);

    const vehicleIds = [...new Set(arrayValue(input.vehicleIds).map(clean).filter(Boolean))];
    for (const vehicleId of vehicleIds) {
      const [vehicle] = await tx<any[]>`
        select v.id::text,v.vin,v.car_name,v.statement,v.exterior_color,v.interior_color,v.model_year,l.name as location_name
        from operations.vehicles v left join operations.locations l on l.id=v.location_id
        where v.id=${vehicleId}::uuid and v.is_deleted=false and v.archived_at is null
      `;
      if (!vehicle) throw new MarketingError(400, "إحدى سيارات الكرييتيف غير موجودة في مخزن العمليات", "VEHICLE_NOT_FOUND");
      await tx`
        insert into marketing.creative_vehicle_links(creative_id,vehicle_id,vin_snapshot,car_name_snapshot,statement_snapshot,exterior_color_snapshot,interior_color_snapshot,model_year_snapshot,location_snapshot)
        values (${creative.id}::uuid,${vehicle.id}::uuid,${vehicle.vin},${vehicle.car_name},${vehicle.statement},${vehicle.exterior_color},${vehicle.interior_color},${vehicle.model_year},${vehicle.location_name})
        on conflict(creative_id,vehicle_id) do nothing
      `;
    }

    const assignments = arrayValue<AssignmentInput>(input.assignments);
    if (!assignments.length) throw new MarketingError(400, `حدد توزيع الكرييتيف ${creativeName}`, "ASSIGNMENT_REQUIRED");
    for (const assignmentInput of assignments) {
      const assignmentDepartment = normalizeDepartment(assignmentInput.departmentCode || departmentCode);
      const executionUserId = clean(assignmentInput.executionUserId);
      const contentUserId = clean(assignmentInput.contentUserId);
      if (!executionUserId || !contentUserId) throw new MarketingError(400, `كل يوزر تنفيذي في ${creativeName} يجب ربطه بكاتب محتوى`, "PAIR_REQUIRED");
      const users = await tx<any[]>`select id::text,full_name from core.users where id in ${tx([executionUserId, contentUserId].map((id) => `${id}`))} and is_active=true`;
      if (new Set(users.map((row: any) => row.id)).size !== new Set([executionUserId, contentUserId]).size) throw new MarketingError(400, "أحد المستخدمين المختارين غير موجود أو موقوف", "USER_NOT_FOUND");
      const pairKey = buildPairKey({ campaignId: campaign.id, creativeId: creative.id, departmentCode: assignmentDepartment, executionUserId, contentUserId });
      const [assignment] = await tx<any[]>`
        insert into marketing.creative_assignments(campaign_id,creative_id,department_code,execution_user_id,content_user_id,pair_key,due_date,writer_due_date,department_note,content_note)
        values (${campaign.id}::uuid,${creative.id}::uuid,${assignmentDepartment},${executionUserId}::uuid,${contentUserId}::uuid,${pairKey},${dateValue(assignmentInput.dueDate) || null},${dateValue(assignmentInput.writerDueDate) || null},${clean(assignmentInput.departmentNote) || null},${clean(assignmentInput.contentNote) || null})
        returning *,id::text
      `;
      const contentTaskCode = buildTaskCode(campaign.campaign_code, instanceCode, assignmentDepartment, assignmentSerial, "C");
      const executionTaskCode = buildTaskCode(campaign.campaign_code, instanceCode, assignmentDepartment, assignmentSerial, "E");
      const [contentTask] = await tx<any[]>`
        insert into marketing.tasks(campaign_id,creative_id,department_code,assigned_to,paired_content_user_id,status,due_at,task_code,task_type,pair_key,title,assignment_id,progress_percent,requires_final_file,workflow_snapshot,created_by,updated_by)
        values (${campaign.id}::uuid,${creative.id}::uuid,'content',${contentUserId}::uuid,${contentUserId}::uuid,'pending_template',${dateValue(assignmentInput.writerDueDate) || structureDeadline || null},${contentTaskCode},'content_template',${pairKey},${`Task Template - ${creativeName}`},${assignment.id}::uuid,0,false,'[]'::jsonb,${user.id}::uuid,${user.id}::uuid)
        returning *,id::text
      `;
      const workflow = await resolveWorkflow(tx, assignmentDepartment);
      const [executionTask] = await tx<any[]>`
        insert into marketing.tasks(campaign_id,creative_id,department_code,assigned_to,paired_content_user_id,status,due_at,task_code,task_type,pair_key,title,assignment_id,depends_on_task_id,progress_percent,requires_final_file,workflow_snapshot,created_by,updated_by)
        values (${campaign.id}::uuid,${creative.id}::uuid,${assignmentDepartment},${executionUserId}::uuid,${contentUserId}::uuid,'blocked_by_template',${dateValue(assignmentInput.dueDate) || publishStartDate},${executionTaskCode},'execution',${pairKey},${creativeName},${assignment.id}::uuid,${contentTask.id}::uuid,0,true,${tx.json(safeJson(workflow))},${user.id}::uuid,${user.id}::uuid)
        returning *,id::text
      `;
      for (const action of workflow) {
        await tx`
          insert into marketing.task_action_events(task_id,action_code,action_name,action_order,weight,is_admin_only,is_required)
          values (${executionTask.id}::uuid,${`${assignmentDepartment}_${action.sort_order}`},${action.name},${action.sort_order},${Number(action.weight || 0)},${Boolean(action.is_admin_only)},${Boolean(action.is_required)})
        `;
      }
      assignmentSerial += 1;
    }
  }

  const budgets = arrayValue<any>(body.budgets || body.budgetItems);
  for (let index = 0; index < budgets.length; index += 1) {
    const input = budgets[index];
    const creativeId = creativeMap.get(clean(input.creativeClientId)) || clean(input.creativeId);
    if (!creativeId) continue;
    const [budget] = await tx<any[]>`
      insert into marketing.campaign_budget_items(campaign_id,funnel_id,creative_id,ads_count,content_goal,expected_target,sort_order)
      values (${campaign.id}::uuid,${clean(input.funnelId) || null},${creativeId}::uuid,${Math.max(1,Math.floor(numberValue(input.adsCount,1)))},${clean(input.contentGoal) || null},${clean(input.expectedTarget) || null},${index}) returning id::text
    `;
    for (const platform of arrayValue<any>(input.platforms)) {
      const platformId = clean(platform.platformId);
      if (!platformId) continue;
      await tx`insert into marketing.campaign_budget_platforms(budget_item_id,platform_id,amount) values (${budget.id}::uuid,${platformId}::uuid,${Math.max(0,numberValue(platform.amount,0))})`;
    }
  }

  const schedule = arrayValue<any>(body.schedule || body.publishSchedule);
  for (let index = 0; index < schedule.length; index += 1) {
    const input = schedule[index];
    const creativeId = creativeMap.get(clean(input.creativeClientId)) || clean(input.creativeId);
    const publishDate = dateValue(input.publishDate || input.date);
    if (!creativeId || !publishDate) continue;
    const [item] = await tx<any[]>`
      insert into marketing.publish_schedule_items(campaign_id,creative_id,publish_date,caption,hashtags,sort_order)
      values (${campaign.id}::uuid,${creativeId}::uuid,${publishDate}::date,${clean(input.caption) || null},${clean(input.hashtags) || null},${index}) returning id::text
    `;
    for (const target of arrayValue<any>(input.targets)) {
      const platformId = clean(target.platformId);
      const postTypeIds = arrayValue(target.postTypeIds).map(clean).filter(Boolean);
      if (!platformId) continue;
      for (const postTypeId of postTypeIds.length ? postTypeIds : [clean(target.postTypeId)].filter(Boolean)) {
        await tx`
          insert into marketing.publish_schedule_targets(schedule_item_id,platform_id,post_type_id,publish_time,dimensions,status)
          select ${item.id}::uuid,${platformId}::uuid,p.id,${clean(target.publishTime) || null},p.dimensions,'draft'
          from marketing.platform_post_types p where p.id=${postTypeId}::uuid and p.platform_id=${platformId}::uuid
          on conflict(schedule_item_id,platform_id,post_type_id) do nothing
        `;
      }
    }
  }

  const result = await recalculateCampaign(tx, campaign.id);
  return { ...campaign, progress_percent: result.campaign.progress_percent, status: result.campaign.status };
}

export async function createCampaign(user: SessionUser, body: CampaignPayload) {
  assertCampaignManage(user);
  const sql = getSql();
  return sql.begin(async (tx) => {
    const campaign = await insertCampaignGraph(tx, user, body, "campaign");
    await tx`insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data) values (${user.id}::uuid,'marketing','campaign_created','campaign',${campaign.id},${tx.json(safeJson(campaign))})`;
    return { ok: true, campaign, message: "تم إنشاء الحملة وتوزيع التاسكات بنجاح" };
  });
}

export async function createAgenda(user: SessionUser, body: CampaignPayload) {
  assertCampaignManage(user);
  const agenda = body.agenda && typeof body.agenda === "object" ? body.agenda : body;
  const name = clean(agenda.name || agenda.agendaName);
  const monthKey = clean(agenda.monthKey || agenda.month);
  const publishStartDate = dateValue(agenda.publishStartDate || agenda.startDate);
  const publishEndDate = dateValue(agenda.publishEndDate || agenda.endDate);
  if (!name || !/^\d{4}-\d{2}$/.test(monthKey) || !publishStartDate || !publishEndDate) throw new MarketingError(400, "أكمل اسم الأجندة والشهر وتاريخ البداية والنهاية", "VALIDATION_ERROR");
  if (publishStartDate > publishEndDate) throw new MarketingError(400, "تاريخ بداية الأجندة يجب ألا يتجاوز النهاية", "INVALID_DATE_RANGE");
  const campaignType = await getSql()<any[]>`select id::text from marketing.campaign_types where name='أجندة شهرية' and is_active=true limit 1`;
  const mergedBody = {
    ...body,
    campaign: {
      ...(body.campaign || {}),
      campaignTypeId: clean(body.campaign?.campaignTypeId) || campaignType[0]?.id,
      name,
      campaignDate: publishStartDate,
      publishStartDate,
      publishEndDate,
      objective: clean(agenda.objective) || `أجندة ${monthKey}`,
      contentBrief: clean(agenda.contentBrief),
    },
  };
  const sql = getSql();
  return sql.begin(async (tx) => {
    const [agendaRow] = await tx<any[]>`
      insert into marketing.agendas(name,month_key,publish_start_date,publish_end_date,created_by,updated_by)
      values (${name},${monthKey},${publishStartDate}::date,${publishEndDate}::date,${user.id}::uuid,${user.id}::uuid) returning *,id::text
    `;
    const campaign = await insertCampaignGraph(tx, user, mergedBody, "agenda", agendaRow.id);
    await tx`insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data) values (${user.id}::uuid,'marketing','agenda_created','agenda',${agendaRow.id},${tx.json(safeJson({ agenda: agendaRow, campaign }))})`;
    return { ok: true, agenda: agendaRow, campaign, message: "تم إنشاء الأجندة وتوزيع مهامها بنجاح" };
  });
}

function campaignScope(sql: ReturnType<typeof getSql>, user: SessionUser) {
  if (isAdmin(user) || hasPermission(user, "marketing.campaigns.manage") || hasPermission(user, "marketing.tasks.review")) return sql`true`;
  return sql`exists(select 1 from marketing.tasks sx where sx.campaign_id=c.id and sx.assigned_to=${user.id}::uuid)`;
}

export async function listCampaigns(request: VercelRequest, user: SessionUser) {
  const sql = getSql();
  const { page, pageSize, offset } = pageValues(request);
  const search = clean(request.query.search);
  const type = clean(request.query.type);
  const status = clean(request.query.status);
  const sourceType = clean(request.query.sourceType);
  const from = dateValue(request.query.from);
  const to = dateValue(request.query.to);
  const pattern = `%${search}%`;
  const scope = campaignScope(sql, user);
  const where = sql`
    c.is_deleted=false and ${scope}
    and (${search}='' or c.name ilike ${pattern} or coalesce(c.campaign_code,'') ilike ${pattern} or coalesce(c.objective,'') ilike ${pattern})
    and (${type}='' or c.campaign_type=${type} or c.campaign_type_id::text=${type})
    and (${status}='' or c.status=${status})
    and (${sourceType}='' or c.source_type=${sourceType})
    and (${from}='' or c.campaign_date>=nullif(${from}::text,'')::date)
    and (${to}='' or c.campaign_date<=nullif(${to}::text,'')::date)
  `;
  const [count] = await sql<{ total: number }[]>`select count(*)::int as total from marketing.campaigns c where ${where}`;
  const rows = await sql<any[]>`
    select c.id::text,c.campaign_code,c.name,c.campaign_type,c.objective,c.content_brief,c.status,c.source_type,c.campaign_date,c.publish_start_date,c.publish_end_date,
      c.progress_percent,c.released_at,c.archived_at,c.created_at,c.updated_at,
      coalesce(x.creative_count,0)::int as creative_count,coalesce(x.task_count,0)::int as task_count,coalesce(x.completed_tasks,0)::int as completed_tasks,
      coalesce(x.departments,'[]'::json) as departments,coalesce(x.assignees,'[]'::json) as assignees,
      coalesce(b.total_budget,0)::numeric as total_budget
    from marketing.campaigns c
    left join lateral (
      select count(distinct cr.id)::int creative_count,count(distinct t.id)::int task_count,count(distinct t.id) filter(where t.progress_percent>=100)::int completed_tasks,
        json_agg(distinct jsonb_build_object('code',t.department_code,'name',coalesce(dm.display_name,t.department_code))) filter(where t.id is not null) as departments,
        json_agg(distinct jsonb_build_object('id',u.id::text,'name',u.full_name,'department',t.department_code)) filter(where u.id is not null) as assignees
      from marketing.creatives cr left join marketing.tasks t on t.creative_id=cr.id left join core.users u on u.id=t.assigned_to left join marketing.department_mappings dm on dm.department_code=t.department_code
      where cr.campaign_id=c.id
    ) x on true
    left join lateral (
      select coalesce(sum(bp.amount),0) total_budget from marketing.campaign_budget_items bi join marketing.campaign_budget_platforms bp on bp.budget_item_id=bi.id where bi.campaign_id=c.id
    ) b on true
    where ${where}
    order by greatest(c.updated_at,c.created_at) desc limit ${pageSize} offset ${offset}
  `;
  return { ok: true, rows, total: Number(count?.total || 0), page, pageSize };
}

export async function campaignDetail(id: string, user: SessionUser) {
  const sql = getSql();
  const scope = campaignScope(sql, user);
  const [campaign] = await sql<any[]>`select c.*,c.id::text from marketing.campaigns c where c.id=${id}::uuid and c.is_deleted=false and ${scope}`;
  if (!campaign) throw new MarketingError(404, "الحملة غير موجودة", "CAMPAIGN_NOT_FOUND");
  const creatives = await sql<any[]>`
    select cr.*,cr.id::text,
      coalesce(v.vehicles,'[]'::json) vehicles,
      coalesce(a.assignments,'[]'::json) assignments
    from marketing.creatives cr
    left join lateral (
      select json_agg(json_build_object('vehicle_id',l.vehicle_id::text,'vin',l.vin_snapshot,'car_name',l.car_name_snapshot,'statement',l.statement_snapshot,'exterior_color',l.exterior_color_snapshot,'interior_color',l.interior_color_snapshot,'model_year',l.model_year_snapshot,'location',l.location_snapshot) order by l.vin_snapshot) vehicles
      from marketing.creative_vehicle_links l where l.creative_id=cr.id
    ) v on true
    left join lateral (
      select json_agg(json_build_object('id',ca.id::text,'department_code',ca.department_code,'execution_user_id',ca.execution_user_id::text,'execution_user_name',eu.full_name,'content_user_id',ca.content_user_id::text,'content_user_name',cu.full_name,'due_date',ca.due_date,'writer_due_date',ca.writer_due_date,'department_note',ca.department_note,'content_note',ca.content_note,'pair_key',ca.pair_key) order by ca.created_at) assignments
      from marketing.creative_assignments ca join core.users eu on eu.id=ca.execution_user_id join core.users cu on cu.id=ca.content_user_id where ca.creative_id=cr.id
    ) a on true
    where cr.campaign_id=${id}::uuid order by cr.instance_no
  `;
  const tasks = await sql<any[]>`
    select t.*,t.id::text,u.full_name as assigned_to_name,cu.full_name as content_user_name,dm.display_name as department_name,
      coalesce(a.actions,'[]'::json) actions,coalesce(f.files,'[]'::json) files,tv.latest_template
    from marketing.tasks t
    left join core.users u on u.id=t.assigned_to left join core.users cu on cu.id=t.paired_content_user_id left join marketing.department_mappings dm on dm.department_code=t.department_code
    left join lateral (select json_agg(x order by x.action_order) actions from (select id::text,action_code,action_name,action_order,weight,is_admin_only,is_required,is_completed,completed_at,note from marketing.task_action_events where task_id=t.id) x) a on true
    left join lateral (select json_agg(x order by x.uploaded_at desc) files from (select id::text,file_kind,file_name,mime_type,file_size,uploaded_at,is_active from marketing.task_files where task_id=t.id and is_active=true) x) f on true
    left join lateral (select json_build_object('id',v.id::text,'version_no',v.version_no,'status',v.status,'parsed_data',v.parsed_data,'submitted_at',v.submitted_at,'reviewed_at',v.reviewed_at,'review_note',v.review_note) latest_template from marketing.task_template_versions v where v.task_id=t.id order by v.version_no desc limit 1) tv on true
    where t.campaign_id=${id}::uuid order by t.task_type,t.department_code,t.task_code
  `;
  const budgets = await sql<any[]>`
    select bi.*,bi.id::text,f.name as funnel_name,cr.creative_name,cr.instance_code,coalesce(p.platforms,'[]'::json) platforms
    from marketing.campaign_budget_items bi left join marketing.funnels f on f.id=bi.funnel_id join marketing.creatives cr on cr.id=bi.creative_id
    left join lateral (select json_agg(json_build_object('platform_id',bp.platform_id::text,'platform_name',pc.name,'amount',bp.amount) order by pc.sort_order) platforms from marketing.campaign_budget_platforms bp join marketing.platform_catalog pc on pc.id=bp.platform_id where bp.budget_item_id=bi.id) p on true
    where bi.campaign_id=${id}::uuid order by bi.sort_order,bi.id
  `;
  const schedule = await sql<any[]>`
    select si.*,si.id::text,cr.creative_name,cr.instance_code,coalesce(t.targets,'[]'::json) targets
    from marketing.publish_schedule_items si join marketing.creatives cr on cr.id=si.creative_id
    left join lateral (select json_agg(json_build_object('id',st.id::text,'platform_id',st.platform_id::text,'platform_name',pc.name,'post_type_id',st.post_type_id::text,'post_type_name',pt.name,'publish_time',st.publish_time,'dimensions',coalesce(st.dimensions,pt.dimensions),'status',st.status) order by pc.sort_order,pt.sort_order) targets from marketing.publish_schedule_targets st join marketing.platform_catalog pc on pc.id=st.platform_id join marketing.platform_post_types pt on pt.id=st.post_type_id where st.schedule_item_id=si.id) t on true
    where si.campaign_id=${id}::uuid order by si.publish_date,si.sort_order
  `;
  return { ok: true, campaign, creatives, tasks, budgets, schedule };
}

export async function campaignAction(user: SessionUser, body: Record<string, any>) {
  const action = clean(body.action);
  const id = clean(body.id || body.campaignId);
  if (!id) throw new MarketingError(400, "الحملة مطلوبة", "VALIDATION_ERROR");
  const sql = getSql();
  if (action === "update_campaign") {
    assertCampaignManage(user);
    const payload = body.payload && typeof body.payload === "object" ? body.payload as Record<string, any> : body;
    const campaignInput = payload.campaign && typeof payload.campaign === "object" ? payload.campaign as Record<string, any> : payload;
    const name = clean(campaignInput.name);
    const objective = clean(campaignInput.objective);
    const contentBrief = clean(campaignInput.contentBrief);
    const campaignDate = dateValue(campaignInput.campaignDate);
    const publishStartDate = dateValue(campaignInput.publishStartDate);
    const publishEndDate = dateValue(campaignInput.publishEndDate);
    const structureDeadline = dateValue(campaignInput.structureDeadline);
    const expectedVersion = Math.max(0, Math.floor(numberValue(campaignInput.version, 0)));
    if (!name || !campaignDate || !publishStartDate || !publishEndDate) throw new MarketingError(400, "أكمل اسم الحملة وتواريخها", "VALIDATION_ERROR");
    if (publishStartDate > publishEndDate) throw new MarketingError(400, "تاريخ بداية النشر يجب ألا يتجاوز تاريخ النهاية", "INVALID_DATE_RANGE");
    const assignments = arrayValue<any>(payload.assignments);
    const budgets = arrayValue<any>(payload.budgets);
    const schedule = arrayValue<any>(payload.schedule);
    const result = await sql.begin(async (tx) => {
      const [campaign] = await tx<any[]>`select *,id::text from marketing.campaigns where id=${id}::uuid and is_deleted=false for update`;
      if (!campaign) throw new MarketingError(404, "الحملة غير موجودة", "CAMPAIGN_NOT_FOUND");
      if (campaign.status === "archived" || campaign.released_at) throw new MarketingError(409, "لا يمكن تعديل حملة مؤرشفة أو محررة للنشر", "CAMPAIGN_LOCKED");
      if (expectedVersion && Number(campaign.version || 0) !== expectedVersion) throw new MarketingError(409, "تم تعديل الحملة من مستخدم آخر. أعد فتح التفاصيل قبل الحفظ", "VERSION_CONFLICT");

      const [published] = await tx<{ count: number }[]>`
        select count(*)::int count from marketing.publish_targets pt
        join marketing.publish_prep_items pi on pi.id=pt.publish_prep_item_id
        where pi.campaign_id=${id}::uuid and pt.status in ('publishing','published')
      `;
      if (Number(published?.count || 0) > 0 && schedule.length) throw new MarketingError(409, "لا يمكن تغيير جدول النشر بعد بدء النشر الفعلي", "PUBLISH_SCHEDULE_LOCKED");

      await tx`
        update marketing.campaigns set name=${name},objective=${objective || null},content_brief=${contentBrief || null},campaign_date=${campaignDate}::date,
          publish_start_date=${publishStartDate}::date,publish_end_date=${publishEndDate}::date,starts_at=${publishStartDate}::date,ends_at=${publishEndDate}::date,due_at=${publishEndDate}::date,
          structure_deadline=${structureDeadline || null},updated_by=${user.id}::uuid,updated_at=now(),version=version+1
        where id=${id}::uuid
      `;

      for (const input of assignments) {
        const assignmentId = clean(input.id);
        if (!assignmentId) continue;
        const dueDate = dateValue(input.dueDate);
        const writerDueDate = dateValue(input.writerDueDate);
        const departmentNote = clean(input.departmentNote);
        const contentNote = clean(input.contentNote);
        const [assignment] = await tx<any[]>`
          update marketing.creative_assignments set due_date=${dueDate || null},writer_due_date=${writerDueDate || null},department_note=${departmentNote || null},content_note=${contentNote || null}
          where id=${assignmentId}::uuid and campaign_id=${id}::uuid returning id::text
        `;
        if (!assignment) throw new MarketingError(400, "إحدى علاقات التوزيع لا تنتمي للحملة", "INVALID_ASSIGNMENT");
        await tx`
          update marketing.tasks set due_at=case when task_type='content_template' then ${writerDueDate || structureDeadline || null} else ${dueDate || publishStartDate} end,
            updated_by=${user.id}::uuid,updated_at=now(),version=version+1
          where assignment_id=${assignmentId}::uuid
        `;
      }

      await tx`delete from marketing.campaign_budget_items where campaign_id=${id}::uuid`;
      for (let index = 0; index < budgets.length; index += 1) {
        const budget = budgets[index] || {};
        const creativeId = clean(budget.creativeId);
        const funnelId = clean(budget.funnelId);
        if (!creativeId) continue;
        const [creative] = await tx<any[]>`select id::text from marketing.creatives where id=${creativeId}::uuid and campaign_id=${id}::uuid`;
        if (!creative) throw new MarketingError(400, "أحد بنود الميزانية مرتبط بكرييتيف غير صحيح", "INVALID_CREATIVE");
        const [item] = await tx<any[]>`
          insert into marketing.campaign_budget_items(campaign_id,creative_id,funnel_id,ads_count,content_goal,expected_target,sort_order)
          values (${id}::uuid,${creativeId}::uuid,${funnelId || null},${Math.max(1,Math.floor(numberValue(budget.adsCount,1)))},${clean(budget.contentGoal) || null},${clean(budget.expectedTarget) || null},${index + 1}) returning id::text
        `;
        for (const platform of arrayValue<any>(budget.platforms)) {
          const platformId = clean(platform.platformId);
          if (!platformId) continue;
          await tx`
            insert into marketing.campaign_budget_platforms(budget_item_id,platform_id,amount)
            values (${item.id}::uuid,${platformId}::uuid,${Math.max(0,numberValue(platform.amount,0))})
          `;
        }
      }

      if (Number(published?.count || 0) === 0) {
        await tx`delete from marketing.publish_schedule_items where campaign_id=${id}::uuid`;
        for (let index = 0; index < schedule.length; index += 1) {
          const item = schedule[index] || {};
          const creativeId = clean(item.creativeId);
          const publishDate = dateValue(item.publishDate);
          if (!creativeId || !publishDate) continue;
          if (publishDate < publishStartDate || publishDate > publishEndDate) throw new MarketingError(400, "أحد مواعيد النشر خارج نطاق الحملة", "INVALID_SCHEDULE_DATE");
          const [creative] = await tx<any[]>`select id::text from marketing.creatives where id=${creativeId}::uuid and campaign_id=${id}::uuid`;
          if (!creative) throw new MarketingError(400, "أحد عناصر الجدول مرتبط بكرييتيف غير صحيح", "INVALID_CREATIVE");
          const [scheduleItem] = await tx<any[]>`
            insert into marketing.publish_schedule_items(campaign_id,creative_id,publish_date,caption,hashtags,sort_order)
            values (${id}::uuid,${creativeId}::uuid,${publishDate}::date,${clean(item.caption) || null},${clean(item.hashtags) || null},${index + 1}) returning id::text
          `;
          for (const target of arrayValue<any>(item.targets)) {
            const platformId = clean(target.platformId);
            const postTypeId = clean(target.postTypeId);
            if (!platformId || !postTypeId) continue;
            await tx`
              insert into marketing.publish_schedule_targets(schedule_item_id,platform_id,post_type_id,publish_time,dimensions,status)
              select ${scheduleItem.id}::uuid,${platformId}::uuid,${postTypeId}::uuid,${clean(target.publishTime) || null},pt.dimensions,'scheduled'
              from marketing.platform_post_types pt where pt.id=${postTypeId}::uuid and pt.platform_id=${platformId}::uuid
            `;
          }
        }
      }

      const recalculated = await recalculateCampaign(tx, id);
      return { before: campaign, campaign: recalculated.campaign };
    });
    await audit(user, "update_campaign", "marketing.campaign", id, result.before, result.campaign);
    return { ok: true, campaign: result.campaign, message: "تم تحديث الحملة والتوزيع والميزانية وجدول النشر" };
  }
  if (action === "archive_campaign") {
    assertCampaignManage(user);
    const [row] = await sql<any[]>`update marketing.campaigns set archived_at=now(),status='archived',updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${id}::uuid and is_deleted=false returning *,id::text`;
    if (!row) throw new MarketingError(404, "الحملة غير موجودة", "CAMPAIGN_NOT_FOUND");
    return { ok: true, campaign: row, message: "تمت أرشفة الحملة" };
  }
  if (action === "release_campaign") {
    if (!hasPermission(user, "marketing.campaigns.release")) throw new MarketingError(403, "لا توجد لديك صلاحية تحرير الحملة للنشر", "FORBIDDEN");
    return sql.begin(async (tx) => {
      const [row] = await tx<any[]>`select *,id::text from marketing.campaigns where id=${id}::uuid and is_deleted=false for update`;
      if (!row) throw new MarketingError(404, "الحملة غير موجودة", "CAMPAIGN_NOT_FOUND");
      const result = await recalculateCampaign(tx, id);
      if (Number(result.campaign.progress_percent || 0) < 100) throw new MarketingError(409, "لا يمكن تحرير الحملة قبل اكتمال جميع المتطلبات", "CAMPAIGN_NOT_READY");
      const [updated] = await tx<any[]>`update marketing.campaigns set released_at=now(),status='completed',updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${id}::uuid returning *,id::text`;
      return { ok: true, campaign: updated, message: "تم تحرير الحملة للنشر" };
    });
  }
  if (action === "delete_campaign") {
    if (!isAdmin(user)) throw new MarketingError(403, "الحذف متاح للأدمن فقط", "FORBIDDEN");
    const [row] = await sql<any[]>`update marketing.campaigns set is_deleted=true,status='archived',archived_at=now(),updated_by=${user.id}::uuid,updated_at=now() where id=${id}::uuid and is_deleted=false returning id::text`;
    if (!row) throw new MarketingError(404, "الحملة غير موجودة", "CAMPAIGN_NOT_FOUND");
    return { ok: true, message: "تم حذف الحملة من العرض" };
  }
  throw new MarketingError(400, "إجراء الحملة غير مدعوم", "INVALID_ACTION");
}
