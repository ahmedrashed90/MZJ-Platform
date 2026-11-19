import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts=require('typescript');
const read=(file)=>fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
const code=read('server/_crm-inbox-agent-engine.ts');
const source=read('server/crm/inbox.ts');
const ui=read('src/crm/pages/CrmInboxPage.tsx');
const life=read('server/_crm-lifecycle.ts');
const cron=read('server/internal/inbox-auto-assign-tick.ts');
function compile(s,name){const c=ts.transpileModule(s,{fileName:name,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}});assert.equal((c.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error).length,0,name);return c.outputText;}
for(const p of ['server/_crm-inbox-agent-engine.ts','server/_crm-lifecycle.ts','server/crm/inbox.ts','server/internal/inbox-auto-assign-tick.ts','src/crm/pages/CrmInboxPage.tsx'])compile(read(p),p);
assert.match(code,/auto_classify_started_at/);
assert.match(code,/c.last_customer_message_at >= \$\{settings.auto_classify_started_at\}/);
assert.match(code,/acquireInboxAutoAssignLease/);
assert.match(code,/auto_assign_lease_expires_at=now\(\)\+interval '90 seconds'/);
assert.match(code,/classifyConversationService\(/);
assert.match(code,/classificationMethod:'unclassified_auto_assignment'/);
assert.match(life,/assignmentOverride\?:/);
assert.match(life,/input.assignmentOverride \|\|/);
assert.match(cron,/acquireInboxAutoAssignLease\(\)/);
assert.doesNotMatch(cron,/tryWithDatabaseAdvisoryLock/);
assert.match(source,/if \(request.method === "DELETE"\)/);
assert.match(source,/last_customer_message_at is not distinct from/);
assert.match(source,/inboxDismissedAt/g);
assert.doesNotMatch(source,/delete from crm.conversations/i);
assert.match(ui,/مسح من غير مصنفة/);
assert.match(ui,/method:"DELETE"/);
console.log('PASS: parse, schema, expiring lease, canonical lifecycle and non-destructive removal');

function bed({eligible='cash',history=false,assigned=false,ambiguous=false,busy=false,phone='966512345678',leaseBusy=false,existingRequest=false}={}){
 const id='11111111-1111-4111-8111-111111111111',contact='22222222-2222-4222-8222-222222222222', repId='33333333-3333-4333-8333-333333333333';
 const createdAt=new Date(Date.now()-3*60_000).toISOString();
 const candidate={id,contact_id:contact,channel_code:'instagram',created_at:createdAt,last_customer_message_at:createdAt,classification_state:'new'};
 const current={...candidate,lead_id:null,service_request_id:existingRequest?'11111111-1111-4111-8111-888888888888':null,assigned_to:assigned?repId:null,lead_assigned_to:null,metadata:{},status:'open',branch_code:null};
 const calls=[],auto=[],alerts=[],selected=[],lockCalls=[];
 const settings={enabled:true,auto_assign_minutes:1,auto_classify_started_at:new Date(Date.now()-5*60_000).toISOString(),unassigned_alert_phone:phone,engine_v2:true};
 const sql=async (parts,...params)=>{
   const query=parts.join(' ? ').replace(/\s+/g,' ').trim();calls.push({query,params});
   if(query.includes('from crm.inbox_agent_settings where id=')) return [settings];
   if(query.includes('select engine_v2 from crm.inbox_agent_settings'))return [{engine_v2:true}];
   if(query.includes('order by (case when c.classification_state'))return history?[]:[candidate];
   if(query.includes('left join crm.leads l on l.id=c.lead_id')&&query.includes('where c.id='))return [current];
   if(query.includes('from crm.service_requests'))return [];
   if(query.includes('from core.users where id='))return [{id:repId,full_name:'Sales Rep'}];
   if(query.includes('from core.user_system_departments'))return ambiguous?[{code:'cash_sales'},{code:'finance_sales'}]:[{code:'finance_sales'}];
   if(query.includes('from crm.inbox_agent_logs'))return [];
   if(query.includes('set auto_assign_lease_owner='))return leaseBusy?[]:[{id:'default'}];
   return [];
 };
 sql.json=x=>x;
 const imports={
  './_db.js':{getSql:()=>sql,tryWithDatabaseAdvisoryLock:async(k,cb)=>{lockCalls.push(k);return busy?{acquired:false}:{acquired:true,result:await cb()}}},
  './_crm-utils.js':{clean:x=>String(x??'').trim(),normalizePhone:x=>String(x??''),sourceLabel:x=>x,chooseAssignment:async(svc,branch,source)=>{selected.push({svc,branch,source});return {assignedTo:eligible===svc?repId:null,assignedName:'Sales Rep',branchCode:'hall',ruleId:id};}},
  './_crm-messaging.js':{deliverConversationMessage:async()=>{},deliverDirectWhatsapp:async x=>{alerts.push(x)}},
  './_crm-lifecycle.js':{classifyConversationService:async x=>{auto.push(x);return {leadId:id,request:{id}}}},
  'node:crypto':{randomUUID:()=>id},
 };
 const mod={exports:{}};
 vm.runInNewContext(compile(code,'server/_crm-inbox-agent-engine.ts'),{module:mod,exports:mod.exports,require:k=>{assert.ok(k in imports,`unknown import ${k}`);return imports[k]},process,console,Date,Number,String,Math,Boolean,Set,Map,Error});
 return {engine:mod.exports,calls,auto,alerts,selected,settings,lockCalls};
}
{
 const t=bed(),out=await t.engine.runAutoAssign();assert.equal(out.assigned,1);assert.equal(out.failed,0);assert.equal(out.skipped,0);
 assert.equal(t.auto[0].serviceKey,'cash');assert.equal(t.auto[0].classificationMethod,'unclassified_auto_assignment');
 assert.equal(t.auto[0].assignmentOverride.assignedTo,'33333333-3333-4333-8333-333333333333');
 assert.equal(t.auto[0].skipAutomaticTemplate,true);assert.deepEqual(t.selected.map(x=>x.svc),['cash']);
 assert.ok(t.calls.some(x=>x.query.includes('last_customer_message_at >= ? ::timestamptz')));
 console.log('PASS: fresh conversation -> one rep, one service request lifecycle without second rotation');
}
{
 const t=bed({eligible:'finance'}),out=await t.engine.runAutoAssign();assert.equal(out.assigned,1);
 assert.equal(t.auto[0].serviceKey,'finance');assert.deepEqual(t.selected.map(x=>x.svc),['cash','finance']);
 console.log('PASS: configured finance fallback chooses finance classification');
}
{
 const t=bed({assigned:true}),out=await t.engine.runAutoAssign();assert.equal(out.assigned,1);
 assert.equal(t.auto[0].assignmentOverride.assignedTo,'33333333-3333-4333-8333-333333333333');assert.equal(t.auto[0].serviceKey,'finance');assert.equal(t.selected.length,0);
 console.log('PASS: preassigned owner retained and unambiguous department inferred');
}
{
 const t=bed({assigned:true,ambiguous:true}),out=await t.engine.runAutoAssign();assert.equal(out.assigned,0);assert.equal(out.skipped,1);assert.equal(t.auto.length,0);assert.equal(t.alerts.length,0);
 console.log('PASS: ambiguous existing rep is neither misclassified nor sent to dedicated unassigned phone');
}
{
 const t=bed({history:true}),out=await t.engine.runAutoAssign();assert.equal(out.assigned,0);assert.equal(t.auto.length,0);
 console.log('PASS: historical conversations are not automatically accepted');
}
{
 const t=bed({existingRequest:true}),out=await t.engine.runAutoAssign();assert.equal(out.assigned,0);assert.equal(t.auto.length,0);
 console.log('PASS: already classified requests are not duplicated');
}
{
 const t=bed({eligible:'none'}),out=await t.engine.runAutoAssign();assert.equal(out.assigned,0);assert.equal(out.skipped,1);
 assert.equal(t.alerts.length,1);assert.equal(t.alerts[0].phone,'966512345678');
 console.log('PASS: unassignable new lead alerts only the chosen phone');
}
{
 const t=bed({eligible:'none',phone:''}),out=await t.engine.runAutoAssign();assert.equal(out.assigned,0);assert.equal(t.alerts.length,0);
 console.log('PASS: unassigned notification never falls back to four normal numbers');
}
{
 const t=bed({busy:true}),out=await t.engine.runAutoAssign();assert.equal(out.assigned,0);assert.equal(out.skipped,1);
 console.log('PASS: per-contact non-blocking lock prevents duplicate work');
}
{
 const t=bed(),lease=await t.engine.acquireInboxAutoAssignLease();assert.equal(lease.acquired,true);
 await lease.release();assert.ok(t.calls.some(x=>x.query.includes('auto_assign_lease_owner=null')));
 const busy=bed({leaseBusy:true}),lease2=await busy.engine.acquireInboxAutoAssignLease();assert.equal(lease2.acquired,false);
 await lease2.release();
 console.log('PASS: expiring DB lease acquire, release and busy path');
}
console.log('ALL NEW CRM UNCLASSIFIED TESTS PASSED');
