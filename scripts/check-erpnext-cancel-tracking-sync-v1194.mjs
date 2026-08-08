import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const checks = [];
const expect = (label, condition) => checks.push([label, Boolean(condition)]);
const contains = (file, ...tokens) => {
  const text = read(file);
  return tokens.every((token) => text.includes(token));
};
const versionAtLeast = (actual, minimum) => {
  const left = String(actual).split(".").map((part) => Number(part) || 0);
  const right = String(minimum).split(".").map((part) => Number(part) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] || 0) !== (right[index] || 0)) return (left[index] || 0) > (right[index] || 0);
  }
  return true;
};

expect("Package version keeps ERPNext cancel tracking release or newer", versionAtLeast(JSON.parse(read("package.json")).version, "1.19.4"));
expect("ERPNext instance identity includes creation", contains("server/_erpnext-sales-order-normalizer.ts", "sourceInstanceKey", "created:${erpCreatedAt}", "isCancellation"));
expect("ERPNext cancel route uses the unified endpoint", contains("server/integrations/erpnext-sales-order.ts", "normalized.isCancellation", "cancelErpNextSalesOrder"));
expect("Cancellation is idempotent", contains("server/_erpnext-sales-order-sync.ts", "alreadyCancelled", "ERP_CANCEL_ORDER_NOT_FOUND"));
expect("Cancelled tracking orders are deleted with their related SMS rows", contains("server/_erpnext-sales-order-sync.ts", "delete from tracking.sms_messages", "delete from tracking.orders"));
expect("Operations returns only eligible under-delivery vehicles", contains("server/_erpnext-sales-order-sync.ts", "status_code='available_for_sale'", "OPERATIONS_NEWER_SALES_ORDER_PRESERVED", "OPERATIONS_CANCEL_REVIEW_REQUIRED"));
expect("Approval cycles created for the cancelled order are deleted", contains("server/_erpnext-sales-order-sync.ts", "delete from operations.approval_events", "delete from operations.vehicle_approvals"));
expect("CRM previous state including sold fields is stored and restored", contains("server/_erpnext-sales-order-sync.ts", "crm_previous_state", "soldQuantity", "soldAt", "restored_previous_state", "erpnext_sales_order_cancelled"));
expect("Multiple CRM sales orders inherit the original pre-sale state", contains("server/_erpnext-sales-order-sync.ts", "originIntegrationState", "inheritedPreviousState", "historicalOrigin"));
expect("Tracking stage action updates all order vehicles", contains("server/tracking/orders.ts", "from tracking.order_vehicles ov", "ov.order_id=${row.order_id}::uuid", "لجميع سيارات الطلب"));
expect("SMS sent state is persisted per order stage", contains("server/tracking/orders.ts", "tracking.sms_messages", "sm.order_id=${id}::uuid", "as sms_sent"));
expect("SMS button has persistent green state", contains("src/tracking/pages/TrackingOrdersPage.tsx", "stage.sms_sent ? \"sent\"", "تم إرسال SMS+ لهذه المرحلة") && contains("src/styles.css", ".tracking-stage-actions button.sms.sent", "#218c5a"));
expect("Cancellation retry reconciles earlier partial cancellation", contains("server/_erpnext-sales-order-sync.ts", "const alreadyCancelled = Boolean(order.is_cancelled)", "cancelled_at=coalesce(cancelled_at,now())"));
expect("Operations active tracking excludes cancelled orders", contains("server/operations/index.ts", "coalesce(o.is_cancelled,false)=false"));
expect("Vehicle sales-order tab includes cancellation history", contains("server/operations/index.ts", "so.is_cancelled", "so.cancelled_at", "so.cancellation_reason") && contains("src/operations/components/VehicleDetailModal.tsx", "ملغي من NEXT ERP", "لا يوجد طلب بيع نشط مرتبط بهذه السيارة"));
expect("Public tracking shows cancellation instead of continuing the live flow", contains("server/tracking/public.ts", "is_cancelled: order.is_cancelled") && contains("src/tracking/pages/PublicTrackingPage.tsx", "تم إلغاء طلب البيع", "order.is_cancelled"));
expect("Runtime schemas include cancellation columns", contains("server/_tracking-schema.ts", "cancellation_reason", "source_instance_key", "erp_created_at") && contains("server/_erpnext-integration-schema.ts", "crm_previous_state", "is_cancelled", "cancelled_at"));
expect("Approval action constraint supports cancellation", contains("server/_operations-schema.ts", "position('cancelled'", "'reset','cancelled'"));
expect("Migration exists", fs.existsSync("database/migrations/20260724_erpnext_cancel_tracking_sync_v1194.sql"));
expect("Cancel webhook JSON exists", fs.existsSync("integration-assets/MZJ-ERPNext-Sales-Order-Cancel-Webhook-JSON.txt") && contains("integration-assets/MZJ-ERPNext-Sales-Order-Cancel-Webhook-JSON.txt", '"event": "sales_order.cancelled"', '"creation": {{ (doc.creation or \'\') | tojson }}'));

let failed = 0;
for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"}: ${label}`);
  if (!passed) failed += 1;
}
console.log(`\nERPNext cancel/tracking sync checks: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);
