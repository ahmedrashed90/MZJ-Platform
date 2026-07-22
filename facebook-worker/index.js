/*
MZJ Facebook Transport Worker v1.18.1

The MZJ platform is the single source of truth for:
- automation configuration and trigger policy
- service choices and accepted replies
- finance questions and customer answers
- customer/request creation
- branch, sales and call-center assignment
- idempotency, sessions, messages and reporting

This Worker is transport-only. It validates Meta requests, receives all Messenger
messages and media, forwards normalized events to MZJ, and sends platform-requested
text/buttons/media through Facebook Graph API with an optional ManyChat text fallback.
*/

const VERSION = "mzj-facebook-transport-v1.18.1";
const DEFAULT_PLATFORM_INBOUND_URL = "https://mzj-platform.vercel.app/api/integrations/facebook";
const DEFAULT_GRAPH_API_VERSION = "v20.0";
const DEFAULT_MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const FAILURE_STATUSES = new Set(["error", "failed", "failure", "rejected", "invalid"]);
const SUCCESS_STATUSES = new Set(["ok", "success", "sent", "queued", "accepted", "submitted", "delivered", "processing"]);
const SEND_RESULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const memorySendResults = new Map();

const META_WEBHOOK_PATHS = new Set(["/meta/webhook", "/webhook", "/webhook/facebook", "/webhook/meta", "/facebook/webhook"]);
const AUTOMATION_PATHS = new Set(["/automation", "/manychat/automation", "/webhook/manychat"]);
const SEND_PATHS = new Set(["/send/facebook", "/crm/send", "/send/meta", "/send"]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response("", { status: 204, headers: corsHeaders() });

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return json({
        ok: true,
        service: "facebook-crm-transport",
        version: VERSION,
        role: "transport_only",
        platformOwnsAutomation: true,
        routes: {
          health: "GET /",
          debug: "GET /debug/last",
          metaWebhook: "GET/POST /meta/webhook",
          manychatTransport: "POST /automation",
          send: "POST /send/facebook",
        },
        env_check: {
          has_gateway_secret: Boolean(clean(env.MZJ_GATEWAY_SECRET)),
          has_platform_inbound_url: Boolean(platformInboundUrl(env)),
          has_platform_media_url: Boolean(platformMediaUrl(env)),
          has_fb_verify_token: Boolean(clean(env.FB_VERIFY_TOKEN)),
          has_fb_app_secret: Boolean(clean(env.FB_APP_SECRET)),
          has_fb_page_id: Boolean(clean(env.FB_PAGE_ID)),
          has_fb_page_access_token: Boolean(clean(env.FB_PAGE_ACCESS_TOKEN)),
          has_manychat_api_token: Boolean(manychatToken(env)),
          has_manychat_webhook_secret: Boolean(clean(env.MANYCHAT_WEBHOOK_SECRET)),
          has_debug_kv: Boolean(env.DEBUG_KV),
          has_send_idempotency_kv: Boolean(env.FACEBOOK_SEND_IDEMPOTENCY_KV || env.DEBUG_KV),
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/debug/last") {
      return json({
        ok: true,
        version: VERSION,
        metaPayload: await debugGet(env, "DEBUG_FACEBOOK_LAST_META_PAYLOAD"),
        metaForward: await debugGet(env, "DEBUG_FACEBOOK_LAST_META_FORWARD"),
        automationPayload: await debugGet(env, "DEBUG_FACEBOOK_LAST_AUTOMATION_PAYLOAD"),
        automationForward: await debugGet(env, "DEBUG_FACEBOOK_LAST_AUTOMATION_FORWARD"),
        send: await debugGet(env, "DEBUG_FACEBOOK_LAST_SEND"),
      });
    }

    if (request.method === "GET" && META_WEBHOOK_PATHS.has(url.pathname)) return verifyMetaWebhook(url, env);
    if (request.method === "POST" && META_WEBHOOK_PATHS.has(url.pathname)) return receiveMetaWebhook(request, env, ctx);
    if (request.method === "POST" && AUTOMATION_PATHS.has(url.pathname)) return receiveManyChatTransport(request, env, ctx);

    if (request.method === "POST" && SEND_PATHS.has(url.pathname)) {
      if (!gatewayAuthorized(request, env)) return json({ ok: false, status: "failed", error: "Unauthorized gateway request", version: VERSION }, 401);
      return sendFromPlatform(request, env, ctx);
    }

    return json({ ok: false, error: "Not found", version: VERSION }, 404);
  },
};

function verifyMetaWebhook(url, env) {
  const mode = clean(url.searchParams.get("hub.mode"));
  const token = clean(url.searchParams.get("hub.verify_token"));
  const challenge = clean(url.searchParams.get("hub.challenge"));
  if (mode === "subscribe" && clean(env.FB_VERIFY_TOKEN) && timingSafeEqualText(token, clean(env.FB_VERIFY_TOKEN))) {
    return text(challenge, 200);
  }
  return text("Forbidden", 403);
}

async function receiveMetaWebhook(request, env, ctx) {
  const rawBody = await request.text();
  if (clean(env.FB_APP_SECRET)) {
    const valid = await verifyXHubSignature256(clean(request.headers.get("x-hub-signature-256")), rawBody, clean(env.FB_APP_SECRET));
    if (!valid) return json({ ok: false, status: "failed", error: "Bad signature", version: VERSION }, 401);
  }

  const parsed = parseJsonStrict(rawBody);
  if (!parsed.ok) return json({ ok: false, status: "failed", error: "Invalid JSON", version: VERSION }, 400);
  if (ctx?.waitUntil) ctx.waitUntil(debugPut(env, "DEBUG_FACEBOOK_LAST_META_PAYLOAD", parsed.value));
  if (parsed.value?.object !== "page" || !Array.isArray(parsed.value?.entry)) {
    return json({ ok: true, accepted: true, ignored: true, reason: "unsupported_object", version: VERSION });
  }

  try {
    const events = normalizeMetaEvents(parsed.value, env);
    const forwarded = [];
    for (const event of events) {
      const payload = await buildMetaPlatformPayload(event, env);
      const result = await forwardToPlatform(payload, env, "facebook");
      if (!result.ok) throw new Error(`Platform rejected ${event.eventId}: HTTP ${result.status} ${result.error}`);
      forwarded.push({
        eventId: event.eventId,
        providerMessageId: event.providerMessageId,
        direction: event.isEcho ? "out" : "in",
        conversationId: payload.conversationId,
        platformStatus: result.status,
      });
    }
    const result = { processed: events.length, forwarded };
    if (ctx?.waitUntil) ctx.waitUntil(debugPut(env, "DEBUG_FACEBOOK_LAST_META_FORWARD", result));
    return json({ ok: true, accepted: true, ...result, version: VERSION });
  } catch (error) {
    const message = errorMessage(error);
    if (ctx?.waitUntil) ctx.waitUntil(debugPut(env, "DEBUG_FACEBOOK_LAST_META_FORWARD", { ok: false, error: message }));
    // A non-2xx response lets Meta retry an event that the PostgreSQL platform did not accept.
    return json({ ok: false, status: "failed", error: message, version: VERSION }, 502);
  }
}

function normalizeMetaEvents(body, env) {
  const events = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    const pageId = clean(entry?.id || env.FB_PAGE_ID);
    const entryTime = timestampMs(entry?.time || Date.now());
    const messaging = [
      ...(Array.isArray(entry?.messaging) ? entry.messaging : []),
      ...(Array.isArray(entry?.standby) ? entry.standby : []),
    ];
    for (const event of messaging) {
      if (!event || typeof event !== "object" || event.delivery || event.read) continue;
      const senderId = clean(event?.sender?.id);
      const recipientId = clean(event?.recipient?.id);
      if (!senderId || !pageId) continue;
      const isEcho = event?.message?.is_echo === true || senderId === pageId || senderId === clean(env.FB_PAGE_ID);
      const participantId = isEcho ? recipientId : senderId;
      if (!participantId) continue;
      const content = extractMetaContent(event);
      if (!content.hasContent) continue;
      const occurredAt = timestampMs(event?.timestamp || entryTime);
      const providerMessageId = clean(content.providerMessageId) || stableEventId({ pageId, participantId, occurredAt, content, isEcho });
      events.push({
        eventId: providerMessageId,
        providerMessageId,
        pageId,
        participantId,
        isEcho,
        occurredAt,
        content,
      });
    }
  }
  const unique = new Map();
  for (const event of events) if (!unique.has(event.eventId)) unique.set(event.eventId, event);
  return [...unique.values()];
}

