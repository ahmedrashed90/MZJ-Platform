import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const read = (filename) => readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8');
const operations = read('server/operations/index.ts');
const modal = read('src/operations/components/SalesFollowupQuickApprovalModal.tsx');
const types = read('src/operations/types.ts');
const gateway = read('server/_api-permissions.ts');
const checks = [];
function check(label, value) { assert.ok(value, label); checks.push(label); console.log(`PASS ${label}`); }

const clause = operations.match(/const pendingApprovalClause = pendingApprovalsOnly \? sql`([\s\S]*?)` : sql`true`;/)?.[1];
check('Candidates include every missing approval from the same followup cohort', !!clause && clause.includes('stage_6_completed=false or stage_7_completed=false'));
check('Candidates do not exclude delivered, archived, or unmatched records silently', !!clause && !/operations_status_code|order_archived|operations_vehicle_id|normalized_vin/.test(clause));
check('Summary and candidate counts both derive from scopedRows', operations.includes('with scoped as (${scopedRows}) select count(*)::int as total from scoped where ${statusClause} and ${pendingApprovalClause}'));
check('Paginated candidate listing retains full search and paging', operations.includes('limit ${pageSize} offset ${offset}') && modal.includes('payload.pagination.pages > 1'));
check('Normal approval route still requires platform.superadmin', gateway.includes('sales_followup_approval_candidates: "platform.superadmin"') && gateway.includes('sales_followup_approval_action: "platform.superadmin"'));
check('Actions revalidate not-cancelled and not-archived sale', operations.includes('and latest_order.id=tv.id') && operations.includes('coalesce(o.is_cancelled,false)=false') && operations.includes('coalesce(o.is_archived,false)=false'));
check('UI reports non-actionable records but keeps them in the list', modal.includes('approvalUnavailableReason(row)') && modal.includes('selected.operations_status_code === "delivered"'));
check('Approvals on previously delivered cars are retrospective', operations.includes('async function recordDeliveredSalesFollowupApproval(') && operations.includes('return recordDeliveredSalesFollowupApproval('));
check('Existing under-delivery route remains the canonical approvalAction', operations.includes('return approvalAction(sql, {') && operations.includes('approvalAction: "approve"'));
check('No changes to other tracking stage control', operations.includes('await syncTrackingApprovalStagesForOperationsVehicle(tx, vehicleId'));
check('Types include archive status', types.includes('order_archived?: boolean'));

for (const filename of ['server/operations/index.ts','src/operations/types.ts','src/operations/components/SalesFollowupQuickApprovalModal.tsx']) {
  const parsed=ts.transpileModule(read(filename),{fileName:filename,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}});
  check(`${filename} parses as TypeScript`, !(parsed.diagnostics||[]).some(d=>d.category===ts.DiagnosticCategory.Error));
}

// Execute the actual delivered-vehicle approval function with an in-memory SQL
// transaction harness, rather than only checking that strings exist.
const start=operations.indexOf('async function recordDeliveredSalesFollowupApproval(');
const end=operations.indexOf('async function approveSalesFollowupVehicle(',start);
assert.ok(start>0 && end>start);
const compiled=ts.transpileModule(operations.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
class OperationError extends Error { constructor(status,code,message) {super(message);this.status=status;this.code=code;} }
let syncCalls=[];
const sync=async (_tx, id, actor)=> {syncCalls.push({id,actor});};
const fun=new Function('OperationError','actor','hasPermission','syncTrackingApprovalStagesForOperationsVehicle',`${compiled}\nreturn recordDeliveredSalesFollowupApproval;`)(OperationError,(user)=>({id:user.id,name:'مدير النظام',role:'platform_admin'}),()=>true,sync);
const vehicleId='11111111-1111-4111-8111-111111111111';
const trackingId='22222222-2222-4222-8222-222222222222';
const who={id:'33333333-3333-4333-8333-333333333333'};

function mockDb({status='delivered',cancelled=false,latest=true,previous=null}={}) {
  const state={status,approval:previous,events:[],queries:[]};
  const tx=async (literals,...values)=> {
    const q=literals.join(' ? ').toLowerCase().replace(/\s+/g,' ').trim();state.queries.push(q);
    if(q.includes('from operations.vehicles') && q.includes('for update'))return [{id:vehicleId,vin:'VIN-123',status_code:state.status}];
    if(q.includes('from tracking.order_vehicles tv') && q.includes('tv.id= ? ::uuid'))return cancelled?[]:[{id:trackingId}];
    if(q.includes('from tracking.order_vehicles tv') && q.includes('order by o.order_date'))return [{id:latest?trackingId:'another-tracking-vehicle'}];
    if(q.includes('from operations.vehicle_approvals') && q.includes('for update'))return state.approval?[state.approval]:[];
    if(q.includes('max(cycle_no)'))return [{next:1}];
    if(q.includes('insert into operations.vehicle_approvals')){state.approval={id:'approval-1',cycle_no:1,financial_approved:false,administrative_approved:false,is_active:false};return [state.approval];}
    if(q.includes('update operations.vehicle_approvals')){
      const k=q.includes('financial_approved=true')?'financial_approved':'administrative_approved';
      state.approval={...state.approval,[k]:true};return [state.approval];
    }
    if(q.includes('insert into operations.approval_events')){state.events.push('approval_saved');return [];}
    throw new Error(`Unexpected query: ${q.slice(0,250)}`);
  };
  tx.json=(obj)=>obj;
  return { sql:{begin:async(fn)=>fn(tx)},state};
}

syncCalls=[];
{
  const {sql,state}=mockDb();
  const result=await fun(sql,vehicleId,trackingId,'financial','استيفاء مالي لاحق',who);
  check('Delivered approval writes to the canonical record',result.ok && state.approval.financial_approved && !state.approval.administrative_approved);
  check('Retrospective approval creates an inactive cycle only when none exists',state.approval.is_active===false);
  check('Delivered approval produces an approval audit event',state.events.length===1);
  check('Delivered approval synchronizes tracking stages 6/7',syncCalls.length===1&&syncCalls[0].id===vehicleId);
  check('Delivered approval never changes inventory status or movement',state.status==='delivered' && !state.queries.some(q=>q.includes('operations.movements') || q.includes('movement_batches') || q.includes('update operations.vehicles')));
  syncCalls=[];
  await fun(sql,vehicleId,trackingId,'administrative','استيفاء إداري لاحق',who);
  check('The second approval keeps the first and records a separate audit event',state.approval.financial_approved&&state.approval.administrative_approved&&state.events.length===2);
  await assert.rejects(()=>fun(sql,vehicleId,trackingId,'financial','',who),(err)=>err.code==='ALREADY_APPROVED');
  check('Duplicate approval is rejected without overwriting history',state.events.length===2);
}
for (const [label,args] of [['Cancelled orders',{cancelled:true}],['Older orders',{latest:false}],['Wrong vehicle state',{status:'available_for_sale'}]]) {
  const {sql,state}=mockDb(args);
  await assert.rejects(()=>fun(sql,vehicleId,trackingId,'financial','',who),(err)=>err.code==='VEHICLE_NOT_ELIGIBLE');
  check(`${label} cannot be retrospectively approved`,state.events.length===0 && !state.approval);
}
console.log(`All-missing-approvals check: ${checks.length}/${checks.length} PASS`);
