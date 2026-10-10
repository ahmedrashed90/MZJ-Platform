import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const workerPath = path.resolve(new URL('../facebook-worker/src/index.js', import.meta.url).pathname);
const mod = await import(`${pathToFileURL(workerPath).href}?test=${Date.now()}`);
const worker = mod.default;
const originalFetch = globalThis.fetch;

try {
  const rejectedCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    rejectedCalls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      error: {
        message: 'Recipient is not available for messaging',
        type: 'OAuthException',
        code: 100,
        error_subcode: 2018001,
        fbtrace_id: 'TRACE123',
      },
    }), { status: 400, headers: { 'content-type': 'application/json' } });
  };

  const rejected = await worker.fetch(new Request('https://worker.example/send/facebook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mzj-gateway-secret': 'secret' },
    body: JSON.stringify({ pageId: 'page_123', participantId: 'psid_456', text: 'اهلا' }),
  }), {
    MZJ_GATEWAY_SECRET: 'secret',
    FB_PAGE_ID: 'page_123',
    FB_PAGE_ACCESS_TOKEN: 'page-token',
    FB_GRAPH_API_VERSION: 'v25.0',
  }, { waitUntil() {} });

  const rejectedBody = await rejected.json();
  assert.equal(rejected.status, 502);
  assert.equal(rejectedBody.ok, false);
  assert.equal(rejectedBody.error, 'Recipient is not available for messaging');
  assert.equal(rejectedCalls[0].url, 'https://graph.facebook.com/v25.0/page_123/messages');
  assert.equal(JSON.parse(rejectedCalls[0].init.body).recipient.id, 'psid_456');

  const successCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    successCalls.push({ url: String(url), init });
    return new Response(JSON.stringify({ recipient_id: 'psid_456', message_id: 'mid_789' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const success = await worker.fetch(new Request('https://worker.example/send/facebook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mzj-gateway-secret': 'secret' },
    body: JSON.stringify({ pageId: 'page_123', participantId: 'psid_456', text: 'تم' }),
  }), {
    MZJ_GATEWAY_SECRET: 'secret',
    FB_PAGE_ID: 'page_123',
    FB_PAGE_ACCESS_TOKEN: 'page-token',
    FB_GRAPH_API_VERSION: 'v25.0',
  }, { waitUntil() {} });

  const successBody = await success.json();
  assert.equal(success.status, 200);
  assert.equal(successBody.ok, true);
  assert.equal(successBody.provider_message_id, 'mid_789');
  assert.equal(successCalls[0].url, 'https://graph.facebook.com/v25.0/page_123/messages');

  const privateReplyCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    privateReplyCalls.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: 'mid_private_123' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const privateReply = await worker.fetch(new Request('https://worker.example/send/facebook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mzj-gateway-secret': 'secret' },
    body: JSON.stringify({ pageId: 'page_123', commentId: 'comment_321', privateReply: true, text: 'اهلا من التعليق' }),
  }), {
    MZJ_GATEWAY_SECRET: 'secret',
    FB_PAGE_ID: 'page_123',
    FB_PAGE_ACCESS_TOKEN: 'page-token',
    FB_GRAPH_API_VERSION: 'v25.0',
  }, { waitUntil() {} });

  const privateReplyBody = await privateReply.json();
  assert.equal(privateReply.status, 200);
  assert.equal(privateReplyBody.ok, true);
  assert.equal(privateReplyBody.private_reply, true);
  assert.equal(privateReplyBody.provider_message_id, 'mid_private_123');
  assert.equal(privateReplyCalls[0].url, 'https://graph.facebook.com/v25.0/comment_321/private_replies');
  assert.deepEqual(JSON.parse(privateReplyCalls[0].init.body), { message: 'اهلا من التعليق' });

  const manyChatCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    manyChatCalls.push({ url: String(url), init });
    if (String(url).includes('api.manychat.com/fb/subscriber/getInfo')) {
      return new Response(JSON.stringify({ data: { id: 'mc_123', facebook_psid: 'psid_from_manychat' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).includes('graph.facebook.com') && init.method === 'POST') {
      return new Response(JSON.stringify({ recipient_id: 'psid_from_manychat', message_id: 'mid_manychat_resolved' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  };

  const resolved = await worker.fetch(new Request('https://worker.example/send/facebook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mzj-gateway-secret': 'secret' },
    body: JSON.stringify({ pageId: 'page_123', manychatContactId: 'mc_123', text: 'رسالة بعد حل الهوية' }),
  }), {
    MZJ_GATEWAY_SECRET: 'secret',
    FB_PAGE_ID: 'page_123',
    FB_PAGE_ACCESS_TOKEN: 'page-token',
    FB_GRAPH_API_VERSION: 'v25.0',
    MANYCHAT_API_TOKEN: 'manychat-token',
  }, { waitUntil() {} });

  const resolvedBody = await resolved.json();
  assert.equal(resolved.status, 200);
  assert.equal(resolvedBody.participantId, 'psid_from_manychat');
  assert.equal(resolvedBody.identityResolution, 'manychat_getinfo_psid');
  const resolvedGraphCall = manyChatCalls.find((call) => call.url === 'https://graph.facebook.com/v25.0/page_123/messages');
  assert.ok(resolvedGraphCall);
  assert.equal(JSON.parse(resolvedGraphCall.init.body).recipient.id, 'psid_from_manychat');

  console.log('PASS Facebook provider rejection is returned with the real Meta error');
  console.log('PASS Facebook send uses explicit /PAGE_ID/messages');
  console.log('PASS Facebook provider-confirmed send returns the real message id');
  console.log('PASS Facebook comment can start with /COMMENT_ID/private_replies');
  console.log('PASS Facebook worker resolves PSID from ManyChat getInfo when available');
  console.log('5/5 checks passed');
} finally {
  globalThis.fetch = originalFetch;
}
