import crypto from "node:crypto";
import type { VercelRequest } from "@vercel/node";
import type { SessionUser } from "./_auth.js";
import type { getSql } from "./_db.js";
import { decryptPlatformToken, encryptPlatformToken } from "./_platform-connections.js";

type Sql = ReturnType<typeof getSql>;

const DEFAULT_ACCOUNTS_DOMAIN = "https://accounts.zoho.sa";
const DEFAULT_API_DOMAIN = "https://www.zohoapis.sa";
const DEFAULT_UPLOAD_DOMAIN = "https://files.zoho.sa";
const DEFAULT_ROOT_FOLDER_ID = "efosi67f34a771f13446c8d01545192eb1829";
const ZOHO_SCOPES = [
  "WorkDrive.files.CREATE",
  "WorkDrive.files.READ",
  "WorkDrive.users.READ",
  "ZohoFiles.files.CREATE",
  "ZohoFiles.files.READ",
];

function clean(value: unknown) { return String(value ?? "").trim(); }
function object(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString("base64url"); }
function normalizeDomain(value: unknown, fallback: string) { return (clean(value) || fallback).replace(/\/+$/, ""); }

function publicOrigin(request: VercelRequest) {
  const configured = clean(process.env.MZJ_PUBLIC_BASE_URL);
  if (configured) return new URL(configured).origin;
  const forwardedHost = clean(request.headers["x-forwarded-host"]).split(",")[0].trim();
  const host = forwardedHost || clean(request.headers.host).split(",")[0].trim();
  if (!host) throw new Error("تعذر تحديد رابط المنصة العام");
  const protocol = (clean(request.headers["x-forwarded-proto"]) || (process.env.VERCEL ? "https" : "http")).split(",")[0].trim();
  return new URL(`${protocol}://${host}`).origin;
}

export function zohoRedirectUri(request: VercelRequest) {
  return clean(process.env.ZOHO_REDIRECT_URI) || `${publicOrigin(request)}/api/integrations/zoho/callback`;
}

function zohoStaticConfig() {
  const clientId = clean(process.env.ZOHO_CLIENT_ID);
  const clientSecret = clean(process.env.ZOHO_CLIENT_SECRET);
  const accountsDomain = normalizeDomain(process.env.ZOHO_ACCOUNTS_URL || process.env.ZOHO_ACCOUNTS_DOMAIN, DEFAULT_ACCOUNTS_DOMAIN);
  const apiDomain = normalizeDomain(process.env.ZOHO_API_DOMAIN, DEFAULT_API_DOMAIN);
  const uploadDomain = normalizeDomain(process.env.ZOHO_UPLOAD_DOMAIN, DEFAULT_UPLOAD_DOMAIN);
  const rootFolderId = clean(process.env.ZOHO_PUBLISH_ROOT_FOLDER_ID || process.env.ZOHO_WORKDRIVE_FOLDER_ID) || DEFAULT_ROOT_FOLDER_ID;
  return { clientId, clientSecret, accountsDomain, apiDomain, uploadDomain, rootFolderId };
}

function requireOAuthConfig() {
  const config = zohoStaticConfig();
  const missing = [!config.clientId && "ZOHO_CLIENT_ID", !config.clientSecret && "ZOHO_CLIENT_SECRET"].filter(Boolean);
  if (missing.length) throw new Error(`إعداد Zoho غير مكتمل: ${missing.join("، ")}`);
  return config;
}

