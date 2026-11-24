import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); }
catch { ts = require(join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript')); }

const read = file => readFileSync(file, 'utf8');
const source = read('src/marketing/workflow/strategyProductOrder.ts');
const transpiled = ts.transpileModule(source, {
  fileName: 'strategyProductOrder.ts', reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const compileErrors = (transpiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
assert.equal(compileErrors.length, 0, 'Product ordering utility must compile');
const module = { exports: {} };
runInNewContext(transpiled.outputText, { module, exports: module.exports }, { filename: 'strategyProductOrder.js' });
const sort = rows => Array.from(module.exports.sortStrategyProductsByExecutionDate(rows));
assert.equal(typeof module.exports.sortStrategyProductsByExecutionDate, 'function');

let passed = 0;
function test(label, cb) { cb(); passed++; console.log(`PASS: ${label}`); }
const p = (id, executed, due = null, createdAt = '2026-11-24T00:00:00Z') => ({ itemId: id, approvedOn: executed, dueOn: due, createdAt });

test('real execution dates are ascending, regardless of input order or readiness', () => {
  const products = [p('unexecuted', null, '2026-11-01'), p('newer', '2026-12-03'), p('oldest', '2026-11-01'), p('middle', '2026-11-25')];
  assert.deepEqual(sort(products).map(row => row.itemId), ['oldest', 'middle', 'newer', 'unexecuted']);
});
test('0% or unfinished products with no execution date stay after executed products', () => {
  const products = [p('waiting', null, '2026-10-01'), p('executed', '2026-11-25')];
  assert.equal(sort(products)[0].itemId, 'executed');
});
test('missing execution dates order by each requirement delivery target', () => {
  assert.deepEqual(sort([p('later', null, '2027-01-31'), p('early', null, '2027-01-07'), p('no-target', null)]).map(x => x.itemId), ['early', 'later', 'no-target']);
});
test('equal execution days use the individual delivery target as tie breaker', () => {
  assert.deepEqual(sort([p('b', '2026-12-10', '2026-12-30'), p('a', '2026-12-10', '2026-12-01')]).map(x => x.itemId), ['a', 'b']);
});
test('same execution and delivery dates prefer newer creation', () => {
  assert.deepEqual(sort([p('older', '2026-12-10', null, '2026-10-20'), p('recent', '2026-12-10', null, '2026-11-20')]).map(x => x.itemId), ['recent', 'older']);
});
test('invalid and absent execution timestamps are treated as unexecuted', () => {
  assert.deepEqual(sort([p('invalid', 'not-a-date'), p('approved', '2026-12-01')]).map(x => x.itemId), ['approved', 'invalid']);
});
test('does not modify query response or its objects', () => {
  const input = Object.freeze([Object.freeze(p('x', null)), Object.freeze(p('y', '2026-12-01'))]);
  const result = sort(input);
  assert.deepEqual(result.map(x => x.itemId), ['y', 'x']);
  assert.notEqual(result, input);
  assert.deepEqual(input.map(x => x.itemId), ['x', 'y']);
});
test('per-requirement date reads the independent work item due_on in the collapsed row', () => {
  const detail = read('src/marketing/workflow/TaskDetail.tsx');
  const start = detail.indexOf('className="mkw-requirement-review-toggle"');
  const end = detail.indexOf('</button>', start);
  assert.ok(start > -1 && end > start);
  const toggler = detail.slice(start, end);
  assert.match(toggler, /تاريخ تسليم المطلوب:/);
  assert.match(toggler, /dateTime=\{item\.due_on\}/);
  assert.match(toggler, /showDate\(item\.due_on\)/);
  assert.doesNotMatch(toggler, /dueDates\[/);
  assert.doesNotMatch(toggler, /task\.due_to/);
});
test('per-requirement date has visible styling rather than hidden or clipped styling', () => {
  const css = read('src/marketing/workflow/workflow.css');
  assert.match(css, /\.mkw-requirement-review-identify \.mkw-requirement-due-on \{[^}]*display:inline-flex/);
  assert.match(css, /\.mkw-requirement-due-on time \{[^}]*direction:ltr/);
});
test('strategy products are sorted by their execution day after filtering', () => {
  const code = read('src/marketing/workflow/StrategyDrafts.tsx');
  assert.match(code, /sortStrategyProductsByExecutionDate\(\(query\.data\?\.rows \|\| \[\]\)\.filter/);
  assert.match(code, /row\.approvedOn \? showDate\(row\.approvedOn\)/);
});
test('approved products remain filtered and use their displayed approval date for ordering', () => {
  const code = read('src/marketing/pages/ProductsPage.tsx');
  assert.match(code, /\.sort\(\(a, b\) => \{/);
  assert.match(code, /a\.approved_at \|\| a\.released_at/);
  assert.match(code, /b\.approved_at \|\| b\.released_at/);
});
test('server provides independent due date and actual approval date', () => {
  const code = read('server/marketing/strategy-drafts.ts');
  assert.match(code, /i\.due_on::text,i\.approved_at/);
  assert.match(code, /dueOn: day\(row\.due_on\), approvedOn: row\.approved_at/);
  assert.match(read('shared/marketing-workflow.ts'), /due_on: string; status: WorkItemStatus/);
});
console.log(`${passed}/${12} individual due date and product execution-order checks passed`);
