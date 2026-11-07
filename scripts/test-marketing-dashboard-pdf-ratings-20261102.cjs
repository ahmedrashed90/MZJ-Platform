'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const read = name => fs.readFileSync(name, 'utf8');
const load = createLoader(process.cwd(), {
  'react/jsx-runtime': { jsx: (type, props) => ({type, props}), jsxs: (type, props) => ({type, props}) },
  './api': { showDate: date => String(date || '—').slice(0, 10) },
});
const { planPdfSummaryHtml, inclusivePlanDays, campaignPdfSummaryHtml, exportPlanSummaryPdf } = load('src/marketing/workflow/campaignPdfExport.ts');
let passed = 0;
function check(message, fn) { fn(); passed++; console.log('PASS:', message); }
const lines = [
  { id:'1', platform_code:'instagram', platform_name:'انستجرام', idea_name:'تعريف بالبراند', media_kind:'image', product_idea:'فكرة الصورة', budget_amount:100, scheduled_on:'2026-11-03', published_ready:true },
  { id:'2', platform_code:'instagram', platform_name:'انستجرام', idea_name:'تعريف بالبراند', media_kind:'image', product_idea:'فكرة الصورة', budget_amount:0, scheduled_on:'2026-11-03', published_ready:false },
  { id:'3', platform_code:'tiktok', platform_name:'تيك توك', idea_name:'تعريف بالبراند', media_kind:'video', product_idea:'فكرة الفيديو', budget_amount:50, scheduled_on:'2026-11-05', published_ready:false },
];
check('Dates include both funding start and end', () => {
  assert.equal(inclusivePlanDays('2026-11-02', '2026-11-03'), 2);
  assert.equal(inclusivePlanDays('2026-11-02', '2026-11-02'), 1);
  assert.equal(inclusivePlanDays('2026-11-03', '2026-11-02'), null);
  assert.equal(inclusivePlanDays('2026-11-03', null), null);
});
const base = { planName:'تعريف بالبراند', planNo:'CMP-001', creatorName:'منشئ تجريبي', createdAt:'2026-11-02',
  fundingFrom:'2026-11-02', fundingTo:'2026-11-05', publishState:'جاري النشر',
  approvedByName:'المراجع', approvedAt:'2026-11-02T15:30:00.000Z', lines };
const campaign = campaignPdfSummaryHtml(base);
check('Campaign PDF has creator alongside creation date, published count alongside approver and timestamp', () => {
  assert.match(campaign, /تاريخ الإنشاء/); assert.match(campaign, /منشئ الحملة/);
  assert.match(campaign, /تم نشره/); assert.match(campaign, /المراجع/);
  assert.match(campaign, /الاعتماد — المستخدم والتاريخ والساعة/);
  assert.match(campaign, /تاريخ التمويل من/); assert.match(campaign, /تاريخ التمويل إلى/);
  assert.match(campaign, /المدة/); assert.match(campaign, /4 يوم/);
  assert.match(campaign, /إجمالي ميزانية الحملة/);
});
check('Campaign PDF does not duplicate creative or expose post details', () => {
  assert.match(campaign, /المطلوبات المختلفة \(1\)/);
  assert.match(campaign, /الأفكار المختلفة \(2\)/);
  assert.doesNotMatch(campaign, /تفاصيل النشر حسب المنصة/);
});
const agenda = planPdfSummaryHtml({...base, kind:'agenda', planNo:'AGD-001', agendaFrom:'2026-11-02', agendaTo:'2026-11-04',
  platforms:[{name:'انستجرام'}, {name:'تيك توك'}, {name:'سناب شات'}, {name:'فيس بوك'}, {name:'يوتيوب'}] });
