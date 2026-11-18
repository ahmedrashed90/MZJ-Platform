import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(path.join(root, name), 'utf8');
const table = read('src/operations/components/VehicleTable.tsx');
const detail = read('src/operations/components/VehicleDetailModal.tsx');
const inventory = read('src/operations/pages/InventoryPage.tsx');
const styles = read('src/styles.css');
const catalog = read('shared/operations-inventory-fields.ts');
import typescript from 'typescript';
const tests = [
  ['VIN first and tajyeer immediately after it in the table', () => {
    const keys = [...table.matchAll(/^\s*\{ key: "([^"]+)", label: /gm)].map(match => match[1]);
    assert.deepEqual(keys.slice(0, 3), ['vin','tajyeer','car']);
    assert.equal(keys.filter(key => key === 'tajyeer').length, 1);
  }],
  ['Batch removed from stock table but still available in vehicle detail', () => {
    assert.doesNotMatch(table, /\{ key: "batch",/);
    assert.match(detail, /\["[^"\]]+", vehicle\.batch_no\]/);
  }],
  ['VIN and tajyeer adjacent in the details modal', () => {
    assert.match(detail, /vehicle\.vin\], \["[^"\]]+", vehicle\.is_tajyeer \? /);
    assert.equal((detail.match(/vehicle\.is_tajyeer \?/g) || []).length, 1);
  }],
  ['No-tajyeer row is marked and yes-tajyeer row is not', () => {
    assert.match(table, /className=\{row\.is_tajyeer \? undefined : "operations-tajyeer-pending"\}/);
  }],
  ['Red row tint and hover include all cells and sticky VIN cell', () => {
    assert.match(styles, /tr\.operations-tajyeer-pending > td\s*\{\s*background:\s*#[0-9a-f]{6}/i);
    assert.match(styles, /tr\.operations-tajyeer-pending > td:first-child\s*\{/);
    assert.match(styles, /tr\.operations-tajyeer-pending:hover > td/);
    assert.match(styles, /tr\.operations-tajyeer-pending:hover > td:first-child/);
  }],
  ['Batch remains available for Excel export and is permission-filtered', () => {
    assert.match(inventory, /\{ key: "batch", label: "[^"\n]+", read: \(row\) => row\.batch_no \}/);
    assert.match(inventory, /meta\.inventoryVisibleColumns\.includes\(item\.key\)/);
    assert.match(catalog, /key: "batch"/);
  }],
  ['Export has VIN then tajyeer, and notes remain', () => {
    const keys = [...inventory.matchAll(/^\s*\{ key: "(vin|tajyeer|car|notes|batch)", label:/gm)].map(match => match[1]);
    assert.deepEqual(keys.slice(0, 3), ['vin','tajyeer','car']);
    assert.ok(keys.includes('notes'));
  }],
  ['Tajyeer permission checks and filters have not been bypassed', () => {
    assert.match(inventory, /canUpdateTajyeer \?/);
    assert.match(inventory, /meta\.inventoryVisibleColumns\.includes\("tajyeer"\)/);
  }],
  ['Modified TSX source parses with TypeScript', () => {
    for (const [file, code] of [['VehicleTable.tsx',table],['VehicleDetailModal.tsx',detail],['InventoryPage.tsx',inventory]]) {
      const parsed = typescript.createSourceFile(file, code, typescript.ScriptTarget.Latest, true, typescript.ScriptKind.TSX);
      assert.deepEqual(parsed.parseDiagnostics.map(d=>typescript.flattenDiagnosticMessageText(d.messageText,' ')), [], file);
    }
  }],
];
let failed = 0;
for (const [label, test] of tests) {
  try { test(); console.log(`PASS: ${label}`); }
  catch (error) { failed++; console.error(`FAIL: ${label}\n${error.stack}`); }
}
console.log(`Inventory row presentation checks: ${tests.length-failed}/${tests.length}`);
if (failed) process.exit(1);
