import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const marketingDashboard = read("src/marketing/pages/MarketingDashboardPage.tsx");
const taskModal = read("src/marketing/components/TaskDetailModal.tsx");
const publishPrep = read("src/marketing/pages/PublishPrepPage.tsx");
const marketingApi = read("server/marketing/index.ts");
const dashboard = read("src/pages/DashboardPage.tsx");
const dashboardLayout = read("server/_dashboard-layout.ts");
const marketingCss = read("src/marketing/marketing.css");

const checks = [
  ["complete button is outside task details", marketingDashboard.includes("marketing-dashboard-complete-task") && marketingDashboard.includes('action: "complete_task"') && !taskModal.includes("marketing-complete-task-button")],
  ["complete button is limited to received execution tasks at 100 percent", marketingDashboard.includes('task.task_kind === "execution"') && marketingDashboard.includes("progress >= 100") && marketingDashboard.includes('task.status !== "completed"') && marketingDashboard.includes("Boolean(task.received_at)") && marketingDashboard.includes("task.can_complete_task")],
  ["publish prep is driven by every live execution task and isolated manual publish entry", marketingApi.includes("from marketing.tasks t") && marketingApi.includes("where t.task_kind in ('execution','manual_publish')") && marketingApi.includes("coalesce(schedule_row.group_id::text,t.id::text) as id") && marketingApi.includes("cam.is_deleted=false and cam.archived_at is null") && marketingApi.includes("ag.archived_at is null") && !marketingApi.includes("cam.status in ('ready_publish','publishing')") && !marketingApi.includes("ag.status in ('ready_publish','publishing')") && !marketingApi.includes("t.status<>'completed'")],
  ["publish prep save accepts execution tasks from every live campaign and agenda", (marketingApi.match(/cam\.is_deleted=false and cam\.archived_at is null\)/g) || []).length >= 2 && (marketingApi.match(/ag\.archived_at is null\)/g) || []).length >= 2],
  ["publish prep distinguishes automatic task preparation from isolated manual publishing", publishPrep.includes("تجهيز التاسكات") && publishPrep.includes("تجهيز نشر يدوي جديد") && publishPrep.includes("marketing-publish-task-kind") && marketingApi.includes("where t.task_kind in ('execution','manual_publish')") && marketingApi.includes("t.task_kind in ('task_template','execution')")],
  ["automatic publish prep save remains linked to the resolved execution task through the shared schedule service", publishPrep.includes('taskId: editing.task_id || ""') && marketingApi.includes("requestedTaskId") && marketingApi.includes("activePublishTask(sql,taskId,['execution','manual_publish'])") && marketingApi.includes("replacePublishScheduleGroup")],
  ["publish prep can create publishing rows for an execution task that has no prior schedule", marketingApi.includes("select gen_random_uuid()::text as id") && marketingApi.includes("const groupId=clean(current?.group_id)") && !marketingApi.includes('if(!current)throw new Error(\"تاسك تجهيز النشر غير موجود\")')],
  ["dashboard layout uses serialized saves", dashboard.includes("layoutSaveQueueRef") && dashboard.includes("layoutMutationRef")],
  ["dashboard renders widgets in the saved order instead of relying on CSS order", dashboard.includes("DashboardUnifiedGrid") && dashboard.includes("data-widget-id={id}") && !dashboard.includes("style={{ order: widgetPosition(id) }}")],
  ["dashboard layout has a per-user refresh-safe recovery", dashboard.includes("dashboardLayoutStorageKey") && dashboard.includes("readStoredDashboardLayout") && dashboard.includes("writeStoredDashboardLayout")],
  ["dashboard layout API returns persisted timestamp", dashboardLayout.includes("updated_at::text") && dashboardLayout.includes("updatedAt")],
  ["new dashboard and publish controls have native styling", marketingCss.includes(".marketing-dashboard-complete-task") && marketingCss.includes(".marketing-publish-task-kind")],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS: ${name}`);
  else { console.error(`FAIL: ${name}`); failed += 1; }
}
console.log(`Marketing completion / publish prep / dashboard layout checks: ${checks.length - failed}/${checks.length} passed`);
if (failed) process.exit(1);
