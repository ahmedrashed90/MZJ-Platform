import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const preview = read('src/owners/OwnersMemberPreviewPage.tsx');
const portal = read('src/owners/OwnersPortalPage.tsx');
const css = read('src/styles.css');

const header = '<div className="owners-movement-head"><span>التاريخ</span><span>البيان</span><span>النقاط</span></div>';
const legacyHeader = '<div className="owners-movement-head"><span>الحركة</span><span>التاريخ</span><span>عدد النقاط</span></div>';

const checks = [
  ['admin customer page uses date / statement / points header', preview.includes(header)],
  ['public customer page uses date / statement / points header', portal.includes(header)],
  ['legacy movement header removed from admin customer page', !preview.includes(legacyHeader)],
  ['legacy movement header removed from public customer page', !portal.includes(legacyHeader)],
  ['admin row renders date before statement', preview.indexOf('owners-movement-date') < preview.indexOf('owners-movement-main', preview.indexOf('owners-movement-head'))],
  ['public row renders date before statement', portal.indexOf('owners-movement-date') < portal.indexOf('owners-movement-main', portal.indexOf('owners-movement-head'))],
  ['desktop movement grid reserves middle column for statement', css.includes('grid-template-columns:minmax(160px,.55fr) minmax(0,1fr) minmax(110px,.35fr)')],
  ['mobile movement layout keeps statement and points on main row', css.includes('.owners-movement-table article>.owners-movement-main{grid-column:1;grid-row:1}') && css.includes('.owners-movement-table article>strong{grid-column:2;grid-row:1}')],
  ['mobile movement date stays visible on second row', css.includes('.owners-movement-table article>.owners-movement-date{grid-column:1/-1;grid-row:2')],
];

let passed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
  if (ok) passed += 1;
}
console.log(`Owners ledger columns v35 checks: ${passed}/${checks.length} passed`);
if (passed !== checks.length) process.exit(1);
