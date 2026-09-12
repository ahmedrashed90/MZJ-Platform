import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const files = {
  schema: read("server/_marketing-schema.ts"),
  drive: read("server/_google-drive-storage.ts"),
  driveRoute: read("server/integrations/google-drive.ts"),
  api: read("api/index.ts"),
  marketing: read("server/marketing/index.ts"),
  instagram: read("server/_instagram-publisher.ts"),
  facebook: read("server/_facebook-video-publisher.ts"),
  youtube: read("server/_youtube-publisher.ts"),
  imageDelivery: read("server/_instagram-media-delivery.ts"),
  client: read("src/marketing/api.ts"),
  modal: read("src/marketing/components/TaskDetailModal.tsx"),
  executionFolders: read("src/marketing/executionFolders.ts"),
  css: read("src/marketing/marketing.css"),
  publish: read("src/marketing/pages/PublishPrepPage.tsx"),
  campaign: read("src/marketing/pages/CreateCampaignPage.tsx"),
  agenda: read("src/marketing/pages/CreateAgendaPage.tsx"),
  env: read(".env.example"),
};

const checks = [
  ["Legacy Zoho schema remains for existing stored files", files.schema.includes("marketing.zoho_workdrive_connection") && files.marketing.includes("getZohoRuntime")],
  ["Google Drive connection schema exists", files.schema.includes("marketing.google_drive_connection") && files.schema.includes("marketing.google_drive_oauth_states")],
  ["Google Drive upload tickets are database-backed", files.schema.includes("marketing.google_drive_upload_tickets") && files.marketing.includes("googleDriveTicketHash")],
  ["OAuth connect and callback are registered", files.api.includes('"google-drive/connect"') && files.api.includes('"google-drive/callback"') && files.driveRoute.includes('action === "connect"') && files.driveRoute.includes('action === "callback"')],
  ["OAuth uses drive.file only", files.drive.includes('https://www.googleapis.com/auth/drive.file') && !files.drive.includes('https://www.googleapis.com/auth/drive"')],
  ["First files upload to Google Drive", files.marketing.includes("category==='first-file'") && files.marketing.includes("storageProvider:'google-drive'")],
  ["Final files upload to Google Drive", files.marketing.includes("prepareFinalUpload") && files.marketing.includes("createGoogleDriveResumableUpload")],
  ["New first/final uploads no longer stage through R2", !files.marketing.includes("category:'final-upload-staging'") && !files.client.includes("uploadWholeFinalFileToZoho")],
  ["Browser PUT uses XMLHttpRequest for progress", files.client.includes('xhr.open("PUT", input.uploadUrl, true)') && files.client.includes("xhr.upload.onprogress") && files.client.includes("xhr.send(input.file)")],
  ["First-file progress, speed and ETA are visible", files.modal.includes("firstUploadPercent") && files.modal.includes("activeFirstUploadFile") && files.modal.includes("speedBytesPerSecond") && files.modal.includes("formatUploadEta")],
  ["First-file cancel aborts request and cleans pending record", files.modal.includes("cancelFirstUpload") && files.client.includes('action: "cancel_file_upload"') && files.marketing.includes("async function cancelFileUpload")],
  ["Final-file progress and cancel remain", files.modal.includes("cancelFinalUpload") && files.client.includes("cancel_final_upload") && files.client.includes("UploadCancelledError")],
  ["Drive confirmation can recover file ID server-side", files.drive.includes("findGoogleDriveUploadedFile") && files.marketing.includes("externalId:externalId||undefined") && files.marketing.includes("resolvedExternalId")],
  ["First file becomes ready after Drive verification", files.marketing.includes("set status='ready',external_id=${resolvedExternalId}") && files.marketing.includes("where id=${fileId}::uuid and status='uploading'")],
  ["First-file delete handles Google Drive", files.marketing.includes("deleteGoogleDriveFile") && files.marketing.includes("category='first-file'")],
  ["Existing R2 and Zoho downloads remain compatible", files.marketing.includes("provider!=='zoho'") && files.marketing.includes("createDownloadUrl") && files.marketing.includes("getZohoFileInfo")],
  ["Google Drive downloads stay private through backend", files.marketing.includes("openGoogleDriveFile")],
  ["Campaign raw-folder button still calls platform API", files.campaign.includes('action: "create_raw_folders"') && files.campaign.includes("إنشاء فولدرات الخام")],
  ["Agenda raw-folder button still calls platform API", files.agenda.includes('action: "create_raw_folders"') && files.agenda.includes("إنشاء فولدرات الخام")],
  ["Raw/delivery folder hierarchy is created on Google Drive", files.marketing.includes('name:"01-RAW"') && files.marketing.includes('name:"02-OUTPUT"') && files.marketing.includes('mzjKind:"user-output"')],
  ["Folder creation is idempotent under MZJ root", files.drive.includes("ensureGoogleDriveFolder") && files.drive.includes("runtime.rootFolderId") && files.drive.includes("trashed=false and name=")],
  ["Drive folder IDs and URLs survive frontend compaction", files.executionFolders.includes("rawFolderId") && files.executionFolders.includes("outputFolderId") && files.executionFolders.includes("campaignFolderId") && files.executionFolders.includes("outputFolderUrl")],
  ["Task stores Drive raw and user delivery folders", files.marketing.includes('type: "google_drive"') && files.marketing.includes("userOutputFolderId") && files.marketing.includes("rawFolderUrl")],
  ["Task folder buttons accept Drive URLs without Windows paths", files.modal.includes('folders.type === "google_drive"') && files.modal.includes("drive.google.com/drive/folders") && files.modal.includes("openExecutionFolder")],
  ["New task uploads use its Drive delivery folder", files.marketing.includes("googleDriveTaskUploadParent") && files.marketing.includes("parentFolderId:driveParentFolderId||undefined")],
  ["Requested old notes are removed", !files.modal.includes("نسخ العمل الأولية للمراجعة قبل الملف النهائي") && !files.modal.includes("يرفع من داخل المنصة إلى Zoho WorkDrive")],
  ["Upload status names Google Drive", files.modal.includes("رفع الملفات إلى Google Drive") && !files.modal.includes("رفع الملفات إلى Zoho")],
  ["Instagram image delivery supports Google Drive", files.imageDelivery.includes('storage_provider) === "google-drive"')],
  ["Instagram video publishing supports Google Drive", files.instagram.includes('storage_provider) === "google-drive"')],
  ["Facebook video publishing supports Google Drive", files.facebook.includes('storage_provider) === "google-drive"')],
  ["YouTube publishing supports Google Drive", files.youtube.includes('storage_provider) === "google-drive"')],
  ["Task details keep existing upload CSS", files.modal.includes("marketing-final-upload-dropzone") && files.css.includes(".marketing-final-upload-progress")],
  ["Multiple final images keep selection order", files.client.includes("file = input.files[upload.orderIndex]") && files.marketing.includes("orderIndex:item.orderIndex")],
  ["Publish prep still recognizes media groups", files.publish.includes("final_file_count")],
  ["Google Drive environment variables are documented", files.env.includes("GOOGLE_DRIVE_CLIENT_ID=") && files.env.includes("GOOGLE_DRIVE_REDIRECT_URI=https://mzj-platform.vercel.app/api/google-drive/callback")],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
