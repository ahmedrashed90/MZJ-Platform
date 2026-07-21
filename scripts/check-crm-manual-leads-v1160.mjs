import fs from "node:fs";

const page = fs.readFileSync("src/crm/pages/CrmManualLeadsPage.tsx", "utf8");
const api = fs.readFileSync("server/crm/manual-leads.ts", "utf8");
const tracking = fs.readFileSync("src/tracking/TrackingLayout.tsx", "utf8");
const settings = fs.readFileSync("src/pages/SettingsPage.tsx", "utf8");
const meta = fs.readFileSync("server/meta.ts", "utf8");

const checks = [
  ["Manual lead form hides payment selector", !page.includes("<span>الدفع</span><select")],
  ["Manual lead form hides branch selector", !page.includes("<span>الفرع</span><select")],
  ["Manual lead form hides registration date input", !page.includes("<span>تاريخ تسجيل العميل</span>")],
  ["Manual lead form hides automatic assignment controls", !page.includes("<span>المندوب المسؤول</span><select") && !page.includes("<span>الكول سنتر</span><select")],
  ["Manual lead WhatsApp-only note is removed", !page.includes("العميل اليدوي يتم التواصل معه عن طريق واتساب بالقوالب فقط")],
  ["New manual leads belong to the logged-in salesperson", api.includes("const assignedTo = user.id") && api.includes("manualLeadOwnerContext")],
  ["New manual leads do not call automatic distribution", !api.includes("chooseAssignment") && !api.includes("chooseCallCenterAssignment")],
  ["Registration date is generated automatically", api.includes("registered_at,location") && api.includes("${clean(body.financeType) || null},now()")],
  ["Tracking navigation no longer duplicates settings", !tracking.includes("/settings?section=tracking") && !tracking.includes("إعدادات التتبع")],
  ["Tracking settings remain in unified settings", settings.includes("TrackingSettingsPanel") && settings.includes("إعدادات التتبع")],
  ["Role choices are deduplicated", meta.includes("distinct on (lower(trim(name)))") && settings.includes("visibleRoles")],
];

let failed = false;
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
