import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
function load(path, modules = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  assert.equal((code.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  new Function('require','module','exports',code.outputText)(name => {
    if (!Object.hasOwn(modules, name)) throw new Error(`Unexpected import ${name}`);
    return modules[name];
  }, module, module.exports);
  return module.exports;
}
const routing = load('../server/marketing/form-lead-routing.ts');
const crmFields = load('../shared/lead-form-crm-fields.ts');
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const crmId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

async function run({ source = 'Meta', answers = {}, answer_labels = {}, priorExists = false,
  teams = ['cash_sales', 'finance_sales'], status = 'pending', race = false, reviewExisting = false, repairable = false, sameSubmission = false } = {}) {
  const form = {
    id, form_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Test customer',
    phone: '966505050000', source, campaign: 'Test campaign', medium: 'paid', ad_id: '1',
    answers, answer_labels, crm_status: status,
    crm_lead_id: ['linked', 'existing'].includes(status) ? crmId : null,
    created_at: '2026-11-07T12:00:00Z',
  };
  let eligibilityChecks = 0;
  let importCalls = 0;
  let notificationCalls = 0;
  let persistedStatus = '';
  let importedPayload = null;
  let storedPayload = null;
  const profileCalls = [];
  const sql = async (parts, ...values) => {
    const query = parts.join('?').replace(/\s+/g, ' ').toLowerCase();
    if (query.includes('from marketing.form_leads')) return [{ ...form }];
    if (query.includes('select id::text from crm.leads')) return priorExists ? [{ id: crmId }] : [];
    if (query.includes('select distinct d.code as department_code')) {
      eligibilityChecks++;
      assert.equal((query.match(/d\.code='finance_sales'/g) || []).length, 2);
      assert.doesNotMatch(query, /cash_sales/);
      return teams.map(department_code => ({ department_code }));
    }
    if (query.includes('insert into integrations.inbound_events')) { storedPayload = values[1]; return []; }
    if (query.includes('update marketing.form_leads set crm_status=')) {
      persistedStatus = query.includes("crm_status='failed'") ? 'failed' : values[0];
      return [];
    }
    throw new Error(`Unexpected SQL ${query.slice(0,100)}`);
  };
  sql.json = data => data;
  const bridge = load('../server/marketing/lead-forms-crm.ts', {
    '../_db.js': { getSql: () => sql, withDatabaseAdvisoryLock: async (_key, work) => work() },
    '../_crm-schema.js': { ensureCrmSchema: async () => {} },
    '../_crm-lifecycle.js': { isRecoverableMarketingFormLead: async (_sql, leadId, eventId, sourceCode) => {
      assert.equal(leadId, crmId); assert.equal(eventId, `marketing-form:${id}`);
      assert.equal(sourceCode, 'meta_lead'); return repairable;
    } },
    '../_phone-utils.js': { normalizePhone: number => String(number).replace(/\D/g, '') },
    '../_crm-lead-import.js': { processLeadImportEvent: async (route, event, payload) => {
      importCalls++;
      assert.equal(route, 'marketing-form');
      assert.equal(event, `marketing-form:${id}`);
      importedPayload = payload;
      assert.deepEqual(payload, storedPayload);
      return { lead: { id: crmId }, existedBefore: (priorExists && !repairable) || race, createLead: !((priorExists && !repairable) || race) };
    } },
    '../_notifications.js': { createNotification: async () => { notificationCalls++; }, notificationDedupe: () => 'test' },
    './form-lead-routing.js': routing,
    '../../shared/lead-form-crm-fields.js': crmFields,
    './form-crm-profile.js': {saveMarketingFormProfile: async (leadId,row,created) => {
      assert.equal(leadId,crmId); assert.equal(row.id,id); profileCalls.push(created); return created || sameSubmission;
    }},
  });
  let result, error;
  try { result = await bridge.syncMarketingFormLeadToCrm(form.id, reviewExisting); } catch (e) { error = e; }
  return { result, error, eligibilityChecks, importCalls, notificationCalls, persistedStatus, importedPayload, profileCalls };
}

// All form sources and all purchase preferences route to finance. Preserve
// the original purchase answer and existing source-mapping behavior.
const sources = [ ['Meta','meta_lead'], ['facebook','facebook_lead'], ['instagram','instagram_lead'],
  ['snapchat','snapchat_lead'], ['tiktok','tiktok_lead'], ['google','website'], ['direct','website'] ];
const choices = [ [{ purchase: 'cash' }, {}, 'cash'], [{ purchase: 'finance' }, {}, 'finance'], [{}, {}, 'undecided'],
  [{ custom: 'cash' }, { custom: '\u0643\u064a\u0641 \u062a\u0641\u0636\u0644 \u0627\u0644\u0634\u0631\u0627\u0621\u061f' }, 'cash'] ];
for (const [source, sourceCode] of sources) {
  for (const [answers, answer_labels, preference] of choices) {
    for (const teams of [['cash_sales','finance_sales'], ['finance_sales']]) {
      const r = await run({ source, answers, answer_labels, teams });
      assert.ifError(r.error);
      assert.equal(r.result.status, 'linked');
      assert.equal(r.importedPayload.serviceKey, 'finance');
      assert.equal(r.importedPayload.raw.intakeServiceKey, 'finance');
      assert.equal(r.importedPayload.purchasePreference, preference);
      assert.deepEqual(r.importedPayload.raw.answers, answers);
      assert.equal(r.importedPayload.sourceCode, sourceCode);
      assert.equal(r.eligibilityChecks, 1);
      assert.equal(r.importCalls, 1);
      assert.equal(r.notificationCalls, 1);
      assert.equal(r.persistedStatus, 'linked');
      assert.deepEqual(r.profileCalls,[true]);
    }
  }
}
console.log('PASS: 56 new form scenarios route to finance and preserve sources and submitted answers');

for (const teams of [['cash_sales'], []]) {
  for (const [answers, answer_labels] of choices) {
    const r = await run({ teams, answers, answer_labels });
    assert.ok(r.error, 'No finance team must never fall back to cash');
    assert.equal(r.importCalls, 0);
    assert.equal(r.notificationCalls, 0);
    assert.equal(r.persistedStatus, 'failed');
  }
}
console.log('PASS: no cash fallback; failed sync remains available for retry');

for (const teams of [['finance_sales'], []]) {
  const r = await run({ priorExists: true, teams, answers: { purchase: 'cash' } });
  assert.ifError(r.error);
  assert.equal(r.result.status, 'existing');
  assert.equal(r.eligibilityChecks, 0);
  assert.equal(r.importCalls, 1);
  assert.equal(r.notificationCalls, 0);
  assert.equal(r.persistedStatus, 'existing');
  assert.equal(r.importedPayload.sourceCode, 'meta_lead');
  assert.deepEqual(r.profileCalls,[false]);
}
for (const status of ['linked', 'existing']) {
  const r = await run({ status });
  assert.ifError(r.error);
  assert.equal(r.result.status, status);
  assert.equal(r.importCalls, 0);
  assert.equal(r.eligibilityChecks, 0);
  assert.equal(r.notificationCalls, 0);
}
const raced = await run({ race: true });
assert.ifError(raced.error);
assert.equal(raced.result.status, 'existing');
assert.equal(raced.notificationCalls, 0);
console.log('PASS: previous customers retain provenance-only import; completed sync and race are protected');

const verifiedExisting = await run({ status: 'existing', priorExists: true, reviewExisting: true });
assert.ifError(verifiedExisting.error);
assert.equal(verifiedExisting.result.status, 'existing');
assert.equal(verifiedExisting.importCalls, 0);
assert.deepEqual(verifiedExisting.profileCalls,[false]);
const linkedReview = await run({status:'linked',reviewExisting:true});
assert.ifError(linkedReview.error);
assert.equal(linkedReview.importCalls,0);
assert.deepEqual(linkedReview.profileCalls,[false]);
const recovered = await run({ status: 'existing', priorExists: true, reviewExisting: true, repairable: true });
assert.ifError(recovered.error);
assert.equal(recovered.result.status, 'linked');
assert.equal(recovered.importCalls, 1);
assert.equal(recovered.importedPayload.serviceKey, 'finance');
assert.equal(recovered.notificationCalls, 1);
console.log('PASS: manual review repairs only proven incomplete form links, leaving real existing links untouched');

const completedPartial = await run({status:'failed',priorExists:true,reviewExisting:true,sameSubmission:true});
assert.ifError(completedPartial.error);
assert.equal(completedPartial.result.status,'linked');
assert.equal(completedPartial.persistedStatus,'linked');
assert.equal(completedPartial.eligibilityChecks,0);
assert.equal(completedPartial.notificationCalls,0);
assert.deepEqual(completedPartial.profileCalls,[false]);
console.log('PASS: exact failed form submission can finish profile and become linked without redistribution');
