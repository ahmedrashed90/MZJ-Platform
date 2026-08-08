import crypto from "node:crypto";
import type { getSql } from "./_db.js";
import { createDownloadUrl } from "./_media-storage.js";
import { getZohoFileInfo, getZohoRuntime } from "./_zoho-workdrive.js";

type Sql = ReturnType<typeof getSql>;

type InstagramImagePayload = {
  bytes: Buffer;
  contentType: string;
  fileName: string;
};

function clean(value: unknown) { return String(value ?? "").trim(); }
function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}
function first(value: unknown) { return Array.isArray(value) ? value[0] : value; }

function signingSecret() {
  const secret = clean(
    process.env.MZJ_INSTAGRAM_MEDIA_SIGNING_KEY
    || process.env.MZJ_PLATFORM_TOKEN_ENCRYPTION_KEY
    || process.env.MZJ_TOKEN_ENCRYPTION_KEY,
  );
  if (!secret || secret.length < 32) {
    throw new Error("مفتاح تأمين روابط صور Instagram غير مضبوط");
  }
  return crypto.createHash("sha256").update(`instagram-image-delivery:v1:${secret}`).digest();
}

function publicOrigin() {
  const configured = clean(process.env.MZJ_PUBLIC_BASE_URL);
  const vercelProduction = clean(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  const vercelDeployment = clean(process.env.VERCEL_URL);
  const candidate = configured || vercelProduction || vercelDeployment;
  if (!candidate) throw new Error("MZJ_PUBLIC_BASE_URL غير مضبوط لتجهيز رابط صورة Instagram");
  const normalized = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  const url = new URL(normalized);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) throw new Error("رابط المنصة العام يجب أن يستخدم HTTPS");
  return url.origin;
}

function signaturePayload(fileId: string, expiresAt: number) {
  return `v1:${fileId}:${expiresAt}`;
}

function sign(fileId: string, expiresAt: number) {
  return crypto.createHmac("sha256", signingSecret()).update(signaturePayload(fileId, expiresAt)).digest("base64url");
}

export function createInstagramImageDeliveryUrl(file: any, lifetimeSeconds = 7200) {
  const fileId = clean(file?.id);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fileId)) {
    throw new Error(`معرف صورة Instagram ${clean(file?.original_name) || ""} غير صالح`);
  }
  const lifetime = Math.min(10_800, Math.max(900, positiveInteger(lifetimeSeconds) || 7200));
  const expiresAt = Math.floor(Date.now() / 1000) + lifetime;
  const url = new URL("/api/marketing/instagram-media", publicOrigin());
  url.searchParams.set("file", fileId);
  url.searchParams.set("expires", String(expiresAt));
  url.searchParams.set("signature", sign(fileId, expiresAt));
  return url.toString();
}

export function verifyInstagramImageDeliveryQuery(query: Record<string, unknown>) {
  const fileId = clean(first(query.file));
  const expiresAt = positiveInteger(first(query.expires));
  const received = clean(first(query.signature));
  if (!fileId || !expiresAt || !received) return { ok: false as const, error: "رابط الصورة غير مكتمل" };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fileId)) {
    return { ok: false as const, error: "معرف الصورة غير صالح" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (expiresAt < now - 60) return { ok: false as const, error: "انتهت صلاحية رابط الصورة" };
  if (expiresAt > now + 10_860) return { ok: false as const, error: "مدة رابط الصورة غير صالحة" };
  const expected = sign(fileId, expiresAt);
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) {
    return { ok: false as const, error: "توقيع رابط الصورة غير صالح" };
  }
  return { ok: true as const, fileId, expiresAt };
}

function detectImageContentType(bytes: Buffer, headerContentType: string, storedContentType: string) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (headerContentType.startsWith("image/")) return headerContentType;
  if (storedContentType.startsWith("image/")) return storedContentType;
  return "";
}

async function openStoredImage(sql: Sql, file: any) {
  if (clean(file.storage_provider) === "zoho") {
    const externalId = clean(file.external_id);
    if (!externalId) throw new Error("معرف ملف Zoho غير موجود");
    const runtime = await getZohoRuntime(sql);
    const info = await getZohoFileInfo(sql, externalId);
    const downloadUrl = clean(info.downloadUrl) || `${runtime.uploadDomain}/v1/workdrive/download/${encodeURIComponent(externalId)}`;
    return fetch(downloadUrl, {
      redirect: "follow",
      headers: {
        Authorization: `Zoho-oauthtoken ${runtime.accessToken}`,
        Accept: "image/*,application/octet-stream,*/*",
      },
    });
  }

  const storageKey = clean(file.storage_key);
  if (!storageKey) throw new Error("مسار الصورة في التخزين غير موجود");
  return fetch(createDownloadUrl(storageKey, 900), {
    redirect: "follow",
    headers: { Accept: "image/*,application/octet-stream,*/*" },
  });
}

export async function loadInstagramImage(sql: Sql, fileId: string): Promise<InstagramImagePayload> {
  const [file] = await sql<any[]>`
    select * from marketing.files
    where id=${fileId}::uuid and status='ready'
    limit 1
  `;
  if (!file) throw Object.assign(new Error("الصورة غير موجودة أو لم يكتمل رفعها"), { statusCode: 404 });
  if (/video|mp4|mov|webm/i.test(`${file.mime_type || ""} ${file.original_name || ""}`)) {
    throw Object.assign(new Error("رابط صور Instagram لا يقبل ملفات الفيديو"), { statusCode: 415 });
  }

  const source = await openStoredImage(sql, file);
  if (!source.ok) {
    const detail = clean(await source.text().catch(() => ""));
    throw Object.assign(new Error(detail || `تعذر تنزيل صورة Instagram من التخزين (${source.status})`), { statusCode: 502 });
  }

  const headerContentType = clean(source.headers.get("content-type")).split(";")[0].toLowerCase();
  if (headerContentType.includes("application/json") || headerContentType.includes("text/html")) {
    throw Object.assign(new Error("مزود التخزين لم يرجع محتوى الصورة الفعلي"), { statusCode: 502 });
  }

  const bytes = Buffer.from(await source.arrayBuffer());
  if (!bytes.length) throw Object.assign(new Error("ملف الصورة فارغ"), { statusCode: 422 });
  const contentType = detectImageContentType(bytes, headerContentType, clean(file.mime_type).split(";")[0].toLowerCase());
  if (!contentType) throw Object.assign(new Error("محتوى الملف ليس صورة صالحة للنشر"), { statusCode: 415 });

  return {
    bytes,
    contentType,
    fileName: clean(file.original_name) || `instagram-image-${fileId}`,
  };
}