function extractMetaContent(event) {
  const message = event?.message || {};
  const postback = event?.postback || {};
  const quickReply = message?.quick_reply || {};
  const referral = event?.referral || postback?.referral || message?.referral || {};
  const payload = first(quickReply?.payload, postback?.payload, referral?.ref, referral?.ad_id);
  const buttonTitle = first(postback?.title);
  const messageText = first(message?.text, postback?.title, postback?.payload, quickReply?.payload, referral?.ref);
  const attachments = [];
  for (const attachment of Array.isArray(message?.attachments) ? message.attachments : []) {
    const normalized = normalizeMetaAttachment(attachment);
    if (normalized) attachments.push(normalized);
  }
  let messageType = "text";
  if (attachments.length) messageType = attachments[0].type || "attachment";
  else if (postback?.payload) messageType = "postback";
  else if (quickReply?.payload) messageType = "quick_reply";
  else if (referral?.ref) messageType = "referral";
  return {
    providerMessageId: first(message?.mid, postback?.mid),
    text: clean(messageText),
    payload: clean(payload),
    buttonTitle: clean(buttonTitle),
    messageType,
    attachments,
    hasContent: Boolean(clean(messageText) || clean(payload) || attachments.length),
  };
}

function normalizeMetaAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") return null;
  const payload = attachment.payload && typeof attachment.payload === "object" ? attachment.payload : {};
  const url = first(payload.url, payload.href, payload.link);
  const stickerId = first(payload.sticker_id, payload.stickerId);
  const title = first(attachment.title, payload.title);
  if (!url && !stickerId && !title) return null;
  let type = normalizeMediaType(attachment.type || "attachment");
  if (type === "fallback") type = url ? "link" : "attachment";
  return {
    type,
    url,
    fileName: first(payload.filename, payload.file_name, attachment.name, fileNameFromUrl(url)),
    mimeType: first(payload.mime_type, payload.mimeType, guessMimeType(url, type)),
    title,
    stickerId,
  };
}

