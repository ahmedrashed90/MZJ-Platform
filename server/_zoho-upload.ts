import type { getSql } from "./_db.js";
import { getZohoTransferRuntime, parseZohoUploadResult } from "./_zoho-workdrive.js";

type Sql = ReturnType<typeof getSql>;
type ZohoTransferRuntime = Awaited<ReturnType<typeof getZohoTransferRuntime>>;

export type ZohoUploadStrategy = "standard" | "chunk";

export const ZOHO_PROXY_CHUNK_SIZE = 4 * 1024 * 1024;
export const ZOHO_CHUNK_UPLOAD_MIN_FILE_SIZE = 64 * 1024 * 1024;

function clean(value: unknown) { return String(value ?? "").trim(); }

function findString(value: unknown, keys: string[]): string {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findString(item, keys);
      if (found) return found;
    }
    return "";
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (candidate !== null && candidate !== undefined && typeof candidate !== "object") {
      const text = clean(candidate);
      if (text) return text;
    }
  }
  for (const child of Object.values(record)) {
    const found = findString(child, keys);
    if (found) return found;
  }
  return "";
}

function parseResponse(text: string) {
  if (!text) return {} as Record<string, any>;
  try { return JSON.parse(text) as Record<string, any>; } catch { return { raw: text }; }
}

function responseError(payload: any, status: number, fallback: string) {
  const first = Array.isArray(payload?.errors) ? payload.errors[0] : payload?.error;
  return clean(first?.title || first?.detail || first?.message || first || payload?.message || payload?.error_description || payload?.raw) || `${fallback} (${status})`;
}

function chunkUploadDomain(runtime: ZohoTransferRuntime) {
  const configured = clean(process.env.ZOHO_CHUNK_UPLOAD_DOMAIN);
  if (configured) return configured.replace(/\/+$/, "");

  for (const candidate of [runtime.apiDomain, runtime.uploadDomain]) {
    try {
      const url = new URL(candidate);
      const apiMatch = url.hostname.match(/^www\.zohoapis\.(.+)$/i);
      if (apiMatch?.[1]) return `${url.protocol}//upload.zoho.${apiMatch[1]}`;
      const filesMatch = url.hostname.match(/^files\.zoho\.(.+)$/i);
      if (filesMatch?.[1]) return `${url.protocol}//upload.zoho.${filesMatch[1]}`;
      if (/^upload\.zoho\./i.test(url.hostname)) return `${url.protocol}//${url.host}`;
    } catch { /* try next configured domain */ }
  }
  throw new Error("تعذر تحديد نطاق رفع الملفات الكبيرة في Zoho WorkDrive");
}

function ownedArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function createZohoChunkUploadSession(sql: Sql, input: { fileName: string; fileSize: number; parentId?: string }) {
  const runtime = await getZohoTransferRuntime(sql);
  const parentId = clean(input.parentId) || runtime.rootFolderId;
  const url = new URL(`${runtime.apiDomain}/workdrive/api/v1/uploadsession/create`);
  url.searchParams.set("size", String(input.fileSize));
  url.searchParams.set("file_name", input.fileName);
  url.searchParams.set("parent_id", parentId);
  url.searchParams.set("name_conflict", "fail");

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Zoho-oauthtoken ${runtime.accessToken}`, Accept: "application/vnd.api+json" },
  });
  const payload = parseResponse(await response.text());
  if (!response.ok || payload?.errors) throw new Error(responseError(payload, response.status, "تعذر إنشاء جلسة رفع Zoho"));

  const uploadId = findString(payload, ["upload_id", "uploadId", "UPLOAD_ID"]);
  if (!uploadId) throw new Error("Zoho لم يرجع معرف جلسة رفع الملف الكبير");
  return { uploadId, parentId };
}

export async function prepareZohoUpload(sql: Sql, input: { fileName: string; fileSize: number; parentId?: string }) {
  const runtime = await getZohoTransferRuntime(sql);
  const parentId = clean(input.parentId) || runtime.rootFolderId;
  if (input.fileSize < ZOHO_CHUNK_UPLOAD_MIN_FILE_SIZE) {
    return { strategy: "standard" as const, uploadId: null, parentId };
  }
  const session = await createZohoChunkUploadSession(sql, { ...input, parentId });
  return { strategy: "chunk" as const, uploadId: session.uploadId, parentId: session.parentId };
}

export async function uploadZohoChunk(sql: Sql, input: { uploadId: string; start: number; total: number; bytes: Uint8Array }) {
  const runtime = await getZohoTransferRuntime(sql);
  const end = input.start + input.bytes.byteLength - 1;
  const uploadBody = ownedArrayBuffer(input.bytes);

  const response = await fetch(`${chunkUploadDomain(runtime)}/workdrive-api/v1/stream/upload`, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${runtime.accessToken}`,
      Accept: "application/vnd.api+json",
      "Content-Type": "application/octet-stream",
      "upload-id": input.uploadId,
      "Content-Range": `bytes ${input.start}-${end}/${input.total}`,
      "x-streammode": "1",
      "Content-Length": String(uploadBody.byteLength),
    },
    body: uploadBody,
  });
  const payload = parseResponse(await response.text());
  if (!response.ok || payload?.errors) throw new Error(responseError(payload, response.status, "تعذر رفع جزء الملف إلى Zoho"));
  return { payload, uploaded: end + 1, total: input.total };
}

