'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const pageSource = fs.readFileSync(path.join(root, 'src/marketing/pages/ProductsPage.tsx'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server/marketing/workflow.ts'), 'utf8');
const typesSource = fs.readFileSync(path.join(root, 'shared/marketing-workflow.ts'), 'utf8');
const orderSource = fs.readFileSync(path.join(root, 'src/marketing/workflow/strategyProductOrder.ts'), 'utf8');

// Load the declared TypeScript devDependency through Node's module resolution.
// Resolving the tsc executable and walking parent folders is not portable on Vercel.
const ts = require('typescript');
const compiled = ts.transpileModule(pageSource, {
  fileName: 'ProductsPage.tsx',
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
});
assert.equal(compiled.diagnostics?.length || 0, 0, 'ProductsPage must transpile without TSX syntax errors');

const element = (type, props) => ({ type, props: props || {} });
const components = {
  W: { products: 'المنتجات', statement: 'بيان المنتج', ideaName: 'اسم الفكرة', viewProduct: 'مشاهدة المنتج' },
  Empty() {}, MediaLabel() {}, ProductViewButton() {}, Search() {}, WorkAlert() {}, WorkHeader() {},
};
let currentSearch = '';
let currentTab = 'approved';
let stateIndex = 0;
let currentRows = [];
let requestedResource = null;
const requireMock = id => {
  if (id === 'react') return { useState: value => { const index = stateIndex++; return [index === 0 ? currentSearch : index === 4 ? currentTab : value, () => {}]; } };
  if (id === 'react/jsx-runtime') return { jsx: element, jsxs: element };
  if (id === '../workflow/components') return components;
  if (id === '../workflow/ProductReference') return { ProductReference() {} };
  if (id === '../workflow/StrategyDrafts') return { StrategyProductsTab() {} };
  if (id === '../workflow/strategyProductOrder') return orderModule.exports;
  if (id === '../workflow/api') return { useWorkQuery: resource => {
    requestedResource = resource;
    return { data: { rows: currentRows }, loading: false, error: null, reload: async () => {} };
  } };
  throw new Error(`Unexpected import ${id}`);
};
// The test uses the *real* publication-order utility, not a fake sorter.
const orderCompiled = ts.transpileModule(orderSource, {
  fileName: 'strategyProductOrder.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const orderModule = { exports: {} };
vm.runInNewContext('(function(module,exports){' + orderCompiled.outputText + '\n})', {})(orderModule, orderModule.exports);
const moduleMock = { exports: {} };
vm.runInNewContext('(function(require,module,exports){' + compiled.outputText + '\n})', {})(requireMock, moduleMock, moduleMock.exports);
const ProductsPage = moduleMock.exports.ProductsPage;

const children = node => Array.isArray(node) ? node : node === undefined || node === null ? [] : [node];
function find(node, type) {
  if (Array.isArray(node)) return node.flatMap(item => find(item, type));
  if (!node || typeof node !== 'object') return [];
  return [...(node.type === type ? [node] : []), ...find(node.props?.children, type)];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  return text(node.props?.children);
}
const mockProduct = (id, props = {}) => ({
  id, task_no: `TSK-${id}`, task_name: `مطلوب ${id}`, statement: `مطلوب ${id}`,
  idea_name: `فكرة ${id}`, media_kind: 'image', assignee_name: 'المنفذ',
  approved_at: '2026-10-26T20:00:00.000Z', released_at: '2026-10-26T20:00:00.000Z', publish_on: null, ...props,
});
const rows = [
  mockProduct('first', { assignee_name: 'سمر', approved_at: '2026-10-26T23:30:00.000Z', publish_on:'2026-12-03' }),
  mockProduct('second', { assignee_name: 'محمود', approved_at: '2026-10-24T08:15:00.000Z', publish_on:'2026-12-01' }),
  mockProduct('third', { assignee_name: '', approved_at: null, released_at: null }),
];
currentRows = rows;
stateIndex = 0;
const page = ProductsPage();
assert.equal(requestedResource, 'products');
const headers = find(page, 'th').map(text);
assert.deepEqual(headers, ['مسلسل','تاريخ اعتماد المنتج','بيان المنتج','اسم الفكرة','اسم المنفذ','مشاهدة المنتج']);
const bodyRows = find(page, 'tbody').flatMap(node => find(node, 'tr'));
assert.equal(bodyRows.length, 3);
assert.deepEqual(bodyRows.map(r => find(r, 'td').length), [6,6,6]);
assert.deepEqual(bodyRows.map(r => text(find(r,'td')[0])), ['1','2','3']);
const first = find(bodyRows[0], 'td');
assert.equal(text(first[4]), 'محمود', 'Earlier publication date must be first');
const expectedRiyadh = '24/10/2026';
assert.equal(text(find(first[1], 'time')[0]), expectedRiyadh, 'Approval date must respect MZJ Riyadh timezone');
assert.equal(find(first[1], 'time')[0].props.dateTime, rows[1].approved_at);
assert.equal(find(first[1], 'time')[0].props.dir, 'ltr', 'Approval date must render left-to-right');
assert.equal(find(first[1], 'time')[0].props.style.direction, 'ltr');
assert.equal(find(first[1], 'time')[0].props.style.unicodeBidi, 'isolate');
assert.equal(find(first[1], 'time')[0].props.style.whiteSpace, 'nowrap');
assert.equal(text(find(find(bodyRows[1], 'td')[1], 'time')[0]), '27/10/2026', 'Approval date must use DD/MM/YYYY');
assert.match(text(find(first[1], 'time')[0]), /^\d{2}\/\d{2}\/\d{4}$/, 'Date must not contain right-to-left formatting marks');
assert.equal(text(find(find(bodyRows[2], 'td')[1], 'time')[0]), '—', 'Missing approval timestamp must not be invented');
assert.equal(text(find(bodyRows[2], 'td')[4]), '—', 'Missing assignee must be explicit');
assert.equal(find(page,'time').length, 6); // approval + publication per product
assert.equal(text(first[1]).includes('2026/12/01'), true, 'Show the publication date used for sorting');
assert.equal(text(find(bodyRows[1],'td')[1]).includes('2026/12/03'), true);
assert.equal(find(page,components.ProductViewButton).length, 3, 'Existing view actions remain');

currentSearch = 'second';
stateIndex = 0;
const filtered = ProductsPage();
const filteredRows = find(filtered,'tbody').flatMap(node => find(node,'tr'));
assert.equal(filteredRows.length, 1);
assert.equal(text(find(filteredRows[0], 'td')[0]), '1', 'Visible rows must be renumbered after search');
assert.equal(text(find(filteredRows[0], 'td')[4]), 'محمود');

assert.match(serverSource, /i\.approved_at as released_at/);
assert.match(serverSource, /min\(l\.scheduled_on\)::text/);
assert.match(serverSource, /p\.kind='agenda'/);
assert.match(serverSource, /coalesce\(u\.full_name,'\'\) as assignee_name/);
assert.match(serverSource, /i\.status='approved'/);
assert.match(serverSource, /order by i\.approved_at desc/);
assert.match(typesSource, /approved_at\?: string \| null/);
assert.match(typesSource, /export type WorkProduct = WorkItem & \{ task_no: string; task_name: string; released_at: string/);
console.log('PASS - marketing approved products table: six columns, ascending publication date, approval date preserved, per-row numbering, executor, filtering, product view');
