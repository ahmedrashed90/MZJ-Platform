import fs from "node:fs";

const campaign = fs.readFileSync("src/marketing/pages/CreateCampaignPage.tsx", "utf8");
const picker = fs.readFileSync("src/marketing/components/CreativeMultiPicker.tsx", "utf8");
const editor = fs.readFileSync("src/marketing/components/CreativeEditor.tsx", "utf8");
const manager = fs.readFileSync("src/marketing/components/EntityCreativeManager.tsx", "utf8");
const database = fs.readFileSync("src/marketing/pages/MarketingDatabasePage.tsx", "utf8");
const report = fs.readFileSync("src/marketing/reportXlsx.ts", "utf8");
const server = fs.readFileSync("server/marketing/index.ts", "utf8");
const schema = fs.readFileSync("server/_marketing-schema.ts", "utf8");
const css = fs.readFileSync("src/marketing/marketing.css", "utf8");

const checks = [
  ["reusable multi-creative picker", picker.includes("export function CreativeMultiPicker") && picker.includes("aria-pressed={selected}")],
  ["campaign budget selects multiple creatives", campaign.includes("creativeTempIds: string[]") && campaign.includes('label="المنتج / الكرييتيف"')],
  ["campaign schedule selects multiple creatives per day", campaign.includes('hint="يمكن اختيار أكثر من كرييتيف لنفس اليوم"')],
  ["normalized budget-to-creative relation", schema.includes("create table if not exists marketing.budget_item_creatives")],
  ["campaign creation persists all budget creative links", server.includes("for (const creativeId of creativeIds)") && server.includes("insert into marketing.budget_item_creatives")],
  ["campaign schedule expands all selected creatives", server.includes("for (const creativeId of creativeIds)") && server.includes("marketing.publish_schedule")],
  ["database detail returns all budget creative names", server.includes("as creative_ids") && server.includes("as creative_names")],
  ["agenda platform chooser is professional", editor.includes("marketing-platform-choice-grid") && editor.includes("marketing-platform-post-type-grid")],
  ["database add creative action is redesigned", database.includes("marketing-add-creative-button-copy")],
  ["archive actions are redesigned", database.includes("marketing-archive-panel") && database.includes("marketing-row-archive-button")],
  ["creative editor uses clean two-panel workspace", manager.includes("marketing-entity-side-panel") && manager.includes("marketing-entity-main-panel") && css.includes("background: #f8fafb")],
  ["selected users are visibly confirmed", editor.includes("aria-pressed={selected}") && editor.includes("<CheckCircle") && css.includes("button.selected")],
  ["xlsx builder is reusable and sanitizes invalid XML", report.includes("buildMarketingReportXlsxBytes") && report.includes("\\u0000-\\u0008")],
  ["xlsx package contains properties and worksheet dimension", report.includes("docProps/core.xml") && report.includes("<dimension ref=")],
  ["broken schedule and review Excel actions are removed", !database.includes("function exportSchedule") && !database.includes("function exportReview") && !database.includes("تصدير مراجعة Excel")],
  ["responsive styles cover all new controls", css.includes(".marketing-creative-multi-options") && css.includes(".marketing-platform-choice-card") && css.includes(".marketing-archive-panel")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
  if (!ok) failed += 1;
}
console.log(`Marketing creative UI, multiselect and reports v1.22.5 checks: ${checks.length - failed}/${checks.length} passed`);
if (failed) process.exit(1);
