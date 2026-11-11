'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLoader, scriptedSql } = require('./marketing-workflow-test-support.cjs');
const root = path.resolve(__dirname, '..');
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0');
const all = { enabled:true, dataScope:'all', roleCode:'admin', branchCodes:[], departmentCodes:[] };
const admin = { id:uid(1), fullName:'Manager', permissions:['platform.superadmin'], deniedPermissions:[], systemAccess:{marketing:all} };
const employee = { id:uid(2), fullName:'Employee', permissions:['marketing.task.view_assigned','marketing.task.final_file.upload'], deniedPermissions:[], systemAccess:{marketing:{...all,roleCode:'employee',dataScope:'assigned'}} };
const other = { id:uid(3), fullName:'Other', permissions:[], deniedPermissions:[], systemAccess:{marketing:{...all,roleCode:'employee',dataScope:'assigned'}} };
const stubs = {
  '../_db.js': { getSql:()=>{throw Error('No live database in tests');},withDatabaseAdvisoryLock:async(k,fn)=>fn() },
  '../_auth.js': { loadUserProfile:async()=>null },
  '../_access-control.js': { getSystemAccess:u=>u.systemAccess.marketing },
  '../_marketing-workflow-schema.js': { ensureMarketingWorkflowSchema:async()=>{} },
  '../_notifications.js': { createNotification:async()=>{} },
  '../_media-storage.js': {mediaStorageConfigured:()=>false,buildMarketingStorageKey:()=>`work/${uid(80)}`,headMediaObject:async()=>({exists:true,size:4}),createUploadUrl:()=>{throw Error('External media upload is not part of this test');}},
  '../_google-drive-storage.js': {createGoogleDriveResumableUpload:async()=>({uploadUrl:'https://upload.invalid'}),verifyGoogleDriveUploadedFile:async()=>({id:'fake',size:4})},
  './evaluations.js': {canGradeWorkItem:async()=>false},
};
const load = createLoader(root, stubs, {'server/marketing/workflow.ts':'\nexport { saveItem };'});
const { saveItem } = load('server/marketing/workflow.ts');
const taskId=uid(50), itemId=uid(51);
const base = {id:itemId,task_id:taskId,created_by:admin.id,assigned_to:employee.id,
  idea:'الفكرة القديمة',idea_name:'صورة تعريفية',due_on:'2026-11-01',department_id:uid(30),
  status:'in_progress',version:3,media_kind:'image',formats:[{id:uid(10),name:'Photo'}],files:[]};
