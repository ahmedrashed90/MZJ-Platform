'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = (() => { try { return require('typescript'); } catch { return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); } })();
const root = path.join(__dirname, '..');
function read(p) { return fs.readFileSync(path.join(root, p), 'utf8'); }
function load(p, deps={}) {
  const compiled = ts.transpileModule(read(p), { fileName:p, compilerOptions: { module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.ReactJSX }, reportDiagnostics:true });
  assert.equal((compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,`Syntax: ${p}`);
  const mod={exports:{}};
  vm.runInNewContext(compiled.outputText,{module:mod,exports:mod.exports,require(name){if(name in deps) return deps[name]; throw new Error(`Unmocked import ${name}`);},Map,Set,Date,String,Number,Array,console},{filename:p});
  return mod.exports;
}
let passed=0;
function check(message, fn){fn();passed++;console.log('PASS:',message);}
const helper=load('shared/marketing-plan-calendar.ts');
const row=(plan_id,kind,scheduled_on,from=null,to=null)=>({plan_id,plan_no:kind==='campaign'?'CMP-000001':'AGD-000002',name:kind==='campaign'?'حملة تعريفية':'أجندة الأسبوع',kind,review_status:'revision',creator_name:'موظف التسويق',scheduled_on,funding_from:from,funding_to:to});
function eventRows(rows, from='2026-11-01', to='2026-11-30'){return helper.buildCalendarPlanEvents(rows,from,to).map(e=>({day:e.event_on,type:e.event_type,id:e.plan_id}));}
check('Campaign funding start/end appear exactly twice, never on intermediate days',()=>{
  const got=eventRows([row('c1','campaign','2026-11-04','2026-11-02','2026-11-06')]);
  assert.deepEqual(Array.from(got.map(e=>e.day)),['2026-11-02','2026-11-06']);
  assert.deepEqual(Array.from(got.map(e=>e.type)),['funding_start','funding_end']);
});
check('Campaign on same-day funding start/end produces one combined event',()=>{
  assert.deepEqual(Array.from(eventRows([row('same','campaign','2026-11-01','2026-11-04','2026-11-04')]).map(e=>e.type)),['funding_both']);
});
check('Historical campaign without end date displays start only',()=>{
  const got=eventRows([row('legacy','campaign','2026-11-03',null,null)]);
  assert.equal(got.length,1);assert.equal(got[0].day,'2026-11-03');
});
check('Campaign with end this month and start last month shows only the end',()=>{
  const got=eventRows([row('long','campaign','2026-10-22','2026-10-29','2026-11-08')]);
  assert.equal(got.length,1);assert.equal(got[0].type,'funding_end');
});
check('Campaign with start this month and end next month shows only the start',()=>{
  const got=eventRows([row('next','campaign','2026-12-02','2026-11-29','2026-12-04')]);
  assert.equal(got.length,1);assert.equal(got[0].type,'funding_start');
});
check('Campaign completely spanning the month creates no every-day reminders',()=>{
  assert.equal(eventRows([row('outside','campaign','2026-11-04','2026-10-21','2026-12-02')]).length,0);
});
check('Agenda appears on each distinct scheduled date, not every day between',()=>{
  const got=eventRows([row('a1','agenda','2026-11-03'),row('a1','agenda','2026-11-03'),row('a1','agenda','2026-11-09')]);
  assert.deepEqual(Array.from(got.map(e=>e.day)),['2026-11-03','2026-11-09']);
  assert.ok(got.every(e=>e.type==='agenda_publish'));
});
check('Multiple platform/post rows do not repeat campaign or agenda cards',()=>{
  const got=eventRows([row('c1','campaign','2026-11-04','2026-11-02','2026-11-06'),row('c1','campaign','2026-11-04','2026-11-02','2026-11-06'),row('a1','agenda','2026-11-02'),row('a1','agenda','2026-11-02')]);
  assert.equal(got.length,3);
});
check('Malformed historical date is ignored rather than poisoning the calendar',()=>{
  assert.equal(eventRows([row('bad','campaign','not-a-date', '2026-99-07',null)]).length,0);
});
check('Month boundaries use inclusive local dates, preserving Gregorian day',()=>{
  const got=eventRows([row('c','campaign','2026-11-01','2026-11-01','2026-11-30')]);
  assert.deepEqual(Array.from(got.map(e=>e.day)),['2026-11-01','2026-11-30']);
});
const server=read('server/marketing/workflow.ts'),detail=read('src/marketing/workflow/PlanDetail.tsx'),calendar=read('src/marketing/pages/ReceiptCalendarPage.tsx');
check('Calendar enforces plan-line ownership and excludes deleted campaigns and tasks',()=>{
  const body=server.split('async function planCalendarEvents')[1].split('async function calendar(')[0];
  assert.match(body,/marketing\.work_plan_items l/);
  assert.match(body,/p\.created_by=\$\{user\.id\}/);
  assert.match(body,/i\.assigned_to=\$\{user\.id\}/);
  assert.match(body,/d\.code=any\(\$\{scopes\}/);
  assert.match(body,/p\.is_deleted=false/);
  assert.match(body,/t\.is_deleted=false/);
  assert.match(body,/camp\.is_deleted=false/);
  assert.match(body,/l\.scheduled_on between \$\{from\}::date and \$\{to\}::date/);
});
check('Campaign/agenda milestones are returned even on dates without any task delivery',()=>{
  assert.match(server,/if \(!taskIds\.length\) return \{ ok: true, rows, ratingSummaries: \{\}, planEvents \}/);
  assert.match(server,/ratingSummaries, planEvents \}/);
});
check('Review funding is optional and updated atomically with the request and audit',()=>{
  const body=server.split('async function changePlanReview')[1].split('async function updatePlanRows')[0];
  assert.match(body,/updateFunding = action === 'revision' && body\.updateFunding === true/);
  assert.match(body,/if \(updateFunding && plan\.kind !== 'campaign'\)/);
  const persist=body.indexOf('await persistPlanFundingWindow');
  const update=body.indexOf('update marketing.work_plans');
  const audit=body.indexOf('insert into marketing.work_plan_reviews');
  assert.ok(persist>0 && persist<update && update<audit, 'Funding, review state and audit run inside the same transaction');
  assert.match(body,/فترة التمويل: من \$\{fundingFrom\} إلى \$\{fundingTo \|\| 'غير محدد'\}/);
  assert.match(server,/payload=case when \$\{fundingTo\}='' then/);
});
check('Reviewer sees optional funding dates and can submit both with revision note',()=>{
  assert.match(detail,/مراجعة فترة التمويل مع طلب التعديل/);
  assert.match(detail,/تأكيد طلب التعديل/);
  assert.match(detail,/updateFunding: changeFunding/);
  assert.match(detail,/changeFunding \? \{ fundingFrom, fundingTo \} : \{\}/);
  assert.match(detail,/setFundingOnReview\(true\)/);
  assert.match(detail,/setFundingOnReview\(false\)/);
});
check('Calendar has campaign/agenda names in date cell, detail list and drilldown',()=>{
  assert.match(calendar,/mkw-calendar-plan-hint/);
  assert.match(calendar,/مواعيد الحملات والأجندات/);
  assert.match(calendar,/بداية التمويل/);
  assert.match(calendar,/نهاية التمويل/);
  assert.match(calendar,/تاريخ نشر الأجندة/);
  assert.match(calendar,/onClick=\{\(\) => setOpenedPlan\(event\.plan_id\)\}/);
  assert.match(calendar,/<PlanDetail id=\{openedPlan\}/);
});
const script=read('package.json');
check('Regression checks are wired into the normal build without moving Owners checks',()=>{
  assert.match(script,/check-owners-community-v1200\.mjs/);
  assert.match(script,/test-marketing-plan-review-calendar-20261102\.cjs/);
});
console.log(`${passed}/${passed} campaign revision and calendar milestone checks passed`);
