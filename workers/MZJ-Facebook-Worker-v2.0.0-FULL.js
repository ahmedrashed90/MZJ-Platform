const VERSION = "mzj-facebook-worker-v2.0.0-platform-automation";
const DEFAULT_PLATFORM_INBOUND_URL = "https://mzj-platform.vercel.app/api/integrations/facebook";
const DEFAULT_GRAPH_VERSION = "v20.0";
const DEFAULT_MAX_MEDIA_BYTES = 50 * 1024 * 1024;

const META_PATHS = new Set(["/meta/webhook", "/webhook", "/webhook/facebook", "/webhook/meta", "/facebook/webhook"]);
const AUTOMATION_PATHS = new Set(["/automation", "/manychat/automation", "/webhook/manychat"]);
const SEND_PATHS = new Set(["/send/facebook", "/crm/send", "/send/meta", "/send"]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response("", { status: 204, headers: corsHeaders() });
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) return health(env);
    if (request.method === "GET" && META_PATHS.has(url.pathname)) return verifyWebhook(url, env);
    if (request.method === "POST" && META_PATHS.has(url.pathname)) return receiveMeta(request, env, ctx);
    if (request.method === "POST" && AUTOMATION_PATHS.has(url.pathname)) return receiveCompatibilityAutomation(request, env, ctx);
    if (request.method === "POST" && SEND_PATHS.has(url.pathname)) {
      if (!gatewayAuthorized(request, env)) return json({ ok: false, status: "failed", error: "Unauthorized gateway request", version: VERSION }, 401);
      return sendOutbound(request, env, ctx);
    }
    return json({ ok: false, error: "Not found", version: VERSION }, 404);
  },
};

function health(env) {
  return json({
    ok: true,
    service: "facebook-crm-worker",
    workerCode: "facebook",
    version: VERSION,
    responsibility: "transport_only",
    storage: "platform_postgresql",
    env_check: {
      has_gateway_secret: Boolean(clean(env?.MZJ_GATEWAY_SECRET)),
      has_platform_inbound_url: Boolean(clean(env?.PLATFORM_INBOUND_URL) || DEFAULT_PLATFORM_INBOUND_URL),
      has_fb_verify_token: Boolean(clean(env?.FB_VERIFY_TOKEN)),
      has_fb_app_secret: Boolean(clean(env?.FB_APP_SECRET)),
      has_fb_page_access_token: Boolean(clean(env?.FB_PAGE_ACCESS_TOKEN)),
      has_manychat_api_token: Boolean(manychatToken(env)),
    },
    routes: { health: "GET /", metaWebhook: "GET/POST /meta/webhook", compatibilityAutomation: "POST /automation", send: "POST /send/facebook" },
  });
}

function verifyWebhook(url, env) {
  const mode = clean(url.searchParams.get("hub.mode"));
  const token = clean(url.searchParams.get("hub.verify_token"));
  const challenge = clean(url.searchParams.get("hub.challenge"));
  if (mode === "subscribe" && clean(env?.FB_VERIFY_TOKEN) && timingSafeEqual(token, clean(env.FB_VERIFY_TOKEN))) return text(challenge, 200);
  return text("Forbidden", 403);
}

