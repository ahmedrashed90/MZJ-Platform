import { createSign, randomUUID } from "node:crypto";

const DEFAULT_PROJECT_ID = "mzj-tracking";
const DEFAULT_API_KEY = "AIzaSyCorGtT5_Z68jCtLODvqnv0Fb7QW5eR6MQ";

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function serviceAccount() {
  const json = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (json) {
    try {
      const parsed = JSON.parse(json);
      return {
        clientEmail: String(parsed.client_email || ""),
        privateKey: String(parsed.private_key || "").replace(/\\n/g, "\n"),
      };
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON غير صالح");
    }
  }
  return {
    clientEmail: String(process.env.FIREBASE_CLIENT_EMAIL || "").trim(),
    privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim(),
  };
}

async function getGoogleAccessToken() {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) return cachedAccessToken.token;
  const account = serviceAccount();
  if (!account.clientEmail || !account.privateKey) return "";

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: account.clientEmail,
    sub: account.clientEmail,
    aud: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/datastore",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${base64Url(signer.sign(account.privateKey))}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payloadJson = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !payloadJson.access_token) {
    throw new Error(payloadJson.error_description || "تعذر الحصول على صلاحية Firebase");
  }
  cachedAccessToken = {
    token: payloadJson.access_token,
    expiresAt: Date.now() + Number(payloadJson.expires_in || 3600) * 1000,
  };
  return cachedAccessToken.token;
}

type FirestoreScalar = string | number | boolean | null | Date | Record<string, unknown>;

function firestoreValue(value: FirestoreScalar): Record<string, unknown> {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === "object") {
    const fields = Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, firestoreValue(nested as FirestoreScalar)]));
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

export async function queueFirebaseSms(document: Record<string, FirestoreScalar>) {
  const projectId = String(process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID).trim();
  const apiKey = String(process.env.FIREBASE_API_KEY || DEFAULT_API_KEY).trim();
  const documentId = `platform_${Date.now()}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const token = await getGoogleAccessToken();
  const endpoint = new URL(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/sms_outbox`);
  endpoint.searchParams.set("documentId", documentId);
  if (apiKey) endpoint.searchParams.set("key", apiKey);

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(document).map(([key, value]) => [key, firestoreValue(value)])) }),
  });
  const responsePayload = await response.json().catch(() => ({})) as { error?: { message?: string }; name?: string };
  if (!response.ok) {
    const message = responsePayload.error?.message || "تعذر إضافة الرسالة إلى sms_outbox";
    if (!token && (response.status === 401 || response.status === 403)) {
      throw new Error(`${message}. أضف FIREBASE_SERVICE_ACCOUNT_JSON أو FIREBASE_CLIENT_EMAIL وFIREBASE_PRIVATE_KEY في Vercel`);
    }
    throw new Error(message);
  }
  return { documentId, name: responsePayload.name || "" };
}
