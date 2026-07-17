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
    const templateOnly = !Boolean(sourceConfig.allow_free_text);
    return { route, templateOnly, sourceArabic, reason: route === "whatsapp" ? (templateOnly ? "الإرسال عبر واتساب بالقوالب فقط" : "الإرسال عبر واتساب بنص أو قالب أو وسيط") : `الإرسال عبر ${sourceLabel(route)}` };
  }
  const raw = [conversation.source_code, conversation.source_name, conversation.platform_code, conversation.channel_code, conversation.legacy_id].map(clean).filter(Boolean).join(" ");
  const key = normalized(raw);
  if ((key.includes("facebook") || key.includes("فيسبوك")) && !isLeadSource(`${raw} ${sourceArabic}`)) return { route: "facebook", templateOnly: false, sourceArabic, reason: "الإرسال عبر فيسبوك" };
  if ((key.includes("instagram") || key.includes("انستجرام") || key.includes("انستغرام")) && !isLeadSource(`${raw} ${sourceArabic}`)) return { route: "instagram", templateOnly: false, sourceArabic, reason: "الإرسال عبر إنستجرام" };
  if ((key.includes("tiktok") || key.includes("تيك_توك") || key.includes("تيك")) && !isLeadSource(`${raw} ${sourceArabic}`)) return { route: "tiktok", templateOnly: false, sourceArabic, reason: "الإرسال عبر تيك توك" };
  const templateOnlySources = new Set(["تيك توك ليد", "سناب شات ليد", "تيك توك ليد وسناب شات ليد", "حاسبة التقسيط", "خلال الفرع", "موقع حراج", "موقع آخر", "صديق", "اتصال الرقم الموحد", "إدخال يدوي"]);
  const manualEntry = Boolean(conversation.metadata?.manualEntry || conversation.metadata?.manual_entry);
  const templateOnly = manualEntry || templateOnlySources.has(sourceArabic);
  return { route: "whatsapp", templateOnly, sourceArabic, reason: templateOnly ? "الإرسال عبر واتساب بالقوالب فقط" : "الإرسال عبر واتساب بنص أو قالب أو وسيط" };
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

