import type { SessionUser } from "../../_auth.js";
import { getSql } from "../../_db.js";
import { MarketingError, clean } from "../common.js";
import { decryptPlatformSecret, encryptPlatformSecret } from "./security.js";
import { isVideoFile, providerJson } from "./shared.js";
import type { PlatformConnection, PublishResult, PublishTargetContext } from "./types.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels";

export function youtubeConfigured() { return Boolean(clean(process.env.YOUTUBE_CLIENT_ID) && clean(process.env.YOUTUBE_CLIENT_SECRET)); }

export function youtubeAuthorizationUrl(redirectUri: string, state: string) {
  if (!youtubeConfigured()) throw new MarketingError(503, "بيانات تطبيق YouTube غير مضبوطة", "OAUTH_NOT_CONFIGURED");
  const scopes = (clean(process.env.YOUTUBE_SCOPES) || "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly").split(/[\s,]+/).filter(Boolean);
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", clean(process.env.YOUTUBE_CLIENT_ID));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeYouTubeCode(code: string, redirectUri: string) {
  const body = new URLSearchParams({
    code: clean(code),
    client_id: clean(process.env.YOUTUBE_CLIENT_ID),
    client_secret: clean(process.env.YOUTUBE_CLIENT_SECRET),
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  return providerJson<any>(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }, "YouTube");
}

async function channelInfo(accessToken: string) {
  const url = new URL(CHANNELS_URL);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("mine", "true");
  const payload = await providerJson<any>(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } }, "YouTube");
  const item = Array.isArray(payload.items) ? payload.items[0] : null;
  if (!item) throw new MarketingError(409, "لم يتم العثور على قناة YouTube لهذا الحساب", "YOUTUBE_CHANNEL_NOT_FOUND");
  return { id: String(item.id), title: clean(item.snippet?.title) || String(item.id) };
}

export async function saveYouTubeConnection(user: SessionUser, tokenPayload: any) {
  const accessToken = clean(tokenPayload.access_token);
  if (!accessToken) throw new MarketingError(502, "YouTube لم يرجع Access Token", "YOUTUBE_TOKEN_MISSING");
  const channel = await channelInfo(accessToken);
  const sql = getSql();
  const [platform] = await sql<any[]>`select id::text from marketing.platform_catalog where code='youtube'`;
  const expiresIn = Number(tokenPayload.expires_in || 0);
  const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  const scopes = clean(tokenPayload.scope).split(/\s+/).filter(Boolean);
  await sql`
    insert into marketing.platform_connections(platform_id,status,mode,account_id,account_name,profile_id,scopes,access_token_encrypted,refresh_token_encrypted,expires_at,last_refreshed_at,last_error,connected_by,updated_at)
    values (${platform.id}::uuid,'connected','production',${channel.id},${channel.title},${channel.id},${scopes},${encryptPlatformSecret(accessToken)},${encryptPlatformSecret(clean(tokenPayload.refresh_token))},${expiresAt},now(),null,${user.id}::uuid,now())
    on conflict(platform_id) do update set status='connected',mode='production',account_id=excluded.account_id,account_name=excluded.account_name,profile_id=excluded.profile_id,scopes=excluded.scopes,access_token_encrypted=excluded.access_token_encrypted,
      refresh_token_encrypted=coalesce(excluded.refresh_token_encrypted,marketing.platform_connections.refresh_token_encrypted),expires_at=excluded.expires_at,last_refreshed_at=now(),last_error=null,connected_by=excluded.connected_by,updated_at=now()
  `;
  return channel;
}

