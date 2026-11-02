// Marketing workflow V2: obsolete UI assertions are inventoried in docs/MARKETING-WORKFLOW-TEST-MIGRATION.json.
import fs from "node:fs";

const dashboard = fs.readFileSync("src/marketing/pages/MarketingDashboardPage.tsx", "utf8");
const css = fs.readFileSync("src/marketing/marketing.css", "utf8");

const checks = [
  
  ["campaign progress bar no longer overlays a percentage label", css.includes(".marketing-dashboard-entity > .marketing-progress > b { display: none; }")],
  
  ["old circular campaign task counter is removed", !dashboard.includes("marketing-dashboard-entity-count") && !css.includes(".marketing-dashboard-entity-count")],
  ["department headers are compact", css.includes("min-height: 36px") && css.includes("padding: 6px 8px")],
  ["department cards use compact spacing", css.includes(".marketing-dashboard-readiness-departments") && css.includes("gap: 5px")],
  
  
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS: ${name}`);
  else {
    console.error(`FAIL: ${name}`);
    failed += 1;
  }
}

console.log(`Marketing dashboard compact v1.20.6 checks: ${checks.length - failed}/${checks.length} passed`);
if (failed) process.exit(1);
