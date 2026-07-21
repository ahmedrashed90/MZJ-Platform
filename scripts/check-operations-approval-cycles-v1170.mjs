import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const expect = (file, needle, label = needle) => {
  if (!read(file).includes(needle)) throw new Error(`Operations approval-cycle v1.17.0 check failed: ${file} missing ${label}`);
};
const reject = (file, needle, label = needle) => {
  if (read(file).includes(needle)) throw new Error(`Operations approval-cycle v1.17.0 check failed: ${file} contains forbidden ${label}`);
};

const packageJson = JSON.parse(read("package.json"));
if (packageJson.version !== "1.17.0") throw new Error("Operations approval-cycle check failed: package version must be 1.17.0");

expect("server/_operations-schema.ts", "drop constraint if exists operations_vehicle_current_approval_unique", "legacy approval constraint cleanup");
expect("server/_operations-schema.ts", "i.indpred is null", "generic legacy full unique-index cleanup");
expect("server/_operations-schema.ts", "operations_vehicle_approvals_active_unique", "active-cycle partial unique index");
expect("server/_operations-approval-cycle.ts", "startFreshVehicleApprovalCycle", "canonical fresh-cycle helper");
expect("server/_operations-approval-cycle.ts", "closeActiveVehicleApprovalCycle", "canonical cycle close helper");
expect("server/operations/index.ts", "await startFreshVehicleApprovalCycle(tx, vehicleId)", "movement under-delivery cycle trigger");
expect("server/operations/index.ts", "movementType: \"vehicle_management\"", "management status movement audit");
expect("server/_erpnext-sales-order-sync.ts", "await startFreshVehicleApprovalCycle(tx, operationsVehicle.id)", "NEXT ERP approval-cycle trigger");
expect("src/operations/pages/VehicleManagementPage.tsx", '<span>الحالة</span><select value={form.statusCode}', "editable management status");
reject("src/operations/pages/VehicleManagementPage.tsx", '<span>الحالة</span><select disabled={Boolean(form.id)}', "disabled management status");

console.log("Operations approval-cycle and vehicle-management status v1.17.0 check passed.");
