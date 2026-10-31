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
    return [{tasks:true,items:true,plans:true,drafts:true,files:true,ratings:true,formats:true,categories:true,notes:true,rejected:true,reviewers:true,revisionNumbers:true,executorResponse:true,rejectedRevisionNotes:true,editingState:true,rejectedState:true}];
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
  const schemaStatusQuery = dashboard.match(/useWorkQuery<\{([^}]+)\}>\(\'schema_status\'\)/);
  assert(schemaStatusQuery, 'dashboard must query schema_status with a typed response');
  for (const field of ['ready', 'baseReady', 'performanceReady', 'canUpgrade']) {
    assert(new RegExp(`\\b${field}\\s*:`).test(schemaStatusQuery[1]), `schema_status response must include ${field}`);
  }
  assert(/publishSettingsReady\??\s*:\s*boolean/.test(schemaStatusQuery[1]), 'schema status must expose optional publish settings readiness');
  assert(/workPost(?:<[^>]+>)?\('upgrade_schema', \{\}\)/.test(dashboard));
  assert(dashboard.includes('await query.reload()'));
  console.log('PASS: missing post_type_id detected before list queries');
  console.log('PASS: dashboard reads never run DDL');
  console.log('PASS: busy concurrent migrations return retryable error');
  console.log('PASS: controlled additive upgrade succeeds and is idempotent');
  console.log('PASS: upgrade action requires platform superadmin');
  console.log('PASS: dashboard shows one-click upgrade and reloads data');

  // A production install may already contain schema-1 through schema-7.
  // The explicit admin action must apply only schema-8 and schema-9,
  // without replaying the initial bootstrap or deleting any existing task.
  async function reviewUpgradeFixture(missingReviewTables = false) {
    const appliedCodes = new Set(Array.from({length:9}, (_,i) => `schema-${i+1}`)
      .filter(code => !missingReviewTables ? !['schema-8','schema-9'].includes(code) : true));
    let reviewingReady = !missingReviewTables, terminalReady = !missingReviewTables;
    const executed = [];
    const modernSql = async (parts) => {
      const query = parts.join('?').replace(/\s+/g,' ');
      if (query.includes("to_regclass('marketing.workflow_migrations')::text as relation"))
        return [{ relation:'marketing.workflow_migrations' }];
      if (query.includes('from marketing.workflow_migrations where code in'))
        return [...appliedCodes].map(code => ({code}));
      if (query.includes("to_regclass('marketing.work_plan_unique_entry')"))
        return [{plans:true,lines:true,migrations:true,unique_index:true}];
      if (query.includes('table_name in (\'work_plans\',\'work_plan_items\')'))
        return Object.entries(allColumns).flatMap(([table_name, fields]) => fields.map(column_name => ({table_name,column_name})));
      if (query.includes("where code='schema-4'")) return [{code:'schema-4'}];
      if (query.includes("to_regclass('marketing.work_tasks')")) return [{
        tasks:true,items:true,plans:true,drafts:true,files:true,ratings:true,formats:true,categories:true,
        notes:true,rejected:true,reviewers:reviewingReady,revisionNumbers:reviewingReady,
        executorResponse:reviewingReady,rejectedRevisionNotes:reviewingReady,deadlineExceptions:reviewingReady,
        editingState:reviewingReady,rejectedState:terminalReady,
      }];
      throw new Error('Unexpected SQL in review upgrade fixture: '+query);
    };
    const fixtureLoader = createLoader(root, {
      './_db.js':{
        getSql:() => modernSql,
        runSqlScript:async script => {
          assert(!/\bdrop table\b|\btruncate table\b/i.test(script));
          const code = script.includes("values('schema-8')") ? 'schema-8'
            : script.includes("values('schema-9')") ? 'schema-9'
            : script.includes("values('schema-10')") ? 'schema-10'
            : script.includes("values('schema-11')") ? 'schema-11'
            : script.includes("values('schema-12')") ? 'schema-12'
            : script.includes("values('schema-13')") ? 'schema-13' : 'unexpected';
          assert.notEqual(code,'unexpected','Only additive workflow migrations are needed');
          executed.push(code); appliedCodes.add(code);
          if(code==='schema-8') reviewingReady=true;
          if(code==='schema-9') terminalReady=true;
          if(code==='schema-10') reviewingReady=true;
        },
        tryWithDatabaseAdvisoryLock:async(key,work) => {
          assert.equal(key,'mzj:marketing:schema-setup');
          return {acquired:true,result:await work()};
        },
      },
    });
    const loaded = fixtureLoader('server/_marketing-workflow-schema.ts');
    await loaded.ensureMarketingWorkflowSchema();
    await loaded.assertMarketingWorkflowReady(modernSql);
    await loaded.ensureMarketingWorkflowSchema();
    return executed;
  }
  assert.deepEqual(await reviewUpgradeFixture(false), ['schema-8','schema-9','schema-10','schema-11','schema-12','schema-13']);
  console.log('PASS: schema-7 to schema-13 safely upgrades once without touching old records');
  assert.deepEqual(await reviewUpgradeFixture(true), ['schema-8','schema-9','schema-10','schema-11','schema-12','schema-13']);
  console.log('PASS: present migration markers with missing review structures are repaired');
})().catch(error => { console.error(error); process.exitCode = 1; });
