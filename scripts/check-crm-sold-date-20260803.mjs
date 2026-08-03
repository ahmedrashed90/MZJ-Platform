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
const drawer = read("src/crm/components/LeadDrawer.tsx");
const databasePage = read("src/crm/pages/CrmDatabasePage.tsx");
const dashboard = read("server/crm/dashboard.ts");
const reports = read("server/crm/reports.ts");
const unifiedDashboard = read("server/_dashboard-data.ts");
const kpi = read("server/crm/kpi.ts");
const erpSync = read("server/_erpnext-sales-order-sync.ts");
const dataManagement = read("server/data-management.ts");

assert(baseSchema.includes("sold_at timestamptz"), "base CRM leads schema is missing sold_at");
assert(schema.includes("crm-sold-at-20260803") && schema.includes("add column if not exists sold_at timestamptz"), "idempotent sold_at migration is missing");
assert(drawer.includes("تاريخ تم البيع") && drawer.includes('addChangedDateField(payload, "soldAt"'), "database edit sold date field is missing");
assert(databasePage.includes("تاريخ تم البيع") && databasePage.includes("row.sold_at"), "database table/export does not expose sold date");
assert(leads.includes("soldAtFieldProvided") && leads.includes("sold_at=${nextSoldAt}::timestamptz"), "lead update does not persist sold date");
assert(leads.includes('statusChanged && input.statusLabel === "تم البيع"'), "new manual sales do not receive an automatic sold date");
assert(dashboard.includes("coalesce(l.sold_at,l.registered_at,l.created_at)"), "CRM dashboard sold date filtering is missing");
assert(reports.includes("coalesce(l.sold_at,l.registered_at,l.created_at)"), "CRM reports sold date filtering is missing");
assert(unifiedDashboard.includes("scoped_manual_sold") && unifiedDashboard.includes("coalesce(l.sold_at,l.registered_at,l.created_at)"), "unified dashboard manual sold-date aggregation is missing");
assert(kpi.includes("coalesce(l.sold_at,l.updated_at,l.created_at)"), "KPI manual sales still use update date instead of sold date");
assert(erpSync.includes("sold_at=${saleAt}::timestamptz"), "ERP sales do not persist their actual sale date");
assert(dataManagement.includes('"تاريخ تم البيع"') && dataManagement.includes("sold_at"), "customer import/export does not preserve sold date");

console.log("CRM manual sold-date editing, reporting alignment, and schema checks passed.");
