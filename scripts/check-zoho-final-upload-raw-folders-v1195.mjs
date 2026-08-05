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
  instagram: read("server/_instagram-publisher.ts"),
  client: read("src/marketing/api.ts"),
  modal: read("src/marketing/components/TaskDetailModal.tsx"),
  css: read("src/marketing/marketing.css"),
  publish: read("src/marketing/pages/PublishPrepPage.tsx"),
  connections: read("src/marketing/pages/PlatformConnectionsPage.tsx"),
  worker: read("gateway-worker/src/index.js"),
  env: read(".env.example"),
};

const oldGatewayTokens = ["partUploadUrl", "handleZohoUploadPart", "handleZohoUploadFinalize", "ZOHO_UPLOAD_STAGING", "ZOHO_UPLOAD_GATEWAY_URL", "createZohoMediaUrl", "zoho_media_tickets"];
const liveSource = [files.schema, files.zoho, files.route, files.marketing, files.client, files.modal, files.worker, files.env].join("\n");

const checks = [
  ["Zoho connection schema", files.schema.includes("marketing.zoho_workdrive_connection")],
  ["Ordered final media schema", files.schema.includes("marketing.final_media_groups") && files.schema.includes("order_index")],
  ["Platform proxy upload sessions are database-backed", files.schema.includes("marketing.zoho_upload_tickets") && files.marketing.includes("uploadFinalFileProxy") && files.marketing.includes("cancelFinalUpload")],
  ["OAuth start and callback", files.route.includes('action === "start"') && files.route.includes('action === "callback"')],
  ["Zoho route registered before generic integrations", files.api.indexOf('route.startsWith("integrations/zoho/")') < files.api.indexOf('route.startsWith("integrations/")')],
  ["Final upload prepares ordered files", files.marketing.includes("prepareFinalUpload") && files.marketing.includes("attachFinalMediaGroup")],
  ["Zoho filenames are collision-safe", files.marketing.includes("zohoFinalFileName") && files.marketing.includes("const zohoFileName=zohoFinalFileName")],
  ["Browser uploads through the platform API", files.client.includes("new XMLHttpRequest()") && files.client.includes("upload_final_file_proxy") && files.client.includes("/api/marketing") && !files.client.includes("/workdrive/api/v1/upload")],
  ["Upload progress, speed and ETA are reported", files.client.includes("xhr.upload.onprogress") && files.client.includes("speedBytesPerSecond") && files.client.includes("etaSeconds")],
  ["Upload can be cancelled", files.client.includes("currentRequest?.abort()") && files.client.includes("UploadCancelledError") && files.modal.includes("cancelFinalUpload")],
  ["Task details contain a visible upload panel", files.modal.includes("marketing-final-upload-dropzone") && files.modal.includes("اسحب الملفات هنا أو اضغط للاختيار") && files.css.includes(".marketing-final-upload-progress")],
  ["Multiple images keep their selection order", files.client.includes("file = input.files[upload.orderIndex]") && files.marketing.includes("orderIndex:item.orderIndex")],
  ["Old Zoho Worker and R2 upload path removed", oldGatewayTokens.every((token) => !liveSource.includes(token))],
  ["Carousel server records remain ordered", files.marketing.includes("order by order_index,created_at,id") && files.instagram.includes("media_type: \"CAROUSEL\"") && files.instagram.includes("childCreates.map((child) => child.creationId).join(\",\")")],
  ["Existing final button condition preserved", files.modal.includes('task.template_status !== "approved" || task.status === "completed"')],
  ["Campaign and agenda final files supported", files.marketing.includes("source_type") && files.marketing.includes("source_id")],
  ["RAW token compatibility retained", files.marketing.includes("MZJ_RAW_ALLOW_LEGACY_TOKEN") && files.marketing.includes("MZJ_RAW_SECRET_2026_CHANGE_ME")],
  ["Zoho environment documented without gateway", files.env.includes("ZOHO_PUBLISH_ROOT_FOLDER_ID=efosi67f34a771f13446c8d01545192eb1829") && !files.env.includes("ZOHO_UPLOAD_GATEWAY_URL")],
  ["Zoho connection UI", files.connections.includes("Zoho WorkDrive") && files.connections.includes("/api/integrations/zoho/start") && files.connections.includes("رفع من المنصة")],
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
