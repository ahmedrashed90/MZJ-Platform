import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assertions = [];
const check = (name, condition, detail = "") => {
  assertions.push({ name, passed: Boolean(condition), detail });
  if (!condition) throw new Error(`Marketing rebuild check failed: ${name}${detail ? ` — ${detail}` : ""}`);
};

const schema = read("server/_marketing-schema.ts");
const api = read("server/marketing/index.ts");
const app = read("src/App.tsx");
const layout = read("src/marketing/MarketingLayout.tsx");
const pages = read("src/marketing/pages/MarketingPages.tsx");
const wizard = read("src/marketing/components/ProjectWizard.tsx");
const settings = read("src/marketing/components/MarketingSettingsPanel.tsx");
const operationsApi = read("server/operations/index.ts");
const operationsLayout = read("src/operations/OperationsLayout.tsx");
const setup = read("server/setup/initialize.ts");
const gateway = read("api/index.ts");

const expectedRoutes = [
  "/marketing", "/marketing/database", "/marketing/create-campaign", "/marketing/create-agenda",
  "/marketing/campaigns", "/marketing/packages", "/marketing/publish-prep", "/marketing/requests",
  "/marketing/calendar", "/marketing/stock", "/marketing/reports", "/marketing/attendance", "/marketing/connections",
];
for (const route of expectedRoutes) {
  const child = route === "/marketing" ? 'path="/marketing"' : `path="${route.replace("/marketing/", "")}"`;
  check(`route ${route}`, app.includes(child) && layout.includes(route));
}
check("operations photography route", app.includes('path="photos"') && operationsLayout.includes('/operations/photos'));
check("marketing API gateway", gateway.includes('marketingHandler') && gateway.includes('["marketing", marketingHandler]'));
check("schema initialization", setup.includes('ensureMarketingSchema'));
check("attendance settings type-agnostic singleton", schema.includes("id boolean primary key default true check (id = true)") && schema.includes("where not exists(select 1 from marketing.attendance_settings)") && !schema.includes("alter column id type text") && api.includes("order by updated_at desc nulls last limit 1") && api.includes("where ctid=(select ctid from marketing.attendance_settings"));

for (const table of [
  "marketing.departments", "marketing.department_users", "marketing.assignment_actions", "marketing.creative_types",
  "marketing.campaign_types", "marketing.platforms", "marketing.platform_post_types", "marketing.package_categories",
  "marketing.request_statuses", "marketing.instance_assignments", "marketing.instance_vehicles", "marketing.budget_items",
  "marketing.publish_schedule", "marketing.tasks", "marketing.task_action_progress", "marketing.task_uploads",
  "marketing.task_reviews", "marketing.project_links", "marketing.project_files", "marketing.packages",
  "marketing.attendance_records", "marketing.presence_status", "marketing.platform_connections", "marketing.activity_log",
]) check(`schema ${table}`, schema.includes(table));

