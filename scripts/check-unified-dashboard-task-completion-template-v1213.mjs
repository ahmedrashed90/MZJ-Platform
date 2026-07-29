import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const dashboard = read("src/pages/DashboardPage.tsx");
const dashboardLayout = read("server/_dashboard-layout.ts");
const dashboardCss = read("src/styles.css");
const marketingDashboard = read("src/marketing/pages/MarketingDashboardPage.tsx");
const taskModal = read("src/marketing/components/TaskDetailModal.tsx");
const presentation = read("src/marketing/components/TaskTemplatePresentation.tsx");
const marketingApi = read("server/marketing/index.ts");
const marketingCss = read("src/marketing/marketing.css");
const schema = read("server/_marketing-schema.ts");

const checks = [
  ["main and operations widgets share one persisted order", dashboard.includes("DEFAULT_DASHBOARD_WIDGET_ORDER") && dashboard.includes("widgetOrder") && dashboardLayout.includes("dashboard_widget_order")],
  ["all dashboard widgets render in one sortable grid", dashboard.includes('className="dashboard-unified-widget-grid"') && dashboard.includes("sortableDashboardWidget") && dashboard.includes("draggableOperationWidget")],
  ["cross-group drag uses the same dragged widget and drop handler", dashboard.includes("draggedWidget") && dashboard.includes("dropDashboardWidget") && dashboard.includes("persistDashboardLayout(next)")],
  ["dashboard reset restores one unified default order", dashboard.includes("persistDashboardLayout(DEFAULT_DASHBOARD_WIDGET_ORDER, [])")],
  ["unified dashboard grid has shared responsive styling", dashboardCss.includes(".dashboard-unified-widget-grid") && dashboardCss.includes(".dashboard-operation-widget")],
  ["100 percent marks a task ready instead of auto completing", marketingApi.includes("then 'ready_to_complete'") && !marketingApi.includes("then 'completed' when")],
  ["task completion is an explicit backend action", marketingApi.includes("async function completeTask") && marketingApi.includes("action==='complete_task'")],
  ["completed tasks retain actor and completion date", schema.includes("completed_by uuid") && marketingApi.includes("completed_by=${user.id}::uuid") && marketingApi.includes("completed_at=now()")],
  ["unapproval clears completion state", marketingApi.includes("completed_at=null,completed_by=null,final_file_id=null")],
  ["execution task shows a completion button only at 100 percent", taskModal.includes('className="marketing-complete-task-button"') && taskModal.includes('action: "complete_task"') && taskModal.includes("Number(task.progress || 0) >= 100")],
  ["marketing dashboard exposes completed tasks list", marketingDashboard.includes("marketing-completed-tasks-trigger") && marketingDashboard.includes("data.completed") && marketingDashboard.includes("marketing-completed-tasks-modal")],
  ["completed list shows completion actor and date", marketingDashboard.includes("task.completed_by_name") && marketingDashboard.includes("task.completed_at")],
  ["one shared Task Template component is used for saved and approved views", taskModal.split("<TaskTemplatePresentation").length >= 4],
  ["upload preview uses the exact shared Task Template presentation", taskModal.includes('mode="preview"') && taskModal.includes("previewValidation={{") && taskModal.includes("marketing-template-preview-canvas") && !taskModal.includes("marketing-template-preview-table") && !taskModal.includes("marketing-template-preview-design")],
  ["legacy table preview markup and CSS are removed", !taskModal.includes("marketing-template-preview-table") && !dashboardCss.includes("marketing-template-preview-table") && !dashboardCss.includes("marketing-template-validation-summary")],
  ["Task Template is structured into context, fields and scenes", presentation.includes("marketing-template-context-grid") && presentation.includes("marketing-template-field-grid") && presentation.includes("marketing-template-scene-grid")],
  ["preview validation is embedded inside the same presentation shell", presentation.includes("marketing-template-preview-status") && presentation.includes("previewValidation.fileName") && marketingCss.includes(".marketing-template-preview-status")],
  ["Task Template review remains inline on the shared design", presentation.includes("marketing-template-field-review-note") && presentation.includes("onSelectField") && presentation.includes("onFieldNoteChange")],
  ["professional template and completion styling exists", marketingCss.includes(".marketing-template-shell") && marketingCss.includes(".marketing-task-completion-panel") && marketingCss.includes(".marketing-completed-tasks-list")],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS: ${name}`);
  else { console.error(`FAIL: ${name}`); failed += 1; }
}
console.log(`Unified dashboard / task completion / Task Template checks: ${checks.length - failed}/${checks.length} passed`);
if (failed) process.exit(1);
