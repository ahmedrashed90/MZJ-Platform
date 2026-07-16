import type { VercelRequest, VercelResponse } from "@vercel/node";
import postgres from "postgres";
import crypto from "node:crypto";

const allowedSources = new Set([
  "facebook",
  "instagram",
  "tiktok",
  "whatsapp",
  "tiktok-snapchat",
  "installment-calculator",
]);

function bodyObject(request: VercelRequest) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body); } catch { return { raw: request.body }; }
  }
  return {};
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });

  const source = String(request.query.source || request.headers["x-mzj-source"] || "").trim().toLowerCase();
  if (!allowedSources.has(source)) return response.status(400).json({ ok: false, error: "Unknown integration source" });

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return response.status(503).json({ ok: false, error: "DATABASE_URL is not configured" });

  const payload = bodyObject(request);
  const rawKey = String(
    payload.eventId || payload.event_id || payload.messageId || payload.message_id ||
    payload.id || request.headers["x-event-id"] || ""
  ).trim();
  const eventKey = rawKey || crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const eventType = String(payload.type || payload.event || payload.action || "incoming").trim();

  const sql = postgres(connectionString, { max: 1, prepare: false });
  try {
    const [row] = await sql`
      insert into integrations.inbound_events(source, event_key, event_type, payload)
      values (${source}, ${eventKey}, ${eventType}, ${sql.json(payload)})
      on conflict (source, event_key)
      do update set payload = excluded.payload
      returning id::text, status, received_at
    `;
    return response.status(202).json({ ok: true, source, eventKey, event: row });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: "تعذر تسجيل حدث التكامل" });
  } finally {
    await sql.end({ timeout: 1 });
  }
}
