import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { searchMarketingDashboard, dashboardDateKeywords, normalizeDashboardSearch } from '../src/marketing/workflow/dashboardSearch.ts';

const tasks = [
  { id: 't1', task_no: 'TSK-000064', name: 'تصميم صورة تعريفية', type_name: 'تصميم', status: 'active',
    assignee_names: ['بلال حسن'], search_ideas: ['مواصفات سوناتا'], search_briefs: ['البراند الرسمي سيارات السعودية'], due_from: '2026-11-08', due_to: '2026-11-08',
    due_dates: ['2026-11-08'], created_at: '2026-11-07T22:00:00Z' },
  { id: 't2', task_no: 'TSK-000072', name: 'مونتاج فيديو تمويلي', type_name: 'فيديو', status: 'completed',
    assignee_names: ['محمود'], search_ideas: ['تمويل السيارات'], due_from: '2026-11-18', due_to: '2026-11-18',
    created_at: '2026-11-01T00:00:00Z' },
  { id: 't3', task_no: 'TSK-000076', name: 'تعديل تصميم', type_name: 'تصميم', status: 'active',
    assignee_names: ['بلال'], search_ideas: [], due_from: '2026-12-01', due_to: '2026-12-01',
    created_at: '2026-11-02T00:00:00Z' },
];
const base = { status: 'publishing', review_status: 'publishing', name: 'شهر 11', plan_no: 'AGD-000018',
  kind: 'agenda', plan_id: 'a1', creator_name: 'احمد', plan_created_at: '2026-11-05T20:00:00Z',
  agenda_from: '2026-11-08', agenda_to: '2026-11-30', product_idea: 'تعريف المواصفات',
  caption: '', hashtags: '', task_no: 'TSK-000064', task_name: 'تصميم صورة تعريفية',
  idea_name: 'سوناتا 2026', assignee_name: 'بلال حسن', published_ready: false, publication_timing: null };
