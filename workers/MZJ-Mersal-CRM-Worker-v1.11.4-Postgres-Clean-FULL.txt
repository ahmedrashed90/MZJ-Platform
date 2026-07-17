const VERSION = "mzj-mersal-postgres-v1.11.4";

const ACCEPTED_PROVIDER_STATUSES = new Set(["success", "sent", "delivered", "queued", "accepted", "submitted", "processing"]);
const FAILED_PROVIDER_STATUSES = new Set(["error", "failed", "failure", "rejected", "invalid"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return json({
        ok: true,
        service: "mersal-crm",
        version: VERSION,
        storage: "postgresql",
        routes: ["/send/mersal", "/webhook/mersal", "/templates/mersal"],
      });
    }

    if (request.method === "GET" && url.pathname === "/debug/last") {
      const record = await readDebugRecord(env);
      return json(record || { ok: true, note: "no webhook payload recorded" });
    }

    if (request.method === "POST" && url.pathname === "/send/mersal") {
      if (!authorizedPlatformRequest(request, env)) {
        return json({ ok: false, status: "failed", error: "Unauthorized platform request", version: VERSION }, 401);
      }
      const body = await readJson(request);
      return handleOutbound(body, env);
    }

    if (request.method === "POST" && url.pathname === "/templates/mersal") {
      if (!authorizedPlatformRequest(request, env)) {
        return json({ ok: false, error: "Unauthorized platform request", version: VERSION }, 401);
      }
      return handleTemplates(env);
    }

    if (request.method === "POST" && url.pathname === "/webhook/mersal") {
      const payload = await readJson(request);
      await writeDebugRecord(env, payload);
      return handleInbound(payload, env);
    }

    return json({ ok: false, error: "Not found", version: VERSION }, 404);
  },
};

async function handleOutbound(body, env) {
  const phone = normalizePhone(body?.phone);
  if (!phone) return json({ ok: false, status: "failed", error: "Valid phone is required", version: VERSION }, 400);

  const templateName = clean(body?.template_name);
  const mediaUrl = clean(body?.mediaUrl);
  const text = clean(body?.text);

  let result;
  let messageType;

  if (templateName) {
    messageType = "template";
    result = await sendTemplate(env, {
      phone,
      templateName,
      language: clean(body?.template_language) || "ar",
      components: Array.isArray(body?.components) ? body.components : [],
    });
  } else if (mediaUrl) {
    messageType = normalizeMediaType(body?.mediaType);
    result = await sendMedia(env, {
      phone,
      mediaUrl,
      mediaType: messageType,
      caption: clean(body?.caption || body?.text),
      fileName: clean(body?.fileName),
    });
  } else {
    if (!text) return json({ ok: false, status: "failed", error: "Message text is required", version: VERSION }, 400);
    messageType = "text";
    result = await sendText(env, { phone, message: text });
  }

  return json({
    ...result,
    provider: "mersal",
    providerStatus: result.ok ? "sent" : "failed",
    messageType,
    phone,
    version: VERSION,
  }, result.ok ? 200 : 502);
}

async function sendText(env, input) {
  const token = required(env.MERSAL_TOKEN, "MERSAL_TOKEN");
  const url = requiredUrl(env.MERSAL_SEND_URL, "MERSAL_SEND_URL");
  return postMersal(url, { token, phone: input.phone, message: input.message });
}

async function sendTemplate(env, input) {
  const token = required(env.MERSAL_TOKEN, "MERSAL_TOKEN");
  const url = requiredUrl(env.MERSAL_TEMPLATE_URL, "MERSAL_TEMPLATE_URL");
  const payload = {
    token,
    phone: input.phone,
    template_name: input.templateName,
    template_language: input.language,
  };
  if (input.components.length) payload.components = input.components;
  return postMersal(url, payload);
}

async function sendMedia(env, input) {
  const token = required(env.MERSAL_TOKEN, "MERSAL_TOKEN");
  const url = requiredUrl(env.MERSAL_MEDIA_SEND_URL, "MERSAL_MEDIA_SEND_URL");
  const payload = {
    token,
    phone: input.phone,
    type: input.mediaType,
    media_url: input.mediaUrl,
  };
  if (input.caption) payload.caption = input.caption;
  if (input.mediaType === "document" && input.fileName) payload.filename = input.fileName;
  return postMersal(url, payload);
}

