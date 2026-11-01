'use strict';
/** End-to-end contracts without access to live Postgres or external publishing providers. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const read = p => fs.readFileSync(p, 'utf8');
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const user = {id:uid(1),fullName:'Marketing reviewer',permissions:['platform.superadmin'],deniedPermissions:[],
  systemAccess:{marketing:{enabled:true,roleCode:'marketing_admin',dataScope:'all',branchCodes:[],departmentCodes:[]}}};
const stubs={
  '../_db.js':{getSql:()=>{throw Error('No live database');},withDatabaseAdvisoryLock:async(_,fn)=>fn()},
  '../_auth.js':{loadUserProfile:async()=>user},
  '../_access-control.js':{getSystemAccess:u=>u.systemAccess.marketing},
  '../_marketing-workflow-schema.js':{assertMarketingWorkflowReady:async()=>{},marketingPlanScheduleSchemaStatus:async()=>({}),marketingWorkflowStructureStatus:async()=>({}),ensureMarketingWorkflowSchema:async()=>{}},
  '../_notifications.js':{createNotification:async()=>{}},
  '../_media-storage.js':{createUploadUrl:()=>{},headMediaObject:async()=>({}),mediaStorageConfigured:()=>false,buildMarketingStorageKey:()=>''},
  '../_google-drive-storage.js':{createGoogleDriveResumableUpload:async()=>({}),verifyGoogleDriveUploadedFile:async()=>({})},
};
const { savePlanPostUrl }=createLoader(process.cwd(),stubs,{'server/marketing/workflow.ts':'\nexport { savePlanPostUrl };'})('server/marketing/workflow.ts');
const dashboard=read('src/marketing/pages/MarketingDashboardPage.tsx');
const creator=read('src/marketing/workflow/CreatePage.tsx');
const review=read('src/marketing/workflow/PlanDetail.tsx');
const prep=read('src/marketing/workflow/PublishPage.tsx');
const report=read('src/marketing/workflow/PlanReport.tsx');
const server=read('server/marketing/workflow.ts');
const shared=read('shared/marketing-workflow.ts');
let passed=0;
function check(condition, label) { assert.ok(condition,label);passed++;console.log(`PASS ${label}`); }

(async()=>{
  check(/navigate\(`\/marketing\?plan=\$\{encodeURIComponent\(created.id\)\}`\)/.test(creator), 'create agenda or campaign opens the saved plan for review');
  check(/<PlanDetail id=\{planId\}/.test(dashboard) && /مراجعة واعتماد/.test(dashboard) && /<PlanReport id=\{tableId\}/.test(dashboard),
    'dashboard shows approval/editor separately from read-only report');
  check(!/budgetId|setBudgetId|جدول الميزانية|Wallet/.test(dashboard), 'no separate budget table or button remains');
  check(/chooserIsCampaign && <th>الميزانية \(ر\.س\)<\/th>/.test(dashboard) && /line\.product_idea/.test(dashboard),
    'publication preparation table shows budget after type and deliverable idea after product');
  check(/i\.idea as product_idea/.test(server) && /product_idea\?: string/.test(shared),
    'deliverable idea originates from work_items.idea in SQL instead of task title');
  check(/data\.product\.idea \|\|/.test(prep) && /data\.line\.budget_amount/.test(prep),
    'opened publication editor shows deliverable idea and campaign budget');
  check(!/<th scope="col">تاريخ الإنشاء<\/th>/.test(report) && /<th scope="col">الفكرة \(فكرة المطلوب\)<\/th>/.test(report)
    && /line\.product_idea/.test(report), 'read-only report omits repeated creation date and includes deliverable idea');
  check(/إجمالي الميزانية/.test(review) && /line\.budget_amount/.test(review) && /line\.product_idea/.test(review)
    && /اعتماد/.test(review) && /تعديل المنتجات والجدول/.test(review),
    'full review displays budgets, deliverable ideas, approval and editing');
  check(/\['in_progress','revision','submitted'\]\.includes\(plan\.review_status\)/.test(server),
    'author may edit a waiting-review campaign and it is resubmitted automatically');
  check(!/setPublishedOn|onChange=\{event => setPublishedOn/.test(prep)
    && /disabled aria-label="تاريخ النشر الفعلي المسجل تلقائيًا"/.test(prep)
    && /workPost\('save_plan_post_url', \{ lineId: data.line.id, url: postUrl.trim\(\) \}\)/.test(prep),
    'first-link publication date cannot be manually overridden from browser');

  // Simulate postgres row locking and RETURNING values. Test the date first-save
  // contract and ensure later URL edits do not write a second publication date.
  const lineId=uid(10),planId=uid(11);
  const row={id:lineId,plan_id:planId,review_status:'publishing',created_by:user.id,
    manual_post_url:'',manual_published_on:null,provider_post_url:'',prepared_count:0,published_count:0,scheduled_count:0,failed_count:0};
  let today='2026-11-01', updateSql='';
  const sql=async (parts,...values)=>{
    const q=parts.join('?').replace(/\s+/g,' ').trim();
    if(q.includes('select l.id,l.plan_id,l.manual_post_url')) return [{id:lineId,plan_id:planId,review_status:row.review_status,created_by:user.id,manual_post_url:row.manual_post_url,manual_published_on:row.manual_published_on}];
    if(q.includes('select l.*,l.scheduled_on::text')) return [row];
    if(q.includes('update marketing.work_plan_items')) {
      updateSql=q;
      const url=values[0];
      assert.equal(typeof url,'string');
      assert.match(q,/manual_published_on=\(now\(\) at time zone/);
      assert.match(q,/time zone 'Asia\/Riyadh'/);
      row.manual_post_url=url;
      row.manual_published_on=row.manual_published_on||(url?today:null);
      return [{published_on:row.manual_published_on}];
    }
    return [];
  };
  sql.begin=async callback=>callback(sql);
  let result=await savePlanPostUrl(sql,user,{lineId,url:'https://example.com/first',publishedOn:'1999-01-01'});
  check(result.publishedOn==='2026-11-01' && row.manual_published_on==='2026-11-01',
    'first valid post URL timestamps on the server instead of accepting client date');
  today='2026-11-02';
  await assert.rejects(()=>savePlanPostUrl(sql,user,{lineId,url:'https://example.com/edited',publishedOn:'2026-11-02'}),/لا يمكن تعديله/);
  check(row.manual_published_on==='2026-11-01' && row.manual_post_url==='https://example.com/first',
    'second save cannot change the URL or publication date');
  await assert.rejects(()=>savePlanPostUrl(sql,user,{lineId,url:''}),/لا يمكن تعديله/);
  check(row.manual_published_on==='2026-11-01' && row.manual_post_url==='https://example.com/first',
    'a saved URL cannot be deleted');
  await assert.rejects(()=>savePlanPostUrl(sql,user,{lineId,url:'javascript:alert(1)'}));
  check(Boolean(updateSql) && row.manual_published_on==='2026-11-01',
    'unsafe link is rejected without altering the record');

  for(const file of ['shared/marketing-workflow.ts','server/marketing/workflow.ts','src/marketing/workflow/CreatePage.tsx',
    'src/marketing/workflow/PlanDetail.tsx','src/marketing/workflow/PublishPage.tsx',
    'src/marketing/workflow/PlanReport.tsx','src/marketing/pages/MarketingDashboardPage.tsx']) {
    const sourceFile=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    assert.equal(sourceFile.parseDiagnostics.length,0,file+' syntax error');
  }
  check(true,'all seven changed TypeScript modules parse successfully');
  console.log(`Marketing campaign approval, preparation and immutable URL: ${passed}/${passed} passed`);
})().catch(error=>{console.error(error);process.exitCode=1;});
