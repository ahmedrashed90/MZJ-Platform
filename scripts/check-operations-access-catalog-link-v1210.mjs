import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const checks = [];
function expect(label, condition) {
  checks.push({ label, ok: Boolean(condition) });
  console.log(`${condition ? "PASS" : "FAIL"}: ${label}`);
}

const accessSchema = read("server/_access-control-schema.ts");
const operationsSchema = read("server/_operations-schema.ts");
const accessApi = read("server/access-control.ts");
const operationsApi = read("server/operations/index.ts");
const accessRuntime = read("server/_access-control.ts");
const accessUi = read("src/access-control/UsersPermissionsPanel.tsx");
const migration = read("database/migrations/20260728_operations_access_catalog_link.sql");

expect("Per-user operations vehicle-status scope has one canonical table", accessSchema.includes("core.user_system_vehicle_statuses") && accessSchema.includes("primary key(user_id,system_code,status_code)"));
expect("Operational locations have a canonical central branch link", operationsSchema.includes("core_branch_id uuid references core.branches(id) on delete set null"));
expect("Existing operational locations are backfilled into central branches", operationsSchema.includes("insert into core.branches(code,name,is_active,sort_order)") && operationsSchema.includes("set core_branch_id=b.id"));
expect("Saving an operational location updates the same central branch catalog", operationsApi.includes("core_branch_id=${coreBranchId}::uuid") && operationsApi.includes("تم حفظ إعداد المكان وربطه بالفروع المسموحة"));
expect("Editing a central branch updates its linked operational location", accessApi.includes("update operations.locations set code=${row.code},name=${row.name}"));
expect("Access-control bootstrap returns active vehicle statuses", accessApi.includes("vehicleStatuses") && accessApi.includes("from operations.vehicle_statuses order by"));
expect("User save persists operations vehicle-status scope", accessApi.includes("delete from core.user_system_vehicle_statuses") && accessApi.includes("insert into core.user_system_vehicle_statuses"));
expect("Effective access includes vehicle status codes", accessRuntime.includes("vehicle_status_codes") && accessRuntime.includes("vehicleStatusCodes: normalizeArray"));
expect("Users and permissions UI shows allowed vehicle statuses", accessUi.includes("حالات السيارات المسموحة") && accessUi.includes("vehicleStatusCodes"));
expect("Empty vehicle-status selection remains backward compatible", accessUi.includes("عدم تحديد حالات يعني السماح بكل حالات السيارات الفعالة") && operationsApi.includes("return !allowed.length || allowed.includes"));
expect("Operations reads are status-scoped", operationsApi.includes("vehicleStatusScope") && operationsApi.includes("and ${statusScope}"));
expect("Operations mutations validate current and target statuses", operationsApi.includes("assertVehicleStatusAccess(user, before.status_code") && operationsApi.includes("assertVehicleStatusAccess(user, newStatus") && operationsApi.includes("assertVehicleStatusAccess(user, vehicle.status_code"));
expect("Deployment migration carries both catalog links", migration.includes("core.user_system_vehicle_statuses") && migration.includes("operations.locations") && migration.includes("core_branch_id"));

const failed = checks.filter((item) => !item.ok);
if (failed.length) {
  console.error(`\nOperations access catalog link checks failed: ${failed.length}/${checks.length}`);
  process.exit(1);
}
console.log(`\nOperations access catalog link checks passed: ${checks.length}/${checks.length}`);