async function receiveMeta(request, env, ctx) {
  const rawBody = await request.text();
  if (clean(env?.FB_APP_SECRET)) {
    const valid = await verifySignature(clean(request.headers.get("x-hub-signature-256")), rawBody, env.FB_APP_SECRET);
    if (!valid) return json({ ok: false, error: "Bad signature", version: VERSION }, 401);
  }
  const body = parseJson(rawBody);
  if (!body || body.object !== "page" || !Array.isArray(body.entry)) return json({ ok: true, accepted: true, ignored: true, reason: "unsupported_object", version: VERSION });
  try {
    const events = await normalizeMetaEvents(body, env);
    const forwarded = [];
    for (const event of events) {
      const payload = await buildInboundPayload(event, env);
      const result = await forwardToPlatform(payload, env);
      if (!result.ok) throw new Error(`Platform rejected ${event.eventId}: HTTP ${result.status} ${result.error}`);
      forwarded.push({ eventId: event.eventId, conversationId: payload.conversationId, direction: payload.direction, platformStatus: result.status });
    }
    const result = { ok: true, accepted: true, processed: events.length, forwarded, version: VERSION };
    if (ctx?.waitUntil) ctx.waitUntil(debugPut(env, "FACEBOOK_LAST_META_RESULT", result));
    return json(result);
  } catch (error) {
    const message = errorMessage(error);
    if (ctx?.waitUntil) ctx.waitUntil(debugPut(env, "FACEBOOK_LAST_META_ERROR", { message }));
    return json({ ok: false, status: "failed", error: message, version: VERSION }, 502);
  }
}

async function normalizeMetaEvents(body, env) {
  const output = [];
  for (const entry of body.entry) {
    const pageId = clean(entry?.id || env?.FB_PAGE_ID);
    const events = [...(Array.isArray(entry?.messaging) ? entry.messaging : []), ...(Array.isArray(entry?.standby) ? entry.standby : [])];
    for (const raw of events) {
      if (!raw || raw.delivery || raw.read) continue;
      const senderId = clean(raw?.sender?.id);
      const recipientId = clean(raw?.recipient?.id);
      const isEcho = raw?.message?.is_echo === true || senderId === pageId || senderId === clean(env?.FB_PAGE_ID);
      const facebookPsid = isEcho ? recipientId : senderId;
      if (!pageId || !facebookPsid) continue;
      const content = extractContent(raw);
      if (!content.hasContent) continue;
      const timestamp = timestampMs(raw?.timestamp || entry?.time || Date.now());
      const eventId = clean(content.providerMessageId) || stableId({ pageId, facebookPsid, timestamp, direction: isEcho ? "out" : "in", content });
      const displayName = isEcho ? "Facebook Page" : await fetchProfileName(facebookPsid, env).catch(() => "");
      output.push({ eventId, pageId, facebookPsid, isEcho, timestamp, content, displayName: displayName || `Facebook User (${facebookPsid.slice(-4)})` });
    }
  }
  return [...new Map(output.map((item) => [item.eventId, item])).values()];
}

function extractContent(event) {
  const message = event?.message || {};
  const postback = event?.postback || {};
  const quickReply = message?.quick_reply || {};
  const referral = event?.referral || postback?.referral || message?.referral || {};
  const payload = first(quickReply?.payload, postback?.payload, referral?.ref);
  const textValue = first(message?.text, postback?.title, quickReply?.payload, postback?.payload, referral?.ref);
  const attachments = (Array.isArray(message?.attachments) ? message.attachments : []).map(normalizeAttachment).filter(Boolean);
  const messageType = attachments[0]?.type || (postback?.payload ? "postback" : quickReply?.payload ? "quick_reply" : "text");
  return {
    providerMessageId: first(message?.mid, postback?.mid),
    text: clean(textValue),
    payload: clean(payload),
    messageType,
    attachments,
    hasContent: Boolean(clean(textValue) || clean(payload) || attachments.length),
  };
}

function normalizeAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") return null;
  const rawType = clean(attachment.type).toLowerCase();
  const payload = attachment.payload && typeof attachment.payload === "object" ? attachment.payload : {};
  const url = first(payload.url, payload.href, payload.link);
  const type = normalizeMediaType(rawType);
  if (!url && !payload.sticker_id && !payload.title) return null;
  return { type, url, fileName: first(payload.filename, payload.file_name, fileNameFromUrl(url)), mimeType: first(payload.mime_type, guessMimeType(url, type)), stickerId: clean(payload.sticker_id), title: clean(payload.title) };
}

