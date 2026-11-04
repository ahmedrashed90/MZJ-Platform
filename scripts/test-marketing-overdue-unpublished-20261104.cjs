'use strict';
/** Non-production regression for overdue scheduled posts with no publication URL.
 * Covers Saudi time-zone day boundaries, aggregation, report markers and API mapping. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const loader = createLoader(process.cwd());
const { saudiCalendarDay, classifyWorkPublicationTiming } = loader('shared/marketing-publication-timing.ts');
const { summarizePublishingDays } = loader('src/marketing/workflow/publishingDaySummary.ts');
let count = 0;
const ok = label => { count++; console.log(`PASS: ${label}`); };
const moveDay = (day, amount) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
};

assert.equal(saudiCalendarDay(new Date('2026-11-03T21:05:00Z')), '2026-11-04');
assert.equal(saudiCalendarDay(new Date('2026-11-03T20:59:59Z')), '2026-11-03');
ok('Overdue uses Saudi local day even around UTC midnight');
const today = saudiCalendarDay();
const yesterday = moveDay(today, -1);
const tomorrow = moveDay(today, 1);
assert.equal(classifyWorkPublicationTiming(yesterday, false, null, today), 'overdue');
ok('A passed scheduled date without link is overdue');
assert.equal(classifyWorkPublicationTiming(today, false, null, today), null);
assert.equal(classifyWorkPublicationTiming(tomorrow, false, null, today), null);
ok('Today and future planned posts without link are pending');
assert.equal(classifyWorkPublicationTiming(yesterday, true, yesterday, today), 'on_time');
assert.equal(classifyWorkPublicationTiming(yesterday, true, today, today), 'late');
ok('Published on time and published late continue to compare actual vs planned date');
assert.equal(classifyWorkPublicationTiming(yesterday, true, null, today), null);
assert.equal(classifyWorkPublicationTiming('', false, null, today), null);
ok('Already-published rows lacking an actual date are not falsely marked late');
const line = (id, date, ready, timing) => ({id,scheduled_on:date,published_ready:ready,
  publication_timing:timing,idea_name:'منتج',platform_name:'انستجرام',post_type_name:'بوست صور'});
const overdueDay = summarizePublishingDays([
  line('o1', yesterday, false, 'overdue'),
  line('o2', yesterday, false, 'overdue'),
  line('late', yesterday, true, 'late'),
  line('on', yesterday, true, 'on_time'),
  line('undated', yesterday, true, null),
])[0];
assert.equal(overdueDay.publicationCount,5);
assert.equal(overdueDay.onTimeCount,1);
assert.equal(overdueDay.lateCount,3);
assert.equal(overdueDay.publishedLateCount,1);
assert.equal(overdueDay.overdueCount,2);
assert.equal(overdueDay.pendingCount,0);
assert.equal(overdueDay.undatedCount,1);
assert.equal(overdueDay.publishedCount,3);
ok('Dashboard counts late + overdue while never double-counting unpublished posts as published');
const pending = summarizePublishingDays([line('p1',today,false,null),line('p2',today,true,'on_time')])[0];
assert.equal(pending.pendingCount,1);
assert.equal(pending.lateCount,0);
ok('Scheduled today is not reported as overdue before the day ends');

const dashboard=fs.readFileSync('src/marketing/pages/MarketingDashboardPage.tsx','utf8');
const detail=fs.readFileSync('src/marketing/workflow/PlanDetail.tsx','utf8');
const server=fs.readFileSync('server/marketing/workflow.ts','utf8');
const execution=fs.readFileSync('src/marketing/workflow/TaskDetail.tsx','utf8');
assert.match(dashboard,/const overduePosts = days\.reduce/);
assert.match(dashboard,/mkw-dashboard-plan-timing mkw-delivery-summary/);
assert.doesNotMatch(dashboard,/group\[0\]\.kind === 'agenda' && \(onTimePosts/);
ok('Overdue summary appears in both campaign and agenda cards');
assert.match(dashboard,/day\.publishedLateCount > 0/);
assert.match(dashboard,/day\.overdueCount > 0/);
assert.match(dashboard,/متأخر ولم يُنشر/);
ok('Daily drilldown distinguishes posted-late from not-yet-posted overdue');
assert.match(detail,/line\.publication_timing === 'overdue'/);
assert.match(detail,/!line\.published_ready/);
ok('Reports/details show a distinct overdue status for a post without URL');
assert.match(server,/classifyWorkPublicationTiming\(/);
assert.doesNotMatch(execution,/classifyWorkPublicationTiming|publication_timing|mkw-dashboard-plan-timing/);
ok('Only publishing path changed; task-execution module remains untouched');

const stubUser = {id:'00000000-0000-4000-8000-000000000001', fullName:'Test', permissions:[],deniedPermissions:[],
 systemAccess:{marketing:{dataScope:'all',roleCode:'marketing_admin',branchCodes:[],departmentCodes:[]}}};
const stubs={
 '../_db.js':{getSql:()=>{throw Error('No live DB');},withDatabaseAdvisoryLock:async(_k,fn)=>fn()},
 '../_auth.js':{loadUserProfile:async()=>stubUser},
 '../_access-control.js':{getSystemAccess:u=>u.systemAccess.marketing},
 '../_marketing-workflow-schema.js':{assertMarketingWorkflowReady:async()=>{},marketingPlanScheduleSchemaStatus:async()=>({}),marketingWorkflowStructureStatus:async()=>({}),ensureMarketingWorkflowSchema:async()=>{}},
 '../_notifications.js':{createNotification:async()=>{}},
 '../_media-storage.js':{createUploadUrl:()=>{},headMediaObject:async()=>({}),mediaStorageConfigured:()=>false,buildMarketingStorageKey:()=>''},
 '../_google-drive-storage.js':{createGoogleDriveResumableUpload:async()=>({}),verifyGoogleDriveUploadedFile:async()=>({})},
};
const { planLines }=createLoader(process.cwd(),stubs,{'server/marketing/workflow.ts':'\nexport {planLines};'})('server/marketing/workflow.ts');
const row=(id,scheduled,manual_post_url='',manual_published_on=null)=>({
 id,scheduled_on:scheduled,manual_post_url,manual_published_on,provider_post_url:'',provider_published_on:null,
 review_status:'publishing',prepared_count:0,published_count:0,scheduled_count:0,failed_count:0,
});
(async()=>{
 const rows=[
   row('past-unpublished',yesterday),
   row('today-unpublished',today),
   row('posted-on-time',yesterday,'https://example.org/one',yesterday),
   row('posted-late',yesterday,'https://example.org/two',today),
   row('old-link-no-date',yesterday,'https://example.org/three'),
 ];
 const sql=async(parts,...values)=>parts.join('?').includes('select l.*,l.scheduled_on::text') ? rows : [];
 const actual=await planLines(sql,stubUser);
 assert.deepEqual(actual.map(item=>item.publication_timing), ['overdue',null,'on_time','late',null]);
 assert.deepEqual(actual.map(item=>item.published_ready),[false,false,true,true,true]);
 ok('Real server plan-lines mapper identifies overdue without altering published flag or link rules');
 for (const f of ['shared/marketing-publication-timing.ts','shared/marketing-workflow.ts','server/marketing/workflow.ts',
  'src/marketing/workflow/publishingDaySummary.ts','src/marketing/pages/MarketingDashboardPage.tsx','src/marketing/workflow/PlanDetail.tsx']) {
   const code=fs.readFileSync(f,'utf8');
   const parsed=ts.createSourceFile(f,code,ts.ScriptTarget.ES2022,true,f.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
   assert.equal(parsed.parseDiagnostics.length,0,`${f} should parse`);
 }
 ok('All changed TypeScript files pass syntactic validation');
 console.log(`${count}/${count} overdue publication regression checks passed`);
})().catch(err=>{console.error(err);process.exitCode=1;});
