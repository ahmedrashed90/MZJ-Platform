const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLoader, scriptedSql } = require('./marketing-workflow-test-support.cjs');
const root = process.cwd();
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const worker = { id: uuid(1), fullName: 'Executor', permissions: [
  'system.marketing.access', 'marketing.task.view_assigned', 'marketing.task.final_file.upload',
], deniedPermissions: [], systemAccess: { marketing: {enabled:true,dataScope:'assigned',roleCode:'executor',branchCodes:[],departmentCodes:[]} } };
const otherWorker = { ...worker, id: uuid(2), fullName:'Other executor' };
const reviewer = { ...worker, id: uuid(3), fullName:'Reviewer', permissions:['platform.superadmin'], systemAccess: {marketing:{enabled:true,dataScope:'all',roleCode:'admin',branchCodes:[],departmentCodes:[]}} };
const notifications=[];
const load=createLoader(root, {
  '../_db.js': {getSql:()=>{throw Error('No database')},withDatabaseAdvisoryLock:async(_key,fn)=>fn()},
  '../_auth.js': {loadUserProfile:async()=>null},
  '../_access-control.js': {getSystemAccess:user=>user.systemAccess.marketing},
  '../_marketing-workflow-schema.js': {ensureMarketingWorkflowSchema:async()=>{}},
  '../_notifications.js': {createNotification:async event=>notifications.push(event)},
  '../_media-storage.js': {mediaStorageConfigured:()=>false,buildMarketingStorageKey:()=>''},
  '../_google-drive-storage.js': {createGoogleDriveResumableUpload:async()=>({uploadUrl:'https://example.invalid'})},
}, {'server/marketing/workflow.ts':'\nexport { declineItemRevision, reviewItem };'});
const {declineItemRevision,reviewItem}=load('server/marketing/workflow.ts');
const {workReviewableFormats}=load('shared/marketing-workflow.ts');
const {parseReviewNote}=load('shared/marketing-review-note-format.ts');
const format={id:uuid(10),platform_id:uuid(30),platform_name:'Instagram',name:'صورة',width:1080,height:1080};
const original={id:uuid(20),task_id:uuid(21),created_by:reviewer.id,task_name:'Test',assigned_to:worker.id,
  media_kind:'image',department_id:uuid(30),formats:[format],files:[{id:uuid(31),name:'asset.jpg',category:'final',format_id:format.id,mime_type:'image/jpeg',status:'ready'}],
  status:'revision',version:4};
const step=(match,rows=[],check)=>({match,rows,check});
const taskLock=()=>step('select id from marketing.work_tasks');
const itemRead=rows=>step('select i.*,t.name as task_name',rows);
const itemLock=rows=>step('select * from marketing.work_items',rows);
const itemLoad=rows=>step('coalesce(d.name',rows);
function declineSteps(current=original, formatRows=[{format_id:format.id}], reason='ملف صحيح') {
  const reviewed={...current,status:'submitted',format_reviews:[{format_id:format.id,status:'submitted'}]};
  const steps=[itemRead([current]),taskLock(),itemLock([current]),step('select format_id::text',formatRows)];
  if (formatRows.length) steps.push(
    step('update marketing.work_format_reviews',[],(_vals,sql)=>assert(sql.includes("set status='submitted'"))),
    step('update marketing.work_items',[],(_vals,sql)=>assert(sql.includes("status='submitted'"))),
    step('insert into marketing.work_history',[],values=>{
      assert.equal(values[2],'revision_declined');
      assert.equal(values[3],reason);
      assert.deepEqual(values[6].formatIds,formatRows.map(row=>String(row.format_id)));
    }),
    taskLock(),itemLoad([reviewed]),
    step('update marketing.work_tasks',[],values=>assert.equal(values[0],'active')),
    step('select u.id::text',[])
  );
  return steps;
}
const tests=[];
const test=(name,fn)=>tests.push([name,fn]);

