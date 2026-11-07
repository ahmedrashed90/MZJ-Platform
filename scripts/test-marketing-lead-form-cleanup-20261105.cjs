/** Guard the live forms-only cleanup contract without touching a production database. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.resolve(__dirname, '../server/marketing/lead-forms.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  fileName: 'server/marketing/lead-forms.ts',
  reportDiagnostics: true,
  compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
});
assert.equal(compiled.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
const formA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const formB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const leadA='11111111-1111-4111-8111-111111111111';
const leadB='22222222-2222-4222-8222-222222222222';
const leadC='33333333-3333-4333-8333-333333333333';
const db={
  forms:[{id:formA},{id:formB}],
  leads:[{id:leadA,form_id:formA},{id:leadB,form_id:formA},{id:leadC,form_id:formB}],
  visits:[{id:'v1',form_id:formA},{id:'v2',form_id:formA},{id:'v3',form_id:formB}],
  steps:[{id:'s1',form_id:formA},{id:'s2',form_id:formB}],
  crm:[{id:'CRM-A'},{id:'CRM-B'}], // must never change
  sheets:[{id:'SHEET-A'}],
  pixels:[{id:'SNAP-PIXEL'}],
};
const initialExternal=JSON.stringify({crm:db.crm,sheets:db.sheets,pixels:db.pixels});
const audit=[];
let allow=true;
const matches=(row,id)=>!id||row.form_id===id;
function count(d,id){return {leads:d.leads.filter(x=>matches(x,id)).length,visits:d.visits.filter(x=>matches(x,id)).length,steps:d.steps.filter(x=>matches(x,id)).length};}
function tagged(d){
  const fn=(parts,...args)=>{
    const q=parts.join('?').replace(/\s+/g,' ').trim().toLowerCase();
    const first=args[0]||'';
    if(q.includes('from marketing.lead_forms where id='))return Promise.resolve(d.forms.filter(x=>x.id===first));
    if(q.includes('as leads')&&q.includes('as visits')&&q.includes('as steps'))return Promise.resolve([count(d,first)]);
    if(q.startsWith('delete from marketing.form_leads where id=')){
      const idx=d.leads.findIndex(x=>x.id===first);
      return Promise.resolve(idx<0?[]:[d.leads.splice(idx,1)[0]]);
    }
    for(const [table,label] of [['marketing.form_leads','leads'],['marketing.form_visits','visits'],['marketing.form_step_events','steps']]){
      if(q.includes(`with deleted as (delete from ${table}`)){
        const removed=d[label].filter(x=>matches(x,first));
        d[label]=d[label].filter(x=>!matches(x,first));
        return Promise.resolve([{total:removed.length}]);
      }
    }
    throw new Error('Unexpected SQL in cleanup handler: '+q.slice(0,170));
  };
  fn.unsafe=async query=>{
    assert.match(query,/^lock table marketing\.form_leads, marketing\.form_visits, marketing\.form_step_events/i);
    return [];
  };
  fn.begin=async callback=>{
    const draft=structuredClone(d);
    const result=await callback(tagged(draft));
    for(const key of Object.keys(d))d[key]=draft[key];
    return result;
  };
  return fn;
}
const mocks={
  '../_db.js':{getSql:()=>tagged(db),withDatabaseAdvisoryLock:async(_key,cb)=>cb()},
  '../_auth.js':{requireUser:async()=>({id:'ccee7799-1111-4111-8111-111111111111',systemAccess:{marketing:{enabled:true}}})},
  '../_access-control.js':{
    logSecurityEvent:async e=>audit.push(e),
    requirePermissionForUser:async(_req,res,_user,permission)=>{
      assert.equal(permission,'marketing.lead_forms.leads.delete');
      if(allow)return true;
      res.status(403).json({ok:false,error:'FORBIDDEN'});return false;
    },
  },
  '../_marketing-lead-forms-schema.js':{ensureMarketingLeadFormsSchema:async()=>{}},
  './lead-forms-crm.js':{syncMarketingFormLeadToCrm:async()=>{throw new Error('CRM must remain untouched');}},
  '../../shared/lead-forms.js':{},
  '../../shared/lead-form-rules.js':{},
  '../../shared/lead-form-design.js':{},
  '../../shared/lead-form-pixels.js':{},
};
const moduleExports={};
vm.runInNewContext(compiled.outputText,{
  exports:moduleExports, require:(name)=>name==='node:crypto'?require(name):(mocks[name]||(()=>{throw new Error('Unmocked module '+name);})()),
  console,URL,URLSearchParams,Date,Math,AbortSignal,structuredClone,
}, {filename:'server/marketing/lead-forms.ts'});
const handler=moduleExports.default;
assert.equal(typeof handler,'function');
async function request(action,payload={},method='POST'){
  const req={method,query:method==='GET'?{view:action,...payload}:{},body:method==='POST'?{action,...payload}:{},headers:{}};
  const res={code:200,data:null,setHeader(){return this;},status(c){this.code=c;return this;},json(data){this.data=data;return this;}};
  await handler(req,res);
  return res;
}
(async()=>{
  allow=false;
  let result=await request('data_summary',{formId:''},'GET');
  assert.equal(result.code,403,'Data counts must require the sensitive delete permission');
  allow=true;
  result=await request('data_summary',{formId:''},'GET');
  assert.equal(result.code,200);assert.deepEqual(JSON.parse(JSON.stringify(result.data.summary)),{leads:3,visits:3,steps:2});
  result=await request('delete_lead',{id:leadA,confirm:'DELETE_LEAD'});
  assert.equal(result.code,200);assert.equal(db.leads.length,2);assert.equal(db.visits.length,3,'Single lead removal must not rewrite genuine visit history');
  result=await request('delete_lead',{id:leadA,confirm:'DELETE_LEAD'});
  assert.equal(result.code,404);
  result=await request('clear_data',{formId:formA,confirm:'wrong',expectedLeads:1,expectedVisits:2,expectedSteps:1});
  assert.equal(result.code,400);assert.equal(db.leads.length,2);
  result=await request('clear_data',{formId:formA,confirm:'CLEAR_FORM_DATA',expectedLeads:0,expectedVisits:2,expectedSteps:1});
  assert.equal(result.code,400,'A stale preview must prevent bulk deletion');assert.equal(db.leads.length,2);
  result=await request('clear_data',{formId:formA,confirm:'CLEAR_FORM_DATA',expectedLeads:1,expectedVisits:2,expectedSteps:1});
  assert.equal(result.code,200);assert.deepEqual(JSON.parse(JSON.stringify(result.data.removed)),{leads:1,visits:2,steps:1});
  assert.deepEqual(count(db,formA),{leads:0,visits:0,steps:0});
  assert.deepEqual(count(db,formB),{leads:1,visits:1,steps:1},'Other forms must remain intact');
  result=await request('data_summary',{formId:''},'GET');
  assert.equal(result.data.summary.leads,1);
  result=await request('clear_data',{formId:'',confirm:'CLEAR_FORM_DATA',expectedLeads:1,expectedVisits:1,expectedSteps:1});
  assert.equal(result.code,200);assert.deepEqual(count(db,''),{leads:0,visits:0,steps:0});
  assert.equal(db.forms.length,2,'Never delete published form definitions');
  assert.equal(JSON.stringify({crm:db.crm,sheets:db.sheets,pixels:db.pixels}),initialExternal);
  assert.equal(audit.filter(x=>x.result==='success').length,3);
  const ui=fs.readFileSync(path.resolve(__dirname,'../src/marketing/lead-forms/LeadFormsPage.tsx'),'utf8');
  const permission=fs.readFileSync(path.resolve(__dirname,'../shared/access-control.ts'),'utf8');
  const catalog=fs.readFileSync(path.resolve(__dirname,'../server/_access-control-schema.ts'),'utf8');
  assert.match(ui,/canDeleteLeads&&<button[^>]*mlf-delete-button/);
  assert.match(ui,/const canViewReports=can\('reports.view'\)/);
  assert.match(ui,/\[from,to,statsForm,canViewReports\]/);
  assert.doesNotMatch(ui,/\[from,to,statsForm,user\]/);
  assert.match(ui,/const StatsLine=memo\(/);
  assert.match(permission,/marketing\.lead_forms\.leads\.delete/);
  assert.ok(catalog.split("('marketing.lead_forms.leads.delete'").length===3,'Permission must exist in both SQL catalogs');
  console.log('PASS: admin-only lead deletion, bulk reset (leads/visits/steps), stale-preview protection, form scoping, audit, CRM/Sheets/Pixel isolation, dashboard refresh stability');
})().catch(error=>{console.error(error);process.exitCode=1;});
