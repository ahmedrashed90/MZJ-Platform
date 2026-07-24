import crypto from "node:crypto";

export type MediaStorageConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
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

export function buildMediaStorageKey(input: { conversationId: string; fileName?: string; mediaType?: string }) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const conversation = safeSegment(input.conversationId, "conversation");
  const filename = safeSegment(input.fileName, `${safeSegment(input.mediaType, "file")}-${crypto.randomUUID()}`);
  return `crm/${yyyy}/${mm}/${conversation}/${crypto.randomUUID()}-${filename}`;
}

export function buildMarketingStorageKey(input: { category: string; sourceType?: string; sourceId?: string; taskId?: string; fileName?: string }) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const category = safeSegment(input.category, "file");
  const sourceType = safeSegment(input.sourceType, "marketing");
  const sourceId = safeSegment(input.sourceId, "general");
  const taskId = input.taskId ? `/${safeSegment(input.taskId, "task")}` : "";
  const filename = safeSegment(input.fileName, `${category}-${crypto.randomUUID()}`);
  return `marketing/${yyyy}/${mm}/${sourceType}/${sourceId}${taskId}/${crypto.randomUUID()}-${filename}`;
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

function signingKey(secret: string, stamp: string) {
  const date = hmac(`AWS4${secret}`, stamp);
  const region = hmac(date, "auto");
  const service = hmac(region, "s3");
  return hmac(service, "aws4_request");
}

function presign(method: "GET" | "PUT", storageKey: string, expiresSeconds = 900) {
  const config = mediaStorageConfig();
  if (!config) throw new Error("تخزين الوسائط R2 غير مضبوط في متغيرات Vercel");
  const now = new Date();
  const stamp = dateStamp(now);
  const timestamp = amzDate(now);
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${encodeURIComponent(config.bucket)}/${encodePath(storageKey)}`;
  const scope = `${stamp}/auto/s3/aws4_request`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
    "X-Amz-Date": timestamp,
    "X-Amz-Expires": String(Math.max(60, Math.min(604800, expiresSeconds))),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.entries(query).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
  const canonicalRequest = [method, canonicalUri, canonicalQuery, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", timestamp, scope, sha256(canonicalRequest)].join("\n");
  const signature = crypto.createHmac("sha256", signingKey(config.secretAccessKey, stamp)).update(stringToSign).digest("hex");
  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function createUploadUrl(storageKey: string, expiresSeconds = 900) { return presign("PUT", storageKey, expiresSeconds); }
export function createDownloadUrl(storageKey: string, expiresSeconds = 300) { return presign("GET", storageKey, expiresSeconds); }
