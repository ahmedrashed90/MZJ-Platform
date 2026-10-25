import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const root = process.cwd();
const shared = createLoader(root)('shared/marketing-workflow.ts');
const plan = createLoader(root)('src/marketing/workflow/planComposer.ts');
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ig = uid(10), fb = uid(11);
const postTypes = [
  { id: uid(21), platform_id: ig, name: 'Photo' },
  { id: uid(22), platform_id: ig, name: 'Story' },
  { id: uid(23), platform_id: ig, name: 'Reel' },
  { id: uid(24), platform_id: fb, name: 'Photo' },
  { id: uid(25), platform_id: fb, name: 'Video' },
];
const products = [{ id: uid(31), task_no: 'TSK-000001', task_id: uid(41), task_name: 'Content campaign', idea_name: 'First design', idea: 'Make photo', media_kind: 'image', sort_order: 1, assignee_name: 'Design', formats: [postTypes[0]] },
  { id: uid(32), task_no: 'TSK-000002', task_id: uid(42), task_name: 'Video campaign', idea_name: 'Second Reel', idea: 'Shoot video', media_kind: 'video', sort_order: 2, assignee_name: 'Video', formats: [postTypes[2]] }];
const meta = { platforms: [{ id: ig, name: 'Instagram', code: 'instagram' }, { id: fb, name: 'Facebook', code: 'facebook' }], postTypes };
const source = fs.readFileSync('src/marketing/workflow/CreatePage.tsx', 'utf8').replace('function PlanComposer(', 'export function PlanComposer(');
const transpiled = ts.transpileModule(source, { fileName: 'CreatePage.tsx', reportDiagnostics: true, compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} });
assert.deepEqual(transpiled.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error).map(item => item.messageText), []);
const jsx = (type, props, key) => ({ type, props: props || {}, key });
const Stub = () => null;
let slots = [], cursor = 0, saves = [], navigations = [];
function useState(initial) {
  const index = cursor++;
  if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
  return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
}
const frontExports = {};
vm.runInNewContext(transpiled.outputText, { exports: frontExports, crypto,
  console, Array, Object, Set, Map, Number, String, Date, Math, Intl,
  require(name) {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
    if (name === 'react') return { useState, useMemo: fn => fn(), useRef: value => ({ current: value }), useCallback: fn => fn, useEffect: () => {} };
    if (name === 'react-router-dom') return { useNavigate: () => path => navigations.push(path), useSearchParams: () => [new URLSearchParams(), () => {}] };
    if (name === '@phosphor-icons/react') return Object.fromEntries(['CalendarBlank','FilmStrip','ImageSquare','ListChecks','Megaphone','Plus','X'].map(key => [key,Stub]));
    if (name === './components') return { W: { selectProduct: 'اختر المنتج', addDate: 'إضافة يوم', remove: 'حذف', choose: 'اختر', agenda: 'أجندة', campaign: 'حملة', publishDate: 'تاريخ النشر', fundingDate: 'تاريخ التمويل', createCampaign: 'إنشاء حملة', createAgenda: 'إنشاء أجندة', cancel: 'إلغاء', loading: 'تحميل' }, Empty: Stub, Field: Stub, FormatSelector: Stub, ProductViewButton: Stub, WorkAlert: Stub, WorkHeader: Stub };
    if (name === './api') return { useWorkQuery: () => ({ data: { rows: products }, loading: false, error: '' }), workPost: async (action, body) => { saves.push({action,body}); return {ok:true}; }, uploadWorkFile: () => {}, showDate: () => {} };
    if (name === '../../../shared/marketing-workflow') return shared;
    if (name === './requiredMedia') return { splitRequiredMediaSelection: () => [] };
    if (name === './planComposer') return plan;
    throw new Error('Unexpected frontend module ' + name);
  },
}, { timeout: 3000 });
function render(kind = 'campaign') { cursor = 0; return frontExports.PlanComposer({ kind, initialProduct: '', meta }); }
function nodes(node, predicate) {
  if (node === undefined || node === null || node === false) return [];
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
  if (typeof node !== 'object') return [];
  const match = predicate(node) ? [node] : [];
  return match.concat(nodes(node.props?.children, predicate));
}
function byLabel(tree, type, label) { return nodes(tree, node => node.type === type && node.props['aria-label'] === label); }
function workRows(tree) { return nodes(tree, node => node.type === 'div' && node.props.className === 'mkw-plan-table-row'); }
let checks = 0;
function check(ok, message) { assert.ok(ok, message); checks++; console.log(`PASS: ${message}`); }
let tree = render();
const firstPicker = byLabel(tree, 'select', 'اختر المنتج')[0];
firstPicker.props.onChange({ target: { value: products[0].id } });
tree = render();
check(workRows(tree).length === 1 && byLabel(tree, 'select', 'اختر المنتج')[0].props.value === products[0].id, 'Campaign first product can be selected');
const platformInputs = nodes(tree, node => node.type === 'input' && node.props.type === 'checkbox');
check(platformInputs.length === 2 && !platformInputs.some(input => input.props.checked), 'Both supported platforms are available as independent checkboxes');
platformInputs.forEach(input => input.props.onChange());
tree = render();
check(nodes(tree, node => node.type === 'input' && node.props.type === 'checkbox' && node.props.checked).length === 2, 'Both platforms can be enabled simultaneously for one product');
check(byLabel(tree, 'select', 'نوع النشر — Instagram')[0].props.value === '' && byLabel(tree, 'select', 'نوع النشر — Facebook')[0].props.value === uid(24), 'Formats narrow to image-compatible choices and single option fills automatically');
byLabel(tree, 'select', 'نوع النشر — Instagram')[0].props.onChange({ target: { value: uid(21) } });
tree = render();
byLabel(tree, 'input', 'ميزانية Instagram')[0].props.onChange({ target: { value: '120.50' } });
byLabel(tree, 'input', 'ميزانية Facebook')[0].props.onChange({ target: { value: '80' } });
const date = nodes(tree, node => node.type === 'input' && node.props.type === 'date')[0];
date.props.onChange({ target: { value: '2026-10-17' } });
tree = render();
// Add a second day; its picker may contain the video product only.
const addDay = nodes(tree, node => node.type === 'button' && String((node.props.children || []).at?.(-1) || '') === 'إضافة يوم')[0];
check(!!addDay && !addDay.props.disabled, 'Add-day button permits another unused product');
addDay.props.onClick();
tree = render();
check(workRows(tree).length === 2, 'Campaign adds independent day without copying first product or platforms');
const secondSelect = byLabel(tree, 'select', 'اختر المنتج')[1];
const availableProducts = nodes(secondSelect, node => node.type === 'option' && node.props.value).map(item => item.props.value);
check(availableProducts.length === 1 && availableProducts[0] === products[1].id, 'First selected product is absent from every later dropdown');
secondSelect.props.onChange({ target: { value: products[1].id } });
tree = render();
const secondRow = workRows(tree)[1];
const secondCheckboxes = nodes(secondRow, node => node.type === 'input' && node.props.type === 'checkbox');
secondCheckboxes[0].props.onChange();
tree = render();
check(nodes(workRows(tree)[1], node => node.type === 'option' && node.props.value === uid(21)).length === 0, 'Video day does not show photo-only post types');
check(nodes(workRows(tree)[1], node => node.type === 'option' && node.props.value === uid(23)).length === 1, 'Video day offers Reel for Instagram');
const secondType = byLabel(workRows(tree)[1], 'select', 'نوع النشر — Instagram')[0];
secondType.props.onChange({ target: { value: uid(23) } });
tree = render();
byLabel(workRows(tree)[1], 'input', 'ميزانية Instagram')[0].props.onChange({ target: { value: '49' } });
const secondDate = nodes(workRows(tree)[1], node => node.type === 'input' && node.props.type === 'date')[0];
secondDate.props.onChange({ target: { value: '2026-10-18' } });
tree = render();
const form = nodes(tree, node => node.type === 'form')[0];
await form.props.onSubmit({ preventDefault() {} });
check(saves.length === 1 && saves[0].action === 'create_plan' && saves[0].body.entries.length === 2, 'Submitting campaign sends one product per day to the original create_plan route');
check(saves[0].body.entries[0].platforms.length === 2 && saves[0].body.entries[0].platforms[0].budget === 120.5 && saves[0].body.entries[0].platforms[1].budget === 80, 'Campaign submit persists each selected platform and budget separately');
check(saves[0].body.entries[1].platforms.length === 1 && saves[0].body.entries[1].platforms[0].postTypeId === uid(23), 'Second video product retains its different compatible publish format');
check(navigations.at(-1) === '/marketing', 'Successful save preserves original return navigation');
// Rendering the same component in agenda mode omits budget fields but keeps multi-selection.
slots = []; cursor = 0;
tree = render('agenda');
check(byLabel(tree, 'input', 'ميزانية Instagram').length === 0 && byLabel(tree, 'select', 'اختر المنتج').length === 1, 'Agenda shares the product workflow without campaign budgets');
console.log(`${checks}/${checks} rendered campaign and agenda UI checks passed`);
