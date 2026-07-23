import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

const requiredFiles = [
  "server/marketing/common.ts",
  "server/marketing/campaigns.ts",
  "server/marketing/dashboard.ts",
  "server/marketing/tasks.ts",
  "server/marketing/publishing.ts",
  "server/marketing/stock.ts",
  "server/marketing/settings.ts",
  "server/marketing/platforms/registry.ts",
  "server/internal/marketing-publish.ts",
  "server/operations/photography-requests.ts",
  "src/marketing/MarketingLayout.tsx",
  "src/marketing/pages/MarketingDashboardPage.tsx",
  "src/marketing/pages/CreateCampaignPage.tsx",
  "src/marketing/pages/CreateAgendaPage.tsx",
  "src/marketing/pages/CampaignsPage.tsx",
  "src/marketing/pages/TasksPage.tsx",
  "src/marketing/pages/PublishPrepPage.tsx",
  "src/marketing/pages/PlatformsPage.tsx",
  "src/marketing/pages/CalendarPage.tsx",
  "src/marketing/pages/ReceiptCalendarPage.tsx",
  "src/marketing/pages/StockPage.tsx",
  "src/marketing/pages/PackagesPage.tsx",
  "src/marketing/pages/AttendancePage.tsx",
  "src/marketing/pages/ReportsPage.tsx",
  "src/marketing/settings/MarketingSettingsPanel.tsx",
  "database/migrations/20260723_marketing_full_native_rebuild.sql",
  "public/marketing/templates/task-template-base.xlsx",
  "public/marketing/templates/agenda-task-template.xlsx",
];

for (const file of requiredFiles) {
  if (!exists(file)) throw new Error(`Marketing rebuild check failed: missing ${file}`);
}

const requiredText = [
  ["src/App.tsx", '<Route path="/marketing" element={<MarketingLayout />}>'],
  ["src/App.tsx", '<Route path="stock" element={<StockPage />} />'],
  ["src/pages/SettingsPage.tsx", '<MarketingSettingsPanel />'],
  ["src/marketing/MarketingLayout.tsx", 'label: "قاعدة البيانات"'],
  ["src/marketing/MarketingLayout.tsx", 'label: "الحضور والانصراف"'],
  ["src/marketing/pages/MarketingDashboardPage.tsx", "المطلوب"],
  ["src/marketing/pages/MarketingDashboardPage.tsx", "جاهزية المطلوب"],
  ["src/marketing/pages/MarketingDashboardPage.tsx", "قسم النشر"],
  ["src/marketing/pages/MarketingDashboardPage.tsx", "الأرشيف"],
  ["src/marketing/pages/StockPage.tsx", "الهيكل VIN"],
  ["src/marketing/pages/StockPage.tsx", "اللون الداخلي"],
  ["src/marketing/pages/StockPage.tsx", "اللون الخارجي"],
  ["src/marketing/pages/StockPage.tsx", "متابعة الطلبات"],
  ["src/operations/pages/TransferRequestsPage.tsx", "طلبات النقل والتصوير"],
  ["server/operations/index.ts", "r.request_kind='photography'"],
  ["server/_dashboard-data.ts", "r.request_kind='photography'"],
  ["src/marketing/MarketingLayout.tsx", "تسجيل الحضور الآن"],
  ["src/marketing/pages/AttendancePage.tsx", "تصدير XLSX"],
  ["server/marketing/stock.ts", "request_kind='photography'"],
    ["server/marketing/campaigns.ts", "depends_on_task_id"],
  ["server/marketing/campaigns.ts", 'action === "update_campaign"'],
  ["server/marketing/tasks.ts", "template_approved"],
  ["server/marketing/tasks.ts", "blocked_by_template"],
  ["server/marketing/platforms/registry.ts", "executePublishTarget"],
  ["server/marketing/platforms/registry.ts", "use_saved_contacts"],
  ["server/internal/marketing-publish.ts", "MARKETING_PUBLISHER_SECRET"],
  ["server/marketing/publishing.ts", "recentJobs"],
  ["server/marketing/platforms/registry.ts", "publish_attempts"],
  ["src/marketing/pages/PlatformsPage.tsx", "سجل النشر"],
  ["src/marketing/pages/PublishPrepPage.tsx", "استخدام قائمة عملاء واتساب المحفوظة"],
  ["src/marketing/pages/PublishPrepPage.tsx", "كل التاسكات"],
  ["src/marketing/pages/PublishPrepPage.tsx", "بانتظار التاريخ"],
  ["src/marketing/pages/PublishPrepPage.tsx", "نشر المحدد الآن"],
  ["src/marketing/MarketingLayout.tsx", "meta.access[item.access]"],
  ["src/marketing/settings/MarketingSettingsPanel.tsx", "أرقام عملاء واتساب"],
  ["database/migrations/20260723_marketing_full_native_rebuild.sql", "use_saved_contacts boolean"],
  ["database/migrations/20260723_marketing_full_native_rebuild.sql", "alter table operations.transfer_requests add column if not exists request_kind"],
];

for (const [file, needle] of requiredText) {
  if (!read(file).includes(needle)) throw new Error(`Marketing rebuild check failed: ${file} missing ${needle}`);
}

