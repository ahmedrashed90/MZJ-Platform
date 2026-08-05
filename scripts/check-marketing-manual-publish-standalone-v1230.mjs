import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const publishApi = read("server/marketing/index.ts");
const schema = read("server/_marketing-schema.ts");
const publishPage = read("src/marketing/pages/PublishPrepPage.tsx");
const instagramPublisher = read("server/_instagram-publisher.ts");

const checks = [
  ["manual publish no longer asks for a campaign or agenda", !publishPage.includes("manualSources") && !publishPage.includes("sourceKey") && !publishPage.includes("اختر الحملة أو الأجندة")],
  ["manual publish creative type comes from the active system creative-type list", publishPage.includes("meta?.creativeTypes") && publishPage.includes("اختر نوع الكرييتيف من قائمة الكرييتيفات")],
  ["manual publish still selects files directly from the device", publishPage.includes('type="file"') && publishPage.includes("multiple") && publishPage.includes("addManualFiles")],
  ["manual publishing remains multi-image aware", publishPage.includes("بوست الصور والستوري يقبلان عدة صور") && publishPage.includes("moveManualFile")],
  ["server no longer loads campaign or agenda sources for the manual form", !publishApi.includes("async function manualPublishSources") && !publishApi.includes("manualSources:await manualPublishSources")],
  ["manual entry is stored as a standalone source", publishApi.includes("'manual',${sourceId}::uuid") && publishApi.includes("campaign_id,agenda_id") && publishApi.includes("null,null,'manual'")],
  ["standalone manual creative has no campaign or agenda foreign key", publishApi.includes("${ids.creative_id}::uuid,null,null") && publishApi.includes("standalone:true")],
  ["publish schedule and published posts accept manual source type", schema.includes("publish_schedule_source_type_check check(source_type in ('campaign','agenda','manual'))") && schema.includes("published_posts_source_type_check check(source_type in ('campaign','agenda','manual'))")],
  ["manual rows remain visible in publish preparation", publishApi.includes("t.source_type='manual' and t.task_kind='manual_publish'") && publishApi.includes("then 'نشر يدوي'")],
  ["standalone manual access is checked through its task", publishApi.includes("async function assertPublishEntryAccess") && publishApi.includes("canAccessMarketingTask(sql,user,taskId)")],
  ["standalone manual records do not recalculate campaign or agenda progress", publishApi.includes('if (sourceType === "manual") return;')],
  ["manual and automatic publishing keep the same schedule persistence service", publishApi.includes("replacePublishScheduleGroup") && publishApi.includes("normalizePublishScheduleRequest")],
  ["Instagram image posts still support carousel publishing", instagramPublisher.includes('media_type: "CAROUSEL"')],
  ["Instagram stories still publish selected images in order", instagramPublisher.includes("for (let index = 0; index < files.length; index += 1)")],
];

let passed = 0;
for (const [label, condition] of checks) {
  console.log(`${condition ? "PASS" : "FAIL"}: ${label}`);
  if (condition) passed += 1;
}
console.log(`Marketing standalone manual publish checks: ${passed}/${checks.length} passed`);
if (passed !== checks.length) process.exit(1);
