import type { VercelRequest, VercelResponse } from "@vercel/node";
import { chooseAssignment, clean } from "../_crm-utils.js";
import { getSql } from "../_db.js";
import { ensureCrmSchema } from "../_crm-schema.js";
import { normalizePhone } from "../_phone-utils.js";
import { ensureOwnersSchema } from "../_owners-schema.js";
import { ensureLegacyCustomerCodeForLead } from "../_owners-customer-segments.js";

const QR_SOURCE_NAME = "\u0643\u0648\u062f QR \u0645\u0628\u064a\u0639\u0627\u062a \u0627\u0644\u0643\u0627\u0634";

function body(request: VercelRequest) {
  if (request.body && typeof request.body === "object") return request.body as Record<string, unknown>;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body || "{}") as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  await ensureCrmSchema();
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });

  const payload = body(request);
  const customerName = clean(payload.name ?? payload.customerName ?? payload.customer_name);
  const phoneRaw = clean(payload.phone ?? payload.mobile ?? payload.phoneNumber ?? payload.phone_number);
  const phone = normalizePhone(phoneRaw);
  const website = clean(payload.website);
  if (website) return response.status(200).json({ ok: true });
  if (!customerName) return response.status(400).json({ ok: false, error: "اسم العميل مطلوب" });
  if (!phone) return response.status(400).json({ ok: false, error: "اكتب رقم جوال سعودي صحيح بصيغة 05xxxxxxxx" });

  const sql = getSql();
  const [duplicate] = await sql<any[]>`
    select id::text,customer_name,status_label
    from crm.leads
    where phone_normalized=${phone} and is_deleted=false
    limit 1
  `;
  if (duplicate) {
    return response.status(409).json({
      ok: false,
      error: "رقم الجوال مسجل بالفعل في CRM",
      leadId: duplicate.id,
      status: duplicate.status_label || null,
    });
  }

  const assignment = await chooseAssignment("cash", "", "branch");
  if (!assignment.assignedTo || !assignment.branchCode) {
    return response.status(409).json({ ok: false, error: "لا توجد قاعدة توزيع كاش نشطة بمندوب وفرع مؤهلين حاليًا" });
  }

  const extraData = {
    cashQrIntake: true,
    intakeChannel: "cash_qr",
    assignmentRuleId: assignment.ruleId || null,
    assignmentRuleName: assignment.ruleName || null,
  };

  const [created] = await sql<any[]>`
    insert into crm.leads(
      customer_name,phone,phone_normalized,source_code,source_name,platform_code,
      service_key,department_code,branch_code,status_label,payment_type,
      assigned_to,responsible_name_snapshot,extra_data,registered_at,created_at,updated_at
    ) values(
      ${customerName},${phoneRaw || phone},${phone},'branch',${QR_SOURCE_NAME},'cash_qr',
      'cash','cash_sales',${assignment.branchCode},'عميل جديد','كاش',
      ${assignment.assignedTo}::uuid,${assignment.assignedName || null},${sql.json(extraData)},now(),now(),now()
    )
    returning id::text,customer_name,phone_normalized,branch_code,source_name,payment_type,status_label,department_code,assigned_to::text,registered_at,updated_at
  `;

  await sql`
    insert into crm.lead_events(
      lead_id,event_type,new_status,new_department,new_branch,actor_name,actor_role,note
    ) values(
      ${created.id}::uuid,'lead_created','عميل جديد','cash_sales',${assignment.branchCode},
      'QR كود مبيعات الكاش','public_qr','دخول العميل إلى CRM من QR كود مبيعات الكاش'
    )
  `;

  await (async () => {
    await ensureOwnersSchema();
    await ensureLegacyCustomerCodeForLead(created.id);
  })().catch((error) => console.error("MZJ Owners legacy customer code sync failed", error));

  return response.status(201).json({
    ok: true,
    message: "تم تسجيل بياناتك بنجاح وسيقوم فريق المبيعات بخدمتك",
    leadId: created.id,
  });
}
