// Marketing execution punctuality regression checks. No live database required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const server = read('server/marketing/workflow.ts');
const dashboard = read('src/marketing/pages/MarketingDashboardPage.tsx');
const taskDetail = read('src/marketing/workflow/TaskDetail.tsx');
const labels = read('shared/marketing-workflow-labels.ts');
const css = read('src/marketing/workflow/workflow.css');
const types = read('shared/marketing-workflow.ts');
let count = 0;
function test(name, fn) { fn(); count++; console.log('PASS: ' + name); }
const submittedDay = timestamp => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const submissionStatus = (status, submittedAt, due) =>
  (status !== 'submitted' && status !== 'approved') || !submittedAt ? null : submittedDay(submittedAt) <= due ? 'on_time' : 'late';
test('same due date is on-time', () => assert.equal(submissionStatus('submitted', '2026-10-12T10:00:00Z', '2026-10-12'), 'on_time'));
test('earlier than due date is on-time', () => assert.equal(submissionStatus('approved', '2026-10-11T20:59:59Z', '2026-10-12'), 'on_time'));
test('Riyadh midnight marks the next day as late', () => assert.equal(submissionStatus('submitted', '2026-10-11T21:00:00Z', '2026-10-11'), 'late'));
test('late day after deadline is late', () => assert.equal(submissionStatus('approved', '2026-10-14T08:00:00Z', '2026-10-12'), 'late'));
test('in progress is not counted as a delivery', () => assert.equal(submissionStatus('in_progress', null, '2026-10-12'), null));
test('revision is not counted until executor resubmits', () => assert.equal(submissionStatus('revision', '2026-10-12T09:00:00Z', '2026-10-12'), null));
test('approval timestamp does not affect punctuality', () => assert.equal(submissionStatus('approved', '2026-10-12T09:00:00Z', '2026-10-12'), 'on_time'));
test('dashboard counts derive from submitted_at at Riyadh civil date only', () => {
  assert.match(server, /i\.submitted_at at time zone 'Asia\/Riyadh'/g);
  assert.match(server, /i\.status in \('submitted','approved'\)/g);
  assert.match(server, /::date <= i\.due_on\)::int as submitted_on_time_count/);
  assert.match(server, /::date > i\.due_on\)::int as submitted_late_count/);
});
test('executor delivery status provided within task details', () => {
  assert.match(server, /else null end as delivery_status/);
  assert.match(types, /delivery_status\?: 'on_time' \| 'late' \| null/);
  assert.match(taskDetail, /item\.assignee_name/);
  assert.match(taskDetail, /item\.delivery_status/);
  assert.match(taskDetail, /W\.deliveredAt/);
});
test('dashboard shows both counters with agreed labels', () => {
  assert.match(dashboard, /task\.submitted_on_time_count \?\? 0/);
  assert.match(dashboard, /task\.submitted_late_count \?\? 0/);
  assert.ok(labels.includes('التسليم في الموعد') && labels.includes('تأخر في التسليم'));
});
test('colors come from existing MZJ success and danger tokens', () => {
  assert.match(css, /\.mkw-delivery-summary-card\.is-on-time, \.mkw-delivery-badge\.is-on-time \{ color:var\(--green\); \}/);
  assert.match(css, /\.mkw-delivery-summary-card\.is-late, \.mkw-delivery-badge\.is-late \{ color:var\(--red\); \}/);
});
console.log(`${count}/${count} marketing delivery punctuality checks passed`);
