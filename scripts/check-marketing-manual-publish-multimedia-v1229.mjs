import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const publishApi = read("server/marketing/index.ts");
const permissions = read("server/_api-permissions.ts");
const publishPage = read("src/marketing/pages/PublishPrepPage.tsx");
const publishStyles = read("src/marketing/marketing.css");
const instagramPublisher = read("server/_instagram-publisher.ts");
const uploadApi = read("src/marketing/api.ts");

const checks = [
  ["manual publishing loads independent campaign and agenda sources", publishApi.includes("async function manualPublishSources") && publishApi.includes("manualSources:await manualPublishSources")],
  ["manual publishing selects a system creative type rather than an existing task", publishPage.includes("creativeTypeId") && publishPage.includes("اختر نوع الكرييتيف من النظام") && !publishPage.includes("manualTaskRows") && !publishPage.includes("manualSelectedRow")],
  ["manual publishing accepts files directly from the user's device", publishPage.includes('type="file"') && publishPage.includes("multiple") && publishPage.includes("addManualFiles") && publishPage.includes("manualFiles")],
  ["selected manual files keep an explicit order", publishPage.includes("moveManualFile") && publishPage.includes("[next[index], next[target]] = [next[target], next[index]]") && publishPage.includes("ترتيب القائمة هو ترتيب الصور عند النشر")],
  ["manual publishing creates a new isolated publish entry", publishPage.includes('action: "create_manual_publish_entry"') && publishApi.includes("async function createManualPublishEntry") && publishApi.includes("task_kind,title,status") && publishApi.includes("'manual_publish'")],
  ["manual upload uses the canonical Zoho final-media flow", publishPage.includes("uploadMarketingFinalFiles") && uploadApi.includes('action: "prepare_final_upload"') && uploadApi.includes('action: "attach_final_media_group"') && publishApi.includes("ملفات النشر اليدوي تُرفع كمجموعة مرتبة")],
  ["failed or cancelled manual uploads clean up their draft", publishPage.includes('action: "discard_manual_publish_entry"') && publishApi.includes("async function discardManualPublishEntry")],
  ["manual publish anchor tasks do not enter campaign progress or normal task dashboards", publishApi.includes("task_kind in ('task_template','execution')") && publishApi.includes("t.task_kind in ('execution','manual_publish')")],
  ["manual and automatic schedules share one normalization and persistence path", publishApi.includes("normalizePublishScheduleRequest") && publishApi.includes("replacePublishScheduleGroup") && publishApi.includes("savePublishPrep") && publishApi.includes("createManualPublishEntry")],
  ["saved manual entries remain editable through the same schedule service", publishApi.includes("activePublishTask(sql,taskId,['execution','manual_publish'])") && publishApi.includes("publishTask.task_kind==='manual_publish'") && publishPage.includes('editing?.task_kind === "manual_publish" ? "تعديل النشر اليدوي"')],
  ["photo posts accept ordered multiple images", publishApi.includes("attached_media:mediaIds.map") && instagramPublisher.includes('media_type: "CAROUSEL"')],
  ["Instagram stories publish every selected image in order", instagramPublisher.includes("for (let index = 0; index < files.length; index += 1)") && instagramPublisher.includes("stories.push(await publishImageStory")],
  ["Facebook stories publish every selected image in order", publishApi.includes("for(const storyFile of files)") && publishApi.includes("batchCount:stories.length")],
  ["video formats remain limited to one video file", publishApi.includes("الفيديو أو الريل يُرفع كملف واحد فقط") && publishPage.includes("الفيديو أو الريل يُرفع كملف واحد فقط")],
  ["Instagram multi-image posts enforce the platform limit", publishApi.includes("حتى 10 صور") && publishPage.includes("حتى 10 صور")],
  ["manual upload actions keep authoritative task-kind permission checks", permissions.includes('create_manual_publish_entry: "marketing.publish_prep.manage"') && publishApi.includes('const permission = isManualPublish ? "marketing.publish_prep.manage"')],
  ["manual publishing UI has scoped file-picker and progress styles", publishStyles.includes(".marketing-manual-media-picker") && publishStyles.includes(".marketing-manual-upload-progress") && publishStyles.includes(".marketing-manual-media-order")],
];

let passed = 0;
for (const [label, condition] of checks) {
  console.log(`${condition ? "PASS" : "FAIL"}: ${label}`);
  if (condition) passed += 1;
}
console.log(`Marketing manual publish multimedia checks: ${passed}/${checks.length} passed`);
if (passed !== checks.length) process.exit(1);
