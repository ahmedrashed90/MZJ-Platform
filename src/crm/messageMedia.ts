import type { CrmMessage } from "./types";

type LooseRecord = Record<string, unknown>;

const MEDIA_URL_KEYS = [
  "mersalMediaUrl", "mersal_media_url", "mediaUrl", "media_url", "fileUrl", "file_url",
  "attachmentUrl", "attachment_url", "whatsappMediaUrl", "whatsapp_media_url", "downloadUrl", "download_url",
  "publicUrl", "public_url", "secureUrl", "secure_url", "header_image", "header_audio", "header_video",
  "header_document", "imageUrl", "image_url", "audioUrl", "audio_url", "videoUrl", "video_url",
  "documentUrl", "document_url",
] as const;
const GENERIC_MEDIA_URL_KEYS = ["url", "link", "href"] as const;

const MEDIA_NESTED_KEYS = [
  "attachment", "attachments", "media", "document", "image", "audio", "video", "sticker", "file",
  "payload", "messageData", "message_data", "providerData", "provider_data", "mersal", "raw", "metadata",
] as const;

const FILE_NAME_KEYS = [
  "file_name", "fileName", "filename", "original_name", "originalName", "documentName", "document_name",
] as const;

const MIME_KEYS = ["mime_type", "mimeType", "content_type", "contentType"] as const;
const TYPE_KEYS = ["attachment_type", "attachmentType", "media_type", "mediaType", "message_type", "messageType", "type"] as const;
const TEXT_KEYS = ["body", "text", "message", "caption", "buttonTitle", "button_title", "lastMessageText", "last_message_text"] as const;
const STRONG_ID_KEYS = [
  "provider_message_id", "providerMessageId", "legacy_id", "mersalMessageId", "mersal_message_id", "fbMessageId",
  "fb_message_id", "messageWamid", "message_wamid", "wamid", "message_id", "messageId", "mediaId", "media_id", "sha256",
] as const;

function record(value: unknown): LooseRecord | null {
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

function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function normalizeMediaType(value: unknown) {
  const type = text(value).toLowerCase();
  if (["photo", "picture"].includes(type)) return "image";
  if (["voice", "ptt"].includes(type)) return "audio";
  if (type === "file") return "document";
  return type;
}

export function normalizeMessageMediaUrl(value: unknown) {
  let url = text(value).replace(/\\\//g, "/").replace(/&amp;/g, "&");
  if (!url || /lookaside\.fbsbx\.com\/whatsapp_business\/attachments/i.test(url)) return "";
  if (url.startsWith("//")) url = `https:${url}`;
  if (/^https?:\/\//i.test(url) || /^(blob:|data:)/i.test(url)) return url;
  if (url.startsWith("/")) return `https://w-mersal.com${url}`;
  if (/^(uploads?|storage|media|files?)\//i.test(url)) return `https://w-mersal.com/${url.replace(/^\/+/, "")}`;
  if (/^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(url)) return `https://${url}`;
  return "";
}

function deepValue(source: unknown, keys: readonly string[], depth = 0, seen = new Set<object>()): string {
  if (depth > 4) return "";
  const obj = record(source);
  if (!obj || seen.has(obj)) return "";
  seen.add(obj);
  for (const key of keys) {
    const candidate = text(obj[key]);
    if (candidate) return candidate;
  }
  for (const key of MEDIA_NESTED_KEYS) {
    const nested = obj[key];
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const found = deepValue(item, keys, depth + 1, seen);
        if (found) return found;
      }
      continue;
    }
    const found = deepValue(nested, keys, depth + 1, seen);
    if (found) return found;
  }
  return "";
}

function deepMediaUrl(source: unknown, depth = 0, seen = new Set<object>()): string {
  if (depth > 4) return "";
  const obj = record(source);
  if (!obj || seen.has(obj)) return "";
  seen.add(obj);
  for (const key of MEDIA_URL_KEYS) {
    const candidate = normalizeMessageMediaUrl(obj[key]);
    if (candidate) return candidate;
  }
  if (depth > 0) {
    for (const key of GENERIC_MEDIA_URL_KEYS) {
      const candidate = normalizeMessageMediaUrl(obj[key]);
      if (candidate) return candidate;
    }
  }
  for (const key of MEDIA_NESTED_KEYS) {
    const nested = obj[key];
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const found = deepMediaUrl(item, depth + 1, seen);
        if (found) return found;
      }
      continue;
    }
    const found = deepMediaUrl(nested, depth + 1, seen);
    if (found) return found;
  }
  return "";
}

export function messageMediaUrl(message: CrmMessage) {
  return deepMediaUrl(message);
}

export function messageMimeType(message: CrmMessage) {
  return deepValue(message, MIME_KEYS);
}