const lines = [
  { ...base, id: 'p1', platform_name: 'إنستجرام', platform_code: 'instagram', post_type_name: 'بوست صور', scheduled_on: '2026-11-08' },
  { ...base, id: 'p2', platform_name: 'تيك توك', platform_code: 'tiktok', post_type_name: 'ستوري', scheduled_on: '2026-11-18', assignee_name: 'محمود' },
  { ...base, id: 'p3', platform_name: 'إنستجرام', platform_code: 'instagram', post_type_name: 'ريلز', scheduled_on: '2026-11-19' },
  { ...base, id: 'p4', platform_name: 'سناب شات', platform_code: 'snapchat', post_type_name: 'Spotlight', scheduled_on: '2026-11-09', published_ready: true, published_on: '2026-11-09', publication_timing: 'on_time' },
  { ...base, id: 'p5', platform_name: 'سناب شات', platform_code: 'snapchat', post_type_name: 'Story', scheduled_on: '2026-11-28', published_ready: true, published_on: '2026-12-01', publication_timing: 'late' },
  { ...base, id: 'p6', platform_name: 'إنستجرام', platform_code: 'instagram', post_type_name: 'بوست صور', scheduled_on: '2026-12-08', idea_name: 'منتج جديد' },
  { ...base, id: 'p7', plan_id: 'c1', kind: 'campaign', plan_no: 'CMP-000003', name: 'حملة تمويل الخريف',
    funding_from: '2026-11-01', funding_to: null, agenda_from: null, agenda_to: null,
    platform_name: 'فيس بوك', platform_code: 'facebook', post_type_name: 'بوست', scheduled_on: '2026-11-08', idea_name: 'كونا' },
];
const search = (query) => searchMarketingDashboard(tasks, lines, query, '2026-11-08');
let checks = 0;
const check = (label, verify) => { verify(); checks++; console.log('PASS', label); };
check('partial executor name', () => assert.deepEqual(search('بل').tasks.map(t => t.id), ['t1','t3']));
check('exact Arabic and hamza normalization', () => assert.deepEqual(search('انست').publications.map(x=>x.id), ['p1','p3','p6']));
check('English platform alias', () => assert.deepEqual(search('insta').publications.map(x=>x.id), ['p1','p3','p6']));
check('platform-specific results not all sibling lines', () => assert.equal(search('انستجرام').publications.some(x=>x.id==='p2'), false));
check('combined executor and platform', () => assert.deepEqual(search('بلال انست').publications.map(x=>x.id), ['p1','p3','p6']));
check('partial finance/product and campaign', () => { const r=search('تمو'); assert(r.tasks.some(x=>x.id==='t2')); assert(r.campaigns.some(x=>x.id==='c1')); });
check('partial task brief', () => assert.deepEqual(search('البراند').tasks.map(x=>x.id), ['t1']));
check('lookup of task code', () => assert.deepEqual(search('TSK-000072').tasks.map(x=>x.id), ['t2']));
check('plan review status Arabic keyword', () => assert(search('معتمد').agendas.some(x => x.id === 'a1')));
check('lookup of plan code', () => assert.deepEqual(search('AGD-000018').agendas.map(x=>x.id), ['a1']));
check('Gregorian YYYY/M/D', () => assert.deepEqual(search('2026/11/8').publications.map(x=>x.id), ['p1','p7']));
check('Gregorian D/M/YYYY', () => assert.deepEqual(search('8/11/2026').publications.map(x=>x.id), ['p1','p7']));
check('Arabic numerals and dashed separators', () => assert.deepEqual(search('٢٠٢٦-١١-٠٨').publications.map(x=>x.id), ['p1','p7']));
check('Month and year (also future days in month)', () => assert.equal(search('11/2026').publications.length, 6));
check('08/11 vs 18/11 must not collide', () => assert.equal(search('08/11/2026').publications.some(x=>x.id==='p2'), false));
check('different month must not collide', () => assert.equal(search('2026/11/08').publications.some(x=>x.id==='p6'), false));
check('actual publish date indexed separately', () => assert(search('2026/12/1').publications.some(x=>x.id==='p5')));
check('idea keyword finds product lines and plans', () => { const r=search('سونا'); assert(r.tasks.some(x=>x.id==='t1')); assert(r.publications.some(x=>x.id==='p1')); assert(r.agendas.some(x=>x.id==='a1')); });
check('Saudi timestamp date handles UTC rollover', () => assert(dashboardDateKeywords('2026-11-07T22:00:00Z').includes('2026/11/08')));
check('Arabic form normalization', () => assert.equal(normalizeDashboardSearch('إِنستِجرام  ٢٠٢٦'), 'انستجرام 2026'));
check('Empty search means no matching results', () => assert.equal(search('   ').tasks.length,0));
check('unmatched search means no results', () => assert.equal(search('شسمشمسمش').publications.length,0));
check('sort results by closest upcoming dates first', () => assert.deepEqual(search('تصميم').tasks.map(x=>x.id), ['t1','t3']));
const front = readFileSync(new URL('../src/marketing/pages/MarketingDashboardPage.tsx', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/marketing/workflow.ts', import.meta.url), 'utf8');
const view = readFileSync(new URL('../src/marketing/components/DashboardSearchResults.tsx', import.meta.url), 'utf8');
check('existing dashboard cards stay independent of the search query', () => assert.match(front, /const tasks = query\.data\?\.tasks \|\| \[\];\s*const lines = query\.data\?\.lines \|\| \[\];/));
check('executor names are returned under item-level permission scope', () => assert.match(server, /left join core\.users assignee on assignee\.id=i\.assigned_to/));
check('search has no visible old heading', () => assert(!front.includes('بحث شامل في الداش بورد') && !view.includes('بحث شامل في الداش بورد')));
check('search opens existing task, report and plan views', () => { assert.match(front, /onOpenTask=\{id => openTask\(id\)\}/); assert.match(front, /onOpenPublication=\{id => setTableId\(id\)\}/); assert.match(front, /onOpenPlan=\{id => setParams\(\{ plan: id \}\)\}/); });
check('dates are labelled separately', () => { assert.match(view, /تاريخ النشر المخطط/); assert.match(view, /تاريخ النشر الفعلي/); assert.match(view, /تاريخ التسليم/); });
console.log(`\n${checks} dashboard keyword-search checks passed`);