async function postMersal(url, payload) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const rawText = await response.text();
    const raw = parseJson(rawText);
    const result = normalizeProviderResult(response.status, response.ok, raw, rawText);
    return { ...result, raw };
  } catch (error) {
    return { ok: false, status: "failed", error: errorMessage(error), httpStatus: 0, raw: null };
  }
}

function normalizeProviderResult(httpStatus, httpOk, raw, rawText) {
  const status = clean(raw?.status || raw?.data?.status || raw?.provider_status).toLowerCase();
  const providerMessageId = first(
    raw?.message_wamid,
    raw?.message_id,
    raw?.wamid,
    raw?.id,
    raw?.data?.message_wamid,
    raw?.data?.message_id,
    raw?.data?.wamid,
    raw?.data?.id,
  );

  const explicitSuccess = Boolean(providerMessageId)
    || raw?.ok === true
    || raw?.success === true
    || ACCEPTED_PROVIDER_STATUSES.has(status);
  const explicitFailure = raw?.ok === false
    || raw?.success === false
    || FAILED_PROVIDER_STATUSES.has(status);

  const ok = explicitSuccess || (httpOk && !explicitFailure);
  return {
    ok,
    status: ok ? "sent" : "failed",
    httpStatus,
    providerMessageId,
    error: ok ? "" : first(raw?.error, raw?.message, raw?.data?.error, raw?.data?.message, rawText, `HTTP ${httpStatus}`),
  };
}

async function handleInbound(incoming, env) {
  let events;
  try {
    events = extractInboundEvents(incoming);
  } catch (error) {
    return json({ ok: false, error: errorMessage(error), version: VERSION }, 400);
  }

  if (!events.length) {
    return json({ ok: true, accepted: true, processed: 0, ignored: "no inbound messages", version: VERSION }, 200);
  }

  const results = [];
  for (const event of events) {
    try {
      const enriched = await enrichInboundEvent(event, env);
      const forwarded = await forwardInboundToPlatform(enriched, env);
      results.push({ eventId: enriched.eventId, ok: true, platformStatus: forwarded.status });
    } catch (error) {
      results.push({ eventId: event.eventId, ok: false, error: errorMessage(error) });
    }
  }

  const ok = results.every((result) => result.ok);
  return json({ ok, accepted: ok, processed: results.filter((result) => result.ok).length, results, version: VERSION }, ok ? 200 : 502);
}

function extractInboundEvents(incoming) {
  const output = [];
  const entries = Array.isArray(incoming?.entry) ? incoming.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
      const messages = Array.isArray(value?.messages) ? value.messages : [];

      for (const message of messages) {
        const contact = contacts.find((item) => normalizePhone(item?.wa_id) === normalizePhone(message?.from)) || contacts[0] || {};
        const phone = normalizePhone(message?.from || contact?.wa_id);
        const eventId = clean(message?.id);
        if (!phone) throw new Error("Inbound WhatsApp phone is missing");
        if (!eventId) throw new Error(`Inbound WhatsApp message ID is missing for ${phone}`);

        const messageType = normalizeMediaType(message?.type || "text");
        const attachment = extractAttachment(message, messageType);
        output.push({
          eventId,
          phone,
          displayName: first(contact?.profile?.name, "عميل"),
          timestamp: message?.timestamp || Date.now(),
          messageType,
          text: extractText(message),
          attachment,
        });
      }
    }
  }

  return output;
}

function extractText(message) {
  return first(
    message?.text?.body,
    message?.button?.text,
    message?.interactive?.button_reply?.title,
    message?.interactive?.list_reply?.title,
    message?.image?.caption,
    message?.video?.caption,
    message?.document?.caption,
  );
}

function extractAttachment(message, type) {
  if (!["image", "audio", "video", "document", "sticker"].includes(type)) return null;
  const media = message?.[type] || {};
  const mediaId = clean(media?.id);
  const mimeType = clean(media?.mime_type);
  const directUrl = clean(media?.url);
  return {
    hasAttachment: true,
    attachmentType: type,
    mediaId,
    mediaUrl: directUrl,
    fileName: clean(media?.filename) || buildMediaFileName(type, mediaId, mimeType),
    mimeType,
    caption: clean(media?.caption),
  };
}

