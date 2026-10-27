import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript");
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const operations = read("server/operations/index.ts");
const schema = read("server/_tracking-schema.ts");
const syncSource = read("server/_tracking-approval-sync.ts");
const modal = read("src/operations/components/SalesFollowupQuickApprovalModal.tsx");
const gateway = read("server/_api-permissions.ts");
let passed = 0;
function check(label, truth) { assert.ok(truth, label); passed++; console.log(`PASS ${label}`); }
class OperationError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
for (const file of ["server/operations/index.ts", "server/_tracking-schema.ts", "server/_tracking-approval-sync.ts", "src/operations/components/SalesFollowupQuickApprovalModal.tsx"]) {
  const result = ts.transpileModule(read(file), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  });
  check(`${file} has no TS parse errors`, !(result.diagnostics || []).some((d) => d.category === ts.DiagnosticCategory.Error));
}
check("External approvals keyed by tracking vehicle rather than VIN", schema.includes("tracking_vehicle_id uuid primary key references tracking.order_vehicles(id)"));
check("External approvals retain financial and administrative actor/time", schema.includes("financial_approved_at timestamptz") && schema.includes("administrative_approved_by_name text"));
check("External approvals have separate append-only audit events", schema.includes("create table if not exists tracking.sale_vehicle_approval_events"));
check("Followup combines stock and external approval state", operations.includes("(coalesce(external_approval.financial_approved,false) or coalesce(current_approval.financial_approved,false)) as stage_6_completed") && operations.includes("(coalesce(external_approval.administrative_approved,false) or coalesce(current_approval.administrative_approved,false)) as stage_7_completed"));
check("Tracking sync reads external approvals without manufacturing inventory rows", syncSource.includes("tracking.sale_vehicle_approvals external_approval") && syncSource.includes("coalesce(ov.vin,tv.vin)"));
check("UI allows missing operations_vehicle_id", !modal.includes('if (!row.operations_vehicle_id) return') && !modal.includes('if (!selected?.operations_vehicle_id'));
check("UI sends trackingVehicleId even without inventory ID", modal.includes("...(selected.operations_vehicle_id ? { vehicleId: selected.operations_vehicle_id } : {})"));
check("Superadmin still required by gateway and route", gateway.includes('sales_followup_approval_action: "platform.superadmin"') && operations.includes('hasPermission(user, "platform.superadmin")'));
check("Candidate listing accepts all non-cancelled sale orders with missing approval", operations.includes("${pendingApprovalsOnly}=true") && operations.includes("stage_6_completed=false or stage_7_completed=false"));
check("No fake inventory created in external approval writer", !operations.slice(operations.indexOf("async function recordExternalSalesFollowupApproval("),operations.indexOf("async function approveSalesFollowupVehicle(")).includes("insert into operations.vehicles"));

