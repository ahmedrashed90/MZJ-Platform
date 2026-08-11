import type { getSql } from "./_db.js";
import { getZohoTransferRuntime, parseZohoUploadResult } from "./_zoho-workdrive.js";

type Sql = ReturnType<typeof getSql>;

type ZohoTransferRuntime = Awaited<ReturnType<typeof getZohoTransferRuntime>>;

export const ZOHO_PROXY_CHUNK_SIZE = 4 * 1024 * 1024;

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

export async function createZohoChunkUploadSession(sql: Sql, input: { fileName: string; fileSize: number; parentId?: string }) {
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

export async function uploadZohoChunk(sql: Sql, input: { uploadId: string; start: number; total: number; bytes: Uint8Array }) {
  const runtime = await getZohoTransferRuntime(sql);
  const end = input.start + input.bytes.byteLength - 1;
  const uploadBody = new ArrayBuffer(input.bytes.byteLength);
  new Uint8Array(uploadBody).set(input.bytes);

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
