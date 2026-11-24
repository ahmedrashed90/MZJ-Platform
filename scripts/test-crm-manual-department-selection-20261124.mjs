import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const page = readFileSync('src/crm/pages/CrmManualLeadsPage.tsx', 'utf8');
const backend = readFileSync('server/crm/manual-leads.ts', 'utf8');

// The selector must be visible, explicit, and part of the payload saved by the form.
assert.match(page, /<span>القسم<\/span><select value=\{form\.serviceKey\}/);
assert.match(page, /<option value="cash">مبيعات الكاش<\/option>/);
assert.match(page, /<option value="finance">مبيعات التمويل<\/option>/);
assert.match(page, /<option value="">اختر القسم<\/option>/);
assert.match(page, /!isDepartmentChosen/);
assert.match(page, /body: JSON\.stringify\(editingId \? \{ \.\.\.form, id: editingId, action: "edit" \} : form\)/);
assert.match(page, /const activeServiceKey = form\.serviceKey;/);
assert.doesNotMatch(backend, /chooseAssignment\(|chooseCallCenterAssignment\(/);
assert.match(backend, /const assignedTo = user\.id;/);
assert.match(backend, /const departmentCode = salesDepartmentCode\(serviceKey\);/);
assert.match(backend, /const paymentType = paymentTypeForService\(serviceKey\);/);

// Compile the real API handler and run it against a small in-memory SQL stub.
// No production database, secrets, or network calls are used.
let ts;
try { ts = require('typescript'); }
catch { ts = require(join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript')); }
const transpile = (text, fileName) => {
  const out = ts.transpileModule(text, { fileName, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  const errors = (out.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `${fileName}: ${errors.map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')).join('\n')}`);
  return out.outputText;
};
transpile(page, 'CrmManualLeadsPage.tsx');
const handlerJs = transpile(backend, 'manual-leads.ts');

const user = { id: 'agent-uuid', fullName: 'Sales agent', roles: [], departmentCodes: ['cash_sales'] };
const clean = value => String(value ?? '').trim();

function makeHandler({ duplicate = false, editing = false, service = 'cash' } = {}) {
  const calls = [];
  const effects = { notifications: 0, attached: 0, audit: [] };
  async function sql(strings, ...values) {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    calls.push({ text, values });
    if (text.includes('from core.users u') && text.includes('department.code as department_code'))
      return [{ department_code: 'cash_sales', branch_code: 'showroom' }];
    if (text.includes('from crm.manual_lead_requests where id='))
      return editing ? [{ id: 'request-uuid', created_lead_id: null, requested_by: user.id,
        requested_assigned_to: user.id, service_key: service, department_code: service === 'finance' ? 'finance_sales' : service === 'service' ? 'customer_service' : 'cash_sales',
        branch_code: 'showroom', approval_status: 'pending' }] : [];
    if (text.includes('from crm.leads where phone_normalized='))
      return duplicate ? [{ id: 'existing-uuid', customer_name: 'Existing' }] : [];
    if (text.startsWith('select id::text,customer_name from crm.leads'))
      return duplicate ? [{ id: 'existing-uuid', customer_name: 'Existing' }] : [];
    if (text.includes('insert into crm.manual_lead_requests')) return [{ id: 'request-uuid' }];
    if (text.includes('insert into crm.leads')) return [{ id: 'created-uuid' }];
    return [];
  }
  sql.begin = fn => fn(sql);
  const deps = {
    '../_crm-utils.js': {
      audit: async (...items) => effects.audit.push(items),
      branchForDepartment: () => 'showroom', calculateLeadCompletion: () => 20,
      clean, isCrmManager: () => false,
      normalizePhone: phone => clean(phone) ? '966500000000' : '',
      parseBody: request => request.body,
      requireCrmUser: async () => user,
      resolveSourceName: async () => 'خلال الفرع',
    },
    '../_db.js': { getSql: () => sql },
    '../_crm-customer-fields.js': { getCustomerFieldDefinitions: async () => [] },
    '../_crm-lifecycle.js': { attachLeadToContactAndOpenRequest: async () => { effects.attached++; } },
    '../_notifications.js': { emitCrmLeadNotification: async () => { effects.notifications++; } },
  };
  const module = { exports: {} };
  runInNewContext(handlerJs, { module, exports: module.exports, require: id => {
    assert.ok(id in deps, `Unexpected dependency ${id}`);
    return deps[id];
  }, console }, { filename: 'server/crm/manual-leads.js' });
  return { handler: module.exports.default, calls, effects };
}

async function call(handler, method, body) {
  const response = { code: null, data: null,
    status(value) { this.code = value; return this; },
    json(value) { this.data = value; return this; } };
  await handler({ method, body, query: {} }, response);
  return response;
}
function findCall(calls, expression) {
  const found = calls.find(c => expression.test(c.text));
  assert.ok(found, `Expected SQL call matching ${expression}`);
  return found;
}

let passed = 0;
for (const [serviceKey, departmentCode, paymentType] of [
  ['cash', 'cash_sales', 'كاش'], ['finance', 'finance_sales', 'تمويل'],
]) {
  const { handler, calls, effects } = makeHandler();
  const res = await call(handler, 'POST', { customerName: 'Real customer', phone: '0500000000', serviceKey });
  assert.equal(res.code, 201);
  assert.equal(res.data.approvalStatus, 'approved');
  for (const table of ['crm.manual_lead_requests', 'crm.leads']) {
    const query = findCall(calls, new RegExp(`insert into ${table.replaceAll('.', '\\.')}`));
    assert.deepEqual(query.values.slice(table === 'crm.leads' ? 5 : 4, table === 'crm.leads' ? 9 : 8),
      table === 'crm.leads' ? [serviceKey, departmentCode, 'showroom', paymentType] : [paymentType, serviceKey, departmentCode, 'showroom']);
    assert.ok(query.values.includes(user.id), 'Lead ownership must stay on the logged-in agent');
  }
  assert.equal(effects.attached, 1);
  assert.equal(effects.notifications, 1);
  passed++;
}
{
  const { handler, calls, effects } = makeHandler({ duplicate: true });
  const res = await call(handler, 'POST', { customerName: 'Duplicate', phone: '0500000000', serviceKey: 'finance' });
  assert.equal(res.code, 201);
  assert.equal(res.data.approvalStatus, 'pending');
  assert.ok(!calls.some(c => c.text.includes('insert into crm.leads')), 'Must not create a duplicate customer');
  assert.equal(effects.attached, 0);
  passed++;
}
for (const serviceKey of ['', 'service', 'invalid']) {
  const { handler, calls } = makeHandler();
  const res = await call(handler, 'POST', { customerName: 'Customer', phone: '0500000000', serviceKey });
  assert.equal(res.code, 400);
  assert.match(res.data.error, /اختر القسم/);
  assert.ok(!calls.some(c => c.text.includes('insert into crm.manual_lead_requests')));
  passed++;
}
{
  const { handler, calls } = makeHandler({ editing: true, duplicate: true });
  const res = await call(handler, 'PATCH', { id: 'request-uuid', action: 'edit', customerName: 'Updated', phone: '0500000000', serviceKey: 'finance' });
  assert.equal(res.code, 200);
  const update = findCall(calls, /update crm.manual_lead_requests set customer_name=/);
  assert.ok(update.values.includes('finance'));
  assert.ok(update.values.includes('finance_sales'));
  assert.ok(update.values.includes('تمويل'));
  passed++;
}
{
  // A pending, historical customer-service request remains editable, but cannot be selected for a new lead.
  const { handler, calls } = makeHandler({ editing: true, duplicate: true, service: 'service' });
  const res = await call(handler, 'PATCH', { id: 'request-uuid', action: 'edit', customerName: 'Legacy', phone: '0500000000', serviceKey: 'service' });
  assert.equal(res.code, 200);
  const update = findCall(calls, /update crm.manual_lead_requests set customer_name=/);
  assert.ok(update.values.includes('customer_service'));
  passed++;
}
console.log(`PASS: ${passed}/8 CRM manual department API cases, cash and finance, duplicate, validation and pending edit`);
