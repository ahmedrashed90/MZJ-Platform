'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createLoader, scriptedSql } = require('./marketing-workflow-test-support.cjs');
const root = process.cwd();
const fakeUser = { id: '00000000-0000-4000-8000-000000000001' };
const P = '00000000-0000-4000-8000-000000000010';
const A = '00000000-0000-4000-8000-000000000011';
const B = '00000000-0000-4000-8000-000000000012';
const C = '00000000-0000-4000-8000-000000000013';
const T = '00000000-0000-4000-8000-000000000020';
const permission = { '../../shared/system-access.js': { hasPermission: (_, key) => key === 'marketing.campaign.create' },
  '../_access-control.js': { getSystemAccess: () => ({ dataScope:'all' }) },
  '../../shared/marketing-workflow.js': { isWorkDate: s => /^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(s) },
  '../../shared/marketing-workflow-labels.js': { W: { denied: 'denied',invalid:'invalid',notFound:'not found' } },
};
const service = createLoader(root, permission)('server/marketing/plan-executor-dates.ts');
const caps = { canViewPlan: async () => true,canReviewPlan:async () => false };
const bases = [{item_id:A,task_id:T,idea_code:'IDEA1',marketing_category:'بيعي',idea_name:'لشركتك سيارة جديدة',task_no:'TSK-0001',task_name:'بيعي'},
  {item_id:B,task_id:T,idea_code:'IDEA1',marketing_category:'بيعي',idea_name:'لشركتك سيارة جديدة',task_no:'TSK-0001',task_name:'بيعي'}];
const sibling = (id,client_key,due_on,assignee_name) => ({id,client_key,task_id:T,idea_name:'لشركتك سيارة جديدة',media_kind:'video',due_on,assignee_name});
const siblings = [sibling(A,'a','2027-01-03','محمود'),sibling(B,'b','2027-01-05','بلال'),sibling(C,'c','2027-01-06','المصور')];
const marker = {task_id:T,data:{clientKeys:['a','b','c'],itemIdeaCodes:['IDEA1','IDEA1','IDEA1']}};
const baseSteps = [
  {match:'from marketing.work_plans where id=',rows:[{id:P,kind:'campaign',created_by:fakeUser.id,review_status:'revision',is_deleted:false}]},
  {match:"to_regclass('marketing.work_plan_executor_dates')",rows:[{ready:true}]},
  {match:'from marketing.work_plan_items l',rows:bases},
  {match:'from marketing.work_items i left join core.users u',rows:siblings},
  {match:'from marketing.work_history h',rows:[marker]},
  {match:'from marketing.work_plan_executor_dates where plan_id=',rows:[{item_id:A,due_on:null}]},
];
let checks=0;
function test(label,fn){fn();checks++;console.log('PASS:',label)}
(async()=>{
  const sql=scriptedSql([...baseSteps]);
  const res=await service.getPlanExecutorDates(sql,fakeUser,{planId:P},caps);
  test('One idea groups two executors and the photographer by original idea code',()=>{
    assert.equal(res.ideas.length,1);assert.equal(res.ideas[0].executors.length,3);
    assert.deepEqual(res.ideas[0].executors.map(row=>row.assigneeName),['محمود','بلال','المصور']);
  });
  test('Cleared plan date does not fall back to the non-null task date',()=>{
    const first=res.ideas[0].executors[0]; assert.equal(first.originalDueOn,'2027-01-03');
    assert.equal(first.dueOn,null);assert.equal(first.overridden,true);
    assert.equal(res.ideas[0].executors[1].dueOn,'2027-01-05');
  });
  test('Editing approved/revision plans remains permitted to original creator',()=>assert.equal(res.canEdit,true));
  test('Plan creator cannot execute database migrations without platform superadmin permission',()=>assert.equal(res.canUpgrade,false));
  test('Only real related executors match a strategy idea code',()=>{
    assert(service.executorIdeaMatches(bases[0],siblings[2],'IDEA1'));
    assert.equal(service.executorIdeaMatches(bases[0],{...siblings[2],id:'other'},'DIFFERENT'),false);
  });
  sql.assertDone();
  const saveSql=scriptedSql([...baseSteps,
    {match:"set local lock_timeout",rows:[]},
    {match:'select id from marketing.work_plans',rows:[{id:P}]},
    {match:'insert into marketing.work_plan_executor_dates(plan_id,item_id,due_on,updated_by)',rows:[]},
    {match:'update marketing.work_plans set updated_at=now()',rows:[]},
  ]);
  const saved=await service.savePlanExecutorDates(saveSql,fakeUser,{planId:P,entries:[{itemId:B,dueOn:null}]},caps);
  test('Saving NULL works as a plan-specific clear for one executor',()=>assert.equal(saved.changed,1));
  test('Saving does not update the task or other executor dates',()=>{
    const writes=saveSql.calls.filter(c=>/^(?:update|insert|delete) /i.test(c.query));
    assert.equal(writes.length,2);
    assert(!writes.some(c=>c.query.includes('marketing.work_items')));
    assert(!writes.some(c=>c.values.includes(A) || c.values.includes(C)));
  });
  saveSql.assertDone();
  const categories=createLoader(root)('src/marketing/workflow/strategyIdeaCategories.ts');
  const ideas=[{id:'1',taskName:'تعريفي - بالبراند',category:'بيعي'},
    {id:'2',taskName:'بيعي - كاش',category:'بيعي - كاش'},
    {id:'3',taskName:'تعريفي - بالبراند',category:'بيعي'},
    {id:'4',taskName:'تعريفي - مواصفات السيارات',category:'تعريفي'}];
  const groups=categories.groupDraftIdeas(ideas);
  test('Strategy task category is authoritative over campaign label',()=>assert.deepEqual(groups.map(g=>g.category),['تعريفي - بالبراند','بيعي','تعريفي - مواصفات السيارات']));
  test('Group headings never lose or merge idea records',()=>assert.deepEqual(groups.flatMap(g=>g.items.map(i=>i.id)).sort(),['1','2','3','4']));
  const source=p=>fs.readFileSync(p,'utf8');
  const draftSource=source('src/marketing/workflow/StrategyDrafts.tsx');
  const backend=source('server/marketing/strategy-drafts.ts');
  const schema=source('server/_marketing-workflow-schema.ts');
  test('Campaign end is editable in draft and persisted with a dedicated field',()=>{
    assert(draftSource.includes('تاريخ نهاية الحملة'));
    assert(draftSource.includes('strategy_save_draft\', { draftId: draft.id, campaignEndOn }'));
    assert(backend.includes('campaign_end_on=${draft.kind'));
    assert(schema.includes('campaign_end_on date'));
  });
  test('Submitting campaign sends explicit end instead of last idea date',()=>assert(backend.includes('fundingTo: current.campaignEndOn || funding.at(-1)')));
  test('Draft delivery overrides transfer with plan submission',()=>assert(backend.includes('set plan_id=${planId}::uuid,draft_id=null')));
  test('Review and report both display executor dates, and status is not a filter',()=>{
    assert(source('src/marketing/workflow/PlanDetail.tsx').includes('<PlanExecutorDates planId={id}'));
    assert(source('src/marketing/workflow/PlanReport.tsx').includes('<PlanExecutorDates planId={id}'));
    assert(source('src/marketing/workflow/StrategyDrafts.tsx').includes('<PlanExecutorDates draftId={draft.id}'));
  });
  console.log(`${checks}/${checks} draft, category and executor-date tests passed`);
})().catch(e=>{console.error(e);process.exitCode=1;});
