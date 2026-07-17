import crypto from "node:crypto";
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
    const templateOnly = false;
    return { route, templateOnly, sourceArabic, reason: route === "whatsapp" ? "الإرسال عبر واتساب بنص أو قالب أو وسيط" : `الإرسال عبر ${sourceLabel(route)}` };
  }
  const raw = [conversation.source_code, conversation.source_name, conversation.platform_code, conversation.channel_code, conversation.legacy_id].map(clean).filter(Boolean).join(" ");
  const key = normalized(raw);
  if ((key.includes("facebook") || key.includes("فيسبوك")) && !isLeadSource(`${raw} ${sourceArabic}`)) return { route: "facebook", templateOnly: false, sourceArabic, reason: "الإرسال عبر فيسبوك" };
  if ((key.includes("instagram") || key.includes("انستجرام") || key.includes("انستغرام")) && !isLeadSource(`${raw} ${sourceArabic}`)) return { route: "instagram", templateOnly: false, sourceArabic, reason: "الإرسال عبر إنستجرام" };
  if ((key.includes("tiktok") || key.includes("تيك_توك") || key.includes("تيك")) && !isLeadSource(`${raw} ${sourceArabic}`)) return { route: "tiktok", templateOnly: false, sourceArabic, reason: "الإرسال عبر تيك توك" };
  const templateOnlySources = new Set(["تيك توك ليد", "سناب شات ليد", "تيك توك ليد وسناب شات ليد", "حاسبة التقسيط", "خلال الفرع", "موقع حراج", "موقع آخر", "صديق", "اتصال الرقم الموحد", "إدخال يدوي"]);
  const manualEntry = Boolean(conversation.metadata?.manualEntry || conversation.metadata?.manual_entry);
  void manualEntry;
  void templateOnlySources;
  return { route: "whatsapp", templateOnly: false, sourceArabic, reason: "الإرسال عبر واتساب بنص أو قالب أو وسيط" };
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
  if (secretValue) headers["x-mzj-gateway-secret"] = secretValue;
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