check("stable idempotency", schema.includes("marketing_campaigns_idempotency_key") && wizard.includes("idempotencyKey") && wizard.includes("localStorage"));
check("unique creative instances", schema.includes("marketing_creatives_project_instance"));
check("unique execution assignment", schema.includes("marketing_instance_assignment_unique"));
check("template task cardinality", api.includes("templateByWriter") && api.includes("task_kind") && api.includes("'template'"));
check("execution task cardinality", api.includes("for (const writerId of writerIds)") && api.includes("template_task_id"));
check("actual receive timestamp", api.includes("received_at=now()") && pages.includes("received_at.slice(0, 10)"));
check("receive gate before template and execution", api.includes("اضغط تم الاستلام قبل رفع Task Template") && api.includes("اضغط تم الاستلام قبل تنفيذ إجراءات التكليف"));
check("weighted action progress", api.includes("task_action_progress") && api.includes("sum(a.percentage)"));
check("equal department rollup", api.includes("avg(dept_progress)"));
check("100 percent publishing gate", api.includes("Number(progress?.value || 0) < 99.99"));
check("dynamic request statuses", settings.includes('"requests"') && pages.includes("meta.requestStatuses") && api.includes("marketing.request_statuses"));
check("shared photography record", api.includes("operations.photography_requests") && operationsApi.includes("operations.photography_requests"));
check("project files and links", api.includes("marketing.project_links") && api.includes("marketing.project_files") && read("src/marketing/components/ProjectDetailsModal.tsx").includes("uploadMarketingFile"));
check("raw folder optional integration", api.includes("MZJ_RAW_API_URL") && wizard.includes("create_raw_folders"));
check("settings are platform-native", read("src/pages/SettingsPage.tsx").includes("MarketingSettingsPanel"));
check("campaign and agenda wizards", pages.includes("ProjectWizard kind=\"campaign\"") && pages.includes("ProjectWizard kind=\"agenda\""));
check("agenda schedule persistence", wizard.includes("schedule })") && wizard.includes("marketing-agenda-days") && wizard.includes("جدول نشر الأجندة"));
check("complete budget fields", schema.includes("ad_count") && schema.includes("content_goal") && schema.includes("expected_goal") && wizard.includes("هدف المحتوى") && wizard.includes("الهدف المتوقع"));
check("task upload permission split", api.includes('uploadKind === "final" ? "marketing.task.execute" : "marketing.template.upload"'));
check("permission-aware marketing navigation", layout.includes("item.permissions.some") && api.includes("لا توجد صلاحية لفتح نظام التسويق"));
check("product files and user summary", read("src/marketing/components/ProjectDetailsModal.tsx").includes("ملخص اليوزرات") && read("src/marketing/components/ProjectDetailsModal.tsx").includes("ملفات المنتجات"));
check("primary department enforced", api.includes("القسم الأساسي غير مكتمل") && wizard.includes("primary_department_id"));
check("department membership validated", api.includes("join marketing.department_users") && api.includes("القسم أو اليوزر غير صحيح"));
check("schedule date range validated", api.includes("تاريخ النشر يجب أن يكون داخل فترة الحملة أو الأجندة"));
check("admin-only assignment actions protected", api.includes("هذا الإجراء متاح للإدارة فقط") && api.includes("a.audience in ('user','both')"));
check("execution receive waits for template", read("src/marketing/components/TaskDetailsModal.tsx").includes('!["waiting_template", "rejected"].includes(task.status)') && api.includes("لا يمكن استلام التاسك التنفيذي قبل اعتماد Task Template المرتبطة"));
check("package category counters", api.includes("countRows") && pages.includes("counts[row.id] || 0"));
check("shared photography status catalog", operationsApi.includes("marketing.request_statuses") && read("src/operations/pages/PhotographyRequestsPage.tsx").includes("requestStatuses"));
check("shared photography event history", api.includes("operations.photography_request_events") && operationsApi.includes("operations.photography_request_events") && pages.includes("سجل المتابعة"));
check("project Excel review export", read("src/marketing/components/ProjectDetailsModal.tsx").includes("application/vnd.ms-excel") && read("src/marketing/components/ProjectDetailsModal.tsx").includes("تصدير Excel"));
check("dynamic primary assignment", wizard.includes("makePrimaryAssignment") && wizard.includes('blankAssignment(departmentId, userId, writerIds, "primary")'));

const marketingRuntime = ["src/marketing", "server/marketing"].flatMap((base) => {
  const files = [];
  const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).forEach((entry) => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(relative);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) files.push(read(relative));
  });
  walk(base);
  return files;
}).join("\n").toLowerCase();
check("no Firebase runtime", !marketingRuntime.includes('from "firebase') && !marketingRuntime.includes("from 'firebase"));
check("no iframe integration", !marketingRuntime.includes("<iframe"));
check("no local publisher dependency", !marketingRuntime.includes("electron") && !marketingRuntime.includes("localhost publisher"));
check("no explicit any in native marketing runtime", !/\bany\b/.test(marketingRuntime));

console.log(`Marketing native rebuild static checks passed: ${assertions.length}`);
