const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const root = process.cwd();
let applied = false;
let migrationRuns = 0;
let lockAvailable = true;
const log = [];
const allColumns = {
  work_plans: ['is_deleted','activated_at','activated_by','deleted_at','deleted_by'],
  work_plan_items: ['is_deleted','post_type_id','budget_amount'],
};
const sql = async (parts) => {
  const query = parts.join('?').replace(/\s+/g, ' ').trim();
  log.push(query);
  if (query.includes("to_regclass('marketing.work_tasks')")) {
    return [{tasks:true,items:true,plans:true,drafts:true,files:true}];
  }
  if (query.includes("to_regclass('marketing.work_plan_unique_entry')")) {
    return [{plans:true,lines:true,migrations:true,unique_index:applied}];
  }
  if (query.includes('information_schema.columns')) {
    const columns = applied ? allColumns : {
      work_plans: ['id','plan_no','kind','name'],
      work_plan_items: ['id','plan_id','product_id','scheduled_on','caption','hashtags'],
    };
    return Object.entries(columns).flatMap(([table_name, fields]) =>
      fields.map(column_name => ({table_name,column_name})));
  }
  if (query.includes("where code='schema-4'")) return applied ? [{code:'schema-4'}] : [];
  throw new Error('Unexpected SQL in schema test: ' + query);
};
const load = createLoader(root, {
  './_db.js': {
    getSql: () => sql,
    runSqlScript: async script => {
      assert(script.includes('alter table marketing.work_plan_items add column if not exists post_type_id'));
      assert(!/drop table|truncate table/i.test(script));
      applied = true; migrationRuns += 1;
    },
    tryWithDatabaseAdvisoryLock: async (key, run) => {
      assert.equal(key,'mzj:marketing:schema-setup');
      if (!lockAvailable) return {acquired:false};
      return {acquired:true,result:await run()};
    },
  },
});
const schema = load('server/_marketing-workflow-schema.ts');
(async () => {
  const before = await schema.marketingPlanScheduleSchemaStatus(sql);
  assert.equal(before.baseReady, true);
  assert.equal(before.ready, false);
  assert(before.missing.includes('work_plan_items.post_type_id'));
  assert(before.missing.includes('schema-4'));
  assert.equal(migrationRuns,0);
  await assert.rejects(
    () => schema.assertMarketingWorkflowReady(sql),
    error => error.code === 'MARKETING_SCHEMA_UPGRADE_REQUIRED' && !String(error.message).includes('column l.post_type_id'),
  );
  assert.equal(migrationRuns,0,'ordinary reads must never run migration SQL');
  lockAvailable = false;
  await assert.rejects(() => schema.upgradeMarketingPlanScheduleSchema(),error => error.code === 'MARKETING_MIGRATION_BUSY');
  assert.equal(migrationRuns,0);
  lockAvailable = true;
  const upgraded = await schema.upgradeMarketingPlanScheduleSchema();
  assert.equal(upgraded.ready,true);
  assert.equal(upgraded.alreadyApplied,false);
  assert.equal(migrationRuns,1);
  const after = await schema.marketingPlanScheduleSchemaStatus(sql);
  assert.equal(after.ready,true);
  await schema.assertMarketingWorkflowReady(sql);
  const repeat = await schema.upgradeMarketingPlanScheduleSchema();
  assert.equal(repeat.alreadyApplied,true);
  assert.equal(migrationRuns,1,'migration must be idempotent');
  const workflow = fs.readFileSync(path.join(root,'server/marketing/workflow.ts'),'utf8');
  const perms = fs.readFileSync(path.join(root,'server/_api-permissions.ts'),'utf8');
  assert(workflow.includes("requirePermission(user, 'platform.superadmin')"));
  assert(perms.includes('work_upgrade_schema: "platform.superadmin"'));
  const dashboard = fs.readFileSync(path.join(root,'src/marketing/pages/MarketingDashboardPage.tsx'),'utf8');
  assert(dashboard.includes("useWorkQuery<{ ready: boolean; baseReady: boolean; canUpgrade: boolean }>('schema_status')"));
  assert(dashboard.includes("workPost('upgrade_schema', {})"));
  assert(dashboard.includes('await query.reload()'));
  console.log('PASS: missing post_type_id detected before list queries');
  console.log('PASS: dashboard reads never run DDL');
  console.log('PASS: busy concurrent migrations return retryable error');
  console.log('PASS: controlled additive upgrade succeeds and is idempotent');
  console.log('PASS: upgrade action requires platform superadmin');
  console.log('PASS: dashboard shows one-click upgrade and reloads data');
})().catch(error => { console.error(error); process.exitCode = 1; });
