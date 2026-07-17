const INBOUND_ROUTES = new Map([
  ["/webhooks/facebook", "facebook"],
  ["/webhooks/instagram", "instagram"],
  ["/webhooks/tiktok", "tiktok"],
  ["/webhooks/whatsapp", "whatsapp"],
  ["/imports/tiktok-snapchat", "tiktok-snapchat"],
  ["/imports/installment-calculator", "installment-calculator"],
]);

const OUTBOUND_ROUTES = new Map([
  ["/send/facebook", "facebook"],
  ["/send/instagram", "instagram"],
  ["/send/tiktok", "tiktok"],
  ["/send/whatsapp", "whatsapp"],
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return json({
        ok: true,
        service: "mzj-integration-gateway",
        inbound: [...INBOUND_ROUTES.keys()],
        outbound: [...OUTBOUND_ROUTES.keys()],
      });
    }

    if (request.method === "GET" && url.pathname === "/webhooks/facebook") {
      return verifyFacebookWebhook(url, env);
    }

    const inboundSource = INBOUND_ROUTES.get(url.pathname);
    if (inboundSource) {
      if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleInbound(request, env, inboundSource);
    }

    const outboundSource = OUTBOUND_ROUTES.get(url.pathname);
    if (outboundSource) {
      if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      if (!safeEquals(request.headers.get("x-mzj-gateway-secret") || "", env.GATEWAY_SECRET || "")) {
        return json({ ok: false, error: "Unauthorized gateway send" }, 401);
      }
      const payload = await readJson(request);
      return sendOutbound(outboundSource, payload, env);
    }

    return json({ ok: false, error: "Not found" }, 404);
  },
};

async function handleInbound(request, env, routeSource) {
  const rawBody = await request.text();
  const payload = parseJson(rawBody);
  const verified = await verifyInbound(request, env, routeSource, rawBody);
  if (!verified.ok) return json({ ok: false, error: verified.error }, verified.status || 401);

  if (routeSource === "facebook" && payload?.object === "page") {
    const events = normalizeFacebookEvents(payload);
    const results = [];
    for (const event of events) {
      results.push(await forwardToPlatform(env, routeSource, event.payload, event.eventId));
    }
    return aggregateResponse(routeSource, results);
  }

  if (routeSource === "whatsapp") {
    const events = normalizeWhatsappEvents(payload);
    const results = [];
    for (const event of events) {
      const enrichedPayload = await enrichWhatsappMediaPayload(event.payload, env).catch((error) => ({
        ...event.payload,
        mersalMediaResolved: false,
        mersalMediaError: String(error?.message || error || "media resolution failed"),
      }));
      results.push(await forwardToPlatform(env, routeSource, enrichedPayload, event.eventId));
    }
    return aggregateResponse(routeSource, results);
  }

  if (["tiktok-snapchat", "installment-calculator"].includes(routeSource)) {
    const rows = Array.isArray(payload?.rows) ? payload.rows : [payload?.row && typeof payload.row === "object" ? payload.row : payload];
    const results = [];
    for (const row of rows.filter(Boolean)) {
      const eventId = String(row.eventId || row.event_id || row.id || hashText(JSON.stringify(row)));
      results.push(await forwardToPlatform(env, routeSource, row, eventId));
    }
    return aggregateResponse(routeSource, results);
  }

  const eventId = String(payload?.eventId || payload?.event_id || payload?.messageId || payload?.message_id || payload?.id || hashText(rawBody));
  const result = await forwardToPlatform(env, routeSource, payload, eventId);
  return new Response(result.body, { status: result.status, headers: { ...corsHeaders(), "content-type": result.contentType } });
}

async function verifyInbound(request, env, source, rawBody) {
  if (source === "facebook" && env.FB_APP_SECRET && request.headers.get("x-hub-signature-256")) {
    const valid = await verifyMetaSignature(request.headers.get("x-hub-signature-256"), rawBody, env.FB_APP_SECRET);
    return valid ? { ok: true } : { ok: false, status: 401, error: "Bad Facebook signature" };
  }

  const sourceKey = `${source.toUpperCase().replace(/-/g, "_")}_WEBHOOK_SECRET`;
  const expected = String(env[sourceKey] || env.INBOUND_SHARED_SECRET || "").trim();
  if (!expected) return { ok: false, status: 503, error: `${sourceKey} or INBOUND_SHARED_SECRET is not configured` };
  const provided = String(request.headers.get("x-webhook-secret") || new URL(request.url).searchParams.get("secret") || "").trim();
  return safeEquals(provided, expected) ? { ok: true } : { ok: false, status: 401, error: "Invalid webhook secret" };
}

