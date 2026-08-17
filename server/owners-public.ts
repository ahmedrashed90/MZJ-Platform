import crypto from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { attachLeadToContactAndOpenRequest } from "./_crm-lifecycle.js";
import { queueFirebaseSms } from "./_firebase-sms.js";
import { chooseAssignment, clean } from "./_crm-utils.js";
import { getSql } from "./_db.js";
import { normalizePhone } from "./_phone-utils.js";
import {
  awardOwnerPoints,
  clearOwnerSession,
  createOwnerSession,
  ensureOwnerMemberByPhone,
  ensureOwnerMemberForLead,
  getOwnerSession,
  getOwnerSettings,
  ownerHash,
  ownerOtpHash,
  secureHashEquals,
  syncOwnerReferralProgress,
  type OwnerJson,
} from "./_owners.js";
import { ensureOwnersSchema } from "./_owners-schema.js";

function requestBody(request: VercelRequest) {
  if (request.body && typeof request.body === "object") return request.body as Record<string, unknown>;
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body || "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function randomOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

function requestIp(request: VercelRequest) {
  return clean(request.headers["x-forwarded-for"] || request.headers["x-real-ip"] || "").split(",")[0].trim();
}

function publicBase(request: VercelRequest) {
  const protocol = String(request.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || "mzj-platform.vercel.app").split(",")[0];
  return `${protocol}://${host}`;
}

function allowedService(value: unknown) {
  const service = clean(value).toLowerCase();
  return ["cash", "finance", "service"].includes(service) ? service : "cash";
}

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(value));
}

async function findReferrer(codeValue: unknown) {
  const code = clean(codeValue).toUpperCase();
  if (!code) return null;
  const [member] = await getSql()<any[]>`
    select id::text,customer_name,phone_normalized,referral_code,metadata,
      coalesce(metadata->>'memberKind','real') as member_kind
    from owners.members
    where referral_code=${code} and status='active'
    limit 1
  `;
  return member || null;
}

async function recordUniqueVisit(request: VercelRequest, referrer: any, visitorValue: unknown) {
  const settings = await getOwnerSettings();
  const visitor = clean(visitorValue).slice(0, 180);
  const userAgent = clean(request.headers["user-agent"]).slice(0, 500);
  const ip = requestIp(request);
  const fallback = `${ip}|${userAgent}`;
  const visitorHash = ownerHash(`${referrer.id}:${visitor || fallback || crypto.randomUUID()}`);
  const ipHash = ip ? ownerHash(ip) : null;
  const sql = getSql();
  const inserted = await sql<any[]>`
    insert into owners.referral_visits(referrer_member_id,visitor_hash,ip_hash,user_agent)
    values(${referrer.id}::uuid,${visitorHash},${ipHash},${userAgent || null})
    on conflict(referrer_member_id,visitor_hash) do nothing
    returning id::text
  `;
  if (!inserted.length) return false;

  const configuredPoints = Math.max(0, Number(settings.points_unique_open || 0));
  const dailyCap = Math.max(0, Number(settings.daily_open_points_cap || 0));
  if (!configuredPoints || !dailyCap) return true;
  const [daily] = await sql<any[]>`
    select coalesce(sum(points),0)::int as total
    from owners.points_ledger
    where member_id=${referrer.id}::uuid
      and event_type='unique_open'
      and created_at >= date_trunc('day',now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh'
  `;
  const remaining = Math.max(0, dailyCap - Number(daily?.total || 0));
  const points = Math.min(configuredPoints, remaining);
  if (points > 0) {
    await awardOwnerPoints({
      memberId: referrer.id,
      points,
      eventType: "unique_open",
      eventKey: `visit:${inserted[0].id}`,
      description: "فتح صديق جديد رابط الدعوة",
      metadata: { visitorHash } as OwnerJson,
    });
  }
  return true;
}

type ReferralRegistrationOptions = {
  source?: string;
  note?: string;
  extraReferralMetadata?: Record<string, unknown>;
  extraLeadMetadata?: Record<string, unknown>;
  successMessage?: string;
};

type ReferralRegistrationResult = {
  status: number;
  body: Record<string, unknown>;
  referralId?: string;
  leadId?: string;
  referrerId?: string;
};

