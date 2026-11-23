'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const load = createLoader(process.cwd(), {
  'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
  './api': { showDate: date => String(date || '—').slice(0, 10) },
});
const { executionDashboardTasks, publishingDashboardEntries } = load('src/marketing/workflow/publishingPriority.ts');
const { compactPublishingIdeaTitle, planPdfSummaryHtml, planPdfScheduleRows } = load('src/marketing/workflow/campaignPdfExport.ts');
let count = 0;
function test(name, fn) { fn(); count++; console.log('PASS:', name); }
const planLine = (planId, options = {}) => ({
  id: `${planId}-row`, plan_id: planId, name: planId, kind: 'agenda', plan_created_at: '2026-11-20T12:00:00Z',
  review_status: 'in_progress', scheduled_on: '2026-11-23', media_kind: 'image',
  prepared_count: 0, published_count: 0, failed_count: 0, published_ready: false,
  product_id: `${planId}-prod`, idea_name: 'اسم التكليف', product_idea: 'فكرة أصلية',
  platform_code: 'snapchat', platform_name: 'سناب شات', assignee_name: 'عبدالله', ...options,
});
const draft = (id, options = {}) => ({
  id, kind: 'campaign', status: 'draft', name: id, createdAt: '2026-11-20T12:00:00Z',
  productCount: 4, configuredCount: 0, executedCount: 0, readyCount: 0,
  ...options,
});

// Numeric readiness is the ONLY primary ordering rule, regardless of workflow status.
test('Execution cards sort by visible numeric readiness: 0%, 16.7%, 83.3%, 100%', () => {
  const input = [
    { id: 'finished', readiness: 100, created_at: '2026-11-22T12:00:00Z' },
    { id: 'partial-high', readiness: 83.3, created_at: '2026-11-20T12:00:00Z' },
    { id: 'partial-low', readiness: 16.7, created_at: '2026-11-21T12:00:00Z' },
    { id: 'untouched', readiness: 0, created_at: '2026-11-19T12:00:00Z' },
    { id: 'also-finished', readiness: 100, created_at: '2026-11-23T12:00:00Z' },
  ];
  assert.deepEqual(executionDashboardTasks(input).map(item => item.id), [
    'untouched', 'partial-low', 'partial-high', 'also-finished', 'finished',
  ]);
  assert.deepEqual(input.map(item => item.id), ['finished', 'partial-high', 'partial-low', 'untouched', 'also-finished']);
});

test('Execution readiness equalities use newest timestamp, with deterministic tie and safe numeric normalization', () => {
  const input = [
    { id: 'b', readiness: '0', created_at: '2026-11-21T12:00:00Z' },
    { id: 'z', readiness: 0, created_at: '2026-11-22T12:00:00Z' },
    { id: 'a', readiness: 0, created_at: '2026-11-21T12:00:00Z' },
    { id: 'negative', readiness: -50, created_at: '2026-11-20T12:00:00Z' },
    { id: 'missing', readiness: undefined, created_at: '2026-11-23T12:00:00Z' },
  ];
  assert.deepEqual(executionDashboardTasks(input).map(item => item.id), [
    'missing', 'z', 'a', 'b', 'negative',
  ]);
});

