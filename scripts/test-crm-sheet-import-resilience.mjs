import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function compile(source, deps) {
  const code = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (!Object.hasOwn(deps, name)) throw new Error(`Unexpected dependency: ${name}`);
    return deps[name];
  }, module, module.exports);
  return module.exports;
}
const transport = compile('src/crm/sheetLeadImportTransport.ts', {});
const { retrySheetLeadRequest, SheetLeadTransportError } = transport;
const response = (status, payload, headers={}) => new Response(JSON.stringify(payload), {
  status, headers: { 'Content-Type': 'application/json', ...headers },
});
const request = { serviceKey: 'cash', campaignName: 'الحملة', rows: [{ rowNumber: 2, phone: '0509876123', customerName: 'عميل' }] };
let calls = 0;
let progress = [];
const transientFetch = async () => {
  calls++;
  if (calls === 1) return response(503, { ok: false, error: 'temporary outage' });
  return response(200, { ok: true, rows: [{ rowNumber: 2 }], summary: { total: 1 } });
};
let output = await retrySheetLeadRequest(request, { fetchImpl: transientFetch, sleep: async () => {}, onRetry: (attempt) => progress.push(attempt) });
assert.equal(calls, 2);
assert.equal(output.summary.total, 1);
assert.deepEqual(progress, [2]);
console.log('PASS: HTTP 503 automatically retries the same rows and progresses');

calls = 0;
await assert.rejects(() => retrySheetLeadRequest(request, {
  fetchImpl: async () => { calls++; return response(403, { ok: false, error: 'superadmin required' }); }, sleep: async () => {},
}), (error) => error instanceof SheetLeadTransportError && error.status === 403 && !error.retryable);
assert.equal(calls, 1);
console.log('PASS: HTTP 403 does not retry or change permissions');

calls = 0;
await assert.rejects(() => retrySheetLeadRequest(request, {
  timeoutMs: 15, maxAttempts: 2, sleep: async () => {},
  fetchImpl: (_path, options) => { calls++; return new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }); },
}), (error) => error instanceof SheetLeadTransportError && error.retryable && /مهلة/.test(error.message));
assert.equal(calls, 2);
console.log('PASS: Stalled API requests are aborted with a finite retry limit; no infinite spinner');

