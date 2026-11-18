import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

// Load the real import processor with an isolated, in-memory SQL adapter.
// This test never opens a database connection or modifies production records.
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = fs.readFileSync(new URL('../server/_crm-lead-import.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
});
assert.equal((code.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);

function makeHarness(existingCustomer) {
  const customerId = '11111111-1111-4111-8111-111111111111';
  const contactId = '22222222-2222-4222-8222-222222222222';
  const conversationId = '33333333-3333-4333-8333-333333333333';
  const requestId = '44444444-4444-4444-8444-444444444444';
  let lead = existingCustomer ? {
    id: customerId, contact_id: contactId, phone: '966505050000',
    phone_normalized: '966505050000', source_code: 'other_website',
    source_name: 'السوق المفتوح', platform_code: 'other_website',
    status_label: 'غير مؤهل', status_code: 'unqualified',
    department_code: 'finance_sales', service_key: 'finance',
    branch_code: 'hall', assigned_to: '55555555-5555-4555-8555-555555555555',
    call_center_assigned_to: null, current_request_id: requestId,
    customer_name: 'عميل قديم', payment_type: 'تمويل',
    source_history: [], extra_data: { customValue: 'kept' },
    created_at: '2026-10-01T00:00:00Z', registered_at: '2026-10-01T00:00:00Z',
  } : null;
  let request = existingCustomer ? {
    id: requestId, lead_id: customerId, contact_id: contactId,
    conversation_id: conversationId, service_key: 'finance',
    department_code: 'finance_sales', branch_code: 'hall',
    assigned_to: '55555555-5555-4555-8555-555555555555',
    call_center_assigned_to: null,
  } : null;
  let conversation = existingCustomer ? {
    id: conversationId, lead_id: customerId, contact_id: contactId,
    service_request_id: requestId, assigned_to: lead.assigned_to,
    call_center_assigned_to: null, department_code: 'finance_sales',
    branch_code: 'hall', service_key: 'finance',
  } : null;
  let classifyCalls = 0;
  let maxActive = 0;
  let active = 0;
  const waiting = new Map();
  const keys = [];
  const leadUpdates = [];
  const conversationUpdates = [];
  const events = [];

  const sql = async (strings, ...values) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
    if (query.includes('from core.sources')) return [{ code: 'meta_lead' }];
    if (query.includes('from crm.leads l') && query.includes('where l.is_deleted=false')) return lead ? [{ ...lead }] : [];
    if (query.includes('from crm.leads l') && query.includes('where l.id=')) return lead ? [{ ...lead }] : [];
    if (query.includes('from crm.conversations where id=')) return conversation ? [{ ...conversation }] : [];
    if (query.startsWith('insert into crm.conversations')) {
      conversation = { id: conversationId, contact_id: contactId, lead_id: lead?.id || null, service_request_id: request?.id || null };
      return [{ ...conversation }];
    }
    if (query.startsWith('update crm.conversations')) {
      conversationUpdates.push(query);
      assert.doesNotMatch(query, /\bassigned_to=|\bcall_center_assigned_to=|\bservice_key=|\bdepartment_code=|\bbranch_code=/);
      return [];
    }
    if (query.startsWith('update crm.leads set')) {
      leadUpdates.push({ query, values });
      assert.ok(lead, 'Classifier must create a new lead before its fields are filled');
      if (existingCustomer) {
        assert.doesNotMatch(query, /\bstatus_label=|\bstatus_code=|\bsource_code=|\bsource_name=|\bassigned_to=|\bcurrent_request_id=|\bservice_key=|\bdepartment_code=|\bbranch_code=/);
        lead = { ...lead, source_history: values[0], extra_data: values[1] };
      } else {
        assert.match(query, /source_code=\?/);
        // New customer source is persisted by the normal classification path.
        lead = { ...lead, source_code: values[4] };
      }
      return [{ ...lead }];
    }
    if (query.startsWith('insert into crm.lead_events')) {
      events.push(query);
      return [];
    }
    if (query.startsWith('update integrations.inbound_events')) return [];
    throw new Error(`Unexpected SQL: ${query.slice(0, 200)}`);
  };
  sql.json = value => value;

  const locks = async (key, work) => {
    keys.push(key);
    const previous = waiting.get(key) || Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    waiting.set(key, previous.then(() => current));
    await previous;
    active++;
    maxActive = Math.max(maxActive, active);
    try { return await work(); }
    finally { active--; release(); }
  };
  const normalizePhone = value => {
    let phone = String(value || '').replace(/\D/g, '');
    if (/^05\d{8}$/.test(phone)) phone = `966${phone.slice(1)}`;
    else if (/^5\d{8}$/.test(phone)) phone = `966${phone}`;
    return phone;
  };
  const dependencies = {
    './_crm-utils.js': {
      clean: value => String(value ?? '').trim(), normalizePhone,
      resolveSourceName: async code => ({ snapchat_lead: 'سناب شات', facebook_lead: 'فيسبوك', tiktok_lead: 'تيك توك' })[code] || code,
      appendCrmSourceHistory: (value, code, name, at) => {
        const sources = Array.isArray(value) ? [...value] : [];
        if (!sources.some(source => String(source?.sourceCode || source?.source || source).toLowerCase() === code.toLowerCase())) {
          sources.push({ source: code, sourceCode: code, sourceName: name, at });
        }
        return sources;
      },
    },
    './_crm-import-campaign.js': { resolveSheetImportCampaign: () => ({ campaignName: null, sheetCampaignName: null, metaPlatform: null }) },
    './_db.js': { getSql: () => sql, withDatabaseAdvisoryLock: locks },
    './_crm-background-jobs.js': { publishBackgroundEvent: async () => null },
    './_crm-lifecycle.js': {
      ensureContactIdentity: async () => {
        await new Promise(resolve => setTimeout(resolve, 2));
        return { contact: { id: contactId } };
      },
      findOpenServiceRequest: async () => request,
      classifyConversationService: async input => {
        classifyCalls++;
        assert.ok(!existingCustomer, 'No existing customer may be reclassified');
        request = { id: requestId, conversation_id: conversationId, lead_id: customerId,
          service_key: 'finance', department_code: 'finance_sales', branch_code: 'hall', assigned_to: 'REP_NEW' };
        lead = { id: customerId, contact_id: contactId, status_label: 'عميل جديد',
          source_code: input.sourceCode, service_key: input.serviceKey,
          department_code: 'finance_sales', branch_code: 'hall',
          current_request_id: requestId, assigned_to: 'REP_NEW',
          source_history: [], extra_data: {}, phone_normalized: '966505050000' };
        conversation = { id: conversationId, lead_id: customerId, contact_id: contactId, service_request_id: requestId };
        return { request, leadId: customerId, reused: false };
      },
    },
  };
  const exports = {};
  const module = { exports };
  new Function('require', 'module', 'exports', code.outputText)((name) => {
    if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected import: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return {
    process: module.exports.processLeadImportEvent,
    snapshot: () => ({ lead, request, conversation, classifyCalls, maxActive, keys, leadUpdates, conversationUpdates, events }),
  };
}

const existing = makeHarness(true);
const results = await Promise.all([
  existing.process('tiktok-snapchat', 'snap-repeated', { phone: '0505050000', source: 'snapchat', customerName: 'اسم جديد', serviceKey: 'cash' }),
  existing.process('tiktok-snapchat', 'fb-repeated', { phone: '966505050000', source: 'facebook', customerName: 'اسم جديد 2' }),
]);
const existingState = existing.snapshot();
assert.equal(existingState.maxActive, 1, 'All imports for the same local nine digits must run sequentially');
assert.equal(new Set(existingState.keys).size, 1, 'All sources must use an identical shared lock');
assert.equal(existingState.classifyCalls, 0, 'Existing finance requests must not be re-distributed');
assert.equal(existingState.leadUpdates.length, 2);
assert.ok(results.every(result => result.existedBefore && !result.createLead));
assert.equal(existingState.lead.status_label, 'غير مؤهل');
assert.equal(existingState.lead.status_code, 'unqualified');
assert.equal(existingState.lead.customer_name, 'عميل قديم');
assert.equal(existingState.lead.source_code, 'other_website');
assert.equal(existingState.lead.source_name, 'السوق المفتوح');
assert.equal(existingState.lead.platform_code, 'other_website');
assert.equal(existingState.lead.assigned_to, '55555555-5555-4555-8555-555555555555');
assert.equal(existingState.lead.current_request_id, '44444444-4444-4444-8444-444444444444');
assert.equal(existingState.lead.extra_data.customValue, 'kept');
assert.deepEqual(new Set(existingState.lead.source_history.map(source => source.sourceCode)), new Set(['other_website', 'snapchat_lead', 'facebook_lead']));
assert.equal(existingState.events.length, 2, 'Each new import event is audited without changing status');
console.log('PASS: concurrent Meta/Snapchat repeat imports serialize, keep original source/status/owner/request, and log both sources');

const fresh = makeHarness(false);
const freshResult = await fresh.process('tiktok-snapchat', 'first-lead', { phone: '0505050000', source: 'tiktok', customerName: 'عميل جديد' });
const freshState = fresh.snapshot();
assert.equal(freshState.classifyCalls, 1);
assert.equal(freshResult.createLead, true);
assert.equal(freshResult.existedBefore, false);
assert.equal(freshState.lead.source_code, 'tiktok_lead');
assert.equal(freshState.lead.status_label, 'عميل جديد');
assert.equal(freshState.lead.assigned_to, 'REP_NEW');
assert.equal(freshState.lead.current_request_id, '44444444-4444-4444-8444-444444444444');
console.log('PASS: genuinely new customer keeps the existing classification/distribution flow');
