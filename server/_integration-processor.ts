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

function isoTimestamp(value: unknown) {
  if (!value) return "";
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? clean(value) : parsed.toISOString();
}

function inboundMessageFingerprint(input: {
  source: string;
  rawProviderMessageId: string;
  occurredAt: unknown;
  direction: string;
  body: unknown;
  messageType: unknown;
  attachmentType: unknown;
  fileName: unknown;
  storageKey: unknown;
}) {
  const canonical = JSON.stringify({
    source: clean(input.source).toLowerCase(),
    rawProviderMessageId: clean(input.rawProviderMessageId),
    occurredAt: isoTimestamp(input.occurredAt),
    direction: clean(input.direction).toLowerCase(),
    body: clean(input.body),
    messageType: clean(input.messageType).toLowerCase(),
    attachmentType: clean(input.attachmentType).toLowerCase(),
    fileName: clean(input.fileName),
    storageKey: clean(input.storageKey),
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
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

function listValues(value: unknown) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).map(clean).filter(Boolean);
  const text = clean(value);
  return text ? [text] : [];
}

function identityData(source: string, payload: any) {
  const wa = nestedWhatsapp(payload);
  const msg = wa?.messages?.[0] || {};
  const contact = wa?.contacts?.[0] || {};
  const pageId = first(payload.pageId, payload.page_id);
  const requestedConversationId = first(payload.conversationId, payload.conversation_id, payload.convId);
  const parsedParticipant = source === "facebook" && requestedConversationId.startsWith("facebook:")
    ? requestedConversationId.split(":").slice(2).join(":")
    : "";
  const facebookPsid = first(
    payload.facebookPsid, payload.facebook_psid, payload.fbPsid, payload.fb_psid,
    payload.metaSenderId, payload.meta_sender_id, payload.fbId, payload.fb_id,
  );
  const participant = first(
    facebookPsid,
    payload.participantId, payload.participant_id,
    payload.user_id, payload.userId, payload.igId, payload.tiktokId,
    parsedParticipant,
    payload.subscriber_id, payload.subscriberId, payload.contact_id, payload.contactId,
    payload.manychatContactId, payload.manychat_contact_id,
    payload.waId, msg?.from, contact?.wa_id,
  );
  const aliases = [...new Set([
    participant,
    facebookPsid,
    parsedParticipant,
    payload.participantId, payload.participant_id,
    payload.subscriber_id, payload.subscriberId,
    payload.contact_id, payload.contactId,
    payload.manychatContactId, payload.manychat_contact_id,
    payload.user_id, payload.userId,
    payload.fbId, payload.fb_id,
    payload.fbPsid, payload.fb_psid,
    payload.metaSenderId, payload.meta_sender_id,
    ...listValues(payload.identityAliases),
    ...listValues(payload.identity_aliases),
    msg?.from, contact?.wa_id,
  ].map(clean).filter(Boolean))];
  const externalId = participant || first(payload.externalCustomerId, payload.external_customer_id, requestedConversationId) || crypto.randomUUID();
  const conversationExternalId = requestedConversationId || (source === "whatsapp" ? externalId : `${source}:${pageId || "default"}:${externalId}`);
  const phone = first(payload.phone, payload.mobile, payload.phoneNumber, payload.phone_number, payload.clientNumber, payload.leadPhone, payload.lead_phone, msg?.from, contact?.wa_id);
  const displayName = first(payload.leadName, payload.lead_name, payload.customerName, payload.customer_name, payload.displayName, payload.display_name, payload.full_name, payload.fullName, payload.name, contact?.profile?.name, "عميل");
  return { participant, pageId, externalId, conversationExternalId, phone, phoneNormalized: normalizePhone(phone), displayName, aliases, facebookPsid };
}

function capturedLeadData(payload: any, identity: ReturnType<typeof identityData>) {
  const name = first(payload.leadName, payload.lead_name, payload.customerName, payload.customer_name, payload.fullName, payload.full_name, payload.name, identity.displayName);
  const car = first(payload.leadCar, payload.lead_car, payload.car, payload.carName, payload.car_name, payload.vehicle);
  const phone = first(payload.leadPhone, payload.lead_phone, payload.phone, payload.mobile, payload.phoneNumber, payload.phone_number, identity.phone);
  return { name, car, phone, phoneNormalized: normalizePhone(phone) };
}

async function syncCapturedLeadData(sql: any, contactId: string, payload: any, identity: ReturnType<typeof identityData>) {
  const captured = capturedLeadData(payload, identity);
  const meaningfulName = ["عميل", "facebook user"].includes(clean(captured.name).toLowerCase()) ? "" : clean(captured.name);
  if (!meaningfulName && !captured.car && !captured.phoneNormalized) return null;
  const [lead] = await sql<any[]>`
    update crm.leads set
      customer_name=coalesce(nullif(${meaningfulName},''),customer_name),
      phone=coalesce(nullif(${captured.phone},''),phone),
      phone_normalized=coalesce(nullif(${captured.phoneNormalized},''),phone_normalized),
      car_name=coalesce(nullif(${captured.car},''),car_name),
      car_type=coalesce(nullif(${captured.car},''),car_type),
      updated_at=now()
    where contact_id=${contactId}::uuid and is_deleted=false
    returning *,id::text,contact_id::text,current_request_id::text
  `;
  return lead || null;
}

function trustedKnownService(routeSource: string, payload: any) {
  if (["installment-calculator", "tiktok-snapchat"].includes(routeSource)) return "finance";
  if (!bool(payload.trustedServiceClassification || payload.trusted_service_classification)) return "";

  const declaredService = first(
    payload.serviceSelectionKey,
    payload.service_selection_key,
    payload.serviceKey,
    payload.service_key,
    payload.serviceSelectionLabel,
    payload.service_selection_label,
  );
  return declaredService ? departmentKey(declaredService) : "";
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
  const rawProviderMessageId = first(
    payload.providerOriginalMessageId, payload.provider_original_message_id,
    payload.providerMessageId, payload.provider_message_id,
    payload.messageId, payload.message_id, payload.mid, whatsappMessage(payload)?.id, eventId,
  );
  let providerMessageId = first(payload.providerMessageId, payload.provider_message_id, payload.messageId, payload.message_id, payload.mid, whatsappMessage(payload)?.id, eventId);
  const occurredAt = dateValue(payload);
  const inboundFingerprint = inboundMessageFingerprint({
    source,
    rawProviderMessageId,
    occurredAt,
    direction,
    body: text,
    messageType: media.hasAttachment ? media.type : first(payload.messageType, payload.message_type, "text"),
    attachmentType: media.type,
    fileName: media.fileName,
    storageKey: media.storageKey,
  });

  const { contact } = await ensureContactIdentity({
    channelCode: source,
    externalId: identity.externalId,
    participantId: identity.participant,
    pageId: identity.pageId,
    phone: identity.phone,
    displayName: identity.displayName,
    aliases: identity.aliases,
    metadata: { routeSource, lastEventId: eventId, identityAliases: identity.aliases, facebookPsid: identity.facebookPsid || null },
  });
  let openRequest = await findOpenServiceRequest(contact.id);
  let matchedLead: any = await syncCapturedLeadData(sql, contact.id, payload, identity);

  // Mersal currently sends the WhatsApp phone number in conversationId. That value
  // identifies the provider contact, not necessarily the PostgreSQL conversation UUID.
  // Resolve the CRM lead and its existing conversation first so inbound replies stay in
  // the same dashboard chat. The provider conversationId remains a final fallback only.
  if (source === "whatsapp" && identity.phoneNormalized) {
    [matchedLead] = await sql<any[]>`
      select l.*,l.id::text,l.contact_id::text,l.current_request_id::text
      from crm.leads l
      where l.is_deleted=false
        and right(regexp_replace(coalesce(l.phone_normalized,l.phone,''),'\\D','','g'),9)=right(${identity.phoneNormalized},9)
      order by
        (l.current_request_id is not null) desc,
        exists(
          select 1 from crm.conversations c
          where c.lead_id=l.id and c.channel_code in ('whatsapp','mersal')
        ) desc,
        l.updated_at desc,
        l.created_at desc
      limit 1
    `;

    if (matchedLead && (!openRequest || openRequest.lead_id !== matchedLead.id)) {
      const [leadRequest] = await sql<any[]>`
        select r.*,r.id::text,r.contact_id::text,r.lead_id::text,r.conversation_id::text,
          r.assigned_to::text,r.call_center_assigned_to::text,
          sales.full_name as assigned_name,cc.full_name as call_center_name
        from crm.service_requests r
        left join core.users sales on sales.id=r.assigned_to
        left join core.users cc on cc.id=r.call_center_assigned_to
        where r.lead_id=${matchedLead.id}::uuid and r.request_state='open'
        order by r.opened_at desc limit 1
      `;
      openRequest = leadRequest || null;
    }
  }

  let conversation: any = null;

  if (source === "whatsapp" && openRequest?.conversation_id) {
    [conversation] = await sql<any[]>`
      select *,id::text,lead_id::text,contact_id::text,service_request_id::text
      from crm.conversations
      where id=${openRequest.conversation_id}::uuid and channel_code in ('whatsapp','mersal')
      limit 1
    `;
  }

  if (!conversation && source === "whatsapp" && (matchedLead?.id || openRequest?.lead_id)) {
    const resolvedLeadId = matchedLead?.id || openRequest?.lead_id;
    [conversation] = await sql<any[]>`
      select *,id::text,lead_id::text,contact_id::text,service_request_id::text
      from crm.conversations
      where lead_id=${resolvedLeadId}::uuid and channel_code in ('whatsapp','mersal')
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

  if (!conversation && source !== "whatsapp") {
    [conversation] = await sql<any[]>`
      select *,id::text,lead_id::text,contact_id::text,service_request_id::text
      from crm.conversations
      where contact_id=${contact.id}::uuid and channel_code=${source}
        and (${identity.pageId || null}::text is null or page_id is null or page_id=${identity.pageId || null})
      order by
        (service_request_id is not null) desc,
        (lead_id is not null) desc,
        (legacy_id=${identity.conversationExternalId}) desc,
        last_message_at desc nulls last,updated_at desc
      limit 1
    `;
  }

  if (!conversation) {
    [conversation] = await sql<any[]>`
      select *,id::text,lead_id::text,contact_id::text,service_request_id::text
      from crm.conversations where legacy_id=${identity.conversationExternalId} limit 1
    `;
  }

  let existingMessage: any = null;
  if (conversation) {
    [existingMessage] = await sql<any[]>`
      select *,id::text,conversation_id::text from crm.messages
      where conversation_id=${conversation.id}::uuid
        and (provider_message_id=${providerMessageId} or coalesce(metadata->>'inboundFingerprint','')=${inboundFingerprint})
      limit 1
    `;

    if (existingMessage) {
      const existingFingerprint = clean(existingMessage.metadata?.inboundFingerprint) || inboundMessageFingerprint({
        source: existingMessage.metadata?.source || source,
        rawProviderMessageId: existingMessage.metadata?.rawProviderMessageId || existingMessage.provider_message_id || rawProviderMessageId,
        occurredAt: existingMessage.created_at,
        direction: existingMessage.direction,
        body: existingMessage.body,
        messageType: existingMessage.message_type,
        attachmentType: existingMessage.attachment_type,
        fileName: existingMessage.file_name,
        storageKey: existingMessage.storage_key,
      });

      if (existingFingerprint !== inboundFingerprint) {
        providerMessageId = `${providerMessageId}:${inboundFingerprint.slice(0, 16)}`;
        [existingMessage] = await sql<any[]>`
          select *,id::text,conversation_id::text from crm.messages
          where conversation_id=${conversation.id}::uuid
            and (provider_message_id=${providerMessageId} or coalesce(metadata->>'inboundFingerprint','')=${inboundFingerprint})
          limit 1
        `;
      }
    }
  }

  if (!conversation) {
    [conversation] = await sql<any[]>`
      insert into crm.conversations(
        legacy_id,lead_id,contact_id,service_request_id,channel_code,customer_name,participant_id,status,preview_text,unread_count,last_message_at,
        service_key,department_code,branch_code,assigned_to,call_center_assigned_to,provider,page_id,classification_state,last_customer_message_at,metadata
      ) values(
        ${identity.conversationExternalId},${openRequest?.lead_id || matchedLead?.id || null}::uuid,${contact.id}::uuid,${openRequest?.id || null}::uuid,${source},${identity.displayName},${identity.participant || identity.externalId},'open',
        ${text || null},0,${occurredAt}::timestamptz,${openRequest?.service_key || null},${openRequest?.department_code || null},${openRequest?.branch_code || null},
        ${openRequest?.assigned_to || null}::uuid,${openRequest?.call_center_assigned_to || null}::uuid,${first(payload.provider, routeSource)},${identity.pageId || null},
        ${openRequest ? 'classified' : 'new'},${direction === "in" ? occurredAt : null}::timestamptz,${sql.json({ routeSource, lastEventId: eventId, providerConversationId: identity.conversationExternalId, identityAliases: identity.aliases, facebookPsid: identity.facebookPsid || null })}
      ) returning *,id::text,lead_id::text,contact_id::text,service_request_id::text
    `;
  } else if (!existingMessage) {
    [conversation] = await sql<any[]>`
      update crm.conversations set
        contact_id=${contact.id}::uuid,
        lead_id=coalesce(${openRequest?.lead_id || matchedLead?.id || null}::uuid,lead_id),
        service_request_id=coalesce(${openRequest?.id || null}::uuid,service_request_id),
        customer_name=coalesce(nullif(${identity.displayName},''),customer_name),
        participant_id=case
          when lower(coalesce(${first(payload.provider, payload.providerName, payload.provider_name, routeSource)},'')) in ('meta','facebook_graph') then coalesce(nullif(${identity.participant || identity.externalId},''),participant_id)
          else coalesce(nullif(participant_id,''),nullif(${identity.participant || identity.externalId},''))
        end,
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
        metadata=coalesce(metadata,'{}'::jsonb)||${sql.json({ routeSource, lastEventId: eventId, providerConversationId: identity.conversationExternalId, identityAliases: identity.aliases, facebookPsid: identity.facebookPsid || null })}::jsonb,
        updated_at=now()
      where id=${conversation.id}::uuid
      returning *,id::text,lead_id::text,contact_id::text,service_request_id::text
    `;
  }

  if (existingMessage) {
    if (direction === "in") {
      [existingMessage] = await sql<any[]>`
        update crm.messages
        set direction='in',provider_status='received',sender_type='customer',
            metadata=coalesce(metadata,'{}'::jsonb)||${sql.json({ inboundFingerprint, rawProviderMessageId })}::jsonb
        where id=${existingMessage.id}::uuid
        returning *,id::text,conversation_id::text
      `;
    }
    await sql`update integrations.inbound_events set status='processed',processed_at=now(),error_message=null where source=${routeSource} and event_key=${eventId}`;
    const resolvedLeadId = conversation.lead_id || matchedLead?.id || openRequest?.lead_id || null;
    return { lead: resolvedLeadId ? { id: resolvedLeadId } : null, conversation, message: existingMessage, createLead: false, contact, automation: null };
  }

  let [message] = await sql<any[]>`
    insert into crm.messages(
      conversation_id,legacy_id,direction,message_type,body,attachment_url,attachment_type,file_name,mime_type,file_size,storage_key,media_status,is_sensitive,
      provider_status,provider_message_id,sender_type,caption,created_at,metadata
    ) values(
      ${conversation.id}::uuid,${providerMessageId},${direction},${media.hasAttachment ? media.type : first(payload.messageType, payload.message_type, "text")},${text || null},
      ${media.storageKey ? null : media.url || null},${media.type || null},${media.fileName || null},${media.mimeType || null},${media.fileSize},${media.storageKey || null},${media.hasAttachment ? 'ready' : null},${media.isSensitive},
      ${direction === "in" ? 'received' : 'sent'},${providerMessageId},${senderType},${media.caption || null},${occurredAt}::timestamptz,${sql.json({ source, routeSource, eventId, mediaId: media.mediaId || null, inboundFingerprint, rawProviderMessageId })}
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
  const explicitServiceSelection = bool(payload.forceServiceReclassification) ||
    bool(payload.force_service_reclassification) ||
    [payload.flowAction, payload.flow_action].some((value) => clean(value).toLowerCase() === "service_selection");
  let createdByKnownSource = false;
  if (knownService && (!openRequest || explicitServiceSelection)) {
    const classified = await classifyConversationService({
      conversationId: conversation.id,
      serviceKey: knownService,
      sourceCode: source,
      classificationMethod: explicitServiceSelection ? "customer_service_selection" : "source_mapping",
      eventKey: eventId,
    });
    openRequest = classified.request;
    createdByKnownSource = classified.reused !== true;
    [conversation] = await sql<any[]>`select *,id::text,lead_id::text,contact_id::text,service_request_id::text from crm.conversations where id=${conversation.id}::uuid`;
    matchedLead = await syncCapturedLeadData(sql, contact.id, payload, identity) || matchedLead;
  }

  if (direction === "in") {
    const unreadLeadId = conversation.lead_id || matchedLead?.id || openRequest?.lead_id || null;
    if (unreadLeadId) {
      await markCrmLeadUnread(sql, {
        leadId: unreadLeadId,
        conversationId: conversation.id,
        createdAt: occurredAt,
        messageId: providerMessageId,
        messageKey: inboundFingerprint,
        messagePath: "",
      });
    } else {
      await sql`
        update crm.conversations set
          unread_count=case when coalesce(metadata->>'lastUnreadMessageKey','')=${inboundFingerprint} then greatest(1,unread_count) else unread_count+1 end,
          metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{lastUnreadMessageKey}',to_jsonb(${inboundFingerprint}::text),true),
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
    lead: (conversation.lead_id || matchedLead?.id || openRequest?.lead_id) ? { id: conversation.lead_id || matchedLead?.id || openRequest?.lead_id } : null,
    conversation,
    message,
    createLead: createdByKnownSource,
    contact,
    automation,
    automationError: automationError || null,
  };
}
