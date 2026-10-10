import fs from "node:fs";

const dashboard = fs.readFileSync("src/marketing/pages/MarketingDashboardPage.tsx", "utf8");
const api = fs.readFileSync("server/marketing/index.ts", "utf8");
const permissions = fs.readFileSync("server/_api-permissions.ts", "utf8");
const css = fs.readFileSync("src/marketing/marketing.css", "utf8");

const checks = [
  ["duplicate content writer is hidden when it is the responsible user", dashboard.includes("sameAssignedUser(task)") && dashboard.includes("!sameAssignedUser(task)")],
  ["responsible color comes from marketing settings", dashboard.includes("task.assigned_user_color") && api.includes("auc.color as assigned_user_color") && api.includes("left join marketing.user_colors auc")],
  ["content writer color comes from marketing settings", dashboard.includes("task.content_user_color") && api.includes("cuc.color as content_user_color") && api.includes("left join marketing.user_colors cuc")],
  ["old hardcoded blue responsible color was removed", !css.includes("#79b4d5") && !css.includes("#1c708f")],
  ["completion percentages use a stable visible LTR format", dashboard.includes('toLocaleString("en-US"') && dashboard.includes('dir="ltr"') && dashboard.includes("نسبة الاكتمال")],
  ["dashboard response exposes a data version", api.includes("async function dashboardVersion") && api.includes("const version = await dashboardVersion(sql)")],
  ["dashboard version endpoint is permission protected", api.includes("resource==='dashboard_version'") && permissions.includes('dashboard_version: "marketing.dashboard.view"')],
  ["dashboard polls version while visible", dashboard.includes("DASHBOARD_LIVE_POLL_MS = 1000") && dashboard.includes("document.visibilityState") && dashboard.includes('resource: "dashboard_version"')],
  ["live refresh is silent and preserves expanded cards", dashboard.includes("await load(true)") && dashboard.includes("setExpandedRequired") && dashboard.includes("setExpandedEntities")],
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