function verifyFacebookWebhook(url, env) {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && safeEquals(token, env.FB_VERIFY_TOKEN || "")) {
    return new Response(challenge || "", { status: 200, headers: corsHeaders() });
  }
  return new Response("Forbidden", { status: 403, headers: corsHeaders() });
}

async function forwardToPlatform(env, source, payload, eventId) {
  const base = String(env.PLATFORM_API_BASE_URL || "").replace(/\/$/, "");
  if (!base) return { status: 503, body: JSON.stringify({ ok: false, error: "PLATFORM_API_BASE_URL is not configured" }), contentType: "application/json" };
  const upstream = await fetch(`${base}/integrations/${source}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mzj-source": source,
      "x-mzj-gateway-secret": env.GATEWAY_SECRET || "",
      "x-event-id": eventId || "",
    },
    body: JSON.stringify({ ...payload, eventId: payload?.eventId || eventId }),
  });
  return {
    status: upstream.status,
    body: await upstream.text(),
    contentType: upstream.headers.get("content-type") || "application/json",
  };
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
      events.push({
        eventId: `facebook_${messageId}`,
        payload: {
          participantId,
          pageId,
          conversationId: `facebook:${pageId}:${participantId}`,
          messageId,
          message: text,
          text,
          direction: isEcho ? "out" : "in",
          provider: "meta",
          platform: "facebook",
          attachmentUrl: attachment?.payload?.url || "",
          attachmentType: attachment?.type || "",
          saveMessage: true,
          createLead: false,
          timestamp: item?.timestamp || entry?.time || Date.now(),
        },
      });
    }
  }
  return events;
}

function normalizeWhatsappEvents(payload) {
  const output = [];
  const entries = payload?.entry || [];
  for (const entry of entries) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      const messages = value?.messages || [];
      if (!messages.length) {
        output.push({ eventId: hashText(JSON.stringify(change)), payload: { entry: [{ ...entry, changes: [{ ...change, value }] }] } });
        continue;
      }
      for (const message of messages) {
        output.push({
          eventId: String(message?.id || hashText(JSON.stringify(message))),
          payload: {
            entry: [{ ...entry, changes: [{ ...change, value: { ...value, messages: [message] } }] }],
          },
        });
      }
    }
  }
  if (!output.length) output.push({ eventId: hashText(JSON.stringify(payload)), payload });
  return output;
}


function whatsappAttachment(message) {
  const type = String(message?.type || "").toLowerCase();
  const media = ["image", "audio", "video", "document", "sticker"].includes(type) ? message?.[type] : null;
  if (!media) return null;
  return {
    hasAttachment: true,
    type,
    mediaId: String(media?.id || "").trim(),
    mimeType: String(media?.mime_type || media?.mimeType || "").trim(),
    fileName: String(media?.filename || media?.fileName || media?.name || "").trim(),
    caption: String(media?.caption || "").trim(),
    whatsappMediaUrl: String(media?.url || media?.link || media?.href || "").trim(),
    sha256: String(media?.sha256 || "").trim(),
  };
}

async function enrichWhatsappMediaPayload(payload, env) {
  const value = payload?.entry?.[0]?.changes?.[0]?.value || {};
  const message = value?.messages?.[0] || {};
  const attachment = whatsappAttachment(message);
  if (!attachment) return payload;

  const phone = normalizePhone(message?.from || value?.contacts?.[0]?.wa_id || payload?.waId || payload?.phone || "");
  const resolved = await resolveMersalIncomingMedia(env, {
    phone,
    messageId: String(message?.id || payload?.messageId || payload?.message_id || "").trim(),
    mediaId: attachment.mediaId,
    type: attachment.type,
  });

  const mediaUrl = resolved?.url || normalizeMersalMediaUrl(attachment.whatsappMediaUrl);
  return {
    ...payload,
    hasAttachment: true,
    attachmentType: resolved?.attachmentType || attachment.type,
    mediaType: resolved?.attachmentType || attachment.type,
    mediaId: attachment.mediaId,
    mimeType: attachment.mimeType || resolved?.mimeType || guessMimeType(mediaUrl, attachment.type),
    fileName: attachment.fileName || resolved?.fileName || fileNameFromUrl(mediaUrl) || buildMediaFileName(attachment.type, attachment.mediaId, attachment.mimeType),
    caption: attachment.caption,
    sha256: attachment.sha256,
    whatsappMediaUrl: attachment.whatsappMediaUrl,
    mersalMediaResolved: Boolean(resolved?.url),
    mersalMediaError: resolved?.url ? "" : resolved?.error || "mersal media not found",
    mersalMessageId: resolved?.mersalMessageId || "",
    mersalContactId: resolved?.contactId || "",
    mersalMediaUrl: resolved?.url || "",
    mediaUrl,
    fileUrl: mediaUrl,
    attachmentUrl: mediaUrl,
  };
}

async function resolveMersalIncomingMedia(env, { phone, messageId, mediaId, type }) {
  const token = String(env.MERSAL_API_TOKEN || "").trim();
  if (!token) return { ok: false, error: "MERSAL_API_TOKEN is not configured" };
  if (!phone) return { ok: false, error: "WhatsApp phone is missing" };
  const contactId = await mersalFindContactId(env, token, phone);
  if (!contactId) return { ok: false, error: "Mersal contact_id was not found" };

  const attempts = [0, 900, 1600, 2500, 3500];
  let messagesChecked = 0;
  for (const delay of attempts) {
    if (delay) await sleep(delay);
    const response = await mersalGetMessages(env, token, contactId);
    const messages = normalizeMersalRows(response);
    messagesChecked = messages.length;
    const found = findMersalMedia(messages, { messageId, mediaId, type, contactId });
    if (found?.url) return { ok: true, contactId, ...found };
  }
  return { ok: false, contactId, messagesChecked, error: "Mersal media URL was not found" };
}

async function mersalFindContactId(env, token, phone) {
  const response = await mersalPost(env, `${mersalBaseUrl(env)}/api/wpbox/getConversations/none?mobile_api=true`, { token });
  const rows = Array.isArray(response?.data) ? response.data : [];
  const normalized = normalizePhone(phone);
  const found = rows.find((row) => {
    const rowPhone = normalizePhone(row?.phone || row?.name || "");
    return rowPhone === normalized || (rowPhone && normalized && rowPhone.endsWith(normalized.slice(-9)));
  });
  return String(found?.id || found?.contact_id || "").trim();
}

async function mersalGetMessages(env, token, contactId) {
  return mersalPost(env, `${mersalBaseUrl(env)}/api/wpbox/getMessages`, { token, contact_id: contactId });
}

function mersalBaseUrl(env) {
  return String(env.MERSAL_API_ENDPOINT || "https://w-mersal.com").replace(/\/+$/, "");
}

async function mersalPost(env, url, body) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const data = parseJson(await response.text());
    if (response.ok && !isMersalInvalidToken(data)) return data;
  } catch {}

  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body || {})) form.set(key, String(value ?? ""));
  const response = await fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  return parseJson(await response.text());
}

function isMersalInvalidToken(data) {
  return String(data?.status || "").toLowerCase() === "error" && String(data?.message || data?.errMsg || "").toLowerCase().includes("invalid token");
}

function normalizeMersalRows(payload) {
  const rows = Array.isArray(payload) ? payload
    : Array.isArray(payload?.data) ? payload.data
      : Array.isArray(payload?.messages) ? payload.messages
        : Array.isArray(payload?.data?.messages) ? payload.data.messages
          : Array.isArray(payload?.data?.data) ? payload.data.data : [];
  return [...rows].sort((left, right) => timestampMs(right?.created_at || right?.createdAt || right?.updated_at || right?.updatedAt || right?.timestamp) - timestampMs(left?.created_at || left?.createdAt || left?.updated_at || left?.updatedAt || left?.timestamp));
}

function findMersalMedia(rows, { messageId, mediaId, type, contactId }) {
  if (messageId) {
    const exact = rows.find((row) => String(row?.fb_message_id || row?.message_wamid || row?.wamid || row?.message_id || "").trim() === messageId);
    const media = mersalMediaFromRow(exact, contactId);
    if (media?.url) return media;
  }
  if (mediaId) {
    const match = rows.map((row) => mersalMediaFromRow(row, contactId)).find((media) => media?.url && (String(media.url).includes(mediaId) || String(media.fileName || "").includes(mediaId)));
    if (match?.url) return match;
  }
  const inbound = rows
    .filter((row) => Number(row?.is_message_by_contact || row?.isMessageByContact || 0) === 1)
    .map((row) => mersalMediaFromRow(row, contactId))
    .filter((media) => media?.url);
  const wanted = normalizeMediaType(type);
  return inbound.find((media) => normalizeMediaType(media.attachmentType) === wanted) || inbound[0] || null;
}

function mersalMediaFromRow(row, contactId) {
  if (!row) return null;
  const candidates = [
    [row?.header_image || row?.image || row?.image_url || row?.media_image, "image"],
    [row?.header_audio || row?.audio || row?.audio_url || row?.voice || row?.voice_url || row?.media_audio, "audio"],
    [row?.header_video || row?.video || row?.video_url || row?.media_video, "video"],
    [row?.header_document || row?.document || row?.document_url || row?.file || row?.file_url || row?.media_document, "document"],
  ];
  const selected = candidates.find(([url]) => String(url || "").trim());
  if (!selected) return null;
  const url = normalizeMersalMediaUrl(selected[0]);
  if (!url) return null;
  return {
    url,
    attachmentType: selected[1],
    mersalMessageId: String(row?.id || ""),
    contactId: String(contactId || row?.contact_id || ""),
    mimeType: guessMimeType(url, selected[1]),
    fileName: fileNameFromUrl(url),
  };
}

function normalizeMersalMediaUrl(value) {
  let url = String(value || "").trim().replace(/\\\//g, "/").replace(/&amp;/g, "&");
  if (!url || /lookaside\.fbsbx\.com\/whatsapp_business\/attachments/i.test(url)) return "";
  if (url.startsWith("//")) url = `https:${url}`;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return `https://w-mersal.com${url}`;
  if (/^(uploads?|storage|media|files?)\//i.test(url)) return `https://w-mersal.com/${url.replace(/^\/+/, "")}`;
  if (/^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(url)) return `https://${url}`;
  return "";
}

function normalizeMediaType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (["photo", "picture"].includes(type)) return "image";
  if (["voice", "ptt"].includes(type)) return "audio";
  if (type === "file") return "document";
  return type;
}

function fileNameFromUrl(url) {
  try {
    return decodeURIComponent(new URL(String(url || "")).pathname.split("/").pop() || "");
  } catch {
    return "";
  }
}

function buildMediaFileName(type, mediaId, mimeType) {
  const extension = extensionFromMime(mimeType, type);
  const safeType = String(type || "media").replace(/[^\w.-]/g, "") || "media";
  const safeId = String(mediaId || Date.now()).replace(/[^\w.-]/g, "").slice(0, 40);
  return `${safeType}-${safeId}${extension}`;
}

function extensionFromMime(mimeType, type) {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("pdf")) return ".pdf";
  if (mime.includes("mp4")) return ".mp4";
  if (mime.includes("mpeg")) return ".mp3";
  if (mime.includes("ogg") || mime.includes("opus")) return ".ogg";
  if (mime.includes("wav")) return ".wav";
  if (mime.includes("aac")) return ".aac";
  if (type === "image") return ".jpg";
  if (type === "audio") return ".mp3";
  if (type === "video") return ".mp4";
  if (type === "sticker") return ".webp";
  return ".bin";
}

