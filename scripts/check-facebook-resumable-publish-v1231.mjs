import fs from "node:fs";

const publisher = fs.readFileSync("server/_facebook-video-publisher.ts", "utf8");
const marketingApi = fs.readFileSync("server/marketing/index.ts", "utf8");

const facebookBlock = marketingApi.split("if(schedule.platform_code==='facebook')")[1]?.split("}else if(schedule.platform_code==='instagram')")[0] || "";
const checks = [
  ["Facebook Reel/Story video publishing is isolated in one publisher service", marketingApi.includes('import { publishFacebookReel, publishFacebookVideoStory } from "../_facebook-video-publisher.js"')],
  ["Reel no longer sends a protected Zoho/R2 URL to Meta", facebookBlock.includes("publishFacebookReel(sql,{pageId,token,file,caption})") && !facebookBlock.includes("publishFacebookReel(pageId,token,await finalMediaDeliveryUrl")],
  ["video Story no longer sends file_url to the rupload endpoint", facebookBlock.includes("publishFacebookVideoStory(sql,{pageId,token,file})") && !facebookBlock.includes("uploadFacebookHostedVideo")],
  ["publisher downloads protected Zoho bytes with OAuth", publisher.includes('Authorization: `Zoho-oauthtoken ${runtime.accessToken}`') && publisher.includes("/v1/workdrive/download/${encodeURIComponent(externalId)}")],
  ["publisher uploads binary bytes to the Meta upload_url", publisher.includes('offset: "0"') && publisher.includes("file_size: String(source.contentLength)") && publisher.includes('"Content-Type": "application/octet-stream"') && publisher.includes("body: source.body")],
  ["hosted file_url mode is not used by the Facebook binary publisher", !publisher.includes("file_url")],
  ["Meta 422 details are preserved for publish logs and UI", publisher.includes("error_subcode") && publisher.includes("fbtrace_id") && publisher.includes("debug_info?.type") && publisher.includes("HTTP ${status}")],
  ["successful results identify the direct binary upload mode", publisher.includes('uploadMode: "resumable_binary"')],
];

let passed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
  if (ok) passed += 1;
}
console.log(`Facebook resumable publish checks: ${passed}/${checks.length} passed`);
if (passed !== checks.length) process.exit(1);