test('Executor can decline requested revision and return its format to review without new upload',async()=>{
  const db=scriptedSql(declineSteps());
  const result=await declineItemRevision(db,{itemId:original.id,version:original.version,reason:'ملف صحيح'},worker);
  assert.equal(result.ok,true);assert.equal(result.message,'تم إرسال رفض التعديل إلى المراجعة');db.assertDone();
  assert(notifications.some(row=>row.eventType==='workflow.revision_declined'));
});
test('Reviewer can approve original files after executor declines revision, reaching 100%',async()=>{
  const resubmitted={...original,status:'submitted',version:5,format_reviews:[{format_id:format.id,status:'submitted'}]};
  const fullyApproved={...resubmitted,status:'approved',format_reviews:[{format_id:format.id,status:'approved'}]};
  const db=scriptedSql([
    itemRead([resubmitted]),taskLock(),itemLock([resubmitted]),itemLoad([resubmitted]),
    step('insert into marketing.work_history',[],values=>assert.equal(values[2],'approved')),
    step('insert into marketing.work_format_reviews',[],values=>assert.equal(values[2],'approved')),
    step('select format_id,status',[{format_id:format.id,status:'approved'}]),
    step('update marketing.work_items',[],values=>assert.equal(values[0],'approved')),
    step('insert into marketing.work_action_progress'),
    taskLock(),itemLoad([fullyApproved]),step('update marketing.work_tasks',[],values=>assert.equal(values[0],'completed')),
  ]);
  const result=await reviewItem(db,{itemId:original.id,version:5,decision:'approve'},reviewer);
  assert.equal(result.readiness.percent,100);db.assertDone();
});
test('Reviewer may reject the disputed product without creating an approved product',async()=>{
  const resubmitted={...original,status:'submitted',version:5,format_reviews:[{format_id:format.id,status:'submitted'}]};
  const db=scriptedSql([
    itemRead([resubmitted]),taskLock(),itemLock([resubmitted]),itemLoad([resubmitted]),
    step('insert into marketing.work_history',[],values=>assert.equal(values[2],'rejected')),
    step('insert into marketing.work_rejected_items'),
    step('delete from marketing.work_items'),
    taskLock(),itemLoad([]),step('update marketing.work_tasks',[],values=>assert.equal(values[0],'empty')),
  ]);
  const result=await reviewItem(db,{itemId:original.id,version:5,decision:'reject'},reviewer);
  assert.equal(result.readiness.approved,0);db.assertDone();
});
test('Second decline is blocked when there are no revision formats',async()=>{
  const db=scriptedSql(declineSteps(original,[]));
  await assert.rejects(()=>declineItemRevision(db,{itemId:original.id,version:4},worker),/لا يوجد تعديل مطلوب/);db.assertDone();
});
test('Other executors cannot decline a revision they do not own',async()=>{
  const db=scriptedSql([itemRead([original])]);
  await assert.rejects(()=>declineItemRevision(db,{itemId:original.id,version:4},otherWorker),/صلاحية|صلاحيات|مسموح|permission|denied|المسموح/);db.assertDone();
});
test('A user without file-upload permission cannot decline',async()=>{
  const unauthorized={...worker,permissions:['system.marketing.access','marketing.task.view_assigned']};
  const db=scriptedSql([]);
  await assert.rejects(()=>declineItemRevision(db,{itemId:original.id,version:4},unauthorized));db.assertDone();
});
test('Reviewer cannot decline on behalf of assigned executor',async()=>{
  const db=scriptedSql([itemRead([original])]);
  await assert.rejects(()=>declineItemRevision(db,{itemId:original.id,version:4},reviewer));db.assertDone();
});
test('Stale version cannot reopen revision or duplicate a decision',async()=>{
  const db=scriptedSql([itemRead([original]),taskLock(),itemLock([original])]);
  await assert.rejects(()=>declineItemRevision(db,{itemId:original.id,version:3},worker));db.assertDone();
});
test('Approved item cannot be reopened by executor',async()=>{
  const done={...original,status:'approved'};
  const db=scriptedSql([itemRead([done]),taskLock(),itemLock([done])]);
  await assert.rejects(()=>declineItemRevision(db,{itemId:original.id,version:4},worker));db.assertDone();
});
test('Previously approved other formats remain excluded from reconsideration',()=>{
  const extra={...format,id:uuid(11)};
  const previouslyApproved={...original,formats:[format,extra],format_reviews:[
    {format_id:format.id,status:'submitted'}, {format_id:extra.id,status:'approved'}
  ]};
  const reviewable=workReviewableFormats(previouslyApproved,'approve');
  assert.deepEqual(reviewable.map(row=>row.id),[format.id]);
});
test('Document notes preserve paragraphs, lists and headings without running together',()=>{
  const blocks=parseReviewNote('## الجودة\n1. وضوح الصورة\n• رقم الهاتف\n\nارجع إلى حاسبة التمويل');
  assert.deepEqual(blocks.map(row=>row.kind),['heading','numbered','bullet','paragraph']);
  assert.equal(blocks[3].text,'ارجع إلى حاسبة التمويل');
});
test('Existing compact notes separated by plus become visible bullet points',()=>{
  assert.deepEqual(parseReviewNote('شاشة حقيقية + وضوح الهاتف + حاسبة التمويل').map(x=>x.text),
    ['شاشة حقيقية','وضوح الهاتف','حاسبة التمويل']);
  assert.deepEqual(parseReviewNote('اتصل +966550000000 للمتابعة 2+3').map(x=>x.kind),['paragraph']);
});
test('UI enforces executor-only action, server endpoint, safe formatting and reviewer decision',()=>{
  const ui=fs.readFileSync(path.join(root,'src/marketing/workflow/TaskDetail.tsx'),'utf8');
  const backend=fs.readFileSync(path.join(root,'server/marketing/workflow.ts'),'utf8');
  const css=fs.readFileSync(path.join(root,'src/marketing/workflow/workflow.css'),'utf8');
  assert(ui.includes('canDeclineRevision = own && canUpload && revisionPending'));
  assert(ui.includes("workPost('decline_revision'"));
  assert(backend.includes("action === 'work_decline_revision'"));
  assert(backend.includes("requirePermission(user, 'marketing.task.review')"));
  assert(ui.includes('ReviewNoteDocument text={reviewNote.note}'));
  assert(ui.includes('<textarea ref={noteEditorRef}'));
  assert(css.includes('.mkw-review-document'));
  assert(!ui.includes('dangerouslySetInnerHTML'));
});
(async()=>{
 let passed=0;
 for(const [name,fn] of tests) {
  try{await fn();console.log('PASS',name);passed++;}
  catch(error){console.error('FAIL',name,error.stack||error);process.exitCode=1;}
 }
 console.log(`${passed}/${tests.length} review-format/revision-decline tests passed`);
})();
