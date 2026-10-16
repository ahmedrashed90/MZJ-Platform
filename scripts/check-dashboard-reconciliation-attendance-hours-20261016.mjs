import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(file, 'utf8');
const source = read('server/_dashboard-data.ts');
const screen = read('src/pages/DashboardPage.tsx');
const crm = read('src/crm/pages/CrmDashboardPage.tsx');
const reports = read('src/crm/pages/CrmReportsPage.tsx');
const attendance = read('src/attendance/AttendancePage.tsx');
let passed = 0;
function check(label, test) {
  try { test(); passed++; console.log('PASS: ' + label); }
  catch (error) { console.error('FAIL: ' + label + ' - ' + error.message); process.exitCode = 1; }
}
check('All three KPI components use the same department activity CTE', () => {
  for (const text of ['open_counts as (', 'no_answer_counts as (', 'sold_counts as (', 'department_activity as (']) assert.ok(source.includes(text));
  for (const alias of ['total_customers', 'no_answer_customers', 'sold', 'open_conversations']) {
    assert.match(source, new RegExp(`from department_activity\\),0\\)::int as ${alias}`));
  }
});
check('Every displayed department total is sourced from department_activity', () => {
  for (const alias of ['cash_sales','finance_sales','customer_service','other_customers']) {
    assert.match(source, new RegExp(`select sum\\(total\\) from department_activity[^\\n]+as ${alias}`));
  }
});
check('Unclassified events are included rather than disappearing from total', () => {
  assert.match(source, /department_code not in \('cash_sales','wholesale','wholesale_sales','finance_sales','call_center','customer_service'\) or department_code is null/);
});
check('Main donut has exact same total as top headline', () => {
  assert.match(screen, /className="pie-center"><Value value=\{crm\?\.totalCustomers \?\? null\}/);
  assert.match(screen, /<h2>توزيع العملاء حسب القسم<\/h2>/);
  assert.doesNotMatch(screen, /className="pie-center"><Value value=\{crm\?\.uniqueCustomers/);
});
check('Main donut openly distinguishes summed indicators from unique customers', () => {
  assert.match(screen, /قد يظهر العميل في أكثر من مؤشر/);
  assert.match(screen, /إجمالي المؤشرات/);
});
check('CRM dashboard only displays summary with identical filters', () => {
  for (const item of ['from', 'to', 'department', 'branch', 'agent', 'q']) assert.match(crm, new RegExp(`selected\\?\\.${item}`));
  assert.match(crm, /const facts = matchingSnapshot \? reportSummary\?\.totals/);
  assert.match(crm, /ready: Boolean\(facts\)/);
});
check('CRM sold metric is fetched from canonical dated transactions, not status count', () => {
  assert.match(crm, /const sold = facts \? Number\(facts\.sold \|\| 0\)/);
  assert.doesNotMatch(crm, /const sold = leads\.filter/);
});
check('CRM missing snapshot cannot masquerade as real zero', () => {
  assert.match(crm, /dashboardTotals\.ready \? [\s\S]*? : "—"/);
  assert.match(crm, /summaryRequestId/);
});
check('CRM reports and dashboard share historic-state and period-sale mode', () => {
  assert.match(crm, /dashboardPeriod: 1, summaryOnly: 1/);
  const occurrences = reports.match(/dashboardPeriod: 1/g) || [];
  assert.ok(occurrences.length >= 3, `expected 3 report endpoints with dashboardPeriod, got ${occurrences.length}`);
});
check('Attendance source contains compact hours and exact minute difference', () => {
  assert.match(attendance, /function wholeHoursText/);
  assert.match(attendance, /function hoursDifferenceText/);
  assert.match(attendance, /formatDurationMinutes\(Math\.abs\(delta\)\)/);
  assert.doesNotMatch(attendance, /hourMinuteText\(/);
});
const helpers = ['formatDurationMinutes','wholeHoursText','hoursDifferenceText'].map(fn => {
  const matcher = new RegExp(`function ${fn}\\([^]*?\\n}\\n`);
  const block = attendance.match(matcher)?.[0];
  assert.ok(block, `missing ${fn}`);
  return block.replaceAll(': unknown', '').replaceAll(': number', '');
}).join('\n');
const formats = vm.runInNewContext(`${helpers}\n({ wholeHoursText,hoursDifferenceText })`);
check('Whole hours omit minutes, including in empty attendance', () => {
  assert.equal(formats.wholeHoursText(418), '7 ساعة');
  assert.equal(formats.wholeHoursText(0), '—');
  assert.equal(formats.wholeHoursText(20), 'أقل من ساعة');
});
check('Difference converts each 60 minutes to an hour without zero-hour prefix', () => {
  assert.equal(formats.hoursDifferenceText(60, 60), '—');
  assert.equal(formats.hoursDifferenceText(60, 119), '+59 دقيقة');
  assert.equal(formats.hoursDifferenceText(60, 120), '+1 ساعة');
  assert.equal(formats.hoursDifferenceText(135, 60), '−1 ساعة و 15 دقيقة');
  assert.equal(formats.hoursDifferenceText(418, 0), '−6 ساعة و 58 دقيقة');
});
check('Both attendance daily layouts and XLS/PDF exports share formatters', () => {
  assert.ok((attendance.match(/hoursDifferenceText\(/g) || []).length >= 7);
  assert.ok((attendance.match(/wholeHoursText\(/g) || []).length >= 12);
});
console.log(`Dashboard CRM and attendance exact-minute regression: ${passed}/13`);
