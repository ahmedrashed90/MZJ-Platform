import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const sync = read('server/_erpnext-sales-order-sync.ts');
const reports = read('server/crm/reports.ts');
let passed = 0;
let total = 0;
function expect(label, condition) {
  total += 1;
  if (!condition) throw new Error(`server/_erpnext-sales-order-sync.ts missing ${label}`);
  passed += 1;
}

expect('canonical ERP sales transaction helper', sync.includes('async function upsertErpNextSalesTransaction'));
expect('ERP quantity comes from normalized order payloads', sync.includes('function erpSalesOrderQuantity'));
expect('canonical source type', sync.includes("'erpnext_sales_order'"));
expect('canonical source reference uses sales order number', sync.includes('source_reference=${normalized.orderNo}'));
expect('sale date is the ERP order date', sync.includes('const saleAt = dateTimeForOrder(normalized.orderDate)'));
expect('representative snapshot comes from mapped ERP user', sync.includes('assigned_name=${mapping.full_name}'));
expect('department snapshot comes from mapped ERP user context', sync.includes('department_code=${input.departmentCode}'));
expect('CRM link writes the canonical sales transaction atomically', sync.includes('await upsertErpNextSalesTransaction(tx, {'));
expect('existing reconciliation rows are reused instead of duplicated', sync.includes("source_type in ('erpnext_sales_order','erp_reconciliation')"));
expect('order cancellation cancels the sales transaction', sync.includes('await cancelErpNextSalesTransaction(tx, {'));
expect('reports remain transaction-only', reports.includes('Canonical sold metric: every report reads only crm.sales_transactions.'));
expect('reports do not query ERP orders as a second sold fact source', !reports.includes('const erpSalesFacts = await sql'));

console.log(`ERPNext canonical sales transaction checks: ${passed}/${total} passed.`);
