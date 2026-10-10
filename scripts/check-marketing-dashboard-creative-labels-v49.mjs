import fs from "node:fs";

const dashboard = fs.readFileSync("src/marketing/pages/MarketingDashboardPage.tsx", "utf8");
const server = fs.readFileSync("server/marketing/index.ts", "utf8");
const css = fs.readFileSync("src/marketing/marketing.css", "utf8");

const checks = [
  ["dashboard API returns the real creative type name", server.includes("ct.name as creative_type_name")],
  ["dashboard API joins creative_types through the task creative", server.includes("left join marketing.creative_types ct on ct.id=c.creative_type_id")],
  ["dashboard live version reacts to creative changes", server.includes("max(updated_at) from marketing.creatives")],
  ["dashboard live version reacts to creative type changes", server.includes("max(updated_at) from marketing.creative_types")],
  ["task card shows a dedicated creative type label", dashboard.includes("<span>نوع الكرييتيف</span>") && dashboard.includes("task.creative_type_name")],
  ["task card shows a dedicated creative name label", dashboard.includes("<span>اسم الكرييتيف</span>") && dashboard.includes("task.creative_name")],
  ["creative name is no longer presented under the generic creative label in task meta", !dashboard.includes('<div><span>الكرييتيف</span><strong>{task.creative_name || task.title || "—"}</strong></div>')],
  ["creative name row spans the card width for readability", dashboard.includes("marketing-dashboard-task-meta-name") && css.includes(".marketing-dashboard-task-meta-name { grid-column: 1 / -1; }")],
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
