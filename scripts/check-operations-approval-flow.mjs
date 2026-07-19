import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("server/operations/approval-flow.ts", "utf8");
const transpiled = ts.transpileModule(source, {
  fileName: "approval-flow.ts",
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
  },
}).outputText;

class OperationsError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const auditEvents = [];
const outboxEvents = [];
const module = { exports: {} };
vm.runInNewContext(transpiled, {
  module,
  exports: module.exports,
  require(specifier) {
    if (specifier === "./common.js") return {
      OperationsError,
      audit: async (...args) => auditEvents.push(args.at(-1)),
      outbox: async (...args) => outboxEvents.push(args.at(-1)),
    };
    throw new Error(`Unexpected dependency: ${specifier}`);
  },
  console,
});

const { assertApprovalStatusTransition, applyApprovalStatusTransition } = module.exports;
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`PASS: ${message}`);
};
const expectError = (vehicle, target, code, text) => {
  try {
    assertApprovalStatusTransition(vehicle, target);
  } catch (error) {
    assert(error instanceof OperationsError, "transition rejection uses OperationsError");
    assert(error.code === code, `transition rejection code is ${code}`);
    assert(String(error.message).includes(text), `transition rejection message explains ${text}`);
    return;
  }
  throw new Error(`Expected ${code} but transition was accepted`);
};

expectError(
  { id: "1", vin: "000123", status_code: "available_for_sale", financial_approved: true, administrative_approved: true },
  "delivered",
  "UNDER_DELIVERY_REQUIRED",
  "مباع تحت التسليم",
);
expectError(
  { id: "1", vin: "000123", status_code: "under_delivery", financial_approved: false, administrative_approved: false },
  "delivered",
  "APPROVALS_REQUIRED",
  "الموافقة المالية والموافقة الإدارية",
);
expectError(
  { id: "1", vin: "000123", status_code: "under_delivery", financial_approved: true, administrative_approved: false },
  "delivered",
  "APPROVALS_REQUIRED",
  "الموافقة الإدارية",
);
expectError(
  { id: "1", vin: "000123", status_code: "under_delivery", financial_approved: false, administrative_approved: true },
  "delivered",
  "APPROVALS_REQUIRED",
  "الموافقة المالية",
);
assertApprovalStatusTransition(
  { id: "1", vin: "000123", status_code: "under_delivery", financial_approved: true, administrative_approved: true },
  "delivered",
);
assert(true, "delivery is allowed only after both approvals on the under-delivery state");
assertApprovalStatusTransition(
  { id: "1", vin: "000123", status_code: "available_for_sale", financial_approved: false, administrative_approved: false },
  "under_delivery",
);
assert(true, "entering under delivery remains an explicit normal status transition");

function makeTx(before) {
  const calls = [];
  const tx = async (strings, ...values) => {
    const text = Array.isArray(strings) ? strings.join("$") : String(strings);
    calls.push({ text, values });
    if (text.includes("select * from operations.vehicle_approvals")) return before ? [before] : [];
    if (text.includes("returning *")) {
      const entering = text.includes("cycle_no=$") || text.includes("cycle_no,updated_at");
      return [{ ...(before || {}), financial_approved: false, administrative_approved: false, cycle_no: entering ? Number(before?.cycle_no || 0) + 1 : Number(before?.cycle_no || 0) }];
    }
    return [];
  };
  tx.json = (value) => value;
  return { tx, calls };
}

const user = { id: "00000000-0000-0000-0000-000000000001", fullName: "Test", roles: ["Admin"], roleCodes: ["system_admin"], branches: ["All"], branchCodes: ["all"] };
const request = {};

auditEvents.length = 0;
outboxEvents.length = 0;
const same = makeTx({ cycle_no: 4, financial_approved: true, administrative_approved: true });
await applyApprovalStatusTransition(same.tx, request, user, { id: "1", vin: "000123", status_code: "under_delivery" }, "under_delivery");
assert(same.calls.length === 0, "editing other vehicle data while still under delivery does not reset approvals");

const delivered = makeTx({ cycle_no: 4, financial_approved: true, administrative_approved: true });
await applyApprovalStatusTransition(delivered.tx, request, user, { id: "1", vin: "000123", status_code: "under_delivery" }, "delivered");
assert(delivered.calls.length === 0, "successful delivery preserves current approvals and their metadata");

const entering = makeTx({ cycle_no: 2, financial_approved: true, administrative_approved: true, financial_note: "old" });
await applyApprovalStatusTransition(entering.tx, request, user, { id: "1", vin: "000123", status_code: "available_for_sale" }, "under_delivery");
assert(entering.calls.some((call) => call.text.includes("financial_approved=false,administrative_approved=false")), "entering under delivery initializes both approvals as incomplete");
assert(entering.calls.filter((call) => call.text.includes("vehicle_approval_history")).length === 2, "initialization records independent financial and administrative history events");
assert(auditEvents.some((event) => event.action === "vehicle.approvals_initialized"), "approval initialization is written to the audit trail");

const leaving = makeTx({ cycle_no: 3, financial_approved: true, administrative_approved: true, financial_note: "approved" });
await applyApprovalStatusTransition(leaving.tx, request, user, { id: "1", vin: "000123", status_code: "under_delivery" }, "available_for_sale");
assert(leaving.calls.some((call) => call.text.includes("financial_approved=false,administrative_approved=false")), "leaving under delivery for another state clears the operational approval snapshot");
assert(leaving.calls.filter((call) => call.text.includes("vehicle_approval_history")).length === 2, "clearing current approvals keeps immutable history for both approval types");
assert(auditEvents.some((event) => event.action === "vehicle.approvals_cleared"), "approval clearing is written to the audit trail");
assert(outboxEvents.some((event) => event.eventType === "operations.vehicle.approvals_initialized") && outboxEvents.some((event) => event.eventType === "operations.vehicle.approvals_cleared"), "initialization and clearing publish central outbox events");

console.log("Mandatory under-delivery approval rule tests passed.");
