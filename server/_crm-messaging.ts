import crypto from "node:crypto";
import type { SessionUser } from "./_auth.js";
import { clean } from "./_crm-utils.js";
import { getSql } from "./_db.js";

type ConversationContext = {
  id: string;
  legacy_id?: string | null;
  lead_id?: string | null;
  channel_code: string;
  participant_id?: string | null;
  phone?: string | null;
  phone_normalized?: string | null;
  customer_name?: string | null;
  lead_customer_name?: string | null;
  car_name?: string | null;
  status_label?: string | null;
};

type TemplateRow = {
  id?: string;
  external_id?: string | null;
  name?: string | null;
  content?: string | null;
  template_type?: string | null;
};

export function renderCrmTemplate(content: string, conversation: ConversationContext) {
  return String(content || "")
    .replace(/{{\s*name\s*}}/gi, conversation.lead_customer_name || conversation.customer_name || "عميل")
    .replace(/{{\s*phone\s*}}/gi, conversation.phone || conversation.phone_normalized || "")
    .replace(/{{\s*car\s*}}/gi, conversation.car_name || "")
    .replace(/{{\s*status\s*}}/gi, conversation.status_label || "");
}

function gatewayHeaders(secretName: string | null | undefined) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const configuredName = clean(secretName);
  if (!configuredName) return headers;
  const secretValue = clean(process.env[configuredName]);
  if (secretValue) headers["x-mzj-gateway-secret"] = secretValue;
  return headers;
}

export async function deliverCrmMessage(input: {
  conversation: ConversationContext;
  text: string;
  template?: TemplateRow | null;
  actor?: SessionUser | null;
  idempotencyKey?: string;
  reason?: string;
}) {
  const sql = getSql();
  const finalText = clean(input.text);
  if (!finalText) throw new Error("MESSAGE_TEXT_REQUIRED");
  const conversation = input.conversation;
  const [endpoint] = await sql<any[]>`
    select * from crm.integration_endpoints
    where source_code=${conversation.channel_code} and is_active=true
  `;
  const idempotencyKey = clean(input.idempotencyKey) || `crm:${conversation.id}:${crypto.randomUUID()}`;
  const payload = {
    conversationId: conversation.id,
    convId: conversation.legacy_id || conversation.id,
    participantId: conversation.participant_id || "",
    phone: conversation.phone_normalized || conversation.phone || "",
    message: finalText,
    text: finalText,
    templateId: input.template?.external_id || null,
    templateName: input.template?.name || null,
    saveMessage: false,
    reason: input.reason || "manual",
  };

  const [insertedJob] = await sql<any[]>`
    insert into integrations.outbound_jobs(source,idempotency_key,conversation_id,lead_id,payload,created_by)
    values (
      ${conversation.channel_code},${idempotencyKey},${conversation.id}::uuid,${conversation.lead_id || null}::uuid,
      ${sql.json(payload)},${input.actor?.id || null}::uuid
    )
    on conflict (idempotency_key) do nothing
    returning id::text,status,error_message,response_payload
  `;
  const [job] = insertedJob
    ? [insertedJob]
    : await sql<any[]>`
        select id::text,status,error_message,response_payload
        from integrations.outbound_jobs where idempotency_key=${idempotencyKey}
      `;
  if (!insertedJob) {
    const [existingMessage] = await sql<any[]>`
      select *,id::text,conversation_id::text
      from crm.messages where metadata->>'jobId'=${job.id} limit 1
    `;
    return {
      message: existingMessage || null,
      providerStatus: job.status || "queued",
      providerResponse: job.response_payload || null,
      errorMessage: job.error_message || "",
      jobId: job.id,
      duplicate: true,
    };
  }

  let providerStatus = "queued";
  let providerResponse: any = null;
  let errorMessage = "";
  if (endpoint?.send_url) {
    try {
      const provider = await fetch(endpoint.send_url, {
        method: "POST",
        headers: gatewayHeaders(endpoint.secret_name),
        body: JSON.stringify(payload),
      });
      const responseText = await provider.text();
      try {
        providerResponse = responseText ? JSON.parse(responseText) : {};
      } catch {
        providerResponse = { raw: responseText };
      }
      providerStatus = provider.ok && providerResponse?.ok !== false ? "sent" : "failed";
      if (providerStatus === "failed") errorMessage = providerResponse?.error || `HTTP ${provider.status}`;
    } catch (error: any) {
      providerStatus = "failed";
      errorMessage = error?.message || String(error);
    }
  }

  const [existingMessage] = await sql<any[]>`
    select *,id::text,conversation_id::text
    from crm.messages
    where metadata->>'jobId'=${job.id}
    limit 1
  `;
  let message = existingMessage;
  if (!message) {
    [message] = await sql<any[]>`
      insert into crm.messages(conversation_id,direction,message_type,body,provider_status,sent_by,metadata)
      values (
        ${conversation.id}::uuid,'out',${input.template ? "template" : "text"},${finalText},${providerStatus},
        ${input.actor?.id || null}::uuid,${sql.json({ jobId: job.id, templateId: input.template?.id || null, reason: input.reason || "manual" })}
      )
      returning *,id::text,conversation_id::text
    `;
  }

  await sql`
    update crm.conversations
    set preview_text=${finalText},last_message_at=now(),updated_at=now(),unread_count=0
    where id=${conversation.id}::uuid
  `;
  await sql`
    update integrations.outbound_jobs
    set status=${providerStatus},attempts=case when ${Boolean(endpoint?.send_url)} then attempts+1 else attempts end,
        response_payload=${providerResponse ? sql.json(providerResponse) : null},error_message=${errorMessage || null},
        processed_at=case when ${providerStatus} <> 'queued' then now() else null end
    where id=${job.id}::uuid
  `;

  return { message, providerStatus, providerResponse, errorMessage, jobId: job.id };
}

export async function sendMappedStatusMessage(input: {
  leadId: string;
  departmentCode: string;
  statusValue: string;
  actor: SessionUser;
  eventId?: string | number;
}) {
  const sql = getSql();
  const [mapping] = await sql<any[]>`
    select m.id::text as mapping_id,t.*,t.id::text
    from crm.status_template_mappings m
    join crm.message_templates t on t.id=m.template_id
    where m.department_code=${input.departmentCode}
      and m.status_value=${input.statusValue}
      and m.is_active=true and t.is_active=true
    limit 1
  `;
  if (!mapping) return { skipped: true, reason: "no_mapping" };

  const [conversation] = await sql<any[]>`
    select c.*,c.id::text,c.lead_id::text,l.phone,l.phone_normalized,l.customer_name as lead_customer_name,l.car_name,l.status_label
    from crm.conversations c
    join crm.leads l on l.id=c.lead_id
    where c.lead_id=${input.leadId}::uuid
    order by c.last_message_at desc nulls last,c.updated_at desc
    limit 1
  `;
  if (!conversation) return { skipped: true, reason: "no_conversation" };
  const text = renderCrmTemplate(mapping.content || "", conversation);
  const result = await deliverCrmMessage({
    conversation,
    text,
    template: mapping,
    actor: input.actor,
    idempotencyKey: input.eventId
      ? `status-event:${input.eventId}`
      : `status:${input.leadId}:${input.statusValue}:${mapping.mapping_id}:${crypto.randomUUID()}`,
    reason: "status_change",
  });
  return { skipped: false, ...result };
}
