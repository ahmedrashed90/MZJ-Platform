import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const sourcePath = "server/_operations-auto-archive.ts";
const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    strict: true,
  },
  fileName: sourcePath,
}).outputText;

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mzj-final-delivery-"));
const tempModule = path.join(tempDir, "operations-auto-archive.mjs");
fs.writeFileSync(tempModule, transpiled, "utf8");
const { tryArchiveEligibleVehicle } = await import(`${pathToFileURL(tempModule).href}?v=${Date.now()}`);

const statements = [];
const tx = async (strings, ...values) => {
  const statement = strings.reduce((result, part, index) => result + part + (index < values.length ? `__VALUE_${index}__` : ""), "");
  statements.push(statement);
  if (statement.includes("from operations.vehicles") && statement.includes("for update")) {
    return [{ id: "11111111-1111-1111-1111-111111111111", vin: "VIN-TEST", status_code: "under_delivery", state_note: "مباع تحت التسليم — طلب البيع SAL-TEST-1", location_id: "33333333-3333-3333-3333-333333333333", archived_at: null }];
  }
  if (statement.includes("as approvals_complete") && statement.includes("as tracking_complete")) {
    return [{ approvals_complete: true, active_transfer: false, tracking_complete: true }];
  }
  if (statement.includes("select o.sales_order_no") && statement.includes("from tracking.order_vehicles")) {
    return [{ sales_order_no: "SAL-TEST-1" }];
  }
  if (statement.includes("update operations.vehicles")) {
    assert.match(statement, /status_code='delivered'/, "الأرشفة النهائية يجب أن تحول الحالة إلى delivered");
    assert.match(statement, /is_inventory_active=false/, "الأرشفة النهائية يجب أن تخرج السيارة من المخزون النشط");
    assert.match(statement, /state_note=__VALUE_0__/, "الأرشفة النهائية يجب أن تحفظ ملاحظة طلب البيع النظيفة");
    return [{ id: "11111111-1111-1111-1111-111111111111", vin: "VIN-TEST", status_code: "delivered", state_note: "طلب البيع SAL-TEST-1", archived_at: new Date().toISOString(), is_inventory_active: false }];
  }
  if (statement.includes("insert into operations.movements")) {
    assert.match(statement, /'delivered'/, "سجل الحركات يجب أن يسجل الحالة الجديدة delivered");
    assert.match(statement, /'tracking_delivery'/, "سجل الحركات يجب أن يميز حركة التسليم النهائي");
    return [];
  }
  if (statement.includes("insert into operations.vehicle_archive_events")) return [];
  throw new Error(`Unexpected SQL in final-delivery check: ${statement}`);
};
tx.json = (value) => value;

const result = await tryArchiveEligibleVehicle(
  tx,
  "11111111-1111-1111-1111-111111111111",
  { id: "22222222-2222-2222-2222-222222222222", name: "مستخدم اختبار" },
);

assert.equal(result.archived, true);
assert.equal(result.reason, "archived");
assert.equal(result.vehicle.status_code, "delivered");
assert.equal(result.vehicle.is_inventory_active, false);
assert.equal(result.vehicle.state_note, "طلب البيع SAL-TEST-1");
assert.ok(statements.some((statement) => statement.includes("insert into operations.movements")), "يجب تسجيل حركة مباع تم التسليم");
assert.ok(statements.some((statement) => statement.includes("insert into operations.vehicle_archive_events")), "يجب تسجيل حدث الأرشفة");

console.log("Tracking final delivery -> delivered movement + clean sales-order note + vehicle archive runtime check passed.");
