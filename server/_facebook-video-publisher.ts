import type { getSql } from "./_db.js";
import { createDownloadUrl } from "./_media-storage.js";
import { getZohoFileInfo, getZohoRuntime } from "./_zoho-workdrive.js";

type Sql = ReturnType<typeof getSql>;
type GraphMethod = "GET" | "POST";
type FacebookVideoKind = "Reel" | "Story";

type FacebookVideoPublishInput = {
  pageId: string;
  token: string;
  file: any;
  caption?: string;
};

type VideoUploadSource = {
  body: BodyInit;
  contentLength: number;
  mimeType: string;
  fileName: string;
};

class FacebookApiError extends Error {
  readonly status: number;
  readonly code: number;
  readonly subcode: number;
  readonly payload: any;

  constructor(message: string, status: number, payload: any = {}) {
    super(message);
    this.name = "FacebookApiError";
    this.status = status;
    this.code = Number(payload?.error?.code || payload?.code || 0) || 0;
    this.subcode = Number(payload?.error?.error_subcode || payload?.error_subcode || 0) || 0;
    this.payload = payload;
  }
}

function clean(value: unknown) { return String(value ?? "").trim(); }
function graphVersion() { return clean(process.env.META_GRAPH_VERSION) || "v25.0"; }
function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}
function parseJson(raw: string) {
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
function nestedJson(value: unknown) {
  const text = clean(value);
  if (!text || (!text.startsWith("{") && !text.startsWith("["))) return null;
  const parsed = parseJson(text);
  return parsed && typeof parsed === "object" ? parsed : null;
}
function facebookErrorMessage(payload: any, status: number, fallback: string) {
  const error = payload?.error || {};
  const nested = nestedJson(error?.message || payload?.message);
  const nestedError = nested?.error || nested || {};
  const userTitle = clean(error?.error_user_title || nestedError?.error_user_title);
  const primary = clean(
    error?.error_user_msg
    || nestedError?.error_user_msg
    || error?.message
    || nestedError?.message
    || payload?.debug_info?.message
    || payload?.message
    || fallback,
  );
  const details: string[] = [];
  const code = Number(error?.code || nestedError?.code || payload?.code || 0) || 0;
  const subcode = Number(error?.error_subcode || nestedError?.error_subcode || payload?.error_subcode || 0) || 0;
  const type = clean(error?.type || nestedError?.type || payload?.debug_info?.type);
  const trace = clean(error?.fbtrace_id || nestedError?.fbtrace_id || payload?.fbtrace_id);
  if (status) details.push(`HTTP ${status}`);
  if (code) details.push(`code ${code}`);
  if (subcode) details.push(`subcode ${subcode}`);
  if (type) details.push(type);
  if (trace) details.push(`trace ${trace}`);
  const titled = userTitle && !primary.includes(userTitle) ? `${userTitle}: ${primary}` : primary;
  return details.length ? `${titled} [Meta ${details.join(" | ")}]` : titled;
}

async function graphRequest(path: string, method: GraphMethod, token: string, params: Record<string, any> = {}) {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}${path}`);
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    if (method === "GET") url.searchParams.set(key, text);
    else body.set(key, text);
  }
  if (method === "GET") url.searchParams.set("access_token", token);
  else body.set("access_token", token);
  const response = await fetch(url.toString(), { method, body: method === "POST" ? body : undefined });
  const raw = await response.text().catch(() => "");
  const payload = parseJson(raw);
  if (!response.ok || payload?.error) {
    throw new FacebookApiError(
      facebookErrorMessage(payload, response.status, `Facebook API error ${response.status}`),
      response.status,
      payload,
    );
  }
  return payload;
}

function videoMimeType(file: any, responseContentType: unknown) {
  const responseType = clean(responseContentType).split(";")[0].trim().toLowerCase();
  const storedType = clean(file?.mime_type).split(";")[0].trim().toLowerCase();
  if (responseType.startsWith("video/")) return responseType;
  if (storedType.startsWith("video/")) return storedType;
  const extension = clean(file?.original_name).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
  const mapped: Record<string, string> = {
    mp4: "video/mp4",
    m4v: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
    mpeg: "video/mpeg",
    mpg: "video/mpeg",
  };
  return mapped[extension] || "application/octet-stream";
}

async function openVideoUploadSource(sql: Sql, file: any): Promise<VideoUploadSource> {
  let response: Response;
  if (clean(file?.storage_provider) === "zoho") {
    const externalId = clean(file?.external_id);
    if (!externalId) throw new Error(`معرف ملف Zoho ${clean(file?.original_name) || ""} غير موجود`);
    const runtime = await getZohoRuntime(sql);
    const info = await getZohoFileInfo(sql, externalId);
    const downloadUrl = clean(info.downloadUrl) || `${runtime.uploadDomain}/v1/workdrive/download/${encodeURIComponent(externalId)}`;
    response = await fetch(downloadUrl, {
      redirect: "follow",
      headers: { Authorization: `Zoho-oauthtoken ${runtime.accessToken}`, Accept: "application/octet-stream,*/*" },
    });
  } else {
    const storageKey = clean(file?.storage_key);
    if (!storageKey) throw new Error(`مسار الملف النهائي ${clean(file?.original_name) || ""} غير موجود`);
    response = await fetch(createDownloadUrl(storageKey, 7200), {
      redirect: "follow",
      headers: { Accept: "application/octet-stream,*/*" },
    });
  }

  if (!response.ok) {
    const detail = clean(await response.text().catch(() => ""));
    throw new Error(detail || `تعذر تنزيل فيديو Facebook ${clean(file?.original_name) || ""} (${response.status})`);
  }
  const responseContentType = clean(response.headers.get("content-type")).split(";")[0].trim().toLowerCase();
  if (responseContentType.includes("application/json") || responseContentType.includes("text/html")) {
    throw new Error(`مزود التخزين لم يرجع محتوى الفيديو الفعلي ${clean(file?.original_name) || ""}`);
  }
  const mimeType = videoMimeType(file, responseContentType);
  if (!mimeType.startsWith("video/")) {
    throw new Error(`الملف ${clean(file?.original_name) || ""} ليس فيديو صالحًا للنشر على Facebook`);
  }

  const contentLength = positiveInteger(response.headers.get("content-length")) || positiveInteger(file?.file_size);
  const fileName = clean(file?.original_name) || "facebook-video";
  if (response.body && contentLength) {
    return { body: response.body as BodyInit, contentLength, mimeType, fileName };
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.byteLength) throw new Error(`ملف الفيديو ${fileName} فارغ`);
  return { body: bytes as BodyInit, contentLength: bytes.byteLength, mimeType, fileName };
}

async function uploadVideoBinary(uploadUrl: string, token: string, source: VideoUploadSource, kind: FacebookVideoKind) {
  const request: RequestInit & { duplex: "half" } = {
    method: "POST",
    redirect: "manual",
    headers: {
      Authorization: `OAuth ${token}`,
      offset: "0",
      file_size: String(source.contentLength),
      "Content-Type": "application/octet-stream",
      "Content-Length": String(source.contentLength),
    },
    body: source.body,
    duplex: "half",
  };
  const response = await fetch(uploadUrl, request);
  const raw = await response.text().catch(() => "");
  const payload = parseJson(raw);
  if (!response.ok || payload?.success === false || payload?.error || payload?.debug_info) {
    throw new FacebookApiError(
      facebookErrorMessage(payload, response.status, `تعذر رفع فيديو ${kind} على Facebook (${response.status})`),
      response.status,
      payload,
    );
  }
  if (payload?.success !== true) {
    throw new Error(`Meta لم تؤكد اكتمال رفع فيديو ${kind} على Facebook`);
  }
  return payload;
}

async function startVideoUpload(pageId: string, token: string, endpoint: "video_reels" | "video_stories", kind: FacebookVideoKind) {
  const start = await graphRequest(`/${pageId}/${endpoint}`, "POST", token, { upload_phase: "start" });
  const videoId = clean(start?.video_id || start?.id);
  const uploadUrl = clean(start?.upload_url || start?.uploadUrl);
  if (!videoId || !uploadUrl) throw new Error(`تعذر بدء رفع فيديو ${kind} على Facebook`);
  return { start, videoId, uploadUrl };
}

export async function publishFacebookReel(sql: Sql, input: FacebookVideoPublishInput) {
  const { start, videoId, uploadUrl } = await startVideoUpload(input.pageId, input.token, "video_reels", "Reel");
  const source = await openVideoUploadSource(sql, input.file);
  const upload = await uploadVideoBinary(uploadUrl, input.token, source, "Reel");
  const publish = await graphRequest(`/${input.pageId}/video_reels`, "POST", input.token, {
    upload_phase: "finish",
    video_id: videoId,
    video_state: "PUBLISHED",
    description: clean(input.caption),
  });
  return { start, upload, publish, video_id: videoId, uploadMode: "resumable_binary" };
}

export async function publishFacebookVideoStory(sql: Sql, input: FacebookVideoPublishInput) {
  const { start, videoId, uploadUrl } = await startVideoUpload(input.pageId, input.token, "video_stories", "Story");
  const source = await openVideoUploadSource(sql, input.file);
  const upload = await uploadVideoBinary(uploadUrl, input.token, source, "Story");
  const publish = await graphRequest(`/${input.pageId}/video_stories`, "POST", input.token, {
    upload_phase: "finish",
    video_id: videoId,
  });
  return { start, upload, publish, video_id: videoId, uploadMode: "resumable_binary" };
}