const leadSources = compile('shared/crm-sheet-sources.ts', {});
const leadPhones = compile('shared/crm-sheet-phone.ts', {});
const leads = new Map();
const legacyLeads = new Map();
let legacyScans = 0;
let assignmentCount = 0;
let notifiedCount = 0;
let lockHeld = false;
let hookRuns = 0;
let busy = false;
const query = (strings, ...values) => {
  const sql = strings.join('?').toLowerCase();
  if (sql.includes('as phone_suffix')) {
    legacyScans++;
    return Promise.resolve((values[0] || []).flatMap((suffix) => {
      const found = legacyLeads.get(suffix);
      return found ? [{ ...found, phone_suffix: suffix }] : [];
    }));
  }
  if (sql.includes('from crm.leads l left join core.users')) {
    const found = leads.get(values[0]);
    return Promise.resolve(found ? [{
      id: found.id, customer_name: found.customer_name, assigned_name: found.assigned_name,
      branch_code: found.branch_code, source_name: found.source_name,
      source_code: found.source_code,
    }] : []);
  }
  if (sql.includes('insert into crm.leads(')) {
    const [customer_name, phone, phone_normalized, source_code, source_name, service_key, department_code, branch_code, payment_type, campaign_name, assigned_to] = values;
    if (leads.has(phone_normalized)) {
      const duplicate = new Error('duplicate key'); duplicate.code = '23505'; throw duplicate;
    }
    const row = { id: `lead-${leads.size + 1}`, customer_name, phone, phone_normalized, source_code, source_name, service_key, department_code, branch_code, payment_type, campaign_name, assigned_to, assigned_name: assigned_to, created_at: new Date().toISOString() };
    leads.set(phone_normalized, row);
    return Promise.resolve([row]);
  }
  return Promise.resolve([]);
};
query.begin = async (fn) => fn(query);
const dependencies = {
  '../shared/crm-sheet-sources.js': leadSources,
  '../shared/crm-sheet-phone.js': leadPhones,
  './_db.js': {
    getSql: () => query,
    withDatabaseAdvisoryLock: async (_key, work) => work(),
    tryWithDatabaseAdvisoryLock: async (_key, work) => {
      if (busy) return { acquired: false };
      lockHeld = true;
      try { return { acquired: true, result: await work() }; }
      finally { lockHeld = false; }
    },
  },
  './_crm-utils.js': {
    clean: (value) => String(value ?? '').trim(),
    chooseSheetImportAssignment: async () => ({ assignedTo: `agent-${++assignmentCount}`, assignedName: `مندوب ${assignmentCount}`, branchCode: 'hall' }),
    audit: async () => { assert.equal(lockHeld, false, 'Audit must not hold the import lock'); },
  },
  './_crm-customer-fields.js': { getCustomerFieldDefinitions: async () => [], calculateLeadCompletion: () => 40 },
  './_crm-lifecycle.js': { attachLeadToContactAndOpenRequest: async () => { assert.equal(lockHeld, false, 'Contact linking must not hold the import lock'); hookRuns++; } },
  './_notifications.js': { emitCrmLeadNotification: async () => { assert.equal(lockHeld, false, 'Notifications must not hold the import lock'); notifiedCount++; } },
};
const service = compile('server/_crm-sheet-import.ts', dependencies);
const actor = { id: '00000000-0000-0000-0000-000000000001', fullName: 'مدير النظام' };
const all = Array.from({ length: 101 }, (_, i) => ({
  rowNumber: i + 2, customerName: `عميل ${i+1}`,
  phone: `05${String(i + 1000).padStart(8, '0')}`, source: i % 2 ? 'Facebook' : 'Snapchat',
}));
let httpCalls = 0;
let temporaryFailureCount = 0;
const importFetch = async (_url, options) => {
  httpCalls++;
  const payload = JSON.parse(options.body);
  // The first four batches completed (12 clients); the fifth call commits
  // the leads but its response is lost, so an automatic retry MUST NOT
  // reassign them or emit duplicate notifications.
  if (httpCalls === 5) {
    await service.importCrmSheetBatch(actor, payload.rows, payload.serviceKey, payload.campaignName);
    temporaryFailureCount++;
    return response(504, { ok: false, error: 'Vercel response lost after commit' });
  }
  try {
    return response(200, { ok: true, ...await service.importCrmSheetBatch(actor, payload.rows, payload.serviceKey, payload.campaignName) });
  } catch (error) {
    return response(error?.code === 'CRM_SHEET_IMPORT_BUSY' ? 423 : 500, { ok: false, error: error.message });
  }
};
const rowsReturned = [];
for (let i = 0; i < all.length; i += 3) {
  const slice = all.slice(i, i + 3);
  const result = await retrySheetLeadRequest({ ...request, rows: slice }, { fetchImpl: importFetch, sleep: async () => {} });
  assert.equal(result.summary.total, slice.length);
  rowsReturned.push(...result.rows);
}
assert.equal(temporaryFailureCount, 1);
assert.equal(rowsReturned.length, 101);
assert.equal(leads.size, 101);
assert.equal(assignmentCount, 101);
assert.equal(notifiedCount, 101);
assert.equal(hookRuns, 101);
const assignments = new Map(Array.from(leads.values(), (lead) => [lead.phone_normalized, lead.assigned_to]));
for (let i = 0; i < all.length; i += 3) {
  const result = await retrySheetLeadRequest({ ...request, rows: all.slice(i, i+3) }, { fetchImpl: importFetch, sleep: async () => {} });
  assert.equal(result.summary.created, 0);
}
assert.equal(leads.size, 101);
assert.equal(assignmentCount, 101);
assert.equal(notifiedCount, 101);
for (const lead of leads.values()) assert.equal(lead.assigned_to, assignments.get(lead.phone_normalized));
console.log('PASS: 101-row import recovers after the 12-row stall, even when a timed-out batch already committed');
console.log('PASS: Re-import of the same 101 rows keeps the same reps and branches; no duplicate notifications');

legacyLeads.set('500001999', { id: 'old-manual', customer_name: 'عميل قديم',
  assigned_name: 'المندوب الأصلي', branch_code: 'qadisiyah', source_code: 'manual', source_name: 'مصدر قديم' });
const ownersBeforeLegacy = assignmentCount;
const scannedBeforeLegacy = legacyScans;
const legacyTest = await service.importCrmSheetBatch(actor, [
  { rowNumber: 300, customerName: 'اسم معدل', phone: '0500001999', source: 'Facebook' },
  { rowNumber: 301, customerName: 'جديد', phone: '0500010999', source: 'Snapchat' },
], 'cash', 'الحملة');
assert.equal(legacyTest.summary.existing, 1);
assert.equal(legacyTest.summary.created, 1);
assert.equal(legacyTest.rows[0].assignedName, 'المندوب الأصلي');
assert.equal(legacyTest.rows[0].branchCode, 'qadisiyah');
assert.equal(assignmentCount, ownersBeforeLegacy + 1);
assert.equal(legacyScans - scannedBeforeLegacy, 1);
console.log('PASS: Legacy-format CRM phones are checked once per batch and retain existing assignments');

busy = true;
const previousCount = leads.size;
await assert.rejects(() => service.importCrmSheetBatch(actor, [{ rowNumber: 103, customerName: 'عميل آخر', phone: '0500002223' }], 'cash', ''), (error) => error.code === 'CRM_SHEET_IMPORT_BUSY');
assert.equal(leads.size, previousCount);
busy = false;
console.log('PASS: Busy database lock returns a retryable error immediately, without creating customers');
