import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker from './src/index.js';

const requests = [];
const savedFetch = globalThis.fetch;
const base = 'https://facebook.next-erp-mzj.workers.dev';
const env = {
  FB_PAGE_ID: '616836628446846',
  FB_PAGE_ACCESS_TOKEN: 'test-page-token',
  FB_VERIFY_TOKEN: 'legacy-verify',
  FB_APP_SECRET: 'legacy-publishing-app-secret',
  FB_MESSENGER_VERIFY_TOKEN: 'new-messenger-verify',
  FB_MESSENGER_APP_SECRET: 'new-messenger-app-secret',
  MZJ_GATEWAY_SECRET: 'gateway-test-secret',
  PLATFORM_INBOUND_URL: 'https://platform.test/api/integrations/facebook',
};

globalThis.fetch = async (url, options = {}) => {
  const destination = String(url);
  requests.push({ url: destination, options });
  if (destination === env.PLATFORM_INBOUND_URL) {
    return Response.json({ ok: true, result: { conversationId: 'crm-conversation-1', messageId: 'crm-message-1' } }, { status: 202 });
  }
  if (destination.includes('graph.facebook.com') && options.method === 'POST') {
    return Response.json({ recipient_id: 'customer-psid-1', message_id: 'mid.out-1' });
  }
  if (destination.includes('graph.facebook.com')) {
    return Response.json({ first_name: 'Test', last_name: 'Messenger' });
  }
  throw new Error(`Unexpected network call: ${destination}`);
};

function signedWebhook(data, secret = env.FB_MESSENGER_APP_SECRET) {
  const body = JSON.stringify(data);
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  return new Request(`${base}/meta/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${signature}` },
    body,
  });
}

function pageEvent(change, field = 'messaging', pageId = env.FB_PAGE_ID) {
  return { object: 'page', entry: [{ id: pageId, time: 1792940000000, [field]: [change] }] };
}

try {
  const health = await worker.fetch(new Request(`${base}/health`), env, {});
  const status = await health.json();
  assert.equal(status.env_check.messenger_receiver_ready, true);
  assert.match(status.version, /v2\.0\.8/);

  const validVerify = await worker.fetch(new Request(`${base}/meta/webhook?hub.mode=subscribe&hub.verify_token=new-messenger-verify&hub.challenge=ok-123`), env, {});
  assert.equal(validVerify.status, 200);
  assert.equal(await validVerify.text(), 'ok-123');
  const invalidVerify = await worker.fetch(new Request(`${base}/meta/webhook?hub.mode=subscribe&hub.verify_token=legacy-verify&hub.challenge=bad`), env, {});
  assert.equal(invalidVerify.status, 403);

  const textMessage = pageEvent({
    sender: { id: 'customer-psid-1' }, recipient: { id: env.FB_PAGE_ID },
    timestamp: 1792940000000, message: { mid: 'mid.in-1', text: 'اهلا' },
  });
  const inbound = await worker.fetch(signedWebhook(textMessage), env, {});
  assert.equal(inbound.status, 200);
  assert.equal((await inbound.json()).processed, 1);
  const incomingForward = requests.find((request) => request.url === env.PLATFORM_INBOUND_URL);
  assert.ok(incomingForward, 'Messenger message must be forwarded to CRM');
  const forwarded = JSON.parse(incomingForward.options.body);
  assert.equal(forwarded.platform, 'facebook');
  assert.equal(forwarded.direction, 'in');
  assert.equal(forwarded.pageId, env.FB_PAGE_ID);
  assert.equal(forwarded.facebookPsid, 'customer-psid-1');
  assert.equal(forwarded.participantId, 'customer-psid-1');
  assert.equal(forwarded.conversationId, `facebook:${env.FB_PAGE_ID}:customer-psid-1`);
  assert.equal(forwarded.text, 'اهلا');
  assert.equal(forwarded.providerMessageId, 'mid.in-1');
  assert.equal(forwarded.workerCode, 'facebook');

  const standbyReply = pageEvent({
    sender: { id: 'customer-psid-1' }, recipient: { id: env.FB_PAGE_ID },
    timestamp: 1792940010000, message: { mid: 'mid.in-2', text: 'رد من ManyChat' },
  }, 'standby');
  const standby = await worker.fetch(signedWebhook(standbyReply), env, {});
  assert.equal(standby.status, 200);
  assert.equal((await standby.json()).processed, 1);
  const standbyForward = requests.filter((r) => r.url === env.PLATFORM_INBOUND_URL).at(-1);
  assert.equal(JSON.parse(standbyForward.options.body).text, 'رد من ManyChat');

  const postback = pageEvent({
    sender: { id: 'customer-psid-1' }, recipient: { id: env.FB_PAGE_ID },
    timestamp: 1792940020000, postback: { mid: 'mid.in-3', title: 'كاش', payload: 'cash' },
  });
  const postbackResponse = await worker.fetch(signedWebhook(postback), env, {});
  assert.equal((await postbackResponse.json()).processed, 1);
  const postbackForward = requests.filter((r) => r.url === env.PLATFORM_INBOUND_URL).at(-1);
  assert.equal(JSON.parse(postbackForward.options.body).payload, 'cash');

  const beforeWrongPage = requests.filter((r) => r.url === env.PLATFORM_INBOUND_URL).length;
  const wrongPage = await worker.fetch(signedWebhook(pageEvent({
    sender: { id: 'customer-psid-X' }, recipient: { id: 'wrong-page' },
    message: { mid: 'mid.in-X', text: 'wrong Page' },
  }, 'messaging', 'wrong-page')), env, {});
  assert.equal((await wrongPage.json()).processed, 0);
  assert.equal(requests.filter((r) => r.url === env.PLATFORM_INBOUND_URL).length, beforeWrongPage);

  const wrongAppSignature = await worker.fetch(signedWebhook(textMessage, env.FB_APP_SECRET), env, {});
  assert.equal(wrongAppSignature.status, 401);
  const missingSignature = await worker.fetch(new Request(`${base}/meta/webhook`, {
    method: 'POST', body: JSON.stringify(textMessage), headers: { 'content-type': 'application/json' },
  }), env, {});
  assert.equal(missingSignature.status, 401);

  const outbound = await worker.fetch(new Request(`${base}/send/facebook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mzj-gateway-secret': env.MZJ_GATEWAY_SECRET },
    body: JSON.stringify({ conversationId: `facebook:WRONG-PAGE:customer-psid-1`, pageId: 'WRONG-PAGE', text: 'الرد' }),
  }), env, {});
  assert.equal(outbound.status, 200);
  assert.equal((await outbound.json()).status, 'sent');
  const outboundRequest = requests.filter((r) => r.options.method === 'POST' && r.url.includes('graph.facebook.com')).at(-1);
  assert.ok(outboundRequest.url.endsWith(`/${env.FB_PAGE_ID}/messages`), 'Outbounds must retain configured Page ID');

  assert.equal(requests.filter((r) => r.url.includes('engagement-webhook')).length, 0);
  console.log('PASS: isolated Meta Messenger verification, signed incoming messages, standby, postbacks, Page scope, CRM forwarding, outbound regression');
} finally {
  globalThis.fetch = savedFetch;
}