test('Plans and drafts sort by the EXACT readiness displayed, not action/status/preparation', () => {
  const oneOfSix = Array.from({ length: 6 }, (_, index) => planLine('one-of-six', {
    id: `one-of-six-${index}`, published_ready: index === 0,
    prepared_count: 1, review_status: 'publishing',
    plan_created_at: '2026-11-19T12:00:00Z',
  }));
  const fiveOfSix = Array.from({ length: 6 }, (_, index) => planLine('five-of-six', {
    id: `five-of-six-${index}`, published_ready: index < 5,
    plan_created_at: '2026-11-19T12:00:00Z',
  }));
  const groups = new Map([
    ['complete', [planLine('complete', { review_status: 'published', published_ready: true, prepared_count: 1 })]],
    ['one-of-six', oneOfSix],
    ['five-of-six', fiveOfSix],
    ['approved-zero', [planLine('approved-zero', { review_status: 'publishing', prepared_count: 1, activated_at: '2026-11-20T13:00:00Z', plan_created_at: '2026-11-21T12:00:00Z' })]],
    ['zero-newer', [planLine('zero-newer', { kind: 'campaign', plan_created_at: '2026-11-22T12:00:00Z' })]],
  ]);
  const drafts = [
    draft('draft-half', { readyCount: 2, configuredCount: 4, createdAt: '2026-11-23T12:00:00Z' }),
    draft('draft-zero', { configuredCount: 4, readyCount: 0, createdAt: '2026-11-20T12:00:00Z' }),
    draft('draft-full', { readyCount: 4, createdAt: '2026-11-21T12:00:00Z' }),
  ];
  const sorted = publishingDashboardEntries(groups, drafts);
  assert.deepEqual(sorted.map(item => item.id), [
    'zero-newer', 'approved-zero', 'draft-zero', 'one-of-six', 'draft-half', 'five-of-six', 'draft-full', 'complete',
  ]);
  assert.deepEqual(sorted.map(item => item.readiness), [0, 0, 0, 17, 50, 83, 100, 100]);
  assert.deepEqual([...groups.keys()], ['complete', 'one-of-six', 'five-of-six', 'approved-zero', 'zero-newer']);
  assert.deepEqual(drafts.map(item => item.id), ['draft-half', 'draft-zero', 'draft-full']);
});

test('Zero readiness stays first even when plan is submitted, prepared, activated or published', () => {
  const groups = new Map([
    ['half', [planLine('half', { published_ready: true }), planLine('half', { id: 'half-2' })]],
    ['activated', [planLine('activated', { review_status: 'publishing', activated_at: '2026-11-22', prepared_count: 1 })]],
    ['submitted', [planLine('submitted', { review_status: 'submitted', prepared_count: 1 })]],
    ['failed-preparation', [planLine('failed-preparation', { failed_count: 1 })]],
  ]);
  assert.deepEqual(publishingDashboardEntries(groups, []).map(item => item.readiness), [0, 0, 0, 50]);
});

test('Refreshing readiness reorders cards without touching the underlying data', () => {
  const first = [ { id: 'A', readiness: 0, created_at: '2026-11-21' }, { id: 'B', readiness: 75, created_at: '2026-11-22' } ];
  assert.deepEqual(executionDashboardTasks(first).map(task => task.id), ['A', 'B']);
  const next = first.map(task => ({...task, readiness: task.id === 'A' ? 100 : 50 }));
  assert.deepEqual(executionDashboardTasks(next).map(task => task.id), ['B', 'A']);
  assert.equal(first[0].readiness, 0);
});

