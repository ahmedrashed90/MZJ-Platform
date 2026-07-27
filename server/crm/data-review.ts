import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clean, normalizePhone, parseBody, requireCrmUser, userScope, type Scope } from "../_crm-utils.js";
import { getSql } from "../_db.js";
import { hasPermission } from "../_access-control.js";

function norm(value: unknown) {
  return String(value ?? "").trim().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").toLowerCase();
}

type Issue = {
  leadId: string;
  customerName: string;
  phone: string;
  issueCode: string;
  issueField: string;
  issue: string;
  currentValue: string;
  department: string;
  branch: string;
  status: string;
  source: string;
  assignedName: string;
};

type Correction = {
  rowNumber: number;
  leadId: string;
  customerName: string;
  issueCode: string;
  issue: string;
  field: string;
  oldValue: string;
  newValue: string;
  resolvedValue: string;
  resolvedLabel?: string;
  valid: boolean;
  error: string;
};

function inputValue(row: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = clean(row[key]);
    if (value) return value;
  }
  return "";
}

async function validateCorrections(rows: unknown[], sql: ReturnType<typeof getSql>, scope: Scope): Promise<Correction[]> {
  const prepared = rows.map((item, index) => {
    const raw = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const leadId = inputValue(raw, "معرّف العميل", "leadId", "lead_id");
    const field = inputValue(raw, "الحقل المطلوب تصحيحه", "issueField", "field");
    const newValue = inputValue(raw, "القيمة المصححة", "correctedValue", "newValue");
    return {
      raw,
      rowNumber: index + 2,
      leadId,
      issueCode: inputValue(raw, "كود الخطأ", "issueCode", "issue_code"),
      issue: inputValue(raw, "سبب الخطأ", "issue"),
      field,
      newValue,
      validLeadId: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(leadId),
      normalizedPhone: field === "phone" ? normalizePhone(newValue) : "",
    };
  });

  const correctionKeyCounts = new Map<string, number>();
  const proposedPhoneLeads = new Map<string, Set<string>>();
  for (const item of prepared) {
    const key = `${item.leadId}\u0000${item.field}`;
    correctionKeyCounts.set(key, (correctionKeyCounts.get(key) || 0) + 1);
    if (item.normalizedPhone && item.leadId) {
      if (!proposedPhoneLeads.has(item.normalizedPhone)) proposedPhoneLeads.set(item.normalizedPhone, new Set());
      proposedPhoneLeads.get(item.normalizedPhone)!.add(item.leadId);
    }
  }
  const leadIds = [...new Set(prepared.filter((row) => row.validLeadId).map((row) => row.leadId))];
  const normalizedPhones = [...new Set(prepared.map((row) => row.normalizedPhone).filter(Boolean))];
  const [leads, departments, branches, users, statuses, sources, phoneMatches] = await Promise.all([
    leadIds.length ? sql<any[]>`
      select l.*,l.id::text from crm.leads l
      where l.id=any(${leadIds}::uuid[]) and l.is_deleted=false
        and (
          ${scope.all}::boolean
          or (${scope.includeAssigned}::boolean and ${scope.callCenterOnly}::boolean and l.call_center_assigned_to=${scope.userId}::uuid)
          or (${scope.includeAssigned}::boolean and not ${scope.callCenterOnly}::boolean and (l.assigned_to=${scope.userId}::uuid or l.call_center_assigned_to=${scope.userId}::uuid))
          or (l.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[])))
        )
    ` : Promise.resolve([]),
    sql<any[]>`select code,name from core.departments where is_active=true`,
    sql<any[]>`select code,name from core.branches where is_active=true`,
    sql<any[]>`
      select u.id::text,u.full_name,u.email,
        coalesce(array_agg(distinct d.code) filter(where d.code is not null),'{}') as department_codes,
        coalesce(array_agg(distinct b.code) filter(where b.code is not null),'{}') as branch_codes
      from core.users u
      left join core.user_departments ud on ud.user_id=u.id
      left join core.departments d on d.id=ud.department_id
      left join core.user_branches ub on ub.user_id=u.id
      left join core.branches b on b.id=ub.branch_id
      where u.is_active=true
      group by u.id
    `,
    sql<any[]>`select department_code,value,label from crm.dashboard_statuses where is_active=true`,
    sql<any[]>`select code,name from core.sources where is_active=true`,
    normalizedPhones.length ? sql<any[]>`select id::text,phone_normalized from crm.leads where phone_normalized=any(${normalizedPhones}::text[]) and is_deleted=false` : Promise.resolve([]),
  ]);

  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  const departmentByValue = new Map<string, any>();
  for (const department of departments) { departmentByValue.set(department.code, department); departmentByValue.set(department.name, department); }
  const branchByValue = new Map<string, any>();
  for (const branch of branches) { branchByValue.set(branch.code, branch); branchByValue.set(branch.name, branch); }
  const sourceByValue = new Map<string, any>();
  for (const source of sources) { sourceByValue.set(source.code, source); sourceByValue.set(source.name, source); }
  const statusByDepartmentAndValue = new Map<string, any>();
  for (const status of statuses) {
    statusByDepartmentAndValue.set(`${status.department_code}\u0000${status.value}`, status);
    statusByDepartmentAndValue.set(`${status.department_code}\u0000${status.label}`, status);
  }
  const phonesByValue = new Map<string, Set<string>>();
  for (const match of phoneMatches) {
    if (!phonesByValue.has(match.phone_normalized)) phonesByValue.set(match.phone_normalized, new Set());
    phonesByValue.get(match.phone_normalized)!.add(match.id);
  }

  const findUser = (value: string) => users.filter((candidate) => candidate.id === value || String(candidate.email || "").toLowerCase() === value.toLowerCase() || candidate.full_name === value);
  const output: Correction[] = [];

  for (const item of prepared) {
    const lead = leadById.get(item.leadId);
    const correction: Correction = {
      rowNumber: item.rowNumber,
      leadId: item.leadId,
      customerName: lead?.customer_name || inputValue(item.raw, "اسم العميل", "customerName"),
      issueCode: item.issueCode,
      issue: item.issue,
      field: item.field,
      oldValue: lead ? String((lead as any)[item.field] ?? "") : "",
      newValue: item.newValue,
      resolvedValue: "",
      valid: false,
      error: "",
    };

    if (!lead) correction.error = "العميل غير موجود";
    else if (!item.field) correction.error = "الحقل المطلوب تصحيحه غير موجود في الشيت";
    else if (!item.newValue) correction.error = "اكتب القيمة المصححة";
    else if ((correctionKeyCounts.get(`${item.leadId}\u0000${item.field}`) || 0) > 1) correction.error = "يوجد أكثر من تصحيح لنفس العميل والحقل داخل الشيت";
    else if (item.field === "phone") {
      if (!item.normalizedPhone) correction.error = "رقم الجوال غير صحيح";
      else if ((proposedPhoneLeads.get(item.normalizedPhone)?.size || 0) > 1) correction.error = "نفس رقم الجوال المصحح مستخدم لأكثر من عميل داخل الشيت";
      else if ([...(phonesByValue.get(item.normalizedPhone) || [])].some((id) => id !== item.leadId)) correction.error = "رقم الجوال مرتبط بعميل آخر";
      else { correction.valid = true; correction.resolvedValue = item.normalizedPhone; }
    } else if (item.field === "department_code") {
      const department = departmentByValue.get(item.newValue);
      if (!department || !["cash_sales", "finance_sales", "customer_service"].includes(department.code)) correction.error = "القسم غير صحيح";
      else { correction.valid = true; correction.resolvedValue = department.code; correction.resolvedLabel = department.name; }
    } else if (item.field === "branch_code") {
      const branch = branchByValue.get(item.newValue);
      if (!branch) correction.error = "الفرع غير صحيح";
      else { correction.valid = true; correction.resolvedValue = branch.code; correction.resolvedLabel = branch.name; }
    } else if (item.field === "assigned_to" || item.field === "call_center_assigned_to") {
      const candidates = findUser(item.newValue);
      const assigned = candidates.length === 1 ? candidates[0] : null;
      if (!candidates.length) correction.error = "المستخدم غير موجود أو موقوف";
      else if (candidates.length > 1) correction.error = "اسم المستخدم غير فريد؛ استخدم الإيميل أو المعرّف";
      else if (item.field === "call_center_assigned_to" && !(assigned.department_codes || []).includes("call_center")) correction.error = "المستخدم ليس ضمن قسم الكول سنتر";
      else if (item.field === "assigned_to" && lead.department_code && !(assigned.department_codes || []).includes(lead.department_code)) correction.error = "المستخدم لا يتبع قسم العميل";
      else if (item.field === "assigned_to" && lead.branch_code && (assigned.branch_codes || []).length && !(assigned.branch_codes || []).includes(lead.branch_code)) correction.error = "المستخدم لا يتبع فرع العميل";
      else { correction.valid = true; correction.resolvedValue = assigned.id; correction.resolvedLabel = assigned.full_name; }
    } else if (item.field === "status_label") {
      const statusDepartment = lead.department_code === "cash_sales" ? "cash" : lead.department_code === "finance_sales" ? "finance" : lead.department_code === "customer_service" ? "service" : lead.department_code;
      const status = statusByDepartmentAndValue.get(`${statusDepartment}\u0000${item.newValue}`);
      if (!status) correction.error = "الحالة غير معتمدة للقسم الحالي";
      else { correction.valid = true; correction.resolvedValue = status.value; correction.resolvedLabel = status.label; }
    } else if (item.field === "source_code") {
      const source = sourceByValue.get(item.newValue);
      if (!source) correction.error = "المصدر غير صحيح";
      else { correction.valid = true; correction.resolvedValue = source.code; correction.resolvedLabel = source.name; }
    } else if (item.field === "registered_at") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item.newValue)) correction.error = "اكتب التاريخ بصيغة YYYY-MM-DD";
      else {
        const parsed = new Date(`${item.newValue}T00:00:00Z`);
        if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== item.newValue) correction.error = "التاريخ غير صحيح";
        else { correction.valid = true; correction.resolvedValue = item.newValue; }
      }
    } else correction.error = "هذا النوع من الأخطاء لا يدعم التصحيح التلقائي";
    output.push(correction);
  }
  return output;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  const body = request.method === "POST" ? parseBody(request) : {};
  const action = request.method === "POST" ? (clean(body.action) || "preview") : "view";
  const requiredPermission = action === "execute" ? "crm.data_review.execute" : "crm.data_review.view";
  if (!hasPermission(user, requiredPermission)) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لمراجعة أو تصحيح بيانات CRM" });
  const sql = getSql();
  const scope = userScope(user);

  if (request.method === "POST") {
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) return response.status(400).json({ ok: false, error: "الشيت لا يحتوي على صفوف تصحيح" });
    if (rows.length > 5000) return response.status(400).json({ ok: false, error: "الحد الأقصى 5000 صف في كل عملية مراجعة" });
    const corrections = await validateCorrections(rows, sql, scope);
    const invalid = corrections.filter((row) => !row.valid);
    if (action === "preview") return response.status(200).json({ ok: true, action, validCount: corrections.length - invalid.length, invalidCount: invalid.length, corrections });
    if (action !== "execute") return response.status(400).json({ ok: false, error: "الإجراء غير صحيح" });
    if (invalid.length) return response.status(400).json({ ok: false, error: "تم رفض التنفيذ لأن بعض الصفوف غير صالحة", corrections });

    await sql.begin(async (tx) => {
      for (const item of corrections) {
        const [before] = await tx<any[]>`
          select l.*,l.id::text from crm.leads l
          where l.id=${item.leadId}::uuid and l.is_deleted=false
            and (
              ${scope.all}::boolean
              or (${scope.includeAssigned}::boolean and ${scope.callCenterOnly}::boolean and l.call_center_assigned_to=${scope.userId}::uuid)
              or (${scope.includeAssigned}::boolean and not ${scope.callCenterOnly}::boolean and (l.assigned_to=${scope.userId}::uuid or l.call_center_assigned_to=${scope.userId}::uuid))
              or (l.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[])))
            )
          for update
        `;
        if (!before) throw new Error(`العميل في الصف ${item.rowNumber} لم يعد موجودًا`);
        if (item.field === "phone") {
          await tx`update crm.leads set phone=${item.newValue},phone_normalized=${item.resolvedValue},updated_by=${user.id}::uuid,updated_at=now() where id=${item.leadId}::uuid`;
          await tx`update crm.manual_lead_requests set phone=${item.newValue},phone_normalized=${item.resolvedValue},updated_at=now() where created_lead_id=${item.leadId}::uuid`;
        } else if (item.field === "department_code") {
          const serviceKey = item.resolvedValue === "finance_sales" ? "finance" : item.resolvedValue === "customer_service" ? "service" : "cash";
          await tx`update crm.leads set department_code=${item.resolvedValue},service_key=${serviceKey},updated_by=${user.id}::uuid,updated_at=now() where id=${item.leadId}::uuid`;
          await tx`update crm.manual_lead_requests set department_code=${item.resolvedValue},service_key=${serviceKey},updated_at=now() where created_lead_id=${item.leadId}::uuid`;
        } else if (item.field === "branch_code") {
          await tx`update crm.leads set branch_code=${item.resolvedValue},updated_by=${user.id}::uuid,updated_at=now() where id=${item.leadId}::uuid`;
          await tx`update crm.manual_lead_requests set branch_code=${item.resolvedValue},updated_at=now() where created_lead_id=${item.leadId}::uuid`;
        } else if (item.field === "assigned_to") {
          await tx`update crm.leads set assigned_to=${item.resolvedValue}::uuid,updated_by=${user.id}::uuid,updated_at=now() where id=${item.leadId}::uuid`;
          await tx`update crm.manual_lead_requests set requested_assigned_to=${item.resolvedValue}::uuid,updated_at=now() where created_lead_id=${item.leadId}::uuid`;
        } else if (item.field === "call_center_assigned_to") {
          await tx`update crm.leads set call_center_assigned_to=${item.resolvedValue}::uuid,updated_by=${user.id}::uuid,updated_at=now() where id=${item.leadId}::uuid`;
          await tx`update crm.manual_lead_requests set requested_call_center_to=${item.resolvedValue}::uuid,updated_at=now() where created_lead_id=${item.leadId}::uuid`;
        } else if (item.field === "status_label") {
          await tx`update crm.leads set status_label=${item.resolvedValue},updated_by=${user.id}::uuid,updated_at=now() where id=${item.leadId}::uuid`;
        } else if (item.field === "source_code") {
          await tx`update crm.leads set source_code=${item.resolvedValue},source_name=${item.resolvedLabel || item.resolvedValue},updated_by=${user.id}::uuid,updated_at=now() where id=${item.leadId}::uuid`;
          await tx`update crm.manual_lead_requests set source_code=${item.resolvedValue},updated_at=now() where created_lead_id=${item.leadId}::uuid`;
        } else if (item.field === "registered_at") {
          await tx`update crm.leads set registered_at=(${item.resolvedValue}::date::timestamp at time zone 'Asia/Riyadh'),updated_by=${user.id}::uuid,updated_at=now() where id=${item.leadId}::uuid`;
          await tx`update crm.manual_lead_requests set registered_at=(${item.resolvedValue}::date::timestamp at time zone 'Asia/Riyadh'),updated_at=now() where created_lead_id=${item.leadId}::uuid`;
        }
        await tx`
          insert into crm.lead_events(lead_id,event_type,actor_id,actor_name,note,details)
          values (${item.leadId}::uuid,'data_review_correction',${user.id}::uuid,${user.fullName},${inputValue(rows[item.rowNumber - 2] as Record<string, unknown>, "ملاحظة التصحيح", "note") || "تصحيح من شيت مراجعة البيانات"},${tx.json({ issueCode: item.issueCode, field: item.field, oldValue: item.oldValue, newValue: item.resolvedValue })})
        `;
        await tx`
          insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,before_data,after_data)
          values (${user.id}::uuid,'crm','data_review_correction','lead',${item.leadId},${tx.json(before)},${tx.json({ field: item.field, value: item.resolvedValue, issueCode: item.issueCode })})
        `;
      }
    });
    return response.status(200).json({ ok: true, action, updatedCount: corrections.length, corrections });
  }

  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const [leads, statuses, sources] = await Promise.all([
    sql<any[]>`
      select l.id::text,l.customer_name,l.phone,l.phone_normalized,l.service_key,l.department_code,l.branch_code,l.status_label,l.source_code,
        l.registered_at,l.created_at,l.assigned_to::text,l.call_center_assigned_to::text,
        assigned.full_name as assigned_name,assigned.is_active as assigned_active,
        coalesce(array_agg(distinct ad.code) filter (where ad.code is not null),'{}') as assigned_departments,
        coalesce(array_agg(distinct ab.code) filter (where ab.code is not null),'{}') as assigned_branches,
        count(*) over(partition by nullif(l.phone_normalized,''))::int as duplicate_count
      from crm.leads l
      left join core.users assigned on assigned.id=l.assigned_to
      left join core.user_departments aud on aud.user_id=assigned.id
      left join core.departments ad on ad.id=aud.department_id
      left join core.user_branches aub on aub.user_id=assigned.id
      left join core.branches ab on ab.id=aub.branch_id
      where l.is_deleted=false
        and (
          ${scope.all}::boolean
          or (${scope.includeAssigned}::boolean and ${scope.callCenterOnly}::boolean and l.call_center_assigned_to=${scope.userId}::uuid)
          or (${scope.includeAssigned}::boolean and not ${scope.callCenterOnly}::boolean and (l.assigned_to=${scope.userId}::uuid or l.call_center_assigned_to=${scope.userId}::uuid))
          or (l.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[])))
        )
      group by l.id,assigned.id
      order by coalesce(l.registered_at,l.created_at) desc
    `,
    sql<any[]>`select department_code,value from crm.dashboard_statuses where is_active=true`,
    sql<any[]>`select code from core.sources`,
  ]);

  const statusMap = new Map<string, Set<string>>();
  for (const row of statuses) {
    const key = row.department_code === "cash" ? "cash_sales" : row.department_code === "finance" ? "finance_sales" : row.department_code === "service" ? "customer_service" : row.department_code;
    if (!statusMap.has(key)) statusMap.set(key, new Set());
    statusMap.get(key)!.add(norm(row.value));
  }
  const sourceCodes = new Set(sources.map((row) => row.code));
  const issues: Issue[] = [];
  const add = (lead: any, issueCode: string, issueField: string, issue: string, currentValue: unknown) => issues.push({
    leadId: lead.id,
    customerName: lead.customer_name || "—",
    phone: lead.phone || lead.phone_normalized || "—",
    issueCode,
    issueField,
    issue,
    currentValue: String(currentValue ?? "—"),
    department: lead.department_code || "—",
    branch: lead.branch_code || "—",
    status: lead.status_label || "—",
    source: lead.source_code || "—",
    assignedName: lead.assigned_name || "—",
  });

  for (const lead of leads) {
    if (lead.phone_normalized && Number(lead.duplicate_count || 0) > 1) add(lead, "duplicate_phone", "phone", "رقم الجوال مكرر", lead.phone_normalized);
    if (!lead.department_code) add(lead, "missing_department", "department_code", "العميل بدون قسم", lead.department_code);
    if (!lead.branch_code) add(lead, "missing_branch", "branch_code", "العميل بدون فرع", lead.branch_code);
    if (!lead.assigned_to) add(lead, "missing_assignee", "assigned_to", "العميل بدون مسؤول مبيعات", lead.assigned_to);
    if (lead.department_code === "finance_sales" && !lead.call_center_assigned_to) add(lead, "missing_call_center", "call_center_assigned_to", "عميل تمويل بدون موظف كول سنتر", lead.call_center_assigned_to);
    if (lead.assigned_to && !lead.assigned_name) add(lead, "unknown_assignee", "assigned_to", "المسؤول المرتبط غير موجود", lead.assigned_to);
    if (lead.assigned_to && lead.assigned_name && lead.assigned_active === false) add(lead, "inactive_assignee", "assigned_to", "المسؤول المرتبط موقوف", lead.assigned_name);
    if (lead.assigned_to && lead.department_code && !(lead.assigned_departments || []).includes(lead.department_code)) add(lead, "assignee_department_mismatch", "assigned_to", "المسؤول لا يتبع قسم العميل", lead.assigned_name);
    if (lead.assigned_to && lead.branch_code && (lead.assigned_branches || []).length && !(lead.assigned_branches || []).includes(lead.branch_code)) add(lead, "assignee_branch_mismatch", "assigned_to", "المسؤول لا يتبع فرع العميل", lead.assigned_name);
    if (lead.status_label && lead.department_code && !statusMap.get(lead.department_code)?.has(norm(lead.status_label))) add(lead, "unknown_status", "status_label", "حالة غير معروفة للقسم", lead.status_label);
    if (lead.source_code && !sourceCodes.has(lead.source_code)) add(lead, "unknown_source", "source_code", "مصدر غير معروف", lead.source_code);
    if (!lead.registered_at && !lead.created_at) add(lead, "missing_registration_date", "registered_at", "تاريخ التسجيل غير موجود", "—");
    if (lead.service_key === "finance" && lead.department_code !== "finance_sales") add(lead, "service_department_conflict", "department_code", "تعارض نوع الخدمة مع القسم", `${lead.service_key} / ${lead.department_code}`);
    if (lead.service_key === "cash" && lead.department_code !== "cash_sales") add(lead, "service_department_conflict", "department_code", "تعارض نوع الخدمة مع القسم", `${lead.service_key} / ${lead.department_code}`);
    if (lead.service_key === "service" && lead.department_code !== "customer_service") add(lead, "service_department_conflict", "department_code", "تعارض نوع الخدمة مع القسم", `${lead.service_key} / ${lead.department_code}`);
  }

  const summary = [...issues.reduce((map, issue) => map.set(issue.issueCode, { code: issue.issueCode, label: issue.issue, count: (map.get(issue.issueCode)?.count || 0) + 1 }), new Map<string, { code: string; label: string; count: number }>()).values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ar"));
  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json({ ok: true, checkedLeads: leads.length, issueCount: issues.length, affectedLeads: new Set(issues.map((issue) => issue.leadId)).size, summary, issues });
}
