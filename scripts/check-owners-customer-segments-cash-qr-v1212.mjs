import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const exists=(file)=>fs.existsSync(path.join(root,file));
let passed=0, failed=0;
function expect(name,condition){if(condition){passed++;console.log(`PASS: ${name}`);}else{failed++;console.log(`FAIL: ${name}`);}}

const page=read('src/owners/OwnersCommunityPage.tsx');
const owners=read('server/owners.ts');
const segments=read('server/_owners-customer-segments.ts');
const core=read('server/_owners.ts');
const schema=read('server/_owners-schema.ts');
const qr=read('server/crm/cash-qr.ts');
const admin=read('src/crm/pages/CrmAdminPage.tsx');
const app=read('src/App.tsx');
const api=read('api/index.ts');
const perms=read('server/_api-permissions.ts');

const newLabel='\u0627\u0644\u0639\u0645\u0644\u0627\u0621 \u0627\u0644\u062c\u062f\u064a\u062f\u0629';
const oldLabel='\u0627\u0644\u0639\u0645\u0644\u0627\u0621 \u0627\u0644\u0642\u062f\u064a\u0645\u0629';
const sold='\u062a\u0645 \u0627\u0644\u0628\u064a\u0639';
const newStatus='\u0639\u0645\u064a\u0644 \u062c\u062f\u064a\u062f';
const cash='\u0643\u0627\u0634';
const cashSales='cash_sales';

expect('Owners page has new-customers tab',page.includes(newLabel));
expect('Owners page has old-customers tab',page.includes(oldLabel));
expect('old segment excludes sold CRM status',segments.includes("coalesce(l.status_label,'') <> ${SOLD_STATUS}") && segments.includes('const SOLD_STATUS'));
expect('old customers have stable referral codes',schema.includes('owners.legacy_customer_codes') && segments.includes("('L' || upper(substr(md5(l.id::text), 1, 9)))"));
expect('sold conversion retires old code',core.includes('markLegacyCustomerConvertedForLead') && segments.includes("status='converted'"));
expect('new owner code avoids collision with old codes',core.includes('legacyCodeConflict') && core.includes('owners.legacy_customer_codes where referral_code'));
expect('Owners API returns old segment',owners.includes('legacyCustomers') && owners.includes('legacy_customers'));
expect('CRM settings exposes QR section',admin.includes('cash_qr') && admin.includes('\u0625\u0646\u0634\u0627\u0621 QR \u0643\u0648\u062f'));
expect('public QR route exists',app.includes('/cash-register') && exists('src/crm/pages/CashQrRegistrationPage.tsx'));
expect('QR API is routed and public',api.includes('crm/cash-qr') && perms.includes('crm/cash-qr'));
expect('QR intake requires name and phone',qr.includes('customerName') && qr.includes('phoneRaw') && qr.includes('normalizePhone'));
expect('QR intake uses current cash assignment engine',qr.includes('chooseAssignment("cash", "", "branch")'));
expect('QR intake stores cash sales defaults',qr.includes(`'cash','${cashSales}'`) && qr.includes(`'${newStatus}','${cash}'`));
expect('QR intake stores registration and update timestamps',qr.includes('registered_at,created_at,updated_at') && qr.includes('now(),now(),now()'));
expect('QR intake immediately prepares old-customer code',qr.includes('ensureLegacyCustomerCodeForLead(created.id)'));
expect('QR asset exists',exists('public/cash-register-qr.svg'));
expect('no release patch or migration file added',!fs.readdirSync(path.join(root,'migration-packages')).some((name)=>/1212|cash.?qr|legacy.?customer/i.test(name)));

console.log(`\nFocused Owners/CRM QR checks: ${passed}/${passed+failed} passed.`);
process.exit(failed?1:0);
