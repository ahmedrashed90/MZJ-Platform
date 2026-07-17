import crypto from "node:crypto";
import { clean, departmentKey, normalizePhone } from "./_crm-utils.js";
import { getSql } from "./_db.js";
import { ensureContactIdentity, findOpenServiceRequest, classifyConversationService } from "./_crm-lifecycle.js";
import { publishAutomationEvent } from "./_crm-automation.js";
import { markCrmLeadUnread } from "./_crm-unread-state.js";

function first(...values: unknown[]) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return "";
}

function bool(value: unknown) {
  return value === true || value === 1 || ["true", "1", "yes", "on"].includes(clean(value).toLowerCase());
}

function nestedWhatsapp(payload: any) {
  return payload?.entry?.[0]?.changes?.[0]?.value || {};
}

function whatsappMessage(payload: any) {
  return nestedWhatsapp(payload)?.messages?.[0] || {};
}

function routeSourceCode(routeSource: string, payload: any) {
  if (routeSource === "installment-calculator") return "installment_calculator";
  if (routeSource !== "tiktok-snapchat") return routeSource.replace(/-/g, "_");
  const source = first(payload.sourceCode, payload.source_code, payload.source, payload.platform, payload.channel).toLowerCase();
  return source.includes("snap") ? "snapchat_lead" : "tiktok_lead";
}

