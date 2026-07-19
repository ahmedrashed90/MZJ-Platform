import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const assertIncludes = (file, needles) => {
  const text = read(file);
  for (const needle of needles) {
    if (!text.includes(needle)) throw new Error(`${file} is missing required final-correction marker: ${needle}`);
  }
};

assertIncludes("src/operations/pages/InventoryPage.tsx", [
  "setSelectedVehicleId(row.id)",
  "<VehicleDetailDrawer vehicleId={selectedVehicleId}",
  "onClose={()=>setSelectedVehicleId(null)}",
]);
assertIncludes("src/operations/components/VehicleDetailDrawer.tsx", [
  "AbortController",
  "abortRef.current?.abort()",
  "setDetail(null)",
  "onClose()",
]);
assertIncludes("server/_operations-service.ts", [
  "DUPLICATE_ACTIVE_REQUEST",
  "sourceLocationIds.length!==1",
  "sourceBranchCodes.length!==1",
  "movementId=randomUUID()",
  "movement_id,changed_by",
  "التجاوز الإداري متاح لمدير النظام فقط",
  "سبب التجاوز الإداري مطلوب",
]);
assertIncludes("server/operations/index.ts", [
  "fieldErrors",
  "requestId",
  "operations.vehicles.export",
  "vehicles.exported",
  "request.create_failed",
]);
assertIncludes("server/_operations-service.ts", [
  "const approvalRows=await listApprovals(user,{})",
  "const requests=await listRequests(user,{limit:1000})",
  "const shortages=await getShortages(user)",
]);
assertIncludes("src/pages/DashboardPage.tsx", [
  'resource: "vehicles"',
  'resource: "approvals"',
  'resource: "requests"',
  'resource: "shortages"',
  "row.branch_count",
  "row.total_count",
  "openRequestDetail(row)",
]);
assertIncludes("src/operations/components/StickyHorizontalScroll.tsx", [
  "bar.scrollLeft=target.scrollLeft",
  "target.scrollLeft=bar.scrollLeft",
  "ResizeObserver",
]);
assertIncludes("src/operations/pages/MovementPage.tsx", [
  "checklistByVehicle",
  "لا يوجد حقل إنشاء جديد باسم «ملاحظة الحركة»",
]);
if (read("src/operations/pages/MovementPage.tsx").includes("movementNote")) {
  throw new Error("Removed movementNote field or payload reappeared in the unified movement page");
}
const app = read("src/App.tsx");
const movementRoutes = [...app.matchAll(/<Route path="movement"/g)].length;
if (movementRoutes !== 1) throw new Error(`Expected exactly one operations movement route, found ${movementRoutes}`);
if (/group.?movement|bulk.?movement/i.test(app)) throw new Error("A duplicate bulk/group movement route remains reachable");

const service = read("server/_operations-service.ts");
for (const marker of [
  "ACTIVE_SHORTAGE_STATUSES",
  "SHORTAGE_LOCATIONS",
  "SHORTAGE_BRANCHES",
  "ACCESSORY_EXCLUSIONS",
  "l.code=any(${SHORTAGE_LOCATIONS}",
  "v.status_code=any(${ACTIVE_SHORTAGE_STATUSES}",
  "rows.length",
]) {
  if (!service.includes(marker)) throw new Error(`Shortage rule marker missing: ${marker}`);
}

const migration = read("database/migrations/20260719_operations_native.sql");
if (/drop\s+table|truncate\s+/i.test(migration)) throw new Error("Final operations migration contains a destructive statement");
for (const historicalField of ["note text", "status_note text", "vehicle_status_notes", "operations.movements"]) {
  if (!migration.includes(historicalField)) throw new Error(`Historical movement/note preservation marker missing: ${historicalField}`);
}

console.log("Operations final mandatory corrections static acceptance checks passed.");