async function buildMetaPlatformPayload(event, env) {
  const conversationId = facebookConversationId(event.pageId, event.participantId);
  const storedAttachments = [];
  for (let index = 0; index < event.content.attachments.length; index += 1) {
    storedAttachments.push(await prepareInboundAttachment(env, {
      attachment: event.content.attachments[index],
      eventId: `${event.eventId}_attachment_${index + 1}`,
      conversationId,
      pageId: event.pageId,
      participantId: event.participantId,
    }));
  }
  const primary = storedAttachments[0] || null;
  const messageText = clean(event.content.text) || clean(event.content.buttonTitle) || clean(event.content.payload) || (primary ? attachmentLabel(primary.attachmentType) : "");
  const direction = event.isEcho ? "out" : "in";
  return {
    eventId: event.eventId,
    event_id: event.eventId,
    providerMessageId: event.providerMessageId,
    provider_message_id: event.providerMessageId,
    eventType: event.isEcho ? "message_echo" : "incoming_message",
    event_type: event.isEcho ? "message_echo" : "incoming_message",
    type: "incoming_message",
    platform: "facebook",
    channel: "facebook",
    provider: "meta",
    providerName: "facebook_graph",
    workerCode: clean(env.WORKER_CODE) || "facebook",
    worker_code: clean(env.WORKER_CODE) || "facebook",
    pageId: event.pageId,
    page_id: event.pageId,
    participantId: event.participantId,
    participant_id: event.participantId,
    facebookPsid: event.participantId,
    facebook_psid: event.participantId,
    conversationId,
    conversation_id: conversationId,
    direction,
    senderType: event.isEcho ? "agent" : "customer",
    sender_type: event.isEcho ? "agent" : "customer",
    text: messageText,
    message: messageText,
    payload: clean(event.content.payload),
    buttonTitle: clean(event.content.buttonTitle),
    button_title: clean(event.content.buttonTitle),
    messageType: primary?.attachmentType || event.content.messageType || "text",
    message_type: primary?.attachmentType || event.content.messageType || "text",
    attachments: storedAttachments,
    timestamp: event.occurredAt,
    // Explicitly transport-only. These values prevent legacy Worker-side capture/classification.
    createLead: false,
    create_lead: false,
    trustedServiceClassification: false,
    trusted_service_classification: false,
    forceServiceReclassification: false,
    force_service_reclassification: false,
    providerEntryFlowHandled: false,
    provider_entry_flow_handled: false,
  };
}

async function receiveManyChatTransport(request, env, ctx) {
  if (!manychatWebhookAuthorized(request, env)) return json({ ok: false, status: "failed", error: "Unauthorized ManyChat transport request", version: VERSION }, 401);
  const body = await safeJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, status: "failed", error: "Invalid JSON", version: VERSION }, 400);
  if (ctx?.waitUntil) ctx.waitUntil(debugPut(env, "DEBUG_FACEBOOK_LAST_AUTOMATION_PAYLOAD", body));

  // Compatibility endpoint only. Meta Webhook is the one authoritative inbound path.
  // Forwarding a second ManyChat copy can turn one customer response into two flow steps.
  const deferred = {
    ok: true,
    accepted: true,
    skipped: true,
    deferredToMetaWebhook: true,
    reason: "meta_webhook_is_authoritative",
    providerMessageId: clean(first(body.providerMessageId, body.provider_message_id, body.messageId, body.message_id, body.mid)),
    version: VERSION,
  };
  if (ctx?.waitUntil) ctx.waitUntil(debugPut(env, "DEBUG_FACEBOOK_LAST_AUTOMATION_FORWARD", deferred));
  return json(deferred);
}

