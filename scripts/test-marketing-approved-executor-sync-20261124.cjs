'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createLoader, scriptedSql } = require('./marketing-workflow-test-support.cjs');
const service = createLoader(process.cwd())('server/marketing/approved-executor-dates.ts');
const P = '00000000-0000-4000-8000-000000000010';
const A = '00000000-0000-4000-8000-000000000011';
const B = '00000000-0000-4000-8000-000000000012';
const C = '00000000-0000-4000-8000-000000000013';
const T = '00000000-0000-4000-8000-000000000020';
const user = { id:'00000000-0000-4000-8000-000000000001',fullName:'مراجع التسويق' };
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS:', name); }
(async()=>{
  const steps = [
    {match:"to_regclass('marketing.work_plan_executor_dates')",rows:[{has_table:true,has_applied:true,nullable_date:true}]},
    {match:'from marketing.work_plan_executor_dates where plan_id=',rows:[
      {id:'00000000-0000-4000-8000-000000000101',item_id:A,due_on:null},
      {id:'00000000-0000-4000-8000-000000000102',item_id:B,due_on:'2027-01-25'},
    ]},
    {match:'from marketing.work_items i join marketing.work_tasks t',rows:[{task_id:T,due_on:'2027-01-11'}]},
    {match:'update marketing.work_items set due_on=',check:(values)=>{ assert.equal(values[0],null); assert.equal(values[1],A); }},
    {match:'insert into marketing.work_history',check:(values)=>{
      assert.equal(values[0],T); assert.equal(values[1],A); assert.equal(values[4].previousDueOn,'2027-01-11'); assert.equal(values[4].dueOn,null);
    }},
    {match:'update marketing.work_plan_executor_dates set applied_at=now()',rows:[]},
    {match:'from marketing.work_items i join marketing.work_tasks t',rows:[{task_id:T,due_on:'2027-01-20'}]},
    {match:'update marketing.work_items set due_on=',check:(values)=>{assert.equal(values[0],'2027-01-25'); assert.equal(values[1],B);}},
    {match:'insert into marketing.work_history',check:(values)=>{assert.equal(values[1],B);assert.equal(values[4].dueOn,'2027-01-25');}},
    {match:'update marketing.work_plan_executor_dates set applied_at=now()',rows:[]},
  ];
  const sql=scriptedSql(steps);
  const count=await service.applyApprovedPlanExecutorDates(sql,user,P);
  test('Approved plan updates exactly two pending executor deadlines',()=>assert.equal(count,2));
  test('Clear is committed as SQL NULL instead of the old original date',()=>assert(sql.calls.some(c=>c.query.startsWith('update marketing.work_items') && c.values[0]===null)));
  test('Other executor remains untouched',()=>assert(!sql.calls.some(c=>c.values.includes(C))));
  test('Each changed executor receives an audit entry',()=>assert.equal(sql.calls.filter(c=>c.query.startsWith('insert into marketing.work_history')).length,2));
  test('Pending rows become applied only after writing their original tasks',()=>assert.equal(sql.calls.filter(c=>c.query.includes('set applied_at=now()')).length,2));
  sql.assertDone();

  const repeat=scriptedSql([
    {match:"to_regclass('marketing.work_plan_executor_dates')",rows:[{has_table:true,has_applied:true,nullable_date:true}]},
    {match:'from marketing.work_plan_executor_dates where plan_id=',rows:[]},
  ]);
  const second=await service.applyApprovedPlanExecutorDates(repeat,user,P);
  test('Reapproving with no pending edits never rewrites delivery dates',()=>assert.equal(second,0));
  repeat.assertDone();

  const legacy=scriptedSql([
    {match:"to_regclass('marketing.work_plan_executor_dates')",rows:[{has_table:true,has_applied:false,nullable_date:false}]},
    {match:'select count(*)::int as total',rows:[{total:1}]},
  ]);
  await assert.rejects(()=>service.applyApprovedPlanExecutorDates(legacy,user,P),/schema-22/);
  test('Legacy NOT NULL schema blocks approval rather than dropping a cleared date silently',()=>assert(!legacy.calls.some(c=>c.query.startsWith('update marketing.work_items'))));
  legacy.assertDone();

  const missing=scriptedSql([
    {match:"to_regclass('marketing.work_plan_executor_dates')",rows:[{has_table:true,has_applied:true,nullable_date:true}]},
    {match:'from marketing.work_plan_executor_dates where plan_id=',rows:[{id:A,item_id:B,due_on:null}]},
    {match:'from marketing.work_items i join marketing.work_tasks t',rows:[]},
  ]);
  await assert.rejects(()=>service.applyApprovedPlanExecutorDates(missing,user,P),/لم يعد موجودًا/);
  test('Missing original task aborts without marking pending dates applied',()=>assert(!missing.calls.some(c=>c.query.includes('set applied_at=now()'))));
  missing.assertDone();

  const src = (p)=>fs.readFileSync(p,'utf8');
  const workflow = src('server/marketing/workflow.ts');
  const schema = src('server/_marketing-workflow-schema.ts');
  const editor = src('src/marketing/workflow/PlanExecutorDates.tsx');
  test('Normal plan approval calls date sync inside its review transaction',()=>{
    const a=workflow.indexOf("if (action === 'approved') await applyApprovedPlanExecutorDates(");
    const b=workflow.indexOf('const status = action === \'approved\'');
    assert(a!==-1 && b>a);
  });
  test('Already approved plans use reviewer-protected explicit approval, never immediate save sync',()=>{
    assert(workflow.includes('if (!(await canReviewPlan(sql, user))) throw new Error(W.denied)'));
    assert(workflow.includes("['publishing','published'].includes(plan.review_status)"));
    assert(workflow.includes("action === 'work_approve_plan_executor_dates'"));
    assert(!src('server/marketing/plan-executor-dates.ts').includes('applyApprovedPlanExecutorDates('));
  });
  test('Database migration allows NULL task due_on and stores applied marker',()=>{
    assert(schema.includes('alter table marketing.work_items alter column due_on drop not null'));
    assert(schema.includes('add column if not exists applied_at timestamptz'));
    assert(schema.includes("hasApprovedExecutorDates: rows.some(x => x.code === 'schema-22')"));
  });
  test('UI warns about delayed sync and exposes a reviewer approval action',()=>{
    assert(editor.includes('بعد الاعتماد فقط'));
    assert(editor.includes('approve_plan_executor_dates'));
    assert(editor.includes('اعتماد تواريخ المنفذين وتحديث التاسكات'));
  });
  test('Original task edit preserves an already-cleared NULL deadline',()=>{
    assert(workflow.includes('let due: string | null = workDate(locked.due_on) || null;'));
    assert(src('src/marketing/workflow/TaskDetail.tsx').includes("useState(item.due_on || '')"));
  });
  console.log(`${checks}/${checks} approved executor-date sync checks passed`);
})().catch(error=>{console.error(error);process.exitCode=1});
