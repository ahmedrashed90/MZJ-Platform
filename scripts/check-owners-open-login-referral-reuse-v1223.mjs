import fs from 'node:fs';

const schema = fs.readFileSync(new URL('../server/_owners-schema.ts', import.meta.url), 'utf8');
const core = fs.readFileSync(new URL('../server/_owners.ts', import.meta.url), 'utf8');
const publicApi = fs.readFileSync(new URL('../server/owners-public.ts', import.meta.url), 'utf8');
const portal = fs.readFileSync(new URL('../src/owners/OwnersPortalPage.tsx', import.meta.url), 'utf8');

const checks = [
  ['schema state is 1223', schema.includes('version=greatest(version,1223)') && schema.includes('>= 1223')],
  ['friend-code ledger exists', schema.includes('create table if not exists owners.friend_code_uses')],
  ['friend-code ledger is unique per referrer and buyer phone', schema.includes('unique(referrer_member_id,used_by_phone_normalized)')],
  ['historical friend-code uses are backfilled', schema.includes('insert into owners.friend_code_uses(') && schema.includes("coalesce(benefit.metadata->>'selfUse','false')='false'")],
  ['sessions support unsold/new-customer identity', schema.includes('legacy_customer_code_id uuid references owners.legacy_customer_codes') && schema.includes('owners_sessions_identity_check')],
  ['legacy Owners sessions can be created and read', core.includes('createLegacyOwnerSession') && core.includes('getLegacyOwnerSession')],
  ['cancelled orders release friend-code use', core.includes('delete from owners.friend_code_uses') && core.includes('friendCodesReleased')],
  ['OTP request accepts member or new-customer code record', publicApi.includes('const legacyCustomer = member ? null : await findLegacyCustomerCodeByPhone(phone);') && publicApi.includes('رقم الجوال غير مسجل في MZJ Owners Community')],
  ['OTP verification creates legacy session when no sold member exists', publicApi.includes('else await createLegacyOwnerSession(response, legacyCustomer!.id)')],
  ['new customer portal profile exposes membership, points and customer code', publicApi.includes('profileKind: "legacy"') && publicApi.includes('points: 0') && publicApi.includes('referralCode: legacyCustomer.referral_code')],
  ['new-customer code is restricted to new_customer context', publicApi.includes('useContext !== "new_customer"') && publicApi.includes('كود العميل الجديد صالح لصاحب الكود فقط')],
  ['friend-code lookup rejects same phone/code after previous order', publicApi.includes('where referrer_member_id=${referrer.id}::uuid') && publicApi.includes('used_by_phone_normalized=${phone}') && publicApi.includes('سبق استخدام كود دعوة هذا الصديق مع رقم الجوال')],
  ['both commerce confirm paths reserve the friend-code phone pair', (publicApi.match(/insert into owners\.friend_code_uses\(/g) || []).length >= 2],
  ['friend code cannot be used by its owner as friend referral', publicApi.includes('useContext === "friend" && selfUse')],
  ['public login copy no longer requires completed purchase', portal.includes('المسجل في MZJ Owners Community') && !portal.includes('المسجل في عملية الشراء')],
  ['new-customer portal hides unavailable invite controls', portal.includes('{member.inviteUrl ? (')],
];

let passed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
  if (ok) passed += 1;
}
console.log(`\nOwners open-login/referral-reuse checks: ${passed}/${checks.length} passed.`);
if (passed !== checks.length) process.exit(1);