function commerceApiKeyFromRequest(request: VercelRequest) {
  const direct = String(request.headers["x-mzj-owners-api-key"] || "").trim();
  if (direct) return direct;
  const authorization = String(request.headers.authorization || "").trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function commerceApiAuthorized(request: VercelRequest) {
  const configured = String(process.env.OWNERS_COMMERCE_API_KEY || "").trim();
  if (!configured) return { ok: false as const, status: 503, error: "OWNERS_COMMERCE_API_KEY غير مضاف في إعدادات المنصة" };
  const supplied = commerceApiKeyFromRequest(request);
  if (!supplied) return { ok: false as const, status: 401, error: "مفتاح ربط الموقع مطلوب" };
  const left = Buffer.from(configured);
  const right = Buffer.from(supplied);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return { ok: false as const, status: 401, error: "مفتاح ربط الموقع غير صحيح" };
  }
  return { ok: true as const };
}

async function registerReferralCore(
  payload: Record<string, unknown>,
  options: ReferralRegistrationOptions = {},
): Promise<ReferralRegistrationResult> {
  const settings = await getOwnerSettings();
  if (settings.is_enabled === false) {
    return { status: 403, body: { ok: false, error: "MZJ Owners Community غير متاح حاليًا" } };
  }

  const referrer = await findReferrer(payload.code);
  if (!referrer) return { status: 404, body: { ok: false, error: "رابط الدعوة غير صالح" } };
  const name = clean(payload.name);
  const phone = normalizePhone(payload.phone);
  if (!name) return { status: 400, body: { ok: false, error: "اسم الصديق مطلوب" } };
  if (!phone) return { status: 400, body: { ok: false, error: "اكتب رقم جوال صحيح" } };
  if (phone === referrer.phone_normalized) {
    return { status: 409, body: { ok: false, error: "لا يمكن استخدام رابط الدعوة لنفس صاحب العضوية" } };
  }

  const sql = getSql();
  const [existingOwner] = await sql<any[]>`
    select id::text from owners.members where phone_normalized=${phone} and status='active' limit 1
  `;
  if (existingOwner) {
    return { status: 409, body: { ok: false, error: "هذا الرقم عضو بالفعل في MZJ Owners Community" } };
  }

  const [linkedReferral] = await sql<any[]>`
    select id::text,referrer_member_id::text
    from owners.referrals
    where referred_phone_normalized=${phone}
    limit 1
  `;
  if (linkedReferral && linkedReferral.referrer_member_id !== referrer.id) {
    return { status: 409, body: { ok: false, error: "هذا الرقم مرتبط بدعوة سابقة" } };
  }

  if (referrer.member_kind === "test") {
    const testMetadata = {
      source: options.source || "test_invite",
      memberKind: "test",
      ...(options.extraReferralMetadata || {}),
    } as OwnerJson;
    const [referral] = await sql<any[]>`
      insert into owners.referrals(
        referrer_member_id,referred_name,referred_phone_normalized,status,registered_at,metadata
      ) values(
        ${referrer.id}::uuid,${name},${phone},'registered',now(),${sql.json(testMetadata)}
      )
      on conflict(referred_phone_normalized) where referred_phone_normalized is not null do update set
        referred_name=excluded.referred_name,
        registered_at=coalesce(owners.referrals.registered_at,excluded.registered_at),
        status=case when owners.referrals.status='rejected' then 'registered' else owners.referrals.status end,
        metadata=coalesce(owners.referrals.metadata,'{}'::jsonb)||excluded.metadata,
        updated_at=now()
      returning id::text
    `;
    await awardOwnerPoints({
      memberId: referrer.id,
      points: Number(settings.points_registration || 0),
      eventType: "registration",
      eventKey: `test-registration:${referral.id}`,
      referralId: referral.id,
      description: "تسجيل صديق تجريبي من رابط الدعوة",
      metadata: { memberKind: "test" } as OwnerJson,
    });
    return {
      status: 200,
      body: { ok: true, message: "تم تسجيل الصديق التجريبي بدون إضافة بيانات إلى CRM" },
      referralId: referral.id,
      referrerId: referrer.id,
    };
  }

  let [lead] = await sql<any[]>`
    select id::text
    from crm.leads
    where phone_normalized=${phone} and is_deleted=false
    order by created_at
    limit 1
  `;
  const leadMetadata = {
    ownerReferralCode: referrer.referral_code,
    referrerMemberId: referrer.id,
    ownersCommunity: true,
    ...(options.extraLeadMetadata || {}),
  } as OwnerJson;
  if (lead) {
    const [priorSale] = await sql<any[]>`
      select id::text
      from crm.sales_transactions
      where lead_id=${lead.id}::uuid and coalesce(is_cancelled,false)=false
      limit 1
    `;
    if (priorSale) {
      return { status: 409, body: { ok: false, error: "هذا الرقم سبق له الشراء ولا يمكن احتسابه كإحالة جديدة" } };
    }
    await sql`
      update crm.leads set
        extra_data=coalesce(extra_data,'{}'::jsonb)||${sql.json(leadMetadata)}::jsonb,
        updated_at=now()
      where id=${lead.id}::uuid
    `;
  } else {
    const service = allowedService(settings.referral_default_service);
    const preferredBranch = clean(settings.referral_default_branch);
    const assignment = await chooseAssignment(service, preferredBranch, "owners_referral");
    const department = service === "finance" ? "finance_sales" : service === "service" ? "customer_service" : "cash_sales";
    const payment = service === "finance" ? "تمويل" : service === "service" ? "خدمة عملاء" : "كاش";
    [lead] = await sql<any[]>`
      insert into crm.leads(
        customer_name,phone,phone_normalized,source_code,source_name,service_key,department_code,
        branch_code,status_label,payment_type,assigned_to,responsible_name_snapshot,registered_at,notes,extra_data
      ) values(
        ${name},${phone},${phone},'owners_referral','MZJ Owners Community',${service},${department},
        ${assignment.branchCode || preferredBranch || null},'عميل جديد',${payment},${assignment.assignedTo || null}::uuid,
        ${assignment.assignedName || null},now(),${options.note || 'تم التسجيل من رابط دعوة MZJ Owners Community'},${sql.json(leadMetadata)}
      )
      returning id::text
    `;
    await attachLeadToContactAndOpenRequest({
      leadId: lead.id,
      actor: null,
      classificationMethod: "owners_referral",
    }).catch((error) => console.error("Owners referral CRM contact link failed", error));
  }

  const referralMetadata = {
    source: options.source || "public_invite",
    ...(options.extraReferralMetadata || {}),
  } as OwnerJson;
  const [referral] = await sql<any[]>`
    insert into owners.referrals(
      referrer_member_id,referred_name,referred_phone_normalized,crm_lead_id,status,registered_at,metadata
    ) values(
      ${referrer.id}::uuid,${name},${phone},${lead.id}::uuid,'registered',now(),${sql.json(referralMetadata)}
    )
    on conflict(referred_phone_normalized) where referred_phone_normalized is not null do update set
      referred_name=excluded.referred_name,
      crm_lead_id=coalesce(owners.referrals.crm_lead_id,excluded.crm_lead_id),
      registered_at=coalesce(owners.referrals.registered_at,excluded.registered_at),
      status=case when owners.referrals.status='rejected' then 'registered' else owners.referrals.status end,
      metadata=coalesce(owners.referrals.metadata,'{}'::jsonb)||excluded.metadata,
      updated_at=now()
    returning id::text
  `;
  await awardOwnerPoints({
    memberId: referrer.id,
    points: Number(settings.points_registration || 0),
    eventType: "registration",
    eventKey: `registration:${referral.id}`,
    referralId: referral.id,
    description: "سجل صديق جديد من رابط الدعوة",
  });
  return {
    status: 200,
    body: { ok: true, message: options.successMessage || "تم تسجيل بياناتك وسيقوم فريق MZJ بالتواصل معك" },
    referralId: referral.id,
    leadId: lead.id,
    referrerId: referrer.id,
  };
}

