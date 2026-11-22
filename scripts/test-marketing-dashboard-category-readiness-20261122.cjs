'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const load = createLoader(process.cwd(), {
  'react/jsx-runtime': { jsx: (type, props) => ({type,props}), jsxs: (type, props) => ({type,props}) },
  './api': {showDate: value => String(value || '—').slice(0,10)},
});
const { executionDashboardTasks, publishingDashboardEntries } = load('src/marketing/workflow/publishingPriority.ts');
const { groupStrategyDraftIdeas } = load('src/marketing/workflow/strategyDraftGrouping.ts');
const { planPdfScheduleRows, planPdfSummaryHtml } = load('src/marketing/workflow/campaignPdfExport.ts');
let passed = 0;
function check(title, fn) {fn();passed++;console.log('PASS:',title);}
const task = (id, readiness, created_at = '2026-11-22') => ({id,readiness, created_at});
const line = (id, extra = {}) => ({id,product_id:id, plan_id:'p1',task_no:'TSK-000224', requirement_number:Number(id.slice(-1)),
  idea_name:'فكرة مشتركة', product_idea:'بريف إبداعي: حاسبة القسط — جرّبها قبل تتواصل السيارات المعتمدة: لا توجد سيارات محددة للفكرة',
  scheduled_on:'2026-12-01',media_kind:'video',platform_code:'instagram',platform_name:'انستجرام', assignee_name:'محمود',
  published_ready:false,review_status:'submitted', ...extra });
const draft = (id, readyCount, productCount=4, extra={}) => ({id,kind:'campaign',name:id,readyCount,productCount, status:'draft',
  configuredCount:productCount, executedCount:productCount, createdAt:'2026-11-22',...extra });

