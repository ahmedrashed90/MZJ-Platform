import crypto from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionUser } from "./_auth.js";
import { hasPermission } from "./_access-control.js";
import { clean } from "./_crm-utils.js";
import { getSql } from "./_db.js";
import { normalizePhone } from "./_phone-utils.js";
import {
  backfillOwnerPurchasePointsForExistingMembers,
  ensureOwnerMemberForLead,
  processOwnerSaleForLead,
  syncOwnerReferralProgress,
} from "./_owners.js";
import { ensureOwnersSchema } from "./_owners-schema.js";
import { syncLegacyCustomerCodes } from "./_owners-customer-segments.js";
import { DEFAULT_OWNER_WELCOME_MESSAGE_TEMPLATE, queueLegacyOwnerWelcomeSms, queueOwnerWelcomeSms } from "./_owners-welcome.js";
import { getWebsiteStock } from "./_website-stock.js";
import { ownerPurchaseLedger, ownerPurchaseSummary, ownerOwnsSalesOrder } from "./_owners-purchases.js";
import { downloadNextErpSalesInvoicePdf, listNextErpSalesInvoices, ownerInvoiceError } from "./_owners-invoices.js";

const OWNERS_PORTAL_URL = "https://mzj-platform.vercel.app/club";

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

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(value));
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


function randomRedemptionCode() {
  return crypto.randomInt(0, 100_000_000).toString().padStart(8, "0");
}

