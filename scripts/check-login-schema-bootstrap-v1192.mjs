import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const schema = read('server/_access-control-schema.ts');
const auth = read('server/_auth.ts');
const login = read('server/auth/login.ts');
const setup = read('server/setup/initialize.ts');

const checks = [
  ['schema readiness state exists', schema.includes('core.access_control_schema_state') && schema.includes('version,updated_at')],
  ['schema bootstrap uses advisory lock', schema.includes('withDatabaseAdvisoryLock') && schema.includes('ensureAccessControlSchema')],
  ['schema bootstrap verifies auth columns', schema.includes("table_name='sessions' and column_name='permission_version'")],
  ['login initializes schema before query', login.includes('await ensureAccessControlSchema();')],
  ['session creation initializes schema', auth.includes('export async function createSession') && auth.includes('await ensureAccessControlSchema();')],
  ['session lookup initializes schema', auth.includes('export async function getSessionUser') && auth.includes('await ensureAccessControlSchema();')],
  ['profile loading initializes schema', auth.includes('export async function loadUserProfile') && auth.includes('await ensureAccessControlSchema();')],
  ['setup uses the same bootstrap service', setup.includes('await ensureAccessControlSchema();') && !setup.includes('runSqlScript(ACCESS_CONTROL_SQL)')],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
console.log(`Login schema bootstrap checks passed: ${checks.length}/${checks.length}`);
