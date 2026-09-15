import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const sync = read('server/_erpnext-sales-order-sync.ts');
const leads = read('server/crm/leads.ts');
const reports = read('server/crm/reports.ts');
const crmDashboard = read('server/crm/dashboard.ts');
const unifiedDashboard = read('server/_dashboard-data.ts');

const between = (text, start, end) => {
  const a = text.indexOf(start);
  if (a < 0) return '';
  const b = text.indexOf(end, a + start.length);
  return b < 0 ? text.slice(a) : text.slice(a, b);
};

const snapshotBlock = between(sync, 'export async function refreshCrmLeadSalesSnapshot', 'export async function cancelErpNextSalesOrder');
const leadSaleSummaryBlock = between(leads, 'left join lateral (\n      select coalesce(sum(greatest(coalesce(st.quantity,1),1)),0)::int as sold_count', ') sale_summary on true');
const agentSalesBlock = between(reports, 'agent_sale_rows as (', 'agent_sales as (');
const periodSaleBlock = between(crmDashboard, 'left join lateral (\n      select max(st.sale_at) as sale_at', ') period_sale on true');

let passed = 0;
let total = 0;
function expect(label, condition) {
  total += 1;
  if (!condition) throw new Error(`Canonical sold single-source check failed: ${label}`);
  passed += 1;
}

expect('lead sold snapshot is derived from crm.sales_transactions',
  snapshotBlock.includes('from crm.sales_transactions st') &&
  snapshotBlock.includes('coalesce(sum(greatest(coalesce(st.quantity,1),1)),0)::int as sold_quantity'));
expect('lead sold snapshot no longer sums integrations.erpnext_sales_orders',
  !snapshotBlock.includes('integrations.erpnext_sales_orders'));
expect('customer list sold_count reads transactions only',
  leadSaleSummaryBlock.includes('from crm.sales_transactions st') &&
  !leadSaleSummaryBlock.includes('integrations.erpnext_sales_orders'));
expect('representative customer report uses transaction rows only',
  agentSalesBlock.includes('from crm.sales_transactions st') &&
  !agentSalesBlock.includes('integrations.erpnext_sales_orders'));
expect('representative detail does not fall back to lead sold_quantity',
  reports.includes("case when s.lead_id is not null then s.sold_quantity else null end::int as sold_quantity"));
expect('CRM dashboard sold-period date uses transactions only',
  periodSaleBlock.includes('from crm.sales_transactions st') &&
  !periodSaleBlock.includes('integrations.erpnext_sales_orders'));
expect('unified dashboard has one scoped canonical sold source',
  unifiedDashboard.includes('), scoped_sold as (') &&
  !unifiedDashboard.includes('scoped_erp_sold') &&
  !unifiedDashboard.includes('scoped_manual_sold'));
expect('unified sold totals sum scoped_sold only',
  unifiedDashboard.includes('coalesce((select sum(quantity) from scoped_sold),0)::int as sold'));

console.log(`CRM canonical sold single-source checks: ${passed}/${total} passed.`);
