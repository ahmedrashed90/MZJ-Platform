import crypto from "node:crypto";
import { waitUntil } from "@vercel/functions";
import type { SessionUser } from "./_auth.js";
import { clean, normalizePhone, sourceLabel } from "./_crm-utils.js";
import { getSql } from "./_db.js";
import { createDownloadUrl } from "./_media-storage.js";

export type ConversationContext = {
  id: string;
  legacy_id?: string | null;
  lead_id?: string | null;
  contact_id?: string | null;
  service_request_id?: string | null;
  channel_code: string;
  participant_id?: string | null;
  phone?: string | null;
  phone_normalized?: string | null;
  customer_name?: string | null;
  lead_customer_name?: string | null;
  car_name?: string | null;
  status_label?: string | null;
  source_code?: string | null;
  source_name?: string | null;
  platform_code?: string | null;
  service_key?: string | null;
  page_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type TemplateRow = {
  id?: string;
  external_id?: string | null;
  name?: string | null;
  display_name?: string | null;
  content?: string | null;
  template_type?: string | null;
  provider?: string | null;
  language_code?: string | null;
};

export type MediaDelivery = {
  storageKey: string;
  mediaType: "image" | "audio" | "video" | "document";
  fileName?: string;
  mimeType?: string;
  fileSize?: number | null;
  caption?: string;
  isSensitive?: boolean;
};

type DeliveryRoute = "whatsapp" | "facebook" | "instagram" | "tiktok";
type DeliveryKind = "text" | "template" | "media";
type DeliveryPolicy = { route: DeliveryRoute; templateOnly: boolean; sourceArabic: string; reason: string };

function normalized(value: unknown) {
  return clean(value).toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/[\s/]+/g, "_");
}
function isLeadSource(value: string) { const text = normalized(value); return text.includes("lead") || text.includes("ليد"); }

async function resolveDeliveryPolicy(conversation: ConversationContext): Promise<DeliveryPolicy> {
  const sql = getSql();
  const sourceCode = clean(conversation.source_code);
  const [sourceConfig] = sourceCode ? await sql<any[]>`select name,delivery_route,allow_free_text from core.sources where code=${sourceCode} limit 1` : [];
  const sourceArabic = clean(sourceConfig?.name) || sourceLabel(conversation.source_code || conversation.source_name || conversation.platform_code || conversation.channel_code);
  if (sourceConfig?.delivery_route) {
    const route = sourceConfig.delivery_route as DeliveryRoute;
    return { route, templateOnly: false, sourceArabic, reason: route === "whatsapp" ? "الإرسال عبر واتساب بنص حر أو قالب أو مرفق" : `الإرسال عبر ${sourceLabel(route)}` };
  }
  const raw = [conversation.source_code, conversation.source_name, conversation.platform_code, conversation.channel_code, conversation.legacy_id].map(clean).filter(Boolean).join(" ");
  const key = normalized(raw);
  if ((key.includes("facebook") || key.includes("فيسبوك")) && !isLeadSource(`${raw} ${sourceArabic}`)) return { route: "facebook", templateOnly: false, sourceArabic, reason: "الإرسال عبر فيسبوك" };
  if ((key.includes("instagram") || key.includes("انستجرام") || key.includes("انستغرام")) && !isLeadSource(`${raw} ${sourceArabic}`)) return { route: "instagram", templateOnly: false, sourceArabic, reason: "الإرسال عبر إنستجرام" };
  if ((key.includes("tiktok") || key.includes("تيك_توك") || key.includes("تيك")) && !isLeadSource(`${raw} ${sourceArabic}`)) return { route: "tiktok", templateOnly: false, sourceArabic, reason: "الإرسال عبر تيك توك" };
  return { route: "whatsapp", templateOnly: false, sourceArabic, reason: "الإرسال عبر واتساب بنص حر أو قالب أو مرفق" };
}

export function renderCrmTemplate(content: string, conversation: ConversationContext) {
  return String(content || "")
    .replace(/{{\s*(?:name|customer_name|customerName)\s*}}/gi, conversation.lead_customer_name || conversation.customer_name || "عميل")
    .replace(/{{\s*phone\s*}}/gi, conversation.phone || conversation.phone_normalized || "")
    .replace(/{{\s*car\s*}}/gi, conversation.car_name || "")
    .replace(/{{\s*status\s*}}/gi, conversation.status_label || "");
}

