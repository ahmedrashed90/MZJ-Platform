import assert from "node:assert/strict";
import fs from "node:fs";
import { syncTrackingApprovalStagesForTrackingVehicle, syncTrackingApprovalStagesForOperationsVehicle, isApprovalControlledTrackingStage } from "../server/_tracking-approval-sync.ts";

const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");

assert.equal(isApprovalControlledTrackingStage(6), true);
assert.equal(isApprovalControlledTrackingStage("7"), true);
assert.equal(isApprovalControlledTrackingStage(5), false);
assert.equal(isApprovalControlledTrackingStage(10), false);

const operations = read("server/operations/index.ts");
const tracking = read("server/tracking/orders.ts");
const trackingPage = read("src/tracking/pages/TrackingOrdersPage.tsx");
const trackingUtils = read("server/_tracking-utils.ts");
const approvalCycle = read("server/_operations-approval-cycle.ts");
assert.match(operations, /coalesce\(current_approval\.financial_approved,false\) as stage_6_completed/);
assert.match(operations, /coalesce\(current_approval\.administrative_approved,false\) as stage_7_completed/);
assert.match(operations, /await syncTrackingApprovalStagesForOperationsVehicle\(tx, vehicleId/);
assert.match(tracking, /if \(isApprovalControlledTrackingStage\(row.sort_order\)\)/);
assert.match(trackingPage, /!approvalControlled && !selected.is_archived/);
assert.match(trackingPage, /!\[6, 7\]\.includes\(Number\(stage.sort_order\)\)/);
assert.match(trackingUtils, /join tracking.stages stage_info on stage_info.id=e.stage_id and stage_info.sort_order not in \(6,7\)/);
assert.match(trackingUtils, /await syncTrackingApprovalStagesForTrackingVehicle\(sql, vehicleId\)/);
assert.match(approvalCycle, /await syncTrackingApprovalStagesForOperationsVehicle\(tx, vehicleId\)/);

const stageIds = {6: "stage-financial", 7: "stage-admin"};
function dbHarness({ financial = false, administrative = false, stages = {6: "pending", 7: "pending"}, latest = true, oldOrder = false, linked = true } = {}) {
  const state = {
    link: {
      tracking_vehicle_id: "tracking-vehicle-1", order_id: "order-1",
      is_archived: oldOrder, is_deleted: false, is_cancelled: false,
      operations_vehicle_id: linked ? "operations-vehicle-1" : null,
      vin: "VIN229838", financial_approved: financial,
      administrative_approved: administrative,
      financial_approved_by: "financial-actor", administrative_approved_by: "admin-actor",
      financial_approved_by_name: "مسؤول مالي", administrative_approved_by_name: "مسؤول إداري",
      financial_approved_at: "2026-10-26T09:00:00Z", administrative_approved_at: "2026-10-26T09:05:00Z",
    },
    statuses: {...stages}, events: [], changed: [], orderStatus: "in_progress", latest, 
    queries: [],
  };
  async function sql(strings, ...values) {
    const query = strings.join(" ").replace(/\s+/g, " ").trim().toLowerCase();
    state.queries.push(query);
    if (query.includes("from tracking.order_vehicles tv") && query.includes("left join lateral") && query.includes("approval.financial_approved")) return [state.link];
    if (query.includes("select tv.id::text as id from tracking.order_vehicles tv")) return [{id: state.latest ? "tracking-vehicle-1" : "older-other-vehicle"}];
    if (query.includes("select tv.id::text from tracking.order_vehicles tv") && query.includes("join operations.vehicles ov")) return [{id: "tracking-vehicle-1"}];
    if (query.includes("from tracking.stages s") && query.includes("vs.status as prior_status")) return [6,7].map(n=>({id:stageIds[n],sort_order:n,prior_status:state.statuses[n] ?? null}));
    if (query.includes("insert into tracking.vehicle_stages")) {
      const stageNo = values[1] === stageIds[6] ? 6 : 7;
      const desired = values[2];
      const prior = state.statuses[stageNo];
      state.statuses[stageNo] = desired;
      if(prior === desired) return [];
      state.changed.push({stageNo, desired, approvedBy:values[3]});
      return [{id:"row-"+stageNo}];
    }
    if (query.includes("insert into tracking.stage_events")) {
      state.events.push({stageId: values[2],action:values[3],actorId:values[4]});
      return [];
    }
    if (query.includes("from tracking.order_vehicles tv") && query.includes("count(vs.id)::int as total")) return [{total:10, completed:8+Object.values(state.statuses).filter(s=>s==="completed").length}];
    if (query.includes("update tracking.orders set status")) {state.orderStatus=values[0]; return [];}
    throw new Error(`Unexpected database query: ${query.slice(0,150)}`);
  }
  return {state, sql};
}

// One approval is one Tracking stage, never the sibling or the other approval.
{
  const {state,sql} = dbHarness({financial:true});
  const result = await syncTrackingApprovalStagesForTrackingVehicle(sql, "tracking-vehicle-1", {id:"finance-user",name:"مدير المالية"});
  assert.deepEqual(state.statuses,{6:"completed",7:"pending"});
  assert.equal(result.changed,1);
  assert.deepEqual(state.events.map(e=>e.action),["completed"]);
  assert.equal(state.events[0].stageId,stageIds[6]);
  assert.equal(state.orderStatus,"in_progress");
  const again=await syncTrackingApprovalStagesForTrackingVehicle(sql,"tracking-vehicle-1");
  assert.equal(again.changed,0);
  assert.equal(state.events.length,1,"idempotent reads cannot duplicate approval audit events");
}
// Approving both marks both complete, without counting the sales order twice.
{
  const {state,sql} = dbHarness({financial:true,administrative:true});
  await syncTrackingApprovalStagesForTrackingVehicle(sql,"tracking-vehicle-1");
  assert.deepEqual(state.statuses,{6:"completed",7:"completed"});
  assert.equal(state.orderStatus,"completed");
  assert.deepEqual(state.events.map(e=>e.stageId),[stageIds[6],stageIds[7]]);
}
// Reverting financial leaves administrative complete and status in progress.
{
  const {state,sql} = dbHarness({financial:false,administrative:true,stages:{6:"completed",7:"completed"}});
  await syncTrackingApprovalStagesForTrackingVehicle(sql,"tracking-vehicle-1",{id:"revert-user",name:"مراجع"});
  assert.deepEqual(state.statuses,{6:"pending",7:"completed"});
  assert.deepEqual(state.events,[{stageId:stageIds[6],action:"reverted",actorId:"revert-user"}]);
  assert.equal(state.orderStatus,"in_progress");
}
// Reset button clears both stages, preserving tracking history via revert events.
{
  const {state,sql} = dbHarness({financial:false,administrative:false,stages:{6:"completed",7:"completed"}});
  await syncTrackingApprovalStagesForTrackingVehicle(sql,"tracking-vehicle-1",{id:"reset-user",name:"مشرف"});
  assert.deepEqual(state.statuses,{6:"pending",7:"pending"});
  assert.deepEqual(state.events.map(e=>e.action),["reverted","reverted"]);
  assert.equal(state.orderStatus,"in_progress");
}
// Old manually completed Tracking milestones cannot override missing approvals.
{
  const {state,sql} = dbHarness({stages:{6:"completed",7:"pending"}});
  await syncTrackingApprovalStagesForTrackingVehicle(sql,"tracking-vehicle-1");
  assert.equal(state.statuses[6],"pending");
}
// Archived historical orders and older active orders for the same VIN are untouched.
for(const setup of [{oldOrder:true},{latest:false}]) {
  const {state,sql}=dbHarness({...setup,financial:true,administrative:true});
  const res=await syncTrackingApprovalStagesForTrackingVehicle(sql,"tracking-vehicle-1");
  assert.equal(res.changed,0);
  assert.deepEqual(state.statuses,{6:"pending",7:"pending"});
}
// Explicit retrospective write on newest archived order updates only 6/7;
// it never unarchives or rewrites the historical tracking order's status.
{
  const {state,sql}=dbHarness({oldOrder:true,financial:true,administrative:false});
  const result=await syncTrackingApprovalStagesForTrackingVehicle(sql,"tracking-vehicle-1",{id:"superadmin",name:"مدير النظام"},{allowArchived:true});
  assert.equal(result.changed,1);
  assert.deepEqual(state.statuses,{6:"completed",7:"pending"});
  assert.equal(state.events.length,1);
  assert.equal(state.orderStatus,"in_progress");
  assert.ok(!state.queries.some(q=>q.includes("update tracking.orders set status")));
}
{
  const {state,sql}=dbHarness({oldOrder:true,financial:true,latest:false});
  const result=await syncTrackingApprovalStagesForTrackingVehicle(sql,"tracking-vehicle-1",{}, {allowArchived:true});
  assert.equal(result.changed,0);
  assert.deepEqual(state.statuses,{6:"pending",7:"pending"});
}
// Operations approval actions call the same canonical routine with no second source.
{
  const {state,sql}=dbHarness({financial:true,administrative:false});
  await syncTrackingApprovalStagesForOperationsVehicle(sql,"operations-vehicle-1",{id:"finance-user"});
  assert.equal(state.statuses[6],"completed");
  assert.equal(state.statuses[7],"pending");
}
console.log("PASS: operations approvals exclusively own tracking 6/7; approve, revert, reset, historic, idempotency, multi-vehicle guards, and UI/API write protection");