async function registerReferral(response: VercelResponse, payload: Record<string, unknown>) {
  const result = await registerReferralCore(payload);
  return response.status(result.status).json(result.body);
}

async function commerceEligibility(codeValue: unknown, phoneValue: unknown) {
  const settings = await getOwnerSettings();
  if (settings.is_enabled === false) return { ok: false as const, status: 403, error: "MZJ Owners Community غير متاح حاليًا" };
  const referrer = await findReferrer(codeValue);
  if (!referrer || referrer.member_kind === "test") {
    return { ok: false as const, status: 404, error: "كود الدعوة غير صالح للاستخدام في طلب الشراء" };
  }
  const phone = normalizePhone(phoneValue);
  if (!phone) return { ok: false as const, status: 400, error: "اكتب رقم جوال العميل بشكل صحيح" };
  if (phone === referrer.phone_normalized) {
    return { ok: false as const, status: 409, error: "لا يمكن لصاحب العضوية استخدام كود الدعوة الخاص به" };
  }

  const sql = getSql();
  const [existingBenefit] = await sql<any[]>`
    select id::text,website_order_id
    from owners.referral_purchase_benefits
    where referred_phone_normalized=${phone}
    limit 1
  `;
  if (existingBenefit) {
    return { ok: false as const, status: 409, error: "سبق لهذا العميل الاستفادة من مكافأة كود الدعوة" };
  }

  const [existingOwner] = await sql<any[]>`
    select id::text from owners.members where phone_normalized=${phone} and status='active' limit 1
  `;
  const [lead] = await sql<any[]>`
    select id::text
    from crm.leads
    where phone_normalized=${phone} and is_deleted=false
    order by created_at
    limit 1
  `;
  let priorSale: any = null;
  if (lead) {
    [priorSale] = await sql<any[]>`
      select id::text
      from crm.sales_transactions
      where lead_id=${lead.id}::uuid and coalesce(is_cancelled,false)=false
      limit 1
    `;
  }
  const customerKind = existingOwner || priorSale ? "existing" as const : "new" as const;

  const [linkedReferral] = await sql<any[]>`
    select id::text,referrer_member_id::text,status,crm_lead_id::text
    from owners.referrals
    where referred_phone_normalized=${phone}
    limit 1
  `;
  if (customerKind === "new" && linkedReferral && linkedReferral.referrer_member_id !== referrer.id) {
    return { ok: false as const, status: 409, error: "هذا العميل مرتبط بكود دعوة آخر بالفعل" };
  }

  return {
    ok: true as const,
    referrer,
    phone,
    customerKind,
    existingOwner: existingOwner || null,
    linkedReferral: linkedReferral || null,
    lead: lead || null,
  };
}

