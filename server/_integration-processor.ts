import crypto from "node:crypto";
import {
  calculateCreditLimit,
  calculateLeadCompletion,
  chooseAssignment,
  chooseCallCenterAssignment,
  clean,
  departmentCodeFromKey,
  departmentKey,
  normalizePhone,
  resolveSourceName,
} from "./_crm-utils.js";
import { getSql } from "./_db.js";
import { getCustomerFieldDefinitions } from "./_crm-customer-fields.js";

function first(...values: unknown[]) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return "";
}

function toBool(value: unknown) {
  if (value === true || value === 1) return true;
  return ["true", "1", "yes", "on"].includes(clean(value).toLowerCase());
}

function nestedWhatsapp(payload: any) {
  return payload?.entry?.[0]?.changes?.[0]?.value || {};
}

function whatsappMessage(payload: any) {
  return nestedWhatsapp(payload)?.messages?.[0] || {};
}

function effectiveSource(routeSource: string, payload: any) {
  if (routeSource === "installment-calculator") return "installment_calculator";
  if (routeSource === "facebook-chat") return "facebook";
  if (routeSource === "instagram-chat") return "instagram";
  if (routeSource === "tiktok-chat") return "tiktok";
  if (routeSource !== "tiktok-snapchat") return routeSource.replace(/-/g, "_");
  const source = first(payload.sourceCode, payload.source_code, payload.source, payload.platform, payload.channel).toLowerCase();
  if (source.includes("snap")) return "snapchat_lead";
  return "tiktok_lead";
}

function attachmentData(payload: any) {
  const message = whatsappMessage(payload);
  const type = first(payload.attachmentType, payload.attachment_type, payload.messageType, payload.message_type, message?.type);
  const nested = type ? message?.[type] : null;
  const url = first(
    payload.attachmentUrl,
    payload.attachment_url,
    payload.mediaUrl,
    payload.media_url,
    payload.fileUrl,
    payload.file_url,
    payload.mersalMediaUrl,
    nested?.link,
    nested?.url,
  );
  const fileName = first(payload.fileName, payload.file_name, nested?.filename);
  const mimeType = first(payload.mimeType, payload.mime_type, nested?.mime_type);
  const mediaId = first(payload.mediaId, payload.media_id, nested?.id);
  const hasAttachment = toBool(payload.hasAttachment) || Boolean(url || mediaId || ["image", "audio", "video", "document", "sticker"].includes(type));
  const labels: Record<string, string> = {
    image: "صورة",
    audio: "مقطع صوتي",
    video: "فيديو",
    document: fileName || "ملف",
    sticker: "ملصق",
  };
  return {
    hasAttachment,
    type: type || (hasAttachment ? "document" : ""),
    url,
    fileName,
    mimeType,
    mediaId,
    label: labels[type] || (hasAttachment ? fileName || "مرفق" : ""),
  };
}

function messageText(payload: any, attachment: ReturnType<typeof attachmentData>) {
  const wa = nestedWhatsapp(payload);
  const msg = wa?.messages?.[0] || {};
  return first(
    payload.customer_message,
    payload.last_input_text,
    payload.lastTextInput,
    payload.message,
    payload.text,
    payload.body,
    payload.previewText,
    msg?.text?.body,
    msg?.button?.text,
    msg?.interactive?.button_reply?.title,
    msg?.interactive?.list_reply?.title,
    msg?.image?.caption,
    msg?.document?.caption,
    msg?.video?.caption,
    attachment.label,
  );
}

function serviceFromPayload(payload: any) {
  const explicit = first(
    payload.serviceKey,
    payload.service_key,
    payload.leadServiceKey,
    payload.lead_service_key,
    payload.autoService,
    payload.latestChoice,
  );
  if (explicit) return departmentKey(explicit);

  const choice = first(
    payload.buttonTitle,
    payload.button_title,
    payload.message,
    payload.text,
    whatsappMessage(payload)?.interactive?.button_reply?.title,
    whatsappMessage(payload)?.interactive?.list_reply?.title,
  );
  const normalized = choice.replace(/[أإآ]/g, "ا").toLowerCase();
  if (normalized.includes("تمويل")) return "finance";
  if (normalized.includes("خدم")) return "service";
  if (normalized.includes("كاش")) return "cash";
  return "";
}