async function enrichInboundEvent(event, env) {
  let attachment = event.attachment;

  if (attachment?.hasAttachment) {
    const directUrl = normalizeMediaUrl(attachment.mediaUrl);
    if (directUrl && !isProtectedWhatsappMediaUrl(directUrl)) {
      attachment = { ...attachment, mediaUrl: directUrl };
    } else {
      const resolved = await resolveMersalMedia(event, env);
      attachment = { ...attachment, ...resolved };
    }

    if (!attachment.mediaUrl) throw new Error(`Mersal media URL was not resolved for ${event.eventId}`);
    attachment = { ...attachment, ...(await persistMediaToPlatform(event, attachment, env)) };
  }

  const text = event.text || attachment?.caption || (attachment ? attachmentLabel(attachment.attachmentType) : "");
  return {
    eventId: event.eventId,
    type: "incoming_message",
    direction: "in",
    senderType: "customer",
    provider: "mersal",
    platform: "whatsapp",
    channel: "whatsapp",
    waId: event.phone,
    phone: event.phone,
    participantId: event.phone,
    conversationId: event.phone,
    customerName: event.displayName,
    messageId: event.eventId,
    providerMessageId: event.eventId,
    text,
    message: text,
    messageType: attachment?.attachmentType || event.messageType,
    timestamp: event.timestamp,
    hasAttachment: Boolean(attachment),
    attachmentType: attachment?.attachmentType || "",
    mediaType: attachment?.attachmentType || "",
    storageKey: attachment?.storageKey || "",
    fileName: attachment?.fileName || "",
    mimeType: attachment?.mimeType || "",
    fileSize: attachment?.fileSize || null,
    caption: attachment?.caption || "",
    mediaId: attachment?.mediaId || "",
  };
}

async function resolveMersalMedia(event, env) {
  const token = required(env.MERSAL_API_TOKEN, "MERSAL_API_TOKEN");
  const conversationsUrl = requiredUrl(env.MERSAL_CONVERSATIONS_URL, "MERSAL_CONVERSATIONS_URL");
  const messagesUrl = requiredUrl(env.MERSAL_MESSAGES_URL, "MERSAL_MESSAGES_URL");

  const conversations = await postMersalForm(conversationsUrl, { token });
  const rows = Array.isArray(conversations?.data) ? conversations.data : [];
  const contact = rows.find((row) => samePhone(row?.phone || row?.name || row?.mobile, event.phone));
  const contactId = first(contact?.id, contact?.contact_id);
  if (!contactId) throw new Error(`Mersal contact was not found for ${event.phone}`);

  for (const delay of [0, 800, 1600, 2600]) {
    if (delay) await sleep(delay);
    const messagesPayload = await postMersalForm(messagesUrl, { token, contact_id: contactId });
    const messages = normalizeMersalRows(messagesPayload);
    const row = messages.find((candidate) => [candidate?.fb_message_id, candidate?.message_wamid, candidate?.wamid, candidate?.message_id, candidate?.id]
      .map(clean)
      .includes(event.eventId));
    if (!row) continue;
    const media = mediaFromMersalRow(row);
    if (media.mediaUrl) return media;
  }

  throw new Error(`Mersal media was not ready for ${event.eventId}`);
}

async function postMersalForm(url, body) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) form.set(key, String(value ?? ""));
  const response = await fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const text = await response.text();
  const payload = parseJson(text);
  if (!response.ok) throw new Error(first(payload?.error, payload?.message, text, `HTTP ${response.status}`));
  return payload;
}

function normalizeMersalRows(payload) {
  const rows = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.messages)
      ? payload.messages
      : Array.isArray(payload?.data?.messages)
        ? payload.data.messages
        : [];
  return rows.slice().sort((left, right) => timestampMs(right?.created_at || right?.timestamp) - timestampMs(left?.created_at || left?.timestamp));
}

function mediaFromMersalRow(row) {
  const fields = [
    ["image", row?.header_image],
    ["audio", row?.header_audio],
    ["video", row?.header_video],
    ["document", row?.header_document],
  ];
  const found = fields.find(([, value]) => clean(value));
  if (!found) return { mediaUrl: "" };
  const [attachmentType, value] = found;
  const mediaUrl = normalizeMediaUrl(value);
  const mimeType = first(row?.mime_type, guessMimeType(mediaUrl, attachmentType));
  return {
    hasAttachment: true,
    attachmentType,
    mediaUrl,
    fileName: first(row?.filename, row?.file_name, fileNameFromUrl(mediaUrl), buildMediaFileName(attachmentType, row?.id, mimeType)),
    mimeType,
    caption: first(row?.caption),
  };
}

