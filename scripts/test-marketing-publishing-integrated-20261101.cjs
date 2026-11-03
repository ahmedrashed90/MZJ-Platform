'use strict';
/** Integration regression without production database/network: dynamic day aggregation,
 * backend transitions and source-level read-only report boundaries. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const read = file => fs.readFileSync(file, 'utf8');
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0');
const user = {id:uid(1),fullName:'Tester',permissions:['platform.superadmin'],deniedPermissions:[],
  systemAccess:{marketing:{enabled:true,roleCode:'marketing_admin',dataScope:'all',branchCodes:[],departmentCodes:[]}}};
const stubs={
  '../_db.js':{getSql:()=>{throw Error('No live DB');},withDatabaseAdvisoryLock:async(_,fn)=>fn()},
  '../_auth.js':{loadUserProfile:async()=>user},
  '../_access-control.js':{getSystemAccess:u=>u.systemAccess.marketing},
  '../_marketing-workflow-schema.js':{assertMarketingWorkflowReady:async()=>{},marketingPlanScheduleSchemaStatus:async()=>({}),marketingWorkflowStructureStatus:async()=>({}),ensureMarketingWorkflowSchema:async()=>{}},
  '../_notifications.js':{createNotification:async()=>{}},
  '../_media-storage.js':{createUploadUrl:()=>{},headMediaObject:async()=>({}),mediaStorageConfigured:()=>false,buildMarketingStorageKey:()=>''},
  '../_google-drive-storage.js':{createGoogleDriveResumableUpload:async()=>({}),verifyGoogleDriveUploadedFile:async()=>({})},
};
const load=createLoader(process.cwd(),stubs,{'server/marketing/workflow.ts':'\nexport { updatePlanRows, planLines, savePlanPostUrl };'});
const { summarizePublishingDays }=load('src/marketing/workflow/publishingDaySummary.ts');
const { updatePlanRows, planLines, savePlanPostUrl }=load('server/marketing/workflow.ts');
const dashboard=read('src/marketing/pages/MarketingDashboardPage.tsx');
const report=read('src/marketing/workflow/PlanReport.tsx');
const manager=read('src/marketing/workflow/PlanDetail.tsx');
const prep=read('src/marketing/workflow/PublishPage.tsx');
const execution=read('src/marketing/workflow/TaskDetail.tsx');
const server=read('server/marketing/workflow.ts');
const schema=read('server/_marketing-workflow-schema.ts');
const shared=read('shared/marketing-workflow.ts');

const record=(id,date,platform,type,ready=false,timing=null)=>({
  id:uid(id),scheduled_on:date,idea_name:'صورة تعريفية',platform_name:platform,post_type_name:type,
  published_ready:ready,publication_timing:timing,product_id:uid(100),
});
const samples=[
  record(10,'2026-10-31','إنستجرام','بوست صور',true,'on_time'),
  record(11,'2026-10-31','سناب شات','Spotlight',true,'late'),
  record(12,'2026-10-31','تيك توك','ستوري',false),
  record(13,'2026-11-01','إنستجرام','بوست صور',true,null),
];
const days=summarizePublishingDays(samples);
assert.equal(days.length,2,'one date must render as one dashboard row');
assert.equal(days[0].date,'2026-10-31');
assert.equal(days[0].publicationCount,3);
assert.deepEqual(days[0].platformNames,['إنستجرام','سناب شات','تيك توك']);
assert.equal(days[0].onTimeCount,1);assert.equal(days[0].lateCount,1);assert.equal(days[0].pendingCount,1);
assert.equal(days[1].undatedCount,1,'old links without dates may not be marked on time');
assert.equal(samples.length,4,'report source rows remain untouched');
console.log('PASS daily aggregation: 3 platforms + post types on same date yield one summary row; separate detailed lines preserved');

assert.match(dashboard,/\[publishingOpen, setPublishingOpen\] = useState\(true\)/);
assert.match(dashboard,/\{publishingOpen && <div id="mkw-publishing-body"/);
assert.match(dashboard,/summarizePublishingDays\(group\)/);
assert.match(dashboard,/expandedPlanIds\.has\(id\)/);
assert.match(dashboard,/hidden=\{!productsOpen\}/);
assert.match(dashboard,/<PlanReport id=\{tableId\}/);
assert.doesNotMatch(dashboard,/<PlanDetail id=\{tableId\}/);
assert.match(dashboard,/تاريخ الإنشاء: \{showDate\(group\[0\]\.plan_created_at\)\}/);
assert.match(dashboard,/const distinctProducts = new Set\(group.map\(line => line.product_id\)\)\.size/);
assert.match(dashboard,/>فتح<\/button>/);
console.log('PASS dashboard: publishing section open by default, product rows open only by title click, report not manager editor');

for(const field of ['plan.created_at','line.idea_name','line.platform_name','line.post_type_name','line.caption','line.hashtags','line.effective_post_url','line.scheduled_on']) {
  assert.ok(report.includes(field), `report must display ${field}`);
}
assert.match(report,/className="mkw-fullscreen mkw-plan-report-modal"/);
assert.match(report,/للعرض فقط/);
assert.doesNotMatch(report,/<input\b|<textarea\b|<select\b|\bworkPost\s*\(|\bLinkEditor\b/);
assert.match(report,/<button[^>]+mkw-campaign-export-pdf/, 'the existing export button does not mutate report data');
assert.doesNotMatch(report,/تاريخ النشر الفعلي/);
assert.doesNotMatch(manager,/save_plan_post_url|LinkEditor/);
assert.match(prep,/رابط المنشور وتاريخ النشر الفعلي/);
assert.match(prep,/workPost\('save_plan_post_url'/);
assert.doesNotMatch(execution,/mkw-executor-copy|saveCopy\(/,'caption and hashtags are only edited in publishing');
assert.match(shared,/manual_published_on\?: string/);
assert.match(schema,/MARKETING_WORKFLOW_PUBLICATION_DATES_SQL/);
assert.match(schema,/if \(!\(await flags\(\)\)\.hasPublicationDates\) await runSqlScript/);
assert.match(server,/as plan_created_at/);
console.log('PASS report is full-screen read-only with creation date, caption, hashtags and URL; link saving lives only in preparation');

function fakeSql(handler) {
  const calls=[];
  const sql=async (parts,...values)=>{
    const q=parts.join('?').replace(/\s+/g,' ').trim();calls.push({q,values});return handler(q,values);
  };
  sql.begin=async fn=>fn(sql);sql.json=v=>v;sql.calls=calls;
  return sql;
}
const blank={id:uid(20),plan_id:uid(21),product_id:uid(22),scheduled_on:'2026-10-31',manual_post_url:'',provider_post_url:'',
  review_status:'publishing',prepared_count:0,scheduled_count:0,published_count:0,failed_count:0};
(async()=>{
  const rows=[
    {...blank,id:uid(30),manual_post_url:'https://example.org/post',manual_published_on:'2026-10-31'},
    {...blank,id:uid(31),manual_post_url:'https://example.org/post2',manual_published_on:'2026-11-01'},
    {...blank,id:uid(32),manual_post_url:'https://example.org/old',manual_published_on:null},
    {...blank,id:uid(33),provider_post_url:'https://example.org/automatic',provider_published_on:'2026-10-30'},
  ];
  const result=await planLines(fakeSql(q=>q.includes('select l.*,l.scheduled_on::text')?rows:[]),user);
  assert.deepEqual(result.map(row=>row.publication_timing),['on_time','late',null,'on_time']);
  assert.equal(result[2].published_on,null);
  console.log('PASS publication dates and green/red timing respect dates, not save timestamps');

  const planId=uid(6),productId=uid(7),postTypeId=uid(8),lineId=uid(9);
  const product={id:productId,idea_name:'Test',media_kind:'image',status:'approved',formats:[{id:postTypeId,name:'Photo'}],files:[{category:'final',status:'ready',format_id:postTypeId,name:'photo.png',mime_type:'image/png'}]};
  const sql=fakeSql(q=>{
    if(q.includes('select * from marketing.work_plans'))return [{id:planId,created_by:user.id,kind:'agenda',review_status:'revision',activated_at:null,review_note:'ملاحظة قديمة'}];
    if(q.includes('select id::text from marketing.work_plan_items'))return [{id:lineId}];
    if(q.includes('select i.*,i.due_on::text,t.name as task_name'))return [product];
    if(q.includes('select i.*,i.due_on::text,coalesce(d.name'))return [product];
    if(q.includes('select pt.id::text,pt.platform_id::text'))return [{id:postTypeId,name:'Photo'}];
    return [];
  });
  await updatePlanRows(sql,user,{planId,entries:[{id:lineId,date:'2026-11-05',productId,postTypeId,budget:0}]});
  const updates=sql.calls.filter(item=>item.q.includes('update marketing.work_plans'));
  assert.equal(updates.length,1);
  assert.match(updates[0].q,/review_status='submitted'/);
  assert.doesNotMatch(updates[0].q,/review_note=/);
  assert.ok(sql.calls.some(item=>item.q.includes('insert into marketing.work_plan_reviews') && item.q.includes("'submitted'")));
  console.log('PASS plan edit+save atomically submits for review and retains existing notes');

  const statusUser=user;
  const saved=fakeSql(q=>{
    if(q.includes('select l.id,l.plan_id,l.manual_post_url'))return [{id:lineId,plan_id:planId,review_status:'publishing',created_by:statusUser.id,manual_post_url:'',manual_published_on:null}];
    if(q.includes('select l.*,l.scheduled_on::text'))return [{id:lineId,plan_id:planId,review_status:'publishing',manual_post_url:'',provider_post_url:'',prepared_count:0,published_count:0,scheduled_count:0,failed_count:0}];
    if(q.includes('update marketing.work_plan_items'))return [{published_on:'2026-11-01'}];
    return [];
  });
  await savePlanPostUrl(saved,user,{lineId,url:'https://example.org/post',publishedOn:'2026-10-31'});
  assert.ok(saved.calls.some(item=>item.q.includes('update marketing.work_plan_items') && item.q.includes('manual_published_on')));
  await assert.rejects(()=>savePlanPostUrl(saved,user,{lineId,url:'javascript:alert(1)',publishedOn:'2026-10-31'}));
  console.log('PASS link storage validates URLs and actual dates; no report mutations');

  for(const file of ['src/marketing/pages/MarketingDashboardPage.tsx','src/marketing/workflow/PlanReport.tsx',
    'src/marketing/workflow/PlanDetail.tsx','src/marketing/workflow/PublishPage.tsx','src/marketing/workflow/TaskDetail.tsx','src/marketing/workflow/publishingDaySummary.ts',
    'server/marketing/workflow.ts','server/_marketing-workflow-schema.ts','shared/marketing-workflow.ts']) {
    const source=read(file);
    const sourceFile=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    assert.equal(sourceFile.parseDiagnostics.length,0,file+' has syntax diagnostics');
  }
  console.log('PASS 9 changed TypeScript/TSX modules parse without syntax errors');
  console.log('ALL integrated publishing checks passed');
})().catch(err=>{console.error(err);process.exitCode=1;});