function sourceData(source: string, payload: any) {
  const wa = nestedWhatsapp(payload);
  const message = wa?.messages?.[0] || {};
  const contact = wa?.contacts?.[0] || {};
  const participant = first(
    payload.participantId,
    payload.participant_id,
    payload.subscriber_id,
    payload.subscriberId,
    payload.contact_id,
    payload.contactId,
    payload.user_id,
    payload.userId,
    payload.igId,
    payload.tiktokId,
    payload.fbId,
    payload.waId,
    message?.from,
    contact?.wa_id,
  );
  const pageId = first(payload.pageId, payload.page_id);
  const providerConversation = first(payload.conversationId, payload.conversation_id, payload.convId);
  const conversationId = providerConversation || (source === "whatsapp" ? participant : `${source}:${pageId || "default"}:${participant || crypto.randomUUID()}`);
  const phoneRaw = first(payload.leadPhone, payload.phone, payload.mobile, payload.phoneNumber, payload.clientNumber, message?.from, contact?.wa_id);
  const name = first(payload.leadName, payload.customerName, payload.displayName, payload.full_name, payload.fullName, payload.name, contact?.profile?.name, "عميل");
  return { participant, pageId, conversationId, phoneRaw, phoneNormalized: normalizePhone(phoneRaw), name };
}

function shouldCreateLead(routeSource: string, payload: any, serviceKey: string, phone: string) {
  if (!phone) return false;
  if (["tiktok-snapchat", "installment-calculator"].includes(routeSource)) return true;
  if (toBool(payload.createLead)) return Boolean(serviceKey);
  const explicitService = first(payload.leadServiceKey, payload.serviceKey, payload.lead_service_key, payload.service_key);
  return Boolean(serviceKey && explicitService);
}

