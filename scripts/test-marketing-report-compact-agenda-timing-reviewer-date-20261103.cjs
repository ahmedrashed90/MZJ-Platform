'use strict';
/** Regression: compact read-only captions, agenda timing, and audited reviewer-only manual-date correction.
 * All Postgres/media/notification calls are mocked; never contacts production. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const reviewerId=uid(1),adminId=uid(2),creatorId=uid(3),lineId=uid(4),planId=uid(5);
const users={reviewer:{id:reviewerId,fullName:'Reviewer',permissions:[],deniedPermissions:[]},
  admin:{id:adminId,fullName:'Admin not assigned to plan review',permissions:['platform.superadmin'],deniedPermissions:[]},
  creator:{id:creatorId,fullName:'Creator',permissions:[],deniedPermissions:[]}};
const stubs={
  '../_db.js':{getSql:()=>{throw Error('No live DB');},withDatabaseAdvisoryLock:async(_k,fn)=>fn()},
  '../_auth.js':{loadUserProfile:async()=>null},
  '../_access-control.js':{getSystemAccess:()=>({dataScope:'all',roleCode:'marketing_admin',departmentCodes:[],branchCodes:[]})},
  '../_marketing-workflow-schema.js':{assertMarketingWorkflowReady:async()=>{},marketingPlanScheduleSchemaStatus:async()=>({}),marketingWorkflowStructureStatus:async()=>({}),ensureMarketingWorkflowSchema:async()=>{}},
  '../_notifications.js':{createNotification:async()=>{}},
  '../_media-storage.js':{createUploadUrl:()=>{},headMediaObject:async()=>({}),mediaStorageConfigured:()=>false,buildMarketingStorageKey:()=>''},
  '../_google-drive-storage.js':{createGoogleDriveResumableUpload:async()=>({}),verifyGoogleDriveUploadedFile:async()=>({})},
};
const api=createLoader(process.cwd(),stubs,{'server/marketing/workflow.ts':'\nexport {correctPlanPublicationDate,savePlanPostUrl};\n'})('server/marketing/workflow.ts');
const {summarizePublishingDays}=createLoader(process.cwd(),{})('src/marketing/workflow/publishingDaySummary.ts');
const read=p=>fs.readFileSync(p,'utf8');
const server=read('server/marketing/workflow.ts'),dashboard=read('src/marketing/pages/MarketingDashboardPage.tsx'),
  report=read('src/marketing/workflow/PlanReport.tsx'),prep=read('src/marketing/workflow/PublishPage.tsx'),
  css=read('src/marketing/workflow/workflow.css'),execution=read('src/marketing/workflow/TaskDetail.tsx');
let passed=0;const check=(name)=>{passed++;console.log('PASS',name);};
assert.match(css,/\.mkw-plan-report-copy\s*\{[^}]*white-space:nowrap;[^}]*text-overflow:ellipsis/);
assert.match(report,/className="mkw-plan-report-copy" title=\{line.caption/);
assert.match(report,/className="mkw-plan-report-copy" title=\{line.hashtags/);
check('Both report copy columns are one line with full-text title and without scrolling cells');
assert.match(dashboard,/group\[0\]\.kind === 'agenda' && \(onTimePosts > 0 \|\| latePosts > 0\)/);
assert.match(dashboard,/mkw-dashboard-agenda-timing mkw-delivery-summary/);
assert.match(dashboard,/نشر في الموعد/);assert.match(dashboard,/تأخر في النشر/);
check('Agenda cards show compact on-time/late counts, keeping campaign/day rows intact');
const days=summarizePublishingDays([
  {scheduled_on:'2026-11-02',published_ready:true,publication_timing:'on_time'},
  {scheduled_on:'2026-11-02',published_ready:true,publication_timing:'late'},
  {scheduled_on:'2026-11-02',published_ready:false,publication_timing:null},
]);
assert.equal(days[0].onTimeCount,1);assert.equal(days[0].lateCount,1);assert.equal(days[0].pendingCount,1);
check('Timing counts include only published lines with verified publication dates');
assert.match(prep,/data\.canCorrectPublishedDate && linkFinalized/);
assert.match(prep,/onClick=\{\(\) => void correctPublishedDate\(\)\}/);
assert.match(prep,/readOnly=\{linkFinalized\}/);
assert.match(prep,/disabled aria-label="تاريخ النشر الفعلي المسجل تلقائيًا"/);
assert.match(server,/canCorrectPublishedDate: \['publishing', 'published'\]/);
assert.match(server,/else if \(action === 'work_correct_plan_published_on'\)/);
check('Only configured reviewers receive correction editor; original URL and date field remain locked');
assert.match(dashboard,/!query\.data\?\.capabilities\.prepare && !query\.data\?\.canReviewPlans/);
assert.match(server,/const planReviewer = await canReviewPlan\(sql,user\)/);
assert.match(server,/productVisible\(sql, user, line.product_id, planReviewer\)/);
assert.match(server,/selectedPlanReviewer.*exists\(select 1 from marketing\.work_plan_items pl/s);
check('Reviewer has read-only preparation access even without general copy-edit permission');
assert.doesNotMatch(execution,/correct_plan_published_on|canCorrectPublishedDate|mkw-dashboard-agenda-timing/);
check('Execution workflow has no reviewer-date or agenda-timing code');
for(const f of ['server/marketing/workflow.ts','src/marketing/workflow/PublishPage.tsx','src/marketing/pages/MarketingDashboardPage.tsx','src/marketing/workflow/PlanReport.tsx']){
  const source=read(f),parsed=ts.createSourceFile(f,source,ts.ScriptTarget.ES2022,true,f.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  assert.equal(parsed.parseDiagnostics.length,0,`Syntax errors in ${f}`);
}
check('All modified TypeScript/TSX files parse');

// SQL stub preserves the row state, records audit payloads and mimics conditional RETURNING.
let selectedIds=[reviewerId,uid(9)],status='publishing',url='https://example.com/original',actual='2026-11-01';
const queries=[],audits=[];
const sql=async(parts,...args)=>{
  const q=parts.join('?').replace(/\s+/g,' ').trim();queries.push({q,args});
  if(q.includes("to_regclass('marketing.work_plan_reviewers')"))return[{present:true}];
  if(q.includes('select rr.user_id::text from marketing.work_plan_reviewers'))return selectedIds.map(user_id=>({user_id}));
  if(q.includes('select l.id,l.plan_id,l.manual_post_url,l.manual_published_on::text as previous_on'))
    return [{id:lineId,plan_id:planId,manual_post_url:url,previous_on:actual,review_status:status}];
  if(q.startsWith('update marketing.work_plan_items')&&q.includes('manual_published_on=')&&q.includes('version=version+1')){
    assert.equal(args[1],lineId);
    assert.equal(args[2],actual);
    actual=args[0];return[{published_on:actual}];
  }
  if(q.startsWith('insert into audit.activity_log')){audits.push({q,args});return[];}
  return [];
};
sql.begin=async fn=>fn(sql);sql.json=x=>x;
(async()=>{
  await assert.rejects(()=>api.correctPlanPublicationDate(sql,users.admin,{lineId,publishedOn:'2026-10-31',reason:'corrected actual date'}));
  assert.equal(actual,'2026-11-01');check('Unlisted platform admin cannot correct manual publication date via API');
  await assert.rejects(()=>api.correctPlanPublicationDate(sql,users.creator,{lineId,publishedOn:'2026-10-31',reason:'corrected actual date'}));
  check('Plan creator cannot correct date without review assignment');
  await assert.rejects(()=>api.correctPlanPublicationDate(sql,users.reviewer,{lineId,publishedOn:'2026-10-31',reason:'bad'}));
  await assert.rejects(()=>api.correctPlanPublicationDate(sql,users.reviewer,{lineId,publishedOn:'2026-15-31',reason:'correction reason'}));
  check('Correction requires valid date and non-trivial reason');
  await assert.rejects(()=>api.correctPlanPublicationDate(sql,users.reviewer,{lineId,publishedOn:'2026-11-01',reason:'corrected actual date'}));
  check('Unchanged date rejected before any update');
  url='';await assert.rejects(()=>api.correctPlanPublicationDate(sql,users.reviewer,{lineId,publishedOn:'2026-10-31',reason:'corrected actual date'}));
  url='https://example.com/original';status='revision';
  await assert.rejects(()=>api.correctPlanPublicationDate(sql,users.reviewer,{lineId,publishedOn:'2026-10-31',reason:'corrected actual date'}));
  status='publishing';check('No correction before saved link and plan approval');
  const answer=await api.correctPlanPublicationDate(sql,users.reviewer,{lineId,publishedOn:'2026-10-31',reason:'Correcting manually recorded day'});
  assert.equal(answer.publishedOn,'2026-10-31');assert.equal(actual,'2026-10-31');
  assert.equal(url,'https://example.com/original');
  check('Assigned reviewer corrects date while original URL stays immutable');
  assert.equal(audits.length,1);
  const audit=audits[0];assert.equal(audit.args[0],reviewerId);assert.equal(audit.args[2].publishedOn,'2026-11-01');
  assert.equal(audit.args[3].publishedOn,'2026-10-31');assert.match(audit.args[3].reason,/Correcting manually recorded day/);
  assert.match(audit.q,/before_data,after_data/);
  check('Previous date, corrected date, reviewer ID and reason persisted in audit log');
  const previous=actual;
  await api.correctPlanPublicationDate(sql,users.reviewer,{lineId,publishedOn:'2026-10-30',reason:'Confirmed posting on earlier date'});
  assert.equal(actual,'2026-10-30');assert.equal(audits.length,2);assert.equal(audits[1].args[2].publishedOn,previous);
  check('Subsequent reviewer corrections retain full date history');
  const update=queries.find(entry=>entry.q.startsWith('update marketing.work_plan_items'));
  assert.doesNotMatch(update.q,/manual_post_url=|scheduled_on=|budget_amount=|caption=|hashtags=/);
  check('Correction never edits URL, planned schedule, budget, caption or hashtags');
  console.log(`${passed}/${passed} focused publication UX/security checks passed`);
})().catch(error=>{console.error(error);process.exitCode=1});
