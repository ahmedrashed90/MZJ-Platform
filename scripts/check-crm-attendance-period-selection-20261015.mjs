import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(name, 'utf8');
const tests = [];
function check(name, callback) {
  try { callback(); tests.push([name,true]); console.log(`PASS: ${name}`); }
  catch(err) { tests.push([name,false]); console.error(`FAIL: ${name}: ${err.message}`); }
}
const crmApi=read('server/crm/dashboard.ts');
const reportApi=read('server/crm/reports.ts');
const crmUi=read('src/crm/pages/CrmDashboardPage.tsx');
const attendApi=read('server/attendance.ts');
const attendUi=read('src/attendance/AttendancePage.tsx');
const css=read('src/styles.css');
check('CRM original clients remain in sales statuses irrespective of the chosen date',()=>{
  assert.match(crmApi,/l\.status_label is distinct from 'غير مؤهل'/);
  assert.doesNotMatch(crmApi,/l\.status_label='تم البيع'[\s\S]{0,140}period_sale\.sale_at is not null/);
  assert.match(crmApi,/l\.status_label is distinct from 'غير مؤهل'[\s\S]*?and \(\$\{branch \|\| null\}/);
});
check('CRM only nonqualified leads use date of status change, not last general update',()=>{
  assert.match(crmApi,/e\.new_status='غير مؤهل'/);
  assert.match(reportApi,/e\.new_status='غير مؤهل'/);
  const main=crmApi.slice(crmApi.indexOf('-- Keep historic customers'),crmApi.indexOf('and (${branch || null}'));
  assert(!main.includes('l.updated_at'), 'Status date may not be based on a general update');
});
check('CRM report summary matches historical customer cohort only in dashboard mode',()=>{
  assert.match(reportApi,/\$\{dashboardPeriod\}::boolean and \(\s*l\.status_label is distinct from 'غير مؤهل'/);
  assert.match(reportApi,/not \$\{dashboardPeriod\}::boolean[\s\S]{0,140}\$\{reportDateSql\}/);
  assert.match(reportApi,/dashboardPeriod \? distinctCustomers/);
  assert.match(reportApi,/const facts = allFacts/);
});
check('CRM reports filter canonical sales by sale date in dashboard and reports',()=>{
  assert.match(reportApi,/and \(\$\{from \|\| null\}::date is null or \$\{manualSaleDateSql\}/);
  assert.match(reportApi,/and \(\$\{to \|\| null\}::date is null or \$\{manualSaleDateSql\}/);
  assert.doesNotMatch(reportApi,/\(\$\{dashboardPeriod\}::boolean or \$\{from \|\| null\}::date is null or \$\{manualSaleDateSql\}/);
  assert.match(crmUi,/loadDashboard\(true\);\s*void loadReportSummary\(true\)/);
});
check('Attendance UI retrieves date-specific shift assignments before enabling time inputs',()=>{
  assert.match(attendUi,/view: "report", from: permissionDate, to: permissionDate, employeeIds: permissionSelectedIds/);
  assert.match(attendUi,/selectEarlyDeparturePeriod/);
  assert.match(attendUi,/فترة الدوام/);
  assert.match(attendUi,/disabled=\{!chosen \|\| earlyDepartureSaving\}/);
});
check('Attendance saves the chosen period and validates it server-side',()=>{
  assert.match(attendApi,/const periodId = clean\(source\.periodId\)/);
  assert.match(attendApi,/EARLY_DEPARTURE_PERIOD_REQUIRED/);
  assert.match(attendApi,/selectedPeriods\.find\(period => clean\(period\.id\) === item\.periodId\)/);
  assert.match(attendApi,/timeMinutes\(item\.fromTime\) >= timeMinutes\(selectedShift\.startTime\)/);
  assert.match(attendApi,/timeMinutes\(item\.toTime\) <= timeMinutes\(selectedShift\.endTime\)/);
});
check('Friday period is evening only both in UI and API',()=>{
  assert.match(attendUi,/friday && period\.name === "الفترة المسائية" \? "friday"/);
  assert.match(attendApi,/item\.periodId !== "friday"/);
  assert.match(attendApi,/name: "الفترة المسائية", startTime: fridayFrom, endTime: fridayTo/);
});
check('Attendance uses actual shift schedule and keeps existing permission table',()=>{
  assert.match(attendApi,/resolveAssignedPeriodTimes\(period, overrides\[clean\(period\.id\)\]\)/);
  assert.match(attendApi,/insert into core\.attendance_early_departure_permissions/);
  assert.match(css,/attendance-permission-shift-times/);
});
const fails=tests.filter(x=>!x[1]);
console.log(`CRM date scope and attendance period regression: ${tests.length-fails.length}/${tests.length}`);
if(fails.length) process.exit(1);
