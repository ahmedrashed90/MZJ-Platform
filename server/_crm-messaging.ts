import crypto from "node:crypto";
import type { SessionUser } from "./_auth.js";
import { clean, normalizePhone, sourceLabel } from "./_crm-utils.js";
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
  source_code?: string | null;
  source_name?: string | null;
  platform_code?: string | null;
  service_key?: string | null;
  page_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

type TemplateRow = {
  id?: string;
  external_id?: string | null;
  name?: string | null;
  display_name?: string | null;
  content?: string | null;
  template_type?: string | null;
  provider?: string | null;
  language_code?: string | null;
};

type DeliveryRoute = "whatsapp" | "facebook" | "instagram" | "tiktok";

type DeliveryPolicy = {
  route: DeliveryRoute;
  templateOnly: boolean;
  sourceArabic: string;
  reason: string;
};

function normalized(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[\s/]+/g, "_");
}

function isLeadSource(value: string) {
  const text = normalized(value);
  return text.includes("lead") || text.includes("ليد");
}

function resolveDeliveryPolicy(conversation: ConversationContext): DeliveryPolicy {
  const sourceArabic = sourceLabel(conversation.source_code || conversation.source_name || conversation.platform_code || conversation.channel_code);
  const raw = [
    conversation.source_code,
    conversation.source_name,
    conversation.platform_code,
    conversation.channel_code,
    conversation.legacy_id,
  ].map((item) => clean(item)).filter(Boolean).join(" ");
  const key = normalized(raw);

  if ((key.includes("facebook") || key.includes("فيسبوك") || key.includes("فيس_بوك")) && !isLeadSource(`${raw} ${sourceArabic}`)) {
    return { route: "facebook", templateOnly: false, sourceArabic, reason: "الإرسال عبر Endpoint فيسبوك" };
  }
  if ((key.includes("instagram") || key.includes("انستجرام") || key.includes("انستغرام")) && !isLeadSource(`${raw} ${sourceArabic}`)) {
    return { route: "instagram", templateOnly: false, sourceArabic, reason: "الإرسال عبر Endpoint إنستجرام" };
  }
  if ((key.includes("tiktok") || key.includes("تيك_توك") || key.includes("تيك")) && !isLeadSource(`${raw} ${sourceArabic}`)) {
    return { route: "tiktok", templateOnly: false, sourceArabic, reason: "الإرسال عبر Endpoint تيك توك" };
  }

  const templateOnlySources = new Set([
    "تيك توك ليد",
    "سناب شات ليد",
    "تيك توك ليد وسناب شات ليد",
    "حاسبة التقسيط",
    "خلال الفرع",
    "موقع حراج",
    "موقع آخر",
    "صديق",
    "اتصال الرقم الموحد",
    "إدخال يدوي",
  ]);
  const manualEntry = Boolean(conversation.metadata?.manualEntry || conversation.metadata?.manual_entry);
  const templateOnly = manualEntry || templateOnlySources.has(sourceArabic);
  return {
    route: "whatsapp",
    templateOnly,
    sourceArabic,
    reason: templateOnly ? "الإرسال عبر واتساب بالقوالب فقط" : "الإرسال عبر واتساب بنص حر أو قالب",
  };
}

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

function isMersalTemplate(template?: TemplateRow | null) {
  if (!template) return false;
  const raw = normalized([template.provider, template.template_type, template.external_id].filter(Boolean).join(" "));
  return Boolean(template.external_id) || raw.includes("mersal") || raw.includes("مرسال") || raw.includes("whatsapp_template");
}

function extractNumberedTemplateParams(templateBody: string, renderedText: string) {
  const matches = [...String(templateBody || "").matchAll(/{{\s*(\d+)\s*}}/g)];
  if (!matches.length) return [];
  let pattern = "^";
  let lastIndex = 0;
  const order: number[] = [];
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  for (const match of matches) {
    pattern += escape(templateBody.slice(lastIndex, match.index));
    pattern += "([\\s\\S]*?)";
    order.push(Number(match[1]));
    lastIndex = Number(match.index) + match[0].length;
  }
  pattern += escape(templateBody.slice(lastIndex)) + "$";
  const result = new RegExp(pattern, "i").exec(renderedText);
  if (!result) return [];
  const values: Record<number, string> = {};
  order.forEach((position, index) => { values[position] = clean(result[index + 1]); });
  return Object.keys(values).map(Number).sort((a, b) => a - b).map((position) => values[position]);
}

function endpointCandidates(route: DeliveryRoute) {
  if (route === "whatsapp") return ["whatsapp", "mersal"];
  if (route === "facebook") return ["facebook", "facebook-chat", "facebook_chat"];
  if (route === "instagram") return ["instagram", "instagram-chat", "instagram_chat"];
  return ["tiktok", "tiktok-chat", "tiktok_chat"];
}

