import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const transpile = (path, jsx = false) => {
  const code = ts.transpileModule(read(path), {
    fileName: path,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}) },
    reportDiagnostics: true,
  });
  const errors = (code.diagnostics || []).filter((item) => item.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors, [], path + ' parses without TypeScript errors');
  return code.outputText;
};

const sharedCode = transpile('shared/crm-follow-up.ts');
const helperModule = { exports: {} };
vm.runInNewContext(sharedCode, { module: helperModule, exports: helperModule.exports, require }, { filename: 'crm-follow-up.js' });
const { postponedFollowUpError, POSTPONED_FOLLOW_UP_REQUIRED, POSTPONED_FOLLOW_UP_INVALID } = helperModule.exports;

let passes = 0;
function check(label, value) { assert.ok(value, label); passes++; console.log('PASS: ' + label); }

check('Postponed status without a date is rejected', postponedFollowUpError('مؤجل', '') === POSTPONED_FOLLOW_UP_REQUIRED);
check('Postponed status with null date is rejected', postponedFollowUpError('مؤجل', null) === POSTPONED_FOLLOW_UP_REQUIRED);
check('Postponed status with whitespace date is rejected', postponedFollowUpError('مؤجل', '   ') === POSTPONED_FOLLOW_UP_REQUIRED);
check('Postponed status with a valid chosen day is accepted', postponedFollowUpError('مؤجل', '2026-11-19') === '');
check('Valid leap-day follows calendar rules', postponedFollowUpError('مؤجل', '2028-02-29') === '');
check('Invalid February date cannot be saved', postponedFollowUpError('مؤجل', '2026-02-30') === POSTPONED_FOLLOW_UP_INVALID);
check('Invalid month cannot be saved', postponedFollowUpError('مؤجل', '2026-13-19') === POSTPONED_FOLLOW_UP_INVALID);
check('Unparseable date cannot be saved', postponedFollowUpError('مؤجل', 'tomorrow') === POSTPONED_FOLLOW_UP_INVALID);
check('Historical PostgreSQL timestamps remain valid', postponedFollowUpError('مؤجل', '2026-11-19T00:00:00.000Z') === '');
check('Other statuses need no date', postponedFollowUpError('مؤهل', '') === '');
check('Cash/finance service status same central rule', postponedFollowUpError('مؤجل', '2026-11-19') === '');
check('A newly postponed customer must choose a date in the same change', postponedFollowUpError('مؤجل', '2026-11-01', { previousStatus: 'مؤهل', followUpDateProvided: false }) === POSTPONED_FOLLOW_UP_REQUIRED);
check('A newly postponed customer with an explicitly chosen date is accepted', postponedFollowUpError('مؤجل', '2026-11-19', { previousStatus: 'مؤهل', followUpDateProvided: true }) === '');
check('A deferred customer with existing date can edit other fields', postponedFollowUpError('مؤجل', '2026-11-19T00:00:00Z', { previousStatus: 'مؤجل', followUpDateProvided: false }) === '');
check('Existing deferred customer with missing date must fix it', postponedFollowUpError('مؤجل', null, { previousStatus: 'مؤجل', followUpDateProvided: false }) === POSTPONED_FOLLOW_UP_REQUIRED);
check('Moving away from deferred does not require date', postponedFollowUpError('مؤهل', null, { previousStatus: 'مؤجل', followUpDateProvided: false }) === '');

const component = read('src/crm/components/LeadDrawer.tsx');
transpile('src/crm/components/LeadDrawer.tsx', true);
check('Editor enforces shared validation before any save mutation', component.includes('const followUpError = postponedFollowUpError(activeForm.values.status_label, activeForm.values.follow_up_at);') && component.indexOf('const followUpError = postponedFollowUpError(activeForm.values.status_label') < component.indexOf('setSaving(true);', component.indexOf('async function saveLead()')));
check('Date field has required mark, native date input, and error feedback', component.includes('const requiredFollowUp = field.field_key === "follow_up_at"') && component.includes('ref={followUpDateRef} type="date" required') && component.includes('role="alert"'));
check('Fast status chooser stages postponed for saving, never posts it alone', component.includes('if (isPostponedStatus(nextStatus)) {') && component.indexOf('if (isPostponedStatus(nextStatus)) {') < component.indexOf('const payload: Record<string, unknown> = { id: nextForm.id, statusLabel: nextStatus };'));
check('Old hidden follow-up values are cleared on new postponement', component.includes('isPostponedStatus(next) && isPostponedStatus(activeForm.values.status_label) ? activeForm.values.follow_up_at : ""'));
check('Date remains visible when historical field settings have it disabled', component.includes('if (postponed && !visible.some((field) => field.field_key === "follow_up_at"))'));

const server = read('server/crm/leads.ts');
transpile('server/crm/leads.ts');
check('Create API rejects postponed lead before inserting it', server.indexOf('const followUpError = postponedFollowUpError(input.statusLabel, input.followUpAt);') < server.indexOf('insert into crm.leads('));
check('Update API checks new deferred status before database writes', server.includes('previousStatus: previousStatusLabel') && server.includes('followUpDateProvided: hasOwnField(body, ["followUpAt", "follow_up_at"])'));
check('Explicit date clearing does not pick up stale DB date', server.includes('input.followUpAt = clean(providedValue(body, ["followUpAt", "follow_up_at"])) || null;'));

