import crypto from "node:crypto";
import type { VercelRequest } from "@vercel/node";
import type { SessionUser } from "./_auth.js";
import type { getSql } from "./_db.js";
import { decryptPlatformToken, encryptPlatformToken } from "./_platform-connections.js";

type Sql = ReturnType<typeof getSql>;

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const DEFAULT_ROOT_FOLDER_NAME = "MZJ Platform Storage";

function clean(value: unknown) { return String(value ?? "").trim(); }
function object(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString("base64url"); }
function driveQueryText(value: unknown) { return clean(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }
function folderName(value: unknown, fallback = "Folder") {
  return (clean(value) || fallback).replace(/[\u0000-\u001f]/g, " ").replace(/[\\/]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 180) || fallback;
}

function publicOrigin(request: VercelRequest) {
  const configured = clean(process.env.MZJ_PUBLIC_BASE_URL);
  if (configured) return new URL(configured).origin;
  const forwardedHost = clean(request.headers["x-forwarded-host"]).split(",")[0].trim();
  const host = forwardedHost || clean(request.headers.host).split(",")[0].trim();
  if (!host) throw new Error("Unable to determine the public platform URL");
  const protocol = (clean(request.headers["x-forwarded-proto"]) || (process.env.VERCEL ? "https" : "http")).split(",")[0].trim();
  return new URL(`${protocol}://${host}`).origin;
}

export function googleDriveRedirectUri(request: VercelRequest) {
  return clean(process.env.GOOGLE_DRIVE_REDIRECT_URI) || `${publicOrigin(request)}/api/google-drive/callback`;
}

export function googleDriveFolderUrl(folderId: unknown) {
  const id = clean(folderId);
  return id ? `https://drive.google.com/drive/folders/${encodeURIComponent(id)}` : "";
}

function staticConfig() {
  return {
    clientId: clean(process.env.GOOGLE_DRIVE_CLIENT_ID),
    clientSecret: clean(process.env.GOOGLE_DRIVE_CLIENT_SECRET),
    rootFolderName: clean(process.env.GOOGLE_DRIVE_ROOT_FOLDER_NAME) || DEFAULT_ROOT_FOLDER_NAME,
  };
}

function requireOAuthConfig() {
  const config = staticConfig();
  const missing = [!config.clientId && "GOOGLE_DRIVE_CLIENT_ID", !config.clientSecret && "GOOGLE_DRIVE_CLIENT_SECRET"].filter(Boolean);
  if (missing.length) throw new Error(`Google Drive configuration is incomplete: ${missing.join(", ")}`);
  return config;
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
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  const payload = object(await response.json().catch(() => ({})));
  if (!response.ok || !clean(payload.access_token)) throw new Error(clean(payload.error_description || payload.error) || `Google OAuth exchange failed (${response.status})`);
  return payload;
}

async function refreshAccessToken(sql: Sql, row: any) {
  const config = requireOAuthConfig();
  const refreshToken = decryptPlatformToken(row.refresh_token_encrypted);
  if (!refreshToken) throw new Error("Google Drive refresh token is missing");
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  const payload = object(await response.json().catch(() => ({})));
  if (!response.ok || !clean(payload.access_token)) {
    const message = clean(payload.error_description || payload.error) || `Google Drive token refresh failed (${response.status})`;
    await sql`update marketing.google_drive_connection set status='error',last_error=${message},updated_at=now() where id=1`;
    throw new Error(message);
  }
  const expires = Number(payload.expires_in || 3600);
  await sql`
    update marketing.google_drive_connection
    set status='connected',access_token_encrypted=${encryptPlatformToken(payload.access_token)},
        token_expires_at=now()+make_interval(secs=>${Math.max(60, Math.floor(expires))}),
        last_verified_at=now(),last_error=null,updated_at=now()
    where id=1
  `;
  return clean(payload.access_token);
}

export async function getGoogleDriveAccessToken(sql: Sql) {
  const [row] = await sql<any[]>`select * from marketing.google_drive_connection where id=1`;
  if (!row?.refresh_token_encrypted) throw new Error("Google Drive storage is not connected");
  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
  const current = clean(row.access_token_encrypted) && expiresAt > Date.now() + 120_000 ? decryptPlatformToken(row.access_token_encrypted) : "";
  return current || refreshAccessToken(sql, row);
}

async function driveJson(accessToken: string, url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const response = await fetch(url, { ...init, headers });
  const payload = object(await response.json().catch(() => ({})));
  if (!response.ok) throw new Error(clean(payload.error?.message || payload.error_description || payload.error) || `Google Drive API error ${response.status}`);
  return payload;
}

async function ensureRootFolder(accessToken: string, existingId: string, name: string) {
  if (existingId) {
    try {
      const existing = await driveJson(accessToken, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(existingId)}?fields=id,name,mimeType,trashed`);
      if (clean(existing.id) && existing.mimeType === FOLDER_MIME && existing.trashed !== true) return existing;
    } catch {
      // Recreate below when the saved folder is no longer accessible.
    }
  }
  return driveJson(accessToken, "https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,webViewLink", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ name: folderName(name, DEFAULT_ROOT_FOLDER_NAME), mimeType: FOLDER_MIME }),
  });
}

export async function createGoogleDriveAuthorizationUrl(sql: Sql, user: SessionUser, request: VercelRequest) {
  const config = requireOAuthConfig();
  const state = randomToken(36);
  const redirectUri = googleDriveRedirectUri(request);
  await sql`delete from marketing.google_drive_oauth_states where expires_at<now()`;
  await sql`
    insert into marketing.google_drive_oauth_states(state_hash,user_id,redirect_uri,expires_at)
    values(${sha256(state)},${user.id}::uuid,${redirectUri},now()+interval '10 minutes')
  `;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", DRIVE_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function completeGoogleDriveAuthorization(sql: Sql, input: { code: string; state: string }) {
  const code = clean(input.code), state = clean(input.state);
  if (!code || !state) throw new Error("Google Drive callback data is incomplete");
  const [stateRow] = await sql<any[]>`
    delete from marketing.google_drive_oauth_states
    where state_hash=${sha256(state)} and expires_at>now()
    returning user_id::text,redirect_uri
  `;
  if (!stateRow) throw new Error("Google Drive authorization link expired or is invalid");

  const payload = await exchangeAuthorizationCode(code, clean(stateRow.redirect_uri));
  const [existing] = await sql<any[]>`select refresh_token_encrypted,root_folder_id from marketing.google_drive_connection where id=1`;
  const existingRefresh = clean(existing?.refresh_token_encrypted);
  const refreshToken = clean(payload.refresh_token);
  if (!refreshToken && !existingRefresh) throw new Error("Google did not return a refresh token. Start the connection again and approve access");
  const accessToken = clean(payload.access_token);
  const expires = Number(payload.expires_in || 3600);
  const config = staticConfig();
  const root = await ensureRootFolder(accessToken, clean(existing?.root_folder_id), config.rootFolderName);
  const rootFolderId = clean(root.id);
  if (!rootFolderId) throw new Error("Unable to create the MZJ Google Drive storage folder");

  await sql`
    insert into marketing.google_drive_connection(
      id,status,root_folder_id,root_folder_name,scopes,access_token_encrypted,refresh_token_encrypted,
      token_expires_at,last_verified_at,last_error,connected_by,connected_at,updated_at
    ) values(
      1,'connected',${rootFolderId},${clean(root.name) || config.rootFolderName},${sql.json([DRIVE_SCOPE])},
      ${encryptPlatformToken(accessToken)},${refreshToken ? encryptPlatformToken(refreshToken) : existingRefresh},
      now()+make_interval(secs=>${Math.max(60, Math.floor(expires))}),now(),null,${stateRow.user_id}::uuid,now(),now()
    )
    on conflict(id) do update set
      status='connected',root_folder_id=excluded.root_folder_id,root_folder_name=excluded.root_folder_name,scopes=excluded.scopes,
      access_token_encrypted=excluded.access_token_encrypted,
      refresh_token_encrypted=coalesce(excluded.refresh_token_encrypted,marketing.google_drive_connection.refresh_token_encrypted),
      token_expires_at=excluded.token_expires_at,last_verified_at=now(),last_error=null,connected_by=excluded.connected_by,
      connected_at=coalesce(marketing.google_drive_connection.connected_at,now()),updated_at=now()
  `;
  return { ok: true, rootFolderId, rootFolderName: clean(root.name) || config.rootFolderName };
}

export async function getGoogleDriveConnectionStatus(sql: Sql) {
  const [row] = await sql<any[]>`select * from marketing.google_drive_connection where id=1`;
  const config = staticConfig();
  return {
    configured: Boolean(config.clientId && config.clientSecret),
    connected: Boolean(row?.status === "connected" && row?.refresh_token_encrypted && row?.root_folder_id),
    status: clean(row?.status) || "disconnected",
    rootFolderId: clean(row?.root_folder_id),
    rootFolderName: clean(row?.root_folder_name) || config.rootFolderName,
    lastVerifiedAt: row?.last_verified_at || null,
    lastError: clean(row?.last_error),
  };
}

export async function getGoogleDriveRuntime(sql: Sql) {
  const [row] = await sql<any[]>`select * from marketing.google_drive_connection where id=1`;
  if (!row?.refresh_token_encrypted || !clean(row?.root_folder_id)) throw new Error("Google Drive storage is not connected. Open /api/google-drive/connect first");
  return { accessToken: await getGoogleDriveAccessToken(sql), rootFolderId: clean(row.root_folder_id) };
}

export type GoogleDriveFolderItem = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdTime: string | null;
  modifiedTime: string | null;
  isFolder: boolean;
  parents: string[];
};

async function driveFileInfoWithToken(accessToken: string, fileId: string) {
  return driveJson(accessToken, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(clean(fileId))}?fields=id,name,mimeType,size,parents,webViewLink,webContentLink,appProperties,trashed,createdTime,modifiedTime`);
}

export async function listGoogleDriveFolder(sql: Sql, folderId: string): Promise<GoogleDriveFolderItem[]> {
  const id = clean(folderId);
  if (!id) throw new Error("Google Drive folder is not specified");
  const runtime = await getGoogleDriveRuntime(sql);
  const files: any[] = [];
  let pageToken = "";
  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", `'${driveQueryText(id)}' in parents and trashed=false`);
    url.searchParams.set("spaces", "drive");
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("orderBy", "name_natural");
    url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size,parents,createdTime,modifiedTime,trashed)");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const payload = await driveJson(runtime.accessToken, url.toString());
    if (Array.isArray(payload.files)) files.push(...payload.files);
    pageToken = clean(payload.nextPageToken);
  } while (pageToken);
  return files
    .filter((item: any) => clean(item?.id) && item?.trashed !== true)
    .map((item: any) => ({
      id: clean(item.id),
      name: clean(item.name) || "file",
      mimeType: clean(item.mimeType) || "application/octet-stream",
      size: Math.max(0, Number(item.size || 0) || 0),
      createdTime: clean(item.createdTime) || null,
      modifiedTime: clean(item.modifiedTime) || null,
      isFolder: clean(item.mimeType) === FOLDER_MIME,
      parents: Array.isArray(item.parents) ? item.parents.map(clean).filter(Boolean) : [],
    }))
    .sort((a: GoogleDriveFolderItem, b: GoogleDriveFolderItem) => Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name, "ar"));
}

