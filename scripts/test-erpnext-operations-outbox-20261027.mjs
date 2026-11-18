import assert from 'node:assert/strict';
const worker = (await import('../cloudflare-worker/mzj-next-wordpress-operations-full.js')).default;
const receipt = 'MAT-PRE-2026-00145';
const rows = new Map();
const messages = [];
const d1 = {
  prepare(query) {
    return {
      bind(...params) {
        return {
          async run() {
            if (query.includes('insert into mzj_operations_stock_jobs')) {
              if (!rows.has(params[0])) rows.set(params[0], { receipt: params[0], state: 'pending', attempts: 0, next_attempt_at: params[2], locked_until: 0 });
            } else if (query.includes("set state = 'delivered'")) {
              Object.assign(rows.get(params[2]), { state: 'delivered', attempts: rows.get(params[2]).attempts + 1, locked_until: 0 });
            } else if (query.includes("set state='pending'")) {
              Object.assign(rows.get(params[4]), { state: 'pending', attempts: params[0], next_attempt_at: params[1], locked_until: 0 });
            } else throw new Error(`Unexpected D1 .run(): ${query}`);
            return { success: true };
          },
          async first() {
            if (query.includes('update mzj_operations_stock_jobs')) {
              const row = rows.get(params[2]);
              if (!row || row.state !== 'pending' || row.next_attempt_at > params[3] || row.locked_until > params[4]) return null;
              row.locked_until = params[0];
              return { receipt: row.receipt, attempts: row.attempts };
            }
            if (query.includes('select state, next_attempt_at, locked_until')) return rows.get(params[0]);
            throw new Error(`Unexpected D1 .first(): ${query}`);
          },
          async all() { return { results: [] }; },
        };
      },
    };
  },
};
const env = {
  WORKER_ADMIN_TOKEN: 'test-token', NEXT_API_KEY: 'test', NEXT_API_SECRET: 'test',
  MZJ_PLATFORM_URL: 'https://example.test', MZJ_STOCK_SYNC_KEY: 'platform-test',
  MZJ_STOCK_DB: d1,
  MZJ_STOCK_QUEUE: { async send(body) { messages.push(body); } },
};
const oldFetch = globalThis.fetch;
let platformAttempts = 0;
let siteCalls = 0;
globalThis.fetch = async (request, options) => {
  const url = String(request);
  if (url.includes('Purchase%20Receipt')) return Response.json({ data: {
    name: receipt, docstatus: 1,
    items: [{ item_code: 'G01A-3.5', qty: 2, serial_no: '283956\n283542' }],
  } });
  if (url.includes('/Serial%20No/')) {
    const vin = url.split('/').at(-1);
    return Response.json({ data: {
      serial_no: vin, name: vin, type: 'ستاريا', class: '3500 سي سي', model: '2027',
      agent: 'المجدوعي', warehouse: vin === '283956' ? 'معرض الملتقي - ممزال' : 'خارج الصالة - ممزال',
      car_status: vin === '283956' ? 'متاحة للحجز' : 'محجوزة', detail: vin === '283956' ? 'خدش' : '',
    } });
  }
  if (url.includes('purchase-receipt-stock')) {
    platformAttempts++;
    const payload = JSON.parse(options.body);
    assert.deepEqual(payload.vehicles.map((v) => v.serial_no), ['283956', '283542']);
    if (platformAttempts === 1) return Response.json({ ok: false, error: 'temporary' }, { status: 503 });
    return Response.json({ ok: true, total: 2, inserted: 2, skipped: 0 });
  }
  if (url.includes('mzjcars.com')) siteCalls++;
  throw new Error(`Unexpected URL ${url}`);
};
try {
  const manual = await worker.fetch(new Request('https://test.example/operations/manual', {
    method: 'POST', headers: { Authorization: 'Bearer test-token' }, body: JSON.stringify({ receipt }),
  }), env, { waitUntil() {} });
  assert.equal(manual.status, 202);
  assert.equal(rows.get(receipt).state, 'pending');
  assert.deepEqual(messages, [{ receipt }]);
  let outcome;
  const message = { body: { receipt }, retry(opts) { outcome = { type: 'retry', ...opts }; }, ack() { outcome = { type: 'ack' }; } };
  await worker.queue({ messages: [message] }, env);
  assert.equal(outcome.type, 'retry');
  assert.equal(outcome.delaySeconds, 5);
  assert.equal(rows.get(receipt).attempts, 1);
  rows.get(receipt).next_attempt_at = 0; // simulate the 5-second delay passing
  await worker.queue({ messages: [message] }, env);
  assert.deepEqual(outcome, { type: 'ack' });
  assert.equal(rows.get(receipt).state, 'delivered');
  assert.equal(platformAttempts, 2);
  assert.equal(siteCalls, 0);
  console.log('PASS: persisted D1 job; Queue retry after 5 seconds; successful delivery; site isolation');
} finally { globalThis.fetch = oldFetch; }
