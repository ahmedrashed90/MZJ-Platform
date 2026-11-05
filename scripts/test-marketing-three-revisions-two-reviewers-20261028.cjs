const assert = require('node:assert/strict');
const fs = require('node:fs');
const {createLoader} = require('./marketing-workflow-test-support.cjs');
const root=process.cwd();
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const owner={id:uid(1),fullName:'Manager',permissions:['marketing.task.review','settings.marketing.manage','marketing.dashboard.view'],systemAccess:{marketing:{enabled:true,dataScope:'all'}}};
const worker={id:uid(2),fullName:'Executor',permissions:['marketing.task.final_file.upload','marketing.task.view_assigned'],systemAccess:{marketing:{enabled:true,dataScope:'assigned'}}};
const appointed={...worker,id:uid(3),fullName:'Grader',permissions:['marketing.dashboard.view']};
const notifications=[];
const load=createLoader(root,{
  '../_db.js':{getSql:()=>{throw Error('live DB forbidden')},withDatabaseAdvisoryLock:async(k,fn)=>fn()},
  '../_auth.js':{loadUserProfile:async()=>null},
  '../_access-control.js':{getSystemAccess:user=>user.systemAccess.marketing},
  '../_marketing-workflow-schema.js':{assertMarketingWorkflowReady:async()=>{},ensureMarketingWorkflowSchema:async()=>{},marketingPlanScheduleSchemaStatus:async()=>({ready:true})},
  '../_notifications.js':{createNotification:async x=>notifications.push(x)},
  '../_media-storage.js':{mediaStorageConfigured:()=>false,buildMarketingStorageKey:()=>'',headMediaObject:async()=>({exists:true,size:42})},
  '../_google-drive-storage.js':{createGoogleDriveResumableUpload:async()=>({uploadUrl:'https://unused.invalid'})},
},{'server/marketing/workflow.ts':'\nexport {reviewItem, respondToItemRevision};'});
const {reviewItem,respondToItemRevision}=load('server/marketing/workflow.ts');
const evals=load('server/marketing/evaluations.ts');
const readiness=load('shared/marketing-workflow.ts');
const fmt={id:uid(22),platform_name:'IG',name:'صورة',width:1080,height:1080};
const finalFile={id:uid(23),name:'file.jpg',mime_type:'image/jpeg',file_size:42,category:'final',format_id:fmt.id,status:'ready'};
function makeFixture(initial='submitted') {
 const item={id:uid(50),task_id:uid(51),task_name:'Campaign',created_by:owner.id,assigned_to:worker.id,department_id:uid(52),
  status:initial,version:1,formats:[fmt],files:[finalFile],media_kind:'image',due_on:'2026-10-31',idea_name:'Image'};
 const model={item,formatReviews:[],notes:[],history:[],ratings:[],approvers:[owner.id,appointed.id]};
 const db=async (parts,...values)=>{
  const q=parts.join('?').replace(/\s+/g,' ').trim();
  if(q.startsWith('set local') || q.startsWith('lock table'))return [];
  if(q.includes('from marketing.work_rating_reviewers rr') && q.includes('where rr.user_id='))
    return model.approvers.includes(values[0])?[{one:1}]:[];
  if(q.includes('select i.*,t.name as task_name'))return [{...item}];
  if(q.includes('select id from marketing.work_tasks'))return [{id:item.task_id}];
  if(q.startsWith('select id,assigned_to,status,formats from marketing.work_items'))return [{...item}];
  if(q.startsWith('select id::text,name from marketing.work_kpi_criteria'))return [{id:uid(90),name:'معيار جودة'}];
  if(q.startsWith('insert into marketing.work_item_ratings')){model.ratings.push({id:values[0],percentage:values[4]});return [];}
  if(q.includes('select * from marketing.work_items where id='))return [{...item}];
  if(q.includes('coalesce(d.name') && q.includes('from marketing.work_items'))
    return [{...item,files:item.files,format_reviews:model.formatReviews.map(x=>({...x})),review_notes:model.notes.map(x=>({...x})),
      latest_review_event:model.history.at(-1) ? {action:model.history.at(-1).action} : null}];
  if(q.includes('from marketing.work_review_categories') && q.includes('where id='))return [{id:uid(60)}];
  if(q.startsWith('select coalesce(max(revision_number)'))return [{number:Math.max(0,...model.notes.map(x=>x.revision_number)),count:model.notes.length}];
  if(q.startsWith('select 1 from marketing.work_history') && q.includes("revision_declined"))
    return model.history.some(x=>x.action==='revision_declined')?[{one:1}]:[];
  if(q.startsWith('insert into marketing.work_history')){model.history.push({action:values[2],note:values[3]});return []}
  if(q.startsWith('insert into marketing.work_format_reviews')){
    const status=values[2];const found=model.formatReviews.find(x=>x.format_id===fmt.id);
    if(found)found.status=status;else model.formatReviews.push({format_id:fmt.id,status});return [];
  }
  if(q.startsWith('select format_id,status from marketing.work_format_reviews'))return model.formatReviews.map(x=>({...x}));
  if(q.startsWith('select format_id::text from marketing.work_format_reviews'))return model.formatReviews.filter(x=>x.status==='revision');
  if(q.startsWith('update marketing.work_format_reviews')){model.formatReviews.filter(x=>x.status==='revision').forEach(x=>x.status='submitted');return []}
  if(q.startsWith('insert into marketing.work_item_review_notes')){model.notes.push({revision_number:values.at(-1),note:values[2],executor_response:null});return []}
  if(q.startsWith('update marketing.work_item_review_notes')){model.notes.forEach(x=>x.executor_response=values[0]);return []}
  if(q.startsWith('update marketing.work_items set status=')){item.status=q.includes("status='rejected'")?'rejected':values[0];item.version++;return []}
  if(q.startsWith('update marketing.work_tasks'))return [];
  if(q.startsWith('insert into marketing.work_action_progress'))return [];
  if(q.startsWith('select format_id from marketing.work_format_reviews'))return model.formatReviews;
  throw Error('Unexpected SQL in fixture: '+q);
 };
 db.begin=async fn=>fn(db);db.json=x=>x;return {db,model};
}
(async()=>{
 let tests=0;
 const check=(name,fn)=>{tests++;console.log('PASS',name)};
 const schema=fs.readFileSync('server/_marketing-workflow-schema.ts','utf8');
 assert(schema.includes('MARKETING_WORKFLOW_REVISION_POLICY_SQL')&&schema.includes("'schema-8'"));check('Additive schema supports state editing and two grader slots');
 let {db,model}=makeFixture();
 for(let n=1;n<=3;n++){
  await reviewItem(db,{itemId:model.item.id,version:model.item.version,decision:'revise',note:'Change '+n,categoryId:uid(60)},owner);
  assert.equal(model.notes.length,n);assert.equal(model.notes[n-1].revision_number,n);assert.equal(model.item.status,'revision');
 }
 check('All three immutable revisions can be requested in the first review cycle');
 await assert.rejects(()=>reviewItem(db,{itemId:model.item.id,version:model.item.version,decision:'revise',note:'Fourth',categoryId:uid(60)},owner),/التعديلات الثلاثة/);
 assert.equal(model.notes.length,3);check('Fourth revision is rejected by server');
 await assert.rejects(()=>evals.manageItemReviewNote(db,owner,{noteId:uid(1),note:'edit'},model.item),/نهائية/);
 check('Saved note cannot be edited or deleted via endpoint');
 await assert.rejects(()=>respondToItemRevision(db,{itemId:model.item.id,version:model.item.version},appointed,true),/صلاحية/);
 check('Other executor cannot accept revision');
 await respondToItemRevision(db,{itemId:model.item.id,version:model.item.version},worker,true);
 assert.equal(model.item.status,'editing');assert(model.notes.every(x=>x.executor_response==='accepted'));
 check('Executor accepts revision => editing, notes persist');
 let decline=makeFixture('revision');decline.model.formatReviews=[{format_id:fmt.id,status:'revision'}];
 await respondToItemRevision(decline.db,{itemId:decline.model.item.id,version:decline.model.item.version},worker,false);
 assert.equal(decline.model.item.status,'submitted');assert.equal(decline.model.formatReviews[0].status,'submitted');
 check('Executor refuses revision => submitted, same existing files retained');
 assert.equal(await evals.canGradeWorkItem(db,appointed),true);
 assert.equal(await evals.canGradeWorkItem(db,worker),false);
 check('Only assigned raters get server authorization');
 await assert.rejects(()=>evals.manageEvaluationSetting(db,owner,{kind:'raters',userIds:[owner.id,owner.id]}),/مختلفين/);
 check('Duplicate rating user slots are invalid');
 // Terminal rejection is a task outcome, not deletion or a product approval.
 const accepted = {...model.item,status:'approved',formats:[fmt],files:[finalFile],
  format_reviews:[{format_id:fmt.id,status:'approved'}]};
 const rejected = {...model.item,id:uid(54),status:'rejected',formats:[fmt],files:[],format_reviews:[]};
 const pending = {...model.item,id:uid(55),status:'in_progress',formats:[fmt],files:[],format_reviews:[]};
 assert.deepEqual(readiness.workReadiness([accepted,pending]),{total:2,approved:1,percent:50,complete:false});
 assert.deepEqual(readiness.workReadiness([accepted,accepted]),{total:2,approved:2,percent:100,complete:true});
 assert.deepEqual(readiness.workReadiness([accepted,rejected]),{total:2,approved:1,percent:100,complete:true});
 assert.deepEqual(readiness.workReadiness([rejected,rejected]),{total:2,approved:0,percent:100,complete:true});
 assert.equal(readiness.workItemReadiness(rejected),100);
 check('Readiness counts rejected requirements at 100% while approvals remain distinct');
 const finish=makeFixture('submitted');
 const uploadedFileIds=finish.model.item.files.map(file=>file.id);
 await reviewItem(finish.db,{itemId:finish.model.item.id,version:finish.model.item.version,decision:'reject'},owner);
 assert.equal(finish.model.item.status,'rejected');
 assert.deepEqual(finish.model.item.files.map(file=>file.id),uploadedFileIds);
 assert.equal(finish.model.history.at(-1).action,'rejected');
 assert.equal(readiness.workReadiness([finish.model.item]).percent,100);
 check('Reviewer rejection keeps files, item identity, and task progress intact');
 await assert.rejects(()=>reviewItem(finish.db,{itemId:finish.model.item.id,version:finish.model.item.version,decision:'approve'},owner),/المطلوب/);
 check('Terminal rejection cannot be revised or approved by stale reviewer action');
 const score=await evals.saveItemRating(finish.db,appointed,{scores:[{criterionId:uid(90),score:3}]},finish.model.item);
 assert.equal(score.percentage,100);
 assert.deepEqual(finish.model.ratings,[{id:finish.model.item.id,percentage:100}]);
 check('A rejected requirement can be rated by an appointed grader without final file approval');
 await assert.rejects(()=>evals.saveItemRating(finish.db,worker,{scores:[{criterionId:uid(90),score:3}]},finish.model.item),/صلاحية/);
 check('A non-appointed executor still cannot rate rejected deliverables');

 const ui=fs.readFileSync('src/marketing/workflow/TaskDetail.tsx','utf8');
 assert(ui.includes('+ إضافة تعديل')&&ui.includes('قبول التعديل')&&ui.includes('رفض التعديل'));
 assert(!ui.includes('manageNote(')&&!ui.includes('editNote('));check('Task UI has only immutable revision flow');
 console.log(`${tests}/${tests} marketing revision/rating policy tests passed`);
})().catch(e=>{console.error(e);process.exitCode=1});