function commerceRewardPayload(reward: any) {
  const discountType = reward.reward_type === "discount" && reward.checkout_discount_type === "percentage" ? "percentage" : "amount";
  const discountValue = reward.reward_type === "discount" ? Number(reward.checkout_discount_value || reward.checkout_discount_amount || 0) : 0;
  return {
    id: reward.id,
    name: reward.name,
    description: reward.description || "",
    type: reward.reward_type,
    value: reward.reward_value || "",
    discountType,
    discountValue,
    discountAmount: discountType === "amount" ? discountValue : 0,
    discountPercent: discountType === "percentage" ? discountValue : 0,
    availableForNewCustomer: reward.available_for_referral_purchase === true,
    availableForExistingCustomer: reward.available_for_existing_customer_purchase === true,
    startsAt: reward.starts_at || null,
    endsAt: reward.ends_at || null,
  };
}

async function getCommerceRewards(customerKind: "new" | "existing", rewardId?: string) {
  const sql = getSql();
  const rows = await sql<any[]>`
    select
      id::text,name,description,reward_type,reward_value,
      available_for_referral_purchase,available_for_existing_customer_purchase,
      checkout_discount_type,checkout_discount_value,checkout_discount_amount,
      stock_quantity,redeemed_quantity,referral_purchase_redeemed_quantity,starts_at,ends_at
    from owners.rewards
    where is_active=true
      and (
        (${customerKind}='existing' and available_for_existing_customer_purchase=true)
        or (${customerKind}='new' and (available_for_referral_purchase=true or available_for_existing_customer_purchase=true))
      )
      and (starts_at is null or starts_at<=now())
      and (ends_at is null or ends_at>=now())
      and (stock_quantity is null or (redeemed_quantity+referral_purchase_redeemed_quantity)<stock_quantity)
      and (${clean(rewardId) || null}::uuid is null or id=${clean(rewardId) || null}::uuid)
    order by name,id
  `;
  return rows;
}

async function handleCommerceRewards(request: VercelRequest, response: VercelResponse, payload: Record<string, unknown>) {
  const auth = commerceApiAuthorized(request);
  if (!auth.ok) return response.status(auth.status).json({ ok: false, error: auth.error });
  const eligibility = await commerceEligibility(payload.code, payload.phone);
  if (!eligibility.ok) return response.status(eligibility.status).json({ ok: false, error: eligibility.error });

  const rewards = await getCommerceRewards(eligibility.customerKind);
  return response.status(200).json({
    ok: true,
    eligible: true,
    referralCode: eligibility.referrer.referral_code,
    referrerName: eligibility.referrer.customer_name || "عميل MZJ",
    customerKind: eligibility.customerKind,
    rewards: rewards.map(commerceRewardPayload),
  });
}