export function messageMediaType(message: CrmMessage) {
  const declared = normalizeMediaType(deepValue(message, TYPE_KEYS));
  if (["image", "audio", "video", "document", "sticker"].includes(declared)) return declared;
  const mime = messageMimeType(message).toLowerCase();
  if (mime.startsWith("image/")) return mime.includes("webp") && declared === "sticker" ? "sticker" : "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime) return "document";
  const url = messageMediaUrl(message).toLowerCase().split(/[?#]/)[0];
  if (/\.(jpe?g|png|gif|webp|bmp|svg)$/.test(url)) return "image";
  if (/\.(mp3|ogg|opus|wav|aac|m4a)$/.test(url)) return "audio";
  if (/\.(mp4|mov|webm|m4v|avi)$/.test(url)) return "video";
  if (/\.(pdf|docx?|xlsx?|pptx?|txt|csv|zip|rar)$/.test(url)) return "document";
  return declared;
}

export function messageFileName(message: CrmMessage) {
  const explicit = deepValue(message, FILE_NAME_KEYS);
  if (explicit && !/^https?:\/\//i.test(explicit)) return explicit;
  const url = messageMediaUrl(message);
  if (url) {
    try {
      const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
      if (name) return name;
    } catch {
      // Use the generic fallback below.
    }
  }
  return "تحميل المرفق";
}

export function messageHasAttachment(message: CrmMessage) {
  const raw = message as CrmMessage & LooseRecord;
  return Boolean(
    message.media_asset_id || message.storage_key || messageMediaUrl(message) ||
    raw.hasAttachment === true || raw.has_attachment === true ||
    ["image", "audio", "video", "document", "sticker"].includes(messageMediaType(message)),
  );
}

export function messageDisplayText(message: CrmMessage, mediaPresent = messageHasAttachment(message)) {
  const content = deepValue(message, TEXT_KEYS);
  if (content) return content;
  return mediaPresent ? "" : "رسالة بدون نص";
}

export function messageTimestamp(message: CrmMessage) {
  const raw = deepValue(message, ["created_at", "createdAt", "receivedAt", "received_at", "timestamp", "updatedAt", "updated_at"]);
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) {
    const number = Number(raw);
    return number < 1e12 ? number * 1000 : number;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isOutboundChatMessage(message: CrmMessage) {
  const raw = message as CrmMessage & LooseRecord;
  const direction = text(raw.direction || raw.messageDirection || raw.message_direction).toLowerCase();
  if (["out", "outbound", "sent", "send"].includes(direction)) return true;
  if (["in", "inbound", "received", "receive"].includes(direction)) return false;
  if (raw.isIncoming === true || raw.is_incoming === true || raw.isFromCustomer === true || raw.is_from_customer === true) return false;
  const senderType = text(raw.sender_type || raw.senderType).toLowerCase();
  if (["customer", "contact", "client"].includes(senderType)) return false;
  return ["human", "agent", "bot", "system", "employee", "staff"].includes(senderType);
}

function strongMessageKeys(message: CrmMessage) {
  const keys = new Set<string>();
  const visit = (source: unknown, depth = 0, seen = new Set<object>()) => {
    if (depth > 4) return;
    const obj = record(source);
    if (!obj || seen.has(obj)) return;
    seen.add(obj);
    for (const key of STRONG_ID_KEYS) {
      const value = text(obj[key]);
      if (value) keys.add(value);
    }
    for (const key of MEDIA_NESTED_KEYS) visit(obj[key], depth + 1, seen);
  };
  visit(message);
  return [...keys];
}

function fallbackMessageKey(message: CrmMessage) {
  const direction = isOutboundChatMessage(message) ? "out" : "in";
  const bucket = Math.floor(messageTimestamp(message) / 3000);
  const media = messageMediaUrl(message);
  const mediaType = messageMediaType(message);
  if (media) return `fallback:${direction}:media:${mediaType}:${media}:${bucket}`;
  const content = messageDisplayText(message, false).replace(/\s+/g, " ").trim().toLowerCase();
  const file = messageFileName(message).toLowerCase();
  return `fallback:${direction}:${content || file || "empty"}:${bucket}`;
}

function contentScore(message: CrmMessage) {
  let score = 0;
  if (messageMediaUrl(message)) score += 50;
  if (messageDisplayText(message, false)) score += 20;
  if (messageFileName(message) !== "تحميل المرفق") score += 10;
  if (messageMimeType(message)) score += 8;
  if (messageHasAttachment(message)) score += 6;
  if (message.provider_status) score += 3;
  if (messageTimestamp(message)) score += 1;
  return score;
}

function mergeMessages(left: CrmMessage, right: CrmMessage) {
  const preferred = contentScore(right) >= contentScore(left) ? right : left;
  const fallback = preferred === right ? left : right;
  const merged = { ...fallback, ...preferred } as CrmMessage;
  for (const [key, value] of Object.entries(fallback)) {
    if (merged[key as keyof CrmMessage] == null || merged[key as keyof CrmMessage] === "") {
      (merged as LooseRecord)[key] = value;
    }
  }
  const leftTime = messageTimestamp(left);
  const rightTime = messageTimestamp(right);
  if (leftTime && rightTime) merged.created_at = leftTime <= rightTime ? left.created_at : right.created_at;
  merged.id = preferred.id || fallback.id;
  return merged;
}

export function prepareChatMessages(messages: CrmMessage[], limit = 300) {
  const sorted = [...(Array.isArray(messages) ? messages : [])]
    .filter((message) => Boolean(message && (messageHasAttachment(message) || messageDisplayText(message, false))))
    .sort((left, right) => messageTimestamp(left) - messageTimestamp(right) || String(left.id).localeCompare(String(right.id)));
  const byKey = new Map<string, CrmMessage>();
  const aliasToKey = new Map<string, string>();
  for (const message of sorted) {
    const strong = strongMessageKeys(message);
    const matchedKeys = [...new Set(strong.map((alias) => aliasToKey.get(alias)).filter((key): key is string => Boolean(key)))];
    const key = matchedKeys[0] || strong[0] || fallbackMessageKey(message);
    let merged = message;
    for (const matchedKey of matchedKeys) {
      const existing = byKey.get(matchedKey);
      if (existing) merged = mergeMessages(existing, merged);
      if (matchedKey !== key) byKey.delete(matchedKey);
    }
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeMessages(existing, merged) : merged);
    for (const alias of strong) aliasToKey.set(alias, key);
  }
  return [...byKey.values()]
    .sort((left, right) => messageTimestamp(left) - messageTimestamp(right) || String(left.id).localeCompare(String(right.id)))
    .slice(-Math.max(1, limit));
}