export async function createZohoAuthorizationUrl(sql: Sql, user: SessionUser, request: VercelRequest) {
  const config = requireOAuthConfig();
  const state = randomToken(36);
  const redirectUri = zohoRedirectUri(request);
  await sql`delete from marketing.zoho_oauth_states where expires_at<now()`;
  await sql`
    insert into marketing.zoho_oauth_states(state_hash,user_id,redirect_uri,expires_at)
    values(${sha256(state)},${user.id}::uuid,${redirectUri},now()+interval '10 minutes')
  `;
  const url = new URL(`${config.accountsDomain}/oauth/v2/auth`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("scope", ZOHO_SCOPES.join(","));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

async function exchangeAuthorizationCode(code: string, redirectUri: string) {
  const config = requireOAuthConfig();
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const response = await fetch(`${config.accountsDomain}/oauth/v2/token`, { method: "POST", body });
  const payload = object(await response.json().catch(() => ({})));
  if (!response.ok || !clean(payload.access_token)) throw new Error(clean(payload.error_description || payload.error) || `تعذر استكمال ربط Zoho (${response.status})`);
  return payload;
}

export async function completeZohoAuthorization(sql: Sql, input: { code: string; state: string }) {
  const code = clean(input.code), state = clean(input.state);
  if (!code || !state) throw new Error("بيانات رجوع Zoho غير مكتملة");
  const [stateRow] = await sql<any[]>`
    delete from marketing.zoho_oauth_states
    where state_hash=${sha256(state)} and expires_at>now()
    returning user_id::text,redirect_uri
  `;
  if (!stateRow) throw new Error("رابط ربط Zoho منتهي أو غير صالح. ابدأ الربط مرة أخرى");
  const payload = await exchangeAuthorizationCode(code, clean(stateRow.redirect_uri));
  const config = zohoStaticConfig();
  const refreshToken = clean(payload.refresh_token);
  const existing = await sql<any[]>`select refresh_token_encrypted from marketing.zoho_workdrive_connection where id=1`;
  const existingRefresh = clean(existing[0]?.refresh_token_encrypted);
  if (!refreshToken && !existingRefresh) throw new Error("Zoho لم يرجع Refresh Token. أعد الربط مع الموافقة الكاملة");
  const accessExpires = Number(payload.expires_in_sec || payload.expires_in || 3600);
  const apiDomain = normalizeDomain(payload.api_domain, config.apiDomain);
  const accessToken = clean(payload.access_token);
  const folderResponse = await fetch(`${apiDomain}/workdrive/api/v1/files/${encodeURIComponent(config.rootFolderId)}`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, Accept: "application/vnd.api+json" },
  });
  const folderPayload = object(await folderResponse.json().catch(() => ({})));
  if (!folderResponse.ok || folderPayload.errors) throw new Error("تم تسجيل الدخول إلى Zoho لكن الحساب لا يستطيع الوصول إلى فولدر MZJ PUBLISH المحدد");
  const userResponse = await fetch(`${apiDomain}/workdrive/api/v1/users/me`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, Accept: "application/vnd.api+json" },
  });
  const userPayload = object(await userResponse.json().catch(() => ({})));
  if (!userResponse.ok || userPayload.errors) throw new Error("تم ربط الفولدر لكن تعذر قراءة هوية مستخدم Zoho. أعد الربط بعد قبول كل الصلاحيات");
  await sql`
    insert into marketing.zoho_workdrive_connection(
      id,status,account_email,accounts_domain,api_domain,upload_domain,root_folder_id,scopes,
      access_token_encrypted,refresh_token_encrypted,token_expires_at,last_verified_at,last_error,connected_by,connected_at,updated_at
    ) values(
      1,'connected',${clean(process.env.ZOHO_ACCOUNT_EMAIL)||'marketing@mzjcars.com'},${config.accountsDomain},${apiDomain},${config.uploadDomain},${config.rootFolderId},${sql.json(ZOHO_SCOPES)},
      ${encryptPlatformToken(accessToken)},${refreshToken ? encryptPlatformToken(refreshToken) : existingRefresh},now()+make_interval(secs=>${Math.max(60,Math.floor(accessExpires))}),now(),null,${stateRow.user_id}::uuid,now(),now()
    )
    on conflict(id) do update set
      status='connected',account_email=excluded.account_email,accounts_domain=excluded.accounts_domain,api_domain=excluded.api_domain,
      upload_domain=excluded.upload_domain,root_folder_id=excluded.root_folder_id,scopes=excluded.scopes,
      access_token_encrypted=excluded.access_token_encrypted,
      refresh_token_encrypted=coalesce(excluded.refresh_token_encrypted,marketing.zoho_workdrive_connection.refresh_token_encrypted),
      token_expires_at=excluded.token_expires_at,last_verified_at=now(),last_error=null,connected_by=excluded.connected_by,
      connected_at=coalesce(marketing.zoho_workdrive_connection.connected_at,now()),updated_at=now()
  `;
  return { ok: true, accountEmail: clean(process.env.ZOHO_ACCOUNT_EMAIL) || "marketing@mzjcars.com", rootFolderId: config.rootFolderId };
}

