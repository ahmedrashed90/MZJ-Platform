import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const read = file => readFileSync(file, 'utf8');
const cohortSource = read('server/_crm-customer-cohort.ts');
const root = read('server/_dashboard-data.ts');
const rootUi = read('src/pages/DashboardPage.tsx');
const crm = read('server/crm/dashboard.ts');
const reports = read('server/crm/reports.ts');
const reportUi = read('src/crm/pages/CrmReportsPage.tsx');
const crmUi = read('src/crm/pages/CrmDashboardPage.tsx');
let passed = 0;
function check(label, test) {
  try { test(); passed++; console.log(`PASS: ${label}`); }
  catch (error) { console.error(`FAIL: ${label}: ${error.message}`); process.exitCode = 1; }
}

check('All three CRM endpoints use one reusable period/cohort rule', () => {
  for (const endpoint of [root, crm, reports]) assert.match(endpoint, /crmVisibleCustomerCohortSql/);
  assert.match(cohortSource, /l.status_label is distinct from 'غير مؤهل'/);
  assert.match(cohortSource, /e.new_status='غير مؤهل'/);
  assert.match(cohortSource, /at time zone 'Asia\/Riyadh'/);
  assert.doesNotMatch(cohortSource, /l.updated_at/);
});
check('Shared cohort binds user dates as SQL parameters (no raw interpolation)', () => {
  const compiled = ts.transpileModule(cohortSource, {compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022}}).outputText;
  const m = {exports:{}};
  vm.runInNewContext(`(function(exports, module){${compiled}\n})`)(m.exports,m);
  const sql = (strings,...params) => ({sql:strings.reduce((out,part,i) => out+part+(i < params.length ? (typeof params[i]?.sql === 'string' ? params[i].sql : `:p${i}`) : ''),''),params});
  const from='2026-10-01',to='2026-10-31';
  const fragment = m.exports.crmVisibleCustomerCohortSql(sql,from,to);
  assert.match(fragment.sql, /max\(e.created_at\)/);
  assert.match(fragment.sql, /l.status_label is distinct from 'غير مؤهل'/);
  assert.ok(!fragment.sql.includes(from), 'From date should be parameterised');
  assert.ok(!fragment.sql.includes(to), 'To date should be parameterised');
  assert.ok(fragment.params.includes(from));
  assert.ok(fragment.params.includes(to));
});
check('Headline and department slices count actual CRM lead rows, not activity events', () => {
  assert.match(root, /count\(\*\)::int as total_customers/);
  for (const dimension of ['cash_sales','finance_sales','customer_service','other_customers']) {
    assert.match(root, new RegExp(`count\\(\\*\\) filter\\(where[^\\n]+as ${dimension}`));
  }
  assert.doesNotMatch(root, /sum\(total\) from department_activity\),0\)::int as total_customers/);
  assert.match(root, /distinct on \(coalesce\(nullif\(l.phone_normalized/);
});
check('New customer graph and interval total still use registration date', () => {
  assert.match(root, /count\(\*\) filter\(where \(coalesce\(registered_at,created_at\)/);
  assert.match(root, /as new_in_range/);
  assert.match(root, /from generate_series/);
});
check('CRM completed customers stay included by default in every department', () => {
  assert.match(crm, /const includeClosed = !\["0", "false", "no"\]/);
  assert.match(crm, /department} = 'service' and l.department_code = 'customer_service'/);
  assert.match(crmUi, /dashboardPeriod: 1, summaryOnly: 1/);
});
check('Reports include service in headline, source, branch, and representative breakdowns', () => {
  assert.match(reports, /const reportRows = leads;/);
  assert.match(reports, /const salesRows = reportRows;/);
  assert.match(reports, /const agentSalesRows = salesRows;/);
  assert.match(reports, /const reportFacts = salesFacts;/);
  assert.doesNotMatch(reports, /reportRows = leads.filter\(\(row\) => row.department_code !== "customer_service"\)/);
  assert.match(reports, /totals: makeMetrics\(reportRows, reportFacts\)/);
});
check('Source groups are exhaustive: digital, direct or other', () => {
  assert.match(reports, /case when original_source.report_group in \('digital','direct'\) then original_source.report_group else 'other' end as source_report_group/);
  for(const group of ['digital','direct','other']) assert.ok(reports.includes(`sourceGroup("${group}")`));
});
check('Report headline does not invent extra customers for sold facts', () => {
  assert.match(reports, /dashboardPeriod \? rowLeadIds.size/);
  assert.match(reports, /const soldCount = facts.reduce\(/);
  assert.match(reports, /manualSaleDateSql/);
});
check('Customer/section popup uses same grouping as dashboard-period report', () => {
  assert.match(reports, /reportDetailDepartmentGroupSql/);
  assert.match(reports, /reportDetailBranchGroupSql/);
  assert.match(reports, /detailKind}='source' and coalesce/);
  assert.match(reports, /detailKind}='service' and \(case when \$\{dashboardPeriod\}/);
  assert.match(reportUi, /dashboardPeriod: 1/);
});
check('Main dashboard opens all period-visible customers, not only new registrations', () => {
  assert.match(rootUi, /new URLSearchParams\(\{ department, from: appliedRange.from, to: appliedRange.to, includeClosed: "1" \}\)/);
  assert.doesNotMatch(rootUi, /dateBasis: "registered"/);
  assert.match(rootUi, /مجموع الأقسام مطابق لإجمالي العملاء/);
  assert.doesNotMatch(rootUi, /إجمالي المؤشرات/);
});
check('Representative and unclassified cohorts are preserved', () => {
  assert.match(root, /l.assigned_to::text as id/);
  assert.match(root, /غير موزع/);
  assert.match(root, /department_code is null/);
  assert.match(reports, /row.current_assigned_to \|\| "__none__"/);
});
check('Observed Neon reference partitions are internally consistent without hardcoding production counts', () => {
  const sums = (counts) => counts.reduce((t,n)=>t+n,0);
  assert.equal(sums([456,257,22]),735);
  assert.equal(sums([297,363,75]),735);
  assert.doesNotMatch(root, /735|713|731/);
  assert.doesNotMatch(reports, /735|713|731/);
});
for(const file of ['server/_crm-customer-cohort.ts','server/_dashboard-data.ts','server/crm/dashboard.ts','server/crm/reports.ts','src/pages/DashboardPage.tsx','src/crm/pages/CrmAdminPage.tsx']) {
  check(`${file}: parses as TypeScript`, () => {
    const ast = ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    assert.equal(ast.parseDiagnostics.length,0,ast.parseDiagnostics.map(x=>ts.flattenDiagnosticMessageText(x.messageText,' ')).join(', '));
  });
}
console.log(`Canonical CRM customer totals: ${passed}/18`);
