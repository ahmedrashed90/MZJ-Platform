import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const publisher = read("server/_instagram-publisher.ts");
const marketingApi = read("server/marketing/index.ts");
const imageDelivery = read("server/_instagram-media-delivery.ts");
const imageHandler = read("server/marketing/instagram-media.ts");
const apiRouter = read("api/index.ts");
const apiPermissions = read("server/_api-permissions.ts");

const checks = [
  ["Instagram publishing is centralized in one service", marketingApi.includes('import { publishInstagramContent } from "../_instagram-publisher.js"') && marketingApi.includes("result=await publishInstagramContent(sql")],
  ["the old direct video_url Reel flow is removed", !marketingApi.includes("{caption,video_url:mediaUrl,media_type:'REELS'")],
  ["video containers start a resumable upload session", publisher.includes('upload_type: "resumable"') && publisher.includes('media_type: input.mediaType')],
  ["Zoho/R2 video bytes are uploaded directly to Meta", publisher.includes("openVideoUploadSource") && publisher.includes("rupload.facebook.com/ig-api-upload") && publisher.includes('offset: "0"') && publisher.includes("file_size: String(source.contentLength)")],
  ["container readiness is checked before media_publish", publisher.includes("waitForContainer") && publisher.includes('fields: "status_code,status"') && publisher.indexOf("waitForContainer(containerId") < publisher.indexOf("media_publish")],
  ["processing ERROR and EXPIRED states stop publishing", publisher.includes('statusCode === "ERROR"') && publisher.includes('statusCode === "EXPIRED"')],
  ["Media ID race is retried only after readiness", publisher.includes("isMediaNotReady") && publisher.includes("attempt <= 3") && publisher.includes("await waitForContainer(containerId, token, label)")],
  ["Instagram image publishing uses the signed platform delivery route", publisher.includes('createInstagramImageDeliveryUrl') && !publisher.includes('input.resolvePublicUrl') && !marketingApi.includes('resolvePublicUrl:(mediaFile:any)=>finalMediaDeliveryUrl')],
  ["Instagram image URLs are signed and short-lived", imageDelivery.includes('createHmac("sha256"') && imageDelivery.includes('timingSafeEqual') && imageDelivery.includes('expiresAt') && imageDelivery.includes('/api/marketing/instagram-media')],
  ["the public image route fetches protected Zoho bytes with OAuth", imageDelivery.includes('Authorization: `Zoho-oauthtoken ${runtime.accessToken}`') && imageDelivery.includes('loadInstagramImage') && imageHandler.includes('verifyInstagramImageDeliveryQuery')],
  ["the public image route is registered without changing the marketing endpoint", apiRouter.includes('import instagramMediaHandler from "../server/marketing/instagram-media.js"') && apiRouter.includes('["marketing/instagram-media", instagramMediaHandler]') && apiPermissions.includes('if (route === "marketing/instagram-media") return null;')],
  ["Instagram Stories can publish ordered batches of images", publisher.includes("for (let index = 0; index < files.length; index += 1)") && publisher.includes("stories.push(await publishImageStory") && !marketingApi.includes("الستوري يجب أن يحتوي على ملف واحد فقط")],
  ["Facebook Stories can publish ordered batches of images", marketingApi.includes("for(const storyFile of files)") && marketingApi.includes("batchCount:stories.length")],
  ["Instagram carousels remain ordered and capped at ten images", publisher.includes("files.length > 10") && publisher.includes("for (const file of files)") && publisher.includes("children.map((item) => item.creationId).join")],
];

let passed = 0;
for (const [label, condition] of checks) {
  console.log(`${condition ? "PASS" : "FAIL"}: ${label}`);
  if (condition) passed += 1;
}
console.log(`Instagram resumable publishing checks: ${passed}/${checks.length} passed`);
if (passed !== checks.length) process.exit(1);
