import fs from "node:fs";

const portal = fs.readFileSync("src/owners/OwnersPortalPage.tsx", "utf8");
const preview = fs.readFileSync("src/owners/OwnersMemberPreviewPage.tsx", "utf8");
const css = fs.readFileSync("src/styles.css", "utf8");
const desc = "ارسل كود الدعوة الى أصدقائك وأستفد من هدايا النقاط وأجعلهم يستفيدوا من الخصم";
const checks = [
  [portal.includes(desc), "public page has exact invite description"],
  [preview.includes(desc), "admin preview has exact invite description"],
  [portal.includes('className="owners-invite-description-alert"'), "public description uses alert class"],
  [css.includes('.owners-invite-description-alert') && css.includes('color:#b42318'), "description is red and distinctive"],
  [portal.includes('<span>كود الدعوة</span>') && portal.includes('{member.referralCode || "—"}'), "invite code is displayed separately"],
  [portal.includes('value={member.inviteUrl || ""}') && portal.includes('نسخ الرابط'), "full coded invite link can be copied"],
  [portal.includes('WhatsappLogo') && portal.includes('> إرسال</a>'), "invite can be sent"],
  [portal.indexOf('owners-points-list-section') < portal.indexOf('owners-member-invite-card') && portal.indexOf('owners-member-invite-card') < portal.indexOf('<OwnersDiscountCalculator'), "invite block sits directly after points list"],
  [preview.indexOf('owners-points-list-section') < preview.indexOf('owners-member-invite-card') && preview.indexOf('owners-member-invite-card') < preview.indexOf('<OwnersDiscountCalculator'), "preview mirrors invite placement"],
  [(preview.match(/owners-admin-invite-card/g) || []).length === 1, "preview has one invite block only"],
];
let passed=0;
for (const [ok,label] of checks) {
  if (ok) { passed++; console.log(`PASS ${label}`); }
  else console.error(`FAIL ${label}`);
}
console.log(`${passed}/${checks.length} passed`);
if (passed !== checks.length) process.exit(1);
