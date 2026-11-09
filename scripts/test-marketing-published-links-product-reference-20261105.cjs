'use strict';
// Regression: a first-saved public link is the only publication criterion;
// caption/hashtags are editable later without changing the original date.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const {createLoader} = require('./marketing-workflow-test-support.cjs');
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor={id:uid(1),fullName:'Marketing admin',permissions:['platform.superadmin'],deniedPermissions:[],
  systemAccess:{marketing:{roleCode:'marketing_admin',dataScope:'all',branchCodes:[],departmentCodes:[]}}};
const stubs={
  '../_db.js':{getSql:()=>{throw Error('No database calls');},withDatabaseAdvisoryLock:async(_,fn)=>fn()},
  '../_auth.js':{loadUserProfile:async()=>actor},
  '../_access-control.js':{getSystemAccess:u=>u.systemAccess.marketing},
  '../_marketing-workflow-schema.js':{assertMarketingWorkflowReady:async()=>{},marketingPlanScheduleSchemaStatus:async()=>({}),marketingWorkflowStructureStatus:async()=>({}),ensureMarketingWorkflowSchema:async()=>{}},
  '../_notifications.js':{createNotification:async()=>{}},
  '../_media-storage.js':{createUploadUrl:()=>{},headMediaObject:async()=>({}),mediaStorageConfigured:()=>false,buildMarketingStorageKey:()=>''},
  '../_google-drive-storage.js':{createGoogleDriveResumableUpload:async()=>({}),verifyGoogleDriveUploadedFile:async()=>({})},
};
const load=createLoader(process.cwd(),stubs,{'server/marketing/workflow.ts':'\nexport {planLines,restorePlanPostUrl,savePlanPostUrl,savePreparation};'});
const {planLines,restorePlanPostUrl,savePlanPostUrl,savePreparation}=load('server/marketing/workflow.ts');
const server=fs.readFileSync('server/marketing/workflow.ts','utf8');
const ui=fs.readFileSync('src/marketing/workflow/PublishPage.tsx','utf8');
const report=fs.readFileSync('src/marketing/workflow/PlanReport.tsx','utf8');
const products=fs.readFileSync('src/marketing/pages/ProductsPage.tsx','utf8');
assert.doesNotMatch(server,/budget_amount=\$\{row\.budget\},manual_post_url=''/);
assert.match(server,/manual_post_url=\$\{url\},/);
assert.match(server,/manual_published_on=\(now\(\) at time zone 'Asia\/Riyadh'\)::date/);
assert.match(server,/caption=case when product_id is distinct from/);
assert.match(server,/manual_published_on.*existingLines|existingLines.*manual_published_on/s);
assert.match(report,/<ProductReference title=\{line\.idea_name\} details=\{line\}/);
assert.match(products,/<ProductReference title=\{product\.task_name\} details=\{product\}/);
assert.match(ui,/<ProductReference title=\{data\.product\.idea_name\} details=\{data\.product\}/);
assert.match(ui,/workPost\('restore_plan_post_url'/);
const now='2026-11-05',original='2026-11-04';
const row={id:uid(10),plan_id:uid(20),scheduled_on:original,review_status:'publishing',
  manual_post_url:'https://example.com/original',manual_published_on:original,
  provider_post_url:'',provider_published_on:null,caption:'',hashtags:'',prepared_count:1,published_count:0,scheduled_count:0,failed_count:0};
let visible=[row];
const selectSql=async sql=>{
  if(sql.join('?').includes('to_regclass'))return [{present:false}];
  return visible;
};
(async()=>{
  let lines=await planLines(selectSql,actor);
  assert.equal(lines[0].published_ready,true);
  assert.equal(lines[0].effective_post_url,row.manual_post_url);
  assert.equal(lines[0].published_on,original);
  row.caption='كابشن بعد النشر';row.hashtags='#mzj';
  lines=await planLines(selectSql,actor);
  assert.equal(lines[0].published_ready,true,'Copy does not change published state');
  assert.equal(lines[0].publication_timing,'on_time','Original timestamp determines on-time classification');
  assert.equal(lines[0].published_on,original);
  row.manual_post_url='';row.audited_manual_post_url='https://example.com/original';
  lines=await planLines(selectSql,actor);
  assert.equal(lines[0].published_ready,true,'Recover valid URL from append-only audit');
  assert.equal(lines[0].missing_persisted_url,true);
  row.audited_manual_post_url=null;
  lines=await planLines(selectSql,actor);
  assert.equal(lines[0].published_ready,false,'Do not make up a missing URL');
  assert.equal(lines[0].missing_persisted_url,true);
  const q=[];
  let stored={manual_post_url:'',manual_published_on:original};
  const tx=async (strings,...args)=>{
    const query=strings.join('?').replace(/\s+/g,' ').trim();q.push({query,args});
    if(query.startsWith('set local'))return [];
    if(query.includes("to_regclass('marketing.work_plan_reviewers')"))return [{present:false}];
    if(query.startsWith('select l.id,l.plan_id,l.manual_post_url,l.manual_published_on::text as original_on'))
      return [{id:uid(10),plan_id:uid(20),manual_post_url:stored.manual_post_url,original_on:stored.manual_published_on,review_status:'publishing'}];
    if(query.startsWith('select 1 from marketing.work_publish_targets'))return [];
    if(query.startsWith('update marketing.work_plan_items set manual_post_url')){
      assert.doesNotMatch(query,/manual_published_on=/,'Restore MUST preserve original date');
      stored.manual_post_url=args[0];return [{id:uid(10)}];
    }
    if(query.startsWith('insert into audit.activity_log'))return [];
    throw Error('Unexpected SQL: '+query);
  };
  tx.begin=async fn=>fn(tx);tx.json=v=>v;
  let restored=await restorePlanPostUrl(tx,actor,{lineId:uid(10),url:'https://example.com/original'});
  assert.equal(restored.ok,true);assert.equal(restored.publishedOn,original);
  assert.equal(stored.manual_post_url,'https://example.com/original');
  assert.equal(stored.manual_published_on,original,'Never reset original date during recovery');
  await assert.rejects(()=>restorePlanPostUrl(tx,actor,{lineId:uid(10),url:'https://example.com/different'}),/استعادة الرابط متاحة فقط/);
  assert.ok(q.some(x=>x.query.includes('insert into audit.activity_log')),'Restore is audited');
  // Exercise the actual savePreparation handler AFTER a link has already been
  // saved, with a blank caption/hashtag. Saving text is never a second publish.
  const format={id:uid(51),platform_id:uid(52),platform_code:'instagram',platform_name:'Instagram',name:'photo',width:1080,height:1080};
  const product={id:uid(53),task_id:uid(54),department_id:uid(55),assigned_to:actor.id,media_kind:'image',
    formats:[format],files:[{id:uid(56),name:'file.jpg',mime_type:'image/jpeg',file_size:500,category:'final',format_id:format.id,status:'ready'}],
    status:'approved',idea_name:'Approved image',task_no:'TSK-000084'};
  const postLine={id:uid(57),plan_id:uid(58),product_id:product.id,post_type_id:format.id,
    review_status:'publishing',scheduled_on:original,version:2,kind:'agenda',name:'Agenda',caption:'',hashtags:'',
    manual_post_url:'https://example.com/saved-before-copy',manual_published_on:original,created_by:actor.id};
  const saveQueries=[];
  const prepareSql=async (parts,...args)=>{
    const query=parts.join('?').replace(/\s+/g,' ').trim();saveQueries.push({query,args});
    if(query.startsWith('set local'))return [];
    if(query.includes("to_regclass('marketing.work_plan_reviewers')"))return [{present:false}];
    if(query.startsWith('select l.*,l.scheduled_on::text'))return [postLine];
    if(query.startsWith('select i.*,i.due_on::text,t.name as task_name'))return [product];
    if(query.startsWith('select i.*,i.due_on::text,coalesce(d.name'))return [product];
    if(query.startsWith('select pt.id::text,pt.platform_id::text'))return [format];
    if(query.startsWith('select l.*,p.kind,p.created_by'))return [postLine];
    if(query.startsWith('select i.id from marketing.work_items i join marketing.work_tasks t'))return [{id:product.id}];
    if(query.startsWith('select target.*'))return [];
    if(query.startsWith('select id,creative_id from marketing.tasks'))return [{id:uid(59),creative_id:uid(60)}];
    if(query.startsWith('select pt.id from marketing.platform_post_types pt'))return [{id:format.id}];
    if(query.startsWith('update marketing.work_plan_items set caption')){
      assert.doesNotMatch(query,/manual_post_url|manual_published_on/, 'Text save cannot clear post URL or real date');
      postLine.caption=args[0];postLine.hashtags=args[1];
      return [];
    }
    if(/^(insert into marketing\.publish_schedule|insert into marketing\.work_publish_targets|delete from marketing\.work_publish_files|insert into marketing\.work_publish_files)/.test(query))return [];
    throw Error('Unexpected preparation query: '+query);
  };
  prepareSql.begin=async fn=>fn(prepareSql);prepareSql.json=v=>v;
  const prepared=await savePreparation(prepareSql,actor,{lineId:postLine.id,version:postLine.version,
    formatIds:[format.id],caption:'كابشن بعد حفظ الرابط',hashtags:'#mzj',publishTime:'20:00'},
    {youtubeDefaults:async()=>({})});
  assert.equal(prepared.ok,true);
  assert.equal(postLine.manual_post_url,'https://example.com/saved-before-copy');
  assert.equal(postLine.manual_published_on,original);
  assert.equal(postLine.caption,'كابشن بعد حفظ الرابط');
  assert.ok(saveQueries.some(entry=>entry.query.startsWith('update marketing.work_plan_items set caption')));
  const afterCopySql=async parts=>parts.join('?').includes('select l.*,l.scheduled_on::text')?[postLine]:[];
  const afterCopy=await planLines(afterCopySql,actor);
  assert.equal(afterCopy[0].published_ready,true);
  assert.equal(afterCopy[0].published_on,original);
  console.log('PASS: real savePreparation retains link and original publication day after adding caption and hashtag');
  for(const f of ['shared/marketing-workflow.ts','server/marketing/workflow.ts','src/marketing/workflow/ProductReference.tsx',
    'src/marketing/workflow/PlanReport.tsx','src/marketing/workflow/PlanDetail.tsx','src/marketing/workflow/PublishPage.tsx','src/marketing/pages/ProductsPage.tsx']){
    const s=fs.readFileSync(f,'utf8');const sf=ts.createSourceFile(f,s,ts.ScriptTarget.Latest,true,f.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    assert.equal(sf.parseDiagnostics.length,0,`TypeScript syntax: ${f} - ${sf.parseDiagnostics.map(d=>d.messageText).join(',')}`);
  }
  console.log('PASS: post link alone marks published; late caption has no effect');
  console.log('PASS: immutable original date and historic URL recovery');
  console.log('PASS: task, requirement, executor appear on product, report, and preparation');
  console.log('PASS: all changed TS/TSX files parse');
})().catch(err=>{console.error(err);process.exitCode=1;});
