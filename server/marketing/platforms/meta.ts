import crypto from "node:crypto";
import type { SessionUser } from "../../_auth.js";
import { getSql } from "../../_db.js";
import { MarketingError, clean } from "../common.js";
import { decryptPlatformSecret, encryptPlatformSecret } from "./security.js";
import { isVideoFile, normalizePostType, providerJson } from "./shared.js";
import type { PlatformAccountOption, PlatformConnection, PublishResult, PublishTargetContext } from "./types.js";

const GRAPH_VERSION = clean(process.env.META_GRAPH_VERSION) || "v20.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

function appSecretProof(token: string) {
  const secret = clean(process.env.META_APP_SECRET);
  return secret && token ? crypto.createHmac("sha256", secret).update(token).digest("hex") : "";
}

function appendParam(body: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null || value === "") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => body.append(`${key}[${index}]`, typeof item === "object" ? JSON.stringify(item) : String(item)));
  } else if (typeof value === "object") body.set(key, JSON.stringify(value));
  else body.set(key, String(value));
}

async function graphGet(path: string, params: Record<string, unknown>, token: string) {
  const url = new URL(`${GRAPH_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => value !== undefined && value !== null && value !== "" && url.searchParams.set(key, String(value)));
  url.searchParams.set("access_token", token);
  const proof = appSecretProof(token);
  if (proof) url.searchParams.set("appsecret_proof", proof);
  return providerJson<any>(url.toString(), {}, "Meta");
}

async function graphPost(path: string, params: Record<string, unknown>, token: string) {
  const body = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => appendParam(body, key, value));
  body.set("access_token", token);
  const proof = appSecretProof(token);
  if (proof) body.set("appsecret_proof", proof);
  return providerJson<any>(`${GRAPH_BASE}${path}`, { method: "POST", body }, "Meta");
}

export function metaConfigured() { return Boolean(clean(process.env.META_APP_ID) && clean(process.env.META_APP_SECRET)); }

export function metaAuthorizationUrl(redirectUri: string, state: string) {
  if (!metaConfigured()) throw new MarketingError(503, "بيانات تطبيق Meta غير مضبوطة", "OAUTH_NOT_CONFIGURED");
  const scopes = (clean(process.env.META_SCOPES) || "public_profile,pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_metadata,instagram_basic,instagram_content_publish").split(",").map((item) => item.trim()).filter(Boolean);
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", clean(process.env.META_APP_ID));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(","));
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeMetaCode(code: string, redirectUri: string) {
  const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set("client_id", clean(process.env.META_APP_ID));
  url.searchParams.set("client_secret", clean(process.env.META_APP_SECRET));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", clean(code));
  const shortToken = await providerJson<any>(url.toString(), {}, "Meta");
  let token = clean(shortToken.access_token);
  if (!token) throw new MarketingError(502, "Meta لم يرجع Access Token", "META_TOKEN_MISSING");
  const longUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", clean(process.env.META_APP_ID));
  longUrl.searchParams.set("client_secret", clean(process.env.META_APP_SECRET));
  longUrl.searchParams.set("fb_exchange_token", token);
  try {
    const longToken = await providerJson<any>(longUrl.toString(), {}, "Meta");
    token = clean(longToken.access_token) || token;
    return { accessToken: token, expiresIn: Number(longToken.expires_in || shortToken.expires_in || 0) };
  } catch {
    return { accessToken: token, expiresIn: Number(shortToken.expires_in || 0) };
  }
}

async function rawPages(userToken: string) {
  const payload = await graphGet("/me/accounts", { fields: "id,name,access_token,category,link,instagram_business_account{id,username,name}", limit: 100 }, userToken);
  return Array.isArray(payload.data) ? payload.data : [];
}

export async function listMetaAccounts(connection: PlatformConnection): Promise<PlatformAccountOption[]> {
  const token = decryptPlatformSecret(connection.access_token_encrypted);
  if (!token) throw new MarketingError(409, "Meta غير متصلة", "PLATFORM_NOT_CONNECTED");
  const pages = await rawPages(token);
  return pages.map((page: any) => ({ id: String(page.id), name: clean(page.name) || String(page.id), category: clean(page.category) || null, instagram: page.instagram_business_account ? { id: String(page.instagram_business_account.id), username: clean(page.instagram_business_account.username) || null, name: clean(page.instagram_business_account.name) || null } : null }));
}

export async function saveMetaOAuthConnection(user: SessionUser, accessToken: string, expiresIn: number) {
  const sql = getSql();
  const [facebook] = await sql<any[]>`select id::text from marketing.platform_catalog where code='facebook'`;
  const [instagram] = await sql<any[]>`select id::text from marketing.platform_catalog where code='instagram'`;
  const pages = await rawPages(accessToken);
  const expiry = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  const scopes = (clean(process.env.META_SCOPES) || "public_profile,pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_metadata,instagram_basic,instagram_content_publish").split(",").map((item) => item.trim()).filter(Boolean);
  await sql`
    insert into marketing.platform_connections(platform_id,status,mode,account_name,scopes,access_token_encrypted,expires_at,last_refreshed_at,last_error,connected_by,updated_at)
    values (${facebook.id}::uuid,${pages.length === 1 ? "connected" : "account_selection_required"},'production',${pages.length === 1 ? clean(pages[0]?.name) : "اختر صفحة Facebook"},${scopes},${encryptPlatformSecret(accessToken)},${expiry},now(),null,${user.id}::uuid,now())
    on conflict(platform_id) do update set status=excluded.status,mode='production',account_name=excluded.account_name,scopes=excluded.scopes,access_token_encrypted=excluded.access_token_encrypted,expires_at=excluded.expires_at,last_refreshed_at=now(),last_error=null,connected_by=excluded.connected_by,updated_at=now()
  `;
  if (pages.length === 1) await selectMetaPage(user, String(pages[0].id));
  else if (instagram) await sql`
    insert into marketing.platform_connections(platform_id,status,mode,connected_by,updated_at)
    values (${instagram.id}::uuid,'account_selection_required','production',${user.id}::uuid,now())
    on conflict(platform_id) do update set status='account_selection_required',account_id=null,account_name=null,profile_id=null,access_token_encrypted=null,refresh_token_encrypted=null,last_error=null,connected_by=${user.id}::uuid,updated_at=now()
  `;
  return { pages: pages.length };
}

export async function selectMetaPage(user: SessionUser, pageId: string) {
  const sql = getSql();
  const [fb] = await sql<any[]>`
    select c.*,c.id::text,p.id::text platform_id,p.code platform_code,p.name platform_name
    from marketing.platform_connections c join marketing.platform_catalog p on p.id=c.platform_id where p.code='facebook'
  `;
  if (!fb) throw new MarketingError(409, "ابدأ ربط Meta أولًا", "PLATFORM_NOT_CONNECTED");
  const userToken = decryptPlatformSecret(fb.access_token_encrypted);
  const pages = await rawPages(userToken);
  const page = pages.find((item: any) => String(item.id) === clean(pageId));
  if (!page) throw new MarketingError(404, "صفحة Facebook غير متاحة لهذا الحساب", "ACCOUNT_NOT_FOUND");
  const pageToken = clean(page.access_token) || userToken;
  const ig = page.instagram_business_account || null;
  const [facebook] = await sql<any[]>`select id::text from marketing.platform_catalog where code='facebook'`;
  const [instagram] = await sql<any[]>`select id::text from marketing.platform_catalog where code='instagram'`;
  await sql.begin(async (tx) => {
    await tx`
      update marketing.platform_connections set status='connected',account_id=${String(page.id)},account_name=${clean(page.name)},profile_id=null,
        access_token_encrypted=${encryptPlatformSecret(pageToken)},last_refreshed_at=now(),last_error=null,connected_by=${user.id}::uuid,updated_at=now()
      where platform_id=${facebook.id}::uuid
    `;
    await tx`
      insert into marketing.platform_connections(platform_id,status,mode,account_id,account_name,profile_id,scopes,access_token_encrypted,last_refreshed_at,last_error,connected_by,updated_at)
      values (${instagram.id}::uuid,${ig ? "connected" : "missing_instagram_business"},'production',${ig ? String(ig.id) : null},${ig ? clean(ig.username || ig.name) : null},${ig ? String(ig.id) : null},${fb.scopes || []},${ig ? encryptPlatformSecret(pageToken) : null},now(),${ig ? null : "لا يوجد Instagram Business Account مرتبط بالصفحة"},${user.id}::uuid,now())
      on conflict(platform_id) do update set status=excluded.status,mode='production',account_id=excluded.account_id,account_name=excluded.account_name,profile_id=excluded.profile_id,scopes=excluded.scopes,access_token_encrypted=excluded.access_token_encrypted,last_refreshed_at=now(),last_error=excluded.last_error,connected_by=excluded.connected_by,updated_at=now()
    `;
  });
  return { id: String(page.id), name: clean(page.name), instagram: ig ? { id: String(ig.id), username: clean(ig.username || ig.name) } : null };
}

async function waitInstagramContainer(creationId: string, token: string) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const state = await graphGet(`/${creationId}`, { fields: "status_code,status" }, token);
    const code = clean(state.status_code || state.status).toUpperCase();
    if (["FINISHED", "PUBLISHED"].includes(code)) return;
    if (["ERROR", "EXPIRED"].includes(code)) throw new MarketingError(502, `Instagram container status: ${code}`, "INSTAGRAM_CONTAINER_FAILED");
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

export async function publishMeta(connection: PlatformConnection, context: PublishTargetContext): Promise<PublishResult> {
  const token = decryptPlatformSecret(connection.access_token_encrypted);
  if (!token || connection.status !== "connected") return { status: "blocked", errorMessage: `${context.platformName} غير متصلة` };
  const postType = normalizePostType(context.postTypeCode || context.postTypeName);
  const isVideo = isVideoFile(context.mediaUrl, context.mimeType, postType);

  if (context.platformCode === "facebook") {
    const pageId = clean(connection.account_id);
    if (!pageId) return { status: "blocked", errorMessage: "لم يتم اختيار صفحة Facebook" };
    let result: any;
    if (postType.includes("story")) {
      if (!context.mediaUrl) return { status: "failed", errorMessage: "Facebook Story تحتاج ملفًا نهائيًا" };
      if (isVideo) {
        const start = await graphPost(`/${pageId}/video_stories`, { upload_phase: "start" }, token);
        const uploadUrl = clean(start.upload_url);
        const videoId = clean(start.video_id || start.id);
        if (!uploadUrl || !videoId) throw new MarketingError(502, "لم يبدأ رفع Story الفيديو من Facebook", "FACEBOOK_STORY_START_FAILED");
        const uploaded = await providerJson<any>(uploadUrl, { method: "POST", headers: { Authorization: `OAuth ${token}`, file_url: context.mediaUrl } }, "Facebook");
        const published = await graphPost(`/${pageId}/video_stories`, { upload_phase: "finish", video_id: videoId }, token);
        result = { start, uploaded, published };
      } else {
        const uploaded = await graphPost(`/${pageId}/photos`, { url: context.mediaUrl, published: false }, token);
        const photoId = clean(uploaded.id || uploaded.photo_id);
        const published = await graphPost(`/${pageId}/photo_stories`, { photo_id: photoId }, token);
        result = { uploaded, published };
      }
    } else if (!context.mediaUrl) result = await graphPost(`/${pageId}/feed`, { message: context.message }, token);
    else if (isVideo) result = await graphPost(`/${pageId}/videos`, { file_url: context.mediaUrl, description: context.message }, token);
    else result = await graphPost(`/${pageId}/photos`, { url: context.mediaUrl, caption: context.message, published: true }, token);
    const id = clean(result?.id || result?.post_id || result?.published?.post_id || result?.published?.id || result?.published?.video_id);
    return { status: "published", externalId: id || null, publishedUrl: id ? `https://www.facebook.com/${id}` : null, responseSummary: { id, type: postType || (isVideo ? "video" : "photo") } };
  }

  const igId = clean(connection.profile_id || connection.account_id);
  if (!igId) return { status: "blocked", errorMessage: "Instagram Business Account غير محدد" };
  if (!context.mediaUrl) return { status: "failed", errorMessage: "Instagram يحتاج ملفًا نهائيًا" };
  const createParams: Record<string, unknown> = { caption: context.message };
  if (postType.includes("story")) {
    createParams.media_type = "STORIES";
    createParams[isVideo ? "video_url" : "image_url"] = context.mediaUrl;
  } else if (isVideo || postType.includes("reel")) {
    createParams.media_type = "REELS";
    createParams.video_url = context.mediaUrl;
    createParams.share_to_feed = true;
  } else createParams.image_url = context.mediaUrl;
  const created = await graphPost(`/${igId}/media`, createParams, token);
  const creationId = clean(created.id || created.creation_id);
  if (!creationId) throw new MarketingError(502, "Instagram لم يرجع Media Container ID", "INSTAGRAM_MEDIA_ID_MISSING");
  if (isVideo) await waitInstagramContainer(creationId, token);
  const published = await graphPost(`/${igId}/media_publish`, { creation_id: creationId }, token);
  const id = clean(published.id || published.media_id || creationId);
  return { status: "published", externalId: id, publishedUrl: id ? `https://www.instagram.com/p/${id}` : null, responseSummary: { id, creationId, type: postType || (isVideo ? "reel" : "image") } };
}
