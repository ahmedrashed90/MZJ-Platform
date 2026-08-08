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
const reports = read("server/crm/reports.ts");
const erpSync = read("server/_erpnext-sales-order-sync.ts");

assert(baseSchema.includes("sold_at timestamptz"), "CRM lead sold snapshot field is missing");
assert(schema.includes("crm-sold-at-20260803") && schema.includes("add column if not exists sold_at timestamptz"), "sold_at migration is missing");
assert(baseSchema.includes("create table if not exists crm.sales_transactions"), "canonical sales transaction table is missing");
assert(erpSync.includes("const saleAt = dateTimeForOrder(normalized.orderDate)"), "ERP order date is not the canonical sale date");
assert(erpSync.includes("sale_at=${saleAt}::timestamptz"), "ERP link does not persist the real sale date");
assert(erpSync.includes("assigned_name=${mapping.full_name}"), "ERP salesperson snapshot is missing");
assert(erpSync.includes("department_code=${input.departmentCode}"), "ERP department snapshot is missing");
assert(!leads.includes("insertManualSale(tx") && !leads.includes("updateLatestManualSale(tx"), "manual lead edits still mutate sales history");
assert(salesApi.includes("from crm.sales_transactions st") && !salesApi.includes("union all"), "sales history is not canonical-only");
assert(!drawer.includes("تسجيل عملية بيع جديدة"), "manual sale control is still visible");
assert(reports.includes("from crm.sales_transactions st"), "CRM reports do not use sales transactions");
assert(!reports.includes("const erpSalesFacts = await sql"), "CRM reports still double-count ERP as a second source");

console.log("CRM automatic ERP sale-date alignment checks passed (12 assertions).");
