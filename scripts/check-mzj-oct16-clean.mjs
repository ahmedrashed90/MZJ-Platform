import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const read = (file) => readFileSync(file, 'utf8');
const checks = [];
function check(name, fn) {
  try { fn(); console.log('PASS: ' + name); checks.push(true); }
  catch (error) { console.error('FAIL: ' + name + ': ' + error.message); checks.push(false); }
}
const crm = read('server/crm/dashboard.ts'), reports = read('server/crm/reports.ts');
const crmUi = read('src/crm/pages/CrmDashboardPage.tsx');
const dash = read('server/_dashboard-data.ts'), dashUi = read('src/pages/DashboardPage.tsx');
const attendance = read('server/attendance.ts'), schema = read('server/_attendance-schema.ts'), attendUi = read('src/attendance/AttendancePage.tsx');
const importer = read('server/_crm-sheet-import.ts'), manual = read('src/crm/pages/CrmManualLeadsPage.tsx');
const marketing = read('src/marketing/workflow/CreatePage.tsx'), marketingDashboard = read('src/marketing/pages/MarketingDashboardPage.tsx');
check('Historic sold customers remain in CRM status columns', () => { assert.match(crm, /crmVisibleCustomerCohortSql/); assert.doesNotMatch(crm, /dated_sale\.sale_at/); });
check('Period sales are transaction facts filtered by sale_at in both dashboard and reports', () => { assert.match(reports, /const facts = allFacts/); assert.match(reports, /and \(\$\{from \|\| null\}::date is null or \$\{manualSaleDateSql\} >=/); assert.match(reports, /and \(\$\{to \|\| null\}::date is null or \$\{manualSaleDateSql\} <=/); assert.doesNotMatch(reports,/and \(\$\{dashboardPeriod\}::boolean or \$\{from/); });
check('Dashboard revenue and quality metrics are real facts and configurable qualified group', () => { assert.match(reports, /qualifiedStatuses = setOf\(quality\.qualified_statuses/); assert.match(reports, /marketingQuality: percent\(count\(/); assert.match(reports, /\+ soldCount, total\)/); assert.match(reports, /salesQuality: percent\(soldCount, total\)/); assert.match(crmUi, /const facts = matchingSnapshot \? reportSummary\?\.totals/); assert.match(crmUi, /reportSummary\?\.quality\?\.qualified_statuses/); });
check('Dashboard department distribution reconciles to the KPI while reps remain unique', () => { assert.match(dash, /as total_customers/); assert.match(dash, /as unique_customers/); assert.match(dash, /from scoped_sold/); assert.match(dash, /department_activity as/); assert.match(dash, /count\(\*\)::int as total_customers/); assert.match(dashUi, /crm\?\.totalCustomers \?\? null/); assert.match(dashUi, /مجموع الأقسام مطابق لإجمالي العملاء/); });
check('Whole-month and week labels use selected date window and correct counting', () => { assert.match(dashUi, /dashboardRangeIsMonthly/); assert.match(dashUi, /dashboardRangeIsWeekly/); assert.match(dashUi, /جدد هذا الشهر/); assert.match(dashUi, /جدد هذا الأسبوع/); assert.match(dash, /as new_in_range/); });
check('Excel customer template preserves phone strings, import works with configured source', () => { assert.match(manual, /downloadXlsx\("MZJ-CRM-Leads-Template.xlsx"/); assert.match(importer, /from core.sources/); assert.match(importer, /resolveSource/); assert.match(importer, /findExistingPhone\(check.phoneNormalized/); assert.match(manual, /استيراد العملاء/); });
check('Marketing executor picker is flat and holds canonical department+person ID', () => { assert.match(marketing, /new Map\(meta.departments.flatMap/); assert.match(marketing, /changeItem\(item.key, \{ departmentId/); assert.doesNotMatch(marketing, /<optgroup key=\{department.id\}/); });
check('Marketing delivery badges hide empty categories', () => { assert.match(marketingDashboard, /submitted_on_time_count \?\? 0\) > 0/); assert.match(marketingDashboard, /submitted_late_count \?\? 0\) > 0/); });
check('Attendance permission type and reason are stored with idempotent schema columns', () => { assert.match(schema, /add column if not exists permission_type/); assert.match(schema, /add column if not exists reason/); assert.match(attendance, /permissionType !== 'departure'/); assert.match(attendance, /item\.reason/); });
check('Attendance permission delete reverts only exact authorized checkouts and requires admin', () => { assert.match(attendance, /deleteEarlyDeparturePermission/); assert.match(attendance, /checkout_source='authorized'/); assert.match(attendance, /early_departure_from_at=\$\{permission.from_at\}/); assert.match(attendUi, /window.confirm/); });
check('Attendance expected, actual, and difference columns are in daily view and exports', () => { for (const c of ['ساعات الدوام المفترضة', 'ساعات العمل الفعلية','الفرق (فعلي − مفترض)']) assert.ok(attendUi.includes(c)); assert.doesNotMatch(attendUi, /className="attendance-hours-summary panel"/); assert.match(attendUi, /ATTENDANCE_SUMMARY_HEADERS/); assert.match(attendUi, /ATTENDANCE_DETAILS_HEADERS/); });
const succeeded = checks.filter(Boolean).length;
console.log(`MZJ Oct 16 source assertions: ${succeeded}/${checks.length}`);
if (succeeded !== checks.length) process.exit(1);
