import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, branchForDepartment, calculateLeadCompletion, clean, isCrmManager, normalizePhone, parseBody, requireCrmUser, resolveSourceName } from "../_crm-utils.js";
import { getSql } from "../_db.js";
import { getCustomerFieldDefinitions } from "../_crm-customer-fields.js";
import { attachLeadToContactAndOpenRequest } from "../_crm-lifecycle.js";

function boundedInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function serviceKeyForDepartment(departmentCode: string) {
  if (departmentCode === "finance_sales") return "finance";
  if (departmentCode === "customer_service") return "service";
  return "cash";
}

function paymentTypeForService(serviceKey: string) {
  if (serviceKey === "finance") return "تمويل";
  if (serviceKey === "service") return "خدمة عملاء";
  return "كاش";
}

async function manualLeadOwnerContext(sql: ReturnType<typeof getSql>, userId: string) {
  const [row] = await sql<any[]>`
    select department.code as department_code, branch.code as branch_code
    from core.users u
    left join lateral (
      select d.code
      from core.user_departments ud
      join core.departments d on d.id = ud.department_id and d.is_active = true
      where ud.user_id = u.id
        and d.code in ('cash_sales','finance_sales','customer_service')
      order by ud.is_primary desc, d.name
      limit 1
    ) department on true
    left join lateral (
      select b.code
      from core.user_branches ub
      join core.branches b on b.id = ub.branch_id and b.is_active = true
      where ub.user_id = u.id
      order by ub.is_primary desc, b.sort_order, b.name
      limit 1
    ) branch on true
    where u.id = ${userId}::uuid
  `;
  const departmentCode = clean(row?.department_code);
  if (!departmentCode) return null;
  const serviceKey = serviceKeyForDepartment(departmentCode);
  const branchCode = clean(row?.branch_code) || branchForDepartment(serviceKey);
  if (!branchCode) return null;
  return {
    serviceKey,
    departmentCode,
    branchCode,
    paymentType: paymentTypeForService(serviceKey),
  };
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

    const owner = await manualLeadOwnerContext(sql, user.id);
    if (!owner) {
      return response.status(400).json({ ok: false, error: "يجب ربط المستخدم بقسم مبيعات وفرع أساسي قبل إضافة عميل جديد" });
    }

    const { serviceKey, departmentCode, branchCode, paymentType } = owner;
    const [duplicate] = await sql<any[]>`select id::text,customer_name from crm.leads where phone_normalized=${phoneNormalized} and is_deleted=false limit 1`;
    const approvalStatus = duplicate ? "pending" : "approved";
    const sourceCode = clean(body.sourceCode || "branch");
    const sourceName = await resolveSourceName(sourceCode);
    const assignedTo = user.id;
    const callCenterTo = null;

    const [requestRow] = await sql<any[]>`
      insert into crm.manual_lead_requests(customer_name,phone,phone_normalized,source_code,payment_type,service_key,department_code,branch_code,car_name,car_category,car_model,color,finance_type,registered_at,location,notes,requested_assigned_to,requested_call_center_to,duplicate_lead_id,approval_status,requested_by)
      values (${customerName},${phone},${phoneNormalized},${sourceCode},${paymentType},${serviceKey},${departmentCode},${branchCode},${clean(body.carName) || null},${clean(body.carCategory) || null},${clean(body.carModel) || null},${clean(body.color) || null},${clean(body.financeType) || null},now(),${clean(body.location) || null},${clean(body.notes) || null},${assignedTo}::uuid,${callCenterTo}::uuid,${duplicate?.id || null}::uuid,${approvalStatus},${user.id}::uuid)
      returning *,id::text
    `;

    if (!duplicate) {
      const customerFields = await getCustomerFieldDefinitions();
      const completionPercent = calculateLeadCompletion({ customerName, phone, sourceCode, statusLabel: "عميل جديد", serviceKey, location: clean(body.location), carName: clean(body.carName), carCategory: clean(body.carCategory), carModel: clean(body.carModel), color: clean(body.color), financeType: clean(body.financeType) }, customerFields);
      const [lead] = await sql<any[]>`
        insert into crm.leads(customer_name,phone,phone_normalized,source_code,source_name,service_key,department_code,branch_code,status_label,payment_type,car_name,car_category,car_model,color,finance_type,location,notes,assigned_to,call_center_assigned_to,created_by,updated_by,registered_at,completion_percent)
        values (${customerName},${phone},${phoneNormalized},${sourceCode},${sourceName},${serviceKey},${departmentCode},${branchCode},'عميل جديد',${paymentType},${clean(body.carName) || null},${clean(body.carCategory) || null},${clean(body.carModel) || null},${clean(body.color) || null},${clean(body.financeType) || null},${clean(body.location) || null},${clean(body.notes) || null},${assignedTo}::uuid,${callCenterTo}::uuid,${user.id}::uuid,${user.id}::uuid,now(),${completionPercent}) returning id::text
      `;
      await sql`update crm.manual_lead_requests set created_lead_id=${lead.id}::uuid,reviewed_by=${user.id}::uuid,reviewed_at=now(),updated_at=now() where id=${requestRow.id}::uuid`;
      await attachLeadToContactAndOpenRequest({ leadId: lead.id, actor: user, classificationMethod: "manual" });
      await sql`insert into crm.lead_events(lead_id,event_type,new_status,new_department,new_branch,actor_id,actor_name,note) values (${lead.id}::uuid,'manual_lead_created','عميل جديد',${departmentCode},${branchCode},${user.id}::uuid,${user.fullName},'إضافة عميل يدوي')`;
    }
    await audit(user, "manual_lead_requested", "manual_lead_request", requestRow.id, requestRow);
    return response.status(201).json({ ok: true, row: requestRow, duplicate: duplicate || null, approvalStatus });
  }

  if (request.method === "PATCH") {
    const body = parseBody(request);
    const id = clean(body.id);
    const action = clean(body.action);
    const [row] = await sql<any[]>`select *,id::text,duplicate_lead_id::text,created_lead_id::text,requested_by::text,requested_assigned_to::text,requested_call_center_to::text from crm.manual_lead_requests where id=${id}::uuid and is_deleted=false`;
    if (!row) return response.status(404).json({ ok: false, error: "الطلب غير موجود" });

    if (action === "edit") {
      if (!isCrmManager(user) && row.requested_by !== user.id) return response.status(403).json({ ok: false, error: "غير مسموح بتعديل هذا العميل" });
      const customerName = clean(body.customerName);
      const phone = clean(body.phone);
      const phoneNormalized = normalizePhone(phone);
      if (!customerName || !phoneNormalized) return response.status(400).json({ ok: false, error: "اسم العميل ورقم الجوال الصحيح مطلوبان" });

      const serviceKey = clean(row.service_key) || "cash";
      const departmentCode = clean(row.department_code) || (serviceKey === "finance" ? "finance_sales" : serviceKey === "service" ? "customer_service" : "cash_sales");
      const branchCode = clean(row.branch_code) || branchForDepartment(serviceKey);
      const paymentType = clean(row.payment_type) || paymentTypeForService(serviceKey);
      const assignedTo = clean(row.requested_assigned_to) || clean(row.requested_by);
      const callCenterTo = clean(row.requested_call_center_to) || null;
      const sourceCode = clean(body.sourceCode || row.source_code || "branch");
      const sourceName = await resolveSourceName(sourceCode);
      const [duplicate] = await sql<any[]>`
        select id::text,customer_name from crm.leads
        where phone_normalized=${phoneNormalized} and is_deleted=false and id<>coalesce(${row.created_lead_id || null}::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
        limit 1
      `;
      if (row.created_lead_id && duplicate) return response.status(409).json({ ok: false, error: "رقم الجوال مرتبط بعميل آخر، لا يمكن دمج العميل من شاشة التعديل" });

      await sql.begin(async (tx) => {
        await tx`
          update crm.manual_lead_requests set customer_name=${customerName},phone=${phone},phone_normalized=${phoneNormalized},source_code=${sourceCode},car_name=${clean(body.carName) || null},car_category=${clean(body.carCategory) || null},car_model=${clean(body.carModel) || null},color=${clean(body.color) || null},finance_type=${clean(body.financeType) || null},location=${clean(body.location) || null},notes=${clean(body.notes) || null},duplicate_lead_id=${duplicate?.id || null}::uuid,approval_status=${duplicate ? "pending" : "approved"},updated_at=now()
          where id=${id}::uuid
        `;
        if (row.created_lead_id) {
          const customerFields = await getCustomerFieldDefinitions();
          const completionPercent = calculateLeadCompletion({ customerName, phone, sourceCode, statusLabel: "عميل جديد", serviceKey, location: clean(body.location), carName: clean(body.carName), carCategory: clean(body.carCategory), carModel: clean(body.carModel), color: clean(body.color), financeType: clean(body.financeType) }, customerFields);
          await tx`
            update crm.leads set customer_name=${customerName},phone=${phone},phone_normalized=${phoneNormalized},source_code=${sourceCode},source_name=${sourceName},car_name=${clean(body.carName) || null},car_category=${clean(body.carCategory) || null},car_model=${clean(body.carModel) || null},color=${clean(body.color) || null},finance_type=${clean(body.financeType) || null},location=${clean(body.location) || null},notes=${clean(body.notes) || null},completion_percent=${completionPercent},updated_by=${user.id}::uuid,updated_at=now()
            where id=${row.created_lead_id}::uuid
          `;
        }
      });

      if (!row.created_lead_id && !duplicate) {
        const customerFields = await getCustomerFieldDefinitions();
        const completionPercent = calculateLeadCompletion({ customerName, phone, sourceCode, statusLabel: "عميل جديد", serviceKey, location: clean(body.location), carName: clean(body.carName), carCategory: clean(body.carCategory), carModel: clean(body.carModel), color: clean(body.color), financeType: clean(body.financeType) }, customerFields);
        const [lead] = await sql<any[]>`
          insert into crm.leads(customer_name,phone,phone_normalized,source_code,source_name,service_key,department_code,branch_code,status_label,payment_type,car_name,car_category,car_model,color,finance_type,location,notes,assigned_to,call_center_assigned_to,created_by,updated_by,registered_at,completion_percent)
          values (${customerName},${phone},${phoneNormalized},${sourceCode},${sourceName},${serviceKey},${departmentCode},${branchCode || null},'عميل جديد',${paymentType},${clean(body.carName) || null},${clean(body.carCategory) || null},${clean(body.carModel) || null},${clean(body.color) || null},${clean(body.financeType) || null},${clean(body.location) || null},${clean(body.notes) || null},${assignedTo}::uuid,${callCenterTo}::uuid,${user.id}::uuid,${user.id}::uuid,coalesce(${row.registered_at}::timestamptz,now()),${completionPercent}) returning id::text
        `;
        await sql`update crm.manual_lead_requests set approval_status='approved',created_lead_id=${lead.id}::uuid,reviewed_by=${user.id}::uuid,reviewed_at=now(),updated_at=now() where id=${id}::uuid`;
        await attachLeadToContactAndOpenRequest({ leadId: lead.id, actor: user, classificationMethod: "manual_edit" });
      }
      const after = { customerName, phone, sourceCode, serviceKey, departmentCode, branchCode, paymentType, assignedTo };
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
