// Regression: older pending revision notes are executable even when a format
// review row is missing or stale. Never mutate final files on a decline.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const root = process.cwd();
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const formatId = uid(70);
const owner = { id: uid(1),fullName:'Reviewer',permissions:['marketing.task.review'],systemAccess:{marketing:{enabled:true,dataScope:'all'}} };
const assignee = { id: uid(2),fullName:'Executor',permissions:['marketing.task.view_assigned'],systemAccess:{marketing:{enabled:true,dataScope:'assigned'}} };
const outsider = { ...assignee,id:uid(3) };
const notifications=[];
const load = createLoader(root, {
 '../_db.js': { getSql: () => { throw Error('test must not use production DB'); }, withDatabaseAdvisoryLock: async (_, fn) => fn() },
 '../_auth.js': { loadUserProfile: async () => null },
 '../_access-control.js': { getSystemAccess: user => user.systemAccess.marketing },
 '../_marketing-workflow-schema.js': { assertMarketingWorkflowReady: async () => {}, ensureMarketingWorkflowSchema: async () => {}, marketingPlanScheduleSchemaStatus: async () => ({ready:true}) },
 '../_notifications.js': { createNotification: async (msg) => { notifications.push(msg); } },
 '../_media-storage.js': { mediaStorageConfigured: () => false, buildMarketingStorageKey: () => '', headMediaObject: async () => ({exists:true,size:1}) },
 '../_google-drive-storage.js': { createGoogleDriveResumableUpload: async () => ({uploadUrl:'https://unused.invalid'}) },
 './evaluations.js': { canGradeWorkItem: async () => false },
}, {'server/marketing/workflow.ts':'\nexport { respondToItemRevision };'});
const { respondToItemRevision } = load('server/marketing/workflow.ts');
function fixture({ formatStatus='submitted', unanswered=true, historyFormatIds=[formatId] }={}) {
 const file={id:uid(71),name:'original.mp4',mime_type:'video/mp4',status:'ready',category:'final',format_id:formatId};
 const item={id:uid(60),task_id:uid(61),task_name:'Test',created_by:owner.id,assigned_to:assignee.id,department_id:uid(62),
   status:'revision',version:3,formats:[{id:formatId,name:'Reel'}],files:[file],media_kind:'video',due_on:'2026-11-11'};
 const m={item,files:[file],formatReviews:formatStatus?[{format_id:formatId,status:formatStatus}]:[], notes:[{id:uid(80),executor_response:unanswered?null:'accepted'}],history:[]};
 const db=async(parts,...vals)=>{
  const q=parts.join('?').replace(/\s+/g,' ').trim();
  if(q.startsWith('set local'))return [];
  if(q.includes('select i.*,t.name as task_name'))return [{...item}];
  if(q.startsWith('select id from marketing.work_tasks'))return [{id:item.task_id}];
  if(q.startsWith('select * from marketing.work_items where id='))return [{...item}];
  if(q.startsWith('select format_id::text from marketing.work_format_reviews') && q.includes("status='revision'"))
    return m.formatReviews.filter(x=>x.status==='revision');
  if(q.startsWith('select format_id::text from marketing.work_format_reviews') && q.includes("status='submitted'"))
    return m.formatReviews.filter(x=>x.status==='submitted');
  if(q.startsWith('select id::text from marketing.work_item_review_notes'))return unanswered?[{id:uid(80)}]:[];
  if(q.startsWith('select data from marketing.work_history'))return [{data:{formatIds:historyFormatIds}}];
  if(q.startsWith("update marketing.work_format_reviews set status='revision'")){
    for(const r of m.formatReviews){if(r.status==='submitted' && vals[1].includes(r.format_id))r.status='revision';}return [];
  }
  if(q.startsWith("update marketing.work_format_reviews set status='submitted'")){
    for(const r of m.formatReviews){if(r.status==='revision')r.status='submitted';}return [];
  }
  if(q.startsWith('update marketing.work_item_review_notes')){
    for(const n of m.notes){if(n.executor_response===null)n.executor_response=vals[0];}return [];
  }
  if(q.startsWith('update marketing.work_items set status=')){
    item.status=vals[0];item.version++;return [];
  }
  if(q.startsWith('insert into marketing.work_history')){m.history.push(vals[2]);return []}
  if(q.includes('coalesce(d.name') && q.includes('from marketing.work_items'))
    return [{...item,files:m.files,format_reviews:m.formatReviews,review_notes:m.notes}];
  if(q.startsWith('update marketing.work_tasks'))return [];
  throw Error('Unexpected SQL in regression fixture: '+q);
 };
 db.begin=async fn=>fn(db);db.json=x=>x;
 return {db,m};
}
(async()=>{
 let total=0;
 const check=(ok, desc)=>{assert.ok(ok,desc); console.log('PASS:',desc);total++;};
 const ui=fs.readFileSync('src/marketing/workflow/TaskDetail.tsx','utf8');
 check(ui.includes("const hasUnansweredRevision = (item.review_notes || []).some(note => !note.executor_response)") &&
  ui.includes("(revisionPending || hasUnansweredRevision)"),'Outstanding immutable review note restores executor response buttons');
 check(!ui.includes("hasPermission(user, 'marketing.task.final_file.upload') && item.status === 'revision'"), 'Responding is separate from uploading new files');
 {
  const {db,m}=fixture({formatStatus:'revision'}); const res=await respondToItemRevision(db,{itemId:m.item.id,version:m.item.version},assignee,true);
  check(res.ok && m.item.status==='editing' && m.formatReviews[0].status==='revision', 'Normal pending revision remains actionable for assigned executor');
 }
 {
  const {db,m}=fixture(); const res=await respondToItemRevision(db,{itemId:m.item.id,version:m.item.version},assignee,true);
  check(res.ok && m.item.status==='editing' && m.formatReviews[0].status==='revision', 'Old request with stale submitted format: accept unlocks only requested size');
  check(m.files.length===1 && m.files[0].name==='original.mp4' && m.notes[0].executor_response==='accepted', 'Accept preserves old file and permanently records executor response');
 }
 {
  const {db,m}=fixture(); const res=await respondToItemRevision(db,{itemId:m.item.id,version:m.item.version},assignee,false);
  check(res.ok && m.item.status==='submitted' && m.formatReviews[0].status==='submitted','Old request: decline returns the same format to review');
  check(m.files.length===1 && m.notes[0].executor_response==='declined','Decline preserves originals and permanently records executor response');
 }
 {
  const {db,m}=fixture({formatStatus:null});await respondToItemRevision(db,{itemId:m.item.id,version:m.item.version},assignee,true);
  check(m.item.status==='editing' && !m.formatReviews.length,'Old request with missing format reviews is still accepted without inventing new data');
 }
 {
  const {db,m}=fixture({unanswered:false});await assert.rejects(()=>respondToItemRevision(db,{itemId:m.item.id,version:m.item.version},assignee,true),/لا يوجد تعديل مطلوب/);
  check(m.item.status==='revision','Responded note cannot be accepted again');
 }
 {
  const {db,m}=fixture();await assert.rejects(()=>respondToItemRevision(db,{itemId:m.item.id,version:m.item.version},outsider,true),/صلاحية/);
  check(m.item.status==='revision','Other users cannot respond even with task visibility');
 }
 {
  const {db,m}=fixture();await assert.rejects(()=>respondToItemRevision(db,{itemId:m.item.id,version:m.item.version+1},assignee,true),/حدّث الصفحة/);
  check(m.item.status==='revision','Stale requests cannot overwrite newer item versions');
 }
 console.log(`${total}/${total} revision-response regression checks passed`);
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
