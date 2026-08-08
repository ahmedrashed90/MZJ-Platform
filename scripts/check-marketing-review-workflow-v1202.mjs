import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const modal = read("src/marketing/components/TaskDetailModal.tsx");
const dashboard = read("src/marketing/pages/MarketingDashboardPage.tsx");
const presentation = read("src/marketing/components/TaskTemplatePresentation.tsx");
const api = read("server/marketing/index.ts");
const css = read("src/marketing/marketing.css");

const checks = [
  ["structured per-field feedback", modal.includes('kind: "task_template_review_feedback"') && modal.includes("fieldNotes") && modal.includes("selectedFields")],
  ["legacy plain notes remain readable", modal.includes('return { ...emptyFeedback, generalNote: text }')],
  ["single click selects review field", presentation.includes("onClick: () => onSelectField?.(key)")],
  ["double click opens inline field note", presentation.includes("onDoubleClick: () => onOpenField?.(key)") && presentation.includes("marketing-template-field-review-note")],
  ["browser prompt removed from template review", !modal.includes("window.prompt") && !modal.includes("prompt(")],
  ["writer sees yellow requested fields and note", presentation.includes("review-selected") && presentation.includes("هذا الحقل مطلوب تعديله")],
  ["approval clears active feedback", modal.includes('reviewActionName === "approve" ? "" : feedback')],
  ["professional review action classes", ["review-request", "review-save", "review-reject", "review-approve"].every((name) => modal.includes(name))],
  ["sticky review command bar", css.includes(".marketing-review-command-bar") && css.includes("position: sticky")],
  ["yellow review field styling", css.includes(".marketing-writer-field.review-selected") && css.includes("background: #fff4ad")],
  ["assigned user can view feedback", api.includes("canViewFeedback:hasPermission") && api.includes("task.assigned_to===user.id")],
  ["required tasks grouped by department", dashboard.includes("requiredByDepartment") && dashboard.includes("marketing-dashboard-department")],
  ["readiness grouped by campaign and department", dashboard.includes("receivedBySource") && dashboard.includes("expandedReadinessDepartments")],
  ["receive action still uses canonical backend flow", dashboard.includes('action: "receive_task"') && api.includes("async function receiveTask")],
  ["received task leaves required and enters readiness", api.includes("required:tasks.filter((task)=>!task.received_at") && api.includes("received:tasks.filter((task)=>task.received_at")],
  ["dashboard task cards preserve responsible and content writer", dashboard.includes("task.assigned_name") && dashboard.includes("task.content_user_name")],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS: ${name}`);
  else {
    console.error(`FAIL: ${name}`);
    failed += 1;
  }
}
console.log(`Marketing review workflow v1.20.2 checks: ${checks.length - failed}/${checks.length} passed`);
if (failed) process.exit(1);
