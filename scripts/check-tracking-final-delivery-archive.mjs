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
    return [{ id: "11111111-1111-1111-1111-111111111111", vin: "VIN-TEST", status_code: "under_delivery", archived_at: null }];
  }
  if (statement.includes("as approvals_complete") && statement.includes("as tracking_complete")) {
    return [{ approvals_complete: true, active_transfer: false, tracking_complete: true }];
  }
  if (statement.includes("update operations.vehicles")) {
    assert.match(statement, /status_code='delivered'/, "الأرشفة النهائية يجب أن تحول الحالة إلى delivered");
    assert.match(statement, /is_inventory_active=false/, "الأرشفة النهائية يجب أن تخرج السيارة من المخزون النشط");
    return [{ id: "11111111-1111-1111-1111-111111111111", vin: "VIN-TEST", status_code: "delivered", archived_at: new Date().toISOString(), is_inventory_active: false }];
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
assert.ok(statements.some((statement) => statement.includes("insert into operations.vehicle_archive_events")), "يجب تسجيل حدث الأرشفة");

console.log("Tracking final delivery -> delivered status + vehicle archive runtime check passed.");
