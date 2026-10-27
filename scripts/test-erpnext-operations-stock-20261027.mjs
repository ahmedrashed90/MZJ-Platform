import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const require = createRequire(import.meta.url);
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const worker = (await import('../cloudflare-worker/mzj-next-wordpress-operations-full.js')).default;

const receipt = 'MAT-PRE-2026-00145';
const primary = {
  serial_no: '283956', name: '283956', type: 'ستاريا', class: 'بنزين 9 راكب اتوماتيك 3500 سي سي',
  agent: 'المجدوعي', model: '2027', custom_color: 'اسود', custom_external_color: 'اسود',
  warehouse: 'معرض الملتقي - ممزال', car_status: 'متاحة للحجز', detail: 'يوجد خدش بالسقف باب الراكب + السائق\n',
};
const second = { ...primary, serial_no: '283542', name: '283542', warehouse: 'خارج الصالة - ممزال', car_status: 'محجوزة', detail: '' };

// Worker preview reads all VINs from the original receipt even when a current
// Serial No purchase_document_no has changed to MAT-STE.
const calls = [];
const oldFetch = globalThis.fetch;
globalThis.fetch = async (request, options) => {
  const url = String(request);
  calls.push({ url, options });
  if (url.includes('/Purchase%20Receipt/')) return Response.json({ data: {
    name: receipt, docstatus: 1, items: [{ item_code: 'G01A-3.5', stock_qty: 2, serial_no: '283956\n283542' }],
  } });
  if (url.includes('/Serial%20No/283956')) return Response.json({ data: primary });
  if (url.includes('/Serial%20No/283542')) return Response.json({ data: { ...second, purchase_document_no: 'MAT-STE-2026-01164' } });
  if (url.includes('/api/integrations/erpnext/purchase-receipt-stock')) {
    const body = JSON.parse(options.body);
    assert.equal(body.dryRun, true);
    assert.equal(body.vehicles.length, 2);
    return Response.json({ ok: true, dryRun: true, total: 2, writes: 0 });
  }
  throw new Error(`Unexpected fetch: ${url}`);
};
const env = {
  WORKER_ADMIN_TOKEN: 'test-not-a-real-token', NEXT_API_KEY: 'test', NEXT_API_SECRET: 'test',
  MZJ_PLATFORM_URL: 'https://example.test', MZJ_STOCK_SYNC_KEY: 'test-platform-key',
};
try {
  const response = await worker.fetch(new Request('https://test.example/operations/preview', {
    method: 'POST', headers: { Authorization: `Bearer ${env.WORKER_ADMIN_TOKEN}` },
    body: JSON.stringify({ receipt, checkPlatform: true }),
  }), env, { waitUntil() {} });
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.ok, true);
  assert.equal(json.writes, 0);
  assert.deepEqual(json.payload.vehicles.map((v) => v.serial_no), ['283956', '283542']);
  assert.equal(json.payload.vehicles[0].detail.includes('خدش'), true);
  assert.equal(json.payload.vehicles[1].warehouse, 'خارج الصالة - ممزال');
  assert.equal(calls.some((call) => call.url.includes('mzjcars.com')), false);
  const unauthorized = await worker.fetch(new Request('https://test.example/operations/preview', {
    method: 'POST', body: JSON.stringify({ receipt }),
  }), env, { waitUntil() {} });
  assert.equal(unauthorized.status, 401);
} finally {
  globalThis.fetch = oldFetch;
}

// Transpile the isolated TypeScript mapping/controller and stub external
// modules to test it without any real DB, API or production credentials.
let platformCode = readFileSync(new URL('../server/integrations/erpnext-purchase-receipt-stock.ts', import.meta.url), 'utf8');
platformCode = ts.transpileModule(platformCode, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  reportDiagnostics: true,
}).outputText;
platformCode = platformCode.replace(/^import .*?;\s*$/gm, '');
platformCode = platformCode.replace(/export default async function handler/, 'async function handler');
platformCode = platformCode.replace(/export function mapNextReceiptVehicle/, 'function mapNextReceiptVehicle');
platformCode += '\n globalThis.__moduleResult = { handler, mapNextReceiptVehicle };\n';
let writes = 0;
let schemaBootstraps = 0;
const sql = function (parts, ...values) {
  if (!Array.isArray(parts) || !Array.isArray(parts.raw)) return parts;
  const query = parts.join('?');
  if (query.includes('from operations.locations')) return Promise.resolve([
    { id: 'location-multaqa', code: 'multaqa' }, { id: 'location-hallout', code: 'hall_out' },
  ]);
  if (query.includes('from operations.vehicle_statuses')) return Promise.resolve([
    { code: 'has_notes' }, { code: 'reserved' },
  ]);
  if (query.includes('from operations.vehicles')) return Promise.resolve(
    query.includes('limit 1') && values.includes('283542')
      ? [{ id: 'old-vehicle', status_code: 'delivered' }] : [],
  );
  throw new Error(`Unexpected SQL in read-only test: ${query}`);
};
sql.begin = () => { writes++; throw new Error('dry-run must not start a transaction'); };
const sandbox = {
  process: { env: { ERPNEXT_STOCK_SYNC_KEY: 'test-platform-key' } },
  getSql: () => sql,
  safeSecretEquals: (a, b) => a === b,
  ensureOperationsSchema: () => { schemaBootstraps++; },
  console,
};
sandbox.globalThis = sandbox;
vm.runInNewContext(platformCode, sandbox, { filename: 'platform-stock.js' });
const { mapNextReceiptVehicle, handler } = sandbox.__moduleResult;
assert.equal(mapNextReceiptVehicle(primary).statusCode, 'has_notes');
assert.equal(mapNextReceiptVehicle(primary).locationCode, 'multaqa');
assert.equal(mapNextReceiptVehicle(second).statusCode, 'reserved');
assert.equal(mapNextReceiptVehicle(second).locationCode, 'hall_out');
assert.equal(mapNextReceiptVehicle({ ...primary, serial_no: '001689' }).vin, '001689');
assert.equal(mapNextReceiptVehicle({ ...primary, detail: '' }).statusCode, 'available_for_sale');
assert.equal(mapNextReceiptVehicle({ ...primary, warehouse: 'unknown' }).locationCode, '');
const resp = {
  headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; return this; },
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return this; },
};
await handler({ method: 'POST', headers: { 'x-mzj-stock-key': 'test-platform-key' }, body: {
  receipt, event: 'on_submit', dryRun: true, vehicles: [primary, second],
} }, resp);
assert.equal(resp.statusCode, 200);
assert.equal(resp.body.writes, 0);
assert.equal(resp.body.results[0].action, 'would_insert');
assert.equal(resp.body.results[0].statusCode, 'has_notes');
assert.equal(resp.body.results[1].action, 'existing_unchanged');
assert.equal(resp.body.results[1].existingStatus, 'delivered');
assert.equal(writes, 0);
assert.equal(schemaBootstraps, 0);
console.log('PASS: Worker preview; original receipt VINs; site isolation; Platform mapping; dry-run; duplicates; sale protection; zero writes');
