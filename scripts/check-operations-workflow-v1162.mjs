import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const pkg = read("package.json");
const schema = read("server/_operations-schema.ts");
const databaseSchema = read("database/schema.sql");
const migration = read("database/migrations/20260721_operations_delivery_approval_and_check_history_v1162.sql");
const api = read("server/operations/index.ts");
const dashboardModal = read("src/operations/components/DashboardOperationsModal.tsx");
const detail = read("src/operations/components/VehicleDetailModal.tsx");
const vehicleTable = read("src/operations/components/VehicleTable.tsx");
const movementPage = read("src/operations/pages/MovementPage.tsx");
const approvalsPage = read("src/operations/pages/ApprovalsPage.tsx");
const styles = read("src/styles.css");

const checks = [
  ["Version is 1.16.2 or newer", /"version": "(?:1\.16\.[2-9][0-9]*|1\.1[7-9]\.[0-9]+|[2-9]\.[0-9]+\.[0-9]+)"/.test(pkg)],
  ["Existing check history tables gain the missing note column", schema.includes("alter table operations.vehicle_check_history add column if not exists note text") && migration.includes("vehicle_check_history add column if not exists note text")],
  ["Approval rows persist pending final delivery requests", schema.includes("pending_delivery jsonb") && databaseSchema.includes("pending_delivery jsonb") && migration.includes("vehicle_approvals add column if not exists pending_delivery jsonb")],
  ["Final delivery no longer forces the legacy under-delivery transition", !api.includes("يجب أن تكون السيارة") || !api.includes("في حالة مباع تحت التسليم قبل التسليم النهائي")],
  ["Missing approvals queue the requested final delivery", api.includes("pendingApprovals.push") && api.includes("pending_delivery=${tx.json(pending)}")],
  ["Completed approvals execute the queued delivery", api.includes('movementType: "approved_delivery"') && api.includes("اكتملت الموافقتان وتم تسليم السيارة نهائيًا")],
  ["Check history writes the note after schema compatibility runs", api.includes("vehicle_check_history(vehicle_id,item_code,old_status,new_status,note") && schema.includes("ensureOperationsSchema")],
  ["Vehicle deletion requires exact VIN confirmation", api.includes("CONFIRMATION_MISMATCH") && detail.includes("confirmVin.trim() !== vehicle.vin")],
  ["Vehicle deletion removes related operational and tracking data", ["operations.approval_events", "operations.vehicle_check_history", "operations.transfer_request_vehicles", "operations.photography_request_vehicles", "tracking.order_vehicles", "operations.vehicles"].every((token) => api.includes(`delete from ${token}`))],
  ["Operations dashboard inventory and shortage drilldowns use fullscreen modal", dashboardModal.includes("dashboard-operations-modal-fullscreen") && styles.includes(".dashboard-operations-modal-fullscreen")],
  ["Vehicle checks are rendered as separated professional cards", detail.includes("operations-check-card") && styles.includes(".operations-check-card > header")],
  ["Agency movement checks are rendered as separated editor cards", movementPage.includes("operations-check-edit-card") && styles.includes(".operations-check-edit-card > label")],
  ["Tracking request is a compact progress control with percentage tones", vehicleTable.includes("trackingProgressTone") && styles.includes(".operations-tracking-open.low") && styles.includes(".operations-tracking-open.medium") && styles.includes(".operations-tracking-open.high")],
  ["Approval screen closes a vehicle after automatic final delivery", approvalsPage.includes("setSelected(updated || null)")],
];

let failed = false;
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