async function sendFromPlatform(request, env, ctx) {
  const body = await safeJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, status: "failed", error: "Invalid JSON", version: VERSION }, 400);
  const target = resolveSendTarget(body, env);
  if (!target.participantId) return json({ ok: false, status: "failed", error: "Facebook participantId/PSID is required", version: VERSION }, 400);
  const outboundType = resolveOutboundType(body);
  if (!outboundType) return json({ ok: false, status: "failed", error: "Missing text or media", version: VERSION }, 400);
  const internalSendId = clean(first(body.internalSendId, body.internal_send_id, body.idempotencyKey, body.idempotency_key, body.jobId, body.job_id));
  if (internalSendId) {
    const previous = await readSendResult(env, internalSendId);
    if (previous?.ok === true) {
      const replay = { ...previous, duplicate: true, idempotentReplay: true, internalSendId, version: VERSION };
      if (ctx?.waitUntil) ctx.waitUntil(debugPut(env, "DEBUG_FACEBOOK_LAST_SEND", replay));
      return json(replay, 200);
    }
  }

  let result;
  if (outboundType === "text") {
    const textValue = clean(first(body.text, body.message));
    const buttons = normalizeButtons(body.buttons || body.quickReplies || body.quick_replies);
    result = await sendFacebookText(env, {
      participantId: target.participantId,
      manychatContactId: target.manychatContactId,
      text: textValue,
      buttons,
      messagingType: clean(first(body.messaging_type, body.messagingType, "RESPONSE")),
      tag: clean(first(body.tag, body.message_tag, body.messageTag)),
      preferProvider: clean(first(body.prefer_provider, body.preferProvider)).toLowerCase(),
    });
  } else {
    result = await sendFacebookMedia(env, {
      participantId: target.participantId,
      mediaUrl: clean(first(body.media_url, body.mediaUrl, body.file_url, body.fileUrl, body.attachment_url, body.attachmentUrl)),
      mediaType: normalizeOutboundMediaType(first(body.media_type, body.mediaType, body.attachment_type, body.attachmentType, body.type, "file")),
      messagingType: clean(first(body.messaging_type, body.messagingType, "RESPONSE")),
      tag: clean(first(body.tag, body.message_tag, body.messageTag)),
    });
  }

  const responseBody = {
    ...result,
    provider: "facebook",
    platform: "facebook",
    channel: "facebook",
    message_type: outboundType,
    participantId: target.participantId,
    pageId: target.pageId,
    conversationId: target.conversationId,
    internalSendId: internalSendId || "",
    version: VERSION,
  };
  if (result.ok && internalSendId) await storeSendResult(env, internalSendId, responseBody);
  if (ctx?.waitUntil) ctx.waitUntil(debugPut(env, "DEBUG_FACEBOOK_LAST_SEND", responseBody));
  return json(responseBody, result.ok ? 200 : 502);
}

function sendResultKey(value) {
  return `facebook-send:${stableEventId(clean(value))}`;
}

function sendResultKv(env) {
  return env.FACEBOOK_SEND_IDEMPOTENCY_KV || env.DEBUG_KV || null;
}

async function readSendResult(env, internalSendId) {
  const key = sendResultKey(internalSendId);
  const memory = memorySendResults.get(key);
  if (memory) return memory;
  const kv = sendResultKv(env);
  if (kv?.get) {
    try {
      const raw = await kv.get(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        memorySendResults.set(key, parsed);
        return parsed;
      }
    } catch {}
  }
  const cache = globalThis?.caches?.default;
  if (cache?.match) {
    try {
      const response = await cache.match(new Request(`https://mzj-facebook-send.invalid/${encodeURIComponent(key)}`));
      if (response) {
        const parsed = await response.json();
        memorySendResults.set(key, parsed);
        return parsed;
      }
    } catch {}
  }
  return null;
}

async function storeSendResult(env, internalSendId, result) {
  const key = sendResultKey(internalSendId);
  memorySendResults.set(key, result);
  const raw = JSON.stringify(result);
  const kv = sendResultKv(env);
  if (kv?.put) {
    try { await kv.put(key, raw, { expirationTtl: SEND_RESULT_TTL_SECONDS }); } catch {}
  }
  const cache = globalThis?.caches?.default;
  if (cache?.put) {
    try {
      await cache.put(
        new Request(`https://mzj-facebook-send.invalid/${encodeURIComponent(key)}`),
        new Response(raw, { headers: { "content-type": "application/json", "cache-control": `public, max-age=${SEND_RESULT_TTL_SECONDS}` } }),
      );
    } catch {}
  }
}

function resolveSendTarget(body, env) {
  const conversationId = clean(first(body.conversationId, body.conversation_id, body.convId));
  const parsed = parseFacebookConversationId(conversationId);
  const pageId = clean(first(body.pageId, body.page_id, parsed?.pageId, env.FB_PAGE_ID));
  const participantId = clean(first(body.participantId, body.participant_id, body.psid, body.facebookPsid, body.facebook_psid, body.fbPsid, body.fb_psid, body.recipientId, body.recipient_id, parsed?.participantId));
  const manychatContactId = clean(first(body.manychatContactId, body.manychat_contact_id, body.subscriberId, body.subscriber_id));
  return { pageId, participantId, manychatContactId, conversationId: conversationId || (pageId && participantId ? facebookConversationId(pageId, participantId) : "") };
}

