const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = file => fs.readFileSync(file,'utf8');
const dashboard=read('src/marketing/pages/MarketingDashboardPage.tsx');
const settings=read('src/marketing/components/MarketingSettingsPanel.tsx');
const database=read('src/marketing/pages/MarketingDatabasePage.tsx');
const server=read('server/marketing/workflow.ts');
const schema=read('server/_marketing-workflow-schema.ts');
const legacy=read('server/marketing/index.ts');
const css=read('src/marketing/workflow/workflow.css');
const tests=[
  ['dashboard has a progress bar labeled publishing readiness',()=>{assert.match(dashboard,/<Readiness value=\{readiness\} label="جاهزية النشر"\/>/);assert.match(css,/mkw-publish-readiness progress/)}],
  ['plan state badges and cards receive status classes',()=>{assert.match(dashboard,/mkw-plan-state-\$\{/);for(const s of ['revision','submitted','in_progress','publishing','published'])assert.match(css,new RegExp('mkw-plan-state-'+s))}],
  ['publish button hidden when settings are off',()=>assert.match(dashboard,/publishSettings\.data\?\.enabled && <button type="button" className="primary"/)],
  ['existing publish implementation is gated server-side',()=>{assert.match(server,/if \(!settings\.enabled\) throw new Error/);assert.match(server,/activateWorkflowPlan\(sql, user, body, services\)/)}],
  ['marketing settings provide a persistent off-by-default toggle',()=>{assert.match(settings,/save_publish_button_settings/);assert.match(settings,/tab === "publishing"/);assert.match(schema,/dashboard_publish_enabled boolean not null default false/)}],
  ['settings are protected by marketing-admin permissions',()=>{assert.match(server,/function canManagePublishControls/);assert.match(server,/settings\.marketing\.manage/);assert.match(server,/typeof body\.enabled !== 'boolean'/)}],
  ['schema migration is additive and separately controlled',()=>{assert.match(schema,/MARKETING_WORKFLOW_PUBLISH_CONTROL_SQL/);assert.match(schema,/schema-13/);assert.match(schema,/if \(!\(await flags\(\)\)\.hasPublishControl\) await runSqlScript/)}],
  ['database shows delete for agendas and campaigns only to permitted users',()=>{assert.match(database,/row\.kind === 'agenda' && canDeleteAgenda/);assert.match(database,/row\.kind === 'campaign' && canDeleteCampaign/);assert.match(database,/mkw-confirm-delete/)}],
  ['server deletes only plan rows and never the source product',()=>{const body=server.slice(server.indexOf('async function deleteWorkflowPlan'),server.indexOf('async function planDetails'));assert.match(body,/delete from marketing\.work_plan_reviews/);assert.match(body,/delete from marketing\.work_plan_items/);assert.match(body,/delete from marketing\.work_plans/);assert.doesNotMatch(body,/delete from marketing\.work_items/)}],
  ['provider records are retained and in-flight operations cannot be deleted',()=>{const body=server.slice(server.indexOf('async function deleteWorkflowPlan'),server.indexOf('async function planDetails'));assert.match(body,/s\.status in \('processing','verification_required'\)/);assert.match(body,/if \(hasTargets \|\| hasAdapterReferences\)/);assert.match(body,/s\.status in \('waiting','failed'\)/)}],
  ['legacy agenda deletion avoids cascading task removal',()=>{const body=legacy.slice(legacy.indexOf('async function deleteEntity('),legacy.indexOf('async function monitoring('));assert.match(body,/if\(linked\)/);assert.match(body,/update marketing\.agendas set status='archived'/);assert.match(body,/delete from marketing\.agendas/)}],
];
let failures=0;for(const [name,fn] of tests){try{fn();console.log('PASS '+name)}catch(e){failures++;console.error('FAIL '+name,e.message)}}
console.log(`${tests.length-failures}/${tests.length} marketing publish-control checks passed`);process.exitCode=failures?1:0;
