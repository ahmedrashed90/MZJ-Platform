import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const exists = (relative) => fs.existsSync(path.join(root, relative));
const failures = [];
const checked = [];

function requireFile(relative) {
  if (!exists(relative)) failures.push(`Missing file: ${relative}`);
  else checked.push(relative);
}

function requireText(relative, fragments) {
  requireFile(relative);
  if (!exists(relative)) return;
  const text = read(relative);
  for (const fragment of fragments) {
    if (!text.includes(fragment)) failures.push(`${relative} missing: ${fragment}`);
  }
}

const pages = [
  "src/marketing/pages/MarketingDashboardPage.tsx",
  "src/marketing/pages/DatabasePage.tsx",
  "src/marketing/pages/CampaignWizardPage.tsx",
  "src/marketing/pages/AgendaWizardPage.tsx",
  "src/marketing/pages/CampaignManagementPage.tsx",
  "src/marketing/pages/PackagesPage.tsx",
  "src/marketing/pages/PublishPrepPage.tsx",
  "src/marketing/pages/RequestsPage.tsx",
  "src/marketing/pages/CalendarPage.tsx",
  "src/marketing/pages/StockPage.tsx",
  "src/marketing/pages/ReportsPage.tsx",
  "src/marketing/pages/AttendancePage.tsx",
  "src/marketing/pages/ConnectionsPage.tsx",
];
for (const page of pages) requireFile(page);

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

requireText("src/pages/SettingsPage.tsx", ["MarketingSettingsPanel", "إعدادات التسويق"]);
requireText("src/marketing/MarketingLayout.tsx", ["meta.permissions.canView", "meta.permissions.canManage", "meta.permissions.canManagePackages"]);
requireText("src/marketing/components/MarketingSettingsPanel.tsx", [
  '"departments"', '"actions"', '"creatives"', '"campaign_types"', '"platforms"', '"request_statuses"', '"categories"', '"funnels"',
  "userIds", "progressPercent", "adminOnly", "shortCode", "primaryDepartmentId", "width", "height",
]);
requireText("src/marketing/components/CampaignDetailView.tsx", [
  "عرض ملفات المنتجات", "تصدير PDF", "تصدير جدول النشر", "تصدير مراجعة Excel", "downloadSpreadsheetXml", "عرض الميزانية", "عرض نتائج الحملة", "روابط الحملة", "إنشاء فولدرات الخام",
]);
requireText("src/marketing/components/exportFiles.ts", ["downloadSpreadsheetXml", "downloadStoredZip", "buildStoredZip", "buildCsv", "0x04034B50", "0x02014B50"]);
requireText("src/marketing/pages/MarketingDashboardPage.tsx", [
  "TASK - المطلوب", "جاهزية المطلوب", "قسم النشر", "تحميل نموذج Task Template", "approve_template", "request_revision", "reject_template", "attach_final", "toggle_action", "receive",
]);
requireText("src/marketing/pages/CampaignWizardPage.tsx", [
  "بيانات الحملة", "الكرييتيف", "الميزانية", "جدول النشر", "المراجعة", "idempotencyKey", "create_raw_folders",
]);
requireText("src/marketing/pages/AgendaWizardPage.tsx", [
  "بيانات الأجندة", "جدول الأيام والربط", "مراجعة وإنشاء الأجندة", "تحميل شيتات العلاقات ZIP", "downloadStoredZip", "idempotencyKey", "create_raw_folders",
]);
requireText("src/marketing/pages/StockPage.tsx", ["create_photo_request", "إنشاء طلب تصوير", "رقم الهيكل", "المكان الحالي"]);
requireText("src/marketing/pages/RequestsPage.tsx", ["photo_request_action", "بيانات المتابعة", "row.updates"]);
requireText("src/operations/pages/TransferRequestsPage.tsx", ["PhotographyRequestsList", "طلبات التصوير", "متابعة الطلبات"]);
requireText("src/operations/components/PhotographyRequestsList.tsx", ["dashboard_requests", 'kind: "photo"', "بيانات المتابعة", "row.updates"]);
requireFile("public/templates/marketing-task-template.xlsx");
requireFile("public/templates/marketing-agenda-task-template.xlsx");

