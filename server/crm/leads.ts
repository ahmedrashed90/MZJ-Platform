import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, branchForDepartment, calculateCreditLimit, calculateLeadCompletion, chooseAssignment, chooseCallCenterAssignment, clean, departmentCodeFromKey, departmentKey, isCrmManager, normalizePhone, parseBody, positiveInt, requireCrmUser, resolveSourceName, sourceLabel, userScope } from "../_crm-utils.js";
import { getSql } from "../_db.js";
import { getCustomerFieldDefinitions, missingRequiredCustomerFields, sanitizeCustomFieldValues } from "../_crm-customer-fields.js";
import { attachLeadToContactAndOpenRequest, closeCurrentServiceRequest, recordOwnershipEvent } from "../_crm-lifecycle.js";


function riyadhNoteTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")}`;
}

function leadPayload(body: Record<string, any>) {
  const serviceKey = departmentKey(
    body.serviceKey ?? body.service_key ?? body.departmentCode ?? body.department_code ?? body.paymentType ?? body.payment_type ?? "cash",
  );
  const phone = clean(body.phone ?? body.mobile ?? body.phone_number ?? body.phoneNumber);
  const sourceCode = clean(body.sourceCode ?? body.source_code ?? body.source ?? "branch");
  const suppliedSourceName = clean(body.sourceName ?? body.source_name);
  return {
    customerName: clean(body.customerName ?? body.customer_name ?? body.name ?? body.fullName ?? body.full_name),
    phone,
    phoneNormalized: normalizePhone(phone),
    sourceCode,
    sourceName: sourceLabel(sourceCode || suppliedSourceName),
    platformCode: clean(body.platformCode ?? body.platform_code ?? body.platform),
    serviceKey,
    departmentCode: clean(body.departmentCode ?? body.department_code) || departmentCodeFromKey(serviceKey),
    branchCode: clean(body.branchCode ?? body.branch_code) || branchForDepartment(serviceKey),
    statusLabel: clean(body.statusLabel ?? body.status_label ?? body.status) || "عميل جديد",
    statusCode: clean(body.statusCode ?? body.status_code),
    paymentType: clean(body.paymentType ?? body.payment_type) || (serviceKey === "finance" ? "تمويل" : serviceKey === "service" ? "خدمة عملاء" : "كاش"),
    carName: clean(body.carName ?? body.car_name ?? body.car),
    carCategory: clean(body.carCategory ?? body.car_category ?? body.vehicleCategory ?? body.vehicle_category ?? body.carTrim ?? body.trim ?? body.variant ?? body.grade),
    location: clean(body.location ?? body.place),
    age: body.age === "" || body.age == null ? null : Number(body.age),
    salary: body.salary === "" || body.salary == null ? null : Number(body.salary),
    obligation: body.obligation === "" || body.obligation == null ? null : Number(body.obligation),
    salaryBank: clean(body.salaryBank ?? body.salary_bank ?? body.bank),
    carModel: clean(body.carModel ?? body.car_model ?? body.model),
    carType: clean(body.carType ?? body.car_type),
    color: clean(body.color),
    financeType: clean(body.financeType ?? body.finance_type),
    followUpAt: clean(body.followUpAt ?? body.follow_up_at) || null,
    campaignName: clean(body.campaignName ?? body.campaign_name),
    campaignDate: clean(body.campaignDate ?? body.campaign_date) || null,
    notes: clean(body.notes),
    statusNote: clean(body.statusNote ?? body.status_note),
    assignedTo: clean(body.assignedTo ?? body.assigned_to) || null,
    callCenterAssignedTo: clean(body.callCenterAssignedTo ?? body.call_center_assigned_to) || null,
    extraData: body.customFields ?? body.extraData ?? body.extra_data ?? {},
  };
}

