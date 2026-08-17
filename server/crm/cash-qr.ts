import type { VercelRequest, VercelResponse } from "@vercel/node";
import { chooseAssignment, clean } from "../_crm-utils.js";
import { getSql } from "../_db.js";
import { ensureCrmSchema } from "../_crm-schema.js";
import { normalizePhone } from "../_phone-utils.js";
import { ensureOwnersSchema } from "../_owners-schema.js";
import { ensureLegacyCustomerCodeForLead } from "../_owners-customer-segments.js";

const QR_SOURCE_NAME = "كود QR مبيعات الكاش";
const QR_FALLBACK_POOL_KEY = "cash_qr:fallback:cash_sales";

function body(request: VercelRequest) {
  if (request.body && typeof request.body === "object") return request.body as Record<string, unknown>;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body || "{}") as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

async function chooseCashQrFallbackAssignment(sql: any) {
  const candidates = await sql<any[]>`
    select u.id::text as user_id,u.full_name,
      coalesce(
        (
          select b.code
          from core.user_system_branches usb
          join core.branches b on b.id=usb.branch_id and b.is_active=true
          where usb.user_id=u.id and usb.system_code='crm'
          order by usb.is_primary desc,b.sort_order,b.name
          limit 1
        ),
        (
          select b.code
          from core.user_branches ub
          join core.branches b on b.id=ub.branch_id and b.is_active=true
          where ub.user_id=u.id
          order by ub.is_primary desc,b.sort_order,b.name
          limit 1
        )
      ) as branch_code
    from core.users u
    where u.is_active=true
      and u.can_receive_leads=true
      and (
        exists (
          select 1
          from core.user_system_departments usd
          join core.departments d on d.id=usd.department_id and d.system_code='crm' and d.is_active=true
          where usd.user_id=u.id and usd.system_code='crm' and d.code='cash_sales'
        )
        or (
          not exists (
            select 1 from core.user_system_departments usd0
            where usd0.user_id=u.id and usd0.system_code='crm'
          )
          and exists (
            select 1
            from core.user_departments ud
            join core.departments d on d.id=ud.department_id and d.is_active=true
            where ud.user_id=u.id and d.code='cash_sales'
          )
        )
      )
      and coalesce(
        (
          select b.code
          from core.user_system_branches usb
          join core.branches b on b.id=usb.branch_id and b.is_active=true
          where usb.user_id=u.id and usb.system_code='crm'
          order by usb.is_primary desc,b.sort_order,b.name
          limit 1
        ),
        (
          select b.code
          from core.user_branches ub
          join core.branches b on b.id=ub.branch_id and b.is_active=true
          where ub.user_id=u.id
          order by ub.is_primary desc,b.sort_order,b.name
          limit 1
        )
      ) is not null
    order by u.full_name,u.id::text
  `;

  if (!candidates.length) return null;

  const [state] = await sql<any[]>`
    select last_user_id::text
    from crm.assignment_state
    where pool_key=${QR_FALLBACK_POOL_KEY}
    limit 1
  `;
  const lastIndex = candidates.findIndex((candidate) => candidate.user_id === state?.last_user_id);
  const selected = candidates[(lastIndex + 1 + candidates.length) % candidates.length];

  await sql`
    insert into crm.assignment_state(pool_key,last_user_id,last_branch_code,updated_at)
    values (${QR_FALLBACK_POOL_KEY},${selected.user_id}::uuid,${selected.branch_code},now())
    on conflict (pool_key) do update
      set last_user_id=excluded.last_user_id,last_branch_code=excluded.last_branch_code,updated_at=now()
  `;

  return {
    assignedTo: selected.user_id,
    assignedName: selected.full_name,
    branchCode: selected.branch_code,
    ruleId: null,
    ruleName: "QR كاش - توزيع تلقائي من مناديب الكاش",
    fallback: true,
  };
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
      error: "رقم الجوال مسجل بالفعل",
      leadId: duplicate.id,
      status: duplicate.status_label || null,
    });
  }

  let assignment: any = await chooseAssignment("cash", "", "branch");
  let usedFallback = false;
  if (!assignment.assignedTo || !assignment.branchCode) {
    const fallback = await chooseCashQrFallbackAssignment(sql);
    if (fallback) {
      assignment = fallback;
      usedFallback = true;
    }
  }
  if (!assignment.assignedTo || !assignment.branchCode) {
    return response.status(409).json({ ok: false, error: "لا يوجد مندوب مبيعات كاش متاح حاليًا، حاول مرة أخرى لاحقًا" });
  }

  const extraData = {
    cashQrIntake: true,
    intakeChannel: "cash_qr",
    assignmentRuleId: assignment.ruleId || null,
    assignmentRuleName: assignment.ruleName || null,
    assignmentFallback: usedFallback,
  };

  const created = await sql.begin(async (tx) => {
    const contactMetadata = {
      origin: "cash_qr",
      intakeChannel: "cash_qr",
      sourceName: QR_SOURCE_NAME,
    };

    let [contact] = await tx<any[]>`
      select *,id::text
      from crm.contacts
      where primary_phone_normalized=${phone}
      limit 1
      for update
    `;

    if (!contact) {
      [contact] = await tx<any[]>`
        insert into crm.contacts(contact_key,display_name,primary_phone,primary_phone_normalized,metadata)
        values(
          ${`phone:${phone}`},${customerName},${phoneRaw || phone},${phone},${tx.json(contactMetadata)}
        )
        on conflict(contact_key) do update set
          display_name=coalesce(nullif(excluded.display_name,''),crm.contacts.display_name),
          primary_phone=coalesce(nullif(excluded.primary_phone,''),crm.contacts.primary_phone),
          primary_phone_normalized=coalesce(nullif(excluded.primary_phone_normalized,''),crm.contacts.primary_phone_normalized),
          metadata=coalesce(crm.contacts.metadata,'{}'::jsonb)||excluded.metadata,
          updated_at=now()
        returning *,id::text
      `;
    } else {
      [contact] = await tx<any[]>`
        update crm.contacts set
          display_name=coalesce(nullif(${customerName},''),display_name),
          primary_phone=coalesce(nullif(${phoneRaw || phone},''),primary_phone),
          primary_phone_normalized=coalesce(nullif(${phone},''),primary_phone_normalized),
          metadata=coalesce(metadata,'{}'::jsonb)||${tx.json(contactMetadata)}::jsonb,
          is_active=true,
          updated_at=now()
        where id=${contact.id}::uuid
        returning *,id::text
      `;
    }

    await tx`
      insert into crm.contact_identities(contact_id,channel_code,external_id,participant_id,display_name,metadata)
      values(
        ${contact.id}::uuid,'cash_qr',${phone},${phone},${customerName},${tx.json(contactMetadata)}
      )
      on conflict(channel_code,external_id) do update set
        contact_id=excluded.contact_id,
        participant_id=excluded.participant_id,
        display_name=coalesce(nullif(excluded.display_name,''),crm.contact_identities.display_name),
        metadata=coalesce(crm.contact_identities.metadata,'{}'::jsonb)||excluded.metadata,
        updated_at=now()
    `;

    const [lead] = await tx<any[]>`
      insert into crm.leads(
        customer_name,phone,phone_normalized,contact_id,source_code,source_name,platform_code,
        service_key,department_code,branch_code,status_label,payment_type,
        assigned_to,responsible_name_snapshot,extra_data,registered_at,created_at,updated_at
      ) values(
        ${customerName},${phoneRaw || phone},${phone},${contact.id}::uuid,'branch',${QR_SOURCE_NAME},'cash_qr',
        'cash','cash_sales',${assignment.branchCode},'عميل جديد','كاش',
        ${assignment.assignedTo}::uuid,${assignment.assignedName || null},${tx.json(extraData)},now(),now(),now()
      )
      returning id::text,contact_id::text,customer_name,phone_normalized,branch_code,source_name,payment_type,status_label,department_code,assigned_to::text,registered_at,updated_at
    `;

    await tx`
      insert into crm.lead_events(
        lead_id,event_type,new_status,new_department,new_branch,actor_name,actor_role,note
      ) values(
        ${lead.id}::uuid,'lead_created','عميل جديد','cash_sales',${assignment.branchCode},
        'QR كود مبيعات الكاش','public_qr','دخول العميل إلى CRM من QR كود مبيعات الكاش'
      )
    `;

    if (usedFallback) {
      await tx`
        insert into crm.assignment_logs(
          rule_id,lead_id,department_code,branch_code,source_code,assigned_to,assigned_name,assignment_mode,action,actor_name
        ) values(
          null,${lead.id}::uuid,'cash_sales',${assignment.branchCode},'cash_qr',
          ${assignment.assignedTo}::uuid,${assignment.assignedName || null},'round_robin','cash_qr_fallback','QR كود مبيعات الكاش'
        )
      `.catch(() => undefined);
    }

    return lead;
  });

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
