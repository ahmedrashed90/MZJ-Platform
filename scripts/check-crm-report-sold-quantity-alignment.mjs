import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const api = read("server/crm/reports.ts");
const page = read("src/crm/pages/CrmReportsPage.tsx");

const checks = [
  ["CRM reports use sales_transactions as the single sold-fact source", api.includes("const salesFacts = await sql") && api.includes("from crm.sales_transactions st")],
  ["CRM reports do not add ERP orders as a second sold-fact source", !api.includes("const erpSalesFacts = await sql") && !api.includes("const salesFacts = [...erpSalesFacts")],
  ["Sold totals sum transaction quantities only", api.includes("const soldCount = facts.reduce((total, fact) => total + Math.max(1, Number(fact.quantity || 1)), 0);")],
  ["Sold totals do not fall back to lead sold_quantity", !api.includes("return total + reportSoldQuantity(lead.sold_quantity)")],
  ["Representative facts use transaction assignment", api.includes('(fact) => fact.assigned_to || "__none__"') && api.includes('(fact) => fact.assigned_name || "غير موزع"')],
  ["Representative drill-down reads sales_transactions only", api.includes("agent_sale_rows as (") && api.includes("coalesce(st.assigned_to::text,'__none__')=${detailValue}") && !/agent_sale_rows as \([\s\S]*?union all[\s\S]*?agent_sales as \(/.test(api)],
  ["Customer report modal displays sold quantity", page.includes("<th>عدد المباع</th>") && page.includes('{row.sold_quantity ?? "—"}')],
  ["Customer report PDF displays sold quantity", page.includes('htmlEscape(row.sold_quantity ?? "—")') && page.includes('<th>عدد المباع</th><th>التحديثات</th>')],
];

for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
