'use strict';
const assert=require('node:assert/strict');
const {createLoader}=require('./marketing-workflow-test-support.cjs');
const fs=require('node:fs');
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const selected=uid(1),other=uid(2),creator=uid(3),planId=uid(4);
const users={reviewer:{id:selected,fullName:'Reviewer',permissions:[],deniedPermissions:[]},
  admin:{id:other,fullName:'System admin',permissions:['platform.superadmin','marketing.task.review'],deniedPermissions:[]},
  creator:{id:creator,fullName:'Plan creator',permissions:[],deniedPermissions:[]},
  configurator:{id:other,fullName:'Settings manager',permissions:['settings.marketing.manage'],deniedPermissions:[]}};
const notices=[],queries=[];
let planStatus='submitted';
let selectedIds=[selected,uid(5)];
const fakePlan=()=>({id:planId,created_by:creator,name:'Test campaign',kind:'campaign',review_status:planStatus,activated_at:null,is_deleted:false});
const sql=async(parts,...args)=>{
  const q=parts.join('?').replace(/\s+/g,' ').trim();queries.push({q,args});
  if(q.includes("to_regclass('marketing.work_plan_reviewers')"))return[{present:true}];
  if(q.includes('select rr.user_id::text from marketing.work_plan_reviewers'))return selectedIds.map(user_id=>({user_id}));
  if(q.includes('select * from marketing.work_plans where id='))return[fakePlan()];
  if(q.includes('select p.id,p.created_by,p.kind,p.name,p.review_status,p.activated_at,p.is_deleted'))return[fakePlan()];
  if(q.includes('select l.*,l.scheduled_on::text'))return[{id:uid(7),plan_id:planId,scheduled_on:'2026-11-02',review_status:planStatus,manual_post_url:'',provider_post_url:'',manual_published_on:null,provider_published_on:null,scheduled_count:0,published_count:0,failed_count:0,created_by:creator}];
  if(q.includes('update marketing.campaigns set'))return[{id:planId}];
  if(q.includes('select u.id::text from core.users'))return selectedIds.map(id=>({id}));
  return [];
};
sql.begin=async callback=>callback(sql);sql.json=value=>value;
const source=fs.readFileSync('server/marketing/workflow.ts','utf8');
const apiModule=createLoader(process.cwd(),{
  '../_db.js':{getSql:()=>sql,withDatabaseAdvisoryLock:async(_k,fn)=>fn()},
  '../_auth.js':{loadUserProfile:async()=>null},
  '../_access-control.js':{getSystemAccess:()=>({dataScope:'all',roleCode:'marketing_admin',departmentCodes:[],branchCodes:[]})},
  '../_marketing-workflow-schema.js':{assertMarketingWorkflowReady:async()=>{},marketingPlanScheduleSchemaStatus:async()=>({}),marketingWorkflowStructureStatus:async()=>({}),ensureMarketingWorkflowSchema:async()=>{}},
  '../_notifications.js':{createNotification:async data=>{notices.push(data);}},
  '../_media-storage.js':{createUploadUrl:()=>{},headMediaObject:async()=>({}),mediaStorageConfigured:()=>false,buildMarketingStorageKey:()=>''},
  '../_google-drive-storage.js':{createGoogleDriveResumableUpload:async()=>({}),verifyGoogleDriveUploadedFile:async()=>({})},
},{'server/marketing/workflow.ts':'\nexport { canReviewPlan,changePlanReview,updatePlanFunding,savePlanReviewers,planReviewersSettings };\n'})('server/marketing/workflow.ts');
(async()=>{
  let passed=0;const check=message=>{passed++;console.log('PASS:',message);};
  assert.equal(await apiModule.canReviewPlan(sql,users.reviewer),true);
  assert.equal(await apiModule.canReviewPlan(sql,users.admin),false);
  check('Only active selected reviewer IDs confer approval capability, never platform admin');
  await assert.rejects(()=>apiModule.changePlanReview(sql,users.admin,{planId,decision:'approved'}));
  check('Platform admin not on the two-reviewer list cannot approve');
  await assert.rejects(()=>apiModule.changePlanReview(sql,users.reviewer,{planId,decision:'revision',note:'Please revise',updateFunding:true,fundingFrom:'2026-11-10'}));
  check('Reviewer cannot modify funding through plan-review API');
  await apiModule.changePlanReview(sql,users.reviewer,{planId,decision:'revision',note:'Change funding dates'});
  assert.equal(notices.at(-1).audienceUserIds[0],creator);
  assert.equal(notices.at(-1).actionUrl,'/marketing?plan='+planId);
  check('Revision persists and sends an actionable notification to the creator');
  planStatus='revision';
  await assert.rejects(()=>apiModule.updatePlanFunding(sql,users.admin,{planId,fundingFrom:'2026-11-05',fundingTo:'2026-11-07'}));
  check('Reviewer and admin cannot change campaign funding without ownership');
  await apiModule.updatePlanFunding(sql,users.creator,{planId,fundingFrom:'2026-11-05',fundingTo:'2026-11-07'});
  assert(queries.some(x=>x.q.includes("review_status='submitted'")));
  assert(notices.at(-1).audienceUserIds.includes(selected));
  check('Creator edits funding and returns the campaign to the selected reviewers');
  await assert.rejects(()=>apiModule.savePlanReviewers(sql,users.reviewer,{userIds:[selected,other]}));
  check('Regular reviewers cannot change the reviewer settings');
  await assert.rejects(()=>apiModule.savePlanReviewers(sql,users.configurator,{userIds:[selected,selected]}));
  check('Configured reviewer slots cannot contain duplicate user IDs');
  await apiModule.savePlanReviewers(sql,users.configurator,{userIds:[selected,uid(5)]});
  assert(queries.some(x=>x.q.startsWith('lock table marketing.work_plan_reviewers')));
  assert(queries.some(x=>x.q.startsWith('insert into marketing.work_plan_reviewers')));
  check('Settings manager updates the two reviewer slots transactionally');
  assert.match(source,/createNotification/);
  console.log(`${passed}/${passed} campaign/agenda review role checks passed`);
})().catch(error=>{console.error(error);process.exitCode=1;});