const serverFragments = [
  "canViewMarketing", "createCampaign", "pg_advisory_xact_lock", "idempotency_key", "taskAction", "approve_template", "request_revision", "reject_template", "template_task_id", "toggle_action", "actual_received_at=now()", "calculateCampaignProgress", "move_to_publish", "create_raw_folders", "createPhotoRequest", "photoRequestAction", "photography_request_updates", "savePackage", "attendanceAction", "saveConnection",
];
requireText("server/marketing/index.ts", serverFragments);
requireText("server/operations/index.ts", ["photography_requests", "photography_request_updates", 'kind === "photo"']);
requireText("api/index.ts", ["marketing"]);

const schemaFiles = ["database/marketing_native_rebuild.sql", "database/schema.sql", "server/_schema.ts"];
const tables = [
  "marketing.departments", "marketing.department_users", "marketing.assignment_actions", "marketing.creative_catalog", "marketing.campaign_types", "marketing.funnels", "marketing.platforms", "marketing.platform_post_types", "marketing.request_statuses", "marketing.package_categories", "marketing.campaigns", "marketing.agenda_days", "marketing.creative_instances", "marketing.instance_content_writers", "marketing.instance_departments", "marketing.instance_assignments", "marketing.instance_vehicles", "marketing.instance_platform_posts", "marketing.budget_items", "marketing.budget_platform_values", "marketing.publish_schedule_items", "marketing.publish_schedule_posts", "marketing.tasks", "marketing.task_action_items", "marketing.template_submissions", "marketing.campaign_links", "marketing.car_packages", "marketing.attendance_records", "marketing.platform_connections", "operations.photography_requests", "operations.photography_request_vehicles", "operations.photography_request_updates",
];
for (const schemaFile of schemaFiles) requireText(schemaFile, tables);
requireText("database/marketing_native_rebuild.sql", [
  "begin;", "commit;", "drop schema if exists marketing cascade", "unique(campaign_id,publish_date,instance_id)", "PANNER", "MZJ-INTERIAL", "D-CAROUSEL", "M-RL-SPEC-ST", "P-CAR-PHOTO", "marketing.settings.manage",
]);

const forbiddenTargets = ["src/marketing", "server/marketing", "database/marketing_native_rebuild.sql"];
const forbiddenPatterns = [/firebase/i, /local\s*publisher/i, /publisher\s*agent/i, /checklist/i, /\/marketing\/settings/i, /<iframe/i];
function walk(target) {
  const absolute = path.join(root, target);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return [absolute];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => walk(path.relative(root, path.join(absolute, entry.name))));
}
for (const target of forbiddenTargets) {
  for (const absolute of walk(target)) {
    if (!/\.(ts|tsx|js|mjs|sql|css|html)$/i.test(absolute)) continue;
    const text = fs.readFileSync(absolute, "utf8");
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(text)) failures.push(`Forbidden marketing runtime content ${pattern} in ${path.relative(root, absolute)}`);
    }
  }
}

for (const relative of [...walk("src/marketing"), path.join(root, "server/marketing/index.ts")]) {
  if (!/\.(ts|tsx)$/i.test(relative)) continue;
  const text = fs.readFileSync(relative, "utf8");
  if (/\bas\s+any\b|:\s*any\b|<any>/.test(text)) failures.push(`Unsafe any found in ${path.relative(root, relative)}`);
}

if (failures.length) {
  console.error(`Marketing native validation failed (${failures.length} issue(s)):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Marketing native validation passed (${new Set(checked).size} required files, dynamic schema/routes/actions verified).`);
