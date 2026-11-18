'use strict';
const assert = require('node:assert/strict');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const load = createLoader(process.cwd(), {
  'react/jsx-runtime': { jsx:(type, props)=>({type,props}), jsxs:(type, props)=>({type,props}) },
  './api': { showDate: value => value ? String(value).slice(0, 10) : '—' },
});
const { planPdfScheduleRows, planPdfChronologicalRows, planPdfSummaryHtml } = load('src/marketing/workflow/campaignPdfExport.ts');
let passed=0;
function test(name,fn){fn();console.log('PASS:',name);passed++}
const entry=(date, product, idea, platform='انستجرام', executor='محمود')=>({
  id: `${date}-${product}-${platform}`, scheduled_on:date, idea_name:product, product_idea:idea,
  platform_name:platform, platform_code:platform, assignee_name:executor, budget_amount:10,
});
const sample=[
  entry('2026-12-05','أول منتج','أول فكرة','تيك توك'),
  entry('2026-11-10','ثالث منتج','ثالث فكرة','انستجرام'),
  entry('2026-11-07','ثاني منتج','ثاني فكرة'),
  entry('2026-12-01','ثاني منتج','ثاني فكرة','فيس بوك'),
  entry('2026-11-05','أول منتج','أول فكرة','انستجرام'),
  entry('2026-11-15','خامس منتج','خامس فكرة'),
  entry('2026-11-12','رابع منتج','رابع فكرة'),
];
const section=(lines,kind='agenda')=>planPdfSummaryHtml({kind,planName:'تقرير اختبار',planNo:'X1',lines})
  .split('<section class="schedule-section">')[1].split('</section>')[0];
const dates=html=>[...html.matchAll(/<td class="schedule-dates" rowspan="\d+">([^<]+)<\/td>/g)].map(x=>x[1]);
const count=(text,regex)=>[...text.matchAll(regex)].length;

test('REGRESSION: groups spanning Nov and Dec no longer interleave the months',()=>{
  // The original product-group order put Dec 05 before Nov 07.
  assert.deepEqual(planPdfScheduleRows(sample).map(r=>r.product).slice(0,2),['أول منتج','ثاني منتج']);
  assert.deepEqual(planPdfChronologicalRows(sample).map(r=>r.date),[
    '2026-11-05','2026-11-07','2026-11-10','2026-11-12','2026-11-15','2026-12-01','2026-12-05'
  ]);
});
test('Printed date cells are globally sorted in BOTH agenda and campaign',()=>{
  for(const kind of ['agenda','campaign']){
    const order=dates(section(sample,kind));
    assert.deepEqual(order,['2026-11-05','2026-11-07','2026-11-10','2026-11-12','2026-11-15','2026-12-01','2026-12-05']);
  }
});
test('All days of a given month precede the next month, including a year boundary',()=>{
  const rows=planPdfChronologicalRows([
    entry('2027-01-02','ح','ح'),entry('2026-12-31','أ','أ'),entry('2026-11-30','ج','ج'),
    entry('2026-11-01','أ','أ'),entry('2026-12-01','أ','أ'),entry('2027-01-01','د','د'),
  ]);
  assert.deepEqual(rows.map(r=>r.date),['2026-11-01','2026-11-30','2026-12-01','2026-12-31','2027-01-01','2027-01-02']);
});
test('Same day, different product/idea groups: date appears once with correct rowspan',()=>{
  const html=section([
    entry('2026-11-08','أكسنت','فكرة A','تيك توك','بلال'),
    entry('2026-11-08','سوناتا','فكرة B','انستجرام','محمود'),
    entry('2026-11-09','توسان','فكرة C'),
  ]);
  assert.deepEqual(dates(html),['2026-11-08','2026-11-09']);
  assert.match(html,/<td class="schedule-dates" rowspan="2">2026-11-08<\/td>/);
  assert.equal(count(html, /class="schedule-product"/g),3);
});
test('Same product/idea on consecutive dates merges adjacent content cells',()=>{
  const html=section([
    entry('2026-11-08','سوناتا','فكرة A'), entry('2026-11-09','سوناتا','فكرة A'),
  ]);
  assert.match(html,/<td class="schedule-product" rowspan="2">سوناتا<\/td><td class="schedule-idea" rowspan="2">فكرة A<\/td>/);
  assert.deepEqual(dates(html),['2026-11-08','2026-11-09']);
});
test('Nonadjacent content groups remain identified and chronological (no misleading spanning)',()=>{
  const html=section([
    entry('2026-11-05','سوناتا','فكرة A'),entry('2026-12-05','سوناتا','فكرة A'),
    entry('2026-11-07','أكسنت','فكرة B'),
  ]);
  assert.deepEqual(dates(html),['2026-11-05','2026-11-07','2026-12-05']);
  assert.equal(count(html,/<td class="schedule-product" rowspan="1">سوناتا<\/td>/g),2);
});
test('Repeated platforms and executors in a day remain unique within each product/idea',()=>{
  const html=section([
    entry('2026-11-08','سوناتا','فكرة A','تيك توك','محمود'),
    entry('2026-11-08','سوناتا','فكرة A','تيك توك','محمود'),
    entry('2026-11-08','سوناتا','فكرة A','انستجرام','محمود'),
  ]);
  assert.equal(count(html,/>محمود<\/div>/g),1);
  assert.equal(count(html,/>تيك توك<\/div>/g),1);
  assert.equal(count(html,/>انستجرام<\/div>/g),1);
});
test('Missing and invalid dates appear at end, one unspecified day group',()=>{
  const html=section([
    entry('2026-02-31','منتج بلا يوم','فكرة A'),entry('','منتج آخر','فكرة B'),entry('2026-11-08','منتج معروف','فكرة C'),
  ]);
  assert.deepEqual(dates(html),['2026-11-08','غير محدد']);
  assert.match(html,/<td class="schedule-dates" rowspan="2">غير محدد<\/td>/);
});
test('Sorting does not change original publication rows or campaign budget',()=>{
  const before=JSON.stringify(sample);
  const agenda=section(sample,'agenda');
  const campaign=planPdfSummaryHtml({kind:'campaign',planNo:'X1',planName:'حملة اختبار',lines:sample});
  assert.equal(JSON.stringify(sample),before);
  assert.match(campaign,/70\.00 ر\.س/);
  assert.deepEqual(dates(agenda),dates(section(sample,'campaign')));
});
console.log(`${passed}/${passed} chronological PDF tests passed`);
