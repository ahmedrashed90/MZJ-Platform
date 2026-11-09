'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const load = createLoader(process.cwd(), {
  'react/jsx-runtime': { jsx: (type, props) => ({type,props}), jsxs: (type, props) => ({type,props}) },
  './api': { showDate: value => value ? String(value).slice(0, 10) : '—' },
});
const { planPdfScheduleRows, planPdfSummaryHtml, exportPlanSummaryPdf } = load('src/marketing/workflow/campaignPdfExport.ts');
const server = fs.readFileSync('server/operations/index.ts','utf8');
const stockPage = fs.readFileSync('src/operations/pages/InventoryPage.tsx','utf8');
const dashboard = fs.readFileSync('src/marketing/pages/MarketingDashboardPage.tsx','utf8');
const report = fs.readFileSync('src/marketing/workflow/PlanReport.tsx','utf8');
let count = 0;
function check(label, task) { task(); console.log('PASS:',label); count++; }
const sample = [
  { id:'1', product_id:'p1', idea_name:'  إعلان تمويل — سوناتا  ', product_idea:'فكرة تمويل السيارة', platform_code:'instagram', platform_name:'انستجرام', assignee_name:'محمود', scheduled_on:'2026-11-08', budget_amount:100 },
  { id:'2', product_id:'p1', idea_name:'إعلان تمويل - سوناتا', product_idea:'  فكرة  تمويل السيارة  ', platform_code:'tiktok', platform_name:'تيك توك', assignee_name:'بلال', scheduled_on:'2026-11-09', budget_amount:50 },
  { id:'3', product_id:'p1', idea_name:'إعلان تمويل - سوناتا', product_idea:'فكرة تمويل السيارة', platform_code:'instagram', platform_name:'انستجرام', assignee_name:'محمود', scheduled_on:'2026-11-08', budget_amount:75 },
  { id:'4', product_id:'p2', idea_name:'إعلان تمويل - سوناتا', product_idea:'فكرة ثانية', platform_code:'snapchat', platform_name:'سناب شات', assignee_name:'عبدالله', scheduled_on:'2026-11-10', budget_amount:20 },
];
check('Inventory prioritizes tajyeer=no only for active stock, not archived/all records', () => {
  assert.match(server, /const prioritizeUntajyeer = activeOnly && boolValue\(request\.query\.inventory\);/);
  assert.match(server, /order by case when \$\{prioritizeUntajyeer\} then \(case when v\.is_tajyeer then 1 else 0 end\) else 0 end,\s*v\.updated_at desc,v\.vin\s*limit \$\{pageSize\} offset \$\{offset\}/);
  assert.equal((server.match(/const prioritizeUntajyeer/g)||[]).length,1);
});
check('Pagination and Excel use the server stock ordering (not a per-page client sort)', () => {
  assert.match(stockPage,/inventory: 1/);
  assert.match(stockPage,/pageSize: 200/);
  assert.match(stockPage,/allRows\.push\(\.\.\.payload\.rows\)/);
  assert.doesNotMatch(stockPage,/allRows\.sort\(/);
});
check('One row per normalized product + idea, never one row per platform or post type', () => {
  const rows=planPdfScheduleRows(sample);
  assert.equal(rows.length,2);
  assert.equal(rows[0].publications.length,2);
  assert.deepEqual(rows[0].publications.map(item=>[item.date,item.platform,item.executor]),[
    ['2026-11-08','انستجرام','محمود'],['2026-11-09','تيك توك','بلال']]);
  assert.equal(rows[1].idea,'فكرة ثانية');
});
check('Same product with a truly different idea stays separate; all original budget/rows survive', () => {
  const copy=structuredClone(sample);
  const before=JSON.stringify(sample);
  const rows=planPdfScheduleRows(copy);
  assert.equal(rows.length,2);
  assert.equal(JSON.stringify(sample),before);
  assert.equal(sample.reduce((acc,l)=>acc+l.budget_amount,0),245);
  assert.equal(sample.length,4);
});
check('The same platform on different days is preserved and reliably date-sorted', () => {
  const rows=planPdfScheduleRows([
    {...sample[0],id:'a',scheduled_on:'2026-11-15'},
    {...sample[0],id:'b',scheduled_on:'2026-11-02'},
  ]);
  assert.deepEqual(rows[0].publications.map(p=>p.date),['2026-11-02','2026-11-15']);
});
check('Same date/platform with distinct executors cannot merge the wrong assignee', () => {
  const rows=planPdfScheduleRows([
    {...sample[0],id:'a',assignee_name:'محمود'},
    {...sample[0],id:'b',assignee_name:'بلال'},
  ]);
  assert.equal(rows[0].publications.length,2);
  assert.deepEqual(new Set(rows[0].publications.map(row=>row.executor)),new Set(['محمود','بلال']));
});
check('Missing or impossible scheduled dates show no invented date', () => {
  const rows=planPdfScheduleRows([
    {...sample[0],id:'a',scheduled_on:'2026-02-31'},
    {...sample[0],id:'b',scheduled_on:''},
  ]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].publications.length,1);
  assert.equal(rows[0].publications[0].date,null);
});
check('PDF columns match request in exact RTL order, with a compact unique schedule', () => {
  const html=planPdfSummaryHtml({kind:'agenda',planName:'جدول نوفمبر',planNo:'AGD-1',lines:sample,agendaFrom:'2026-11-08',agendaTo:'2026-11-10'});
  assert.match(html,/<th>التاريخ<\/th><th>المنتج<\/th><th>الفكرة<\/th><th>المنفذ<\/th><th>المنصة<\/th>/);
  const section=html.split('<section class="schedule-section">')[1].split('</section>')[0];
  assert.equal((section.match(/<tr><td class="schedule-dates">/g)||[]).length,2);
  assert.equal((section.match(/<td>إعلان تمويل [—-] سوناتا<\/td>/g)||[]).length,2); // two DIFFERENT ideas
  assert.equal((section.match(/<td>فكرة تمويل السيارة<\/td>/g)||[]).length,1);
  assert.equal((section.match(/<td>فكرة ثانية<\/td>/g)||[]).length,1);
  assert.match(section,/2026-11-08/);assert.match(section,/2026-11-09/);assert.match(section,/2026-11-10/);
  assert.match(section,/محمود/);assert.match(section,/بلال/);
  assert.match(section,/انستجرام/);assert.match(section,/تيك توك/);
  assert.doesNotMatch(html,/<h2>المطلوبات المختلفة/); // obsolete repeated idea lists removed
});
check('PDF HTML escapes user-origin product, executor and idea names', () => {
  const html=planPdfSummaryHtml({kind:'campaign',planName:'البرنامج',planNo:'CMP-1',lines:[{
    ...sample[0],idea_name:'<script>alert(1)</script>', product_idea:'<img onerror=1>',assignee_name:'<b>محمود</b>'
  }]});
  assert.doesNotMatch(html,/<script>alert\(1\)<\/script>|<img onerror=1>|<b>محمود<\/b>/);
  assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);assert.match(html,/&lt;b&gt;/);
});
check('Both PDF exports include the exact same unique schedule, with unchanged campaign budget totals', () => {
  const agenda=planPdfSummaryHtml({kind:'agenda',planName:'أجندة',planNo:'AGD-1',lines:sample});
  const campaign=planPdfSummaryHtml({kind:'campaign',planName:'حملة',planNo:'CMP-1',lines:sample});
  for (const html of [agenda,campaign]) {
    assert.match(html,/جدول النشر المختصر \(2\)/);
    assert.match(html,/فكرة تمويل السيارة/);
  }
  assert.match(campaign,/245\.00 ر\.س/);
  assert.match(agenda,/إجمالي المنشورات<\/span><strong>4<\/strong>/);
});
check('Both summary actions are accessible from report AND dashboard preparation chooser', () => {
  assert.match(report,/exportCampaignSummaryPdf\(options\)/);
  assert.match(report,/exportPlanSummaryPdf\(/);
  assert.match(dashboard,/if \(chooserIsCampaign\) exportCampaignSummaryPdf\(options\)/);
  assert.match(dashboard,/else exportPlanSummaryPdf\(/);
  assert.match(dashboard,/تصدير PDF — ملخص الأجندة/);
});
check('HTML can be printed via native browser export without a new API', () => {
  let html=''; let printed=0;
  global.window={open:()=>({document:{open(){},write(value){html=value},close(){}},focus(){},setTimeout(fn){fn()},print(){printed++}})};
  exportPlanSummaryPdf({kind:'agenda',planName:'أجندة',planNo:'AGD-1',lines:sample});
  assert.equal(printed,1);assert.match(html,/جدول النشر المختصر \(2\)/);
});
check('Affected TS/TSX files parse successfully', () => {
  for(const file of ['server/operations/index.ts','src/marketing/workflow/campaignPdfExport.ts','src/marketing/pages/MarketingDashboardPage.tsx']) {
    const parse=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    assert.deepEqual(parse.parseDiagnostics.map(d=>d.messageText),[],file);
  }
});
console.log(`${count}/${count} targeted tests passed`);
