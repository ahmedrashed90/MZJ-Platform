import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const read = (filename) => readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8');
const operations = read('server/operations/index.ts');
const modal = read('src/operations/components/SalesFollowupQuickApprovalModal.tsx');
const trackingSync = read('server/_tracking-approval-sync.ts');
const gateway = read('server/_api-permissions.ts');
let passed=0;
function check(label, value) { assert.ok(value, label); passed++; console.log(`PASS ${label}`); }

const clause = operations.match(/const pendingApprovalClause = pendingApprovalsOnly \? sql`([\s\S]*?)` : sql`true`;/)?.[1];
check('Candidate listing includes either approval missing', !!clause && clause.includes('stage_6_completed=false or stage_7_completed=false'));
check('Candidate listing never silently hides archived or delivered', !!clause && !/operations_status_code|order_archived|operations_vehicle_id/.test(clause));
check('Every non-cancelled sale with missing approvals is considered, including completed and archived', operations.includes('${pendingApprovalsOnly}=true') && operations.includes('coalesce(o.is_cancelled,false)=false'));
check('Candidate paging and searches preserved', modal.includes('payload.pagination.pages > 1') && operations.includes('limit ${pageSize} offset ${offset}'));
check('Superadmin required at gateway and endpoint', gateway.includes('sales_followup_approval_candidates: "platform.superadmin"') && gateway.includes('sales_followup_approval_action: "platform.superadmin"') && operations.includes('hasPermission(user, "platform.superadmin")'));
check('Archived and completed sales are eligible but cancelled and deleted never are', operations.includes('coalesce(o.is_cancelled,false)=false') && operations.includes('coalesce(o.is_deleted,false)=false'));
check('Guard against older sales for same VIN remains', operations.includes('latest_order.id=tv.id') && operations.includes('latest?.id !== trackingVehicleId'));
check('UI enables archived and external order while preserving invalid VIN guard', !modal.includes('if (row.order_archived) return') && modal.includes('if (row.operations_vehicle_id && !row.order_archived') && !modal.includes('if (!row.operations_vehicle_id) return'));
check('UI confirms retrospective approval and preserves archive', modal.includes('selected.order_archived') && modal.includes('الاحتفاظ بالأرشفة'));
check('Archived stages use specific vehicle not all historical orders', operations.includes('syncTrackingApprovalStagesForTrackingVehicle(tx, trackingVehicleId') && operations.includes('{ allowArchived: true }'));
check('Normal delivered approval and under_delivery approval paths stay intact', operations.includes('syncTrackingApprovalStagesForOperationsVehicle(tx, vehicleId') && operations.includes('return approvalAction(sql, {'));
check('Archived order status is not rewritten by tracking sync', trackingSync.includes('if (changed && !link.is_archived)'));

for (const filename of ['server/operations/index.ts','server/_tracking-approval-sync.ts','src/operations/components/SalesFollowupQuickApprovalModal.tsx']) {
 const parsed = ts.transpileModule(read(filename), {fileName:filename,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}});
 check(`${filename} parses as TypeScript`, !(parsed.diagnostics||[]).some(d=>d.category===ts.DiagnosticCategory.Error));
}

