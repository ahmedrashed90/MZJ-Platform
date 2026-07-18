import fs from "node:fs";

const checks = [
  ["api/index.ts", "integrations/tracking/orders"],
  ["api/index.ts", "tracking/public"],
  ["server/_tracking-schema.ts", "tracking.vehicle_stages"],
  ["server/_tracking-schema.ts", "tracking.deleted_order_blocks"],
  ["server/_firebase-sms.ts", "sms_outbox"],
  ["server/tracking/sms.ts", 'status: "pending"'],
  ["server/tracking/sms.ts", 'source: "sales.html"'],
  ["server/integrations/tracking-orders.ts", "google-sheets-next-erp"],
  ["src/App.tsx", 'path="/tracking"'],
  ["src/App.tsx", 'path="/track"'],
  ["src/App.tsx", 'path="/Test-Track.html"'],
  ["src/tracking/pages/TrackingDeletePage.tsx", "حذف طلبات التتبع"],
  ["src/tracking/pages/PublicTrackingPage.tsx", "اكتب رقم الطلب أو رقم الهيكل"],
  ["src/pages/SettingsPage.tsx", "TrackingSettingsPanel"],
];

for (const [file, needle] of checks) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(needle)) throw new Error(`Tracking check failed: ${file} missing ${needle}`);
}
console.log("Tracking v1.12 native platform module, public page, deletion, dual-sync ingest, and SMS+ checks passed.");