function guessMimeType(url, type) {
  const value = String(url || "").toLowerCase().split(/[?#]/)[0];
  if (/\.jpe?g$/.test(value)) return "image/jpeg";
  if (/\.png$/.test(value)) return "image/png";
  if (/\.webp$/.test(value)) return "image/webp";
  if (/\.gif$/.test(value)) return "image/gif";
  if (/\.mp3$/.test(value)) return "audio/mpeg";
  if (/\.(ogg|opus)$/.test(value)) return "audio/ogg";
  if (/\.wav$/.test(value)) return "audio/wav";
  if (/\.aac$/.test(value)) return "audio/aac";
  if (/\.mp4$/.test(value)) return "video/mp4";
  if (/\.pdf$/.test(value)) return "application/pdf";
  const normalized = normalizeMediaType(type);
  if (normalized === "image" || normalized === "sticker") return normalized === "sticker" ? "image/webp" : "image/jpeg";
  if (normalized === "audio") return "audio/mpeg";
  if (normalized === "video") return "video/mp4";
  return "application/octet-stream";
}

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function sendOutbound(source, payload, env) {
  if (source === "instagram") return responseFromResult(await sendManyChat(payload, env.MANYCHAT_INSTAGRAM_TOKEN || env.MANYCHAT_API_TOKEN));
  if (source === "facebook") {
    const manychat = await sendManyChat(payload, env.MANYCHAT_FACEBOOK_TOKEN || env.MANYCHAT_API_TOKEN);
    if (manychat.ok) return responseFromResult(manychat);
    return responseFromResult(await sendFacebookGraph(payload, env.FB_PAGE_ACCESS_TOKEN));
  }
  if (source === "tiktok") return responseFromResult(await sendTikTok(payload, env));
  if (source === "whatsapp") return responseFromResult(await sendMersal(payload, env));
  return json({ ok: false, error: "Unknown send source" }, 400);
}

async function sendManyChat(payload, token) {
  const subscriberId = String(payload?.participantId || payload?.subscriber_id || payload?.subscriberId || "").trim();
  const text = String(payload?.message || payload?.text || "").trim();
  if (!subscriberId || !text) return { ok: false, error: "participantId and message are required" };
  if (!token) return { ok: false, error: "ManyChat token is not configured" };
  const response = await fetch("https://api.manychat.com/fb/sending/sendContent", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ subscriber_id: subscriberId, data: { version: "v2", content: { messages: [{ type: "text", text }] } } }),
  });
  return providerResult(response, "manychat");
}