async function list(request: VercelRequest, response: VercelResponse, user: any) {
  const sql = getSql();
  const scope = userScope(user);
  const q = clean(request.query.q);
  const source = clean(request.query.source);
  const status = clean(request.query.status);
  const department = clean(request.query.department);
  const branch = clean(request.query.branch);
  const agent = clean(request.query.agent);
  const callCenter = clean(request.query.callCenter);
  const payment = clean(request.query.payment);
  const car = clean(request.query.car);
  const campaign = clean(request.query.campaign);
  const from = clean(request.query.from);
  const to = clean(request.query.to);
  const limit = positiveInt(request.query.limit, 100, 500);
  const offset = Math.max(0, Number(request.query.offset || 0) || 0);

  const customerFields = await getCustomerFieldDefinitions();

  const rows = await sql<any[]>`
    select l.*, l.id::text, l.assigned_to::text, l.call_center_assigned_to::text,
      sales.full_name as assigned_name, cc.full_name as call_center_name,
      b.name as branch_name, src.name as catalog_source_name,
      coalesce(c.id::text, '') as conversation_id, c.legacy_id as conversation_legacy_id, c.channel_code, c.preview_text,
      greatest(coalesce(l.unread_count,0),coalesce(c.unread_count,0))::int as unread_count,
      greatest(l.last_message_at,c.last_message_at) as last_message_at
    from crm.leads l
    left join core.sources src on src.code = l.source_code
    left join core.users sales on sales.id = l.assigned_to
    left join core.users cc on cc.id = l.call_center_assigned_to
    left join core.branches b on b.code = l.branch_code
    left join lateral (
      select * from crm.conversations cx where cx.lead_id = l.id order by cx.last_message_at desc nulls last limit 1
    ) c on true
    where l.is_deleted = false
      and (
        ${scope.all}::boolean
        or (${scope.callCenterOnly}::boolean and l.call_center_assigned_to = ${scope.userId}::uuid)
        or (not ${scope.callCenterOnly}::boolean and (l.assigned_to = ${scope.userId}::uuid or l.call_center_assigned_to = ${scope.userId}::uuid))
        or (l.department_code = any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code = any(${scope.branchCodes}::text[])))
      )
      and (${q || null}::text is null or concat_ws(' ', l.customer_name,l.phone,l.phone_normalized,l.car_name,l.car_category,l.source_name,l.campaign_name,l.notes) ilike ${q ? `%${q}%` : null})
      and (${source || null}::text is null or l.source_code = ${source || null} or l.source_name = ${source || null})
      and (${status || null}::text is null or l.status_label = ${status || null})
      and (${department || null}::text is null or l.department_code = ${department || null} or l.service_key = ${department || null})
      and (${branch || null}::text is null or l.branch_code = ${branch || null})
      and (${agent || null}::uuid is null or l.assigned_to = ${agent || null}::uuid)
      and (${callCenter || null}::uuid is null or l.call_center_assigned_to = ${callCenter || null}::uuid)
      and (${payment || null}::text is null or l.payment_type = ${payment || null})
      and (${car || null}::text is null or l.car_name = ${car || null})
      and (${campaign || null}::text is null or l.campaign_name = ${campaign || null})
      and (${from || null}::date is null or (coalesce(l.registered_at,l.created_at) at time zone 'Asia/Riyadh')::date >= ${from || null}::date)
      and (${to || null}::date is null or (coalesce(l.registered_at,l.created_at) at time zone 'Asia/Riyadh')::date <= ${to || null}::date)
    order by l.updated_at desc, l.created_at desc
    limit ${limit} offset ${offset}
  `;

  const [count] = await sql<{ total: number }[]>`
    select count(*)::int as total from crm.leads l
    where l.is_deleted = false
      and (
        ${scope.all}::boolean
        or (${scope.callCenterOnly}::boolean and l.call_center_assigned_to = ${scope.userId}::uuid)
        or (not ${scope.callCenterOnly}::boolean and (l.assigned_to = ${scope.userId}::uuid or l.call_center_assigned_to = ${scope.userId}::uuid))
        or (l.department_code = any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code = any(${scope.branchCodes}::text[])))
      )
      and (${q || null}::text is null or concat_ws(' ', l.customer_name,l.phone,l.phone_normalized,l.car_name,l.car_category,l.source_name,l.campaign_name,l.notes) ilike ${q ? `%${q}%` : null})
      and (${source || null}::text is null or l.source_code = ${source || null} or l.source_name = ${source || null})
      and (${status || null}::text is null or l.status_label = ${status || null})
      and (${department || null}::text is null or l.department_code = ${department || null} or l.service_key = ${department || null})
      and (${branch || null}::text is null or l.branch_code = ${branch || null})
      and (${agent || null}::uuid is null or l.assigned_to = ${agent || null}::uuid)
      and (${callCenter || null}::uuid is null or l.call_center_assigned_to = ${callCenter || null}::uuid)
      and (${payment || null}::text is null or l.payment_type = ${payment || null})
      and (${car || null}::text is null or l.car_name = ${car || null})
      and (${campaign || null}::text is null or l.campaign_name = ${campaign || null})
      and (${from || null}::date is null or (coalesce(l.registered_at,l.created_at) at time zone 'Asia/Riyadh')::date >= ${from || null}::date)
      and (${to || null}::date is null or (coalesce(l.registered_at,l.created_at) at time zone 'Asia/Riyadh')::date <= ${to || null}::date)
  `;
  for (const row of rows) {
    row.source_name = row.catalog_source_name || sourceLabel(row.source_code || row.source_name);
    row.completion_percent = calculateLeadCompletion(row, customerFields);
    delete row.catalog_source_name;
  }
  return response.status(200).json({ ok: true, rows, total: Number(count?.total || 0), limit, offset });
}

