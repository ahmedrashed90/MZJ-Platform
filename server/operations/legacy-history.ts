import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createSign } from "node:crypto";
import { requireOperationsUser } from "../_operations-auth.js";

function clean(v: unknown) { return String(v ?? "").trim(); }
function b64url(input: string) { return Buffer.from(input).toString("base64url"); }

let tokenCache: { token: string; expiresAt: number } | null = null;
async function accessToken() {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) return tokenCache.token;
  const projectId = clean(process.env.LEGACY_FIREBASE_PROJECT_ID);
  const clientEmail = clean(process.env.LEGACY_FIREBASE_CLIENT_EMAIL);
  const privateKey = clean(process.env.LEGACY_FIREBASE_PRIVATE_KEY).replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) throw new Error("LEGACY_FIREBASE_ENV_MISSING");
  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(privateKey).toString("base64url")}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const data = await response.json().catch(() => ({} as any));
  if (!response.ok || !data.access_token) throw new Error(`LEGACY_FIREBASE_TOKEN_FAILED:${data.error_description || data.error || response.status}`);
  tokenCache = { token: data.access_token, expiresAt: now + Number(data.expires_in || 3600) * 1000 };
  return tokenCache.token;
}

function firestoreString(value: string) { return { stringValue: value }; }

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireOperationsUser(request, response);
  if (!user) return;
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const body = (request.body && typeof request.body === "object") ? request.body as any : JSON.parse(String(request.body || "{}"));
    const projectId = clean(process.env.LEGACY_FIREBASE_PROJECT_ID);
    const token = await accessToken();
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    if (body.kind === "query") {
      const collectionId = clean(body.collectionId);
      const fieldPath = clean(body.fieldPath);
      const op = clean(body.op);
      const value = clean(body.value);
      const allowedCollections = new Set(["logs", "requests", "transfers"]);
      const allowedFields = new Set(["vin", "payload.vin", "payload.vins", "vins"]);
      const allowedOps = new Set(["EQUAL", "ARRAY_CONTAINS"]);
      if (!allowedCollections.has(collectionId) || !allowedFields.has(fieldPath) || !allowedOps.has(op) || !value) {
        return response.status(400).json({ ok: false, error: "INVALID_LEGACY_QUERY" });
      }
      const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:runQuery`;
      const upstream = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId }], where: { fieldFilter: { field: { fieldPath }, op, value: firestoreString(value) } } } }),
      });
      const payload = await upstream.json().catch(() => []);
      if (!upstream.ok) return response.status(upstream.status).json({ ok: false, error: payload?.error?.message || "LEGACY_FIRESTORE_READ_FAILED", details: payload });
      return response.status(200).json({ ok: true, payload });
    }

    if (body.kind === "car") {
      const vin = clean(body.vin);
      if (!vin) return response.status(400).json({ ok: false, error: "VIN_REQUIRED" });
      const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/cars/${encodeURIComponent(vin)}`;
      const upstream = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      if (upstream.status === 404) return response.status(200).json({ ok: true, payload: null });
      const payload = await upstream.json().catch(() => ({}));
      if (!upstream.ok) return response.status(upstream.status).json({ ok: false, error: payload?.error?.message || "LEGACY_FIRESTORE_READ_FAILED", details: payload });
      return response.status(200).json({ ok: true, payload });
    }

    return response.status(400).json({ ok: false, error: "INVALID_KIND" });
  } catch (error) {
    console.error("legacy history read failed", error);
    const message = error instanceof Error ? error.message : "LEGACY_HISTORY_FAILED";
    return response.status(500).json({ ok: false, error: message });
  }
}
