'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { createLoader, scriptedSql } = require('./marketing-workflow-test-support.cjs');
const root = process.cwd();
const uuid = '00000000-0000-4000-8000-000000000023';
const user = { id: '00000000-0000-4000-8000-000000000001' };
const service = createLoader(root, {
  '../../shared/system-access.js': { hasPermission: () => true },
  '../_access-control.js': { getSystemAccess: () => ({ dataScope: 'all' }) },
  '../../shared/marketing-workflow.js': { isWorkDate: value => /^20\d{2}-\d{2}-\d{2}$/.test(value) },
  '../../shared/marketing-workflow-labels.js': { W: { denied: 'denied', invalid: 'invalid', notFound: 'not-found', immutable: 'immutable', requiredFields: 'required', saved: 'saved' } },
  '../../shared/marketing-publication-timing.js': { saudiCalendarDay: () => '2026-11-25' },
  '../_marketing-workflow-schema.js': { marketingStrategyDraftsReady: async () => true },
})('server/marketing/strategy-drafts.ts');
let checked = 0;
function done(label) { checked++; console.log('PASS:', label); }
function settingsSteps(kind, noteReady = true, hasNote = true) {
  return [
    { match: 'from marketing.strategy_plan_drafts where id=', rows: [{ id: uuid, kind, name: 'رمضان 2027', status: 'draft', platform_goals: [], created_by: user.id }] },
    { match: 'from marketing.strategy_plan_drafts where kind=', rows: [] },
    { match: "column_name='campaign_end_on'", rows: [{ ready: true }] },
    { match: 'select campaign_end_on::text', rows: [{ campaign_end_on: null }] },
    ...(hasNote ? [{ match: "column_name='submission_note'", rows: [{ ready: noteReady }] }] : []),
    ...(hasNote && !noteReady ? [] : [
      { match: 'update marketing.strategy_plan_drafts set name=', rows: [] },
      ...(hasNote ? [{ match: 'set submission_note=', check: values => assert(values.includes('يرجى مراجعة جدول النشر')), rows: [] }] : []),
    ]),
  ];
}
async function checkSaving(kind) {
  const sql = scriptedSql(settingsSteps(kind));
  const result = await service.saveStrategyDraftSettings(sql, user, { draftId: uuid, submissionNote: 'يرجى مراجعة جدول النشر' });
  assert.equal(result.ok, true);
  const noteWrites = sql.calls.filter(row => row.query.includes('set submission_note='));
  assert.equal(noteWrites.length, 1);
  assert(!sql.calls.some(row => /^(?:delete|truncate)/i.test(row.query)));
  sql.assertDone();
  done(`Optional review note persists on a ${kind} draft without changing approval`);
}
const src = file => fs.readFileSync(file, 'utf8');
function staticContract() {
  const draftUi = src('src/marketing/workflow/StrategyDrafts.tsx');
  const backend = src('server/marketing/strategy-drafts.ts');
  const planUi = src('src/marketing/workflow/PlanDetail.tsx');
  const schema = src('server/_marketing-workflow-schema.ts');
  assert(draftUi.includes('ملاحظة للمراجعة (اختياري)'));
  assert(draftUi.includes('onClick={() => void submitForReview()}'));
  assert(draftUi.indexOf('ملاحظة للمراجعة (اختياري)') > draftUi.indexOf('إرسال للمراجعة</button>'));
  assert(draftUi.includes("await workPost('strategy_save_draft', { draftId: draft.id, submissionNote });"));
  assert(backend.includes("decision: 'submitted', note: current.submissionNote || ''"));
  assert(planUi.includes('submissionReviewNote && <section'));
  assert(schema.includes('add column if not exists submission_note text not null default'));
  assert(schema.includes("values('schema-23')"));
  done('Notes appear under Submit in both draft kinds, and in native reviewer history');
  const capture = src('src/marketing/workflow/TaskDetail.tsx');
  assert(capture.includes("item.delivery_mode === 'drive_link' && <CaptureItemEditor"));
  assert(capture.includes("await workPost('save_item', { itemId: item.id, version: item.version, idea, explanation });"));
  assert(capture.includes('حفظ الفكرة لا يغيّر موعد التسليم أو رابط التصوير'));
  done('Photography reuses existing save_item API and never changes capture URL or deadline');
}
function captureTest() {
  const script = src('src/marketing/workflow/TaskDetail.tsx') + '\nexport { CaptureItemEditor };';
  const compiled = ts.transpileModule(script, {
    fileName: 'TaskDetail.tsx', reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  assert.equal(compiled.diagnostics?.length || 0, 0);
  const jsx = (type, props) => ({ type, props: props || {} });
  const recorded = [];
  let allowed = true;
  let cursor = 0;
  let state = [];
  const ownUser = { id: user.id };
  const react = {
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
    useEffect() {}, useRef: initial => ({ current: initial }),
  };
  const imports = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '../../auth/AuthContext': { useAuth: () => ({ user: allowed ? ownUser : { id: 'other' } }) },
    './api': { showDate: String, workPost: async (action, args) => { recorded.push({ action, args }); return { ok: true }; } },
    './components': { W: { idea: 'الفكرة', required: 'المطلوب', sizes: 'المقاسات' },
      Field: function Field(){}, WorkAlert: function WorkAlert(){}, Formats: function Formats(){} },
    '@phosphor-icons/react': {}, '../../components/Modal': {},
    '../../../shared/marketing-workflow': {}, '../../systemAccess': {},
    './dashboardSearch': {}, '../../../shared/marketing-review-note-format': {},
    './creativeDocx': {}, './taskPresentation': {},
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputText)(name => {
    if (!Object.prototype.hasOwnProperty.call(imports, name)) throw Error('Missing test import: ' + name);
    return imports[name];
  }, module, module.exports);
  function find(tree, check) {
    const matches = [];
    const walk = node => { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return;
      if (check(node)) matches.push(node); walk(node.props?.children); };
    walk(tree); return matches;
  }
  const item = { id: uuid, version: 9, assigned_to: user.id, status: 'in_progress', idea: 'البريف الأول', explanation: 'الشرح الأول',
    media_kind: 'video', formats: [], due_on: '2027-01-04', capture_url: '', capture_submitted_at: null };
  const base = { item, capabilities: { editTask: false }, refresh: async () => {} };
  function render(props) { cursor = 0; return module.exports.CaptureItemEditor(props); }
  return { render, find, recorded, item, base,
    revoke: () => { allowed = false; state = []; }, restore: () => { allowed = true; state = []; },
  };
}
async function captureScenarios() {
  const ui = captureTest();
  let tree = ui.render(ui.base);
  let button = ui.find(tree, node => node.type === 'button' && node.props.children === 'تعديل الفكرة')[0];
  assert(button, 'Photographer sees an Edit Idea control on an in-progress shoot');
  button.props.onClick();
  tree = ui.render(ui.base);
  const ideaInput = ui.find(tree, node => node.type === 'textarea' && node.props['aria-label'] === 'تعديل فكرة التصوير')[0];
  const explanation = ui.find(tree, node => node.type === 'textarea' && node.props['aria-label'] === 'تعديل شرح فكرة التصوير')[0];
  assert(ideaInput && explanation, 'Both idea and explanation are editable');
  ideaInput.props.onChange({ target: { value: 'البريف المعدل' } });
  explanation.props.onChange({ target: { value: 'الشرح المعدل' } });
  tree = ui.render(ui.base);
  const save = ui.find(tree, node => node.type === 'button' && node.props.children === 'حفظ الفكرة والشرح')[0];
  assert(save && !save.props.disabled);
  save.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.recorded.length, 1);
  assert.equal(ui.recorded[0].action, 'save_item');
  assert.equal(ui.recorded[0].args.idea, 'البريف المعدل');
  assert.equal(ui.recorded[0].args.explanation, 'الشرح المعدل');
  assert.equal(ui.recorded[0].args.dueOn, undefined);
  assert.equal(ui.recorded[0].args.url, undefined);
  done('Photographer can edit and save the brief without touching delivery or link');
  ui.revoke();
  tree = ui.render(ui.base);
  assert.equal(ui.find(tree, node => node.type === 'button' && node.props.children === 'تعديل الفكرة').length, 0);
  done('Unassigned viewer cannot edit another photographer\'s idea');
  ui.restore();
  tree = ui.render({ ...ui.base, item: { ...ui.item, status: 'rejected' }, capabilities: { editTask: true } });
  assert.equal(ui.find(tree, node => node.type === 'button' && node.props.children === 'تعديل الفكرة').length, 0);
  done('Rejected photography requirement remains immutable');
  ui.revoke();
  tree = ui.render({ ...ui.base, item: { ...ui.item, status: 'approved' }, capabilities: { editTask: true } });
  assert.equal(ui.find(tree, node => node.type === 'button' && node.props.children === 'تعديل الفكرة').length, 1);
  done('Authorized task editor can correct an approved photography brief');
}
(async () => {
  await checkSaving('agenda');
  await checkSaving('campaign');
  const oldSchema = scriptedSql(settingsSteps('agenda', false));
  await assert.rejects(() => service.saveStrategyDraftSettings(oldSchema, user,
    { draftId: uuid, submissionNote: 'يرجى مراجعة جدول النشر' }), /تحديث قاعدة بيانات التسويق/);
  oldSchema.assertDone();
  done('Missing migration blocks saving notes safely instead of dropping them');
  const untouched = scriptedSql(settingsSteps('agenda', true, false));
  await service.saveStrategyDraftSettings(untouched, user, { draftId: uuid, platformGoals: [] });
  assert(!untouched.calls.some(row => row.query.includes('set submission_note=')));
  untouched.assertDone();
  done('Unrelated draft settings updates leave saved review notes untouched');
  staticContract();
  await captureScenarios();
  console.log(`${checked}/${checked} strategy draft review-note and photography editor checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
