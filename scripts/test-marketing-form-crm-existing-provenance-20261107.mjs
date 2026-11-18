import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const code = ts.transpileModule(readFileSync(new URL('../server/marketing/lead-forms-crm.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
});
assert.equal((code.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);

for (const priorExists of [true, false]) {
  const form = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', form_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: 'عميل', phone: '966505050000', source: 'Meta',
    campaign: 'حملة اختبار', medium: 'paid', ad_id: '1', answers: {}, answer_labels: {},
    crm_status: 'pending', crm_lead_id: null, created_at: '2026-11-07T12:00:00Z',
  };
  let eligibilityChecks = 0;
  let importCalls = 0;
  let notificationCalls = 0;
  let persistedStatus = '';
  let importedPayload = null;
  const sql = async (parts, ...values) => {
    const query = parts.join('?').replace(/\s+/g, ' ').toLowerCase();
    if (query.includes('from marketing.form_leads')) return [{ ...form }];
    if (query.includes('select id::text from crm.leads')) return priorExists ? [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }] : [];
    if (query.includes('select distinct d.code as department_code')) {
      eligibilityChecks++;
      return [{ department_code: 'cash_sales' }, { department_code: 'finance_sales' }];
    }
    if (query.includes('insert into integrations.inbound_events')) return [];
    if (query.includes('update marketing.form_leads set crm_status=')) {
      persistedStatus = values[0];
      return [];
    }
    throw new Error(`Unexpected SQL ${query.slice(0,100)}`);
  };
  sql.json = data => data;
  const modules = {
    '../_db.js': { getSql: () => sql, withDatabaseAdvisoryLock: async (_key, work) => work() },
    '../_crm-schema.js': { ensureCrmSchema: async () => {} },
    '../_phone-utils.js': { normalizePhone: number => String(number).replace(/\D/g, '') },
    '../_crm-lead-import.js': { processLeadImportEvent: async (route, event, payload) => {
      importCalls++;
      assert.equal(route, 'marketing-form');
      assert.equal(event, 'marketing-form:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      importedPayload = payload;
      return { lead: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, existedBefore: priorExists, createLead: !priorExists };
    } },
    '../_notifications.js': { createNotification: async () => { notificationCalls++; }, notificationDedupe: () => 'test' },
    './form-lead-routing.js': { formPurchasePreference: () => 'cash', undecidedFormService: () => 'cash' },
  };
  const module = { exports: {} };
  new Function('require','module','exports',code.outputText)(name => {
    if (!Object.hasOwn(modules, name)) throw new Error(`Unexpected import ${name}`);
    return modules[name];
  }, module, module.exports);
  const result = await module.exports.syncMarketingFormLeadToCrm(form.id);
  assert.equal(importCalls, 1, 'Both new and existing leads must use the protected shared import path');
  assert.equal(importedPayload.sourceCode, 'meta_lead');
  assert.equal(eligibilityChecks, priorExists ? 0 : 1, 'Previously-registered customers must not depend on available sales staff');
  assert.equal(result.status, priorExists ? 'existing' : 'linked');
  assert.equal(persistedStatus, result.status);
  assert.equal(notificationCalls, priorExists ? 0 : 1);
}
console.log('PASS: existing Meta forms log provenance without new distribution; brand-new forms still use eligibility and notifications');
