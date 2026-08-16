import fs from "node:fs";

const page = fs.readFileSync("src/marketing/pages/PublishPrepPage.tsx", "utf8");
const clientApi = fs.readFileSync("src/marketing/api.ts", "utf8");
const serverApi = fs.readFileSync("server/marketing/index.ts", "utf8");
const css = fs.readFileSync("src/marketing/marketing.css", "utf8");

const checks = [
  ["publish prep shows a dedicated final-file download button", page.includes("marketing-publish-download-files") && page.includes('"تحميل الملفات"') && page.includes('"تحميل الملف"')],
  ["multi-file button sends every final file ID without creating a ZIP", page.includes("downloadFinalFiles(finalFiles)") && page.includes("files.map((file) => String(file?.id") && !page.includes("JSZip")],
  ["client triggers separate browser downloads for each file", clientApi.includes("export function downloadMarketingFiles") && clientApi.includes("for (const fileId of ids)") && clientApi.includes("download: 1") && clientApi.includes("anchor.click()")],
  ["download endpoint switches Content-Disposition to attachment", serverApi.includes('const mode=forceDownload?"attachment":"inline"') && serverApi.includes("marketingFileDisposition(file.original_name,forceDownload)")],
  ["R2 downloads are proxied when attachment mode is requested", serverApi.includes('if(!forceDownload)return response.redirect(302,url)') && serverApi.includes('pipeMarketingFileResponse(response,upstream,file,true,"R2")')],
  ["download button has a dedicated visual style", css.includes(".marketing-publish-download-files")],
];

let passed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
  if (ok) passed += 1;
}
console.log(`Publish prep final download checks: ${passed}/${checks.length} passed`);
if (passed !== checks.length) process.exit(1);
