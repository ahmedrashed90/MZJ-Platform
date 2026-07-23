import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    failures.push(`Missing file: ${relativePath}`);
    return "";
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function expect(relativePath, needle, label) {
  const content = read(relativePath);
  if (!content.includes(needle)) failures.push(`${label} (${relativePath})`);
  else passes.push(label);
}

function reject(relativePath, needle, label) {
  const content = read(relativePath);
  if (content.includes(needle)) failures.push(`${label} (${relativePath})`);
  else passes.push(label);
}

const packageJson = JSON.parse(read("package.json") || "{}");
if (packageJson.version !== "1.19.0") failures.push("Package version must be 1.19.0");
else passes.push("Package version 1.19.0");
if (!String(packageJson.scripts?.typecheck || "").includes("check-marketing-native-v1190.mjs")) failures.push("Marketing checker is not part of typecheck");
else passes.push("Marketing checker is included in typecheck");

for (const file of [
  "src/marketing/MarketingLayout.tsx",
  "src/marketing/pages/MarketingDashboardPage.tsx",
  "src/marketing/pages/MarketingCampaignsPage.tsx",
  "src/marketing/pages/MarketingCampaignBuilderPage.tsx",
  "src/marketing/pages/MarketingCampaignDetailPage.tsx",
  "src/marketing/pages/MarketingTasksPage.tsx",
  "src/marketing/pages/MarketingAgendaPage.tsx",
  "src/marketing/pages/MarketingPublishingPage.tsx",
  "src/marketing/pages/MarketingCalendarPage.tsx",
  "src/marketing/components/MarketingSettingsPanel.tsx",
  "server/_marketing-auth.ts",
  "server/_marketing-schema.ts",
  "server/marketing/index.ts",
  "database/migrations/20260723_marketing_native_rebuild_v1190.sql",
]) read(file);

expect("src/App.tsx", '<Route path="/marketing" element={<MarketingLayout />}>', "Native marketing route");
expect("src/App.tsx", '<Route path="campaigns/new" element={<MarketingCampaignBuilderPage />} />', "Full-page campaign builder route");
reject("src/App.tsx", '<Route path="/marketing" element={<EmptyModulePage', "Marketing is not an empty placeholder");
expect("api/index.ts", '["marketing", marketingHandler]', "Marketing API dispatcher route");
expect("src/pages/SettingsPage.tsx", '<MarketingSettingsPanel />', "Marketing settings integration");
expect("src/components/Sidebar.tsx", "marketingOnly: true", "Permission-aware marketing sidebar item");
expect("server/_dashboard-data.ts", "status in ('مجدولة','تجهيز النشر')", "Unified dashboard uses native marketing statuses");
reject("server/_dashboard-data.ts", "status='scheduled'", "Legacy English dashboard status removed");

const builder = read("src/marketing/pages/MarketingCampaignBuilderPage.tsx");
for (const stage of ["بيانات الحملة", "الكرييتيف والربط", "الميزانية", "جدول النشر", "المراجعة والحفظ"]) {
  if (!builder.includes(stage)) failures.push(`Missing campaign builder stage: ${stage}`);
  else passes.push(`Campaign builder stage: ${stage}`);
}
for (const required of ["instanceKey", "Unique Spec Key", "اللون الخارجي", "اللون الداخلي", "يُفتح بعد اعتماد Task Template", "حفظ وإنهاء"]) {
  if (!builder.includes(required)) failures.push(`Missing builder requirement: ${required}`);
  else passes.push(`Builder requirement: ${required}`);
}

const api = read("server/marketing/index.ts");
for (const status of ["في انتظار اعتماد الهيكل", "في انتظار Task Template", "جاهز للتنفيذ", "تم الاستلام", "تجهيز النشر", "مجدولة", "مكتملة"]) {
  if (!api.includes(status)) failures.push(`Missing workflow status: ${status}`);
  else passes.push(`Workflow status: ${status}`);
}
for (const action of ["approve_structure", "save_template", "submit_template", "approve_template", "set_due", "add_action", "submit_execution", "approve_execution", "move_to_publishing", "mark_published"]) {
  if (!api.includes(`"${action}"`) && !api.includes(`'${action}'`)) failures.push(`Missing workflow action: ${action}`);
  else passes.push(`Workflow action: ${action}`);
}
for (const guard of [
  'if (current.status !== "في انتظار اعتماد الهيكل") return { locked: true };',
  'if (task.status === "تاسك معتمد") return { validation:',
  'if (task.status !== "في انتظار الاعتماد") return { validation:',
  'if (!["جاهز للتنفيذ", "مطلوب تعديل"].includes(task.status)) return { validation:',
]) {
  if (!api.includes(guard)) failures.push(`Missing workflow guard: ${guard}`);
  else passes.push("Workflow guard present");
}

const migration = read("database/migrations/20260723_marketing_native_rebuild_v1190.sql");
for (const table of ["marketing.agenda_items", "marketing.publishing_items", "marketing.creative_type_settings", "marketing.platform_settings", "marketing.activity_log"]) {
  if (!migration.includes(table)) failures.push(`Missing marketing table: ${table}`);
  else passes.push(`Marketing table: ${table}`);
}
for (const mapping of [
  "array['content','photography']",
  "array['content','montage']",
  "array['content','design']",
  "Sandbox / Draft Upload",
  "بانتظار موافقة Public Profile API",
]) {
  if (!migration.includes(mapping)) failures.push(`Missing seeded marketing mapping/status: ${mapping}`);
  else passes.push(`Seeded mapping/status: ${mapping}`);
}

expect("server/_marketing-schema.ts", "export function ensureMarketingSchema()", "Marketing API has idempotent schema bootstrap");
expect("server/marketing/index.ts", "await ensureMarketingSchema();", "Marketing API runs schema bootstrap");
expect("server/_schema.ts", "create table if not exists marketing.publishing_items", "Bootstrap schema contains publishing items");
expect("database/schema.sql", "create table if not exists marketing.publishing_items", "Reference schema contains publishing items");
expect("src/styles.css", "Marketing native module v1.19.0", "Marketing styles are integrated");

if (failures.length) {
  console.error(`Marketing native v1.19.0 check failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Marketing native v1.19.0 check passed (${passes.length} assertions).`);