function unifiedWhatsappSendUrl(endpoint: Record<string, unknown>) {
  // The active Mersal Worker exposes one CRM route (/send/mersal) for both
  // free text and templates. Prefer that canonical route and ignore any stale
  // legacy template-only URL that may still exist in the database.
  return clean(endpoint.text_send_url || endpoint.send_url || endpoint.template_send_url);
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

  let url = "";
  if (route === "whatsapp") {
    url = kind === "media"
      ? clean(endpoint.media_send_url || unifiedWhatsappSendUrl(endpoint))
      : unifiedWhatsappSendUrl(endpoint);
  } else {
    url = kind === "template"
      ? clean(endpoint.template_send_url || endpoint.text_send_url || endpoint.send_url)
      : kind === "media"
        ? clean(endpoint.media_send_url || endpoint.text_send_url || endpoint.send_url)
        : clean(endpoint.text_send_url || endpoint.send_url);
  }

  if (!url) throw new Error(`لم يتم ضبط مسار ${kind === "template" ? "القوالب" : kind === "media" ? "الوسائط" : "النص"} لقناة ${sourceLabel(route)}`);
  return { endpoint, url };
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
    const templateName = clean(input.template.external_id || input.template.name);
    if (!templateName) throw new Error("قالب واتساب غير مربوط باسم قالب مرسال");
    return { ...payload, template_name: templateName, template_language: clean(input.template.language_code) || "ar", params: extractNumberedTemplateParams(clean(input.template.content), input.text), text: input.text };
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
  if (policy.templateOnly && !input.template && !input.media) throw new Error(`مصدر العميل «${policy.sourceArabic}» يسمح بالإرسال عن طريق واتساب بالقوالب فقط`);
  if (policy.templateOnly && input.template && !isMersalTemplate(input.template)) throw new Error("المصدر يسمح بقالب واتساب متزامن من مرسال فقط");
  const kind: DeliveryKind = input.media ? "media" : input.template ? "template" : "text";
  const { endpoint, url } = await resolveEndpoint(policy.route, kind);
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

  let providerStatus = "failed"; let providerResponse: any = null; let errorMessage = "";
  try {
    const provider = await fetch(url, { method: "POST", headers: gatewayHeaders(endpoint.secret_name), body: JSON.stringify(payload) });
    const raw = await provider.text();
    try { providerResponse = JSON.parse(raw); } catch { providerResponse = { raw }; }
    providerStatus = provider.ok && providerResponse?.ok !== false ? (clean(providerResponse?.status) || "sent") : "failed";
    if (providerStatus === "failed") errorMessage = clean(providerResponse?.error || providerResponse?.message || providerResponse?.raw) || `HTTP ${provider.status}`;
  } catch (error: any) { errorMessage = error?.message || String(error); }

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
        ${Boolean(input.media?.isSensitive)},${providerStatus},${input.actor?.id||null}::uuid,${senderType},${sql.json({ jobId: job.id, templateId: input.template?.id || null, reason: input.reason || "manual", deliveryRoute: policy.route, sourceArabic: policy.sourceArabic })}
      ) returning *,id::text,conversation_id::text
    `;
  }
  const nowField = senderType === "human" ? "last_human_reply_at" : "last_bot_reply_at";
  await sql.unsafe(`update crm.conversations set preview_text=$1,last_message_at=now(),updated_at=now(),unread_count=case when $3::boolean then 0 else unread_count end,${nowField}=now() where id=$2::uuid`, [finalText || input.media?.fileName || "مرفق", conversation.id, senderType === "human"]);
  await sql`update integrations.outbound_jobs set status=${providerStatus},attempts=attempts+1,response_payload=${providerResponse ? sql.json(providerResponse) : null},error_message=${errorMessage||null},processed_at=now() where id=${job.id}::uuid`;
  return { message, providerStatus, providerResponse, errorMessage, jobId: job.id, routing: policy };
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
  const { endpoint, url } = await resolveEndpoint("whatsapp", input.template ? "template" : "text");
  const templateName = clean(input.template?.external_id || input.template?.name);
  const payload = input.template ? { phone, waId: phone, template_name: templateName, template_language: clean(input.template.language_code)||"ar", params: extractNumberedTemplateParams(clean(input.template.content), input.text), text: input.text, agentAuto: true } : { phone, waId: phone, text: input.text, message: input.text, agentAuto: true };
  const key = clean(input.idempotencyKey) || `direct-wa:${phone}:${crypto.randomUUID()}`;
  const [job] = await sql<any[]>`insert into integrations.outbound_jobs(source,idempotency_key,payload,status) values('whatsapp',${key},${sql.json(payload as any)},'queued') on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key returning *,id::text`;
  if (job.processed_at) return { ok: job.status !== "failed", status: job.status, response: job.response_payload };
  try {
    const response = await fetch(url,{method:"POST",headers:gatewayHeaders(endpoint.secret_name),body:JSON.stringify(payload)});
    const raw = await response.text(); let data:any; try{data=JSON.parse(raw)}catch{data={raw}};
    const status = response.ok && data?.ok !== false ? (clean(data?.status)||"sent") : "failed";
    await sql`update integrations.outbound_jobs set status=${status},attempts=attempts+1,response_payload=${sql.json(data)},error_message=${status==='failed' ? clean(data?.error||data?.message||raw) : null},processed_at=now() where id=${job.id}::uuid`;
    return { ok: status !== "failed", status, response: data };
  } catch(error:any) {
    await sql`update integrations.outbound_jobs set status='failed',attempts=attempts+1,error_message=${error?.message||String(error)},processed_at=now() where id=${job.id}::uuid`;
    return { ok:false,status:"failed",error:error?.message||String(error) };
  }
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