async function create(request: VercelRequest, response: VercelResponse, user: any) {
  const sql = getSql();
  const body = parseBody(request);
  const input = leadPayload(body);
  const customerFields = await getCustomerFieldDefinitions();
  input.extraData = sanitizeCustomFieldValues(input.extraData, customerFields);
  input.sourceName = await resolveSourceName(input.sourceCode, input.sourceName);
  if (!input.customerName) return response.status(400).json({ ok: false, error: "اسم العميل مطلوب" });
  if (!input.phoneNormalized) return response.status(400).json({ ok: false, error: "اكتب رقم جوال سعودي صحيح بصيغة 05xxxxxxxx" });
  const missingRequired = missingRequiredCustomerFields(input, customerFields);
  if (missingRequired.length) return response.status(400).json({ ok: false, error: `أكمل الحقول المطلوبة: ${missingRequired.map((field) => field.label).join("، ")}` });

  const [duplicate] = await sql<any[]>`select id::text, customer_name from crm.leads where phone_normalized = ${input.phoneNormalized} and is_deleted = false limit 1`;
  if (duplicate) return response.status(409).json({ ok: false, error: "رقم الجوال مسجل بالفعل", duplicate });

  let assignment = { assignedTo: input.assignedTo, assignedName: "", branchCode: input.branchCode };
  if (!input.assignedTo) assignment = await chooseAssignment(input.serviceKey, input.branchCode, input.sourceCode);
  let callCenter = { assignedTo: input.callCenterAssignedTo, assignedName: "" };
  if (input.serviceKey === "finance" && !input.callCenterAssignedTo) callCenter = await chooseCallCenterAssignment(input.sourceCode, input.branchCode || "online");

  const completionPercent = calculateLeadCompletion(input, customerFields);
  const credit = calculateCreditLimit(input.salary, input.obligation, input.financeType);

  const [row] = await sql<any[]>`
    insert into crm.leads(
      customer_name, phone, phone_normalized, source_code, source_name, platform_code,
      service_key, department_code, branch_code, status_code, status_label, payment_type,
      car_name, car_category, location, age, salary, obligation, salary_bank, car_model, car_type, color,
      finance_type, follow_up_at, campaign_name, campaign_date, notes, status_note, extra_data,
      assigned_to, call_center_assigned_to, created_by, updated_by, registered_at,
      responsible_name_snapshot, call_center_name_snapshot, completion_percent, credit_limit, credit_qualified
    ) values (
      ${input.customerName}, ${input.phone}, ${input.phoneNormalized}, ${input.sourceCode}, ${input.sourceName}, ${input.platformCode || null},
      ${input.serviceKey}, ${input.departmentCode}, ${assignment.branchCode || input.branchCode || null}, ${input.statusCode || null}, ${input.statusLabel}, ${input.paymentType},
      ${input.carName || null}, ${input.carCategory || null}, ${input.location || null}, ${input.age}, ${input.salary}, ${input.obligation}, ${input.salaryBank || null}, ${input.carModel || null}, ${input.carType || null}, ${input.color || null},
      ${input.financeType || null}, ${input.followUpAt}, ${input.campaignName || null}, ${input.campaignDate}, ${input.notes || null}, ${input.statusNote || null}, ${sql.json(input.extraData)},
      ${assignment.assignedTo}::uuid, ${callCenter.assignedTo}::uuid, ${user.id}::uuid, ${user.id}::uuid, now(),
      ${assignment.assignedName || null}, ${callCenter.assignedName || null}, ${completionPercent}, ${credit.amount}, ${credit.qualified}
    ) returning *, id::text, assigned_to::text, call_center_assigned_to::text
  `;
  await sql`
    insert into crm.lead_events(lead_id,event_type,new_status,new_department,new_branch,actor_id,actor_name,actor_role,note)
    values (${row.id}::uuid,'lead_created',${input.statusLabel},${input.departmentCode},${assignment.branchCode || input.branchCode || null},${user.id}::uuid,${user.fullName},${user.roles.join("، ") || null},'دخول العميل إلى النظام')
  `;
  await attachLeadToContactAndOpenRequest({ leadId: row.id, actor: user, classificationMethod: "manual" });
  row.source_name = input.sourceName;
  row.completion_percent = completionPercent;
  row.credit_limit = credit.amount;
  row.credit_qualified = credit.qualified;
  await audit(user, "lead_created", "lead", row.id, row);
  return response.status(201).json({ ok: true, row });
}

