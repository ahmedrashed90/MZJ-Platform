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
  css: read("src/marketing/marketing.css"),
  publish: read("src/marketing/pages/PublishPrepPage.tsx"),
  env: read(".env.example"),
};

const checks = [
  ["Legacy Zoho schema remains for existing stored files", files.schema.includes("marketing.zoho_workdrive_connection") && files.marketing.includes("getZohoRuntime")],
  ["Google Drive connection schema exists", files.schema.includes("marketing.google_drive_connection") && files.schema.includes("marketing.google_drive_oauth_states")],
  ["Google Drive final upload tickets are database-backed", files.schema.includes("marketing.google_drive_upload_tickets") && files.marketing.includes("googleDriveTicketHash")],
  ["OAuth connect and callback are registered", files.api.includes('"google-drive/connect"') && files.api.includes('"google-drive/callback"') && files.driveRoute.includes('action === "connect"') && files.driveRoute.includes('action === "callback"')],
  ["OAuth uses drive.file only", files.drive.includes('https://www.googleapis.com/auth/drive.file') && !files.drive.includes('https://www.googleapis.com/auth/drive"')],
  ["First files upload to Google Drive", files.marketing.includes("category==='first-file'") && files.marketing.includes("storageProvider:'google-drive'")],
  ["Final files upload to Google Drive", files.marketing.includes("prepareFinalUpload") && files.marketing.includes("'google-drive'") && files.marketing.includes("createGoogleDriveResumableUpload")],
  ["New final upload no longer stages through R2", !files.marketing.includes("category:'final-upload-staging'") && !files.client.includes("uploadWholeFinalFileToZoho")],
  ["Browser uploads whole final file through resumable session", files.client.includes('xhr.open("PUT", input.uploadUrl, true)') && files.client.includes("xhr.send(input.file)") && files.client.includes("uploadWholeFinalFileToGoogleDrive")],
  ["Upload response is confirmed by Drive file ID", files.client.includes("externalId") && files.marketing.includes("verifyGoogleDriveUploadedFile")],
  ["First-file delete handles Google Drive", files.marketing.includes("deleteGoogleDriveFile")],
  ["Existing R2 and Zoho downloads remain compatible", files.marketing.includes("provider!=='zoho'") && files.marketing.includes("createDownloadUrl") && files.marketing.includes("getZohoFileInfo")],
  ["Google Drive downloads are private through backend", files.marketing.includes("openGoogleDriveFile")],
  ["Instagram image delivery supports Google Drive", files.imageDelivery.includes('storage_provider) === "google-drive"')],
  ["Instagram video publishing supports Google Drive", files.instagram.includes('storage_provider) === "google-drive"')],
  ["Facebook video publishing supports Google Drive", files.facebook.includes('storage_provider) === "google-drive"')],
  ["YouTube publishing supports Google Drive", files.youtube.includes('storage_provider) === "google-drive"')],
  ["Upload progress, speed and ETA are preserved", files.client.includes("xhr.upload.onprogress") && files.client.includes("speedBytesPerSecond") && files.client.includes("etaSeconds")],
  ["Upload cancellation is preserved", files.client.includes("currentRequest?.abort()") && files.client.includes("UploadCancelledError") && files.modal.includes("cancelFinalUpload")],
  ["Task details multi-file UI is unchanged", files.modal.includes("marketing-final-upload-dropzone") && files.css.includes(".marketing-final-upload-progress")],
  ["Multiple images keep selection order", files.client.includes("file = input.files[upload.orderIndex]") && files.marketing.includes("orderIndex:item.orderIndex")],
  ["Publish prep still recognizes media groups", files.publish.includes("final_file_count")],
  ["Google Drive environment variables are documented", files.env.includes("GOOGLE_DRIVE_CLIENT_ID=") && files.env.includes("GOOGLE_DRIVE_REDIRECT_URI=https://mzj-platform.vercel.app/api/google-drive/callback")],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
