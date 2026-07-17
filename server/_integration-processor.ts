import crypto from "node:crypto";
import { clean, departmentKey, normalizePhone } from "./_crm-utils.js";
import { getSql } from "./_db.js";
import { ensureContactIdentity, findOpenServiceRequest, classifyConversationService } from "./_crm-lifecycle.js";
import { publishAutomationEvent } from "./_crm-automation.js";
import { markCrmLeadUnread } from "./_crm-unread-state.js";
import {
  extractIntegrationDirection,
  extractIntegrationMedia,
  extractIntegrationMessageText,
  extractIntegrationMessageType,
  extractIntegrationSenderType,
  extractStrongMessageKeys,
  integrationMessageMetadata,
  whatsappMessage,
} from "./_message-media.js";

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
  const media = extractIntegrationMedia(payload);
  const text = extractIntegrationMessageText(payload, media);
  const direction = extractIntegrationDirection(payload);
  const senderType = extractIntegrationSenderType(payload, direction);
  const messageType = extractIntegrationMessageType(payload, media);
  const messageKeys = extractStrongMessageKeys(payload, eventId);
  const providerMessageId = messageKeys[0] || eventId;
  const occurredAt = dateValue(payload);
  const messageMetadata = integrationMessageMetadata(payload, media, source, routeSource, eventId, messageKeys);

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
      where conversation_id=${conversation.id}::uuid and (
        provider_message_id=any(${messageKeys}::text[])
        or legacy_id=any(${messageKeys}::text[])
        or coalesce(metadata->>'eventId','')=any(${messageKeys}::text[])
        or coalesce(metadata->>'mediaId','')=any(${messageKeys}::text[])
        or coalesce(metadata->>'sha256','')=any(${messageKeys}::text[])
        or coalesce(metadata->>'mersalMessageId','')=any(${messageKeys}::text[])
        or coalesce(metadata->>'fbMessageId','')=any(${messageKeys}::text[])
        or exists (
          select 1 from jsonb_array_elements_text(coalesce(metadata->'messageKeys','[]'::jsonb)) as stored_key(value)
          where stored_key.value=any(${messageKeys}::text[])
        )
      )
      order by created_at asc limit 1
    `;
  }

  if (!conversation) {
    [conversation] = await sql<any[]>`
      insert into crm.conversations(
        legacy_id,lead_id,contact_id,service_request_id,channel_code,customer_name,participant_id,status,preview_text,unread_count,last_message_at,
        service_key,department_code,branch_code,assigned_to,call_center_assigned_to,provider,page_id,classification_state,last_customer_message_at,metadata
      ) values(
        ${identity.conversationExternalId},${openRequest?.lead_id || null}::uuid,${contact.id}::uuid,${openRequest?.id || null}::uuid,${source},${identity.displayName},${identity.participant || identity.externalId},'open',
        ${text || null},${direction === "in" ? 1 : 0},${occurredAt}::timestamptz,${openRequest?.service_key || null},${openRequest?.department_code || null},${openRequest?.branch_code || null},
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
        unread_count=unread_count+${direction === "in" ? 1 : 0},
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
    [existingMessage] = await sql<any[]>`
      update crm.messages set
        body=case
          when nullif(${text},'') is not null and (body is null or body='' or body=any(array['صورة','رسالة صوتية','فيديو','ملف','ملصق','مرفق'])) then ${text}
          else body
        end,
        message_type=case when ${media.hasAttachment}::boolean then ${messageType} else message_type end,
        attachment_url=case
          when nullif(${media.storageKey ? "" : media.url},'') is not null then ${media.storageKey ? "" : media.url}
          when coalesce(attachment_url,'')~*'lookaside\.fbsbx\.com/whatsapp_business/attachments' then null
          else attachment_url
        end,
        attachment_type=coalesce(nullif(${media.type},''),attachment_type),
        file_name=coalesce(nullif(${media.fileName},''),file_name),
        mime_type=coalesce(nullif(${media.mimeType},''),mime_type),
        file_size=coalesce(${media.fileSize},file_size),
        storage_key=coalesce(nullif(${media.storageKey},''),storage_key),
        media_status=case when ${media.hasAttachment}::boolean then 'ready' else media_status end,
        caption=coalesce(nullif(${media.caption},''),caption),
        provider_status=case when direction='in' then 'received' else provider_status end,
        metadata=coalesce(metadata,'{}'::jsonb)||${sql.json(messageMetadata)}::jsonb,
        created_at=least(created_at,${occurredAt}::timestamptz)
      where id=${existingMessage.id}::uuid
      returning *,id::text,conversation_id::text
    `;
    if (media.storageKey) {
      await sql`
        insert into crm.media_assets(conversation_id,message_id,storage_key,original_name,media_type,mime_type,file_size,is_sensitive,status,metadata)
        values(${conversation.id}::uuid,${existingMessage.id}::uuid,${media.storageKey},${media.fileName || null},${media.type || 'document'},${media.mimeType || null},${media.fileSize},${media.isSensitive},'ready',${sql.json({ source, eventId })})
        on conflict(storage_key) do update set
          conversation_id=excluded.conversation_id,message_id=excluded.message_id,original_name=coalesce(excluded.original_name,crm.media_assets.original_name),
          media_type=excluded.media_type,mime_type=coalesce(excluded.mime_type,crm.media_assets.mime_type),file_size=coalesce(excluded.file_size,crm.media_assets.file_size),
          is_sensitive=excluded.is_sensitive,status='ready',updated_at=now()
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
      ${conversation.id}::uuid,${providerMessageId},${direction},${messageType},${text || null},
      ${media.storageKey ? null : media.url || null},${media.type || null},${media.fileName || null},${media.mimeType || null},${media.fileSize},${media.storageKey || null},${media.hasAttachment ? 'ready' : null},${media.isSensitive},
      ${direction === "in" ? 'received' : 'sent'},${providerMessageId},${senderType},${media.caption || null},${occurredAt}::timestamptz,${sql.json(messageMetadata)}
    )
    on conflict (conversation_id,provider_message_id) where provider_message_id is not null do update set
      body=coalesce(nullif(excluded.body,''),crm.messages.body),
      message_type=coalesce(nullif(excluded.message_type,''),crm.messages.message_type),
      attachment_url=coalesce(nullif(excluded.attachment_url,''),crm.messages.attachment_url),
      attachment_type=coalesce(nullif(excluded.attachment_type,''),crm.messages.attachment_type),
      file_name=coalesce(nullif(excluded.file_name,''),crm.messages.file_name),
      mime_type=coalesce(nullif(excluded.mime_type,''),crm.messages.mime_type),
      file_size=coalesce(excluded.file_size,crm.messages.file_size),
      storage_key=coalesce(nullif(excluded.storage_key,''),crm.messages.storage_key),
      media_status=coalesce(nullif(excluded.media_status,''),crm.messages.media_status),
      caption=coalesce(nullif(excluded.caption,''),crm.messages.caption),
      metadata=coalesce(crm.messages.metadata,'{}'::jsonb)||excluded.metadata,
      created_at=least(crm.messages.created_at,excluded.created_at)
    returning *,id::text,conversation_id::text
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

  if (conversation.lead_id && direction === "in") {
    await markCrmLeadUnread(sql, { leadId: conversation.lead_id, conversationId: conversation.id, createdAt: occurredAt, messageId: providerMessageId, messageKey: providerMessageId, messagePath: "" });
  }

  const automation = await publishAutomationEvent({
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

  await sql`update integrations.inbound_events set status='processed',processed_at=now(),error_message=null where source=${routeSource} and event_key=${eventId}`;
  return { lead: conversation.lead_id ? { id: conversation.lead_id } : null, conversation, message, createLead: createdByKnownSource, contact, automation };
}
