import { getSql } from "./_db.js";
import { queueFirebaseSms } from "./_firebase-sms.js";
import { clean } from "./_crm-utils.js";
import { normalizePhone } from "./_phone-utils.js";
import { ensureOwnerMemberByPhone } from "./_owners.js";
import { ensureOwnersSchema } from "./_owners-schema.js";

export type OwnerWelcomeQueueResult = {
  status: "queued" | "already_sent" | "member_not_found" | "invalid_phone";
  memberId?: string;
  documentId?: string;
};

export type LegacyOwnerWelcomeQueueResult = {
  status: "queued" | "already_sent" | "customer_not_found" | "invalid_phone";
  legacyCustomerId?: string;
  documentId?: string;
};

export const DEFAULT_OWNER_WELCOME_MESSAGE_TEMPLATE = `مرحباً : {customer_name}
أهلاً بك في MZJ Club Community.
يمكنك الدخول إلى حسابك ومتابعة نقاطك ومكافآتك من هنا:
{portal_url}
الكود الشخصي : {personal_code}

تاريخ تثق به`;

function renderOwnerWelcomeMessage(template: unknown, input: {
  customerName: unknown;
  portalUrl: unknown;
  personalCode: unknown;
}) {
  const values: Record<string, string> = {
    customer_name: clean(input.customerName) || "عميل مجموعة محمد بن ذعار العجمي",
    portal_url: clean(input.portalUrl),
    personal_code: clean(input.personalCode),
  };
  const source = clean(template) || DEFAULT_OWNER_WELCOME_MESSAGE_TEMPLATE;
  return source.replace(/\{([a-z0-9_]+)\}/gi, (match, key: string) => values[key] ?? match);
}

async function configuredWelcomeTemplate(sql: ReturnType<typeof getSql>) {
  const [settings] = await sql<any[]>`
    select welcome_message_template
    from owners.settings
    where id='default'
    limit 1
  `;
  return clean(settings?.welcome_message_template) || DEFAULT_OWNER_WELCOME_MESSAGE_TEMPLATE;
}

export async function queueOwnerWelcomeSms(input: {
  memberId?: unknown;
  phone?: unknown;
  byUid?: string | null;
  portalUrl: string;
}): Promise<OwnerWelcomeQueueResult> {
  await ensureOwnersSchema();
  const sql = getSql();
  const memberId = clean(input.memberId);
  let member: any = null;

  if (memberId) {
    [member] = await sql<any[]>`
      select *,id::text
      from owners.members
      where id=${memberId}::uuid and status='active'
      limit 1
    `;
  } else {
    member = await ensureOwnerMemberByPhone(input.phone);
  }

  if (!member) return { status: "member_not_found" };
  if (member.welcome_sent_at) return { status: "already_sent", memberId: member.id };

  const phone = normalizePhone(member.phone_normalized || input.phone);
  if (!phone) return { status: "invalid_phone", memberId: member.id };

  const message = renderOwnerWelcomeMessage(await configuredWelcomeTemplate(sql), {
    customerName: member.customer_name,
    portalUrl: input.portalUrl,
    personalCode: member.referral_code,
  });

  const queued = await queueFirebaseSms({
    ...(input.byUid ? { byUid: input.byUid } : {}),
    createdAt: new Date(),
    message,
    meta: { type: "owners_welcome", purpose: "welcome", memberId: member.id, referralCode: member.referral_code || "" },
    phone,
    source: "mzj_owners_community",
    status: "queued",
    to: phone,
  });

  await sql`
    update owners.members
    set
      welcome_sent_at=coalesce(welcome_sent_at,now()),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('welcomeDocumentId',${queued.documentId},'welcomeChannel','sms_plus'),
      updated_at=now()
    where id=${member.id}::uuid
  `;

  return { status: "queued", memberId: member.id, documentId: queued.documentId };
}

export async function queueLegacyOwnerWelcomeSms(input: {
  legacyCustomerId: unknown;
  byUid?: string | null;
  portalUrl: string;
  purpose?: string;
}): Promise<LegacyOwnerWelcomeQueueResult> {
  await ensureOwnersSchema();
  const sql = getSql();
  const legacyCustomerId = clean(input.legacyCustomerId);
  if (!legacyCustomerId) return { status: "customer_not_found" };

  const [customer] = await sql<any[]>`
    select
      c.id::text,c.crm_lead_id::text,c.customer_name,c.phone_normalized,c.referral_code,c.welcome_sent_at,
      l.status_label
    from owners.legacy_customer_codes c
    join crm.leads l on l.id=c.crm_lead_id and l.is_deleted=false
    where c.id=${legacyCustomerId}::uuid
      and c.status='active'
      and coalesce(l.status_label,'')<>'تم البيع'
    limit 1
  `;

  if (!customer) return { status: "customer_not_found" };
  if (customer.welcome_sent_at) return { status: "already_sent", legacyCustomerId: customer.id };

  const phone = normalizePhone(customer.phone_normalized);
  if (!phone) return { status: "invalid_phone", legacyCustomerId: customer.id };

  const message = renderOwnerWelcomeMessage(await configuredWelcomeTemplate(sql), {
    customerName: customer.customer_name,
    portalUrl: input.portalUrl,
    personalCode: customer.referral_code,
  });

  const queued = await queueFirebaseSms({
    ...(input.byUid ? { byUid: input.byUid } : {}),
    createdAt: new Date(),
    message,
    meta: {
      type: "owners_welcome",
      purpose: clean(input.purpose) || "welcome",
      legacyCustomerId: customer.id,
      leadId: customer.crm_lead_id,
      referralCode: customer.referral_code || "",
      statusLabel: customer.status_label || "",
    },
    phone,
    source: "mzj_owners_community",
    status: "queued",
    to: phone,
  });

  await sql`
    update owners.legacy_customer_codes
    set
      welcome_sent_at=coalesce(welcome_sent_at,now()),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('welcomeDocumentId',${queued.documentId},'welcomeChannel','sms_plus'),
      updated_at=now()
    where id=${customer.id}::uuid
  `;

  return { status: "queued", legacyCustomerId: customer.id, documentId: queued.documentId };
}
