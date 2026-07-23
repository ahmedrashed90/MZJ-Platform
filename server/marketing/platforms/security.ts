import crypto from "node:crypto";
import type { SessionUser } from "../../_auth.js";
import { getSql } from "../../_db.js";
import { MarketingError, clean } from "../common.js";

const ENVELOPE_VERSION = "mkt1";

function keyMaterial() {
  const raw = clean(process.env.MARKETING_TOKEN_ENCRYPTION_KEY || process.env.INTEGRATIONS_TOKEN_ENCRYPTION_KEY || process.env.AUTH_SECRET);
  if (!raw) throw new MarketingError(503, "مفتاح تشفير توكنات التسويق غير مضبوط", "TOKEN_ENCRYPTION_NOT_CONFIGURED");
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  } catch { /* fall through */ }
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptPlatformSecret(value: string) {
  const text = clean(value);
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyMaterial(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptPlatformSecret(value: unknown) {
  const text = clean(value);
  if (!text) return "";
  const [version, ivText, tagText, encryptedText] = text.split(".");
  if (version !== ENVELOPE_VERSION || !ivText || !tagText || !encryptedText) throw new MarketingError(500, "صيغة التوكن المشفر غير صحيحة", "INVALID_TOKEN_ENVELOPE");
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", keyMaterial(), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new MarketingError(500, "تعذر فك تشفير توكن المنصة", "TOKEN_DECRYPTION_FAILED");
  }
}

export function secretConfigured(value: unknown) { return Boolean(clean(value)); }
export function hashOAuthState(state: string) { return crypto.createHash("sha256").update(state).digest("hex"); }
export function randomOAuthState() { return crypto.randomBytes(32).toString("base64url"); }

export async function createOAuthState(input: { platformCode: string; redirectUri: string; user: SessionUser }) {
  const sql = getSql();
  const state = randomOAuthState();
  await sql`
    delete from marketing.oauth_states where expires_at < now() - interval '1 hour' or used_at is not null;
    insert into marketing.oauth_states(platform_code,state_hash,user_id,redirect_uri,expires_at)
    values (${clean(input.platformCode)},${hashOAuthState(state)},${input.user.id}::uuid,${clean(input.redirectUri)},now()+interval '10 minutes')
  `;
  return state;
}

export async function consumeOAuthState(input: { platformCode: string; state: string; user: SessionUser }) {
  const sql = getSql();
  const hash = hashOAuthState(clean(input.state));
  return sql.begin(async (tx) => {
    const [row] = await tx<any[]>`
      select id::text,redirect_uri from marketing.oauth_states
      where platform_code=${clean(input.platformCode)} and state_hash=${hash} and user_id=${input.user.id}::uuid
        and used_at is null and expires_at>now()
      for update
    `;
    if (!row) throw new MarketingError(400, "جلسة ربط المنصة انتهت أو غير صحيحة", "INVALID_OAUTH_STATE");
    await tx`update marketing.oauth_states set used_at=now() where id=${row.id}::uuid`;
    return row as { id: string; redirect_uri: string };
  });
}

export function requestOrigin(headers: Record<string, string | string[] | undefined>) {
  const forwardedProto = Array.isArray(headers["x-forwarded-proto"]) ? headers["x-forwarded-proto"][0] : headers["x-forwarded-proto"];
  const forwardedHost = Array.isArray(headers["x-forwarded-host"]) ? headers["x-forwarded-host"][0] : headers["x-forwarded-host"];
  const hostHeader = Array.isArray(headers.host) ? headers.host[0] : headers.host;
  const proto = clean(forwardedProto) || "https";
  const host = clean(forwardedHost) || clean(hostHeader);
  if (!host) throw new MarketingError(400, "تعذر تحديد دومين المنصة", "MISSING_HOST");
  return `${proto}://${host}`;
}
