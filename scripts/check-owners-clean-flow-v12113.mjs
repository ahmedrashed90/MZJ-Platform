import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const admin = read("src/owners/OwnersCommunityPage.tsx");
const core = read("server/_owners.ts");
const api = read("server/owners.ts");
const inviteApi = read("server/owners-public.ts");
const invite = read("src/owners/OwnersInvitePage.tsx");
const cashApi = read("server/crm/cash-qr.ts");
const cashPage = read("src/crm/pages/CashQrRegistrationPage.tsx");
const css = read("src/styles.css");

const checks = [
  ["sold/new tabs renamed", admin.includes(">عملاء تم البيع</button>") && admin.includes(">العملاء الجديدة</button>") && !admin.includes(">العملاء القديمة</button>")],
  ["imported previous customers are documented in sold customers", admin.includes("تمت إضافة العملاء ضمن عملاء تم البيع")],
  ["dashboard cards are interactive", admin.includes('className="owners-stat-card"') && admin.includes("openMembersPoints") && admin.includes("openSoldReferrals") && admin.includes("openReadyRedemptions")],
  ["outstanding points opens balance detail", admin.includes('membersView === "points"') && admin.includes("تفاصيل النقاط القائمة")],
  ["referral sales and ready redemptions have data filters", admin.includes('referralsView === "sold"') && admin.includes('redemptionsView === "ready"')],
  ["tabs are centered", css.includes(".owners-tabs{display:flex;justify-content:center;flex-wrap:wrap")],
  ["multi-vehicle order is customer classification only", api.includes("has_multi_vehicle_order") && admin.includes("عميل مميز") && css.includes(".owners-member-type.special")],
  ["purchase settings explain one award per order", admin.includes("مرة واحدة للعميل لكل طلب بيع مكتمل، بغض النظر عن عدد السيارات")],
  ["purchase award is once per sales transaction/order and not multiplied by quantity", core.includes("'purchase:'||sale.sale_id::text") && core.includes("'saleQuantity',sale.order_quantity") && !core.includes("configuredPoints*sale.order_quantity")],
  ["legacy initial purchase is bound to its concrete order", core.includes("legacyInitialMapped") && core.includes("existing_purchase.metadata->>'saleId'=sale.sale_id::text")],
  ["cancelled sale zeros only its purchase ledger award", core.includes("purchaseCancelled") && core.includes("مكافأة شراء ملغاة") && core.includes("case when scoped.is_cancelled then 0")],
  ["test members excluded from purchase reconciliation", core.includes("memberKind','real')<>'test")],
  ["legacy/new list excludes customers already retained as sold members", api.includes("not exists (\n            select 1\n            from owners.members member")],
  ["invite registration returns customer's code", inviteApi.includes("ensureLegacyCustomerCodeForLead(lead.id)") && inviteApi.includes("customerCode")],
  ["invite success lets customer copy the code", invite.includes("owners-customer-code-box") && invite.includes("نسخ الكود")],
  ["cash QR registration returns customer's code", cashApi.includes("customerCode?.referral_code")],
  ["cash QR success lets customer copy the code", cashPage.includes("cash-qr-customer-code") && cashPage.includes("نسخ الكود")],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS ${name}`);
  else { console.error(`FAIL ${name}`); failed += 1; }
}
if (failed) process.exit(1);
console.log(`PASS ${checks.length}/${checks.length}`);
