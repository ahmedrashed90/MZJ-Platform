import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const sync = read('server/_erpnext-sales-order-sync.ts');
const reconcile = read('database/reconcile-duplicate-erp-sales-transactions.sql');
let passed = 0;
let total = 0;
function expect(label, condition) {
  total += 1;
  if (!condition) throw new Error(`ERP sales dedup reconciliation missing ${label}`);
  passed += 1;
}

expect('runtime lookup includes cancelled rows so a prior canonical row can be reused',
  sync.includes('select id::text,source_type,coalesce(is_cancelled,false) as is_cancelled') &&
  sync.includes('where source_reference=${normalized.orderNo}') &&
  !sync.includes('where source_reference=${normalized.orderNo}\n      and coalesce(is_cancelled,false)=false'));
expect('runtime prefers the canonical ERP row even if it was previously cancelled',
  sync.includes("when source_type='erpnext_sales_order' then 0"));
expect('runtime cancels only active extra rows',
  sync.includes('id<>${existing.id}::uuid') && sync.includes('and coalesce(is_cancelled,false)=false'));
expect('reconciliation scopes duplicates to active ERP Sales Orders',
  reconcile.includes('CREATE TEMP TABLE _erp_active_orders') && reconcile.includes('coalesce(so.is_cancelled,false)=false'));
expect('reconciliation no longer excludes ERP orders whose crm_lead_id is null',
  !reconcile.includes('AND so.crm_lead_id IS NOT NULL') && !reconcile.includes('and so.crm_lead_id is not null'));
expect('reconciliation can resolve the lead from the normalized customer phone',
  reconcile.includes('phone_normalized=latest.actual_customer_phone_normalized'));
expect('reconciliation falls back to a unanimous duplicate transaction lead',
  reconcile.includes('d.distinct_active_leads=1') && reconcile.includes('d.unanimous_lead_id'));
expect('ambiguous lead conflicts stop before updates',
  reconcile.indexOf('Canonical sales reconciliation stopped safely') < reconcile.indexOf('UPDATE crm.sales_transactions st'));
expect('canonical row selection can reuse a cancelled ERP canonical row',
  reconcile.includes("WHEN st.source_type='erpnext_sales_order' THEN 0"));
expect('only extra active rows are cancelled',
  reconcile.includes('st.id<>c.canonical_id') && reconcile.includes('coalesce(st.is_cancelled,false)=false'));
expect('final verification uses the exact same active ERP order scope',
  reconcile.includes('JOIN _erp_active_orders erp') && reconcile.includes('HAVING count(*)>1'));
expect('script commits only after the final duplicate invariant',
  reconcile.lastIndexOf('COMMIT;') > reconcile.lastIndexOf('Canonical sales reconciliation failed'));

console.log(`ERP sales dedup reconciliation checks: ${passed}/${total} passed.`);
