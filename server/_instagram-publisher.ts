import type { getSql } from "./_db.js";
import { createDownloadUrl } from "./_media-storage.js";
import { createInstagramImageDeliveryUrl } from "./_instagram-media-delivery.js";
import { getZohoFileInfo, getZohoRuntime } from "./_zoho-workdrive.js";
import type { MarketingPublishFormat } from "../shared/marketing-publishing.js";

type Sql = ReturnType<typeof getSql>;
type InstagramGraphMethod = "GET" | "POST";
type InstagramMediaType = "REELS" | "STORIES";

type InstagramPublishInput = {
  igId: string;
  token: string;
  caption: string;
  format: MarketingPublishFormat;
  files: any[];
};

type VideoUploadSource = {
  body: BodyInit;
  contentLength: number;
  mimeType: string;
  fileName: string;
};

class InstagramApiError extends Error {
  readonly code: number;
  readonly subcode: number;
  readonly payload: any;

  constructor(message: string, payload: any = {}) {
    super(message);
    this.name = "InstagramApiError";
    this.code = Number(payload?.error?.code || payload?.code || 0) || 0;
    this.subcode = Number(payload?.error?.error_subcode || payload?.error_subcode || 0) || 0;
    this.payload = payload;
  }
}

function clean(value: unknown) { return String(value ?? "").trim(); }
function graphVersion() { return clean(process.env.META_GRAPH_VERSION) || "v25.0"; }
function sleep(milliseconds: number) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}
function looksVideo(file: any) {
  return /video|mp4|mov|webm/i.test(`${file?.mime_type || ""} ${file?.original_name || ""}`);
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
function parseJson(raw: string) {
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
function metaErrorMessage(payload: any, fallback: string) {
  return clean(
    payload?.error?.error_user_msg
    || payload?.error?.message
    || payload?.debug_info?.message
    || payload?.message
    || fallback,
  );
}
function resumableUploadMessage(payload: any, status: number) {
  const rawMessage = metaErrorMessage(payload, `تعذر رفع فيديو Instagram (${status})`);
  const nested = parseJson(rawMessage);
  return metaErrorMessage(nested, rawMessage);
}
function processingFailureMessage(statusText: string, label: string) {
  const text = clean(statusText);
  if (/2207076/.test(text)) {
    return `فشلت معالجة ${label} على Instagram بعد رفع الملف مباشرة إلى Meta. راجع أن الفيديو MP4 بترميز H.264 وصوت AAC ومعدل إطارات ثابت، ثم أعد المحاولة`;
  }
  return text ? `فشلت معالجة ${label} على Instagram: ${text}` : `فشلت معالجة ${label} على Instagram`;
}
function isMediaNotReady(error: unknown) {
  const value = error as InstagramApiError;
  const message = clean(value?.message).toLowerCase();
  return value?.code === 9007 || value?.subcode === 2207008 || message.includes("media id is not available") || message.includes("media is not ready");
}

async function graphRequest(path: string, method: InstagramGraphMethod, token: string, params: Record<string, any> = {}) {
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
    throw new InstagramApiError(metaErrorMessage(payload, `Instagram API error ${response.status}`), payload);
  }
  return payload;
}

async function openVideoUploadSource(sql: Sql, file: any): Promise<VideoUploadSource> {
  let response: Response;
  if (clean(file.storage_provider) === "zoho") {
    const externalId = clean(file.external_id);
    if (!externalId) throw new Error(`معرف ملف Zoho ${clean(file.original_name) || ""} غير موجود`);
    const runtime = await getZohoRuntime(sql);
    const info = await getZohoFileInfo(sql, externalId);
    const downloadUrl = clean(info.downloadUrl) || `${runtime.uploadDomain}/v1/workdrive/download/${encodeURIComponent(externalId)}`;
    response = await fetch(downloadUrl, {
      redirect: "follow",
      headers: { Authorization: `Zoho-oauthtoken ${runtime.accessToken}`, Accept: "application/octet-stream,*/*" },
    });
  } else {
    const storageKey = clean(file.storage_key);
    if (!storageKey) throw new Error(`مسار الملف النهائي ${clean(file.original_name) || ""} غير موجود`);
    response = await fetch(createDownloadUrl(storageKey, 7200), {
      redirect: "follow",
      headers: { Accept: "application/octet-stream,*/*" },
    });
  }
  if (!response.ok) {
    const message = clean(await response.text().catch(() => ""));
    throw new Error(message || `تعذر تنزيل ملف الفيديو ${clean(file.original_name) || ""} (${response.status})`);
  }
  const responseContentType = clean(response.headers.get("content-type")).split(";")[0].trim().toLowerCase();
  if (responseContentType.includes("application/json") || responseContentType.includes("text/html")) {
    throw new Error(`مزود التخزين لم يرجع محتوى الفيديو الفعلي ${clean(file.original_name) || ""}`);
  }
  const mimeType = videoMimeType(file, responseContentType);
  if (!mimeType.startsWith("video/")) {
    throw new Error(`الملف ${clean(file.original_name) || ""} ليس فيديو صالحًا للنشر على Instagram`);
  }
  const contentLength = positiveInteger(response.headers.get("content-length")) || positiveInteger(file.file_size);
  const fileName = clean(file.original_name) || "instagram-video";
  if (response.body && contentLength) return { body: response.body as BodyInit, contentLength, mimeType, fileName };
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.byteLength) throw new Error(`ملف الفيديو ${fileName} فارغ`);
  return { body: bytes as BodyInit, contentLength: bytes.byteLength, mimeType, fileName };
}

