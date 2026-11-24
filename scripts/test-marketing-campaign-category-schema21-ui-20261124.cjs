'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const source=relative=>fs.readFileSync(relative,'utf8');
let checks=0;
function check(name,fn){fn();checks++;console.log('PASS:',name);}
const css=source('src/marketing/workflow/strategyDrafts.css');
const draft=source('src/marketing/workflow/StrategyDrafts.tsx');
const panel=source('src/marketing/workflow/PlanExecutorDates.tsx');
const dashboard=source('src/marketing/pages/MarketingDashboardPage.tsx');
const server=source('server/marketing/workflow.ts');
const executor=source('server/marketing/plan-executor-dates.ts');
check('Campaign category headers scroll normally instead of floating over ideas',()=>{
  const rule=css.match(/\.mkw-sd-category-heading\s*\{([^}]+)\}/);
  assert(rule); assert.match(rule[1],/position\s*:\s*static/);
  assert.doesNotMatch(rule[1],/position\s*:\s*sticky/);
});
check('Campaign categories and each individual selectable idea are preserved',()=>{
  assert(draft.includes('groupedIdeas.map(group'));
  assert(draft.includes('group.items.map(idea'));
  assert(draft.includes('onClick={() => selectIdea(idea.id)}'));
});
check('Executor panel exposes one upgrade control next to the blocking message',()=>{
  assert(panel.includes('تحديث قاعدة بيانات التسويق الآن'));
  assert(panel.includes('data?.canUpgrade'));
  assert(panel.includes("await workPost('upgrade_schema', {})"));
  assert(panel.includes('await query.reload()'));
});
check('Update request still uses the existing superadmin-protected DDL action',()=>{
  assert(server.includes("action === 'work_upgrade_schema'"));
  assert(server.includes("requirePermission(user, 'platform.superadmin')"));
  assert(executor.includes("canUpgrade: hasPermission(user, 'platform.superadmin')"));
});
check('Dashboard highlights a missing schema-21 even when original workflow is ready',()=>{
  assert(server.includes('executorDatesReady'));
  assert(dashboard.includes('schema.data?.ready && schema.data.executorDatesReady === false'));
  assert(dashboard.includes('تحديث تواريخ المنفذين والحملات'));
});
check('Plan-level clear/reset logic remains separated from the original execution task',()=>{
  assert(executor.includes('marketing.work_plan_executor_dates'));
  assert(!executor.includes('update marketing.work_items set due_on'));
});
console.log(`${checks}/${checks} campaign category and schema-21 UI tests passed`);
