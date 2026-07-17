const VERSION = "mzj-integration-gateway-v1.12.0";

const INBOUND_ROUTES = new Map([
  ["/webhooks/facebook", "facebook"],
  ["/webhooks/instagram", "instagram"],
  ["/webhooks/tiktok", "tiktok"],
  ["/webhook/mersal", "whatsapp"],
  ["/imports/tiktok-snapchat", "tiktok-snapchat"],
  ["/imports/installment-calculator", "installment-calculator"],
]);

const OUTBOUND_ROUTES = new Map([
  ["/send/facebook", "facebook"],
  ["/send/instagram", "instagram"],
  ["/send/tiktok", "tiktok"],
  ["/send/mersal", "whatsapp"],
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true, service: "mzj-integration-gateway", version: VERSION, inbound: [...INBOUND_ROUTES.keys()], outbound: [...OUTBOUND_ROUTES.keys()] });
    }
    if (request.method === "GET" && url.pathname === "/webhooks/facebook") return verifyFacebookWebhook(url, env);

    if (request.method === "POST" && url.pathname === "/templates/mersal") {
      if (!safeEquals(request.headers.get("x-mzj-gateway-secret") || "", env.GATEWAY_SECRET || "")) return json({ ok: false, error: "Unauthorized gateway request" }, 401);
      return syncMersalTemplates(env);
    }

    const inboundSource = INBOUND_ROUTES.get(url.pathname);
    if (inboundSource) {
      if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleInbound(request, env, inboundSource);
    }

    const outboundSource = OUTBOUND_ROUTES.get(url.pathname);
    if (outboundSource) {
      if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      if (!safeEquals(request.headers.get("x-mzj-gateway-secret") || "", env.GATEWAY_SECRET || "")) return json({ ok: false, error: "Unauthorized gateway send" }, 401);
      return sendOutbound(outboundSource, await readJson(request), env);
    }

    return json({ ok: false, error: "Not found" }, 404);
  },
};

async function handleInbound(request, env, routeSource) {
  const rawBody = await request.text();
  const payload = parseJson(rawBody);
  const verified = await verifyInbound(request, env, routeSource, rawBody);
  if (!verified.ok) return json({ ok: false, error: verified.error }, verified.status || 401);

  if (routeSource === "facebook" && payload?.object === "page") return forwardEvents(env, routeSource, normalizeFacebookEvents(payload));
  if (routeSource === "whatsapp") return forwardEvents(env, routeSource, await normalizeMersalEvents(payload, env));

  if (["tiktok-snapchat", "installment-calculator"].includes(routeSource)) {
    const rows = Array.isArray(payload?.rows) ? payload.rows : [payload?.row && typeof payload.row === "object" ? payload.row : payload];
    return forwardEvents(env, routeSource, rows.filter(Boolean).map((row) => ({
      eventId: String(row.eventId || row.event_id || row.id || hashText(JSON.stringify(row))),
      payload: row,
    })));
  }

  const eventId = String(payload?.eventId || payload?.event_id || payload?.messageId || payload?.message_id || payload?.id || hashText(rawBody));
  const result = await forwardToPlatform(env, routeSource, payload, eventId);
  return new Response(result.body, { status: result.status, headers: { ...corsHeaders(), "content-type": result.contentType } });
}

async function forwardEvents(env, source, events) {
  if (!events.length) return json({ ok: true, source, count: 0, results: [] }, 202);
  const results = [];
  for (const event of events) results.push(await forwardToPlatform(env, source, event.payload, event.eventId));
  return aggregateResponse(source, results);
}

