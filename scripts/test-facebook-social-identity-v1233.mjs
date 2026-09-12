import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const workerPath = path.resolve(new URL('../facebook-worker/src/index.js', import.meta.url).pathname);
const mod = await import(`${pathToFileURL(workerPath).href}?test=${Date.now()}`);
const worker = mod.default;

const originalFetch = globalThis.fetch;
const calls = [];

globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  return new Response(JSON.stringify({ ok: true, result: { conversationId: 'crm-conv-1' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

try {
  const request = new Request('https://facebook-worker.example/automation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      eventId: 'manychat-comment-event-1',
      pageId: 'page_123',
      facebookPsid: 'psid_456',
      manychatContactId: 'manychat_789',
      commentId: 'comment_321',
      socialActorId: 'social_actor_111',
      text: 'اهلا',
      customerName: 'عميل فيسبوك',
    }),
  });

  const response = await worker.fetch(request, {
    MZJ_GATEWAY_SECRET: 'gateway-secret',
    PLATFORM_INBOUND_URL: 'https://platform.example/api/integrations/facebook',
    FB_PAGE_ID: 'page_123',
  }, { waitUntil() {} });

  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.participantId, 'psid_456');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://platform.example/api/integrations/facebook');

  const forwarded = JSON.parse(calls[0].init.body);
  assert.equal(forwarded.facebookPsid, 'psid_456');
  assert.equal(forwarded.participantId, 'psid_456');
  assert.equal(forwarded.manychatContactId, 'manychat_789');
  assert.equal(forwarded.commentId, 'comment_321');
  assert.equal(forwarded.socialActorId, 'social_actor_111');
  assert.equal(forwarded.conversationId, 'facebook:page_123:psid_456');
  assert.equal(calls[0].init.headers['x-mzj-gateway-secret'], 'gateway-secret');

  console.log('PASS Facebook comment identity forwards real PSID to the platform');
  console.log('PASS Facebook comment correlation keeps commentId/socialActorId');
  console.log('2/2 checks passed');
} finally {
  globalThis.fetch = originalFetch;
}