function dateValue(payload: any) {
  const raw = payload.createdAt ?? payload.created_at ?? payload.receivedAt ?? payload.received_at ?? payload.timestamp ?? whatsappMessage(payload)?.timestamp;
  if (raw == null || raw === "") return new Date().toISOString();
  if (typeof raw === "number") return new Date(raw < 1e12 ? raw * 1000 : raw).toISOString();
  const text = String(raw).trim();
  if (/^\d+$/.test(text)) {
    const value = Number(text);
    return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function mediaData(payload: any) {
  const msg = whatsappMessage(payload);
  const rawType = first(payload.mediaType, payload.media_type, payload.attachmentType, payload.attachment_type, payload.messageType, payload.message_type, msg?.type).toLowerCase();
  const type = rawType === "file" ? "document" : rawType === "voice" || rawType === "ptt" ? "audio" : rawType;
  const nested = msg?.[rawType] || msg?.[type];
  const storageKey = first(payload.storageKey, payload.storage_key);
  const url = first(payload.mediaUrl, payload.media_url, payload.attachmentUrl, payload.attachment_url, payload.fileUrl, payload.file_url, nested?.url, nested?.link);
  const fileName = first(payload.fileName, payload.file_name, nested?.filename);
  const mimeType = first(payload.mimeType, payload.mime_type, nested?.mime_type);
  const fileSize = Number(payload.fileSize ?? payload.file_size ?? 0) || null;
  const hasAttachment = bool(payload.hasAttachment) || Boolean(storageKey || url || nested?.id || ["image", "audio", "video", "document", "sticker"].includes(type));
  return {
    hasAttachment,
    type: type || (hasAttachment ? "document" : ""),
    storageKey,
    url,
    fileName,
    mimeType,
    fileSize,
    caption: first(payload.caption, nested?.caption),
    isSensitive: bool(payload.isSensitive || payload.is_sensitive),
    mediaId: first(payload.mediaId, payload.media_id, nested?.id),
  };
}

function messageBody(payload: any, media: ReturnType<typeof mediaData>) {
  const msg = whatsappMessage(payload);
  return first(
    payload.customer_message,
    payload.last_input_text,
    payload.lastTextInput,
    payload.text,
    payload.message,
    payload.body,
    payload.previewText,
    msg?.text?.body,
    msg?.button?.text,
    msg?.interactive?.button_reply?.title,
    msg?.interactive?.list_reply?.title,
    media.caption,
    media.hasAttachment ? media.fileName || ({ image: "صورة", audio: "رسالة صوتية", video: "فيديو", document: "ملف", sticker: "ملصق" } as Record<string, string>)[media.type] || "مرفق" : "",
  );
}

function identityData(source: string, payload: any) {
  const wa = nestedWhatsapp(payload);
  const msg = wa?.messages?.[0] || {};
  const contact = wa?.contacts?.[0] || {};
  const participant = first(payload.participantId, payload.participant_id, payload.subscriber_id, payload.subscriberId, payload.contact_id, payload.contactId, payload.user_id, payload.userId, payload.igId, payload.tiktokId, payload.fbId, payload.waId, msg?.from, contact?.wa_id);
  const pageId = first(payload.pageId, payload.page_id);
  const externalId = participant || first(payload.externalCustomerId, payload.external_customer_id, payload.conversationId, payload.conversation_id, payload.convId) || crypto.randomUUID();
  const conversationExternalId = first(payload.conversationId, payload.conversation_id, payload.convId) || (source === "whatsapp" ? externalId : `${source}:${pageId || "default"}:${externalId}`);
  const phone = first(payload.phone, payload.mobile, payload.phoneNumber, payload.clientNumber, payload.leadPhone, msg?.from, contact?.wa_id);
  const displayName = first(payload.customerName, payload.displayName, payload.full_name, payload.fullName, payload.leadName, payload.name, contact?.profile?.name, "عميل");
  return { participant, pageId, externalId, conversationExternalId, phone, phoneNormalized: normalizePhone(phone), displayName };
}

function trustedKnownService(routeSource: string, payload: any) {
  if (["installment-calculator", "tiktok-snapchat"].includes(routeSource)) return "finance";
  if (bool(payload.trustedServiceClassification || payload.trusted_service_classification)) return departmentKey(first(payload.serviceKey, payload.service_key));
  return "";
}

export async function processIntegrationEvent(routeSource: string, eventId: string, payload: any) {
  const sql = getSql();
  const source = routeSourceCode(routeSource, payload);
  const identity = identityData(source, payload);
  const media = mediaData(payload);
  const text = messageBody(payload, media);
  const waMessage = whatsappMessage(payload);
  const isWhatsappCustomerMessage = source === "whatsapp" && Boolean(waMessage?.from) && Boolean(waMessage?.id || text || media.hasAttachment);
  const declaredDirection = first(payload.direction, payload.messageDirection, payload.message_direction, "in").toLowerCase();
  const direction = isWhatsappCustomerMessage ? "in" : (declaredDirection === "out" ? "out" : "in");
  const senderType = direction === "in" ? "customer" : first(payload.senderType, payload.sender_type, "system");
  const providerMessageId = first(payload.providerMessageId, payload.provider_message_id, payload.messageId, payload.message_id, payload.mid, whatsappMessage(payload)?.id, eventId);
  const occurredAt = dateValue(payload);

  const { contact } = await ensureContactIdentity({
    channelCode: source,
    externalId: identity.externalId,
    participantId: identity.participant,
    pageId: identity.pageId,
    phone: identity.phone,
    displayName: identity.displayName,
    metadata: { routeSource, lastEventId: eventId },
  });
  let openRequest = await findOpenServiceRequest(contact.id);

  let [conversation] = await sql<any[]>`
    select *,id::text,lead_id::text,contact_id::text,service_request_id::text
    from crm.conversations where legacy_id=${identity.conversationExternalId} limit 1
  `;

  if (!conversation && source === "whatsapp" && openRequest?.lead_id) {
    [conversation] = await sql<any[]>`
      select *,id::text,lead_id::text,contact_id::text,service_request_id::text
      from crm.conversations
      where lead_id=${openRequest.lead_id}::uuid and channel_code in ('whatsapp','mersal')
      order by last_message_at desc nulls last,updated_at desc limit 1
    `;
  }

  if (!conversation && source === "whatsapp" && identity.phoneNormalized) {
    [conversation] = await sql<any[]>`
      select c.*,c.id::text,c.lead_id::text,c.contact_id::text,c.service_request_id::text
      from crm.conversations c
      join crm.leads l on l.id=c.lead_id
      where c.channel_code in ('whatsapp','mersal')
        and right(regexp_replace(coalesce(l.phone_normalized,l.phone,''),'\\D','','g'),9)=right(${identity.phoneNormalized},9)
      order by c.last_message_at desc nulls last,c.updated_at desc limit 1
    `;
  }

  if (!conversation && source === "whatsapp") {
    [conversation] = await sql<any[]>`
      select *,id::text,lead_id::text,contact_id::text,service_request_id::text
      from crm.conversations
      where contact_id=${contact.id}::uuid and channel_code in ('whatsapp','mersal')
      order by last_message_at desc nulls last,updated_at desc limit 1
    `;
  }

  let existingMessage: any = null;
  if (conversation) {
    [existingMessage] = await sql<any[]>`
      select *,id::text,conversation_id::text from crm.messages
      where conversation_id=${conversation.id}::uuid and provider_message_id=${providerMessageId} limit 1
    `;
  }

  if (!conversation) {
    [conversation] = await sql<any[]>`
      insert into crm.conversations(
        legacy_id,lead_id,contact_id,service_request_id,channel_code,customer_name,participant_id,status,preview_text,unread_count,last_message_at,
        service_key,department_code,branch_code,assigned_to,call_center_assigned_to,provider,page_id,classification_state,last_customer_message_at,metadata
      ) values(
        ${identity.conversationExternalId},${openRequest?.lead_id || null}::uuid,${contact.id}::uuid,${openRequest?.id || null}::uuid,${source},${identity.displayName},${identity.participant || identity.externalId},'open',
        ${text || null},0,${occurredAt}::timestamptz,${openRequest?.service_key || null},${openRequest?.department_code || null},${openRequest?.branch_code || null},
        ${openRequest?.assigned_to || null}::uuid,${openRequest?.call_center_assigned_to || null}::uuid,${first(payload.provider, routeSource)},${identity.pageId || null},
        ${openRequest ? 'classified' : 'new'},${direction === "in" ? occurredAt : null}::timestamptz,${sql.json({ routeSource, lastEventId: eventId, providerConversationId: identity.conversationExternalId })}
      ) returning *,id::text,lead_id::text,contact_id::text,service_request_id::text
    `;
  } else if (!existingMessage) {
    [conversation] = await sql<any[]>`
      update crm.conversations set
        contact_id=${contact.id}::uuid,
        lead_id=coalesce(${openRequest?.lead_id || null}::uuid,lead_id),
        service_request_id=coalesce(${openRequest?.id || null}::uuid,service_request_id),
        customer_name=coalesce(nullif(${identity.displayName},''),customer_name),
        participant_id=coalesce(nullif(${identity.participant || identity.externalId},''),participant_id),
        preview_text=coalesce(nullif(${text},''),preview_text),
        unread_count=unread_count,
        last_message_at=greatest(coalesce(last_message_at,'epoch'),${occurredAt}::timestamptz),
        service_key=coalesce(${openRequest?.service_key || null},service_key),
        department_code=coalesce(${openRequest?.department_code || null},department_code),
        branch_code=coalesce(${openRequest?.branch_code || null},branch_code),
        assigned_to=coalesce(${openRequest?.assigned_to || null}::uuid,assigned_to),
        call_center_assigned_to=coalesce(${openRequest?.call_center_assigned_to || null}::uuid,call_center_assigned_to),
        provider=coalesce(nullif(${first(payload.provider, routeSource)},''),provider),
        classification_state=case when ${Boolean(openRequest)} then 'classified' when classification_state='closed' then 'new' else classification_state end,
        last_customer_message_at=case when ${direction === "in"} then ${occurredAt}::timestamptz else last_customer_message_at end,
        last_human_reply_at=case when ${direction === "out" && senderType === "human"} then ${occurredAt}::timestamptz else last_human_reply_at end,
        metadata=coalesce(metadata,'{}'::jsonb)||${sql.json({ routeSource, lastEventId: eventId, providerConversationId: identity.conversationExternalId })}::jsonb,
        updated_at=now()
      where id=${conversation.id}::uuid
      returning *,id::text,lead_id::text,contact_id::text,service_request_id::text
    `;
  }

  if (existingMessage) {
    if (direction === "in") {
      [existingMessage] = await sql<any[]>`
        update crm.messages
        set direction='in',provider_status='received',sender_type='customer'
        where id=${existingMessage.id}::uuid
        returning *,id::text,conversation_id::text
      `;
    }
    await sql`update integrations.inbound_events set status='processed',processed_at=now(),error_message=null where source=${routeSource} and event_key=${eventId}`;
    return { lead: conversation.lead_id ? { id: conversation.lead_id } : null, conversation, message: existingMessage, createLead: false, contact, automation: null };
  }

  let [message] = await sql<any[]>`
    insert into crm.messages(
      conversation_id,legacy_id,direction,message_type,body,attachment_url,attachment_type,file_name,mime_type,file_size,storage_key,media_status,is_sensitive,
      provider_status,provider_message_id,sender_type,caption,created_at,metadata
    ) values(
      ${conversation.id}::uuid,${providerMessageId},${direction},${media.hasAttachment ? media.type : first(payload.messageType, payload.message_type, "text")},${text || null},
      ${media.storageKey ? null : media.url || null},${media.type || null},${media.fileName || null},${media.mimeType || null},${media.fileSize},${media.storageKey || null},${media.hasAttachment ? 'ready' : null},${media.isSensitive},
      ${direction === "in" ? 'received' : 'sent'},${providerMessageId},${senderType},${media.caption || null},${occurredAt}::timestamptz,${sql.json({ source, routeSource, eventId, mediaId: media.mediaId || null })}
    ) returning *,id::text,conversation_id::text
  `;

  if (media.storageKey) {
    await sql`
      insert into crm.media_assets(conversation_id,message_id,storage_key,original_name,media_type,mime_type,file_size,is_sensitive,status,metadata)
      values(${conversation.id}::uuid,${message.id}::uuid,${media.storageKey},${media.fileName || null},${media.type || 'document'},${media.mimeType || null},${media.fileSize},${media.isSensitive},'ready',${sql.json({ source, eventId })})
      on conflict(storage_key) do update set
        conversation_id=excluded.conversation_id,message_id=excluded.message_id,original_name=coalesce(excluded.original_name,crm.media_assets.original_name),
        media_type=excluded.media_type,mime_type=coalesce(excluded.mime_type,crm.media_assets.mime_type),file_size=coalesce(excluded.file_size,crm.media_assets.file_size),
        is_sensitive=excluded.is_sensitive,status='ready',updated_at=now()
    `;
  }

  const knownService = trustedKnownService(routeSource, payload);
  let createdByKnownSource = false;
  if (!openRequest && knownService) {
    const classified = await classifyConversationService({ conversationId: conversation.id, serviceKey: knownService, sourceCode: source, classificationMethod: "source_mapping", eventKey: eventId });
    openRequest = classified.request;
    createdByKnownSource = classified.reused !== true;
    [conversation] = await sql<any[]>`select *,id::text,lead_id::text,contact_id::text,service_request_id::text from crm.conversations where id=${conversation.id}::uuid`;
  }

  if (direction === "in") {
    if (conversation.lead_id) {
      await markCrmLeadUnread(sql, { leadId: conversation.lead_id, conversationId: conversation.id, createdAt: occurredAt, messageId: providerMessageId, messageKey: providerMessageId, messagePath: "" });
    } else {
      await sql`
        update crm.conversations set
          unread_count=case when coalesce(metadata->>'lastUnreadMessageKey','')=${providerMessageId} then greatest(1,unread_count) else unread_count+1 end,
          metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{lastUnreadMessageKey}',to_jsonb(${providerMessageId}::text),true),
          updated_at=now()
        where id=${conversation.id}::uuid
      `;
    }
  }

  // The inbound message is already persisted at this point. Automation is a secondary
  // side effect and must never make the webhook fail or hide the customer reply.
  let automation: any = null;
  let automationError = "";
  try {
    automation = await publishAutomationEvent({
      eventKey: `${source}:${eventId}:message`,
      eventType: direction === "in" ? "message.received" : "message.sent",
      source,
      contactId: contact.id,
      conversationId: conversation.id,
      serviceRequestId: conversation.service_request_id || openRequest?.id || null,
      leadId: conversation.lead_id || openRequest?.lead_id || null,
      payload: { ...payload, direction, senderType, text, messageId: message.id, providerMessageId, createdAt: occurredAt, hasAttachment: media.hasAttachment, mediaType: media.type },
      actor: null,
    });
  } catch (error: any) {
    automationError = error?.message || String(error);
    console.error("Inbound message persisted; automation side effect failed", {
      routeSource,
      eventId,
      conversationId: conversation.id,
      messageId: message.id,
      error: automationError,
    });
  }

  await sql`
    update integrations.inbound_events
    set status='processed',processed_at=now(),error_message=${automationError ? `automation: ${automationError}` : null}
    where source=${routeSource} and event_key=${eventId}
  `;
  return {
    lead: conversation.lead_id ? { id: conversation.lead_id } : null,
    conversation,
    message,
    createLead: createdByKnownSource,
    contact,
    automation,
    automationError: automationError || null,
  };
}
