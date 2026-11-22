'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const load = createLoader(process.cwd(), {
  'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
  './api': { showDate: date => String(date || '—').slice(0, 10) },
});
const { publishingDashboardEntries } = load('src/marketing/workflow/publishingPriority.ts');
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

test('Publishing cards rank visible readiness first, independent of review/preparation status', () => {
  const groups = new Map([
    ['finished', [planLine('finished', { review_status: 'published', published_ready: true, prepared_count: 1 })]],
    ['started', [planLine('started', { prepared_count: 1 })]],
    ['new-older', [planLine('new-older', { kind: 'campaign', plan_created_at: '2026-11-19T12:00:00Z' })]],
    ['new-latest', [planLine('new-latest', { plan_created_at: '2026-11-22T12:00:00Z' })]],
  ]);
  const drafts = [draft('draft-working', { configuredCount: 1 }), draft('draft-new', { createdAt: '2026-11-21T12:00:00Z' }),
    draft('draft-sent', { status: 'submitted' })];
  const sorted = publishingDashboardEntries(groups, drafts);
  assert.deepEqual(sorted.map(item => item.id), [
    'new-latest', 'draft-new', 'draft-sent', 'draft-working', 'started', 'new-older', 'finished',
  ]);
  assert.deepEqual([...groups.keys()], ['finished', 'started', 'new-older', 'new-latest'], 'do not mutate backend order');
  assert.equal(drafts[0].id, 'draft-working', 'do not mutate draft array');
});

test('Zero-percent publication stays first even after review, preparation or activation', () => {
  const groups = new Map([
    ['failed-prep', [planLine('failed-prep', { failed_count: 1 })]],
    ['under-review', [planLine('under-review', { review_status: 'submitted' })]],
    ['activated', [planLine('activated', { activated_at: '2026-11-20T13:00:00Z' })]],
    ['unstarted', [planLine('unstarted')]],
  ]);
  const sorted = publishingDashboardEntries(groups, []);
  assert.equal(sorted.length, 4);
  assert(sorted.every(row => row.progress === 0 && row.priority === 0));
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
    assert.match(schedule, /<th>نوع المنتج<\/th><th>التصنيف<\/th><th>الفكرة<\/th>/);
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
