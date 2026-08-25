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
  purchase_points_effective_at?: string | Date | null;
  points_repurchase_enabled?: boolean | null;
  points_repurchase?: number | string | null;
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
      greatest(coalesce(st.quantity,1),1)::int as sale_quantity,
      st.source_reference as sale_order_reference,
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
        await reconcileOwnerPurchasePoints(member.id);
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
  const configuredPoints = Math.trunc(Number(settings.points_purchase || 0));
  const configuredRepurchasePoints = Math.trunc(Number(settings.points_repurchase || 0));
  const purchaseEnabled = settings.points_purchase_enabled === true && configuredPoints > 0;
  const repurchaseEnabled = settings.points_repurchase_enabled !== false && configuredRepurchasePoints > 0;
  const repurchaseEffectiveAt = settings.purchase_points_effective_at || null;
  const memberId = clean(memberIdValue);
  const sql = getSql();

  return sql.begin(async (tx) => {
    // Older releases could create one generic initial purchase ledger row before
    // the concrete CRM sale id was attached. Bind that legacy row to the first
    // actual order once so cancellation/restoration and later orders stay exact.
    await tx`
      with legacy_initial as (
        select
          ledger.id as ledger_id,
          sale.id as sale_id,
          sale.sale_at,
          greatest(coalesce(sale.quantity,1),1)::int as order_quantity,
          sale.source_reference as order_reference
        from owners.points_ledger ledger
        join owners.members member on member.id=ledger.member_id
        join lateral (
          select st.id,st.sale_at,st.quantity,st.source_reference
          from crm.sales_transactions st
          join crm.leads lead on lead.id=st.lead_id and lead.is_deleted=false
          where
            (member.source_sale_id is not null and st.id=member.source_sale_id)
            or (member.crm_lead_id is not null and st.lead_id=member.crm_lead_id)
            or (
              nullif(member.phone_normalized,'') is not null
              and nullif(lead.phone_normalized,'') is not null
              and lead.phone_normalized=member.phone_normalized
            )
          order by st.sale_at,st.created_at,st.id
          limit 1
        ) sale on true
        where member.status='active'
          and coalesce(member.metadata->>'memberKind','real')<>'test'
          and (${memberId || null}::uuid is null or member.id=${memberId || null}::uuid)
          and ledger.event_type='purchase'
          and ledger.event_key='purchase:member:'||member.id::text||':initial'
          and coalesce(ledger.metadata->>'importedPreviousCustomer','false')<>'true'
          and not (ledger.metadata ? 'saleId')
      )
      update owners.points_ledger ledger set
        metadata=coalesce(ledger.metadata,'{}'::jsonb)||jsonb_build_object(
          'saleId',legacy.sale_id::text,
          'saleAt',legacy.sale_at,
          'saleQuantity',legacy.order_quantity,
          'saleOrderReference',legacy.order_reference,
          'purchaseAwardPoints',ledger.points,
          'legacyInitialMapped',true
        )
      from legacy_initial legacy
      where ledger.id=legacy.ledger_id
    `;

    // Keep the original award attached to the order itself. If that order is
    // cancelled, only its purchase award becomes zero; the member and any
    // unrelated referral points remain untouched. Restoring the same order
    // restores the original award value rather than the current settings value.
    await tx`
      with scoped_purchase as (
        select
          ledger.id,
          coalesce(sale.is_cancelled,false) as is_cancelled,
          coalesce(
            nullif(ledger.metadata->>'purchaseAwardPoints','')::int,
            ledger.points
          )::int as awarded_points
        from owners.points_ledger ledger
        join owners.members member on member.id=ledger.member_id
        left join crm.sales_transactions sale
          on sale.id=case
            when coalesce(ledger.metadata->>'saleId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              then (ledger.metadata->>'saleId')::uuid
            else null
          end
        where member.status='active'
          and coalesce(member.metadata->>'memberKind','real')<>'test'
          and (${memberId || null}::uuid is null or member.id=${memberId || null}::uuid)
          and ledger.event_type='purchase'
          and ledger.metadata ? 'saleId'
          and coalesce(ledger.metadata->>'pointsResetBaseline','false')<>'true'
      )
      update owners.points_ledger ledger set
        points=case when scoped.is_cancelled then 0 else scoped.awarded_points end,
        description=case when scoped.is_cancelled then 'شراء ملغي' else ledger.description end,
        metadata=coalesce(ledger.metadata,'{}'::jsonb)||jsonb_build_object(
          'purchaseAwardPoints',scoped.awarded_points,
          'purchaseCancelled',scoped.is_cancelled
        )
      from scoped_purchase scoped
      where ledger.id=scoped.id
    `;

    let insertedCount = 0;
    if (purchaseEnabled || repurchaseEnabled) {
      const summary = await tx<{ awards: number }[]>`
        with runtime_values as (
          select
            ${memberId || null}::uuid as scope_member_id,
            ${configuredPoints}::integer as purchase_award_points,
            ${configuredRepurchasePoints}::integer as repurchase_award_points,
            ${purchaseEnabled}::boolean as purchase_enabled,
            ${repurchaseEnabled}::boolean as repurchase_enabled,
            ${repurchaseEffectiveAt}::timestamptz as repurchase_effective_at
        ), eligible_members as (
          select
            member.id,
            member.phone_normalized,
            member.crm_lead_id,
            member.source_sale_id,
            member.first_sale_at,
            member.last_sale_at,
            member.metadata
          from owners.members member
          cross join runtime_values runtime
          where member.status='active'
            and coalesce(member.metadata->>'memberKind','real')<>'test'
            and (runtime.scope_member_id is null or member.id=runtime.scope_member_id)
        ), canonical_sales as (
          select distinct
            member.id as member_id,
            sale.id as sale_id,
            sale.sale_at,
            greatest(coalesce(sale.quantity,1),1)::int as order_quantity,
            sale.source_reference as order_reference
          from eligible_members member
          join crm.sales_transactions sale
            on coalesce(sale.is_cancelled,false)=false
          join crm.leads lead
            on lead.id=sale.lead_id
           and lead.is_deleted=false
          where
            (member.source_sale_id is not null and sale.id=member.source_sale_id)
            or (member.crm_lead_id is not null and sale.lead_id=member.crm_lead_id)
            or (
              nullif(member.phone_normalized,'') is not null
              and nullif(lead.phone_normalized,'') is not null
              and lead.phone_normalized=member.phone_normalized
            )
        ), ranked_sales as (
          select
            sale.*,
            row_number() over(
              partition by sale.member_id
              order by sale.sale_at,sale.sale_id
            ) as sale_rank
          from canonical_sales sale
        ), canonical_awardable as (
          select sale.*
          from ranked_sales sale
          cross join runtime_values runtime
          where (
              (sale.sale_rank=1 and runtime.purchase_enabled)
              or (
                sale.sale_rank>1
                and runtime.repurchase_enabled
                and (runtime.repurchase_effective_at is null or sale.sale_at>=runtime.repurchase_effective_at)
              )
            )
            and not exists (
              select 1
              from owners.points_ledger existing_purchase
              where existing_purchase.member_id=sale.member_id
                and existing_purchase.event_type='purchase'
                and existing_purchase.metadata->>'saleId'=sale.sale_id::text
            )
        ), canonical_inserted as (
          insert into owners.points_ledger(member_id,points,event_type,event_key,description,metadata)
          select
            sale.member_id,
            case when sale.sale_rank=1 then runtime.purchase_award_points else runtime.repurchase_award_points end,
            'purchase',
            'purchase:'||sale.sale_id::text,
            case when sale.sale_rank=1 then 'شراء العميل' else 'إعادة الشراء' end,
            jsonb_build_object(
              'saleId',sale.sale_id::text,
              'purchaseKind',case when sale.sale_rank=1 then 'first' else 'repurchase' end,
              'saleAt',sale.sale_at,
              'saleQuantity',sale.order_quantity,
              'saleOrderReference',sale.order_reference,
              'purchaseAwardPoints',case when sale.sale_rank=1 then runtime.purchase_award_points else runtime.repurchase_award_points end,
              'appliedFromSettings',true
            )
          from canonical_awardable sale
          cross join runtime_values runtime
          on conflict(event_key) do nothing
          returning member_id,points
        ), fallback_candidates as (
          select member.id as member_id,member.first_sale_at,member.last_sale_at
          from eligible_members member
          cross join runtime_values runtime
          where runtime.purchase_enabled
            and coalesce(member.metadata->>'enrollmentSource','') like 'excel_import%'
            and not exists (
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
            runtime.purchase_award_points,
            'purchase',
            'purchase:member:'||member.member_id::text||':initial',
            'شراء العميل',
            jsonb_build_object(
              'saleAt',coalesce(member.first_sale_at,member.last_sale_at),
              'purchaseKind','first',
              'purchaseAwardPoints',runtime.purchase_award_points,
              'appliedFromSettings',true,
              'memberPurchaseFallback',true,
              'importedPreviousCustomer',true
            )
          from fallback_candidates member
          cross join runtime_values runtime
          on conflict(event_key) do nothing
          returning member_id,points
        ), inserted_totals as (
          select inserted.member_id,count(*)::int as awards,sum(inserted.points)::int as awarded_points
          from (
            select member_id,points from canonical_inserted
            union all
            select member_id,points from fallback_inserted
          ) inserted
          group by inserted.member_id
        )
        update owners.members member set
          lifetime_points=member.lifetime_points+inserted_totals.awarded_points,
          updated_at=now()
        from inserted_totals
        where member.id=inserted_totals.member_id
        returning inserted_totals.awards
      `;
      insertedCount = summary.reduce((total: number, row: any) => total + Number(row.awards || 0), 0);
    }

    // Label every active purchase from its real order rank while preserving the
    // points amount stored for that order. Only the movement label is normalized.
    await tx`
      with eligible_members as (
        select member.id,member.phone_normalized,member.crm_lead_id,member.source_sale_id
        from owners.members member
        where member.status='active'
          and coalesce(member.metadata->>'memberKind','real')<>'test'
          and (${memberId || null}::uuid is null or member.id=${memberId || null}::uuid)
      ), canonical_sales as (
        select distinct
          member.id as member_id,
          sale.id as sale_id,
          sale.sale_at
        from eligible_members member
        join crm.sales_transactions sale on coalesce(sale.is_cancelled,false)=false
        join crm.leads lead on lead.id=sale.lead_id and lead.is_deleted=false
        where
          (member.source_sale_id is not null and sale.id=member.source_sale_id)
          or (member.crm_lead_id is not null and sale.lead_id=member.crm_lead_id)
          or (
            nullif(member.phone_normalized,'') is not null
            and nullif(lead.phone_normalized,'') is not null
            and lead.phone_normalized=member.phone_normalized
          )
      ), ranked_sales as (
        select
          sale.*,
          row_number() over(partition by sale.member_id order by sale.sale_at,sale.sale_id) as sale_rank
        from canonical_sales sale
      )
      update owners.points_ledger ledger set
        description=case when sale.sale_rank=1 then 'شراء العميل' else 'إعادة الشراء' end,
        metadata=coalesce(ledger.metadata,'{}'::jsonb)||jsonb_build_object(
          'purchaseKind',case when sale.sale_rank=1 then 'first' else 'repurchase' end
        )
      from ranked_sales sale
      where ledger.member_id=sale.member_id
        and ledger.event_type='purchase'
        and ledger.metadata->>'saleId'=sale.sale_id::text
    `;

    // The ledger remains the spendable-balance source of truth. Recalculate the
    // scoped real members after order-state reconciliation so cancelled orders
    // immediately lose only their purchase points and imported previous buyers
    // stay consistent with their ledger.
    await tx`
      with scoped_members as (
        select member.id
        from owners.members member
        where member.status='active'
          and coalesce(member.metadata->>'memberKind','real')<>'test'
          and (${memberId || null}::uuid is null or member.id=${memberId || null}::uuid)
      ), ledger_totals as (
        select
          member.id as member_id,
          coalesce(sum(ledger.points),0)::int as points_balance
        from scoped_members member
        left join owners.points_ledger ledger on ledger.member_id=member.id
        group by member.id
      )
      update owners.members member set
        points_balance=greatest(0,ledger_totals.points_balance),
        updated_at=now()
      from ledger_totals
      where member.id=ledger_totals.member_id
    `;

    return insertedCount;
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


function ownerCommerceOrderRoot(value: unknown) {
  let orderId = clean(value).slice(0, 180);
  const suffixes = [":primary", ":bonus", ":friend", ":new-customer", ":old-customer", ":personal-code", ":redemption"];
  let changed = true;
  while (changed && orderId) {
    changed = false;
    for (const suffix of suffixes) {
      if (!orderId.endsWith(suffix)) continue;
      orderId = orderId.slice(0, -suffix.length);
      changed = true;
      break;
    }
  }
  return orderId;
}

type OwnerCancellationSummary = {
  websiteOrderId: string | null;
  nextErpSalesOrder: string | null;
  personalCodesReleased: number;
  redemptionCodesRestored: number;
  purchaseBenefitsReleased: number;
  referralSalesReopened: number;
  purchasePointMovementsCancelled: number;
  referralSalePointMovementsCancelled: number;
  affectedMembers: number;
};

/**
 * Reverse only the MZJ Owners commerce effects that belong to a cancelled order.
 *
 * The ERP Sales Order remains the authoritative cancellation signal. Website order
 * id is accepted as a fallback for the WooCommerce side so codes are never stranded
 * if the ERP-link writeback was delayed. The operation is intentionally idempotent:
 * repeated ERP/Woo cancellation notifications return success without double refunds.
 */
export async function reverseOwnerCommerceForCancelledOrder(input: {
  nextErpSalesOrder?: string | null;
  websiteOrderId?: string | null;
  reason?: string | null;
  source?: string | null;
}): Promise<OwnerCancellationSummary> {
  await ensureOwnersSchema();
  const nextErpSalesOrder = clean(input.nextErpSalesOrder).slice(0, 160) || null;
  const websiteOrderId = ownerCommerceOrderRoot(input.websiteOrderId) || null;
  const reason = clean(input.reason).slice(0, 500) || "تم إلغاء طلب الشراء";
  const source = clean(input.source).slice(0, 100) || "order_cancellation";

  const empty: OwnerCancellationSummary = {
    websiteOrderId,
    nextErpSalesOrder,
    personalCodesReleased: 0,
    redemptionCodesRestored: 0,
    purchaseBenefitsReleased: 0,
    referralSalesReopened: 0,
    purchasePointMovementsCancelled: 0,
    referralSalePointMovementsCancelled: 0,
    affectedMembers: 0,
  };
  if (!nextErpSalesOrder && !websiteOrderId) return empty;

  const sql = getSql();
  const websiteOrderPattern = websiteOrderId ? `${websiteOrderId}:%` : "__no_website_order__";
  const cancellation = await sql.begin(async (tx) => {
    const benefits = await tx<any[]>`
      select id::text,reward_id::text,referral_id::text,referrer_member_id::text,website_order_id,next_erp_sales_order
      from owners.referral_purchase_benefits
      where (
        (${nextErpSalesOrder}::text is not null and next_erp_sales_order=${nextErpSalesOrder})
        or (${websiteOrderId}::text is not null and (website_order_id=${websiteOrderId} or website_order_id like ${websiteOrderPattern}))
      )
      for update
    `;

    const rewardCounts = new Map<string, number>();
    for (const benefit of benefits) {
      const rewardId = clean(benefit.reward_id);
      if (rewardId) rewardCounts.set(rewardId, (rewardCounts.get(rewardId) || 0) + 1);
    }
    for (const [rewardId, count] of rewardCounts) {
      await tx`
        update owners.rewards set
          referral_purchase_redeemed_quantity=greatest(0,referral_purchase_redeemed_quantity-${count}),
          updated_at=now()
        where id=${rewardId}::uuid
      `;
    }
    if (benefits.length) {
      const benefitIds = benefits.map((row: any) => clean(row.id)).filter(Boolean);
      if (benefitIds.length) await tx`delete from owners.referral_purchase_benefits where id in ${tx(benefitIds)}`;
    }

    const personalCodes = await tx<any[]>`
      delete from owners.personal_code_uses
      where (
        (${nextErpSalesOrder}::text is not null and next_erp_sales_order=${nextErpSalesOrder})
        or (${websiteOrderId}::text is not null and website_order_id=${websiteOrderId})
      )
      returning id::text,member_id::text
    `;

    const restoredRedemptions = await tx<any[]>`
      update owners.redemptions set
        status='approved',website_order_id=null,next_erp_sales_order=null,
        used_channel=null,used_by_phone_normalized=null,reviewed_by=null,reviewed_at=null,updated_at=now()
      where status='delivered' and (
        (${nextErpSalesOrder}::text is not null and next_erp_sales_order=${nextErpSalesOrder})
        or (${websiteOrderId}::text is not null and website_order_id=${websiteOrderId})
      )
      returning id::text,member_id::text
    `;

    const cancelledSales = nextErpSalesOrder ? await tx<any[]>`
      select id::text,lead_id::text,sale_at
      from crm.sales_transactions
      where source_reference=${nextErpSalesOrder}
        and coalesce(is_cancelled,false)=true
      order by sale_at,created_at,id
    ` : [];
    const cancelledSaleIds = cancelledSales.map((row: any) => clean(row.id)).filter(Boolean);

    const purchaseRows = cancelledSaleIds.length ? await tx<any[]>`
      select
        ledger.id::text,
        ledger.member_id::text,
        case
          when coalesce(ledger.metadata->>'purchaseAwardPoints','') ~ '^[0-9]+$'
            then (ledger.metadata->>'purchaseAwardPoints')::integer
          else greatest(0,ledger.points)
        end as cancelled_points
      from owners.points_ledger ledger
      where ledger.event_type='purchase'
        and coalesce(ledger.metadata->>'pointsResetBaseline','false')<>'true'
        and coalesce(ledger.metadata->>'cancellationLifetimeAdjusted','false')<>'true'
        and ledger.metadata->>'saleId' in ${tx(cancelledSaleIds)}
        and (
          ledger.points>0
          or coalesce(ledger.metadata->>'purchaseCancelled','false')='true'
        )
      for update
    ` : [];

    const cancelledReferralPointRows = cancelledSaleIds.length ? await tx<any[]>`
      with cancelled_sales as (
        select id::text as sale_id
        from crm.sales_transactions
        where id in ${tx(cancelledSaleIds)}
      ), scoped as (
        select
          ledger.id,
          ledger.member_id,
          case
            when coalesce(ledger.metadata->>'saleAwardPoints','') ~ '^[0-9]+$'
              then (ledger.metadata->>'saleAwardPoints')::integer
            else greatest(0,ledger.points)
          end as original_points
        from owners.points_ledger ledger
        join cancelled_sales sale on ledger.event_key='sale:'||sale.sale_id
        where ledger.event_type='sale'
          and coalesce(ledger.metadata->>'cancellationLifetimeAdjusted','false')<>'true'
          and (
            ledger.points>0
            or coalesce(ledger.metadata->>'saleCancelled','false')='true'
          )
        for update of ledger
      )
      update owners.points_ledger ledger set
        points=0,
        description='الصديق - بيع ملغي',
        metadata=coalesce(ledger.metadata,'{}'::jsonb)||jsonb_build_object(
          'saleAwardPoints',scoped.original_points,
          'saleCancelled',true,
          'cancelledSalesOrder',${nextErpSalesOrder},
          'cancellationReason',${reason},
          'cancellationSource',${source}
        )
      from scoped
      where ledger.id=scoped.id
      returning ledger.id::text,ledger.member_id::text,scoped.original_points as cancelled_points
    ` : [];

    const reopenedReferrals: any[] = [];
    if (cancelledSaleIds.length) {
      const referralRows = await tx<any[]>`
        select r.id::text,r.referrer_member_id::text,r.sale_transaction_id::text,l.status_label
        from owners.referrals r
        left join crm.leads l on l.id=r.crm_lead_id and l.is_deleted=false
        where r.sale_transaction_id in ${tx(cancelledSaleIds)}
        for update of r
      `;
      for (const referral of referralRows) {
        const newStatus = qualifiedStatus(referral.status_label) ? "qualified" : "registered";
        await tx`
          update owners.referrals set
            status=${newStatus},sale_transaction_id=null,sold_at=null,
            qualified_at=case when ${newStatus}='qualified' then coalesce(qualified_at,now()) else null end,
            metadata=coalesce(metadata,'{}'::jsonb)||${tx.json({
              lastCancelledSalesOrder: nextErpSalesOrder,
              cancelledSaleTransactionId: clean(referral.sale_transaction_id) || null,
              cancellationReason: reason,
              cancellationSource: source,
            })}::jsonb,
            updated_at=now()
          where id=${referral.id}::uuid
        `;
        reopenedReferrals.push(referral);
      }
    }

    const lifetimeDeductions = new Map<string, number>();
    const purchaseMemberIds = new Set<string>();
    for (const row of purchaseRows) {
      const memberId = clean(row.member_id);
      const points = Math.max(0, Math.trunc(Number(row.cancelled_points || 0)));
      if (!memberId) continue;
      purchaseMemberIds.add(memberId);
      if (points) lifetimeDeductions.set(memberId, (lifetimeDeductions.get(memberId) || 0) + points);
    }
    for (const row of cancelledReferralPointRows) {
      const memberId = clean(row.member_id);
      const points = Math.max(0, Math.trunc(Number(row.cancelled_points || 0)));
      if (!memberId || !points) continue;
      lifetimeDeductions.set(memberId, (lifetimeDeductions.get(memberId) || 0) + points);
    }

    return {
      benefits,
      personalCodes,
      restoredRedemptions,
      reopenedReferrals,
      purchaseRows,
      cancelledReferralPointRows,
      purchaseMemberIds: [...purchaseMemberIds],
      lifetimeDeductions: [...lifetimeDeductions.entries()],
    };
  });

  for (const memberId of cancellation.purchaseMemberIds) {
    await reconcileOwnerPurchasePoints(memberId);
  }
  const reopenedReferrerIds: string[] = Array.from(new Set<string>(
    cancellation.reopenedReferrals
      .map((row: any) => String(clean(row.referrer_member_id) || ""))
      .filter(Boolean),
  ));
  for (const referrerMemberId of reopenedReferrerIds) {
    await syncOwnerReferralProgress(referrerMemberId);
  }

  const affectedMemberIds = Array.from(new Set([
    ...cancellation.purchaseMemberIds,
    ...cancellation.cancelledReferralPointRows.map((row: any) => clean(row.member_id)).filter(Boolean),
  ]));

  if (affectedMemberIds.length) {
    const deductions = new Map<string, number>(cancellation.lifetimeDeductions as Array<[string, number]>);
    await sql.begin(async (tx) => {
      const [settings] = await tx<any[]>`select silver_points,gold_points,platinum_points from owners.settings where id='default'`;
      const totals = await tx<any[]>`
        select member.id::text as member_id,coalesce(sum(ledger.points),0)::int as points_balance
        from owners.members member
        left join owners.points_ledger ledger on ledger.member_id=member.id
        where member.id in ${tx(affectedMemberIds)}
        group by member.id
      `;
      for (const row of totals) {
        const memberId = clean(row.member_id);
        const deduction = Math.max(0, Math.trunc(Number(deductions.get(memberId) || 0)));
        const [member] = await tx<any[]>`
          update owners.members set
            points_balance=greatest(0,${Number(row.points_balance || 0)}),
            lifetime_points=greatest(0,lifetime_points-${deduction}),
            updated_at=now()
          where id=${memberId}::uuid
          returning lifetime_points
        `;
        if (member) {
          const tier = tierForLifetimePoints(Number(member.lifetime_points || 0), settings || {});
          await tx`update owners.members set tier_code=${tier},updated_at=now() where id=${memberId}::uuid`;
        }
      }
      const adjustedLedgerIds = [
        ...cancellation.purchaseRows.map((row: any) => clean(row.id)).filter(Boolean),
        ...cancellation.cancelledReferralPointRows.map((row: any) => clean(row.id)).filter(Boolean),
      ];
      if (adjustedLedgerIds.length) {
        await tx`
          update owners.points_ledger set
            metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
              'cancellationLifetimeAdjusted',true,
              'cancellationLifetimeAdjustedAt',now()
            )
          where id in ${tx(adjustedLedgerIds)}
        `;
      }
    });
  }

  return {
    websiteOrderId,
    nextErpSalesOrder,
    personalCodesReleased: cancellation.personalCodes.length,
    redemptionCodesRestored: cancellation.restoredRedemptions.length,
    purchaseBenefitsReleased: cancellation.benefits.length,
    referralSalesReopened: cancellation.reopenedReferrals.length,
    purchasePointMovementsCancelled: cancellation.purchaseRows.length,
    referralSalePointMovementsCancelled: cancellation.cancelledReferralPointRows.length,
    affectedMembers: affectedMemberIds.length,
  };
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
        description: "الصديق تم البيع",
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
      description: "الصديق تم البيع",
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
