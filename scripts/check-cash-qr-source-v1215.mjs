import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root,p),'utf8');
const cash = read('server/crm/cash-qr.ts');
const schema = read('server/_crm-schema.ts');
const serverUtils = read('server/_crm-utils.ts');
const clientSources = read('src/crm/sourceCatalog.ts');

const checks = [
  ['cash QR source code is qr', cash.includes('const QR_SOURCE_CODE = "qr";')],
  ['cash QR source label is QR', cash.includes('const QR_SOURCE_NAME = "QR";')],
  ['cash QR lead no longer writes branch as source', !cash.includes("${contact.id}::uuid,'branch',${QR_SOURCE_NAME}")],
  ['cash QR lead writes canonical source variables', cash.includes('${contact.id}::uuid,${QR_SOURCE_CODE},${QR_SOURCE_NAME}')],
  ['legacy CRM source catalog includes QR', schema.includes("('qr','QR',115)" )],
  ['canonical source catalog includes QR', schema.includes("('qr','QR',115,true,array['crm'],'whatsapp',false,'direct')")],
  ['existing cash QR leads are normalized', schema.includes("where platform_code='cash_qr'") && schema.includes("set source_code='qr',source_name='QR'")],
  ['server source labels map qr to QR', serverUtils.includes('qr: "QR", cash_qr: "QR"')],
  ['client source labels map qr to QR', clientSources.includes('qr: "QR"') && clientSources.includes('cash_qr: "QR"')],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
  if (!ok) failed++;
}
if (failed) process.exit(1);
console.log(`Cash QR source checks: ${checks.length}/${checks.length} passed`);
