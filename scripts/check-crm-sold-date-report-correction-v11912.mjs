import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const drawer = read("src/crm/components/LeadDrawer.tsx");
const leads = read("server/crm/leads.ts");
const salesHistory = read("server/_crm-sales-history.ts");
const reports = read("server/crm/reports.ts");
const erpSync = read("server/_erpnext-sales-order-sync.ts");
const reconciliation = read("database/reconcile-duplicate-erp-sales-transactions.sql");
const packageJson = JSON.parse(read("package.json"));

const checks = [
  [packageJson.version === "1.19.12", "release version is 1.19.12"],
  [drawer.includes('activeForm.values.status_label === "تم البيع" ? <label><span>تاريخ تم البيع</span><input type="date" required'), "CRM database edit exposes an explicit sold-date field only for sold customers"],
  [drawer.includes('addChangedDateField(payload, "soldAt", activeForm.values.sold_at, originalValues.sold_at)'), "the edit drawer sends only an actually changed sold date"],
  [drawer.includes("if (showSalesHistory) await loadSalesHistory(result.row.id, true)") && drawer.includes("sold_at: result.row.sold_at ? riyadhDateInput(result.row.sold_at)"), "the drawer immediately refreshes the canonical sold date and sales history after saving"],
  [leads.includes("riyadhCalendarDate(providedValue(body, [\"soldAt\", \"sold_at\"])) !== riyadhCalendarDate(before.sold_at)"), "backend compares sold dates on the Riyadh calendar"],
  [leads.includes("!isValidCalendarDate(input.soldAt)"), "backend validates a real calendar date before correction"],
  [leads.includes("await correctLatestCanonicalSaleDate(tx"), "lead edit delegates sold-date correction to the canonical sales-history service"],
  [salesHistory.includes("update crm.sales_transactions set") && salesHistory.includes("soldDateOverride: true") && !salesHistory.slice(salesHistory.indexOf("export async function correctLatestCanonicalSaleDate")).includes("insert into crm.sales_transactions"), "correction updates an existing active canonical sale without creating a sale"],
  [salesHistory.includes("max(sale_at) as sold_at") && leads.includes("sold_at=${persistedSoldAt}::timestamptz"), "lead sold snapshot is refreshed from canonical transactions in the same transaction"],
  [reports.includes("detailStatus || null}::text is distinct from 'تم البيع' or result_rows.last_sale_at is not null"), "agent customer report requires an in-period canonical sale when status is sold"],
  [erpSync.match(/soldDateOverride/g)?.length >= 2, "ERP update and conflict paths preserve an approved sold-date correction"],
  [reconciliation.includes("st.metadata->>'soldDateOverride'"), "ERP duplicate reconciliation also preserves the correction"],
  [leads.includes('حالة تم البيع يتم تطبيقها تلقائيًا فقط بعد مطابقة طلب NEXT ERP برقم الجوال') && !leads.includes("insertManualSale(tx") && !leads.includes("updateLatestManualSale(tx"), "manual sale creation remains blocked"],
];

for (const [ok, label] of checks) {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`PASS: ${label}`);
}

const riyadhDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Riyadh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date("2026-08-30T21:00:00.000Z"));
if (riyadhDate !== "2026-08-31") {
  console.error(`FAIL: Riyadh calendar conversion expected 2026-08-31 but got ${riyadhDate}`);
  process.exit(1);
}
console.log("PASS: Riyadh midnight timestamp maps to the intended CRM calendar date");
console.log(`CRM sold-date/report correction checks passed: ${checks.length + 1}/${checks.length + 1}`);
