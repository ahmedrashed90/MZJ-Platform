import crypto from "node:crypto";

export type MediaStorageConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export type MarketingStorageKeyInput = {
  category: string;
  sourceType?: string;
  sourceId?: string;
  sourceCode?: string;
  sourceName?: string;
  creativeId?: string;
  creativeCode?: string;
  creativeName?: string;
  taskId?: string;
  taskCode?: string;
  taskName?: string;
  fileName?: string;
  createdAt?: string | Date;
  uniqueId?: string;
};

function clean(value: unknown) { return String(value ?? "").trim(); }

export function mediaStorageConfig(): MediaStorageConfig | null {
  const config = {
    accountId: clean(process.env.R2_ACCOUNT_ID),
    accessKeyId: clean(process.env.R2_ACCESS_KEY_ID),
    secretAccessKey: clean(process.env.R2_SECRET_ACCESS_KEY),
    bucket: clean(process.env.R2_BUCKET),
  };
  return Object.values(config).every(Boolean) ? config : null;
}

export function mediaStorageConfigured() { return Boolean(mediaStorageConfig()); }

function safeSegment(value: unknown, fallback: string) {
  return clean(value).normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || fallback;
}

function safeMarketingSegment(value: unknown, fallback: string, maxLength = 120) {
  return clean(value)
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\p{M}._-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, maxLength) || fallback;
}

function shortId(value: unknown) {
  const compact = clean(value).replace(/[^a-zA-Z0-9]/g, "");
  return compact.slice(0, 8) || crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}

function namedFolder(code: unknown, name: unknown, id: unknown, fallback: string) {
  const codeValue = clean(code) ? safeMarketingSegment(code, "", 48) : "";
  const nameValue = clean(name) ? safeMarketingSegment(name, "", 88) : "";
  const idValue = clean(id) ? shortId(id) : "";
  const parts = [codeValue, nameValue, idValue].filter(Boolean);
  return parts.join("__") || fallback;
}

function marketingCategoryFolder(categoryValue: unknown) {
  const category = clean(categoryValue).toLowerCase();
  const known: Record<string, string> = {
    "first-file": "01-FIRST-FILE",
    "final-file": "02-FINAL-FILE",
    "final-upload-staging": "02-FINAL-FILE",
    "task-template": "03-TASK-TEMPLATE",
    "campaign-result": "04-CAMPAIGN-RESULT",
  };
  if (known[category]) return known[category];
  return `05-${safeMarketingSegment(category || "FILE", "FILE", 64).toUpperCase()}`;
}

function marketingFileName(fileNameValue: unknown, category: string, uniqueIdValue?: unknown) {
  const safeName = safeMarketingSegment(fileNameValue, `${safeMarketingSegment(category, "file", 48)}.bin`, 170);
  const unique = shortId(uniqueIdValue || crypto.randomUUID());
  const dot = safeName.lastIndexOf(".");
  if (dot > 0 && dot < safeName.length - 1 && safeName.length - dot <= 16) {
    const base = safeName.slice(0, dot).slice(0, 145) || "file";
    const extension = safeName.slice(dot + 1);
    return `${base}__${unique}.${extension}`;
  }
  return `${safeName.slice(0, 150) || "file"}__${unique}`;
}

function storageDate(value?: string | Date) {
  const parsed = value instanceof Date ? value : value ? new Date(value) : new Date();
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

export function buildMediaStorageKey(input: { conversationId: string; fileName?: string; mediaType?: string }) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const conversation = safeSegment(input.conversationId, "conversation");
  const filename = safeSegment(input.fileName, `${safeSegment(input.mediaType, "file")}-${crypto.randomUUID()}`);
  return `crm/${yyyy}/${mm}/${conversation}/${crypto.randomUUID()}-${filename}`;
}

export function buildMarketingStorageKey(input: MarketingStorageKeyInput) {
  const now = storageDate(input.createdAt);
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const sourceType = safeMarketingSegment(input.sourceType, "marketing", 40).toLowerCase();
  const sourceFolder = namedFolder(input.sourceCode, input.sourceName, input.sourceId, `${sourceType}__${shortId(input.sourceId)}`);
  const segments = ["marketing", String(yyyy), mm, sourceType, sourceFolder];

  if (clean(input.creativeId) || clean(input.creativeCode) || clean(input.creativeName)) {
    segments.push(namedFolder(input.creativeCode || "CREATIVE", input.creativeName, input.creativeId, `CREATIVE__${shortId(input.creativeId)}`));
  }
  if (clean(input.taskId) || clean(input.taskCode) || clean(input.taskName)) {
    segments.push(namedFolder(input.taskCode || "TASK", input.taskName, input.taskId, `TASK__${shortId(input.taskId)}`));
  }

  segments.push(marketingCategoryFolder(input.category));
  segments.push(marketingFileName(input.fileName, input.category, input.uniqueId));
  return segments.join("/");
}

