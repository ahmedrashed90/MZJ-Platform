const VERSION = "mersal-crm-postgres-v32";
const DEFAULT_PLATFORM_INBOUND_URL = "https://mzj-platform.vercel.app/api/integrations/whatsapp";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true, service: "mersal-crm", version: VERSION, database: "platform-postgresql" });
    }

    if (request.method === "POST" && url.pathname === "/send/mersal") {
      return handleSendMersal(await safeJson(request), env);
    }

    if (request.method === "POST" && url.pathname === "/webhook/mersal") {
      try {
        return await handleWebhook(await safeJson(request), env);
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error), version: VERSION }, 502);
      }
    }

    return json({ ok: false, error: "Not Found", version: VERSION }, 404);
  },
};

async function handleSendMersal(body, env) {
  const phone = normalizePhone(body?.waId || body?.phone || "");
  if (!phone) return json({ ok: false, error: "missing waId/phone", version: VERSION }, 400);

  const templateName = clean(body?.template_name || body?.templateName || body?.template?.name);
  if (templateName) {
    const language = clean(body?.template_language || body?.templateLang || body?.template?.lang) || "ar";
    let components = Array.isArray(body?.components) ? body.components : null;
    if (!components) {
      const params = Array.isArray(body?.params)
        ? body.params
        : Array.isArray(body?.parameters)
          ? body.parameters
          : Array.isArray(body?.template?.params)
            ? body.template.params
            : [];
      components = paramsToComponents(params);
    }
    const result = await sendTemplate(env, { phone, templateName, language, components });
    return json(result, result.ok ? 200 : 502);
  }

  const message = clean(body?.text || body?.message);
  if (!message) return json({ ok: false, error: "missing text/message", version: VERSION }, 400);
  const result = await sendText(env, { phone, message, buttons: body?.buttons, header: body?.header, footer: body?.footer });
  return json(result, result.ok ? 200 : 502);
}

async function sendText(env, { phone, message, buttons, header, footer }) {
  const token = clean(env?.WA_TOKEN || env?.MERSAL_TOKEN || env?.MERSAL_API_TOKEN);
  if (!token) return { ok: false, error: "Missing WA_TOKEN/MERSAL_TOKEN/MERSAL_API_TOKEN", version: VERSION };
  const base = clean(env?.MERSAL_API_ENDPOINT || "https://w-mersal.com").replace(/\/+$/, "");
  const usedUrl = clean(env?.MERSAL_SEND_URL) || `${base}/api/wpbox/sendmessage`;
  const payload = { token, phone: normalizePhone(phone), message: String(message || "") };
  if (Array.isArray(buttons) && buttons.length) {
    payload.buttons = buttons;
    if (header) payload.header = String(header);
    if (footer) payload.footer = String(footer);
  }
  return postMersal(usedUrl, payload, "text");
}

async function sendTemplate(env, { phone, templateName, language, components }) {
  const token = clean(env?.WA_TOKEN || env?.MERSAL_TOKEN || env?.MERSAL_API_TOKEN);
  if (!token) return { ok: false, error: "Missing WA_TOKEN/MERSAL_TOKEN/MERSAL_API_TOKEN", version: VERSION };
  const base = clean(env?.MERSAL_API_ENDPOINT || "https://w-mersal.com").replace(/\/+$/, "");
  const usedUrl = clean(env?.MERSAL_TEMPLATE_URL) || `${base}/api/wpbox/sendtemplatemessage`;
  const payload = {
    token,
    phone: normalizePhone(phone),
    template_name: String(templateName || ""),
    template_language: String(language || "ar"),
  };
  if (Array.isArray(components) && components.length) payload.components = components;
  return postMersal(usedUrl, payload, "template", { templateName, templateLanguage: language });
}