async function uploadVideoToInstagram(containerId: string, token: string, source: VideoUploadSource) {
  const request: RequestInit & { duplex: "half" } = {
    method: "POST",
    redirect: "manual",
    headers: {
      Authorization: `OAuth ${token}`,
      offset: "0",
      file_size: String(source.contentLength),
      "Content-Type": source.mimeType,
      "Content-Length": String(source.contentLength),
    },
    body: source.body,
    duplex: "half",
  };
  const response = await fetch(`https://rupload.facebook.com/ig-api-upload/${graphVersion()}/${encodeURIComponent(containerId)}`, request);
  const raw = await response.text().catch(() => "");
  const payload = parseJson(raw);
  if (!response.ok || payload?.success === false || payload?.error || payload?.debug_info) {
    throw new Error(resumableUploadMessage(payload, response.status));
  }
  if (payload?.success !== true) throw new Error("Meta لم تؤكد اكتمال رفع فيديو Instagram");
  return payload;
}

async function waitForContainer(containerId: string, token: string, label: string) {
  const configuredTimeout = positiveInteger(process.env.INSTAGRAM_MEDIA_READY_TIMEOUT_MS);
  const timeoutMs = Math.min(105_000, Math.max(30_000, configuredTimeout || 90_000));
  const configuredInterval = positiveInteger(process.env.INSTAGRAM_MEDIA_READY_POLL_MS);
  const intervalMs = Math.min(10_000, Math.max(1_500, configuredInterval || 3_000));
  const startedAt = Date.now();
  let lastStatus: any = {};

  while (Date.now() - startedAt < timeoutMs) {
    lastStatus = await graphRequest(`/${containerId}`, "GET", token, { fields: "status_code,status" });
    const statusCode = clean(lastStatus?.status_code).toUpperCase();
    if (statusCode === "FINISHED" || statusCode === "PUBLISHED") return lastStatus;
    if (statusCode === "ERROR" || statusCode === "EXPIRED") {
      throw new Error(processingFailureMessage(clean(lastStatus?.status || statusCode), label));
    }
    await sleep(intervalMs);
  }

  const detail = clean(lastStatus?.status || lastStatus?.status_code);
  throw new Error(`انتهت مهلة انتظار معالجة ${label} على Instagram${detail ? `: ${detail}` : ""}`);
}

async function publishReadyContainer(igId: string, containerId: string, token: string, label: string) {
  const ready = await waitForContainer(containerId, token, label);
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const publish = await graphRequest(`/${igId}/media_publish`, "POST", token, { creation_id: containerId });
      return { ready, publish };
    } catch (error) {
      lastError = error;
      if (!isMediaNotReady(error) || attempt === 3) throw error;
      await sleep(3_000);
      await waitForContainer(containerId, token, label);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`تعذر نشر ${label} على Instagram`);
}