function gatewayHeaders(secretName: string | null | undefined) {
  const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8", accept: "application/json" };
  const configuredName = clean(secretName) || "MZJ_GATEWAY_SECRET";
  const secretValue = clean(process.env[configuredName]);
  if (!secretValue) throw new Error(`متغير السر ${configuredName} غير موجود في Vercel`);
  headers["x-mzj-gateway-secret"] = secretValue;
  return headers;
}

function isMersalTemplate(template?: TemplateRow | null) {
  if (!template) return false;
  const raw = normalized([template.provider, template.template_type, template.external_id].filter(Boolean).join(" "));
  return Boolean(template.external_id) || raw.includes("mersal") || raw.includes("whatsapp_template");
}

function extractNumberedTemplateParams(templateBody: string, renderedText: string) {
  const matches = [...String(templateBody || "").matchAll(/{{\s*(\d+)\s*}}/g)];
  if (!matches.length) return [];
  let pattern = "^"; let lastIndex = 0; const order: number[] = [];
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  for (const match of matches) { pattern += escape(templateBody.slice(lastIndex, match.index)); pattern += "([\\s\\S]*?)"; order.push(Number(match[1])); lastIndex = Number(match.index) + match[0].length; }
  pattern += escape(templateBody.slice(lastIndex)) + "$";
  const result = new RegExp(pattern, "i").exec(renderedText);
  if (!result) return [];
  const values: Record<number,string> = {}; order.forEach((position,index) => { values[position] = clean(result[index+1]); });
  return Object.keys(values).map(Number).sort((a,b)=>a-b).map((position)=>values[position]);
}

function endpointCandidates(route: DeliveryRoute) {
  if (route === "whatsapp") return ["whatsapp", "mersal"];
  if (route === "facebook") return ["facebook", "facebook-chat", "facebook_chat"];
  if (route === "instagram") return ["instagram", "instagram-chat", "instagram_chat"];
  return ["tiktok", "tiktok-chat", "tiktok_chat"];
}

function whatsappRouteCandidates(endpoint: Record<string, unknown>, _kind: DeliveryKind) {
  const configured = clean(endpoint.text_send_url || endpoint.send_url);
  return configured ? [configured] : [];
}

function endpointUrlCandidates(route: DeliveryRoute, kind: DeliveryKind, endpoint: Record<string, unknown>) {
  if (route === "whatsapp") return whatsappRouteCandidates(endpoint, kind);
  const url = kind === "template"
    ? clean(endpoint.template_send_url || endpoint.text_send_url || endpoint.send_url)
    : kind === "media"
      ? clean(endpoint.media_send_url || endpoint.text_send_url || endpoint.send_url)
      : clean(endpoint.text_send_url || endpoint.send_url);
  return url ? [url] : [];
}

async function resolveEndpoint(route: DeliveryRoute, kind: DeliveryKind) {
  const sql = getSql();
  const candidates = endpointCandidates(route);
  const rows = await sql<any[]>`
    select * from crm.integration_endpoints where is_active=true and source_code = any(${candidates})
    order by case source_code when ${candidates[0]} then 0 else 1 end
  `;
  const endpoint = rows[0];
  if (!endpoint) throw new Error(`لم يتم ضبط Endpoint فعال لقناة ${sourceLabel(route)}`);
  const urls = endpointUrlCandidates(route, kind, endpoint);
  if (!urls.length) throw new Error(`لم يتم ضبط مسار ${kind === "template" ? "القوالب" : kind === "media" ? "الوسائط" : "النص"} لقناة ${sourceLabel(route)}`);
  return { endpoint, urls };
}

