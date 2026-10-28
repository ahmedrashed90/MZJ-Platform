import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const read = (file) => fs.readFileSync(file, "utf8");
const compiled = ts.transpileModule(read("server/_tracking-order-archive.ts"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace(/^import .*?;\s*$/gm, "").replace(/^export /gm, "");
const factory = new Function("tryArchiveVehicleForTrackingRecord", `${compiled}\nreturn {archiveTrackingOrderInventory, TrackingOrderArchiveError};`);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rows = (expected = 10, completed = 10) => [
  { tracking_vehicle_id: id(1), vin: "592077", expected_stages: expected, completed_stages: completed },
  { tracking_vehicle_id: id(2), vin: "283988", expected_stages: 10, completed_stages: 10 },
];
const txFor = (vehicles, externalApproved = true) => async (strings) => {
  const statement = strings.join(" ");
  if (statement.includes("from tracking.sale_vehicle_approvals")) {
    return [{ financial_approved: externalApproved, administrative_approved: externalApproved }];
  }
  assert.match(statement, /from tracking\.order_vehicles v/);
  assert.match(statement, /left join tracking\.stages s on s\.is_active=true/);
  return vehicles;
};

{
  const attempts = [];
  const { archiveTrackingOrderInventory } = factory(async (_tx, trackingVehicleId) => {
    attempts.push(trackingVehicleId);
    return trackingVehicleId === id(1) ? { reason: "archived", archived: true } : { reason: "already_archived", archived: false };
  });
  const result = await archiveTrackingOrderInventory(txFor(rows()), id(3), { id: id(5), name: "Admin" });
  assert.deepEqual(result, { totalVehicles: 2, archivedVehicles: 1, alreadyArchivedVehicles: 1, externalVehicles: 0 });
  assert.deepEqual(attempts, [id(1), id(2)]);
}
{
  const { archiveTrackingOrderInventory } = factory(async () => null);
  const result = await archiveTrackingOrderInventory(txFor(rows()), id(3), { id: id(5), name: "Admin" });
  assert.equal(result.externalVehicles, 2, "external VINs are not fabricated in inventory");
  await assert.rejects(archiveTrackingOrderInventory(txFor(rows(), false), id(3), { id: id(5), name: "Admin" }), /الموافقة المالية أو الإدارية/);
}
{
  let attempts = 0;
  const { archiveTrackingOrderInventory } = factory(async () => { attempts++; return { reason: "archived" }; });
  await assert.rejects(archiveTrackingOrderInventory(txFor(rows(10, 9)), id(3), { id: id(5), name: "Admin" }), /592077/);
  assert.equal(attempts, 0, "all selected VINs must complete their stages before any archive write");
  await assert.rejects(archiveTrackingOrderInventory(txFor(rows(0, 0)), id(3), { id: id(5), name: "Admin" }), /592077/);
  await assert.rejects(archiveTrackingOrderInventory(txFor([]), id(3), { id: id(5), name: "Admin" }), /لا يحتوي على سيارات/);
}
{
  for (const reason of ["approvals_incomplete", "active_transfer", "tracking_incomplete", "vehicle_not_found"]) {
    const { archiveTrackingOrderInventory } = factory(async () => ({ reason, archived: false }));
    await assert.rejects(archiveTrackingOrderInventory(txFor(rows()), id(3), { id: id(5), name: "Admin" }), /592077/);
  }
}
const tracking = read("server/tracking/orders.ts");
const stages = read("server/_tracking-utils.ts");
const automaticArchive = read("server/_operations-auto-archive.ts");
const approvals = read("server/operations/index.ts");
const approvalScope = read("server/_operations-query-scope.ts");
const approvalPage = read("src/operations/pages/ApprovalsPage.tsx");
const trackingPage = read("src/tracking/pages/TrackingOrdersPage.tsx");
assert.match(tracking, /await sql\.begin\(async \(tx\) => \{/);
assert.match(tracking, /return archiveTrackingOrderInventory\(tx, candidate\.id/);
assert.match(tracking, /const result = await archiveTrackingOrderInventory\(tx, orderId/);
assert.match(tracking, /update tracking\.orders\s+set is_archived=true/);
assert.match(tracking, /hasPermission\(user, "tracking\.order\.archive"\)/);
assert.match(tracking, /for update of o/);
assert.match(tracking, /const \[currentOrder\].*?for update/s);
assert.match(tracking, /vs\.vehicle_id=any\(\$\{vehicleIds\}::uuid\[\]\)/);
assert.match(tracking, /action === "revert_stage_bulk"/);
assert.doesNotMatch(stages, /e\.order_id=vo\.order_id/);
assert.match(stages, /where e\.vehicle_id=\$\{vehicleId\}::uuid/g);
assert.match(automaticArchive, /and count\(vs\.id\)=\(select count\(\*\) from tracking\.stages where is_active=true\)/);
assert.match(automaticArchive, /coalesce\(o\.is_cancelled,false\)=false/);
assert.match(approvalScope, /operationsArchivedCompletedApprovalVisibilityScope/);
assert.match(approvals, /\$\{filter\}='completed' and \$\{archivedCompletedScope\}/);
assert.match(approvals, /if \(v\.archived_at\) throw new OperationError\(409, "VEHICLE_ARCHIVED"/);
assert.match(approvalPage, /setCounts\(payload\.counts\)/);
assert.match(approvalPage, /!selected\.archived_at/);
assert.match(trackingPage, /setSelectedVehicleIds\(payload\.order\.is_archived \? \[\] : payload\.order\.vehicles\.map\(vehicle => vehicle\.id\)\)/);
assert.match(trackingPage, /reconcileArchivedOrders/);
console.log("PASS: archive integration + historic reconciliation + VIN-isolated stages + approvals history + selection tests");