function resolveOutboundType(body) {
  const requested = clean(body.type).toLowerCase();
  const textValue = clean(first(body.text, body.message));
  const mediaUrl = clean(first(body.media_url, body.mediaUrl, body.file_url, body.fileUrl, body.attachment_url, body.attachmentUrl));
  if (["media", "image", "audio", "video", "file", "document"].includes(requested)) return mediaUrl ? "media" : "";
  if (requested === "text") return textValue ? "text" : "";
  if (mediaUrl) return "media";
  return textValue ? "text" : "";
}

function normalizeButtons(value) {
  return (Array.isArray(value) ? value : []).map((button) => ({
    id: clean(first(button?.id, button?.payload, button?.value)),
    title: clean(first(button?.title, button?.label, button?.text)),
  })).filter((button) => button.id && button.title).slice(0, 13);
}

async function sendFacebookText(env, input) {
  const attempts = [];
  const preferManyChat = input.preferProvider === "manychat" && manychatToken(env) && input.manychatContactId && !input.buttons.length;
  if (preferManyChat) {
    const manychat = await sendManyChatText(env, input.manychatContactId, input.text);
    attempts.push(attemptSummary("manychat", manychat));
    if (manychat.ok) return { ...manychat, send_method: "manychat", attempts };
  }

  const message = { text: input.text };
  if (input.buttons.length) {
    message.quick_replies = input.buttons.map((button) => ({ content_type: "text", title: button.title.slice(0, 20), payload: button.id.slice(0, 1000) }));
  }
  const graph = await sendGraphMessage(env, { participantId: input.participantId, message, messagingType: input.messagingType, tag: input.tag });
  attempts.push(attemptSummary("graph", graph));
  if (graph.ok) return { ...graph, send_method: "graph", attempts };

  if (!preferManyChat && manychatToken(env) && input.manychatContactId && !input.buttons.length) {
    const manychat = await sendManyChatText(env, input.manychatContactId, input.text);
    attempts.push(attemptSummary("manychat", manychat));
    if (manychat.ok) return { ...manychat, send_method: "manychat", attempts };
  }
  return { ...graph, ok: false, status: "failed", provider_status: "failed", send_method: "", attempts };
}

async function sendFacebookMedia(env, input) {
  if (!clean(input.mediaUrl)) return failedProviderResult("Missing media URL");
  const attachment = { type: input.mediaType, payload: { url: clean(input.mediaUrl), is_reusable: true } };
  const graph = await sendGraphMessage(env, { participantId: input.participantId, message: { attachment }, messagingType: input.messagingType, tag: input.tag });
  return { ...graph, send_method: "graph", media_type: input.mediaType, media_url: input.mediaUrl, attempts: [attemptSummary("graph", graph)] };
}

async function sendGraphMessage(env, input) {
  const token = clean(env.FB_PAGE_ACCESS_TOKEN);
  if (!token) return failedProviderResult("FB_PAGE_ACCESS_TOKEN missing");
  if (!clean(input.participantId)) return failedProviderResult("participantId/PSID missing");
  const payload = { recipient: { id: clean(input.participantId) }, message: input.message || {} };
  const tag = clean(input.tag);
  if (tag) { payload.messaging_type = "MESSAGE_TAG"; payload.tag = tag; }
  else payload.messaging_type = clean(input.messagingType) || "RESPONSE";
  try {
    const response = await fetch(facebookSendUrl(env), {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    return normalizeProviderResponse(response, await response.text());
  } catch (error) {
    return failedProviderResult(errorMessage(error));
  }
}

async function sendManyChatText(env, subscriberId, textValue) {
  const token = manychatToken(env);
  if (!token) return failedProviderResult("MANYCHAT_API_TOKEN missing");
  try {
    const response = await fetch(clean(env.MANYCHAT_SEND_URL) || "https://api.manychat.com/fb/sending/sendContent", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ subscriber_id: clean(subscriberId), data: { version: "v2", content: { messages: [{ type: "text", text: clean(textValue) }] } } }),
    });
    return normalizeProviderResponse(response, await response.text());
  } catch (error) {
    return failedProviderResult(errorMessage(error));
  }
}

