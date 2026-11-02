// Regression tests for automatic final-size submission and delivery-calendar ratings.
// Runs the actual workflow functions with an in-memory SQL boundary; no live DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const root = process.cwd();
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0');
const admin = {id:uid(1),fullName:'Admin',permissions:['platform.superadmin'],deniedPermissions:[],systemAccess:{marketing:{enabled:true,dataScope:'all',roleCode:'admin',branchCodes:[],departmentCodes:[]}}};
const worker = {id:uid(2),fullName:'Executor',permissions:['system.marketing.access','marketing.task.final_file.upload','marketing.receipt_calendar.view'],deniedPermissions:[],systemAccess:{marketing:{enabled:true,dataScope:'assigned',roleCode:'employee',branchCodes:[],departmentCodes:[]}}};
const load = createLoader(root, {
 '../_db.js':{getSql:()=>{throw Error('Live DB forbidden')},withDatabaseAdvisoryLock:async (_key,fn)=>fn()},
 '../_auth.js':{loadUserProfile:async()=>null},
 '../_access-control.js':{getSystemAccess:u=>u.systemAccess.marketing},
 '../_marketing-workflow-schema.js':{assertMarketingWorkflowReady:async()=>{},ensureMarketingWorkflowSchema:async()=>{},marketingPlanScheduleSchemaStatus:async()=>({ready:true})},
 '../_notifications.js':{createNotification:async()=>{}},
 '../_media-storage.js':{mediaStorageConfigured:()=>false,buildMarketingStorageKey:()=>'',headMediaObject:async()=>({exists:true,size:12})},
 '../_google-drive-storage.js':{createGoogleDriveResumableUpload:async()=>({uploadUrl:'https://example.invalid'})},
 './evaluations.js':{canGradeWorkItem:async()=>false},
}, {'server/marketing/workflow.ts':'\nexport {submitCompletedUpload, calendar, commitUpload};'});
const { submitCompletedUpload, calendar, commitUpload } = load('server/marketing/workflow.ts');
const { workFormatsReadyForReview } = load('shared/marketing-workflow.ts');
const makeFormat = n => ({id:'format-'+n,name:'بوست صور',platform_name:'إنستجرام'});
const formats = Array.from({length:4},(_,n)=>makeFormat(n+1));
const readyFile = fmt => ({id:uid(100+Number(fmt.id.slice(-1))),name:'creative.png',mime_type:'image/png',category:'final',format_id:fmt.id,status:'ready'});
const model = (format_reviews, files, pending=0) => {
 const item = {id:uid(15),task_id:uid(30),created_by:admin.id,assigned_to:worker.id,
   task_name:'Campaign',status:'editing',idea_name:'طلب صورة',media_kind:'image',formats,
   files,format_reviews:format_reviews.map(([format_id,status])=>({format_id,status})),due_on:'2026-11-01'};
 const inserts=[],changes=[],queries=[];
 const sql = async (parts,...values) => {
   const q=parts.join('?').replace(/\s+/g,' ').trim();queries.push(q);
   if(q.includes('count(*)::int as count from marketing.work_uploads')) return [{count:pending}];
   if(q.includes('from marketing.work_items i left join marketing.departments d'))return [item];
   if(q.startsWith('insert into marketing.work_format_reviews')) {inserts.push(values[1]);item.format_reviews.push({format_id:values[1],status:'submitted'});return []}
   if(q.startsWith("update marketing.work_items set status='submitted'")) {changes.push('submitted');item.status='submitted';return []}
   if(q.startsWith('insert into marketing.work_history'))return [];
   if(q.startsWith('select id from marketing.work_tasks'))return [{id:item.task_id}];
   if(q.startsWith('update marketing.work_tasks'))return [];
   throw Error('Unexpected SQL: '+q);
 };
 sql.json = data => data;
 return {item,sql,inserts,changes,queries};
};
let tests=0; const pass=x=>{console.log('PASS: '+x);tests++};
(async()=>{
 const approved=[formats[0],formats[1]];
 const saved=approved.map(fmt=>[fmt.id,'approved']);
 let state=model(saved,[...approved.map(readyFile),readyFile(formats[2])]);
 assert.deepEqual(workFormatsReadyForReview(state.item,true),[]);
 assert.equal(await submitCompletedUpload(state.sql,worker,state.item.id,state.item),null);
 assert.deepEqual(state.changes,[]);
 pass('Never auto-submit when even one configured size is missing');

 state=model(saved,formats.map(readyFile),1);
 assert.equal(await submitCompletedUpload(state.sql,worker,state.item.id,state.item),null);
 assert.deepEqual(state.changes,[]);
 pass('Never auto-submit while another file is still uploading');

 state=model(saved,formats.map(readyFile));
 const result=await submitCompletedUpload(state.sql,worker,state.item.id,state.item);
 assert.equal(result.taskId,state.item.task_id);
 assert.deepEqual(state.inserts,[formats[2].id,formats[3].id]);
 assert.equal(state.item.format_reviews.filter(row=>row.status==='approved').length,2);
 assert.deepEqual(state.changes,['submitted']);
 pass('Last required size submits only new formats; approved sizes retain approval');
 assert.equal(await submitCompletedUpload(state.sql,worker,state.item.id,state.item),null);
 assert.equal(state.inserts.length,2);
 pass('Submission is idempotent when there are no new formats');

 state=model([...saved,[formats[3].id,'revision']],formats.map(readyFile));
 assert.equal(await submitCompletedUpload(state.sql,worker,state.item.id,state.item),null);
 pass('A still-open revision cannot be silently submitted');

 state=model(saved,[...approved.map(readyFile),readyFile(formats[2]),{...readyFile(formats[3]),status:'uploading'}]);
 assert.deepEqual(workFormatsReadyForReview(state.item,true),[]);
 pass('Only ready files count toward the final-size review gate');

 state=model([],formats.map(readyFile));
 assert.equal((await submitCompletedUpload(state.sql,worker,state.item.id,state.item))?.taskId,state.item.task_id);
 assert.deepEqual(state.inserts,formats.map(fmt=>fmt.id));
 pass('First-time upload submits every required size automatically');

 state=model(formats.map(fmt=>[fmt.id,'submitted']),formats.map(readyFile));
 assert.equal(await submitCompletedUpload(state.sql,worker,state.item.id,state.item),null);
 pass('A fully submitted requirement is never resubmitted by another upload');

 state=model([], [{...readyFile(formats[0]),name:'carousel-1.png'}]);
 state.item.formats=[{...formats[0],name:'Carousel'}];
 assert.deepEqual(workFormatsReadyForReview(state.item,true),[]);
 state.item.files.push({...readyFile(formats[0]),id:uid(199),name:'carousel-2.png'});
 assert.equal(workFormatsReadyForReview(state.item,true).length,1);
 pass('Image carousel waits for its second required file before automatic review');

 const server=fs.readFileSync('server/marketing/workflow.ts','utf8');
 const client=fs.readFileSync('src/marketing/workflow/TaskDetail.tsx','utf8');
 const uploadApi=fs.readFileSync('src/marketing/workflow/api.ts','utf8');
 assert(server.includes("body.autoSubmit === true") && server.includes('submitCompletedUpload(tx, user'));
 assert(client.includes('index === selected.length - 1'));
 assert(uploadApi.includes('externalId, autoSubmit'));
 assert(client.includes('version.current = item.version'));
 pass('Only final file of a multi-file selection requests auto-submit, then syncs version');

 // Full request-to-database simulation: commit the last upload, then confirm
 // the same transaction marks its task submitted and does not rewrite approvals.
 {
  const uploadId=uid(400), mediaFile={...readyFile(formats[3]),id:uploadId};
  const uploadRow={file_id:uploadId,item_id:uid(15),category:'final',format_ids:[formats[3].id],
    created_by:worker.id,committed_at:null,cancelled_at:null,storage_provider:'r2',storage_key:'workflow/final.png',
    status:'uploading',file_size:12,original_name:'creative.png',mime_type:'image/png'};
  const m=model(saved,[...approved.map(readyFile),readyFile(formats[2])]);
  let taskSubmitted=false;
  const sql=async(parts,...values)=>{
   const q=parts.join('?').replace(/\s+/g,' ').trim();
   if(q.startsWith('set local'))return [];
   if(q.includes('select up.*,f.storage_provider'))return [{...uploadRow}];
   if(q.includes('select i.*,t.name as task_name'))return [{...m.item}];
   if(q.startsWith('select id from marketing.work_tasks'))return [{id:m.item.task_id}];
   if(q.startsWith('select * from marketing.work_items where id='))return [{...m.item}];
   if(q.startsWith('select * from marketing.work_uploads where file_id='))return [{...uploadRow}];
   if(q.startsWith('update marketing.files set status=')) {uploadRow.status='ready';return [];}
   if(q.startsWith('update marketing.work_uploads set committed_at=')) {uploadRow.committed_at='2026-11-01';return [];}
   if(q.startsWith('select format_id from marketing.work_format_reviews') && q.includes("status in ('approved','submitted')"))return [];
   if(q.startsWith('select media_kind from marketing.work_items'))return [{media_kind:'image'}];
   if(q.startsWith('select format_id from marketing.work_format_reviews') && q.includes("status='revision'"))return [];
   if(q.startsWith('insert into marketing.work_item_files')) {m.item.files.push(mediaFile);return [];}
   if(q.startsWith('delete from marketing.work_format_reviews'))return [];
   if(q.startsWith('update marketing.work_items set version='))return [];
   if(q.includes('count(*)::int as count from marketing.work_uploads'))return [{count:uploadRow.status==='ready'?0:1}];
   if(q.includes('from marketing.work_items i left join marketing.departments d'))return [m.item];
   if(q.startsWith('insert into marketing.work_format_reviews')) {m.inserts.push(values[1]);m.item.format_reviews.push({format_id:values[1],status:'submitted'});return [];}
   if(q.startsWith("update marketing.work_items set status='submitted'")) {taskSubmitted=true;m.item.status='submitted';return [];}
   if(q.startsWith('insert into marketing.work_history'))return [];
   if(q.startsWith('update marketing.work_tasks'))return [];
   if(q.startsWith('select u.id::text from core.users'))return [];
   throw Error('Unexpected SQL in commit: '+q);
  };
  sql.begin=async callback=>callback(sql);sql.json=data=>data;
  const committed=await commitUpload(sql,{fileId:uploadId,autoSubmit:true},worker);
  assert.equal(committed.ok,true);
  assert.equal(committed.autoSubmitted,true);
  assert.equal(uploadRow.status,'ready');
  assert.equal(taskSubmitted,true);
  assert.deepEqual(m.inserts,[formats[2].id,formats[3].id]);
  assert.equal(m.item.format_reviews.filter(row=>row.status==='approved').length,2);
  pass('Committing the last file atomically auto-submits and preserves approvals');
 }

 const firstDay=[{id:uid(201),task_id:uid(250),due_on:'2026-11-01',idea_name:'صورة 1'},
  {id:uid(202),task_id:uid(250),due_on:'2026-11-01',idea_name:'صورة 2'}];
 const current=Array.from({length:5},(_,i)=>({id:uid(201+i),task_id:uid(250),idea_name:'مطلوب '+(i+1),
  assignee_name:'منفذ '+(i+1),is_rated:i<2,status:i<2?'approved':'in_progress',files:[],formats:[],format_reviews:[],media_kind:'image'}));
 const archive=[{id:uid(206),task_id:uid(250),idea_name:'مطلوب 6',assignee_name:'منفذ 6',
  is_rated:true,status:'rejected'}];
 const log=[];
 const calendarSql=async(parts,...values)=>{
  const q=parts.join('?').replace(/\s+/g,' ').trim();log.push({q,values});
  if(q.includes('select distinct p.id::text as plan_id'))return [];
  if(q.includes('select i.id,i.task_id,i.due_on::text'))return firstDay;
  if(q.includes('select i.id::text as id,i.task_id::text as task_id'))return current;
  if(q.includes('from marketing.work_rejected_items r'))return archive;
  throw Error('Unexpected calendar SQL: '+q);
 };
 const output=await calendar(calendarSql,admin,{query:{from:'2026-11-01',to:'2026-11-30'}});
 assert.equal(output.rows.length,2);
 assert.deepEqual(output.planEvents,[]);
 assert.deepEqual({total:output.ratingSummaries[uid(250)].total,rated:output.ratingSummaries[uid(250)].rated,missing:output.ratingSummaries[uid(250)].missing},
  {total:6,rated:3,missing:3});
 assert.equal(output.ratingSummaries[uid(250)].items.length,6);
 pass('Calendar counts 3/6 across all task dates, including archived rejected ratings');
 assert(log.every(x=>!x.q.includes('drop table')));
 pass('Calendar summaries use read-only queries');
 const calendarUi=fs.readFileSync('src/marketing/pages/ReceiptCalendarPage.tsx','utf8');
 assert(calendarUi.includes('ratingSummaries[group.taskId]') && calendarUi.includes('entry.assignee_name'));
 assert(calendarUi.includes('لم يُقيّم بعد') && calendarUi.includes('بانتظار التقييم'));
 pass('Calendar shows who was graded and who still needs a rating');
 const rightColumn = calendarUi.indexOf('<aside className="mkw-calendar-sidebar"');
 const ratingsPanel = calendarUi.indexOf('className="mkw-panel mkw-calendar-ratings-panel"');
 const sidebarEnd = calendarUi.indexOf('</aside>', rightColumn);
 const deliveriesPanel = calendarUi.indexOf('className="mkw-panel mkw-calendar-deliveries"');
 assert(rightColumn >= 0 && ratingsPanel > rightColumn && sidebarEnd > ratingsPanel && deliveriesPanel > sidebarEnd,
  'Ratings must render beneath the calendar in the right sidebar, not among delivery cards');
 assert(calendarUi.includes('ratedTaskGroups.map(group =>') && calendarUi.includes('selectedGroups.map(group =>'));
 const css=fs.readFileSync('src/marketing/workflow/workflow.css','utf8');
 assert(css.includes('.mkw-calendar-sidebar { display:grid; gap:20px;') && css.includes('.mkw-calendar-layout { display:grid;'));
 pass('Task ratings render under the right-hand calendar; deliveries remain in the left column');
 console.log(`${tests}/${tests} automatic submission and calendar rating tests passed`);
})().catch(error=>{console.error(error);process.exitCode=1});
