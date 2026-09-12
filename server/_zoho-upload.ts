import { randomUUID } from "node:crypto";
import type { getSql } from "./_db.js";
import { getZohoTransferRuntime, parseZohoUploadResult } from "./_zoho-workdrive.js";

type Sql = ReturnType<typeof getSql>;
type ZohoTransferRuntime = Awaited<ReturnType<typeof getZohoTransferRuntime>>;

export type ZohoUploadStrategy = "standard" | "stream";

// WorkDrive documents the normal multipart endpoint for files up to 250 MB.
// Larger files use the single-request stream upload endpoint. Neither path
// requires application-level chunking or reassembly.
export const ZOHO_STANDARD_UPLOAD_MAX_FILE_SIZE = 250_000_000;

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
  return clean(first?.id || first?.code || first?.title || first?.detail || first?.message || first || payload?.message || payload?.error_description || payload?.raw) || `${fallback} (${status})`;
}

function streamUploadDomain(runtime: ZohoTransferRuntime) {
  const configured = clean(process.env.ZOHO_STREAM_UPLOAD_DOMAIN || process.env.ZOHO_CHUNK_UPLOAD_DOMAIN);
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

function safeHeaderFileName(fileName: string) {
  return encodeURIComponent(fileName.replace(/[\r\n]/g, "")).slice(0, 1800) || "file";
}

async function openSourceStream(input: { sourceUrl: string; fileSize: number }) {
  const response = await fetch(input.sourceUrl, {
    method: "GET",
    headers: { "Cache-Control": "no-store" },
  });
  if (!response.ok) throw new Error(`تعذر قراءة الملف الكامل من التخزين المؤقت (${response.status})`);
  if (!response.body) throw new Error("التخزين المؤقت لم يرجع محتوى الملف");

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > 0 && contentLength !== input.fileSize) {
    await response.body.cancel().catch(() => undefined);
    throw new Error(`حجم الملف المخزن لا يطابق الملف المختار (${contentLength} من ${input.fileSize} بايت)`);
  }
  return response.body;
}

function prefixedStream(prefix: Uint8Array, source: ReadableStream<Uint8Array>, suffix: Uint8Array) {
  const reader = source.getReader();
  let state: "prefix" | "source" | "suffix" | "done" = "prefix";
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (state === "prefix") {
        state = "source";
        controller.enqueue(prefix);
        return;
      }
      if (state === "source") {
        const next = await reader.read();
        if (!next.done) {
          controller.enqueue(next.value);
          return;
        }
        state = "suffix";
      }
      if (state === "suffix") {
        state = "done";
        controller.enqueue(suffix);
        return;
      }
      controller.close();
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}

function streamingRequest(init: RequestInit) {
  return { ...init, duplex: "half" } as RequestInit & { duplex: "half" };
}

function parsedUpload(payload: any, parentId: string) {
  const parsed = parseZohoUploadResult(payload);
  const resourceId = parsed.resourceId || findString(payload, ["resource_id", "resourceId", "RESOURCE_ID"]);
  if (!resourceId) throw new Error("Zoho لم يرجع معرف الملف بعد اكتمال الرفع");
  return { payload, parsed, resourceId, parentId };
}

async function uploadStandardWholeFile(sql: Sql, input: {
  sourceUrl: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  parentId?: string;
}) {
  const runtime = await getZohoTransferRuntime(sql);
  const parentId = clean(input.parentId) || runtime.rootFolderId;
  const source = await openSourceStream({ sourceUrl: input.sourceUrl, fileSize: input.fileSize });
  const boundary = `----MZJWorkDrive${randomUUID().replace(/-/g, "")}`;
  const encodedName = safeHeaderFileName(input.fileName);
  const mimeType = clean(input.mimeType) || "application/octet-stream";
  const encoder = new TextEncoder();
  const prefix = encoder.encode(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="filename"\r\n\r\n${encodedName}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="parent_id"\r\n\r\n${parentId}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="override-name-exist"\r\n\r\nfalse\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="content"; filename="${encodedName}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`,
  );
  const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
  const totalLength = prefix.byteLength + input.fileSize + suffix.byteLength;

  const response = await fetch(`${runtime.apiDomain}/workdrive/api/v1/upload`, streamingRequest({
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${runtime.accessToken}`,
      Accept: "application/vnd.api+json",
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(totalLength),
    },
    body: prefixedStream(prefix, source, suffix),
  }));
  const payload = parseResponse(await response.text());
  if (!response.ok || payload?.errors) throw new Error(responseError(payload, response.status, "تعذر رفع الملف الكامل إلى Zoho"));
  return parsedUpload(payload, parentId);
}

async function uploadLargeWholeFile(sql: Sql, input: {
  sourceUrl: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  parentId?: string;
  uploadId?: string | null;
}) {
  const runtime = await getZohoTransferRuntime(sql);
  const parentId = clean(input.parentId) || runtime.rootFolderId;
  const source = await openSourceStream({ sourceUrl: input.sourceUrl, fileSize: input.fileSize });
  const uploadId = clean(input.uploadId) || `mzj-${randomUUID()}`;
  const boundary = `----MZJWorkDrive${randomUUID().replace(/-/g, "")}`;
  const encodedName = safeHeaderFileName(input.fileName);
  const mimeType = clean(input.mimeType) || "application/octet-stream";
  const encoder = new TextEncoder();
  const prefix = encoder.encode(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="content"; filename="${encodedName}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`,
  );
  const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
  const totalLength = prefix.byteLength + input.fileSize + suffix.byteLength;

  const response = await fetch(`${streamUploadDomain(runtime)}/workdrive-api/v1/stream/upload`, streamingRequest({
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${runtime.accessToken}`,
      Accept: "application/vnd.api+json",
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(totalLength),
      "x-filename": encodedName,
      "x-parent_id": parentId,
      "upload-id": uploadId,
      "x-override-name-exist": "false",
      "x-streammode": "1",
    },
    body: prefixedStream(prefix, source, suffix),
  }));
  const payload = parseResponse(await response.text());
  if (!response.ok || payload?.errors) throw new Error(responseError(payload, response.status, "تعذر رفع الملف الكبير الكامل إلى Zoho"));
  return parsedUpload(payload, parentId);
}

export async function prepareZohoUpload(sql: Sql, input: { fileName: string; fileSize: number; parentId?: string }) {
  const runtime = await getZohoTransferRuntime(sql);
  const parentId = clean(input.parentId) || runtime.rootFolderId;
  const strategy: ZohoUploadStrategy = input.fileSize <= ZOHO_STANDARD_UPLOAD_MAX_FILE_SIZE ? "standard" : "stream";
  return {
    strategy,
    uploadId: strategy === "stream" ? `mzj-${randomUUID()}` : null,
    parentId,
  };
}

export async function uploadZohoWholeFile(sql: Sql, input: {
  sourceUrl: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  parentId?: string;
  strategy: ZohoUploadStrategy;
  uploadId?: string | null;
}) {
  if (!Number.isSafeInteger(input.fileSize) || input.fileSize <= 0) throw new Error("حجم الملف غير صالح");
  if (input.strategy === "stream") return uploadLargeWholeFile(sql, input);
  return uploadStandardWholeFile(sql, input);
}