async function refreshYouTubeConnection(connection: PlatformConnection) {
  const refreshToken = decryptPlatformSecret(connection.refresh_token_encrypted);
  if (!refreshToken) throw new MarketingError(409, "Refresh Token الخاص بـYouTube غير موجود؛ أعد ربط الحساب", "YOUTUBE_REFRESH_TOKEN_MISSING");
  const body = new URLSearchParams({
    client_id: clean(process.env.YOUTUBE_CLIENT_ID),
    client_secret: clean(process.env.YOUTUBE_CLIENT_SECRET),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const refreshed = await providerJson<any>(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }, "YouTube");
  const accessToken = clean(refreshed.access_token);
  if (!accessToken) throw new MarketingError(502, "تعذر تجديد توكن YouTube", "YOUTUBE_REFRESH_FAILED");
  const expiresIn = Number(refreshed.expires_in || 3600);
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  const sql = getSql();
  await sql`update marketing.platform_connections set access_token_encrypted=${encryptPlatformSecret(accessToken)},expires_at=${expiresAt},last_refreshed_at=now(),last_error=null,updated_at=now() where id=${connection.id}::uuid`;
  return accessToken;
}

async function youtubeAccessToken(connection: PlatformConnection) {
  const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : 0;
  if (!connection.access_token_encrypted || (expiresAt && expiresAt < Date.now() + 120000)) return refreshYouTubeConnection(connection);
  return decryptPlatformSecret(connection.access_token_encrypted);
}

function titleFor(context: PublishTargetContext) {
  const base = clean(context.fileName).replace(/\.[a-z0-9]+$/i, "") || clean(context.caption).split("\n")[0] || "MZJ Video";
  return base.slice(0, 100);
}

export async function publishYouTube(connection: PlatformConnection, context: PublishTargetContext): Promise<PublishResult> {
  if (connection.status !== "connected") return { status: "blocked", errorMessage: "YouTube غير متصلة" };
  if (!context.mediaUrl || !isVideoFile(context.mediaUrl, context.mimeType, context.postTypeCode)) return { status: "failed", errorMessage: "YouTube يحتاج ملف فيديو نهائي" };
  const token = await youtubeAccessToken(connection);
  const mediaResponse = await fetch(context.mediaUrl);
  if (!mediaResponse.ok || !mediaResponse.body) throw new MarketingError(502, `تعذر تنزيل ملف YouTube: ${mediaResponse.status}`, "YOUTUBE_MEDIA_DOWNLOAD_FAILED");
  const contentType = context.mimeType || mediaResponse.headers.get("content-type") || "video/mp4";
  const metadata = {
    snippet: { title: titleFor(context), description: context.message, categoryId: clean(process.env.YOUTUBE_CATEGORY_ID) || "22" },
    status: { privacyStatus: context.youtubePrivacy, selfDeclaredMadeForKids: false },
  };
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": contentType,
      ...(context.fileSize > 0 ? { "X-Upload-Content-Length": String(context.fileSize) } : {}),
    },
    body: JSON.stringify(metadata),
  });
  const initPayload = await init.json().catch(() => ({}));
  if (!init.ok) throw new MarketingError(502, clean(initPayload?.error?.message) || `YouTube upload init failed: ${init.status}`, "YOUTUBE_UPLOAD_INIT_FAILED");
  const uploadUrl = init.headers.get("location");
  if (!uploadUrl) throw new MarketingError(502, "YouTube لم يرجع رابط رفع Resumable", "YOUTUBE_UPLOAD_URL_MISSING");
  const uploadOptions: RequestInit & { duplex?: "half" } = { method: "PUT", headers: { "Content-Type": contentType }, body: mediaResponse.body as any, duplex: "half" };
  const uploaded = await fetch(uploadUrl, uploadOptions);
  const payload = await uploaded.json().catch(() => ({}));
  if (!uploaded.ok || payload?.error) throw new MarketingError(502, clean(payload?.error?.message) || `YouTube upload failed: ${uploaded.status}`, "YOUTUBE_UPLOAD_FAILED");
  const videoId = clean(payload.id);
  return { status: "published", externalId: videoId || null, publishedUrl: videoId ? `https://youtu.be/${videoId}` : null, responseSummary: { id: videoId, privacyStatus: context.youtubePrivacy } };
}
