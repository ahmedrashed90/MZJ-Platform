import fs from 'node:fs';

const zoho = fs.readFileSync(new URL('../server/_zoho-workdrive.ts', import.meta.url), 'utf8');
const marketing = fs.readFileSync(new URL('../server/marketing/index.ts', import.meta.url), 'utf8');
const checks = [
  ['Zoho OAuth requests binary download permission', zoho.includes('"ZohoFiles.files.READ"')],
  ['Publishing uses the file metadata download URL', marketing.includes('const downloadUrl=clean(info.downloadUrl)')],
  ['Publishing follows Zoho download redirects', marketing.includes("redirect:'follow'")],
  ['Publishing validates actual image signatures', marketing.includes('function detectImageMime') && marketing.includes('ليس صورة فعلية صالحة للنشر')],
  ['Facebook still receives image bytes through multipart source', marketing.includes("form.append('source'")],
];
let passed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (ok) passed += 1;
}
console.log(`Zoho download scope checks: ${passed}/${checks.length} passed`);
if (passed !== checks.length) process.exit(1);
