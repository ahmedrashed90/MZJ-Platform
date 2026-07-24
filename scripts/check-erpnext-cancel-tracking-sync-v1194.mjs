import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const checks = [];
const expect = (label, condition) => checks.push([label, Boolean(condition)]);
const contains = (file, ...tokens) => {
  const text = read(file);
  return tokens.every((token) => text.includes(token));
};

expect("Package version is 1.19.5", JSON.parse(read("package.json")).version === "1.19.5");
expect("ERPNext instance identity includes creation", contains("server/_erpnext-sales-order-normalizer.ts", "sourceInstanceKey", "created:${erpCreatedAt}", "isCancellation"));
expect("ERPNext cancel route uses the unified endpoint", contains("server/integrations/erpnext-sales-order.ts", "normalized.isCancellation", "cancelErpNextSalesOrder"));
expect("Cancellation is idempotent", contains("server/_erpnext-sales-order-sync.ts", "alreadyCancelled", "ERP_CANCEL_ORDER_NOT_FOUND"));
expect("Cancelled tracking orders are preserved", contains("server/_erpnext-sales-order-sync.ts", "is_cancelled=true", "cancellation_source='next_erp'"));
expect("Operations returns only eligible under-delivery vehicles", contains("server/_erpnext-sales-order-sync.ts", "status_code='available_for_sale'", "OPERATIONS_NEWER_SALES_ORDER_PRESERVED", "OPERATIONS_CANCEL_REVIEW_REQUIRED"));
expect("Approval cycles close with cancelled event", contains("server/_erpnext-sales-order-sync.ts", "'all','cancelled'", "is_active=false"));
expect("CRM previous state is stored and restored", contains("server/_erpnext-sales-order-sync.ts", "crm_previous_state", "restored_previous_state", "erpnext_sales_order_cancelled"));
expect("Multiple CRM sales orders inherit the original pre-sale state", contains("server/_erpnext-sales-order-sync.ts", "originIntegrationState", "inheritedPreviousState", "historicalOrigin"));
expect("Tracking stage action updates all order vehicles", contains("server/tracking/orders.ts", "from tracking.order_vehicles ov", "ov.order_id=${row.order_id}::uuid", "لجميع سيارات الطلب"));
expect("SMS sent state is persisted per order stage", contains("server/tracking/orders.ts", "tracking.sms_messages", "sm.order_id=${id}::uuid", "as sms_sent"));
expect("SMS button has persistent green state", contains("src/tracking/pages/TrackingOrdersPage.tsx", "stage.sms_sent ? \"sent\"", "تم إرسال SMS+ لهذه المرحلة") && contains("src/styles.css", ".tracking-stage-actions button.sms.sent", "#218c5a"));
expect("Cancelled tracking actions are blocked", contains("server/tracking/orders.ts", "طلب البيع ملغي من NEXT ERP ولا يمكن تعديل مراحله") && contains("server/tracking/sms.ts", "طلب البيع ملغي من NEXT ERP ولا يمكن إرسال SMS+ له"));
expect("Operations active tracking excludes cancelled orders", contains("server/operations/index.ts", "coalesce(o.is_cancelled,false)=false"));
expect("Vehicle sales-order tab includes cancellation history", contains("server/operations/index.ts", "so.is_cancelled", "so.cancelled_at", "so.cancellation_reason") && contains("src/operations/components/VehicleDetailModal.tsx", "ملغي من NEXT ERP", "لا يوجد طلب بيع نشط مرتبط بهذه السيارة"));
expect("Public tracking shows cancellation instead of continuing the live flow", contains("server/tracking/public.ts", "is_cancelled: order.is_cancelled") && contains("src/tracking/pages/PublicTrackingPage.tsx", "تم إلغاء طلب البيع", "order.is_cancelled"));
expect("Runtime schemas include cancellation columns", contains("server/_tracking-schema.ts", "cancellation_reason", "source_instance_key", "erp_created_at") && contains("server/_erpnext-integration-schema.ts", "crm_previous_state", "is_cancelled", "cancelled_at"));
expect("Approval action constraint supports cancellation", contains("server/_operations-schema.ts", "position('cancelled'", "'reset','cancelled'"));
expect("Migration exists", fs.existsSync("database/migrations/20260724_erpnext_cancel_tracking_sync_v1194.sql"));
expect("Cancel webhook JSON exists", fs.existsSync("integration-assets/MZJ-ERPNext-Sales-Order-Cancel-Webhook-JSON.txt") && contains("integration-assets/MZJ-ERPNext-Sales-Order-Cancel-Webhook-JSON.txt", '"event": "sales_order.cancelled"', '"creation": "{{ doc.creation }}"'));

let failed = 0;
for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"}: ${label}`);
  if (!passed) failed += 1;
}
console.log(`\nERPNext cancel/tracking sync checks: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);
