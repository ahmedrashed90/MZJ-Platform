'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createLoader,scriptedSql}=require('./marketing-workflow-test-support.cjs');
const root=path.resolve(__dirname,'..');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const admin={id:id(1),fullName:'Admin',permissions:['platform.superadmin'],deniedPermissions:[],systemAccess:{marketing:{dataScope:'all'}}};
const executor={id:id(2),fullName:'Executor',permissions:['marketing.task.view_assigned'],deniedPermissions:[],systemAccess:{marketing:{dataScope:'assigned'}}};
const load=createLoader(root,{
  '../_db.js':{getSql:()=>{throw Error('External database prohibited')}},
  '../_access-control.js':{getSystemAccess:(user)=>user.systemAccess.marketing},
});
const ratings=load('server/marketing/evaluations.ts');
const domain=load('shared/marketing-workflow.ts');
let checks=0;
function check(name,fn){return Promise.resolve().then(fn).then(()=>{checks++;console.log('PASS',name)});}
const formatA={id:id(10),name:'image',platform_name:'Meta',platform_code:'meta',platform_id:id(12)};
const formatB={...formatA,id:id(11),name:'story'};
const fileA={id:id(50),name:'design.png',mime_type:'image/png',file_size:1024,format_id:formatA.id,category:'final',status:'ready'};
const item={id:id(100),assigned_to:executor.id,formats:[formatA,formatB],files:[fileA],media_kind:'image',status:'submitted'};
const step=(match,rows=[],check)=>({match,rows,check});
async function main(){
  await check('Partial format ready counts 25, and approval of it counts 50',()=>{
    assert.equal(domain.workItemReadiness(item),25);
    assert.equal(domain.workItemReadiness({...item,format_reviews:[{format_id:formatA.id,status:'approved'}]}),50);
    assert.equal(domain.workItemReadiness({...item,files:[fileA,{...fileA,id:id(51),format_id:formatB.id}],format_reviews:[{format_id:formatA.id,status:'approved'}]}),75);
    assert.equal(domain.workItemReadiness({...item,files:[fileA,{...fileA,id:id(51),format_id:formatB.id}],format_reviews:[{format_id:formatA.id,status:'approved'},{format_id:formatB.id,status:'approved'}]}),100);
  });
  await check('Incomplete carousel does not count as a finished format',()=>{
    assert.equal(domain.workItemReadiness({...item,formats:[{...formatA,name:'carousel'}]}),0);
  });
  await check('Every quality level has its own threshold and star grade',()=>{
    for (const [score,label,stars] of [[0,'غير مناسب',1],[49.99,'غير مناسب',1],[50,'ضعيف',2],[59.99,'ضعيف',2],[60,'مقبول',3],[89.99,'مقبول',3],[90,'جيد',4],[99.99,'جيد',4],[100,'ممتاز',5]]) {
      assert.equal(domain.workRatingLevel(score).label,label);assert.equal(domain.workRatingLevel(score).stars,stars);
    }
  });
  await check('Admin saves a complete 0-3 per-criterion grade at the correct percentage',async()=>{
    const db=scriptedSql([
      step('select id,assigned_to,status,formats',[{id:item.id,assigned_to:executor.id,status:'approved',formats:item.formats}]),
      step('select count(*)::int as approved_count',[{approved_count:2}]),
      step('select id::text,name from marketing.work_kpi_criteria',[{id:id(201),name:'قبول أو رفض المنتج'},{id:id(202),name:'الجودة'}]),
      step('insert into marketing.work_item_ratings',[],(values)=>{
        const grades=values.find(v=>Array.isArray(v));
        assert.deepEqual(grades.map(r=>r.score),[3,0]);
        assert.equal(values[4],50);
      }),
    ]);
    const result=await ratings.saveItemRating(db,admin,{scores:[{criterionId:id(201),score:3},{criterionId:id(202),score:0}]},item);
    assert.equal(result.percentage,50);db.assertDone();
  });
  await check('Out-of-range values and executor grading are rejected',async()=>{
    const input={scores:[{criterionId:id(201),score:4}]};
    await assert.rejects(()=>ratings.saveItemRating(scriptedSql([]),executor,input,item));
    const db=scriptedSql([step('select id,assigned_to,status,formats',[{id:item.id,assigned_to:executor.id,status:'approved',formats:item.formats}]),step('select count(*)::int as approved_count',[{approved_count:2}]),step('select id::text,name from marketing.work_kpi_criteria',[{id:id(201),name:'Design'}])]);
    await assert.rejects(()=>ratings.saveItemRating(db,admin,input,item));db.assertDone();
  });
  await check('Unapproved requirements cannot be rated by an administrator', async()=>{
    const db=scriptedSql([step('select id,assigned_to,status,formats',[{id:item.id,assigned_to:executor.id,status:'submitted',formats:item.formats}])]);
    await assert.rejects(()=>ratings.saveItemRating(db,admin,{scores:[{criterionId:id(201),score:3}]},item), /100%/);
    db.assertDone();
  });
  await check('Binary acceptance criterion rejects 1 or 2 on the server',async()=>{
    const db=scriptedSql([
      step('select id,assigned_to,status,formats',[{id:item.id,assigned_to:executor.id,status:'approved',formats:item.formats}]),
      step('select count(*)::int as approved_count',[{approved_count:2}]),
      step('select id::text,name from marketing.work_kpi_criteria',[{id:id(201),name:'قبول أو رفض المنتج'}]),
    ]);
    await assert.rejects(()=>ratings.saveItemRating(db,admin,{scores:[{criterionId:id(201),score:2}]},item), /0 أو 3/);
    db.assertDone();
  });
  await check('Rejected requirement rating is saved only in archival table',async()=>{
    const db=scriptedSql([
      step('select item_id,assigned_to',[{item_id:item.id,assigned_to:executor.id}]),
      step('select id::text,name from marketing.work_kpi_criteria',[{id:id(201),name:'قبول أو رفض المنتج'},{id:id(202),name:'الجودة'}]),
      step('update marketing.work_rejected_items',[],values=>{
        const grades=values.find(v=>Array.isArray(v));
        assert.deepEqual(grades.map(r=>r.score),[0,3]);
      }),
    ]);
    const result=await ratings.saveRejectedItemRating(db,admin,{scores:[{criterionId:id(201),score:0},{criterionId:id(202),score:3}]},{item_id:item.id});
    assert.equal(result.percentage,50);db.assertDone();
  });
  await check('Only managers may change review notes, and categories validate against settings',async()=>{
    await assert.rejects(()=>ratings.manageItemReviewNote(scriptedSql([]),executor,{remove:true},item));
    const db=scriptedSql([step('select id',[{id:item.id}]),step('select id from marketing.work_review_categories',[{id:id(301)}]),step('insert into marketing.work_item_review_notes'),step('update marketing.work_items')]);
    await ratings.manageItemReviewNote(db,admin,{categoryId:id(301),note:'Please fix text'},item);db.assertDone();
  });
  await check('Review notes support independent creation, editing, and deletion',async()=>{
    const db=scriptedSql([
      step('select id',[{id:item.id}]),
      step('select id from marketing.work_review_categories',[{id:id(301)}]),
      step('select id from marketing.work_item_review_notes',[{id:id(400)}]),
      step('update marketing.work_item_review_notes'),step('update marketing.work_items'),
    ]);
    await ratings.manageItemReviewNote(db,admin,{noteId:id(400),categoryId:id(301),note:'Updated comment'},item);
    db.assertDone();
    const deleting=scriptedSql([step('select id',[{id:item.id}]),
      step('select id from marketing.work_item_review_notes',[{id:id(400)}]),
      step('update marketing.work_item_review_notes'),step('update marketing.work_items')]);
    await ratings.manageItemReviewNote(deleting,admin,{noteId:id(400),remove:true},item);
    deleting.assertDone();
    await assert.rejects(()=>ratings.manageItemReviewNote(scriptedSql([]),admin,{remove:true},item));
  });
  await check('New schema keeps existing reviews and tracks daily organic followers',()=>{
    const sql=fs.readFileSync(path.join(root,'database/migrations/20261022_marketing_review_notes.sql'),'utf8');
    for(const key of ['work_item_review_notes','work_item_review_notes_legacy_unique','social_follower_snapshots','schema-6']) assert(sql.includes(key));
    assert(sql.includes('on conflict do nothing'));
    assert(!/drop\s+(?:table|schema)|truncate\s+table/i.test(sql));
  });
  await check('Rating controls are three per row and stars appear only with overall result',()=>{
    const task=fs.readFileSync(path.join(root,'src/marketing/workflow/TaskDetail.tsx'),'utf8');
    const css=fs.readFileSync(path.join(root,'src/marketing/workflow/workflow.css'),'utf8');
    assert(task.includes('mkw-rating-final-result') && task.includes('mkw-requirement-rating-strip'));
    assert(task.includes('type="number" min="0" max="3" step="1"'));
    assert(css.includes('mkw-rating-criteria-grid{display:grid;grid-template-columns:repeat(3'));
    assert(!task.includes('اختر الدرجة'));
  });
  await check('Schema includes independent format approvals and review ratings',()=>{
    const schema=fs.readFileSync(path.join(root,'database/migrations/20261021_marketing_reviews_kpi.sql'),'utf8');
    for (const key of ['work_review_categories','work_format_reviews','work_item_ratings','work_kpi_criteria','schema-5']) assert(schema.includes(key));
    assert(!/drop\s+(?:table|schema)|truncate\s+table/i.test(schema));
  });
  await check('Executor interface and settings, reports, review controls are integrated',()=>{
    const task=fs.readFileSync(path.join(root,'src/marketing/workflow/TaskDetail.tsx'),'utf8');
    const screen=fs.readFileSync(path.join(root,'src/marketing/pages/MarketingRatingsPage.tsx'),'utf8');
    const workflow=fs.readFileSync(path.join(root,'server/marketing/workflow.ts'),'utf8');
    assert(task.includes('عرض التقييم')&&task.includes('mkw-note-fields'));
    assert(screen.includes('أعلى تقييم خلال كل شهر'));
    assert(workflow.includes("and status='revision'") || workflow.includes("and fr.status='revision'"));
    assert(workflow.includes("status in ('approved','submitted')"));
  });
  await check('Campaign charts use every filtered campaign without a fixed top-N limit',()=>{
    const text=fs.readFileSync(path.join(root,'src/marketing/components/CampaignReportPage.tsx'),'utf8');
    assert(!text.includes('CHART_LIMIT'));
    assert(!text.includes('.slice(0, CHART_LIMIT)'));
    assert(text.indexOf('className="mcr-charts"')<text.indexOf('className="panel mcr-filters"'));
    assert(!text.includes('لوحة موحدة لنتائج الحملات الإعلانية'));
    for (const label of ['التفاعلات لكل حملة','عدد الليدات لكل حملة','تكلفة الليد لكل حملة']) assert(text.includes(label));
  });
  await check('Removed duplicate engagement tabs and TikTok follower counts come from approved OAuth scope',()=>{
    const ui=fs.readFileSync(path.join(root,'src/marketing/pages/EngagementPage.tsx'),'utf8');
    assert(!ui.includes('نتائج الأجندات')&&!ui.includes('الحملات الممولة'));
    const provider=fs.readFileSync(path.join(root,'server/_platform-connections.ts'),'utf8');
    assert(provider.includes('user.info.stats')&&provider.includes('follower_count'));
    assert(fs.readFileSync(path.join(root,'server/_marketing-social-accounts.ts'),'utf8').includes('/api/analytics/account')); 
    assert(fs.readFileSync(path.join(root,'server/_marketing-tiktok-ads.ts'),'utf8').includes("['onsite_form']"));
  });
  console.log(`\n${checks}/${checks} combined 2026-10-21 marketing checks passed (offline).`);
}
main().catch(e=>{console.error(e);process.exitCode=1});