export async function getZohoConnectionStatus(sql: Sql) {
  const [row] = await sql<any[]>`select * from marketing.zoho_workdrive_connection where id=1`;
  const config = zohoStaticConfig();
  return {
    configured: Boolean(config.clientId && config.clientSecret && config.rootFolderId),
    connected: Boolean(row?.status === "connected" && row?.refresh_token_encrypted),
    status: clean(row?.status) || "disconnected",
    accountEmail: clean(row?.account_email) || clean(process.env.ZOHO_ACCOUNT_EMAIL) || "marketing@mzjcars.com",
    rootFolderId: clean(row?.root_folder_id) || config.rootFolderId,
    apiDomain: clean(row?.api_domain) || config.apiDomain,
    uploadDomain: clean(row?.upload_domain) || config.uploadDomain,
    lastVerifiedAt: row?.last_verified_at || null,
    lastError: clean(row?.last_error),
  };
}

async function refreshAccessToken(sql: Sql, row: any) {
  const config = requireOAuthConfig();
  const refreshToken = decryptPlatformToken(row.refresh_token_encrypted);
  if (!refreshToken) throw new Error("Refresh Token الخاص بـZoho غير موجود");
  const accountsDomain = normalizeDomain(row.accounts_domain, config.accountsDomain);
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });
  const response = await fetch(`${accountsDomain}/oauth/v2/token`, { method: "POST", body });
  const payload = object(await response.json().catch(() => ({})));
  if (!response.ok || !clean(payload.access_token)) {
    const message = clean(payload.error_description || payload.error) || `تعذر تجديد Zoho Access Token (${response.status})`;
    await sql`update marketing.zoho_workdrive_connection set status='error',last_error=${message},updated_at=now() where id=1`;
    throw new Error(message);
  }
  const expires = Number(payload.expires_in_sec || payload.expires_in || 3600);
  const apiDomain = normalizeDomain(payload.api_domain, clean(row.api_domain) || config.apiDomain);
  await sql`
    update marketing.zoho_workdrive_connection
    set status='connected',access_token_encrypted=${encryptPlatformToken(payload.access_token)},token_expires_at=now()+make_interval(secs=>${Math.max(60,Math.floor(expires))}),
        api_domain=${apiDomain},last_verified_at=now(),last_error=null,updated_at=now()
    where id=1
  `;
  return clean(payload.access_token);
}

export async function getZohoAccessToken(sql: Sql) {
  const [row] = await sql<any[]>`select * from marketing.zoho_workdrive_connection where id=1`;
  if (!row?.refresh_token_encrypted) throw new Error("Zoho WorkDrive غير مربوط. افتح مسار ربط Zoho أولًا");
  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
  const current = clean(row.access_token_encrypted) && expiresAt > Date.now() + 120_000 ? decryptPlatformToken(row.access_token_encrypted) : "";
  return current || refreshAccessToken(sql, row);
}

export async function getZohoTransferRuntime(sql: Sql) {
  const [row] = await sql<any[]>`select * from marketing.zoho_workdrive_connection where id=1`;
  const config = zohoStaticConfig();
  if (!row?.refresh_token_encrypted) throw new Error("Zoho WorkDrive غير مربوط");
  return {
    accessToken: await getZohoAccessToken(sql),
    apiDomain: normalizeDomain(row.api_domain, config.apiDomain),
    uploadDomain: normalizeDomain(row.upload_domain, config.uploadDomain),
    rootFolderId: clean(row.root_folder_id) || config.rootFolderId,
  };
}