function normalizeProviderResponse(response, rawText) {
  const raw = parseJson(rawText);
  const providerMessageId = first(raw?.message_id, raw?.messageId, raw?.mid, raw?.data?.message_id, raw?.data?.messageId, raw?.recipient_id);
  const normalizedStatus = clean(first(raw?.provider_status, raw?.providerStatus, raw?.status, raw?.data?.status)).toLowerCase();
  const explicitFailure = Boolean(raw?.error) || raw?.ok === false || raw?.success === false || FAILURE_STATUSES.has(normalizedStatus);
  const explicitSuccess = raw?.ok === true || raw?.success === true || SUCCESS_STATUSES.has(normalizedStatus);
  const accepted = Boolean(providerMessageId) || explicitSuccess || (response.ok && !explicitFailure);
  const error = accepted ? "" : first(raw?.error?.message, raw?.error, raw?.message, rawText, `HTTP ${response.status}`);
  return {
    ok: accepted,
    status: accepted ? "sent" : "failed",
    provider_status: accepted ? "sent" : "failed",
    provider_message_id: providerMessageId,
    providerMessageId,
    message_id: providerMessageId,
    http_status: response.status,
    httpStatus: response.status,
    error,
    raw,
  };
}

function failedProviderResult(message) {
  return { ok: false, status: "failed", provider_status: "failed", provider_message_id: "", providerMessageId: "", message_id: "", http_status: 0, httpStatus: 0, error: clean(message) || "Facebook request failed", raw: null };
}

function attemptSummary(provider, result) {
  return { provider, ok: result?.ok === true, httpStatus: Number(result?.http_status || result?.httpStatus || 0), providerMessageId: clean(result?.provider_message_id || result?.providerMessageId), error: clean(result?.error) };
}

async function prepareInboundAttachment(env, input) {
  const attachment = input.attachment || {};
  const attachmentType = normalizeMediaType(attachment.type || "attachment");
  const sourceUrl = clean(attachment.url);
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
    return {
      attachmentType,
      mediaType: attachmentType,
      mediaUrl: sourceUrl,
      fileUrl: sourceUrl,
      attachmentUrl: sourceUrl,
      fileName: clean(attachment.fileName),
      mimeType: clean(attachment.mimeType),
      fileSize: null,
      storageKey: "",
      mediaStatus: sourceUrl ? "external" : "metadata_only",
      isSensitive: true,
      stickerId: clean(attachment.stickerId),
      title: clean(attachment.title),
    };
  }

  const stored = await storeInboundMedia(env, {
    sourceUrl,
    eventId: input.eventId,
    conversationId: input.conversationId,
    pageId: input.pageId,
    participantId: input.participantId,
    mediaType: attachmentType,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
  });
  return {
    attachmentType,
    mediaType: attachmentType,
    mediaUrl: sourceUrl,
    fileUrl: sourceUrl,
    attachmentUrl: sourceUrl,
    fileName: stored.fileName,
    mimeType: stored.mimeType,
    fileSize: stored.fileSize,
    storageKey: stored.storageKey,
    mediaAssetId: stored.assetId,
    mediaStatus: "ready",
    isSensitive: true,
    stickerId: clean(attachment.stickerId),
    title: clean(attachment.title),
  };
}

async function storeInboundMedia(env, input) {
  const download = await fetchFacebookAttachment(input.sourceUrl, env);
  if (!download.ok) throw new Error(`Failed to download Facebook attachment: HTTP ${download.status}`);
  const bytes = await download.arrayBuffer();
  if (!bytes.byteLength) throw new Error("Facebook attachment download returned an empty file");
  const maxBytes = positiveInteger(env.MAX_MEDIA_BYTES, DEFAULT_MAX_MEDIA_BYTES);
  if (bytes.byteLength > maxBytes) throw new Error(`Facebook attachment exceeds the ${maxBytes} byte platform limit`);
  const responseMime = clean(download.headers.get("content-type")).split(";")[0];
  const mimeType = responseMime || clean(input.mimeType) || guessMimeType(input.sourceUrl, input.mediaType);
  const fileName = ensureMediaFileName(first(input.fileName, fileNameFromUrl(download.url || input.sourceUrl)), input.mediaType, mimeType, input.eventId);
  const endpoint = platformMediaUrl(env);
  const secret = clean(env.MZJ_GATEWAY_SECRET);
  if (!endpoint || !secret) throw new Error("Platform inbound media endpoint is not configured");

  const preparedResponse = await fetch(endpoint, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "x-mzj-gateway-secret": secret, "x-mzj-source": "facebook", "x-event-id": clean(input.eventId) },
    body: JSON.stringify({
      action: "prepare_upload",
      source: "facebook",
      eventKey: clean(input.eventId),
      conversationId: clean(input.conversationId),
      pageId: clean(input.pageId),
      participantId: clean(input.participantId),
      mediaType: normalizeMediaType(input.mediaType),
      fileName,
      mimeType,
      fileSize: bytes.byteLength,
      isSensitive: true,
    }),
  });
  const preparedText = await preparedResponse.text();
  const prepared = parseJson(preparedText);
  if (!preparedResponse.ok || prepared?.ok === false || !clean(prepared?.uploadUrl) || !clean(prepared?.storageKey)) {
    throw new Error(first(prepared?.error, preparedText, `Platform media prepare failed: HTTP ${preparedResponse.status}`));
  }
  const upload = await fetch(clean(prepared.uploadUrl), { method: "PUT", headers: { "content-type": mimeType || "application/octet-stream" }, body: bytes });
  if (!upload.ok) throw new Error(`Platform media upload failed: HTTP ${upload.status}`);
  return { assetId: clean(prepared.assetId), storageKey: clean(prepared.storageKey), fileName, mimeType, fileSize: bytes.byteLength };
}

