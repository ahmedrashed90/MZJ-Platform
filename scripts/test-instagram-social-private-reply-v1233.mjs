import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const workerPath = path.resolve(new URL('../workers/MZJ-Instagram-Worker-v2.0.16-FULL.js', import.meta.url).pathname);
const mod = await import(`${pathToFileURL(workerPath).href}?test=${Date.now()}`);
const worker = mod.default;

const originalFetch = globalThis.fetch;
const calls = [];

globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  return new Response(JSON.stringify({ recipient_id: 'igsid_987654', message_id: 'mid_private_reply_1' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

try {
  const request = new Request('https://instagram-worker.example/send/instagram', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-mzj-gateway-secret': 'test-secret',
    },
    body: JSON.stringify({
      type: 'text',
      text: 'اهلا بك',
      commentId: 'comment_12345',
      instagramAccountId: 'ig_account_9',
      conversationId: 'instagram:ig_account_9:social-comment-comment_12345',
    }),
  });

  const response = await worker.fetch(request, {
    MZJ_GATEWAY_SECRET: 'test-secret',
    IG_PAGE_ACCESS_TOKEN: 'page-token',
    IG_USER_ID: 'ig_account_9',
    IG_GRAPH_API_VERSION: 'v20.0',
  }, { waitUntil() {} });

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.send_method, 'graph_private_reply');
  assert.equal(body.privateReply, true);
  assert.equal(body.recipient_id, 'igsid_987654');
  assert.equal(body.provider_message_id, 'mid_private_reply_1');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v20\.0\/ig_account_9\/messages$/);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, 'Bearer page-token');

  const sent = JSON.parse(calls[0].init.body);
  assert.deepEqual(sent.recipient, { comment_id: 'comment_12345' });
  assert.deepEqual(sent.message, { text: 'اهلا بك' });

  console.log('PASS Instagram comment private reply uses comment_id');
  console.log('PASS Instagram private reply returns/stores real recipient IGSID');
  console.log('2/2 checks passed');
} finally {
  globalThis.fetch = originalFetch;
}
