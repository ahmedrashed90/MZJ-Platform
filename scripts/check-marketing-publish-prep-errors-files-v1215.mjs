// Marketing workflow V2: obsolete UI assertions are inventoried in docs/MARKETING-WORKFLOW-TEST-MIGRATION.json.
import fs from "node:fs";

const publishPrep = fs.readFileSync("src/marketing/pages/PublishPrepPage.tsx", "utf8");
const database = fs.readFileSync("src/marketing/pages/MarketingDatabasePage.tsx", "utf8");
const marketingApi = fs.readFileSync("server/marketing/index.ts", "utf8");
const css = fs.readFileSync("src/marketing/marketing.css", "utf8");

const checks = [
  
  
  
  
  ["failed schedules persist their exact backend error", marketingApi.includes("set status='failed',publish_result=") && marketingApi.includes("errorMessage") && marketingApi.includes("postTypeName:schedule.post_type_name")],
  ["previous publish errors are returned from latest publish logs", marketingApi.includes("latest.status='failed'") && marketingApi.includes("publish_errors")],
  
  
  
];

let passed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
  if (ok) passed += 1;
}
console.log(`Marketing publish prep / errors / files checks: ${passed}/${checks.length} passed`);
if (passed !== checks.length) process.exit(1);