async function postToWorker(urls: string[], headers: Record<string, string>, payload: Record<string, unknown>) {
  const url = clean(urls[0]);
  if (!url) return { ok: false, provider: null, response: { error: "No worker route configured" }, usedUrl: "", attempts: [] as Array<{ url: string; status: number; response: any }> };
  try {
    const provider = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
    const raw = await provider.text();
    let response: any;
    try { response = JSON.parse(raw); } catch { response = { raw }; }
    const ok = provider.ok && response?.ok !== false;
    return { ok, provider, response, usedUrl: url, attempts: [{ url, status: provider.status, response }] };
  } catch (error: any) {
    const response = { error: error?.message || String(error) };
    return { ok: false, provider: null, response, usedUrl: url, attempts: [{ url, status: 0, response }] };
  }
}

type BackgroundDeliveryInput = {
  urls: string[];
  headers: Record<string, string>;
  payload: Record<string, unknown>;
  jobId: string;
  messageId?: string | null;
  conversationId?: string | null;
  hasMedia?: boolean;
};

async function finishWorkerDelivery(input: BackgroundDeliveryInput) {
  const sql = getSql();
  try {
    const delivery = await postToWorker(input.urls, input.headers, input.payload);
    const data = delivery.response;
    const rawStatus = normalized(data?.status || data?.providerStatus || data?.raw?.status || "");
    const providerStatus = delivery.ok && !["error", "failed", "failure", "rejected"].includes(rawStatus) ? "sent" : "failed";
    const providerMessageId = clean(
      data?.providerMessageId || data?.provider_message_id || data?.message_wamid || data?.messageWamid || data?.message_id ||
      data?.raw?.message_wamid || data?.raw?.wamid || data?.raw?.message_id || data?.raw?.id || "",
    );
    const attempts = delivery.attempts.map((attempt) => ({
      url: attempt.url,
      status: attempt.status,
      error: clean(attempt.response?.error || attempt.response?.message || attempt.response?.raw) || null,
    }));
    const errorMessage = providerStatus === "failed"
      ? clean(data?.error || data?.message || data?.raw?.message || data?.raw?.error || data?.raw) || (delivery.provider ? `HTTP ${delivery.provider.status}` : "تعذر الوصول إلى Worker الإرسال")
      : "";

    if (input.messageId) {
      await sql`
        update crm.messages set
          provider_status=${providerStatus},
          provider_message_id=coalesce(nullif(${providerMessageId},''),provider_message_id),
          media_status=case when storage_key is not null then ${providerStatus} else media_status end,
          metadata=coalesce(metadata,'{}'::jsonb)||${sql.json({ workerRoute: delivery.usedUrl, workerAttempts: attempts, providerResult: data, providerConfirmedAt: new Date().toISOString(), providerError: errorMessage || null })}::jsonb
        where id=${input.messageId}::uuid
      `;
    }

    await sql`
      update integrations.outbound_jobs set
        status=${providerStatus},attempts=attempts+1,response_payload=${data ? sql.json(data) : null},
        error_message=${errorMessage || null},processed_at=now()
      where id=${input.jobId}::uuid
    `;

    if (input.conversationId) await sql`update crm.conversations set updated_at=now() where id=${input.conversationId}::uuid`;
  } catch (error: any) {
    const errorMessage = clean(error?.message || error) || "تعذر إكمال إرسال الرسالة";
    if (input.messageId) {
      await sql`
        update crm.messages set
          provider_status='failed',
          media_status=case when storage_key is not null then 'failed' else media_status end,
          metadata=coalesce(metadata,'{}'::jsonb)||${sql.json({ providerError: errorMessage, providerConfirmedAt: new Date().toISOString() })}::jsonb
        where id=${input.messageId}::uuid
      `.catch(()=>undefined);
    }
    await sql`
      update integrations.outbound_jobs set status='failed',attempts=attempts+1,error_message=${errorMessage},processed_at=now()
      where id=${input.jobId}::uuid
    `.catch(()=>undefined);
  }
}

function startWorkerDelivery(input: BackgroundDeliveryInput) {
  waitUntil(finishWorkerDelivery(input));
}