export async function googleDrivePathWithinRoot(sql: Sql, itemId: string, rootFolderId: string) {
  const item = clean(itemId), root = clean(rootFolderId);
  if (!item || !root) return null;
  const runtime = await getGoogleDriveRuntime(sql);
  const reversed: Array<{ id: string; name: string; mimeType: string }> = [];
  const visited = new Set<string>();
  let current = item;
  for (let depth = 0; depth < 30 && current; depth += 1) {
    if (visited.has(current)) return null;
    visited.add(current);
    const info = await driveFileInfoWithToken(runtime.accessToken, current);
    if (!clean(info.id) || info.trashed === true) return null;
    reversed.push({ id: clean(info.id), name: clean(info.name) || "Folder", mimeType: clean(info.mimeType) });
    if (clean(info.id) === root) return reversed.reverse();
    const parents = Array.isArray(info.parents) ? info.parents.map(clean).filter(Boolean) : [];
    current = parents[0] || "";
  }
  return null;
}

export async function ensureGoogleDriveFolder(sql: Sql, input: { parentId?: string; name: string; appProperties?: Record<string, string> }) {
  const runtime = await getGoogleDriveRuntime(sql);
  const parentId = clean(input.parentId) || runtime.rootFolderId;
  const name = folderName(input.name);
  const q = `'${driveQueryText(parentId)}' in parents and mimeType='${FOLDER_MIME}' and trashed=false and name='${driveQueryText(name)}'`;
  const listUrl = new URL("https://www.googleapis.com/drive/v3/files");
  listUrl.searchParams.set("q", q);
  listUrl.searchParams.set("spaces", "drive");
  listUrl.searchParams.set("pageSize", "10");
  listUrl.searchParams.set("fields", "files(id,name,mimeType,parents,webViewLink,appProperties,trashed)");
  const list = await driveJson(runtime.accessToken, listUrl.toString());
  const existing = Array.isArray(list.files) ? list.files.find((item: any) => clean(item?.id) && item?.trashed !== true) : null;
  if (existing) return { ...existing, webViewLink: clean(existing.webViewLink) || googleDriveFolderUrl(existing.id) };

  const created = await driveJson(runtime.accessToken, "https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,parents,webViewLink,appProperties", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId],
      appProperties: input.appProperties || undefined,
    }),
  });
  return { ...created, webViewLink: clean(created.webViewLink) || googleDriveFolderUrl(created.id) };
}

