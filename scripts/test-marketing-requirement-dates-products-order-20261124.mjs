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
function transpile(code, fileName) {
  const result = ts.transpileModule(code, {
    fileName, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  assert.equal((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, `${fileName} transpiles`);
  const module = { exports: {} };
  runInNewContext(result.outputText, { module, exports: module.exports }, { filename: fileName });
  return module.exports;
}
const ordering = transpile(read('src/marketing/workflow/strategyProductOrder.ts'), 'strategyProductOrder.ts');
const sort = rows => Array.from(ordering.sortProductsByPublishDate(rows));

let passed = 0;
function test(label, cb) { cb(); passed++; console.log(`PASS: ${label}`); }
const p = (itemId, publishOn, opts = {}) => ({ itemId, publishOn, createdAt: '2026-11-24T00:00:00Z', ...opts });

test('publish dates order ASC for December screenshot (not execution or readiness)', () => {
  const rows = [p('dec03', '2026-12-03', { approvedOn: '2026-11-01' }),
    p('dec02', '2026-12-02', { approvedOn: '2026-11-30' }),
    p('dec01', '2026-12-01', { approvedOn: null }),
    p('dec04', '2026-12-04'), p('dec06', '2026-12-06'), p('dec05', '2026-12-05')];
  assert.deepEqual(sort(rows).map(r => r.itemId), ['dec01','dec02','dec03','dec04','dec05','dec06']);
});
test('36 ideas can have 316 publications without affecting sort of ideas', () => {
  const rows = Array.from({ length: 36 }, (_, i) => {
    const day = `2026-12-${String(Math.min(31, 36 - i)).padStart(2,'0')}`;
    return p(`idea-${i}`, day, { publishDates: Array(i < 28 ? 9 : 8).fill(day) });
  });
  assert.equal(rows.reduce((count, row) => count + row.publishDates.length, 0), 316);
  assert.equal(sort(rows).length, 36);
  assert.equal(sort(rows)[0].itemId, 'idea-35'); // 2026-12-01 is the earliest day
});
test('when an idea has multiple platform dates, its earliest scheduled date is used', () => {
  assert.equal(ordering.productPublicationDay(p('multi', '2026-12-18', {publishDates: ['2026-12-15','2026-12-07','2026-12-20']})), '2026-12-07');
  assert.deepEqual(sort([p('later','2026-12-10'),p('multi','2026-12-18',{publishDates:['2026-12-07','2026-12-20']})]).map(r=>r.itemId), ['multi','later']);
});
test('strategy rows without publish date go to the end, even when approved', () => {
  assert.deepEqual(sort([p('empty',null,{approvedOn:'2026-01-01'}),p('dated','2026-12-01',{approvedOn:null})]).map(r=>r.itemId), ['dated','empty']);
});
test('invalid/malformed days are treated as missing (not calendar overflow)', () => {
  assert.deepEqual(sort([p('invalid','2026-13-47'),p('dated','2026-12-01'),p('text','not a date')]).map(r=>r.itemId), ['dated','invalid','text']);
});
test('same publish day uses newest created date, then stable ID', () => {
  assert.deepEqual(sort([
    p('older','2026-12-10',{createdAt:'2026-11-01'}),
    p('newer','2026-12-10',{createdAt:'2026-11-24'}),
  ]).map(r=>r.itemId), ['newer','older']);
  assert.deepEqual(sort([p('b','2026-12-10'),p('a','2026-12-10')]).map(r=>r.itemId), ['a','b']);
});
test('sorting does not mutate the query result or date arrays', () => {
  const a = Object.freeze(p('a','2026-12-07',{publishDates:Object.freeze(['2026-12-09','2026-12-07'])}));
  const b = Object.freeze(p('b','2026-12-02'));
  const rows = Object.freeze([a,b]);
  assert.deepEqual(sort(rows).map(r=>r.itemId), ['b','a']);
  assert.equal(rows[0].itemId, 'a');
  assert.deepEqual(Array.from(a.publishDates), ['2026-12-09','2026-12-07']);
});
test('approved product rows use their native agenda publish_on field', () => {
  assert.deepEqual(sort([{id:'late',publish_on:'2026-12-25'},{id:'early',publish_on:'2026-12-01'}]).map(r=>r.id), ['early','late']);
});
test('work due date renders Gregorian YYYY/MM/DD with no bidi controls', () => {
  const detail = read('src/marketing/workflow/TaskDetail.tsx');
  const start = detail.indexOf('function requirementDueLabel(');
  const end = detail.indexOf('function riyadhToday()', start);
  assert.ok(start > 0 && end > start);
  const dates = transpile(`${detail.slice(start, end)}\nmodule.exports = { requirementDueLabel };`, 'workDueDate.ts');
  assert.equal(dates.requirementDueLabel('2027-01-11'),'2027/01/11');
  assert.equal(dates.requirementDueLabel('2027-01-01'),'2027/01/01');
  assert.equal(dates.requirementDueLabel(''),'—');
  assert.doesNotMatch(dates.requirementDueLabel('2027-01-11'),/[\u200e\u200f\u202a-\u202e]/);
});
test('individual work-item due date is LTR and never derives from the task range', () => {
  const detail = read('src/marketing/workflow/TaskDetail.tsx');
  const start = detail.indexOf('className="mkw-requirement-review-toggle"');
  const end = detail.indexOf('</button>', start);
  const toggle = detail.slice(start, end);
  assert.match(toggle, /تاريخ تسليم المطلوب:/);
  assert.match(toggle, /<time dateTime=\{item\.due_on\} dir="ltr">\{requirementDueLabel\(item\.due_on\)\}<\/time>/);
  assert.doesNotMatch(toggle, /dueDates\[|task\.due_to/);
  const css = read('src/marketing/workflow/workflow.css');
  assert.match(css, /\.mkw-requirement-due-on time \{[^}]*display:inline-block;[^}]*white-space:nowrap;[^}]*direction:ltr/);
});
test('strategy tab sorts the filtered API ideas by publication date and still displays it', () => {
  const code = read('src/marketing/workflow/StrategyDrafts.tsx');
  assert.match(code, /sortProductsByPublishDate\(\(query\.data\?\.rows \|\| \[\]\)\.filter/);
  assert.match(code, /row\.publishDates\?\.length/);
  assert.match(code, /row\.approvedOn \? showDate\(row\.approvedOn\)/);
});
test('approved tab sorts by agenda publication date and preserves approval date field', () => {
  const page = read('src/marketing/pages/ProductsPage.tsx');
  const server = read('server/marketing/workflow.ts');
  assert.match(page, /sortProductsByPublishDate\(\(query\.data\?\.rows \|\| \[\]\)\.filter/);
  assert.match(page, /productPublicationDay\(product\)/);
  assert.match(page, /approvalDate\(approvedAt\)/);
  assert.match(server, /min\(l\.scheduled_on\)::text/);
  assert.match(server, /l\.product_id=i\.id and l\.is_deleted=false and p\.is_deleted=false and p\.kind='agenda'/);
  assert.match(read('shared/marketing-workflow.ts'), /publish_on\?: string \| null/);
});
test('underlying per-item delivery and approval data remain independent', () => {
  const source = read('server/marketing/strategy-drafts.ts');
  assert.match(source, /i\.due_on::text,i\.approved_at/);
  assert.match(source, /dueOn: day\(row\.due_on\), approvedOn: row\.approved_at/);
  assert.match(read('shared/marketing-workflow.ts'), /due_on: string; status: WorkItemStatus/);
});
console.log(`${passed}/${13} work item date and product publication-order checks passed`);