function basePayload(route: DeliveryRoute, conversation: ConversationContext) {
  const conversationId = clean(conversation.legacy_id) || conversation.id;
  const participantId = clean(conversation.participant_id);
  const displayName = conversation.lead_customer_name || conversation.customer_name || "عميل";
  if (route === "whatsapp") {
    const phone = normalizePhone(conversation.phone_normalized || conversation.phone || participantId);
    if (!phone) throw new Error("رقم واتساب غير موجود أو غير صالح");
    return { phone, waId: phone, conversationId: conversationId || phone, convId: conversationId || phone, leadId: conversation.lead_id || "", contactId: conversation.contact_id || "", serviceRequestId: conversation.service_request_id || "" };
  }
  if (route === "tiktok") {
    const subscriber = participantId || conversationId.replace(/^tiktok[_:]/i, "");
    return { subscriber_id: subscriber, subscriberId: subscriber, participantId: subscriber, conversationId, convId: conversationId, displayName, serviceKey: conversation.service_key || "" };
  }
  if (route === "instagram") return { subscriber_id: participantId, participantId, manychatContactId: participantId, igId: participantId, pageId: conversation.page_id || "", conversationId, convId: conversationId, displayName, serviceKey: conversation.service_key || "" };
  return { convId: conversationId, conversationId, participantId, pageId: conversation.page_id || "" };
}

function deliveryPayload(input: { route: DeliveryRoute; conversation: ConversationContext; text: string; template?: TemplateRow | null; media?: MediaDelivery | null; policy: DeliveryPolicy; buttons?: unknown[]; header?: string; footer?: string }) {
  const payload: Record<string,unknown> = { ...basePayload(input.route, input.conversation), source: input.policy.sourceArabic, deliveryChannel: input.route, saveMessage: false };
  if (input.media) {
    const mediaUrl = createDownloadUrl(input.media.storageKey, 900);
    return { ...payload, mediaUrl, fileUrl: mediaUrl, mediaType: input.media.mediaType, attachmentType: input.media.mediaType, fileName: input.media.fileName || "", mimeType: input.media.mimeType || "", fileSize: input.media.fileSize || null, caption: input.media.caption || input.text || "" };
  }
  if (input.template) {
    const templateName = clean(input.template.name || input.template.external_id);
    if (!templateName) throw new Error("قالب واتساب غير مربوط باسم قالب مرسال");
    const params = extractNumberedTemplateParams(clean(input.template.content), input.text);
    return {
      ...payload,
      template_name: templateName,
      template_language: clean(input.template.language_code) || "ar",
      params,
      components: params.length ? [{ type: "body", parameters: params.map((value) => ({ type: "text", text: value })) }] : [],
      text: input.text,
    };
  }
  return { ...payload, message: input.text, text: input.text, ...(Array.isArray(input.buttons) && input.buttons.length ? { buttons: input.buttons, header: input.header || "", footer: input.footer || "" } : {}) };
}

async function loadConversation(conversationId: string): Promise<ConversationContext | null> {
  const sql = getSql();
  const [row] = await sql<any[]>`
    select c.*,c.id::text,c.lead_id::text,c.contact_id::text,c.service_request_id::text,
      l.phone,l.phone_normalized,l.customer_name as lead_customer_name,l.car_name,l.status_label,l.source_code,l.source_name,l.platform_code,l.service_key
    from crm.conversations c left join crm.leads l on l.id=c.lead_id
    where c.id=${conversationId}::uuid limit 1
  `;
  return row || null;
}

