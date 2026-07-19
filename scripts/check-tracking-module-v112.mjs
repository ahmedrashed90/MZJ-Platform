import fs from "node:fs";

const checks = [
  ["api/index.ts", "integrations/tracking/orders"],
  ["api/index.ts", "tracking/public"],
  ["server/_tracking-schema.ts", "tracking.vehicle_stages"],
  ["server/_firebase-sms.ts", "sms_outbox"],
  ["server/tracking/sms.ts", 'status: "pending"'],
  ["server/tracking/sms.ts", 'source: "sales.html"'],
  ["server/integrations/tracking-orders.ts", "google-sheets-next-erp"],
  ["server/integrations/tracking-orders.ts", "sourceAlreadyDeleted"],
  ["server/integrations/tracking-orders.ts", "source_key"],
  ["server/tracking/delete.ts", 'tracking.orders.delete'],
  ["server/tracking/delete.ts", "تم مسح طلب التراكينج وفك ارتباط السيارات من المخزون بنجاح"],
  ["server/_operations-schema.ts", "operations_vehicle_id"],
  ["src/App.tsx", 'path="/tracking"'],
  ["src/App.tsx", 'path="/track"'],
  ["src/App.tsx", 'path="/Test-Track.html"'],
  ["src/tracking/pages/TrackingOrdersPage.tsx", "مسح طلب التراكينج"],
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
if (ingest.includes("deleted_order_blocks")) throw new Error("Tracking ingest must not permanently block deleted order numbers.");
if (ingest.includes("on conflict (sales_order_no)")) throw new Error("Tracking ingest must not use sales_order_no as the idempotency identity.");
if (fs.existsSync("src/tracking/pages/TrackingDeletePage.tsx")) throw new Error("Legacy standalone tracking deletion page must not exist.");

console.log("Tracking native module, archive flow, in-details safe deletion, source-identity ingest, public page, and SMS+ checks passed.");
