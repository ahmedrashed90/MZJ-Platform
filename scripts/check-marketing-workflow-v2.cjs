const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLoader, scriptedSql } = require('./marketing-workflow-test-support.cjs');
const root = process.cwd(), events = [], tests = [];
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0');
const system = { enabled:true, dataScope:'all', roleCode:'admin', branchCodes:[], departmentCodes:[] };
const admin = {id:uid(1),fullName:'Admin',permissions:['platform.superadmin'],deniedPermissions:[],systemAccess:{marketing:system}};
const worker = {id:uid(2),fullName:'Worker',permissions:['system.marketing.access','marketing.task.view_assigned','marketing.task.final_file.upload','marketing.receipt_calendar.view'],deniedPermissions:[],systemAccess:{marketing:{...system,dataScope:'assigned'}}};
const stubs = {
  '../_db.js': { getSql:()=>{throw Error('No live database in tests');},withDatabaseAdvisoryLock:async(k,fn)=>fn() },
  '../_auth.js': { loadUserProfile:async()=>null },
  '../_access-control.js': { getSystemAccess:u=>u.systemAccess.marketing },
  '../_marketing-workflow-schema.js': { ensureMarketingWorkflowSchema:async()=>{} },
  '../_notifications.js': { createNotification:async e=>events.push(e) },
  '../_media-storage.js': {mediaStorageConfigured:()=>false,buildMarketingStorageKey:()=>`work/${uid(80)}`,headMediaObject:async()=>({exists:true,size:4}),createUploadUrl:()=>{throw Error('Unexpected external upload');}},
  '../_google-drive-storage.js': {createGoogleDriveResumableUpload:async()=>({uploadUrl:'https://upload.invalid/test'}),verifyGoogleDriveUploadedFile:async()=>({id:'drive-id',size:4})},
};
const privateExports=['reserveTask','createTask','reviewItem','submitItem','saveItem','addItemFormats','prepareUpload','commitUpload','removeUpload','calendar','productVisible','products','taskSummary','createPlan','publishTarget','resetPublicationAfterCheck','saveProductDraft','deleteWorkflowTask','taskList'];
const load=createLoader(root,stubs,{'server/marketing/workflow.ts':'\nexport { '+privateExports.join(',')+' };'});
const domain=load('shared/marketing-workflow.ts'), api=load('server/marketing/workflow.ts'), evaluations=load('server/marketing/evaluations.ts'), {W}=load('shared/marketing-workflow-labels.ts');
const format={id:uid(10),platform_id:uid(20),name:'Photo',platform_name:'Instagram',platform_code:'instagram',width:1080,height:1080};
const file={id:uid(80),name:'tucson.jpg',mime_type:'image/jpeg',file_size:4,category:'final',format_id:format.id,status:'ready'};
const item={id:uid(51),task_id:uid(50),task_name:'Tucson',task_no:'TSK-000001',created_by:admin.id,assigned_to:worker.id,department_id:uid(30),status:'submitted',media_kind:'image',formats:[format],files:[file],version:1,due_on:'2026-10-15'};
const test=(name,fn)=>tests.push([name,fn]);
const step=(match,rows=[],check)=>({match,rows,check});
const itemRead=rows=>step('select i.*,t.name as task_name',rows);
const taskLock=()=>step('select id from marketing.work_tasks');
const itemLock=rows=>step('select * from marketing.work_items',rows);
const itemLoad=rows=>step('coalesce(d.name',rows);
const recalc=(rows,expectedStatus)=>[taskLock(),itemLoad(rows),step('update marketing.work_tasks',[],values=>assert.equal(values[0],expectedStatus))];
const identitySql=scriptedSql([]);

