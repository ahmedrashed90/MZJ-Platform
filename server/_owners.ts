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
  points_purchase_enabled?: boolean | null;
  points_purchase?: number | string | null;
  points_qualified_enabled?: boolean | null;
  points_qualified?: number | string | null;
  points_sale_enabled?: boolean | null;
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
      if (member) {
        await markLegacyCustomerConvertedForLead(sale.lead_id, member.id);
        const settings = await getOwnerSettings();
        if (settings.points_purchase_enabled === true) {
          await awardOwnerPoints({
            memberId: member.id,
            points: Number(settings.points_purchase || 0),
            eventType: "purchase",
            eventKey: `purchase:${sale.sale_id}`,
            description: "مكافأة إتمام عملية شراء",
            metadata: { saleId: sale.sale_id } as OwnerJson,
          });
        }
      }
      return member || null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/referral_code|owners_members_referral/i.test(message)) throw error;
    }
  }
  throw new Error("تعذر إنشاء كود دعوة فريد للعميل");
}

async function reconcileOwnerPurchasePoints(memberIdValue?: string | null) {
  await ensureOwnersSchema();
  const settings = await getOwnerSettings();
  const points = Math.trunc(Number(settings.points_purchase || 0));
  if (settings.points_purchase_enabled !== true || points <= 0) return 0;

  const silver = Math.max(0, Number(settings.silver_points || 1000));
  const gold = Math.max(silver, Number(settings.gold_points || 3000));
  const platinum = Math.max(gold, Number(settings.platinum_points || 7000));
  const memberId = clean(memberIdValue);
  const sql = getSql();

  return sql.begin(async (tx) => {
    const [summary] = await tx<any[]>`
      with eligible_members as (
        select
          m.id,
          m.phone_normalized,
          m.crm_lead_id,
          m.source_sale_id,
          m.first_sale_at,
          m.last_sale_at,
          m.metadata
        from owners.members m
        where m.status='active'
          and coalesce(m.metadata->>'memberKind','real')<>'test'
          and (${memberId || null}::uuid is null or m.id=${memberId || null}::uuid)
      ), canonical_sales as (
        select member.id as member_id,st.id as sale_id,st.sale_at
        from eligible_members member
        join crm.sales_transactions st
          on member.source_sale_id is not null
         and st.id=member.source_sale_id
         and coalesce(st.is_cancelled,false)=false
        join crm.leads lead on lead.id=st.lead_id and lead.is_deleted=false

        union

        select member.id as member_id,st.id as sale_id,st.sale_at
        from eligible_members member
        join crm.sales_transactions st
          on member.crm_lead_id is not null
         and st.lead_id=member.crm_lead_id
         and coalesce(st.is_cancelled,false)=false
        join crm.leads lead on lead.id=st.lead_id and lead.is_deleted=false

        union

        select member.id as member_id,st.id as sale_id,st.sale_at
        from eligible_members member
        join crm.leads lead
          on nullif(member.phone_normalized,'') is not null
         and lead.is_deleted=false
         and nullif(lead.phone_normalized,'') is not null
         and lead.phone_normalized=member.phone_normalized
        join crm.sales_transactions st
          on st.lead_id=lead.id
         and coalesce(st.is_cancelled,false)=false
      ), ranked_sales as (
        select
          sale.member_id,
          sale.sale_id,
          sale.sale_at,
          row_number() over(
            partition by sale.member_id
            order by sale.sale_at,sale.sale_id
          ) as sale_rank
        from canonical_sales sale
      ), canonical_awardable as (
        select sale.member_id,sale.sale_id,sale.sale_at
        from ranked_sales sale
        where not (
          sale.sale_rank=1
          and exists (
            select 1
            from owners.points_ledger legacy_purchase
            where legacy_purchase.member_id=sale.member_id
              and legacy_purchase.event_type='purchase'
              and legacy_purchase.event_key='purchase:member:'||sale.member_id::text||':initial'
          )
        )
      ), canonical_inserted as (
        insert into owners.points_ledger(member_id,points,event_type,event_key,description,metadata)
        select
          sale.member_id,
          ${points},
          'purchase',
          'purchase:'||sale.sale_id::text,
          'مكافأة إتمام عملية شراء',
          jsonb_build_object(
            'saleId',sale.sale_id::text,
            'saleAt',sale.sale_at,
            'appliedFromSettings',true
          )
        from canonical_awardable sale
        on conflict(event_key) do nothing
        returning member_id
      ), fallback_candidates as (
        select member.id as member_id,member.first_sale_at,member.last_sale_at
        from eligible_members member
        where not exists (
          select 1 from canonical_sales sale where sale.member_id=member.id
        )
          and not exists (
            select 1
            from owners.points_ledger existing_purchase
            where existing_purchase.member_id=member.id
              and existing_purchase.event_type='purchase'
          )
      ), fallback_inserted as (
        insert into owners.points_ledger(member_id,points,event_type,event_key,description,metadata)
        select
          member.member_id,
          ${points},
          'purchase',
          'purchase:member:'||member.member_id::text||':initial',
          'مكافأة إتمام عملية شراء',
          jsonb_build_object(
            'saleAt',coalesce(member.first_sale_at,member.last_sale_at),
            'appliedFromSettings',true,
            'memberPurchaseFallback',true
          )
        from fallback_candidates member
        on conflict(event_key) do nothing
        returning member_id
      ), inserted_counts as (
        select inserted.member_id,count(*)::int as awards
        from (
          select member_id from canonical_inserted
          union all
          select member_id from fallback_inserted
        ) inserted
        group by inserted.member_id
      ), credited as (
        update owners.members member set
          lifetime_points=member.lifetime_points+(inserted_counts.awards*${points}),
          tier_code=case
            when member.lifetime_points+(inserted_counts.awards*${points})>=${platinum} then 'platinum'
            when member.lifetime_points+(inserted_counts.awards*${points})>=${gold} then 'gold'
            when member.lifetime_points+(inserted_counts.awards*${points})>=${silver} then 'silver'
            else 'member'
          end,
          updated_at=now()
        from inserted_counts
        where member.id=inserted_counts.member_id
        returning member.id
      )
      select coalesce(sum(awards),0)::int as inserted_count
      from inserted_counts
    `;

    // The ledger is the source of truth for the spendable balance. Rebuild only
    // the scoped real members after purchase reconciliation so a valid purchase
    // can never remain visible as a stale zero balance on the member card.
    await tx`
      with scoped_members as (
        select member.id
        from owners.members member
        where member.status='active'
          and coalesce(member.metadata->>'memberKind','real')<>'test'
          and (${memberId || null}::uuid is null or member.id=${memberId || null}::uuid)
          and exists (
            select 1
            from owners.points_ledger purchase
            where purchase.member_id=member.id
              and purchase.event_type='purchase'
          )
      ), ledger_totals as (
        select
          ledger.member_id,
          coalesce(sum(ledger.points),0)::int as points_balance
        from owners.points_ledger ledger
        join scoped_members member on member.id=ledger.member_id
        group by ledger.member_id
      )
      update owners.members member set
        points_balance=greatest(0,ledger_totals.points_balance),
        updated_at=now()
      from ledger_totals
      where member.id=ledger_totals.member_id
    `;

    return Number(summary?.inserted_count || 0);
  });
}

export async function ensureOwnerPurchasePointsForMember(memberId: string) {
  return reconcileOwnerPurchasePoints(memberId);
}

export async function backfillOwnerPurchasePointsForExistingMembers() {
  return reconcileOwnerPurchasePoints(null);
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
      if (settings.points_qualified_enabled !== false) await awardOwnerPoints({
        memberId: referral.referrer_member_id,
        points: Number(settings.points_qualified || 0),
        eventType: "qualified",
        eventKey: `qualified:${referral.id}`,
        referralId: referral.id,
        description: "تحول الصديق إلى عميل مؤهل",
      });
      if (settings.points_sale_enabled !== false) await awardOwnerPoints({
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
      if (settings.points_qualified_enabled !== false) await awardOwnerPoints({
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
    if (settings.points_qualified_enabled !== false) await awardOwnerPoints({
      memberId: referral.referrer_member_id,
      points: Number(settings.points_qualified || 0),
      eventType: "qualified",
      eventKey: `qualified:${referral.id}`,
      referralId: referral.id,
      description: "تحول الصديق إلى عميل مؤهل",
    });
    if (settings.points_sale_enabled !== false) await awardOwnerPoints({
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
