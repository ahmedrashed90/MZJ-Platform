import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const files = {
  schema: read("server/_marketing-schema.ts"),
  zoho: read("server/_zoho-workdrive.ts"),
  route: read("server/integrations/zoho.ts"),
  api: read("api/index.ts"),
  marketing: read("server/marketing/index.ts"),
  client: read("src/marketing/api.ts"),
  modal: read("src/marketing/components/TaskDetailModal.tsx"),
  publish: read("src/marketing/pages/PublishPrepPage.tsx"),
  connections: read("src/marketing/pages/PlatformConnectionsPage.tsx"),
  worker: read("gateway-worker/src/index.js"),
  env: read(".env.example"),
};

const checks = [
  ["Zoho connection schema", files.schema.includes("marketing.zoho_workdrive_connection")],
  ["Ordered final media schema", files.schema.includes("marketing.final_media_groups") && files.schema.includes("order_index")],
  ["OAuth start and callback", files.route.includes('action === "start"') && files.route.includes('action === "callback"')],
  ["Zoho route registered before generic integrations", files.api.indexOf('route.startsWith("integrations/zoho/")') < files.api.indexOf('route.startsWith("integrations/")')],
  ["Final upload prepares ordered files", files.marketing.includes("prepareFinalUpload") && files.marketing.includes("attachFinalMediaGroup")],
  ["Zoho filenames are collision-safe", files.marketing.includes("zohoFinalFileName") && files.marketing.includes("const zohoFileName=zohoFinalFileName")],
  ["Final upload uses chunked Zoho gateway", files.client.includes("partUploadUrl") && files.client.includes("20 * 1024 * 1024") && files.worker.includes("handleZohoUploadPart") && files.worker.includes("handleZohoUploadFinalize")],
  ["Temporary R2 parts are cleaned", files.worker.includes("ZOHO_UPLOAD_STAGING") && files.worker.includes("bucket.delete(key)")],
  ["Private Zoho media gateway", files.worker.includes("handleZohoMedia") && files.zoho.includes("createZohoMediaUrl")],
  ["Carousel publishes in order", files.marketing.includes("multipleImages") && files.marketing.includes("media_type:'CAROUSEL'")],
  ["Existing final button condition preserved", files.modal.includes('task.template_status !== "approved" || task.status === "completed"')],
  ["Campaign/agenda final files supported", files.marketing.includes("source_type") && files.marketing.includes("source_id")],
  ["RAW token compatibility", files.marketing.includes("MZJ_RAW_ALLOW_LEGACY_TOKEN") && files.marketing.includes("MZJ_RAW_SECRET_2026_CHANGE_ME")],
  ["Zoho environment documented", files.env.includes("ZOHO_PUBLISH_ROOT_FOLDER_ID=efosi67f34a771f13446c8d01545192eb1829")],
  ["Zoho connection UI", files.connections.includes("Zoho WorkDrive") && files.connections.includes("/api/integrations/zoho/start")],
  ["Publish prep recognizes media groups", files.publish.includes("final_file_count")],
  ["Every selected platform requires a post type", files.marketing.includes("حدد نوع نشر لكل منصة مختارة") && files.publish.includes("نوع النشر لكل منصة")],
  ["Server blocks incomplete publishing", files.marketing.includes("الكابشن غير موجود") && files.marketing.includes("الهاشتاج غير موجود") && files.marketing.includes("نوع النشر غير محدد")],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
