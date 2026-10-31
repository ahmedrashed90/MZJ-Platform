'use strict';
/** Regression coverage for compact daily publishing, real publication dates and
 * atomic plan-edit review submission. No live database/provider calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const user = { id:uid(1),fullName:'Manager',permissions:['platform.superadmin'],deniedPermissions:[],
  systemAccess:{marketing:{enabled:true,roleCode:'marketing_admin',dataScope:'all',branchCodes:[],departmentCodes:[]}} };
const stubs = {
  '../_db.js':{getSql:()=>{throw Error('No live DB');},withDatabaseAdvisoryLock:async(_,fn)=>fn()},
  '../_auth.js':{loadUserProfile:async()=>user},
  '../_access-control.js':{getSystemAccess:u=>u.systemAccess.marketing},
  '../_marketing-workflow-schema.js':{assertMarketingWorkflowReady:async()=>{},marketingPlanScheduleSchemaStatus:async()=>({}),marketingWorkflowStructureStatus:async()=>({}),ensureMarketingWorkflowSchema:async()=>{}},
  '../_notifications.js':{createNotification:async()=>{}},
  '../_media-storage.js':{createUploadUrl:()=>{},headMediaObject:async()=>({}),mediaStorageConfigured:()=>false,buildMarketingStorageKey:()=>''},
  '../_google-drive-storage.js':{createGoogleDriveResumableUpload:async()=>({}),verifyGoogleDriveUploadedFile:async()=>({})},
};
const load = createLoader(process.cwd(),stubs,{'server/marketing/workflow.ts':'\nexport { updatePlanRows, planLines };'});
const { updatePlanRows, planLines } = load('server/marketing/workflow.ts');
const dashboard = fs.readFileSync('src/marketing/pages/MarketingDashboardPage.tsx','utf8');
const planDetail = fs.readFileSync('src/marketing/workflow/PlanDetail.tsx','utf8');
const prep = fs.readFileSync('src/marketing/workflow/PublishPage.tsx','utf8');
const execution = fs.readFileSync('src/marketing/workflow/TaskDetail.tsx','utf8');
const schema = fs.readFileSync('server/_marketing-workflow-schema.ts','utf8');
assert.match(dashboard, /useState\(false\).*publishingOpen|\[publishingOpen, setPublishingOpen\] = useState\(false\)/);
assert.match(dashboard, /\{publishingOpen && <div className="mkw-column-body">/);
assert.match(dashboard, /const days = new Map<string, WorkPlanLine\[\]>\(\)/);
assert.match(dashboard, /for \(const line of group\)/);
assert.match(dashboard, /\[\.\.\.days\.entries\(\)\]/);
assert.doesNotMatch(dashboard, /<div className="mkw-plan-lines">\{group\.map/);
assert.match(dashboard, /plan_created_at/);
assert.match(dashboard, />التقرير<\/button>/);
assert.match(dashboard, />فتح<\/button>/);
assert.match(planDetail, /تاريخ إنشاء الأجندة أو الحملة/);
assert.match(planDetail, /سجل المراجعات والملاحظات السابقة/);
assert.match(prep, /رابط المنشور وتاريخ النشر الفعلي/);
assert.doesNotMatch(execution, /mkw-executor-copy/);
assert.match(schema, /MARKETING_WORKFLOW_PUBLICATION_DATES_SQL/);
assert.match(schema, /if \(!\(await flags\(\)\)\.hasPublicationDates\) await runSqlScript/);
console.log('PASS: default-collapsed daily dashboard, detailed report, task-copy removal and schema upgrade');

function fakeSql(handler) {
  const calls=[];
  const sql=async (parts,...values)=>{const q=parts.join('?').replace(/\s+/g,' ').trim();calls.push({q,values});return handler(q,values)};
  sql.begin=async fn=>fn(sql);sql.json=x=>x;sql.calls=calls;
  return sql;
}
function lineSql(data) { return fakeSql(q => q.includes('select l.*,l.scheduled_on::text') ? data : []); }
(async()=>{
  const base={id:uid(11),plan_id:uid(12),product_id:uid(13),scheduled_on:'2026-10-31',manual_post_url:'',provider_post_url:'',
    review_status:'publishing',prepared_count:0,scheduled_count:0,published_count:0,failed_count:0};
  const rows=[
    {...base,id:uid(20),manual_post_url:'https://example.org/on-time',manual_published_on:'2026-10-31'},
    {...base,id:uid(21),manual_post_url:'https://example.org/late',manual_published_on:'2026-11-01'},
    {...base,id:uid(22),manual_post_url:'https://example.org/old',manual_published_on:null},
    {...base,id:uid(23)},
    {...base,id:uid(24),provider_post_url:'https://example.org/provider',provider_published_on:'2026-10-30'},
  ];
  const result=await planLines(lineSql(rows),user);
  assert.deepEqual(result.map(line=>line.publication_timing),['on_time','late',null,null,'on_time']);
  assert.deepEqual(result.map(line=>line.published_ready),[true,true,true,false,true]);
  assert.equal(result[2].published_on,null,'legacy URL must not be assigned a fabricated date');
  console.log('PASS: actual date controls on-time/late classification; old links remain undated');

  const planId=uid(7), productId=uid(8), postTypeId=uid(9), lineId=uid(10), taskId=uid(6);
  const product={id:productId,task_id:taskId,idea_name:'Test',media_kind:'image',status:'approved',
    formats:[{id:postTypeId,name:'Photo'}],files:[{category:'final',status:'ready',format_id:postTypeId,name:'photo.png',mime_type:'image/png'}]};
  const sql=fakeSql(q=>{
    if(q.includes('select * from marketing.work_plans'))return [{id:planId,created_by:user.id,kind:'agenda',review_status:'revision',activated_at:null,review_note:'ملاحظة محفوظة'}];
    if(q.includes('select id::text from marketing.work_plan_items'))return [{id:lineId}];
    if(q.includes('select i.*,i.due_on::text,t.name as task_name'))return [product];
    if(q.includes('select i.*,i.due_on::text,coalesce(d.name'))return [product];
    if(q.includes('select pt.id::text,pt.platform_id::text'))return [{id:postTypeId,name:'Photo'}];
    return [];
  });
  const response=await updatePlanRows(sql,user,{planId,entries:[{id:lineId,date:'2026-11-05',productId,postTypeId,budget:0}]});
  assert.equal(response.ok,true);
  const updates=sql.calls.filter(item=>item.q.includes('update marketing.work_plans'));
  assert.equal(updates.length,1);
  assert.match(updates[0].q,/review_status='submitted'/);
  assert.doesNotMatch(updates[0].q,/review_note=/);
  assert.ok(sql.calls.some(item=>item.q.includes('insert into marketing.work_plan_reviews')&&item.q.includes("'submitted'")));
  console.log('PASS: edit save atomically submits for review and keeps previous notes intact');
  console.log('3/3 new publishing regression sections passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