async function websiteCarsForDiscountCalculator() {
  try {
    const websiteStock = await getWebsiteStock();
    return {
      cars: websiteStock.cars
        .filter((car) => car.price > 0)
        .map((car) => ({ vehicleId: car.vehicleId, title: car.title, price: car.price, priceBeforeTax: car.priceBeforeTax })),
      warning: websiteStock.warning || "",
    };
  } catch (error) {
    return {
      cars: [] as Array<{ vehicleId: string; title: string; price: number; priceBeforeTax: number }>,
      warning: error instanceof Error ? error.message : "تعذر تحميل سيارات الموقع",
    };
  }
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

async function findRedemptionByCode(sql: ReturnType<typeof getSql>, codeValue: unknown) {
  const code = clean(codeValue);
  if (!/^\d{8}$/.test(code)) return null;
  const [row] = await sql<any[]>`
    select
      rd.id::text,rd.status,rd.points_cost,rd.redemption_code,rd.created_at,rd.reviewed_at,
      m.customer_name,m.phone_normalized,r.name as reward_name,u.full_name as reviewed_by_name
    from owners.redemptions rd
    join owners.members m on m.id=rd.member_id
    join owners.rewards r on r.id=rd.reward_id
    left join core.users u on u.id=rd.reviewed_by
    where rd.redemption_code=${code}
    limit 1
  `;
  return row || null;
}

function redemptionLookupPayload(row: any) {
  if (!row) return { ok: true, state: "invalid", message: "كود الاستبدال غير صحيح" };
  const redemption = {
    id: row.id,
    code: row.redemption_code,
    status: row.status,
    pointsCost: Number(row.points_cost || 0),
    createdAt: row.created_at,
    redeemedAt: row.reviewed_at || null,
    redeemedBy: row.reviewed_by_name || null,
    customerName: row.customer_name || "عميل MZJ",
    phone: row.phone_normalized || "",
    rewardName: row.reward_name || "مكافأة",
  };
  if (row.status === "approved") return { ok: true, state: "valid", redemption };
  if (row.status === "delivered") return { ok: true, state: "used", redemption };
  return { ok: true, state: "unavailable", message: row.status === "cancelled" ? "تم إلغاء هذا الاستبدال" : row.status === "rejected" ? "تم رفض هذا الاستبدال" : "الاستبدال غير جاهز للتسليم", redemption };
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
    if (!allowed) return response.status(403).json({ ok: false, error: "لا توجد لديك صلاحية للدخول إلى MZJ Club Community" });
    if (scope === "settings") {
      const settingsRows = await sql<any[]>`select * from owners.settings where id='default'`;
      return response.status(200).json({ ok: true, settings: settingsRows[0] || {} });
    }

    if (scope === "purchase_invoices" || scope === "invoice_pdf") {
      const memberId = clean(request.query.memberId);
      const salesOrder = clean(request.query.salesOrder);
      if (!isUuid(memberId) || !salesOrder) return response.status(400).json({ ok: false, error: "العميل أو طلب البيع غير محدد" });
      if (!await ownerOwnsSalesOrder(memberId, salesOrder)) {
        return response.status(404).json({ ok: false, error: "طلب البيع غير مرتبط بهذه العضوية" });
      }
      try {
        const invoices = await listNextErpSalesInvoices(salesOrder);
        if (scope === "purchase_invoices") return response.status(200).json({ ok: true, salesOrder, invoices });
        const invoiceName = clean(request.query.invoice);
        if (!invoiceName || !invoices.some((invoice) => invoice.name === invoiceName)) {
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

    if (scope === "profile") {
      const kind = clean(request.query.kind) === "legacy" ? "legacy" : "member";
      const id = clean(request.query.id);
      if (!isUuid(id)) return response.status(400).json({ ok: false, error: "العميل غير محدد بشكل صحيح" });

      if (kind === "legacy") {
        const [customer] = await sql<any[]>`
          select
            c.id::text,c.crm_lead_id::text,c.customer_name,c.phone_normalized,c.referral_code,c.created_at,c.updated_at,
            l.status_label,l.department_code,l.branch_code,l.source_code,l.source_name,l.registered_at,
            u.full_name as assigned_name,b.name as branch_name,src.name as catalog_source_name
          from owners.legacy_customer_codes c
          join crm.leads l on l.id=c.crm_lead_id and l.is_deleted=false
          left join core.users u on u.id=l.assigned_to
          left join core.branches b on b.code=l.branch_code
          left join core.sources src on src.code=l.source_code
          where c.id=${id}::uuid and c.status='active'
          limit 1
        `;
        if (!customer) return response.status(404).json({ ok: false, error: "العميل غير موجود ضمن العملاء الجديدة" });
        const websiteCars = await websiteCarsForDiscountCalculator();
        const [pointsSettings] = await sql<any[]>`select points_repurchase,points_sale,points_unique_open from owners.settings where id='default'`;
        return response.status(200).json({
          ok: true,
          profileKind: "legacy",
          member: {
            id: customer.id,
            name: customer.customer_name || "عميل MZJ",
            phone: customer.phone_normalized || "",
            points: 0,
            lifetimePoints: 0,
            tier: "member",
            referralCode: customer.referral_code || "",
            inviteUrl: "",
            statusLabel: customer.status_label || "عميل جديد",
            branchName: customer.branch_name || customer.branch_code || "",
            sourceName: customer.catalog_source_name || customer.source_name || customer.source_code || "",
            assignedName: customer.assigned_name || "",
            joinedAt: customer.created_at || customer.registered_at || null,
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
            repurchase: Number(pointsSettings?.points_repurchase ?? 500),
            referralSale: Number(pointsSettings?.points_sale ?? 700),
            referralSend: Number(pointsSettings?.points_unique_open ?? 50),
          },
          websiteCars: websiteCars.cars,
          websiteCarsWarning: websiteCars.warning,
        });
      }

      const [member] = await sql<any[]>`
        select
          m.id::text,m.customer_name,m.phone_normalized,m.referral_code,m.points_balance,m.lifetime_points,
          m.tier_code,m.first_sale_at,m.last_sale_at,m.activated_at,m.created_at,m.welcome_sent_at,m.metadata
        from owners.members m
        where m.id=${id}::uuid and m.status='active'
        limit 1
      `;
      if (!member) return response.status(404).json({ ok: false, error: "عضوية العميل غير موجودة" });

      const [referrals, referralVisits, ledger, rewards, redemptions, purchaseSummary] = await Promise.all([
        sql<any[]>`
          select id::text,referred_name,status,registered_at,qualified_at,sold_at,created_at
          from owners.referrals
          where referrer_member_id=${id}::uuid
          order by created_at desc
          limit 100
        `,
        sql<any[]>`
          select id::text,created_at
          from owners.referral_visits
          where referrer_member_id=${id}::uuid
          order by created_at desc
          limit 100
        `,
        ownerPurchaseLedger(id),
        sql<any[]>`
          select id::text,name,description,reward_type,reward_value,show_on_member_page,points_cost,starts_at,ends_at
          from owners.rewards
          where is_active=true and show_on_member_page=true
            and points_cost<=${Number(member.points_balance || 0)}
            and (starts_at is null or starts_at<=now())
            and (ends_at is null or ends_at>=now())
            and (stock_quantity is null or redeemed_quantity<stock_quantity)
          order by points_cost,name
        `,
        sql<any[]>`
          select rd.id::text,rd.status,rd.points_cost,rd.redemption_code,rd.created_at,rd.reviewed_at,
            r.name as reward_name,u.full_name as reviewed_by_name
          from owners.redemptions rd
          join owners.rewards r on r.id=rd.reward_id
          left join core.users u on u.id=rd.reviewed_by
          where rd.member_id=${id}::uuid
          order by rd.created_at desc
          limit 50
        `,
        ownerPurchaseSummary(id),
      ]);

      const websiteCars = await websiteCarsForDiscountCalculator();
      const [pointsSettings] = await sql<any[]>`select points_repurchase,points_sale,points_unique_open from owners.settings where id='default'`;
      return response.status(200).json({
        ok: true,
        profileKind: "member",
        member: {
          id: member.id,
          name: member.customer_name || "عميل MZJ",
          phone: member.phone_normalized || "",
          points: Number(member.points_balance || 0),
          lifetimePoints: Number(member.lifetime_points || 0),
          tier: member.tier_code || "member",
          referralCode: member.referral_code || "",
          inviteUrl: `${publicBase(request)}/club/invite/${member.referral_code}`,
          firstSaleAt: purchaseSummary.firstSaleAt || member.first_sale_at || null,
          lastSaleAt: purchaseSummary.lastSaleAt || member.last_sale_at || null,
          joinedAt: member.activated_at || member.created_at || null,
          purchaseCount: Number(purchaseSummary.purchaseCount || 0),
        },
        referrals,
        referralVisits,
        ledger,
        rewards,
        cardRewards: [],
        redemptions,
        pointsMenu: {
          repurchase: Number(pointsSettings?.points_repurchase ?? 500),
          referralSale: Number(pointsSettings?.points_sale ?? 700),
          referralSend: Number(pointsSettings?.points_unique_open ?? 50),
        },
        websiteCars: websiteCars.cars,
        websiteCarsWarning: websiteCars.warning,
      });
    }

    // Dashboard loading is intentionally read-only. Heavy CRM/Owners synchronization
    // runs only from the explicit sync action or when point settings are saved.
    const [settings, members, legacyCustomers, referrals, rewards, redemptions, stats] = await Promise.all([
      sql<any[]>`select * from owners.settings where id='default'`.then((rows) => rows[0] || {}),
      sql<any[]>`
        select
          m.id::text,m.crm_lead_id::text,m.source_sale_id::text,m.customer_name,m.phone_normalized,m.referral_code,m.points_balance,m.lifetime_points,
          m.tier_code,m.first_sale_at,m.last_sale_at,m.last_login_at,m.welcome_sent_at,m.metadata,
          coalesce(m.metadata->>'memberKind','real') as member_kind,
          coalesce(m.metadata->>'enrollmentSource','canonical_sale') as enrollment_source,
          coalesce(sale_summary.max_order_quantity,0)::int as max_order_quantity,
          coalesce(sale_summary.has_multi_vehicle_order,false) as is_special_customer,
          coalesce(sale_summary.active_sales_count,0)::int as active_sales_count,
          count(distinct r.id)::int as referrals_count,
          count(distinct r.id) filter(where r.status='sold')::int as sales_count
        from owners.members m
        left join owners.referrals r on r.referrer_member_id=m.id
        left join lateral (
          select
            max(greatest(coalesce(st.quantity,1),1))::int as max_order_quantity,
            bool_or(greatest(coalesce(st.quantity,1),1)>1) as has_multi_vehicle_order,
            count(distinct st.id)::int as active_sales_count
          from crm.sales_transactions st
          join crm.leads sl on sl.id=st.lead_id and sl.is_deleted=false
          where coalesce(st.is_cancelled,false)=false
            and (
              (m.source_sale_id is not null and st.id=m.source_sale_id)
              or (m.crm_lead_id is not null and st.lead_id=m.crm_lead_id)
              or (
                nullif(m.phone_normalized,'') is not null
                and nullif(sl.phone_normalized,'') is not null
                and sl.phone_normalized=m.phone_normalized
              )
            )
        ) sale_summary on true
        where m.status='active'
        group by m.id,sale_summary.max_order_quantity,sale_summary.has_multi_vehicle_order,sale_summary.active_sales_count
        order by m.created_at desc
        limit 1000
      `,
      sql<any[]>`
        select
          c.id::text,c.crm_lead_id::text,c.customer_name,c.phone_normalized,c.referral_code,c.welcome_sent_at,c.created_at,c.updated_at,
          0::int as lifetime_points,
          l.status_label,l.department_code,l.branch_code,l.source_code,l.source_name,l.payment_type,l.registered_at,
          u.full_name as assigned_name,b.name as branch_name,src.name as catalog_source_name
        from owners.legacy_customer_codes c
        join crm.leads l on l.id=c.crm_lead_id and l.is_deleted=false
        left join core.users u on u.id=l.assigned_to
        left join core.branches b on b.code=l.branch_code
        left join core.sources src on src.code=l.source_code
        where c.status='active'
          and coalesce(l.status_label,'') <> 'تم البيع'
          and not exists (
            select 1
            from owners.members member
            where member.status='active'
              and (member.crm_lead_id=l.id or (nullif(member.phone_normalized,'') is not null and member.phone_normalized=l.phone_normalized))
          )
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
          rd.id::text,rd.status,rd.points_cost,rd.redemption_code,rd.note,rd.created_at,rd.reviewed_at,
          m.customer_name,m.phone_normalized,r.name as reward_name,u.full_name as reviewed_by_name
        from owners.redemptions rd
        join owners.members m on m.id=rd.member_id
        join owners.rewards r on r.id=rd.reward_id
        left join core.users u on u.id=rd.reviewed_by
        order by rd.created_at desc
        limit 500
      `,
      sql<any[]>`
        select
          (select count(*) from owners.members where status='active' and coalesce(metadata->>'memberKind','real')<>'test')::int as members,
          (select count(*) from owners.legacy_customer_codes c join crm.leads l on l.id=c.crm_lead_id where c.status='active' and l.is_deleted=false and coalesce(l.status_label,'')<>'تم البيع' and not exists (select 1 from owners.members member where member.status='active' and (member.crm_lead_id=l.id or (nullif(member.phone_normalized,'') is not null and member.phone_normalized=l.phone_normalized))))::int as legacy_customers,
          (select count(*) from owners.referrals r join owners.members m on m.id=r.referrer_member_id where coalesce(m.metadata->>'memberKind','real')<>'test')::int as referrals,
          (select count(*) from owners.referrals r join owners.members m on m.id=r.referrer_member_id where r.status='sold' and coalesce(m.metadata->>'memberKind','real')<>'test')::int as referral_sales,
          (select coalesce(sum(points_balance),0) from owners.members where status='active' and coalesce(metadata->>'memberKind','real')<>'test')::int as outstanding_points,
          (select count(*) from owners.redemptions rd join owners.members m on m.id=rd.member_id where rd.status='approved' and coalesce(m.metadata->>'memberKind','real')<>'test')::int as ready_redemptions
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
  if (["lookup_redemption", "confirm_redemption"].includes(action)) {
    if (!canManageCommunity) return response.status(403).json({ ok: false, error: "لا توجد لديك صلاحية لإدارة MZJ Club Community" });
    const code = clean(payload.code);
    if (!/^\d{8}$/.test(code)) return response.status(400).json({ ok: false, error: "كود الاستبدال يجب أن يكون 8 أرقام" });
    if (action === "lookup_redemption") {
      return response.status(200).json(redemptionLookupPayload(await findRedemptionByCode(sql, code)));
    }
    const result = await sql.begin(async (tx) => {
      const [row] = await tx<any[]>`
        select id::text,status,redemption_code
        from owners.redemptions
        where redemption_code=${code}
        for update
      `;
      if (!row) return { status: 404, error: "كود الاستبدال غير صحيح" };
      if (row.status === "delivered") return { status: 409, error: "تم استخدام هذا الكود مسبقًا" };
      if (row.status !== "approved") return { status: 409, error: "هذا الاستبدال غير جاهز للتسليم" };
      await tx`
        update owners.redemptions set status='delivered',reviewed_by=${actor.id}::uuid,reviewed_at=now(),updated_at=now()
        where id=${row.id}::uuid
      `;
      return { ok: true };
    });
    if ("error" in result) return response.status(result.status).json({ ok: false, error: result.error });
    return response.status(200).json(redemptionLookupPayload(await findRedemptionByCode(sql, code)));
  }

  if (["save_settings", "save_points_settings"].includes(action) && !canManageSettings) return response.status(403).json({ ok: false, error: "لا توجد لديك صلاحية لتعديل إعدادات البرنامج" });
  if (!["save_settings", "save_points_settings"].includes(action) && !canManageCommunity) return response.status(403).json({ ok: false, error: "لا توجد لديك صلاحية لإدارة MZJ Club Community" });

  if (action === "save_settings") {
    const silverPoints = integer(payload.silverPoints, 1000, 0, 1_000_000_000);
    const goldPoints = Math.max(silverPoints, integer(payload.goldPoints, 3000, 0, 1_000_000_000));
    const platinumPoints = Math.max(goldPoints, integer(payload.platinumPoints, 7000, 0, 1_000_000_000));
    const uniqueOpenPoints = integer(payload.pointsUniqueOpen, 50, 0, 1_000_000);
    const salePoints = integer(payload.pointsSale, 700, 0, 1_000_000);
    const dailyOpenPointsCap = Math.max(uniqueOpenPoints, integer(payload.dailyOpenPointsCap, 50, 0, 1_000_000));
    const [settings] = await sql<any[]>`
      update owners.settings set
        is_enabled=${payload.isEnabled !== false},
        otp_expiry_minutes=${integer(payload.otpExpiryMinutes, 5, 1, 30)},
        otp_resend_seconds=${integer(payload.otpResendSeconds, 60, 15, 600)},
        otp_max_attempts=${integer(payload.otpMaxAttempts, 5, 1, 20)},
        otp_hourly_limit=${integer(payload.otpHourlyLimit, 5, 1, 30)},
        points_purchase_enabled=${payload.pointsPurchaseEnabled === true},
        points_purchase=${integer(payload.pointsPurchase, 500, 0, 1_000_000)},
        points_repurchase_enabled=${payload.pointsRepurchaseEnabled !== false},
        points_repurchase=${integer(payload.pointsRepurchase, 500, 0, 1_000_000)},
        points_unique_open_enabled=${payload.pointsUniqueOpenEnabled !== false},
        points_unique_open=${uniqueOpenPoints},
        points_registration_enabled=${payload.pointsRegistrationEnabled !== false},
        points_registration=${integer(payload.pointsRegistration, 10, 0, 1_000_000)},
        points_qualified_enabled=${payload.pointsQualifiedEnabled !== false},
        points_qualified=${integer(payload.pointsQualified, 25, 0, 1_000_000)},
        points_sale_enabled=${payload.pointsSaleEnabled !== false},
        points_sale=${salePoints},
        daily_open_points_cap=${dailyOpenPointsCap},
        silver_points=${silverPoints},
        gold_points=${goldPoints},
        platinum_points=${platinumPoints},
        referral_default_service=${clean(payload.referralDefaultService) || "cash"},
        referral_default_branch=${clean(payload.referralDefaultBranch) || "online"},
        friend_benefit_title=${clean(payload.friendBenefitTitle) || "دعوة من مجموعة محمد بن ذعار العجمي"},
        friend_benefit_text=${clean(payload.friendBenefitText) || "سجل بياناتك من رابط الدعوة وسيقوم فريق مجموعة محمد بن ذعار العجمي بالتواصل معك."},
        welcome_message_enabled=${payload.welcomeMessageEnabled === true},
        welcome_message_template=${clean(payload.welcomeMessageTemplate) || DEFAULT_OWNER_WELCOME_MESSAGE_TEMPLATE},
        updated_by=${actor.id}::uuid,
        updated_at=now()
      where id='default'
      returning *
    `;
    const purchasersSynced = settings?.points_purchase_enabled === true
      ? await syncMembersFromCanonicalSales()
      : 0;
    const purchasePointsApplied = settings?.points_purchase_enabled === true || settings?.points_repurchase_enabled !== false
      ? await backfillOwnerPurchasePointsForExistingMembers()
      : 0;
    return response.status(200).json({ ok: true, settings, purchasersSynced, purchasePointsApplied });
  }

  if (action === "save_points_settings") {
    const purchasePoints = integer(payload.pointsPurchase, 500, 0, 1_000_000);
    const purchaseEnabled = payload.pointsPurchaseEnabled === true;
    const uniqueOpenPoints = integer(payload.pointsUniqueOpen, 50, 0, 1_000_000);
    const salePoints = integer(payload.pointsSale, 700, 0, 1_000_000);
    const dailyOpenPointsCap = Math.max(uniqueOpenPoints, integer(payload.dailyOpenPointsCap, 50, 0, 1_000_000));
    const [settings] = await sql<any[]>`
      update owners.settings set
        points_purchase_enabled=${purchaseEnabled},
        points_purchase=${purchasePoints},
        points_repurchase_enabled=${payload.pointsRepurchaseEnabled !== false},
        points_repurchase=${integer(payload.pointsRepurchase, 500, 0, 1_000_000)},
        points_unique_open_enabled=${payload.pointsUniqueOpenEnabled !== false},
        points_unique_open=${uniqueOpenPoints},
        points_registration_enabled=${payload.pointsRegistrationEnabled !== false},
        points_registration=${integer(payload.pointsRegistration, 10, 0, 1_000_000)},
        points_qualified_enabled=${payload.pointsQualifiedEnabled !== false},
        points_qualified=${integer(payload.pointsQualified, 25, 0, 1_000_000)},
        points_sale_enabled=${payload.pointsSaleEnabled !== false},
        points_sale=${salePoints},
        daily_open_points_cap=${dailyOpenPointsCap},
        updated_by=${actor.id}::uuid,updated_at=now()
      where id='default'
      returning *
    `;
    const purchasersSynced = settings?.points_purchase_enabled === true
      ? await syncMembersFromCanonicalSales()
      : 0;
    const purchasePointsApplied = settings?.points_purchase_enabled === true || settings?.points_repurchase_enabled !== false
      ? await backfillOwnerPurchasePointsForExistingMembers()
      : 0;
    return response.status(200).json({ ok: true, settings, purchasersSynced, purchasePointsApplied });
  }

  if (action === "sync_members") {
    const synced = await syncMembersFromCanonicalSales();
    await syncLegacyCustomerCodes();
    const referrals = await syncOwnerReferralProgress();
    const purchasePointsApplied = await backfillOwnerPurchasePointsForExistingMembers();
    return response.status(200).json({ ok: true, synced, referrals, purchasePointsApplied });
  }

  if (action === "create_test_member") {
    const result = await createManualOwnerMember({
      name: payload.name, phone: payload.phone, source: "admin_test", actorId: actor.id,
    });
    if (result.status === "invalid") return response.status(400).json({ ok: false, error: result.error });
    if (result.status === "duplicate") return response.status(409).json({ ok: false, error: "رقم الجوال موجود بالفعل ضمن أعضاء البرنامج" });
    return response.status(200).json({ ok: true, memberId: result.memberId });
  }

  if (["delete_member", "delete_test_member"].includes(action)) {
    const memberId = clean(payload.memberId);
    const [deleted] = await sql<any[]>`
      delete from owners.members
      where id=${memberId}::uuid
      returning id::text
    `;
    if (!deleted) return response.status(404).json({ ok: false, error: "العضو غير موجود" });
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
    const showOnMemberPage = payload.showOnMemberPage === true;
    const availableForReferralPurchase = payload.availableForReferralPurchase === true;
    const availableForExistingCustomerPurchase = payload.availableForExistingCustomerPurchase === true;
    const availableForFriendReferralPurchase = payload.availableForFriendReferralPurchase === true;
    const availableForRepurchase = payload.availableForRepurchase === true;
    const checkoutDiscountType = clean(payload.checkoutDiscountType) === "percentage" ? "percentage" : "amount";
    const checkoutDiscountRaw = Number(payload.checkoutDiscountValue ?? payload.checkoutDiscountAmount);
    const checkoutDiscountValue = rewardType === "discount" && (availableForReferralPurchase || availableForExistingCustomerPurchase || availableForFriendReferralPurchase || availableForRepurchase)
      ? Math.round((Number.isFinite(checkoutDiscountRaw) ? checkoutDiscountRaw : 0) * 100) / 100
      : 0;
    const checkoutDiscountAmount = checkoutDiscountType === "amount" ? checkoutDiscountValue : 0;
    const pointsCost = integer(payload.pointsCost, 1, 1, 1_000_000_000);
    const hasStockQuantity = Object.prototype.hasOwnProperty.call(payload, "stockQuantity");
    const stockQuantity = payload.stockQuantity === "" || payload.stockQuantity == null
      ? null
      : integer(payload.stockQuantity, 0, 0, 1_000_000_000);
    const startsAt = optionalDate(payload.startsAt);
    const endsAt = optionalDate(payload.endsAt);
    const isActive = payload.isActive !== false;
    if (!name) return response.status(400).json({ ok: false, error: "اسم المكافأة مطلوب" });
    if (!rewardValue) return response.status(400).json({ ok: false, error: "حدد قيمة أو تفاصيل المكافأة التي ستظهر للعميل" });
    if ((availableForReferralPurchase || availableForExistingCustomerPurchase || availableForFriendReferralPurchase || availableForRepurchase) && rewardType === "discount" && !(checkoutDiscountValue > 0)) {
      return response.status(400).json({ ok: false, error: "حدد قيمة الخصم أو نسبة الخصم للمكافأة المتاحة في طلب الموقع" });
    }
    if (rewardType === "discount" && checkoutDiscountType === "percentage" && checkoutDiscountValue > 100) {
      return response.status(400).json({ ok: false, error: "نسبة الخصم يجب أن تكون بين 0 و100" });
    }

    if (id) {
      await sql`
        update owners.rewards set
          name=${name},description=${description || null},reward_type=${rewardType},reward_value=${rewardValue || null},
          show_on_member_page=${showOnMemberPage},available_for_referral_purchase=${availableForReferralPurchase},
          available_for_existing_customer_purchase=${availableForExistingCustomerPurchase},
          available_for_friend_referral_purchase=${availableForFriendReferralPurchase},available_for_repurchase=${availableForRepurchase},
          checkout_discount_type=${checkoutDiscountType},checkout_discount_value=${checkoutDiscountValue},
          checkout_discount_amount=${checkoutDiscountAmount},points_cost=${pointsCost},stock_quantity=case when ${hasStockQuantity} then ${stockQuantity} else stock_quantity end,
          starts_at=${startsAt}::timestamptz,ends_at=${endsAt}::timestamptz,is_active=${isActive},
          updated_by=${actor.id}::uuid,updated_at=now()
        where id=${id}::uuid
      `;
    } else {
      await sql`
        insert into owners.rewards(
          name,description,reward_type,reward_value,show_on_member_card,show_on_member_page,available_for_referral_purchase,available_for_existing_customer_purchase,available_for_friend_referral_purchase,available_for_repurchase,
          checkout_discount_type,checkout_discount_value,checkout_discount_amount,
          points_cost,stock_quantity,starts_at,ends_at,is_active,created_by,updated_by
        ) values(
          ${name},${description || null},${rewardType},${rewardValue || null},false,${showOnMemberPage},${availableForReferralPurchase},${availableForExistingCustomerPurchase},${availableForFriendReferralPurchase},${availableForRepurchase},
          ${checkoutDiscountType},${checkoutDiscountValue},${checkoutDiscountAmount},${pointsCost},${stockQuantity},
          ${startsAt}::timestamptz,${endsAt}::timestamptz,${isActive},${actor.id}::uuid,${actor.id}::uuid
        )
      `;
    }
    return response.status(200).json({ ok: true });
  }

  if (action === "reward_usage") {
    const id = clean(payload.id);
    if (!id) return response.status(400).json({ ok: false, error: "المكافأة غير محددة" });

    const [reward] = await sql<any[]>`
      select id::text,name,reward_type,reward_value,redeemed_quantity,referral_purchase_redeemed_quantity
      from owners.rewards
      where id=${id}::uuid
      limit 1
    `;
    if (!reward) return response.status(404).json({ ok: false, error: "المكافأة غير موجودة" });

    const [purchaseUsages, redemptionUsages] = await Promise.all([
      sql<any[]>`
        select
          b.id::text,
          'website_purchase'::text as usage_type,
          coalesce(nullif(rf.referred_name,''),nullif(l.customer_name,''),nullif(om.customer_name,''),'عميل') as customer_name,
          b.referred_phone_normalized as phone,
          b.customer_kind,
          b.website_order_id,
          b.next_erp_sales_order,
          b.created_at,
          coalesce(nullif(b.metadata->>'referralCode',''),nullif(om.referral_code,''),nullif(lc.referral_code,''),'') as referral_code,
          case when b.referrer_kind='member' then om.customer_name else lc.customer_name end as code_owner_name,
          b.referrer_kind,
          null::text as redemption_status,
          null::integer as points_cost
        from owners.referral_purchase_benefits b
        left join owners.referrals rf on rf.id=b.referral_id
        left join owners.members om on om.id=b.referrer_member_id
        left join owners.legacy_customer_codes lc on lc.id=b.legacy_customer_code_id
        left join lateral (
          select lead.customer_name
          from crm.leads lead
          where lead.is_deleted=false and lead.phone_normalized=b.referred_phone_normalized
          order by lead.updated_at desc,lead.created_at desc
          limit 1
        ) l on true
        where b.reward_id=${id}::uuid
        order by b.created_at desc
        limit 1000
      `,
      sql<any[]>`
        select
          rd.id::text,
          'member_redemption'::text as usage_type,
          m.customer_name,
          m.phone_normalized as phone,
          'member'::text as customer_kind,
          null::text as website_order_id,
          null::text as next_erp_sales_order,
          rd.created_at,
          m.referral_code,
          m.customer_name as code_owner_name,
          'member'::text as referrer_kind,
          rd.status as redemption_status,
          rd.points_cost
        from owners.redemptions rd
        join owners.members m on m.id=rd.member_id
        where rd.reward_id=${id}::uuid
          and rd.status in ('requested','approved','delivered')
        order by rd.created_at desc
        limit 1000
      `,
    ]);

    const usages = [...purchaseUsages, ...redemptionUsages]
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return response.status(200).json({
      ok: true,
      reward: {
        id: reward.id,
        name: reward.name,
        type: reward.reward_type,
        value: reward.reward_value || "",
      },
      counts: {
        total: usages.length,
        websitePurchases: purchaseUsages.length,
        memberRedemptions: redemptionUsages.length,
      },
      usages,
    });
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

      let redemptionCode = clean(redemption.redemption_code);
      if (status === "approved" && !redemptionCode) {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const candidate = randomRedemptionCode();
          const [exists] = await tx<any[]>`select 1 from owners.redemptions where redemption_code=${candidate} limit 1`;
          if (!exists) { redemptionCode = candidate; break; }
        }
        if (!redemptionCode) return { error: "تعذر إنشاء كود استبدال فريد", status: 500 };
      }

      await tx`
        update owners.redemptions set
          status=${status},redemption_code=coalesce(redemption_code,${redemptionCode || null}),note=${clean(payload.note) || null},reviewed_by=${actor.id}::uuid,
          reviewed_at=now(),updated_at=now()
        where id=${id}::uuid
      `;
      return { ok: true };
    });
    if ("error" in result) return response.status(result.status).json({ ok: false, error: result.error });
    return response.status(200).json({ ok: true });
  }

  if (action === "send_legacy_welcome") {
    const legacyCustomerId = clean(payload.legacyCustomerId);
    try {
      const result = await queueLegacyOwnerWelcomeSms({
        legacyCustomerId,
        byUid: actor.id,
        portalUrl: OWNERS_PORTAL_URL,
        purpose: "manual_new_customer_welcome",
      });
      if (result.status === "customer_not_found") return response.status(404).json({ ok: false, error: "العميل غير موجود ضمن العملاء الجديدة" });
      if (result.status === "already_sent") return response.status(409).json({ ok: false, error: "تم إرسال رسالة الترحيب لهذا العميل مسبقًا" });
      if (result.status === "invalid_phone") return response.status(400).json({ ok: false, error: "رقم جوال العميل غير صالح" });
      return response.status(200).json({ ok: true, status: "queued", documentId: result.documentId });
    } catch (error) {
      return response.status(502).json({ ok: false, error: error instanceof Error ? error.message : "تعذر إرسال رسالة الترحيب عبر SMS+" });
    }
  }

  if (action === "send_legacy_welcome_by_status") {
    const statusLabel = clean(payload.statusLabel);
    if (!statusLabel) return response.status(400).json({ ok: false, error: "اختر الحالة أولاً" });

    const customers = await sql<any[]>`
      select c.id::text,c.welcome_sent_at
      from owners.legacy_customer_codes c
      join crm.leads l on l.id=c.crm_lead_id and l.is_deleted=false
      where c.status='active'
        and coalesce(l.status_label,'')<>'تم البيع'
        and coalesce(l.status_label,'')=${statusLabel}
        and not exists (
          select 1 from owners.members member
          where member.status='active'
            and (member.crm_lead_id=l.id or (nullif(member.phone_normalized,'') is not null and member.phone_normalized=l.phone_normalized))
        )
      order by l.updated_at desc,l.created_at desc
      limit 5000
    `;

    const summary = {
      matched: customers.length,
      queued: 0,
      alreadySent: 0,
      invalidPhone: 0,
      noLongerEligible: 0,
      failed: 0,
    };

    for (let index = 0; index < customers.length; index += 20) {
      const batch = customers.slice(index, index + 20);
      const results = await Promise.all(batch.map(async (customer) => {
        if (customer.welcome_sent_at) return { status: "already_sent" as const };
        try {
          return await queueLegacyOwnerWelcomeSms({
            legacyCustomerId: customer.id,
            byUid: actor.id,
            portalUrl: OWNERS_PORTAL_URL,
            purpose: "bulk_new_customer_welcome",
          });
        } catch (error) {
          console.error("MZJ Owners bulk welcome SMS+ queue failed", { legacyCustomerId: customer.id, statusLabel, error });
          return null;
        }
      }));

      for (const result of results) {
        if (!result) { summary.failed += 1; continue; }
        if (result.status === "queued") summary.queued += 1;
        else if (result.status === "already_sent") summary.alreadySent += 1;
        else if (result.status === "invalid_phone") summary.invalidPhone += 1;
        else if (result.status === "customer_not_found") summary.noLongerEligible += 1;
      }
    }

    return response.status(200).json({ ok: true, statusLabel, summary });
  }

  if (action === "send_welcome") {
    const memberId = clean(payload.memberId);
    try {
      const result = await queueOwnerWelcomeSms({
        memberId,
        byUid: actor.id,
        portalUrl: `${publicBase(request)}/club`,
      });
      if (result.status === "member_not_found") return response.status(404).json({ ok: false, error: "العضو غير موجود" });
      if (result.status === "already_sent") return response.status(409).json({ ok: false, error: "تم إرسال رسالة الترحيب لهذا العضو مسبقًا" });
      if (result.status === "invalid_phone") return response.status(400).json({ ok: false, error: "رقم جوال العضو غير صالح" });
      return response.status(200).json({ ok: true, status: "queued", documentId: result.documentId });
    } catch (error) {
      return response.status(502).json({ ok: false, error: error instanceof Error ? error.message : "تعذر إرسال رسالة الترحيب عبر SMS+" });
    }
  }

  return response.status(400).json({ ok: false, error: "Unknown action" });
}
