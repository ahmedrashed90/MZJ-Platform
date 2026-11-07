'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const read = file => fs.readFileSync(file, 'utf8');
const jsx = (type, props) => ({ type, props: props || {} });
const data = {
  plan: { id: 'agenda-1', kind: 'agenda', name: 'أجندة نوفمبر', plan_no: 'AGD-001',
    creator_name: 'منشئ الأجندة التجريبي', created_at: '2026-11-02T08:00:00Z',
    review_status: 'publishing', status: 'publishing', readiness: 25,
    agenda_from: '2026-11-02', agenda_to: '2026-11-05' },
  platforms: [
    { name: 'انستجرام', code: 'instagram' }, { name: 'تيك توك', code: 'tiktok' },
    { name: 'سناب شات', code: 'snapchat' }, { name: 'فيس بوك', code: 'facebook' },
  ],
  lines: [
    {id: '1', idea_name: 'إعلان البراند', media_kind: 'image', product_idea: 'فكرة الصورة',
      platform_name:'انستجرام', platform_code:'instagram', scheduled_on:'2026-11-02', published_ready:true, effective_post_url:'https://example.com/post'},
    {id: '2', idea_name: 'إعلان البراند', media_kind: 'image', product_idea: 'فكرة الصورة',
      platform_name:'انستجرام', platform_code:'instagram', scheduled_on:'2026-11-03', published_ready:false},
    {id: '3', idea_name: 'إعلان البراند', media_kind: 'video', product_idea: 'فكرة الفيديو',
      platform_name:'تيك توك', platform_code:'tiktok', scheduled_on:'2026-11-04', published_ready:false},
    {id: '4', idea_name: 'إعلان البراند', media_kind: 'video', product_idea: 'فكرة الفيديو',
      platform_name:'سناب شات', platform_code:'snapchat', scheduled_on:'2026-11-05', published_ready:false},
  ],
  history: [{action:'approved', actor_name:'المراجع التجريبي', created_at:'2026-11-02T15:30:00.000Z', note:'', category_name:''}],
};
const stubs = {
  react: { useState: initial => [initial, () => {}] },
  'react/jsx-runtime': {jsx, jsxs:jsx, Fragment:'Fragment'},
  '../../components/Modal': {Modal:'Modal'},
  './components': {Empty:'Empty', WorkAlert:'WorkAlert'},
  './PlanStatus': {PlanStatusBadges:'PlanStatusBadges', planDisplayState: (_status, published, total) => published === total ? 'published' : 'publishing'},
  './PlanDetail': {PublicationTiming:'PublicationTiming', planStatusName: name => ({publishing:'جاري النشر',published:'تم النشر'})[name] || name},
  './api': {showDate: value => value ? String(value).slice(0, 10) : '—', useWorkQuery: () => ({data,loading:false,error:''})},
};
const load = createLoader(process.cwd(), stubs);
const {agendaPublicationSummary} = load('src/marketing/workflow/campaignOverview.tsx');
const {planPdfSummaryHtml, agendaPublicationRange, inclusivePlanDays, planApprovalLabel} = load('src/marketing/workflow/campaignPdfExport.ts');
const {PlanReport} = load('src/marketing/workflow/PlanReport.tsx');
let checks=0;
function check(label, run) {run(); checks++; console.log('PASS:', label);}
function traverse(node, action) {
  if (Array.isArray(node)) return node.forEach(part => traverse(part, action));
  if (node == null || typeof node === 'boolean') return;
  action(node);
  if (typeof node === 'object') traverse(node.props?.children, action);
}
function getText(node) { const result=[]; traverse(node, n => {if(typeof n === 'string' || typeof n === 'number')result.push(String(n))}); return result.join(' '); }
function byClass(tree, classPart) {const result=[];traverse(tree, node => {if(node && typeof node === 'object' && String(node.props?.className || '').includes(classPart)) result.push(node)});return result;}
const view=PlanReport({id:'agenda-1',onClose:()=>{}});
const text=getText(view);
const summary=agendaPublicationSummary(data.lines,data.platforms);
const pdf=planPdfSummaryHtml({kind:'agenda', planName:data.plan.name,planNo:data.plan.plan_no,
  lines:data.lines,platforms:data.platforms,creatorName:data.plan.creator_name,createdAt:data.plan.created_at,
  agendaFrom:data.plan.agenda_from,agendaTo:data.plan.agenda_to,
  publishState:'جاري النشر',approvedByName:data.history[0].actor_name,approvedAt:data.history[0].created_at});