async function buildInboundPayload(event, env) {
  const conversationId = `facebook:${event.pageId}:${event.facebookPsid}`;
  const attachments = [];
  for (let index = 0; index < event.content.attachments.length; index += 1) {
    attachments.push(await prepareInboundAttachment(event.content.attachments[index], `${event.eventId}_att_${index + 1}`, conversationId, event, env));
  }
  const primary = attachments[0] || null;
  const body = clean(event.content.text) || clean(event.content.payload) || (primary ? attachmentLabel(primary.attachmentType) : "");
  return {
    eventId: event.eventId,
    event_id: event.eventId,
    providerMessageId: event.content.providerMessageId || event.eventId,
    provider_message_id: event.content.providerMessageId || event.eventId,
    platform: "facebook",
    channel: "facebook",
    workerCode: "facebook",
    worker_code: "facebook",
    provider: "facebook_graph",
    providerName: "facebook_graph",
    source: "فيسبوك",
    conversationId,
    conversation_id: conversationId,
    pageId: event.pageId,
    page_id: event.pageId,
    participantId: event.facebookPsid,
    participant_id: event.facebookPsid,
    facebookPsid: event.facebookPsid,
    facebook_psid: event.facebookPsid,
    direction: event.isEcho ? "out" : "in",
    senderType: event.isEcho ? "agent" : "customer",
    sender_type: event.isEcho ? "agent" : "customer",
    customerName: event.displayName,
    customer_name: event.displayName,
    text: body,
    message: body,
    payload: event.content.payload,
    messageType: primary?.attachmentType || event.content.messageType,
    message_type: primary?.attachmentType || event.content.messageType,
    attachments,
    hasAttachment: attachments.length > 0,
    has_attachment: attachments.length > 0,
    attachmentType: primary?.attachmentType || "",
    attachment_type: primary?.attachmentType || "",
    mediaUrl: primary?.mediaUrl || "",
    media_url: primary?.mediaUrl || "",
    fileUrl: primary?.fileUrl || "",
    file_url: primary?.fileUrl || "",
    fileName: primary?.fileName || "",
    file_name: primary?.fileName || "",
    mimeType: primary?.mimeType || "",
    mime_type: primary?.mimeType || "",
    fileSize: primary?.fileSize || null,
    file_size: primary?.fileSize || null,
    storageKey: primary?.storageKey || "",
    storage_key: primary?.storageKey || "",
    timestamp: event.timestamp,
    isEcho: event.isEcho,
    is_echo: event.isEcho,
  };
}