function platformPayload(
  route: DeliveryRoute,
  conversation: ConversationContext,
  text: string,
  template: TemplateRow | null | undefined,
  policy: DeliveryPolicy,
) {
  const conversationId = clean(conversation.legacy_id) || conversation.id;
  const participantId = clean(conversation.participant_id);
  const displayName = conversation.lead_customer_name || conversation.customer_name || "عميل";

  if (route === "whatsapp") {
    const phone = normalizePhone(conversation.phone_normalized || conversation.phone);
    if (!phone) {
      throw new Error("رقم واتساب غير موجود أو غير صالح. عدّل رقم العميل إلى رقم سعودي صحيح ثم أعد الإرسال");
    }
    if (template) {
      const templateName = clean(template.external_id || template.name);
      if (!templateName) throw new Error("قالب واتساب المختار غير مربوط باسم قالب مرسال");
      return {
        phone,
        waId: phone,
        conversationId: conversationId || phone,
        convId: conversationId || phone,
        leadId: conversation.lead_id || "",
        template_name: templateName,
        template_language: clean(template.language_code) || "ar",
        params: extractNumberedTemplateParams(clean(template.content), text),
        source: policy.sourceArabic,
        deliveryChannel: "whatsapp",
        saveMessage: false,
      };
    }
    return {
      phone,
      waId: phone,
      conversationId: conversationId || phone,
      convId: conversationId || phone,
      message: text,
      text,
      leadId: conversation.lead_id || "",
      source: policy.sourceArabic,
      deliveryChannel: "whatsapp",
      saveMessage: false,
    };
  }

  if (route === "tiktok") {
    const subscriber = participantId || conversationId.replace(/^tiktok[_:]/i, "");
    return {
      subscriber_id: subscriber,
      subscriberId: subscriber,
      participantId: subscriber,
      conversationId: conversationId || `tiktok_${subscriber}`,
      convId: conversationId || `tiktok_${subscriber}`,
      displayName,
      serviceKey: conversation.service_key || "",
      message: text,
      text,
      saveMessage: true,
    };
  }

  if (route === "instagram") {
    return {
      subscriber_id: participantId,
      participantId,
      manychatContactId: participantId,
      igId: participantId,
      pageId: conversation.page_id || "",
      conversationId,
      convId: conversationId,
      displayName,
      serviceKey: conversation.service_key || "",
      message: text,
      text,
      saveMessage: true,
    };
  }

  return {
    convId: conversationId,
    conversationId,
    text,
    message: text,
    participantId,
    pageId: conversation.page_id || "",
    saveMessage: true,
  };
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
  if (!finalText) throw new Error("اكتب الرسالة أو اختر قالبًا صالحًا");

  const conversation = input.conversation;
  const policy = resolveDeliveryPolicy(conversation);
  if (policy.templateOnly && !input.template) {
    throw new Error(`مصدر العميل «${policy.sourceArabic}» يسمح بالإرسال عن طريق واتساب بالقوالب فقط`);
  }
  if (policy.templateOnly && !isMersalTemplate(input.template)) {
    throw new Error("المصدر يسمح بقالب واتساب متزامن من مرسال فقط، وليس رسالة سريعة");
  }

  const candidates = endpointCandidates(policy.route);
  const endpoints = await sql<any[]>`
    select * from crm.integration_endpoints
    where source_code=any(${candidates}::text[]) and is_active=true
  `;
  const endpoint = candidates.map((code) => endpoints.find((row) => row.source_code === code)).find(Boolean);
  if (!endpoint?.send_url) {
    throw new Error(`لا يوجد Send URL محفوظ لقناة ${policy.route === "whatsapp" ? "واتساب" : policy.route === "facebook" ? "فيسبوك" : policy.route === "instagram" ? "إنستجرام" : "تيك توك"}`);
  }

  const idempotencyKey = clean(input.idempotencyKey) || `crm:${conversation.id}:${crypto.randomUUID()}`;
  const payload = platformPayload(policy.route, conversation, finalText, input.template, policy);

  const [insertedJob] = await sql<any[]>`
    insert into integrations.outbound_jobs(source,idempotency_key,conversation_id,lead_id,payload,created_by)
    values (
      ${policy.route},${idempotencyKey},${conversation.id}::uuid,${conversation.lead_id || null}::uuid,
      ${sql.json({ ...payload, routing: policy, reason: input.reason || "manual" })},${input.actor?.id || null}::uuid
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
      routing: policy,
    };
  }

  let providerStatus = "failed";
  let providerResponse: any = null;
  let errorMessage = "";
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
    providerStatus = provider.ok && providerResponse?.ok !== false && String(providerResponse?.status || "").toLowerCase() !== "error" ? "sent" : "failed";
    if (providerStatus === "failed") errorMessage = clean(providerResponse?.error || providerResponse?.message || providerResponse?.raw) || `HTTP ${provider.status}`;
  } catch (error: any) {
    providerStatus = "failed";
    errorMessage = error?.message || String(error);
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
        ${input.actor?.id || null}::uuid,${sql.json({
          jobId: job.id,
          templateId: input.template?.id || null,
          reason: input.reason || "manual",
          deliveryRoute: policy.route,
          sourceArabic: policy.sourceArabic,
          templateOnly: policy.templateOnly,
        })}
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
    set status=${providerStatus},attempts=attempts+1,
        response_payload=${providerResponse ? sql.json(providerResponse) : null},error_message=${errorMessage || null},
        processed_at=now()
    where id=${job.id}::uuid
  `;

  return { message, providerStatus, providerResponse, errorMessage, jobId: job.id, routing: policy };
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
    select c.*,c.id::text,c.lead_id::text,l.phone,l.phone_normalized,l.customer_name as lead_customer_name,
      l.car_name,l.status_label,l.source_code,l.source_name,l.platform_code,l.service_key
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