async function handleCommerceConfirm(request: VercelRequest, response: VercelResponse, payload: Record<string, unknown>) {
  const auth = commerceApiAuthorized(request);
  if (!auth.ok) return response.status(auth.status).json({ ok: false, error: auth.error });

  const websiteOrderId = clean(payload.websiteOrderId).slice(0, 160);
  const rewardId = clean(payload.rewardId);
  const customerName = clean(payload.name);
  const phone = normalizePhone(payload.phone);
  const nextErpSalesOrder = clean(payload.nextErpSalesOrder).slice(0, 160) || null;
  if (!websiteOrderId) return response.status(400).json({ ok: false, error: "رقم طلب الموقع مطلوب" });
  if (!rewardId || !isUuid(rewardId)) return response.status(400).json({ ok: false, error: "المكافأة المختارة غير صحيحة" });
  if (!customerName) return response.status(400).json({ ok: false, error: "اسم العميل مطلوب" });
  if (!phone) return response.status(400).json({ ok: false, error: "رقم جوال العميل غير صحيح" });

  const sql = getSql();
  const [existingOrderBenefit] = await sql<any[]>`
    select
      b.id::text,b.referral_id::text,b.reward_id::text,b.reward_name,b.reward_type,b.reward_value,b.customer_kind,
      b.checkout_discount_type,b.checkout_discount_value,b.checkout_discount_amount,
      b.website_order_id,b.next_erp_sales_order,b.referred_phone_normalized
    from owners.referral_purchase_benefits b
    where b.website_order_id=${websiteOrderId}
    limit 1
  `;
  if (existingOrderBenefit) {
    if (existingOrderBenefit.referred_phone_normalized !== phone) {
      return response.status(409).json({ ok: false, error: "رقم الطلب مستخدم مع عميل آخر" });
    }
    if (nextErpSalesOrder && existingOrderBenefit.next_erp_sales_order !== nextErpSalesOrder) {
      await sql`
        update owners.referral_purchase_benefits set next_erp_sales_order=${nextErpSalesOrder},updated_at=now()
        where id=${existingOrderBenefit.id}::uuid
      `;
    }
    return response.status(200).json({
      ok: true,
      duplicate: true,
      referralId: existingOrderBenefit.referral_id,
      benefitId: existingOrderBenefit.id,
      nextErpSalesOrder: nextErpSalesOrder || existingOrderBenefit.next_erp_sales_order || null,
      customerKind: existingOrderBenefit.customer_kind || "new",
      reward: {
        id: existingOrderBenefit.reward_id,
        name: existingOrderBenefit.reward_name,
        type: existingOrderBenefit.reward_type,
        value: existingOrderBenefit.reward_value || "",
        discountType: existingOrderBenefit.checkout_discount_type === "percentage" ? "percentage" : "amount",
        discountValue: Number(existingOrderBenefit.checkout_discount_value || existingOrderBenefit.checkout_discount_amount || 0),
        discountAmount: existingOrderBenefit.checkout_discount_type === "percentage" ? 0 : Number(existingOrderBenefit.checkout_discount_value || existingOrderBenefit.checkout_discount_amount || 0),
        discountPercent: existingOrderBenefit.checkout_discount_type === "percentage" ? Number(existingOrderBenefit.checkout_discount_value || 0) : 0,
      },
    });
  }

  const eligibility = await commerceEligibility(payload.code, phone);
  if (!eligibility.ok) return response.status(eligibility.status).json({ ok: false, error: eligibility.error });
  const rewards = await getCommerceRewards(eligibility.customerKind, rewardId);
  const reward = rewards[0];
  if (!reward) return response.status(409).json({ ok: false, error: "المكافأة المختارة لم تعد متاحة" });

  const rewardSnapshot = commerceRewardPayload(reward);
  let referralId: string | null = null;
  const referrerId = eligibility.referrer.id as string;
  if (eligibility.customerKind === "new") {
    const referralMetadata = {
      source: "website_purchase",
      websiteOrderId,
      selectedReward: rewardSnapshot,
    };
    const leadMetadata = {
      ownerReferralRewardId: rewardSnapshot.id,
      ownerReferralRewardName: rewardSnapshot.name,
      ownerReferralRewardType: rewardSnapshot.type,
      ownerReferralRewardValue: rewardSnapshot.value,
      ownerReferralDiscountType: rewardSnapshot.discountType,
      ownerReferralDiscountValue: rewardSnapshot.discountValue,
      ownerReferralDiscountAmount: rewardSnapshot.discountAmount,
      ownerReferralDiscountPercent: rewardSnapshot.discountPercent,
      ownerReferralWebsiteOrderId: websiteOrderId,
    };

    const registration = await registerReferralCore(
      { code: payload.code, name: customerName, phone },
      {
        source: "website_purchase",
        note: "تم التسجيل من كود دعوة أثناء طلب شراء سيارة من الموقع",
        extraReferralMetadata: referralMetadata,
        extraLeadMetadata: leadMetadata,
        successMessage: "تم ربط كود الدعوة والمكافأة بطلب الشراء",
      },
    );
    if (registration.status !== 200 || !registration.referralId || !registration.referrerId) {
      return response.status(registration.status).json(registration.body);
    }
    referralId = registration.referralId;
  }

  try {
    const benefit = await sql.begin(async (tx) => {
      const [lockedReward] = await tx<any[]>`
        select id::text,stock_quantity,redeemed_quantity,referral_purchase_redeemed_quantity,is_active,starts_at,ends_at,
          available_for_referral_purchase,available_for_existing_customer_purchase
        from owners.rewards
        where id=${rewardId}::uuid
        for update
      `;
      const now = Date.now();
      const available = lockedReward
        && lockedReward.is_active === true
        && (eligibility.customerKind === "existing"
          ? lockedReward.available_for_existing_customer_purchase === true
          : (lockedReward.available_for_referral_purchase === true || lockedReward.available_for_existing_customer_purchase === true))
        && (!lockedReward.starts_at || new Date(lockedReward.starts_at).getTime() <= now)
        && (!lockedReward.ends_at || new Date(lockedReward.ends_at).getTime() >= now)
        && (lockedReward.stock_quantity == null
          || Number(lockedReward.redeemed_quantity || 0) + Number(lockedReward.referral_purchase_redeemed_quantity || 0) < Number(lockedReward.stock_quantity));
      if (!available) throw new Error("REWARD_NOT_AVAILABLE");

      const metadata = { source: "website_purchase", referralCode: eligibility.referrer.referral_code, customerKind: eligibility.customerKind } as OwnerJson;
      const [inserted] = await tx<any[]>`
        insert into owners.referral_purchase_benefits(
          referral_id,referrer_member_id,referred_phone_normalized,customer_kind,reward_id,reward_name,reward_type,reward_value,
          checkout_discount_type,checkout_discount_value,checkout_discount_amount,website_order_id,next_erp_sales_order,metadata
        ) values(
          ${referralId}::uuid,${referrerId}::uuid,${phone},${eligibility.customerKind},${rewardSnapshot.id}::uuid,
          ${rewardSnapshot.name},${rewardSnapshot.type},${rewardSnapshot.value || null},
          ${rewardSnapshot.discountType},${rewardSnapshot.discountValue},${rewardSnapshot.discountAmount},
          ${websiteOrderId},${nextErpSalesOrder},${tx.json(metadata)}
        )
        returning id::text
      `;
      await tx`
        update owners.rewards set
          referral_purchase_redeemed_quantity=referral_purchase_redeemed_quantity+1,
          updated_at=now()
        where id=${rewardSnapshot.id}::uuid
      `;
      if (referralId) {
        await tx`
          update owners.referrals set
            metadata=coalesce(metadata,'{}'::jsonb)||${tx.json({ websitePurchaseBenefitId: inserted.id, websiteOrderId, selectedReward: rewardSnapshot } as OwnerJson)}::jsonb,
            updated_at=now()
          where id=${referralId}::uuid
        `;
      }
      return inserted;
    });

    return response.status(200).json({
      ok: true,
      referralId,
      benefitId: benefit.id,
      referralCode: eligibility.referrer.referral_code,
      customerKind: eligibility.customerKind,
      reward: rewardSnapshot,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "REWARD_NOT_AVAILABLE") {
      return response.status(409).json({ ok: false, error: "المكافأة المختارة نفدت أو توقفت قبل تأكيد الطلب" });
    }
    if (/unique|duplicate|referral_purchase_benefits/i.test(message)) {
      return response.status(409).json({ ok: false, error: "سبق لهذا العميل الاستفادة من مكافأة كود الدعوة" });
    }
    throw error;
  }
}
export default async function handler(request: VercelRequest, response: VercelResponse) {
  await ensureOwnersSchema();
  response.setHeader("Cache-Control", "no-store");
  const sql = getSql();
  const payload = requestBody(request);
  const action = clean(payload.action || request.query.action);

  if (request.method === "GET" && action === "invite") {
    const settings = await getOwnerSettings();
    if (settings.is_enabled === false) {
      return response.status(403).json({ ok: false, error: "MZJ Owners Community غير متاح حاليًا" });
    }
    const referrer = await findReferrer(request.query.code);
    if (!referrer) return response.status(404).json({ ok: false, error: "رابط الدعوة غير صالح" });
    await recordUniqueVisit(request, referrer, request.query.visitor).catch((error) => {
      console.error("Owners invite visit tracking failed", error);
    });
    return response.status(200).json({
      ok: true,
      referrerName: referrer.customer_name || "أحد عملاء MZJ",
      benefitTitle: settings.friend_benefit_title,
      benefitText: settings.friend_benefit_text,
    });
  }

  if (request.method === "POST" && action === "commerce_rewards") {
    return handleCommerceRewards(request, response, payload);
  }

  if (request.method === "POST" && action === "commerce_confirm") {
    return handleCommerceConfirm(request, response, payload);
  }

  if (request.method === "POST" && action === "register_referral") {
    return registerReferral(response, payload);
  }

  if (request.method === "POST" && action === "request_otp") {
    const phone = normalizePhone(payload.phone);
    if (!phone) return response.status(400).json({ ok: false, error: "اكتب رقم جوال صحيح" });
    const settings = await getOwnerSettings();
    if (settings.is_enabled === false) {
      return response.status(403).json({ ok: false, error: "MZJ Owners Community غير متاح حاليًا" });
    }
    const member = await ensureOwnerMemberByPhone(phone);
    if (!member) {
      return response.status(404).json({ ok: false, error: "رقم الجوال غير مرتبط بعملية شراء مكتملة من MZJ" });
    }

    const [limits] = await sql<any[]>`
      select
        max(created_at) as last_created_at,
        count(*) filter(where created_at>now()-interval '1 hour')::int as hourly_count
      from owners.otp_challenges
      where phone_normalized=${phone}
    `;
    if (
      limits?.last_created_at
      && Date.now() - new Date(limits.last_created_at).getTime() < Number(settings.otp_resend_seconds || 60) * 1000
    ) {
      return response.status(429).json({ ok: false, error: "انتظر قليلًا قبل طلب رمز جديد" });
    }
    if (Number(limits?.hourly_count || 0) >= Number(settings.otp_hourly_limit || 5)) {
      return response.status(429).json({ ok: false, error: "تم تجاوز عدد طلبات رمز التحقق خلال الساعة" });
    }
    const challengeId = crypto.randomUUID();
    const otp = randomOtp();
    await sql`
      insert into owners.otp_challenges(id,phone_normalized,code_hash,max_attempts,expires_at)
      values(
        ${challengeId}::uuid,${phone},${ownerOtpHash(challengeId, phone, otp)},
        ${Number(settings.otp_max_attempts || 5)},now()+${Number(settings.otp_expiry_minutes || 5)}*interval '1 minute'
      )
    `;
    const expiryMinutes = Number(settings.otp_expiry_minutes || 5);
    try {
      const message = `رمز التحقق الخاص بك في MZJ Owners Community هو: ${otp}. الرمز صالح لمدة ${expiryMinutes} دقائق. لا تشارك الرمز مع أي شخص.`;
      await queueFirebaseSms({
        createdAt: new Date(),
        message,
        meta: {
          type: "owners_otp",
          purpose: "login",
          challengeId,
          expiresMinutes: expiryMinutes,
        },
        phone,
        source: "mzj_owners_community",
        status: "queued",
        to: phone,
      });
    } catch (error) {
      await sql`delete from owners.otp_challenges where id=${challengeId}::uuid`;
      const message = error instanceof Error ? error.message : "تعذر إرسال رمز التحقق عبر SMS+";
      return response.status(502).json({ ok: false, error: message });
    }
    return response.status(200).json({
      ok: true,
      challengeId,
      expiresMinutes: Number(settings.otp_expiry_minutes || 5),
    });
  }

  if (request.method === "POST" && action === "verify_otp") {
    const phone = normalizePhone(payload.phone);
    const code = clean(payload.code);
    const challengeId = clean(payload.challengeId);
    if (!phone || !/^\d{6}$/.test(code) || !challengeId) {
      return response.status(400).json({ ok: false, error: "بيانات التحقق غير مكتملة" });
    }
    const [challenge] = await sql<any[]>`
      select *
      from owners.otp_challenges
      where id=${challengeId}::uuid
        and phone_normalized=${phone}
        and consumed_at is null
      limit 1
    `;
    if (!challenge || new Date(challenge.expires_at).getTime() < Date.now()) {
      return response.status(400).json({ ok: false, error: "رمز التحقق منتهي أو غير صالح" });
    }
    if (Number(challenge.attempts) >= Number(challenge.max_attempts)) {
      return response.status(429).json({ ok: false, error: "تم تجاوز عدد المحاولات المسموح" });
    }
    const expectedHash = ownerOtpHash(challengeId, phone, code);
    if (!secureHashEquals(expectedHash, challenge.code_hash)) {
      await sql`update owners.otp_challenges set attempts=attempts+1 where id=${challengeId}::uuid`;
      return response.status(400).json({ ok: false, error: "رمز التحقق غير صحيح" });
    }

    const member = await ensureOwnerMemberByPhone(phone);
    if (!member) return response.status(404).json({ ok: false, error: "عضوية العميل غير موجودة" });
    await sql`update owners.otp_challenges set consumed_at=now() where id=${challengeId}::uuid`;
    await createOwnerSession(response, member.id);
    return response.status(200).json({ ok: true });
  }

  if (request.method === "POST" && action === "logout") {
    await clearOwnerSession(request, response);
    return response.status(200).json({ ok: true });
  }

  let member = await getOwnerSession(request);
  if (!member) return response.status(401).json({ ok: false, error: "يجب تسجيل الدخول" });
  await syncOwnerReferralProgress(member.id);
  const [refreshedMember] = await sql<any[]>`
    select *,id::text,crm_lead_id::text,source_sale_id::text
    from owners.members
    where id=${member.id}::uuid and status='active'
    limit 1
  `;
  if (refreshedMember) member = refreshedMember;

  if (request.method === "GET" && action === "me") {
    const referrals = await sql<any[]>`
      select id::text,referred_name,status,registered_at,qualified_at,sold_at,created_at
      from owners.referrals
      where referrer_member_id=${member.id}::uuid
      order by created_at desc
      limit 100
    `;
    const ledger = await sql<any[]>`
      select id::text,points,event_type,description,created_at
      from owners.points_ledger
      where member_id=${member.id}::uuid
      order by created_at desc
      limit 100
    `;
    const rewards = await sql<any[]>`
      select id::text,name,description,reward_type,reward_value,show_on_member_card,points_cost,stock_quantity,redeemed_quantity,referral_purchase_redeemed_quantity,starts_at,ends_at
      from owners.rewards
      where is_active=true
        and (starts_at is null or starts_at<=now())
        and (ends_at is null or ends_at>=now())
        and (stock_quantity is null or (redeemed_quantity+referral_purchase_redeemed_quantity)<stock_quantity)
      order by points_cost,name
    `;
    const redemptions = await sql<any[]>`
      select rd.id::text,rd.status,rd.points_cost,rd.created_at,r.name as reward_name
      from owners.redemptions rd
      join owners.rewards r on r.id=rd.reward_id
      where rd.member_id=${member.id}::uuid
      order by rd.created_at desc
      limit 50
    `;
    return response.status(200).json({
      ok: true,
      member: {
        id: member.id,
        name: member.customer_name,
        phone: member.phone_normalized,
        points: Number(member.points_balance || 0),
        lifetimePoints: Number(member.lifetime_points || 0),
        tier: member.tier_code,
        referralCode: member.referral_code,
        inviteUrl: `${publicBase(request)}/owners/invite/${member.referral_code}`,
      },
      referrals,
      ledger,
      rewards,
      redemptions,
    });
  }

  if (request.method === "POST" && action === "redeem") {
    const rewardId = clean(payload.rewardId);
    if (!rewardId) return response.status(400).json({ ok: false, error: "المكافأة مطلوبة" });

    const result = await sql.begin(async (tx) => {
      const [lockedMember] = await tx<any[]>`
        select points_balance from owners.members where id=${member.id}::uuid for update
      `;
      const [reward] = await tx<any[]>`
        select *
        from owners.rewards
        where id=${rewardId}::uuid
          and is_active=true
          and (starts_at is null or starts_at<=now())
          and (ends_at is null or ends_at>=now())
        for update
      `;
      if (!reward) return { error: "المكافأة غير متاحة" };
      if (reward.stock_quantity != null && Number(reward.redeemed_quantity || 0) + Number(reward.referral_purchase_redeemed_quantity || 0) >= Number(reward.stock_quantity)) {
        return { error: "نفدت كمية المكافأة" };
      }
      if (Number(lockedMember?.points_balance || 0) < Number(reward.points_cost)) {
        return { error: "رصيد النقاط غير كاف" };
      }

      const [redemption] = await tx<any[]>`
        insert into owners.redemptions(member_id,reward_id,points_cost)
        values(${member.id}::uuid,${rewardId}::uuid,${Number(reward.points_cost)})
        returning id::text
      `;
      await tx`
        insert into owners.points_ledger(member_id,points,event_type,event_key,reward_id,description)
        values(
          ${member.id}::uuid,${-Number(reward.points_cost)},'redemption',
          ${`redemption:${redemption.id}`},${rewardId}::uuid,${`طلب استبدال: ${reward.name}`}
        )
      `;
      await tx`
        update owners.members set points_balance=points_balance-${Number(reward.points_cost)},updated_at=now()
        where id=${member.id}::uuid
      `;
      await tx`
        update owners.rewards set redeemed_quantity=redeemed_quantity+1,updated_at=now()
        where id=${rewardId}::uuid
      `;
      return { ok: true };
    });
    if ("error" in result) return response.status(400).json({ ok: false, error: result.error });
    return response.status(200).json({ ok: true });
  }

  return response.status(405).json({ ok: false, error: "Method not allowed" });
}
