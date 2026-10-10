import fs from "node:fs";

const publishPrep = fs.readFileSync("src/marketing/pages/PublishPrepPage.tsx", "utf8");
const database = fs.readFileSync("src/marketing/pages/MarketingDatabasePage.tsx", "utf8");
const marketingApi = fs.readFileSync("server/marketing/index.ts", "utf8");
const css = fs.readFileSync("src/marketing/marketing.css", "utf8");

const checks = [
  ["publish prep is a vertical list instead of a two-column card board", publishPrep.includes("marketing-publish-list-row") && !publishPrep.includes("marketing-publish-card-v2") && css.includes(".marketing-publish-list { display: grid; gap: 9px; }")],
  ["manual publish is not blocked by a future date", !publishPrep.includes("T23:59:59") && publishPrep.includes("تاريخ النشر مرجع للجدول")],
  ["each task has a direct publish-now action", publishPrep.includes("void publish([row.id])") && publishPrep.includes("نشر الآن")],
  ["publish errors are shown with platform and post type", publishPrep.includes("نتيجة تنفيذ النشر") && publishPrep.includes("item.platformName") && publishPrep.includes("item.postTypeName") && publishPrep.includes("item.error")],
  ["failed schedules persist their exact backend error", marketingApi.includes("set status='failed',publish_result=") && marketingApi.includes("errorMessage") && marketingApi.includes("postTypeName:schedule.post_type_name")],
  ["previous publish errors are returned from latest publish logs", marketingApi.includes("latest.status='failed'") && marketingApi.includes("publish_errors")],
  ["final files open from publish prep", publishPrep.includes("downloadMarketingFile") && publishPrep.includes("marketing-publish-file-links")],
  ["database only shows current ready final files", database.includes('file.category === "final-file" && file.status === "ready"') && database.includes("activeGroupIds") && database.includes("activeFileIds")],
  ["database final file controls use the clean file-row design", database.includes("marketing-product-file-row") && database.includes("فتح الملف") && css.includes(".marketing-product-file-open")],
];

let passed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
  if (ok) passed += 1;
}
console.log(`Marketing publish prep / errors / files checks: ${passed}/${checks.length} passed`);
if (passed !== checks.length) process.exit(1);
