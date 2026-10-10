import fs from 'node:fs';

const portal = fs.readFileSync(new URL('../src/owners/OwnersPortalPage.tsx', import.meta.url), 'utf8');
const preview = fs.readFileSync(new URL('../src/owners/OwnersMemberPreviewPage.tsx', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('../src/owners/OwnersSettingsPanel.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const checks = [];
const add = (name, ok) => checks.push({ name, ok: Boolean(ok) });

add('public portal exposes the selected design on the root', portal.includes('data-portal-design={portalDesign}'));
add('admin member preview exposes the selected design on the root', preview.includes('data-portal-design={portalDesign}'));
add('public portal reloads design on focus or settings storage event', portal.includes('mzj-owners-portal-design-revision') && portal.includes('window.addEventListener("focus", refresh)'));
add('admin preview reloads design on focus or settings storage event', preview.includes('mzj-owners-portal-design-revision') && preview.includes('window.addEventListener("focus", refresh)'));
add('settings broadcasts design revision after successful save', settings.includes('localStorage.setItem("mzj-owners-portal-design-revision"'));
add('portal has one canonical design-aware hero', portal.includes('className="owners-club-hero"') && portal.includes('owners-club-hero-copy'));
add('design 1 uses the cinematic hero composition', styles.includes('.owners-club-design.design_1 .owners-club-hero{display:grid') && styles.includes('linear-gradient(125deg,#321b16'));
add('design 2 uses the wide member dashboard composition', styles.includes('.owners-club-design.design_2 .owners-club-hero{display:flex;flex-direction:column') && styles.includes('.owners-club-design.design_2 .owners-membership-shell{width:100%;aspect-ratio:auto'));
add('design 3 uses the soft journey composition', styles.includes('.owners-club-design.design_3 .owners-club-hero{display:grid') && styles.includes('border-radius:34px'));
add('all main club sections remain full width', styles.includes('.owners-club-design .owners-club-main-section') && styles.includes('width:100%'));

const homeStart = portal.indexOf('owners-points-list-section owners-club-main-section');
const home = homeStart >= 0 ? portal.slice(homeStart) : '';
const ordered = ['قائمة النقاط', 'owners-member-invite-card owners-club-main-section', '<OwnersDiscountCalculator', 'المكافآت المتاحة', 'سجل الحركة'];
let last = -1;
let orderOk = Boolean(home);
for (const label of ordered) {
  const index = home.indexOf(label, last + 1);
  if (index < 0 || index < last) { orderOk = false; break; }
  last = index;
}
add('public home keeps the requested section order', orderOk);

for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'}: ${check.name}`);
const passed = checks.filter((check) => check.ok).length;
console.log(`MZJ Club design render v95 checks: ${passed}/${checks.length} passed.`);
if (passed !== checks.length) process.exit(1);