async function persistMediaToPlatform(event, attachment, env) {
  const mediaEndpoint = requiredUrl(env.MZJ_PLATFORM_MEDIA_URL, "MZJ_PLATFORM_MEDIA_URL");
  const secret = required(env.MZJ_GATEWAY_SECRET, "MZJ_GATEWAY_SECRET");
  const mediaResponse = await fetch(attachment.mediaUrl);
  if (!mediaResponse.ok) throw new Error(`Unable to download Mersal media: HTTP ${mediaResponse.status}`);

  const bytes = await mediaResponse.arrayBuffer();
  if (bytes.byteLength > 50 * 1024 * 1024) throw new Error("Inbound media exceeds 50 MB");
  const mimeType = attachment.mimeType || mediaResponse.headers.get("content-type") || guessMimeType(attachment.mediaUrl, attachment.attachmentType);
  const fileName = attachment.fileName || buildMediaFileName(attachment.attachmentType, event.eventId, mimeType);

  const preparedResponse = await fetch(mediaEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mzj-gateway-secret": secret },
    body: JSON.stringify({
      action: "prepare_upload",
      source: "whatsapp",
      eventKey: event.eventId,
      conversationId: event.phone,
      fileName,
      mimeType,
      fileSize: bytes.byteLength,
      mediaType: attachment.attachmentType,
      isSensitive: true,
    }),
  });
  const preparedText = await preparedResponse.text();
  const prepared = parseJson(preparedText);
  if (!preparedResponse.ok || prepared?.ok !== true || !prepared?.uploadUrl || !prepared?.storageKey) {
    throw new Error(first(prepared?.error, preparedText, `Platform media preparation failed: HTTP ${preparedResponse.status}`));
  }

  const uploadResponse = await fetch(prepared.uploadUrl, {
    method: "PUT",
    headers: { "content-type": mimeType },
    body: bytes,
  });
  if (!uploadResponse.ok) throw new Error(`R2 media upload failed: HTTP ${uploadResponse.status}`);

  return { storageKey: prepared.storageKey, fileName, mimeType, fileSize: bytes.byteLength };
}

async function forwardInboundToPlatform(event, env) {
  const url = requiredUrl(env.MZJ_PLATFORM_INBOUND_URL, "MZJ_PLATFORM_INBOUND_URL");
  const secret = required(env.MZJ_GATEWAY_SECRET, "MZJ_GATEWAY_SECRET");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-mzj-source": "whatsapp",
      "x-mzj-gateway-secret": secret,
      "x-event-id": event.eventId,
    },
    body: JSON.stringify(event),
  });
  const text = await response.text();
  const payload = parseJson(text);
  if (!response.ok || payload?.ok !== true) {
    throw new Error(first(payload?.error, text, `Platform inbound failed: HTTP ${response.status}`));
  }
  return { status: response.status, payload };
}

async function handleTemplates(env) {
  const token = required(env.MERSAL_API_TOKEN, "MERSAL_API_TOKEN");
  const baseUrl = requiredUrl(env.MERSAL_TEMPLATES_URL, "MERSAL_TEMPLATES_URL");
  const url = new URL(baseUrl);
  url.searchParams.set("token", token);
  const response = await fetch(url.toString(), { method: "GET", headers: { accept: "application/json" } });
  const text = await response.text();
  const payload = parseJson(text);
  const status = clean(payload?.status).toLowerCase();
  if (!response.ok || payload?.ok === false || FAILED_PROVIDER_STATUSES.has(status)) {
    return json({ ok: false, error: first(payload?.error, payload?.message, text, `HTTP ${response.status}`), raw: payload, version: VERSION }, 502);
  }
  const templates = Array.isArray(payload?.templates) ? payload.templates : [];
  return json({ ok: true, source: "mersal", count: templates.length, templates, version: VERSION });
}

function authorizedPlatformRequest(request, env) {
  const configured = clean(env.MZJ_GATEWAY_SECRET);
  const provided = clean(request.headers.get("x-mzj-gateway-secret"));
  return configured && provided && safeEquals(configured, provided);
}

function required(value, name) {
  const text = clean(value);
  if (!text) throw new Error(`${name} is not configured`);
  return text;
}

