import crypto from "node:crypto";
import type { VercelRequest } from "@vercel/node";
import type { SessionUser } from "./_auth.js";
import { hasPermission } from "../shared/system-access.js";

export type PlatformProvider = "meta" | "tiktok" | "youtube";
type Sql = ReturnType<typeof import("./_db.js").getSql>;

type ConnectionRow = {
  platform: string;
  connected: boolean;
  status: string | null;
  state: string | null;
  source: string | null;
  account_id: string | null;
  account_name: string | null;
  page_id: string | null;
  page_name: string | null;
  ig_user_id: string | null;
  username: string | null;
  pages: unknown;
  scopes: unknown;
  metadata: unknown;
  access_token_encrypted: string | null;
  user_access_token_encrypted: string | null;
  page_access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: string | Date | null;
  refresh_token_expires_at: string | Date | null;
  last_verified_at: string | Date | null;
  last_error: string | null;
  connected_at: string | Date | null;
  disconnected_at: string | Date | null;
  created_at: string | Date | null;
  updated_at: string | Date | null;
  connected_by: string | null;
  disconnected_by: string | null;
  updated_by: string | null;
};

type MetaPage = {
  id: string;
  name: string;
  access_token: string;
  tasks?: string[];
  picture?: { data?: { url?: string } };
  instagram_business_account?: {
    id?: string;
    username?: string;
    name?: string;
    profile_picture_url?: string;
  };
};

type OAuthStateRow = {
  provider: PlatformProvider;
  user_id: string;
  return_origin: string;
  return_path: string;
};

type ConnectionDraftRow = {
  id: string;
  provider: PlatformProvider;
  payload_encrypted: string;
  public_payload: unknown;
  expires_at: string | Date;
};

