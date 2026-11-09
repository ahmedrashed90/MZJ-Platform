/** The saved-template delete must be scoped, authorized, and leave forms/leads/pixels untouched. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('server/marketing/lead-forms.ts');
const transpiled = ts.transpileModule(source, {
  fileName: 'server/marketing/lead-forms.ts',
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
assert.equal(transpiled.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
const me = '11111111-1111-4111-8111-111111111111';
const someone = '22222222-2222-4222-8222-222222222222';
const ownId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const templates = [
  {id: ownId, name: 'تصميم مكرر', created_by: me, template: 'steps', config:{}, updated_at:'', created_at:''},
  {id: otherId, name: 'تصميم زميل', created_by: someone, template: 'steps', config:{}, updated_at:'', created_at:''},
];
const independent = {forms:[{id:'FORM', config:{design:'تصميم مكرر'}}], leads:[{id:'LEAD'}], pixels:[{id:'PIXEL'}], crm:[{id:'CRM'}]};
const originalIndependent = JSON.stringify(independent);
const audit = [];
let canCreate = true, canEdit = false;
const sql = (strings, ...values) => {
  const query = strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
  if(query.startsWith('select id::text,name,template,config,created_by::text,created_at,updated_at from marketing.form_design_templates'))
    return Promise.resolve(templates.map(template=>({...template})));
  if(query.startsWith('delete from marketing.form_design_templates')){
    const [id,userId,mayManageAll] = values;
    const index = templates.findIndex(template=>template.id===id && (template.created_by===userId || mayManageAll));
    return Promise.resolve(index<0 ? [] : [templates.splice(index,1)[0]]);
  }
  throw new Error('Unexpected SQL: ' + query.slice(0,240));
};
const mocks = {
  '../_db.js': {getSql:()=>sql,withDatabaseAdvisoryLock:async(_key,fn)=>fn()},
  '../_auth.js': {requireUser:async()=>({id:me,systemAccess:{marketing:{enabled:true}}})},
  '../_access-control.js': {
    hasPermission:(_user,permission)=>permission==='marketing.lead_forms.edit' && canEdit,
    requirePermissionForUser:async(_req,res,_user,permission)=>{
      assert.ok(['marketing.lead_forms.view','marketing.lead_forms.create'].includes(permission));
      if(permission==='marketing.lead_forms.create' && !canCreate){res.status(403).json({ok:false,error:'FORBIDDEN'});return false;}
      return true;
    },
    logSecurityEvent:async event=>audit.push(event),
  },
  '../_marketing-lead-forms-schema.js':{ensureMarketingLeadFormsSchema:async()=>{}},
  './lead-forms-crm.js':{syncMarketingFormLeadToCrm:()=>{throw new Error('Never touch CRM');}},
  '../../shared/lead-forms.js':{},
  '../../shared/lead-form-rules.js':{},
  '../../shared/lead-form-design.js':{},
  '../../shared/lead-form-pixels.js':{},
};
const mod = {exports:{}};
vm.runInNewContext(transpiled.outputText, {
  exports:mod.exports,require:id=>id==='node:crypto'?require(id):mocks[id]||{},
  console,URL,URLSearchParams,Date,Math,AbortSignal,structuredClone,
}, {filename:'server/marketing/lead-forms.ts'});
const handler = mod.exports.default;
assert.equal(typeof handler,'function');
async function request(action,payload={},method='POST'){
  const req={method,query:method==='GET'?{view:action,...payload}:{},body:method==='POST'?{action,...payload}:{},headers:{}};
  const res={code:200,data:null,setHeader(){return this;},status(value){this.code=value;return this;},json(value){this.data=value;return this;}};
  await handler(req,res);
  return res;
}
(async()=>{
  let result = await request('design_templates',{},'GET');
  assert.equal(result.code,200);
  assert.equal(result.data.templates.length,2);
  assert.equal(result.data.templates[0].created_by,me);
  canCreate=false;
  result = await request('design_template_delete',{id:ownId,confirm:'DELETE_DESIGN_TEMPLATE'});
  assert.equal(result.code,403,'Users without design-creation permission must not delete');
  canCreate=true;
  result = await request('design_template_delete',{id:ownId});
  assert.equal(result.code,400,'Deletion requires explicit confirmation');
  result = await request('design_template_delete',{id:'not-a-uuid',confirm:'DELETE_DESIGN_TEMPLATE'});
  assert.equal(result.code,400,'Invalid design ids must never reach SQL');
  result = await request('design_template_delete',{id:otherId,confirm:'DELETE_DESIGN_TEMPLATE'});
  assert.equal(result.code,404,'A non-editor cannot remove another author’s design');
  result = await request('design_template_delete',{id:ownId,confirm:'DELETE_DESIGN_TEMPLATE'});
  assert.equal(result.code,200,'Creator can delete their own saved template');
  assert.equal(result.data.deleted,1);
  assert.equal(templates.length,1);
  assert.equal(audit.length,1);
  assert.equal(audit[0].entityType,'marketing_form_design_template');
  result = await request('design_template_delete',{id:ownId,confirm:'DELETE_DESIGN_TEMPLATE'});
  assert.equal(result.code,404,'Previously removed designs cannot be deleted again');
  canEdit=true;
  result = await request('design_template_delete',{id:otherId,confirm:'DELETE_DESIGN_TEMPLATE'});
  assert.equal(result.code,200,'Editors with create access may manage another author’s template');
  assert.equal(templates.length,0);
  assert.equal(JSON.stringify(independent),originalIndependent,'Deleting templates must not mutate forms, leads, CRM or pixel settings');
  const ui = read('src/marketing/lead-forms/LeadFormsPage.tsx');
  assert.match(ui,/savedDesigns\.map\(item=>/);
  assert.match(ui,/deleteSavedDesign\(item\)/);
  assert.match(ui,/can\('create'\)&&\(item\.created_by===user\?\.id\|\|can\('edit'\)\)/);
  assert.match(ui,/window\.confirm\(/);
  assert.match(ui,/setSavedDesigns\(current=>current\.filter\(/);
  assert.match(ui,/setPresetId\(current=>current===item\.id\?'':current\)/);
  assert.match(ui,/await reloadDesigns\(\)/);
  assert.ok(!ui.split("{tab==='library'")[1].split("{tab==='builder'")[0].split('FORM_TEMPLATES.map')[1].split('savedDesigns.map')[0].includes('deleteSavedDesign'), 'Built-in templates cannot be deleted');
  console.log('PASS: saved-design deletion requires authorization and confirmation, is owner-scoped with editor override, and leaves existing forms/leads/pixels untouched');
})().catch(error=>{console.error(error);process.exit(1);});
