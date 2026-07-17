import worker from "../mersal-crm-worker/src/index.js";

const originalFetch = globalThis.fetch;
const env = {
  MZJ_GATEWAY_SECRET: "secret",
  MERSAL_TOKEN: "send-token",
  MERSAL_API_TOKEN: "api-token",
  MERSAL_SEND_URL: "https://mersal.test/send",
  MERSAL_TEMPLATE_URL: "https://mersal.test/template",
  MERSAL_MEDIA_SEND_URL: "https://mersal.test/media",
  MERSAL_TEMPLATES_URL: "https://mersal.test/templates",
  MERSAL_CONVERSATIONS_URL: "https://mersal.test/conversations",
  MERSAL_MESSAGES_URL: "https://mersal.test/messages",
  MZJ_PLATFORM_INBOUND_URL: "https://platform.test/api/integrations/whatsapp",
  MZJ_PLATFORM_MEDIA_URL: "https://platform.test/api/integrations/media",
};

function assert(value, message) { if (!value) throw new Error(message); }
async function jsonBody(response) { return JSON.parse(await response.text()); }

try {
  globalThis.fetch = async (url) => {
    assert(String(url) === env.MERSAL_SEND_URL, "Unexpected Mersal send URL");
    return new Response(JSON.stringify({ status: "success", message_wamid: "wamid.123" }), { status: 500 });
  };
  let response = await worker.fetch(new Request("https://worker.test/send/mersal", {
    method: "POST",
    headers: { "content-type": "application/json", "x-mzj-gateway-secret": "secret" },
    body: JSON.stringify({ phone: "0541421013", text: "hello" }),
  }), env);
  let result = await jsonBody(response);
  assert(response.status === 200, "Confirmed provider delivery must return HTTP 200");
  assert(result.ok === true && result.providerStatus === "sent" && result.providerMessageId === "wamid.123", "Confirmed delivery must be marked sent");

  globalThis.fetch = async () => new Response(JSON.stringify({ status: "error", message: "invalid phone" }), { status: 200 });
  response = await worker.fetch(new Request("https://worker.test/send/mersal", {
    method: "POST",
    headers: { "content-type": "application/json", "x-mzj-gateway-secret": "secret" },
    body: JSON.stringify({ phone: "0541421013", text: "hello" }),
  }), env);
  result = await jsonBody(response);
  assert(response.status === 502 && result.ok === false && result.providerStatus === "failed", "Explicit provider rejection must stay failed");

  let forwarded = null;
  globalThis.fetch = async (url, init) => {
    assert(String(url) === env.MZJ_PLATFORM_INBOUND_URL, "Inbound reply must use the exact platform URL");
    forwarded = { headers: Object.fromEntries(new Headers(init.headers)), body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ ok: true, source: "whatsapp" }), { status: 202 });
  };
  const webhook = {
    entry: [{ changes: [{ value: {
      contacts: [{ wa_id: "966541421013", profile: { name: "Test Customer" } }],
      messages: [{ id: "wamid.in.1", from: "966541421013", timestamp: "1784310000", type: "text", text: { body: "reply from phone" } }],
    } }] }],
  };
  response = await worker.fetch(new Request("https://worker.test/webhook/mersal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(webhook),
  }), env);
  result = await jsonBody(response);
  assert(response.status === 200 && result.ok === true && result.processed === 1, "Inbound reply must be processed");
  assert(forwarded.body.eventId === "wamid.in.1", "Inbound event must use the provider message id");
  assert(forwarded.body.text === "reply from phone" && forwarded.body.direction === "in", "Inbound text must be forwarded to PostgreSQL API");
  assert(forwarded.headers["x-mzj-gateway-secret"] === "secret", "Inbound platform request must be authenticated");

  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: "database unavailable" }), { status: 500 });
  response = await worker.fetch(new Request("https://worker.test/webhook/mersal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(webhook),
  }), env);
  result = await jsonBody(response);
  assert(response.status === 502 && result.ok === false, "Platform rejection must not be acknowledged as processed");

  console.log("Mersal worker behavior tests passed.");
} finally {
  globalThis.fetch = originalFetch;
}
