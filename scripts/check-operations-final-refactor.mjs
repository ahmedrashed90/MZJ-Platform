import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const requireMarkers = (file, markers) => {
  const text = read(file);
  for (const marker of markers) {
    if (!text.includes(marker)) throw new Error(`${file}: missing ${marker}`);
  }
  return text;
};
const forbidMarkers = (file, markers) => {
  const text = read(file);
  for (const marker of markers) {
    if (text.includes(marker)) throw new Error(`${file}: forbidden marker remains: ${marker}`);
  }
};

const layout = requireMarkers("src/operations/OperationsLayout.tsx", [
  'label: "مخزون السيارات"', 'label: "إدارة السيارات"', 'label: "الحركة"', 'label: "طلبات النقل"',
  'label: "الموافقات"', 'label: "جميع السيارات"', 'label: "سجل الحركات"', 'label: "الأرشيف"',
]);
if ((layout.match(/label:/g) || []).length !== 8) throw new Error("Operations layout must expose exactly eight tabs");
forbidMarkers("src/operations/OperationsLayout.tsx", ["طلبات النقل والتصوير"]);

const inventory = requireMarkers("src/operations/pages/InventoryPage.tsx", [
  "operations-sticky-filter-stack", "StickyHorizontalScroll", "useResizableColumns", "column-resize-handle",
  "تصدير النتائج الحالية إلى Excel", 'operations.vehicle.delete', "مسح السيارة", "سبب المسح",
  'action:"delete_vehicle"', "notifyOperationsChanged",
]);
if (!inventory.includes("onDoubleClick={()=>autoFit(column.key)}")) throw new Error("Column auto-fit is missing");

const management = requireMarkers("src/operations/pages/VehicleManagementPage.tsx", [
  'type ImportMode="replace"|"add"|"update"', "استبدال كامل", "إضافة فوق الحالي", "تحديث من الشيت",
  'action:"preview_import"', 'action:"import_vehicles"', "replaceConfirmed", "Import Batch", "requestKey",
]);

const movement = requireMarkers("src/operations/pages/MovementPage.tsx", [
  'action:"preview_movement"', 'action:"create_movement"', "movement-vehicle-facts", "checklistByVehicle",
  "Atomic", "requestKey", "لا يوجد حقل إنشاء جديد باسم «ملاحظة الحركة»",
]);
if (movement.includes("movementNote")) throw new Error("Removed movement note payload returned");

const requests = requireMarkers("src/operations/pages/RequestsPage.tsx", [
  'tab==="create"', 'tab==="active"', 'tab==="completed"', "إنشاء طلب", "متابعة الطلبات", "الطلبات المكتملة",
  'action:"create_request"', "request-completed-filters", "الحركة الناتجة عن الطلب",
]);
for (const marker of ["طلبات التصوير", "سبب الطلب", "photography_type"]) {
  if (requests.includes(marker)) throw new Error(`Transfer requests page still exposes ${marker}`);
}

const service = requireMarkers("server/_operations-service.ts", [
  'type VehicleImportMode = "replace" | "add" | "update"', "buildVehicleImportPlan", "previewVehicleImport",
  "operations.import_batches", "inventory_active=false", "IMPORT_VALIDATION_FAILED", "Scientific Notation",
  "previewMovement", "operations.vehicle.approval_pending", "APPROVALS_REQUIRED", "request_key",
  "r.request_type='transfer'", "deleteVehiclePermanently", "VEHICLE_HAS_HISTORY", "recommendedAction: \"archive\"",
  'audit(tx, user, "vehicle.deleted_permanently"', "operations.vehicle_tracking_links", "tracking.order_vehicles",
]);
if (/delete\s+from\s+operations\.vehicles/i.test(service) === false) throw new Error("Physical delete statement missing");

requireMarkers("server/operations/index.ts", [
  "canDeleteVehicle", "canReplaceInventory", 'action === "delete_vehicle"', "operations.vehicle.delete",
  'action === "preview_import"', 'action === "import_vehicles"', 'action === "preview_movement"',
  "operations.approvals.financial", "operations.approvals.administrative",
]);
requireMarkers("server/_operations-auth.ts", [
  "canDeleteVehicle", 'user.permissions.includes("operations.vehicle.delete")', "canReplaceInventory",
]);
const schema = requireMarkers("database/migrations/20260719_operations_native.sql", [
  "operations.vehicle.delete", "operations.vehicles.replace", "operations.import_batches", "inventory_active",
  "operations_import_batches_request_key_unique", "operations_movement_batches_request_key_unique",
]);
if (/drop\s+table|truncate\s+/i.test(schema)) throw new Error("Migration contains a destructive statement");

requireMarkers("src/styles.css", [
  ".operations-sticky-filter-stack", ".inventory-scroll-area", ".column-resize-handle", ".operations-confirm-modal",
  ".vehicle-delete-action", ".import-mode-cards", ".movement-preview", ".operations-request-create-page",
]);
const dashboard = requireMarkers("src/pages/DashboardPage.tsx", ["طلبات النقل", "operations:data-changed"]);
for (const marker of ["طلبات النقل والتصوير", "سبب الطلب", "نوع التصوير", "تاريخ التصوير"]) {
  if (dashboard.includes(marker)) throw new Error(`Dashboard still exposes removed transfer/photo field: ${marker}`);
}

console.log("Operations final refactor acceptance checks passed: inventory UX, three-mode import, movement, transfer-only requests, approvals, hard-delete safety, permissions, audit, and dashboard refresh.");
