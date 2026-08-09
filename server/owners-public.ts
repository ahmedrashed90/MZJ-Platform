import crypto from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { attachLeadToContactAndOpenRequest } from "./_crm-lifecycle.js";
import { deliverDirectWhatsapp } from "./_crm-messaging.js";
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

function renderNumberedTemplate(content: string, values: string[]) {
  return String(content || "").replace(/{{\s*(\d+)\s*}}/g, (_match, number) => values[Number(number) - 1] || "");
}

function allowedService(value: unknown) {
  const service = clean(value).toLowerCase();
  return ["cash", "finance", "service"].includes(service) ? service : "cash";
}

async function findReferrer(codeValue: unknown) {
  const code = clean(codeValue).toUpperCase();
  if (!code) return null;
  const [member] = await getSql()<any[]>`
    select id::text,customer_name,phone_normalized,referral_code
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

async function registerReferral(response: VercelResponse, payload: Record<string, unknown>) {
  const settings = await getOwnerSettings();
  if (settings.is_enabled === false) {
    return response.status(403).json({ ok: false, error: "MZJ Owners Community غير متاح حاليًا" });
  }

  const referrer = await findReferrer(payload.code);
  if (!referrer) return response.status(404).json({ ok: false, error: "رابط الدعوة غير صالح" });
  const name = clean(payload.name);
  const phone = normalizePhone(payload.phone);
  if (!name) return response.status(400).json({ ok: false, error: "اسم الصديق مطلوب" });
  if (!phone) return response.status(400).json({ ok: false, error: "اكتب رقم جوال صحيح" });
  if (phone === referrer.phone_normalized) {
    return response.status(409).json({ ok: false, error: "لا يمكن استخدام رابط الدعوة لنفس صاحب العضوية" });
  }

  const sql = getSql();
  const [existingOwner] = await sql<any[]>`
    select id::text from owners.members where phone_normalized=${phone} and status='active' limit 1
  `;
  if (existingOwner) {
    return response.status(409).json({ ok: false, error: "هذا الرقم عضو بالفعل في MZJ Owners Community" });
  }

  const [linkedReferral] = await sql<any[]>`
    select id::text,referrer_member_id::text
    from owners.referrals
    where referred_phone_normalized=${phone}
    limit 1
  `;
  if (linkedReferral && linkedReferral.referrer_member_id !== referrer.id) {
    return response.status(409).json({ ok: false, error: "هذا الرقم مرتبط بدعوة سابقة" });
  }

  let [lead] = await sql<any[]>`
    select id::text
    from crm.leads
    where phone_normalized=${phone} and is_deleted=false
    order by created_at
    limit 1
  `;
  if (lead) {
    const [priorSale] = await sql<any[]>`
      select id::text
      from crm.sales_transactions
      where lead_id=${lead.id}::uuid and coalesce(is_cancelled,false)=false
      limit 1
    `;
    if (priorSale) {
      return response.status(409).json({ ok: false, error: "هذا الرقم سبق له الشراء ولا يمكن احتسابه كإحالة جديدة" });
    }
    const referralMetadata: OwnerJson = {
      ownerReferralCode: referrer.referral_code,
      referrerMemberId: referrer.id,
      ownersCommunity: true,
    };
    await sql`
      update crm.leads set
        extra_data=coalesce(extra_data,'{}'::jsonb)||${sql.json(referralMetadata)}::jsonb,
        updated_at=now()
      where id=${lead.id}::uuid
    `;
  } else {
    const service = allowedService(settings.referral_default_service);
    const preferredBranch = clean(settings.referral_default_branch);
    const assignment = await chooseAssignment(service, preferredBranch, "owners_referral");
    const department = service === "finance" ? "finance_sales" : service === "service" ? "customer_service" : "cash_sales";
    const payment = service === "finance" ? "تمويل" : service === "service" ? "خدمة عملاء" : "كاش";
    const extraData: OwnerJson = {
      ownerReferralCode: referrer.referral_code,
      referrerMemberId: referrer.id,
      ownersCommunity: true,
    };
    [lead] = await sql<any[]>`
      insert into crm.leads(
        customer_name,phone,phone_normalized,source_code,source_name,service_key,department_code,
        branch_code,status_label,payment_type,assigned_to,responsible_name_snapshot,registered_at,notes,extra_data
      ) values(
        ${name},${phone},${phone},'owners_referral','MZJ Owners Community',${service},${department},
        ${assignment.branchCode || preferredBranch || null},'عميل جديد',${payment},${assignment.assignedTo || null}::uuid,
        ${assignment.assignedName || null},now(),'تم التسجيل من رابط دعوة MZJ Owners Community',${sql.json(extraData)}
      )
      returning id::text
    `;
    await attachLeadToContactAndOpenRequest({
      leadId: lead.id,
      actor: null,
      classificationMethod: "owners_referral",
    }).catch((error) => console.error("Owners referral CRM contact link failed", error));
  }

  const referralMetadata: OwnerJson = { source: "public_invite" };
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
  return response.status(200).json({ ok: true, message: "تم تسجيل بياناتك وسيقوم فريق MZJ بالتواصل معك" });
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
    if (!settings.otp_template_id) {
      return response.status(503).json({ ok: false, error: "لم يتم ضبط قالب OTP المعتمد من مرسال في إعدادات البرنامج" });
    }

    const [template] = await sql<any[]>`
      select *,id::text
      from crm.message_templates
      where id=${settings.otp_template_id}::uuid
        and is_active=true
        and lower(coalesce(provider,''))='mersal'
        and upper(coalesce(status,''))='APPROVED'
      limit 1
    `;
    if (!template) return response.status(503).json({ ok: false, error: "قالب OTP المحدد غير متاح أو غير معتمد" });

    const challengeId = crypto.randomUUID();
    const otp = randomOtp();
    await sql`
      insert into owners.otp_challenges(id,phone_normalized,code_hash,max_attempts,expires_at)
      values(
        ${challengeId}::uuid,${phone},${ownerOtpHash(challengeId, phone, otp)},
        ${Number(settings.otp_max_attempts || 5)},now()+${Number(settings.otp_expiry_minutes || 5)}*interval '1 minute'
      )
    `;
    const text = renderNumberedTemplate(template.content, [
      otp,
      String(Number(settings.otp_expiry_minutes || 5)),
    ]);
    try {
      await deliverDirectWhatsapp({
        phone,
        text,
        template,
        idempotencyKey: `owners-otp:${challengeId}`,
        reason: "owners_otp",
      });
    } catch (error) {
      await sql`delete from owners.otp_challenges where id=${challengeId}::uuid`;
      const message = error instanceof Error ? error.message : "تعذر إرسال رمز التحقق عبر واتساب";
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
      select id::text,name,description,reward_type,points_cost,stock_quantity,redeemed_quantity,starts_at,ends_at
      from owners.rewards
      where is_active=true
        and (starts_at is null or starts_at<=now())
        and (ends_at is null or ends_at>=now())
        and (stock_quantity is null or redeemed_quantity<stock_quantity)
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
      if (reward.stock_quantity != null && Number(reward.redeemed_quantity) >= Number(reward.stock_quantity)) {
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
