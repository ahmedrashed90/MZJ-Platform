// Marketing workflow V2: obsolete UI assertions are inventoried in docs/MARKETING-WORKFLOW-TEST-MIGRATION.json.
import fs from "node:fs";

const dashboard = fs.readFileSync("src/marketing/pages/MarketingDashboardPage.tsx", "utf8");
const server = fs.readFileSync("server/marketing/index.ts", "utf8");
const css = fs.readFileSync("src/marketing/marketing.css", "utf8");

const checks = [
  ["dashboard API returns the real creative type name", server.includes("ct.name as creative_type_name")],
  ["dashboard API joins creative_types through the task creative", server.includes("left join marketing.creative_types ct on ct.id=c.creative_type_id")],
  ["dashboard live version reacts to creative changes", server.includes("max(updated_at) from marketing.creatives")],
  ["dashboard live version reacts to creative type changes", server.includes("max(updated_at) from marketing.creative_types")],
  
  
  ["creative name is no longer presented under the generic creative label in task meta", !dashboard.includes('<div><span>الكرييتيف</span><strong>{task.creative_name || task.title || "—"}</strong></div>')],
  
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS: ${name}`);
  else {
    console.error(`FAIL: ${name}`);
    failed += 1;
  }
}
console.log(`Marketing dashboard creative labels v49 checks: ${checks.length - failed}/${checks.length} passed`);
if (failed) process.exit(1);
