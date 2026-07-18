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
function sha256Bytes(value: crypto.BinaryLike) { return crypto.createHash("sha256").update(value).digest("hex"); }
function sha256Text(value: string) { return sha256Bytes(value); }
function amzDate(date: Date) { return date.toISOString().replace(/[:-]|\.\d{3}/g, ""); }
function dateStamp(date: Date) { return amzDate(date).slice(0, 8); }
function awsEncode(value: string) { return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`); }
function encodePath(path: string) { return path.split("/").map(awsEncode).join("/"); }

function signingKey(secret: string, stamp: string) {
  const date = hmac(`AWS4${secret}`, stamp);
  const region = hmac(date, "auto");
  const service = hmac(region, "s3");
  return hmac(service, "aws4_request");
}

function endpoint(config: MediaStorageConfig, storageKey: string) {
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${awsEncode(config.bucket)}/${encodePath(storageKey)}`;
  return { host, canonicalUri, url: `https://${host}${canonicalUri}` };
}

function presign(method: "GET" | "PUT", storageKey: string, expiresSeconds = 900) {
  const config = mediaStorageConfig();
  if (!config) throw new Error("تخزين الوسائط R2 غير مضبوط في متغيرات Vercel");
  const now = new Date();
  const stamp = dateStamp(now);
  const timestamp = amzDate(now);
  const { host, canonicalUri, url } = endpoint(config, storageKey);
  const scope = `${stamp}/auto/s3/aws4_request`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
    "X-Amz-Date": timestamp,
    "X-Amz-Expires": String(Math.max(60, Math.min(604800, expiresSeconds))),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.entries(query).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`).join("&");
  const canonicalRequest = [method, canonicalUri, canonicalQuery, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", timestamp, scope, sha256Text(canonicalRequest)].join("\n");
  const signature = crypto.createHmac("sha256", signingKey(config.secretAccessKey, stamp)).update(stringToSign).digest("hex");
  return `${url}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function createUploadUrl(storageKey: string, expiresSeconds = 900) { return presign("PUT", storageKey, expiresSeconds); }
export function createDownloadUrl(storageKey: string, expiresSeconds = 300) { return presign("GET", storageKey, expiresSeconds); }

export async function putMediaObject(storageKey: string, bytes: Uint8Array, contentType = "application/octet-stream") {
  const config = mediaStorageConfig();
  if (!config) throw new Error("تخزين الوسائط R2 غير مضبوط في متغيرات Vercel");
  const now = new Date();
  const stamp = dateStamp(now);
  const timestamp = amzDate(now);
  const { host, canonicalUri, url } = endpoint(config, storageKey);
  const payloadHash = sha256Bytes(bytes);
  const scope = `${stamp}/auto/s3/aws4_request`;
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${timestamp}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = ["PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", timestamp, scope, sha256Text(canonicalRequest)].join("\n");
  const signature = crypto.createHmac("sha256", signingKey(config.secretAccessKey, stamp)).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const result = await fetch(url, {
    method: "PUT",
    headers: {
      authorization,
      "content-type": clean(contentType) || "application/octet-stream",
      "content-length": String(bytes.byteLength),
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": timestamp,
    },
    body: Buffer.from(bytes),
  });
  if (!result.ok) {
    const detail = (await result.text().catch(() => "")).slice(0, 1200);
    throw new Error(`R2 upload HTTP ${result.status}${detail ? `: ${detail}` : ""}`);
  }
  return { storageKey, fileSize: bytes.byteLength, etag: clean(result.headers.get("etag")) };
}


export async function getMediaObject(storageKey: string, range = "") {
  const config = mediaStorageConfig();
  if (!config) throw new Error("تخزين الوسائط R2 غير مضبوط في متغيرات Vercel");
  const now = new Date();
  const stamp = dateStamp(now);
  const timestamp = amzDate(now);
  const { host, canonicalUri, url } = endpoint(config, storageKey);
  const payloadHash = sha256Text("");
  const scope = `${stamp}/auto/s3/aws4_request`;
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${timestamp}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = ["GET", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", timestamp, scope, sha256Text(canonicalRequest)].join("\n");
  const signature = crypto.createHmac("sha256", signingKey(config.secretAccessKey, stamp)).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const headers: Record<string, string> = {
    authorization,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": timestamp,
  };
  if (clean(range)) headers.range = clean(range);
  const result = await fetch(url, { method: "GET", headers });
  if (!result.ok && result.status !== 206) {
    const detail = (await result.text().catch(() => "")).slice(0, 1200);
    throw new Error(`R2 download HTTP ${result.status}${detail ? `: ${detail}` : ""}`);
  }
  return result;
}
