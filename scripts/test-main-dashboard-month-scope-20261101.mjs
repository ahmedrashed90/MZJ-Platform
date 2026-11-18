import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = file => readFileSync(file, 'utf8');
const source = read('server/_dashboard-data.ts');
const cohort = read('server/_crm-customer-cohort.ts');
const crmDetail = read('server/crm/dashboard.ts');
const ui = read('src/pages/DashboardPage.tsx');
let passed = 0;
function check(name, assertion) {
  assertion();
  passed++;
  console.log(`PASS: ${name}`);
}
const registrationSql = source.split('with scoped_input as (')[1]?.split('), scoped_leads as (')[0] || '';
const saleSql = source.split('), scoped_sold as (')[1]?.split('), open_counts as (')[0] || '';
const cohorts = source.split('), scoped_leads as (')[1]?.split('), scoped_sold as (')[0] || '';

check('Main dashboard unique customer cohort is strictly registration-date scoped', () => {
  assert.match(registrationSql, /crmRegisteredCustomerCohortSql\(sql, from, to\)/);
  assert.match(registrationSql, /crmVisibleCustomerCohortSql\(sql, from, to\)/);
  assert.match(registrationSql, /visibleLeadScope/);
  assert.match(cohorts, /distinct on \(coalesce\(nullif\(l\.phone_normalized/);
});
check('Conversations and unanswered counts only include scoped monthly leads', () => {
  assert.match(source, /join scoped_leads l on l\.id=c\.lead_id/);
  assert.match(source, /from scoped_leads l where l\.status_label='لم يتم الرد'/);
});
check('Department total and reps share the same monthly customer population', () => {
  assert.match(source, /from scoped_leads l\s+left join core\.users u/);
  assert.match(source, /from scoped_leads\s*`/);
  for (const key of ['cash_sales','finance_sales','customer_service','other_customers']) assert.ok(source.includes(`as ${key}`));
});
check('Sales count is a separate transaction cohort filtered by Riyadh sale time', () => {
  assert.match(saleSql, /from crm\.sales_transactions st/);
  assert.doesNotMatch(saleSql, /scoped_leads/);
  assert.match(saleSql, /st\.sale_at at time zone 'Asia\/Riyadh'/);
  assert.match(saleSql, /between \$\{from\}::date and \$\{to\}::date/);
  assert.match(saleSql, /coalesce\(st\.is_cancelled,false\)=false/);
});
check('Interval filters bind as SQL parameters instead of user-controlled SQL strings', () => {
  const compiled = ts.transpileModule(cohort, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const obj={exports:{}};
  vm.runInNewContext(`(function(exports,module){${compiled}\n})`)(obj.exports,obj);
  const sql=(strings,...params)=>({sql:strings.join('?'),params});
  const result=obj.exports.crmRegisteredCustomerCohortSql(sql,'2026-11-01','2026-11-30');
  assert.ok(result.params.includes('2026-11-01'));
  assert.ok(result.params.includes('2026-11-30'));
  assert.doesNotMatch(result.sql,/2026-11-01|2026-11-30/);
  assert.match(result.sql,/Asia\/Riyadh/);
});
check('All dashboard requests use applied date range; initial range is full Saudi month', () => {
  assert.match(ui,/new URLSearchParams\(appliedRange\)/);
  assert.match(ui,/function defaultDashboardRange/);
  assert.match(ui,/return dashboardMonthRange\(riyadhDateKey\(new Date\(\)\)\.slice\(0, 7\)\)!/);
});
check('Main dashboard customer drilldowns follow the same registration month cohort', () => {
  assert.match(ui,/dateBasis: "platform_dashboard"/);
  assert.match(crmDetail,/dateBasis === "platform_dashboard"/);
  assert.match(crmDetail,/crmRegisteredCustomerCohortSql\(sql/);
  assert.match(crmDetail,/crmVisibleCustomerCohortSql\(sql/);
});
check('Dated-sales detail includes prior-month customers with sales in selected month', () => {
  assert.match(ui,/salesInRange: "1"/);
  assert.match(ui,/"تم البيع"[^\n]+\(\) => true, true\)/);
  assert.match(crmDetail,/from crm\.sales_transactions range_sale/);
  assert.match(crmDetail,/range_sale\.sale_at at time zone 'Asia\/Riyadh'/);
});
check('Existing status-cohort logic remains intact for CRM-specific dashboards', () => {
  assert.match(cohort,/l\.status_label is distinct from 'غير مؤهل'/);
  assert.match(crmDetail,/crmVisibleCustomerCohortSql\(sql, from \|\| null, to \|\| null\)/);
});
console.log(`Dashboard month-scope regressions: ${passed}/${passed} passed.`);
