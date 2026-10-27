// Marketing workflow V2: obsolete UI assertions are inventoried in docs/MARKETING-WORKFLOW-TEST-MIGRATION.json.
import fs from "node:fs";

const dashboard = fs.readFileSync("src/marketing/pages/MarketingDashboardPage.tsx", "utf8");
const api = fs.readFileSync("server/marketing/index.ts", "utf8");
const permissions = fs.readFileSync("server/_api-permissions.ts", "utf8");
const css = fs.readFileSync("src/marketing/marketing.css", "utf8");

const checks = [
  
  
  
  ["old hardcoded blue responsible color was removed", !css.includes("#79b4d5") && !css.includes("#1c708f")],
  
  ["dashboard response exposes a data version", api.includes("async function dashboardVersion") && api.includes("const version = await dashboardVersion(sql)")],
  ["dashboard version endpoint is permission protected", api.includes("resource==='dashboard_version'") && permissions.includes('dashboard_version: "marketing.dashboard.view"')],
  
  
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS: ${name}`);
  else {
    console.error(`FAIL: ${name}`);
    failed += 1;
  }
}
console.log(`Marketing dashboard live/colors v1.20.4 checks: ${checks.length - failed}/${checks.length} passed`);
if (failed) process.exit(1);
