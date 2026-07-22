import assert from "node:assert/strict";
import worker from "./src/index.js";

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), options });
  if (String(url).includes("/api/integrations/facebook")) return new Response(JSON.stringify({ ok: true, result: { conversationId: "conv-1", messageId: "msg-1" } }), { status: 200, headers: { "content-type": "application/json" } });
  if (String(url).includes("graph.facebook.com") && options.method === "POST") return new Response(JSON.stringify({ recipient_id: "psid-1", message_id: "mid.sent.1" }), { status: 200, headers: { "content-type": "application/json" } });
  if (String(url).includes("graph.facebook.com") && (!options.method || options.method === "GET")) return new Response(JSON.stringify({ first_name: "Test", last_name: "Customer" }), { status: 200, headers: { "content-type": "application/json" } });
  return new Response("not found", { status: 404 });
};

const env = {
  MZJ_GATEWAY_SECRET: "gateway-secret",
  PLATFORM_INBOUND_URL: "https://platform.test/api/integrations/facebook",
  FB_VERIFY_TOKEN: "verify",
  FB_PAGE_ACCESS_TOKEN: "page-token",
  FB_PAGE_ID: "page-1",
};

const health = await worker.fetch(new Request("https://worker.test/health"), env, {});
assert.equal(health.status, 200);
assert.equal((await health.json()).responsibility, "transport_only");

const verification = await worker.fetch(new Request("https://worker.test/meta/webhook?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=123"), env, {});
assert.equal(await verification.text(), "123");

const metaPayload = {
  object: "page",
  entry: [{
    id: "page-1",
    time: Date.now(),
    messaging: [{ sender: { id: "psid-1" }, recipient: { id: "page-1" }, timestamp: Date.now(), message: { mid: "mid.in.1", text: "Hello", quick_reply: { payload: "cash" } } }],
  }],
};
const inbound = await worker.fetch(new Request("https://worker.test/meta/webhook", { method: "POST", body: JSON.stringify(metaPayload), headers: { "content-type": "application/json" } }), env, {});
assert.equal(inbound.status, 200);
assert.equal((await inbound.json()).processed, 1);
const platformCall = calls.find((call) => call.url.includes("/api/integrations/facebook"));
assert.ok(platformCall);
const forwarded = JSON.parse(platformCall.options.body);
assert.equal(forwarded.facebookPsid, "psid-1");
assert.equal(forwarded.payload, "cash");
assert.equal(forwarded.workerCode, "facebook");
assert.equal(forwarded.conversationId, "facebook:page-1:psid-1");
assert.equal("serviceKey" in forwarded, false);
assert.equal("createLead" in forwarded, false);

const send = await worker.fetch(new Request("https://worker.test/send/facebook", {
  method: "POST",
  headers: { "content-type": "application/json", "x-mzj-gateway-secret": "gateway-secret" },
  body: JSON.stringify({ conversationId: "facebook:page-1:psid-1", text: "Choose", buttons: [{ title: "Option A", payload: "a" }] }),
}), env, {});
assert.equal(send.status, 200);
const sent = await send.json();
assert.equal(sent.status, "sent");
assert.equal(sent.provider_message_id, "mid.sent.1");
const graphCall = calls.findLast((call) => call.url.includes("graph.facebook.com") && call.options.method === "POST");
const graphBody = JSON.parse(graphCall.options.body);
assert.equal(graphBody.message.quick_replies[0].payload, "a");

const source = await (await import("node:fs/promises")).readFile(new URL("./src/index.js", import.meta.url), "utf8");
for (const forbidden of ["مبيعات الكاش", "مبيعات التمويل", "خدمة العملاء", "finance_registration_complete", "forceServiceReclassification"]) assert.equal(source.includes(forbidden), false, `worker must not contain flow string: ${forbidden}`);

console.log("facebook-worker tests: PASS");
globalThis.fetch = originalFetch;