function uniqueStrings(values: unknown[]) {
  const seen = new Set<string>();
  return values.map(clean).filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function urlOrigin(value: unknown) {
  try { return new URL(clean(value)).origin; } catch { return ""; }
}

function whatsappRouteCandidates(endpoint: Record<string, unknown>, kind: DeliveryKind) {
  const url = kind === "media"
    ? clean(endpoint.media_send_url || endpoint.send_url || endpoint.text_send_url)
    : clean(endpoint.send_url || endpoint.text_send_url || endpoint.template_send_url);
  return url ? [url] : [];
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

function shouldTryNextWorkerRoute(status: number, response: any) {
  const message = normalized(response?.error || response?.message || response?.raw || "");
  return status === 404 || status === 405 || message === "not_found" || message.includes("route_not_found");
}

async function postToWorker(urls: string[], headers: Record<string, string>, payload: Record<string, unknown>) {
  const attempts: Array<{ url: string; status: number; response: any }> = [];
  for (const url of urls) {
    try {
      const provider = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
      const raw = await provider.text();
      let response: any;
      try { response = JSON.parse(raw); } catch { response = { raw }; }
      attempts.push({ url, status: provider.status, response });
      const ok = provider.ok && response?.ok !== false;
      if (ok || !shouldTryNextWorkerRoute(provider.status, response)) {
        return { ok, provider, response, usedUrl: url, attempts };
      }
    } catch (error: any) {
      const response = { error: error?.message || String(error) };
      attempts.push({ url, status: 0, response });
      if (url === urls[urls.length - 1]) return { ok: false, provider: null, response, usedUrl: url, attempts };
    }
  }
  const last = attempts[attempts.length - 1] || { url: urls[0] || "", status: 0, response: { error: "No worker route available" } };
  return { ok: false, provider: null, response: last.response, usedUrl: last.url, attempts };
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

function providerMessageIdFromResponse(response: any) {
  const raw = response?.raw && typeof response.raw === "object" ? response.raw : {};
  return clean(
    response?.provider_message_id
      || response?.message_wamid
      || response?.message_id
      || raw?.provider_message_id
      || raw?.message_wamid
      || raw?.message_id,
  );
}

export async function recordDeliveredCrmMessage(input: {
  conversation: ConversationContext;
  text?: string;
  template?: TemplateRow | null;
  media?: MediaDelivery | null;
  actor?: SessionUser | null;
  senderType?: "human" | "bot" | "system";
  idempotencyKey: string;
  clientMessageId?: string;
  reason?: string;
  providerStatus?: string;
  providerResponse?: any;
  workerRoute?: string;
}) {
  const sql = getSql();
  const senderType = input.senderType || (input.actor ? "human" : "bot");
  const finalText = clean(input.text || input.media?.caption || input.template?.content);
  if (!finalText && !input.media) throw new Error("اكتب الرسالة أو اختر قالبًا أو ملفًا صالحًا");
  const policy = await resolveDeliveryPolicy(input.conversation);
  const kind: DeliveryKind = input.media ? "media" : input.template ? "template" : "text";
  const providerStatus = clean(input.providerStatus) || "sent";
  const providerMessageId = providerMessageIdFromResponse(input.providerResponse);
  const [job] = await sql<any[]>`
    insert into integrations.outbound_jobs(source,idempotency_key,conversation_id,lead_id,payload,status,attempts,response_payload,processed_at,created_by)
    values (
      ${policy.route},${input.idempotencyKey},${input.conversation.id}::uuid,${input.conversation.lead_id||null}::uuid,
      ${sql.json({ text: finalText, templateId: input.template?.id || null, media: input.media || null } as any)},
      ${providerStatus},1,${input.providerResponse ? sql.json(input.providerResponse) : null},now(),${input.actor?.id||null}::uuid
    )
    on conflict(idempotency_key) do update set
      status=excluded.status,response_payload=excluded.response_payload,processed_at=excluded.processed_at
    returning *,id::text
  `;

  let [message] = await sql<any[]>`
    select *,id::text,conversation_id::text from crm.messages
    where metadata->>'clientMessageId'=${clean(input.clientMessageId)}
       or (${providerMessageId || null}::text is not null and conversation_id=${input.conversation.id}::uuid and provider_message_id=${providerMessageId || null})
    order by created_at desc limit 1
  `;
  if (!message) {
    [message] = await sql<any[]>`
      insert into crm.messages(
        conversation_id,direction,message_type,body,attachment_url,attachment_type,file_name,mime_type,file_size,storage_key,media_status,
        is_sensitive,provider_status,provider_message_id,sent_by,sender_type,metadata
      ) values (
        ${input.conversation.id}::uuid,'out',${kind},${finalText||null},${input.media ? createDownloadUrl(input.media.storageKey,300) : null},${input.media?.mediaType||null},
        ${input.media?.fileName||null},${input.media?.mimeType||null},${input.media?.fileSize||null},${input.media?.storageKey||null},${input.media ? providerStatus : null},
        ${Boolean(input.media?.isSensitive)},${providerStatus},${providerMessageId||null},${input.actor?.id||null}::uuid,${senderType},
        ${sql.json({ jobId: job.id, clientMessageId: clean(input.clientMessageId) || null, templateId: input.template?.id || null, reason: input.reason || "manual", deliveryRoute: policy.route, sourceArabic: policy.sourceArabic, workerRoute: clean(input.workerRoute) || null })}
      ) returning *,id::text,conversation_id::text
    `;
  }
  const nowField = senderType === "human" ? "last_human_reply_at" : "last_bot_reply_at";
  await sql.unsafe(
    `update crm.conversations set preview_text=$1,last_message_at=now(),updated_at=now(),unread_count=case when $3::boolean then 0 else unread_count end,${nowField}=now() where id=$2::uuid`,
    [finalText || input.media?.fileName || "مرفق", input.conversation.id, senderType === "human"],
  );
  return { message, providerStatus, providerResponse: input.providerResponse, errorMessage: "", jobId: job.id, routing: policy, workerRoute: clean(input.workerRoute) };
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
  if (policy.templateOnly && !input.template && !input.media) throw new Error(`مصدر العميل «${policy.sourceArabic}» يسمح بالإرسال عن طريق واتساب بالقوالب فقط`);
  if (policy.templateOnly && input.template && !isMersalTemplate(input.template)) throw new Error("المصدر يسمح بقالب واتساب متزامن من مرسال فقط");
  const kind: DeliveryKind = input.media ? "media" : input.template ? "template" : "text";
  const { endpoint, urls } = await resolveEndpoint(policy.route, kind);
  const idempotencyKey = clean(input.idempotencyKey) || `crm:${conversation.id}:${kind}:${crypto.randomUUID()}`;
  const payload = deliveryPayload({ route: policy.route, conversation, text: finalText, template: input.template, media: input.media, policy, buttons: input.buttons, header: input.header, footer: input.footer });

  const [job] = await sql<any[]>`
    insert into integrations.outbound_jobs(source,idempotency_key,conversation_id,lead_id,payload,status,created_by)
    values (${policy.route},${idempotencyKey},${conversation.id}::uuid,${conversation.lead_id||null}::uuid,${sql.json(payload as any)},'queued',${input.actor?.id||null}::uuid)
    on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key
    returning *,id::text
  `;
  if (job.status !== "queued" && job.processed_at) {
    const [existing] = await sql<any[]>`select *,id::text,conversation_id::text from crm.messages where metadata->>'jobId'=${job.id} limit 1`;
    return { message: existing, providerStatus: job.status, providerResponse: job.response_payload, errorMessage: job.error_message, jobId: job.id, routing: policy };
  }

  let providerStatus = "failed"; let providerResponse: any = null; let errorMessage = ""; let workerRoute = ""; let workerAttempts: any[] = [];
  const delivery = await postToWorker(urls, gatewayHeaders(endpoint.secret_name), payload);
  providerResponse = delivery.response;
  workerRoute = delivery.usedUrl;
  workerAttempts = delivery.attempts.map((attempt) => ({ url: attempt.url, status: attempt.status, error: clean(attempt.response?.error || attempt.response?.message || attempt.response?.raw) || null }));
  providerStatus = delivery.ok ? (clean(providerResponse?.status) || "sent") : "failed";
  if (providerStatus === "failed") {
    errorMessage = clean(providerResponse?.error || providerResponse?.message || providerResponse?.raw)
      || (delivery.provider ? `HTTP ${delivery.provider.status}` : "تعذر الوصول إلى مسار إرسال صالح في Worker");
  }

  const [existingMessage] = await sql<any[]>`select *,id::text,conversation_id::text from crm.messages where metadata->>'jobId'=${job.id} limit 1`;
  let message = existingMessage;
  if (!message) {
    [message] = await sql<any[]>`
      insert into crm.messages(
        conversation_id,direction,message_type,body,attachment_url,attachment_type,file_name,mime_type,file_size,storage_key,media_status,
        is_sensitive,provider_status,sent_by,sender_type,metadata
      ) values (
        ${conversation.id}::uuid,'out',${kind},${finalText||null},${input.media ? createDownloadUrl(input.media.storageKey,300) : null},${input.media?.mediaType||null},
        ${input.media?.fileName||null},${input.media?.mimeType||null},${input.media?.fileSize||null},${input.media?.storageKey||null},${input.media ? providerStatus : null},
        ${Boolean(input.media?.isSensitive)},${providerStatus},${input.actor?.id||null}::uuid,${senderType},${sql.json({ jobId: job.id, templateId: input.template?.id || null, reason: input.reason || "manual", deliveryRoute: policy.route, sourceArabic: policy.sourceArabic, workerRoute, workerAttempts })}
      ) returning *,id::text,conversation_id::text
    `;
  }
  const nowField = senderType === "human" ? "last_human_reply_at" : "last_bot_reply_at";
  await sql.unsafe(`update crm.conversations set preview_text=$1,last_message_at=now(),updated_at=now(),unread_count=case when $3::boolean then 0 else unread_count end,${nowField}=now() where id=$2::uuid`, [finalText || input.media?.fileName || "مرفق", conversation.id, senderType === "human"]);
  await sql`update integrations.outbound_jobs set status=${providerStatus},attempts=attempts+1,response_payload=${providerResponse ? sql.json(providerResponse) : null},error_message=${errorMessage||null},processed_at=now() where id=${job.id}::uuid`;
  return { message, providerStatus, providerResponse, errorMessage, jobId: job.id, routing: policy, workerRoute, workerAttempts };
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
  const { endpoint, urls } = await resolveEndpoint("whatsapp", input.template ? "template" : "text");
  const templateName = clean(input.template?.name || input.template?.external_id);
  const templateParams = input.template ? extractNumberedTemplateParams(clean(input.template.content), input.text) : [];
  const payload = input.template ? { phone, waId: phone, template_name: templateName, template_language: clean(input.template.language_code)||"ar", params: templateParams, components: templateParams.length ? [{ type: "body", parameters: templateParams.map((value) => ({ type: "text", text: value })) }] : [], text: input.text, agentAuto: true } : { phone, waId: phone, text: input.text, message: input.text, agentAuto: true };
  const key = clean(input.idempotencyKey) || `direct-wa:${phone}:${crypto.randomUUID()}`;
  const [job] = await sql<any[]>`insert into integrations.outbound_jobs(source,idempotency_key,payload,status) values('whatsapp',${key},${sql.json(payload as any)},'queued') on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key returning *,id::text`;
  if (job.processed_at) return { ok: job.status !== "failed", status: job.status, response: job.response_payload };
  const delivery = await postToWorker(urls, gatewayHeaders(endpoint.secret_name), payload);
  const data = delivery.response;
  const status = delivery.ok ? (clean(data?.status)||"sent") : "failed";
  const attempts = delivery.attempts.map((attempt) => ({ url: attempt.url, status: attempt.status, error: clean(attempt.response?.error || attempt.response?.message || attempt.response?.raw) || null }));
  const error = status === "failed" ? clean(data?.error||data?.message||data?.raw) || "تعذر الوصول إلى مسار إرسال صالح في Worker" : "";
  await sql`update integrations.outbound_jobs set status=${status},attempts=attempts+1,response_payload=${sql.json({ ...data, workerRoute: delivery.usedUrl, workerAttempts: attempts })},error_message=${error||null},processed_at=now() where id=${job.id}::uuid`;
  return { ok: status !== "failed", status, response: data, workerRoute: delivery.usedUrl, workerAttempts: attempts, error: error || undefined };
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
