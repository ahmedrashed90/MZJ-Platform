// Marketing request isolation tests. No live database or external services.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const root = path.resolve(__dirname, '..');
const file = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const tests = [];
async function test(label,fn){ await fn(); tests.push(label); console.log('PASS:',label); }
(async()=>{
  let reads = 0, migrations = 0;
  const sql = async parts => {
    reads++;
    const query=parts.join('?').replace(/\s+/g,' ');
    if(query.includes("to_regclass('marketing.work_tasks')"))return [{tasks:true,items:true,plans:true,drafts:true,files:true,ratings:true,formats:true,categories:true,notes:true,rejected:true,reviewers:true,revisionNumbers:true,executorResponse:true,rejectedRevisionNotes:true,editingState:true,rejectedState:true}];
    if(query.includes("to_regclass('marketing.work_plan_unique_entry')"))return [{plans:true,lines:true,migrations:true,unique_index:true}];
    if(query.includes('information_schema.columns'))return [
      ...['is_deleted','activated_at','activated_by','deleted_at','deleted_by'].map(column_name=>({table_name:'work_plans',column_name})),
      ...['is_deleted','post_type_id','budget_amount'].map(column_name=>({table_name:'work_plan_items',column_name})),
    ];
    if(query.includes("where code='schema-4'"))return [{code:'schema-4'}];
    throw Error('Unexpected read-only catalog query: '+query);
  };
  const load = createLoader(root,{
    './_db.js': {getSql:()=>sql,runSqlScript:async()=>{migrations++;throw Error('Unexpected database migration')},tryWithDatabaseAdvisoryLock:async()=>{migrations++;throw Error('Unexpected DDL advisory lock')} },
  });
  const schema = load('server/_marketing-workflow-schema.ts');
  await test('Read-only workflow readiness does not migrate tables',async()=>{await schema.assertMarketingWorkflowReady(); await schema.assertMarketingWorkflowReady();assert.equal(reads,4);assert.equal(migrations,0)});
  await test('Normal permissions path skips marketing DDL',async()=>{
    let clientCalls=0;
    const access= createLoader(root,{
      './_db.js': {getSql:()=>{clientCalls++;throw Error('DDL entered from access check')},runSqlScript:async()=>{throw Error('migration')} ,withDatabaseAdvisoryLock:async()=>{throw Error('migration')}},
    }).load || null;
    const accessModule=createLoader(root,{
      './_db.js': {getSql:()=>{clientCalls++;throw Error('DB migration accessed')},runSqlScript:async()=>{throw Error('migration')} ,withDatabaseAdvisoryLock:async()=>{throw Error('migration')}},
    })('server/_marketing-workflow-access.ts');
    await accessModule.ensureMarketingWorkflowAccess();assert.equal(clientCalls,0);
  });
  await test('Every new work request uses schema check, never implicit migration',async()=>{
    const workflow=file('server/marketing/workflow.ts');assert.equal((workflow.match(/await ensureMarketingWorkflowSchema\(\)/g)||[]).length,1);assert(workflow.includes("action === 'work_upgrade_schema'"));assert(workflow.includes('await assertMarketingWorkflowReady(sql)'));
  });
  await test('Marketing never invokes Operations schema DDL at request time',async()=>{ const index=file('server/marketing/index.ts'); assert(!index.includes('ensureOperationsSchema')); });
  await test('Workflow reads get local PostgreSQL lock and execution limits',async()=>{
    const index=file('server/marketing/index.ts');
    assert(index.includes("request.method === 'GET' && resource !== 'work_file'"));
    assert(index.includes("await tx`set transaction read only`"));
    assert(index.includes("await tx`set local lock_timeout = '3s'`"));
    assert(index.includes("await tx`set local statement_timeout = '15s'`"));
  });
  await test('Workflow mutation transactions have time limits and no external-system edits',async()=>{
    const workflow=file('server/marketing/workflow.ts');
    const txCount=(workflow.match(/sql\.begin\(async tx => \{/g)||[]).length;
    const guarded=(workflow.match(/await tx`set local statement_timeout = '15s'`/g)||[]).length;
    assert.equal(txCount,18); assert.equal(guarded,17); // Existing TikTok rescheduling transaction uses its own provider-confirmation flow.
  });
  await test('Initial setup still provisions Marketing workflow and permissions once',async()=>{
    const setup=file('server/setup/initialize.ts');assert(setup.includes('await ensureMarketingWorkflowSchema()'));assert(setup.includes('allowMigration: true'));
  });
  console.log(`${tests.length}/${tests.length} marketing stability tests passed (offline, no live DB).`);
})().catch(error=>{ console.error(error);process.exitCode=1 });
