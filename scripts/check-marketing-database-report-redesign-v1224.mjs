import fs from "node:fs";

const database = fs.readFileSync("src/marketing/pages/MarketingDatabasePage.tsx", "utf8");
const manager = fs.readFileSync("src/marketing/components/EntityCreativeManager.tsx", "utf8");
const css = fs.readFileSync("src/marketing/marketing.css", "utf8");
const xlsx = fs.readFileSync("src/marketing/reportXlsx.ts", "utf8");

const checks = [
  ["dedicated printable report window", database.includes('window.open("", "_blank"') && database.includes("popup.document.write")],
  ["PDF includes entity data tasks and results", database.includes("بيانات ${escapePrintHtml(entityKind)} والتاسكات وجدول النشر ونتائج النشر والتفاعل") && database.includes("<h2>التاسكات</h2>") && database.includes("نتائج النشر والتفاعل")],
  ["campaign budget is included in PDF", database.includes("<h2>الميزانية</h2>") && database.includes("budgetRows")],
  ["creatives use compact table", database.includes("marketing-entity-creatives-table") && !database.includes("marketing-entity-creative-card")],
  ["real xlsx MIME and extension", xlsx.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") && xlsx.includes('}.xlsx`')],
  ["xlsx is RTL with frozen header", xlsx.includes('rightToLeft="1"') && xlsx.includes('topLeftCell="A6"') && xlsx.includes("<autoFilter")],
  ["spreadsheet values are formula-safe", xlsx.includes("safeSpreadsheetText") && (xlsx.includes("/^\\s*[=+\\-@]/") || xlsx.includes("/^[=+\\-@]/"))],
  ["schedule Excel action is intentionally removed", !database.includes('sheetName: "جدول النشر"') && !database.includes("تصدير جدول النشر")],
  ["review Excel action is intentionally removed", !database.includes('sheetName: "مراجعة التاسكات"') && !database.includes("تصدير مراجعة Excel")],
  ["creative editor has professional hero", manager.includes("marketing-entity-workspace") && manager.includes("marketing-entity-side-stats")],
  ["creative editor actions are in modal footer", manager.includes("marketing-entity-creative-footer-bar") && manager.includes('className="marketing-entity-action save"')],
  ["responsive compact table and modal styling", css.includes(".marketing-entity-creatives-table") && css.includes(".marketing-entity-workspace") && css.includes("@media (max-width: 640px)")],
];

let passed = 0;
for (const [label, ok] of checks) {
  if (ok) {
    passed += 1;
    console.log(`PASS: ${label}`);
  } else {
    console.error(`FAIL: ${label}`);
  }
}

console.log(`Marketing database reports and creative UI v1.22.4 checks: ${passed}/${checks.length} passed`);
if (passed !== checks.length) process.exit(1);
