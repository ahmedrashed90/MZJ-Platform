import crypto from "node:crypto";
import type { getSql } from "./_db.js";
import { openGoogleDriveFile } from "./_google-drive-storage.js";

type Sql = ReturnType<typeof getSql>;

function clean(value: unknown) { return String(value ?? "").trim(); }
function positiveInteger(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0; }
function first(value: unknown) { return Array.isArray(value) ? value[0] : value; }

function signingSecret() {
  const secret = clean(process.env.MZJ_GOOGLE_DRIVE_MEDIA_SIGNING_KEY || process.env.MZJ_PLATFORM_TOKEN_ENCRYPTION_KEY || process.env.MZJ_TOKEN_ENCRYPTION_KEY);
  if (!secret || secret.length < 32) throw new Error("Google Drive media signing key is not configured");
  return crypto.createHash("sha256").update(`google-drive-media-delivery:v1:${secret}`).digest();
}

function publicOrigin() {
  const configured = clean(process.env.MZJ_PUBLIC_BASE_URL);
  const vercelProduction = clean(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  const vercelDeployment = clean(process.env.VERCEL_URL);
  const candidate = configured || vercelProduction || vercelDeployment;
  if (!candidate) throw new Error("MZJ_PUBLIC_BASE_URL is not configured");
  const normalized = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  return new URL(normalized).origin;
}

function signaturePayload(fileId: string, expiresAt: number) { return `v1:${fileId}:${expiresAt}`; }
function sign(fileId: string, expiresAt: number) { return crypto.createHmac("sha256", signingSecret()).update(signaturePayload(fileId, expiresAt)).digest("base64url"); }

export function createGoogleDriveMediaDeliveryUrl(file: any, lifetimeSeconds = 7200) {
  const fileId = clean(file?.id);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fileId)) throw new Error("Invalid Google Drive media file ID");
  const lifetime = Math.min(10_800, Math.max(900, positiveInteger(lifetimeSeconds) || 7200));
  const expiresAt = Math.floor(Date.now() / 1000) + lifetime;
  const url = new URL("/api/marketing/google-drive-media", publicOrigin());
  url.searchParams.set("file", fileId);
  url.searchParams.set("expires", String(expiresAt));
  url.searchParams.set("signature", sign(fileId, expiresAt));
  return url.toString();
}

export function verifyGoogleDriveMediaQuery(query: Record<string, unknown>) {
  const fileId = clean(first(query.file));
  const expiresAt = positiveInteger(first(query.expires));
  const received = clean(first(query.signature));
  if (!fileId || !expiresAt || !received) return { ok: false as const, error: "Incomplete media URL" };
  const now = Math.floor(Date.now() / 1000);
  if (expiresAt < now - 60 || expiresAt > now + 10_860) return { ok: false as const, error: "Expired media URL" };
  const expected = sign(fileId, expiresAt);
  const a = Buffer.from(received), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false as const, error: "Invalid media signature" };
  return { ok: true as const, fileId };
}

export async function openGoogleDriveMediaByFileId(sql: Sql, fileId: string) {
  const [file] = await sql<any[]>`select * from marketing.files where id=${fileId}::uuid and status='ready' and storage_provider='google-drive' limit 1`;
  if (!file) throw Object.assign(new Error("Google Drive media file was not found"), { statusCode: 404 });
  const externalId = clean(file.external_id);
  if (!externalId) throw Object.assign(new Error("Google Drive external file ID is missing"), { statusCode: 404 });
  const upstream = await openGoogleDriveFile(sql, externalId, "application/octet-stream,*/*");
  return { file, upstream };
}