// Run the actual archived/delivered approval function with transaction-scoped
// mock SQL: audit trail, stage sync target, stale sale and cancellation guards.
const start=operations.indexOf('async function recordRetrospectiveSalesFollowupApproval(');
const end=operations.indexOf('async function approveSalesFollowupVehicle(',start);
assert.ok(start>0 && end>start);
const compiled=ts.transpileModule(operations.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
class OperationError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
let syncCalls=[];
const syncAll=async (_tx,id,actor)=>{syncCalls.push({scope:'active',id,actor});};
const syncSingle=async (_tx,id,actor,options)=>{syncCalls.push({scope:'archived',id,actor,options});};
const record = new Function('OperationError','actor','hasPermission','syncTrackingApprovalStagesForOperationsVehicle','syncTrackingApprovalStagesForTrackingVehicle',`${compiled}\nreturn recordRetrospectiveSalesFollowupApproval;`)(
 OperationError,(user)=>({id:user.id,name:'مدير النظام',role:'platform_admin'}),()=>true,syncAll,syncSingle,
);
const vehicleId='11111111-1111-4111-8111-111111111111';
const trackingId='22222222-2222-4222-8222-222222222222';
const who={id:'33333333-3333-4333-8333-333333333333'};
function mockDb({status='delivered',archived=false,cancelled=false,latest=true,previous=null}={}) {
 const state={status,archived,approval:previous,events:[],queries:[]};
 const tx=async (literals,...values)=>{
  const q=literals.join(' ? ').toLowerCase().replace(/\s+/g,' ').trim();state.queries.push(q);
  if(q.includes('from operations.vehicles') && q.includes('for update'))return [{id:vehicleId,vin:'VIN-123',status_code:state.status}];
  if(q.includes('from tracking.order_vehicles tv') && q.includes('tv.id= ? ::uuid'))return cancelled?[]:[{id:trackingId,is_archived:state.archived}];
  if(q.includes('from tracking.order_vehicles tv') && q.includes('order by o.order_date'))return [{id:latest?trackingId:'some-newer-sale'}];
  if(q.includes('from operations.vehicle_approvals') && q.includes('for update'))return state.approval?[state.approval]:[];
  if(q.includes('max(cycle_no)'))return [{next:1}];
  if(q.includes('insert into operations.vehicle_approvals')){state.approval={id:'approval-1',cycle_no:1,financial_approved:false,administrative_approved:false,is_active:false};return [state.approval];}
  if(q.includes('update operations.vehicle_approvals')){const k=q.includes('financial_approved=true')?'financial_approved':'administrative_approved';state.approval={...state.approval,[k]:true};return [state.approval];}
  if(q.includes('insert into operations.approval_events')){state.events.push({note:values[4],action:'approve'});return [];}
  throw new Error(`Unexpected query: ${q.slice(0,250)}`);
 };
 tx.json=(obj)=>obj;
 return {sql:{begin:async(fn)=>fn(tx)},state};
}
// One archived sale, multiple cars: only chosen tracking row syncs.
syncCalls=[];
{
 const {sql,state}=mockDb({archived:true,status:'available_for_sale'});
 const result=await record(sql,vehicleId,trackingId,'financial','اعتماد بعد الأرشفة',who);
 check('Archived sale can be approved without delivery status',result.ok && result.archivedOrder===true && state.approval.financial_approved && !state.approval.administrative_approved);
 check('Archived approval recorded in original approval_events with explanatory note',state.events.length===1 && state.events[0].note.includes('مؤرشف') && state.events[0].note.includes('اعتماد بعد الأرشفة'));
 check('Archived approval uses individual tracking vehicle sync in explicit opt-in mode',syncCalls.length===1 && syncCalls[0].scope==='archived' && syncCalls[0].id===trackingId && syncCalls[0].options.allowArchived===true);
 check('Archived approval does not modify vehicle, delivery, order, archive state',state.status==='available_for_sale' && !state.queries.some(q=>/update (operations\.vehicles|tracking\.orders)|insert into (operations\.movements|operations\.movement_batches)/.test(q)));
 check('Creates no new active stock/delivery cycle',state.approval.is_active===false && state.queries.filter(q=>q.includes('insert into operations.vehicle_approvals')).length===1);
 syncCalls=[];
 await record(sql,vehicleId,trackingId,'administrative','',who);
 check('Administrative approval preserves financial for same car',state.approval.financial_approved && state.approval.administrative_approved && state.events.length===2);
 await assert.rejects(()=>record(sql,vehicleId,trackingId,'financial','',who),e=>e.code==='ALREADY_APPROVED');
 check('Repeated approval blocked without duplicate audit',state.events.length===2);
}
syncCalls=[];
{
 const {sql,state}=mockDb({status:'delivered'});
 const result=await record(sql,vehicleId,trackingId,'financial','موافقة مالية بعد التسليم',who);
 check('Unarchived delivered sale keeps the original retrospective path',result.ok && !result.archivedOrder && state.approval.financial_approved && syncCalls.length===1 && syncCalls[0].scope==='active');
}
for (const [label,args] of [['Cancelled archived orders',{cancelled:true,archived:true}],['Older archived orders',{latest:false,archived:true}],['Unarchived wrong vehicle status',{status:'available_for_sale'}]]) {
 const {sql,state}=mockDb(args);
 await assert.rejects(()=>record(sql,vehicleId,trackingId,'financial','',who),e=>e.code==='VEHICLE_NOT_ELIGIBLE');
 check(`${label} are not approved`,state.events.length===0 && !state.approval);
}
// Test the public endpoint's decision: archived path, normal path and auth.
const endpointStart=operations.indexOf('async function approveSalesFollowupVehicle(');
const endpointEnd=operations.indexOf('async function completeSalesOrderFollowup(',endpointStart);
const endpointJS=ts.transpileModule(operations.slice(endpointStart,endpointEnd),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
let route=[];
const handler=new Function('OperationError','clean','hasPermission','recordRetrospectiveSalesFollowupApproval','approvalAction',`${endpointJS}\nreturn approveSalesFollowupVehicle;`)(
 OperationError,(x)=>String(x??'').trim(),(user,perm)=>Boolean(user.superadmin),
 async (...args)=>{route.push({type:'retrospective',args});return {ok:true};},
 async (...args)=>{route.push({type:'normal',args});return {ok:true};},
);
const mockUser={...who,superadmin:true};
function row(status_code,order_archived,financial_approved=false){return {operations_vehicle_id:vehicleId,vin:'VIN-123',status_code,order_archived,financial_approved,administrative_approved:false};}
function sqlTarget(target){return async()=>target?[target]:[];}
const input={vehicleId,trackingVehicleId:trackingId,approvalType:'financial'};
route=[];await handler(sqlTarget(row('available_for_sale',true)),input,mockUser);
check('Public endpoint routes archived non-delivered order to retrospective approval',route.length===1 && route[0].type==='retrospective');
route=[];await handler(sqlTarget(row('delivered',false)),input,mockUser);
check('Public endpoint keeps delivered retrospective',route.length===1 && route[0].type==='retrospective');
route=[];await handler(sqlTarget(row('under_delivery',false)),input,mockUser);
check('Public endpoint retains normal pending delivery approval behavior',route.length===1 && route[0].type==='normal');
await assert.rejects(()=>handler(sqlTarget(row('delivered',true)),input,{...mockUser,superadmin:false}),e=>e.code==='FORBIDDEN');
check('Only superadmin can act through quick approval',true);
await assert.rejects(()=>handler(sqlTarget(null),input,mockUser),e=>e.code==='VEHICLE_NOT_ELIGIBLE');
check('Missing, cancelled or older order rejected by public endpoint',true);
await assert.rejects(()=>handler(sqlTarget(row('delivered',true)),{...input,trackingVehicleId:'bad-id'},mockUser),e=>e.code==='VALIDATION_ERROR');
check('Invalid UUID is rejected while valid 36-character UUID works',true);
check('Archive quick approval uses the complete UUID format',operations.includes('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i'));
console.log(`Archived/active approval tests: ${passed}/${passed} PASS`);