async function publishVideo(
  sql: Sql,
  input: { igId: string; token: string; caption: string; file: any; mediaType: InstagramMediaType; shareToFeed?: boolean; label: string },
) {
  const params: Record<string, any> = {
    media_type: input.mediaType,
    upload_type: "resumable",
  };
  if (input.mediaType === "REELS") {
    params.caption = input.caption;
    params.share_to_feed = input.shareToFeed !== false;
  }
  const create = await graphRequest(`/${input.igId}/media`, "POST", input.token, params);
  const creationId = clean(create?.id || create?.creation_id);
  if (!creationId) throw new Error(`تعذر إنشاء حاوية ${input.label} على Instagram`);
  const source = await openVideoUploadSource(sql, input.file);
  const upload = await uploadVideoToInstagram(creationId, input.token, source);
  const { ready, publish } = await publishReadyContainer(input.igId, creationId, input.token, input.label);
  return { create, upload, ready, publish, creationId, fileName: source.fileName, uploadMode: "resumable_binary" };
}

async function publishImageStory(igId: string, token: string, file: any, label: string) {
  const imageUrl = createInstagramImageDeliveryUrl(file);
  const create = await graphRequest(`/${igId}/media`, "POST", token, { media_type: "STORIES", image_url: imageUrl });
  const creationId = clean(create?.id || create?.creation_id);
  if (!creationId) throw new Error(`تعذر إنشاء ${label} على Instagram`);
  const { ready, publish } = await publishReadyContainer(igId, creationId, token, label);
  return { create, ready, publish, creationId };
}

async function publishSingleImage(igId: string, token: string, caption: string, file: any) {
  const imageUrl = createInstagramImageDeliveryUrl(file);
  const create = await graphRequest(`/${igId}/media`, "POST", token, { caption, image_url: imageUrl });
  const creationId = clean(create?.id || create?.creation_id);
  if (!creationId) throw new Error("تعذر إنشاء بوست صور على Instagram");
  const { ready, publish } = await publishReadyContainer(igId, creationId, token, "بوست الصور");
  return { create, ready, publish, creationId };
}

async function publishCarousel(igId: string, token: string, caption: string, files: any[]) {
  if (files.length < 2 || files.length > 10) throw new Error("Carousel على Instagram يتطلب من صورتين إلى 10 صور");
  const children: Array<{ create: any; ready: any; creationId: string }> = [];
  for (const file of files) {
    const imageUrl = createInstagramImageDeliveryUrl(file);
    const create = await graphRequest(`/${igId}/media`, "POST", token, { image_url: imageUrl, is_carousel_item: true });
    const creationId = clean(create?.id || create?.creation_id);
    if (!creationId) throw new Error("تعذر تجهيز إحدى صور Carousel على Instagram");
    const ready = await waitForContainer(creationId, token, "إحدى صور Carousel");
    children.push({ create, ready, creationId });
  }
  const create = await graphRequest(`/${igId}/media`, "POST", token, {
    media_type: "CAROUSEL",
    children: children.map((item) => item.creationId).join(","),
    caption,
  });
  const creationId = clean(create?.id || create?.creation_id);
  if (!creationId) throw new Error("تعذر إنشاء Carousel على Instagram");
  const { ready, publish } = await publishReadyContainer(igId, creationId, token, "Carousel");
  return { children, create, ready, publish, creationId };
}

export async function publishInstagramContent(sql: Sql, input: InstagramPublishInput) {
  const files = Array.isArray(input.files) ? input.files : [];
  if (!files.length) throw new Error("ملفات Instagram غير موجودة");

  if (input.format === "story") {
    const stories = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const label = files.length > 1 ? `Story رقم ${index + 1}` : "Story";
      if (looksVideo(file)) {
        stories.push(await publishVideo(sql, {
          igId: input.igId,
          token: input.token,
          caption: "",
          file,
          mediaType: "STORIES",
          label,
        }));
      } else {
        stories.push(await publishImageStory(input.igId, input.token, file, label));
      }
    }
    const first = stories[0] || {};
    return { stories, publish: first.publish, id: clean(first.publish?.id), batchCount: stories.length };
  }

  if (input.format === "reel" || input.format === "short" || input.format === "video") {
    return publishVideo(sql, {
      igId: input.igId,
      token: input.token,
      caption: input.caption,
      file: files[0],
      mediaType: "REELS",
      shareToFeed: true,
      label: "Reel",
    });
  }

  if (files.length > 1) return publishCarousel(input.igId, input.token, input.caption, files);
  return publishSingleImage(input.igId, input.token, input.caption, files[0]);
}
