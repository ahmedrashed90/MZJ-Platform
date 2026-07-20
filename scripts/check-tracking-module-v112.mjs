import fs from "node:fs";

const checks = [
  ["api/index.ts", "integrations/tracking/orders"],
  ["api/index.ts", "tracking/public"],
  ["server/_tracking-schema.ts", "tracking.vehicle_stages"],
  ["server/_tracking-schema.ts", "tracking.deleted_source_identities"],
  ["server/_firebase-sms.ts", "sms_outbox"],
  ["server/tracking/sms.ts", 'status: "pending"'],
  ["server/tracking/sms.ts", 'source: "sales.html"'],
  ["server/integrations/tracking-orders.ts", "google-sheets-next-erp"],
  ["server/integrations/tracking-orders.ts", "sourceFingerprint"],
  ["server/tracking/delete.ts", "delete from tracking.orders"],
  ["server/tracking/delete.ts", "tracking.deleted_source_identities"],
  ["src/App.tsx", 'path="/tracking"'],
  ["src/App.tsx", 'path="/track"'],
  ["src/App.tsx", 'path="/Test-Track.html"'],
  ["src/tracking/pages/TrackingOrdersPage.tsx", "مسح طلب التراكينج"],
  ["src/tracking/pages/TrackingOrdersPage.tsx", "OperationsModal"],
  ["src/tracking/pages/TrackingDeletePage.tsx", "سجل حذف طلبات التراكينج"],
  ["src/tracking/pages/PublicTrackingPage.tsx", "اكتب رقم الطلب أو رقم الهيكل"],
  ["src/pages/SettingsPage.tsx", "TrackingSettingsPanel"],
  ["src/App.tsx", 'path="archive"'],
  ["src/tracking/TrackingLayout.tsx", "أرشيف الطلبات"],
  ["server/tracking/orders.ts", 'action === "archive_order"'],
  ["server/tracking/orders.ts", "زر الأرشفة يتاح بعد اكتمال المراحل العشر لجميع سيارات الطلب"],
  ["server/_tracking-schema.ts", "archive_initial_tracking_history_except_active_7_v1"],
  ["src/tracking/pages/TrackingOrdersPage.tsx", "أرشفة الطلب"],
  ["src/tracking/pages/PublicTrackingPage.tsx", "الطلب منتهي"],
];

for (const [file, needle] of checks) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(needle)) throw new Error(`Tracking check failed: ${file} missing ${needle}`);
}

const ingest = fs.readFileSync("server/integrations/tracking-orders.ts", "utf8");
if (ingest.includes("deleted_order_blocks")) throw new Error("Tracking ingest must not permanently block a reused business order number");
console.log("Tracking native platform module, source-identity deletion, archive flow, public page, dual-sync ingest, and SMS+ checks passed.");
