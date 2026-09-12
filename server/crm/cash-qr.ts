import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clean } from "../_crm-utils.js";
import { getSql } from "../_db.js";
import { ensureCrmSchema } from "../_crm-schema.js";
import { normalizePhone } from "../_phone-utils.js";
import { ensureOwnersSchema } from "../_owners-schema.js";
import { ensureLegacyCustomerCodeForLead } from "../_owners-customer-segments.js";
import { uniqueOwnerCode } from "../_owners-code.js";
import { queueLegacyOwnerWelcomeSms } from "../_owners-welcome.js";

const WEBSITE_SOURCE_CODE = "website";
const WEBSITE_SOURCE_NAME = "Website";
const WEBSITE_BRANCH_CODE = "website";
const WEBSITE_OWNER_EMPLOYEE_NO = "SYSTEM-WEBSITE";
const WEBSITE_OWNER_NAME = "Website";
const OWNERS_PORTAL_URL = "https://mzj-platform.vercel.app/club";
const SOLD_STATUS = "تم البيع";

function body(request: VercelRequest) {
  if (request.body && typeof request.body === "object") return request.body as Record<string, unknown>;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body || "{}") as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

async function queueRegistrationWelcome(customerCode: any) {
  let welcomeSmsQueued = false;
  if (!customerCode?.id || !customerCode?.referral_code) return welcomeSmsQueued;
  try {
    const welcomeResult = await queueLegacyOwnerWelcomeSms({
      legacyCustomerId: customerCode.id,
      portalUrl: OWNERS_PORTAL_URL,
      purpose: "cash_qr_registration",
    });
    welcomeSmsQueued = welcomeResult.status === "queued" || welcomeResult.status === "already_sent";
  } catch (error) {
    // The CRM + MZJ Club registration and customer code are already persisted.
    // SMS+ remains retryable from MZJ Club Community if the provider is temporarily unavailable.
    console.error("MZJ Club Community welcome SMS+ queue failed", error);
  }
  return welcomeSmsQueued;
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

  // The public QR flow depends on both CRM and MZJ Club. Prepare both schemas before
  // creating a CRM lead so a schema problem can never leave a CRM-only registration.
  await ensureOwnersSchema();

  const sql = getSql();
  const [duplicate] = await sql<any[]>`
    select id::text,customer_name,status_label,platform_code,source_code,phone_normalized
    from crm.leads
    where phone_normalized=${phone} and is_deleted=false
    limit 1
  `;
  if (duplicate) {
    // Self-heal QR registrations created by an older deployment where CRM committed
    // before the MZJ Club customer-code step. Only our own cash_qr intake is recovered;
    // every other existing CRM customer keeps the original duplicate protection.
    if (clean(duplicate.platform_code) === "cash_qr" && clean(duplicate.status_label) !== SOLD_STATUS) {
      const customerCode = await ensureLegacyCustomerCodeForLead(duplicate.id, { sd96: true });
      if (!customerCode?.id || !customerCode?.referral_code) {
        return response.status(500).json({ ok: false, error: "العميل موجود في CRM لكن تعذر استكمال تسجيله في MZJ Club Community" });
      }
      const welcomeSmsQueued = await queueRegistrationWelcome(customerCode);
      return response.status(200).json({
        ok: true,
        recovered: true,
        message: "تم استكمال تسجيل بياناتك بنجاح",
        leadId: duplicate.id,
        customerCode: customerCode.referral_code,
        welcomeSmsQueued,
        customerCodeSmsQueued: welcomeSmsQueued,
      });
    }

    return response.status(409).json({
      ok: false,
      error: "رقم الجوال مسجل بالفعل",
      leadId: duplicate.id,
      status: duplicate.status_label || null,
    });
  }

  const [websiteOwner] = await sql<any[]>`
    select id::text,full_name
    from core.users
    where employee_no=${WEBSITE_OWNER_EMPLOYEE_NO} and is_active=true
    limit 1
  `;
  if (!websiteOwner?.id) {
    return response.status(500).json({ ok: false, error: "تعذر تهيئة مسؤول Website لتسجيل العميل" });
  }

  const extraData = {
    cashQrIntake: true,
    intakeChannel: "cash_qr",
    routingMode: "fixed_website",
    routingBranch: WEBSITE_BRANCH_CODE,
    routingOwner: WEBSITE_OWNER_NAME,
  };
  const preparedCustomerCode = await uniqueOwnerCode();

  const created = await sql.begin(async (tx) => {
    const contactMetadata = {
      origin: "cash_qr",
      intakeChannel: "cash_qr",
      sourceCode: WEBSITE_SOURCE_CODE,
      sourceName: WEBSITE_SOURCE_NAME,
      branchCode: WEBSITE_BRANCH_CODE,
      responsibleName: WEBSITE_OWNER_NAME,
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
        ${customerName},${phoneRaw || phone},${phone},${contact.id}::uuid,${WEBSITE_SOURCE_CODE},${WEBSITE_SOURCE_NAME},'cash_qr',
        'cash','cash_sales',${WEBSITE_BRANCH_CODE},'عميل جديد','كاش',
        ${websiteOwner.id}::uuid,${WEBSITE_OWNER_NAME},${tx.json(extraData)},now(),now(),now()
      )
      returning id::text,contact_id::text,customer_name,phone_normalized,branch_code,source_code,source_name,payment_type,status_label,department_code,assigned_to::text,responsible_name_snapshot,registered_at,updated_at
    `;

    await tx`
      insert into crm.lead_events(
        lead_id,event_type,new_status,new_department,new_branch,actor_name,actor_role,note
      ) values(
        ${lead.id}::uuid,'lead_created','عميل جديد','cash_sales',${WEBSITE_BRANCH_CODE},
        ${WEBSITE_OWNER_NAME},'public_qr','دخول العميل إلى CRM من رابط أو QR الموقع الإلكتروني'
      )
    `;

    // CRM lead + MZJ Club new-customer row are one database transaction. If either
    // insert fails, neither side is committed, preventing CRM-only registrations.
    const [customerCode] = await tx<any[]>`
      insert into owners.legacy_customer_codes(
        crm_lead_id,phone_normalized,customer_name,referral_code,status,metadata,created_at,updated_at
      ) values(
        ${lead.id}::uuid,${phone},${customerName},${preparedCustomerCode}::text,'active',
        jsonb_build_object('source','crm_non_sold','statusLabel','عميل جديد','intakeChannel','cash_qr'),
        now(),now()
      )
      on conflict(crm_lead_id) do update set
        phone_normalized=excluded.phone_normalized,
        customer_name=excluded.customer_name,
        status='active',
        converted_member_id=null,
        converted_at=null,
        metadata=coalesce(owners.legacy_customer_codes.metadata,'{}'::jsonb)||excluded.metadata,
        updated_at=now()
      returning id::text,crm_lead_id::text,customer_name,phone_normalized,referral_code,status,converted_member_id::text
    `;
    if (!customerCode?.id || !customerCode?.referral_code) {
      throw new Error("MZJ Club Community customer code was not created");
    }

    return { lead, customerCode };
  });

  const welcomeSmsQueued = await queueRegistrationWelcome(created.customerCode);

  return response.status(201).json({
    ok: true,
    message: "تم تسجيل بياناتك بنجاح وسيقوم فريق المبيعات بخدمتك",
    leadId: created.lead.id,
    customerCode: created.customerCode.referral_code,
    welcomeSmsQueued,
    customerCodeSmsQueued: welcomeSmsQueued,
  });
}