check('Agenda PDF includes every configured platform including zero-post ones', () => {
  for (const name of ['انستجرام','تيك توك','سناب شات','فيس بوك','يوتيوب']) assert(agenda.includes(name));
  assert.match(agenda, /سناب شات<\/td><td>0<\/td>/);
  assert.match(agenda, /يوتيوب<\/td><td>0<\/td>/);
  assert.match(agenda, /انستجرام<\/td><td>2<\/td>/);
});
check('Agenda PDF includes periods, unique media requirements, ideas, and approval audit', () => {
  assert.match(agenda, /منشئ الأجندة/);
  assert.match(agenda, /تاريخ نشر الأجندة من/);
  assert.match(agenda, /تاريخ نشر الأجندة إلى/);
  assert.match(agenda, /3 يوم/);
  assert.match(agenda, /المطلوبات المختلفة \(2\)/);
  assert.match(agenda, /صورة — تعريف بالبراند/);
  assert.match(agenda, /فيديو — تعريف بالبراند/);
  assert.match(agenda, /الأفكار المختلفة \(2\)/);
  assert.match(agenda, /المراجع/);
  assert.doesNotMatch(agenda, /الكابشن|الهاشتاج|تفاصيل النشر حسب المنصة/);
});
check('Unknown approval metadata cannot be faked', () => {
  const html = campaignPdfSummaryHtml({...base, approvedByName:'', approvedAt:null, fundingTo:null});
  assert.match(html, /لم يتم الاعتماد بعد/);
  assert.match(html, /غير محددة/);
});
check('Native print export opens on actual click', () => {
  let html = '';let count=0;
  global.window={open:()=>({document:{open(){},write:content=>html=content,close(){}},focus(){},setTimeout:fn=>fn(),print(){count++}})};
  exportPlanSummaryPdf({...base,kind:'agenda',platforms:[{name:'سناب شات'}]});
  assert.equal(count,1);assert.match(html, /منشئ الأجندة/);
});
check('Report PDF button is offered to campaign and agenda, detail table stays intact', () => {
  const report=read('src/marketing/workflow/PlanReport.tsx');
  assert.match(report,/تصدير PDF — ملخص الأجندة/);
  assert.match(report,/تصدير PDF — ملخص الحملة/);
  assert.match(report, /displayLines.map\(\(line, index\)/);
  assert.match(report,/exportPlanSummaryPdf/);
});
check('Production query returns approver and complete platform catalog', () => {
  const server=read('server/marketing/workflow.ts');
  assert.match(server,/approval.actor_name as approved_by_name/);
  assert.match(server,/r.action='approved'/);
  assert.match(server,/select name,code from marketing.platforms order by name/);
});
check('Manual links are authoritative; captions and hashtags are optional in preparation', () => {
  const client=read('src/marketing/workflow/PublishPage.tsx');
  const server=read('server/marketing/workflow.ts');
  assert.doesNotMatch(client,/احفظ الكابشن والهاشتاج أولًا، ثم احفظ رابط المنشور/);
  assert.doesNotMatch(client,/<textarea required value=\{caption\}/);
  assert.doesNotMatch(client,/<textarea required value=\{hashtags\}/);
  assert.doesNotMatch(server,/if \(!caption \|\| !hashtags\) throw new Error\(W.requiredFields\)/);
  assert.match(server,/if \(!text\(schedule.caption\) \|\| !text\(schedule.hashtags\)\) throw new Error\(W.requiredFields\)/);
  assert.match(server,/manual_published_on=\(now\(\) at time zone 'Asia\/Riyadh'\)::date/);
});
check('Ratings default to current Riyadh month; apply button uses brand style', () => {
  const ratings=read('src/marketing/pages/MarketingRatingsPage.tsx');
  assert.match(ratings,/dateKey\(new Date\(\)\)\.slice\(0,7\)/);
  assert.match(ratings,/setMonth\] = useState\(\(\) => dateKey\(new Date\(\)\)\.slice\(5,7\)\)/);
  assert.match(ratings,/mkw-ratings-apply-button/);
  assert.match(read('src/marketing/marketing.css'),/#4a211c/);
});
check('Dashboard cards use consistent compact frame and separated tones', () => {
  const css=read('src/marketing/workflow/workflow.css');
  assert.match(css,/\.mkw-dashboard \.mkw-dashboard-task,\s*\.mkw-dashboard \.mkw-dashboard-publish-card/);
  assert.match(css,/nth-of-type\(6n \+ 2\)/);
  assert.match(css,/min-height:285px/);
});
for(const path of ['src/marketing/workflow/campaignPdfExport.ts','src/marketing/workflow/PlanReport.tsx','src/marketing/pages/MarketingDashboardPage.tsx','src/marketing/pages/MarketingRatingsPage.tsx','src/marketing/workflow/PublishPage.tsx','server/marketing/workflow.ts','shared/marketing-workflow.ts']){
  const source=ts.createSourceFile(path,read(path),ts.ScriptTarget.Latest,true,path.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  assert.equal(source.parseDiagnostics.length,0,path+' syntax errors');
}
check('All modified TS and TSX sources parse cleanly',()=>{});
console.log(`Marketing dashboard, PDF, ratings and manual publication: ${passed}/${passed} passed`);
