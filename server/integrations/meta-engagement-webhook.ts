import crypto from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { processMetaEngagementWebhook } from "../_marketing-engagement.js";

function clean(value: unknown) { return String(Array.isArray(value) ? value[0] : value ?? "").trim(); }

async function rawBody(request: VercelRequest) {
  if (Buffer.isBuffer(request.body)) return request.body;
  if (typeof request.body === "string") return Buffer.from(request.body);
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function safeEqual(expected: string, actual: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  const verifyToken = clean(process.env.META_WEBHOOK_VERIFY_TOKEN);
  if (request.method === "GET") {
    const mode = clean(request.query["hub.mode"]);
    const token = clean(request.query["hub.verify_token"]);
    const challenge = clean(request.query["hub.challenge"]);
    if (mode === "subscribe" && verifyToken && safeEqual(verifyToken, token)) return response.status(200).send(challenge);
    return response.status(403).json({ ok: false, error: "Webhook verification failed" });
  }
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const appSecret = clean(process.env.META_APP_SECRET);
  if (!appSecret) return response.status(503).json({ ok: false, error: "META_APP_SECRET is not configured" });
  try {
    const body = await rawBody(request);
    const signature = clean(request.headers["x-hub-signature-256"]);
    const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(body).digest("hex")}`;
    if (!signature || !safeEqual(expected, signature)) return response.status(401).json({ ok: false, error: "Invalid webhook signature" });
    const payload = JSON.parse(body.toString("utf8") || "{}");
    // Meta expects a fast 200 response. Processing remains idempotent if Meta retries.
    const result = await processMetaEngagementWebhook(payload);
    return response.status(200).json(result);
  } catch (error: any) {
    console.error("Meta engagement webhook failed", error);
    return response.status(500).json({ ok: false, error: clean(error?.message) || "Webhook processing failed" });
  }
}
