import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const cash = read("server/crm/cash-qr.ts");
const segments = read("server/_owners-customer-segments.ts");
const welcome = read("server/_owners-welcome.ts");
const app = read("src/App.tsx");
const settings = read("src/owners/OwnersSettingsPanel.tsx");
const trackingUi = read("src/tracking/components/TrackingSettingsPanel.tsx");
const trackingSms = read("server/tracking/sms.ts");
const trackingTemplates = read("server/_tracking-message-templates.ts");

const checks = [
  ["owners schema is prepared before CRM transaction", cash.indexOf("await ensureOwnersSchema();") < cash.indexOf("const created = await sql.begin")],
  ["QR creates CRM and Club row in the same transaction", cash.includes("const created = await sql.begin") && cash.includes("insert into owners.legacy_customer_codes")],
  ["QR transaction returns both lead and customer code", cash.includes("return { lead, customerCode };")],
  ["QR fails transaction when Club code is missing", cash.includes('throw new Error("MZJ Club Community customer code was not created")')],
  ["QR no longer swallows Club code creation after CRM commit", !cash.includes("legacy customer code sync failed")],
  ["QR generates SD96 code before atomic insert", cash.includes("const preparedCustomerCode = await uniqueOwnerCode();")],
  ["QR customer code is explicitly typed text", cash.includes("${preparedCustomerCode}::text")],
  ["old failed cash_qr registrations are self-healed", cash.includes('clean(duplicate.platform_code) === "cash_qr"') && cash.includes("recovered: true")],
  ["self-heal still protects sold customers", cash.includes("clean(duplicate.status_label) !== SOLD_STATUS")],
  ["other duplicate CRM customers keep original protection", cash.includes('error: "رقم الجوال مسجل بالفعل"')],
  ["QR welcome is queued from the persisted Club code", cash.includes("queueRegistrationWelcome(created.customerCode)")],
  ["QR welcome still uses shared editable template sender", cash.includes("queueLegacyOwnerWelcomeSms") && cash.includes('purpose: "cash_qr_registration"')],
  ["QR customer portal remains /club", cash.includes('https://mzj-platform.vercel.app/club')],
  ["QR public route remains /cash-register", app.includes('path="/cash-register"')],
  ["legacy helper returns an existing code before generating a replacement", segments.includes("if (existing) return existing;")],
  ["legacy SD96 helper no longer uses parameterized SQL CASE", !segments.includes("case when ${options.sd96 === true}")],
  ["legacy SD96 helper explicitly types generated code", segments.includes("${sd96Code}::text")],
  ["welcome document id is explicitly typed in both update paths", (welcome.match(/\$\{queued\.documentId\}::text/g) || []).length >= 2],
  ["Club welcome template remains editable", settings.includes("welcomeMessageTemplate") && settings.includes("DEFAULT_WELCOME_MESSAGE_TEMPLATE")],
  ["stage 10 old/new message switch remains present", trackingUi.includes("الرسالة القديمة") && trackingUi.includes("الرسالة الجديدة")],
  ["stage 10 server chooses effective configured template", trackingSms.includes("effectiveTrackingSmsTemplate") && trackingTemplates.includes('normalizeTrackingSmsMessageMode(configuredMode) === "legacy"')],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS ${name}`);
  else { console.error(`FAIL ${name}`); failed += 1; }
}
if (failed) process.exit(1);
console.log(`PASS ${checks.length}/${checks.length}`);
