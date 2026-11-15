'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createLoader,scriptedSql}=require('./marketing-workflow-test-support.cjs');
const root=process.cwd();
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const admin={id:uid(1),fullName:'Admin',permissions:['platform.superadmin'],deniedPermissions:[],systemAccess:{marketing:{enabled:true,dataScope:'all',roleCode:'admin',branchCodes:[],departmentCodes:[]}}};
const viewer={...admin,id:uid(2),permissions:['marketing.products.view'],systemAccess:{marketing:{...admin.systemAccess.marketing,dataScope:'assigned',roleCode:'employee'}}};
const stubs={
  '../_db.js':{getSql:()=>{throw Error('No database in test');},withDatabaseAdvisoryLock:async(k,fn)=>fn()},
  '../_auth.js':{loadUserProfile:async()=>null},
  '../_access-control.js':{getSystemAccess:u=>u.systemAccess.marketing},
  '../_marketing-workflow-schema.js':{ marketingStrategyDraftsReady:async()=>false,ensureMarketingWorkflowSchema:async()=>{}},
  '../_notifications.js':{createNotification:async()=>{}},
  '../_media-storage.js':{mediaStorageConfigured:()=>false},
  '../_google-drive-storage.js':{},
  './evaluations.js':{canGradeWorkItem:async()=>false},
};
const load=createLoader(root,stubs,{'server/marketing/workflow.ts':'\nexport { createManualKeywordsProduct, products, productVisible };'});
const api=load('server/marketing/workflow.ts');
const choice=load('src/marketing/workflow/productChoice.ts');
const mockFormat={id:uid(10),platform_id:uid(11),platform_name:'Instagram',platform_code:'instagram',name:'Photo',width:1080,height:1080};
const mockVideo={...mockFormat,id:uid(12),name:'Reels'};
const step=(match,rows=[],check)=>({match,rows,check});
const manual={id:uid(20),task_id:uid(19),task_no:'MANUAL-KEYWORDS',task_name:'\u0643\u0644\u0645\u0627\u062a \u0628\u062d\u062b',
  idea_name:'\u0643\u0644\u0645\u0627\u062a \u0628\u062d\u062b',idea:'\u0643\u0644\u0645\u0627\u062a \u0628\u062d\u062b',status:'approved',media_kind:'image',
  formats:[mockFormat],files:[],assigned_to:admin.id,department_id:uid(9),sort_order:0,requirement_number:1};
(async()=>{
  const denied=scriptedSql([]);
  await assert.rejects(()=>api.createManualKeywordsProduct(denied,viewer));
  denied.assertDone();
  const db=scriptedSql([
    step('select pg_advisory_xact_lock',[],(_,q)=>assert(q.includes('::bigint'))),
    step('select i.id::text as id',[]),
    step('select id::text as id from marketing.campaign_types',[{id:uid(8)}]),
    step('select id::text as id from marketing.departments',[{id:uid(9)}]),
    step('select pt.id::text',[mockFormat,mockVideo]),
    step('insert into marketing.work_reservations',[{id:uid(19),task_number:5}]),
    step('insert into marketing.work_tasks',[],(values)=>assert(values.includes('MANUAL-KEYWORDS'))),
    step('insert into marketing.work_items',[{id:uid(20)}],(values,query)=>{
      assert(query.includes("'approved'"),'The reusable product is approved on creation');
      assert(query.includes("'image'"),'The existing posting media contract stays intact');
      const formats=values.find(Array.isArray);
      assert.equal(formats.length,1,'Only image-compatible post types are selected');
    }),
    step('insert into marketing.work_history',[],values=>assert(values.includes('manual_product_created'))),
    step('update marketing.work_reservations'),
  ]);
  const created=await api.createManualKeywordsProduct(db,admin);
  assert.equal(created.id,uid(20));assert.equal(created.existed,false);db.assertDone();
  const repeat=scriptedSql([
    step('select pg_advisory_xact_lock'),step('select i.id::text as id',[{id:uid(20)}]),
  ]);
  const reused=await api.createManualKeywordsProduct(repeat,admin);
  assert.equal(reused.id,uid(20));assert.equal(reused.existed,true);repeat.assertDone();
  console.log('PASS: one permission-gated Keywords product; repeated requests preserve the same identity');

  const list=scriptedSql([
    step('select i.*,i.due_on::text',[manual]),
    step('select i.id::text as id,i.task_id::text as task_id',[]),
  ]);
  const rows=await api.products(list,viewer);
  assert.equal(rows.length,1);
  assert.equal(rows[0].manual_product,true);
  assert.equal(rows[0].statement,manual.idea_name);
  assert.equal(rows[0].files.length,0,'Text-only product needs no fabricated media files');
  list.assertDone();
  const detail=scriptedSql([
    step('select i.*,i.due_on::text,t.name as task_name',[manual]),
    step('select i.*,i.due_on::text',[manual]),
  ]);
  const visible=await api.productVisible(detail,viewer,manual.id);
  assert.equal(visible.manual_product,true);
  assert.deepEqual(visible.files,[]);
  detail.assertDone();
  const groups=choice.productChoiceGroups(rows);
  assert.equal(groups.length,1);assert.equal(groups[0].title,manual.idea_name);
  assert.equal(choice.productChoiceLabel(rows[0]),manual.idea_name);
  const plan=load('src/marketing/workflow/planComposer.ts');
  const entry={key:'first',date:'2026-11-15',productId:manual.id,platforms:[{
    platformId:mockFormat.platform_id,postTypeId:mockFormat.id,postTypeIds:[mockFormat.id],
    budget:'120',postTypeBudgets:{[mockFormat.id]:'120'}
  }]};
  assert.equal(plan.validatePlanComposer([entry],rows,[{...mockFormat,platform_id:mockFormat.platform_id}],'campaign'),'');
  assert.equal(plan.planEntriesPayload([entry],'campaign')[0].productId,manual.id);
  console.log('PASS: normal product/list/detail/campaign picker includes Keywords without task requirements or final files');

  const server=fs.readFileSync('server/marketing/workflow.ts','utf8');
  const page=fs.readFileSync('src/marketing/pages/ProductsPage.tsx','utf8');
  const compose=fs.readFileSync('src/marketing/workflow/CreatePage.tsx','utf8');
  assert(server.includes("action === 'work_create_manual_keywords_product'"));
  assert(server.includes("t.task_no<>'MANUAL-KEYWORDS'"),'Internal product must not appear as a delivery task');
  assert(page.includes("workPost('create_manual_keywords_product'"));
  assert(compose.includes('product.manual_product'));
  assert(compose.includes('productChoiceLabel(candidate)'));
  console.log('PASS: products UI, campaign selection, task/calendar isolation and workflow API are wired');
})().catch(err=>{console.error(err);process.exitCode=1;});