async function verifyInbound(request, env, source, rawBody) {
  if (source === "facebook" && env.FB_APP_SECRET) {
    const signature = request.headers.get("x-hub-signature-256");
    if (!signature) return { ok: false, status: 401, error: "Missing Facebook signature" };
    const valid = await verifyMetaSignature(signature, rawBody, env.FB_APP_SECRET);
    return valid ? { ok: true } : { ok: false, status: 401, error: "Bad Facebook signature" };
  }

  // Mersal posts directly to the registered webhook URL and does not use the platform gateway header.
  if (source === "whatsapp") return { ok: true };

  const sourceKey = `${source.toUpperCase().replace(/-/g, "_")}_WEBHOOK_SECRET`;
  const expected = String(env[sourceKey] || "").trim();
  if (!expected) return { ok: false, status: 503, error: `${sourceKey} is not configured` };
  const provided = String(request.headers.get("x-webhook-secret") || "").trim();
  return safeEquals(provided, expected) ? { ok: true } : { ok: false, status: 401, error: "Invalid webhook secret" };
}

function verifyFacebookWebhook(url, env) {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && safeEquals(token, env.FB_VERIFY_TOKEN || "")) return new Response(challenge || "", { status: 200, headers: corsHeaders() });
  return new Response("Forbidden", { status: 403, headers: corsHeaders() });
}

