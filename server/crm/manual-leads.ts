import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, branchForDepartment, calculateLeadCompletion, chooseAssignment, chooseCallCenterAssignment, clean, departmentCodeFromKey, departmentKey, isCrmManager, normalizePhone, parseBody, requireCrmUser, resolveSourceName } from "../_crm-utils.js";
import { getSql } from "../_db.js";
import { getCustomerFieldDefinitions } from "../_crm-customer-fields.js";
import { attachLeadToContactAndOpenRequest } from "../_crm-lifecycle.js";

function boundedInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function registeredDate(value: unknown) {
  const date = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  const sql = getSql();

  if (request.method === "GET") {
    const q = clean(request.query.q);
    const status = clean(request.query.status);
    const page = boundedInt(request.query.page, 1, 1, 100000);
    const pageSize = boundedInt(request.query.pageSize, 100, 10, 200);
    const offset = (page - 1) * pageSize;
    const [countRow] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from crm.manual_lead_requests r
      left join core.users sales on sales.id=r.requested_assigned_to
      where r.is_deleted=false
        and (${status || null}::text is null or r.approval_status=${status || null})
        and (${q || null}::text is null or concat_ws(' ',r.customer_name,r.phone,r.source_code,r.car_name,sales.full_name) ilike ${q ? `%${q}%` : null})
        and (${isCrmManager(user)}::boolean or r.requested_by=${user.id}::uuid)
    `;
    const rows = await sql<any[]>`
      select r.*,r.id::text,r.requested_by::text,r.reviewed_by::text,r.duplicate_lead_id::text,r.created_lead_id::text,
        req.full_name as requested_by_name,rev.full_name as reviewed_by_name,sales.full_name as requested_assigned_name,cc.full_name as requested_call_center_name,
        dup.customer_name as duplicate_customer_name,dup.status_label as duplicate_status,src.name as source_name
      from crm.manual_lead_requests r
      left join core.users req on req.id=r.requested_by
      left join core.users rev on rev.id=r.reviewed_by
      left join core.users sales on sales.id=r.requested_assigned_to
      left join core.users cc on cc.id=r.requested_call_center_to
      left join crm.leads dup on dup.id=r.duplicate_lead_id
      left join core.sources src on src.code=r.source_code
      where r.is_deleted=false
        and (${status || null}::text is null or r.approval_status=${status || null})
        and (${q || null}::text is null or concat_ws(' ',r.customer_name,r.phone,r.source_code,r.car_name,sales.full_name) ilike ${q ? `%${q}%` : null})
        and (${isCrmManager(user)}::boolean or r.requested_by=${user.id}::uuid)
      order by r.created_at desc
      limit ${pageSize} offset ${offset}
    `;
    return response.status(200).json({ ok: true, rows, total: Number(countRow?.count || 0), page, pageSize });
  }

  if (request.method === "POST") {
    const body = parseBody(request);
    const customerName = clean(body.customerName);
    const phone = clean(body.phone);
    const phoneNormalized = normalizePhone(phone);
    if (!customerName) return response.status(400).json({ ok: false, error: "اسم العميل مطلوب" });
    if (!phoneNormalized) return response.status(400).json({ ok: false, error: "اكتب رقم جوال سعودي صحيح" });
    const serviceKey = departmentKey(body.serviceKey || body.paymentType || "cash");
    const departmentCode = departmentCodeFromKey(serviceKey);
    const branchCode = clean(body.branchCode) || branchForDepartment(serviceKey);
    const [duplicate] = await sql<any[]>`select id::text,customer_name from crm.leads where phone_normalized=${phoneNormalized} and is_deleted=false limit 1`;
    const status = duplicate ? "pending" : "approved";
    const sourceCode = clean(body.sourceCode || "branch");
    const sourceName = await resolveSourceName(sourceCode);
    let assignedTo = clean(body.assignedTo) || null;
    let callCenterTo = clean(body.callCenterAssignedTo) || null;
    if (!assignedTo) assignedTo = (await chooseAssignment(serviceKey, branchCode, sourceCode)).assignedTo;
    if (serviceKey === "finance" && !callCenterTo) callCenterTo = (await chooseCallCenterAssignment(sourceCode, branchCode || "online")).assignedTo;
    const registeredAt = registeredDate(body.registeredAt);

    const [requestRow] = await sql<any[]>`
      insert into crm.manual_lead_requests(customer_name,phone,phone_normalized,source_code,payment_type,service_key,department_code,branch_code,car_name,car_category,car_model,color,finance_type,registered_at,location,notes,requested_assigned_to,requested_call_center_to,duplicate_lead_id,approval_status,requested_by)
      values (${customerName},${phone},${phoneNormalized},${sourceCode},${clean(body.paymentType)},${serviceKey},${departmentCode},${branchCode || null},${clean(body.carName) || null},${clean(body.carCategory) || null},${clean(body.carModel) || null},${clean(body.color) || null},${clean(body.financeType) || null},case when ${registeredAt}::date is null then now() else (${registeredAt}::date::timestamp at time zone 'Asia/Riyadh') end,${clean(body.location) || null},${clean(body.notes) || null},${assignedTo}::uuid,${callCenterTo}::uuid,${duplicate?.id || null}::uuid,${status},${user.id}::uuid)
      returning *,id::text
    `;

    if (!duplicate) {
      const customerFields = await getCustomerFieldDefinitions();
      const completionPercent = calculateLeadCompletion({ customerName, phone, sourceCode, statusLabel: "عميل جديد", serviceKey, location: clean(body.location), carName: clean(body.carName), carCategory: clean(body.carCategory), carModel: clean(body.carModel), color: clean(body.color), financeType: clean(body.financeType) }, customerFields);
      const [lead] = await sql<any[]>`
        insert into crm.leads(customer_name,phone,phone_normalized,source_code,source_name,service_key,department_code,branch_code,status_label,payment_type,car_name,car_category,car_model,color,finance_type,location,notes,assigned_to,call_center_assigned_to,created_by,updated_by,registered_at,completion_percent)
        values (${customerName},${phone},${phoneNormalized},${sourceCode},${sourceName},${serviceKey},${departmentCode},${branchCode || null},'عميل جديد',${clean(body.paymentType) || (serviceKey === "finance" ? "تمويل" : serviceKey === "service" ? "خدمة عملاء" : "كاش")},${clean(body.carName) || null},${clean(body.carCategory) || null},${clean(body.carModel) || null},${clean(body.color) || null},${clean(body.financeType) || null},${clean(body.location) || null},${clean(body.notes) || null},${assignedTo}::uuid,${callCenterTo}::uuid,${user.id}::uuid,${user.id}::uuid,case when ${registeredAt}::date is null then now() else (${registeredAt}::date::timestamp at time zone 'Asia/Riyadh') end,${completionPercent}) returning id::text
      `;
      await sql`update crm.manual_lead_requests set created_lead_id=${lead.id}::uuid,reviewed_by=${user.id}::uuid,reviewed_at=now(),updated_at=now() where id=${requestRow.id}::uuid`;
      await attachLeadToContactAndOpenRequest({ leadId: lead.id, actor: user, classificationMethod: "manual" });
      await sql`insert into crm.lead_events(lead_id,event_type,new_status,new_department,new_branch,actor_id,actor_name,note) values (${lead.id}::uuid,'manual_lead_created','عميل جديد',${departmentCode},${branchCode || null},${user.id}::uuid,${user.fullName},'إضافة عميل يدوي')`;
    }
    await audit(user, "manual_lead_requested", "manual_lead_request", requestRow.id, requestRow);
    return response.status(201).json({ ok: true, row: requestRow, duplicate: duplicate || null, approvalStatus: status });
  }

  if (request.method === "PATCH") {
    const body = parseBody(request);
    const id = clean(body.id);
    const action = clean(body.action);
    const [row] = await sql<any[]>`select *,id::text,duplicate_lead_id::text,created_lead_id::text,requested_by::text from crm.manual_lead_requests where id=${id}::uuid and is_deleted=false`;
    if (!row) return response.status(404).json({ ok: false, error: "الطلب غير موجود" });

    if (action === "edit") {
      if (!isCrmManager(user) && row.requested_by !== user.id) return response.status(403).json({ ok: false, error: "غير مسموح بتعديل هذا العميل" });
      const customerName = clean(body.customerName);
      const phone = clean(body.phone);
      const phoneNormalized = normalizePhone(phone);
      if (!customerName || !phoneNormalized) return response.status(400).json({ ok: false, error: "اسم العميل ورقم الجوال الصحيح مطلوبان" });
      const serviceKey = departmentKey(body.serviceKey || body.paymentType || row.service_key || "cash");
      const departmentCode = departmentCodeFromKey(serviceKey);
      const branchCode = clean(body.branchCode) || branchForDepartment(serviceKey);
      const sourceCode = clean(body.sourceCode || row.source_code || "branch");
      const sourceName = await resolveSourceName(sourceCode);
      const registeredAt = registeredDate(body.registeredAt);
      const [duplicate] = await sql<any[]>`
        select id::text,customer_name from crm.leads
        where phone_normalized=${phoneNormalized} and is_deleted=false and id<>coalesce(${row.created_lead_id || null}::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
        limit 1
      `;
      if (row.created_lead_id && duplicate) return response.status(409).json({ ok: false, error: "رقم الجوال مرتبط بعميل آخر، لا يمكن دمج العميل من شاشة التعديل" });
      const submittedAssignedTo = clean(body.assignedTo);
      const submittedCallCenterTo = clean(body.callCenterAssignedTo);
      const assignedChanged = submittedAssignedTo !== clean(row.requested_assigned_to);
      const callCenterChanged = submittedCallCenterTo !== clean(row.requested_call_center_to) || serviceKey !== row.service_key;
      const departmentChanged = departmentCode !== row.department_code;
      let assignedTo = assignedChanged ? submittedAssignedTo || null : row.requested_assigned_to || null;
      let callCenterTo = callCenterChanged ? submittedCallCenterTo || null : row.requested_call_center_to || null;
      if (assignedChanged && !assignedTo) assignedTo = (await chooseAssignment(serviceKey, branchCode, sourceCode)).assignedTo;
      if (serviceKey === "finance" && callCenterChanged && !callCenterTo) callCenterTo = (await chooseCallCenterAssignment(sourceCode, branchCode || "online")).assignedTo;
      if (serviceKey !== "finance") callCenterTo = null;

      await sql.begin(async (tx) => {
        await tx`
          update crm.manual_lead_requests set customer_name=${customerName},phone=${phone},phone_normalized=${phoneNormalized},source_code=${sourceCode},payment_type=${clean(body.paymentType)},service_key=${serviceKey},department_code=${departmentCode},branch_code=${branchCode || null},car_name=${clean(body.carName) || null},car_category=${clean(body.carCategory) || null},car_model=${clean(body.carModel) || null},color=${clean(body.color) || null},finance_type=${clean(body.financeType) || null},registered_at=case when ${registeredAt}::date is null then registered_at else (${registeredAt}::date::timestamp at time zone 'Asia/Riyadh') end,location=${clean(body.location) || null},notes=${clean(body.notes) || null},requested_assigned_to=${assignedTo}::uuid,requested_call_center_to=${callCenterTo}::uuid,duplicate_lead_id=${duplicate?.id || null}::uuid,approval_status=case when ${Boolean(duplicate)} then 'pending' else approval_status end,updated_at=now()
          where id=${id}::uuid
        `;
        if (row.created_lead_id) {
          const customerFields = await getCustomerFieldDefinitions();
          const completionPercent = calculateLeadCompletion({ customerName, phone, sourceCode, statusLabel: "عميل جديد", serviceKey, location: clean(body.location), carName: clean(body.carName), carCategory: clean(body.carCategory), carModel: clean(body.carModel), color: clean(body.color), financeType: clean(body.financeType) }, customerFields);
          await tx`
            update crm.leads set customer_name=${customerName},phone=${phone},phone_normalized=${phoneNormalized},source_code=${sourceCode},source_name=${sourceName},service_key=${serviceKey},department_code=${departmentCode},branch_code=${branchCode || null},status_label=case when ${departmentChanged} then 'عميل جديد' else status_label end,status_code=case when ${departmentChanged} then null else status_code end,payment_type=${clean(body.paymentType)},car_name=${clean(body.carName) || null},car_category=${clean(body.carCategory) || null},car_model=${clean(body.carModel) || null},color=${clean(body.color) || null},finance_type=${clean(body.financeType) || null},registered_at=case when ${registeredAt}::date is null then registered_at else (${registeredAt}::date::timestamp at time zone 'Asia/Riyadh') end,location=${clean(body.location) || null},notes=${clean(body.notes) || null},assigned_to=case when ${assignedChanged} then ${assignedTo}::uuid else assigned_to end,call_center_assigned_to=case when ${serviceKey}<>'finance' then null when ${callCenterChanged} then ${callCenterTo}::uuid else call_center_assigned_to end,completion_percent=${completionPercent},updated_by=${user.id}::uuid,updated_at=now()
            where id=${row.created_lead_id}::uuid
          `;
        }
      });

      if (!row.created_lead_id && !duplicate) {
        if (!assignedTo) assignedTo = (await chooseAssignment(serviceKey, branchCode, sourceCode)).assignedTo;
        if (serviceKey === "finance" && !callCenterTo) callCenterTo = (await chooseCallCenterAssignment(sourceCode, branchCode || "online")).assignedTo;
        const customerFields = await getCustomerFieldDefinitions();
        const completionPercent = calculateLeadCompletion({ customerName, phone, sourceCode, statusLabel: "عميل جديد", serviceKey, location: clean(body.location), carName: clean(body.carName), carCategory: clean(body.carCategory), carModel: clean(body.carModel), color: clean(body.color), financeType: clean(body.financeType) }, customerFields);
        const [lead] = await sql<any[]>`
          insert into crm.leads(customer_name,phone,phone_normalized,source_code,source_name,service_key,department_code,branch_code,status_label,payment_type,car_name,car_category,car_model,color,finance_type,location,notes,assigned_to,call_center_assigned_to,created_by,updated_by,registered_at,completion_percent)
          values (${customerName},${phone},${phoneNormalized},${sourceCode},${sourceName},${serviceKey},${departmentCode},${branchCode || null},'عميل جديد',${clean(body.paymentType)},${clean(body.carName) || null},${clean(body.carCategory) || null},${clean(body.carModel) || null},${clean(body.color) || null},${clean(body.financeType) || null},${clean(body.location) || null},${clean(body.notes) || null},${assignedTo}::uuid,${callCenterTo}::uuid,${user.id}::uuid,${user.id}::uuid,case when ${registeredAt}::date is null then now() else (${registeredAt}::date::timestamp at time zone 'Asia/Riyadh') end,${completionPercent}) returning id::text
        `;
        await sql`update crm.manual_lead_requests set approval_status='approved',created_lead_id=${lead.id}::uuid,requested_assigned_to=${assignedTo}::uuid,requested_call_center_to=${callCenterTo}::uuid,reviewed_by=${user.id}::uuid,reviewed_at=now(),updated_at=now() where id=${id}::uuid`;
        await attachLeadToContactAndOpenRequest({ leadId: lead.id, actor: user, classificationMethod: "manual_edit" });
      }
      if (row.created_lead_id && departmentChanged) {
        await sql`insert into crm.lead_events(lead_id,event_type,old_status,new_status,old_department,new_department,old_branch,new_branch,actor_id,actor_name,actor_role,note) values (${row.created_lead_id}::uuid,'department_transfer',null,'عميل جديد',${row.department_code || null},${departmentCode},${row.branch_code || null},${branchCode || null},${user.id}::uuid,${user.fullName},${user.roles.join("، ") || null},'تعديل قسم العميل من صفحة الإضافة اليدوية')`;
      }
      const after = { ...body, phoneNormalized, serviceKey, departmentCode, branchCode, assignedTo, callCenterTo, assignedChanged, callCenterChanged };
      await audit(user, "manual_lead_edited", "manual_lead_request", id, after, row);
      return response.status(200).json({ ok: true });
    }

    if (!isCrmManager(user)) return response.status(403).json({ ok: false, error: "اعتماد الطلبات متاح للإدارة فقط" });
    if (action === "reject") {
      await sql`update crm.manual_lead_requests set approval_status='rejected',approval_note=${clean(body.note) || null},reviewed_by=${user.id}::uuid,reviewed_at=now(),updated_at=now() where id=${id}::uuid`;
      await audit(user, "manual_duplicate_rejected", "manual_lead_request", id, { note: clean(body.note) });
      return response.status(200).json({ ok: true });
    }
    if (action !== "approve") return response.status(400).json({ ok: false, error: "الإجراء غير صحيح" });
    const targetId = clean(body.targetLeadId) || row.duplicate_lead_id;
    if (!targetId) return response.status(400).json({ ok: false, error: "العميل الأصلي غير موجود" });
    const [lead] = await sql<any[]>`
      update crm.leads set
        customer_name=coalesce(nullif(${row.customer_name},''),customer_name),phone=${row.phone},phone_normalized=${row.phone_normalized},
        source_history=coalesce(source_history,'[]'::jsonb) || ${sql.json([{ source: row.source_code, at: new Date().toISOString() }])}::jsonb,
        car_name=coalesce(nullif(${row.car_name},''),car_name),car_category=coalesce(nullif(${row.car_category},''),car_category),car_model=coalesce(nullif(${row.car_model},''),car_model),color=coalesce(nullif(${row.color},''),color),finance_type=coalesce(nullif(${row.finance_type},''),finance_type),location=coalesce(nullif(${row.location},''),location),
        registered_at=coalesce(${row.registered_at}::timestamptz,registered_at),notes=concat_ws(E'\n',notes,${row.notes || null}),
        assigned_to=coalesce(${clean(body.assignedTo) || row.requested_assigned_to}::uuid,assigned_to),call_center_assigned_to=coalesce(${clean(body.callCenterAssignedTo) || row.requested_call_center_to}::uuid,call_center_assigned_to),
        updated_by=${user.id}::uuid,updated_at=now()
      where id=${targetId}::uuid returning id::text
    `;
    await sql`update crm.manual_lead_requests set approval_status='approved',approval_note=${clean(body.note) || null},reviewed_by=${user.id}::uuid,reviewed_at=now(),created_lead_id=${targetId}::uuid,updated_at=now() where id=${id}::uuid`;
    await attachLeadToContactAndOpenRequest({ leadId: targetId, actor: user, classificationMethod: "manual_duplicate" });
    await sql`insert into crm.lead_events(lead_id,event_type,actor_id,actor_name,note,details) values (${targetId}::uuid,'manual_duplicate_approved',${user.id}::uuid,${user.fullName},'تمت الموافقة وتحديث العميل الأصلي بدون تكرار',${sql.json({ requestId: id })})`;
    await audit(user, "manual_duplicate_approved", "manual_lead_request", id, { targetId });
    return response.status(200).json({ ok: true, leadId: lead?.id || targetId });
  }

  if (request.method === "DELETE") {
    const body = parseBody(request);
    const id = clean(body.id || request.query.id);
    if (!id) return response.status(400).json({ ok: false, error: "رقم السجل مطلوب" });
    const [before] = await sql<any[]>`select *,id::text from crm.manual_lead_requests where id=${id}::uuid and is_deleted=false and (${isCrmManager(user)}::boolean or requested_by=${user.id}::uuid)`;
    if (!before) return response.status(404).json({ ok: false, error: "السجل غير موجود أو لا توجد صلاحية لمسحه" });
    await sql`update crm.manual_lead_requests set is_deleted=true,deleted_by=${user.id}::uuid,deleted_at=now(),updated_at=now() where id=${id}::uuid`;
    await audit(user, "manual_lead_request_deleted", "manual_lead_request", id, { isDeleted: true }, before);
    return response.status(200).json({ ok: true, softDeleted: true });
  }
  return response.status(405).json({ ok: false, error: "Method not allowed" });
}