const marketingRuntimeFiles = ["src/marketing", "server/marketing"];
const forbiddenPatterns = [
  /firebase/i,
  /merged-patches/i,
  /monkey\s*patch/i,
  /MutationObserver/,
  /local-publisher/i,
  /checklist-reel/i,
];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx|css|js|jsx)$/.test(entry.name)) {
      const relative = path.relative(root, full);
      const text = fs.readFileSync(full, "utf8");
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(text)) throw new Error(`Marketing rebuild check failed: forbidden ${pattern} in ${relative}`);
      }
    }
  }
}

for (const directory of marketingRuntimeFiles) walk(path.join(root, directory));

const app = read("src/App.tsx");
for (const forbiddenRoute of ["marketing/settings", "marketing/checklist-reel", "marketing/local-publisher"]) {
  if (app.includes(forbiddenRoute)) throw new Error(`Marketing rebuild check failed: forbidden route ${forbiddenRoute}`);
}

const layout = read("src/marketing/MarketingLayout.tsx");
for (const forbiddenLabel of ["Checklist ريل السيارات", "جدولة النشر المحلي"]) {
  if (layout.includes(forbiddenLabel)) throw new Error(`Marketing rebuild check failed: forbidden marketing navigation ${forbiddenLabel}`);
}



const marketingSettingsSource = read("server/marketing/settings.ts");
if (!marketingSettingsSource.includes("canSeePeopleCatalog") || !marketingSettingsSource.includes("canManagePlatforms ? platform")) {
  throw new Error("Marketing rebuild check failed: marketing metadata must hide people and platform connection details from ordinary users");
}

const campaignScopeSource = read("server/marketing/campaigns.ts");
if (campaignScopeSource.includes('hasPermission(user, "marketing.campaigns.view")) return sql`true`')) {
  throw new Error("Marketing rebuild check failed: campaigns.view must not grant global campaign data access");
}
const dashboardScopeSource = read("server/marketing/dashboard.ts");
if (dashboardScopeSource.includes('hasPermission(user, "marketing.dashboard.view")) return sql`true`')) {
  throw new Error("Marketing rebuild check failed: dashboard.view must not grant global campaign data access");
}
const publishPrepScopeSource = read("server/marketing/publishing.ts");
if (publishPrepScopeSource.includes('hasPermission(user, "marketing.publish_prep.view")) return sql`true`')) {
  throw new Error("Marketing rebuild check failed: publish_prep.view must not grant global publish data access");
}


for (const [file, source] of [["campaigns", campaignScopeSource], ["dashboard", dashboardScopeSource], ["publishing", publishPrepScopeSource]]) {
  if (/paired_content_user_id\s*=\s*\$\{user\.id\}/.test(source) || /\$\{user\.id\}[^`\n]*paired_content_user_id/.test(source)) {
    throw new Error(`Marketing rebuild check failed: ${file} must not grant cross-user access through paired_content_user_id`);
  }
}
const taskSource = read("server/marketing/tasks.ts");
if (!taskSource.includes("storageKey.includes(expectedStorageSegment)")) {
  throw new Error("Marketing rebuild check failed: finalized task files must be bound to the exact task storage path");
}

const publishing = read("server/marketing/publishing.ts");
if (publishing.includes("mark_publish_target")) {
  throw new Error("Marketing rebuild check failed: fake publish action is not allowed");
}

const platformRegistry = read("server/marketing/platforms/registry.ts");
for (const honestState of ["TikTok في وضع Sandbox/Review", "Snapchat بانتظار Public Profile API Allowlist"]) {
  if (!platformRegistry.includes(honestState)) throw new Error(`Marketing rebuild check failed: missing honest platform state ${honestState}`);
}

const migration = read("database/migrations/20260723_marketing_full_native_rebuild.sql");
if (migration.includes("campaigns_v2") || migration.includes("tasks_new")) {
  throw new Error("Marketing rebuild check failed: parallel marketing tables are forbidden");
}
if (!migration.includes("create unique index if not exists marketing_tasks_pair_type_unique")) {
  throw new Error("Marketing rebuild check failed: exact pair task uniqueness is missing");
}
for (const requiredMigrationText of [
  "drop schema if exists marketing cascade",
  "create table marketing.campaigns",
  "create table marketing.creatives",
  "create table marketing.tasks",
  "target_id uuid not null references marketing.publish_targets(id)",
  "operations_transfer_requests_marketing_campaign_fk",
]) {
  if (!migration.includes(requiredMigrationText)) {
    throw new Error(`Marketing rebuild check failed: canonical migration missing ${requiredMigrationText}`);
  }
}
for (const forbiddenLegacyTable of ["marketing.publisher_devices", "marketing.publisher_import_plans"]) {
  if (migration.includes(forbiddenLegacyTable)) {
    throw new Error(`Marketing rebuild check failed: obsolete local publisher table remains in canonical migration: ${forbiddenLegacyTable}`);
  }
}

const campaignApi = read("server/marketing/campaigns.ts");
if (!campaignApi.includes("for update") || !campaignApi.includes("version=version+1")) {
  throw new Error("Marketing rebuild check failed: campaign edit lock/version protection is incomplete");
}

console.log("Marketing full native rebuild structure, exclusions, shared photography flow, exact pair workflow, publishing truthfulness, and unified settings checks passed.");