check('Execution: all 0% first, then 25/50/75%, 100% last; do not mutate backend array', () => {
  const input=[task('done',100),task('half',50),task('zero-new',0,'2026-11-23'),task('quarter',25),task('zero-old',0,'2026-11-21')];
  const snapshot=JSON.stringify(input);
  assert.deepEqual(executionDashboardTasks(input).map(task=>task.id),['zero-new','zero-old','quarter','half','done']);
  assert.equal(JSON.stringify(input),snapshot);
});
check('Publishing: 0% first even if submitted, prepared or activated; next ascending readiness', () => {
  const groups=new Map([
    ['half',[line('l1',{published_ready:true}),line('l2')]],
    ['zero',[line('l3',{prepared_count:1,activated_at:'2026-11-20',review_status:'publishing'})]],
    ['done',[line('l4',{published_ready:true,review_status:'published'})]],
  ]);
  const result=publishingDashboardEntries(groups,[draft('quarter',1),draft('ready-config-only',0),draft('full',4)]);
  assert.deepEqual(result.map(v=>v.id),['ready-config-only','zero','quarter','half','full','done']);
  assert.deepEqual(result.map(v=>v.progress),[0,0,.25,.5,1,1]);
});
check('Draft idea groups use canonical category heading and preserve titles and original identity', () => {
  const ideas=[{id:'a',category:'بيعي - قسط',ideaName:'سنة جديدة وسيارة جديدة'},
    {id:'b',category:'تعريفي - مواصفات السيارات',ideaName:'بنزين 91 ولا 95'},
    {id:'c',category:'بيعي - قسط',ideaName:'حاسبة القسط'},
    {id:'d',category:'',ideaName:'بدون تصنيف'},
    {id:'e',category:' تعريفي - مواصفات السيارات ',ideaName:'التصنيف الثاني'}];
  const snapshot=JSON.stringify(ideas);
  const groups=groupStrategyDraftIdeas(ideas);
  assert.deepEqual(groups.map(g=>g.category),['بيعي - قسط','تعريفي - مواصفات السيارات','بدون تصنيف']);
  assert.deepEqual(groups[0].entries.map(i=>i.id),['a','c']);
  assert.deepEqual(groups[1].entries.map(i=>i.ideaName),['بنزين 91 ولا 95','التصنيف الثاني']);
  assert.equal(JSON.stringify(ideas),snapshot);
});
check('Grouping a filtered subset keeps only visible ideas, no duplication', () => {
  const visible=[{id:'2',category:'بيعي - كاش',ideaName:'فكرة ب'}, {id:'5',category:'بيعي - كاش',ideaName:'فكرة هـ'}];
  assert.deepEqual(groupStrategyDraftIdeas(visible).flatMap(g=>g.entries.map(i=>i.id)),['2','5']);
  assert.deepEqual(groupStrategyDraftIdeas([]),[]);
});
check('Campaign and agenda PDF categories follow product IDs (not guessed from title)', () => {
  const lines=[line('p1',{media_kind:'video'}),line('p2',{media_kind:'video',scheduled_on:'2026-12-02'})];
  const categoryByProduct={p1:'بيعي - قسط',p2:'تعريفي - مواصفات السيارات'};
  const snapshot=JSON.stringify(lines);
  for(const kind of ['campaign','agenda']){
    const html=planPdfSummaryHtml({kind,planName:'اختبار تصنيف',planNo:'TEST',lines,categoryByProduct});
    const section=html.split('<section class="schedule-section">')[1].split('</section>')[0];
    assert.match(section,/<th>نوع المنتج<\/th><th>التصنيف<\/th><th>الفكرة<\/th>/);
    assert.match(section,/<td class="schedule-category" rowspan="1">بيعي - قسط<\/td>/);
    assert.match(section,/<td class="schedule-category" rowspan="1">تعريفي - مواصفات السيارات<\/td>/);
    assert.match(section,/حاسبة القسط — جرّبها قبل تتواصل/);
    assert.doesNotMatch(section,/بريف إبداعي:|السيارات المعتمدة/);
    assert.equal((section.match(/class="schedule-category"/g)||[]).length,2);
  }
  assert.equal(JSON.stringify(lines),snapshot);
});
check('Same title but different classification must remain separate records', () => {
  const lines=[line('p1',{platform_code:'snapchat'}),line('p2',{platform_code:'instagram'})];
  const categories={p1:'بيعي - قسط',p2:'بيعي - كاش'};
  assert.equal(planPdfScheduleRows(lines,categories).length,2);
  assert.equal(planPdfScheduleRows(lines,{p1:'بيعي - قسط',p2:'بيعي - قسط'}).length,1);
});
check('Unknown classification is — and category HTML is escaped', () => {
  const html=planPdfSummaryHtml({kind:'agenda',planName:'تصنيف',planNo:'1',lines:[line('p1'),line('p2')],
    categoryByProduct:{p1:'<script>alert(1)</script>'}});
  const schedule=html.split('<section class="schedule-section">')[1].split('</section>')[0];
  assert.match(schedule,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(schedule,/<script>/);
  assert.match(schedule,/<td class="schedule-category" rowspan="1">—<\/td>/);
});
check('Both PDF entry points use the same authoritative plan_products category map', () => {
  const report=fs.readFileSync('src/marketing/workflow/PlanReport.tsx','utf8');
  const dashboard=fs.readFileSync('src/marketing/pages/MarketingDashboardPage.tsx','utf8');
  assert.match(report,/categoryByProduct: planProductCategories\(products\.data\?\.rows\)/);
  assert.match(dashboard,/categoryByProduct: planProductCategories\(chooserProducts\.data\?\.rows\)/);
  assert.match(dashboard,/executionEntries\.map\(task/);
  assert.match(dashboard,/executionDashboardTasks\(tasks\)/);
});
check('Draft editor renders headings and per-idea title buttons while retaining editor controls', () => {
  const src=fs.readFileSync('src/marketing/workflow/StrategyDrafts.tsx','utf8');
  assert.match(src,/groupStrategyDraftIdeas\(visibleIdeas\)/);
  assert.match(src,/groupedIdeas\.map\(group => <section/);
  assert.match(src,/mkw-sd-idea-category-title/);
  assert.match(src,/group\.entries\.map\(idea => <button/);
  assert.match(src,/onClick=\{\(\) => selectIdea\(idea\.id\)\}/);
  assert.match(src,/saveIdea\(\)/);
  assert.match(src,/copyToIncomplete\(\)/);
});
check('Modified TypeScript and TSX modules have no parser diagnostics', () => {
  const paths=['src/marketing/workflow/publishingPriority.ts','src/marketing/workflow/campaignPdfExport.ts',
    'src/marketing/workflow/StrategyProductsTable.tsx','src/marketing/workflow/strategyDraftGrouping.ts',
    'src/marketing/workflow/StrategyDrafts.tsx','src/marketing/pages/MarketingDashboardPage.tsx',
    'src/marketing/workflow/PlanReport.tsx'];
  for(const name of paths){
    const src=ts.createSourceFile(name,fs.readFileSync(name,'utf8'),ts.ScriptTarget.Latest,true,name.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    assert.deepEqual(src.parseDiagnostics.map(x=>x.messageText),[],name);
  }
});
console.log(`${passed}/${passed} targeted readiness, category and draft grouping tests passed`);