export async function commitZohoChunkUpload(sql: Sql, input: { uploadId: string; parentId?: string; fileName: string }) {
  const runtime = await getZohoTransferRuntime(sql);
  const parentId = clean(input.parentId) || runtime.rootFolderId;
  const url = new URL(`${runtime.apiDomain}/workdrive/api/v1/uploadsession/commit`);
  url.searchParams.set("upload_id", input.uploadId);
  url.searchParams.set("parent_id", parentId);
  url.searchParams.set("file_name", input.fileName);
  url.searchParams.set("name_conflict", "fail");

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Zoho-oauthtoken ${runtime.accessToken}`, Accept: "application/vnd.api+json" },
  });
  const payload = parseResponse(await response.text());
  if (!response.ok || payload?.errors) throw new Error(responseError(payload, response.status, "تعذر إنهاء رفع الملف في Zoho"));

  const parsed = parseZohoUploadResult(payload);
  const resourceId = parsed.resourceId || findString(payload, ["resource_id", "resourceId", "RESOURCE_ID"]);
  if (!resourceId) throw new Error("Zoho لم يرجع معرف الملف بعد اكتمال الرفع");
  return { payload, parsed, resourceId, parentId };
}

export async function uploadZohoStandardFile(sql: Sql, input: {
  fileName: string;
  mimeType: string;
  fileSize: number;
  parentId?: string;
  parts: Uint8Array[];
}) {
  const runtime = await getZohoTransferRuntime(sql);
  const parentId = clean(input.parentId) || runtime.rootFolderId;
  const total = input.parts.reduce((sum, part) => sum + part.byteLength, 0);
  if (total !== input.fileSize) throw new Error("أجزاء الملف لا تطابق الحجم المحدد قبل الإرسال إلى Zoho");

  const form = new FormData();
  form.append("filename", encodeURIComponent(input.fileName));
  form.append("parent_id", parentId);
  form.append("override-name-exist", "false");
  form.append(
    "content",
    new Blob(input.parts.map(ownedArrayBuffer), { type: clean(input.mimeType) || "application/octet-stream" }),
    input.fileName,
  );

  const response = await fetch(`${runtime.apiDomain}/workdrive/api/v1/upload`, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${runtime.accessToken}`,
      Accept: "application/vnd.api+json",
    },
    body: form,
  });
  const payload = parseResponse(await response.text());
  if (!response.ok || payload?.errors) throw new Error(responseError(payload, response.status, "تعذر رفع الملف إلى Zoho"));

  const parsed = parseZohoUploadResult(payload);
  const resourceId = parsed.resourceId || findString(payload, ["resource_id", "resourceId", "RESOURCE_ID"]);
  if (!resourceId) throw new Error("Zoho لم يرجع معرف الملف بعد اكتمال الرفع");
  return { payload, parsed, resourceId, parentId };
}
