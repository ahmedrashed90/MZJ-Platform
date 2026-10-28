import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const sync = fs.readFileSync('server/_erpnext-sales-order-sync.ts', 'utf8');
const reports = fs.readFileSync('server/crm/reports.ts', 'utf8');
const marketing = fs.readFileSync('src/marketing/workflow/workflow.css', 'utf8');
const manual = fs.readFileSync('server/crm/manual-leads.ts', 'utf8');
const parsed = ts.createSourceFile('server/_erpnext-sales-order-sync.ts', sync, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
assert.equal(parsed.parseDiagnostics.length, 0, 'ERP sync source must be syntactically valid TS');
const functionNamed = (name) => parsed.statements.find(x => ts.isFunctionDeclaration(x) && x.name?.text === name);
const upsert = functionNamed('upsertErpNextSalesTransaction');
const link = functionNamed('linkCrmCustomer');
assert.ok(upsert && link, 'Expected canonical ERP integration functions');

// Exercise the real TypeScript sales-transaction function against a tagged SQL recorder.
const transpiled = ts.transpileModule(upsert.getText(parsed), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const queryCalls = [];
function makeTx(existing = []) {
  return Object.assign(async (segments, ...args) => {
    const query = segments.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
    queryCalls.push({ query, args });
    if (query.startsWith('select id::text,source_type,')) return existing;
    if (query.startsWith('insert into crm.sales_transactions(') && query.includes('on conflict(')) return [{ id: 'created-sale-id' }];
    if (query.startsWith('update crm.sales_transactions set')) return [{ id: 'updated-sale-id' }];
    throw Error(`Unexpected query: ${query.slice(0,130)}`);
  }, { json: (value) => value });
}
const clean = value => value == null ? '' : String(value).trim();
const context = { clean, numberValue: Number, erpSalesOrderQuantity: () => 1 };
vm.runInNewContext(`${transpiled}\nthis.exposed = upsertErpNextSalesTransaction;`, context);
const syncTransaction = context.exposed;
const common = {
  orderId: 'erp-order-1', leadId: 'lead-1', normalized: {
    crmSourceCode: 'next_erp', crmSourceName: 'NEXT ERP', sourceInstanceKey: 'erp:order-1',
    orderNo: 'SAL-ORD-TEST-1', erpCreatedAt: '2026-10-23', erpUserId: 'erp-user', erpSalesPerson: 'ERP Salesperson', grandTotal: 42000,
  }, saleAt: '2026-10-23T00:00:00.000Z',
  mapping: { id: 'mapped-erp-id', full_name: 'ERP Salesperson' },
  departmentCode: 'wholesale', branchCode: 'qadisiyah',
  firstPayload: { item: { type: 'car', category: 'SUV' } },
};
const assertAcquisition = ({ query, args }, code, name) => {
  assert.ok(query.includes('source_code=') || query.includes('source_code,source_name,'), 'Sale row must snapshot acquisition source');
  assert.ok(args.includes(code), `Expected acquisition source ${code} in transaction args`);
  assert.ok(args.includes(name), `Expected acquisition name ${name} in transaction args`);
  const metadata = args.find(x => x?.origin === 'erpnext-sales-order');
  assert.ok(metadata, 'ERP metadata must remain available');
  assert.equal(metadata.crmSourceCode, 'next_erp', 'Keep technical ERP origin separate in metadata');
  assert.equal(metadata.leadAcquisitionSourceCode, code);
  assert.equal(metadata.leadAcquisitionSourceName, name);
};
const transactionArgs = async (leadSourceCode, leadSourceName, existing = []) => {
  queryCalls.length = 0;
  await syncTransaction(makeTx(existing), { ...common, leadSourceCode, leadSourceName });
  return queryCalls.at(-1);
};
assertAcquisition(await transactionArgs('haraj','موقع حراج'), 'haraj','موقع حراج');
assertAcquisition(await transactionArgs('next_erp','NEXT ERP'), 'next_erp','NEXT ERP');
assertAcquisition(await transactionArgs('branch','خلال الفرع', [{ id: 'sale-1',source_type: 'erpnext_sales_order' }]), 'branch','خلال الفرع');
// Replayed ERP events must not replace a historical non-technical sale snapshot.
assertAcquisition(await transactionArgs('branch','خلال الفرع', [{ id: 'sale-2',source_type: 'erpnext_sales_order',source_code:'haraj',source_name:'موقع حراج' }]), 'haraj','موقع حراج');

const linkText = link.getText(parsed);
const originalUpdate = linkText.match(/\[lead\] = await tx`\s*(update crm\.leads[\s\S]*?)`;/)?.[1];
assert.ok(originalUpdate, 'Must identify existing CRM lead UPDATE statement');
for (const column of ['source_code','source_name','source_history','platform_code', 'service_key','department_code','branch_code', 'assigned_to','responsible_name_snapshot','payment_type','customer_name','phone','phone_normalized','car_name','car_category','car_model','color']) {
  assert.ok(!new RegExp(`\\b${column}\\s*=`).test(originalUpdate), `ERP sale must not overwrite an existing CRM lead's ${column}`);
}
assert.match(originalUpdate,/status_label='تم البيع'/, 'Existing lead becomes sold');
const requestUpdate = linkText.match(/update crm\.service_requests set([\s\S]*?)where id=\$\{existing\.current_request_id\}/)?.[1];
assert.ok(requestUpdate,'Request closing update must exist');
for (const column of ['source_code','department_code','branch_code','assigned_to','service_key']) {
  assert.ok(!new RegExp(`\\b${column}\\s*=`).test(requestUpdate), `Existing request must preserve ${column}`);
}
assert.ok(sync.includes("display_name=coalesce(nullif(display_name,''),nullif(${name},''))"), 'Existing contact names remain unchanged by ERP events');
assert.ok(sync.includes("primary_phone=coalesce(nullif(primary_phone,''),nullif(${phone},''))"), 'Existing contact phone remains unchanged by ERP events');
assert.ok(linkText.includes('leadSourceCode: clean(lead.source_code)'), 'Transaction attribution comes from saved CRM lead');
assert.ok(linkText.includes('${oldDepartment||null},${oldDepartment||null}'), 'Event must report unchanged CRM department');
assert.ok(linkText.includes('${oldBranch||null},${oldBranch||null}'), 'Event must report unchanged CRM branch');
assert.match(reports,/st\.source_type,''\)\) in \('erpnext_sales_order','erp_reconciliation'\)/, 'Reports must handle legacy ERP transaction snapshots');
assert.match(reports,/then case when lower\(l\.source_code\)/, 'Reports must use existing customer acquisition source over historical ERP order source');
assert.ok(manual.includes('const MANUAL_LEAD_SOURCE_CODE = "branch"'), 'Manual lead creation uses branch');
assert.ok(manual.includes('manual_duplicate_approved'), 'Manual duplicate workflow remains unmodified');
assert.match(marketing,/\.mkw-detail-overview > \.mkw-readiness progress::-webkit-progress-value \{ background:#16a34a; \}/, 'Task-level bar must be green');
assert.match(marketing,/\.mkw-requirement-item-readiness \.mkw-readiness/, 'Requirement-level styling must stay separate');
console.log('PASS: ERP Sale/CRM acquisition source, existing client scope, reports history, marketing task-only green regression checks');
