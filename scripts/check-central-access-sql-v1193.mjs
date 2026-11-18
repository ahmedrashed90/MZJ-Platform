import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  'database/migrations/20260724_central_access_control_v1190.sql',
  'database/seeds/20260724_central_access_catalog.sql',
  'server/_access-control-schema.ts',
];

const trailingCommaBeforeConflict = /,\s*\n\s*on\s+conflict/gi;
const expectedFinalPageRow = "('tracking','delete','حذف طلبات التراكينج','/tracking/delete',30,true)\non conflict(system_code,code)";
let failed = 0;

for (const relative of targets) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const badMatches = [...source.matchAll(trailingCommaBeforeConflict)];
  const hasExpectedPageEnding = source.includes(expectedFinalPageRow);
  const ok = badMatches.length === 0 && hasExpectedPageEnding;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${relative}`);
  if (!ok) {
    if (badMatches.length) console.error(`  found ${badMatches.length} trailing comma(s) before ON CONFLICT`);
    if (!hasExpectedPageEnding) console.error('  central system_pages VALUES list does not end with the expected final row');
    failed += 1;
  }
}

if (failed) process.exit(1);
console.log(`Central access SQL syntax regression checks passed: ${targets.length}/${targets.length}`);
