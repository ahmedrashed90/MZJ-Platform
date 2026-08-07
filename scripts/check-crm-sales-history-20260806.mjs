import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
  if (!condition) {
    console.error(`CRM sales-history check failed: ${message}`);
    process.exit(1);
  }
};

const baseSchema = read("server/_schema.ts");
const migration = read("server/_crm-schema.ts");
const salesApi = read("server/crm/sales.ts");
const leads = read("server/crm/leads.ts");
const reports = read("server/crm/reports.ts");
const drawer = read("src/crm/components/LeadDrawer.tsx");
const routes = read("api/index.ts");
const erpSync = read("server/_erpnext-sales-order-sync.ts");

assert(baseSchema.includes("create table if not exists crm.sales_transactions"), "sales transaction table is missing");
assert(baseSchema.includes("crm_sales_transactions_source_reference_unique"), "canonical source identity index is missing");
assert(migration.includes("crm-sales-history-20260806"), "sales history migration is missing");
assert(routes.includes('import crmSalesHandler from "../server/crm/sales.js"') && routes.includes('["crm/sales", crmSalesHandler]'), "sales-history API route is not registered");
assert(salesApi.includes("from crm.sales_transactions st") && !salesApi.includes("from integrations.erpnext_sales_orders so"), "customer history must read the canonical transaction source only");
assert(salesApi.includes("تم البيع يتم تسجيله تلقائيًا فقط بعد مطابقة طلب NEXT ERP برقم الجوال"), "manual sale POST is not blocked");
assert(!salesApi.includes("insertManualSale") && !salesApi.includes("manual_sale_recorded"), "manual sale creation remains exposed");
assert(!leads.includes("insertManualSale(tx") && !leads.includes("updateLatestManualSale(tx"), "lead edits still create manual sale transactions");
assert(leads.includes("حالة تم البيع يتم تطبيقها تلقائيًا فقط بعد مطابقة طلب NEXT ERP برقم الجوال"), "manual transition to sold is not blocked in lead API");
assert(drawer.includes("سجل المبيعات") && drawer.includes("salesHistory.map"), "sales history list is missing");
assert(!drawer.includes("تسجيل عملية بيع جديدة") && !drawer.includes("recordNewSale"), "manual sale UI still exists");
assert(drawer.includes("سجل البيع يُنشأ تلقائيًا من طلبات NEXT ERP بعد مطابقة العميل برقم الجوال"), "automatic ERP source explanation is missing");
assert(erpSync.includes("async function upsertErpNextSalesTransaction"), "ERP canonical sales transaction writer is missing");
assert(erpSync.includes("await upsertErpNextSalesTransaction(tx, {"), "ERP link does not write sales transaction atomically");
assert(erpSync.includes("mergedReason: 'erpnext_sales_order_deduplication'"), "same-order transaction deduplication is missing");
assert(reports.includes("Canonical sold metric: every report reads only crm.sales_transactions."), "reports are not canonical-transaction only");

console.log("CRM automatic NEXT ERP sales history checks passed (16 assertions).");