check('Report preserves existing creator, created date, post count, and publication labels',()=>{
  for(const label of ['منشئ الأجندة','تاريخ إنشاء الأجندة أو الحملة','عدد المنشورات','حالة النشر','المنشورات المنشورة'])
    assert(text.includes(label),label);
});
check('Report includes the PDF approval actor and local approval timestamp',()=>{
  assert(text.includes('الاعتماد — المستخدم والتاريخ والساعة'));
  const label=planApprovalLabel(data.history[0].actor_name,data.history[0].created_at);
  assert(text.includes(label)); assert(pdf.includes(label));
});
check('Report displays both publishing dates and the same inclusive duration as PDF',()=>{
  const range=agendaPublicationRange(data.lines,data.plan.agenda_from,data.plan.agenda_to);
  assert.equal(inclusivePlanDays(range.from,range.to),4);
  for(const label of ['تاريخ نشر الأجندة من','تاريخ نشر الأجندة إلى','المدة','4 يوم']) {
    assert(text.includes(label),label); assert(pdf.includes(label),label);
  }
});
check('All configured platforms appear on report and PDF, even if zero posts',()=>{
  assert.deepEqual(summary.platforms.map(({name,count})=>[name,count]),
    [['انستجرام',2],['تيك توك',1],['سناب شات',1],['فيس بوك',0]]);
  assert.equal(byClass(view, 'mkw-agenda-platform-table').length,1);
  for(const platform of summary.platforms) {
    assert(text.includes(platform.name),platform.name);assert(pdf.includes(platform.name),platform.name);
    assert(pdf.includes(`<td>${platform.name}</td><td>${platform.count}</td>`),platform.name+' PDF count');
  }
});
check('Requirement and idea summaries dedupe exactly like printable PDF',()=>{
  assert.equal(summary.requirements.length,2);assert.equal(summary.ideas.length,2);
  for(const item of [...summary.requirements,...summary.ideas]){
    assert(text.includes(item),item+' report');assert(pdf.includes(item),item+' PDF');
  }
  assert(text.includes('المطلوبات المختلفة ( 2 )'));
  assert(text.includes('الأفكار المختلفة ( 2 )'));
});
check('Agenda detail rows are ordered by publish date, then grouped by platform within each date',()=>{
  const originalLines=data.lines;
  const makeLine=(id, date, platform, type) => ({...originalLines[0], id,
    scheduled_on:date, platform_name:platform, post_type_name:type, published_ready:false,
    effective_post_url:undefined});
  // Intentionally scrambled input: the UI must not depend on database row order.
  data.lines=[
    makeLine('later','2026-11-07','انستجرام','ستوري'),
    makeLine('snap','2026-11-05','سناب شات','Story'),
    makeLine('ig-story','2026-11-05','انستجرام','ستوري'),
    makeLine('fb','2026-11-05','فيس بوك','بوست صور'),
    makeLine('ig-post','2026-11-05','انستجرام','بوست صور'),
    makeLine('early','2026-11-04','سناب شات','Story'),
    makeLine('undated','','فيس بوك','ستوري'),
  ];
  try {
    const before=data.lines.map(line=>line.id);
    const table=byClass(PlanReport({id:'agenda-unsorted',onClose:()=>{}}),'mkw-plan-report-table')[0];
    const rows=[];
    traverse(table,node=>{
      const cells=node?.type==='tr' ? node.props?.children : null;
      if(Array.isArray(cells) && cells[0]?.type==='td') {
        rows.push([getText(cells[0]),getText(cells[3]),getText(cells[4])]);
      }
    });
    assert.deepEqual(rows,[
      ['2026-11-04','سناب شات','Story'],
      ['2026-11-05','انستجرام','بوست صور'],
      ['2026-11-05','انستجرام','ستوري'],
      ['2026-11-05','سناب شات','Story'],
      ['2026-11-05','فيس بوك','بوست صور'],
      ['2026-11-07','انستجرام','ستوري'],
      ['—','فيس بوك','ستوري'],
    ]);
    assert.deepEqual(data.lines.map(line=>line.id),before,'sorting cannot mutate published plan rows');
  } finally { data.lines=originalLines; }
});
check('Agenda report keeps the existing publication-details table and headings unchanged',()=>{
  const source=read('src/marketing/workflow/PlanReport.tsx');
  for(const label of ['تفاصيل النشر حسب المنصة ونوع المنشور','تاريخ النشر','المنتج','الفكرة (فكرة المطلوب)','المنصة','نوع النشر','الكابشن','الهاشتاج','الالتزام بالموعد','الحالة','رابط المنشور'])
    assert(source.includes(label),label);
  assert.equal(byClass(view,'mkw-plan-report-table').length,1);
  assert.equal((getText(byClass(view,'mkw-plan-report-table')[0]).match(/لم يُنشر بعد/g)||[]).length,3);
});
check('Campaign report stays unchanged: no agenda-only summary in campaign',()=>{
  const original = data.plan;data.plan={...original,kind:'campaign',plan_no:'CMP-1'};
  const campaignView=PlanReport({id:'campaign-1',onClose:()=>{}});
  assert.equal(byClass(campaignView,'mkw-agenda-report-overview').length,0);
  assert.equal(byClass(campaignView,'mkw-agenda-platform-table').length,0);
  data.plan=original;
});
check('Campaign on-screen report displays approver, Riyadh approval timestamp, and the PDF-matching funding duration',()=>{
  const original=data.plan;
  data.plan={...original,kind:'campaign',plan_no:'CMP-001',funding_from:'2026-11-02',funding_to:'2026-11-05'};
  try {
    const view=PlanReport({id:'campaign',onClose:()=>{}});
    const text=getText(view);
    const approvalLabel=planApprovalLabel(data.history[0].actor_name,data.history[0].created_at);
    assert(text.includes('الاعتماد — المستخدم والتاريخ والساعة'));
    assert(text.includes(approvalLabel));
    let component=null;
    traverse(view,node=>{if(node && typeof node==='object' && node.type?.name==='CampaignOverview') component=node;});
    assert(component,'CampaignOverview must be present in campaign report');
    const overview=getText(component.type(component.props));
    assert(overview.includes('تاريخ التمويل من'));
    assert(overview.includes('تاريخ التمويل إلى'));
    assert(overview.includes('المدة'));
    assert(overview.includes('4 يوم'));
    assert(overview.includes('إجمالي ميزانية الحملة'));
    const pdf=planPdfSummaryHtml({kind:'campaign',planNo:data.plan.plan_no,planName:data.plan.name,
      creatorName:data.plan.creator_name,createdAt:data.plan.created_at,
      fundingFrom:data.plan.funding_from,fundingTo:data.plan.funding_to,
      lines:data.lines,approvedByName:data.history[0].actor_name,approvedAt:data.history[0].created_at});
    assert(pdf.includes(approvalLabel));
    assert(pdf.includes('4 يوم'));
  } finally {data.plan=original;}
});
check('Campaign report with no end date or approval shows honest placeholders; review fields remain untouched',()=>{
  const original=data.plan,history=data.history;
  data.plan={...original,kind:'campaign',funding_from:'2026-11-02',funding_to:null,review_status:'submitted'};
  data.history=[];
  try {
    const view=PlanReport({id:'campaign-legacy',onClose:()=>{}});
    assert(getText(view).includes('لم يتم الاعتماد بعد'));
    let component=null;
    traverse(view,node=>{if(node && typeof node==='object' && node.type?.name==='CampaignOverview') component=node;});
    assert(component);
    assert(getText(component.type(component.props)).includes('غير محددة'));
    assert(!getText(component.type(component.props)).includes('0 يوم'));
    const pdf=planPdfSummaryHtml({kind:'campaign',planNo:data.plan.plan_no,planName:data.plan.name,
      fundingFrom:data.plan.funding_from,fundingTo:null,lines:data.lines});
    assert(pdf.includes('غير محددة'));
    assert(pdf.includes('لم يتم الاعتماد بعد'));
  } finally {data.plan=original;data.history=history;}
});
check('Only campaign read-only summary adds duration; agenda layout and PlanDetail stay unchanged',()=>{
  const src=read('src/marketing/workflow/PlanReport.tsx');
  const overview=read('src/marketing/workflow/campaignOverview.tsx');
  const detail=read('src/marketing/workflow/PlanDetail.tsx');
  assert(src.includes('durationDays={campaignDuration}'));
  assert(overview.includes('durationDays !== undefined'));
  assert(!detail.includes('durationDays='));
  assert(src.includes('تفاصيل النشر حسب المنصة ونوع المنشور'));
});
check('Old agendas without date fields show their scheduled first/last dates in report and PDF',()=>{
  const older=agendaPublicationRange(data.lines,null,null);
  assert.equal(older.from,'2026-11-02');assert.equal(older.to,'2026-11-05');
  const original=data.plan;data.plan={...original,agenda_from:null,agenda_to:null};
  assert(getText(PlanReport({id:'legacy',onClose:()=>{}})).includes('4 يوم'));
  data.plan=original;
});
check('Unknown approval stays clearly unapproved rather than inventing a name',()=>{
  const original=data.plan; const oldHistory=data.history;
  data.plan={...original,review_status:'submitted'};data.history=[];
  assert(getText(PlanReport({id:'draft',onClose:()=>{}})).includes('لم يتم الاعتماد بعد'));
  data.history=oldHistory;data.plan=original;
});
check('Modified source parses as TypeScript/TSX',()=>{
  for(const file of ['src/marketing/workflow/PlanReport.tsx','src/marketing/workflow/campaignOverview.tsx','src/marketing/workflow/campaignPdfExport.ts']){
    const parse=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    assert.equal(parse.parseDiagnostics.length,0,file);
  }
});
console.log(`Agenda report/PDF parity: ${checks}/${checks} passed`);
