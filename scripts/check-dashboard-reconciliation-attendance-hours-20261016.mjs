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
check('Customer headline counts visible lead cohort, never activity events', () => {
  assert.match(source, /count\(\*\)::int as total_customers/);
  assert.match(source, /crmVisibleCustomerCohortSql\(sql, from, to\)/);
  assert.doesNotMatch(source, /sum\(total\) from department_activity\),0\)::int as total_customers/);
  for (const alias of ['no_answer_customers', 'sold', 'open_conversations'])
    assert.match(source, new RegExp(`from department_activity\\),0\\)::int as ${alias}`));
});
check('Every department total comes from the exact same customer count', () => {
  for (const alias of ['cash_sales','finance_sales','customer_service','other_customers'])
    assert.match(source, new RegExp(`count\\(\\*\\) filter\\(where[^\\n]+as ${alias}`));
});
check('Unclassified customers are included instead of disappearing', () => {
  assert.match(source, /department_code not in \('cash_sales','wholesale','wholesale_sales','finance_sales','call_center','customer_service'\) or department_code is null/);
});
check('Main donut equals the unique-customer headline', () => {
  assert.match(screen, /className="pie-center"><Value value=\{crm\?\.totalCustomers \?\? null\}/);
  assert.match(screen, /<h2>توزيع العملاء حسب القسم<\/h2>/);
});
check('Main donut is labeled customers, not activity counts', () => {
  assert.match(screen, /مجموع الأقسام مطابق لإجمالي العملاء/);
  assert.doesNotMatch(screen, /<span>إجمالي المؤشرات<\/span>/);
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
check('Actual attendance and expected duty minutes are never rounded to whole hours', () => {
  assert.equal(formats.wholeHoursText(418), '6 ساعة و 58 دقيقة');
  assert.equal(formats.wholeHoursText(0), '—');
  assert.equal(formats.wholeHoursText(20), '20 دقيقة');
});
check('Difference is scheduled minus worked, in exact hours and minutes', () => {
  assert.equal(formats.hoursDifferenceText(60, 60), '—');
  assert.equal(formats.hoursDifferenceText(60, 119), '−59 دقيقة');
  assert.equal(formats.hoursDifferenceText(60, 120), '−1 ساعة');
  assert.equal(formats.hoursDifferenceText(135, 60), '+1 ساعة و 15 دقيقة');
  assert.equal(formats.hoursDifferenceText(418, 0), '+6 ساعة و 58 دقيقة');
});
check('Both attendance daily layouts and XLS/PDF exports share formatters', () => {
  assert.ok((attendance.match(/hoursDifferenceText\(/g) || []).length >= 7);
  assert.ok((attendance.match(/wholeHoursText\(/g) || []).length >= 12);
});
console.log(`Dashboard CRM and attendance exact-minute regression: ${passed}/13`);