const step = (match, rows=[], check) => ({match,rows,check});
const tests=[]; const test=(title,fn)=>tests.push({title,fn});
function dbScenario(status, user=admin, options={}) {
  const row={...base,status,version:options.version ?? 3};
  const updateChecks=[];
  const stages=[
    step('select i.*,t.name as task_name',[row]),
    step('select id from marketing.work_tasks'),
    step('select * from marketing.work_items',[row]),
  ];
  if (options.success) stages.push(
    step('update marketing.work_items',[{version:row.version+1}],(vals,sql)=>{
      assert.match(sql,/set idea=/);assert.doesNotMatch(sql,/status=|approved_by=|approved_at=|format_reviews/);
      assert.equal(vals[0],options.newIdea || 'فكرة جديدة');
      assert.equal(vals[1],row.idea_name);
      assert.equal(vals[2],row.due_on);
      updateChecks.push(vals);
    }),
    step('insert into marketing.work_history',[],vals=>{
      assert.equal(vals[1],itemId);assert.equal(vals[2],'edited');
      assert.equal(vals[6].explanation,options.explanation ?? 'شرح جديد');
    }),
    step('select id from marketing.work_tasks'),
    step('select i.*,i.due_on::text',[row]),
    step('update marketing.work_tasks')
  );
  const db=scriptedSql(stages);
  return {db,row,updateChecks};
}
const input=(patch={})=>({itemId,version:3,idea:'فكرة جديدة',ideaName:base.idea_name,explanation:'شرح جديد',...patch});
for(const status of ['in_progress','editing','revision','submitted','approved']) {
  test('Authorized manager saves idea and explanation in '+status+' without changing approval state',async()=>{
    const {db,updateChecks}=dbScenario(status,admin,{success:true});
    const saved=await saveItem(db,input(),admin);
    assert.equal(saved.version,4);assert.equal(saved.idea,'فكرة جديدة');assert.equal(saved.explanation,'شرح جديد');
    assert.equal(updateChecks.length,1);db.assertDone();
  });
}
test('Assigned executor can save brief while in progress',async()=>{
  const {db}=dbScenario('in_progress',employee,{success:true});
  await saveItem(db,input(),employee);db.assertDone();
});
test('Assigned executor can save brief while editing a revision',async()=>{
  const {db}=dbScenario('editing',employee,{success:true});
  await saveItem(db,input(),employee);db.assertDone();
});
test('Approved brief is protected against executor editing without permission',async()=>{
  const {db}=dbScenario('approved',employee);
  await assert.rejects(()=>saveItem(db,input(),employee),/لا توجد صلاحية|غير مسموح|لا يمكن|denied/i);
  db.assertDone();
});
test('Historical rejected requirement stays immutable, including for manager',async()=>{
  const {db}=dbScenario('rejected',admin);
  await assert.rejects(()=>saveItem(db,input(),admin),/لا يقبل التعديل|لا يمكن|immutable/i);
  db.assertDone();
});
test('Approved brief cannot modify date or assignment',async()=>{
  for (const patch of [{dueOn:'2026-11-02'},{assigneeId:uid(8)}]) {
    const {db}=dbScenario('approved',admin);
    await assert.rejects(()=>saveItem(db,input(patch),admin),/لا يقبل التعديل|لا يمكن|immutable/i);
    db.assertDone();
  }
});
test('Approved brief cannot change the requirement name',async()=>{
  const {db}=dbScenario('approved',admin);
  await assert.rejects(()=>saveItem(db,input({ideaName:'other requirement'}),admin),/لا يقبل التعديل|لا يمكن|immutable/i);
  db.assertDone();
});
test('Concurrent edit with stale version is rejected rather than overwritten',async()=>{
  const {db}=dbScenario('in_progress',admin,{version:4});
  await assert.rejects(()=>saveItem(db,input(),admin),/تم تعديل البيانات|تغير|تعارض|conflict/i);
  db.assertDone();
});
test('Task creation persists both idea and explanation in one creation transaction',()=>{
  const server=fs.readFileSync(path.join(root,'server/marketing/workflow.ts'),'utf8');
  const form=fs.readFileSync(path.join(root,'src/marketing/workflow/CreatePage.tsx'),'utf8');
  assert.match(server,/explanation: text\(input\.explanation, 20000\)/);
  assert.match(form,/idea: item\.idea, explanation: item\.explanation\.trim\(\)/);
  assert.match(form,/حفظ وإنشاء التاسك/);
  assert.match(form,/يُحفظ نص الفكرة والشرح في بيانات المطلوب/);
});
test('Executors and requirements overview hides explanation but keeps it in the opened item editor',()=>{
  const ui=fs.readFileSync(path.join(root,'src/marketing/workflow/TaskDetail.tsx'),'utf8');
  const overview=ui.split('<section className="mkw-detail-items">')[1]?.split('<details className="mkw-history">')[0];
  assert.ok(overview,'Executors and requirements section is present');
  assert.doesNotMatch(overview,/mkw-requirement-explanation-read|الشرح: \{item\.explanation\}/);
  assert.match(overview,/\{item\.idea_name\}/,'Each requirement must keep its clear short name');
  assert.doesNotMatch(overview,/\{item\.idea\?\.trim\(\)/,'The full creative brief must not be repeated in the summary');
  assert.match(ui,/<StrategyIdeaBrief value=\{idea\}\/>/,'The full brief remains available inside the opened requirement');
  assert.match(ui,/function StrategyIdeaBrief/,'Structured image/video brief renderer remains available');
  assert.match(ui,/<Field label="الشرح — شرح الفكرة أو المطلوب">/);
  assert.match(ui,/onChange=\{event => \{ setExplanation\(event\.target\.value\)/);
});
test('The idea and explanation fields have a visible standalone Save action',()=>{
  const ui=fs.readFileSync(path.join(root,'src/marketing/workflow/TaskDetail.tsx'),'utf8');
  assert.match(ui,/className="mkw-idea-save-actions"/);
  assert.match(ui,/حفظ الفكرة والشرح/);
  assert.match(ui,/onClick=\{\(\) => void run\(persist\)\.then/);
  assert.match(ui,/onBriefSaved/);
  assert.match(ui,/تم حفظ الفكرة والشرح بنجاح/);
});
(async()=>{let passed=0;for(const {title,fn} of tests){try{await fn();console.log('PASS:',title);passed++;}catch(error){console.error('FAIL:',title,'\n',error.stack);}}console.log(`${passed}/${tests.length} marketing brief persistence checks passed`);process.exitCode=passed===tests.length?0:1;})();