export async function getZohoRuntime(sql: Sql) {
  const runtime = await getZohoTransferRuntime(sql);
  const userResponse = await fetch(`${runtime.apiDomain}/workdrive/api/v1/users/me`, {
    headers: { Authorization: `Zoho-oauthtoken ${runtime.accessToken}`, Accept: "application/vnd.api+json" },
  });
  const userPayload = object(await userResponse.json().catch(() => ({})));
  const userData = object(userPayload.data);
  const userAttributes = object(userData.attributes);
  const userId = clean(userAttributes.zuid || userAttributes.zid || userData.id);
  if (!userResponse.ok || !userId) throw new Error("تعذر قراءة هوية حساب Zoho المتصل. أعد ربط Zoho من صفحة ربط المنصات");
  return { ...runtime, userId };
}

export function createOpaqueTicket() { return randomToken(36); }
export function ticketHash(ticket: string) { return sha256(ticket); }

export async function getZohoUploadProgress(sql: Sql, uploadId: string) {
  const runtime = await getZohoRuntime(sql);
  const progressId = `upload_${runtime.userId}_${clean(uploadId)}`;
  const response = await fetch(`${runtime.apiDomain}/workdrive/uploadprogress?uploadid=${encodeURIComponent(progressId)}`, {
    headers: { Authorization: `Zoho-oauthtoken ${runtime.accessToken}`, Accept: "application/vnd.api+json" },
  });
  const payload = object(await response.json().catch(() => ({})));
  if (!response.ok) throw new Error(clean(payload.message || payload.error) || `تعذر التحقق من حالة رفع Zoho (${response.status})`);
  return payload;
}

export async function getZohoFileInfo(sql: Sql, externalId: string) {
  const runtime = await getZohoRuntime(sql);
  const response = await fetch(`${runtime.apiDomain}/workdrive/api/v1/files/${encodeURIComponent(externalId)}`, {
    headers: { Authorization: `Zoho-oauthtoken ${runtime.accessToken}`, Accept: "application/vnd.api+json" },
  });
  const payload = object(await response.json().catch(() => ({})));
  if (!response.ok || payload.errors) {
    const first = Array.isArray(payload.errors) ? payload.errors[0] : payload.error;
    throw new Error(clean(first?.title || first?.detail || first) || `تعذر قراءة ملف Zoho (${response.status})`);
  }
  const parsed = parseZohoUploadResult(payload);
  const data = object(payload.data);
  const attributes = object(data.attributes);
  return {
    ...parsed,
    resourceId: parsed.resourceId || clean(data.id),
    fileName: parsed.fileName || clean(attributes.name),
    permalink: parsed.permalink || clean(attributes.permalink),
    downloadUrl: clean(attributes.download_url),
  };
}

export function parseZohoUploadResult(payload: unknown) {
  const root = object(payload);
  const data = Array.isArray(root.data) ? object(root.data[0]) : object(root.data);
  const attributes = object(data.attributes);
  const fileInfoRaw = clean(attributes.file_info || attributes["File INFO"] || attributes.File_INFO);
  let fileInfo: Record<string, any> = {};
  try { fileInfo = fileInfoRaw ? object(JSON.parse(fileInfoRaw)) : {}; } catch { fileInfo = {}; }
  const auditInfo = object(root.AUDIT_INFO || fileInfo.AUDIT_INFO);
  const auditResource = object(auditInfo.resource);
  return {
    resourceId: clean(attributes.resource_id || data.id || root.resource_id || root.RESOURCE_ID || root.id || fileInfo.RESOURCE_ID),
    parentId: clean(attributes.parent_id || root.PARENT_ID || fileInfo.PARENT_ID),
    fileName: clean(attributes.file_name || attributes.filename || attributes.FileName || attributes.name || auditResource.name),
    permalink: clean(attributes.permalink || attributes.Permalink || attributes.web_url || attributes.open_url || fileInfo.PERMALINK || root.permalink),
    statusCode: clean(auditInfo.statusCode || root.statusCode || root.status),
  };
}
