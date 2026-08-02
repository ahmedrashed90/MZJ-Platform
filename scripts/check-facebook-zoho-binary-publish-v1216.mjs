import fs from "node:fs";

const marketingApi = fs.readFileSync("server/marketing/index.ts", "utf8");

const facebookBlock = marketingApi.split("if(schedule.platform_code==='facebook')")[1]?.split("}else if(schedule.platform_code==='instagram')")[0] || "";
const checks = [
  ["Zoho image content is downloaded from the Saudi binary download endpoint", marketingApi.includes("/v1/workdrive/download/${encodeURIComponent(externalId)}") && marketingApi.includes("Authorization:`Zoho-oauthtoken ${runtime.accessToken}`")],
  ["Facebook photo upload uses multipart source instead of a Zoho URL", marketingApi.includes("async function graphFileRequest") && marketingApi.includes("form.append('source'") && facebookBlock.includes("graphFileRequest(`/${pageId}/photos`")],
  ["single Facebook image is uploaded as binary", facebookBlock.includes("const binary=await finalMediaBinary(sql,file)") && facebookBlock.includes("{caption,published:true}")],
  ["Facebook carousel uploads every ordered image as binary", facebookBlock.includes("for(const imageFile of files)") && facebookBlock.includes("{published:false}") && facebookBlock.includes("attached_media")],
  ["Facebook image branches no longer send the private Zoho URL", !facebookBlock.includes("{url:mediaUrl") && !facebookBlock.includes("for(const url of mediaUrls)")],
  ["Instagram publishing flow remains separate", marketingApi.includes("const mediaUrls=[]") && marketingApi.includes("image_url:url") && marketingApi.includes("media_publish")],
];

let passed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
  if (ok) passed += 1;
}
console.log(`Facebook Zoho binary publish checks: ${passed}/${checks.length} passed`);
if (passed !== checks.length) process.exit(1);