export type GoogleDriveUploadInput = {
  fileId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  category: string;
  storageKey: string;
  parentFolderId?: string;
};

export async function createGoogleDriveResumableUpload(sql: Sql, input: GoogleDriveUploadInput) {
  const runtime = await getGoogleDriveRuntime(sql);
  const parentFolderId = clean(input.parentFolderId) || runtime.rootFolderId;
  const url = new URL("https://www.googleapis.com/upload/drive/v3/files");
  url.searchParams.set("uploadType", "resumable");
  url.searchParams.set("fields", "id,name,mimeType,size,parents,webViewLink,webContentLink,appProperties");
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${runtime.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": clean(input.mimeType) || "application/octet-stream",
      "X-Upload-Content-Length": String(Math.max(0, Number(input.fileSize) || 0)),
    },
    body: JSON.stringify({
      name: clean(input.fileName) || "file.bin",
      mimeType: clean(input.mimeType) || "application/octet-stream",
      parents: [parentFolderId],
      appProperties: {
        mzjFileId: clean(input.fileId),
        mzjCategory: clean(input.category),
        mzjStorageKeyHash: sha256(clean(input.storageKey)).slice(0, 40),
      },
    }),
  });
  const message = clean(await response.text().catch(() => ""));
  if (!response.ok) {
    let parsed: any = {};
    try { parsed = message ? JSON.parse(message) : {}; } catch { parsed = {}; }
    throw new Error(clean(parsed?.error?.message || parsed?.error) || message || `Unable to prepare Google Drive upload (${response.status})`);
  }
  const uploadUrl = clean(response.headers.get("location"));
  if (!uploadUrl) throw new Error("Google Drive did not return a resumable upload URL");
  return { uploadUrl, rootFolderId: runtime.rootFolderId, parentFolderId };
}

