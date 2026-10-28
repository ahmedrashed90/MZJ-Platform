const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const {createLoader,scriptedSql} = require('./marketing-workflow-test-support.cjs');
const root=process.cwd();
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const marketing={enabled:true,dataScope:'all',roleCode:'marketing_admin',branchCodes:[],departmentCodes:[]};
const admin={id:uid(1),fullName:'Marketing admin',roleCodes:['marketing_admin'],permissions:['marketing.task.review','marketing.task.view_all','system.marketing.access'],deniedPermissions:[],systemAccess:{marketing}};
const worker={id:uid(2),fullName:'Executor',roleCodes:['marketing_user'],permissions:['marketing.task.view_assigned','marketing.task.final_file.upload','system.marketing.access'],deniedPermissions:[],systemAccess:{marketing:{...marketing,roleCode:'marketing_user',dataScope:'assigned'}}};
const reviewer={...admin,roleCodes:['marketing_user'],systemAccess:{marketing:{...marketing,roleCode:'marketing_user'}}};
const formatA={id:uid(10),name:'1080x1080',platform_name:'Instagram',platform_id:uid(20),platform_code:'instagram'};
const formatB={...formatA,id:uid(11),name:'1080x1920'};
const item={id:uid(51),task_id:uid(50),task_name:'Task',task_no:'TSK-000083',created_by:admin.id,assigned_to:worker.id,department_id:uid(30),status:'in_progress',media_kind:'image',formats:[formatA,formatB],version:7,due_on:'2026-10-28'};
const notifications=[];
const stubs={
  '../_db.js':{getSql:()=>{throw Error('No live database');},withDatabaseAdvisoryLock:async(k,fn)=>fn()},
  '../_auth.js':{loadUserProfile:async()=>null},
  '../_access-control.js':{getSystemAccess:u=>u.systemAccess.marketing},
  '../_marketing-workflow-schema.js':{ensureMarketingWorkflowSchema:async()=>{}},
  '../_notifications.js':{createNotification:async e=>notifications.push(e)},
  '../_media-storage.js':{mediaStorageConfigured:()=>false,buildMarketingStorageKey:()=>'',headMediaObject:async()=>({exists:true,size:4})},
  '../_google-drive-storage.js':{createGoogleDriveResumableUpload:async()=>({}),verifyGoogleDriveUploadedFile:async()=>({})},
  './evaluations.js':{canGradeWorkItem:async()=>false},
};
const api=createLoader(root,stubs,{'server/marketing/workflow.ts':'\nexport { removeItemFormat };'})('server/marketing/workflow.ts');
const step=(match,rows=[],check)=>({match,rows,check});
const taskLock=()=>step('select id from marketing.work_tasks');
const itemRead=()=>step('select i.*,t.name as task_name',[item]);
const itemLock=()=>step('select * from marketing.work_items',[item]);
const recalc=[taskLock(),step('coalesce(d.name',[{...item,formats:[formatB],files:[]}]),step('update marketing.work_tasks')];
const checks=[];
async function test(name,fn){try{await fn();checks.push(name);console.log('PASS:',name);}catch(e){console.error('FAIL:',name,e);process.exitCode=1;}}
(async()=>{
 await test('Late count excludes approved exception; on-time includes it',()=>{
   const source=fs.readFileSync(path.join(root,'server/marketing/workflow.ts'),'utf8');
   const countSql=source.slice(source.indexOf('async function taskList('),source.indexOf('async function reserveTask('));
   assert.match(countSql,/submitted_on_time_count/);
   assert.match(countSql,/and not exists\(select 1 from marketing\.work_item_deadline_exceptions de where de\.item_id=i\.id and de\.status='approved'\)\)::int as submitted_late_count/);
   assert.match(countSql,/submitted_on_time_count[\s\S]*submitted_late_count/);
   const ui=fs.readFileSync(path.join(root,'src/marketing/workflow/TaskDetail.tsx'),'utf8');
   assert(ui.includes("deliveryFilter === 'on_time' && item.delivery_status === 'exception_approved'"));
 });
 await test('Only admin or system administrator may remove sizes',()=>{
   assert.equal(api.workflowCapabilities(admin).manageFormats,true);
   assert.equal(api.workflowCapabilities(worker).manageFormats,false);
   assert.equal(api.workflowCapabilities(reviewer).manageFormats,false);
 });
 await test('Admin removes one unreviewed size and preserves remaining requirement',async()=>{
   const sql=scriptedSql([
     itemRead(),taskLock(),itemLock(),step('select status from marketing.work_format_reviews',[]),
     step('select 1 from marketing.work_uploads',[]),
     step('select j.file_id::text as id',[{id:uid(81),name:'old.jpg'}]),
     step('delete from marketing.work_item_files',[],(v,q)=>assert.equal(v[1],formatA.id)),
     step('delete from marketing.work_format_reviews'),
     step('select format_id,status from marketing.work_format_reviews',[]),
     step('update marketing.work_items', [{version:8}],(v)=>{assert.equal(v[0][0].id,formatB.id);assert.equal(v[1],'in_progress');}),
     step('insert into marketing.work_history',[],(v)=>{assert.equal(v[2],'format_removed');assert.equal(v[6].detachedFiles[0].name,'old.jpg');}),
     ...recalc,
   ]);
   const result=await api.removeItemFormat(sql,{itemId:item.id,formatId:formatA.id,version:7},admin);
   assert.equal(result.version,8);sql.assertDone();
   assert.equal(notifications.length,1);
 });
 await test('Refuse removing last size',async()=>{
   const onlyOne={...item,formats:[formatA]};
   const sql=scriptedSql([itemRead(),taskLock(),step('select * from marketing.work_items',[onlyOne])]);
   await assert.rejects(()=>api.removeItemFormat(sql,{itemId:item.id,formatId:formatA.id,version:7},admin),/آخر مقاس/);
   sql.assertDone();
 });
 await test('Refuse removing approved or submitted size',async()=>{
   for(const status of ['approved','submitted']){
     const sql=scriptedSql([itemRead(),taskLock(),itemLock(),step('select status from marketing.work_format_reviews',[{status}])]);
     await assert.rejects(()=>api.removeItemFormat(sql,{itemId:item.id,formatId:formatA.id,version:7},admin),status==='approved'?/تراجع عن اعتماد/:/قيد المراجعة/);
     sql.assertDone();
   }
 });
 await test('Executor cannot call delete endpoint even with item access',async()=>{
   const sql=scriptedSql([]);
   await assert.rejects(()=>api.removeItemFormat(sql,{itemId:item.id,formatId:formatA.id,version:7},worker),/للأدمن أو مدير النظام/);
   sql.assertDone();
 });
 await test('Marketing index upgrade remains explicit, not a GET-side migration',()=>{
   const schema=fs.readFileSync(path.join(root,'server/_marketing-workflow-schema.ts'),'utf8');
   assert(schema.includes('MARKETING_WORKFLOW_PERFORMANCE_SQL'));
   assert(schema.includes("values('schema-11')"));
   assert(schema.includes('work_history_task_recent'));
   const workflow=fs.readFileSync(path.join(root,'server/marketing/workflow.ts'),'utf8');
   assert(workflow.includes('performanceReady'));
 });
 console.log(`${checks.length}/7 new marketing checks passed`);
})();