async function prepareInboundAttachment(attachment, eventId, conversationId, event, env) {
  const attachmentType = normalizeMediaType(attachment?.type);
  const sourceUrl = clean(attachment?.url);
  if (!/^https?:\/\//i.test(sourceUrl)) return { attachmentType, mediaType: attachmentType, mediaUrl: sourceUrl, fileUrl: sourceUrl, fileName: clean(attachment?.fileName), mimeType: clean(attachment?.mimeType), fileSize: null, storageKey: "", mediaStatus: "metadata_only", isSensitive: true };
  const stored = await storeInboundMedia({ sourceUrl, eventId, conversationId, pageId: event.pageId, participantId: event.facebookPsid, mediaType: attachmentType, fileName: attachment.fileName, mimeType: attachment.mimeType }, env);
  return { attachmentType, mediaType: attachmentType, mediaUrl: sourceUrl, fileUrl: sourceUrl, attachmentUrl: sourceUrl, fileName: stored.fileName, mimeType: stored.mimeType, fileSize: stored.fileSize, storageKey: stored.storageKey, mediaAssetId: stored.assetId, mediaStatus: "ready", isSensitive: true };
}

async function receiveCompatibilityAutomation(request, env, ctx) {
  if (!compatibilityAuthorized(request, env)) return json({ ok: false, error: "Unauthorized compatibility request", version: VERSION }, 401);
  const body = await safeJson(request);
  const pageId = first(body?.pageId, body?.page_id, env?.FB_PAGE_ID);
  const facebookPsid = first(body?.facebookPsid, body?.facebook_psid, body?.fbPsid, body?.fb_psid, body?.psid, body?.pageScopedId, body?.page_scoped_id, body?.participantId, body?.participant_id);
  if (!pageId || !facebookPsid) return json({ ok: true, accepted: true, skipped: true, deferredToMetaWebhook: true, reason: "verified_facebook_psid_required", version: VERSION });
  const messageText = first(body?.lastTextInput, body?.last_text_input, body?.customerMessage, body?.customer_message, body?.text, body?.message);
  const eventId = first(body?.eventId, body?.event_id, body?.messageId, body?.message_id) || stableId({ source: "compatibility", pageId, facebookPsid, messageText, timestamp: body?.timestamp || Date.now() });
  const payload = {
    eventId, providerMessageId: eventId, platform: "facebook", channel: "facebook", workerCode: "facebook",
    provider: "manychat", conversationId: `facebook:${pageId}:${facebookPsid}`, pageId, participantId: facebookPsid,
    facebookPsid, direction: "in", senderType: "customer", text: messageText, message: messageText,
    payload: first(body?.payload, body?.buttonPayload, body?.button_payload), messageType: "text", attachments: [], timestamp: timestampMs(body?.timestamp || Date.now()),
  };
  try {
    const result = await forwardToPlatform(payload, env);
    if (!result.ok) throw new Error(result.error || `HTTP ${result.status}`);
    const response = { ok: true, accepted: true, eventId, conversationId: payload.conversationId, platformStatus: result.status, version: VERSION };
    if (ctx?.waitUntil) ctx.waitUntil(debugPut(env, "FACEBOOK_LAST_COMPATIBILITY_RESULT", response));
    return json(response);
  } catch (error) {
    return json({ ok: false, status: "failed", error: errorMessage(error), version: VERSION }, 502);
  }
}

async function sendOutbound(request, env, ctx) {
  const body = await safeJson(request);
  const target = resolveTarget(body, env);
  if (!target.participantId) return json({ ok: false, status: "failed", error: "participantId/psid is required", version: VERSION }, 400);
  const type = outboundType(body);
  if (!type) return json({ ok: false, status: "failed", error: "missing text, buttons or media", version: VERSION }, 400);

  let result;
  if (type === "media") result = await sendGraphMedia(target.participantId, body, env);
  else result = await sendTextOrButtons(target, body, env);
  const response = { ...result, provider: "facebook", platform: "facebook", workerCode: "facebook", participantId: target.participantId, pageId: target.pageId, conversationId: target.conversationId, message_type: type, version: VERSION };
  if (ctx?.waitUntil) ctx.waitUntil(debugPut(env, "FACEBOOK_LAST_SEND", response));
  return json(response, result.ok ? 200 : 502);
}

async function sendTextOrButtons(target, body, env) {
  const textValue = first(body?.text, body?.message);
  const buttons = normalizeButtons(body?.buttons);
  const graphMessage = buttons.length ? graphButtonMessage(textValue, buttons) : { text: textValue };
  const graph = await sendGraph(target.participantId, graphMessage, env, body);
  const attempts = [{ provider: "graph", ok: graph.ok, httpStatus: graph.http_status, error: graph.error }];
  if (graph.ok) return { ...graph, send_method: "graph", attempts };
  if (!buttons.length && manychatToken(env)) {
    const subscriberId = first(body?.manychatContactId, body?.manychat_contact_id, body?.subscriberId, body?.subscriber_id, target.participantId);
    const manychat = await sendManyChatText(subscriberId, textValue, env);
    attempts.push({ provider: "manychat", ok: manychat.ok, httpStatus: manychat.http_status, error: manychat.error });
    if (manychat.ok) return { ...manychat, send_method: "manychat", attempts };
  }
  return { ...graph, ok: false, status: "failed", provider_status: "failed", attempts, error: graph.error || "Facebook send failed" };
}

function normalizeButtons(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => ({ title: first(item?.title, item?.label, item?.text).slice(0, 20), payload: first(item?.payload, item?.id, item?.value, `choice_${index + 1}`) })).filter((item) => item.title && item.payload).slice(0, 13);
}
function graphButtonMessage(textValue, buttons) {
  return {
    text: textValue || "اختر من القائمة",
    quick_replies: buttons.map((button) => ({ content_type: "text", title: button.title, payload: button.payload })),
  };
}

