import crypto from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { attachLeadToContactAndOpenRequest } from "./_crm-lifecycle.js";
import { ensureCrmSchema } from "./_crm-schema.js";
import { queueFirebaseSms } from "./_firebase-sms.js";
import { chooseAssignment, clean } from "./_crm-utils.js";
import { getSql } from "./_db.js";
import { normalizePhone } from "./_phone-utils.js";
import {
  awardOwnerPoints,
  clearOwnerSession,
  createOwnerSession,
  createLegacyOwnerSession,
  ensureOwnerMemberByPhone,
  ensureOwnerMemberForLead,
  ensureOwnerPurchasePointsForMember,
  getOwnerSession,
  getLegacyOwnerSession,
  getOwnerSettings,
  ownerHash,
  ownerOtpHash,
  reverseOwnerCommerceForCancelledOrder,
  secureHashEquals,
  syncOwnerReferralProgress,
  type OwnerJson,
} from "./_owners.js";
import { ensureOwnersSchema } from "./_owners-schema.js";
import { ensureLegacyCustomerCodeForLead, findLegacyCustomerCodeByCode, findLegacyCustomerCodeByPhone, syncLegacyCustomerCodes } from "./_owners-customer-segments.js";
import { getWebsiteStock } from "./_website-stock.js";
import { ownerPurchaseLedger, ownerPurchaseSummary, ownerOwnsSalesOrder } from "./_owners-purchases.js";
import { downloadNextErpSalesInvoicePdf, listNextErpSalesInvoices, ownerInvoiceError } from "./_owners-invoices.js";
import { ensureMarketingSchema } from "./_marketing-schema.js";

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
  return crypto.randomInt(1000, 10000).toString();
}

function randomRedemptionCode() {
  return crypto.randomInt(0, 100_000_000).toString().padStart(8, "0");
}

function requestIp(request: VercelRequest) {
  return clean(request.headers["x-forwarded-for"] || request.headers["x-real-ip"] || "").split(",")[0].trim();
}

function publicBase(request: VercelRequest) {
  const protocol = String(request.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || "mzj-platform.vercel.app").split(",")[0];
  return `${protocol}://${host}`;
}

async function ownerPublicPackageCatalog() {
  await ensureMarketingSchema();
  const sql = getSql();
  const [categories, rows] = await Promise.all([
    sql<any[]>`select id::text,name,sort_order from marketing.package_categories where is_active=true order by sort_order,name`,
    sql<any[]>`
      select p.id::text,p.name,p.category_id::text,p.price,p.cash_discount,p.registration_fees,p.insurance,p.insurance_description,p.issuance_fees,p.care_features,p.delivery_home,p.delivery_region,
        coalesce(c.name,p.category) as category_name,coalesce(c.sort_order,999) as category_sort,coalesce(s.name,p.sales_type,'—') as sales_type_name
      from marketing.packages p
      left join marketing.package_categories c on c.id=p.category_id
      left join marketing.package_sales_types s on s.id=p.sales_type_id
      where p.is_active=true
      order by coalesce(c.sort_order,999),p.name
    `,
  ]);
  return {
    packageCategories: categories.map((row: any) => ({ id: row.id, name: row.name, sortOrder: Number(row.sort_order || 0) })),
    packages: rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      categoryId: row.category_id || "",
      categoryName: row.category_name || "",
      salesTypeName: row.sales_type_name || "",
      price: Number(row.price || 0),
      cashDiscount: Number(row.cash_discount || 0),
      registrationFees: row.registration_fees === true,
      insurance: row.insurance === true,
      insuranceDescription: clean(row.insurance_description),
      issuanceFees: row.issuance_fees === true,
      careFeatures: Array.isArray(row.care_features) ? row.care_features.map(clean).filter(Boolean) : [],
      deliveryHome: row.delivery_home === true,
      deliveryRegion: row.delivery_region === true,
    })),
  };
}

function allowedService(value: unknown) {
  const service = clean(value).toLowerCase();
  return ["cash", "finance", "service"].includes(service) ? service : "cash";
}

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(value));
}

function commerceOrderRoot(value: unknown) {
  let orderId = clean(value).slice(0, 180);
  const suffixes = [":primary", ":bonus", ":friend", ":new-customer", ":old-customer", ":personal-code", ":redemption"];
  let changed = true;
  while (changed && orderId) {
    changed = false;
    for (const suffix of suffixes) {
      if (orderId.endsWith(suffix)) {
        orderId = orderId.slice(0, -suffix.length);
        changed = true;
        break;
      }
    }
  }
  return orderId;
}

