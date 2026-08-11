import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
const files = {
  schema: read("server/_marketing-schema.ts"),
  zoho: read("server/_zoho-workdrive.ts"),
  upload: read("server/_zoho-upload.ts"),
  storage: read("server/_media-storage.ts"),
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
const liveSource = [files.schema, files.zoho, files.upload, files.storage, files.route, files.marketing, files.client, files.modal, files.worker, files.env].join("\n");

const checks = [
  ["Zoho connection schema", files.schema.includes("marketing.zoho_workdrive_connection")],
  ["Ordered final media schema", files.schema.includes("marketing.final_media_groups") && files.schema.includes("order_index")],
  ["Final upload tickets remain database-backed", files.schema.includes("marketing.zoho_upload_tickets") && files.marketing.includes("commitFinalFileUpload") && files.marketing.includes("cancelFinalUpload")],
  ["Final upload no longer stores file chunks in PostgreSQL", !files.schema.includes("marketing.zoho_standard_upload_parts") && !files.marketing.includes("stageStandardFinalUploadPart") && !files.marketing.includes("readStandardFinalUploadParts")],
  ["OAuth start and callback", files.route.includes('action === "start"') && files.route.includes('action === "callback"')],
  ["Zoho route registered before generic integrations", files.api.indexOf('route.startsWith("integrations/zoho/")') < files.api.indexOf('route.startsWith("integrations/")')],
  ["Final upload prepares ordered files", files.marketing.includes("prepareFinalUpload") && files.marketing.includes("attachFinalMediaGroup")],
  ["Zoho filenames are collision-safe", files.marketing.includes("zohoFinalFileName") && files.marketing.includes("const zohoFileName=zohoFinalFileName")],
  ["Browser uploads each selected file as one whole PUT", files.client.includes('xhr.open("PUT", input.uploadUrl, true)') && files.client.includes("xhr.send(input.file)") && files.client.includes("uploadWholeFinalFileToZoho")],
  ["Browser final upload has no application chunk route", !files.client.includes("final_upload_chunk") && !files.marketing.includes("final_upload_chunk") && !files.client.includes("input.file.slice(")],
  ["Whole file is staged through the existing R2 presigned upload", files.marketing.includes("createUploadUrl(storageKey,7200)") && files.marketing.includes("category:'final-upload-staging'") && files.marketing.includes("'r2'")],
  ["Temporary whole-file object is removed after completion or cancellation", files.storage.includes("createDeleteUrl") && files.marketing.includes("deleteFinalUploadStaging")],
  ["Zoho strategy uses normal upload up to 250 MB and stream upload above it", files.upload.includes("ZOHO_STANDARD_UPLOAD_MAX_FILE_SIZE") && files.upload.includes('"standard" : "stream"') && files.schema.includes("('standard','stream')")],
  ["Standard Zoho upload streams one multipart file without reassembly", files.upload.includes("uploadStandardWholeFile") && files.upload.includes("prefixedStream(prefix, source, suffix)") && files.upload.includes("/workdrive/api/v1/upload") && !files.upload.includes("new Blob(")],
  ["Large Zoho upload streams one multipart file without application chunks", files.upload.includes("uploadLargeWholeFile") && files.upload.includes("/workdrive-api/v1/stream/upload") && files.upload.includes('"x-filename"') && files.upload.includes('"x-parent_id"') && files.upload.includes('body: prefixedStream(prefix, source, suffix)') && files.upload.includes('multipart/form-data; boundary=${boundary}')],
  ["Zoho chunk-session create/commit and Content-Range are removed", !files.upload.includes("uploadsession/create") && !files.upload.includes("uploadsession/commit") && !files.upload.includes("Content-Range")],
  ["Old chunk-only upload module remains absent", !exists("server/_zoho-chunk-upload.ts") && files.marketing.includes('from "../_zoho-upload.js"')],
  ["Final upload no longer serializes files as base64", !files.client.includes("readAsDataURL") && !files.client.includes("base64") && !files.marketing.includes("base64")],
  ["Upload progress, speed and ETA are reported", files.client.includes("xhr.upload.onprogress") && files.client.includes("speedBytesPerSecond") && files.client.includes("etaSeconds")],
  ["Upload can be cancelled", files.client.includes("currentRequest?.abort()") && files.client.includes("UploadCancelledError") && files.modal.includes("cancelFinalUpload")],
  ["Task details contain a visible upload panel", files.modal.includes("marketing-final-upload-dropzone") && files.modal.includes("اسحب الملفات هنا أو اضغط للاختيار") && files.css.includes(".marketing-final-upload-progress")],
  ["Multiple images keep their selection order", files.client.includes("file = input.files[upload.orderIndex]") && files.marketing.includes("orderIndex:item.orderIndex")],
  ["Old Zoho Worker staging flow stays removed", oldGatewayTokens.every((token) => !liveSource.includes(token))],
  ["Carousel server records remain ordered", files.marketing.includes("multipleImages") && files.instagram.includes('media_type: "CAROUSEL"') && files.instagram.includes("for (const file of files)")],
  ["Existing final button condition preserved", files.modal.includes('task.template_status !== "approved" || task.status === "completed"')],
  ["Campaign and agenda final files supported", files.marketing.includes("source_type") && files.marketing.includes("source_id")],
  ["RAW token compatibility retained", files.marketing.includes("MZJ_RAW_ALLOW_LEGACY_TOKEN") && files.marketing.includes("MZJ_RAW_SECRET_2026_CHANGE_ME")],
  ["Zoho environment documented without legacy gateway", files.env.includes("ZOHO_PUBLISH_ROOT_FOLDER_ID=efosi67f34a771f13446c8d01545192eb1829") && !files.env.includes("ZOHO_UPLOAD_GATEWAY_URL")],
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
