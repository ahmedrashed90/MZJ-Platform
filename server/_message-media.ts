import { clean } from "./_crm-utils.js";

type LooseRecord = Record<string, any>;

const URL_KEYS = [
  "mersalMediaUrl", "mersal_media_url", "mediaUrl", "media_url", "fileUrl", "file_url",
  "attachmentUrl", "attachment_url", "whatsappMediaUrl", "whatsapp_media_url", "downloadUrl", "download_url",
  "publicUrl", "public_url", "secureUrl", "secure_url", "header_image", "header_audio", "header_video",
  "header_document", "imageUrl", "image_url", "audioUrl", "audio_url", "videoUrl", "video_url",
  "documentUrl", "document_url",
];
const GENERIC_URL_KEYS = ["url", "link", "href"];
const NESTED_KEYS = [
  "attachment", "attachments", "media", "document", "image", "audio", "video", "sticker", "file",
  "payload", "messageData", "message_data", "providerData", "provider_data", "mersal", "raw", "metadata",
];
const TYPE_KEYS = ["attachmentType", "attachment_type", "mediaType", "media_type", "messageType", "message_type", "type"];
const FILE_KEYS = ["fileName", "file_name", "filename", "originalName", "original_name", "documentName", "document_name"];
const MIME_KEYS = ["mimeType", "mime_type", "contentType", "content_type"];
const TEXT_KEYS = [
  "customer_message", "last_input_text", "lastTextInput", "text", "message", "body", "previewText", "preview_text",
  "caption", "buttonTitle", "button_title", "lastMessageText", "last_message_text", "value",
];
const ID_KEYS = [
  "providerMessageId", "provider_message_id", "messageId", "message_id", "mid", "fbMessageId", "fb_message_id",
  "messageWamid", "message_wamid", "wamid", "mersalMessageId", "mersal_message_id", "mediaId", "media_id", "sha256",
];

function asRecord(value: unknown): LooseRecord | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value as LooseRecord;
  if (typeof value !== "string") return null;
  const source = value.trim();
  if (!source || (!source.startsWith("{") && !source.startsWith("["))) return null;
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as LooseRecord : null;
  } catch {
    return null;
  }
}

function scalar(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function normalizeMediaType(value: unknown) {
  const type = scalar(value).toLowerCase();
  if (["photo", "picture"].includes(type)) return "image";
  if (["voice", "ptt"].includes(type)) return "audio";
  if (type === "file") return "document";
  return type;
}

export function normalizeMersalMediaUrl(value: unknown) {
  let url = scalar(value).replace(/\\\//g, "/").replace(/&amp;/g, "&");
  if (!url || /lookaside\.fbsbx\.com\/whatsapp_business\/attachments/i.test(url)) return "";
  if (url.startsWith("//")) url = `https:${url}`;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return `https://w-mersal.com${url}`;
  if (/^(uploads?|storage|media|files?)\//i.test(url)) return `https://w-mersal.com/${url.replace(/^\/+/, "")}`;
  if (/^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(url)) return `https://${url}`;
  return "";
}

function deepScalar(source: unknown, keys: string[], depth = 0, seen = new Set<object>()): string {
  if (depth > 4) return "";
  const obj = asRecord(source);
  if (!obj || seen.has(obj)) return "";
  seen.add(obj);
  for (const key of keys) {
    const value = scalar(obj[key]);
    if (value) return value;
  }
  for (const key of NESTED_KEYS) {
    const nested = obj[key];
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const found = deepScalar(item, keys, depth + 1, seen);
        if (found) return found;
      }
    } else {
      const found = deepScalar(nested, keys, depth + 1, seen);
      if (found) return found;
    }
  }
  return "";
}

function deepUrl(source: unknown, depth = 0, seen = new Set<object>()): string {
  if (depth > 4) return "";
  const obj = asRecord(source);
  if (!obj || seen.has(obj)) return "";
  seen.add(obj);
  for (const key of URL_KEYS) {
    const value = normalizeMersalMediaUrl(obj[key]);
    if (value) return value;
  }
  if (depth > 0) {
    for (const key of GENERIC_URL_KEYS) {
      const value = normalizeMersalMediaUrl(obj[key]);
      if (value) return value;
    }
  }
  for (const key of NESTED_KEYS) {
    const nested = obj[key];
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const found = deepUrl(item, depth + 1, seen);
        if (found) return found;
      }
    } else {
      const found = deepUrl(nested, depth + 1, seen);
      if (found) return found;
    }
  }
  return "";
}

function inferType(type: string, mimeType: string, url: string) {
  const normalized = normalizeMediaType(type);
  if (["image", "audio", "video", "document", "sticker"].includes(normalized)) return normalized;
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime) return "document";
  const cleanUrl = url.toLowerCase().split(/[?#]/)[0];
  if (/\.(jpe?g|png|gif|webp|bmp|svg)$/.test(cleanUrl)) return "image";
  if (/\.(mp3|ogg|opus|wav|aac|m4a)$/.test(cleanUrl)) return "audio";
  if (/\.(mp4|mov|webm|m4v|avi)$/.test(cleanUrl)) return "video";
  if (/\.(pdf|docx?|xlsx?|pptx?|txt|csv|zip|rar)$/.test(cleanUrl)) return "document";
  return normalized;
}

function fileNameFromUrl(url: string) {
  if (!url) return "";
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
  } catch {
    return "";
  }
}

function whatsappValue(payload: any) {
  return payload?.entry?.[0]?.changes?.[0]?.value || {};
}

export function whatsappMessage(payload: any) {
  return whatsappValue(payload)?.messages?.[0] || {};
}