async function sendGraphMedia(participantId, body, env) {
  const mediaUrl = first(body?.media_url, body?.mediaUrl, body?.file_url, body?.fileUrl, body?.attachment_url, body?.attachmentUrl);
  if (!mediaUrl) return failed("missing media_url");
  const type = outboundMediaType(first(body?.media_type, body?.mediaType, body?.attachment_type, body?.attachmentType, body?.type));
  const result = await sendGraph(participantId, { attachment: { type, payload: { url: mediaUrl, is_reusable: body?.is_reusable !== false && body?.isReusable !== false } } }, env, body);
  return { ...result, media_type: type, media_url: mediaUrl, send_method: "graph", attempts: [{ provider: "graph", ok: result.ok, httpStatus: result.http_status, error: result.error }] };
}

async function sendGraph(participantId, message, env, body = {}) {
  const token = clean(env?.FB_PAGE_ACCESS_TOKEN);
  if (!token) return failed("FB_PAGE_ACCESS_TOKEN missing");
  const payload = { recipient: { id: participantId }, message };
  const tag = first(body?.tag, body?.message_tag, body?.messageTag);
  if (tag) { payload.messaging_type = "MESSAGE_TAG"; payload.tag = tag; }
  else payload.messaging_type = first(body?.messaging_type, body?.messagingType, "RESPONSE");
  try {
    const response = await fetch(graphSendUrl(env), { method: "POST", headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
    const rawText = await response.text();
    const raw = parseJson(rawText) || {};
    return normalizeProvider(response.status, response.ok, raw, rawText);
  } catch (error) { return failed(errorMessage(error)); }
}

async function sendManyChatText(subscriberId, textValue, env) {
  const token = manychatToken(env);
  if (!token || !clean(subscriberId) || !clean(textValue)) return failed("ManyChat subscriber/text missing");
  try {
    const response = await fetch(clean(env?.MANYCHAT_SEND_URL) || "https://api.manychat.com/fb/sending/sendContent", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ subscriber_id: clean(subscriberId), data: { version: "v2", content: { messages: [{ type: "text", text: clean(textValue) }] } } }),
    });
    const rawText = await response.text();
    return normalizeProvider(response.status, response.ok, parseJson(rawText) || {}, rawText);
  } catch (error) { return failed(errorMessage(error)); }
}

function normalizeProvider(httpStatus, httpOk, raw, rawText) {
  const providerMessageId = first(raw?.message_id, raw?.messageId, raw?.mid, raw?.data?.message_id, raw?.data?.messageId);
  const graphError = raw?.error && typeof raw.error === "object" ? raw.error : null;
  const explicitFailure = Boolean(graphError) || raw?.ok === false || raw?.success === false || raw?.status === "failed";
  const accepted = httpOk && !explicitFailure && Boolean(providerMessageId || raw?.ok === true || raw?.success === true);
  return { ok: accepted, status: accepted ? "sent" : "failed", provider_status: accepted ? "sent" : "failed", provider_message_id: providerMessageId, providerMessageId, message_id: providerMessageId, http_status: httpStatus, httpStatus, error: accepted ? "" : first(graphError?.message, raw?.error, raw?.message, rawText, `HTTP ${httpStatus}`), raw };
}
function failed(message) { return { ok: false, status: "failed", provider_status: "failed", provider_message_id: "", providerMessageId: "", message_id: "", http_status: 0, httpStatus: 0, error: clean(message) || "Facebook request failed", raw: null }; }

