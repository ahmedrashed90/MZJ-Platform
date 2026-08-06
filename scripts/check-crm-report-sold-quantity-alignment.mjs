import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const api = read("server/crm/reports.ts");
const page = read("src/crm/pages/CrmReportsPage.tsx");

const checks = [
  ["CRM reports read manual quantities from independent sales transactions", api.includes("from crm.sales_transactions st") && api.includes("greatest(coalesce(st.quantity,1),1)::int as quantity")],
  ["CRM reports keep ERP Sales Orders as independent sales facts", api.includes("from integrations.erpnext_sales_orders so") && api.includes("coalesce(vehicle_stats.quantity,1)::int as quantity")],
  ["Sold totals sum every sale fact quantity in the selected period", api.includes("facts.reduce((total, fact) => total + Math.max(1, Number(fact.quantity || 1)), 0)")],
  ["Representative drill-down combines ERP and manual sale rows", api.includes("agent_sale_rows as (") && api.includes("union all") && api.includes("from crm.sales_transactions st")],
  ["Customer report modal displays sold quantity", page.includes("<th>عدد المباع</th>") && page.includes('{row.sold_quantity ?? "—"}')],
  ["Customer report PDF displays sold quantity", page.includes('htmlEscape(row.sold_quantity ?? "—")') && page.includes('<th>عدد المباع</th><th>التحديثات</th>')],
];

for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
