import type { VercelRequest, VercelResponse } from "@vercel/node";
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
  const eventKey = String(request.headers["x-event-id"] || payload.eventId || "").trim();
  if (!eventKey) return response.status(400).json({ ok: false, error: "x-event-id is required" });
  const eventType = String(payload.type || payload.event || payload.action || "incoming").trim();
  const sql = getSql();
  try {
    let [event] = await sql<any[]>`
      insert into integrations.inbound_events(source,event_key,event_type,payload,status)
      values (${source},${eventKey},${eventType},${sql.json(payload)},'processing')
      on conflict (source,event_key) do nothing
      returning id::text,status,received_at
    `;
    let retried = false;
    if (!event) {
      [event] = await sql<any[]>`
        update integrations.inbound_events set
          event_type=${eventType},payload=${sql.json(payload)},status='processing',error_message=null,processed_at=null,received_at=now()
        where source=${source} and event_key=${eventKey}
          and (status='failed' or (status='processing' and received_at < now()-interval '2 minutes'))
        returning id::text,status,received_at
      `;
      if (!event) {
        const [existing] = await sql<any[]>`
          select id::text,status,received_at,processed_at,error_message
          from integrations.inbound_events
          where source=${source} and event_key=${eventKey}
          limit 1
        `;
        return response.status(200).json({ ok:true,source,eventKey,event:existing,duplicate:true });
      }
      retried = true;
    }
    const result = await processIntegrationEvent(source,eventKey,payload);
    return response.status(202).json({ ok:true,source,eventKey,event,duplicate:false,retried,result:{leadId:result.lead?.id||null,conversationId:result.conversation?.id||null,messageId:result.message?.id||null,createdLead:result.createLead} });
  } catch (error: any) {
    console.error("Integration processing failed", error);
    await sql`update integrations.inbound_events set status='failed',error_message=${error?.message||String(error)} where source=${source} and event_key=${eventKey}`.catch(()=>undefined);
    return response.status(500).json({ ok:false,error:"تعذر معالجة حدث التكامل" });
  }
}
