import crypto from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionUser } from "./_auth.js";
import { hasPermission } from "./_access-control.js";
import { clean } from "./_crm-utils.js";
import { getSql } from "./_db.js";
import { normalizePhone } from "./_phone-utils.js";
import {
  ensureOwnerMemberForLead,
  processOwnerSaleForLead,
  syncOwnerReferralProgress,
} from "./_owners.js";
import { ensureOwnersSchema } from "./_owners-schema.js";
import { syncLegacyCustomerCodes } from "./_owners-customer-segments.js";
import { queueFirebaseSms } from "./_firebase-sms.js";

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

function publicBase(request: VercelRequest) {
  const protocol = String(request.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || "mzj-platform.vercel.app").split(",")[0];
  return `${protocol}://${host}`;
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function optionalDate(value: unknown) {
  const normalized = clean(value);
  return normalized || null;
}

function safeImportedDate(value: unknown) {
  const text = clean(value);
  if (!text) return null;
  const dmy = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  const candidate = dmy
    ? `${dmy[3]}-${String(dmy[2]).padStart(2, "0")}-${String(dmy[1]).padStart(2, "0")}T12:00:00+03:00`
    : /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? `${text}T12:00:00+03:00`
      : text;
  const date = new Date(candidate);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}


function isTestMemberMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  return clean((metadata as Record<string, unknown>).memberKind).toLowerCase() === "test";
}

function randomReferralCode() {
  return crypto.randomBytes(7).toString("base64url").replace(/[-_]/g, "").toUpperCase().slice(0, 10);
}

async function createManualOwnerMember(input: {
  name: unknown;
  phone: unknown;
  purchaseDate?: unknown;
  vehicle?: unknown;
  branch?: unknown;
  orderId?: unknown;
  source: "admin_test" | "excel_import";
  actorId: string;
}) {
  const sql = getSql();
  const phone = normalizePhone(input.phone);
  const name = clean(input.name);
  if (!phone) return { status: "invalid" as const, error: "رقم الجوال غير صالح" };
  if (!name) return { status: "invalid" as const, error: "اسم العميل مطلوب" };

  const [existing] = await sql<any[]>`
    select id::text,metadata
    from owners.members
    where phone_normalized=${phone}
    limit 1
  `;
  if (existing) return { status: "duplicate" as const, memberId: existing.id, test: isTestMemberMetadata(existing.metadata) };

  if (input.source === "excel_import") {
    const [sale] = await sql<any[]>`
      select l.id::text as lead_id,st.id::text as sale_id
      from crm.leads l
      join crm.sales_transactions st on st.lead_id=l.id and coalesce(st.is_cancelled,false)=false
      where l.is_deleted=false and l.phone_normalized=${phone}
      order by st.sale_at desc,st.created_at desc,st.id desc
      limit 1
    `;
    if (sale) {
      const member = await ensureOwnerMemberForLead(sale.lead_id, sale.sale_id);
      if (member) {
        const importMetadata = {
          memberKind: "real", enrollmentSource: "excel_import_matched", importedBy: input.actorId,
          importedAt: new Date().toISOString(), vehicle: clean(input.vehicle) || null, branch: clean(input.branch) || null,
          orderId: clean(input.orderId) || null, purchaseDate: clean(input.purchaseDate) || null,
        };
        await sql`update owners.members set metadata=coalesce(metadata,'{}'::jsonb)||${sql.json(importMetadata)}::jsonb,updated_at=now() where id=${member.id}::uuid`;
        return { status: "matched" as const, memberId: member.id };
      }
    }
  }

  const purchaseDate = safeImportedDate(input.purchaseDate);
  const metadata = {
    memberKind: input.source === "admin_test" ? "test" : "real",
    enrollmentSource: input.source,
    importedBy: input.actorId,
    importedAt: new Date().toISOString(),
    vehicle: clean(input.vehicle) || null,
    branch: clean(input.branch) || null,
    orderId: clean(input.orderId) || null,
    purchaseDate: purchaseDate || null,
  };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const [member] = await sql<any[]>`
        insert into owners.members(
          phone_normalized,customer_name,referral_code,first_sale_at,last_sale_at,metadata
        ) values(
          ${phone},${name},${randomReferralCode()},
          ${purchaseDate || null}::timestamptz,${purchaseDate || null}::timestamptz,${sql.json(metadata)}
        )
        returning id::text
      `;
      return { status: "created" as const, memberId: member.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/referral_code|owners_members_referral/i.test(message)) continue;
      throw error;
    }
  }
  throw new Error("تعذر إنشاء كود دعوة فريد للعضو");
}

