import type { getSql } from "./_db.js";
import { createDownloadUrl } from "./_media-storage.js";
import { getYouTubeAccessToken } from "./_platform-connections.js";
import { getZohoFileInfo, getZohoRuntime } from "./_zoho-workdrive.js";
import type { YouTubePublishOptions } from "../shared/youtube-publishing.js";

type Sql = ReturnType<typeof getSql>;
type UploadSource = { body: BodyInit; contentLength: number; mimeType: string };

const YOUTUBE_PLAYLIST_SCOPES = new Set([
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/youtubepartner",
]);

function clean(value: unknown) { return String(value ?? "").trim(); }
function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}
function connectionScopes(connection: any) {
  if (Array.isArray(connection?.scopes)) return connection.scopes.map(clean).filter(Boolean);
  return clean(connection?.scopes).split(/[\s,]+/).map(clean).filter(Boolean);
}
function canInsertPlaylistItem(connection: any) {
  return connectionScopes(connection).some((scope: string) => YOUTUBE_PLAYLIST_SCOPES.has(scope));
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

async function openUploadSource(sql: Sql, file: any): Promise<UploadSource> {
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
  const contentLength = positiveInteger(response.headers.get("content-length")) || positiveInteger(file.file_size);
  if (response.body && contentLength) return { body: response.body as BodyInit, contentLength, mimeType };
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.byteLength) throw new Error(`ملف الفيديو ${clean(file.original_name) || ""} فارغ`);
  return { body: bytes as BodyInit, contentLength: bytes.byteLength, mimeType };
}

async function apiError(response: Response, action: string) {
  const raw = clean(await response.text().catch(() => ""));
  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
  const reason = clean(payload?.error?.errors?.[0]?.reason || payload?.error?.status);
  const providerMessage = clean(payload?.error?.message || payload?.message);
  const reasonMessages: Record<string, string> = {
    insufficientPermissions: "صلاحيات قناة YouTube غير كافية. أعد ربط القناة ووافق على كل الصلاحيات المطلوبة",
    uploadLimitExceeded: "تم تجاوز حد رفع الفيديوهات المسموح به في قناة YouTube",
    quotaExceeded: "تم استهلاك حصة YouTube API المسموح بها للمشروع",
    dailyLimitExceeded: "تم استهلاك الحد اليومي لـYouTube API",
    invalidCategoryId: "تصنيف فيديو YouTube المحدد غير صالح",
    invalidTitle: "عنوان فيديو YouTube غير صالح",
    invalidDescription: "وصف فيديو YouTube غير صالح",
    invalidTags: "الكلمات المفتاحية لفيديو YouTube غير صالحة",
    forbiddenPrivacySetting: "إعداد خصوصية فيديو YouTube غير مسموح لهذه القناة",
    forbiddenLicenseSetting: "إعداد ترخيص فيديو YouTube غير مسموح لهذه القناة",
    playlistItemsNotAccessible: "قائمة تشغيل YouTube المحددة غير متاحة للحساب المربوط",
  };
  return new Error(reasonMessages[reason] || providerMessage || `${action} (${response.status})`);
}

async function addToPlaylist(accessToken: string, playlistId: string, videoId: string) {
  const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  url.searchParams.set("part", "snippet");
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } } }),
  });
  if (!response.ok) throw await apiError(response, "تم رفع الفيديو لكن تعذرت إضافته إلى قائمة التشغيل");
  return response.json().catch(() => ({}));
}

export async function publishYouTubeVideo(sql: Sql, file: any, options: YouTubePublishOptions) {
  const { accessToken, connection } = await getYouTubeAccessToken(sql);
  if (options.playlistId && !canInsertPlaylistItem(connection)) {
    throw new Error("إضافة الفيديو إلى قائمة تشغيل تحتاج إعادة ربط YouTube والموافقة على صلاحية إدارة القوائم");
  }
  const source = await openUploadSource(sql, file);
  const metadata = {
    snippet: {
      title: options.title,
      description: options.description,
      ...(options.tags.length ? { tags: options.tags } : {}),
      categoryId: options.categoryId,
      defaultLanguage: options.defaultLanguage,
    },
    status: {
      privacyStatus: options.privacyStatus,
      embeddable: options.embeddable,
      license: options.license,
      publicStatsViewable: options.publicStatsViewable,
      selfDeclaredMadeForKids: options.madeForKids,
    },
  };
  const startUrl = new URL("https://www.googleapis.com/upload/youtube/v3/videos");
  startUrl.searchParams.set("uploadType", "resumable");
  startUrl.searchParams.set("part", "snippet,status");
  startUrl.searchParams.set("notifySubscribers", String(options.notifySubscribers));
  const startResponse = await fetch(startUrl.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(source.contentLength),
      "X-Upload-Content-Type": source.mimeType,
    },
    body: JSON.stringify(metadata),
  });
  if (!startResponse.ok) throw await apiError(startResponse, "تعذر بدء رفع الفيديو إلى YouTube");
  const uploadUrl = clean(startResponse.headers.get("location"));
  if (!uploadUrl) throw new Error("YouTube لم يرجع رابط جلسة رفع الفيديو");
  const uploadRequest: RequestInit & { duplex: "half" } = {
    method: "PUT",
    redirect: "manual",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": source.mimeType,
      "Content-Length": String(source.contentLength),
    },
    body: source.body,
    duplex: "half",
  };
  const uploadResponse = await fetch(uploadUrl, uploadRequest);
  if (!uploadResponse.ok) throw await apiError(uploadResponse, "تعذر رفع الفيديو إلى YouTube");
  const video = await uploadResponse.json().catch(() => ({}));
  const videoId = clean((video as any)?.id);
  if (!videoId) throw new Error("اكتمل رفع الفيديو لكن YouTube لم يرجع معرف الفيديو");
  const playlist = options.playlistId ? await addToPlaylist(accessToken, options.playlistId, videoId) : null;
  return { id: videoId, video, playlist, url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` };
}
