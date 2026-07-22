import worker from "../facebook-worker/src/index.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const env = {
  MZJ_GATEWAY_SECRET: "gateway-secret",
  PLATFORM_INBOUND_URL: "https://platform.test/api/integrations/facebook",
  FB_VERIFY_TOKEN: "verify-token",
  FB_PAGE_ID: "page-1",
  FB_PAGE_ACCESS_TOKEN: "page-token",
  FB_GRAPH_API_VERSION: "v20.0",
};

const health = await worker.fetch(new Request("https://worker.test/health"), env, {});
const healthJson = await health.json();
assert(health.status === 200 && healthJson.role === "transport_only" && healthJson.platformOwnsAutomation === true, "Health contract failed");

const verify = await worker.fetch(new Request("https://worker.test/meta/webhook?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=12345"), env, {});
assert(verify.status === 200 && await verify.text() === "12345", "Meta verification failed");

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  if (String(url).includes("platform.test")) {
    return new Response(JSON.stringify({ ok: true, result: { conversationId: "conversation-1", messageId: "message-1" } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (String(url).includes("graph.facebook.com")) {
    return new Response(JSON.stringify({ recipient_id: "psid-1", message_id: "mid.sent.1" }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error(`Unexpected fetch ${url}`);
};

try {
  const inboundBody = {
    object: "page",
    entry: [{
      id: "page-1",
      time: 1784750000000,
      messaging: [{
        sender: { id: "psid-1" },
        recipient: { id: "page-1" },
        timestamp: 1784750000000,
        message: { mid: "mid.in.1", text: "السلام عليكم" },
      }],
    }],
  };
  const inbound = await worker.fetch(new Request("https://worker.test/meta/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(inboundBody),
  }), env, {});
  const inboundJson = await inbound.json();
  assert(inbound.status === 200 && inboundJson.processed === 1, "Inbound forwarding failed");
  const platformCall = calls.find((call) => call.url.includes("platform.test"));
  assert(platformCall, "Platform forwarding call missing");
  const platformPayload = JSON.parse(platformCall.init.body);
  for (const key of ["eventId", "providerMessageId", "platform", "workerCode", "conversationId", "pageId", "participantId", "facebookPsid", "direction", "senderType", "text", "messageType", "attachments", "timestamp"]) {
    assert(Object.prototype.hasOwnProperty.call(platformPayload, key), `Inbound payload missing ${key}`);
  }
  assert(platformPayload.facebookPsid === "psid-1" && platformPayload.conversationId === "facebook:page-1:psid-1", "Canonical Facebook identity failed");
  assert(platformPayload.createLead === false && platformPayload.trustedServiceClassification === false, "Worker must not own classification");

  calls.length = 0;
  const outbound = await worker.fetch(new Request("https://worker.test/send/facebook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-mzj-gateway-secret": "gateway-secret" },
    body: JSON.stringify({
      conversationId: "facebook:page-1:psid-1",
      text: "برجاء اختيار الخدمة",
      idempotencyKey: "automation-session-1-start-menu",
      buttons: [
        { id: "service_cash", title: "💰 مبيعات الكاش" },
        { id: "service_finance", title: "🏦 مبيعات التمويل" },
        { id: "service_cs", title: "🛠 خدمة العملاء" },
      ],
    }),
  }), env, {});
  const outboundJson = await outbound.json();
  assert(outbound.status === 200 && outboundJson.status === "sent" && outboundJson.providerMessageId === "mid.sent.1", "Provider-confirmed send failed");
  const graphCall = calls.find((call) => call.url.includes("graph.facebook.com"));
  const graphPayload = JSON.parse(graphCall.init.body);
  assert(graphPayload.message.quick_replies.length === 3, "Quick replies were not sent");
  assert(graphPayload.message.quick_replies[1].payload === "service_finance", "Quick reply payload changed");
  const graphCallsAfterFirstSend = calls.filter((call) => call.url.includes("graph.facebook.com")).length;
  const duplicateOutbound = await worker.fetch(new Request("https://worker.test/send/facebook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-mzj-gateway-secret": "gateway-secret" },
    body: JSON.stringify({
      conversationId: "facebook:page-1:psid-1",
      text: "برجاء اختيار الخدمة",
      idempotencyKey: "automation-session-1-start-menu",
    }),
  }), env, {});
  const duplicateOutboundJson = await duplicateOutbound.json();
  assert(duplicateOutbound.status === 200 && duplicateOutboundJson.idempotentReplay === true, "Worker outbound idempotency replay failed");
  assert(calls.filter((call) => call.url.includes("graph.facebook.com")).length === graphCallsAfterFirstSend, "Duplicate send reached Facebook Graph twice");

  const deferred = await worker.fetch(new Request("https://worker.test/automation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerMessageId: "manychat-1", lastTextInput: "أحمد" }),
  }), env, {});
  const deferredJson = await deferred.json();
  assert(deferred.status === 200 && deferredJson.skipped === true && deferredJson.deferredToMetaWebhook === true && deferredJson.reason === "meta_webhook_is_authoritative", "ManyChat compatibility input must never start a parallel flow");

  const verifiedDeferred = await worker.fetch(new Request("https://worker.test/automation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerMessageId: "manychat-2", facebookPsid: "psid-1", pageId: "page-1", lastTextInput: "أحمد" }),
  }), env, {});
  const verifiedDeferredJson = await verifiedDeferred.json();
  assert(verifiedDeferredJson.skipped === true && verifiedDeferredJson.reason === "meta_webhook_is_authoritative", "Verified ManyChat input must also defer to Meta to prevent duplicate steps");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Facebook transport Worker v1.18.0 offline request/response tests passed.");
