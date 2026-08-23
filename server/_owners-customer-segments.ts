import { clean } from "./_crm-utils.js";
import { getSql } from "./_db.js";
import { normalizePhone } from "./_phone-utils.js";
import { uniqueOwnerCode } from "./_owners-code.js";

export type LegacyCustomerCode = {
  id: string;
  crm_lead_id: string;
  customer_name: string | null;
  phone_normalized: string | null;
  referral_code: string;
  status: "active" | "converted";
  converted_member_id?: string | null;
};

const SOLD_STATUS = "\u062a\u0645 \u0627\u0644\u0628\u064a\u0639";

export async function syncLegacyCustomerCodes() {
  const sql = getSql();

  await sql`
    insert into owners.legacy_customer_codes(
      crm_lead_id, phone_normalized, customer_name, referral_code, status, metadata, created_at, updated_at
    )
    select
      l.id,
      l.phone_normalized,
      nullif(l.customer_name,''),
      ('L' || upper(substr(md5(l.id::text), 1, 9))),
      'active',
      jsonb_build_object('source','crm_non_sold','statusLabel',coalesce(l.status_label,'')),
      now(),
      now()
    from crm.leads l
    where l.is_deleted=false
      and coalesce(l.status_label,'') <> ${SOLD_STATUS}
    on conflict(crm_lead_id) do update set
      phone_normalized=excluded.phone_normalized,
      customer_name=excluded.customer_name,
      status='active',
      converted_member_id=null,
      converted_at=null,
      metadata=coalesce(owners.legacy_customer_codes.metadata,'{}'::jsonb) || excluded.metadata,
      updated_at=now()
  `;

  await sql`
    update owners.legacy_customer_codes c
    set
      status='converted',
      converted_member_id=m.id,
      converted_at=coalesce(c.converted_at,now()),
      updated_at=now(),
      metadata=coalesce(c.metadata,'{}'::jsonb)||jsonb_build_object('convertedReason','sold')
    from crm.leads l
    left join owners.members m on m.crm_lead_id=l.id and m.status='active'
    where c.crm_lead_id=l.id
      and c.status='active'
      and (l.is_deleted=true or coalesce(l.status_label,'')=${SOLD_STATUS})
  `;

  return true;
}

export async function ensureLegacyCustomerCodeForLead(leadIdValue: unknown, options: { sd96?: boolean } = {}) {
  const leadId = clean(leadIdValue);
  if (!leadId) return null;
  const sql = getSql();
  const sd96Code = options.sd96 === true ? await uniqueOwnerCode() : null;
  const [row] = await sql<any[]>`
    insert into owners.legacy_customer_codes(
      crm_lead_id,phone_normalized,customer_name,referral_code,status,metadata,created_at,updated_at
    )
    select
      l.id,l.phone_normalized,nullif(l.customer_name,''),
      case when ${options.sd96 === true} then ${sd96Code} else ('L' || upper(substr(md5(l.id::text),1,9))) end,
      'active',
      jsonb_build_object('source','crm_non_sold','statusLabel',coalesce(l.status_label,'')),
      now(),now()
    from crm.leads l
    where l.id=${leadId}::uuid
      and l.is_deleted=false
      and coalesce(l.status_label,'') <> ${SOLD_STATUS}
    on conflict(crm_lead_id) do update set
      phone_normalized=excluded.phone_normalized,
      customer_name=excluded.customer_name,
      status='active',
      converted_member_id=null,
      converted_at=null,
      metadata=coalesce(owners.legacy_customer_codes.metadata,'{}'::jsonb) || excluded.metadata,
      updated_at=now()
    returning id::text,crm_lead_id::text,customer_name,phone_normalized,referral_code,status,converted_member_id::text
  `;
  return row || null;
}

export async function markLegacyCustomerConvertedForLead(leadIdValue: unknown, memberIdValue?: unknown) {
  const leadId = clean(leadIdValue);
  const memberId = clean(memberIdValue);
  if (!leadId) return false;
  const sql = getSql();
  const updated = await sql<any[]>`
    update owners.legacy_customer_codes
    set
      status='converted',
      converted_member_id=coalesce(${memberId || null}::uuid,converted_member_id),
      converted_at=coalesce(converted_at,now()),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('convertedReason','sold'),
      updated_at=now()
    where crm_lead_id=${leadId}::uuid and status<>'converted'
    returning id::text
  `;
  return updated.length > 0;
}

export async function findLegacyCustomerCodeByCode(codeValue: unknown): Promise<LegacyCustomerCode | null> {
  const code = clean(codeValue).toUpperCase();
  if (!code) return null;
  const [row] = await getSql()<any[]>`
    select
      c.id::text,c.crm_lead_id::text,c.customer_name,c.phone_normalized,c.referral_code,c.status,
      c.converted_member_id::text
    from owners.legacy_customer_codes c
    join crm.leads l on l.id=c.crm_lead_id and l.is_deleted=false
    where c.referral_code=${code}
      and c.status='active'
      and coalesce(l.status_label,'') <> ${SOLD_STATUS}
    limit 1
  `;
  return row || null;
}

export async function findLegacyCustomerCodeByPhone(phoneValue: unknown): Promise<LegacyCustomerCode | null> {
  const phone = normalizePhone(phoneValue);
  if (!phone) return null;
  const [row] = await getSql()<any[]>`
    select
      c.id::text,c.crm_lead_id::text,c.customer_name,c.phone_normalized,c.referral_code,c.status,
      c.converted_member_id::text
    from owners.legacy_customer_codes c
    join crm.leads l on l.id=c.crm_lead_id and l.is_deleted=false
    where c.phone_normalized=${phone}
      and c.status='active'
      and coalesce(l.status_label,'') <> ${SOLD_STATUS}
    order by c.updated_at desc
    limit 1
  `;
  return row || null;
}