export async function deliverCrmMessage(input: {
  conversation: ConversationContext;
  text?: string;
  template?: TemplateRow | null;
  media?: MediaDelivery | null;
  actor?: SessionUser | null;
  senderType?: "human" | "bot" | "system";
  idempotencyKey?: string;
  reason?: string;
  buttons?: unknown[];
  header?: string;
  footer?: string;
}) {
  const sql = getSql();
  const senderType = input.senderType || (input.actor ? "human" : "bot");
  const finalText = clean(input.text || input.media?.caption || input.template?.content);
  if (!finalText && !input.media) throw new Error("اكتب الرسالة أو اختر قالبًا أو ملفًا صالحًا");

  const conversation = input.conversation;
  const policy = await resolveDeliveryPolicy(conversation);
  const kind: DeliveryKind = input.media ? "media" : input.template ? "template" : "text";
  const { endpoint, urls } = await resolveEndpoint(policy.route, kind);
  const idempotencyKey = clean(input.idempotencyKey) || `crm:${conversation.id}:${kind}:${crypto.randomUUID()}`;
  const proposedJobId = crypto.randomUUID();
  const baseWorkerPayload = deliveryPayload({ route: policy.route, conversation, text: finalText, template: input.template, media: input.media, policy, buttons: input.buttons, header: input.header, footer: input.footer });

  const [job] = await sql<any[]>`
    insert into integrations.outbound_jobs(id,source,idempotency_key,conversation_id,lead_id,payload,status,created_by)
    values (${proposedJobId}::uuid,${policy.route},${idempotencyKey},${conversation.id}::uuid,${conversation.lead_id||null}::uuid,${sql.json(baseWorkerPayload as any)},'queued',${input.actor?.id||null}::uuid)
    on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key
    returning *,id::text
  `;

  if (job.status !== "queued" && job.processed_at) {
    const [existing] = await sql<any[]>`select *,id::text,conversation_id::text from crm.messages where metadata->>'jobId'=${job.id} limit 1`;
    return { message: existing, providerStatus: job.status, providerResponse: job.response_payload, errorMessage: job.error_message, jobId: job.id, routing: policy };
  }

  const payload = {
    ...baseWorkerPayload,
    jobId: job.id,
    idempotencyKey,
  };
  await sql`update integrations.outbound_jobs set payload=${sql.json(payload as any)} where id=${job.id}::uuid`;

  let [message] = await sql<any[]>`select *,id::text,conversation_id::text from crm.messages where metadata->>'jobId'=${job.id} limit 1`;
  if (!message) {
    [message] = await sql<any[]>`
      insert into crm.messages(
        conversation_id,direction,message_type,body,attachment_url,attachment_type,file_name,mime_type,file_size,storage_key,media_status,
        is_sensitive,provider_status,sent_by,sender_type,metadata
      ) values (
        ${conversation.id}::uuid,'out',${kind},${finalText||null},${input.media ? createDownloadUrl(input.media.storageKey,900) : null},${input.media?.mediaType||null},
        ${input.media?.fileName||null},${input.media?.mimeType||null},${input.media?.fileSize||null},${input.media?.storageKey||null},${input.media ? 'queued' : null},
        ${Boolean(input.media?.isSensitive)},'queued',${input.actor?.id||null}::uuid,${senderType},${sql.json({ jobId: job.id, templateId: input.template?.id || null, reason: input.reason || "manual", deliveryRoute: policy.route, sourceArabic: policy.sourceArabic, workerRoute: urls[0] || "" })}
      ) returning *,id::text,conversation_id::text
    `;
  }

  const nowField = senderType === "human" ? "last_human_reply_at" : "last_bot_reply_at";
  await sql.unsafe(`update crm.conversations set preview_text=$1,last_message_at=now(),updated_at=now(),unread_count=case when $3::boolean then 0 else unread_count end,${nowField}=now() where id=$2::uuid`, [finalText || input.media?.fileName || "مرفق", conversation.id, senderType === "human"]);

  const headers = gatewayHeaders(endpoint.secret_name);
  startWorkerDelivery({
    urls,
    headers,
    payload,
    jobId: job.id,
    messageId: message.id,
    conversationId: conversation.id,
    hasMedia: Boolean(input.media),
  });

  return {
    message: { ...message, provider_status: "queued", media_status: input.media ? "queued" : message.media_status },
    providerStatus: "queued",
    providerResponse: { ok: true, accepted: true, status: "queued" },
    errorMessage: "",
    jobId: job.id,
    routing: policy,
    workerRoute: urls[0] || "",
    workerAttempts: [],
  };
}

export async function deliverConversationMessage(input: Omit<Parameters<typeof deliverCrmMessage>[0],"conversation"> & { conversationId: string }) {
  const conversation = await loadConversation(input.conversationId);
  if (!conversation) throw new Error("المحادثة غير موجودة");
  return deliverCrmMessage({ ...input, conversation });
}