function clean(value: unknown) { return String(value ?? "").trim(); }
function array(value: unknown): any[] { return Array.isArray(value) ? value : []; }
function object(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function dbJson(value: unknown) { return JSON.parse(JSON.stringify(value ?? null)); }
function addSeconds(seconds: unknown) {
  const value = Number(seconds);
  return Number.isFinite(value) && value > 0 ? new Date(Date.now() + value * 1000) : null;
}
function dateIso(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function parseScopes(value: unknown, separator: RegExp = /[\s,]+/) {
  return [...new Set(clean(value).split(separator).map((item) => item.trim()).filter(Boolean))];
}
function assertScopes(granted: string[], required: string[], providerName: string) {
  const grantedSet = new Set(granted);
  const missing = required.filter((scope) => !grantedSet.has(scope));
  if (missing.length) throw new Error(`لم يمنح الحساب كل صلاحيات ${providerName} المطلوبة: ${missing.join("، ")}`);
}
function providerFrom(value: unknown): PlatformProvider {
  const provider = clean(value).toLowerCase();
  if (provider === "meta" || provider === "tiktok" || provider === "youtube") return provider;
  throw new Error("المنصة المطلوبة غير مدعومة");
}
function stateHash(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function randomState() { return crypto.randomBytes(32).toString("base64url"); }

function encryptionSecret() {
  const secret = clean(process.env.MZJ_PLATFORM_TOKEN_ENCRYPTION_KEY || process.env.MZJ_TOKEN_ENCRYPTION_KEY);
  if (!secret) throw new Error("MZJ_PLATFORM_TOKEN_ENCRYPTION_KEY غير مضبوط");
  if (secret.length < 32) throw new Error("مفتاح تشفير ربط المنصات يجب ألا يقل عن 32 حرفًا");
  return secret;
}
function encryptionKey() { return crypto.createHash("sha256").update(encryptionSecret()).digest(); }
export function encryptPlatformToken(value: unknown) {
  const text = clean(value);
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url")}`;
}
export function decryptPlatformToken(value: unknown) {
  const original = clean(value);
  if (!original) return "";
  const encoded = original.startsWith("v1.") ? original.slice(3) : original;
  const data = Buffer.from(encoded, "base64url");
  if (data.length < 29) throw new Error("بيانات التوكن المشفر غير صالحة");
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
}

export function publicPlatformConnection(row: any) {
  const metadata = object(row?.metadata);
  return {
    platform: clean(row?.platform),
    connected: Boolean(row?.connected),
    status: clean(row?.status) || "disconnected",
    state: clean(row?.state) || "idle",
    source: clean(row?.source),
    accountId: clean(row?.account_id),
    accountName: clean(row?.account_name),
    pageId: clean(row?.page_id),
    pageName: clean(row?.page_name),
    igUserId: clean(row?.ig_user_id),
    username: clean(row?.username),
    pages: array(row?.pages),
    scopes: array(row?.scopes).map(clean).filter(Boolean),
    metadata,
    avatarUrl: clean(metadata.avatarUrl || metadata.avatar_url || metadata.pictureUrl),
    tokenStored: Boolean(row?.access_token_encrypted || row?.user_access_token_encrypted || row?.page_access_token_encrypted || row?.refresh_token_encrypted),
    tokenExpiresAtIso: dateIso(row?.token_expires_at),
    refreshTokenExpiresAtIso: dateIso(row?.refresh_token_expires_at),
    lastVerifiedAtIso: dateIso(row?.last_verified_at),
    connectedAtIso: dateIso(row?.connected_at),
    disconnectedAtIso: dateIso(row?.disconnected_at),
    updatedAtIso: dateIso(row?.updated_at),
    lastError: clean(row?.last_error),
  };
}

function safePublicUrl(value: string, label: string) {
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !local) throw new Error("HTTPS required");
    return url;
  } catch {
    throw new Error(`${label} غير صالح أو لا يستخدم HTTPS`);
  }
}
function requestOrigin(request: VercelRequest) {
  const configured = clean(process.env.MZJ_PUBLIC_BASE_URL);
  if (configured) return safePublicUrl(configured, "MZJ_PUBLIC_BASE_URL").origin;
  const forwardedHost = clean(request.headers["x-forwarded-host"]).split(",")[0].trim();
  const host = forwardedHost || clean(request.headers.host).split(",")[0].trim();
  if (!host) throw new Error("تعذر تحديد رابط المنصة العام");
  const protocol = (clean(request.headers["x-forwarded-proto"]) || (process.env.VERCEL ? "https" : "http")).split(",")[0].trim();
  return safePublicUrl(`${protocol}://${host}`, "رابط المنصة العام").origin;
}
function callbackUrl(provider: PlatformProvider, request: VercelRequest) {
  const explicit = provider === "meta" ? clean(process.env.META_REDIRECT_URI)
    : provider === "tiktok" ? clean(process.env.TIKTOK_REDIRECT_URI)
      : clean(process.env.YOUTUBE_REDIRECT_URI);
  return explicit ? safePublicUrl(explicit, "OAuth Redirect URI").toString() : `${requestOrigin(request)}/api/marketing/platform-connections/callback/${provider}`;
}
function providerConfig(provider: PlatformProvider, request: VercelRequest) {
  const encryptionValue = clean(process.env.MZJ_PLATFORM_TOKEN_ENCRYPTION_KEY || process.env.MZJ_TOKEN_ENCRYPTION_KEY);
  const encryptionConfigured = encryptionValue.length >= 32;
  const required = provider === "meta"
    ? [["META_APP_ID", process.env.META_APP_ID], ["META_APP_SECRET", process.env.META_APP_SECRET]]
    : provider === "tiktok"
      ? [["TIKTOK_CLIENT_KEY", process.env.TIKTOK_CLIENT_KEY], ["TIKTOK_CLIENT_SECRET", process.env.TIKTOK_CLIENT_SECRET]]
      : [["YOUTUBE_CLIENT_ID", process.env.YOUTUBE_CLIENT_ID], ["YOUTUBE_CLIENT_SECRET", process.env.YOUTUBE_CLIENT_SECRET]];
  const missing = required.filter(([, value]) => !clean(value)).map(([name]) => name);
  if (!encryptionConfigured) missing.push("MZJ_PLATFORM_TOKEN_ENCRYPTION_KEY (32+ chars)");
  let redirectUri = "";
  try { redirectUri = callbackUrl(provider, request); }
  catch {
    missing.push(provider === "meta" ? "META_REDIRECT_URI / MZJ_PUBLIC_BASE_URL" : provider === "tiktok" ? "TIKTOK_REDIRECT_URI / MZJ_PUBLIC_BASE_URL" : "YOUTUBE_REDIRECT_URI / MZJ_PUBLIC_BASE_URL");
  }
  return { configured: missing.length === 0, missing: [...new Set(missing)], redirectUri };
}
function ensureProviderConfigured(provider: PlatformProvider, request: VercelRequest) {
  const config = providerConfig(provider, request);
  if (!config.configured) throw new Error(`إعداد ${provider === "meta" ? "Meta" : provider === "tiktok" ? "TikTok" : "YouTube"} غير مكتمل: ${config.missing.join("، ")}`);
  return config;
}

async function connectionRows(sql: Sql) {
  return sql<ConnectionRow[]>`select * from marketing.platform_connections order by platform`;
}
async function connectionEvents(sql: Sql) {
  return sql<any[]>`
    select e.id::text,e.provider,e.action,e.status,e.account_name,e.details,e.created_at,u.full_name as user_name
    from marketing.platform_connection_events e
    left join core.users u on u.id=e.user_id
    order by e.created_at desc
    limit 20
  `;
}
async function recordEvent(sql: Sql, user: SessionUser, provider: PlatformProvider, action: string, status: string, accountName?: string, details?: unknown) {
  await sql`
    insert into marketing.platform_connection_events(provider,action,status,account_name,details,user_id)
    values(${provider},${action},${status},${clean(accountName) || null},${sql.json(dbJson(details || {}))},${user.id}::uuid)
  `;
}

function providerStatus(row: ConnectionRow | undefined) {
  if (!row) return "disconnected";
  if (row.state === "select_page") return "action_required";
  if (row.status === "warning" || row.state === "validation_failed") return "warning";
  if (row.connected) return "connected";
  if (row.status === "reauthorization_required") return "reauthorization_required";
  return "disconnected";
}

export async function listPlatformConnections(sql: Sql, user: SessionUser, request: VercelRequest) {
  const [rows, events, drafts] = await Promise.all([
    connectionRows(sql),
    connectionEvents(sql),
    sql<ConnectionDraftRow[]>`select id::text,provider,payload_encrypted,public_payload,expires_at from marketing.platform_connection_drafts where user_id=${user.id}::uuid and expires_at>now()`,
  ]);
  const byPlatform = new Map(rows.map((row) => [row.platform, row]));
  const metaDraft = drafts.find((draft) => draft.provider === "meta");
  const metaDraftPublic = object(metaDraft?.public_payload);
  const facebook = byPlatform.get("facebook");
  const instagram = byPlatform.get("instagram");
  const tiktok = byPlatform.get("tiktok");
  const youtube = byPlatform.get("youtube");
  const metaConfig = providerConfig("meta", request);
  const tiktokConfig = providerConfig("tiktok", request);
  const youtubeConfig = providerConfig("youtube", request);
  const facebookPublic = facebook ? publicPlatformConnection(facebook) : null;
  const instagramPublic = instagram ? publicPlatformConnection(instagram) : null;
  const metaConnected = Boolean(facebook?.connected);
  const metaStatus = metaDraft ? "action_required"
    : metaConnected && instagram?.connected ? "connected"
      : metaConnected ? "partial"
        : providerStatus(facebook);
  return {
    ok: true,
    canManage: hasPermission(user, "marketing.connections.manage"),
    providers: [
      {
        provider: "meta",
        title: "Meta",
        configured: metaConfig.configured,
        missingConfiguration: metaConfig.missing,
        redirectUri: metaConfig.redirectUri,
        connected: metaConnected,
        status: metaStatus,
        state: metaDraft ? "select_page" : clean(facebook?.state) || "idle",
        accountName: clean(facebook?.account_name),
        accountId: clean(facebook?.account_id),
        secondaryName: clean(facebook?.page_name),
        secondaryId: clean(facebook?.page_id),
        avatarUrl: clean(object(facebook?.metadata).avatarUrl),
        tokenStored: Boolean(facebookPublic?.tokenStored || instagramPublic?.tokenStored),
        scopes: array(facebook?.scopes).map(clean).filter(Boolean),
        tokenExpiresAtIso: dateIso(facebook?.token_expires_at),
        lastVerifiedAtIso: dateIso(facebook?.last_verified_at || instagram?.last_verified_at),
        connectedAtIso: dateIso(facebook?.connected_at),
        updatedAtIso: dateIso(facebook?.updated_at || instagram?.updated_at),
        lastError: clean(facebook?.last_error || instagram?.last_error),
        requiresSelection: Boolean(metaDraft),
        selectionDraftId: clean(metaDraft?.id),
        availablePages: array(metaDraftPublic.pages),
        assets: { facebook: facebookPublic, instagram: instagramPublic },
      },
      {
        provider: "tiktok",
        title: "TikTok",
        configured: tiktokConfig.configured,
        missingConfiguration: tiktokConfig.missing,
        redirectUri: tiktokConfig.redirectUri,
        connected: Boolean(tiktok?.connected),
        status: providerStatus(tiktok),
        state: clean(tiktok?.state) || "idle",
        accountName: clean(tiktok?.account_name),
        accountId: clean(tiktok?.account_id),
        secondaryName: clean(tiktok?.username),
        secondaryId: "",
        avatarUrl: clean(object(tiktok?.metadata).avatarUrl),
        tokenStored: Boolean(tiktok && publicPlatformConnection(tiktok).tokenStored),
        scopes: array(tiktok?.scopes).map(clean).filter(Boolean),
        tokenExpiresAtIso: dateIso(tiktok?.token_expires_at),
        refreshTokenExpiresAtIso: dateIso(tiktok?.refresh_token_expires_at),
        lastVerifiedAtIso: dateIso(tiktok?.last_verified_at),
        connectedAtIso: dateIso(tiktok?.connected_at),
        updatedAtIso: dateIso(tiktok?.updated_at),
        lastError: clean(tiktok?.last_error),
        requiresSelection: false,
        availablePages: [],
        assets: { tiktok: tiktok ? publicPlatformConnection(tiktok) : null },
      },
      {
        provider: "youtube",
        title: "YouTube",
        configured: youtubeConfig.configured,
        missingConfiguration: youtubeConfig.missing,
        redirectUri: youtubeConfig.redirectUri,
        connected: Boolean(youtube?.connected),
        status: providerStatus(youtube),
        state: clean(youtube?.state) || "idle",
        accountName: clean(youtube?.account_name),
        accountId: clean(youtube?.account_id),
        secondaryName: clean(youtube?.username),
        secondaryId: "",
        avatarUrl: clean(object(youtube?.metadata).avatarUrl),
        tokenStored: Boolean(youtube && publicPlatformConnection(youtube).tokenStored),
        scopes: array(youtube?.scopes).map(clean).filter(Boolean),
        tokenExpiresAtIso: dateIso(youtube?.token_expires_at),
        lastVerifiedAtIso: dateIso(youtube?.last_verified_at),
        connectedAtIso: dateIso(youtube?.connected_at),
        updatedAtIso: dateIso(youtube?.updated_at),
        lastError: clean(youtube?.last_error),
        requiresSelection: false,
        availablePages: [],
        assets: { youtube: youtube ? publicPlatformConnection(youtube) : null },
      },
    ],
    events: events.map((event) => ({
      id: event.id,
      provider: event.provider,
      action: event.action,
      status: event.status,
      accountName: event.account_name || "",
      details: object(event.details),
      userName: event.user_name || "—",
      createdAtIso: dateIso(event.created_at),
    })),
  };
}

function metaVersion() { return clean(process.env.META_GRAPH_VERSION) || "v25.0"; }
function metaScopes() {
  return parseScopes(process.env.META_SCOPES || "public_profile,pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish");
}
function tiktokScopes() { return parseScopes(process.env.TIKTOK_SCOPES || "user.info.basic,video.upload,video.publish"); }
function youtubeScopes() {
  return parseScopes(process.env.YOUTUBE_SCOPES || "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly");
}

export async function startPlatformOAuth(sql: Sql, user: SessionUser, request: VercelRequest, providerValue: unknown) {
  const provider = providerFrom(providerValue);
  const config = ensureProviderConfigured(provider, request);
  const state = randomState();
  const origin = requestOrigin(request);
  await sql`delete from marketing.platform_oauth_states where expires_at<now() or consumed_at is not null`;
  await sql`delete from marketing.platform_connection_drafts where user_id=${user.id}::uuid and provider=${provider}`;
  await sql`
    insert into marketing.platform_oauth_states(state_hash,provider,user_id,return_origin,return_path,expires_at)
    values(${stateHash(state)},${provider},${user.id}::uuid,${origin},'/marketing/platforms',now()+interval '10 minutes')
  `;
  let authorizationUrl = "";
  if (provider === "meta") {
    const url = new URL(`https://www.facebook.com/${metaVersion()}/dialog/oauth`);
    url.searchParams.set("client_id", clean(process.env.META_APP_ID));
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    url.searchParams.set("scope", metaScopes().join(","));
    url.searchParams.set("auth_type", "rerequest");
    authorizationUrl = url.toString();
  } else if (provider === "tiktok") {
    const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.searchParams.set("client_key", clean(process.env.TIKTOK_CLIENT_KEY));
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", tiktokScopes().join(","));
    url.searchParams.set("state", state);
    url.searchParams.set("disable_auto_auth", "1");
    authorizationUrl = url.toString();
  } else {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clean(process.env.YOUTUBE_CLIENT_ID));
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", youtubeScopes().join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("prompt", "consent select_account");
    authorizationUrl = url.toString();
  }
  await recordEvent(sql, user, provider, "oauth_started", "success", undefined, { redirectUri: config.redirectUri });
  return { ok: true, provider, authorizationUrl };
}

