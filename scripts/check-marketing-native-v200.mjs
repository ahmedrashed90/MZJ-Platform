import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const failures = [];
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const exists = (relative) => fs.existsSync(path.join(root, relative));
const requireFile = (relative) => {
  if (!exists(relative)) failures.push(`missing file: ${relative}`);
};
const requireText = (relative, needles) => {
  if (!exists(relative)) return failures.push(`missing file: ${relative}`);
  const text = read(relative);
  for (const needle of needles) {
    if (!text.includes(needle)) failures.push(`missing ${JSON.stringify(needle)} in ${relative}`);
  }
};

const requiredFiles = [
  "server/_marketing-schema.ts",
  "server/_marketing-utils.ts",
  "server/marketing/index.ts",
  "database/migrations/20260723_marketing_native_rebuild_v200.sql",
  "src/marketing/MarketingContext.tsx",
  "src/marketing/MarketingLayout.tsx",
  "src/marketing/components/MarketingSettingsPanel.tsx",
  "src/marketing/components/TaskDetailModal.tsx",
  "src/marketing/components/CampaignDetailModal.tsx",
  "src/marketing/components/InstanceEditor.tsx",
  "src/marketing/pages/MarketingDashboardPage.tsx",
  "src/marketing/pages/MarketingDatabasePage.tsx",
  "src/marketing/pages/CreateCampaignPage.tsx",
  "src/marketing/pages/CreateAgendaPage.tsx",
  "src/marketing/pages/MarketingCampaignsPage.tsx",
  "src/marketing/pages/MarketingPackagesPage.tsx",
  "src/marketing/pages/MarketingPublishPrepPage.tsx",
  "src/marketing/pages/MarketingRequestsPage.tsx",
  "src/marketing/pages/MarketingCalendarPage.tsx",
  "src/marketing/pages/MarketingStockPage.tsx",
  "src/marketing/pages/MarketingReportsPage.tsx",
  "src/marketing/pages/MarketingAttendancePage.tsx",
  "src/marketing/pages/MarketingConnectionsPage.tsx",
];
requiredFiles.forEach(requireFile);

requireText("src/App.tsx", [
  'path="/marketing"',
  'path="database"',
  'path="create-campaign"',
  'path="create-agenda"',
  'path="campaigns"',
  'path="packages"',
  'path="publish-prep"',
  'path="requests"',
  'path="calendar"',
  'path="stock"',
  'path="reports"',
  'path="attendance"',
  'path="connections"',
]);
requireText("api/index.ts", ['import marketingHandler', '["marketing", marketingHandler]']);
requireText("server/setup/initialize.ts", ["ensureMarketingSchema", "await ensureMarketingSchema()"]);
requireText("src/pages/SettingsPage.tsx", ["MarketingSettingsPanel", 'section === "marketing"']);
requireText("server/operations/index.ts", ["updatePhotographyRequest", 'action === "update_photography_request"']);
requireText("src/operations/pages/TransferRequestsPage.tsx", ["طلبات التصوير", "update_photography_request"]);

const schema = read("database/migrations/20260723_marketing_native_rebuild_v200.sql");
for (const table of [
  "departments", "department_users", "assignment_actions", "creatives", "campaign_types",
  "platforms", "publish_types", "package_categories", "request_statuses", "campaigns",
  "agenda_days", "creative_instances", "instance_content_users", "instance_sections",
  "section_users", "section_user_writers", "instance_vehicles", "instance_platforms",
  "instance_publish_types", "budget_items", "budget_item_platforms", "schedule_items",
  "schedule_item_platforms", "files", "tasks", "task_actions", "template_submissions",
  "task_reviews", "campaign_files", "campaign_links", "raw_folder_runs", "packages",
  "attendance", "platform_connections",
]) {
  if (!schema.includes(`create table marketing.${table}`)) failures.push(`missing marketing table: ${table}`);
}
for (const fragment of [
  "drop schema if exists marketing cascade;",
  "create schema marketing;",
  "task_no text not null unique",
  "unique(creative_instance_id,task_kind,department_id,assigned_to,content_writer_id)",
]) {
  if (!schema.toLowerCase().includes(fragment.toLowerCase())) failures.push(`missing migration guarantee: ${fragment}`);
}

const server = read("server/marketing/index.ts");
for (const action of [
  "meta", "dashboard", "campaigns", "campaign_detail", "task_detail", "stock",
  "photo_requests", "packages", "calendar", "reports", "attendance", "connections",
  "publish_prep", "file_url", "save_setting", "disable_setting", "create_campaign",
  "create_agenda", "receive_task", "prepare_upload", "finish_upload", "submit_template",
  "review_template", "task_action", "attach_final_file", "campaign_action", "save_package",
  "delete_package", "create_photo_request", "update_photo_request", "save_attendance",
  "save_connection", "delete_connection", "add_campaign_link", "attach_campaign_file",
  "create_raw_folders",
]) {
  if (!server.includes(`"${action}"`)) failures.push(`missing marketing API action: ${action}`);
}

const marketingSourceFiles = [
  "server/_marketing-schema.ts",
  "server/_marketing-utils.ts",
  "server/marketing/index.ts",
  ...fs.readdirSync(path.join(root, "src/marketing"), { recursive: true })
    .filter((entry) => typeof entry === "string" && /\.(ts|tsx)$/.test(entry))
    .map((entry) => path.join("src/marketing", entry)),
];
for (const relative of marketingSourceFiles) {
  const text = read(relative);
  if (/\bany\b|\bas\s+any\b/.test(text)) failures.push(`explicit any is not allowed: ${relative}`);
  if (/firebase|<iframe|local[ _-]?publisher|publisher[ _-]?agent/i.test(text)) failures.push(`forbidden runtime feature in ${relative}`);
  if (/TODO|FIXME|coming soon|placeholder page|stub page/i.test(text)) failures.push(`unfinished implementation marker in ${relative}`);
}

const app = read("src/App.tsx");
if (/\/marketing\/settings/.test(app)) failures.push("standalone /marketing/settings route is forbidden");
if (/checklist/i.test(app) && /marketing/i.test(app)) failures.push("marketing checklist route is forbidden");

if (failures.length) {
  console.error("Marketing native v2.0 validation failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`Marketing native v2.0 validation passed (${requiredFiles.length} required files, dynamic schema/routes/actions verified).`);
