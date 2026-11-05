'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.join(__dirname, '..');
function file(p) { return fs.readFileSync(path.join(root, p), 'utf8'); }
let passed = 0;
function check(title, f) { f(); console.log('PASS:', title); passed++; }
function sourceModule(p) {
  const compiled = ts.transpileModule(file(p), { fileName: p,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, reportDiagnostics: true });
  assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const exports = {}, module = { exports };
  const stub = (name) => name === './api' ? { showDate: String } : name === './CampaignGoals' ? { CampaignGoalsTable: () => null } : name === 'react/jsx-runtime'
    ? { jsx: () => null, jsxs: () => null } : (() => { throw new Error(`Unexpected runtime import ${name}`); })();
  vm.runInNewContext(compiled.outputText, { require: stub, module, exports, Number, String, Map, Set }, { filename: p });
  return module.exports;
}
const { campaignContentSummary, campaignLinesByPlatform } = sourceModule('src/marketing/workflow/campaignOverview.tsx');
const lines = [
  { id:'1',product_id:'image',idea_name:'صورة تعريفية',product_idea:'هوية العلامة',platform_name:'انستجرام',platform_code:'instagram',post_type_name:'بوست صور',scheduled_on:'2026-11-02',budget_amount:100 },
  { id:'2',product_id:'image',idea_name:'صورة تعريفية',product_idea:'هوية العلامة',platform_name:'انستجرام',platform_code:'instagram',post_type_name:'ستوري',scheduled_on:'2026-11-01',budget_amount:50 },
  { id:'3',product_id:'video',idea_name:'فيديو تعريف',product_idea:'قصة الهوية',platform_name:'تيك توك',platform_code:'tiktok',post_type_name:'ريل',scheduled_on:'2026-11-01',budget_amount:75 },
  { id:'4',product_id:'image',idea_name:'صورة تعريفية',product_idea:'هوية العلامة',platform_name:'تيك توك',platform_code:'tiktok',post_type_name:'صور',scheduled_on:'2026-11-01',budget_amount:25 },
];
check('Budget totals every post type without duplication', () => {
  const s=campaignContentSummary(lines);
  assert.equal(s.total, 250); assert.equal(s.products.length, 2); assert.equal(s.ideas.length, 2);
  assert.equal(s.platforms.find(p=>p.platform==='انستجرام').budget,150);
  assert.equal(s.platforms.find(p=>p.platform==='تيك توك').budget,100);
});
check('All posts are grouped contiguously by platform without changing input', () => {
  const sorted=campaignLinesByPlatform(lines);
  assert.equal(sorted.length,4);
  assert.notEqual(sorted[0], undefined);
  assert.equal(new Set(sorted.map(row=>row.platform_name)).size,2);
  assert.ok(sorted[0].platform_name===sorted[1].platform_name);
  assert.ok(sorted[2].platform_name===sorted[3].platform_name);
  assert.equal(lines[0].id,'1');
});
const backend=file('server/marketing/workflow.ts'), composer=file('src/marketing/workflow/CreatePage.tsx'),
  detail=file('src/marketing/workflow/PlanDetail.tsx'), calendar=file('src/marketing/pages/ReceiptCalendarPage.tsx'),
  report=file('src/marketing/workflow/PlanReport.tsx'), dashboard=file('src/marketing/pages/MarketingDashboardPage.tsx');
check('Campaign stores funding window in existing native payload and reads the same fields', () => {
  assert.match(backend, /workflowPlanId: planId,\s*\.\.\.\(kind === 'campaign' \? \{ platformGoals, \.\.\.\(hasFundingPeriod \? \{ fundingFrom, fundingTo \}/);
  assert.match(backend, /camp\.payload->>'fundingFrom'/);
  assert.match(backend, /camp\.payload->>'fundingTo'/);
  assert.match(backend, /funding_to: plan\.funding_to \|\| null/);
});
check('New campaigns require both dates; creator can edit legacy missing end and resubmit after a revision', () => {
  assert.match(composer, /fundingFrom > fundingTo/);
  assert.match(detail, /update_plan_funding/);
  assert.match(backend, /async function updatePlanFunding/);
  const body=backend.split('async function updatePlanFunding')[1].split('async function createPlan')[0];
  assert.match(body, /plan.created_by !== user.id/);
  assert.match(body, /review_status='submitted'/);
  assert.match(body, /plan.review_status === 'revision'/);
  assert.match(body, /persistPlanFundingWindow/);
  assert.match(backend, /async function persistPlanFundingWindow/);
  assert.match(backend, /jsonb_set\(coalesce\(payload/);
  assert.match(backend, /- 'fundingTo'/);
});
check('Per-requirement explanation is stored and read separately from idea', () => {
  assert.match(composer, /idea: item\.idea, explanation: item\.explanation/);
  assert.match(backend, /h\.data->>'explanation'/);
  assert.match(backend, /explanation: text\(input\.explanation, 20000\)/);
  assert.match(file('src/marketing/workflow/TaskDetail.tsx'), /شرح الفكرة أو المطلوب/);
});
check('Calendar evaluations start collapsed and show stored percentage with stars', () => {
  assert.match(calendar, /<details className=\"mkw-panel mkw-calendar-ratings-panel\"/);
  assert.match(calendar, /<details>\s*<summary>المطلوبات/);
  assert.match(calendar, /RatingStars percentage=\{evaluation\.percentage\}/);
  assert.match(file('src/marketing/workflow/workflow.css'), /mkw-calendar-ratings-panel:not\(\[open\]\)>\.mkw-calendar-rating-summary\{display:none\}/);
  assert.match(backend, /rating\.percentage::float8/);
});
check('Report retains platform grouping, while preparation is sorted by publication date', () => {
  assert.match(report, /CampaignOverview lines=\{lines\}/);
  assert.match(report, /campaignLinesByPlatform\(lines\)/);
  assert.match(dashboard, /CampaignOverview lines=\{chooserSourceLines\}/);
  assert.match(dashboard, /chooserLines = preparationLinesByDate\(chooserSourceLines\)/);
  assert.match(dashboard, /chooserLines\.map\(\(line, index\)/);
  assert.match(dashboard, /group\[0\]\?\.kind === 'campaign' \|\| group\.length > 1/);
  const { preparationLinesByDate } = sourceModule('src/marketing/workflow/campaignOverview.tsx');
  const prepared = preparationLinesByDate(lines);
  assert.deepEqual(Array.from(prepared, row => row.scheduled_on), [
    '2026-11-01', '2026-11-01', '2026-11-01', '2026-11-02'
  ]);
  assert.equal(lines[0].scheduled_on, '2026-11-02', 'sorting must not mutate source rows');
});
console.log(`${passed}/${passed} campaign funding, overview, explanation and rating checks passed`);
