import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync('server/crm/reports.ts', 'utf8');
const validations = [];
const verify = (label, condition) => {
  assert.ok(condition, label);
  validations.push(label);
  console.log(`PASS: ${label}`);
};

const creator = source.match(/const assignedRepBranch = \(context: "effective" \| "base"\) => \{[\s\S]*?\n  \};/);
verify('central branch policy is explicitly scoped to effective-lead CTE or base table', Boolean(creator));
const sql = (parts, ...values) => parts.reduce((query, part, index) => query + String(values[index - 1] ?? '') + part, '');
const javascript = creator[0].replace('(context: "effective" | "base")', '(context)');
const factory = new Function('sql', `${javascript}\nreturn assignedRepBranch;`)(sql);
const effectiveQuery = factory('effective');
const transactionQuery = factory('base');

verify('effective lead queries reference CTE-projected assignment', effectiveQuery.includes('l.current_assigned_to') && effectiveQuery.includes('l.current_branch_code'));
verify('sales transaction queries reference real crm.leads columns', transactionQuery.includes('l.assigned_to') && transactionQuery.includes('l.branch_code'));
verify('sales transaction queries never reference virtual current_* lead columns', !/l\.current_(?:assigned_to|branch_code)/.test(transactionQuery));
verify('both query contexts enforce CRM user-system branch assignments', [effectiveQuery, transactionQuery].every(text => text.includes('core.user_system_branches') && text.includes("usb.system_code='crm'")));
verify('both query contexts fall back to active legacy assignments only when no CRM-specific assignment exists', [effectiveQuery, transactionQuery].every(text => text.includes('core.user_branches') && text.includes('core.user_system_branches usb0') && text.includes('b.is_active=true')));
verify('an assigned user does not fall back to a stale customer branch', [effectiveQuery, transactionQuery].every(text => /case when l\.[a-z_]+ is null then nullif\(l\.[a-z_]+,''\)\s+else coalesce\(/.test(text)));
verify('separate reports expressions use matching schema context', source.includes('const currentLeadBranchCodeSql = assignedRepBranch("effective")') && source.includes('const transactionCurrentBranchCodeSql = assignedRepBranch("base")'));
const salesFactsStart = source.indexOf('const salesFacts = await sql<any[]>`');
const salesFactsEnd = source.indexOf('const [storedQuality]', salesFactsStart);
const salesFacts = source.slice(salesFactsStart, salesFactsEnd);
verify('sales facts select raw crm.leads and use the base-table branch expression', salesFacts.includes('left join crm.leads l on l.id=st.lead_id') && salesFacts.includes('(${transactionCurrentBranchCodeSql})=any(${scope.branchCodes}::text[])'));
verify('sales facts use no effective-only branch fragment in select, join or filter', !salesFacts.includes('currentLeadBranchCodeSql') && (salesFacts.match(/transactionCurrentBranchCodeSql/g) || []).length >= 5);
verify('sale attribution continues to use the historical sale branch', salesFacts.includes('(${transactionBranchCodeSql}) as branch_code') && salesFacts.includes('then ${transactionCurrentBranchCodeSql} else (${transactionBranchCodeSql}) end'));
verify('no database schema mutation is introduced by the report fix', !/\b(?:alter table|drop table|create table)\b/i.test(salesFacts));
console.log(`CRM reports SQL query-context checks: ${validations.length}/${validations.length} passed`);
