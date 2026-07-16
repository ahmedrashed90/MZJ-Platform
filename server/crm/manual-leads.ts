import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, branchForDepartment, calculateLeadCompletion, chooseAssignment, chooseCallCenterAssignment, clean, departmentCodeFromKey, departmentKey, isCrmManager, normalizePhone, parseBody, requireCrmUser, resolveSourceName } from "../_crm-utils.js";
import { getSql } from "../_db.js";
import { getCustomerFieldDefinitions } from "../_crm-customer-fields.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  const sql = getSql();

  if (request.method === "GET") {
    const q = clean(request.query.q);
    const status = clean(request.query.status);
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
      where (${status || null}::text is null or r.approval_status=${status || null})
        and (${q || null}::text is null or concat_ws(' ',r.customer_name,r.phone,r.source_code,r.car_name,sales.full_name) ilike ${q ? `%${q}%` : null})
        and (${isCrmManager(user)}::boolean or r.requested_by=${user.id}::uuid)
      order by r.created_at desc limit 500
    `;
    return response.status(200).json({ ok: true, rows });
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

    const [requestRow] = await sql<any[]>`
      insert into crm.manual_lead_requests(customer_name,phone,phone_normalized,source_code,payment_type,service_key,department_code,branch_code,car_name,location,notes,requested_assigned_to,requested_call_center_to,duplicate_lead_id,approval_status,requested_by)
      values (${customerName},${phone},${phoneNormalized},${sourceCode},${clean(body.paymentType)},${serviceKey},${departmentCode},${branchCode || null},${clean(body.carName) || null},${clean(body.location) || null},${clean(body.notes) || null},${assignedTo}::uuid,${callCenterTo}::uuid,${duplicate?.id || null}::uuid,${status},${user.id}::uuid)
      returning *,id::text
    `;

    if (!duplicate) {
      const customerFields = await getCustomerFieldDefinitions();
      const completionPercent = calculateLeadCompletion({ customerName, phone, sourceCode, statusLabel: 'عميل جديد', serviceKey, location: clean(body.location), carName: clean(body.carName) }, customerFields);
      const [lead] = await sql<any[]>`
        insert into crm.leads(customer_name,phone,phone_normalized,source_code,source_name,service_key,department_code,branch_code,status_label,payment_type,car_name,location,notes,assigned_to,call_center_assigned_to,created_by,updated_by,registered_at,completion_percent)
        values (${customerName},${phone},${phoneNormalized},${sourceCode},${sourceName},${serviceKey},${departmentCode},${branchCode || null},'عميل جديد',${clean(body.paymentType) || (serviceKey==='finance'?'تمويل':serviceKey==='service'?'خدمة عملاء':'كاش')},${clean(body.carName)||null},${clean(body.location)||null},${clean(body.notes)||null},${assignedTo}::uuid,${callCenterTo}::uuid,${user.id}::uuid,${user.id}::uuid,now(),${completionPercent}) returning id::text
      `;
      await sql`update crm.manual_lead_requests set created_lead_id=${lead.id}::uuid,reviewed_by=${user.id}::uuid,reviewed_at=now(),updated_at=now() where id=${requestRow.id}::uuid`;
      await sql`
        insert into crm.conversations(legacy_id,lead_id,channel_code,customer_name,assigned_to,call_center_assigned_to,metadata)
        values (
          ${`crm-manual:${lead.id}`},${lead.id}::uuid,'whatsapp',${customerName},${assignedTo}::uuid,${callCenterTo}::uuid,
          ${sql.json({ manualEntry: true, sourceCode, sourceName })}
        )
        on conflict (legacy_id) do update set lead_id=excluded.lead_id,customer_name=excluded.customer_name,
          assigned_to=excluded.assigned_to,call_center_assigned_to=excluded.call_center_assigned_to,metadata=excluded.metadata,updated_at=now()
      `;
      await sql`insert into crm.lead_events(lead_id,event_type,new_status,new_department,new_branch,actor_id,actor_name,note) values (${lead.id}::uuid,'manual_lead_created','عميل جديد',${departmentCode},${branchCode||null},${user.id}::uuid,${user.fullName},'إضافة عميل يدوي')`;
    }
    await audit(user, "manual_lead_requested", "manual_lead_request", requestRow.id, requestRow);
    return response.status(201).json({ ok: true, row: requestRow, duplicate: duplicate || null, approvalStatus: status });
  }

  if (request.method === "PATCH") {
    if (!isCrmManager(user)) return response.status(403).json({ ok: false, error: "اعتماد الطلبات متاح للإدارة فقط" });
    const body = parseBody(request);
    const id = clean(body.id);
    const action = clean(body.action);
    const [row] = await sql<any[]>`select *,id::text,duplicate_lead_id::text from crm.manual_lead_requests where id=${id}::uuid`;
    if (!row) return response.status(404).json({ ok: false, error: "الطلب غير موجود" });
    if (action === "reject") {
      await sql`update crm.manual_lead_requests set approval_status='rejected',approval_note=${clean(body.note)||null},reviewed_by=${user.id}::uuid,reviewed_at=now(),updated_at=now() where id=${id}::uuid`;
      return response.status(200).json({ ok: true });
    }
    if (action !== "approve") return response.status(400).json({ ok: false, error: "الإجراء غير صحيح" });
    const targetId = clean(body.targetLeadId) || row.duplicate_lead_id;
    if (!targetId) return response.status(400).json({ ok: false, error: "العميل الأصلي غير موجود" });
    const [lead] = await sql<any[]>`
      update crm.leads set
        customer_name=coalesce(nullif(${row.customer_name},''),customer_name),
        phone=${row.phone},phone_normalized=${row.phone_normalized},
        source_history=coalesce(source_history,'[]'::jsonb) || ${sql.json([{ source: row.source_code, at: new Date().toISOString() }])}::jsonb,
        car_name=coalesce(nullif(${row.car_name},''),car_name),location=coalesce(nullif(${row.location},''),location),
        notes=concat_ws(E'\n',notes,${row.notes || null}),
        assigned_to=coalesce(${clean(body.assignedTo)||row.requested_assigned_to}::uuid,assigned_to),
        call_center_assigned_to=coalesce(${clean(body.callCenterAssignedTo)||row.requested_call_center_to}::uuid,call_center_assigned_to),
        updated_by=${user.id}::uuid,updated_at=now()
      where id=${targetId}::uuid returning id::text
    `;
    await sql`update crm.manual_lead_requests set approval_status='approved',approval_note=${clean(body.note)||null},reviewed_by=${user.id}::uuid,reviewed_at=now(),created_lead_id=${targetId}::uuid,updated_at=now() where id=${id}::uuid`;
    await sql`insert into crm.lead_events(lead_id,event_type,actor_id,actor_name,note,details) values (${targetId}::uuid,'manual_duplicate_approved',${user.id}::uuid,${user.fullName},'تمت الموافقة وتحديث العميل الأصلي بدون تكرار',${sql.json({ requestId:id })})`;
    return response.status(200).json({ ok: true, leadId: lead?.id || targetId });
  }

  if (request.method === "DELETE") {
    const body = parseBody(request);
    const id = clean(body.id || request.query.id);
    await sql`delete from crm.manual_lead_requests where id=${id}::uuid and (${isCrmManager(user)}::boolean or requested_by=${user.id}::uuid)`;
    return response.status(200).json({ ok: true });
  }
  return response.status(405).json({ ok: false, error: "Method not allowed" });
}