export function extractIntegrationMedia(payload: any) {
  const msg = whatsappMessage(payload);
  const rawType = deepScalar(payload, TYPE_KEYS) || scalar(msg?.type);
  const nested = msg?.[normalizeMediaType(rawType)] || msg?.[rawType] || null;
  const url = deepUrl(payload) || deepUrl(msg) || deepUrl(nested);
  const mimeType = deepScalar(payload, MIME_KEYS) || scalar(nested?.mime_type || nested?.mimeType);
  const type = inferType(rawType, mimeType, url);
  const storageKey = deepScalar(payload, ["storageKey", "storage_key"]);
  const explicitName = deepScalar(payload, FILE_KEYS) || scalar(nested?.filename || nested?.fileName);
  const fileName = explicitName || fileNameFromUrl(url);
  const fileSize = Number(payload?.fileSize ?? payload?.file_size ?? nested?.file_size ?? nested?.fileSize ?? 0) || null;
  const mediaId = deepScalar(payload, ["mediaId", "media_id"]) || scalar(nested?.id);
  const caption = deepScalar(payload, ["caption"]) || scalar(nested?.caption);
  const hasAttachment = Boolean(
    payload?.hasAttachment === true || payload?.has_attachment === true || storageKey || url || mediaId ||
    ["image", "audio", "video", "document", "sticker"].includes(type),
  );
  return {
    hasAttachment,
    type: type || (hasAttachment ? "document" : ""),
    storageKey,
    url,
    fileName,
    mimeType,
    fileSize,
    caption,
    isSensitive: payload?.isSensitive === true || payload?.is_sensitive === true,
    mediaId,
    sha256: deepScalar(payload, ["sha256"]),
    mersalMessageId: deepScalar(payload, ["mersalMessageId", "mersal_message_id"]),
    fbMessageId: deepScalar(payload, ["fbMessageId", "fb_message_id", "messageWamid", "message_wamid", "wamid"]) || scalar(msg?.id),
    whatsappMediaUrl: deepScalar(payload, ["whatsappMediaUrl", "whatsapp_media_url"]),
  };
}

export function extractIntegrationMessageText(payload: any, media: ReturnType<typeof extractIntegrationMedia>) {
  const msg = whatsappMessage(payload);
  const direct = deepScalar(payload, TEXT_KEYS) || scalar(
    msg?.text?.body || msg?.button?.text || msg?.interactive?.button_reply?.title || msg?.interactive?.list_reply?.title,
  );
  if (direct) return direct;
  if (!media.hasAttachment) return "";
  return media.fileName || ({ image: "صورة", audio: "رسالة صوتية", video: "فيديو", document: "ملف", sticker: "ملصق" } as Record<string, string>)[media.type] || "مرفق";
}

export function extractIntegrationDirection(payload: any) {
  const direction = deepScalar(payload, ["direction", "messageDirection", "message_direction"]).toLowerCase();
  if (["out", "outbound", "sent", "send"].includes(direction)) return "out" as const;
  if (["in", "inbound", "received", "receive"].includes(direction)) return "in" as const;
  if (payload?.isIncoming === false || payload?.is_incoming === false) return "out" as const;
  if (payload?.isIncoming === true || payload?.is_incoming === true || payload?.isFromCustomer === true || payload?.is_from_customer === true) return "in" as const;
  const sender = deepScalar(payload, ["senderType", "sender_type"]).toLowerCase();
  if (["human", "agent", "bot", "system", "employee", "staff"].includes(sender)) return "out" as const;
  return "in" as const;
}

export function extractIntegrationSenderType(payload: any, direction: "in" | "out") {
  const sender = deepScalar(payload, ["senderType", "sender_type"]).toLowerCase();
  if (sender) return sender;
  return direction === "in" ? "customer" : "system";
}

export function extractIntegrationMessageType(payload: any, media: ReturnType<typeof extractIntegrationMedia>) {
  if (media.hasAttachment) return media.type || "document";
  const requested = normalizeMediaType(deepScalar(payload, TYPE_KEYS));
  const templateName = deepScalar(payload, ["templateName", "template_name"]);
  if (requested === "template" || templateName) return "template";
  return "text";
}

export function extractStrongMessageKeys(payload: any, eventId: string) {
  const msg = whatsappMessage(payload);
  const values = new Set<string>();
  const visit = (source: unknown, depth = 0, seen = new Set<object>()) => {
    if (depth > 4) return;
    const obj = asRecord(source);
    if (!obj || seen.has(obj)) return;
    seen.add(obj);
    for (const key of ID_KEYS) {
      const value = scalar(obj[key]);
      if (value) values.add(value);
    }
    for (const key of NESTED_KEYS) visit(obj[key], depth + 1, seen);
  };
  visit(payload);
  if (scalar(msg?.id)) values.add(scalar(msg.id));
  const whatsappType = normalizeMediaType(msg?.type);
  const whatsappMedia = msg?.[whatsappType] || msg?.[msg?.type] || null;
  if (scalar(whatsappMedia?.id)) values.add(scalar(whatsappMedia.id));
  if (scalar(whatsappMedia?.sha256)) values.add(scalar(whatsappMedia.sha256));
  if (clean(eventId)) values.add(clean(eventId));
  return [...values];
}

export function integrationMessageMetadata(payload: any, media: ReturnType<typeof extractIntegrationMedia>, source: string, routeSource: string, eventId: string, messageKeys: string[]) {
  return {
    source,
    routeSource,
    eventId,
    messageKeys,
    mediaId: media.mediaId || null,
    sha256: media.sha256 || null,
    mersalMessageId: media.mersalMessageId || null,
    fbMessageId: media.fbMessageId || null,
    whatsappMediaUrl: media.whatsappMediaUrl || null,
    mersalMediaResolved: Boolean(media.url),
  };
}
