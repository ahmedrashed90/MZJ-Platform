const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const processor = fs.readFileSync(path.join(root, 'server/_integration-processor.ts'), 'utf8');
const lifecycle = fs.readFileSync(path.join(root, 'server/_crm-lifecycle.ts'), 'utf8');
const api = fs.readFileSync(path.join(root, 'server/integrations/[source].ts'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'mersal-worker/src/index.js'), 'utf8');
let ts;
try { ts = require('typescript'); }
catch { ts = require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript')); }
const extracted = processor.match(/async function applyMersalNoSelectionFinanceFallback\(input: \{[\s\S]*?(?=async function claimLatestServiceSelection\()/)?.[0];
assert.ok(extracted, 'Missing integrated Mersal fallback implementation');
const compiled = ts.transpileModule(extracted, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
assert.equal(compiled.diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error).length || 0, 0, 'TypeScript compilation errors');

const defaults = {
  routeSource: 'whatsapp', source: 'whatsapp', direction: 'in',
  payload: { providerEntryFlowHandled: true, entryFlowProvider: 'mersal', crmNoSelectionFallbackPolicy: 'finance_after_second_inbound' },
  knownService: '', explicitServiceSelection: false,
  conversationId: '00000000-0000-0000-0000-000000000001',
  messageId: '00000000-0000-0000-0000-000000000002',
  existingLeadAssignedTo: null, eventId: 'wamid.in.2',
};
const state = {
  classification_state: 'new', service_request_id: null,
  conversation_assigned_to: null, lead_assigned_to: null,
  has_open_request: false, has_previous_customer_message: true, has_automation_selected_choice: false,
};

async function evaluate(opts = {}) {
  let queryCalls = 0;
  let classificationCalls = 0;
  let args;
  const sql = async (_strings, ..._values) => { queryCalls++; return [{ ...state, ...(opts.state || {}) }]; };
  const classified = opts.classified || { request: { service_key: 'finance', assigned_to: 'rep-1', branch_code: 'physical-branch-1' } };
  const context = {
    getSql: () => sql,
    clean: (value) => value == null ? '' : String(value).trim(),
    first: (...values) => values.map(v => v == null ? '' : String(v).trim()).find(Boolean) || '',
    bool: value => value === true || value === 1 || ['true', '1', 'yes', 'on'].includes(String(value || '').toLowerCase()),
    classifyConversationService: async (options) => {
      classificationCalls++;
      args = options;
      if (opts.classifyError) throw opts.classifyError;
      return classified;
    },
  };
  const fn = vm.runInNewContext(compiled.outputText + '\napplyMersalNoSelectionFinanceFallback;', context);
  try {
    const result = await fn({ ...defaults, ...(opts.input || {}) });
    return { result, queryCalls, classificationCalls, args, error: null };
  } catch (error) {
    return { result: null, queryCalls, classificationCalls, args, error };
  }
}

(async () => {
  let tested = 0;
  const check = async (description, opts, predicate) => {
    const output = await evaluate(opts);
    assert.ok(predicate(output), description + '\n' + JSON.stringify(output));
    tested++;
  };
  await check('Second free-text reply classifies and assigns financing', {}, r =>
    Boolean(r.result?.request?.assigned_to) && r.classificationCalls === 1 && r.args.serviceKey === 'finance'
    && r.args.sourceCode === 'whatsapp' && r.args.classificationMethod === 'mersal_no_selection_default'
    && r.args.requirePrimaryAssignment === true && r.args.skipAutomaticTemplate === true
    && r.args.assignPrimary === true && r.args.assignCallCenter === true
    && r.args.requestedBranchCode === undefined);
  await check('First inbound message alone never triggers fallback', { state: { has_previous_customer_message: false } }, r => r.result === null && r.classificationCalls === 0);
  await check('Already selected cash keeps explicit service choice', { input: { knownService: 'cash', explicitServiceSelection: true } }, r => r.queryCalls === 0 && r.classificationCalls === 0);
  await check('Previously classified finance stays where it is', { state: { classification_state: 'classified', service_request_id: 'req' } }, r => r.classificationCalls === 0);
  await check('Existing open service request is preserved', { state: { has_open_request: true } }, r => r.classificationCalls === 0);
  await check('Automation choice already captured is never changed by fallback', { state: { has_automation_selected_choice: true } }, r => r.classificationCalls === 0);
  await check('Worker without the agreed fallback policy is unchanged', { input: { payload: { entryFlowProvider: 'mersal', providerEntryFlowHandled: true } } }, r => r.queryCalls === 0);
  await check('Existing lead owner is preserved', { state: { lead_assigned_to: 'rep-existing' } }, r => r.classificationCalls === 0);
  await check('Historical preassigned lead is preserved', { input: { existingLeadAssignedTo: 'rep-existing' } }, r => r.classificationCalls === 0);
  await check('Fake Mersal metadata cannot request default', { input: { payload: { entryFlowProvider: 'mersal', providerEntryFlowHandled: false } } }, r => r.queryCalls === 0);
  await check('Non-WhatsApp messages are unaffected', { input: { routeSource: 'facebook', source: 'facebook' } }, r => r.queryCalls === 0);
  await check('Outgoing messages are unaffected', { input: { direction: 'out' } }, r => r.queryCalls === 0);
  await check('Concurrency with explicit cash choice is respected', { classified: { request: { service_key: 'cash', assigned_to: 'existing-rep' } } }, r => r.result === null);
  await check('Assignment failure is NOT silently saved', { classified: { request: { service_key: 'finance', assigned_to: null } } }, r => Boolean(r.error) && /could not assign/.test(r.error.message));
  await check('CRM errors propagate so provider can retry', { classifyError: new Error('No active reps') }, r => Boolean(r.error) && r.error.message === 'No active reps');

  assert.ok(lifecycle.includes('requirePrimaryAssignment?: boolean;'), 'Strict-assignment lifecycle option was not added');
  assert.ok(lifecycle.includes("if (input.requirePrimaryAssignment && !assignment.assignedTo)"), 'Strict assignment missing in create path');
  assert.ok(api.includes('assignedBranchCode: result.conversation?.branch_code'), 'API branch diagnostics absent');
  assert.ok(worker.includes('defaultFinanceFallbackApplied: result.data?.result?.defaultFinanceFallback?.applied === true'), 'Worker fallback diagnostics absent');
  assert.ok(processor.indexOf('const defaultFinanceFallback = direction === "in"') > processor.indexOf('automation = await handleAutomationInbound'), 'Fallback should run after automation to protect explicit choices');
  console.log('Mersal finance fallback policy tests passed:', tested, 'cases + integration diagnostics assertions');
})().catch(e => { console.error(e); process.exitCode = 1; });