function personalCodeDiscountAmount(carPreTaxValue: unknown) {
  const carPreTax = Math.max(0, Number(carPreTaxValue || 0));
  if (!Number.isFinite(carPreTax) || carPreTax <= 0) return 0;
  const raw = carPreTax * 0.01;
  return Math.min(carPreTax, Math.floor((raw + 1e-9) / 100) * 100);
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

async function findCommerceCodeOwner(codeValue: unknown) {
  const member = await findReferrer(codeValue);
  if (member) return { ...member, referrer_kind: "member" as const, legacy_customer_code_id: null };
  await syncLegacyCustomerCodes();
  const legacy = await findLegacyCustomerCodeByCode(codeValue);
  if (!legacy) return null;
  return {
    id: legacy.id,
    customer_name: legacy.customer_name,
    phone_normalized: legacy.phone_normalized,
    referral_code: legacy.referral_code,
    metadata: { memberKind: "legacy" },
    member_kind: "legacy",
    referrer_kind: "legacy" as const,
    legacy_customer_code_id: legacy.id,
    crm_lead_id: legacy.crm_lead_id,
  };
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

  if (settings.points_unique_open_enabled === false) return true;
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
      description: "إرسال دعوة لصديق",
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
    return { status: 403, body: { ok: false, error: "MZJ Club Community غير متاح حاليًا" } };
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
    return { status: 409, body: { ok: false, error: "هذا الرقم عضو بالفعل في MZJ Club Community" } };
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
    if (settings.points_registration_enabled !== false) await awardOwnerPoints({
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
        ${name},${phone},${phone},'owners_referral','MZJ Club Community',${service},${department},
        ${assignment.branchCode || preferredBranch || null},'عميل جديد',${payment},${assignment.assignedTo || null}::uuid,
        ${assignment.assignedName || null},now(),${options.note || 'تم التسجيل من رابط دعوة MZJ Club Community'},${sql.json(leadMetadata)}
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
  if (settings.points_registration_enabled !== false) await awardOwnerPoints({
    memberId: referrer.id,
    points: Number(settings.points_registration || 0),
    eventType: "registration",
    eventKey: `registration:${referral.id}`,
    referralId: referral.id,
    description: "سجل صديق جديد من رابط الدعوة",
  });
  const customerCode = await ensureLegacyCustomerCodeForLead(lead.id).catch((error) => {
    console.error("Owners referral customer code creation failed", error);
    return null;
  });
  return {
    status: 200,
    body: {
      ok: true,
      message: options.successMessage || "تم تسجيل بياناتك وسيقوم فريق MZJ بالتواصل معك",
      customerCode: customerCode?.referral_code || null,
    },
    referralId: referral.id,
    leadId: lead.id,
    referrerId: referrer.id,
  };
}

async function registerReferral(response: VercelResponse, payload: Record<string, unknown>) {
  const result = await registerReferralCore(payload);
  return response.status(result.status).json(result.body);
}

/**
 * Website checkout rewards must never become the CRM acquisition source or owner.
 * The canonical website -> Next ERP -> CRM flow owns source/branch/department/assignee.
 * Here we only persist the Owners referral relation; processOwnerSaleForLead() links it
 * to the canonical CRM lead later by phone when the website Sales Order is synchronized.
 */
async function ensureWebsitePurchaseReferral(input: {
  referrerId: string;
  customerName: string;
  phone: string;
  websiteOrderId: string;
  selectedRewards: Record<string, unknown>[];
}) {
  const sql = getSql();
  const metadata = {
    source: "website_purchase",
    websiteOrderId: input.websiteOrderId,
    selectedRewards: input.selectedRewards,
    crmOwnershipPreserved: true,
  } as OwnerJson;

  const [existing] = await sql<any[]>`
    select id::text,referrer_member_id::text,crm_lead_id::text
    from owners.referrals
    where referred_phone_normalized=${input.phone}
    limit 1
  `;
  if (existing && existing.referrer_member_id !== input.referrerId) {
    throw new Error("REFERRAL_OWNER_CONFLICT");
  }

  const [referral] = await sql<any[]>`
    insert into owners.referrals(
      referrer_member_id,referred_name,referred_phone_normalized,status,registered_at,metadata
    ) values(
      ${input.referrerId}::uuid,${input.customerName},${input.phone},'registered',now(),${sql.json(metadata)}
    )
    on conflict(referred_phone_normalized) where referred_phone_normalized is not null do update set
      referred_name=excluded.referred_name,
      registered_at=coalesce(owners.referrals.registered_at,excluded.registered_at),
      status=case when owners.referrals.status='rejected' then 'registered' else owners.referrals.status end,
      metadata=coalesce(owners.referrals.metadata,'{}'::jsonb)||excluded.metadata,
      updated_at=now()
    returning id::text,crm_lead_id::text
  `;

  const settings = await getOwnerSettings();
  if (settings.points_registration_enabled !== false) await awardOwnerPoints({
    memberId: input.referrerId,
    points: Number(settings.points_registration || 0),
    eventType: "registration",
    eventKey: `registration:${referral.id}`,
    referralId: referral.id,
    description: "سجل صديق جديد من كود الدعوة أثناء طلب الموقع",
    metadata: { source: "website_purchase", websiteOrderId: input.websiteOrderId } as OwnerJson,
  });

  return referral.id as string;
}

type CommerceUseContext = "new_customer" | "old_customer" | "friend";

function commerceUseContext(value: unknown): CommerceUseContext | "" {
  const context = clean(value).toLowerCase();
  if (context === "new_customer" || context === "old_customer" || context === "friend") return context;
  return "";
}

async function commerceEligibility(codeValue: unknown, phoneValue: unknown, currentWebsiteOrderId = "", requestedContext: unknown = "") {
  const settings = await getOwnerSettings();
  if (settings.is_enabled === false) return { ok: false as const, status: 403, error: "MZJ Club Community غير متاح حاليًا" };
  const referrer = await findCommerceCodeOwner(codeValue);
  if (!referrer || referrer.member_kind === "test") {
    return { ok: false as const, status: 404, error: "كود الدعوة غير صالح للاستخدام في طلب الشراء" };
  }
  const phone = normalizePhone(phoneValue);
  if (!phone) return { ok: false as const, status: 400, error: "اكتب رقم جوال العميل بشكل صحيح" };

  const sql = getSql();
  const [priorBenefit] = await sql<any[]>`
    select id::text,website_order_id,next_erp_sales_order,customer_kind
    from owners.referral_purchase_benefits
    where referred_phone_normalized=${phone}
    order by created_at desc
    limit 1
  `;

  const [existingOwner] = await sql<any[]>`
    select id::text from owners.members where phone_normalized=${phone} and status='active' limit 1
  `;
  const [lead] = await sql<any[]>`
    select id::text,status_label
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

  const referrerKind = referrer.referrer_kind === "legacy" ? "legacy" as const : "member" as const;
  const selfUse = phone === referrer.phone_normalized;
  const inferredContext: CommerceUseContext = referrerKind === "legacy" ? "new_customer" : (selfUse ? "old_customer" : "friend");
  const useContext = commerceUseContext(requestedContext) || inferredContext;

  if (referrerKind === "legacy" && useContext !== "new_customer") {
    return { ok: false as const, status: 409, error: "كود العميل الجديد يُستخدم داخل خيار «عميل جديد» فقط" };
  }
  if (referrerKind === "member" && useContext === "new_customer") {
    return { ok: false as const, status: 409, error: "كود العميل الجديد يجب أن يكون من تبويب «العملاء الجديدة»" };
  }
  if (referrerKind === "legacy" && phone !== referrer.phone_normalized) {
    return { ok: false as const, status: 409, error: "كود العميل الجديد صالح لصاحب الكود فقط" };
  }
  if (referrerKind === "member" && useContext === "friend" && selfUse) {
    return { ok: false as const, status: 409, error: "لا يمكن استخدام كودك الشخصي كـ «دعوة من صديق»" };
  }
  if (referrerKind === "member" && useContext === "old_customer" && !selfUse) {
    return { ok: false as const, status: 409, error: "كود العميل القديم يجب أن يطابق رقم جوال صاحب العضوية" };
  }

  // The sold customer's own code is reusable on later purchases. When an order
  // id is available, expose only the row for that same order so repeated API
  // calls remain idempotent without blocking a different future purchase.
  let personalCodeUse: any = null;
  if (referrerKind === "member" && useContext === "old_customer") {
    const requestedRoot = commerceOrderRoot(currentWebsiteOrderId);
    if (requestedRoot) {
      [personalCodeUse] = await sql<any[]>`
        select id::text,website_order_id,used_by_phone_normalized,self_use,discount_amount
        from owners.personal_code_uses
        where member_id=${referrer.id}::uuid and website_order_id=${requestedRoot}
        limit 1
      `;
    }
  }

  let friendCodeUse: any = null;
  if (referrerKind === "member" && useContext === "friend") {
    [friendCodeUse] = await sql<any[]>`
      select id::text,website_order_id,next_erp_sales_order
      from owners.friend_code_uses
      where referrer_member_id=${referrer.id}::uuid
        and used_by_phone_normalized=${phone}
      limit 1
    `;
    if (friendCodeUse) {
      const requestedRoot = commerceOrderRoot(currentWebsiteOrderId);
      const usedRoot = commerceOrderRoot(friendCodeUse.website_order_id);
      if (!requestedRoot || requestedRoot !== usedRoot) {
        return { ok: false as const, status: 409, error: "سبق استخدام كود دعوة هذا الصديق مع رقم الجوال. استخدم كود دعوة من صديق آخر" };
      }
    }
  }

  const customerKind = referrerKind === "legacy"
    ? "existing" as const
    : (existingOwner || priorSale || priorBenefit ? "existing" as const : "new" as const);

  if (selfUse && useContext === "old_customer") {
    if (referrerKind === "member" && (customerKind !== "existing" || !existingOwner)) {
      return { ok: false as const, status: 409, error: "كود العميل القديم متاح لعميل MZJ السابق فقط" };
    }
    // No cross-order one-use check here: the same sold customer may use their
    // own code again on a later purchase. Per-order uniqueness is enforced by
    // the benefit and personal-code ledgers.
  }

  const [linkedReferral] = await sql<any[]>`
    select id::text,referrer_member_id::text,status,crm_lead_id::text
    from owners.referrals
    where referred_phone_normalized=${phone}
    limit 1
  `;
  if (referrerKind === "member" && useContext === "friend" && customerKind === "new" && linkedReferral && linkedReferral.referrer_member_id !== referrer.id) {
    return { ok: false as const, status: 409, error: "هذا العميل مرتبط بكود دعوة آخر بالفعل" };
  }

  return {
    ok: true as const,
    referrer,
    referrerKind,
    phone,
    customerKind,
    selfUse,
    useContext,
    existingOwner: existingOwner || null,
    priorBenefit: priorBenefit || null,
    personalCodeUse: personalCodeUse || null,
    friendCodeUse: friendCodeUse || null,
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
    availableForFriendReferral: reward.available_for_friend_referral_purchase === true,
    availableForRepurchase: reward.available_for_repurchase === true,
    startsAt: reward.starts_at || null,
    endsAt: reward.ends_at || null,
  };
}

type CommerceReferrerKind = "legacy" | "member";

function rewardAvailableForReferrerKind(reward: any, referrerKind: CommerceReferrerKind, selfUse: boolean) {
  if (referrerKind === "legacy") return reward?.available_for_referral_purchase === true;
  return selfUse
    ? reward?.available_for_existing_customer_purchase === true
    : reward?.available_for_friend_referral_purchase === true;
}

async function getCommerceRewards(referrerKind: CommerceReferrerKind, selfUse: boolean, rewardId?: string) {
  const sql = getSql();
  const rows = await sql<any[]>`
    select
      id::text,name,description,reward_type,reward_value,
      available_for_referral_purchase,available_for_existing_customer_purchase,available_for_friend_referral_purchase,available_for_repurchase,
      checkout_discount_type,checkout_discount_value,checkout_discount_amount,
      stock_quantity,redeemed_quantity,referral_purchase_redeemed_quantity,starts_at,ends_at
    from owners.rewards
    where is_active=true
      and (
        (${referrerKind}='legacy' and available_for_referral_purchase=true)
        or (${referrerKind}='member' and ${selfUse === true}=true and available_for_existing_customer_purchase=true)
        or (${referrerKind}='member' and ${selfUse === true}=false and available_for_friend_referral_purchase=true)
        or (${referrerKind}='member' and ${selfUse === true}=true and available_for_repurchase=true)
      )
      and (starts_at is null or starts_at<=now())
      and (ends_at is null or ends_at>=now())
      and (stock_quantity is null or (redeemed_quantity+referral_purchase_redeemed_quantity)<stock_quantity)
      and (${clean(rewardId) || null}::uuid is null or id=${clean(rewardId) || null}::uuid)
    order by name,id
  `;
  return rows;
}

async function handleCommerceCustomerByPhone(request: VercelRequest, response: VercelResponse, payload: Record<string, unknown>) {
  const auth = commerceApiAuthorized(request);
  if (!auth.ok) return response.status(auth.status).json({ ok: false, error: auth.error });
  const phone = normalizePhone(payload.phone ?? payload.mobile ?? payload.phoneNumber ?? payload.phone_number);
  if (!phone) return response.status(400).json({ ok: false, error: "اكتب رقم جوال سعودي صحيح بصيغة 05xxxxxxxx" });

  await syncLegacyCustomerCodes();
  const member = await ensureOwnerMemberByPhone(phone);
  if (member?.id && member?.referral_code) {
    return response.status(200).json({
      ok: true,
      found: true,
      customerMode: "old_customer",
      profileKind: "member",
      referrerKind: "member",
      memberId: member.id,
      customerName: member.customer_name || "",
      customerCode: member.referral_code,
      message: "تم التعرف على العميل القديم وجلب الكود الشخصي",
    });
  }

  const legacyCustomer = await findLegacyCustomerCodeByPhone(phone);
  if (legacyCustomer?.id && legacyCustomer?.referral_code) {
    return response.status(200).json({
      ok: true,
      found: true,
      customerMode: "new_customer",
      profileKind: "legacy",
      referrerKind: "legacy",
      leadId: legacyCustomer.crm_lead_id || "",
      customerName: legacyCustomer.customer_name || "",
      customerCode: legacyCustomer.referral_code,
      message: "تم التعرف على العميل الجديد وجلب كود العميل",
    });
  }

  return response.status(404).json({
    ok: false,
    found: false,
    customerMode: "new_customer",
    requiresRegistration: true,
    error: "رقم الجوال غير مسجل بعد. استخدم احصل على كود الخصم لتسجيل العميل الجديد.",
  });
}

async function queueCommerceCustomerCodeSms(input: { name: unknown; phone: unknown; code: unknown; leadId?: unknown }) {
  const phone = normalizePhone(input.phone);
  const code = clean(input.code).toUpperCase();
  if (!phone || !code) throw new Error("بيانات رسالة كود الخصم غير مكتملة");
  const customerName = clean(input.name) || "عميل MZJ CARS";
  const message = `مرحباً : ${customerName}\nكود الخصم الخاص بك في MZJ CARS:\n${code}\n\nتاريخ تثق به`;
  return await queueFirebaseSms({
    createdAt: new Date(),
    message,
    meta: {
      type: "owners_customer_code",
      purpose: "website_checkout_discount_code",
      leadId: clean(input.leadId),
      referralCode: code,
    },
    phone,
    source: "mzj_owners_community",
    status: "queued",
    to: phone,
  });
}

async function handleCommerceNewCustomerCode(request: VercelRequest, response: VercelResponse, payload: Record<string, unknown>) {
  const auth = commerceApiAuthorized(request);
  if (!auth.ok) return response.status(auth.status).json({ ok: false, error: auth.error });

  await ensureCrmSchema();
  const customerName = clean(payload.name ?? payload.customerName ?? payload.customer_name);
  const phoneRaw = clean(payload.phone ?? payload.mobile ?? payload.phoneNumber ?? payload.phone_number);
  const phone = normalizePhone(phoneRaw);
  if (!customerName) return response.status(400).json({ ok: false, error: "اسم العميل مطلوب" });
  if (!phone) return response.status(400).json({ ok: false, error: "اكتب رقم جوال سعودي صحيح بصيغة 05xxxxxxxx" });

  const sql = getSql();
  let [lead] = await sql<any[]>`
    select id::text,customer_name,phone_normalized,status_label,source_code,branch_code,assigned_to::text
    from crm.leads
    where phone_normalized=${phone} and is_deleted=false
    order by created_at
    limit 1
  `;
  let created = false;

  if (lead) {
    const [priorSale] = await sql<any[]>`
      select id::text
      from crm.sales_transactions
      where lead_id=${lead.id}::uuid and coalesce(is_cancelled,false)=false
      limit 1
    `;
    if (priorSale || clean(lead.status_label) === "تم البيع") {
      return response.status(409).json({
        ok: false,
        error: "رقم الجوال مسجل كعميل قديم. اختر «عميل قديم» واستخدم الكود الشخصي.",
      });
    }
  } else {
    const [websiteOwner] = await sql<any[]>`
      select id::text,full_name
      from core.users
      where employee_no='SYSTEM-WEBSITE' and is_active=true
      limit 1
    `;
    if (!websiteOwner?.id) {
      return response.status(500).json({ ok: false, error: "تعذر تهيئة مسؤول Website لتسجيل العميل" });
    }

    const leadMetadata = {
      websiteDiscountCodeRequest: true,
      intakeChannel: "website_checkout_discount",
      routingMode: "fixed_website",
      routingBranch: "website",
      routingOwner: "Website",
    } as OwnerJson;

    [lead] = await sql<any[]>`
      insert into crm.leads(
        customer_name,phone,phone_normalized,source_code,source_name,platform_code,
        service_key,department_code,branch_code,status_label,payment_type,
        assigned_to,responsible_name_snapshot,registered_at,notes,extra_data
      ) values(
        ${customerName},${phoneRaw || phone},${phone},'website','Website','website_checkout_discount',
        'cash','cash_sales','website','عميل جديد','كاش',
        ${websiteOwner.id}::uuid,'Website',now(),'طلب كود خصم عميل جديد من صفحة شراء السيارة بالموقع',${sql.json(leadMetadata)}
      )
      returning id::text,customer_name,phone_normalized,status_label,source_code,branch_code,assigned_to::text
    `;

    await attachLeadToContactAndOpenRequest({
      leadId: lead.id,
      actor: null,
      classificationMethod: "website_checkout_discount",
    }).catch((error) => console.error("Website checkout discount CRM contact link failed", error));

    await sql`
      insert into crm.lead_events(
        lead_id,event_type,new_status,new_department,new_branch,actor_name,actor_role,note
      ) values(
        ${lead.id}::uuid,'lead_created','عميل جديد','cash_sales','website',
        'Website','website_checkout','تم تسجيل العميل من زر احصل على كود الخصم في صفحة شراء السيارة'
      )
    `;
    created = true;
  }

  const customerCode = await ensureLegacyCustomerCodeForLead(lead.id, { sd96: true });
  if (!customerCode?.referral_code) {
    return response.status(500).json({ ok: false, error: "تم تسجيل العميل لكن تعذر إنشاء كود الخصم" });
  }

  let customerCodeSmsQueued = false;
  let smsDocumentId = "";
  let customerCodeSmsError = "";
  try {
    const queued = await queueCommerceCustomerCodeSms({
      name: customerName,
      phone,
      code: customerCode.referral_code,
      leadId: lead.id,
    });
    customerCodeSmsQueued = true;
    smsDocumentId = clean(queued?.documentId);
  } catch (error) {
    customerCodeSmsError = error instanceof Error ? error.message : "تعذر إرسال كود الخصم عبر SMS+";
    console.error("Website checkout customer-code SMS+ queue failed", error);
  }

  return response.status(created ? 201 : 200).json({
    ok: true,
    created,
    leadId: lead.id,
    customerCode: customerCode.referral_code,
    customerCodeSmsQueued,
    smsDocumentId,
    customerCodeSmsError: customerCodeSmsError || undefined,
    message: customerCodeSmsQueued
      ? (created ? "تم تسجيل بياناتك في CRM و MZJ Club وإرسال كود الخصم على الجوال" : "تم العثور على بياناتك وإرسال كود الخصم على الجوال")
      : (created ? "تم تسجيل بياناتك وتجهيز كود الخصم لكن تعذر إرسال SMS+" : "تم العثور على بياناتك وتجهيز الكود لكن تعذر إرسال SMS+"),
  });
}

async function handleCommerceRewards(request: VercelRequest, response: VercelResponse, payload: Record<string, unknown>) {
  const auth = commerceApiAuthorized(request);
  if (!auth.ok) return response.status(auth.status).json({ ok: false, error: auth.error });
  const eligibility = await commerceEligibility(payload.code, payload.phone, "", payload.context);
  if (!eligibility.ok) return response.status(eligibility.status).json({ ok: false, error: eligibility.error });

  const rewards = await getCommerceRewards(eligibility.referrerKind, eligibility.selfUse === true);
  const newCustomerRewards = rewards
    .filter((reward: any) => reward.available_for_referral_purchase === true)
    .map(commerceRewardPayload);
  const existingCustomerRewards = rewards
    .filter((reward: any) => reward.available_for_existing_customer_purchase === true)
    .map(commerceRewardPayload);
  const friendReferralRewards = rewards
    .filter((reward: any) => reward.available_for_friend_referral_purchase === true)
    .map(commerceRewardPayload);
  const repurchaseRewards = rewards
    .filter((reward: any) => reward.available_for_repurchase === true)
    .map(commerceRewardPayload);
  const primaryNewReward = eligibility.referrerKind === "legacy" ? (newCustomerRewards[0] || null) : null;
  return response.status(200).json({
    ok: true,
    eligible: true,
    referralCode: eligibility.referrer.referral_code,
    referrerName: eligibility.referrer.customer_name || "عميل MZJ",
    referrerKind: eligibility.referrerKind,
    customerKind: eligibility.customerKind,
    selfUse: eligibility.selfUse === true,
    // Backward-compatible field for older clients. Member-code reward audience is separated by phone ownership (self = old customer, different phone = friend referral).
    primaryNewRewardId: primaryNewReward?.id || null,
    newCustomerRewardIds: newCustomerRewards.map((reward: any) => reward.id),
    newCustomerRewards,
    existingCustomerRewards,
    friendReferralRewardIds: friendReferralRewards.map((reward: any) => reward.id),
    friendReferralRewards,
    repurchaseRewardIds: repurchaseRewards.map((reward: any) => reward.id),
    repurchaseRewards,
    personalCodeEligible: eligibility.referrerKind === "member",
    personalCodeDiscountRate: eligibility.referrerKind === "member" ? 1 : 0,
    personalCodeRoundingUnit: eligibility.referrerKind === "member" ? 100 : 0,
    personalCodeRoundingMode: eligibility.referrerKind === "member" ? "floor" : "none",
    friendReferralDiscountRate: eligibility.referrerKind === "member" && eligibility.selfUse !== true ? 1 : 0,
    friendReferralRoundingUnit: eligibility.referrerKind === "member" && eligibility.selfUse !== true ? 100 : 0,
    friendReferralRoundingMode: eligibility.referrerKind === "member" && eligibility.selfUse !== true ? "floor" : "none",
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

  const eligibility = await commerceEligibility(payload.code, phone, websiteOrderId, payload.context);
  if (!eligibility.ok) return response.status(eligibility.status).json({ ok: false, error: eligibility.error });
  const rewards = await getCommerceRewards(eligibility.referrerKind, eligibility.selfUse === true, rewardId);
  const reward = rewards[0];
  if (!reward) return response.status(409).json({ ok: false, error: "المكافأة المختارة لم تعد متاحة" });

  const rewardSnapshot = commerceRewardPayload(reward);
  let referralId: string | null = null;
  const referrerId = eligibility.referrerKind === "member" ? eligibility.referrer.id as string : null;
  const legacyCustomerCodeId = eligibility.referrerKind === "legacy" ? eligibility.referrer.id as string : null;
  if (eligibility.customerKind === "new" && eligibility.referrerKind === "member") {
    try {
      referralId = await ensureWebsitePurchaseReferral({
        referrerId: eligibility.referrer.id,
        customerName,
        phone,
        websiteOrderId,
        selectedRewards: [rewardSnapshot],
      });
    } catch (error) {
      if (error instanceof Error && error.message === "REFERRAL_OWNER_CONFLICT") {
        return response.status(409).json({ ok: false, error: "هذا العميل مرتبط بكود دعوة آخر بالفعل" });
      }
      throw error;
    }
  }

  try {
    const benefit = await sql.begin(async (tx) => {
      if (eligibility.referrerKind === "member" && eligibility.useContext === "friend") {
        const rootWebsiteOrderId = commerceOrderRoot(websiteOrderId);
        const rows = await tx<any[]>`
          insert into owners.friend_code_uses(
            referrer_member_id,code_snapshot,used_by_phone_normalized,website_order_id,next_erp_sales_order
          ) values(
            ${eligibility.referrer.id}::uuid,${eligibility.referrer.referral_code},${phone},${rootWebsiteOrderId},${nextErpSalesOrder}
          )
          on conflict(referrer_member_id,used_by_phone_normalized) do update set
            next_erp_sales_order=coalesce(owners.friend_code_uses.next_erp_sales_order,excluded.next_erp_sales_order),
            updated_at=now()
          where owners.friend_code_uses.website_order_id=excluded.website_order_id
          returning id::text
        `;
        if (!rows.length) throw new Error("FRIEND_CODE_ALREADY_USED_BY_PHONE");
      }
      const [lockedReward] = await tx<any[]>`
        select id::text,stock_quantity,redeemed_quantity,referral_purchase_redeemed_quantity,is_active,starts_at,ends_at,
          available_for_referral_purchase,available_for_existing_customer_purchase,available_for_friend_referral_purchase
        from owners.rewards
        where id=${rewardId}::uuid
        for update
      `;
      const now = Date.now();
      const available = lockedReward
        && lockedReward.is_active === true
        && rewardAvailableForReferrerKind(lockedReward, eligibility.referrerKind, eligibility.selfUse === true)
        && (!lockedReward.starts_at || new Date(lockedReward.starts_at).getTime() <= now)
        && (!lockedReward.ends_at || new Date(lockedReward.ends_at).getTime() >= now)
        && (lockedReward.stock_quantity == null
          || Number(lockedReward.redeemed_quantity || 0) + Number(lockedReward.referral_purchase_redeemed_quantity || 0) < Number(lockedReward.stock_quantity));
      if (!available) throw new Error("REWARD_NOT_AVAILABLE");

      const metadata = { source: "website_purchase", referralCode: eligibility.referrer.referral_code, referrerKind: eligibility.referrerKind, customerKind: eligibility.customerKind, selfUse: eligibility.selfUse === true } as OwnerJson;
      const [inserted] = await tx<any[]>`
        insert into owners.referral_purchase_benefits(
          referral_id,referrer_member_id,legacy_customer_code_id,referrer_kind,referred_phone_normalized,customer_kind,reward_id,reward_name,reward_type,reward_value,
          checkout_discount_type,checkout_discount_value,checkout_discount_amount,website_order_id,next_erp_sales_order,metadata
        ) values(
          ${referralId}::uuid,${referrerId}::uuid,${legacyCustomerCodeId}::uuid,${eligibility.referrerKind},${phone},${eligibility.customerKind},${rewardSnapshot.id}::uuid,
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
      referrerKind: eligibility.referrerKind,
      customerKind: eligibility.customerKind,
      selfUse: eligibility.selfUse === true,
      reward: rewardSnapshot,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "REWARD_NOT_AVAILABLE") {
      return response.status(409).json({ ok: false, error: "المكافأة المختارة نفدت أو توقفت قبل تأكيد الطلب" });
    }
    if (message === "FRIEND_CODE_ALREADY_USED_BY_PHONE") {
      return response.status(409).json({ ok: false, error: "سبق استخدام كود دعوة هذا الصديق مع رقم الجوال. استخدم كود دعوة من صديق آخر" });
    }
    if (/unique|duplicate|referral_purchase_benefits/i.test(message)) {
      return response.status(409).json({ ok: false, error: "\u0631\u0642\u0645 \u0637\u0644\u0628 \u0627\u0644\u0645\u0648\u0642\u0639 \u0645\u0633\u062a\u062e\u062f\u0645 \u0628\u0627\u0644\u0641\u0639\u0644" });
    }
    throw error;
  }
}

function primaryNewReward(rows: any[]) {
  return rows.find((reward: any) => reward.available_for_referral_purchase === true && reward.available_for_existing_customer_purchase !== true)
    || rows.find((reward: any) => reward.available_for_referral_purchase === true)
    || null;
}

function benefitRewardPayload(row: any) {
  const discountType = row.checkout_discount_type === "percentage" ? "percentage" : "amount";
  const discountValue = Number(row.checkout_discount_value || row.checkout_discount_amount || 0);
  return {
    id: row.reward_id,
    name: row.reward_name,
    type: row.reward_type,
    value: row.reward_value || "",
    discountType,
    discountValue,
    discountAmount: discountType === "amount" ? discountValue : 0,
    discountPercent: discountType === "percentage" ? discountValue : 0,
  };
}

async function handleCommerceConfirmBundle(request: VercelRequest, response: VercelResponse, payload: Record<string, unknown>) {
  const auth = commerceApiAuthorized(request);
  if (!auth.ok) return response.status(auth.status).json({ ok: false, error: auth.error });

  const websiteOrderId = clean(payload.websiteOrderId).slice(0, 150);
  const primaryRewardId = clean(payload.primaryRewardId);
  const bonusRewardId = clean(payload.bonusRewardId);
  const customerName = clean(payload.name);
  const phone = normalizePhone(payload.phone);
  const nextErpSalesOrder = clean(payload.nextErpSalesOrder).slice(0, 160) || null;
  if (!websiteOrderId) return response.status(400).json({ ok: false, error: "رقم طلب الموقع مطلوب" });
  if (!primaryRewardId || !isUuid(primaryRewardId)) return response.status(400).json({ ok: false, error: "المكافأة الأساسية غير صحيحة" });
  if (bonusRewardId && !isUuid(bonusRewardId)) return response.status(400).json({ ok: false, error: "المكافأة الإضافية غير صحيحة" });
  if (bonusRewardId && bonusRewardId === primaryRewardId) return response.status(400).json({ ok: false, error: "اختر مكافأة إضافية مختلفة" });
  if (!customerName) return response.status(400).json({ ok: false, error: "اسم العميل مطلوب" });
  if (!phone) return response.status(400).json({ ok: false, error: "رقم جوال العميل غير صحيح" });

  const primaryOrderId = `${websiteOrderId}:primary`;
  const bonusOrderId = `${websiteOrderId}:bonus`;
  const expectedOrderIds = bonusRewardId ? [primaryOrderId, bonusOrderId] : [primaryOrderId];
  const sql = getSql();

  const existingRows = await sql<any[]>`
    select id::text,referral_id::text,referrer_member_id::text,referred_phone_normalized,customer_kind,
      reward_id::text,reward_name,reward_type,reward_value,checkout_discount_type,checkout_discount_value,
      checkout_discount_amount,website_order_id,next_erp_sales_order,metadata
    from owners.referral_purchase_benefits
    where website_order_id in (${primaryOrderId},${bonusRewardId ? bonusOrderId : "__no_bonus__"})
    order by created_at,id
  `;
  for (const row of existingRows) {
    if (row.referred_phone_normalized !== phone) {
      return response.status(409).json({ ok: false, error: "رقم طلب الموقع مستخدم مع عميل آخر" });
    }
  }
  const existingByOrder = new Map(existingRows.map((row: any) => [String(row.website_order_id), row]));
  const alreadyComplete = expectedOrderIds.every((id) => existingByOrder.has(id));
  if (alreadyComplete) {
    if (nextErpSalesOrder) {
      await sql`
        update owners.referral_purchase_benefits
        set next_erp_sales_order=${nextErpSalesOrder},updated_at=now()
        where website_order_id in (${primaryOrderId},${bonusRewardId ? bonusOrderId : "__no_bonus__"})
          and coalesce(next_erp_sales_order,'')<>${nextErpSalesOrder}
      `;
    }
    const orderedRows = expectedOrderIds.map((id) => existingByOrder.get(id)).filter(Boolean);
    return response.status(200).json({
      ok: true,
      duplicate: true,
      referralId: orderedRows[0]?.referral_id || null,
      benefitIds: orderedRows.map((row: any) => row.id),
      referralCode: clean(payload.code).toUpperCase(),
      nextErpSalesOrder: nextErpSalesOrder || orderedRows[0]?.next_erp_sales_order || null,
      customerKind: orderedRows[0]?.customer_kind || "existing",
      selfUse: orderedRows.some((row: any) => row.metadata?.selfUse === true || row.metadata?.selfUse === "true"),
      rewards: orderedRows.map(benefitRewardPayload),
    });
  }

  const eligibility = await commerceEligibility(payload.code, phone, websiteOrderId, payload.context);
  if (!eligibility.ok) return response.status(eligibility.status).json({ ok: false, error: eligibility.error });
  const availableRewards = await getCommerceRewards(eligibility.referrerKind, eligibility.selfUse === true);
  let primaryReward: any = null;
  let bonusReward: any = null;

  const repurchaseEligible = eligibility.referrerKind === "member" && eligibility.selfUse === true && eligibility.customerKind === "existing";
  primaryReward = availableRewards.find((reward: any) =>
    String(reward.id) === primaryRewardId && (
      rewardAvailableForReferrerKind(reward, eligibility.referrerKind, eligibility.selfUse === true)
      || (repurchaseEligible && reward.available_for_repurchase === true)
    )
  ) || null;
  if (!primaryReward) {
    const error = eligibility.referrerKind === "legacy"
      ? "مكافأة العميل الجديد المختارة لم تعد متاحة"
      : eligibility.selfUse
        ? "مكافأة العميل القديم أو إعادة الشراء المختارة لم تعد متاحة"
        : "مكافأة دعوة من صديق المختارة لم تعد متاحة";
    return response.status(409).json({ ok: false, error });
  }
  if (bonusRewardId) {
    if (repurchaseEligible) {
      bonusReward = availableRewards.find((reward: any) =>
        String(reward.id) === bonusRewardId && reward.available_for_repurchase === true
      ) || null;
    } else if (eligibility.customerKind === "new") {
      bonusReward = availableRewards.find((reward: any) =>
        String(reward.id) === bonusRewardId && rewardAvailableForReferrerKind(reward, eligibility.referrerKind, eligibility.selfUse === true)
      ) || null;
    } else {
      return response.status(400).json({ ok: false, error: "المكافأة الإضافية غير متاحة لهذا الطلب" });
    }
    if (!bonusReward) return response.status(409).json({ ok: false, error: "المكافأة الإضافية لم تعد متاحة" });
  }

  const selectedRewards = [primaryReward, bonusReward].filter(Boolean);
  const rewardSnapshots = selectedRewards.map(commerceRewardPayload);
  let referralId: string | null = existingRows[0]?.referral_id || null;
  if (eligibility.customerKind === "new" && eligibility.referrerKind === "member" && !referralId) {
    try {
      referralId = await ensureWebsitePurchaseReferral({
        referrerId: eligibility.referrer.id,
        customerName,
        phone,
        websiteOrderId,
        selectedRewards: rewardSnapshots,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "REFERRAL_OWNER_CONFLICT") {
        return response.status(409).json({ ok: false, error: "هذا العميل مرتبط بكود دعوة آخر بالفعل" });
      }
      throw error;
    }
  }

  try {
    const insertedRows = await sql.begin(async (tx) => {
      const result: any[] = [];
      if (eligibility.referrerKind === "member" && eligibility.useContext === "friend") {
        const rootWebsiteOrderId = commerceOrderRoot(websiteOrderId);
        const rows = await tx<any[]>`
          insert into owners.friend_code_uses(
            referrer_member_id,code_snapshot,used_by_phone_normalized,website_order_id,next_erp_sales_order
          ) values(
            ${eligibility.referrer.id}::uuid,${eligibility.referrer.referral_code},${phone},${rootWebsiteOrderId},${nextErpSalesOrder}
          )
          on conflict(referrer_member_id,used_by_phone_normalized) do update set
            next_erp_sales_order=coalesce(owners.friend_code_uses.next_erp_sales_order,excluded.next_erp_sales_order),
            updated_at=now()
          where owners.friend_code_uses.website_order_id=excluded.website_order_id
          returning id::text
        `;
        if (!rows.length) throw new Error("FRIEND_CODE_ALREADY_USED_BY_PHONE");
      }
      for (let index = 0; index < selectedRewards.length; index += 1) {
        const selected = selectedRewards[index];
        const snapshot = rewardSnapshots[index];
        const slot = index === 0 ? "primary" : "bonus";
        const slotOrderId = slot === "primary" ? primaryOrderId : bonusOrderId;
        const existing = existingByOrder.get(slotOrderId);
        if (existing) {
          result.push(existing);
          continue;
        }
        const [lockedReward] = await tx<any[]>`
          select id::text,stock_quantity,redeemed_quantity,referral_purchase_redeemed_quantity,is_active,starts_at,ends_at,
            available_for_referral_purchase,available_for_existing_customer_purchase,available_for_friend_referral_purchase,available_for_repurchase
          from owners.rewards
          where id=${selected.id}::uuid
          for update
        `;
        const now = Date.now();
        const repurchaseOk = repurchaseEligible && lockedReward?.available_for_repurchase === true;
        const audienceOk = slot === "bonus" && repurchaseEligible
          ? repurchaseOk
          : (rewardAvailableForReferrerKind(lockedReward, eligibility.referrerKind, eligibility.selfUse === true) || repurchaseOk);
        const available = lockedReward
          && lockedReward.is_active === true
          && audienceOk
          && (!lockedReward.starts_at || new Date(lockedReward.starts_at).getTime() <= now)
          && (!lockedReward.ends_at || new Date(lockedReward.ends_at).getTime() >= now)
          && (lockedReward.stock_quantity == null
            || Number(lockedReward.redeemed_quantity || 0) + Number(lockedReward.referral_purchase_redeemed_quantity || 0) < Number(lockedReward.stock_quantity));
        if (!available) throw new Error("REWARD_NOT_AVAILABLE");

        const metadata = {
          source: "website_purchase",
            referrerKind: eligibility.referrerKind,
          customerKind: eligibility.customerKind,
          selfUse: eligibility.selfUse === true,
          baseWebsiteOrderId: websiteOrderId,
          rewardSlot: slot,
          repurchaseReward: selected.available_for_repurchase === true,
        } as OwnerJson;
        const [inserted] = await tx<any[]>`
          insert into owners.referral_purchase_benefits(
            referral_id,referrer_member_id,legacy_customer_code_id,referrer_kind,referred_phone_normalized,customer_kind,reward_id,reward_name,reward_type,reward_value,
            checkout_discount_type,checkout_discount_value,checkout_discount_amount,website_order_id,next_erp_sales_order,metadata
          ) values(
            ${referralId}::uuid,${eligibility.referrerKind === "member" ? eligibility.referrer.id : null}::uuid,${eligibility.referrerKind === "legacy" ? eligibility.referrer.id : null}::uuid,${eligibility.referrerKind},${phone},${eligibility.customerKind},${snapshot.id}::uuid,
            ${snapshot.name},${snapshot.type},${snapshot.value || null},${snapshot.discountType},${snapshot.discountValue},${snapshot.discountAmount},
            ${slotOrderId},${nextErpSalesOrder},${tx.json(metadata)}
          )
          returning id::text,referral_id::text,referrer_member_id::text,referred_phone_normalized,customer_kind,
            reward_id::text,reward_name,reward_type,reward_value,checkout_discount_type,checkout_discount_value,
            checkout_discount_amount,website_order_id,next_erp_sales_order,metadata
        `;
        await tx`
          update owners.rewards set
            referral_purchase_redeemed_quantity=referral_purchase_redeemed_quantity+1,
            updated_at=now()
          where id=${snapshot.id}::uuid
        `;
        result.push(inserted);
      }
      if (referralId) {
        await tx`
          update owners.referrals set
            metadata=coalesce(metadata,'{}'::jsonb)||${tx.json({
              websitePurchaseBenefitIds: result.map((row: any) => row.id),
              websiteOrderId,
              selectedRewards: rewardSnapshots,
            } as OwnerJson)}::jsonb,
            updated_at=now()
          where id=${referralId}::uuid
        `;
      }
      return result;
    });

    return response.status(200).json({
      ok: true,
      referralId,
      benefitIds: insertedRows.map((row: any) => row.id),
      referralCode: eligibility.referrer.referral_code,
      referrerKind: eligibility.referrerKind,
      nextErpSalesOrder,
      customerKind: eligibility.customerKind,
      selfUse: eligibility.selfUse === true,
      rewards: rewardSnapshots,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "REWARD_NOT_AVAILABLE") {
      return response.status(409).json({ ok: false, error: "إحدى المكافآت المختارة نفدت أو توقفت قبل تأكيد الطلب" });
    }
    if (message === "FRIEND_CODE_ALREADY_USED_BY_PHONE") {
      return response.status(409).json({ ok: false, error: "سبق استخدام كود دعوة هذا الصديق مع رقم الجوال. استخدم كود دعوة من صديق آخر" });
    }
    if (/unique|duplicate|referral_purchase_benefits/i.test(message)) {
      return response.status(409).json({ ok: false, error: "رقم طلب الموقع مستخدم بالفعل" });
    }
    throw error;
  }
}

async function handleCommercePersonalCodeUse(request: VercelRequest, response: VercelResponse, payload: Record<string, unknown>) {
  const auth = commerceApiAuthorized(request);
  if (!auth.ok) return response.status(auth.status).json({ ok: false, error: auth.error });
  const code = clean(payload.code).toUpperCase();
  const phone = normalizePhone(payload.phone);
  const websiteOrderId = commerceOrderRoot(payload.websiteOrderId);
  const vehicleId = clean(payload.vehicleId).slice(0, 120) || null;
  const carPreTax = Math.max(0, Number(payload.carPreTax || 0));
  const discountAmount = Math.max(0, Number(payload.discountAmount || 0));
  const nextErpSalesOrder = clean(payload.nextErpSalesOrder).slice(0, 160) || null;
  if (!code) return response.status(400).json({ ok: false, error: "الكود الشخصي مطلوب" });
  if (!phone) return response.status(400).json({ ok: false, error: "رقم جوال العميل غير صحيح" });
  if (!websiteOrderId) return response.status(400).json({ ok: false, error: "رقم طلب الموقع مطلوب" });
  if (!Number.isFinite(carPreTax) || carPreTax <= 0) return response.status(400).json({ ok: false, error: "سعر السيارة قبل الضريبة غير صحيح" });
  const expectedDiscount = personalCodeDiscountAmount(carPreTax);
  if (Math.abs(discountAmount - expectedDiscount) > 0.01) {
    return response.status(409).json({ ok: false, error: "قيمة خصم الكود الشخصي لا تطابق قاعدة 1% والتقريب لأسفل" });
  }
  const owner = await findCommerceCodeOwner(code);
  if (!owner || owner.referrer_kind !== "member" || owner.member_kind === "test") {
    return response.status(404).json({ ok: false, error: "كود العميل القديم غير صالح" });
  }
  const selfUse = phone === owner.phone_normalized;
  if (!selfUse) return response.status(409).json({ ok: false, error: "كود العميل القديم يجب أن يطابق رقم جوال صاحب العضوية" });
  const sql = getSql();
  try {
    const result = await sql.begin(async (tx) => {
      const [existing] = await tx<any[]>`
        select id::text,member_id::text,website_order_id,used_by_phone_normalized,self_use,vehicle_id,car_pre_tax,discount_amount,next_erp_sales_order
        from owners.personal_code_uses
        where website_order_id=${websiteOrderId}
        for update
      `;
      if (existing) {
        if (existing.member_id !== owner.id) {
          return { error: "رقم طلب الموقع مرتبط بكود عميل آخر" };
        }
        if (nextErpSalesOrder && existing.next_erp_sales_order !== nextErpSalesOrder) {
          await tx`update owners.personal_code_uses set next_erp_sales_order=${nextErpSalesOrder},updated_at=now() where id=${existing.id}::uuid`;
        }
        return { ok: true, duplicate: true, use: existing };
      }
      const [inserted] = await tx<any[]>`
        insert into owners.personal_code_uses(
          member_id,code_snapshot,used_by_phone_normalized,self_use,website_order_id,vehicle_id,car_pre_tax,discount_amount,next_erp_sales_order
        ) values(
          ${owner.id}::uuid,${owner.referral_code},${phone},true,${websiteOrderId},${vehicleId},${carPreTax},${expectedDiscount},${nextErpSalesOrder}
        )
        returning id::text,member_id::text,website_order_id,used_by_phone_normalized,self_use,vehicle_id,car_pre_tax,discount_amount,next_erp_sales_order
      `;
      return { ok: true, duplicate: false, use: inserted };
    });
    if ("error" in result) return response.status(409).json({ ok: false, error: result.error });
    return response.status(200).json({
      ok: true,
      duplicate: result.duplicate,
      referralCode: owner.referral_code,
      referrerName: owner.customer_name || "عميل MZJ",
      selfUse,
      discountRate: 1,
      roundingUnit: 100,
      discountAmount: expectedDiscount,
      websiteOrderId,
      nextErpSalesOrder,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique|personal_code_uses/i.test(message)) return response.status(409).json({ ok: false, error: "تعذر تثبيت استخدام كود العميل لهذا الطلب" });
    throw error;
  }
}

async function commerceRedemptionByCode(codeValue: unknown) {
  const code = clean(codeValue);
  if (!/^\d{8}$/.test(code)) return null;
  const [row] = await getSql()<any[]>`
    select rd.id::text,rd.status,rd.points_cost,rd.redemption_code,rd.website_order_id,rd.next_erp_sales_order,
      r.id::text as reward_id,r.name,r.description,r.reward_type,r.reward_value,r.is_active,
      r.available_for_referral_purchase,r.available_for_existing_customer_purchase,r.available_for_friend_referral_purchase,r.available_for_repurchase,
      r.checkout_discount_type,r.checkout_discount_value,r.checkout_discount_amount,r.starts_at,r.ends_at,
      m.id::text as member_id,m.customer_name,m.phone_normalized as owner_phone_normalized
    from owners.redemptions rd
    join owners.rewards r on r.id=rd.reward_id
    join owners.members m on m.id=rd.member_id
    where rd.redemption_code=${code}
    limit 1
  `;
  return row || null;
}

function commerceRedemptionRewardAvailable(row: any) {
  if (!row || row.is_active === false) return false;
  const now = Date.now();
  if (row.starts_at && new Date(row.starts_at).getTime() > now) return false;
  if (row.ends_at && new Date(row.ends_at).getTime() < now) return false;
  return true;
}

async function handleCommerceRedemptionsForPhone(request: VercelRequest, response: VercelResponse, payload: Record<string, unknown>) {
  const auth = commerceApiAuthorized(request);
  if (!auth.ok) return response.status(auth.status).json({ ok: false, error: auth.error });
  const phone = normalizePhone(payload.phone);
  if (!phone) return response.status(400).json({ ok: false, error: "رقم جوال العميل غير صحيح" });
  const rows = await getSql()<any[]>`
    select rd.id::text
    from owners.redemptions rd
    join owners.members m on m.id=rd.member_id
    join owners.rewards r on r.id=rd.reward_id
    where m.phone_normalized=${phone}
      and m.status='active'
      and rd.status='approved'
      and rd.redemption_code is not null
      and r.is_active=true
      and (r.starts_at is null or r.starts_at<=now())
      and (r.ends_at is null or r.ends_at>=now())
    order by rd.created_at,rd.id
  `;
  return response.status(200).json({ ok: true, count: rows.length });
}

async function handleCommerceRedemptionLookup(request: VercelRequest, response: VercelResponse, payload: Record<string, unknown>) {
  const auth = commerceApiAuthorized(request);
  if (!auth.ok) return response.status(auth.status).json({ ok: false, error: auth.error });
  const phone = normalizePhone(payload.phone);
  if (!phone) return response.status(400).json({ ok: false, error: "رقم جوال العميل غير صحيح" });
  const row = await commerceRedemptionByCode(payload.code);
  if (!row) return response.status(404).json({ ok: false, error: "كود استبدال المكافأة غير صحيح" });
  if (row.owner_phone_normalized !== phone) return response.status(409).json({ ok: false, error: "كود استبدال المكافأة لا يخص رقم الجوال المسجل في الطلب" });
  if (row.status === "delivered") return response.status(409).json({ ok: false, error: "تم استخدام كود استبدال المكافأة مسبقًا" });
  if (row.status !== "approved") return response.status(409).json({ ok: false, error: "كود استبدال المكافأة غير متاح للاستخدام" });
  if (!commerceRedemptionRewardAvailable(row)) return response.status(409).json({ ok: false, error: "المكافأة المرتبطة بهذا الكود غير متاحة حاليًا" });
  return response.status(200).json({
    ok: true,
    eligible: true,
    redemptionCode: row.redemption_code,
    pointsCost: Number(row.points_cost || 0),
    ownerName: row.customer_name || "عميل MZJ",
    reward: commerceRewardPayload({
      id: row.reward_id,
      name: row.name,
      description: row.description,
      reward_type: row.reward_type,
      reward_value: row.reward_value,
      available_for_referral_purchase: row.available_for_referral_purchase,
      available_for_existing_customer_purchase: row.available_for_existing_customer_purchase,
      available_for_friend_referral_purchase: row.available_for_friend_referral_purchase,
      available_for_repurchase: row.available_for_repurchase,
      checkout_discount_type: row.checkout_discount_type,
      checkout_discount_value: row.checkout_discount_value,
      checkout_discount_amount: row.checkout_discount_amount,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
    }),
  });
}

async function handleCommerceRedemptionConfirm(request: VercelRequest, response: VercelResponse, payload: Record<string, unknown>) {
  const auth = commerceApiAuthorized(request);
  if (!auth.ok) return response.status(auth.status).json({ ok: false, error: auth.error });
  const code = clean(payload.code);
  const websiteOrderId = commerceOrderRoot(payload.websiteOrderId);
  const phone = normalizePhone(payload.phone);
  const nextErpSalesOrder = clean(payload.nextErpSalesOrder).slice(0, 160) || null;
  if (!/^\d{8}$/.test(code)) return response.status(400).json({ ok: false, error: "كود استبدال المكافأة غير صحيح" });
  if (!websiteOrderId) return response.status(400).json({ ok: false, error: "رقم طلب الموقع مطلوب" });
  if (!phone) return response.status(400).json({ ok: false, error: "رقم جوال العميل غير صحيح" });
  const sql = getSql();
  const result = await sql.begin(async (tx) => {
    const [row] = await tx<any[]>`
      select rd.id::text,rd.status,rd.points_cost,rd.redemption_code,rd.website_order_id,rd.next_erp_sales_order,
        r.id::text as reward_id,r.name,r.description,r.reward_type,r.reward_value,r.is_active,
        r.available_for_referral_purchase,r.available_for_existing_customer_purchase,r.available_for_friend_referral_purchase,r.available_for_repurchase,
        r.checkout_discount_type,r.checkout_discount_value,r.checkout_discount_amount,r.starts_at,r.ends_at,
        m.phone_normalized as owner_phone_normalized
      from owners.redemptions rd
      join owners.rewards r on r.id=rd.reward_id
      join owners.members m on m.id=rd.member_id
      where rd.redemption_code=${code}
      for update
    `;
    if (!row) return { status: 404, error: "كود استبدال المكافأة غير صحيح" };
    if (row.owner_phone_normalized !== phone) return { status: 409, error: "كود استبدال المكافأة لا يخص رقم الجوال المسجل في الطلب" };
    if (row.status === "delivered") {
      if (commerceOrderRoot(row.website_order_id) === websiteOrderId) return { ok: true, duplicate: true, row };
      return { status: 409, error: "تم استخدام كود استبدال المكافأة مسبقًا" };
    }
    if (row.status !== "approved") return { status: 409, error: "كود استبدال المكافأة غير متاح للاستخدام" };
    if (!commerceRedemptionRewardAvailable(row)) return { status: 409, error: "المكافأة المرتبطة بهذا الكود غير متاحة حاليًا" };
    const [updated] = await tx<any[]>`
      update owners.redemptions set
        status='delivered',website_order_id=${websiteOrderId},next_erp_sales_order=${nextErpSalesOrder},
        used_channel='website_purchase',used_by_phone_normalized=${phone},reviewed_at=now(),updated_at=now()
      where id=${row.id}::uuid
      returning id::text,status,points_cost,redemption_code,website_order_id,next_erp_sales_order
    `;
    return { ok: true, duplicate: false, row: { ...row, ...updated } };
  });
  if ("error" in result) return response.status(result.status).json({ ok: false, error: result.error });
  const row = result.row;
  return response.status(200).json({
    ok: true,
    duplicate: result.duplicate,
    redemptionCode: row.redemption_code,
    websiteOrderId,
    nextErpSalesOrder,
    reward: commerceRewardPayload({
      id: row.reward_id,
      name: row.name,
      description: row.description,
      reward_type: row.reward_type,
      reward_value: row.reward_value,
      available_for_referral_purchase: row.available_for_referral_purchase,
      available_for_existing_customer_purchase: row.available_for_existing_customer_purchase,
      available_for_friend_referral_purchase: row.available_for_friend_referral_purchase,
      available_for_repurchase: row.available_for_repurchase,
      checkout_discount_type: row.checkout_discount_type,
      checkout_discount_value: row.checkout_discount_value,
      checkout_discount_amount: row.checkout_discount_amount,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
    }),
  });
}

async function handleCommerceRedemptionsConfirm(request: VercelRequest, response: VercelResponse, payload: Record<string, unknown>) {
  const auth = commerceApiAuthorized(request);
  if (!auth.ok) return response.status(auth.status).json({ ok: false, error: auth.error });
  const phone = normalizePhone(payload.phone);
  const websiteOrderId = commerceOrderRoot(payload.websiteOrderId);
  const nextErpSalesOrder = clean(payload.nextErpSalesOrder).slice(0, 160) || null;
  const rawCodes = Array.isArray(payload.codes) ? payload.codes : [];
  const codes = Array.from(new Set(rawCodes.map((value) => clean(value)).filter(Boolean)));
  if (!phone) return response.status(400).json({ ok: false, error: "رقم جوال العميل غير صحيح" });
  if (!websiteOrderId) return response.status(400).json({ ok: false, error: "رقم طلب الموقع مطلوب" });
  if (!codes.length) return response.status(400).json({ ok: false, error: "أدخل كود استبدال مكافأة واحدًا على الأقل" });
  if (codes.some((code) => !/^\d{8}$/.test(code))) return response.status(400).json({ ok: false, error: "يوجد كود استبدال مكافأة غير صحيح" });

  const sql = getSql();
  const result = await sql.begin(async (tx) => {
    const locked: any[] = [];
    for (const code of codes) {
      const [row] = await tx<any[]>`
        select rd.id::text,rd.status,rd.points_cost,rd.redemption_code,rd.website_order_id,rd.next_erp_sales_order,
          r.id::text as reward_id,r.name,r.description,r.reward_type,r.reward_value,r.is_active,
          r.available_for_referral_purchase,r.available_for_existing_customer_purchase,r.available_for_friend_referral_purchase,r.available_for_repurchase,
          r.checkout_discount_type,r.checkout_discount_value,r.checkout_discount_amount,r.starts_at,r.ends_at,
          m.phone_normalized as owner_phone_normalized
        from owners.redemptions rd
        join owners.rewards r on r.id=rd.reward_id
        join owners.members m on m.id=rd.member_id
        where rd.redemption_code=${code}
        for update
      `;
      if (!row) return { status: 404, error: "أحد أكواد استبدال المكافأة غير صحيح" };
      if (row.owner_phone_normalized !== phone) return { status: 409, error: "أحد أكواد استبدال المكافأة لا يخص رقم الجوال المسجل في الطلب" };
      if (row.status === "delivered") {
        if (commerceOrderRoot(row.website_order_id) !== websiteOrderId) return { status: 409, error: "تم استخدام أحد أكواد استبدال المكافأة مسبقًا" };
      } else if (row.status !== "approved") {
        return { status: 409, error: "أحد أكواد استبدال المكافأة غير متاح للاستخدام" };
      } else if (!commerceRedemptionRewardAvailable(row)) {
        return { status: 409, error: "إحدى المكافآت المرتبطة بالأكواد غير متاحة حاليًا" };
      }
      locked.push(row);
    }

    const confirmed: any[] = [];
    let duplicate = true;
    for (const row of locked) {
      if (row.status === "delivered") {
        confirmed.push(row);
        continue;
      }
      duplicate = false;
      const [updated] = await tx<any[]>`
        update owners.redemptions set
          status='delivered',website_order_id=${websiteOrderId},next_erp_sales_order=${nextErpSalesOrder},
          used_channel='website_purchase',used_by_phone_normalized=${phone},reviewed_at=now(),updated_at=now()
        where id=${row.id}::uuid
        returning id::text,status,points_cost,redemption_code,website_order_id,next_erp_sales_order
      `;
      confirmed.push({ ...row, ...updated });
    }
    return { ok: true, duplicate, rows: confirmed };
  });
  if ("error" in result) return response.status(result.status).json({ ok: false, error: result.error });
  return response.status(200).json({
    ok: true,
    duplicate: result.duplicate,
    redemptionCodes: result.rows.map((row: any) => row.redemption_code),
    websiteOrderId,
    nextErpSalesOrder,
    rewards: result.rows.map((row: any) => commerceRewardPayload({
      id: row.reward_id,
      name: row.name,
      description: row.description,
      reward_type: row.reward_type,
      reward_value: row.reward_value,
      available_for_referral_purchase: row.available_for_referral_purchase,
      available_for_existing_customer_purchase: row.available_for_existing_customer_purchase,
      available_for_friend_referral_purchase: row.available_for_friend_referral_purchase,
      available_for_repurchase: row.available_for_repurchase,
      checkout_discount_type: row.checkout_discount_type,
      checkout_discount_value: row.checkout_discount_value,
      checkout_discount_amount: row.checkout_discount_amount,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
    })),
  });
}

async function handleCommerceCancelOrder(request: VercelRequest, response: VercelResponse, payload: Record<string, unknown>) {
  const auth = commerceApiAuthorized(request);
  if (!auth.ok) return response.status(auth.status).json({ ok: false, error: auth.error });
  const websiteOrderId = commerceOrderRoot(payload.websiteOrderId);
  const nextErpSalesOrder = clean(payload.nextErpSalesOrder).slice(0, 160) || null;
  if (!nextErpSalesOrder) {
    return response.status(400).json({ ok: false, error: "رقم طلب البيع من NEXT ERP مطلوب لمطابقة الإلغاء" });
  }

  // WooCommerce is only a retry channel. NEXT ERP remains the authoritative
  // cancellation source, so a manual Woo status change can never release an
  // Owners code/reward while the ERP Sales Order is still active.
  const [confirmedCancellation] = await getSql()<any[]>`
    select 1 as confirmed
    where exists(
      select 1
      from integrations.erpnext_sales_orders erp_order
      where erp_order.sales_order_no=${nextErpSalesOrder}
        and coalesce(erp_order.is_cancelled,false)=true
    ) or exists(
      select 1
      from crm.sales_transactions sale
      where sale.source_reference=${nextErpSalesOrder}
        and coalesce(sale.is_cancelled,false)=true
    )
    limit 1
  `;
  if (!confirmedCancellation) {
    return response.status(409).json({ ok: false, error: "لم يصل تأكيد إلغاء طلب البيع من NEXT ERP إلى المنصة بعد" });
  }

  const cancellation = await reverseOwnerCommerceForCancelledOrder({
    websiteOrderId: websiteOrderId || null,
    nextErpSalesOrder,
    reason: clean(payload.reason) || "تم إلغاء طلب الشراء",
    source: clean(payload.source) || "woocommerce_cancelled",
  });
  return response.status(200).json({ ok: true, cancellation });
}

async function handleCommerceLinkOrder(request: VercelRequest, response: VercelResponse, payload: Record<string, unknown>) {
  const auth = commerceApiAuthorized(request);
  if (!auth.ok) return response.status(auth.status).json({ ok: false, error: auth.error });
  const websiteOrderId = clean(payload.websiteOrderId).slice(0, 150);
  const nextErpSalesOrder = clean(payload.nextErpSalesOrder).slice(0, 160);
  if (!websiteOrderId || !nextErpSalesOrder) return response.status(400).json({ ok: false, error: "رقم طلب الموقع ورقم طلب البيع مطلوبان" });
  const sql = getSql();
  const rows = await sql<any[]>`
    update owners.referral_purchase_benefits
    set next_erp_sales_order=${nextErpSalesOrder},updated_at=now()
    where website_order_id in (${websiteOrderId},${`${websiteOrderId}:primary`},${`${websiteOrderId}:bonus`})
    returning id::text
  `;
  const rootOrderId = commerceOrderRoot(websiteOrderId);
  const personalRows = rootOrderId ? await sql<any[]>`
    update owners.personal_code_uses set next_erp_sales_order=${nextErpSalesOrder},updated_at=now()
    where website_order_id=${rootOrderId}
    returning id::text
  ` : [];
  const friendRows = rootOrderId ? await sql<any[]>`
    update owners.friend_code_uses set next_erp_sales_order=${nextErpSalesOrder},updated_at=now()
    where website_order_id=${rootOrderId}
    returning id::text
  ` : [];
  const redemptionRows = rootOrderId ? await sql<any[]>`
    update owners.redemptions set next_erp_sales_order=${nextErpSalesOrder},updated_at=now()
    where website_order_id=${rootOrderId}
    returning id::text
  ` : [];
  return response.status(200).json({ ok: true, updated: rows.length + personalRows.length + friendRows.length + redemptionRows.length, nextErpSalesOrder });
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
      return response.status(403).json({ ok: false, error: "MZJ Club Community غير متاح حاليًا" });
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

  if (request.method === "POST" && action === "commerce_customer_by_phone") {
    return handleCommerceCustomerByPhone(request, response, payload);
  }

  if (request.method === "POST" && action === "commerce_new_customer_code") {
    return handleCommerceNewCustomerCode(request, response, payload);
  }

  if (request.method === "POST" && action === "commerce_rewards") {
    return handleCommerceRewards(request, response, payload);
  }

  if (request.method === "POST" && action === "commerce_confirm") {
    return handleCommerceConfirm(request, response, payload);
  }

  if (request.method === "POST" && action === "commerce_confirm_bundle") {
    return handleCommerceConfirmBundle(request, response, payload);
  }

  if (request.method === "POST" && action === "commerce_personal_code_use") {
    return handleCommercePersonalCodeUse(request, response, payload);
  }

  if (request.method === "POST" && action === "commerce_redemptions_for_phone") {
    return handleCommerceRedemptionsForPhone(request, response, payload);
  }

  if (request.method === "POST" && action === "commerce_redemption_lookup") {
    return handleCommerceRedemptionLookup(request, response, payload);
  }

  if (request.method === "POST" && action === "commerce_redemption_confirm") {
    return handleCommerceRedemptionConfirm(request, response, payload);
  }

  if (request.method === "POST" && action === "commerce_redemptions_confirm") {
    return handleCommerceRedemptionsConfirm(request, response, payload);
  }

  if (request.method === "POST" && action === "commerce_cancel_order") {
    return handleCommerceCancelOrder(request, response, payload);
  }

  if (request.method === "POST" && action === "commerce_link_order") {
    return handleCommerceLinkOrder(request, response, payload);
  }

  if (request.method === "POST" && action === "register_referral") {
    return registerReferral(response, payload);
  }

  if (request.method === "POST" && action === "request_otp") {
    const phone = normalizePhone(payload.phone);
    if (!phone) return response.status(400).json({ ok: false, error: "اكتب رقم جوال صحيح" });
    const settings = await getOwnerSettings();
    if (settings.is_enabled === false) {
      return response.status(403).json({ ok: false, error: "MZJ Club Community غير متاح حاليًا" });
    }
    const member = await ensureOwnerMemberByPhone(phone);
    const legacyCustomer = member ? null : await findLegacyCustomerCodeByPhone(phone);
    if (!member && !legacyCustomer) {
      return response.status(404).json({ ok: false, error: "رقم الجوال غير مسجل في MZJ Club Community" });
    }

    const resendSeconds = Math.max(15, Number(settings.otp_resend_seconds || 60));
    const [limits] = await sql<any[]>`
      select
        coalesce(max(created_at) > now()-${resendSeconds}::integer*interval '1 second',false) as resend_blocked,
        count(*) filter(where created_at>now()-interval '1 hour')::int as hourly_count
      from owners.otp_challenges
      where phone_normalized=${phone}
    `;
    if (limits?.resend_blocked === true) {
      return response.status(429).json({ ok: false, error: "انتظر قليلًا قبل طلب رمز جديد" });
    }
    if (Number(limits?.hourly_count || 0) >= Number(settings.otp_hourly_limit || 5)) {
      return response.status(429).json({ ok: false, error: "تم تجاوز عدد طلبات رمز التحقق خلال الساعة" });
    }
    const challengeId = crypto.randomUUID();
    const otp = randomOtp();
    const expiryMinutes = Math.max(1, Number(settings.otp_expiry_minutes || 5));
    await sql`
      insert into owners.otp_challenges(id,phone_normalized,code_hash,max_attempts,expires_at)
      values(
        ${challengeId}::uuid,${phone},${ownerOtpHash(challengeId, phone, otp)},
        ${Number(settings.otp_max_attempts || 5)},now()+${expiryMinutes}::integer*interval '1 minute'
      )
    `;
    try {
      const message = `رمز MZJ Club Community: ${otp} صالح لمدة ${expiryMinutes} دقائق.`;
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
      expiresMinutes: expiryMinutes,
    });
  }

  if (request.method === "POST" && action === "verify_otp") {
    const phone = normalizePhone(payload.phone);
    const code = clean(payload.code);
    const challengeId = clean(payload.challengeId);
    if (!phone || !/^\d{4}$/.test(code) || !isUuid(challengeId)) {
      return response.status(400).json({ ok: false, error: "بيانات التحقق غير مكتملة" });
    }
    const [challenge] = await sql<any[]>`
      select *,expires_at>now() as is_unexpired
      from owners.otp_challenges
      where id=${challengeId}::uuid
        and phone_normalized=${phone}
        and consumed_at is null
      limit 1
    `;
    if (!challenge || challenge.is_unexpired !== true) {
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
    const legacyCustomer = member ? null : await findLegacyCustomerCodeByPhone(phone);
    if (!member && !legacyCustomer) return response.status(404).json({ ok: false, error: "عضوية العميل غير موجودة" });
    await sql`update owners.otp_challenges set consumed_at=now() where id=${challengeId}::uuid`;
    if (member) await createOwnerSession(response, member.id);
    else await createLegacyOwnerSession(response, legacyCustomer!.id);
    return response.status(200).json({ ok: true, profileKind: member ? "member" : "legacy" });
  }

  if (request.method === "POST" && action === "logout") {
    await clearOwnerSession(request, response);
    return response.status(200).json({ ok: true });
  }

  let member = await getOwnerSession(request);
  const legacyCustomer = member ? null : await getLegacyOwnerSession(request);
  if (!member && !legacyCustomer) return response.status(401).json({ ok: false, error: "يجب تسجيل الدخول" });

  if (legacyCustomer) {
    if (request.method === "GET" && action === "me") {
      const settings = await getOwnerSettings();
      const packageCatalog = await ownerPublicPackageCatalog();
      let websiteCars: Array<{ vehicleId: string; title: string; price: number; priceBeforeTax: number }> = [];
      let websiteCarsWarning = "";
      try {
        const websiteStock = await getWebsiteStock();
        websiteCars = websiteStock.cars
          .filter((car) => car.price > 0)
          .map((car) => ({ vehicleId: car.vehicleId, title: car.title, price: car.price, priceBeforeTax: car.priceBeforeTax }));
        websiteCarsWarning = websiteStock.warning || "";
      } catch (error) {
        websiteCarsWarning = error instanceof Error ? error.message : "تعذر تحميل سيارات الموقع";
      }
      return response.status(200).json({
        ok: true,
        profileKind: "legacy",
        member: {
          id: legacyCustomer.id,
          name: legacyCustomer.customer_name || "عميل MZJ",
          phone: legacyCustomer.phone_normalized || "",
          points: 0,
          lifetimePoints: 0,
          tier: "member",
          referralCode: legacyCustomer.referral_code || "",
          inviteUrl: "",
          statusLabel: legacyCustomer.status_label || "عميل جديد",
          joinedAt: legacyCustomer.created_at || null,
          purchaseCount: 0,
          lastSaleAt: null,
        },
        referrals: [],
        referralVisits: [],
        ledger: [],
        rewards: [],
        cardRewards: [],
        redemptions: [],
        pointsMenu: {
          repurchase: Number(settings.points_repurchase ?? 500),
          referralSale: Number(settings.points_sale ?? 700),
          referralSend: Number(settings.points_unique_open ?? 50),
        },
        websiteCars,
        websiteCarsWarning,
        ...packageCatalog,
      });
    }
    return response.status(403).json({ ok: false, error: "هذه العملية تتاح بعد اكتمال أول عملية شراء" });
  }

  await syncOwnerReferralProgress(member.id);
  await ensureOwnerPurchasePointsForMember(member.id);
  const [refreshedMember] = await sql<any[]>`
    select *,id::text,crm_lead_id::text,source_sale_id::text
    from owners.members
    where id=${member.id}::uuid and status='active'
    limit 1
  `;
  if (refreshedMember) member = refreshedMember;

  if (request.method === "GET" && action === "purchase_invoices") {
    const salesOrder = clean(request.query.salesOrder);
    if (!salesOrder) return response.status(400).json({ ok: false, error: "طلب البيع غير محدد" });
    if (!await ownerOwnsSalesOrder(member.id, salesOrder)) {
      return response.status(404).json({ ok: false, error: "طلب البيع غير مرتبط بهذه العضوية" });
    }
    try {
      const invoices = await listNextErpSalesInvoices(salesOrder);
      return response.status(200).json({ ok: true, salesOrder, invoices });
    } catch (error) {
      const invoiceError = ownerInvoiceError(error);
      return response.status(invoiceError.status).json({ ok: false, error: invoiceError.message });
    }
  }

  if (request.method === "GET" && action === "invoice_pdf") {
    const salesOrder = clean(request.query.salesOrder);
    const invoiceName = clean(request.query.invoice);
    if (!salesOrder || !invoiceName) return response.status(400).json({ ok: false, error: "طلب البيع أو الفاتورة غير محدد" });
    if (!await ownerOwnsSalesOrder(member.id, salesOrder)) {
      return response.status(404).json({ ok: false, error: "طلب البيع غير مرتبط بهذه العضوية" });
    }
    try {
      const invoices = await listNextErpSalesInvoices(salesOrder);
      if (!invoices.some((invoice) => invoice.name === invoiceName)) {
        return response.status(404).json({ ok: false, error: "الفاتورة غير مرتبطة بطلب البيع" });
      }
      const bytes = await downloadNextErpSalesInvoicePdf(invoiceName);
      const safeName = invoiceName.replace(/[^A-Za-z0-9._-]+/g, "-") || "sales-invoice";
      response.setHeader("Content-Type", "application/pdf");
      response.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
      response.setHeader("Content-Length", String(bytes.byteLength));
      return response.status(200).send(Buffer.from(bytes));
    } catch (error) {
      const invoiceError = ownerInvoiceError(error);
      return response.status(invoiceError.status).json({ ok: false, error: invoiceError.message });
    }
  }

  if (request.method === "GET" && action === "me") {
    const settings = await getOwnerSettings();
    const packageCatalog = await ownerPublicPackageCatalog();
    const referrals = await sql<any[]>`
      select id::text,referred_name,status,registered_at,qualified_at,sold_at,created_at
      from owners.referrals
      where referrer_member_id=${member.id}::uuid
      order by created_at desc
      limit 100
    `;
    const referralVisits = await sql<any[]>`
      select id::text,created_at
      from owners.referral_visits
      where referrer_member_id=${member.id}::uuid
      order by created_at desc
      limit 100
    `;
    const ledger = await ownerPurchaseLedger(member.id);
    const purchaseSummary = await ownerPurchaseSummary(member.id);
    const rewards = await sql<any[]>`
      select id::text,name,description,reward_type,reward_value,show_on_member_page,points_cost,redeemed_quantity,referral_purchase_redeemed_quantity,starts_at,ends_at
      from owners.rewards
      where is_active=true and show_on_member_page=true
        and points_cost<=${Number(member.points_balance || 0)}
        and (starts_at is null or starts_at<=now())
        and (ends_at is null or ends_at>=now())
        and (stock_quantity is null or redeemed_quantity<stock_quantity)
      order by points_cost,name
    `;
    const redemptions = await sql<any[]>`
      select rd.id::text,rd.status,rd.points_cost,rd.redemption_code,rd.created_at,rd.reviewed_at,
        r.name as reward_name,u.full_name as reviewed_by_name
      from owners.redemptions rd
      join owners.rewards r on r.id=rd.reward_id
      left join core.users u on u.id=rd.reviewed_by
      where rd.member_id=${member.id}::uuid
      order by rd.created_at desc
      limit 50
    `;
    let websiteCars: Array<{ vehicleId: string; title: string; price: number; priceBeforeTax: number }> = [];
    let websiteCarsWarning = "";
    try {
      const websiteStock = await getWebsiteStock();
      websiteCars = websiteStock.cars
        .filter((car) => car.price > 0)
        .map((car) => ({ vehicleId: car.vehicleId, title: car.title, price: car.price, priceBeforeTax: car.priceBeforeTax }));
      websiteCarsWarning = websiteStock.warning || "";
    } catch (error) {
      websiteCarsWarning = error instanceof Error ? error.message : "تعذر تحميل سيارات الموقع";
    }

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
        inviteUrl: `${publicBase(request)}/club/invite/${member.referral_code}`,
        joinedAt: member.activated_at || member.created_at || null,
        purchaseCount: Number(purchaseSummary.purchaseCount || 0),
        firstSaleAt: purchaseSummary.firstSaleAt || member.first_sale_at || null,
        lastSaleAt: purchaseSummary.lastSaleAt || member.last_sale_at || null,
      },
      referrals,
      referralVisits,
      ledger,
      rewards,
      cardRewards: [],
      redemptions,
      pointsMenu: {
        repurchase: Number(settings.points_repurchase ?? 500),
        referralSale: Number(settings.points_sale ?? 700),
        referralSend: Number(settings.points_unique_open ?? 50),
      },
      websiteCars,
      websiteCarsWarning,
      ...packageCatalog,
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
          and show_on_member_page=true
          and (starts_at is null or starts_at<=now())
          and (ends_at is null or ends_at>=now())
        for update
      `;
      if (!reward) return { error: "المكافأة غير متاحة" };
      if (Number(lockedMember?.points_balance || 0) < Number(reward.points_cost)) {
        return { error: "رصيد النقاط غير كاف" };
      }

      let redemptionCode = "";
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const candidate = randomRedemptionCode();
        const [exists] = await tx<any[]>`select 1 from owners.redemptions where redemption_code=${candidate} limit 1`;
        if (!exists) { redemptionCode = candidate; break; }
      }
      if (!redemptionCode) return { error: "تعذر إنشاء كود استبدال فريد" };

      const [redemption] = await tx<any[]>`
        insert into owners.redemptions(member_id,reward_id,points_cost,status,redemption_code)
        values(${member.id}::uuid,${rewardId}::uuid,${Number(reward.points_cost)},'approved',${redemptionCode})
        returning id::text,redemption_code
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
      return { ok: true, redemption: { id: redemption.id, code: redemption.redemption_code, status: 'approved', pointsCost: Number(reward.points_cost), rewardName: reward.name } };
    });
    if ("error" in result) return response.status(400).json({ ok: false, error: result.error });
    return response.status(200).json(result);
  }

  return response.status(405).json({ ok: false, error: "Method not allowed" });
}