async function update(request: VercelRequest, response: VercelResponse, user: any) {
  const sql = getSql();
  const body = parseBody(request);
  const id = clean(body.id || request.query.id);
  if (!id) return response.status(400).json({ ok: false, error: "رقم العميل مطلوب" });

  const [before] = await sql<any[]>`
    select l.*, l.id::text, l.assigned_to::text, l.call_center_assigned_to::text,
      sales.full_name as assigned_name,
      cc.full_name as call_center_name
    from crm.leads l
    left join core.users sales on sales.id = l.assigned_to
    left join core.users cc on cc.id = l.call_center_assigned_to
    where l.id = ${id}::uuid and l.is_deleted = false
  `;
  if (!before) return response.status(404).json({ ok: false, error: "العميل غير موجود" });

  const scope = userScope(user);
  const canEdit = scope.all
    || before.assigned_to === user.id
    || before.call_center_assigned_to === user.id
    || (scope.departmentCodes.includes(before.department_code) && (!scope.branchCodes.length || scope.branchCodes.includes(before.branch_code)));
  if (!canEdit) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لتعديل هذا العميل" });

  const input = leadPayload({ ...before, ...body });
  const customerFields = await getCustomerFieldDefinitions();
  input.extraData = {
    ...((before.extra_data && typeof before.extra_data === "object") ? before.extra_data : {}),
    ...sanitizeCustomFieldValues(body.customFields ?? body.extraData ?? body.extra_data ?? {}, customerFields),
  };
  input.sourceName = await resolveSourceName(input.sourceCode, input.sourceName);
  const newNote = clean(body.newNote ?? body.new_note);
  if (newNote) {
    const noteEntry = `[${riyadhNoteTimestamp()}] ${newNote}`;
    input.notes = [clean(before.notes), noteEntry].filter(Boolean).join("\n\n");
  }

  const departmentChanged = clean(before.department_code) !== input.departmentCode;
  if (departmentChanged) {
    input.statusLabel = "عميل جديد";
    input.statusCode = "";
    input.paymentType = input.serviceKey === "finance" ? "تمويل" : input.serviceKey === "service" ? "خدمة عملاء" : "كاش";
  }

  if (input.phone && !input.phoneNormalized) {
    return response.status(400).json({ ok: false, error: "اكتب رقم جوال سعودي صحيح بصيغة 05xxxxxxxx" });
  }
  if (input.phoneNormalized) {
    const [duplicate] = await sql<any[]>`
      select id::text, customer_name
      from crm.leads
      where phone_normalized = ${input.phoneNormalized}
        and id <> ${id}::uuid
        and is_deleted = false
      limit 1
    `;
    if (duplicate) {
      return response.status(409).json({
        ok: false,
        error: `لا يمكن حفظ رقم الجوال لأنه مسجل عند العميل ${duplicate.customer_name || ""}`,
        duplicate,
      });
    }
  }

  const missingRequired = missingRequiredCustomerFields(input, customerFields);
  if (missingRequired.length) return response.status(400).json({ ok: false, error: `أكمل الحقول المطلوبة: ${missingRequired.map((field) => field.label).join("، ")}` });

  let assignedTo = clean(before.assigned_to) || null;
  let assignedName = clean(before.assigned_name || before.responsible_name_snapshot);
  let callCenterAssignedTo = clean(before.call_center_assigned_to) || null;
  let callCenterName = clean(before.call_center_name || before.call_center_name_snapshot);

  if (departmentChanged) {
    const assignment = await chooseAssignment(input.serviceKey, input.branchCode, input.sourceCode);
    input.branchCode = assignment.branchCode || branchForDepartment(input.serviceKey);
    assignedTo = assignment.assignedTo;
    assignedName = assignment.assignedName;

    if (input.serviceKey === "finance") {
      const callCenter = await chooseCallCenterAssignment(input.sourceCode, input.branchCode || "online");
      callCenterAssignedTo = callCenter.assignedTo;
      callCenterName = callCenter.assignedName;
    } else {
      callCenterAssignedTo = null;
      callCenterName = "";
    }
  }

  const completionPercent = calculateLeadCompletion(input, customerFields);
  const credit = calculateCreditLimit(input.salary, input.obligation, input.financeType);
  const statusChanged = clean(before.status_label) !== input.statusLabel;
  const branchChanged = clean(before.branch_code) !== input.branchCode;

  const [row] = await sql<any[]>`
    update crm.leads set
      customer_name=${input.customerName || before.customer_name},
      phone=${input.phone || null},
      phone_normalized=${input.phoneNormalized || null},
      source_code=${input.sourceCode || null},
      source_name=${input.sourceName || null},
      platform_code=${input.platformCode || null},
      service_key=${input.serviceKey},
      department_code=${input.departmentCode},
      branch_code=${input.branchCode || null},
      status_code=${input.statusCode || null},
      status_label=${input.statusLabel},
      payment_type=${input.paymentType || null},
      car_name=${input.carName || input.carType || null},
      car_category=${input.carCategory || null},
      location=${input.location || null},
      age=${input.age},
      salary=${input.salary},
      obligation=${input.obligation},
      salary_bank=${input.salaryBank || null},
      car_model=${input.carModel || null},
      car_type=${input.carType || input.carName || null},
      color=${input.color || null},
      finance_type=${input.financeType || null},
      follow_up_at=${input.followUpAt},
      notes=${input.notes || null},
      extra_data=${sql.json(input.extraData)},
      completion_percent=${completionPercent},
      credit_limit=${credit.amount},
      credit_qualified=${credit.qualified},
      assigned_to=${assignedTo}::uuid,
      call_center_assigned_to=${callCenterAssignedTo}::uuid,
      responsible_name_snapshot=${assignedName || null},
      call_center_name_snapshot=${callCenterName || null},
      updated_by=${user.id}::uuid,
      updated_at=now()
    where id=${id}::uuid
    returning *, id::text, assigned_to::text, call_center_assigned_to::text
  `;

  let lifecycleResult: any = null;
  if (statusChanged || departmentChanged || branchChanged) {
    const [event] = await sql<{ id: number }[]>`
      insert into crm.lead_events(
        lead_id,event_type,old_status,new_status,old_department,new_department,
        old_branch,new_branch,actor_id,actor_name,actor_role,note,details
      ) values (
        ${id}::uuid,
        ${departmentChanged || branchChanged ? "department_transfer" : "status_change"},
        ${before.status_label || null},${input.statusLabel || null},
        ${before.department_code || null},${input.departmentCode || null},
        ${before.branch_code || null},${input.branchCode || null},
        ${user.id}::uuid,${user.fullName},${user.roles.join("، ") || null},
        ${clean(body.note) || null},
        ${sql.json({ source: clean(body.source) || "crm", assignedTo, assignedName, callCenterAssignedTo, callCenterName })}
      )
      returning id
    `;

    if (before.current_request_id) {
      await sql`
        update crm.service_requests set status_label=${input.statusLabel},service_key=${input.serviceKey},department_code=${input.departmentCode},
          branch_code=${input.branchCode || null},assigned_to=${assignedTo}::uuid,call_center_assigned_to=${callCenterAssignedTo}::uuid,updated_at=now()
        where id=${before.current_request_id}::uuid and request_state='open'
      `;
    }

    if (departmentChanged || branchChanged || clean(before.assigned_to) !== clean(assignedTo)) {
      await recordOwnershipEvent({
        contactId: before.contact_id || null,
        requestId: before.current_request_id || null,
        leadId: id,
        previousAssignedTo: before.assigned_to || null,
        previousAssignedName: before.assigned_name || before.responsible_name_snapshot || null,
        newAssignedTo: assignedTo,
        newAssignedName: assignedName,
        previousDepartmentCode: before.department_code,
        newDepartmentCode: input.departmentCode,
        previousBranchCode: before.branch_code,
        newBranchCode: input.branchCode,
        actor: user,
        actorType: "user",
        reason: clean(body.note) || (departmentChanged ? "تحويل العميل إلى قسم آخر" : "تغيير مسؤول أو فرع العميل"),
      });
    }

    if (statusChanged) {
      lifecycleResult = await closeCurrentServiceRequest({
        leadId: id,
        statusLabel: input.statusLabel,
        actor: user,
        reason: input.statusLabel,
      }).catch((error: any) => ({ ok: false, error: error?.message || String(error) }));
    }
  }

  row.source_name = input.sourceName;
  row.completion_percent = completionPercent;
  row.credit_limit = credit.amount;
  row.credit_qualified = credit.qualified;
  row.assigned_name = assignedName || null;
  row.call_center_name = callCenterName || null;

  await audit(user, "lead_updated", "lead", id, row, before);
  return response.status(200).json({ ok: true, row, lifecycleResult });
}

async function remove(request: VercelRequest, response: VercelResponse, user: any) {
  if (!isCrmManager(user)) return response.status(403).json({ ok: false, error: "حذف العملاء متاح للإدارة فقط" });
  const sql = getSql();
  const body = parseBody(request);
  const id = clean(body.id || request.query.id);
  const [before] = await sql<any[]>`select *, id::text from crm.leads where id=${id}::uuid and is_deleted=false`;
  if (!before) return response.status(404).json({ ok: false, error: "العميل غير موجود" });
  await sql`update crm.leads set is_deleted=true, deleted_by=${user.id}::uuid, deleted_at=now(), updated_at=now() where id=${id}::uuid`;
  await audit(user, "lead_deleted", "lead", id, { isDeleted: true }, before);
  return response.status(200).json({ ok: true });
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "GET") return list(request, response, user);
  if (request.method === "POST") return create(request, response, user);
  if (request.method === "PATCH" || request.method === "PUT") return update(request, response, user);
  if (request.method === "DELETE") return remove(request, response, user);
  return response.status(405).json({ ok: false, error: "Method not allowed" });
}
