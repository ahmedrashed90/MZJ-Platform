import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const shared = read("shared/marketing-publishing.ts");
const schema = read("server/_marketing-schema.ts");
const migration = read("database/migrations/20260805_marketing_platform_publish_types_manual_entry_v1227.sql");
const api = read("server/marketing/index.ts");
const clientApi = read("src/marketing/api.ts");
const publishPrep = read("src/marketing/pages/PublishPrepPage.tsx");
const departments = read("src/marketing/pages/DepartmentsPage.tsx");
const types = read("src/marketing/types.ts");

const canonical = [
  ['instagram', 'بوست صور', 1080, 1080, 'photo_post'],
  ['instagram', 'ريل', 1080, 1920, 'reel'],
  ['instagram', 'ستوري', 1080, 1920, 'story'],
  ['tiktok', 'ريل/فيديو', 1080, 1920, 'video'],
  ['tiktok', 'ستوري', 1080, 1920, 'story'],
  ['snapchat', 'Spotlight', 1080, 1920, 'short'],
  ['snapchat', 'Story', 1080, 1920, 'story'],
  ['facebook', 'بوست صور', 1080, 1080, 'photo_post'],
  ['facebook', 'ريل', 1080, 1920, 'reel'],
  ['facebook', 'ستوري', 1080, 1920, 'story'],
  ['linkedin', 'بوست', 1080, 1080, 'photo_post'],
  ['linkedin', 'فيديو', 1080, 1920, 'video'],
  ['youtube', 'Shorts', 1080, 1920, 'short'],
  ['youtube', 'فيديو', 1920, 1080, 'video'],
];

const presetPattern = (platform, name, width, height, format) =>
  shared.includes(`{ name: "${name}", width: ${width}, height: ${height}, format: "${format}" }`) && shared.includes(`${platform}: [`);
const migrationPattern = (platform, name, width, height, format) =>
  migration.includes(`('${platform}','${name}',${width},${height},'${format}')`) && schema.includes(`('${platform}','${name}',${width},${height},'${format}')`);

const checks = [
  ["all canonical platform dimensions and formats are defined once in the shared publishing model", canonical.every((item) => presetPattern(...item))],
  ["database bootstrap and standalone migration use the same canonical platform matrix", canonical.every((item) => migrationPattern(...item))],
  ["obsolete YouTube Reel/Short and LinkedIn Reel choices are not part of the canonical matrix", !shared.includes('{ name: "ريل/Short"') && !shared.includes('linkedin: [\n    { name: "ريل"')],
  ["obsolete platform types are deactivated instead of left selectable", schema.includes("set is_active=false") && schema.includes("('youtube','Shorts'),('youtube','فيديو')") && migration.includes("('linkedin','بوست'),('linkedin','فيديو')")],
  ["post types persist a normalized publish format", schema.includes("publish_format text not null default 'post'") && schema.includes("platform_post_types_publish_format_check") && types.includes("publish_format?:")],
  ["marketing metadata returns dimensions and publish format to settings and publish prep", api.includes("p.width,p.height,p.publish_format")],
  ["settings continue to edit and display the stored width and height without a new design", departments.includes("post.width && post.height") && departments.includes("العرض") && departments.includes("الارتفاع")],
  ["saving a platform derives the execution format from platform code and post type", api.includes("const publishFormat=resolveMarketingPublishFormat(code,postName)") && api.includes("publish_format=excluded.publish_format")],
  ["uploaded media stores width, height and duration", schema.includes("media_width integer") && schema.includes("media_height integer") && schema.includes("duration_seconds numeric(12,3)") && api.includes("media_width,media_height,duration_seconds")],
  ["the browser reads real image/video metadata before final upload", clientApi.includes("video.videoWidth") && clientApi.includes("video.videoHeight") && clientApi.includes("image.naturalWidth") && clientApi.includes("readMarketingMediaMetadataList")],
  ["final upload sends metadata to the backend", clientApi.includes("width: metadata[index]?.width") && clientApi.includes("durationSeconds: metadata[index]?.durationSeconds")],
  ["one backend resolver validates platform and post-type ownership for both normal and manual prep", api.includes("async function resolvePublishCombinations") && api.includes("نوع النشر المحدد لا يتبع المنصة المختارة أو غير مفعّل") && api.match(/resolvePublishCombinations\(/g)?.length >= 3],
  ["one shared media validator is used before saving and immediately before publishing", api.includes("assertMediaMatchesPublishCombinations") && api.includes("assertPublishMedia({platformCode") && shared.includes("validateMarketingPublishMedia")],
  ["exact selected dimensions are snapshotted on every schedule", api.includes("requiredWidth:item.width") && api.includes("requiredHeight:item.height")],
  ["YouTube Shorts are vertical and limited to three minutes", shared.includes('youtube: [\n    { name: "Shorts", width: 1080, height: 1920, format: "short" }') && shared.includes("duration > 180")],
  ["manual publishing no longer lists existing campaigns, agendas or creatives", !publishPrep.includes("manualSources") && !publishPrep.includes("manualTaskRows") && !publishPrep.includes("اختر الكرييتيف")],
  ["manual publishing creates a new source and a new creative and uploads new local media", publishPrep.includes("حملة جديدة") && publishPrep.includes("أجندة جديدة") && publishPrep.includes("اسم الكرييتيف الجديد") && publishPrep.includes('type="file"') && publishPrep.includes('action: "create_manual_publish_entry"')],
  ["manual source creation is validated against the chosen types before database insertion", api.indexOf("assertMediaMatchesPublishCombinations(combinations,mediaFiles)") < api.indexOf("return sql.begin(async tx=>") && publishPrep.includes("files: browserMediaDescriptors")],
  ["manual execution task bypasses unrelated assignment actions while retaining the approved template gate", api.includes("'manual_publish',null") && api.includes("'approved',100") && api.includes("marketing.task.final_file.upload")],
  ["manual content uses the same final upload and save-publish-prep flow", publishPrep.includes("uploadMarketingFinalFiles") && publishPrep.includes('action: "save_publish_prep"') && publishPrep.includes("sourceName") && publishPrep.includes("creativeName")],
];

let passed = 0;
for (const [label, condition] of checks) {
  console.log(`${condition ? "PASS" : "FAIL"}: ${label}`);
  if (condition) passed += 1;
}
console.log(`Marketing platform dimensions and manual-entry checks: ${passed}/${checks.length} passed`);
if (passed !== checks.length) process.exit(1);