test('Parent readiness includes both approved and uploaded final outputs',()=>assert.deepEqual(domain.workReadiness([{...item,status:'approved'},item]),{total:2,approved:1,percent:75,complete:false}));
test('Final upload counts half readiness but not final approval',()=>assert.deepEqual(domain.workReadiness([item]),{total:1,approved:0,percent:50,complete:false}));
test('Individual requirement starts at 0 percent without final uploads',()=>assert.equal(domain.workItemReadiness({...item,status:'in_progress',files:[]}),0));
test('Idea-only attachments do not mark requirement as uploaded',()=>assert.equal(domain.workItemReadiness({...item,status:'in_progress',files:[{...file,category:'idea'}]}),0));
test('Pending or unfinished files do not mark requirement as uploaded',()=>assert.equal(domain.workItemReadiness({...item,status:'in_progress',files:[{...file,status:'pending'}]}),0));
test('Individual requirement reaches 50 percent after all final files are uploaded',()=>assert.equal(domain.workItemReadiness({...item,status:'in_progress'}),50));
test('Submitted requirement remains at 50 percent until approval',()=>assert.equal(domain.workItemReadiness(item),50));
test('Revision with still-ready final files remains at 50 percent',()=>assert.equal(domain.workItemReadiness({...item,status:'revision'}),50));
test('Individual requirement reaches 100 percent after approval',()=>assert.equal(domain.workItemReadiness({...item,status:'approved'}),100));
test('Approval without final coverage cannot show 100 percent',()=>assert.equal(domain.workItemReadiness({...item,status:'approved',files:[]}),0));
test('Partial format upload contributes its proportional share before other formats arrive',()=>assert.equal(domain.workItemReadiness({...item,formats:[format,{...format,id:uid(11)}]}),25));
test('Review buttons require ready FINAL files but do not require Submit',()=>{
  const noFiles={...item,status:'in_progress',format_reviews:[],files:[]};
  assert.equal(domain.workReviewableFormats(noFiles,'approve').length,0);
  assert.equal(domain.workReviewableFormats(noFiles,'revise').length,0);
  const onlyIdea={...noFiles,files:[{...file,category:'idea'}]};
  assert.equal(domain.workReviewableFormats(onlyIdea,'approve').length,0);
  assert.equal(domain.workReviewableFormats(onlyIdea,'revise').length,0);
  const ready={...noFiles,files:[file]};
  assert.deepEqual(domain.workReviewableFormats(ready,'approve').map(f=>f.id),[format.id]);
  assert.deepEqual(domain.workReviewableFormats(ready,'revise').map(f=>f.id),[format.id]);
});
test('Revision locks its format until a new final file is uploaded',()=>{
  const revision={...item,status:'revision',format_reviews:[{format_id:format.id,status:'revision'}]};
  assert.equal(domain.workReviewableFormats(revision,'approve').length,0);
  assert.equal(domain.workReviewableFormats(revision,'revise').length,0);
  assert.equal(domain.workReviewableFormats({...revision,format_reviews:[]},'approve').length,1);
  assert.equal(domain.workReviewableFormats({...revision,format_reviews:[{format_id:format.id,status:'approved'}]},'revise').length,0);
});
test('Incomplete carousel can be revised but cannot be approved as 100%',()=>{
  const partial={...item,formats:[{...format,name:'carousel'}],format_reviews:[]};
  assert.equal(domain.workReviewableFormats(partial,'revise').length,1);
  assert.equal(domain.workReviewableFormats(partial,'approve').length,0);
});
test('Parent task progress mirrors the detailed requirement milestone',()=>assert.equal(domain.workReadiness([item]).percent,domain.workItemReadiness(item)));
test('Each requirement displays its idea and readiness without opening detail',()=>{const front=fs.readFileSync(path.join(root,'src/marketing/workflow/TaskDetail.tsx'),'utf8');assert(front.includes('({item.idea?.trim() ||'));assert(front.includes('<Readiness value={workItemReadiness(item)} />'));assert(front.indexOf('<Readiness value={workItemReadiness(item)} />')<front.indexOf('{opened && <ItemEditor'));});
test('Approval without a ready file never counts',()=>assert.equal(domain.workReadiness([{...item,status:'approved',files:[]}]).percent,0));
test('All formats need final coverage',()=>assert.equal(domain.finalCoverage({...item,formats:[format,{...format,id:uid(11)}]}),false));
test('Wrong image/video file type is rejected',()=>assert.equal(domain.finalCoverage({...item,media_kind:'video'}),false));
test('Carousel requires at least two images',()=>assert.equal(domain.finalCoverage({...item,formats:[{...format,name:'carousel'}]}),false));
test('Two-image carousel final coverage',()=>assert.equal(domain.finalCoverage({...item,formats:[{...format,name:'carousel'}],files:[file,{...file,id:uid(81)}]}),true));
test('Video requires exactly one final file per format',()=>assert.equal(domain.finalCoverage({...item,media_kind:'video',files:[{...file,name:'video.mp4',mime_type:'video/mp4'},{...file,id:uid(81),name:'two.mp4',mime_type:'video/mp4'}]}),false));
test('Final media can be reused across platforms only for an identical output size',()=>{
  const matching={...format,id:uid(11),platform_id:uid(21),platform_name:'Facebook'};
  assert.deepEqual(domain.matchingWorkflowPublishFiles([file],[format],matching,'image'),[file]);
  assert.deepEqual(domain.matchingWorkflowPublishFiles([file],[format],{...matching,width:1080,height:1920},'image'),[]);
  assert.deepEqual(domain.matchingWorkflowPublishFiles([file],[format],matching,'video'),[]);
  assert.deepEqual(domain.matchingWorkflowPublishFiles([file],[format],{...matching,width:null,height:null},'image'),[]);
  assert.deepEqual(domain.matchingWorkflowPublishFiles([file],[format],format,'image'),[file]);
});
test('Cross-platform reuse does not mix the assets of unrelated task formats',()=>{
  const otherFormat={...format,id:uid(15)};
  const sameSizeOnThirdPlatform={...format,id:uid(16),platform_id:uid(22)};
  const otherFile={...file,id:uid(82),format_id:otherFormat.id,name:'another.jpg'};
  assert.deepEqual(domain.matchingWorkflowPublishFiles([file,otherFile],[format,otherFormat],sameSizeOnThirdPlatform,'image'),[file]);
  assert.deepEqual(domain.matchingWorkflowPublishFiles([file,otherFile],[otherFormat,format],sameSizeOnThirdPlatform,'image'),[otherFile]);
  assert.deepEqual(domain.matchingWorkflowPublishFiles([file,otherFile],[format,otherFormat],otherFormat,'image'),[otherFile]);
});
test('Auto-publishing accepts configured adapters and rejects missing or unsupported platform codes',()=>{
  for (const code of ['facebook','instagram','youtube','tiktok']) assert.equal(domain.workPlatformSupportsAutoPublish(code),true,`Supported platform ${code}`);
  for (const code of [undefined,null,'','snapchat','FACEBOOK','TIKTOK','tiktok-live',' tiktok ']) assert.equal(domain.workPlatformSupportsAutoPublish(code),false,`Unsupported platform ${String(code)}`);
});
test('Marketing dashboard uses the safe auto-publishing platform check',()=>{
  const source=fs.readFileSync(path.join(root,'src/marketing/pages/MarketingDashboardPage.tsx'),'utf8');
  assert(source.includes('group.every(line => workPlatformSupportsAutoPublish(line.platform_code))'));
  assert(!source.includes('includes(line.platform_code)'));
});
test('Dashboard includes completed tasks and orders by newest creation first',()=>{
  const s=fs.readFileSync(path.join(root,'server/marketing/workflow.ts'),'utf8');
  assert(s.includes('tasks: await taskList(sql, user), lines:'));
  assert(s.includes('order by t.created_at desc,t.task_number desc'));
  assert(s.includes('where t.is_deleted=false'));
});
test('Campaign and agenda platform choices come from active marketing catalog, not task formats',()=>{
  const front=fs.readFileSync(path.join(root,'src/marketing/workflow/CreatePage.tsx'),'utf8');
  const api=fs.readFileSync(path.join(root,'server/marketing/workflow.ts'),'utf8');
  assert(front.includes('activePlatforms.filter(platform => availablePlanPostTypes(meta.postTypes, product.media_kind, platform.id).length)'));
  assert(front.includes('availablePlanPostTypes(meta.postTypes, product?.media_kind, platform.platformId)'));
  assert(api.includes('const formats = await validateFormats(tx, product.media_kind, ids)'));
  assert(api.includes('await validateFormats(tx, product.media_kind, [postTypeId])'));
  assert(!api.includes('if (!list(product.formats).some((format: WorkFormat) => format.id === postTypeId))'));
});
test('Scheduled preparation checks cross-platform media links against approved final assets',()=>{
  const api=fs.readFileSync(path.join(root,'server/marketing/workflow.ts'),'utf8');
  assert(api.includes('matchingWorkflowPublishFiles(product.files, taskFormats, format, product.media_kind)'));
  assert(api.includes('join marketing.platform_post_types destination_format'));
  assert(api.includes('source_format.width=destination_format.width'));
  assert(api.includes("and jf.category='final'"));
});
test('Publishing page starts collapsed with a compact row table',()=>{
  const source=fs.readFileSync(path.join(root,'src/marketing/workflow/PublishPage.tsx'),'utf8');
  assert(source.includes('<details key={taskId} className="mkw-publish-group mkw-publish-table-group">'));
  assert(source.includes('<table className="mkw-publish-list-table">'));
  assert(source.includes("setExpandedProduct(open ? '' : product.id)"));
  assert(!source.includes('(expandedProduct || firstId)'));
});
test('Deletion shrinks the readiness denominator',()=>assert.deepEqual(domain.workReadiness([{...item,status:'approved'}]),{total:1,approved:1,percent:100,complete:true}));
test('An empty task is never 100 percent complete',()=>assert.deepEqual(domain.workReadiness([]),{total:0,approved:0,percent:0,complete:false}));
test('Six outputs grant 8.3% for a ready upload and 16.7% when approved',()=>{
  const base = Array.from({length:6},(_,index)=>({...item,id:uid(60+index),status:'in_progress',files:[]}));
  assert.deepEqual(domain.workReadiness([{...base[0],files:[file]},...base.slice(1)]),{total:6,approved:0,percent:8.3,complete:false});
  assert.deepEqual(domain.workReadiness([{...base[0],status:'approved',files:[file]},...base.slice(1)]),{total:6,approved:1,percent:16.7,complete:false});
  assert.deepEqual(domain.workReadiness(base.map(entry=>({...entry,files:[file]}))),{total:6,approved:0,percent:50,complete:false});
  assert.deepEqual(domain.workReadiness(base.map(entry=>({...entry,status:'approved',files:[file]}))),{total:6,approved:6,percent:100,complete:true});
});
test('Task percent combines approved, uploaded, and unfinished items without rounding each contribution',()=>{
  const cases = [100,100,100,100,50,50].map((percent,index)=>({...item,id:uid(60+index),status:percent===100?'approved':'submitted'}));
  assert.deepEqual(domain.workReadiness(cases),{total:6,approved:4,percent:83.3,complete:false});
});
test('Incomplete media counts only finished formats, with remaining formats at zero',()=>{
  const missing={...item,formats:[format,{...format,id:uid(11)}]};
  assert.deepEqual(domain.workReadiness([missing,{...item,files:[]}]),{total:2,approved:0,percent:12.5,complete:false});
  assert.deepEqual(domain.workReadiness([{...item,status:'approved',files:[]}]),{total:1,approved:0,percent:0,complete:false});
});
test('Task list batches only authorized item IDs and derives identical weighted readiness as detail',async()=>{
  const taskId=uid(50), otherTaskId=uid(59);
  const one=uid(51),two=uid(52),three=uid(53),four=uid(54),five=uid(55),six=uid(56);
  const records=[one,two,three,four,five,six].map((value,index)=>({
    task_id:taskId,id:value,status:index===0?'approved':index===1?'submitted':'in_progress',
    media_kind:'image',formats:[format],files:index<2?[file]:[],
  }));
  const db=scriptedSql([
    step('select t.*,ct.name as type_name',[{id:taskId,visible_item_ids:[one,two,three,four,five,six],product_count:6},
      {id:otherTaskId,visible_item_ids:[],product_count:0}],(_,query)=>{
      assert.match(query,/array_agg\(i\.id::text\)/);
      assert.match(query,/i\.assigned_to=/);
    }),
    step('select i.task_id::text as task_id',records,(values,query)=>{
      assert.deepEqual(values,[[one,two,three,four,five,six]]);
      assert.match(query,/j\.category='final' and f\.status='ready'/);
    }),
  ]);
  const result=await api.taskList(db,worker);
  assert.deepEqual(result.map(({id,product_count,approved_count,readiness})=>({id,product_count,approved_count,readiness})),[
    {id:taskId,product_count:6,approved_count:1,readiness:25},
    {id:otherTaskId,product_count:0,approved_count:0,readiness:0},
  ]);
  assert.equal(result[0].visible_item_ids,undefined);
  db.assertDone();
});
test('Empty task dashboard does not query item files',async()=>{
  const db=scriptedSql([step('select t.*,ct.name as type_name',[{id:uid(50),visible_item_ids:[],product_count:0}])]);
  assert.equal((await api.taskList(db,worker))[0].readiness,0);
  db.assertDone();
});
test('Rounding is stable',()=>assert.equal(domain.workReadiness([{...item,status:'approved'},item,item]).percent,66.7));
for(const name of ['Reels','video','Shorts'])test(`Video format filter: ${name}`,()=>{assert.equal(domain.supportsWorkMedia('image',name),false);assert.equal(domain.supportsWorkMedia('video',name),true);});
for(const name of ['Photo','image','carousel'])test(`Image format filter: ${name}`,()=>{assert.equal(domain.supportsWorkMedia('image',name),true);assert.equal(domain.supportsWorkMedia('video',name),false);});
test('Generic story supports both declared media kinds',()=>{assert.equal(domain.supportsWorkMedia('image','Story'),true);assert.equal(domain.supportsWorkMedia('video','Story'),true);});
for(const extension of ['doc','docx','xls','xlsx'])test(`Idea attachment ${extension}`,()=>assert.equal(domain.ideaFileAllowed('idea.'+extension),true));
test('Idea extension double-extension bypass denied',()=>assert.equal(domain.ideaFileAllowed('idea.docx.exe'),false));
test('Real leap date accepted and impossible dates rejected',()=>{assert(domain.isWorkDate('2028-02-29'));for(const d of ['2026-02-29','2026-13-01','2026-04-31','2026-01-01Z'])assert.equal(domain.isWorkDate(d),false);});
test('SQL Date values normalize consistently',()=>assert.equal(domain.workDate(new Date('2026-10-15T00:00:00Z')),'2026-10-15'));
test('Terminal approval name recognition',()=>assert.equal(domain.isTerminalApproval(W.approve),true));
test('Explicit deny beats platform admin review',()=>assert.equal(api.workflowCapabilities({...admin,deniedPermissions:['marketing.task.review']}).review,false));
test('Executors cannot review',()=>assert.equal(api.workflowCapabilities(worker).review,false));
test('Calendar rejects impossible date before any query',async()=>assert.rejects(()=>api.calendar(identitySql,worker,{query:{from:'2026-02-29',to:'2026-03-01'}})));
test('Calendar bounds excessive ranges',async()=>assert.rejects(()=>api.calendar(identitySql,worker,{query:{from:'2026-01-01',to:'2026-12-31'}})));
test('Calendar gives platform admin all assignees within selected date range',async()=>{
  const db=scriptedSql([step('and (? or i.assigned_to=?::uuid) and i.due_on between',[],v=>assert.deepEqual(v,[true,admin.id,'2026-10-01','2026-10-31']))]);
  await api.calendar(db,admin,{query:{from:'2026-10-01',to:'2026-10-31'}});db.assertDone();
});
test('Calendar limits regular executor to own deliverables',async()=>{
  const db=scriptedSql([step('and (? or i.assigned_to=?::uuid) and i.due_on between',[],v=>assert.deepEqual(v,[false,worker.id,'2026-10-01','2026-10-31']))]);
  await api.calendar(db,worker,{query:{from:'2026-10-01',to:'2026-10-31'}});db.assertDone();
});
test('Calendar shows each requirement readiness even when the same task has another due date',async()=>{
  const earlier = {...item,formats:[format],files:[file],status:'submitted',format_reviews:[]};
  const later = {...item,id:uid(52),due_on:'2026-10-25',formats:[format],files:[file],status:'approved',format_reviews:[{format_id:format.id,status:'approved'}]};
  const cards = [earlier,later].map(({id,task_id,due_on,status})=>({id,task_id,due_on,status,task_name:'Tucson',task_no:'TSK-000001'}));
  const db = scriptedSql([
    step('select i.id,i.task_id,i.due_on::text',cards, v=>assert.deepEqual(v,[true,admin.id,'2026-10-01','2026-10-31'])),
    step('select i.id::text as id,i.task_id::text as task_id',[earlier,later],v=>assert.deepEqual(v,[[item.task_id],true,admin.id])),
  ]);
  const result=await api.calendar(db,admin,{query:{from:'2026-10-01',to:'2026-10-31'}});
  assert.equal(result.rows.length,2);
  assert.equal(result.rows[0].item_readiness,50);
  assert.equal(result.rows[1].item_readiness,100);
  assert.equal(result.rows[0].task_readiness,undefined);
  db.assertDone();
});
test('Calendar gives regular user readiness from only their visible requirement',async()=>{
  const calendarCard={id:item.id,task_id:item.task_id,due_on:'2026-10-15'};
  const scopedItem={...item,formats:[format],files:[file],format_reviews:[]};
  const db=scriptedSql([
    step('select i.id,i.task_id,i.due_on::text',[calendarCard],v=>assert.deepEqual(v,[false,worker.id,'2026-10-01','2026-10-31'])),
    step('select i.id::text as id,i.task_id::text as task_id',[scopedItem],v=>assert.deepEqual(v,[[item.task_id],false,worker.id])),
  ]);
  const result=await api.calendar(db,worker,{query:{from:'2026-10-01',to:'2026-10-31'}});
  assert.equal(result.rows[0].item_readiness,50);db.assertDone();
});
test('Reviewer can append additional configured photo sizes without touching existing files and approvals',async()=>{
  const next={...format,id:uid(11),name:'Photo Square',platform_id:uid(21),platform_name:'Facebook'};
  const db=scriptedSql([
    itemRead([item]),taskLock(),itemLock([item]),
    step('from marketing.platform_post_types pt join marketing.platforms p',[next],v=>assert.deepEqual(v,[[next.id]])),
    step('update marketing.work_items',[{version:2}],(v,query)=>{
      assert.deepEqual(v[0].map(f=>f.id),[format.id,next.id]);
      assert.deepEqual(v.slice(1,4),[false,false,false]);
      assert(!query.includes('delete from marketing.work_item_files'));
    }),
    step('insert into marketing.work_history',[],v=>{assert.equal(v[2],'formats_added');assert.deepEqual(v[6].formatIds,[next.id]);}),
    ...recalc([{...item,status:'submitted',formats:[format,next],format_reviews:[{format_id:format.id,status:'approved'}]}],'active'),
  ]);
  const n=events.length;
  const output=await api.addItemFormats(db,{itemId:item.id,version:1,formatIds:[next.id]},admin);
  assert.equal(output.added,1);
  assert.equal(output.version,2);
  assert.equal(events.length,n+1);
  assert.deepEqual(events.at(-1).audienceUserIds,[worker.id]);
  db.assertDone();
});
test('Appending sizes to an approved requirement reopens ONLY its final approval',async()=>{
  const next={...format,id:uid(12),name:'Photo Square',platform_id:uid(21)};
  const approved={...item,status:'approved',format_reviews:[{format_id:format.id,status:'approved'}]};
  const reopened={...approved,status:'in_progress',formats:[format,next]};
  assert.equal(domain.workItemReadiness(reopened),50);
  const db=scriptedSql([
    itemRead([approved]),taskLock(),itemLock([approved]),
    step('from marketing.platform_post_types pt join marketing.platforms p',[next]),
    step('update marketing.work_items',[{version:2}],v=>{
      assert.deepEqual(v[0].map(f=>f.id),[format.id,next.id]);
      assert.deepEqual(v.slice(1,4),[true,true,true]);
    }),
    step('update marketing.work_action_progress',[],(_,query)=>{
      assert.match(query,/a\.is_final_approval=true/);
      assert.match(query,/completed=false/);
    }),
    step('insert into marketing.work_history'),
    ...recalc([reopened],'active'),
  ]);
  await api.addItemFormats(db,{itemId:item.id,version:1,formatIds:[next.id]},admin);
  db.assertDone();
});
test('Reviewer can append configured video sizes to a VIDEO requirement',async()=>{
  const initial={...format,name:'Video'};
  const added={...format,id:uid(13),name:'Video Reels',platform_id:uid(21)};
  const video={...item,status:'in_progress',media_kind:'video',formats:[initial],files:[]};
  const db=scriptedSql([
    itemRead([video]),taskLock(),itemLock([video]),
    step('from marketing.platform_post_types pt join marketing.platforms p',[added]),
    step('update marketing.work_items',[{version:2}],v=>assert.deepEqual(v[0].map(f=>f.name),['Video','Video Reels'])),
    step('insert into marketing.work_history'),
    ...recalc([{...video,formats:[initial,added]}],'active'),
  ]);
  const result=await api.addItemFormats(db,{itemId:item.id,version:1,formatIds:[added.id]},admin);
  assert.equal(result.added,1);db.assertDone();
});
test('Executor cannot add final sizes',async()=>{
  await assert.rejects(()=>api.addItemFormats(identitySql,{itemId:item.id,version:1,formatIds:[uid(11)]},worker));
});
test('Adding an existing format cannot duplicate it',async()=>{
  const db=scriptedSql([itemRead([item]),taskLock(),itemLock([item])]);
  await assert.rejects(()=>api.addItemFormats(db,{itemId:item.id,version:1,formatIds:[format.id]},admin));
  db.assertDone();
});
test('Invalid or repeated format IDs cannot be added',async()=>{
  await assert.rejects(()=>api.addItemFormats(identitySql,{itemId:item.id,version:1,formatIds:[]},admin));
  await assert.rejects(()=>api.addItemFormats(identitySql,{itemId:item.id,version:1,formatIds:[uid(11),uid(11)]},admin));
});
test('Stale version cannot append formats to a concurrently edited item',async()=>{
  const db=scriptedSql([itemRead([item]),taskLock(),itemLock([{...item,version:2}])]);
  await assert.rejects(()=>api.addItemFormats(db,{itemId:item.id,version:1,formatIds:[uid(11)]},admin));
  db.assertDone();
});
test('Video-only dimensions cannot be appended to an image requirement',async()=>{
  const newFormat={...format,id:uid(11),name:'Video Reels'};
  const db=scriptedSql([itemRead([item]),taskLock(),itemLock([item]),step('from marketing.platform_post_types pt join marketing.platforms p',[newFormat])]);
  await assert.rejects(()=>api.addItemFormats(db,{itemId:item.id,version:1,formatIds:[newFormat.id]},admin));
  db.assertDone();
});
test('Client only shows unselected sizes compatible with the requirement media kind',()=>{
  const front=fs.readFileSync(path.join(root,'src/marketing/workflow/TaskDetail.tsx'),'utf8');
  const api=fs.readFileSync(path.join(root,'server/marketing/workflow.ts'),'utf8');
  assert(front.includes("workPost('add_item_formats'"));
  assert(front.includes('capabilities.review && <button type="button" className="secondary"'));
  assert(front.includes('!configuredIds.has(format.id) && supportsWorkMedia(item.media_kind, format.name)'));
  assert(front.includes('<FormatSelector formats={availableFormats} selected={newFormatIds}'));
  assert(api.includes("requirePermission(user, 'marketing.task.review')"));
  assert(api.includes("else if (action === 'work_add_item_formats') result = await addItemFormats(sql, body, user)"));
});
test('Executor cannot invoke reviewer API',async()=>assert.rejects(()=>api.reviewItem(identitySql,{itemId:item.id,decision:'approve',version:1},worker)));
test('Revision needs a note',async()=>assert.rejects(()=>api.reviewItem(identitySql,{itemId:item.id,decision:'revise',version:1,note:''},admin)));
test('Stale review cannot overwrite concurrent changes',async()=>{const db=scriptedSql([itemRead([item]),taskLock(),itemLock([{...item,version:2}])]);await assert.rejects(()=>api.reviewItem(db,{itemId:item.id,decision:'approve',version:1},admin));db.assertDone();});
test('Approve checks actual final files before updating state',async()=>{const db=scriptedSql([itemRead([item]),taskLock(),itemLock([item]),itemLoad([{...item,files:[]}])]);await assert.rejects(()=>api.reviewItem(db,{itemId:item.id,decision:'approve',version:1},admin));db.assertDone();});
test('Approval completes a fully delivered single-output task',async()=>{
  const pending={...item,format_reviews:[{format_id:format.id,status:'submitted'}]};
  const db=scriptedSql([
    itemRead([pending]),taskLock(),itemLock([pending]),itemLoad([pending]),
    step('insert into marketing.work_history'),
    step('insert into marketing.work_format_reviews',[],v=>{assert.equal(v[2],'approved'); assert.equal(v[3],true);}),
    step('select format_id,status',[{format_id:format.id,status:'approved'}]),
    step('update marketing.work_items',[],v=>assert.equal(v[0],'approved')),
    step('insert into marketing.work_action_progress'),
    ...recalc([{...pending,status:'approved',format_reviews:[{format_id:format.id,status:'approved'}]}],'completed'),
  ]);
  const result=await api.reviewItem(db,{itemId:item.id,decision:'approve',version:1},admin);
  assert.equal(result.readiness.percent,100);db.assertDone();
});
test('Admin can reject an unsubmitted requirement with NO final files',async()=>{
  const empty={...item,status:'in_progress',format_reviews:[],files:[]};
  const db=scriptedSql([
    itemRead([empty]),taskLock(),itemLock([empty]),itemLoad([empty]),
    step('insert into marketing.work_history',[],v=>assert.deepEqual(v[6].formatIds,[])),
    step('insert into marketing.work_rejected_items',[],v=>assert.equal(v[0],empty.id)),
    step('delete from marketing.work_items',[],v=>assert.deepEqual(v,[empty.id])),
    ...recalc([],'empty'),
  ]);
  const result=await api.reviewItem(db,{itemId:item.id,decision:'reject',version:1},admin);
  assert.equal(result.readiness.total,0);db.assertDone();
});
test('Admin can approve uploaded files directly without executor Submit',async()=>{
  const ready={...item,status:'in_progress',format_reviews:[],submitted_at:null};
  const db=scriptedSql([
    itemRead([ready]),taskLock(),itemLock([ready]),itemLoad([ready]),
    step('insert into marketing.work_history',[],v=>assert.deepEqual(v[6].formatIds,[format.id])),
    step('insert into marketing.work_format_reviews',[],v=>{assert.equal(v[2],'approved');assert.equal(v[3],true);}),
    step('select format_id,status',[{format_id:format.id,status:'approved'}]),
    step('update marketing.work_items',[],(v,q)=>{assert.equal(v[0],'approved');assert(q.includes('submitted_at=case when'));}),
    step('insert into marketing.work_action_progress'),
    ...recalc([{...ready,status:'approved',format_reviews:[{format_id:format.id,status:'approved'}]}],'completed'),
  ]);
  const result=await api.reviewItem(db,{itemId:item.id,decision:'approve',version:1},admin);
  assert.equal(result.readiness.percent,100);db.assertDone();
});
test('Admin can request revision immediately after final upload, before Submit',async()=>{
  const ready={...item,status:'in_progress',format_reviews:[]};
  const categoryId=uid(72);
  const db=scriptedSql([
    itemRead([ready]),taskLock(),itemLock([ready]),itemLoad([ready]),
    step('select id from marketing.work_review_categories',[{id:categoryId}]),
    step('insert into marketing.work_history',[],v=>assert.deepEqual(v[6].formatIds,[format.id])),
    step('insert into marketing.work_format_reviews',[],v=>assert.equal(v[2],'revision')),
    step('select format_id,status',[{format_id:format.id,status:'revision'}]),
    step('insert into marketing.work_item_review_notes'),
    step('update marketing.work_items',[],v=>assert.equal(v[0],'revision')),
    ...recalc([{...ready,status:'revision',format_reviews:[{format_id:format.id,status:'revision'}]}],'active'),
  ]);
  const result=await api.reviewItem(db,{itemId:item.id,decision:'revise',note:'تعديل مطلوب',categoryId,version:1},admin);
  assert.equal(result.readiness.percent,50);db.assertDone();
});
test('Admin cannot revise a requirement with only an idea attachment',async()=>{
  const empty={...item,status:'in_progress',format_reviews:[],files:[{...file,category:'idea'}]};
  const db=scriptedSql([itemRead([empty]),taskLock(),itemLock([empty]),itemLoad([empty])]);
  await assert.rejects(()=>api.reviewItem(db,{itemId:item.id,decision:'revise',categoryId:uid(72),note:'تعديل',version:1},admin));
  db.assertDone();
});
test('Executor can be rated after reviewer requested changes, without 100% approval',async()=>{
  const revised={...item,status:'revision'};
  const criterionId=uid(95);
  const db=scriptedSql([
    step('select id,assigned_to,status,formats',[revised]),
    step('select 1 from marketing.work_format_reviews',[{ready:1}]),
    step('select id::text,name from marketing.work_kpi_criteria',[{id:criterionId,name:'جودة التنفيذ'}]),
    step('insert into marketing.work_item_ratings',[],v=>assert.equal(v[4],100)),
  ]);
  const result=await evaluations.saveItemRating(db,admin,{scores:[{criterionId,score:3}]},revised);
  assert.equal(result.percentage,100);db.assertDone();
});
test('Cannot rate an unreviewed executor who merely uploaded files',async()=>{
  const draft={...item,status:'in_progress'};
  const db=scriptedSql([
    step('select id,assigned_to,status,formats',[draft]),
    step('select 1 from marketing.work_format_reviews',[]),
  ]);
  await assert.rejects(()=>evaluations.saveItemRating(db,admin,{scores:[]},draft),/تقييم المنفذ متاح/);
  db.assertDone();
});
test('Rating a rejected requirement does not require any submitted files',async()=>{
  const criterionId=uid(95), rejected={item_id:item.id,assigned_to:worker.id};
  const db=scriptedSql([
    step('select item_id,assigned_to from marketing.work_rejected_items',[rejected]),
    step('select id::text,name from marketing.work_kpi_criteria',[{id:criterionId,name:'جودة التنفيذ'}]),
    step('update marketing.work_rejected_items',[],v=>{assert.equal(v[1],100);assert.equal(v[3],item.id);}),
  ]);
  const result=await evaluations.saveRejectedItemRating(db,admin,{scores:[{criterionId,score:3}]},rejected);
  assert.equal(result.percentage,100);db.assertDone();
});
test('Reject archives selected output for grading before deletion and recalculates remaining readiness',async()=>{
  const remaining={...item,id:uid(52),status:'approved'};
  const db=scriptedSql([
    itemRead([item]),taskLock(),itemLock([item]),itemLoad([item,remaining]),
    step('insert into marketing.work_history'),
    step('insert into marketing.work_rejected_items',[],v=>{
      assert.equal(v[0],item.id); assert.equal(v[1],item.task_id);
      assert.equal(v[2],worker.id); assert.equal(v[4],item.media_kind);
      assert.equal(v[5],admin.id);
    }),
    step('delete from marketing.work_items',[],v=>assert.deepEqual(v,[item.id])),
    ...recalc([remaining],'completed'),
  ]);
  const r=await api.reviewItem(db,{itemId:item.id,decision:'reject',version:1},admin);
  assert.equal(r.readiness.total,1);assert.equal(r.readiness.percent,100);db.assertDone();
});
test('Rejecting last output archives it for grading but leaves task empty, not a product',async()=>{
  const db=scriptedSql([
    itemRead([item]),taskLock(),itemLock([item]),itemLoad([item]),
    step('insert into marketing.work_history'),
    step('insert into marketing.work_rejected_items',[],v=>assert.equal(v[0],item.id)),
    step('delete from marketing.work_items',[],v=>assert.deepEqual(v,[item.id])),
    ...recalc([],'empty'),
  ]);
  const r=await api.reviewItem(db,{itemId:item.id,decision:'reject',version:1},admin);
  assert.equal(r.readiness.total,0);assert.equal(r.readiness.complete,false);db.assertDone();
});
test('Submitting someone else output is denied',async()=>{const db=scriptedSql([itemRead([{...item,assigned_to:uid(3),status:'in_progress'}])]);await assert.rejects(()=>api.submitItem(db,{itemId:item.id,version:1},worker));db.assertDone();});
test('Pending uploads block submission',async()=>{const current={...item,status:'in_progress'};const db=scriptedSql([itemRead([current]),taskLock(),itemLock([current]),itemLoad([current]),step('select count(*)::int as count',[{count:1}])]);await assert.rejects(()=>api.submitItem(db,{itemId:item.id,version:1},worker));db.assertDone();});
test('Upload item/reservation identity is mutually exclusive',async()=>assert.rejects(()=>api.prepareUpload(identitySql,{itemId:item.id,reservationId:uid(90),category:'idea',fileName:'a.docx',fileSize:4},admin)));
test('Upload to someone else output is denied',async()=>{const db=scriptedSql([itemRead([{...item,status:'in_progress'}]),taskLock(),step('select id from marketing.work_items'),itemRead([{...item,status:'in_progress'}])]);await assert.rejects(()=>api.prepareUpload(db,{itemId:item.id,category:'final',fileName:'a.jpg',fileSize:4,mimeType:'image/jpeg',formatIds:[format.id]},admin));db.assertDone();});
test('Staging final upload holds task and item locks atomically',async()=>{const row={...item,status:'in_progress'};const db=scriptedSql([itemRead([row]),taskLock(),step('select id from marketing.work_items'),itemRead([row]),step('select format_id from marketing.work_format_reviews',[]),step('insert into marketing.files',[{id:file.id}]),step('insert into marketing.work_uploads')]);const r=await api.prepareUpload(db,{itemId:item.id,category:'final',fileName:'a.jpg',fileSize:4,mimeType:'image/jpeg',formatIds:[format.id]},worker);assert.equal(r.storageProvider,'google-drive');db.assertDone();});
test('Removing an unrelated file is denied',async()=>{const row={...item,status:'in_progress'};const db=scriptedSql([step('select * from marketing.work_uploads',[{file_id:file.id,item_id:uid(99),created_by:uid(3)}]),itemRead([row]),taskLock(),step('select status,assigned_to',[row]),itemRead([row]),step('select 1 from marketing.work_item_files')]);await assert.rejects(()=>api.removeUpload(db,{itemId:item.id,fileId:file.id},worker));db.assertDone();});
test('Products require whole-task completion and newest-first order',async()=>{const db=scriptedSql([step("where t.is_deleted=false and t.status='completed' and i.status='approved'",[],(v,q)=>{assert(q.includes('order by t.completed_at desc,i.approved_at desc'));})]);assert.deepEqual(await api.products(db,admin),[]);db.assertDone();});
test('Unreleased products cannot be selected by ID',async()=>{const db=scriptedSql([step("and t.status='completed'",[])]);await assert.rejects(()=>api.productVisible(db,admin,item.id));db.assertDone();});
function publishingDb(status,kind='agenda',extra=[]){return scriptedSql([step('select target.line_id,p.kind',[{line_id:uid(61),kind}]),step('from marketing.work_plan_items l',[{id:uid(61)}]),...(kind==='campaign'?[]:[step('for update of s',[{id:uid(71),status,platform_code:'instagram',caption:'Tucson',hashtags:'#MZJ',publish_result:{id:'remote-1'}}]), ...(['waiting','failed'].includes(status)?[step('join marketing.work_plans plan',[{ok:1}])]:[])]),...extra]);}
const services={validatePublishItem:async()=>{},publishItem:async()=>({})};
test('Funding plan never triggers organic publication or spend',async()=>{const db=publishingDb('waiting','campaign');await assert.rejects(()=>api.publishTarget(db,admin,{scheduleId:uid(71)},services));db.assertDone();});
test('Already published target is idempotent',async()=>{let calls=0;const db=publishingDb('published');const r=await api.publishTarget(db,admin,{scheduleId:uid(71)},{...services,publishItem:async()=>{calls++;}});assert.equal(r.alreadyPublished,true);assert.equal(calls,0);db.assertDone();});
for(const status of ['processing','verification_required','cancelled','unknown'])test(`Public write blocked for ${status}`,async()=>{const db=publishingDb(status);await assert.rejects(()=>api.publishTarget(db,admin,{scheduleId:uid(71)},services));db.assertDone();});
test('Preflight error never claims publication',async()=>{const db=publishingDb('waiting');await assert.rejects(()=>api.publishTarget(db,admin,{scheduleId:uid(71)},{...services,validatePublishItem:async()=>{throw Error('Connection missing');}}));db.assertDone();});
test('Ambiguous public failure requires explicit verification, no retry',async()=>{let calls=0;const db=publishingDb('waiting','agenda',[step("set status='processing'"),step("set status='verification_required'"),step('insert into marketing.publish_logs')]);await assert.rejects(()=>api.publishTarget(db,admin,{scheduleId:uid(71)},{...services,publishItem:async()=>{calls++;throw Error('response lost');}}));assert.equal(calls,1);db.assertDone();});
test('Explicit retry requires confirmation of external state',async()=>assert.rejects(()=>api.resetPublicationAfterCheck(identitySql,admin,{scheduleId:uid(71),confirmedNotPublished:false})));
test('Task preview scopes active and rejected deliverables to current executor',async()=>{
  const other={...item,id:uid(52),assigned_to:uid(3)};
  const rejected={id:uid(53),assigned_to:worker.id,status:'rejected',idea_name:'Rejected item'};
  const db=scriptedSql([
    step('select t.*',[{id:item.task_id,name:'Tucson',type_id:uid(40),created_by:admin.id}]),
    itemLoad([item,other]),
    step('from marketing.work_rejected_items',[rejected],v=>assert.deepEqual(v,[item.task_id,false,worker.id])),
    step('select name from marketing.campaign_types',[{name:'Cash'}]),
    step('select id,action,note',[],v=>assert.deepEqual(v[2],[item.id])),
  ]);
  const r=await api.taskSummary(db,worker,item.task_id);
  assert.equal(r.task.items.length,1);assert.equal(r.task.items[0].assigned_to,worker.id);
  assert.equal(r.rejectedItems.length,1);assert.equal(r.rejectedItems[0].assigned_to,worker.id);db.assertDone();
});
test('Task preview allows platform admin to see rejected grading archive',async()=>{
  const rejected={id:uid(53),assigned_to:uid(3),status:'rejected'};
  const db=scriptedSql([
    step('select t.*',[{id:item.task_id,name:'Tucson',type_id:uid(40),created_by:admin.id}]),
    itemLoad([item]),
    step('from marketing.work_rejected_items',[rejected],v=>assert.deepEqual(v,[item.task_id,true,admin.id])),
    step('select name from marketing.campaign_types',[{name:'Cash'}]),
    step('from marketing.platform_post_types pt join marketing.platforms p',[format]),
    step('select id,action,note'),
  ]);
  const r=await api.taskSummary(db,admin,item.task_id);
  assert.equal(r.rejectedItems.length,1);assert.equal(r.rejectedItems[0].assigned_to,uid(3));db.assertDone();
});
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('Additive workflow schema contains no destructive reset',()=>{const s=read('server/_marketing-workflow-schema.ts');assert(!/drop\s+(?:schema|table)|truncate/i.test(s));assert(!/DROP SCHEMA marketing CASCADE/i.test(read('server/_marketing-schema.ts')));});
test('Terminal approval is excluded from ordinary department sum',()=>{const s=read('server/marketing/index.ts');assert(s.includes('and is_final_approval=false'));assert(s.includes('!terminal&&Number(sum?.total||0)+percentage>100.001'));});
test('Old creation endpoints are retired instead of wrapped',()=>{const s=read('server/marketing/index.ts');assert(!s.includes('async function createCampaignInTransaction'));assert(!s.includes('async function createAgendaInTransaction'));assert(s.includes('retiredCreation'));});
test('Live version refresh is visibility-aware and non-destructive',()=>{const s=read('src/marketing/workflow/api.ts');assert(s.includes('document.visibilityState'));assert(s.includes('90000'));assert(s.includes('18000'));assert(s.includes('reading.current'));assert(s.includes("workGet<{ version: string }>('version')"));});
test('Database is one table and three type filters',()=>{const s=read('src/marketing/pages/MarketingDatabasePage.tsx');assert.equal((s.match(/<table>/g)||[]).length,1);for(const kind of ['task','agenda','campaign'])assert(s.includes(`value="${kind}"`));});
test('Products has exactly the agreed three headers',()=>{const s=read('src/marketing/pages/ProductsPage.tsx');assert.equal((s.match(/<th>/g)||[]).length,3);for(const label of ['statement','ideaName','viewProduct'])assert(s.includes(`<th>{W.${label}}</th>`));});
test('Selected calendar day only passes its outputs to the detail view',()=>{const s=read('src/marketing/pages/ReceiptCalendarPage.tsx');assert(s.includes('row.due_on === selectedDay'));assert(s.includes('onlyItems={opened.items}'));});
test('Native publish engines are used for prepared outputs',()=>{const s=read('server/marketing/index.ts');assert(s.includes('publishItem:publishScheduleItem'));assert(s.includes('workflowScheduleFiles(sql'));assert(s.includes('assertLegacyMarketingTarget'));});
test('Marketing schema and workflow share a serial DDL lock',()=>{const m=read('server/_marketing-schema.ts'),w=read('server/_marketing-workflow-schema.ts');assert(m.includes("withDatabaseAdvisoryLock('mzj:marketing:schema-setup'"));assert(w.includes("tryWithDatabaseAdvisoryLock('mzj:marketing:schema-setup'"));});
test('Marketing does not trigger operations DDL and workflow skips legacy Marketing migration',()=>{const s=read('server/marketing/index.ts');assert(!s.includes('ensureOperationsSchema'));assert(s.includes("if (request.method !== 'GET' && !workflowRequest) {\n      await ensureMarketingSchema();"));const schema=read('server/_marketing-schema.ts');assert(schema.includes('const MARKETING_SCHEMA_VERSION = 3;'));});
test('Small additive draft migration runs without resetting marketing',()=>{const s=read('server/_marketing-workflow-schema.ts');assert(s.includes('MARKETING_WORKFLOW_UPGRADE_SQL'));assert(s.includes('create table if not exists marketing.work_product_drafts'));assert(s.includes("values('schema-2')"));assert(s.includes("values('schema-3')"));assert(s.includes('MARKETING_MIGRATION_BUSY'));});
test('Executor has no permission to prepare a product draft',async()=>{await assert.rejects(()=>api.saveProductDraft(identitySql,worker,{productId:item.id,formatIds:[format.id],caption:'test'}));});
test('Publishing preparation is inside the product view with format, caption and hashtags',()=>{const s=read('src/marketing/workflow/PublishPage.tsx');assert(s.includes('ProductDraftEditor'));assert(s.includes("workPost('save_product_draft'"));assert(s.includes('W.platforms'));assert(s.includes('W.caption'));assert(s.includes('W.hashtags'));});
test('Prepared drafts persist on the product and copy into a plan at creation',()=>{const s=read('server/marketing/workflow.ts');assert(s.includes('async function saveProductDraft('));assert(s.includes("requirePermission(user, 'marketing.publish_prep.manage')"));assert(s.includes('where product_id=any('));assert(s.includes('coalesce(draft.caption'));assert(s.includes('work_save_product_draft'));});
test('Task opens full screen without legacy assignment checkboxes',()=>{const css=read('src/marketing/workflow/workflow.css'),detail=read('src/marketing/workflow/TaskDetail.tsx');assert(css.includes('.mzj-modal-card.mkw-fullscreen'));assert(css.includes('height:100dvh'));assert(detail.includes('className="mkw-fullscreen"'));assert(!detail.includes('toggleAction'));});
test('Task creator groups multiple deliverables by executor without duplicate assignment selectors',()=>{const page=read('src/marketing/workflow/CreatePage.tsx');assert(page.includes('type ExecutorDraft =') && page.includes('items: RequiredDraft[]'));assert(page.includes('إضافة منفذ جديد'));assert(page.includes('mkw-executor-group') && page.includes('mkw-horizontal-row'));assert(page.includes('updateExecutor(executor.key, { departmentId:'));assert(page.includes('changeItem(executor.key, item.key, {'));assert(page.includes('W.addItem'));assert(page.includes('for (const executor of executors) for (const item of executor.items)'));assert(!page.includes('W.addAssignee'));});
test('New marketing navigation is centered in the workflow stylesheet',()=>{const css=read('src/marketing/workflow/workflow.css');assert(css.includes('.marketing-shell .marketing-nav { justify-content:center'));});
test('Deleting a task atomically removes every related campaign/agenda schedule, not sibling source tasks',async()=>{
  const taskId=uid(50),p1=uid(61),p2=uid(62),l1=uid(71),l2=uid(72),l3=uid(73);
  const db=scriptedSql([
    step('select id,name,task_no,is_deleted,created_by',[{id:taskId,is_deleted:false,created_by:admin.id}]),
    step('select distinct l.plan_id::text',[{plan_id:p1},{plan_id:p2}]),
    step('select id from marketing.work_plans',[],v=>assert.deepEqual(v[0],[p1,p2])),
    step('select id::text from marketing.work_plan_items',[{id:l1},{id:l2},{id:l3}]),
    step("s.status in('processing','verification_required')",[]),
    step('from marketing.work_uploads upload',[]),
    step('update marketing.publish_schedule s',[],v=>assert.deepEqual(v[0],[l1,l2,l3])),
    step('update marketing.work_plan_items',[],v=>assert.deepEqual(v[0],[l1,l2,l3])),
    step('update marketing.work_plans',[],v=>assert.deepEqual(v[1],[p1,p2])),
    step('update marketing.campaigns',[],v=>assert.deepEqual(v[0],[p1,p2])),
    step('update marketing.agendas',[],v=>assert.deepEqual(v[1],[p1,p2])),
    step('update marketing.work_tasks',[],v=>assert.equal(v[1],taskId)),
    step('insert into marketing.work_history'),
  ]);
  const result=await api.deleteWorkflowTask(db,admin,taskId);
  assert.equal(result.deletedPlans,2);assert.equal(result.affectedLines,3);db.assertDone();
});
test('Task deletion refuses provider operations that may already be in flight',async()=>{
  const db=scriptedSql([
    step('select id,name,task_no,is_deleted,created_by',[{id:item.task_id,is_deleted:false,created_by:admin.id}]),
    step('select distinct l.plan_id::text',[{plan_id:uid(61)}]),
    step('select id from marketing.work_plans'),
    step('select id::text from marketing.work_plan_items',[{id:uid(71)}]),
    step("s.status in('processing','verification_required')",[{exists:1}]),
  ]);
  await assert.rejects(()=>api.deleteWorkflowTask(db,admin,item.task_id),/عملية نشر|نشر جار/);db.assertDone();
});
test('Scheduled publisher is protected and respects plan activation',()=>{
  const schedule=read('server/marketing/workflow.ts'),route=read('server/internal/marketing-publish-tick.ts'),vercel=read('vercel.json');
  assert(schedule.includes('plan.activated_at is not null'));
  assert(schedule.includes('p.activated_at is not null'));
  assert(schedule.includes('coalesce(p.activated_by,p.created_by)::text as publisher_id'));
  assert(schedule.includes("s.status='waiting'"));
  assert(route.includes('safeSecretEquals'));assert(route.includes('CRON_SECRET'));
  assert(vercel.includes('/api/internal/marketing-publish-tick'));
});
test('Bulk tracking stages update only selected vehicle IDs and log each changed VIN',()=>{
  const orders=read('server/tracking/orders.ts'),page=read('src/tracking/pages/TrackingOrdersPage.tsx');
  assert(orders.includes('complete_stage_bulk'));
  assert(orders.includes('vs.vehicle_id=any(${vehicleIds}::uuid[])'));
  assert(orders.includes('vehicle_id=any(${vehicleIds}::uuid[])'));
  assert(orders.includes('for (const target of targets)'));
  assert(orders.includes('if (affectedCount > 0)'));
  assert(page.includes('تحديد الكل'));assert(page.includes('تم الانتهاء للمحدد'));
});
test('Only permitted campaign deletions show an admin confirmation',()=>{const page=read('src/marketing/pages/MarketingDatabasePage.tsx');assert(page.includes("hasPermission(user, 'marketing.campaign.delete')"));assert(page.includes("row.kind === 'campaign' && canDeleteCampaign"));assert(page.includes('className="mkw-confirm-delete"'));});
(async()=>{let failed=0;for(const [name,fn]of tests){try{await fn();console.log('PASS: '+name);}catch(e){failed++;console.error('FAIL: '+name+'\n'+e.stack);}}console.log(`${tests.length-failed}/${tests.length} workflow checks passed (domain + mocked SQL boundary; no live DB/provider).`);process.exitCode=failed?1:0;})();