export async function processIntegrationEvent(routeSource: string, eventId: string, payload: any) {
  const sql = getSql();
  const customerFields = await getCustomerFieldDefinitions();
  const source = effectiveSource(routeSource, payload);
  const sourceName = await resolveSourceName(source);
  const data = sourceData(source, payload);
  const explicitService = serviceFromPayload(payload);
  const paymentHint = first(payload.payment, payload.leadPayment, payload.paymentType, payload.payment_type);
  const serviceKey = explicitService || (paymentHint ? departmentKey(paymentHint) : (["tiktok-snapchat", "installment-calculator"].includes(routeSource) ? "finance" : ""));
  const attachment = attachmentData(payload);
  const text = messageText(payload, attachment);
  const direction = first(payload.direction, payload.messageDirection, payload.message_direction, "in").toLowerCase() === "out" ? "out" : "in";
  const branchRequested = first(payload.branchId, payload.branch_id, payload.leadBranchId, payload.branchCode, payload.branch);
  const createLead = shouldCreateLead(routeSource, payload, serviceKey, data.phoneNormalized);

  let lead: any = null;
  let assignment: any = null;
  let callCenter: any = null;

  if (createLead) {
    [lead] = await sql<any[]>`
      select *, id::text, assigned_to::text, call_center_assigned_to::text
      from crm.leads
      where phone_normalized=${data.phoneNormalized} and is_deleted=false
      limit 1
    `;

    if (!lead) {
      assignment = await chooseAssignment(serviceKey || "cash", branchRequested, source);
      if ((serviceKey || "cash") === "finance") callCenter = await chooseCallCenterAssignment(source, branchRequested || "online");
      const departmentCode = departmentCodeFromKey(serviceKey || "cash");
      const statusLabel = first(payload.leadStatus, payload.statusLabel, payload.status_label, "عميل جديد");
      const age = first(payload.age) ? Number(first(payload.age)) : null;
      const salary = first(payload.salary, payload.monthlySalary) ? Number(first(payload.salary, payload.monthlySalary)) : null;
      const obligation = first(payload.obligation, payload.obligations, payload.commitment, payload.liability) ? Number(first(payload.obligation, payload.obligations, payload.commitment, payload.liability)) : null;
      const salaryBank = first(payload.salaryBank, payload.salary_bank, payload.bank);
      const carName = first(payload.leadCar, payload.car, payload.carName, payload.vehicleName);
      const carModel = first(payload.carModel, payload.model);
      const carType = first(payload.carType, payload.vehicleType);
      const color = first(payload.color, payload.carColor);
      const financeType = first(payload.financeType, payload.finance_type);
      const location = first(payload.leadLocation, payload.location, payload.city);
      const completionPercent = calculateLeadCompletion({ customerName: data.name, phone: data.phoneNormalized, sourceCode: source, statusLabel, serviceKey: serviceKey || "cash", age, salary, obligation, salaryBank, location, carName, carModel, color }, customerFields);
      const credit = calculateCreditLimit(salary, obligation, financeType);
      const [created] = await sql<any[]>`
        insert into crm.leads(
          legacy_id, customer_name, phone, phone_normalized, source_code, source_name, platform_code,
          service_key, department_code, branch_code, status_label, payment_type, car_name, location,
          age, salary, obligation, salary_bank, car_model, car_type, color, finance_type,
          assigned_to, call_center_assigned_to, registered_at, responsible_name_snapshot,
          call_center_name_snapshot, source_history, extra_data, completion_percent, credit_limit, credit_qualified
        ) values (
          ${first(payload.leadId, payload.lead_id) || null}, ${data.name}, ${data.phoneRaw}, ${data.phoneNormalized},
          ${source}, ${sourceName}, ${source}, ${serviceKey || "cash"}, ${departmentCode},
          ${assignment.branchCode || branchRequested || null}, ${statusLabel},
          ${first(payload.leadPayment, payload.payment) || ((serviceKey || "cash") === "finance" ? "تمويل" : (serviceKey || "cash") === "service" ? "خدمة عملاء" : "كاش")},
          ${carName || null},
          ${location || null},
          ${age}, ${salary}, ${obligation}, ${salaryBank || null}, ${carModel || null}, ${carType || null}, ${color || null}, ${financeType || null},
          ${assignment.assignedTo}::uuid, ${callCenter?.assignedTo || null}::uuid, now(),
          ${assignment.assignedName || null}, ${callCenter?.assignedName || null},
          ${sql.json([{ source, at: new Date().toISOString() }])},
          ${sql.json({ integrationEventId: eventId, routeSource })},
          ${completionPercent}, ${credit.amount}, ${credit.qualified}
        )
        returning *, id::text, assigned_to::text, call_center_assigned_to::text
      `;
      lead = created;
      await sql`
        insert into crm.lead_events(lead_id,event_type,new_status,new_department,new_branch,actor_name,note,details)
        values (${lead.id}::uuid,'integration_lead_created',${lead.status_label},${lead.department_code},${lead.branch_code},${sourceName},'دخول العميل إلى النظام',${sql.json({ eventId, source, routeSource })})
      `;
    } else {
      const historyItem = { source, at: new Date().toISOString() };
      await sql`
        update crm.leads set
          source_history=case
            when coalesce(source_history,'[]'::jsonb) @> ${sql.json([{ source }])}::jsonb then coalesce(source_history,'[]'::jsonb)
            else coalesce(source_history,'[]'::jsonb) || ${sql.json([historyItem])}::jsonb
          end,
          extra_data=coalesce(extra_data,'{}'::jsonb) || ${sql.json({ lastIntegrationEventId: eventId, lastSource: source, routeSource })}::jsonb,
          updated_at=now()
        where id=${lead.id}::uuid
      `;
    }
  }

  let conversation: any = null;
  if (data.participant || data.conversationId) {
    [conversation] = await sql<any[]>`
      select *, id::text, lead_id::text from crm.conversations where legacy_id=${data.conversationId} limit 1
    `;
    if (!conversation) {
      [conversation] = await sql<any[]>`
        insert into crm.conversations(
          legacy_id,lead_id,channel_code,customer_name,participant_id,status,preview_text,unread_count,last_message_at,
          service_key,department_code,branch_code,assigned_to,call_center_assigned_to,provider,page_id,metadata
        ) values (
          ${data.conversationId},${lead?.id || null}::uuid,${source},${data.name},${data.participant || null},'open',
          ${text || null},${direction === 'in' && (text || attachment.hasAttachment) ? 1 : 0},
          ${text || attachment.hasAttachment ? new Date().toISOString() : null},${serviceKey || lead?.service_key || null},
          ${lead?.department_code || null},${lead?.branch_code || null},${lead?.assigned_to || null}::uuid,
          ${lead?.call_center_assigned_to || null}::uuid,${first(payload.provider, routeSource)},${data.pageId || null},
          ${sql.json({ eventId, routeSource })}
        )
        returning *, id::text, lead_id::text
      `;
    } else {
      [conversation] = await sql<any[]>`
        update crm.conversations set
          lead_id=coalesce(${lead?.id || null}::uuid,lead_id),
          customer_name=coalesce(nullif(${data.name},''),customer_name),
          preview_text=coalesce(nullif(${text},''),preview_text),
          unread_count=unread_count+${direction === 'in' && (text || attachment.hasAttachment) ? 1 : 0},
          last_message_at=case when ${Boolean(text || attachment.hasAttachment)} then now() else last_message_at end,
          service_key=coalesce(nullif(${serviceKey},''),service_key),
          department_code=coalesce(${lead?.department_code || null},department_code),
          branch_code=coalesce(${lead?.branch_code || null},branch_code),
          assigned_to=coalesce(${lead?.assigned_to || null}::uuid,assigned_to),
          call_center_assigned_to=coalesce(${lead?.call_center_assigned_to || null}::uuid,call_center_assigned_to),
          metadata=coalesce(metadata,'{}'::jsonb) || ${sql.json({ lastEventId: eventId, routeSource })}::jsonb,
          updated_at=now()
        where id=${conversation.id}::uuid
        returning *, id::text, lead_id::text
      `;
    }
  }

  let message: any = null;
  if (conversation && (text || attachment.hasAttachment)) {
    const providerMessageId = first(payload.messageId, payload.message_id, payload.mid, whatsappMessage(payload)?.id, eventId);
    [message] = await sql<any[]>`
      select *, id::text
      from crm.messages
      where conversation_id=${conversation.id}::uuid and provider_message_id=${providerMessageId}
      limit 1
    `;
    if (!message) {
      [message] = await sql<any[]>`
        insert into crm.messages(
          conversation_id,legacy_id,direction,message_type,body,attachment_url,attachment_type,file_name,mime_type,
          provider_status,provider_message_id,metadata
        ) values (
          ${conversation.id}::uuid,${providerMessageId},${direction},
          ${attachment.type || first(payload.type,payload.messageType,payload.message_type,"text")},
          ${text || null},${attachment.url || null},${attachment.type || null},${attachment.fileName || null},${attachment.mimeType || null},
          ${direction === 'in' ? "received" : "sent"},${providerMessageId},
          ${sql.json({ source, routeSource, eventId, mediaId: attachment.mediaId || null })}
        )
        returning *, id::text
      `;
    }
  }

  await sql`
    update integrations.inbound_events
    set status='processed', processed_at=now(), error_message=null
    where source=${routeSource} and event_key=${eventId}
  `;
  return { lead, conversation, message, createLead };
}