async function consumeOAuthState(sql: Sql, user: SessionUser, provider: PlatformProvider, state: string) {
  if (!state) throw new Error("حالة OAuth غير موجودة");
  const [row] = await sql<OAuthStateRow[]>`
    update marketing.platform_oauth_states
    set consumed_at=now()
    where state_hash=${stateHash(state)} and provider=${provider} and user_id=${user.id}::uuid and consumed_at is null and expires_at>now()
    returning provider,user_id::text,return_origin,return_path
  `;
  if (!row) throw new Error("جلسة الربط منتهية أو مستخدمة مسبقًا");
  if (row.user_id !== user.id) throw new Error("جلسة الربط لا تخص المستخدم الحالي");
  return row;
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = clean((payload as any)?.error_description || (payload as any)?.error?.message || (payload as any)?.message || `${response.status} ${response.statusText}`);
    throw new Error(message || "فشل الاتصال بمزود المنصة");
  }
  return payload as any;
}

function metaProof(token: string) {
  return crypto.createHmac("sha256", clean(process.env.META_APP_SECRET)).update(token).digest("hex");
}
async function metaGraphGet(pathOrUrl: string, token: string, params: Record<string, string> = {}) {
  const url = pathOrUrl.startsWith("http") ? new URL(pathOrUrl) : new URL(`https://graph.facebook.com/${metaVersion()}${pathOrUrl}`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("appsecret_proof", metaProof(token));
  for (const [key, value] of Object.entries(params)) if (clean(value)) url.searchParams.set(key, value);
  return fetchJson(url.toString());
}
async function exchangeMetaToken(code: string, redirectUri: string) {
  const shortUrl = new URL(`https://graph.facebook.com/${metaVersion()}/oauth/access_token`);
  shortUrl.searchParams.set("client_id", clean(process.env.META_APP_ID));
  shortUrl.searchParams.set("client_secret", clean(process.env.META_APP_SECRET));
  shortUrl.searchParams.set("redirect_uri", redirectUri);
  shortUrl.searchParams.set("code", code);
  const short = await fetchJson(shortUrl.toString());
  const shortToken = clean(short.access_token);
  if (!shortToken) throw new Error("Meta لم ترجع Access Token");
  const longUrl = new URL(`https://graph.facebook.com/${metaVersion()}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", clean(process.env.META_APP_ID));
  longUrl.searchParams.set("client_secret", clean(process.env.META_APP_SECRET));
  longUrl.searchParams.set("fb_exchange_token", shortToken);
  const long = await fetchJson(longUrl.toString());
  const accessToken = clean(long.access_token || shortToken);
  return { accessToken, expiresIn: Number(long.expires_in || short.expires_in || 0) };
}
async function loadMetaPages(userToken: string) {
  const first = await metaGraphGet("/me/accounts", userToken, {
    fields: "id,name,access_token,tasks,picture{url},instagram_business_account{id,username,name,profile_picture_url}",
    limit: "100",
  });
  const pages: MetaPage[] = [];
  let payload = first;
  let loops = 0;
  while (payload && loops < 10) {
    pages.push(...array(payload.data).map((item) => item as MetaPage).filter((item) => clean(item.id) && clean(item.access_token)));
    const next = clean(payload?.paging?.next);
    if (!next) break;
    payload = await metaGraphGet(next, userToken);
    loops += 1;
  }
  return pages;
}
async function loadMetaGrantedScopes(userToken: string) {
  const payload = await metaGraphGet("/me/permissions", userToken);
  return array(payload.data).filter((item) => clean(item.status) === "granted").map((item) => clean(item.permission)).filter(Boolean);
}
function publicMetaPages(pages: MetaPage[]) {
  return pages.map((page) => ({
    id: clean(page.id),
    name: clean(page.name),
    tasks: array(page.tasks).map(clean).filter(Boolean),
    pictureUrl: clean(page.picture?.data?.url),
    instagram: page.instagram_business_account ? {
      id: clean(page.instagram_business_account.id),
      username: clean(page.instagram_business_account.username),
      name: clean(page.instagram_business_account.name),
      profilePictureUrl: clean(page.instagram_business_account.profile_picture_url),
    } : null,
  }));
}

async function savePendingMetaSelection(sql: Sql, user: SessionUser, input: { userToken: string; expiresIn: number; accountId: string; accountName: string; scopes: string[]; pages: MetaPage[] }) {
  const publicPayload = { accountId: input.accountId, accountName: input.accountName, scopes: input.scopes, pages: publicMetaPages(input.pages) };
  const encryptedPayload = encryptPlatformToken(JSON.stringify(input));
  if (!encryptedPayload) throw new Error("تعذر تجهيز اختيار صفحة Meta");
  await sql`
    insert into marketing.platform_connection_drafts(provider,user_id,payload_encrypted,public_payload,expires_at)
    values('meta',${user.id}::uuid,${encryptedPayload},${sql.json(dbJson(publicPayload))},now()+interval '15 minutes')
    on conflict(provider,user_id) do update set payload_encrypted=excluded.payload_encrypted,public_payload=excluded.public_payload,created_at=now(),expires_at=excluded.expires_at
  `;
}

async function applyMetaPage(sql: Sql, user: SessionUser, input: { userToken: string; expiresIn?: number; accountId: string; accountName: string; scopes: string[]; pages: MetaPage[]; page: MetaPage }) {
  const pages = publicMetaPages(input.pages);
  const pageId = clean(input.page.id);
  const pageName = clean(input.page.name);
  const pageToken = clean(input.page.access_token);
  const instagram = input.page.instagram_business_account || {};
  const igId = clean(instagram.id);
  const igName = clean(instagram.name || instagram.username);
  const igUsername = clean(instagram.username);
  const tokenExpiresAt = input.expiresIn ? addSeconds(input.expiresIn) : null;
  const facebookMetadata = {
    avatarUrl: clean(input.page.picture?.data?.url),
    tasks: array(input.page.tasks).map(clean).filter(Boolean),
    instagramAccountId: igId || null,
  };
  const instagramMetadata = { avatarUrl: clean(instagram.profile_picture_url), facebookPageId: pageId };
  await sql.begin(async (tx) => {
    await tx`
      insert into marketing.platform_connections(platform,connected,status,state,source,account_id,account_name,page_id,page_name,pages,scopes,metadata,access_token_encrypted,user_access_token_encrypted,page_access_token_encrypted,token_expires_at,last_verified_at,last_error,connected_at,disconnected_at,updated_at,connected_by,disconnected_by,updated_by)
      values('facebook',true,'connected','ready','oauth-meta',${input.accountId},${input.accountName},${pageId},${pageName},${tx.json(dbJson(pages))},${tx.json(dbJson(input.scopes))},${tx.json(dbJson(facebookMetadata))},${encryptPlatformToken(pageToken)},${encryptPlatformToken(input.userToken)},${encryptPlatformToken(pageToken)},${tokenExpiresAt},now(),null,now(),null,now(),${user.id}::uuid,null,${user.id}::uuid)
      on conflict(platform) do update set connected=true,status='connected',state='ready',source='oauth-meta',account_id=excluded.account_id,account_name=excluded.account_name,page_id=excluded.page_id,page_name=excluded.page_name,ig_user_id=null,username=null,pages=excluded.pages,scopes=excluded.scopes,metadata=excluded.metadata,access_token_encrypted=excluded.access_token_encrypted,user_access_token_encrypted=excluded.user_access_token_encrypted,page_access_token_encrypted=excluded.page_access_token_encrypted,refresh_token_encrypted=null,token_expires_at=coalesce(excluded.token_expires_at,marketing.platform_connections.token_expires_at),refresh_token_expires_at=null,last_verified_at=now(),last_error=null,connected_at=coalesce(marketing.platform_connections.connected_at,now()),disconnected_at=null,updated_at=now(),connected_by=excluded.connected_by,disconnected_by=null,updated_by=excluded.updated_by
    `;
    if (igId) {
      await tx`
        insert into marketing.platform_connections(platform,connected,status,state,source,account_id,account_name,page_id,page_name,ig_user_id,username,pages,scopes,metadata,access_token_encrypted,page_access_token_encrypted,token_expires_at,last_verified_at,last_error,connected_at,disconnected_at,updated_at,connected_by,disconnected_by,updated_by)
        values('instagram',true,'connected','ready','oauth-meta',${igId},${igName},${pageId},${pageName},${igId},${igUsername},${tx.json(dbJson(pages))},${tx.json(dbJson(input.scopes))},${tx.json(dbJson(instagramMetadata))},${encryptPlatformToken(pageToken)},${encryptPlatformToken(pageToken)},${tokenExpiresAt},now(),null,now(),null,now(),${user.id}::uuid,null,${user.id}::uuid)
        on conflict(platform) do update set connected=true,status='connected',state='ready',source='oauth-meta',account_id=excluded.account_id,account_name=excluded.account_name,page_id=excluded.page_id,page_name=excluded.page_name,ig_user_id=excluded.ig_user_id,username=excluded.username,pages=excluded.pages,scopes=excluded.scopes,metadata=excluded.metadata,access_token_encrypted=excluded.access_token_encrypted,user_access_token_encrypted=null,page_access_token_encrypted=excluded.page_access_token_encrypted,refresh_token_encrypted=null,token_expires_at=coalesce(excluded.token_expires_at,marketing.platform_connections.token_expires_at),refresh_token_expires_at=null,last_verified_at=now(),last_error=null,connected_at=coalesce(marketing.platform_connections.connected_at,now()),disconnected_at=null,updated_at=now(),connected_by=excluded.connected_by,disconnected_by=null,updated_by=excluded.updated_by
      `;
    } else {
      await tx`
        insert into marketing.platform_connections(platform,connected,status,state,source,page_id,page_name,pages,scopes,metadata,last_verified_at,last_error,updated_at,updated_by)
        values('instagram',false,'not_available','ready','oauth-meta',${pageId},${pageName},${tx.json(dbJson(pages))},${tx.json(dbJson(input.scopes))},${tx.json(dbJson(instagramMetadata))},now(),'صفحة Facebook المختارة غير مرتبطة بحساب Instagram احترافي',now(),${user.id}::uuid)
        on conflict(platform) do update set connected=false,status='not_available',state='ready',source='oauth-meta',account_id=null,account_name=null,page_id=excluded.page_id,page_name=excluded.page_name,ig_user_id=null,username=null,pages=excluded.pages,scopes=excluded.scopes,metadata=excluded.metadata,access_token_encrypted=null,user_access_token_encrypted=null,page_access_token_encrypted=null,refresh_token_encrypted=null,token_expires_at=null,refresh_token_expires_at=null,last_verified_at=now(),last_error=excluded.last_error,connected_at=null,updated_at=now(),updated_by=excluded.updated_by
      `;
    }
  });
  return { pageId, pageName, igId, igUsername };
}

async function completeMetaCallback(sql: Sql, user: SessionUser, code: string, request: VercelRequest) {
  const config = ensureProviderConfigured("meta", request);
  const token = await exchangeMetaToken(code, config.redirectUri);
  const [account, pages, scopes] = await Promise.all([
    metaGraphGet("/me", token.accessToken, { fields: "id,name" }),
    loadMetaPages(token.accessToken),
    loadMetaGrantedScopes(token.accessToken),
  ]);
  if (!pages.length) throw new Error("لم يتم العثور على صفحات Facebook يملك الحساب صلاحية إدارتها");
  assertScopes(scopes, metaScopes(), "Meta");
  const accountId = clean(account.id);
  const accountName = clean(account.name);
  if (pages.length === 1) {
    await sql`delete from marketing.platform_connection_drafts where provider='meta' and user_id=${user.id}::uuid`;
    const selection = await applyMetaPage(sql, user, { userToken: token.accessToken, expiresIn: token.expiresIn, accountId, accountName, scopes, pages, page: pages[0] });
    await recordEvent(sql, user, "meta", "connected", "success", selection.pageName, { pageId: selection.pageId, instagramAccountId: selection.igId || null });
    return { status: "connected", message: selection.igId ? "تم ربط Facebook وInstagram بنجاح" : "تم ربط Facebook، ولا يوجد حساب Instagram احترافي مرتبط بالصفحة", accountName: selection.pageName };
  }
  await savePendingMetaSelection(sql, user, { userToken: token.accessToken, expiresIn: token.expiresIn, accountId, accountName, scopes, pages });
  await recordEvent(sql, user, "meta", "page_selection_required", "success", accountName, { pages: pages.length });
  return { status: "selection_required", message: "تم تسجيل الدخول إلى Meta. اختر صفحة Facebook المطلوبة لإكمال الربط.", accountName };
}

async function exchangeTikTokToken(code: string, redirectUri: string) {
  const body = new URLSearchParams({
    client_key: clean(process.env.TIKTOK_CLIENT_KEY),
    client_secret: clean(process.env.TIKTOK_CLIENT_SECRET),
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const payload = await fetchJson("https://open.tiktokapis.com/v2/oauth/token/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "cache-control": "no-cache" }, body });
  if (payload.error) throw new Error(clean(payload.error_description || payload.error));
  return payload;
}
async function refreshTikTokToken(refreshToken: string) {
  const body = new URLSearchParams({
    client_key: clean(process.env.TIKTOK_CLIENT_KEY),
    client_secret: clean(process.env.TIKTOK_CLIENT_SECRET),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const payload = await fetchJson("https://open.tiktokapis.com/v2/oauth/token/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "cache-control": "no-cache" }, body });
  if (payload.error) throw new Error(clean(payload.error_description || payload.error));
  return payload;
}
async function loadTikTokUser(accessToken: string, scopes: string[]) {
  const fields = ["open_id", "union_id", "avatar_url", "display_name"];
  if (scopes.includes("user.info.profile")) fields.push("username", "profile_deep_link");
  const url = new URL("https://open.tiktokapis.com/v2/user/info/");
  url.searchParams.set("fields", fields.join(","));
  const payload = await fetchJson(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (payload?.error && clean(payload.error.code) && clean(payload.error.code) !== "ok") throw new Error(clean(payload.error.message || payload.error.code));
  const profile = payload?.data?.user;
  if (!profile?.open_id) throw new Error("تعذر قراءة بيانات حساب TikTok");
  return profile;
}
async function saveTikTokConnection(sql: Sql, user: SessionUser, token: any, profile: any, existing?: ConnectionRow) {
  const scopes = parseScopes(token.scope || array(existing?.scopes).join(","));
  const tokenExpiresAt = addSeconds(token.expires_in) || existing?.token_expires_at || null;
  const refreshTokenExpiresAt = addSeconds(token.refresh_expires_in) || existing?.refresh_token_expires_at || null;
  await sql`
    insert into marketing.platform_connections(platform,connected,status,state,source,account_id,account_name,username,scopes,metadata,access_token_encrypted,refresh_token_encrypted,token_expires_at,refresh_token_expires_at,last_verified_at,last_error,connected_at,disconnected_at,updated_at,connected_by,disconnected_by,updated_by)
    values('tiktok',true,'connected','ready','oauth-tiktok',${clean(profile.open_id)},${clean(profile.display_name)},${clean(profile.username)||null},${sql.json(dbJson(scopes))},${sql.json(dbJson({avatarUrl:clean(profile.avatar_url),unionId:clean(profile.union_id),profileUrl:clean(profile.profile_deep_link)}))},${encryptPlatformToken(token.access_token)},${encryptPlatformToken(token.refresh_token)},${tokenExpiresAt},${refreshTokenExpiresAt},now(),null,now(),null,now(),${user.id}::uuid,null,${user.id}::uuid)
    on conflict(platform) do update set connected=true,status='connected',state='ready',source='oauth-tiktok',account_id=excluded.account_id,account_name=excluded.account_name,username=excluded.username,page_id=null,page_name=null,ig_user_id=null,pages='[]'::jsonb,scopes=excluded.scopes,metadata=excluded.metadata,access_token_encrypted=excluded.access_token_encrypted,user_access_token_encrypted=null,page_access_token_encrypted=null,refresh_token_encrypted=excluded.refresh_token_encrypted,token_expires_at=excluded.token_expires_at,refresh_token_expires_at=excluded.refresh_token_expires_at,last_verified_at=now(),last_error=null,connected_at=coalesce(marketing.platform_connections.connected_at,now()),disconnected_at=null,updated_at=now(),connected_by=excluded.connected_by,disconnected_by=null,updated_by=excluded.updated_by
  `;
}
async function completeTikTokCallback(sql: Sql, user: SessionUser, code: string, request: VercelRequest) {
  const config = ensureProviderConfigured("tiktok", request);
  const token = await exchangeTikTokToken(code, config.redirectUri);
  const scopes = parseScopes(token.scope);
  assertScopes(scopes, tiktokScopes(), "TikTok");
  const profile = await loadTikTokUser(clean(token.access_token), scopes);
  await saveTikTokConnection(sql, user, token, profile);
  await recordEvent(sql, user, "tiktok", "connected", "success", clean(profile.display_name), { openId: clean(profile.open_id), scopes });
  return { status: "connected", message: "تم ربط TikTok بنجاح", accountName: clean(profile.display_name) };
}

async function exchangeYouTubeToken(code: string, redirectUri: string) {
  const body = new URLSearchParams({
    client_id: clean(process.env.YOUTUBE_CLIENT_ID),
    client_secret: clean(process.env.YOUTUBE_CLIENT_SECRET),
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  return fetchJson("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
}
async function refreshYouTubeToken(refreshToken: string) {
  const body = new URLSearchParams({
    client_id: clean(process.env.YOUTUBE_CLIENT_ID),
    client_secret: clean(process.env.YOUTUBE_CLIENT_SECRET),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  return fetchJson("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
}
async function loadYouTubeChannel(accessToken: string) {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "id,snippet");
  url.searchParams.set("mine", "true");
  const payload = await fetchJson(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  const channel = array(payload.items)[0];
  if (!channel?.id) throw new Error("الحساب المحدد لا يحتوي على قناة YouTube");
  return channel;
}
async function saveYouTubeConnection(sql: Sql, user: SessionUser, token: any, channel: any, existingRefreshToken = "", existing?: ConnectionRow) {
  const refreshToken = clean(token.refresh_token || existingRefreshToken);
  if (!refreshToken) throw new Error("Google لم ترجع Refresh Token. أعد الربط ووافق على الصلاحيات المطلوبة.");
  const scopes = parseScopes(token.scope || youtubeScopes().join(" "));
  const snippet = object(channel.snippet);
  const thumbnails = object(snippet.thumbnails);
  const avatarUrl = clean(thumbnails.high?.url || thumbnails.medium?.url || thumbnails.default?.url);
  const tokenExpiresAt = addSeconds(token.expires_in) || existing?.token_expires_at || null;
  await sql`
    insert into marketing.platform_connections(platform,connected,status,state,source,account_id,account_name,username,scopes,metadata,access_token_encrypted,refresh_token_encrypted,token_expires_at,last_verified_at,last_error,connected_at,disconnected_at,updated_at,connected_by,disconnected_by,updated_by)
    values('youtube',true,'connected','ready','oauth-youtube',${clean(channel.id)},${clean(snippet.title)},${clean(snippet.customUrl)||null},${sql.json(dbJson(scopes))},${sql.json(dbJson({avatarUrl,description:clean(snippet.description),country:clean(snippet.country)}))},${encryptPlatformToken(token.access_token)},${encryptPlatformToken(refreshToken)},${tokenExpiresAt},now(),null,now(),null,now(),${user.id}::uuid,null,${user.id}::uuid)
    on conflict(platform) do update set connected=true,status='connected',state='ready',source='oauth-youtube',account_id=excluded.account_id,account_name=excluded.account_name,username=excluded.username,page_id=null,page_name=null,ig_user_id=null,pages='[]'::jsonb,scopes=excluded.scopes,metadata=excluded.metadata,access_token_encrypted=excluded.access_token_encrypted,user_access_token_encrypted=null,page_access_token_encrypted=null,refresh_token_encrypted=excluded.refresh_token_encrypted,token_expires_at=excluded.token_expires_at,refresh_token_expires_at=null,last_verified_at=now(),last_error=null,connected_at=coalesce(marketing.platform_connections.connected_at,now()),disconnected_at=null,updated_at=now(),connected_by=excluded.connected_by,disconnected_by=null,updated_by=excluded.updated_by
  `;
}
async function completeYouTubeCallback(sql: Sql, user: SessionUser, code: string, request: VercelRequest) {
  const config = ensureProviderConfigured("youtube", request);
  const [existing] = await sql<ConnectionRow[]>`select * from marketing.platform_connections where platform='youtube'`;
  const existingRefreshToken = existing?.refresh_token_encrypted ? decryptPlatformToken(existing.refresh_token_encrypted) : "";
  const token = await exchangeYouTubeToken(code, config.redirectUri);
  assertScopes(parseScopes(token.scope), youtubeScopes(), "YouTube");
  const channel = await loadYouTubeChannel(clean(token.access_token));
  await saveYouTubeConnection(sql, user, token, channel, existingRefreshToken);
  await recordEvent(sql, user, "youtube", "connected", "success", clean(channel.snippet?.title), { channelId: clean(channel.id), scopes: parseScopes(token.scope) });
  return { status: "connected", message: "تم ربط قناة YouTube بنجاح", accountName: clean(channel.snippet?.title) };
}

export async function completePlatformOAuth(sql: Sql, user: SessionUser, request: VercelRequest, providerValue: unknown) {
  const provider = providerFrom(providerValue);
  const state = clean(request.query.state);
  const oauthState = await consumeOAuthState(sql, user, provider, state);
  const providerError = clean(request.query.error_description || request.query.error || request.query.error_reason);
  if (providerError) {
    await recordEvent(sql, user, provider, "oauth_callback", "failed", undefined, { error: providerError });
    return { provider, returnOrigin: oauthState.return_origin, returnPath: oauthState.return_path, status: "error", message: providerError };
  }
  const code = clean(request.query.code);
  if (!code) throw new Error("مزود المنصة لم يرجع Authorization Code");
  try {
    const result = provider === "meta" ? await completeMetaCallback(sql, user, code, request)
      : provider === "tiktok" ? await completeTikTokCallback(sql, user, code, request)
        : await completeYouTubeCallback(sql, user, code, request);
    return { provider, returnOrigin: oauthState.return_origin, returnPath: oauthState.return_path, ...result };
  } catch (error: any) {
    const message = clean(error?.message) || "تعذر إكمال ربط المنصة";
    await recordEvent(sql, user, provider, "oauth_callback", "failed", undefined, { error: message });
    return { provider, returnOrigin: oauthState.return_origin, returnPath: oauthState.return_path, status: "error", message };
  }
}

export async function selectMetaPage(sql: Sql, user: SessionUser, pageIdValue: unknown) {
  const pageId = clean(pageIdValue);
  if (!pageId) throw new Error("اختر صفحة Facebook");
  const [draft] = await sql<ConnectionDraftRow[]>`
    select id::text,provider,payload_encrypted,public_payload,expires_at
    from marketing.platform_connection_drafts
    where provider='meta' and user_id=${user.id}::uuid and expires_at>now()
  `;
  if (!draft?.payload_encrypted) throw new Error("جلسة اختيار صفحة Meta منتهية. ابدأ إعادة الربط من جديد.");
  let pending: any;
  try { pending = JSON.parse(decryptPlatformToken(draft.payload_encrypted)); }
  catch { throw new Error("تعذر قراءة جلسة اختيار صفحة Meta. ابدأ إعادة الربط من جديد."); }
  const pages = array(pending.pages).map((item) => item as MetaPage);
  const page = pages.find((item) => clean(item.id) === pageId);
  if (!page) throw new Error("الصفحة المختارة لم تعد متاحة في جلسة الربط");
  const scopes = array(pending.scopes).map(clean).filter(Boolean);
  assertScopes(scopes, metaScopes(), "Meta");
  const selection = await applyMetaPage(sql, user, {
    userToken: clean(pending.userToken),
    expiresIn: Number(pending.expiresIn || 0) || undefined,
    accountId: clean(pending.accountId),
    accountName: clean(pending.accountName),
    scopes, pages, page,
  });
  await sql`delete from marketing.platform_connection_drafts where id=${draft.id}::uuid and user_id=${user.id}::uuid`;
  await recordEvent(sql, user, "meta", "page_selected", "success", selection.pageName, { pageId: selection.pageId, instagramAccountId: selection.igId || null });
  return { ok: true, message: selection.igId ? "تم ربط Facebook وInstagram بنجاح" : "تم ربط Facebook، ولا يوجد حساب Instagram احترافي مرتبط بالصفحة" };
}

export async function cancelPlatformConnectionDraft(sql: Sql, user: SessionUser, providerValue: unknown) {
  const provider = providerFrom(providerValue);
  const deleted = await sql<{ id: string }[]>`
    delete from marketing.platform_connection_drafts
    where provider=${provider} and user_id=${user.id}::uuid
    returning id::text
  `;
  if (!deleted.length) throw new Error("لا توجد عملية ربط معلقة لإلغائها");
  await recordEvent(sql, user, provider, "oauth_cancelled", "success", undefined, {});
  return { ok: true, message: "تم إلغاء عملية الربط المعلقة بدون التأثير على الربط الحالي" };
}

function tokenNearExpiry(value: unknown, minutes = 10) {
  const date = value ? new Date(String(value)) : null;
  return !date || !Number.isFinite(date.getTime()) || date.getTime() <= Date.now() + minutes * 60 * 1000;
}
async function markValidationFailure(sql: Sql, provider: PlatformProvider, user: SessionUser, message: string) {
  const platforms = provider === "meta" ? ["facebook", "instagram"] : [provider];
  await sql`
    update marketing.platform_connections
    set status='warning',state='validation_failed',last_error=${message},updated_at=now(),updated_by=${user.id}::uuid
    where platform in ${sql(platforms)}
  `;
  await recordEvent(sql, user, provider, "validated", "failed", undefined, { error: message });
}

export async function validatePlatformConnection(sql: Sql, user: SessionUser, request: VercelRequest, providerValue: unknown) {
  const provider = providerFrom(providerValue);
  ensureProviderConfigured(provider, request);
  try {
    if (provider === "meta") {
      const [facebook] = await sql<ConnectionRow[]>`select * from marketing.platform_connections where platform='facebook'`;
      if (!facebook?.connected || !facebook.user_access_token_encrypted) throw new Error("Meta غير مربوطة");
      const userToken = decryptPlatformToken(facebook.user_access_token_encrypted);
      const [account, pages, scopes] = await Promise.all([
        metaGraphGet("/me", userToken, { fields: "id,name" }),
        loadMetaPages(userToken),
        loadMetaGrantedScopes(userToken),
      ]);
      assertScopes(scopes, metaScopes(), "Meta");
      const page = pages.find((item) => clean(item.id) === clean(facebook.page_id));
      if (!page) throw new Error("صفحة Facebook المربوطة لم تعد متاحة للحساب");
      await applyMetaPage(sql, user, { userToken, accountId: clean(account.id), accountName: clean(account.name), scopes, pages, page });
      await recordEvent(sql, user, "meta", "validated", "success", clean(page.name), { pageId: clean(page.id) });
      return { ok: true, message: "تم التحقق من ربط Meta وتحديث بيانات الصفحة" };
    }
    if (provider === "tiktok") {
      const [row] = await sql<ConnectionRow[]>`select * from marketing.platform_connections where platform='tiktok'`;
      if (!row?.connected || !row.access_token_encrypted) throw new Error("TikTok غير مربوطة");
      let accessToken = decryptPlatformToken(row.access_token_encrypted);
      let refreshToken = row.refresh_token_encrypted ? decryptPlatformToken(row.refresh_token_encrypted) : "";
      let token: any = { access_token: accessToken, refresh_token: refreshToken, scope: array(row.scopes).join(",") };
      if (tokenNearExpiry(row.token_expires_at)) {
        if (!refreshToken) throw new Error("Refresh Token الخاص بـTikTok غير موجود");
        token = await refreshTikTokToken(refreshToken);
        accessToken = clean(token.access_token);
        refreshToken = clean(token.refresh_token || refreshToken);
      }
      const scopes = parseScopes(token.scope || array(row.scopes).join(","));
      assertScopes(scopes, tiktokScopes(), "TikTok");
      const profile = await loadTikTokUser(accessToken, scopes);
      await saveTikTokConnection(sql, user, { ...token, scope: scopes.join(","), access_token: accessToken, refresh_token: refreshToken }, profile, row);
      await recordEvent(sql, user, "tiktok", "validated", "success", clean(profile.display_name), { openId: clean(profile.open_id) });
      return { ok: true, message: "تم التحقق من TikTok وتجديد التوكن عند الحاجة" };
    }
    const [row] = await sql<ConnectionRow[]>`select * from marketing.platform_connections where platform='youtube'`;
    if (!row?.connected || !row.access_token_encrypted) throw new Error("YouTube غير مربوطة");
    let accessToken = decryptPlatformToken(row.access_token_encrypted);
    const refreshToken = row.refresh_token_encrypted ? decryptPlatformToken(row.refresh_token_encrypted) : "";
    const storedScopes = array(row.scopes).map(clean).filter(Boolean);
    assertScopes(storedScopes, youtubeScopes(), "YouTube");
    let token: any = { access_token: accessToken, refresh_token: refreshToken, scope: storedScopes.join(" ") };
    if (tokenNearExpiry(row.token_expires_at)) {
      if (!refreshToken) throw new Error("Refresh Token الخاص بـYouTube غير موجود");
      token = { ...await refreshYouTubeToken(refreshToken), refresh_token: refreshToken };
      accessToken = clean(token.access_token);
    }
    const channel = await loadYouTubeChannel(accessToken);
    await saveYouTubeConnection(sql, user, { ...token, scope: storedScopes.join(" "), access_token: accessToken }, channel, refreshToken, row);
    await recordEvent(sql, user, "youtube", "validated", "success", clean(channel.snippet?.title), { channelId: clean(channel.id) });
    return { ok: true, message: "تم التحقق من قناة YouTube وتجديد التوكن عند الحاجة" };
  } catch (error: any) {
    const message = clean(error?.message) || "فشل التحقق من الربط";
    await markValidationFailure(sql, provider, user, message);
    throw new Error(message);
  }
}

async function revokeMeta(token: string) {
  const url = new URL(`https://graph.facebook.com/${metaVersion()}/me/permissions`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("appsecret_proof", metaProof(token));
  await fetchJson(url.toString(), { method: "DELETE" });
}
async function revokeTikTok(token: string) {
  const body = new URLSearchParams({ client_key: clean(process.env.TIKTOK_CLIENT_KEY), client_secret: clean(process.env.TIKTOK_CLIENT_SECRET), token });
  const response = await fetch("https://open.tiktokapis.com/v2/oauth/revoke/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "cache-control": "no-cache" }, body });
  const payload = await response.json().catch(() => ({}));
  const error = object((payload as any).error);
  const errorCode = clean(error.code || (payload as any).error);
  if (!response.ok || (errorCode && errorCode !== "ok")) throw new Error(clean(error.message || (payload as any).error_description || errorCode || `TikTok revoke ${response.status}`));
}
async function revokeGoogle(token: string) {
  const body = new URLSearchParams({ token });
  const response = await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  if (!response.ok) throw new Error(`Google revoke ${response.status}`);
}

export async function disconnectPlatformConnection(sql: Sql, user: SessionUser, providerValue: unknown) {
  const provider = providerFrom(providerValue);
  const platforms = provider === "meta" ? ["facebook", "instagram"] : [provider];
  await sql`delete from marketing.platform_connection_drafts where provider=${provider} and user_id=${user.id}::uuid`;
  const rows = await sql<ConnectionRow[]>`select * from marketing.platform_connections where platform in ${sql(platforms)}`;
  let accountName = "";
  let warning = "";
  try {
    if (provider === "meta") {
      const row = rows.find((item) => item.platform === "facebook");
      accountName = clean(row?.page_name || row?.account_name);
      const token = row?.user_access_token_encrypted ? decryptPlatformToken(row.user_access_token_encrypted) : "";
      if (token) await revokeMeta(token);
    } else if (provider === "tiktok") {
      const row = rows[0];
      accountName = clean(row?.account_name);
      const token = row?.access_token_encrypted ? decryptPlatformToken(row.access_token_encrypted) : "";
      if (token) await revokeTikTok(token);
    } else {
      const row = rows[0];
      accountName = clean(row?.account_name);
      const token = row?.refresh_token_encrypted ? decryptPlatformToken(row.refresh_token_encrypted) : row?.access_token_encrypted ? decryptPlatformToken(row.access_token_encrypted) : "";
      if (token) await revokeGoogle(token);
    }
  } catch (error: any) {
    warning = clean(error?.message) || "تعذر إلغاء التفويض لدى مزود المنصة";
  }
  await sql`
    update marketing.platform_connections
    set connected=false,status='disconnected',state='idle',source=null,account_id=null,account_name=null,page_id=null,page_name=null,ig_user_id=null,username=null,pages='[]'::jsonb,scopes='[]'::jsonb,metadata='{}'::jsonb,access_token_encrypted=null,user_access_token_encrypted=null,page_access_token_encrypted=null,refresh_token_encrypted=null,token_expires_at=null,refresh_token_expires_at=null,last_verified_at=null,last_error=${warning || null},connected_at=null,disconnected_at=now(),updated_at=now(),disconnected_by=${user.id}::uuid,updated_by=${user.id}::uuid
    where platform in ${sql(platforms)}
  `;
  await recordEvent(sql, user, provider, "disconnected", warning ? "warning" : "success", accountName, warning ? { revokeWarning: warning } : {});
  return { ok: true, message: warning ? `تم فصل الربط من المنصة، مع تنبيه: ${warning}` : "تم فصل الربط وإلغاء التفويض بنجاح", warning: warning || null };
}