// Exercise the real handler with mocked dependencies. Invalid updates return
// before permission checks, SQL writes, notifications, and audit.
const before = {
  id: '11111111-1111-4111-8111-111111111111',
  can_view: true, status_label: 'مؤهل', follow_up_at: null,
  customer_name: 'عميل اختبار', phone: '0501234567', phone_normalized: '966501234567',
  department_code: 'finance_sales', service_key: 'finance', source_code: 'whatsapp', payment_type: 'تمويل',
};
let queryCount = 0;
let writeCount = 0;
let leadBefore = before;
const sql = (chunks, ...values) => {
  const query = chunks.join('?').toLowerCase();
  queryCount++;
  if (query.includes('from crm.leads l') && query.includes('where l.id =')) return Promise.resolve([{ ...leadBefore }]);
  writeCount++;
  throw Error('Test must reject invalid postponed update before running SQL: ' + query.slice(0,110));
};
const utilities = {
  clean: (value) => String(value ?? '').trim(),
  departmentKey: (value) => String(value ?? '').includes('finance') || String(value ?? '').includes('تمويل') ? 'finance' : 'cash',
  departmentCodeFromKey: (key) => key === 'finance' ? 'finance_sales' : 'cash_sales',
  branchForDepartment: () => '',
  normalizePhone: (value) => String(value ?? '').replace(/\D/g, '').replace(/^0/, '966'),
  parseBody: (request) => request.body,
  userScope: () => ({ all: true }),
  crmLeadScopeSql: () => 'true',
  requireCrmUser: async () => ({ id: '22222222-2222-4222-8222-222222222222', roles: [], fullName: 'مندوب' }),
  sourceLabel: (source) => source,
  positiveInt: (value, defaultValue) => defaultValue,
  resolveSourceName: async (source) => source,
};
const serverModule = { exports: {} };
const deps = {
  '../_crm-utils.js': utilities,
  '../_db.js': { getSql: () => sql },
  '../_crm-customer-fields.js': {
    getCustomerFieldDefinitions: async () => [],
    sanitizeCustomFieldValues: () => ({}),
    missingRequiredCustomerFields: () => [],
  },
  '../_crm-lifecycle.js': {},
  '../_notifications.js': {},
  '../_access-control.js': {},
  '../_crm-sales-history.js': {},
  '../../shared/crm-follow-up.js': helperModule.exports,
};
const mockedRequire = (name) => {
  if (!(name in deps)) throw Error('Unexpected import: ' + name);
  return deps[name];
};
vm.runInNewContext(transpile('server/crm/leads.ts'), { module: serverModule, exports: serverModule.exports, require: mockedRequire, console }, { filename: 'server/crm/leads.js' });
const route = serverModule.exports.default;
async function patch(body, previous = before) {
  leadBefore = previous;
  queryCount = 0;
  writeCount = 0;
  const response = {
    statusCode: 200,
    payload: null,
    setHeader: () => {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
  };
  await route({ method: 'PATCH', query: {}, body }, response);
  return response;
}

let result = await patch({ id: before.id, statusLabel: 'مؤجل' });
check('PATCH without date returns 400 and never writes', result.statusCode === 400 && result.payload.error === POSTPONED_FOLLOW_UP_REQUIRED && writeCount === 0);
result = await patch({ id: before.id, statusLabel: 'مؤجل', followUpAt: '2026-02-30' });
check('PATCH with invalid date returns 400 and never writes', result.statusCode === 400 && result.payload.error === POSTPONED_FOLLOW_UP_INVALID && writeCount === 0);
result = await patch({ id: before.id, followUpAt: null }, { ...before, status_label: 'مؤجل', follow_up_at: '2026-11-17T00:00:00Z' });
check('PATCH cannot erase date while remaining deferred', result.statusCode === 400 && result.payload.error === POSTPONED_FOLLOW_UP_REQUIRED && writeCount === 0);
result = await patch({ id: before.id, statusLabel: 'مؤجل' }, { ...before, status_label: 'مؤهل', follow_up_at: '2026-11-17T00:00:00Z' });
check('PATCH cannot silently reuse stale date when newly deferred', result.statusCode === 400 && result.payload.error === POSTPONED_FOLLOW_UP_REQUIRED && writeCount === 0);


async function post(body) {
  queryCount = 0;
  writeCount = 0;
  const response = {
    statusCode: 200,
    payload: null,
    setHeader: () => {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
  };
  await route({ method: 'POST', query: {}, body }, response);
  return response;
}
result = await post({ customerName: 'عميل جديد', phone: '0501234567', statusLabel: 'مؤجل' });
check('POST cannot create postponed customer with missing follow-up date', result.statusCode === 400 && result.payload.error === POSTPONED_FOLLOW_UP_REQUIRED && queryCount === 0);
result = await post({ customerName: 'عميل جديد', phone: '0501234567', statusLabel: 'مؤجل', followUpAt: '2026-02-30' });
check('POST cannot create postponed customer with malformed follow-up date', result.statusCode === 400 && result.payload.error === POSTPONED_FOLLOW_UP_INVALID && queryCount === 0);

console.log(`${passes}/${passes} CRM postponement regression checks passed`);