async function fetchFacebookAttachment(url, env) {
  const token = clean(env.FB_PAGE_ACCESS_TOKEN);
  const attempts = [{ url, headers: { accept: "*/*" } }];
  if (token) {
    attempts.push({ url, headers: { accept: "*/*", authorization: `Bearer ${token}` } });
    try {
      const withToken = new URL(url);
      if (!withToken.searchParams.has("access_token")) withToken.searchParams.set("access_token", token);
      attempts.push({ url: withToken.toString(), headers: { accept: "*/*" } });
    } catch {}
  }
  let lastResponse = null;
  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url, { method: "GET", headers: attempt.headers, redirect: "follow" });
      lastResponse = response;
      if (response.ok) return response;
    } catch {}
  }
  return lastResponse || new Response("Attachment download failed", { status: 502 });
}

async function forwardToPlatform(payload, env, sourceHeader) {
  const endpoint = platformInboundUrl(env);
  const secret = clean(env.MZJ_GATEWAY_SECRET);
  if (!endpoint) return { ok: false, status: 0, error: "Missing PLATFORM_INBOUND_URL", data: null };
  if (!secret) return { ok: false, status: 0, error: "Missing MZJ_GATEWAY_SECRET", data: null };
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-mzj-gateway-secret": secret,
        "x-mzj-source": clean(sourceHeader) || "facebook",
        "x-event-id": clean(payload.eventId || payload.event_id),
      },
      body: JSON.stringify(payload),
    });
    const rawText = await response.text();
    const data = parseJson(rawText);
    return { ok: response.ok && data?.ok !== false, status: response.status, data, error: response.ok ? "" : first(data?.error, rawText, `HTTP ${response.status}`) };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: errorMessage(error) };
  }
}


function platformInboundUrl(env) {
  return clean(env.PLATFORM_INBOUND_URL) || DEFAULT_PLATFORM_INBOUND_URL;
}

