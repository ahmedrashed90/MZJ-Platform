import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
const check = (name, condition, detail = "") => {
  checks.push({ name, passed: Boolean(condition) });
  if (!condition) throw new Error(`Marketing native rebuild check failed: ${name}${detail ? ` — ${detail}` : ""}`);
};

const schema = read("server/_marketing-schema.ts");
const api = read("server/marketing/index.ts");
const app = read("src/App.tsx");
const layout = read("src/marketing/MarketingLayout.tsx");
const pages = read("src/marketing/pages/MarketingPages.tsx");
const wizard = read("src/marketing/components/ProjectWizard.tsx");
const settings = read("src/marketing/components/MarketingSettingsPanel.tsx");
const projectDetails = read("src/marketing/components/ProjectDetailsModal.tsx");
const taskDetails = read("src/marketing/components/TaskDetailsModal.tsx");
const operationsApi = read("server/operations/index.ts");
const operationsLayout = read("src/operations/OperationsLayout.tsx");
const operationsPhotos = read("src/operations/pages/PhotographyRequestsPage.tsx");
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
check("marketing API gateway", gateway.includes("marketingHandler") && gateway.includes('["marketing", marketingHandler]'));
check("schema initialization", setup.includes("ensureMarketingSchema"));
check("isolated native schema", schema.includes("create schema if not exists marketing_native") && !/\b(?:from|join|into|update|table|sequence|references)\s+marketing\.(?:campaigns|platforms|platform_post_types|tasks|departments)\b/i.test(schema));
check("attendance clean singleton", schema.includes("id text primary key default 'default' check (id = 'default')") && schema.includes("insert into marketing_native.attendance_settings(id) values('default')") && api.includes("order by updated_at desc nulls last limit 1"));

for (const table of [
  "departments", "department_users", "assignment_actions", "creative_types", "campaign_types", "platforms",
  "platform_post_types", "package_categories", "request_statuses", "campaigns", "creatives", "instance_assignments",
  "instance_vehicles", "budget_items", "publish_schedule", "tasks", "task_action_progress", "task_uploads",
  "task_reviews", "project_links", "project_files", "packages", "attendance_settings", "attendance_records",
  "presence_status", "attendance_requests", "platform_connections", "activity_log",
]) check(`schema marketing_native.${table}`, schema.includes(`marketing_native.${table}`));

