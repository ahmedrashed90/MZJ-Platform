import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

// Isolated runtime tests of the ACTUAL CRM lifecycle module. No production DB,
// external services, API keys, or network requests are used.
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = fs.readFileSync(new URL('../server/_crm-lifecycle.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.deepEqual((output.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error), []);

const uuid = {
  contact: '22222222-2222-4222-8222-222222222222',
  lead: '11111111-1111-4111-8111-111111111111',
  conversation: '33333333-3333-4333-8333-333333333333',
  request: '44444444-4444-4444-8444-444444444444',
  cashOwner: '55555555-5555-4555-8555-555555555555',
  financeOwner: '66666666-6666-4666-8666-666666666666',
};

function harness({ initialService = 'cash', customerStatus = 'مؤهل', initialRequest = true, initialLead = true, failOnRequest = false } = {}) {
  let state = {
    lead: initialLead ? {
      id: uuid.lead, contact_id: uuid.contact, status_label: customerStatus,
      status_code: 'qualified', source_code: 'other_website', source_name: 'السوق المفتوح', platform_code: 'other_website',
      source_history: [], registered_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z',
      service_key: initialService, department_code: initialService === 'finance' ? 'finance_sales' : 'cash_sales',
      assigned_to: initialService === 'finance' ? uuid.financeOwner : uuid.cashOwner,
      current_request_id: initialRequest ? uuid.request : null, is_deleted: false,
    } : null,
    conversation: { id: uuid.conversation, contact_id: uuid.contact, lead_id: initialLead ? uuid.lead : null,
      service_request_id: initialRequest ? uuid.request : null, channel_code: 'facebook',
      display_name: 'العميل', primary_phone: '0505050000', primary_phone_normalized: '966505050000', unread_count: 0 },
    requests: initialRequest ? [{ id: uuid.request, lead_id: uuid.lead, contact_id: uuid.contact,
      service_key: initialService, status_label: customerStatus, department_code: initialService === 'finance' ? 'finance_sales' : 'cash_sales',
      branch_code: 'hall', source_code: 'other_website', request_state: 'open',
      assigned_to: initialService === 'finance' ? uuid.financeOwner : uuid.cashOwner,
      assigned_name: 'المندوب القديم', call_center_assigned_to: null }] : [],
    events: [], ownership: [],
  };
  let sqlWrites = 0, activeLocks = 0, maximumLocks = 0, lockedKeys = [];
  const lockQueues = new Map();

  async function sql(strings, ...values) {
    const q = strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
    const val = index => values[index];
    if (q.includes('from crm.conversations c join crm.contacts ct')) return [{ ...state.conversation }];
    if (q.includes('from crm.leads') && q.includes('where contact_id=') && !q.startsWith('update')) return state.lead ? [{ ...state.lead }] : [];
    if (q.startsWith('select status_label,source_code,source_name,source_history,registered_at,created_at from crm.leads')) return state.lead ? [{ ...state.lead }] : [];
    if (q.startsWith('insert into crm.leads')) {
      if (state.lead) throw Error('Duplicate insert of existing lead');
      state.lead = { id: uuid.lead, contact_id: uuid.contact, status_label: 'عميل جديد', status_code: null,
        source_code: val(4), source_name: val(5), platform_code: val(6), source_history: val(7),
        assigned_to: null, current_request_id: null, is_deleted: false };
      return [{ ...state.lead }];
    }
    if (q.startsWith('update crm.service_requests set request_state=\'closed\'')) {
      sqlWrites++;
      const row = state.requests.find(r => r.id === val(values.length - 1) && r.request_state === 'open');
      if (!row) return [];
      row.request_state = 'closed';
      return [{ id: row.id }];
    }
    if (q.startsWith('insert into crm.service_requests')) {
      sqlWrites++;
      if (failOnRequest) throw Error('Simulated request insert failure');
      const request = { id: `77777777-7777-4777-8777-${String(state.requests.length + 1).padStart(12, '0')}`,
        contact_id: uuid.contact, lead_id: uuid.lead, conversation_id: uuid.conversation,
        service_key: val(3), department_code: val(4), branch_code: val(5), status_label: 'عميل جديد', request_state: 'open',
        source_code: val(6), classification_method: val(7), assigned_to: val(8), call_center_assigned_to: val(9) };
      state.requests.push(request);
      return [{ ...request }];
    }
    if (q.startsWith('update crm.leads set')) {
      sqlWrites++;
      // The customer status is deliberately never writable during classification.
      assert.doesNotMatch(q, /\bstatus_label\s*=|\bstatus_code\s*=/);
      assert.match(q, /source_code=coalesce\(nullif\(source_code,''\),\?\)/);
      state.lead = { ...state.lead,
        current_request_id: val(1), service_key: val(2), department_code: val(3), branch_code: val(4),
        payment_type: val(5), source_code: state.lead.source_code || val(6),
        source_name: state.lead.source_name || val(7), platform_code: state.lead.platform_code || val(8),
        source_history: val(9), assigned_to: val(10), call_center_assigned_to: val(11),
      };
      return [];
    }
    if (q.startsWith('update crm.conversations set')) {
      sqlWrites++;
      // The non-explicit reuse branch begins with service_request_id; the creation
      // branch begins with lead_id; same-service reuse begins with service_request_id.
      if (q.includes('classification_state=\'classified\'')) {
        const nextRequestId = q.startsWith('update crm.conversations set service_request_id') ? val(0) : val(1);
        const nextLeadId = q.startsWith('update crm.conversations set service_request_id') ? val(1) : val(0);
        state.conversation.service_request_id = nextRequestId;
        state.conversation.lead_id = nextLeadId;
      }
      return [];
    }
    if (q.startsWith('insert into crm.lead_events')) {
      sqlWrites++;
      const eventType = q.includes('service_request_reclassified') ? 'service_request_reclassified' : 'service_request_created';
      const status = q.startsWith('insert into crm.lead_events')
        ? val(1) : null;
      // historical new_status cannot be the new request status for existing leads
      assert.equal(status, state.lead.status_label);
      if (eventType === 'service_request_reclassified') assert.equal(val(2), state.lead.status_label);
      state.events.push({ type: eventType, status });
      return [];
    }
    if (q.startsWith('insert into crm.ownership_events')) { state.ownership.push(q); return []; }
    if (q.startsWith('select') && q.includes('from crm.service_requests')) return state.requests.filter(r => r.request_state === 'open');
    throw Error(`Unmocked SQL: ${q.slice(0, 280)}`);
  }
  sql.json = value => value;
  sql.begin = async (callback) => {
    const backup = structuredClone(state);
    try { return await callback(sql); }
    catch (error) { state = backup; throw error; }
  };

  const lock = async (key, work) => {
    lockedKeys.push(key);
    const previous = lockQueues.get(key) || Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    lockQueues.set(key, previous.then(() => current));
    await previous;
    activeLocks++;
    maximumLocks = Math.max(maximumLocks, activeLocks);
    try { return await work(); }
    finally { activeLocks--; release(); }
  };
  const serviceOwner = (service) => service === 'finance' ? uuid.financeOwner : uuid.cashOwner;
  const dependencies = {
    './_crm-utils.js': {
      clean: v => String(v ?? '').trim(),
      departmentKey: v => String(v || '').includes('finance') ? 'finance' : String(v || '').includes('service') ? 'service' : 'cash',
      departmentCodeFromKey: v => v === 'finance' ? 'finance_sales' : v === 'service' ? 'customer_service' : 'cash_sales',
      branchForDepartment: () => 'hall',
      chooseAssignment: async (service) => ({ assignedTo: serviceOwner(service), assignedName: 'المندوب', branchCode: 'hall' }),
      chooseSheetImportAssignment: async (service) => ({ assignedTo: serviceOwner(service), assignedName: 'المندوب', branchCode: 'hall' }),
      chooseFinanceImportAssignment: async () => ({ assignedTo: uuid.financeOwner, assignedName: 'التمويل', branchCode: 'hall' }),
      chooseCallCenterAssignment: async () => ({ assignedTo: null, assignedName: '' }),
      resolveSourceName: async (source) => source,
      normalizePhone: v => String(v || ''),
      appendCrmSourceHistory: (value, code, name, at) => {
        const history = Array.isArray(value) ? [...value] : [];
        if (!history.some(x => (x.sourceCode || x.source) === code)) history.push({ source: code, sourceCode: code, sourceName: name, at });
        return history;
      },
    },
    './_db.js': { getSql: () => sql, withDatabaseAdvisoryLock: lock },
    './_crm-auto-template.js': { dispatchAutomaticEntryTemplate: async () => ({ skipped: true }) },
    'node:crypto': require('node:crypto'),
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output.outputText)((name) => {
    if (!Object.hasOwn(dependencies, name)) throw Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  // Database lookups are intercepted so there is no dependency on the real schema.
  // The module uses its own named export findOpenServiceRequest, so its SQL
  // lookup must also be modeled with a query rule above (already included).
  return { classify: module.exports.classifyConversationService, snapshot: () => structuredClone(state), metrics: () => ({ sqlWrites, maximumLocks, lockedKeys }) };
}

const input = (serviceKey, method = 'customer_service_selection') => ({
  conversationId: uuid.conversation, serviceKey, sourceCode: 'facebook', classificationMethod: method,
  skipAutomaticTemplate: true, assignCallCenter: false, eventKey: `test:${method}:${serviceKey}`,
});

// 1. Explicit service transfer: preserve the customer while creating a new request.
const transferred = harness();
const transferResult = await transferred.classify(input('finance'));
const afterTransfer = transferred.snapshot();
assert.equal(transferResult.reclassified, true);
assert.equal(afterTransfer.lead.status_label, 'مؤهل');
assert.equal(afterTransfer.lead.status_code, 'qualified');
assert.equal(afterTransfer.lead.source_code, 'other_website');
assert.equal(afterTransfer.lead.source_name, 'السوق المفتوح');
assert.equal(afterTransfer.lead.platform_code, 'other_website');
assert.equal(afterTransfer.lead.service_key, 'finance');
assert.equal(afterTransfer.lead.assigned_to, uuid.financeOwner);
assert.equal(afterTransfer.requests.filter(x => x.request_state === 'open').length, 1);
assert.equal(afterTransfer.requests[0].request_state, 'closed');
assert.equal(afterTransfer.requests[1].status_label, 'عميل جديد');
assert.equal(afterTransfer.lead.current_request_id, afterTransfer.requests[1].id);
assert.equal(afterTransfer.events.length, 2);
assert.deepEqual(afterTransfer.events.map(e => e.status), ['مؤهل', 'مؤهل']);
assert.deepEqual(new Set(afterTransfer.lead.source_history.map(x => x.sourceCode)), new Set(['other_website', 'facebook']));
console.log('PASS: explicit finance transfer preserves customer status/code/original source and creates an independent new request');

// 2. New social interactions cannot move an existing finance request to cash.
const social = harness({ initialService: 'finance', customerStatus: 'غير مؤهل' });
const socialResult = await social.classify(input('cash', 'meta_post_comment'));
const afterSocial = social.snapshot();
assert.equal(socialResult.reused, true);
assert.equal(socialResult.reclassified, false);
assert.equal(afterSocial.requests.length, 1);
assert.equal(afterSocial.requests[0].request_state, 'open');
assert.equal(afterSocial.lead.service_key, 'finance');
assert.equal(afterSocial.lead.status_label, 'غير مؤهل');
assert.equal(afterSocial.lead.source_code, 'other_website');
assert.equal(afterSocial.events.length, 0);
console.log('PASS: a comment/like/source mapping cannot reclassify a finance customer into cash');

// 3. A customer with a closed request keeps status when another request is opened.
const reopening = harness({ initialRequest: false, customerStatus: 'مؤجل' });
await reopening.classify(input('cash', 'source_mapping'));
assert.equal(reopening.snapshot().lead.status_label, 'مؤجل');
assert.equal(reopening.snapshot().requests.length, 1);
assert.equal(reopening.snapshot().requests[0].status_label, 'عميل جديد');
assert.equal(reopening.snapshot().events.at(-1).status, 'مؤجل');
console.log('PASS: existing customers without an open request keep status when a new request starts');

// 4. New customer starts as new with the usual distribution and source.
const fresh = harness({ initialRequest: false, initialLead: false });
await fresh.classify(input('cash', 'lead_import'));
assert.equal(fresh.snapshot().lead.status_label, 'عميل جديد');
assert.equal(fresh.snapshot().lead.source_code, 'facebook');
assert.equal(fresh.snapshot().requests[0].status_label, 'عميل جديد');
console.log('PASS: genuinely new customers still start at عميل جديد with original intake source');

// 5. Same-service selection reuses the same request without status changes.
const same = harness();
const sameResult = await same.classify(input('cash'));
assert.equal(sameResult.reused, true);
assert.equal(same.snapshot().requests.length, 1);
assert.equal(same.snapshot().lead.status_label, 'مؤهل');
assert.equal(same.snapshot().lead.assigned_to, uuid.cashOwner);
console.log('PASS: selecting the same service reuses the active request');

// 6. Rollback protects the original open request on a failed insertion.
const failing = harness({ failOnRequest: true });
await assert.rejects(failing.classify(input('finance')), /Simulated request insert failure/);
assert.equal(failing.snapshot().requests[0].request_state, 'open');
assert.equal(failing.snapshot().requests.length, 1);
assert.equal(failing.snapshot().lead.status_label, 'مؤهل');
assert.equal(failing.snapshot().events.length, 0);
console.log('PASS: failure between closing old and creating new request rolls back all database changes');

// 7. Concurrent selections for a contact use the same advisory-lock key.
const concurrent = harness();
await Promise.all([concurrent.classify(input('finance')), concurrent.classify(input('finance'))]);
assert.equal(concurrent.metrics().maximumLocks, 1);
assert.equal(new Set(concurrent.metrics().lockedKeys).size, 1);
assert.equal(concurrent.snapshot().requests.filter(r => r.request_state === 'open').length, 1);
console.log('PASS: simultaneous service selections serialize per contact and keep one open request');
