import crypto from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "./_db.js";
import { clean } from "./_crm-utils.js";
import { normalizePhone } from "./_phone-utils.js";
import { ensureOwnersSchema } from "./_owners-schema.js";
import { markLegacyCustomerConvertedForLead } from "./_owners-customer-segments.js";

export const OWNER_SESSION_COOKIE = "mzj_owner_session";
const OWNER_SESSION_DAYS = 30;

type SqlClient = ReturnType<typeof getSql>;
export type OwnerJson = Parameters<SqlClient["json"]>[0];

type OwnerSettingsRow = {
  points_qualified?: number | string | null;
  points_sale?: number | string | null;
  silver_points?: number | string | null;
  gold_points?: number | string | null;
  platinum_points?: number | string | null;
};

function randomReferralCode() {
  return crypto.randomBytes(7).toString("base64url").replace(/[-_]/g, "").toUpperCase().slice(0, 10);
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function otpSecret() {
  const configured = clean(process.env.OWNERS_OTP_SECRET || process.env.SESSION_SECRET || process.env.DATABASE_URL);
  return sha256(`mzj-owners-otp:${configured || "mzj-platform"}`);
}

function parseCookies(header: string | undefined) {
  const cookies: Record<string, string> = {};
  for (const part of String(header || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    cookies[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
  }
  return cookies;
}

function tierForLifetimePoints(lifetimePoints: number, settings: OwnerSettingsRow) {
  const platinum = Math.max(0, Number(settings.platinum_points || 7000));
  const gold = Math.max(0, Number(settings.gold_points || 3000));
  const silver = Math.max(0, Number(settings.silver_points || 1000));
  if (lifetimePoints >= platinum) return "platinum";
  if (lifetimePoints >= gold) return "gold";
  if (lifetimePoints >= silver) return "silver";
  return "member";
}

export async function getOwnerSettings() {
  await ensureOwnersSchema();
  const [settings] = await getSql()<any[]>`select * from owners.settings where id='default'`;
  return settings || {};
}

export async function awardOwnerPoints(input: {
  memberId: string;
  points: number;
  eventType: string;
  eventKey: string;
  referralId?: string | null;
  rewardId?: string | null;
  description?: string | null;
  metadata?: OwnerJson;
}) {
  const points = Math.trunc(Number(input.points || 0));
  if (!points) return false;

  await ensureOwnersSchema();
  const sql = getSql();
  return sql.begin(async (tx) => {
    const inserted = await tx<any[]>`
      insert into owners.points_ledger(
        member_id,points,event_type,event_key,referral_id,reward_id,description,metadata
      ) values(
        ${input.memberId}::uuid,
        ${points},
        ${clean(input.eventType)},
        ${clean(input.eventKey)},
        ${input.referralId || null}::uuid,
        ${input.rewardId || null}::uuid,
        ${input.description || null},
        ${tx.json(input.metadata ?? {})}
      )
      on conflict(event_key) do nothing
      returning id::text
    `;
    if (!inserted.length) return false;

    const [settings] = await tx<any[]>`select silver_points,gold_points,platinum_points from owners.settings where id='default'`;
    const [member] = await tx<any[]>`
      update owners.members set
        points_balance=greatest(0,points_balance+${points}),
        lifetime_points=lifetime_points+${Math.max(0, points)},
        updated_at=now()
      where id=${input.memberId}::uuid
      returning lifetime_points
    `;
    if (member) {
      const tier = tierForLifetimePoints(Number(member.lifetime_points || 0), settings || {});
      await tx`update owners.members set tier_code=${tier},updated_at=now() where id=${input.memberId}::uuid`;
    }
    return true;
  });
}

export async function ensureOwnerMemberForLead(leadId: string, saleId?: string | null) {
  await ensureOwnersSchema();
  const sql = getSql();
  const normalizedLeadId = clean(leadId);
  if (!normalizedLeadId) return null;

  const [sale] = await sql<any[]>`
    select
      st.id::text as sale_id,
      st.sale_at,
      l.id::text as lead_id,
      l.customer_name,
      l.phone,
      l.phone_normalized
    from crm.leads l
    join crm.sales_transactions st
      on st.lead_id=l.id
     and coalesce(st.is_cancelled,false)=false
    where l.id=${normalizedLeadId}::uuid
      and l.is_deleted=false
      and (${clean(saleId) || null}::uuid is null or st.id=${clean(saleId) || null}::uuid)
    order by st.sale_at desc,st.created_at desc,st.id desc
    limit 1
  `;
  const phone = normalizePhone(sale?.phone_normalized || sale?.phone);
  if (!sale || !phone) return null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const referralCode = randomReferralCode();
    const [legacyCodeConflict] = await sql<any[]>`
      select id::text from owners.legacy_customer_codes where referral_code=${referralCode} limit 1
    `;
    if (legacyCodeConflict) continue;
    try {
      const metadata: OwnerJson = { enrolledFrom: "canonical_sale" };
      const [member] = await sql<any[]>`
        insert into owners.members(
          phone_normalized,customer_name,crm_lead_id,source_sale_id,referral_code,
          first_sale_at,last_sale_at,metadata
        ) values(
          ${phone},${sale.customer_name || null},${sale.lead_id}::uuid,${sale.sale_id}::uuid,${referralCode},
          ${sale.sale_at}::timestamptz,${sale.sale_at}::timestamptz,${sql.json(metadata)}
        )
        on conflict(phone_normalized) do update set
          customer_name=coalesce(excluded.customer_name,owners.members.customer_name),
          crm_lead_id=coalesce(excluded.crm_lead_id,owners.members.crm_lead_id),
          source_sale_id=coalesce(owners.members.source_sale_id,excluded.source_sale_id),
          first_sale_at=least(coalesce(owners.members.first_sale_at,excluded.first_sale_at),excluded.first_sale_at),
          last_sale_at=greatest(coalesce(owners.members.last_sale_at,excluded.last_sale_at),excluded.last_sale_at),
          status='active',
          updated_at=now()
        returning *,id::text,crm_lead_id::text,source_sale_id::text
      `;
      if (member) await markLegacyCustomerConvertedForLead(sale.lead_id, member.id);
      return member || null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/referral_code|owners_members_referral/i.test(message)) throw error;
    }
  }
  throw new Error("تعذر إنشاء كود دعوة فريد للعميل");
}

export async function ensureOwnerMemberByPhone(phoneValue: unknown) {
  await ensureOwnersSchema();
  const phone = normalizePhone(phoneValue);
  if (!phone) return null;
  const sql = getSql();

  const [existing] = await sql<any[]>`
    select *,id::text,crm_lead_id::text,source_sale_id::text
    from owners.members
    where phone_normalized=${phone} and status='active'
    limit 1
  `;
  if (existing) return existing;

  const [lead] = await sql<any[]>`
    select l.id::text
    from crm.leads l
    join crm.sales_transactions st
      on st.lead_id=l.id
     and coalesce(st.is_cancelled,false)=false
    where l.is_deleted=false and l.phone_normalized=${phone}
    order by st.sale_at desc,st.created_at desc
    limit 1
  `;
  return lead ? ensureOwnerMemberForLead(lead.id) : null;
}

function qualifiedStatus(statusValue: unknown) {
  const status = clean(statusValue);
  if (!status) return false;
  return ![
    "عميل جديد",
    "لم يتم الاتصال",
    "لم يتم الرد",
    "غير مؤهل",
    "مغلق - غير مؤهل",
  ].includes(status);
}

export async function syncOwnerReferralProgress(referrerMemberId?: string | null) {
  await ensureOwnersSchema();
  const sql = getSql();
  const settings = await getOwnerSettings();
  const memberId = clean(referrerMemberId);
  const referrals = await sql<any[]>`
    select
      r.id::text,
      r.status,
      r.referrer_member_id::text,
      r.crm_lead_id::text,
      l.status_label,
      st.id::text as sale_id,
      st.sale_at
    from owners.referrals r
    left join crm.leads l on l.id=r.crm_lead_id and l.is_deleted=false
    left join lateral(
      select id,sale_at
      from crm.sales_transactions
      where lead_id=r.crm_lead_id and coalesce(is_cancelled,false)=false
      order by sale_at desc,created_at desc,id desc
      limit 1
    ) st on true
    where r.status<>'sold'
      and (${memberId || null}::uuid is null or r.referrer_member_id=${memberId || null}::uuid)
    order by r.created_at
  `;

  let changed = 0;
  for (const referral of referrals) {
    if (referral.sale_id) {
      const updated = await sql<any[]>`
        update owners.referrals set
          status='sold',
          sale_transaction_id=${referral.sale_id}::uuid,
          sold_at=${referral.sale_at}::timestamptz,
          qualified_at=coalesce(qualified_at,now()),
          updated_at=now()
        where id=${referral.id}::uuid and status<>'sold'
        returning id::text
      `;
      if (updated.length) changed += 1;
      await awardOwnerPoints({
        memberId: referral.referrer_member_id,
        points: Number(settings.points_qualified || 0),
        eventType: "qualified",
        eventKey: `qualified:${referral.id}`,
        referralId: referral.id,
        description: "تحول الصديق إلى عميل مؤهل",
      });
      await awardOwnerPoints({
        memberId: referral.referrer_member_id,
        points: Number(settings.points_sale || 0),
        eventType: "sale",
        eventKey: `sale:${referral.sale_id}`,
        referralId: referral.id,
        description: "أتم الصديق عملية شراء",
      });
      if (referral.crm_lead_id) await ensureOwnerMemberForLead(referral.crm_lead_id, referral.sale_id);
      continue;
    }

    if (qualifiedStatus(referral.status_label)) {
      const updated = await sql<any[]>`
        update owners.referrals set
          status='qualified',
          qualified_at=coalesce(qualified_at,now()),
          updated_at=now()
        where id=${referral.id}::uuid and status='registered'
        returning id::text
      `;
      if (updated.length) changed += 1;
      await awardOwnerPoints({
        memberId: referral.referrer_member_id,
        points: Number(settings.points_qualified || 0),
        eventType: "qualified",
        eventKey: `qualified:${referral.id}`,
        referralId: referral.id,
        description: "تحول الصديق إلى عميل مؤهل",
      });
    }
  }
  return changed;
}

export async function processOwnerSaleForLead(leadId: string, saleId?: string | null) {
  const member = await ensureOwnerMemberForLead(leadId, saleId);
  if (!member) return null;

  await ensureOwnersSchema();
  const sql = getSql();
  const normalizedSaleId = clean(saleId);
  const [sale] = await sql<any[]>`
    select st.id::text,st.sale_at,l.phone_normalized
    from crm.sales_transactions st
    join crm.leads l on l.id=st.lead_id
    where st.lead_id=${clean(leadId)}::uuid
      and coalesce(st.is_cancelled,false)=false
      and (${normalizedSaleId || null}::uuid is null or st.id=${normalizedSaleId || null}::uuid)
    order by st.sale_at desc,st.created_at desc,st.id desc
    limit 1
  `;
  if (!sale) return member;

  const [referral] = await sql<any[]>`
    select id::text,referrer_member_id::text
    from owners.referrals
    where crm_lead_id=${clean(leadId)}::uuid
       or referred_phone_normalized=${normalizePhone(sale.phone_normalized)}
    order by created_at
    limit 1
  `;
  if (referral) {
    const settings = await getOwnerSettings();
    await sql`
      update owners.referrals set
        crm_lead_id=${clean(leadId)}::uuid,
        sale_transaction_id=${sale.id}::uuid,
        status='sold',
        qualified_at=coalesce(qualified_at,now()),
        sold_at=${sale.sale_at}::timestamptz,
        updated_at=now()
      where id=${referral.id}::uuid
    `;
    await awardOwnerPoints({
      memberId: referral.referrer_member_id,
      points: Number(settings.points_qualified || 0),
      eventType: "qualified",
      eventKey: `qualified:${referral.id}`,
      referralId: referral.id,
      description: "تحول الصديق إلى عميل مؤهل",
    });
    await awardOwnerPoints({
      memberId: referral.referrer_member_id,
      points: Number(settings.points_sale || 0),
      eventType: "sale",
      eventKey: `sale:${sale.id}`,
      referralId: referral.id,
      description: "أتم الصديق عملية شراء",
    });
  }
  return member;
}

export async function createOwnerSession(response: VercelResponse, memberId: string) {
  await ensureOwnersSchema();
  const sql = getSql();
  const token = crypto.randomBytes(32).toString("hex");
  await sql`
    insert into owners.sessions(token_hash,member_id,expires_at)
    values(${sha256(token)},${memberId}::uuid,now()+${OWNER_SESSION_DAYS}*interval '1 day')
  `;
  const secure = process.env.VERCEL ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${OWNER_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${OWNER_SESSION_DAYS * 86400}${secure}`,
  );
}

export async function clearOwnerSession(request: VercelRequest, response: VercelResponse) {
  await ensureOwnersSchema();
  const token = parseCookies(request.headers.cookie)[OWNER_SESSION_COOKIE];
  if (token) await getSql()`delete from owners.sessions where token_hash=${sha256(token)}`.catch(() => undefined);
  const secure = process.env.VERCEL ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${OWNER_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
}

export async function getOwnerSession(request: VercelRequest) {
  await ensureOwnersSchema();
  const token = parseCookies(request.headers.cookie)[OWNER_SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = sha256(token);
  const sql = getSql();
  const [member] = await sql<any[]>`
    select m.*,m.id::text,m.crm_lead_id::text,m.source_sale_id::text
    from owners.sessions s
    join owners.members m on m.id=s.member_id and m.status='active'
    where s.token_hash=${tokenHash} and s.expires_at>now()
    limit 1
  `;
  if (member) {
    await sql`
      update owners.sessions set last_seen_at=now()
      where token_hash=${tokenHash} and last_seen_at<now()-interval '5 minutes'
    `.catch(() => undefined);
    await sql`
      update owners.members set last_login_at=now(),updated_at=now()
      where id=${member.id}::uuid
    `.catch(() => undefined);
  }
  return member || null;
}

export function ownerHash(value: string) {
  return sha256(value);
}

export function ownerOtpHash(challengeId: string, phone: string, code: string) {
  return crypto.createHmac("sha256", otpSecret()).update(`${challengeId}:${phone}:${code}`).digest("hex");
}

export function secureHashEquals(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}
