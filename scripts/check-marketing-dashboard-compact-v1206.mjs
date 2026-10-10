import fs from "node:fs";

const dashboard = fs.readFileSync("src/marketing/pages/MarketingDashboardPage.tsx", "utf8");
const css = fs.readFileSync("src/marketing/marketing.css", "utf8");

const checks = [
  ["campaign completion is shown in a dedicated readable stat", dashboard.includes('className="marketing-dashboard-entity-stats"') && dashboard.includes('{formatProgress(entity.progress)}')],
  ["campaign progress bar no longer overlays a percentage label", css.includes(".marketing-dashboard-entity > .marketing-progress > b { display: none; }")],
  ["department task count and completion use a compact rectangular summary", dashboard.includes('className="marketing-dashboard-department-summary"') && css.includes("border-radius: 8px")],
  ["old circular campaign task counter is removed", !dashboard.includes("marketing-dashboard-entity-count") && !css.includes(".marketing-dashboard-entity-count")],
  ["department headers are compact", css.includes("min-height: 36px") && css.includes("padding: 6px 8px")],
  ["department cards use compact spacing", css.includes(".marketing-dashboard-readiness-departments") && css.includes("gap: 5px")],
  ["dashboard live refresh remains enabled", dashboard.includes("DASHBOARD_LIVE_POLL_MS = 1000") && dashboard.includes('resource: "dashboard_version"')],
  ["responsible colors remain sourced from marketing settings", dashboard.includes("task.assigned_user_color") && dashboard.includes("task.content_user_color")],
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
