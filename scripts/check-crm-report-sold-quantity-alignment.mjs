import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const api = read("server/crm/reports.ts");
const page = read("src/crm/pages/CrmReportsPage.tsx");

const checks = [
  ["CRM reports use sales_transactions as the canonical sales fact source", api.includes("const salesFacts = await sql") && api.includes("from crm.sales_transactions st")],
  ["CRM reports do not add ERP Sales Orders as a second report fact source", !api.includes("const erpSalesFacts = await sql") && !api.includes("const salesFacts = [...erpSalesFacts")],
  ["Sold totals sum canonical transaction quantities only", api.includes("const soldCount = facts.reduce((total, fact) => total + Math.max(1, Number(fact.quantity || 1)), 0);")],
  ["Sold totals do not fall back to lead sold_quantity", !api.includes("return total + reportSoldQuantity(lead.sold_quantity)")],
  ["Representative reports use the immutable transaction salesperson", api.includes("st.assigned_to=${agent || null}::uuid") && api.includes("fact.assigned_to || \"__none__\"")],
  ["Representative drill-down reads canonical transaction rows", api.includes("agent_sale_rows as (") && api.includes("from crm.sales_transactions st") && !api.includes("agent_sale_rows as (\n          select\n            so.crm_lead_id")],
  ["Customer report modal displays sold quantity", page.includes("<th>عدد المباع</th>") && page.includes('{row.sold_quantity ?? "—"}')],
  ["Customer report PDF displays sold quantity", page.includes('htmlEscape(row.sold_quantity ?? "—")') && page.includes('<th>عدد المباع</th><th>التحديثات</th>')],
];

for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