function resolveTarget(body, env) {
  const requestedConversationId = first(body?.conversationId, body?.conversation_id, body?.convId);
  const parsed = parseConversationId(requestedConversationId);
  const pageId = first(body?.pageId, body?.page_id, parsed?.pageId, env?.FB_PAGE_ID);
  const participantId = first(body?.participantId, body?.participant_id, body?.psid, body?.fbPsid, body?.fb_psid, body?.recipientId, body?.recipient_id, parsed?.participantId);
  return { pageId, participantId, conversationId: requestedConversationId || (pageId && participantId ? `facebook:${pageId}:${participantId}` : "") };
}
function outboundType(body) {
  const mediaUrl = first(body?.media_url, body?.mediaUrl, body?.file_url, body?.fileUrl, body?.attachment_url, body?.attachmentUrl);
  if (mediaUrl) return "media";
  if (first(body?.text, body?.message) || normalizeButtons(body?.buttons).length) return "text";
  return "";
}

async function forwardToPlatform(payload, env) {
  const endpoint = clean(env?.PLATFORM_INBOUND_URL) || DEFAULT_PLATFORM_INBOUND_URL;
  const secret = clean(env?.MZJ_GATEWAY_SECRET);
  if (!secret) return { ok: false, status: 0, error: "MZJ_GATEWAY_SECRET missing" };
  try {
    const response = await fetch(endpoint, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", "x-mzj-gateway-secret": secret, "x-mzj-source": "facebook", "x-event-id": clean(payload.eventId) }, body: JSON.stringify(payload) });
    const rawText = await response.text();
    const data = parseJson(rawText) || {};
    return { ok: response.ok && data?.ok !== false, status: response.status, data, error: response.ok ? "" : first(data?.error, rawText, `HTTP ${response.status}`) };
  } catch (error) { return { ok: false, status: 0, error: errorMessage(error) }; }
}

async function storeInboundMedia(input, env) {
  const download = await fetchAttachment(input.sourceUrl, env);
  if (!download?.ok) throw new Error(`Failed to download Facebook attachment: HTTP ${download?.status || 502}`);
  const bytes = await download.arrayBuffer();
  if (!bytes.byteLength) throw new Error("Facebook attachment is empty");
  const maxBytes = positiveInteger(env?.MAX_MEDIA_BYTES, DEFAULT_MAX_MEDIA_BYTES);
  if (bytes.byteLength > maxBytes) throw new Error(`Facebook attachment exceeds ${maxBytes} bytes`);
  const mimeType = clean(download.headers.get("content-type")).split(";")[0] || clean(input.mimeType) || guessMimeType(input.sourceUrl, input.mediaType);
  const fileName = ensureFileName(first(input.fileName, fileNameFromUrl(download.url || input.sourceUrl)), input.mediaType, mimeType, input.eventId);
  const endpoint = platformMediaUrl(env);
  const secret = clean(env?.MZJ_GATEWAY_SECRET);
  const prepare = await fetch(endpoint, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", "x-mzj-gateway-secret": secret, "x-mzj-source": "facebook", "x-event-id": input.eventId }, body: JSON.stringify({ action: "prepare_upload", source: "facebook", eventKey: input.eventId, conversationId: input.conversationId, pageId: input.pageId, participantId: input.participantId, mediaType: input.mediaType, fileName, mimeType, fileSize: bytes.byteLength, isSensitive: true }) });
  const preparedText = await prepare.text();
  const prepared = parseJson(preparedText) || {};
  if (!prepare.ok || prepared?.ok === false || !clean(prepared?.uploadUrl) || !clean(prepared?.storageKey)) throw new Error(first(prepared?.error, preparedText, `Platform media prepare failed: HTTP ${prepare.status}`));
  const upload = await fetch(prepared.uploadUrl, { method: "PUT", headers: { "content-type": mimeType || "application/octet-stream" }, body: bytes });
  if (!upload.ok) throw new Error(`Platform media upload failed: HTTP ${upload.status}`);
  return { assetId: clean(prepared.assetId), storageKey: clean(prepared.storageKey), fileName, mimeType, fileSize: bytes.byteLength };
}

async function fetchAttachment(url, env) {
  const token = clean(env?.FB_PAGE_ACCESS_TOKEN);
  const attempts = [{ url, headers: { accept: "*/*" } }];
  if (token) attempts.push({ url, headers: { accept: "*/*", authorization: `Bearer ${token}` } });
  let last = null;
  for (const attempt of attempts) { try { last = await fetch(attempt.url, { headers: attempt.headers, redirect: "follow" }); if (last.ok) return last; } catch {} }
  return last;
}

async function fetchProfileName(psid, env) {
  const token = clean(env?.FB_PAGE_ACCESS_TOKEN);
  if (!token) return "";
  const url = new URL(`${graphBase(env)}/${encodeURIComponent(psid)}`);
  url.searchParams.set("fields", "first_name,last_name,name"); url.searchParams.set("access_token", token);
  const response = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!response.ok) return "";
  const raw = await response.json().catch(() => ({}));
  return first([clean(raw?.first_name), clean(raw?.last_name)].filter(Boolean).join(" "), raw?.name);
}

function gatewayAuthorized(request, env) { const expected = clean(env?.MZJ_GATEWAY_SECRET); return Boolean(expected && timingSafeEqual(clean(request.headers.get("x-mzj-gateway-secret")), expected)); }
function compatibilityAuthorized(request, env) {
  const expected = clean(env?.MANYCHAT_WEBHOOK_SECRET); if (!expected) return true;
  const url = new URL(request.url); const provided = first(request.headers.get("x-manychat-webhook-secret"), request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""), url.searchParams.get("secret"));
  return timingSafeEqual(provided, expected);
}
async function verifySignature(header, body, secret) {
  if (!header.startsWith("sha256=")) return false;
  const provided = header.slice(7).toLowerCase(); if (!/^[a-f0-9]{64}$/.test(provided)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(clean(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const computed = [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(computed, provided);
}
function timingSafeEqual(left, right) { const a = String(left || ""); const b = String(right || ""); if (!a || a.length !== b.length) return false; let mismatch = 0; for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i); return mismatch === 0; }
function graphBase(env) { return `https://graph.facebook.com/${clean(env?.FB_GRAPH_API_VERSION) || DEFAULT_GRAPH_VERSION}`; }
function graphSendUrl(env) { return clean(env?.FACEBOOK_SEND_URL) || `${graphBase(env)}/me/messages`; }
function platformMediaUrl(env) { if (clean(env?.PLATFORM_MEDIA_URL)) return clean(env.PLATFORM_MEDIA_URL); const url = new URL(clean(env?.PLATFORM_INBOUND_URL) || DEFAULT_PLATFORM_INBOUND_URL); url.pathname = "/api/integrations/media"; url.search = ""; return url.toString(); }
function manychatToken(env) { return clean(env?.MANYCHAT_API_TOKEN || env?.MANYCHAT_API_KEY); }
function parseConversationId(value) { const match = clean(value).match(/^facebook:([^:]+):(.+)$/); return match ? { pageId: match[1], participantId: match[2] } : null; }
function normalizeMediaType(value) { const type = clean(value).toLowerCase(); if (["photo", "picture"].includes(type)) return "image"; if (["voice", "ptt"].includes(type)) return "audio"; if (["file", "fallback"].includes(type)) return "document"; return type || "attachment"; }
function outboundMediaType(value) { const type = normalizeMediaType(value); return ["image", "audio", "video"].includes(type) ? type : "file"; }
function attachmentLabel(type) { const labels = { image: "صورة من العميل", audio: "رسالة صوتية من العميل", video: "فيديو من العميل", document: "ملف من العميل", sticker: "ملصق من العميل", link: "رابط من العميل" }; return labels[normalizeMediaType(type)] || "مرفق من العميل"; }
function fileNameFromUrl(value) { try { return decodeURIComponent(new URL(clean(value)).pathname.split("/").pop() || ""); } catch { return ""; } }
function guessMimeType(url, mediaType) { const lower = clean(url).toLowerCase().split("?")[0]; const map = [[/\.jpe?g$/, "image/jpeg"], [/\.png$/, "image/png"], [/\.webp$/, "image/webp"], [/\.gif$/, "image/gif"], [/\.mp3$/, "audio/mpeg"], [/\.(ogg|opus)$/, "audio/ogg"], [/\.wav$/, "audio/wav"], [/\.mp4$/, "video/mp4"], [/\.pdf$/, "application/pdf"], [/\.zip$/, "application/zip"]]; for (const [pattern, mime] of map) if (pattern.test(lower)) return mime; const type = normalizeMediaType(mediaType); return type === "image" ? "image/jpeg" : type === "audio" ? "audio/mpeg" : type === "video" ? "video/mp4" : "application/octet-stream"; }
function ensureFileName(value, mediaType, mimeType, eventId) { let name = clean(value).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_"); if (!name) name = `${normalizeMediaType(mediaType)}-${eventId || Date.now()}`; if (!/\.[a-z0-9]{1,10}$/i.test(name)) name += extensionForMime(mimeType, mediaType); return name.slice(0, 180); }
function extensionForMime(mimeType, mediaType) { const mime = clean(mimeType).toLowerCase(); if (mime.includes("jpeg")) return ".jpg"; if (mime.includes("png")) return ".png"; if (mime.includes("webp")) return ".webp"; if (mime.includes("pdf")) return ".pdf"; if (mime.includes("mp4")) return ".mp4"; if (mime.includes("mpeg")) return normalizeMediaType(mediaType) === "video" ? ".mpeg" : ".mp3"; if (mime.includes("ogg")) return ".ogg"; return ".bin"; }
function stableId(value) { const serialized = JSON.stringify(value || {}); let hash = 2166136261; for (let i = 0; i < serialized.length; i += 1) { hash ^= serialized.charCodeAt(i); hash = Math.imul(hash, 16777619); } return `facebook_${(hash >>> 0).toString(16)}`; }
function timestampMs(value) { if (typeof value === "number") return value < 1e12 ? value * 1000 : value; if (/^\d+$/.test(clean(value))) { const number = Number(value); return number < 1e12 ? number * 1000 : number; } const parsed = Date.parse(clean(value)); return Number.isFinite(parsed) ? parsed : Date.now(); }
function positiveInteger(value, fallback) { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : fallback; }
function first(...values) { for (const value of values) { const result = clean(value); if (result) return result; } return ""; }
function clean(value) { if (value == null) return ""; if (typeof value === "string") return value.trim(); if (["number", "boolean"].includes(typeof value)) return String(value).trim(); return ""; }
function parseJson(value) { try { return value ? JSON.parse(String(value)) : {}; } catch { return null; } }
async function safeJson(request) { try { return await request.json(); } catch { return {}; } }
function errorMessage(error) { return error instanceof Error ? error.message : String(error || "Unknown error"); }
async function debugPut(env, key, value) { try { if (env?.DEBUG_KV?.put) await env.DEBUG_KV.put(key, JSON.stringify({ at: new Date().toISOString(), value }), { expirationTtl: 86400 }); } catch {} }
function corsHeaders() { return { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type,authorization,x-mzj-gateway-secret,x-manychat-webhook-secret,x-hub-signature-256" }; }
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders(), "content-type": "application/json; charset=utf-8" } }); }
function text(value, status = 200) { return new Response(String(value || ""), { status, headers: { ...corsHeaders(), "content-type": "text/plain; charset=utf-8" } }); }
