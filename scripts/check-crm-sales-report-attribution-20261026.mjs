import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const report = read('server/crm/reports.ts');
const page = read('src/crm/pages/CrmReportsPage.tsx');
const [detail, agentSold, agentGeneral, facts] = [
  ['const soldDetailRows = await sql<any[]>`', 'const detailTotal = Number(soldDetailRows'],
  ['const soldAgentDetailRows = await sql<any[]>`', 'const detailTotal = Number(soldAgentDetailRows'],
  ['const agentDetailRows = await sql<any[]>`', 'const detailTotal = Number(agentDetailRows'],
  ['const salesFacts = await sql<any[]>`', 'const [storedQuality]'],
].map(([start,end]) => {
  const i = report.indexOf(start), j = report.indexOf(end,i);
  assert(i >= 0 && j > i, `Missing report query ${start}`);
  return report.slice(i,j);
});

const checks = [
  ['Sales totals use a single source and vehicle quantities', facts.includes('from crm.sales_transactions st') && report.includes('const soldCount = facts.reduce(') && report.includes('Math.max(1, Number(fact.quantity || 1))')],
  ['All four sales/report drill-down queries filter on the sale branch, not the current CRM branch', [detail,agentSold,agentGeneral,facts].every(part => part.includes('(${transactionBranchCodeSql})=${branch || null}') && !part.includes('then ${transactionCurrentBranchCodeSql} else'))],
  ['Current representative branch remains the access-control boundary', [detail,agentSold,agentGeneral,facts].every(part => part.includes('(${transactionCurrentBranchCodeSql})=any(${scope.branchCodes}::text[])'))],
  ['Cash/finance rollup does not merge wholesale sales', report.includes('if (CASH_BRANCH_ROLLUP_CODES.has(branch)') && report.includes('return department;')],
  ['Sale details are built exclusively from period-filtered transaction rows', detail.includes('matched_sales as (') && detail.includes('in_period_sales as (') && detail.includes('from matched_sales') && detail.includes('latest_sale as (')],
  ['Sale detail branch and salesperson come from the transaction matched to the period', detail.includes('t.department_code,t.branch_code') && detail.includes('t.assigned_to') && detail.includes('t.assigned_name') && detail.includes('t.branch_name')],
  ['Sale detail uses current period order references instead of the first registration order', detail.includes('s.sales_order_numbers') && detail.includes("'طلبات البيع: '||s.sales_order_numbers") && !detail.includes('l.report_branch_code as branch_code')],
  ['One customer can own several sale orders while displayed vehicle quantity sums the matching orders', detail.includes('group by lead_id') && detail.includes('coalesce(sum(quantity),0)::int as sold_quantity') && detail.includes('string_agg(distinct source_reference,')],
  ['Representative sold report keeps transactions even without a currently assigned customer', report.includes('.filter((row) => Number(row.total || 0) >= 1 || Number(row.sold || 0) > 0)')],
  ['Customer/report terminology remains تم البيع', page.includes('تم البيع') && report.includes("'تم البيع'::text as status_label")],
  ['No DDL or persistence mutations are introduced in reporting handler', !/\b(?:alter table|drop table|create table|update crm\.|delete from crm\.|insert into crm\.)\b/i.test(report)],
];
for (const [label, pass] of checks) {
  if (!pass) throw new Error(`FAIL: ${label}`);
  console.log(`PASS: ${label}`);
}
console.log(`CRM sales report attribution 2026-10-26: ${checks.length}/${checks.length} passed`);
