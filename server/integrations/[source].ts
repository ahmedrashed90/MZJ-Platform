import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { safeSecretEquals } from "../_auth.js";
import { ensureCrmSchema } from "../_crm-schema.js";
import { processIntegrationEvent } from "../_integration-processor.js";
import { getSql } from "../_db.js";

const allowedSources = new Set(["facebook","instagram","tiktok","whatsapp","tiktok-snapchat","installment-calculator"]);

function bodyObject(request: VercelRequest) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") { try { return JSON.parse(request.body); } catch { return { raw: request.body }; } }
  return {};
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const configuredSecret = String(process.env.MZJ_GATEWAY_SECRET || "").trim();
  const requestSecret = String(request.headers["x-mzj-gateway-secret"] || "").trim();
  if (!configuredSecret) return response.status(503).json({ ok: false, error: "MZJ_GATEWAY_SECRET is not configured" });
  if (!safeSecretEquals(requestSecret, configuredSecret)) return response.status(401).json({ ok: false, error: "Unauthorized gateway" });
  const source = String(request.query.source || request.headers["x-mzj-source"] || "").trim().toLowerCase();
  if (!allowedSources.has(source)) return response.status(400).json({ ok: false, error: "Unknown integration source" });
  await ensureCrmSchema();
  const payload = bodyObject(request);
  const rawKey = String(payload.eventId || payload.event_id || payload.messageId || payload.message_id || payload.id || request.headers["x-event-id"] || "").trim();
  const eventKey = rawKey || crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const eventType = String(payload.type || payload.event || payload.action || "incoming").trim();
  const sql = getSql();
  try {
    const [event] = await sql<any[]>`
      insert into integrations.inbound_events(source,event_key,event_type,payload)
      values (${source},${eventKey},${eventType},${sql.json(payload)})
      on conflict (source,event_key) do update set payload=excluded.payload
      returning id::text,status,received_at
    `;
    const result = await processIntegrationEvent(source,eventKey,payload);
    const responseBody = {
      ok: !result.automationError,
      source,
      eventKey,
      event,
      retryable: Boolean(result.automationError),
      error: result.automationError || undefined,
      result: {
        leadId: result.lead?.id || null,
        conversationId: result.conversation?.id || null,
        messageId: result.message?.id || null,
        createdLead: result.createLead,
        serviceSelectionAccepted: result.serviceSelectionAccepted,
        automaticTemplate: result.automaticTemplate,
        automation: result.automation || null,
      },
    };
    return response.status(result.automationError ? 503 : 202).json(responseBody);
  } catch (error: any) {
    console.error("Integration processing failed", error);
    await sql`update integrations.inbound_events set status='failed',error_message=${error?.message||String(error)} where source=${source} and event_key=${eventKey}`.catch(()=>undefined);
    return response.status(500).json({ ok:false,error:"تعذر معالجة حدث التكامل" });
  }
}
