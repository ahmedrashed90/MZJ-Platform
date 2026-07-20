import fs from "node:fs";

const required = [
  ["api/index.ts", '"operations", operationsHandler'],
  ["src/App.tsx", 'path="/operations"'],
  ["src/App.tsx", '<Route index element={<InventoryPage />} />'],
  ["src/operations/OperationsLayout.tsx", "مخزون السيارات"],
  ["src/operations/OperationsLayout.tsx", "طلبات النقل"],
  ["server/_operations-schema.ts", "operations.vehicle_statuses"],
  ["server/_operations-schema.ts", "operations.vehicle_deletion_audit"],
  ["server/_operations-schema.ts", "tracking_orders_source_identity_unique"],
  ["server/_operations-schema.ts", "transfer_request_no_seq"],
  ["server/_operations-utils.ts", "DATABASE_ERROR"],
  ["server/operations/index.ts", "VEHICLE_HAS_HISTORY"],
  ["server/operations/index.ts", "APPROVALS_REQUIRED"],
  ["server/operations/index.ts", "movement_batches"],
  ["server/operations/index.ts", "for update"],
  ["server/tracking/delete.ts", "orderId"],
  ["server/tracking/delete.ts", "tracking.deleted_orders"],
  ["server/integrations/tracking-orders.ts", "sourceIdentity"],
  ["src/components/Modal.tsx", "createPortal"],
  ["src/tracking/pages/TrackingOrdersPage.tsx", "تأكيد مسح طلب التراكينج"],
  ["src/operations/components/DashboardOperationsModal.tsx", "تصدير Excel"],
  ["src/operations/components/DashboardOperationsModal.tsx", "طلبات النقل والتصوير"],
  ["src/operations/excel.ts", "buildXlsxBytes"],
  ["src/operations/excel.ts", "DecompressionStream"],
  ["src/operations/pages/VehicleManagementPage.tsx", 'accept=".xlsx,.xls,.html,.csv,.txt"'],
  ["src/pages/DashboardPage.tsx", "sectionErrorLabels"],
  ["server/_dashboard-data.ts", "globalOperationsAccess"],
  ["server/setup/initialize.ts", "ensureOperationsSchema"],
];

for (const [file, needle] of required) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(needle)) throw new Error(`Operations V2 check failed: ${file} missing ${needle}`);
}

const operationsApi = fs.readFileSync("server/operations/index.ts", "utf8");
if (operationsApi.includes('user.departmentCodes.includes("operations")')) {
  throw new Error("Operations V2 check failed: department membership must not bypass branch scope");
}
if (!operationsApi.includes('v.status_code !== "under_delivery"')) {
  throw new Error("Operations V2 check failed: delivered transition must require under-delivery state");
}

if (!operationsApi.includes("assertBranchAccess(user, valid.branch_code")) {
  throw new Error("Operations V2 check failed: vehicle creation must enforce branch scope server-side");
}
if (!operationsApi.includes("لا تملك صلاحية مسح سيارة في هذا الفرع")) {
  throw new Error("Operations V2 check failed: vehicle deletion must enforce branch scope server-side");
}
if (!operationsApi.includes("الحركة المباشرة متاحة فقط إلى موقع داخل الفروع المسموح بها")) {
  throw new Error("Operations V2 check failed: direct movement destination must respect branch scope");
}
if (!operationsApi.includes("from operations.locations l") || !operationsApi.includes("coalesce(l.branch_code,l.code) in")) {
  throw new Error("Operations V2 check failed: replace import must be limited to the user's branch scope");
}
if (!operationsApi.includes("tx.savepoint")) {
  throw new Error("Operations V2 check failed: import row failures must be isolated with savepoints");
}

const trackingDelete = fs.readFileSync("server/tracking/delete.ts", "utf8");
if (trackingDelete.includes("deleted_order_blocks")) {
  throw new Error("Operations V2 check failed: tracking deletion must not create a permanent order-number block");
}
if (!trackingDelete.includes("where id=${orderId}::uuid")) {
  throw new Error("Operations V2 check failed: tracking deletion must use the internal request ID");
}
if (!trackingDelete.includes("tracking.request.deleted") || !trackingDelete.includes("operations.event_outbox")) {
  throw new Error("Operations V2 check failed: tracking deletion must preserve a durable vehicle event");
}

const trackingIngest = fs.readFileSync("server/integrations/tracking-orders.ts", "utf8");
if (/on conflict\s*\(\s*sales_order_no\s*\)/i.test(trackingIngest)) {
  throw new Error("Operations V2 check failed: sales_order_no cannot be the idempotency identity");
}

const dashboardRoute = fs.readFileSync("server/dashboard.ts", "utf8");
if (!dashboardRoute.includes("getDashboardData(user)")) {
  throw new Error("Operations V2 check failed: dashboard aggregation must apply the current user's scope");
}

const app = fs.readFileSync("src/App.tsx", "utf8");
if (app.includes("سيتم إنشاء نظام العمليات")) {
  throw new Error("Operations V2 check failed: old operations placeholder is still present");
}

console.log("Operations Native V2 structure, branch scope, tracking delete, modal stack, dashboard drill-down, and source-identity checks passed.");
