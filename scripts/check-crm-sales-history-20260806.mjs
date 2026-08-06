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
const databaseSchema = read("database/schema.sql");
const migration = read("server/_crm-schema.ts");
const helper = read("server/_crm-sales-history.ts");
const salesApi = read("server/crm/sales.ts");
const leads = read("server/crm/leads.ts");
const reports = read("server/crm/reports.ts");
const crmDashboard = read("server/crm/dashboard.ts");
const unifiedDashboard = read("server/_dashboard-data.ts");
const dataManagement = read("server/data-management.ts");
const drawer = read("src/crm/components/LeadDrawer.tsx");
const types = read("src/crm/types.ts");
const routes = read("api/index.ts");
const permissions = read("server/_api-permissions.ts");

assert(baseSchema.includes("create table if not exists crm.sales_transactions"), "runtime base schema table is missing");
assert(databaseSchema.includes("create table if not exists crm.sales_transactions"), "database installation schema table is missing");
assert(baseSchema.includes("lead_id uuid not null references crm.leads(id) on delete cascade"), "sale history is not linked safely to its customer");
assert(baseSchema.includes("sale_at timestamptz not null") && baseSchema.includes("quantity integer not null default 1"), "sale date/quantity fields are missing");
assert(baseSchema.includes("crm_sales_transactions_lead_date_idx") && baseSchema.includes("crm_sales_transactions_report_idx"), "sales history reporting indexes are missing");
assert(migration.includes("crm-sales-history-20260806") && migration.includes("legacy_backfill"), "idempotent migration/current-state backfill is missing");
assert(migration.includes("not exists(\n    select 1 from integrations.erpnext_sales_orders"), "legacy backfill does not exclude ERP-backed sales");
assert(helper.includes("export async function insertManualSale") && helper.includes("export async function updateLatestManualSale"), "central sales-history write service is missing");
assert(helper.includes("time zone 'Asia/Riyadh'"), "manual sale dates are not normalized to the Riyadh calendar");
assert(routes.includes('import crmSalesHandler from "../server/crm/sales.js"') && routes.includes('["crm/sales", crmSalesHandler]'), "sales-history API route is not registered");
assert(permissions.includes('route === "crm/sales"') && permissions.includes('"crm.customer.status.update"'), "sales-history route permission is missing");
assert(salesApi.includes("with sale_rows as") && salesApi.includes("from crm.sales_transactions st") && salesApi.includes("from integrations.erpnext_sales_orders so"), "customer history does not combine manual and ERP sales");
assert(salesApi.includes("manual_sale_recorded") && salesApi.includes("insertManualSale(tx"), "new repeated manual sales are not recorded as independent events");
assert(leads.includes('metadata: { recordedFrom: "lead_creation" }'), "creating an already-sold lead does not create a sale event");
assert(leads.includes('metadata: { recordedFrom: "lead_status_change" }'), "first manual sold transition does not create a sale event");
assert(leads.includes('metadata: { recordedFrom: "lead_sale_correction" }'), "latest sale corrections are not synchronized centrally");
assert(reports.includes("const salesFacts = await sql") && reports.includes("from crm.sales_transactions st") && !reports.includes("const erpSalesFacts = await sql"), "reports do not use canonical sales transactions only");
assert(reports.includes("const soldCount = facts.reduce(") && reports.includes("Math.max(1, Number(fact.quantity || 1))"), "reports do not count every sale quantity");
assert(crmDashboard.includes("period_sale") && crmDashboard.includes("from crm.sales_transactions st"), "CRM dashboard does not find sales by event date");
assert(unifiedDashboard.includes("scoped_manual_sold") && unifiedDashboard.includes("sum(quantity)"), "unified dashboard does not sum manual sale events");
assert(dataManagement.includes("const explicitSoldAt = rowValue") && dataManagement.includes("updateLatestManualSale(tx"), "customer-sheet correction is not tied to the latest manual sale event");
const explicitAliasBlock = dataManagement.match(/const explicitSoldAt\s*=\s*rowValue\(sourceRow,\s*\[([\s\S]*?)\]\);/)?.[1] || "";
assert(explicitAliasBlock.includes('"تاريخ تم البيع"') && !explicitAliasBlock.includes('"آخر تحديث"'), "customer sheet can still overwrite sales from the last-update column");
assert(types.includes("export type CrmSaleTransaction"), "front-end sales-history type is missing");
assert(drawer.includes("سجل المبيعات") && drawer.includes("recordNewSale") && drawer.includes("salesHistory.map"), "customer drawer sales-history controls/list are missing");

console.log("CRM independent multi-sale history checks passed (24 assertions).");
