'use strict';
const assert = require('node:assert/strict');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const load = createLoader(process.cwd(), {
  'react/jsx-runtime': {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
  './api': { showDate: value => value ? String(value).slice(0, 10) : '—' },
});
const { planPdfScheduleRows, planPdfSummaryHtml } = load('src/marketing/workflow/campaignPdfExport.ts');
const entry = (date, platform, executor, idea = 'إبراز المزايا', product = 'سوناتا 2026') => ({
  id:`${date}-${platform}-${executor}`, scheduled_on:date, platform_name:platform,
  platform_code:platform, assignee_name:executor, product_idea:idea, idea_name:product,
});
let passed = 0;
function test(name, fn){ fn(); console.log('PASS:',name); passed++; }
const schedulePart = (input, kind = 'agenda') => planPdfSummaryHtml({kind, planName:'خطة اختبار',planNo:'TEST-1', lines:input})
  .split('<section class="schedule-section">')[1].split('</section>')[0];
const count = (html, pattern) => [...html.matchAll(pattern)].length;
const uniqueNames = html => [...html.matchAll(/<div class="schedule-unique-name">([^<]*)<\/div>/g)].map(m=>m[1]);

test('One day means exactly one date row, even if four platforms publish',()=>{
  const lines = [
    entry('2026-11-08','انستجرام','محمود'), entry('2026-11-08','تيك توك','بلال'),
    entry('2026-11-08','سناب شات','عبدالله'), entry('2026-11-08','فيس بوك','محمود'),
  ];
  const html=schedulePart(lines);
  assert.equal(count(html,/<td class="schedule-dates">2026-11-08<\/td>/g),1);
  assert.equal(count(html,/<tr>/g),2); // one header plus one daily data row
  assert.equal(count(html,/class="schedule-product"/g),1);
  assert.equal(count(html,/class="schedule-idea"/g),1);
  assert.deepEqual(uniqueNames(html).sort(),['محمود','بلال','عبدالله','انستجرام','تيك توك','سناب شات','فيس بوك'].sort());
  assert.equal(count(html,/>محمود<\/div>/g),1);
});

test('Repeated platform and executor from different post formats are shown once per day',()=>{
  const lines=[entry('2026-11-08','انستجرام','محمود'),entry('2026-11-08','انستجرام','محمود'),
    entry('2026-11-08','انستجرام','بلال'),entry('2026-11-08','تيك توك','محمود')];
  const html=schedulePart(lines);
  assert.equal(count(html,/class="schedule-dates"/g),1);
  assert.equal(count(html,/>محمود<\/div>/g),1);
  assert.equal(count(html,/>بلال<\/div>/g),1);
  assert.equal(count(html,/>انستجرام<\/div>/g),1);
  assert.equal(count(html,/>تيك توك<\/div>/g),1);
  assert.equal(planPdfScheduleRows(lines)[0].publications.length,3); // original associations preserved
});

test('The same executor and platform can appear once again on a DIFFERENT day',()=>{
  const html=schedulePart([entry('2026-11-08','انستجرام','محمود'),entry('2026-11-09','انستجرام','محمود')]);
  assert.equal(count(html,/class="schedule-dates"/g),2);
  assert.equal(count(html,/>محمود<\/div>/g),2);
  assert.equal(count(html,/>انستجرام<\/div>/g),2);
  assert.match(html,/<td class="schedule-product" rowspan="2">سوناتا 2026<\/td>/);
});

test('The same date in distinct product/idea groups is not incorrectly combined',()=>{
  const html=schedulePart([entry('2026-11-08','انستجرام','محمود','فكرة A','سوناتا'),
    entry('2026-11-08','تيك توك','بلال','فكرة B','أكسنت')]);
  assert.equal(count(html,/<td class="schedule-dates">2026-11-08<\/td>/g),2);
  assert.equal(count(html,/class="schedule-product"/g),2);
});

test('Normalization consolidates visually equal executor/platform names without omitting any distinct values',()=>{
  const html=schedulePart([entry('2026-11-08','انستجرام','محمود  فؤاد'),
    entry('2026-11-08','انستجرام ','محمود فؤاد'),entry('2026-11-08','سناب شات','بلال')]);
  assert.equal(count(html,/>محمود  فؤاد<\/div>/g),1);
  assert.equal(count(html,/>انستجرام<\/div>/g),1);
  assert.equal(count(html,/>سناب شات<\/div>/g),1);
});

test('Unknown or invalid scheduled day is shown as unknown (not invented)',()=>{
  const html=schedulePart([entry('2026-02-31','انستجرام','محمود'),entry('','تيك توك','بلال')]);
  assert.equal(count(html,/<td class="schedule-dates">غير محدد<\/td>/g),1);
  assert.equal(count(html,/>انستجرام<\/div>/g),1);
  assert.equal(count(html,/>تيك توك<\/div>/g),1);
});

test('Campaign and agenda render the same daily unique schedule',()=>{
  const lines=[entry('2026-11-08','انستجرام','محمود'),entry('2026-11-08','تيك توك','محمود')];
  for(const kind of ['agenda','campaign']) {
    const html=schedulePart(lines,kind);
    assert.equal(count(html,/<td class="schedule-dates">2026-11-08<\/td>/g),1);
    assert.equal(count(html,/>محمود<\/div>/g),1);
    assert.equal(count(html,/class="schedule-unique-name"/g),3);
  }
});

test('User input is escaped, and underlying plan rows and business aggregations remain unchanged',()=>{
  const lines=[entry('2026-11-08','<b>انستجرام</b>','محمود'),entry('2026-11-08','تيك توك','بلال')];
  const original=JSON.stringify(lines);
  const html=schedulePart(lines);
  assert.doesNotMatch(html,/<b>انستجرام<\/b>/);
  assert.match(html,/&lt;b&gt;انستجرام&lt;\/b&gt;/);
  assert.equal(planPdfScheduleRows(lines)[0].publications.length,2);
  assert.equal(JSON.stringify(lines),original);
});
console.log(`${passed}/${passed} daily-unique summary tests passed`);