check("platform parent-child seed order", schema.indexOf("insert into marketing_native.platforms") < schema.indexOf("insert into marketing_native.platform_post_types"));
check("platform post types resolve native parent IDs", schema.includes("from marketing_native.platforms p") && schema.includes("on v.platform_code=p.code"));
check("platform FK points to native parent", schema.includes("platform_id uuid not null references marketing_native.platforms(id) on delete cascade"));
check("transactional schema self-check", schema.includes("orphan platform_post_types rows") && schema.includes("platform_post_types FK does not target marketing_native.platforms"));
check("stable idempotency", schema.includes("marketing_campaigns_idempotency_key") && wizard.includes("idempotencyKey") && wizard.includes("localStorage"));
check("unique creative instances", schema.includes("marketing_creatives_project_instance"));
check("unique execution assignment", schema.includes("marketing_instance_assignment_unique"));
check("template task cardinality", api.includes("templateByWriter") && api.includes("task_kind") && api.includes("'template'"));
check("execution task cardinality", api.includes("for (const writerId of writerIds)") && api.includes("template_task_id"));
check("actual receive timestamp", api.includes("received_at=now()") && pages.includes("received_at.slice(0, 10)"));
check("receive gate before uploads/actions", api.includes("اضغط تم الاستلام قبل رفع Task Template") && api.includes("اضغط تم الاستلام قبل تنفيذ إجراءات التكليف"));
check("weighted action progress", api.includes("task_action_progress") && api.includes("sum(a.percentage)"));
check("equal department rollup", api.includes("avg(dept_progress)"));
check("100 percent publishing gate", api.includes("Number(progress?.value || 0) < 99.99"));
check("dynamic request statuses", settings.includes('"requests"') && pages.includes("meta.requestStatuses") && api.includes("marketing_native.request_statuses"));
check("shared photography record", api.includes("operations.photography_requests") && operationsApi.includes("operations.photography_requests"));
check("project files and links", api.includes("marketing_native.project_links") && api.includes("marketing_native.project_files") && projectDetails.includes("uploadMarketingFile"));
check("raw folder optional integration", api.includes("MZJ_RAW_API_URL") && wizard.includes("create_raw_folders"));
check("settings are platform-native", read("src/pages/SettingsPage.tsx").includes("MarketingSettingsPanel"));
check("campaign and agenda wizards", pages.includes('ProjectWizard kind="campaign"') && pages.includes('ProjectWizard kind="agenda"'));
check("agenda schedule persistence", wizard.includes("schedule })") && wizard.includes("marketing-agenda-days") && wizard.includes("جدول نشر الأجندة"));
check("complete budget fields", schema.includes("ad_count") && schema.includes("content_goal") && schema.includes("expected_goal") && wizard.includes("هدف المحتوى") && wizard.includes("الهدف المتوقع"));
check("task upload permission split", api.includes('uploadKind === "final" ? "marketing.task.execute" : "marketing.template.upload"'));
check("permission-aware navigation", layout.includes("item.permissions.some") && api.includes("لا توجد صلاحية لفتح نظام التسويق"));
check("product files and user summary", projectDetails.includes("ملخص اليوزرات") && projectDetails.includes("ملفات المنتجات"));
check("primary department enforced", api.includes("القسم الأساسي غير مكتمل") && wizard.includes("primary_department_id"));
check("department membership validated", api.includes("join marketing_native.department_users") && api.includes("القسم أو اليوزر غير صحيح"));
check("schedule date range validated", api.includes("تاريخ النشر يجب أن يكون داخل فترة الحملة أو الأجندة"));
check("admin-only actions protected", api.includes("هذا الإجراء متاح للإدارة فقط") && api.includes("a.audience in ('user','both')"));
check("execution receive waits for template", taskDetails.includes('!["waiting_template", "rejected"].includes(task.status)') && api.includes("لا يمكن استلام التاسك التنفيذي قبل اعتماد Task Template المرتبطة"));
check("package category counters", api.includes("countRows") && pages.includes("counts[row.id] || 0"));
check("shared photography status catalog", operationsApi.includes("marketing_native.request_statuses") && operationsPhotos.includes("requestStatuses"));
check("shared photography event history", api.includes("operations.photography_request_events") && operationsApi.includes("operations.photography_request_events") && pages.includes("سجل المتابعة"));
check("project review export", projectDetails.includes("application/vnd.ms-excel") && projectDetails.includes("تصدير Excel"));
check("dynamic primary assignment", wizard.includes("makePrimaryAssignment") && wizard.includes('blankAssignment(departmentId, userId, writerIds, "primary")'));

const runtimeFiles = [];
for (const base of ["src/marketing", "server/marketing"]) {
  const walk = (relative) => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (/\.(?:ts|tsx|js|jsx)$/i.test(entry.name)) runtimeFiles.push(read(child));
    }
  };
  walk(base);
}
const marketingRuntime = runtimeFiles.join("\n").toLowerCase();
check("no Firebase runtime", !marketingRuntime.includes('from "firebase') && !marketingRuntime.includes("from 'firebase"));
check("no iframe integration", !marketingRuntime.includes("<iframe"));
check("no local publisher dependency", !marketingRuntime.includes("electron") && !marketingRuntime.includes("localhost publisher"));
check("no legacy marketing table runtime access", !/\b(?:from|join|into|update)\s+marketing\.(?:campaigns|platforms|platform_post_types|tasks|departments)\b/i.test(marketingRuntime));

console.log(`Marketing native rebuild checks passed: ${checks.length}`);
