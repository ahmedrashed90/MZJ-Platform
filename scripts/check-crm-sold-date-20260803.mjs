import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
  if (!condition) {
    console.error(`CRM sold-date check failed: ${message}`);
    process.exit(1);
  }
};

const schema = read("server/_crm-schema.ts");
const baseSchema = read("server/_schema.ts");
const leads = read("server/crm/leads.ts");
const salesApi = read("server/crm/sales.ts");
const drawer = read("src/crm/components/LeadDrawer.tsx");
const databasePage = read("src/crm/pages/CrmDatabasePage.tsx");
const dashboard = read("server/crm/dashboard.ts");
const reports = read("server/crm/reports.ts");
const unifiedDashboard = read("server/_dashboard-data.ts");
const kpi = read("server/crm/kpi.ts");
const erpSync = read("server/_erpnext-sales-order-sync.ts");
const dataManagement = read("server/data-management.ts");

assert(baseSchema.includes("sold_at timestamptz"), "base CRM leads schema is missing latest sold_at snapshot");
assert(schema.includes("crm-sold-at-20260803") && schema.includes("add column if not exists sold_at timestamptz"), "idempotent sold_at migration is missing");
assert(baseSchema.includes("create table if not exists crm.sales_transactions"), "independent manual sales history table is missing");
assert(schema.includes("crm-sales-history-20260806") && schema.includes("'legacy_backfill'"), "sales-history migration/backfill is missing");
assert(drawer.includes("تاريخ تم البيع") && drawer.includes('addChangedDateField(payload, "soldAt"'), "database latest sold-date edit is missing");
assert(drawer.includes("سجل المبيعات") && drawer.includes("تسجيل عملية بيع جديدة") && drawer.includes('/api/crm/sales?leadId='), "customer sales-history UI is missing");
assert(databasePage.includes("تاريخ تم البيع") && databasePage.includes("row.sold_at"), "database table/export does not expose latest sold date");
assert(leads.includes("insertManualSale(tx") && leads.includes("updateLatestManualSale(tx"), "lead status/date updates are not synchronized with sales history");
assert(salesApi.includes("insertManualSale(tx") && salesApi.includes("manual_sale_recorded"), "independent repeated manual sale endpoint is missing");
assert(dashboard.includes("from crm.sales_transactions st") && dashboard.includes("period_sale"), "CRM dashboard date filtering does not use independent sale events");
assert(reports.includes("from crm.sales_transactions st") && reports.includes("const salesFacts ="), "CRM reports do not use independent manual sale facts");
assert(unifiedDashboard.includes("scoped_manual_sold") && unifiedDashboard.includes("from crm.sales_transactions st"), "unified dashboard manual sale aggregation is missing");
assert(!kpi.includes("calculated_sales") && !kpi.includes("coalesce(l.sold_at,l.updated_at,l.created_at)"), "KPI sales must stay independent from CRM sales-history aggregation");
assert(erpSync.includes("sold_at=${saleAt}::timestamptz"), "ERP sales do not preserve their actual sale date snapshot");
assert(dataManagement.includes('"تاريخ تم البيع"') && dataManagement.includes("updateLatestManualSale"), "customer import/export does not preserve the explicit latest sold date safely");

console.log("CRM sales date snapshot and independent history alignment checks passed.");