export async function deliverDirectWhatsapp(input: { phone: string; text: string; template?: TemplateRow | null; idempotencyKey?: string; reason?: string }) {
  const sql = getSql();
  const phone = normalizePhone(input.phone);
  if (!phone) throw new Error("رقم واتساب للإشعار غير صالح");

  const kind: DeliveryKind = input.template ? "template" : "text";
  const { endpoint, urls } = await resolveEndpoint("whatsapp", kind);
  const templateName = clean(input.template?.name || input.template?.external_id);
  if (input.template && !templateName) throw new Error("قالب واتساب غير مربوط باسم قالب مرسال");
  const templateParams = input.template ? extractNumberedTemplateParams(clean(input.template.content), input.text) : [];
  const jobId = crypto.randomUUID();
  const key = clean(input.idempotencyKey) || `direct-wa:${phone}:${crypto.randomUUID()}`;
  const payload: Record<string, unknown> = input.template
    ? {
        phone,
        waId: phone,
        template_name: templateName,
        template_language: clean(input.template.language_code) || "ar",
        params: templateParams,
        components: templateParams.length ? [{ type: "body", parameters: templateParams.map((value) => ({ type: "text", text: value })) }] : [],
        text: input.text,
        agentAuto: true,
      }
    : { phone, waId: phone, text: input.text, message: input.text, agentAuto: true };
  const workerPayload = { ...payload, jobId, idempotencyKey: key, reason: input.reason || "automation" };

  const [job] = await sql<any[]>`
    insert into integrations.outbound_jobs(id,source,idempotency_key,payload,status)
    values(${jobId}::uuid,'whatsapp',${key},${sql.json(workerPayload as any)},'queued')
    on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key
    returning *,id::text
  `;
  if (job.processed_at) return { ok: job.status !== "failed", status: job.status, response: job.response_payload };

  const headers = gatewayHeaders(endpoint.secret_name);
  startWorkerDelivery({ urls, headers, payload: workerPayload, jobId: job.id });
  return { ok: true, status: "queued", response: { ok: true, accepted: true, status: "queued" }, workerRoute: urls[0] || "", workerAttempts: [] };
}

export async function getMappedStatusDraft(input: { leadId: string; departmentCode: string; statusValue: string }) {
  const sql = getSql();
  const [mapping] = await sql<any[]>`
    select m.id::text as mapping_id,t.*,t.id::text from crm.status_template_mappings m join crm.message_templates t on t.id=m.template_id
    where m.department_code=${input.departmentCode} and m.status_value=${input.statusValue} and m.is_active=true and t.is_active=true limit 1
  `;
  if (!mapping) return null;
  const [conversation] = await sql<any[]>`
    select c.*,c.id::text,c.lead_id::text,l.phone,l.phone_normalized,l.customer_name as lead_customer_name,l.car_name,l.status_label,l.source_code,l.source_name,l.platform_code,l.service_key
    from crm.conversations c join crm.leads l on l.id=c.lead_id where c.lead_id=${input.leadId}::uuid order by c.last_message_at desc nulls last,c.updated_at desc limit 1
  `;
  return { template: mapping, text: renderCrmTemplate(mapping.content || "", conversation || {}) };
}

/** Kept for backwards compatibility. New UI only prepares the draft and never calls this automatically on status save. */
export async function sendMappedStatusMessage(input: { leadId: string; departmentCode: string; statusValue: string; actor: SessionUser; eventId?: string|number }) {
  const draft = await getMappedStatusDraft(input);
  if (!draft) return { skipped:true,reason:"no_mapping" };
  const sql = getSql();
  const [conversation] = await sql<any[]>`select c.*,c.id::text,c.lead_id::text,l.phone,l.phone_normalized,l.customer_name as lead_customer_name,l.car_name,l.status_label,l.source_code,l.source_name,l.platform_code,l.service_key from crm.conversations c join crm.leads l on l.id=c.lead_id where c.lead_id=${input.leadId}::uuid order by c.last_message_at desc nulls last limit 1`;
  if (!conversation) return { skipped:true,reason:"no_conversation" };
  return { skipped:false, ...(await deliverCrmMessage({ conversation, text:draft.text, template:draft.template, actor:input.actor, senderType:"human", idempotencyKey:input.eventId ? `status-event:${input.eventId}` : undefined, reason:"status_change_manual" })) };
}