async function postMersal(usedUrl, payload, messageType, extra = {}) {
  try {
    const response = await fetch(usedUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const rawText = await response.text();
    let raw = rawText;
    try { raw = rawText ? JSON.parse(rawText) : {}; } catch {}
    const providerStatus = clean(raw?.status).toLowerCase();
    const providerError = clean(raw?.error || raw?.message);
    const ok = response.ok && providerStatus !== "error" && raw?.ok !== false;
    return {
      ok,
      service: "mzj-whatsapp-mersal",
      version: VERSION,
      provider: "mersal",
      messageType,
      phone: normalizePhone(payload.phone),
      httpStatus: response.status,
      status: providerStatus || (ok ? "success" : "error"),
      ...extra,
      raw,
      ...(ok ? {} : { error: providerError || `Mersal HTTP ${response.status}` }),
    };
  } catch (error) {
    return {
      ok: false,
      service: "mzj-whatsapp-mersal",
      version: VERSION,
      provider: "mersal",
      messageType,
      phone: normalizePhone(payload.phone),
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function handleWebhook(incoming, env) {
  const value = incoming?.entry?.[0]?.changes?.[0]?.value || incoming?.value || {};
  const message = value?.messages?.[0] || incoming?.messageObject || incoming?.message || {};
  const contact = value?.contacts?.[0] || incoming?.contact || {};
  const phone = normalizePhone(
    message?.from
      || contact?.wa_id
      || incoming?.waId
      || incoming?.phone
      || incoming?.participantId
      || incoming?.participant_id,
  );

  if (!phone) {
    return json({ ok: true, received: true, forwarded: false, note: "no WhatsApp phone found", version: VERSION });
  }

  const messageId = clean(
    message?.id
      || incoming?.messageId
      || incoming?.message_id
      || incoming?.providerMessageId
      || incoming?.provider_message_id,
  ) || `${phone}-${Date.now()}`;
  const messageType = normalizeMediaType(clean(message?.type || incoming?.messageType || incoming?.message_type || "text")) || "text";
  const createdAt = timestampIso(message?.timestamp || incoming?.createdAt || incoming?.created_at || incoming?.timestamp);
  const customerName = clean(contact?.profile?.name || incoming?.customerName || incoming?.displayName || incoming?.name) || "عميل";
  const attachment = extractMessageAttachment(message, incoming);

  if (attachment.hasAttachment && (!attachment.mediaUrl || isProtectedWhatsappMediaUrl(attachment.mediaUrl))) {
    const resolved = await resolveMersalMedia(env, {
      phone,
      providerMessageId: messageId,
      mediaId: attachment.mediaId,
      messageType,
    });
    if (resolved?.url) {
      attachment.mediaUrl = resolved.url;
      attachment.attachmentUrl = resolved.url;
      attachment.fileUrl = resolved.url;
      attachment.fileName = attachment.fileName || resolved.fileName || fileNameFromUrl(resolved.url);
      attachment.mimeType = attachment.mimeType || resolved.mimeType || guessMimeTypeFromUrl(resolved.url, messageType);
    } else if (isProtectedWhatsappMediaUrl(attachment.mediaUrl)) {
      attachment.mediaUrl = "";
      attachment.attachmentUrl = "";
      attachment.fileUrl = "";
    }
  }

  const text = extractMessageText(message)
    || clean(incoming?.text || incoming?.body || incoming?.customer_message)
    || attachment.caption
    || (attachment.hasAttachment ? attachment.fileName || attachmentLabel(messageType) : "");

  const normalized = {
    eventId: messageId,
    event: "message.received",
    provider: "mersal",
    direction: "in",
    senderType: "customer",
    phone,
    waId: phone,
    participantId: phone,
    conversationId: phone,
    convId: phone,
    providerMessageId: messageId,
    messageId,
    createdAt,
    customerName,
    displayName: customerName,
    text,
    message: text,
    messageType,
    hasAttachment: attachment.hasAttachment,
    mediaType: attachment.hasAttachment ? messageType : "",
    mediaId: attachment.mediaId,
    mediaUrl: attachment.mediaUrl,
    fileUrl: attachment.fileUrl,
    attachmentUrl: attachment.attachmentUrl,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    caption: attachment.caption,
    rawWebhook: incoming,
    entry: incoming?.entry,
  };

  const result = await forwardToPlatform(normalized, env);
  return json({ ok: true, received: true, forwarded: true, platformStatus: result.status, version: VERSION }, 200);
}

async function forwardToPlatform(payload, env) {
  const url = clean(env?.MZJ_PLATFORM_INBOUND_URL) || DEFAULT_PLATFORM_INBOUND_URL;
  const secret = clean(env?.MZJ_GATEWAY_SECRET);
  if (!secret) throw new Error("MZJ_GATEWAY_SECRET is missing in mersal-crm Worker");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mzj-gateway-secret": secret,
      "x-mzj-source": "whatsapp",
    },
    body: JSON.stringify(payload),
  });
  const rawText = await response.text();
  let data = rawText;
  try { data = rawText ? JSON.parse(rawText) : {}; } catch {}
  if (!response.ok) {
    const errorText = clean(data?.error || data?.message || rawText) || `Platform HTTP ${response.status}`;
    throw new Error(errorText);
  }
  return { status: response.status, data };
}

function extractMessageAttachment(message, incoming) {
  const type = normalizeMediaType(clean(message?.type || incoming?.messageType || incoming?.message_type));
  const media = message?.[type]
    || message?.[type === "document" ? "file" : type]
    || incoming?.media
    || incoming?.attachment
    || {};
  const hasAttachment = ["image", "audio", "video", "document", "sticker"].includes(type)
    || Boolean(incoming?.hasAttachment || incoming?.mediaUrl || incoming?.attachmentUrl || incoming?.fileUrl || media?.id || media?.url);
  if (!hasAttachment) {
    return { hasAttachment: false, mediaId: "", mediaUrl: "", fileUrl: "", attachmentUrl: "", fileName: "", mimeType: "", caption: "" };
  }
  const mediaId = clean(media?.id || incoming?.mediaId || incoming?.media_id);
  const mediaUrl = clean(media?.url || media?.link || media?.href || incoming?.mediaUrl || incoming?.media_url || incoming?.attachmentUrl || incoming?.attachment_url || incoming?.fileUrl || incoming?.file_url);
  const mimeType = clean(media?.mime_type || media?.mimeType || incoming?.mimeType || incoming?.mime_type) || guessMimeTypeFromUrl(mediaUrl, type);
  const fileName = clean(media?.filename || media?.fileName || media?.name || incoming?.fileName || incoming?.file_name) || buildMediaFileName(type, mediaId, mimeType);
  const caption = clean(media?.caption || incoming?.caption);
  return { hasAttachment: true, mediaId, mediaUrl, fileUrl: mediaUrl, attachmentUrl: mediaUrl, fileName, mimeType, caption };
}

async function resolveMersalMedia(env, { phone, providerMessageId, mediaId, messageType }) {
  const token = clean(env?.MERSAL_API_TOKEN || env?.MERSAL_TOKEN || env?.WA_TOKEN);
  if (!token) return null;
  const contactId = await findMersalContactId(env, token, phone);
  if (!contactId) return null;
  const delays = [0, 700, 1400];
  for (const delay of delays) {
    if (delay) await sleep(delay);
    const payload = await mersalApiPost(env, "/api/wpbox/getMessages", { token, contact_id: contactId });
    const rows = normalizeMersalMessagesPayload(payload);
    const media = findMersalMedia(rows, { providerMessageId, mediaId, messageType });
    if (media?.url) return media;
  }
  return null;
}

async function findMersalContactId(env, token, phone) {
  const payload = await mersalApiPost(env, "/api/wpbox/getConversations/none?mobile_api=true", { token });
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  const normalized = normalizePhone(phone);
  const found = rows.find((row) => {
    const candidate = normalizePhone(row?.phone || row?.name || row?.mobile || "");
    return candidate === normalized || (candidate && normalized && candidate.endsWith(normalized.slice(-9)));
  });
  return clean(found?.id || found?.contact_id);
}

async function mersalApiPost(env, path, body) {
  const base = clean(env?.MERSAL_API_ENDPOINT || "https://w-mersal.com").replace(/\/+$/, "");
  const url = `${base}${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const rawText = await response.text();
  let data = rawText;
  try { data = rawText ? JSON.parse(rawText) : {}; } catch {}
  if (response.ok && !isInvalidToken(data)) return data;

  const form = new URLSearchParams();
  Object.entries(body || {}).forEach(([key, value]) => form.set(key, String(value ?? "")));
  const fallback = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: form.toString(),
  });
  const fallbackText = await fallback.text();
  try { return fallbackText ? JSON.parse(fallbackText) : {}; } catch { return { raw: fallbackText }; }
}

function findMersalMedia(rows, { providerMessageId, mediaId, messageType }) {
  const sorted = [...rows].sort((left, right) => toMillis(right?.created_at || right?.createdAt) - toMillis(left?.created_at || left?.createdAt));
  const exact = sorted.find((row) => clean(row?.fb_message_id || row?.message_wamid || row?.wamid || row?.message_id) === providerMessageId);
  const exactMedia = mediaFromMersalMessage(exact);
  if (exactMedia?.url) return exactMedia;
  if (mediaId) {
    const byId = sorted.map(mediaFromMersalMessage).find((item) => item?.url && (item.url.includes(mediaId) || item.fileName.includes(mediaId)));
    if (byId?.url) return byId;
  }
  const wanted = normalizeMediaType(messageType);
  return sorted
    .filter((row) => Number(row?.is_message_by_contact || row?.isMessageByContact || 0) === 1)
    .map(mediaFromMersalMessage)
    .find((item) => item?.url && (!wanted || item.type === wanted)) || null;
}

function mediaFromMersalMessage(row) {
  if (!row) return null;
  const candidates = [
    ["image", row?.header_image || row?.image || row?.image_url || row?.media_image],
    ["audio", row?.header_audio || row?.audio || row?.audio_url || row?.voice || row?.voice_url || row?.media_audio],
    ["video", row?.header_video || row?.video || row?.video_url || row?.media_video],
    ["document", row?.header_document || row?.document || row?.document_url || row?.file || row?.file_url || row?.media_document],
  ];
  const found = candidates.find(([, value]) => clean(value));
  if (!found) return null;
  const [type, value] = found;
  const url = clean(value);
  return { type, url, fileName: fileNameFromUrl(url), mimeType: guessMimeTypeFromUrl(url, type) };
}

function normalizeMersalMessagesPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.messages)) return payload.messages;
  if (Array.isArray(payload?.data?.messages)) return payload.data.messages;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  return [];
}

function extractMessageText(message) {
  return clean(
    message?.text?.body
      || message?.button?.text
      || message?.interactive?.button_reply?.title
      || message?.interactive?.list_reply?.title,
  );
}

function paramsToComponents(params) {
  const values = Array.isArray(params) ? params : [];
  return values.length
    ? [{ type: "body", parameters: values.map((value) => ({ type: "text", text: String(value ?? "") })) }]
    : [];
}

function normalizePhone(value) {
  let digits = arabicDigitsToEnglish(String(value || "")).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^05\d{8}$/.test(digits)) digits = `966${digits.slice(1)}`;
  if (/^5\d{8}$/.test(digits)) digits = `966${digits}`;
  return digits;
}

function normalizeMediaType(value) {
  const type = clean(value).toLowerCase();
  if (type === "photo" || type === "picture") return "image";
  if (type === "voice" || type === "ptt") return "audio";
  if (type === "file") return "document";
  return type;
}

function timestampIso(value) {
  if (value == null || value === "") return new Date().toISOString();
  const text = String(value).trim();
  if (/^\d+$/.test(text)) {
    const number = Number(text);
    return new Date(number < 1e12 ? number * 1000 : number).toISOString();
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function attachmentLabel(type) {
  return ({ image: "صورة", audio: "رسالة صوتية", video: "فيديو", document: "ملف", sticker: "ملصق" })[type] || "مرفق";
}

function buildMediaFileName(type, mediaId, mimeType) {
  const extension = extensionFromMimeType(mimeType, type);
  const safeType = clean(type || "media").replace(/[^\w.-]/g, "") || "media";
  const safeId = clean(mediaId || Date.now()).replace(/[^\w.-]/g, "").slice(0, 40);
  return `${safeType}-${safeId}${extension}`;
}

function extensionFromMimeType(mimeType, type) {
  const mime = clean(mimeType).toLowerCase();
  const map = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
    "audio/mpeg": ".mp3", "audio/ogg": ".ogg", "audio/wav": ".wav", "audio/aac": ".aac",
    "video/mp4": ".mp4", "application/pdf": ".pdf", "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  };
  if (map[mime]) return map[mime];
  return ({ image: ".jpg", audio: ".mp3", video: ".mp4", document: "", sticker: ".webp" })[normalizeMediaType(type)] || "";
}

function guessMimeTypeFromUrl(url, type) {
  const lower = clean(url).toLowerCase().split("?")[0];
  const entries = [
    [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".png", "image/png"], [".webp", "image/webp"],
    [".gif", "image/gif"], [".mp3", "audio/mpeg"], [".ogg", "audio/ogg"], [".wav", "audio/wav"],
    [".aac", "audio/aac"], [".mp4", "video/mp4"], [".pdf", "application/pdf"], [".doc", "application/msword"],
    [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ];
  const found = entries.find(([extension]) => lower.endsWith(extension));
  if (found) return found[1];
  return ({ image: "image/jpeg", audio: "audio/mpeg", video: "video/mp4", document: "application/octet-stream", sticker: "image/webp" })[normalizeMediaType(type)] || "";
}

function fileNameFromUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return decodeURIComponent(url.pathname.split("/").pop() || "");
  } catch { return ""; }
}

function isProtectedWhatsappMediaUrl(value) {
  return /lookaside\.fbsbx\.com\/whatsapp_business\/attachments/i.test(clean(value));
}

function isInvalidToken(data) {
  return clean(data?.status).toLowerCase() === "error" && clean(data?.message || data?.errMsg).toLowerCase().includes("invalid token");
}

function toMillis(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function clean(value) {
  return String(value ?? "").trim();
}

function arabicDigitsToEnglish(value) {
  const map = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9" };
  return String(value || "").replace(/[٠-٩۰-۹]/g, (digit) => map[digit] ?? digit);
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), "content-type": "application/json; charset=utf-8" },
  });
}

async function safeJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