function requiredUrl(value, name) {
  const text = required(value, name);
  try {
    const url = new URL(text);
    if (!/^https?:$/.test(url.protocol)) throw new Error("invalid protocol");
    return url.toString();
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
}

function samePhone(left, right) {
  const a = normalizePhone(left);
  const b = normalizePhone(right);
  return Boolean(a && b && (a === b || (a.length >= 9 && b.length >= 9 && a.slice(-9) === b.slice(-9))));
}

function normalizePhone(value) {
  let digits = arabicDigitsToEnglish(String(value ?? "")).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("05") && digits.length === 10) digits = `966${digits.slice(1)}`;
  if (digits.startsWith("5") && digits.length === 9) digits = `966${digits}`;
  return digits;
}

function normalizeMediaType(value) {
  const type = clean(value).toLowerCase();
  if (type === "text") return "text";
  if (type === "voice" || type === "ptt") return "audio";
  if (type === "file") return "document";
  return ["image", "audio", "video", "document", "sticker"].includes(type) ? type : "document";
}

function normalizeMediaUrl(value) {
  let url = clean(value).replace(/\\\//g, "/").replace(/&amp;/gi, "&");
  if (!url) return "";
  if (url.startsWith("//")) url = `https:${url}`;
  if (url.startsWith("/")) url = `https://w-mersal.com${url}`;
  if (!/^https?:\/\//i.test(url)) return "";
  return url;
}

function isProtectedWhatsappMediaUrl(url) {
  return /lookaside\.fbsbx\.com\/whatsapp_business\/attachments/i.test(clean(url));
}

function attachmentLabel(type) {
  if (type === "image") return "صورة من العميل";
  if (type === "audio") return "رسالة صوتية من العميل";
  if (type === "video") return "فيديو من العميل";
  if (type === "document") return "ملف من العميل";
  if (type === "sticker") return "ملصق من العميل";
  return "مرفق من العميل";
}

function buildMediaFileName(type, id, mimeType) {
  const safeType = clean(type).replace(/[^a-z0-9_-]/gi, "") || "media";
  const safeId = clean(id).replace(/[^a-z0-9_.-]/gi, "").slice(0, 48) || String(Date.now());
  return `${safeType}-${safeId}${extensionFromMime(mimeType, type)}`;
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
  if (mime.includes("aac")) return ".aac";
  if (mime.includes("wordprocessingml")) return ".docx";
  if (mime.includes("spreadsheetml")) return ".xlsx";
  if (type === "image") return ".jpg";
  if (type === "audio") return ".mp3";
  if (type === "video") return ".mp4";
  if (type === "sticker") return ".webp";
  return ".bin";
}

function guessMimeType(url, type) {
  const path = clean(url).toLowerCase().split("?")[0];
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".mp3")) return "audio/mpeg";
  if (path.endsWith(".ogg") || path.endsWith(".opus")) return "audio/ogg";
  if (path.endsWith(".wav")) return "audio/wav";
  if (path.endsWith(".aac")) return "audio/aac";
  if (path.endsWith(".mp4")) return "video/mp4";
  if (path.endsWith(".pdf")) return "application/pdf";
  if (type === "image") return "image/jpeg";
  if (type === "audio") return "audio/mpeg";
  if (type === "video") return "video/mp4";
  if (type === "sticker") return "image/webp";
  return "application/octet-stream";
}

function fileNameFromUrl(value) {
  try {
    return decodeURIComponent(new URL(value).pathname.split("/").pop() || "");
  } catch {
    return "";
  }
}

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const text = clean(value);
  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeEquals(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function first(...values) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return "";
}

function clean(value) {
  return String(value ?? "").trim();
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: String(text || "") };
  }
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

function arabicDigitsToEnglish(value) {
  const map = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9" };
  return String(value || "").replace(/[٠-٩۰-۹]/g, (digit) => map[digit] ?? digit);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function writeDebugRecord(env, payload) {
  try {
    if (env.DEBUG_KV) await env.DEBUG_KV.put("DEBUG_LAST_PAYLOAD", JSON.stringify({ receivedAt: new Date().toISOString(), payload }), { expirationTtl: 86400 });
  } catch {}
}

async function readDebugRecord(env) {
  try {
    if (!env.DEBUG_KV) return null;
    const value = await env.DEBUG_KV.get("DEBUG_LAST_PAYLOAD");
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-mzj-gateway-secret",
    "cache-control": "no-store",
  };
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders(), "content-type": "application/json; charset=utf-8" },
  });
}
