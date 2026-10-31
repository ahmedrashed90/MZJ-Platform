'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const user = { id:uid(1),fullName:'Manager',permissions:['platform.superadmin'],deniedPermissions:[],
  systemAccess:{marketing:{enabled:true,roleCode:'marketing_admin',dataScope:'all',branchCodes:[],departmentCodes:[]}} };
const stubs = {
  '../_db.js':{getSql:()=>{throw Error('No live DB');},withDatabaseAdvisoryLock:async (_,fn)=>fn()},
  '../_auth.js':{loadUserProfile:async()=>user},
  '../_access-control.js':{getSystemAccess:u=>u.systemAccess.marketing},
  '../_marketing-workflow-schema.js':{assertMarketingWorkflowReady:async()=>{},marketingPlanScheduleSchemaStatus:async()=>({}),marketingWorkflowStructureStatus:async()=>({}),ensureMarketingWorkflowSchema:async()=>{}},
  '../_notifications.js':{createNotification:async()=>{}},
  '../_media-storage.js':{createUploadUrl:()=>{},headMediaObject:async()=>({}),mediaStorageConfigured:()=>false,buildMarketingStorageKey:()=>''},
  '../_google-drive-storage.js':{createGoogleDriveResumableUpload:async()=>({}),verifyGoogleDriveUploadedFile:async()=>({})},
};
const load=createLoader(process.cwd(),stubs,{'server/marketing/workflow.ts':'\nexport { changePlanReview, savePlanPostUrl };'});
const composer=load('src/marketing/workflow/planComposer.ts');
const wf=load('server/marketing/workflow.ts');
const ig=uid(2), productId=uid(3), planId=uid(4), lineId=uid(5);
const postTypes=[{id:uid(6),platform_id:ig,name:'Photo'},{id:uid(7),platform_id:ig,name:'Story'}];
const entry={key:'one',date:'2026-10-31',productId,platforms:[{platformId:ig,postTypeId:uid(6),postTypeIds:[uid(6),uid(7)],budget:'250'}]};
assert.equal(composer.validatePlanComposer([entry],[{id:productId,media_kind:'image'}],postTypes,'campaign'),'');
assert.equal(composer.planEntriesPayload([entry],'campaign')[0].platforms[0].postTypeIds.length,2);
assert.ok(composer.validatePlanComposer([{...entry,platforms:[{...entry.platforms[0],postTypeIds:[uid(6),uid(6)]}]}],[{id:productId,media_kind:'image'}],postTypes,'campaign'));
console.log('PASS: multiple compatible post types per platform, single platform budget, no duplicates');
function fakeSql(status='in_progress') {
  const statements=[];
  const sql=async (parts,...values)=>{
    const q=parts.join('?').replace(/\s+/g,' ').trim(); statements.push({q,values});
    if (q.includes('select * from marketing.work_plans')) return [{id:planId,created_by:user.id,review_status:status,activated_at:null}];
    if (q.includes('select l.*,l.scheduled_on::text')) return [{id:lineId,plan_id:planId,product_id:productId,review_status:status,manual_post_url:'',provider_post_url:'',prepared_count:0,published_count:0,scheduled_count:0,failed_count:0}];
    if (q.includes('select l.id,l.plan_id,p.review_status')) return [{id:lineId,plan_id:planId,review_status:status,created_by:user.id}];
    if (q.includes('select id from marketing.work_review_categories')) return [{id:uid(8)}];
    return [];
  };
  sql.begin=async fn=>fn(sql);sql.json=x=>x;sql.statements=statements;
  return sql;
}
(async()=>{
  let sql=fakeSql();await wf.changePlanReview(sql,user,{planId,decision:'revision',note:'غير المنتج المطلوب'});
  assert.ok(sql.statements.some(x=>x.q.includes('update marketing.work_plans')&&x.values.includes('revision')));
  assert.ok(sql.statements.some(x=>x.q.includes('insert into marketing.work_plan_reviews')));
  console.log('PASS: manager revision stores durable note and review history');
  sql=fakeSql('submitted');await wf.changePlanReview(sql,user,{planId,decision:'approved'});
  assert.ok(sql.statements.some(x=>x.q.includes('update marketing.work_plans')&&x.values.includes('publishing')));
  console.log('PASS: approval transitions plan to publishing');
  await assert.rejects(()=>wf.savePlanPostUrl(fakeSql('in_progress'),user,{lineId,url:'https://example.com/post',publishedOn:'2026-10-31'}));
  await assert.rejects(()=>wf.savePlanPostUrl(fakeSql('publishing'),user,{lineId,url:'javascript:alert(1)'}));
  sql=fakeSql('publishing');await wf.savePlanPostUrl(sql,user,{lineId,url:'https://example.com/post',publishedOn:'2026-10-31'});
  assert.ok(sql.statements.some(x=>x.q.includes('update marketing.work_plan_items')&&x.values.includes('https://example.com/post')));
  assert.ok(sql.statements.some(x=>x.q.includes('manual_published_on')&&x.values.includes('2026-10-31')));
  console.log('PASS: link only after approval; valid HTTPS required; actual publication date saved per line');
  const schema=fs.readFileSync('server/_marketing-workflow-schema.ts','utf8');
  assert.ok(schema.includes("values('schema-12')")&&schema.includes('manual_post_url')&&schema.includes('work_plan_reviews'));
  assert.ok(fs.readFileSync('server/marketing/workflow.ts','utf8').includes("if (plan.review_status !== 'publishing')"));
  console.log('PASS: additive schema migration and server-side activation gate');
  console.log('6/6 publishing review checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