function platformMediaUrl(env) {
  const configured = clean(env.PLATFORM_MEDIA_URL);
  if (configured) return configured;
  try {
    const url = new URL(platformInboundUrl(env));
    url.pathname = "/api/integrations/media";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function graphBase(env) {
  return `https://graph.facebook.com/${clean(env.FB_GRAPH_API_VERSION) || DEFAULT_GRAPH_API_VERSION}`;
}

function facebookSendUrl(env) {
  return clean(env.FACEBOOK_SEND_URL) || `${graphBase(env)}/me/messages`;
}

function manychatToken(env) {
  return clean(env.MANYCHAT_API_TOKEN || env.MANYCHAT_API_KEY);
}

function gatewayAuthorized(request, env) {
  const expected = clean(env.MZJ_GATEWAY_SECRET);
  return expected && timingSafeEqualText(expected, clean(request.headers.get("x-mzj-gateway-secret")));
}

function manychatWebhookAuthorized(request, env) {
  const expected = clean(env.MANYCHAT_WEBHOOK_SECRET);
  if (!expected) return true;
  const provided = first(
    request.headers.get("x-manychat-webhook-secret"),
    request.headers.get("x-mzj-gateway-secret"),
    clean(request.headers.get("authorization")).replace(/^Bearer\s+/i, ""),
    new URL(request.url).searchParams.get("secret"),
  );
  return timingSafeEqualText(expected, provided);
}

async function verifyXHubSignature256(headerValue, rawBody, secret) {
  if (!headerValue.startsWith("sha256=")) return false;
  const provided = headerValue.slice(7).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(provided)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return timingSafeEqualText(computed, provided);
}

function timingSafeEqualText(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a || a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}

function facebookConversationId(pageId, participantId) {
  return `facebook:${clean(pageId)}:${clean(participantId)}`;
}

function parseFacebookConversationId(value) {
  const match = clean(value).match(/^facebook:([^:]+):(.+)$/);
  return match ? { pageId: match[1], participantId: match[2] } : null;
}

function normalizeMediaType(value) {
  const type = clean(value).toLowerCase();
  if (["photo", "picture"].includes(type)) return "image";
  if (["voice", "ptt"].includes(type)) return "audio";
  if (type === "file") return "document";
  return type || "attachment";
}

function normalizeOutboundMediaType(value) {
  const type = normalizeMediaType(value);
  if (["document", "attachment", "link", "sticker"].includes(type)) return "file";
  return ["image", "audio", "video", "file"].includes(type) ? type : "file";
}

function attachmentLabel(type) {
  const normalized = normalizeMediaType(type);
  if (normalized === "image") return "صورة من العميل";
  if (normalized === "audio") return "رسالة صوتية من العميل";
  if (normalized === "video") return "فيديو من العميل";
  if (["document", "file"].includes(normalized)) return "ملف من العميل";
  if (normalized === "sticker") return "ملصق من العميل";
  if (normalized === "link") return "رابط من العميل";
  return "مرفق من العميل";
}

function ensureMediaFileName(value, mediaType, mimeType, eventId) {
  let fileName = clean(value).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
  if (!fileName) fileName = `${normalizeMediaType(mediaType)}-${clean(eventId) || Date.now()}`;
  if (!/\.[a-z0-9]{1,10}$/i.test(fileName)) fileName += extensionFromMimeType(mimeType, mediaType);
  return fileName.slice(0, 180);
}

function extensionFromMimeType(mimeType, mediaType) {
  const mime = clean(mimeType).toLowerCase();
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("pdf")) return ".pdf";
  if (mime.includes("mp4")) return ".mp4";
  if (mime.includes("ogg") || mime.includes("opus")) return ".ogg";
  if (mime.includes("wav")) return ".wav";
  if (mime.includes("aac")) return ".aac";
  if (mime.includes("zip")) return ".zip";
  if (mime.includes("plain")) return ".txt";
  const type = normalizeMediaType(mediaType);
  if (type === "image") return ".jpg";
  if (type === "audio") return ".mp3";
  if (type === "video") return ".mp4";
  return ".bin";
}

function guessMimeType(url, mediaType) {
  const lower = clean(url).toLowerCase().split("?")[0];
  if (/\.jpe?g$/.test(lower)) return "image/jpeg";
  if (/\.png$/.test(lower)) return "image/png";
  if (/\.webp$/.test(lower)) return "image/webp";
  if (/\.gif$/.test(lower)) return "image/gif";
  if (/\.mp3$/.test(lower)) return "audio/mpeg";
  if (/\.(ogg|opus)$/.test(lower)) return "audio/ogg";
  if (/\.wav$/.test(lower)) return "audio/wav";
  if (/\.aac$/.test(lower)) return "audio/aac";
  if (/\.mp4$/.test(lower)) return "video/mp4";
  if (/\.pdf$/.test(lower)) return "application/pdf";
  if (/\.zip$/.test(lower)) return "application/zip";
  if (/\.txt$/.test(lower)) return "text/plain";
  const type = normalizeMediaType(mediaType);
  if (type === "image") return "image/jpeg";
  if (type === "audio") return "audio/mpeg";
  if (type === "video") return "video/mp4";
  return "application/octet-stream";
}

function fileNameFromUrl(value) {
  try { return decodeURIComponent(new URL(clean(value)).pathname.split("/").pop() || ""); }
  catch { return ""; }
}

function stableEventId(value) {
  const serialized = JSON.stringify(value || {});
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `facebook_${(hash >>> 0).toString(16)}`;
}

function timestampMs(value) {
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const number = Number(value);
    return number < 1e12 ? number * 1000 : number;
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function first(...values) {
  for (const value of values) {
    const result = clean(value);
    if (result) return result;
  }
  return "";
}

function clean(value) {
  if (value == null) return "";
  if (["string", "number", "boolean"].includes(typeof value)) return String(value).trim();
  return "";
}

function parseJson(value) {
  if (value && typeof value === "object") return value;
  try { return value ? JSON.parse(String(value)) : {}; }
  catch { return { raw: String(value || "") }; }
}

function parseJsonStrict(value) {
  try { return { ok: true, value: JSON.parse(String(value || "")) }; }
  catch { return { ok: false, value: null }; }
}

async function safeJson(request) {
  try { return await request.json(); }
  catch { return {}; }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

async function debugPut(env, key, value) {
  try {
    if (!env.DEBUG_KV) return;
    await env.DEBUG_KV.put(key, JSON.stringify({ at: new Date().toISOString(), value }), { expirationTtl: 86400 });
  } catch {}
}

async function debugGet(env, key) {
  try {
    if (!env.DEBUG_KV) return null;
    const raw = await env.DEBUG_KV.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-mzj-gateway-secret,x-manychat-webhook-secret,x-hub-signature-256",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders(), "content-type": "application/json; charset=utf-8" } });
}

function text(value, status = 200) {
  return new Response(String(value || ""), { status, headers: { ...corsHeaders(), "content-type": "text/plain; charset=utf-8" } });
}