export async function getGoogleDriveFileInfo(sql: Sql, externalId: string) {
  const runtime = await getGoogleDriveRuntime(sql);
  return driveFileInfoWithToken(runtime.accessToken, externalId);
}

export async function findGoogleDriveUploadedFile(sql: Sql, fileId: string) {
  const runtime = await getGoogleDriveRuntime(sql);
  const mzjFileId = clean(fileId);
  if (!mzjFileId) return null;
  const q = `appProperties has { key='mzjFileId' and value='${driveQueryText(mzjFileId)}' } and trashed=false`;
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", q);
  url.searchParams.set("spaces", "drive");
  url.searchParams.set("pageSize", "10");
  url.searchParams.set("fields", "files(id,name,mimeType,size,parents,webViewLink,webContentLink,appProperties,trashed,createdTime)");
  const payload = await driveJson(runtime.accessToken, url.toString());
  const files = Array.isArray(payload.files) ? payload.files : [];
  return files.find((item: any) => clean(item?.appProperties?.mzjFileId) === mzjFileId && item?.trashed !== true) || null;
}

export async function verifyGoogleDriveUploadedFile(sql: Sql, input: { externalId?: string; fileId: string; expectedSize?: number | null }) {
  const directId = clean(input.externalId);
  let info = directId ? await getGoogleDriveFileInfo(sql, directId) : null;
  if (!directId) {
    for (let attempt = 0; attempt < 4 && !info; attempt += 1) {
      info = await findGoogleDriveUploadedFile(sql, input.fileId);
      if (!info && attempt < 3) await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  if (!info || !clean(info.id) || info.trashed === true) throw new Error("Uploaded Google Drive file is unavailable");
  if (clean(info.appProperties?.mzjFileId) !== clean(input.fileId)) throw new Error("Uploaded Google Drive file does not match the MZJ file record");
  const expected = Number(input.expectedSize || 0);
  const actual = Number(info.size || 0);
  if (expected > 0 && actual > 0 && expected !== actual) throw new Error("Uploaded Google Drive file size does not match the selected file");
  return info;
}

export async function openGoogleDriveFile(sql: Sql, externalId: string, accept = "application/octet-stream,*/*") {
  const runtime = await getGoogleDriveRuntime(sql);
  return fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(clean(externalId))}?alt=media`, {
    redirect: "follow",
    headers: { Authorization: `Bearer ${runtime.accessToken}`, Accept: accept },
  });
}

export async function deleteGoogleDriveFile(sql: Sql, externalId: string) {
  const id = clean(externalId);
  if (!id) return { ok: true };
  const runtime = await getGoogleDriveRuntime(sql);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${runtime.accessToken}` },
  });
  if (!response.ok && response.status !== 404) {
    const payload = object(await response.json().catch(() => ({})));
    throw new Error(clean(payload?.error?.message || payload?.error) || `Unable to delete Google Drive file (${response.status})`);
  }
  return { ok: true };
}

export function createGoogleDriveUploadTicket() { return randomToken(36); }
export function googleDriveTicketHash(ticket: string) { return sha256(ticket); }
