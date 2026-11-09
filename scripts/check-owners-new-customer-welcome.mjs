import fs from "node:fs";

let passed = 0;
const checks = [];
function read(path) { return fs.readFileSync(path, "utf8"); }
function expect(name, condition) {
  checks.push({ name, condition: Boolean(condition) });
  if (condition) passed += 1;
  console.log(`${condition ? "PASS" : "FAIL"}: ${name}`);
}

const cash = read("server/crm/cash-qr.ts");
const welcome = read("server/_owners-welcome.ts");
const owners = read("server/owners.ts");
const page = read("src/owners/OwnersCommunityPage.tsx");
const schema = read("server/_owners-schema.ts");

expect("cash-register uses the shared new-customer welcome sender", cash.includes("queueLegacyOwnerWelcomeSms") && cash.includes('purpose: "cash_qr_registration"'));
expect("old code-only SMS was removed", !cash.includes("كود دعوتك في MZJ Owners Community:"));
expect("welcome text contains customer name, portal link, personal code and trust signature", welcome.includes("مرحباً : ${customerName}") && welcome.includes("يمكنك الدخول إلى حسابك ومتابعة نقاطك ومكافآتك من هنا:") && welcome.includes("الكود الشخصي : ${personalCode}") && welcome.includes("تاريخ تثق به"));
expect("new-customer welcome delivery is persisted", schema.includes("legacy_customer_codes add column if not exists welcome_sent_at") && schema.includes("table_name='legacy_customer_codes' and column_name='welcome_sent_at'"));
expect("admin API supports individual new-customer welcome", owners.includes('action === "send_legacy_welcome"') && owners.includes('purpose: "manual_new_customer_welcome"'));
expect("admin API supports bulk welcome by CRM status", owners.includes('action === "send_legacy_welcome_by_status"') && owners.includes("coalesce(l.status_label,'')=${statusLabel}"));
expect("new customers payload exposes welcome status", owners.includes("c.referral_code,c.welcome_sent_at,c.created_at"));
expect("new customers UI has a status filter", page.includes("legacyStatusFilter") && page.includes("كل الحالات"));
expect("new customers UI has individual welcome button", page.includes('action: "send_legacy_welcome"') && page.includes("إرسال الترحيب"));
expect("new customers UI has bulk welcome button", page.includes('action: "send_legacy_welcome_by_status"') && page.includes("sendLegacyWelcomeByStatus"));
expect("bulk send is disabled until a specific status is selected", page.includes("!legacyStatusFilter || legacyWelcomeEligibleCount === 0"));

console.log(`\nMZJ Owners new-customer welcome checks: ${passed}/${checks.length} passed.`);
if (passed !== checks.length) process.exit(1);