export function buildInboundMediaStorageKey(input: { channelCode: string; conversationExternalId: string; providerMessageId: string; fileName?: string; mediaType?: string }) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const channel = safeSegment(input.channelCode, "channel");
  const conversation = safeSegment(input.conversationExternalId, "conversation");
  const message = safeSegment(input.providerMessageId, crypto.randomUUID());
  const filename = safeSegment(input.fileName, `${safeSegment(input.mediaType, "file")}-${message}`);
  return `crm/inbound/${channel}/${yyyy}/${mm}/${conversation}/${message}-${filename}`;
}

function hmac(key: crypto.BinaryLike, value: string) { return crypto.createHmac("sha256", key).update(value).digest(); }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function amzDate(date: Date) { return date.toISOString().replace(/[:-]|\.\d{3}/g, ""); }
function dateStamp(date: Date) { return amzDate(date).slice(0, 8); }
function encodePath(path: string) { return path.split("/").map((segment) => encodeURIComponent(segment).replace(/%2F/gi, "/")).join("/"); }
function canonicalHeaderValue(value: string) { return value.trim().replace(/\s+/g, " "); }

function signingKey(secret: string, stamp: string) {
  const date = hmac(`AWS4${secret}`, stamp);
  const region = hmac(date, "auto");
  const service = hmac(region, "s3");
  return hmac(service, "aws4_request");
}

function presign(method: "GET" | "PUT" | "DELETE" | "HEAD", storageKey: string, expiresSeconds = 900, extraHeaders: Record<string, string> = {}) {
  const config = mediaStorageConfig();
  if (!config) throw new Error("تخزين الوسائط R2 غير مضبوط في متغيرات Vercel");
  const now = new Date();
  const stamp = dateStamp(now);
  const timestamp = amzDate(now);
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${encodeURIComponent(config.bucket)}/${encodePath(storageKey)}`;
  const scope = `${stamp}/auto/s3/aws4_request`;
  const headers: Record<string, string> = { host };
  for (const [key, value] of Object.entries(extraHeaders)) headers[key.toLowerCase()] = canonicalHeaderValue(value);
  const headerNames = Object.keys(headers).sort();
  const signedHeaders = headerNames.join(";");
  const canonicalHeaders = `${headerNames.map((key) => `${key}:${headers[key]}`).join("\n")}\n`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
    "X-Amz-Date": timestamp,
    "X-Amz-Expires": String(Math.max(60, Math.min(604800, expiresSeconds))),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const canonicalQuery = Object.entries(query).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", timestamp, scope, sha256(canonicalRequest)].join("\n");
  const signature = crypto.createHmac("sha256", signingKey(config.secretAccessKey, stamp)).update(stringToSign).digest("hex");
  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function createUploadUrl(storageKey: string, expiresSeconds = 900) { return presign("PUT", storageKey, expiresSeconds); }
export function createDownloadUrl(storageKey: string, expiresSeconds = 300) { return presign("GET", storageKey, expiresSeconds); }
export function createDeleteUrl(storageKey: string, expiresSeconds = 300) { return presign("DELETE", storageKey, expiresSeconds); }
export function createHeadUrl(storageKey: string, expiresSeconds = 300) { return presign("HEAD", storageKey, expiresSeconds); }

export async function headMediaObject(storageKey: string) {
  const response = await fetch(createHeadUrl(storageKey, 900), { method: "HEAD" });
  if (response.status === 404) return { exists: false, size: 0, etag: "" };
  if (!response.ok) throw new Error(`تعذر التحقق من ملف R2 (${response.status})`);
  return {
    exists: true,
    size: Number(response.headers.get("content-length") || 0),
    etag: clean(response.headers.get("etag")),
  };
}

export async function copyMediaObject(sourceKey: string, destinationKey: string) {
  const config = mediaStorageConfig();
  if (!config) throw new Error("تخزين الوسائط R2 غير مضبوط في متغيرات Vercel");
  const copySource = `/${encodeURIComponent(config.bucket)}/${encodePath(sourceKey)}`;
  const url = presign("PUT", destinationKey, 900, { "x-amz-copy-source": copySource });
  const response = await fetch(url, { method: "PUT", headers: { "x-amz-copy-source": copySource } });
  if (!response.ok) {
    const message = clean(await response.text().catch(() => ""));
    throw new Error(message || `تعذر نقل ملف R2 إلى المسار المنظم (${response.status})`);
  }
  return { ok: true };
}
