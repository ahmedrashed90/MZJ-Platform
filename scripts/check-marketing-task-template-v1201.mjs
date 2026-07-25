import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const templateExcel = read("src/marketing/templateExcel.ts");
const taskModal = read("src/marketing/components/TaskDetailModal.tsx");
const api = read("src/marketing/api.ts");
const marketingApi = read("server/marketing/index.ts");
const gateway = read("server/_api-permissions.ts");
const css = read("src/marketing/marketing.css");

const checks = [
  ["real xlsx extension", templateExcel.includes(".xlsx") && !templateExcel.includes(".xls\`")],
  ["OpenXML workbook content type", templateExcel.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml")],
  ["RTL worksheet", templateExcel.includes('rightToLeft="1"')],
  ["Task Template sheet name", templateExcel.includes('sheet name="Task Template"')],
  ["writer keys preserved", ["proposedName", "goal", "mainMessage", "hook", "mainScript", "cta", "caption", "hashtags"].every((key) => templateExcel.includes(`\"${key}\"`))],
  ["main script row is tall", templateExcel.includes('key === "mainScript" ? 120')],
  ["XLSX parser used", templateExcel.includes("readXlsx(file)")],
  ["full-screen task class", taskModal.includes("marketing-task-modal-fullscreen")],
  ["xlsx upload only", taskModal.includes('accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"')],
  ["large main script editor", taskModal.includes('return "marketing-writer-field full script"') && css.includes("min-height: 330px")],
  ["assignment actions are buttons", taskModal.includes("marketing-action-button") && !taskModal.includes('type="checkbox"')],
  ["action button styles reach the portaled modal", css.includes(".marketing-task-modal-fullscreen .marketing-action-button") && !css.includes(".marketing-page .marketing-action-button")],
  ["full viewport modal", css.includes("height: 100dvh") && css.includes("width: 100vw")],
  ["mark ready sends upload context", api.includes('category: input.category') && api.includes('taskId: input.taskId')],
  ["contextual template permission helper", marketingApi.includes("requireTaskTemplateUploadAccess")],
  ["prepare upload checks task-template permission", marketingApi.includes('if(category==="task-template")await requireTaskTemplateUploadAccess')],
  ["mark ready checks stored file category", marketingApi.includes('if(file.category==="task-template")await requireTaskTemplateUploadAccess')],
  ["template file-task association validation", marketingApi.includes('file.category!=="task-template"') && marketingApi.includes('file.task_id!==taskId')],
  ["gateway routes task-template contextually", gateway.includes('category === "task-template"') && gateway.includes('system.marketing.access')],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS: ${name}`);
  else { console.error(`FAIL: ${name}`); failed += 1; }
}
console.log(`Marketing Task Template v1.20.1 checks: ${checks.length - failed}/${checks.length} passed`);
if (failed) process.exit(1);