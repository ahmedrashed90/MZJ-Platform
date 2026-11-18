import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterDashboardExecutorItems, matchingTaskExecutors, searchMarketingDashboard } from '../src/marketing/workflow/dashboardSearch.ts';

let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS', name); }
const task = {
  id: 'task-1', task_no: 'TSK-000085', name: 'تعريفي - مواصفات السيارات',
  assignee_names: ['بلال فتحي', 'عبدالله حسن', 'محمود فؤاد'],
};
const items = [
  { id: 'req-b', assignee_name: 'بلال فتحي', due_on: '2026-11-08' },
  { id: 'req-m1', assignee_name: 'محمود فؤاد', due_on: '2026-11-10' },
  { id: 'req-a', assignee_name: 'عبدالله حسن', due_on: '2026-11-12' },
  { id: 'req-m2', assignee_name: 'محمود فؤاد', due_on: '2026-11-15' },
];
const scoped = query => filterDashboardExecutorItems(items, matchingTaskExecutors(task, query)).map(x => x.id);
check('Arabic partial "محم" matches only Mahmoud', () => assert.deepEqual(matchingTaskExecutors(task, 'محم'), ['محمود فؤاد']));
check('Full executor name matches only Mahmoud', () => assert.deepEqual(matchingTaskExecutors(task, 'محمود فؤاد'), ['محمود فؤاد']));
check('Keyword in phrase containing date targets executor', () => assert.deepEqual(matchingTaskExecutors(task, 'محمود 10/11/2026'), ['محمود فؤاد']));
check('Arabic normalization of name in results', () => assert.deepEqual(matchingTaskExecutors(task, 'محمود فواد'), ['محمود فؤاد']));
check('search item 1: Mahmoud shows only his two requirements', () => assert.deepEqual(scoped('محمود'), ['req-m1','req-m2']));
check('search item 2: Bilal shows only his requirement', () => assert.deepEqual(scoped('بلال'), ['req-b']));
check('search item 3: Abdullah shows only his requirement', () => assert.deepEqual(scoped('عبدالله'), ['req-a']));
check('Search by task title leaves whole task visible', () => assert.deepEqual(scoped('مواصفات'), ['req-b','req-m1','req-a','req-m2']));
check('Search by task code leaves whole task visible', () => assert.deepEqual(scoped('TSK-000085'), ['req-b','req-m1','req-a','req-m2']));
check('Short stray character is not treated as executor', () => assert.deepEqual(matchingTaskExecutors(task, 'م'), []));
check('Missing scoped user never silently exposes other executors', () => assert.deepEqual(filterDashboardExecutorItems(items, ['اسم غير موجود']), []));
check('Multiple matching names show only matching executors', () => {
  const two = { ...task, assignee_names: ['محمد محمد','محمود فؤاد','بلال فتحي'] };
  assert.deepEqual(matchingTaskExecutors(two, 'مح'), ['محمد محمد','محمود فؤاد']);
  assert.deepEqual(filterDashboardExecutorItems([{id:'1',assignee_name:'محمد محمد'},{id:'2',assignee_name:'محمود فؤاد'},{id:'3',assignee_name:'بلال فتحي'}],matchingTaskExecutors(two,'مح')).map(x=>x.id), ['1','2']);
});
check('Partial keyword still finds full task in original search', () => {
  const t = { ...task, due_from:'2026-11-08', due_to:'2026-11-15', created_at:'2026-11-01' };
  assert.equal(searchMarketingDashboard([t], [], 'محمود', '2026-11-08').tasks.length, 1);
});
const front = readFileSync(new URL('../src/marketing/pages/MarketingDashboardPage.tsx', import.meta.url), 'utf8');
const detail = readFileSync(new URL('../src/marketing/workflow/TaskDetail.tsx', import.meta.url), 'utf8');
const view = readFileSync(new URL('../src/marketing/components/DashboardSearchResults.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/marketing/workflow/dashboardSearch.css', import.meta.url), 'utf8');
check('Search result passes matched executor names on click', () => {
  assert.match(view, /onClick=\{\(\) => onOpenTask\(task.id, matchedAssignees\)\}/);
  assert.match(front, /onOpenTask=\{\(id, assigneeNames\) => openTask\(id, '', assigneeNames\)\}/);
});
check('Normal dashboard task open clears prior executor scoping', () => {
  assert.match(front, /function openTask\(id: string, filter: '' \| 'on_time' \| 'late' = '', assigneeNames: string\[\] = \[\], capture = false\)/);
  assert.match(front, /setSearchTaskAssignees\(assigneeNames\)/);
  assert.match(front, /onClick=\{\(\) => openTask\(task.id\)\}/);
});
check('Task detail filters active and rejected requirements, not authentication', () => {
  assert.match(detail, /const visibleItems = filterDashboardExecutorItems\(task\?\.items \|\| \[\], searchAssigneeNames\)/);
  assert.match(detail, /const rejectedItems = !deliveryFilter && !captureOnly \? filterDashboardExecutorItems\(query.data\?\.rejectedItems \|\| \[\], searchAssigneeNames\)/);
  assert.match(detail, /query.data!\.capabilities/);
});
check('Single matched requirement expands directly from search', () => {
  assert.match(detail, /if \(!executorScoped \|\| items.length !== 1\) return;/);
  assert.match(detail, /setOpenedRequirementId\(items\[0\]\.id\)/);
});
check('Executor-specific header, due dates and readiness', () => {
  assert.match(detail, /عرض المطلوبات الخاصة بالمنفذ/);
  assert.match(detail, /dueDates\[0\]/);
  assert.match(detail, /scopedReadiness/);
  assert.match(detail, /عدد مطلوبات المنفذ/);
});
check('Search publication status is correctly classified', () => {
  assert.match(view, /line\.published_ready \? line\.publication_timing === 'late' \? 'is-late' : 'is-published'/);
  assert.match(view, /line\.publication_timing === 'overdue' \? 'is-overdue' : 'is-pending'/);
});
check('Waiting publish is yellow', () => assert.match(css, /\.mkw-dashboard-publication-status\.is-pending \{[^}]*background:#fff7e5; color:#986008;/));
check('Published is green', () => assert.match(css, /\.mkw-dashboard-publication-status\.is-published \{[^}]*background:#edf9ef; color:#15783c;/));
check('Overdue and late remain warning red', () => assert.match(css, /\.mkw-dashboard-publication-status\.is-overdue \{[^}]*color:#b42318;/));
check('Original task opening remains unchanged from other screens', () => assert.match(front, /onClick=\{\(\) => openTask\(task.id\)\}/));
console.log(`\n${checks} executor-focused search/publish-color checks passed`);
