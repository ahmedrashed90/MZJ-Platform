'use strict';
const assert=require('node:assert/strict');
const {createLoader}=require('./marketing-workflow-test-support.cjs');
let structureReady=false;
const load=createLoader(process.cwd(),{
  '../_db.js':{getSql:()=>{throw new Error('No production database in test');},withDatabaseAdvisoryLock:async(_key,cb)=>cb()},
  '../_auth.js':{loadUserProfile:async()=>null},
  '../_access-control.js':{getSystemAccess:u=>u.systemAccess?.marketing},
  '../_marketing-workflow-schema.js':{assertMarketingWorkflowReady:async()=>{},ensureMarketingWorkflowSchema:async()=>{},marketingPlanScheduleSchemaStatus:async()=>({ready:true,baseReady:true,missing:[]}),marketingWorkflowStructureStatus:async()=>({ready:structureReady,missing:structureReady?[]:['reviewers']})},
  '../_notifications.js':{createNotification:async()=>{}},
  '../_media-storage.js':{mediaStorageConfigured:()=>false,buildMarketingStorageKey:()=>'',headMediaObject:async()=>({exists:true,size:0})},
  '../_google-drive-storage.js':{createGoogleDriveResumableUpload:async()=>({uploadUrl:'https://unused.invalid'})},
},{'server/marketing/workflow.ts':'\nexport {handleMarketingWorkflow};'});
const {handleMarketingWorkflow}=load('server/marketing/workflow.ts');
const user={id:'00000000-0000-4000-8000-000000000001',fullName:'Admin',permissions:['platform.superadmin'],systemAccess:{marketing:{dataScope:'all'}}};
async function probe(newSchemaReady){
  structureReady=newSchemaReady;
  let sent;
  const response={status(code){assert.equal(code,200);return this;},json(data){sent=data;return this;}};
  const request={method:'GET',query:{resource:'work_schema_status'}};
  let queries=0;
  const sql=async parts=>{
    const query=parts.join('?').replace(/\s+/g,' ');
    queries++;
    if(query.includes("where code='schema-8'")){
      assert(query.includes("where code='schema-9'"));
      assert(query.includes("to_regclass('marketing.work_rating_reviewers')"));
      assert(query.includes("column_name='revision_number'"));
      assert(query.includes("like '%editing%'"));
      assert(query.includes("like '%rejected%'"));
      return [{revision_policy:newSchemaReady,terminal_rejection:newSchemaReady,reviewers:newSchemaReady,
        revision_numbers:newSchemaReady,editing_state:newSchemaReady,rejected_state:newSchemaReady}];
    }
    throw new Error('Unexpected SQL: '+query);
  };
  assert.equal(await handleMarketingWorkflow(request,response,sql,user,{}),true);
  assert.equal(queries,1);
  return sent;
}
(async()=>{
  const old=await probe(false);
  assert.equal(old.baseReady,true);assert.equal(old.ready,false);assert.equal(old.canUpgrade,true);
  console.log('PASS: existing installation with old review schema shows upgrade control');
  const upgraded=await probe(true);
  assert.equal(upgraded.ready,true);assert.equal(upgraded.canUpgrade,true);
  console.log('PASS: fully upgraded review schema reports ready');
  const dashboard=require('node:fs').readFileSync('src/marketing/pages/MarketingDashboardPage.tsx','utf8');
  assert(dashboard.includes('if (schemaUpgrading || !schema.data?.canUpgrade) return;'));
  assert(dashboard.includes('{schema.data.canUpgrade && <button'));
  console.log('PASS: superadmin upgrade remains available when original workflow tables are absent');
})().catch(error=>{console.error(error);process.exitCode=1});