async function sendFacebookGraph(payload, token) {
  const participantId = String(payload?.participantId || "").trim();
  const text = String(payload?.message || payload?.text || "").trim();
  if (!participantId || !text) return { ok: false, error: "participantId and message are required" };
  if (!token) return { ok: false, error: "FB_PAGE_ACCESS_TOKEN is not configured" };
  const response = await fetch(`https://graph.facebook.com/v20.0/me/messages?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient: { id: participantId }, message: { text } }),
  });
  return providerResult(response, "facebook_graph");
}

async function sendTikTok(payload, env) {
  const subscriberId = String(payload?.participantId || payload?.subscriber_id || payload?.subscriberId || "").trim();
  const text = String(payload?.message || payload?.text || "").trim();
  const token = env.MANYCHAT_TIKTOK_TOKEN || env.MANYCHAT_API_KEY;
  const fieldId = Number(env.MANYCHAT_MESSAGE_FIELD_ID);
  const tagId = Number(env.MANYCHAT_TRIGGER_TAG_ID);
  if (!subscriberId || !text) return { ok: false, error: "participantId and message are required" };
  if (!token || !fieldId || !tagId) return { ok: false, error: "TikTok ManyChat settings are not configured" };
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
  return { ok: result.ok, status: result.httpStatus, response: result.raw };
}

async function sendMersal(payload, env) {
  const phone = normalizePhone(payload?.phone || payload?.waId || "");
  if (!phone) return { ok: false, error: "Valid phone is required" };
  const token = env.WA_TOKEN || env.MERSAL_TOKEN || env.MERSAL_API_TOKEN || "";
  if (!token) return { ok: false, error: "Mersal token is not configured" };
  const base = String(env.MERSAL_API_ENDPOINT || "https://w-mersal.com").replace(/\/$/, "");
  const templateName = String(payload?.templateName || payload?.template_name || "").trim();
  const isTemplate = Boolean(templateName);
  const url = isTemplate
    ? env.MERSAL_TEMPLATE_URL || `${base}/api/wpbox/sendtemplatemessage`
    : env.MERSAL_SEND_URL || `${base}/api/wpbox/sendmessage`;
  const body = isTemplate
    ? { token, phone, template_name: templateName, template_language: payload?.templateLanguage || payload?.template_language || "ar", components: payload?.components || [] }
    : { token, phone, message: String(payload?.message || payload?.text || "") };
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return providerResult(response, "mersal");
}

async function providerResult(response, provider) {
  const text = await response.text();
  let raw = text;
  try { raw = text ? JSON.parse(text) : {}; } catch {}
  return { ok: response.ok && raw?.ok !== false, provider, httpStatus: response.status, raw, error: response.ok ? "" : raw?.error || `HTTP ${response.status}` };
}

function responseFromResult(result) {
  return json(result, result.ok ? 200 : 502);
}

function aggregateResponse(source, results) {
  const ok = results.every((item) => item.status >= 200 && item.status < 300);
  return json({
    ok,
    source,
    count: results.length,
    results: results.map((item) => ({ status: item.status, response: parseJson(item.body) })),
  }, ok ? 202 : 502);
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
  let phone = String(value || "").replace(/\D/g, "");
  if (/^05\d{8}$/.test(phone)) phone = `966${phone.slice(1)}`;
  if (/^5\d{8}$/.test(phone)) phone = `966${phone}`;
  return /^9665\d{8}$/.test(phone) ? phone : "";
}

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function parseJson(text) {
  if (text && typeof text === "object") return text;
  try { return JSON.parse(String(text || "{}")); } catch { return { raw: String(text || "") }; }
}

async function readJson(request) {
  return parseJson(await request.text());
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-webhook-secret,x-hub-signature-256,x-mzj-gateway-secret",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() },
  });
}