async function syncMembersFromCanonicalSales() {
  const sql = getSql();
  const rows = await sql<any[]>`
    select distinct on(l.phone_normalized)
      l.id::text as lead_id,
      st.id::text as sale_id
    from crm.sales_transactions st
    join crm.leads l on l.id=st.lead_id and l.is_deleted=false
    where coalesce(st.is_cancelled,false)=false
      and nullif(l.phone_normalized,'') is not null
    order by l.phone_normalized,st.sale_at desc,st.created_at desc,st.id desc
  `;
  let synced = 0;
  for (const row of rows) {
    const member = await processOwnerSaleForLead(row.lead_id, row.sale_id);
    if (member) synced += 1;
  }
  return synced;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  await ensureOwnersSchema();
  response.setHeader("Cache-Control", "no-store");
  const sql = getSql();
  const payload = requestBody(request);
  const action = clean(payload.action || request.query.action);

  const actor = await getSessionUser(request);
  if (!actor) return response.status(401).json({ ok: false, error: "يجب تسجيل الدخول أولًا" });

  if (request.method === "GET") {
    const scope = clean(request.query.scope);
    const allowed = scope === "settings"
      ? hasPermission(actor, "settings.owners.view") || hasPermission(actor, "settings.owners.manage") || hasPermission(actor, "owners.community.manage")
      : hasPermission(actor, "owners.community.view") || hasPermission(actor, "owners.community.manage");
    if (!allowed) return response.status(403).json({ ok: false, error: "لا توجد لديك صلاحية للدخول إلى MZJ Owners Community" });
    if (scope === "settings") {
      const settingsRows = await sql<any[]>`select * from owners.settings where id='default'`;
      return response.status(200).json({ ok: true, settings: settingsRows[0] || {} });
    }

    await syncLegacyCustomerCodes();

    const [settings, members, legacyCustomers, referrals, rewards, redemptions, stats] = await Promise.all([
      sql<any[]>`select * from owners.settings where id='default'`.then((rows) => rows[0] || {}),
      sql<any[]>`
        select
          m.id::text,m.customer_name,m.phone_normalized,m.referral_code,m.points_balance,m.lifetime_points,
          m.tier_code,m.first_sale_at,m.last_sale_at,m.last_login_at,m.welcome_sent_at,m.metadata,
          coalesce(m.metadata->>'memberKind','real') as member_kind,
          coalesce(m.metadata->>'enrollmentSource','canonical_sale') as enrollment_source,
          count(distinct r.id)::int as referrals_count,
          count(distinct r.id) filter(where r.status='sold')::int as sales_count
        from owners.members m
        left join owners.referrals r on r.referrer_member_id=m.id
        where m.status='active'
        group by m.id
        order by m.created_at desc
        limit 1000
      `,
      sql<any[]>`
        select
          c.id::text,c.crm_lead_id::text,c.customer_name,c.phone_normalized,c.referral_code,c.created_at,c.updated_at,
          l.status_label,l.department_code,l.branch_code,l.source_code,l.source_name,l.payment_type,l.registered_at,
          u.full_name as assigned_name,b.name as branch_name,src.name as catalog_source_name
        from owners.legacy_customer_codes c
        join crm.leads l on l.id=c.crm_lead_id and l.is_deleted=false
        left join core.users u on u.id=l.assigned_to
        left join core.branches b on b.code=l.branch_code
        left join core.sources src on src.code=l.source_code
        where c.status='active'
          and coalesce(l.status_label,'') <> 'تم البيع'
        order by l.updated_at desc,l.created_at desc
        limit 5000
      `,
      sql<any[]>`
        select
          r.id::text,r.status,r.referred_name,r.referred_phone_normalized,r.registered_at,
          r.qualified_at,r.sold_at,m.customer_name as referrer_name,m.referral_code,
          coalesce(m.metadata->>'memberKind','real') as referrer_member_kind
        from owners.referrals r
        join owners.members m on m.id=r.referrer_member_id
        order by r.created_at desc
        limit 1000
      `,
      sql<any[]>`
        select *,id::text,created_by::text,updated_by::text
        from owners.rewards
        order by is_active desc,points_cost,name
      `,
      sql<any[]>`
        select
          rd.id::text,rd.status,rd.points_cost,rd.note,rd.created_at,rd.reviewed_at,
          m.customer_name,m.phone_normalized,r.name as reward_name
        from owners.redemptions rd
        join owners.members m on m.id=rd.member_id
        join owners.rewards r on r.id=rd.reward_id
        order by rd.created_at desc
        limit 500
      `,
      sql<any[]>`
        select
          (select count(*) from owners.members where status='active' and coalesce(metadata->>'memberKind','real')<>'test')::int as members,
          (select count(*) from owners.legacy_customer_codes c join crm.leads l on l.id=c.crm_lead_id where c.status='active' and l.is_deleted=false and coalesce(l.status_label,'')<>'تم البيع')::int as legacy_customers,
          (select count(*) from owners.referrals r join owners.members m on m.id=r.referrer_member_id where coalesce(m.metadata->>'memberKind','real')<>'test')::int as referrals,
          (select count(*) from owners.referrals r join owners.members m on m.id=r.referrer_member_id where r.status='sold' and coalesce(m.metadata->>'memberKind','real')<>'test')::int as referral_sales,
          (select coalesce(sum(points_balance),0) from owners.members where status='active' and coalesce(metadata->>'memberKind','real')<>'test')::int as outstanding_points,
          (select count(*) from owners.redemptions rd join owners.members m on m.id=rd.member_id where rd.status='requested' and coalesce(m.metadata->>'memberKind','real')<>'test')::int as pending_redemptions
      `,
    ]);
    return response.status(200).json({
      ok: true,
      settings,
      members,
      legacyCustomers,
      referrals,
      rewards,
      redemptions,
      stats: stats[0] || {},
    });
  }

  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const canManageCommunity = hasPermission(actor, "owners.community.manage");
  const canManageSettings = hasPermission(actor, "settings.owners.manage") || canManageCommunity;
  if (action === "save_settings" && !canManageSettings) return response.status(403).json({ ok: false, error: "لا توجد لديك صلاحية لتعديل إعدادات البرنامج" });
  if (action !== "save_settings" && !canManageCommunity) return response.status(403).json({ ok: false, error: "لا توجد لديك صلاحية لإدارة MZJ Owners Community" });

  if (action === "save_settings") {
    const silverPoints = integer(payload.silverPoints, 1000, 0, 1_000_000_000);
    const goldPoints = Math.max(silverPoints, integer(payload.goldPoints, 3000, 0, 1_000_000_000));
    const platinumPoints = Math.max(goldPoints, integer(payload.platinumPoints, 7000, 0, 1_000_000_000));
    const [settings] = await sql<any[]>`
      update owners.settings set
        is_enabled=${payload.isEnabled !== false},
        otp_expiry_minutes=${integer(payload.otpExpiryMinutes, 5, 1, 30)},
        otp_resend_seconds=${integer(payload.otpResendSeconds, 60, 15, 600)},
        otp_max_attempts=${integer(payload.otpMaxAttempts, 5, 1, 20)},
        otp_hourly_limit=${integer(payload.otpHourlyLimit, 5, 1, 30)},
        points_unique_open=${integer(payload.pointsUniqueOpen, 1, 0, 1_000_000)},
        points_registration=${integer(payload.pointsRegistration, 10, 0, 1_000_000)},
        points_qualified=${integer(payload.pointsQualified, 25, 0, 1_000_000)},
        points_sale=${integer(payload.pointsSale, 500, 0, 1_000_000)},
        daily_open_points_cap=${integer(payload.dailyOpenPointsCap, 25, 0, 1_000_000)},
        silver_points=${silverPoints},
        gold_points=${goldPoints},
        platinum_points=${platinumPoints},
        referral_default_service=${clean(payload.referralDefaultService) || "cash"},
        referral_default_branch=${clean(payload.referralDefaultBranch) || "online"},
        friend_benefit_title=${clean(payload.friendBenefitTitle) || "دعوة من مجموعة محمد بن ذعار العجمي"},
        friend_benefit_text=${clean(payload.friendBenefitText) || "سجل بياناتك من رابط الدعوة وسيقوم فريق مجموعة محمد بن ذعار العجمي بالتواصل معك."},
        welcome_message_enabled=${payload.welcomeMessageEnabled === true},
        updated_by=${actor.id}::uuid,
        updated_at=now()
      where id='default'
      returning *
    `;
    return response.status(200).json({ ok: true, settings });
  }

  if (action === "sync_members") {
    const synced = await syncMembersFromCanonicalSales();
    await syncLegacyCustomerCodes();
    const referrals = await syncOwnerReferralProgress();
    return response.status(200).json({ ok: true, synced, referrals });
  }

  if (action === "create_test_member") {
    const result = await createManualOwnerMember({
      name: payload.name, phone: payload.phone, source: "admin_test", actorId: actor.id,
    });
    if (result.status === "invalid") return response.status(400).json({ ok: false, error: result.error });
    if (result.status === "duplicate") return response.status(409).json({ ok: false, error: "رقم الجوال موجود بالفعل ضمن أعضاء البرنامج" });
    return response.status(200).json({ ok: true, memberId: result.memberId });
  }

  if (action === "delete_test_member") {
    const memberId = clean(payload.memberId);
    const [member] = await sql<any[]>`select id::text,metadata from owners.members where id=${memberId}::uuid limit 1`;
    if (!member) return response.status(404).json({ ok: false, error: "العضو غير موجود" });
    if (!isTestMemberMetadata(member.metadata)) return response.status(409).json({ ok: false, error: "الحذف متاح للأعضاء التجريبيين فقط" });
    await sql`delete from owners.members where id=${memberId}::uuid`;
    return response.status(200).json({ ok: true });
  }

  if (action === "import_members") {
    const rows = Array.isArray(payload.rows) ? payload.rows.slice(0, 5000) : [];
    if (!rows.length) return response.status(400).json({ ok: false, error: "لا توجد بيانات صالحة للاستيراد" });
    const summary = { total: rows.length, created: 0, matched: 0, duplicates: 0, invalid: 0 };
    const details: Array<{ row: number; status: string; error?: string }> = [];
    const seen = new Set<string>();
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] && typeof rows[index] === "object" ? rows[index] as Record<string, unknown> : {};
      const normalized = normalizePhone(row.phone);
      if (!normalized || seen.has(normalized)) {
        summary[normalized ? "duplicates" : "invalid"] += 1;
        details.push({ row: index + 2, status: normalized ? "duplicate_in_file" : "invalid_phone" });
        continue;
      }
      seen.add(normalized);
      try {
        const result = await createManualOwnerMember({
          name: row.name, phone: normalized, purchaseDate: row.purchaseDate, vehicle: row.vehicle,
          branch: row.branch, orderId: row.orderId, source: "excel_import", actorId: actor.id,
        });
        if (result.status === "created") summary.created += 1;
        else if (result.status === "matched") summary.matched += 1;
        else if (result.status === "duplicate") summary.duplicates += 1;
        else summary.invalid += 1;
        if (result.status !== "created" && result.status !== "matched") details.push({ row: index + 2, status: result.status, error: "error" in result ? result.error : undefined });
      } catch (error) {
        summary.invalid += 1;
        details.push({ row: index + 2, status: "error", error: error instanceof Error ? error.message : "تعذر الاستيراد" });
      }
    }
    return response.status(200).json({ ok: true, summary, details: details.slice(0, 100) });
  }

  if (action === "save_reward") {
    const id = clean(payload.id);
    const name = clean(payload.name);
    const description = clean(payload.description);
    const rewardType = ["gift", "discount", "service", "voucher"].includes(clean(payload.rewardType))
      ? clean(payload.rewardType)
      : "gift";
    const rewardValue = clean(payload.rewardValue);
    const showOnMemberCard = payload.showOnMemberCard === true;
    const availableForReferralPurchase = payload.availableForReferralPurchase === true;
    const availableForExistingCustomerPurchase = payload.availableForExistingCustomerPurchase === true;
    const checkoutDiscountType = clean(payload.checkoutDiscountType) === "percentage" ? "percentage" : "amount";
    const checkoutDiscountRaw = Number(payload.checkoutDiscountValue ?? payload.checkoutDiscountAmount);
    const checkoutDiscountValue = rewardType === "discount" && (availableForReferralPurchase || availableForExistingCustomerPurchase)
      ? Math.round((Number.isFinite(checkoutDiscountRaw) ? checkoutDiscountRaw : 0) * 100) / 100
      : 0;
    const checkoutDiscountAmount = checkoutDiscountType === "amount" ? checkoutDiscountValue : 0;
    const pointsCost = integer(payload.pointsCost, 1, 1, 1_000_000_000);
    const stockQuantity = payload.stockQuantity === "" || payload.stockQuantity == null
      ? null
      : integer(payload.stockQuantity, 0, 0, 1_000_000_000);
    const startsAt = optionalDate(payload.startsAt);
    const endsAt = optionalDate(payload.endsAt);
    const isActive = payload.isActive !== false;
    if (!name) return response.status(400).json({ ok: false, error: "اسم المكافأة مطلوب" });
    if (!rewardValue) return response.status(400).json({ ok: false, error: "حدد قيمة أو تفاصيل المكافأة التي ستظهر للعميل" });
    if ((availableForReferralPurchase || availableForExistingCustomerPurchase) && rewardType === "discount" && !(checkoutDiscountValue > 0)) {
      return response.status(400).json({ ok: false, error: "حدد قيمة الخصم أو نسبة الخصم للمكافأة المتاحة في طلب الموقع" });
    }
    if (rewardType === "discount" && checkoutDiscountType === "percentage" && checkoutDiscountValue > 100) {
      return response.status(400).json({ ok: false, error: "نسبة الخصم يجب أن تكون بين 0 و100" });
    }

    if (id) {
      await sql`
        update owners.rewards set
          name=${name},description=${description || null},reward_type=${rewardType},reward_value=${rewardValue || null},
          show_on_member_card=${showOnMemberCard},available_for_referral_purchase=${availableForReferralPurchase},
          available_for_existing_customer_purchase=${availableForExistingCustomerPurchase},
          checkout_discount_type=${checkoutDiscountType},checkout_discount_value=${checkoutDiscountValue},
          checkout_discount_amount=${checkoutDiscountAmount},points_cost=${pointsCost},stock_quantity=${stockQuantity},
          starts_at=${startsAt}::timestamptz,ends_at=${endsAt}::timestamptz,is_active=${isActive},
          updated_by=${actor.id}::uuid,updated_at=now()
        where id=${id}::uuid
      `;
    } else {
      await sql`
        insert into owners.rewards(
          name,description,reward_type,reward_value,show_on_member_card,available_for_referral_purchase,available_for_existing_customer_purchase,
          checkout_discount_type,checkout_discount_value,checkout_discount_amount,
          points_cost,stock_quantity,starts_at,ends_at,is_active,created_by,updated_by
        ) values(
          ${name},${description || null},${rewardType},${rewardValue || null},${showOnMemberCard},${availableForReferralPurchase},${availableForExistingCustomerPurchase},
          ${checkoutDiscountType},${checkoutDiscountValue},${checkoutDiscountAmount},${pointsCost},${stockQuantity},
          ${startsAt}::timestamptz,${endsAt}::timestamptz,${isActive},${actor.id}::uuid,${actor.id}::uuid
        )
      `;
    }
    return response.status(200).json({ ok: true });
  }

  if (action === "delete_reward") {
    const id = clean(payload.id);
    if (!id) return response.status(400).json({ ok: false, error: "المكافأة غير محددة" });
    const [usage] = await sql<any[]>`
      select
        (select count(*) from owners.redemptions where reward_id=${id}::uuid)::int as redemptions,
        (select count(*) from owners.referral_purchase_benefits where reward_id=${id}::uuid)::int as purchase_benefits
    `;
    if (Number(usage?.redemptions || 0) > 0 || Number(usage?.purchase_benefits || 0) > 0) {
      return response.status(409).json({ ok: false, error: "لا يمكن حذف مكافأة لها استخدامات سابقة. أوقفها بدلًا من حذفها للحفاظ على السجل." });
    }
    const deleted = await sql<any[]>`delete from owners.rewards where id=${id}::uuid returning id::text`;
    if (!deleted.length) return response.status(404).json({ ok: false, error: "المكافأة غير موجودة" });
    return response.status(200).json({ ok: true });
  }

  if (action === "redemption") {
    const id = clean(payload.id);
    const status = clean(payload.status);
    if (!["approved", "delivered", "rejected", "cancelled"].includes(status)) {
      return response.status(400).json({ ok: false, error: "حالة الطلب غير صحيحة" });
    }
    const result = await sql.begin(async (tx) => {
      const [redemption] = await tx<any[]>`
        select *,member_id::text,reward_id::text
        from owners.redemptions
        where id=${id}::uuid
        for update
      `;
      if (!redemption) return { error: "طلب الاستبدال غير موجود", status: 404 };

      const transitionAllowed =
        (redemption.status === "requested" && ["approved", "rejected", "cancelled"].includes(status))
        || (redemption.status === "approved" && ["delivered", "rejected", "cancelled"].includes(status))
        || redemption.status === status;
      if (!transitionAllowed) {
        return { error: "لا يمكن تغيير طلب الاستبدال من حالته الحالية إلى الحالة المطلوبة", status: 409 };
      }

      const shouldRefund = ["rejected", "cancelled"].includes(status)
        && !["rejected", "cancelled"].includes(redemption.status);
      if (shouldRefund) {
        const refundRows = await tx<any[]>`
          insert into owners.points_ledger(member_id,points,event_type,event_key,reward_id,description)
          values(
            ${redemption.member_id}::uuid,${Number(redemption.points_cost)},'redemption_refund',
            ${`redemption-refund:${redemption.id}`},${redemption.reward_id}::uuid,'إرجاع نقاط طلب استبدال ملغي'
          )
          on conflict(event_key) do nothing
          returning id::text
        `;
        if (refundRows.length) {
          await tx`
            update owners.members set points_balance=points_balance+${Number(redemption.points_cost)},updated_at=now()
            where id=${redemption.member_id}::uuid
          `;
          await tx`
            update owners.rewards set redeemed_quantity=greatest(0,redeemed_quantity-1),updated_at=now()
            where id=${redemption.reward_id}::uuid
          `;
        }
      }

      await tx`
        update owners.redemptions set
          status=${status},note=${clean(payload.note) || null},reviewed_by=${actor.id}::uuid,
          reviewed_at=now(),updated_at=now()
        where id=${id}::uuid
      `;
      return { ok: true };
    });
    if ("error" in result) return response.status(result.status).json({ ok: false, error: result.error });
    return response.status(200).json({ ok: true });
  }

  if (action === "send_welcome") {
    const memberId = clean(payload.memberId);
    const [member] = await sql<any[]>`
      select *,id::text
      from owners.members
      where id=${memberId}::uuid and status='active'
      limit 1
    `;
    if (!member) return response.status(404).json({ ok: false, error: "العضو غير موجود" });
    if (member.welcome_sent_at) return response.status(409).json({ ok: false, error: "تم إرسال رسالة الترحيب لهذا العضو مسبقًا" });

    const portalUrl = `${publicBase(request)}/owners`;
    const phone = normalizePhone(member.phone_normalized);
    if (!phone) return response.status(400).json({ ok: false, error: "رقم جوال العضو غير صالح" });
    const customerName = clean(member.customer_name) || "عميل مجموعة محمد بن ذعار العجمي";
    const message = `مرحباً ${customerName}\nأهلاً بك في MZJ Owners Community.\nيمكنك الدخول إلى حسابك ومتابعة نقاطك ومكافآتك من هنا:\n${portalUrl}\n\nتاريخ تثق به`;

    try {
      const queued = await queueFirebaseSms({
        byUid: actor.id,
        createdAt: new Date(),
        message,
        meta: { type: "owners_welcome", purpose: "welcome", memberId: member.id },
        phone,
        source: "mzj_owners_community",
        status: "queued",
        to: phone,
      });
      await sql`update owners.members set welcome_sent_at=now(),updated_at=now() where id=${member.id}::uuid`;
      return response.status(200).json({ ok: true, status: "queued", documentId: queued.documentId });
    } catch (error) {
      return response.status(502).json({ ok: false, error: error instanceof Error ? error.message : "تعذر إرسال رسالة الترحيب عبر SMS+" });
    }
  }

  return response.status(400).json({ ok: false, error: "Unknown action" });
}