async function forwardToPlatform(env, source, payload, eventId) {
  const base = requiredUrl(env.PLATFORM_API_BASE_URL, "PLATFORM_API_BASE_URL").replace(/\/$/, "");
  const secret = required(env.GATEWAY_SECRET, "GATEWAY_SECRET");
  const upstream = await fetch(`${base}/integrations/${source}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mzj-source": source, "x-mzj-gateway-secret": secret, "x-event-id": eventId || "" },
    body: JSON.stringify({ ...payload, eventId }),
  });
  return { status: upstream.status, body: await upstream.text(), contentType: upstream.headers.get("content-type") || "application/json" };
}

function normalizeFacebookEvents(payload) {
  const events = [];
  for (const entry of payload?.entry || []) {
    const pageId = String(entry?.id || "");
    for (const item of [...(entry?.messaging || []), ...(entry?.standby || [])]) {
      const senderId = String(item?.sender?.id || "");
      const recipientId = String(item?.recipient?.id || "");
      const isEcho = item?.message?.is_echo === true || senderId === pageId;
      const participantId = isEcho ? recipientId : senderId;
      if (!participantId) continue;
      const attachment = item?.message?.attachments?.[0] || {};
      const messageId = String(item?.message?.mid || item?.postback?.mid || `${entry?.time || Date.now()}_${participantId}`);
      const text = String(item?.message?.text || item?.postback?.title || item?.postback?.payload || "");
      events.push({ eventId: `facebook_${messageId}`, payload: {
        participantId, pageId, conversationId: `facebook:${pageId}:${participantId}`, messageId, message: text, text,
        direction: isEcho ? "out" : "in", provider: "meta", platform: "facebook",
        attachmentUrl: attachment?.payload?.url || "", attachmentType: attachment?.type || "", timestamp: item?.timestamp || entry?.time || Date.now(),
      }});
    }
  }
  return events;
}

async function normalizeMersalEvents(incoming, env) {
  const messages = extractMersalMessages(incoming);
  const output = [];
  for (const item of messages) {
    let attachment = item.attachment;
    if (attachment?.hasAttachment) {
      const directUrl = normalizeMersalMediaUrl(attachment.mediaUrl, env);
      const needsApiResolution = !directUrl || isProtectedWhatsappMediaUrl(directUrl);
      attachment = needsApiResolution
        ? { ...attachment, ...(await resolveMersalMedia(env, item)) }
        : { ...attachment, mediaUrl: directUrl };
      if (!attachment.mediaUrl) throw new Error(`Mersal media URL is missing for message ${item.messageId}`);
      attachment = { ...attachment, ...(await persistInboundMedia(env, item, attachment)) };
    }
    const text = item.text || attachment?.caption || (attachment?.hasAttachment ? attachmentLabel(attachment.attachmentType) : "");
    output.push({ eventId: item.messageId, payload: {
      type: "incoming_message", eventType: "incoming_message", direction: "in", senderType: "customer",
      provider: "mersal", platform: "whatsapp", channel: "whatsapp", channelCode: "whatsapp",
      waId: item.phone, phone: item.phone, participantId: item.phone, conversationId: item.phone,
      customerName: item.displayName, messageId: item.messageId, providerMessageId: item.messageId,
      text, message: text, messageType: attachment?.hasAttachment ? attachment.attachmentType : item.messageType,
      timestamp: item.timestamp, hasAttachment: Boolean(attachment?.hasAttachment),
      attachmentType: attachment?.attachmentType || "", mediaType: attachment?.attachmentType || "",
      mediaUrl: attachment?.storageKey ? "" : attachment?.mediaUrl || "",
      fileUrl: attachment?.storageKey ? "" : attachment?.mediaUrl || "",
      attachmentUrl: attachment?.storageKey ? "" : attachment?.mediaUrl || "",
      storageKey: attachment?.storageKey || "", fileName: attachment?.fileName || "",
      mimeType: attachment?.mimeType || "", fileSize: attachment?.fileSize || null,
      caption: attachment?.caption || "", mediaId: attachment?.mediaId || "",
    }});
  }
  return dedupeEvents(output);
}

function extractMersalMessages(incoming) {
  const roots = [incoming?.entry?.[0]?.changes?.[0]?.value, incoming?.value, incoming?.data, incoming?.payload, incoming?.webhook, incoming?.body, incoming?.event, incoming].filter((value) => value && typeof value === "object");
  const values = [];
  for (const root of roots) {
    for (const entry of Array.isArray(root?.entry) ? root.entry : []) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      if (changes.length) for (const change of changes) if (change?.value && typeof change.value === "object") values.push(change.value);
      else values.push(entry);
    }
    if (root?.value && typeof root.value === "object") values.push(root.value);
    values.push(root);
  }

  const output = [];
  for (const value of values) {
    const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
    const list = Array.isArray(value?.messages) ? value.messages : value?.message && typeof value.message === "object" ? [value.message] : [];
    for (let index = 0; index < list.length; index += 1) {
      const message = list[index] || {};
      const direction = clean(message?.direction || value?.direction || "in").toLowerCase();
      const contactFlag = message?.is_message_by_contact ?? message?.isMessageByContact ?? value?.is_message_by_contact ?? value?.isMessageByContact;
      if (["out", "outbound", "sent"].includes(direction) || Number(contactFlag) === 0) continue;
      const contact = contacts[index] || contacts[0] || value?.contact || {};
      const phone = normalizePhone(first(
        message?.from, message?.phone, message?.waId, message?.wa_id, message?.sender?.phone, message?.sender?.wa_id,
        contact?.wa_id, contact?.phone, contact?.id, value?.waId, value?.wa_id, value?.phone, value?.from,
      ));
      if (!phone) continue;
      const messageType = normalizeMediaType(first(message?.type, value?.messageType, value?.message_type, "text"));
      output.push({
        phone,
        displayName: first(contact?.profile?.name, contact?.name, message?.sender?.name, value?.customerName, value?.displayName, value?.name, "عميل"),
        messageId: first(message?.id, message?.message_id, message?.fb_message_id, value?.messageId, value?.message_id, value?.eventId),
        timestamp: message?.timestamp || message?.createdAt || message?.created_at || value?.timestamp || value?.createdAt || value?.created_at || Date.now(),
        messageType,
        text: extractInboundText(message) || first(
          typeof message?.text === "string" ? message.text : "", message?.last_input_text, message?.customer_message,
          message?.body, typeof message?.message === "string" ? message.message : "", value?.last_input_text, value?.customer_message,
        ),
        attachment: extractInboundAttachment(message) || genericAttachment(message) || genericAttachment(value),
      });
    }
  }

  if (!output.length) {
    const value = roots[0] || {};
    const direction = clean(value?.direction || "in").toLowerCase();
    const contactFlag = value?.is_message_by_contact ?? value?.isMessageByContact;
    const phone = normalizePhone(first(
      value?.waId, value?.wa_id, value?.phone, value?.from, value?.sender?.phone, value?.sender?.wa_id, value?.contact?.phone,
    ));
    const text = first(
      value?.text?.body, typeof value?.text === "string" ? value.text : "", value?.body,
      value?.last_input_text, value?.customer_message, typeof value?.message === "string" ? value.message : "", value?.caption,
    );
    const attachment = genericAttachment(value);
    if (phone && !["out", "outbound", "sent"].includes(direction) && Number(contactFlag) !== 0 && (text || attachment)) {
      output.push({
        phone, displayName: first(value?.customerName, value?.displayName, value?.name, value?.sender?.name, value?.contact?.name, "عميل"),
        messageId: first(value?.messageId, value?.message_id, value?.eventId, value?.id),
        timestamp: value?.timestamp || value?.createdAt || value?.created_at || Date.now(),
        messageType: attachment?.attachmentType || normalizeMediaType(first(value?.messageType, value?.message_type, value?.type, "text")),
        text, attachment,
      });
    }
  }

  for (const item of output) {
    if (!item.messageId) throw new Error(`Mersal message ID is missing for ${item.phone}`);
  }
  return output;
}

function extractInboundText(message) {
  return first(message?.text?.body, message?.button?.text, message?.interactive?.button_reply?.title, message?.interactive?.list_reply?.title,
    message?.image?.caption, message?.video?.caption, message?.document?.caption);
}

function extractInboundAttachment(message) {
  const type = normalizeMediaType(message?.type);
  const media = message?.[clean(message?.type).toLowerCase()] || message?.[type];
  if (!media || !["image", "audio", "video", "document", "sticker"].includes(type)) return null;
  const mediaUrl = first(media?.url, media?.link, media?.href);
  const mimeType = first(media?.mime_type, media?.mimeType);
  const mediaId = first(media?.id);
  return { hasAttachment: true, attachmentType: type, mediaId, mediaUrl,
    fileName: first(media?.filename, media?.fileName, media?.name) || buildMediaFileName(type, mediaId, mimeType),
    mimeType, caption: first(media?.caption) };
}

function genericAttachment(value) {
  const mediaUrl = first(value?.mediaUrl, value?.media_url, value?.attachmentUrl, value?.attachment_url, value?.fileUrl, value?.file_url);
  const mediaId = first(value?.mediaId, value?.media_id);
  const type = normalizeMediaType(first(value?.mediaType, value?.media_type, value?.attachmentType, value?.attachment_type, value?.messageType, value?.message_type, "document"));
  if (!mediaUrl && !mediaId && value?.hasAttachment !== true) return null;
  const mimeType = first(value?.mimeType, value?.mime_type);
  return { hasAttachment: true, attachmentType: type, mediaId, mediaUrl,
    fileName: first(value?.fileName, value?.file_name) || buildMediaFileName(type, mediaId, mimeType), mimeType, caption: first(value?.caption) };
}

async function resolveMersalMedia(env, item) {
  const token = required(env.MERSAL_API_TOKEN, "MERSAL_API_TOKEN");
  const conversationsUrl = requiredUrl(env.MERSAL_CONVERSATIONS_URL, "MERSAL_CONVERSATIONS_URL");
  const messagesUrl = requiredUrl(env.MERSAL_MESSAGES_URL, "MERSAL_MESSAGES_URL");
  const conversations = await postJson(conversationsUrl, { token });
  const rows = Array.isArray(conversations?.data) ? conversations.data : [];
  const contact = rows.find((row) => normalizePhone(row?.phone || row?.name || row?.mobile) === item.phone);
  const contactId = first(contact?.id, contact?.contact_id);
  if (!contactId) throw new Error(`Mersal contact not found for ${item.phone}`);
  const messageIdentity = new Set([item.messageId, item.attachment?.mediaId].map(clean).filter(Boolean));
  for (const delay of [0, 700, 1400, 2400, 3500]) {
    if (delay) await sleep(delay);
    const messages = await postJson(messagesUrl, { token, contact_id: contactId });
    const list = Array.isArray(messages?.data) ? messages.data : Array.isArray(messages?.messages) ? messages.messages : [];
    const row = list.find((candidate) => [candidate?.fb_message_id, candidate?.message_wamid, candidate?.wamid, candidate?.message_id, candidate?.id]
      .map(clean).some((value) => value && messageIdentity.has(value)));
    if (!row) continue;
    const media = mediaFromMersalRow(row, env);
    if (media.mediaUrl) return media;
  }
  throw new Error(`Mersal media URL not found: ${item.messageId}`);
}

function mediaFromMersalRow(row, env) {
  const fields = [
    ["image", row?.header_image || row?.image || row?.image_url || row?.media_image],
    ["audio", row?.header_audio || row?.audio || row?.audio_url || row?.voice || row?.voice_url || row?.media_audio],
    ["video", row?.header_video || row?.video || row?.video_url || row?.media_video],
    ["document", row?.header_document || row?.document || row?.document_url || row?.file || row?.file_url || row?.media_document],
  ];
  const selected = fields.find(([, value]) => clean(value));
  if (!selected) return { mediaUrl: "" };
  const type = selected[0];
  const mediaUrl = normalizeMersalMediaUrl(selected[1], env);
  const mimeType = first(row?.mime_type, row?.mimeType, guessMimeType(mediaUrl, type));
  return { hasAttachment: true, attachmentType: type, mediaUrl, fileName: first(row?.filename, row?.file_name) || buildMediaFileName(type, first(row?.message_id, row?.id), mimeType), mimeType, caption: first(row?.caption, row?.text) };
}

async function persistInboundMedia(env, item, attachment) {
  const base = requiredUrl(env.PLATFORM_API_BASE_URL, "PLATFORM_API_BASE_URL").replace(/\/$/, "");
  const secret = required(env.GATEWAY_SECRET, "GATEWAY_SECRET");
  const mediaResponse = await fetch(attachment.mediaUrl);
  if (!mediaResponse.ok) throw new Error(`Unable to download inbound media: HTTP ${mediaResponse.status}`);
  const mimeType = attachment.mimeType || mediaResponse.headers.get("content-type") || guessMimeType(attachment.mediaUrl, attachment.attachmentType);
  const bytes = await mediaResponse.arrayBuffer();
  if (bytes.byteLength > 50 * 1024 * 1024) throw new Error("Inbound media exceeds 50MB");
  const fileName = attachment.fileName || buildMediaFileName(attachment.attachmentType, item.messageId, mimeType);
  const preparedResponse = await fetch(`${base}/integrations/media`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mzj-gateway-secret": secret },
    body: JSON.stringify({ action: "prepare_upload", source: "whatsapp", eventKey: item.messageId, conversationId: item.phone, fileName, mimeType, fileSize: bytes.byteLength, mediaType: attachment.attachmentType, isSensitive: true }),
  });
  const prepared = parseJson(await preparedResponse.text());
  if (!preparedResponse.ok || prepared?.ok === false || !prepared?.uploadUrl || !prepared?.storageKey) throw new Error(`Platform media preparation failed: HTTP ${preparedResponse.status}`);
  const upload = await fetch(prepared.uploadUrl, { method: "PUT", headers: { "content-type": mimeType }, body: bytes });
  if (!upload.ok) throw new Error(`R2 media upload failed: HTTP ${upload.status}`);
  return { storageKey: prepared.storageKey, fileSize: bytes.byteLength, mimeType, fileName };
}


async function syncMersalTemplates(env) {
  const token = required(env.MERSAL_API_TOKEN, "MERSAL_API_TOKEN");
  const url = requiredUrl(env.MERSAL_TEMPLATES_URL, "MERSAL_TEMPLATES_URL");
  const response = await fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const raw = parseJson(await response.text());
  if (!response.ok || raw?.ok === false || clean(raw?.status).toLowerCase() === "error") {
    return json({ ok: false, error: first(raw?.error, raw?.message, `HTTP ${response.status}`), raw }, 502);
  }
  const templates = Array.isArray(raw) ? raw : Array.isArray(raw?.templates) ? raw.templates : Array.isArray(raw?.data) ? raw.data : [];
  return json({ ok: true, source: "mersal", templates }, 200);
}

async function sendOutbound(source, payload, env) {
  if (source === "instagram") return responseFromResult(await sendManyChat(payload, required(env.MANYCHAT_INSTAGRAM_TOKEN, "MANYCHAT_INSTAGRAM_TOKEN")));
  if (source === "facebook") return responseFromResult(await sendManyChat(payload, required(env.MANYCHAT_FACEBOOK_TOKEN, "MANYCHAT_FACEBOOK_TOKEN")));
  if (source === "tiktok") return responseFromResult(await sendTikTok(payload, env));
  if (source === "whatsapp") return responseFromResult(await sendMersal(payload, env));
  return json({ ok: false, error: "Unknown send source" }, 400);
}

async function sendManyChat(payload, token) {
  const subscriberId = String(payload?.participantId || payload?.subscriber_id || payload?.subscriberId || "").trim();
  const text = String(payload?.message || payload?.text || "").trim();
  if (!subscriberId || !text) return { ok: false, error: "participantId and message are required" };
  const response = await fetch("https://api.manychat.com/fb/sending/sendContent", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ subscriber_id: subscriberId, data: { version: "v2", content: { messages: [{ type: "text", text }] } } }),
  });
  return providerResult(response, "manychat");
}

async function sendTikTok(payload, env) {
  const subscriberId = String(payload?.participantId || payload?.subscriber_id || payload?.subscriberId || "").trim();
  const text = String(payload?.message || payload?.text || "").trim();
  const token = required(env.MANYCHAT_TIKTOK_TOKEN, "MANYCHAT_TIKTOK_TOKEN");
  const fieldId = Number(required(env.MANYCHAT_MESSAGE_FIELD_ID, "MANYCHAT_MESSAGE_FIELD_ID"));
  const tagId = Number(required(env.MANYCHAT_TRIGGER_TAG_ID, "MANYCHAT_TRIGGER_TAG_ID"));
  if (!subscriberId || !text) return { ok: false, error: "participantId and message are required" };
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  await callManyChat("https://api.manychat.com/fb/subscriber/removeTag", headers, { subscriber_id: subscriberId, tag_id: tagId });
  await sleep(700);
  const field = await callManyChat("https://api.manychat.com/fb/subscriber/setCustomField", headers, { subscriber_id: subscriberId, field_id: fieldId, field_value: text });
  await sleep(700);
  const tag = await callManyChat("https://api.manychat.com/fb/subscriber/addTag", headers, { subscriber_id: subscriberId, tag_id: tagId });
  return { ok: field.ok && tag.ok, provider: "manychat_tiktok", setField: field, addTag: tag };
}

async function callManyChat(url, headers, payload) {
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  const result = await providerResult(response, "manychat");
  return { ok: result.ok, status: result.http_status, response: result.raw };
}

async function sendMersal(payload, env) {
  const phone = normalizePhone(payload?.phone);
  if (!phone) return { ok: false, status: "error", error: "Valid phone is required" };
  const token = required(env.MERSAL_TOKEN, "MERSAL_TOKEN");
  const type = clean(payload?.type).toLowerCase();
  if (!["text", "template", "media"].includes(type)) return { ok: false, status: "error", error: "type must be text, template, or media" };

  let url;
  let body;
  if (type === "text") {
    const message = clean(payload?.message);
    if (!message || clean(payload?.template_name)) return { ok: false, status: "error", error: "Invalid text payload" };
    url = requiredUrl(env.MERSAL_SEND_URL, "MERSAL_SEND_URL");
    body = { token, phone, message };
    if (Array.isArray(payload?.buttons) && payload.buttons.length) {
      body.buttons = payload.buttons;
      if (clean(payload?.header)) body.header = clean(payload.header);
      if (clean(payload?.footer)) body.footer = clean(payload.footer);
    }
  } else if (type === "template") {
    const templateName = clean(payload?.template_name);
    if (!templateName) return { ok: false, status: "error", error: "template_name is required" };
    url = requiredUrl(env.MERSAL_TEMPLATE_URL, "MERSAL_TEMPLATE_URL");
    body = {
      token,
      phone,
      template_name: templateName,
      template_language: clean(payload?.template_language) || "ar",
      components: Array.isArray(payload?.components) ? payload.components : [],
    };
  } else {
    const mediaUrl = normalizeHttpUrl(payload?.media_url);
    const mediaType = normalizeMediaType(payload?.media_type);
    if (clean(payload?.template_name)) return { ok: false, status: "error", error: "Media payload cannot contain template_name" };
    if (!mediaUrl || !["image", "audio", "video", "document"].includes(mediaType)) return { ok: false, status: "error", error: "Valid media_url and media_type are required" };
    url = requiredUrl(env.MERSAL_MEDIA_SEND_URL, "MERSAL_MEDIA_SEND_URL");
    body = { token, phone, type: mediaType, media_url: mediaUrl };
    if (clean(payload?.caption)) body.caption = clean(payload.caption);
    if (mediaType === "document" && clean(payload?.file_name)) body.filename = clean(payload.file_name);
  }

  const response = await fetch(url, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body) });
  return providerResult(response, "mersal");
}

async function postJson(url, body) {
  const response = await fetch(url, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = parseJson(await response.text());
  if (!response.ok || payload?.ok === false || clean(payload?.status).toLowerCase() === "error") throw new Error(first(payload?.error, payload?.message, `HTTP ${response.status}`));
  return payload;
}

async function providerResult(response, provider) {
  const text = await response.text();
  const raw = parseJson(text);
  const status = clean(raw?.status || raw?.data?.status).toLowerCase();
  const ok = response.ok && raw?.ok !== false && raw?.success !== false && !["error", "failed", "failure", "rejected"].includes(status);
  return {
    ok,
    provider,
    http_status: response.status,
    status: ok ? "success" : "error",
    provider_message_id: first(raw?.message_wamid, raw?.message_id, raw?.data?.message_wamid, raw?.data?.message_id, raw?.data?.id),
    error: ok ? "" : first(raw?.error, raw?.message, text, `HTTP ${response.status}`),
    raw,
  };
}

function responseFromResult(result) { return json(result, result.ok ? 200 : 502); }
function aggregateResponse(source, results) {
  const ok = results.every((item) => item.status >= 200 && item.status < 300);
  return json({ ok, source, count: results.length, results: results.map((item) => ({ status: item.status, response: parseJson(item.body) })) }, ok ? 202 : 502);
}

function dedupeEvents(events) {
  const seen = new Set();
  return events.filter((event) => { const key = `${event.eventId}:${event.payload?.phone || ""}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

async function verifyMetaSignature(signatureHeader, rawBody, secret) {
  const expectedPrefix = "sha256=";
  if (!signatureHeader?.startsWith(expectedPrefix)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = expectedPrefix + [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return safeEquals(signatureHeader, expected);
}

function safeEquals(left, right) {
  const a = new TextEncoder().encode(String(left || ""));
  const b = new TextEncoder().encode(String(right || ""));
  if (!a.length || a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

function normalizePhone(value) {
  let phone = arabicDigitsToEnglish(String(value || "")).replace(/\D/g, "");
  if (phone.startsWith("00")) phone = phone.slice(2);
  if (/^05\d{8}$/.test(phone)) phone = `966${phone.slice(1)}`;
  if (/^5\d{8}$/.test(phone)) phone = `966${phone}`;
  return /^9665\d{8}$/.test(phone) ? phone : "";
}

function arabicDigitsToEnglish(value) {
  const map = { "٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9","۰":"0","۱":"1","۲":"2","۳":"3","۴":"4","۵":"5","۶":"6","۷":"7","۸":"8","۹":"9" };
  return String(value || "").replace(/[٠-٩۰-۹]/g, (digit) => map[digit] || digit);
}

function normalizeMediaType(value) {
  const type = clean(value).toLowerCase();
  if (["photo", "picture"].includes(type)) return "image";
  if (["voice", "ptt"].includes(type)) return "audio";
  if (type === "file") return "document";
  return type || "text";
}

function normalizeHttpUrl(value) {
  const text = clean(value).replace(/\\\//g, "/").replace(/&amp;/gi, "&");
  if (!text) return "";
  try { const parsed = new URL(text); return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : ""; } catch { return ""; }
}

function normalizeMersalMediaUrl(value, env) {
  const text = clean(value).replace(/\\\//g, "/").replace(/&amp;/gi, "&");
  if (!text) return "";
  const absolute = normalizeHttpUrl(text);
  if (absolute) return absolute;
  const base = requiredUrl(env.MERSAL_MEDIA_BASE_URL, "MERSAL_MEDIA_BASE_URL").replace(/\/$/, "");
  const relative = text.startsWith("/") ? text : `/${text.replace(/^\/+/, "")}`;
  return new URL(relative, `${base}/`).toString();
}

function isProtectedWhatsappMediaUrl(value) {
  const host = (() => { try { return new URL(value).hostname.toLowerCase(); } catch { return ""; } })();
  return host === "lookaside.fbsbx.com" || host.endsWith(".facebook.com") || host.endsWith(".fbcdn.net");
}

function attachmentLabel(type) {
  return ({ image: "صورة من العميل", audio: "رسالة صوتية من العميل", video: "فيديو من العميل", document: "ملف من العميل", sticker: "ملصق من العميل" })[normalizeMediaType(type)] || "مرفق من العميل";
}

function buildMediaFileName(type, id, mimeType) {
  const extension = extensionFromMime(mimeType, type);
  const safeType = clean(type || "media").replace(/[^\w.-]/g, "") || "media";
  const safeId = clean(id || Date.now()).replace(/[^\w.-]/g, "").slice(0, 48) || String(Date.now());
  return `${safeType}-${safeId}${extension}`;
}

function guessMimeType(url, type) {
  const lower = clean(url).toLowerCase().split("?")[0];
  if (/\.jpe?g$/.test(lower)) return "image/jpeg";
  if (/\.png$/.test(lower)) return "image/png";
  if (/\.webp$/.test(lower)) return "image/webp";
  if (/\.gif$/.test(lower)) return "image/gif";
  if (/\.mp3$/.test(lower)) return "audio/mpeg";
  if (/\.(ogg|opus)$/.test(lower)) return "audio/ogg";
  if (/\.wav$/.test(lower)) return "audio/wav";
  if (/\.mp4$/.test(lower)) return "video/mp4";
  if (/\.pdf$/.test(lower)) return "application/pdf";
  const normalized = normalizeMediaType(type);
  return normalized === "image" ? "image/jpeg" : normalized === "audio" ? "audio/mpeg" : normalized === "video" ? "video/mp4" : "application/octet-stream";
}

function extensionFromMime(mimeType, type) {
  const mime = clean(mimeType).toLowerCase();
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("pdf")) return ".pdf";
  if (mime.includes("mp4")) return ".mp4";
  if (mime.includes("mpeg")) return ".mp3";
  if (mime.includes("ogg") || mime.includes("opus")) return ".ogg";
  if (mime.includes("wav")) return ".wav";
  return normalizeMediaType(type) === "image" ? ".jpg" : normalizeMediaType(type) === "audio" ? ".mp3" : normalizeMediaType(type) === "video" ? ".mp4" : ".bin";
}

function required(value, name) { const text = clean(value); if (!text) throw new Error(`${name} is not configured`); return text; }
function requiredUrl(value, name) { const text = required(value, name); const parsed = new URL(text); if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(`${name} must be an HTTP URL`); return parsed.toString(); }
function first(...values) { for (const value of values) { const text = clean(value); if (text) return text; } return ""; }
function clean(value) { return String(value ?? "").trim(); }
function hashText(value) { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16); }
function parseJson(text) { if (text && typeof text === "object") return text; try { return JSON.parse(String(text || "{}")); } catch { return { raw: String(text || "") }; } }
async function readJson(request) { return parseJson(await request.text()); }
function sleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function corsHeaders() { return { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type,authorization,x-webhook-secret,x-hub-signature-256,x-mzj-gateway-secret" }; }
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() } }); }