const externalStart = operations.indexOf("async function recordExternalSalesFollowupApproval(");
const endpointStart = operations.indexOf("async function approveSalesFollowupVehicle(", externalStart);
const endpointEnd = operations.indexOf("async function completeSalesOrderFollowup(", endpointStart);
check("External approval and endpoint functions exist", externalStart >= 0 && endpointStart > externalStart && endpointEnd > endpointStart);
const compile = (slice) => ts.transpileModule(slice, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const carId = "12345678-1234-4234-8234-123456789012";
const orderId = "d2345678-1234-4234-8234-123456789012";
const userId = "c2345678-1234-4234-8234-123456789012";
const vin = "236359";
const user = { id: userId, role: "system_admin", superadmin: true };
let syncCalls = [];
const sync = async (_tx, id, actor, options) => { syncCalls.push({ id, actor, options }); return { changed: 1 }; };
const external = new Function("OperationError", "actor", "hasPermission", "syncTrackingApprovalStagesForTrackingVehicle", `${compile(operations.slice(externalStart, endpointStart))}\nreturn recordExternalSalesFollowupApproval;`)(
  OperationError, () => ({ id: userId, name: "مدير النظام", role: "system_admin" }), (u, name) => Boolean(u.superadmin), sync,
);
function dbHarness({ archived = false, cancelled = false, inventoryLinked = false, latest = true } = {}) {
  const state = { approvals: null, events: [], queries: [], archived, cancelled, inventoryLinked, latest };
  const tx = async (literals, ...values) => {
    const query = literals.join(" ? ").toLowerCase().replace(/\s+/g," ").trim();
    state.queries.push({query,values});
    if (query.includes("from tracking.order_vehicles tv") && query.includes("for update of tv")) {
      if (state.cancelled) return [];
      return [{ tracking_vehicle_id: carId, vin, order_id: orderId,
        sales_order_no: "SAL-ORD-2026-00927", is_archived: state.archived,
        operations_vehicle_id: state.inventoryLinked ? "stock-car" : null }];
    }
    if (query.includes("select newer_tv.id::text as id")) return [{ id: state.latest ? carId : "newer-transaction" }];
    if (query.includes("insert into tracking.sale_vehicle_approvals")) {
      if (!state.approvals) state.approvals = { tracking_vehicle_id:carId, financial_approved:false, administrative_approved:false };
      return [];
    }
    if (query.includes("select * from tracking.sale_vehicle_approvals") && query.includes("for update")) return [{ ...state.approvals }];
    if (query.includes("update tracking.sale_vehicle_approvals")) {
      if (query.includes("financial_approved=true")) state.approvals.financial_approved = true;
      else if (query.includes("administrative_approved=true")) state.approvals.administrative_approved = true;
      return [{ ...state.approvals }];
    }
    if (query.includes("insert into tracking.sale_vehicle_approval_events")) {
      state.events.push({ car: values[0], order: values[1], type: values[2], note: values[7] }); return [];
    }
    throw new Error(`Unexpected query: ${query.slice(0,180)}`);
  };
  tx.json = (obj) => obj;
  return { sql: { begin: (fn) => fn(tx) }, state };
}
{
  syncCalls = [];
  const { sql, state } = dbHarness();
  const financial = await external(sql, carId, "financial", "موافقة من خارج المخزون", user);
  check("Financial external approval succeeds", financial.ok && financial.externalVehicle && state.approvals.financial_approved && !state.approvals.administrative_approved);
  check("Approval uses exact Tracking vehicle and sale order", state.events.length === 1 && state.events[0].car === carId && state.events[0].order === orderId);
  check("Financial approval syncs stage 6 on chosen Tracking car", syncCalls.length === 1 && syncCalls[0].id === carId);
  await external(sql, carId, "administrative", "اعتماد الإدارة", user);
  check("Administrative approval preserves financial", state.approvals.financial_approved && state.approvals.administrative_approved && state.events.length === 2);
  check("No inventory rows, movements or order status updated", !state.queries.some(({query}) => /(insert into operations\.vehicles|update operations\.vehicles|insert into operations\.movements|update tracking\.orders)/.test(query)));
  await assert.rejects(() => external(sql, carId, "financial", "", user), (e) => e.code === "ALREADY_APPROVED");
  check("Repeated approvals fail without duplicate events", state.events.length === 2);
}
{
  syncCalls = [];
  const { sql } = dbHarness({ archived:true });
  const result = await external(sql, carId, "financial", "", user);
  check("Archived external sale supports late approval", result.archivedOrder === true && syncCalls[0].options.allowArchived === true);
}
for (const [label,setup] of [
  ["Cancelled sales", { cancelled:true }],
  ["Older sales of same VIN", { latest:false }],
  ["Cars that do have a valid inventory link", { inventoryLinked:true }],
]) {
  const { sql, state } = dbHarness(setup);
  await assert.rejects(() => external(sql,carId,"financial","",user), (e) => e.code === "VEHICLE_NOT_ELIGIBLE");
  check(`${label} cannot accidentally use external approvals`, state.events.length===0);
}
{
  const { sql } = dbHarness();
  await assert.rejects(() => external(sql,carId,"financial","",{...user,superadmin:false}), (e) => e.code === "FORBIDDEN");
  check("Non-superadmin cannot approve external car", true);
}
// The public entrypoint must dispatch without a synthetic inventory ID and
// preserve normal inventory/retrospective routes.
let routes = [];
const endpoint = new Function(
  "OperationError","clean","hasPermission","recordExternalSalesFollowupApproval","recordRetrospectiveSalesFollowupApproval","approvalAction",
  `${compile(operations.slice(endpointStart, endpointEnd))}\nreturn approveSalesFollowupVehicle;`,
)(
  OperationError, (v) => String(v ?? "").trim(), (u) => u.superadmin,
  async (...args) => { routes.push(["external",args]);return {ok:true}; },
  async (...args) => { routes.push(["retrospective",args]);return {ok:true}; },
  async (...args) => { routes.push(["normal",args]);return {ok:true}; },
);
const mockTarget = (x) => async () => x ? [x] : [];
const payload = { trackingVehicleId: carId, approvalType: "financial" };
{
  routes=[];
  await endpoint(mockTarget({ tracking_vehicle_id: carId, operations_vehicle_id:null, financial_approved:false, administrative_approved:false }),payload,user);
  check("Quick approval routes external sales without stock ID",routes.length===1&&routes[0][0]==="external"&&routes[0][1][1]===carId);
}
{
  routes=[];
  await endpoint(mockTarget({ operations_vehicle_id:orderId, status_code:"under_delivery", financial_approved:false }), { ...payload, vehicleId: orderId }, user);
  check("Existing under-delivery inventory approval unchanged",routes.length===1&&routes[0][0]==="normal");
  routes=[];
  await endpoint(mockTarget({ operations_vehicle_id:orderId, status_code:"delivered", financial_approved:false }), { ...payload, vehicleId: orderId }, user);
  check("Existing delivered inventory approval unchanged",routes.length===1&&routes[0][0]==="retrospective");
  await assert.rejects(()=>endpoint(mockTarget({ operations_vehicle_id:null }),{...payload,vehicleId:orderId},user),(e)=>e.code==="VEHICLE_NOT_ELIGIBLE");
  check("Forged or stale inventory link rejected",true);
}
console.log(`External sales approvals: ${passed}/${passed} PASS`);
