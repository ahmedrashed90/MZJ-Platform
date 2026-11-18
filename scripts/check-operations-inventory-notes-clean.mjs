import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { OPERATIONS_INVENTORY_FIELDS, canViewOperationsInventoryField } from "../shared/operations-inventory-fields.ts";

const base = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(base, file), "utf8");
const table = read("src/operations/components/VehicleTable.tsx");
const inventory = read("src/operations/pages/InventoryPage.tsx");
const server = read("server/operations/index.ts");
const schema = read("server/_access-control-schema.ts");
const users = read("src/access-control/UsersPermissionsPanel.tsx");
const css = read("src/styles.css");
const vehicleManage = read("src/operations/pages/VehicleManagementPage.tsx");
const movement = read("src/operations/pages/MovementPage.tsx");
const checks = [
  ["Notes defined exactly once as a visibility-controlled field", () => assert.equal(OPERATIONS_INVENTORY_FIELDS.filter((x) => x.key === "notes" && x.label === "ملاحظات").length, 1)],
  ["Inventory permission inherited for existing viewers", () => assert.equal(canViewOperationsInventoryField({ permissions: ["operations.inventory.view"] }, "operations.inventory.column.notes"), true)],
  ["Explicit notes denial overrides inventory access", () => assert.equal(canViewOperationsInventoryField({ permissions: ["operations.inventory.view"], deniedPermissions: ["operations.inventory.column.notes"] }, "operations.inventory.column.notes"), false)],
  ["Unprivileged users cannot see notes column", () => assert.equal(canViewOperationsInventoryField({ permissions: [] }, "operations.inventory.column.notes"), false)],
  ["Stock table uses active state_note (not legacy notes)", () => assert.match(table, /key: "notes", label: "ملاحظات"[^\n]*row\.state_note/)],
  ["Stock table retains resizable note column and tooltip", () => assert.ok(table.includes('width: 210, min: 140, max: 440') && table.includes('operations-inventory-note'))],
  ["Stock export includes current notes for allowed users", () => assert.ok(inventory.includes('{ key: "notes", label: "ملاحظات", read: (row) => row.state_note || "" }') && inventory.includes('meta.inventoryVisibleColumns.includes(item.key)'))],
  ["Stock backend selects saved notes", () => assert.match(server, /v\.notes,v\.state_note,v\.shortage_note/)],
  ["Stock backend masks notes when field denied", () => assert.ok(server.includes('notes: ["state_note", "notes", "shortage_note"]') && server.includes('delete row[key]'))],
  ["Permissions screen lists all stock fields including notes", () => assert.ok(users.includes('OPERATIONS_INVENTORY_FIELDS.map((field)'))],
  ["Notes permission is registered in the access catalog SQL", () => assert.match(schema, /\('operations\.inventory\.column\.notes','إظهار ملاحظات'/)],
  ["Upgrade check requires notes permission explicitly", () => assert.ok(schema.includes("bool_or(code='operations.inventory.column.notes') as notes_ready") && schema.includes('row?.notes_ready === true'))],
  ["Single notes form remains available for every status", () => assert.ok(vehicleManage.includes('<span>ملاحظات</span><textarea') && movement.includes('key: "stateNote", label: "ملاحظات"'))],
  ["Stock note style matches platform typography", () => assert.ok(css.includes('.operations-inventory-note') && css.includes('text-overflow: ellipsis'))],
];
let fails=0;
for (const [name, check] of checks) {
  try { check(); console.log(`PASS: ${name}`); }
  catch (error) { fails++; console.error(`FAIL: ${name} — ${error.message}`); }
}
console.log(`Stock notes checks: ${checks.length - fails}/${checks.length}`);
if (fails) process.exit(1);