test('Dashboard renders execution sorted cards and the publish readiness calculation is consistent', () => {
  const source = fs.readFileSync('src/marketing/pages/MarketingDashboardPage.tsx', 'utf8');
  assert.match(source, /executionDashboardTasks\(tasks\)/);
  assert.match(source, /executionTasks\.map\(task/);
  assert.match(source, /Math\.round\(readyLines \* 100 \/ group\.length\)/);
  assert.match(source, /<Readiness value=\{readiness\} label="جاهزية النشر"\s*\/>/);
});

const first = 'بريف إبداعي: سنة جديدة وسيارة جديدة — عروض بداية العام من MZJ السيارات المعتمدة: لا توجد سيارات محددة للفكرة';
const second = 'بريف إبداعي: حاسبة القسط — جرّبها قبل تتواصل أسلوب التنفيذ: سكرين ريكورد + فويس أوفر السيارات المعتمدة: لا توجد سيارات محددة للفكرة';
const third = 'بريف إبداعي: للشركة أكثر من سيارة؟ ابدأ باحتياجكم. أسلوب التنفيذ: تصوير حقيقي + تصميم جرافيكي بالهوية السيارات المعتمدة: ديزاير | ستاندر - جي ال - 1.2 سي سي | 2026 | ابيض | بيج ستاريا | ديزل';

test('User example titles lose all brief and approved-vehicle details', () => {
  assert.equal(compactPublishingIdeaTitle(first), 'سنة جديدة وسيارة جديدة — عروض بداية العام من MZJ');
  assert.equal(compactPublishingIdeaTitle(second), 'حاسبة القسط — جرّبها قبل تتواصل');
  assert.equal(compactPublishingIdeaTitle(third), 'للشركة أكثر من سيارة؟ ابدأ باحتياجكم.');
  assert.equal(compactPublishingIdeaTitle('عملية الشراء الكاش: سهولة البحث والاختيار'), 'عملية الشراء الكاش: سهولة البحث والاختيار');
  assert.equal(compactPublishingIdeaTitle(''), '—');
});

test('Multiple embedded briefs keep only distinct idea titles on separate lines', () => {
  const combined = `${first}\n${second}\n${first}`;
  assert.deepEqual(compactPublishingIdeaTitle(combined).split('\n'), [
    'سنة جديدة وسيارة جديدة — عروض بداية العام من MZJ',
    'حاسبة القسط — جرّبها قبل تتواصل',
  ]);
});

test('Both agenda and campaign PDFs show content kind, not legacy product name or brief details', () => {
  const lines = [
    planLine('one', { idea_name: 'اسم المنتج الفعلي', product_idea: first, media_kind: 'image' }),
    planLine('two', { idea_name: 'اسم الفيديو الفعلي', product_idea: second, media_kind: 'video' }),
    planLine('three', { idea_name: 'اسم صورة أخرى', product_idea: third, media_kind: 'image' }),
  ];
  const before = JSON.stringify(lines);
  for (const kind of ['agenda', 'campaign']) {
    const pdf = planPdfSummaryHtml({ kind, planName: 'ملخص تجربة', planNo: 'TEST', lines });
    const schedule = pdf.split('<section class="schedule-section">')[1].split('</section>')[0];
    assert.match(schedule, /<th>نوع المنتج<\/th><th>الفكرة<\/th>/);
    assert.match(schedule, /<td class="schedule-product" rowspan="1">صورة<\/td>/);
    assert.match(schedule, /<td class="schedule-product" rowspan="1">فيديو<\/td>/);
    for (const title of ['سنة جديدة وسيارة جديدة — عروض بداية العام من MZJ', 'حاسبة القسط — جرّبها قبل تتواصل', 'للشركة أكثر من سيارة؟ ابدأ باحتياجكم.']) assert(schedule.includes(title));
    assert.doesNotMatch(schedule, /بريف إبداعي|السيارات المعتمدة|أسلوب التنفيذ|سكري?ن ريكورد|ديزاير|اسم المنتج الفعلي|اسم الفيديو الفعلي/);
  }
  assert.equal(JSON.stringify(lines), before, 'original DB objects remain unchanged');
});

test('Same title with different vehicle descriptions groups only by visible idea name and media kind', () => {
  const lines = [
    planLine('a', { idea_name: 'تصوير', product_idea: `${first}\nالسيارات المعتمدة: سوناتا` }),
    planLine('b', { idea_name: 'تصوير', product_idea: `${first}\nالسيارات المعتمدة: توسان` }),
    planLine('c', { idea_name: 'تصوير', product_idea: first, media_kind: 'video' }),
  ];
  const rows = planPdfScheduleRows(lines);
  assert.equal(rows.length, 2, 'image/video are different media products even when idea titles are equal');
  assert.deepEqual(rows.map(row => row.mediaKind).sort(), ['image', 'video']);
});

test('No HTML is executed from an idea title', () => {
  const evil = 'بريف إبداعي: <script>alert(1)</script> السيارات المعتمدة: غير محددة';
  const pdf = planPdfSummaryHtml({kind:'campaign',planName:'عنوان',planNo:'1',lines:[planLine('x', {product_idea:evil})]});
  const schedule = pdf.split('<section class="schedule-section">')[1].split('</section>')[0];
  assert.doesNotMatch(schedule, /<script>/);
  assert.match(schedule, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('Updated source files have no TS/TSX syntax errors', () => {
  for (const name of ['src/marketing/workflow/campaignPdfExport.ts', 'src/marketing/workflow/publishingPriority.ts', 'src/marketing/pages/MarketingDashboardPage.tsx']) {
    const syntax = ts.createSourceFile(name, fs.readFileSync(name, 'utf8'), ts.ScriptTarget.Latest, true, name.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    assert.equal(syntax.parseDiagnostics.length, 0, name);
  }
});
console.log(`${count}/${count} publishing priorities and compact PDF titles passed`);
