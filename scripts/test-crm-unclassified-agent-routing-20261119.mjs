import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url),'utf8');
const engineSource = read('server/_crm-inbox-agent-engine.ts');
const settingsSource = read('server/crm/inbox-agent.ts');
const uiSource = read('src/crm/pages/CrmInboxAgentPage.tsx');
const inboxSource = read('server/crm/inbox.ts');
const inboxUi = read('src/crm/pages/CrmInboxPage.tsx');
const cronSource = read('server/internal/inbox-agent-tick.ts');
const roles = read('server/_access-control-schema.ts');

function compile(source, name) {
  const result = ts.transpileModule(source, {fileName:name,reportDiagnostics:true,compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,
  }});
  const errors=(result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
  assert.equal(errors.length,0,`${name}: ${errors.map(x=>x.messageText).join(', ')}`);
  return result.outputText;
}
for (const file of [
  'server/_crm-inbox-agent-engine.ts','server/crm/inbox-agent.ts',
  'server/internal/inbox-agent-tick.ts','server/crm/inbox.ts',
  'src/crm/pages/CrmInboxAgentPage.tsx','src/crm/pages/CrmInboxPage.tsx',
]) compile(read(file), file);
console.log('PASS: all six changed TypeScript/TSX modules parse');
assert.match(settingsSource,/unassigned_alert_phone=\$\{unassignedAlertPhone\|\|null\}/);
assert.match(settingsSource,/if \(unassignedAlertRaw && !unassignedAlertPhone\)/);
assert.match(settingsSource,/auto_assign_minutes=\$\{minutes\(body\.autoAssignMinutes, 2, 2, 60\)\}/);
assert.match(uiSource,/تنبيهات المحادثات غير الموزعة فقط/);
assert.match(uiSource,/رقم واتساب تنبيهات/);
assert.match(uiSource,/autoAssignMinutes: 2/);
assert.match(engineSource,/if \(unassigned\) recipient = \{ name: "مسؤول تنبيهات غير الموزعين"/g);
assert.match(engineSource,/unassigned_alert_phone_missing/);
assert.match(cronSource,/const assignResult = await runAutoAssign\(\);\s*const tickResult = await runInboxAgentTick\(\);/);
assert.match(inboxSource,/\$\{scope\.includeAssigned\}::boolean and \(c\.assigned_to=\$\{user\.id\}/);
assert.match(inboxUi,/فتح المحادثة والرد/);
assert.match(inboxUi,/crmFetch\("\/api\/crm\/conversations", \{ method: "POST"/);
assert.match(roles,/crm\.inbox\.view','crm\.inbox_agent\.view','crm\.manual_lead\.request/);
console.log('PASS: scoped unassigned notification, 2-minute config, cron ordering, rep inbox and reply UI');

function createTestbed({member = 'cash',alreadyAssigned = false,dedicatedPhone = '966512345678'} = {}) {
  const id='11111111-1111-4111-8111-111111111111';
  const contact='22222222-2222-4222-8222-222222222222';
  const user='33333333-3333-4333-8333-333333333333';
  const recent = new Date(Date.now()-3*60*1000).toISOString();
  const calls=[];
  const send=[];
  const select=[];
  const candidate={id,contact_id:contact,lead_id:null,channel_code:'instagram',service_key:null,department_code:null,branch_code:null,customer_name:'Sample User',created_at:recent,service_selection_sent_at:null,last_customer_message_at:recent};
  const current={...candidate,service_request_id:null,assigned_to:alreadyAssigned?user:null,classification_state:'new',status:'open',lead_assigned_to:null,lead_branch_code:null,lead_service_key:null,lead_department_code:null};
  const settings={enabled:true,auto_assign_minutes:1,unassigned_alert_phone:dedicatedPhone,engine_v2:true,escalation_template_id:null};
  const sql=async (literals,...params)=>{
    const query=literals.join(' ? ').replace(/\s+/g,' ').trim();
    calls.push({query,params});
    if(query.includes('select * from crm.inbox_agent_settings'))return [settings];
    if(query.includes('select engine_v2 from crm.inbox_agent_settings'))return [{engine_v2:true}];
    if(query.includes('from crm.conversations c') && query.includes('order by (case when c.classification_state')) return [candidate];
    if(query.includes('from crm.conversations c') && query.includes('left join crm.leads l'))return [current];
    if(query.includes('from crm.service_requests'))return [];
    if(query.includes('from crm.inbox_agent_logs'))return [];
    if(query.includes('update crm.conversations set assigned_to='))return [{id}];
    if(query.includes('crm.message_templates'))return [];
    return [];
  };
  sql.json=(obj)=>obj;
  const imports={
    './_db.js': {getSql:()=>sql,withDatabaseAdvisoryLock:async(_key,cb)=>cb()},
    './_crm-utils.js': {
      clean:(x)=>String(x??'').trim(),sourceLabel:(x)=>x,
      normalizePhone:(x)=>/^\d{10,15}$/.test(String(x||''))?String(x):'',
      chooseAssignment:async (serviceKey,branch,source)=>{
        select.push({serviceKey,branch,source});
        return {assignedTo:member===serviceKey?user:null,assignedName:'Test Agent',branchCode:'hall',ruleId:'44444444-4444-4444-8444-444444444444'};
      },
    },
    './_crm-messaging.js': {
      deliverConversationMessage:async()=>{},
      deliverDirectWhatsapp:async(payload)=>{send.push(payload)},
    },
  };
  const module={exports:{}};
  vm.runInNewContext(compile(engineSource,'server/_crm-inbox-agent-engine.ts'),{
    module,exports:module.exports,require:(x)=>{
      assert.ok(x in imports,`unexpected import ${x}`);return imports[x];
    },process,console,Date,Math,Number,String,Boolean,Array,Set,Map,Error,
  });
  return {engine:module.exports,calls,send,select,settings,current};
}
{
  const t=createTestbed();
  const result=await t.engine.runAutoAssign();
  assert.equal(result.assigned,1);
  assert.equal(result.skipped,0);
  assert.equal(t.select.length,1);
  assert.equal(t.select[0].serviceKey,'cash');
  assert.equal(t.select[0].source,'instagram');
  assert.equal(t.send.length,0);
  const assignmentUpdate=t.calls.find(x=>x.query.includes('update crm.conversations set assigned_to='));
  assert.ok(assignmentUpdate);
  assert.equal(assignmentUpdate.params[2],'cash');
  // PostgreSQL cannot infer the type of an uncast argument to jsonb_build_object(any).
  // This check catches the production error: could not determine data type of parameter $3.
  assert.match(assignmentUpdate.query,/jsonb_build_object\('unclassifiedAutoAssignedAt',now\(\),'unclassifiedAutoAssignSource',\s*\?\s*::text\)/);
  const candidateQuery=t.calls.find(x=>x.query.includes('order by (case when c.classification_state'));
  assert.ok(candidateQuery);
  assert.ok(candidateQuery.params.includes(2),'minimum delay is two minutes even when stored setting is one');
  console.log('PASS: 2-minute routing via configured cash rule without auto classification');
}
{
  const t=createTestbed({member:'finance'});
  const result=await t.engine.runAutoAssign();
  assert.equal(result.assigned,1);
  assert.deepEqual(t.select.map(x=>x.serviceKey),['cash','finance']);
  console.log('PASS: falls back to the finance sales rule without changing service selection');
}
{
  const t=createTestbed({alreadyAssigned:true});
  const result=await t.engine.runAutoAssign();
  assert.equal(result.assigned,0);
  assert.equal(result.skipped,1);
  assert.equal(t.select.length,0);
  console.log('PASS: never redistributes a conversation with an existing owner');
}
{
  const t=createTestbed({member:'none'});
  const result=await t.engine.runAutoAssign();
  assert.equal(result.assigned,0);
  assert.equal(result.skipped,1);
  assert.equal(t.send.length,1);
  assert.equal(t.send[0].phone,'966512345678');
  console.log('PASS: no eligible rep triggers one dedicated-number alert');
}
{
  const t=createTestbed({member:'none',dedicatedPhone:''});
  const result=await t.engine.runAutoAssign();
  assert.equal(result.assigned,0);
  assert.equal(t.send.length,0);
  console.log('PASS: missing dedicated phone does not leak unassigned alerts to normal recipients');
}
console.log('All CRM unclassified-routing tests passed.');
