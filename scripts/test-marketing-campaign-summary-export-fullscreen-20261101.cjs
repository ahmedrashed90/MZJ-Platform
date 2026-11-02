'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const root = process.cwd();
const read = path => fs.readFileSync(path, 'utf8');
const stubs = {
  'react/jsx-runtime': { jsx: (name,props) => ({name,props}), jsxs: (name,props) => ({name,props}) },
  './api': { showDate: value => value || '—' },
};
const load = createLoader(root, stubs);
const { campaignContentSummary } = load('src/marketing/workflow/campaignOverview.tsx');
const { campaignPdfSummaryHtml, exportCampaignSummaryPdf } = load('src/marketing/workflow/campaignPdfExport.ts');
let passes = 0;
function check(title, test) { test(); passes += 1; console.log('PASS:', title); }
const fixture = [];
for(let i=0;i<20;i++) {
  const group = i%5===0 ? 2 : i%5===1 ? 1 : 0;
  const platform_name = ['انستجرام','تيك توك','سناب شات'][group];
  const platform_code = ['instagram','tiktok','snapchat'][group];
  const type = i<12 ? 'صورة تعريفي - البراند' : 'فيديو تعريفي - البراند';
  fixture.push({id: `line-${i}`, product_id: `product-${i%6}`, idea_name: type,
    product_idea: i<12 ? 'إبراز التاريخ - الأقدمية' : 'إبراز صفة البراند - المصداقية',
    platform_name,platform_code,post_type_name:'بوست',budget_amount: i%5===0?188:i%5===1?125:0,
    scheduled_on:'2026-11-06',published_ready:i===0,caption:'لا يظهر في ملف الملخص',hashtags:'test-hashtag'});
}
check('Unique displayed requirements by name, not product id or scheduled post', () => {
  const summary = campaignContentSummary(fixture);
  assert.equal(summary.products.length,2); assert.equal(summary.ideas.length,2);
  assert.equal(summary.platforms.reduce((a,p)=>a+p.count,0),20);
  assert.equal(summary.platforms.reduce((a,p)=>a+p.budget,0),fixture.reduce((a,l)=>a+l.budget_amount,0));
});
check('Whitespace, dash variants and case do not create duplicate requirements', () => {
  const lines=[{...fixture[0],idea_name:'  صورة  تعريفي — البراند '}, {...fixture[1],idea_name:'صورة تعريفي - البراند'}];
  assert.equal(campaignContentSummary(lines).products.length,1);
});
check('Different ideas remain distinct even when requirement title is the same', () => {
  const summary=campaignContentSummary([
    {...fixture[0],idea_name:'صورة',product_idea:'فكرة أولى'},
    {...fixture[1],idea_name:'صورة',product_idea:'فكرة ثانية'},
  ]);
  assert.equal(summary.products.length,1); assert.equal(summary.ideas.length,2);
});
const plan={planName:'حملة البراند',planNo:'CMP-000012',creatorName:'منشئ الحملة',createdAt:'2026-11-01',
  fundingFrom:'2026-11-06',fundingTo:null,lines:fixture};
const html=campaignPdfSummaryHtml(plan);
check('Print export includes only campaign overview and one copy of each required name', () => {
  assert.match(html,/المطلوبات المختلفة \(2\)/);
  assert.match(html,/الأفكار المختلفة \(2\)/);
  assert.equal((html.match(/صورة تعريفي - البراند/g)||[]).length,1);
  assert.equal((html.match(/فيديو تعريفي - البراند/g)||[]).length,1);
  assert.match(html,/تاريخ التمويل من/);assert.match(html,/تاريخ التمويل إلى/);
  assert.match(html,/ميزانية كل منصة/);assert.match(html,/إجمالي ميزانية الحملة/);
  assert.match(html,/منشئ الحملة/);assert.match(html,/CMP-000012/);
  assert.doesNotMatch(html,/test-hashtag|لا يظهر في ملف الملخص|تفاصيل النشر حسب المنصة/);
});
check('Legacy campaigns without end date show unassigned, never invented date', () => {
  assert.match(html, /غير محدد/);assert.doesNotMatch(html, /2026-11-30/);
});
check('Dynamic content is safely HTML-escaped to prevent script injections', () => {
  const malicious=campaignPdfSummaryHtml({...plan,planName:'<script>bad()</script>',
    lines:fixture.slice(0,1).map(x=>({...x,idea_name:'<img onerror=alert(1)>'}))});
  assert.doesNotMatch(malicious,/<script>bad\(\)<\/script>/);
  assert.doesNotMatch(malicious,/<img onerror/);
  assert.match(malicious,/&lt;script&gt;/);
});
check('A real click opens printable document via native Save as PDF', () => {
  let opened='',printed=0,focused=false;
  global.window={open:()=>({document:{open(){},write:html=>{opened=html},close(){}},focus(){focused=true},setTimeout:fn=>fn(),print(){printed++}})};
  exportCampaignSummaryPdf(plan);
  assert.equal(printed,1);assert(focused);assert.match(opened,/<html lang="ar" dir="rtl">/);
});
check('Blocked popup reports a helpful error and does not claim success',()=>{
  global.window={open:()=>null};
  assert.throws(()=>exportCampaignSummaryPdf(plan),/اسمح بفتح النوافذ المنبثقة/);
});
const dashboard=read('src/marketing/pages/MarketingDashboardPage.tsx');
const report=read('src/marketing/workflow/PlanReport.tsx');
const prep=read('src/marketing/workflow/PublishPage.tsx');
check('Export button is offered both in report and campaign preparation',()=>{
  assert.match(dashboard, /exportCampaignSummaryPdf\(/);
  assert.match(report, /exportCampaignSummaryPdf\(/);
  assert.match(dashboard,/تصدير PDF — ملخص الحملة/);assert.match(report,/تصدير PDF — ملخص الحملة/);
});
check('Preparation chooser and individual post editor both display in full screen',()=>{
  assert.match(dashboard,/className="mkw-fullscreen mkw-publishing-chooser-fullscreen"/);
  assert.match(prep,/className="mkw-fullscreen mkw-preparation-fullscreen"/);
  assert.match(read('src/marketing/workflow/workflow.css'),/\.mzj-modal-card\.mkw-fullscreen/);
});
check('Campaign creator information is available on both report and preparation export',()=>{
  assert.match(read('shared/marketing-workflow.ts'),/creator_name\?: string/);
  assert.match(read('server/marketing/workflow.ts'),/coalesce\(creator.full_name,''\)/);
  // Equivalent SQL literal is empty-string; avoid matching generic alias elsewhere.
});
for(const file of ['src/marketing/workflow/campaignOverview.tsx','src/marketing/workflow/campaignPdfExport.ts',
  'src/marketing/workflow/PlanReport.tsx','src/marketing/pages/MarketingDashboardPage.tsx',
  'src/marketing/workflow/PublishPage.tsx','shared/marketing-workflow.ts','server/marketing/workflow.ts']) {
  const source=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  assert.equal(source.parseDiagnostics.length,0,file+' syntax errors');
}
console.log(`Campaign summary/PDF/fullscreen checks ${passes}/${passes} passed`);
