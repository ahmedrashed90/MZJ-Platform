import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const api = read("server/crm/reports.ts");
const page = read("src/crm/pages/CrmReportsPage.tsx");

const checks = [
  ["CRM reports read manual quantities from independent sales transactions", api.includes("from crm.sales_transactions st") && api.includes("greatest(coalesce(st.quantity,1),1)::int as quantity")],
  ["CRM reports do not add ERP Sales Orders as a parallel sold source", !api.includes("const erpSalesFacts = await sql") && api.includes("Canonical sold metric: every report reads only crm.sales_transactions")],
  ["Sold totals sum every sale fact quantity in the selected period", api.includes("const soldCount = facts.reduce(") && api.includes("Math.max(1, Number(fact.quantity || 1))")],
  ["Representative totals use the transaction representative snapshot", api.includes('(fact) => fact.assigned_to || "__none__"') && api.includes('(fact) => fact.assigned_name || "غير موزع"')],
  ["Customer report modal displays sold quantity", page.includes("<th>عدد المباع</th>") && page.includes('{row.sold_quantity ?? "—"}')],
  ["Customer report PDF displays sold quantity", page.includes('htmlEscape(row.sold_quantity ?? "—")') && page.includes('<th>عدد المباع</th><th>التحديثات</th>')],
];

for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
