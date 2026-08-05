import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const api = read("server/crm/reports.ts");
const page = read("src/crm/pages/CrmReportsPage.tsx");

const checks = [
  ["CRM report sold totals use the lead sold quantity as the single source of truth", api.includes("return total + reportSoldQuantity(lead.sold_quantity)") && !api.includes("erp_vehicle_sales_count")],
  ["Sold customer rows normalize an empty sold quantity to one", api.includes('lead.sold_quantity = norm(lead.status_label) === norm("تم البيع") ? reportSoldQuantity(lead.sold_quantity) : null')],
  ["Customer report modal displays sold quantity", page.includes("<th>عدد المباع</th>") && page.includes('{row.sold_quantity ?? \"—\"}')],
  ["Customer report PDF displays sold quantity", page.includes('htmlEscape(row.sold_quantity ?? \"—\")') && page.includes('<th>عدد المباع</th><th>التحديثات</th>')],
];

for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
