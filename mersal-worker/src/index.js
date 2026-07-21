/*
 * MZJ CRM WhatsApp / Mersal Worker
 * Clean transport for MZJ Unified Platform (PostgreSQL).
 *
 * Routes:
 *   GET  /                 health
 *   GET  /debug/last       last inbound payload/forward result when DEBUG_KV is bound
 *   POST /send/mersal      send free text, approved template, or media through Mersal
 *   POST /webhook/mersal   receive WhatsApp replies and forward them to PostgreSQL API
 *   POST /templates/mersal synchronize approved Mersal templates
 *
 * Required Worker variables/secrets:
 *   MZJ_GATEWAY_SECRET
 *   PLATFORM_INBOUND_URL   example: https://mzj-platform.vercel.app/api/integrations/whatsapp
 *   MERSAL_TOKEN
 *   MERSAL_API_TOKEN       required only for resolving protected inbound media
 *
 * Optional exact endpoint overrides:
 *   MERSAL_API_ENDPOINT
 *   MERSAL_SEND_URL
 *   MERSAL_TEMPLATE_URL
 *   MERSAL_MEDIA_SEND_URL
 *   MERSAL_ATTACHMENT_SEND_URL
 *
 * Optional binding:
 *   DEBUG_KV
 *
 * This Worker contains no Firebase/Firestore storage. CRM messages, conversations,
 * unread state, assignments, service changes, finance-data collection, and automations
 * are owned by PostgreSQL in the platform. Mersal keeps the visible welcome flow; this
 * Worker identifies the customer selection and forwards a trusted flow instruction.
 */

const VERSION = "mzj-mersal-postgres-v1.12.4-attachment-formdata";
const DEFAULT_MERSAL_BASE = "https://w-mersal.com";
const DEFAULT_PLATFORM_INBOUND_URL = "https://mzj-platform.vercel.app/api/integrations/whatsapp";
const FAILURE_STATUSES = new Set(["error", "failed", "failure", "rejected", "invalid"]);
const SUCCESS_STATUSES = new Set(["ok", "success", "sent", "queued", "accepted", "submitted", "delivered", "processing"]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response("", { status: 204, headers: corsHeaders() });
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return json({ ok: true, service: "mersal-crm", version: VERSION }, 200);
    }

    if (request.method === "GET" && url.pathname === "/debug/last") {
      return json({
        ok: true,
        version: VERSION,
        inbound: await kvGetJson(env, "DEBUG_LAST_PAYLOAD"),
        forward: await kvGetJson(env, "DEBUG_LAST_FORWARD"),
      }, 200);
    }

    if (request.method === "POST" && url.pathname === "/send/mersal") {
      if (!gatewayAuthorized(request, env)) {
        return json({ ok: false, status: "failed", error: "Unauthorized gateway request", version: VERSION }, 401);
      }
      return handleSendMersal(await safeJson(request), env);
    }

    if (request.method === "POST" && url.pathname === "/templates/mersal") {
      if (!gatewayAuthorized(request, env)) {
        return json({ ok: false, error: "Unauthorized gateway request", version: VERSION }, 401);
      }
      return handleTemplateSync(env);
    }

    if (request.method === "POST" && url.pathname === "/webhook/mersal") {
      const incoming = await safeJson(request);
      if (ctx?.waitUntil) ctx.waitUntil(kvPutJson(env, "DEBUG_LAST_PAYLOAD", incoming));

      try {
        const result = await processInboundWebhook(incoming, env);
        if (ctx?.waitUntil) ctx.waitUntil(kvPutJson(env, "DEBUG_LAST_FORWARD", result));
        return json({ ok: true, accepted: true, ...result, version: VERSION }, 200);
      } catch (error) {
        const message = errorMessage(error);
        console.error("Mersal inbound processing failed", message);
        if (ctx?.waitUntil) ctx.waitUntil(kvPutJson(env, "DEBUG_LAST_FORWARD", { ok: false, error: message }));
        // Do not acknowledge a reply that PostgreSQL did not accept. Returning 502 lets
        // the provider retry the same webhook instead of silently losing the message.
        return json({ ok: false, status: "failed", error: message, version: VERSION }, 502);
      }
    }

    return json({ ok: false, error: "Not found", version: VERSION }, 404);
  },
};

async function handleTemplateSync(env) {
  const token = clean(env?.MERSAL_TOKEN);
  if (!token) return json({ ok: false, error: "Missing MERSAL_TOKEN", version: VERSION }, 503);
  const url = clean(env?.MERSAL_TEMPLATES_URL) || `${mersalBase(env)}/api/wpbox/getTemplates?token=${encodeURIComponent(token)}`;
  try {
    const response = await fetch(url, { method: "GET", headers: { accept: "application/json" } });
    const rawText = await response.text();
    const raw = parseJson(rawText);
    if (!response.ok) return json({ ok: false, error: first(raw?.error, raw?.message, rawText, `HTTP ${response.status}`), raw, version: VERSION }, 502);
    const templates = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.data)
        ? raw.data
        : Array.isArray(raw?.templates)
          ? raw.templates
          : Array.isArray(raw?.data?.templates)
            ? raw.data.templates
            : [];
    return json({ ok: true, source: "mersal", templates, received: templates.length, raw, version: VERSION }, 200);
  } catch (error) {
    return json({ ok: false, error: errorMessage(error), version: VERSION }, 502);
  }
}

async function handleSendMersal(body, env) {
  const phone = normalizePhone(body?.phone || body?.waId || body?.wa_id);
  if (!phone) return json({ ok: false, status: "failed", error: "missing or invalid phone/waId", version: VERSION }, 400);

  const type = outboundType(body);
  if (!type) return json({ ok: false, status: "failed", error: "missing text, template, or media", version: VERSION }, 400);

  let result;
  if (type === "template") {
    result = await sendMersalTemplate(env, {
      phone,
      templateName: clean(body?.template_name || body?.templateName || body?.template?.name),
      language: clean(body?.template_language || body?.templateLanguage || body?.templateLang || body?.template?.language || "ar") || "ar",
      components: templateComponents(body),
    });
  } else if (type === "media") {
    result = await sendMersalMedia(env, {
      phone,
      mediaUrl: clean(body?.media_url || body?.mediaUrl || body?.file_url || body?.fileUrl || body?.attachment_url || body?.attachmentUrl),
      mediaType: normalizeMediaType(body?.media_type || body?.mediaType || body?.attachment_type || body?.attachmentType || "document"),
      fileName: clean(body?.file_name || body?.fileName),
      caption: clean(body?.caption || body?.text || body?.message),
    });
  } else {
    result = await sendMersalText(env, {
      phone,
      message: clean(body?.message || body?.text),
      buttons: body?.buttons,
      header: body?.header,
      footer: body?.footer,
    });
  }

  return json({
    ...result,
    provider: "mersal",
    message_type: type,
    phone,
    version: VERSION,
  }, result.ok ? 200 : 502);
}

function outboundType(body) {
  const requested = clean(body?.type).toLowerCase();
  const templateName = clean(body?.template_name || body?.templateName || body?.template?.name);
  const mediaUrl = clean(body?.media_url || body?.mediaUrl || body?.file_url || body?.fileUrl || body?.attachment_url || body?.attachmentUrl);
  const text = clean(body?.message || body?.text);

  if (requested === "template" || templateName) return templateName ? "template" : "";
  if (requested === "media" || mediaUrl) return mediaUrl ? "media" : "";
  if (requested === "text" || text) return text ? "text" : "";
  return "";
}

async function sendMersalText(env, input) {
  const token = clean(env?.MERSAL_TOKEN);
  if (!token) return failedProviderResult("Missing MERSAL_TOKEN");
  if (!clean(input.message)) return failedProviderResult("missing text/message");

  const payload = {
    token,
    phone: normalizePhone(input.phone),
    message: clean(input.message),
  };
  if (Array.isArray(input.buttons) && input.buttons.length) {
    payload.buttons = input.buttons;
    if (clean(input.header)) payload.header = clean(input.header);
    if (clean(input.footer)) payload.footer = clean(input.footer);
  }

  return postMersalProvider(exactEndpoint(env, "text"), payload);
}

async function sendMersalTemplate(env, input) {
  const token = clean(env?.MERSAL_TOKEN);
  if (!token) return failedProviderResult("Missing MERSAL_TOKEN");
  if (!clean(input.templateName)) return failedProviderResult("missing template_name");

  const payload = {
    token,
    phone: normalizePhone(input.phone),
    template_name: clean(input.templateName),
    template_language: clean(input.language) || "ar",
  };
  if (Array.isArray(input.components) && input.components.length) payload.components = input.components;

  return postMersalProvider(exactEndpoint(env, "template"), payload);
}

async function sendMersalMedia(env, input) {
  const token = clean(env?.MERSAL_TOKEN);
  if (!token) return failedProviderResult("Missing MERSAL_TOKEN");
  const mediaUrl = clean(input.mediaUrl);
  const phone = normalizePhone(input.phone);
  if (!mediaUrl) return failedProviderResult("missing media_url");
  if (!phone) return failedProviderResult("missing or invalid phone");

  try {
    const mediaResponse = await fetch(mediaUrl, { method: "GET", headers: { accept: "*/*" } });
    if (!mediaResponse.ok) return failedProviderResult(`Unable to download attachment: HTTP ${mediaResponse.status}`);
    const mediaType = normalizeMediaType(input.mediaType);
    const mimeType = clean(mediaResponse.headers.get("content-type")) || guessMimeType(mediaUrl, mediaType);
    const fileName = ensureMediaFileName(
      first(input.fileName, contentDispositionFileName(mediaResponse.headers.get("content-disposition")), fileNameFromUrl(mediaUrl)),
      mediaType,
      mimeType,
      `out-${Date.now()}`,
    );
    const bytes = await mediaResponse.arrayBuffer();
    const form = new FormData();
    form.set("token", token);
    form.set("phone", phone);
    form.set("message", clean(input.caption) || fileName || "مرفق");
    form.set("media_url", mediaUrl);
    form.set("type", mediaType);
    form.set("image", new Blob([bytes], { type: mimeType || "application/octet-stream" }), fileName);

    return postMersalMultipartProvider(exactEndpoint(env, "attachment"), form);
  } catch (error) {
    return failedProviderResult(errorMessage(error));
  }
}

function exactEndpoint(env, type) {
  const base = clean(env?.MERSAL_API_ENDPOINT || DEFAULT_MERSAL_BASE).replace(/\/+$/, "");
  if (type === "template") return clean(env?.MERSAL_TEMPLATE_URL) || `${base}/api/wpbox/sendtemplatemessage`;
  if (type === "attachment") return clean(env?.MERSAL_ATTACHMENT_SEND_URL || env?.MERSAL_MEDIA_SEND_URL || env?.MERSAL_SEND_URL) || `${base}/api/wpbox/sendmessage`;
  if (type === "media") return clean(env?.MERSAL_MEDIA_SEND_URL) || `${base}/api/wpbox/sendmedia`;
  return clean(env?.MERSAL_SEND_URL) || `${base}/api/wpbox/sendmessage`;
}

async function postMersalMultipartProvider(url, form) {
  try {
    const response = await fetch(url, { method: "POST", headers: { accept: "application/json" }, body: form });
    const rawText = await response.text();
    const raw = parseJson(rawText);
    return normalizeProviderResponse(response.status, response.ok, raw, rawText);
  } catch (error) {
    return failedProviderResult(errorMessage(error));
  }
}

async function postMersalProvider(url, payload) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const rawText = await response.text();
    const raw = parseJson(rawText);
    return normalizeProviderResponse(response.status, response.ok, raw, rawText);
  } catch (error) {
    return failedProviderResult(errorMessage(error));
  }
}

function normalizeProviderResponse(httpStatus, httpOk, raw, rawText) {
  const providerMessageId = providerMessageIdFrom(raw);
  const statusValue = normalizeStatus(first(
    raw?.provider_status,
    raw?.providerStatus,
    raw?.status,
    raw?.data?.status,
    raw?.result?.status,
    raw?.response?.status,
  ));
  const explicitFailure = raw?.ok === false || raw?.success === false || FAILURE_STATUSES.has(statusValue);
  const explicitSuccess = raw?.ok === true || raw?.success === true || SUCCESS_STATUSES.has(statusValue);

  // A real WhatsApp/Mersal message id is definitive acceptance evidence. This is the
  // specific case that previously displayed "failed" even though the template arrived.
  const accepted = Boolean(providerMessageId) || explicitSuccess || (httpOk && !explicitFailure);
  const error = accepted ? "" : first(raw?.error, raw?.message, raw?.data?.message, rawText, `HTTP ${httpStatus}`);

  return {
    ok: accepted,
    status: accepted ? "sent" : "failed",
    provider_status: accepted ? "sent" : "failed",
    provider_message_id: providerMessageId || "",
    providerMessageId: providerMessageId || "",
    message_wamid: providerMessageId || "",
    http_status: httpStatus,
    httpStatus,
    error,
    raw,
  };
}

function failedProviderResult(message) {
  return {
    ok: false,
    status: "failed",
    provider_status: "failed",
    provider_message_id: "",
    providerMessageId: "",
    message_wamid: "",
    http_status: 0,
    httpStatus: 0,
    error: clean(message) || "Mersal request failed",
    raw: null,
  };
}

function providerMessageIdFrom(raw) {
  return first(
    raw?.provider_message_id,
    raw?.providerMessageId,
    raw?.message_wamid,
    raw?.messageWamid,
    raw?.wamid,
    raw?.message_id,
    raw?.data?.provider_message_id,
    raw?.data?.providerMessageId,
    raw?.data?.message_wamid,
    raw?.data?.messageWamid,
    raw?.data?.wamid,
    raw?.data?.message_id,
    raw?.result?.provider_message_id,
    raw?.result?.message_wamid,
    raw?.result?.wamid,
    raw?.result?.message_id,
    raw?.response?.provider_message_id,
    raw?.response?.message_wamid,
    raw?.response?.wamid,
    raw?.response?.message_id,
  );
}

function templateComponents(body) {
  if (Array.isArray(body?.components)) return body.components;
  if (Array.isArray(body?.template?.components)) return body.template.components;
  const params = Array.isArray(body?.params)
    ? body.params
    : Array.isArray(body?.parameters)
      ? body.parameters
      : Array.isArray(body?.template?.params)
        ? body.template.params
        : [];
  if (!params.length) return [];
  return [{ type: "body", parameters: params.map((value) => ({ type: "text", text: String(value ?? "") })) }];
}

async function processInboundWebhook(incoming, env) {
  const events = normalizeInboundEvents(incoming);
  if (!events.length) return { processed: 0, forwarded: [], note: "webhook received without an inbound message" };

  const forwarded = [];
  for (const event of events) {
    const platformPayload = await buildPlatformInboundPayload(event, env);
    const result = await forwardToPlatform(platformPayload, env);
    if (!result.ok) throw new Error(`PostgreSQL endpoint rejected ${event.eventId}: HTTP ${result.status} ${result.error}`);
    forwarded.push({
      eventId: event.eventId,
      phone: event.phone,
      status: result.status,
      conversationId: result.data?.result?.conversationId || null,
      messageId: result.data?.result?.messageId || null,
    });
  }

  return { processed: events.length, forwarded };
}

function normalizeInboundEvents(incoming) {
  const events = [];
  const entries = Array.isArray(incoming?.entry) ? incoming.entry : [];

  for (const entry of entries) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value || {};
      const contacts = Array.isArray(value?.contacts)
        ? value.contacts
        : value?.contacts && typeof value.contacts === "object"
          ? [value.contacts]
          : [];
      const messages = Array.isArray(value?.messages)
        ? value.messages
        : value?.messages && typeof value.messages === "object"
          ? [value.messages]
          : [];
      for (const message of messages) {
        const phone = normalizePhone(first(
          message?.from,
          message?.wa_id,
          message?.waId,
          contacts?.[0]?.wa_id,
          contacts?.[0]?.waId,
          contacts?.[0]?.user_id,
          contacts?.[0]?.userId,
        ));
        if (!phone) continue;
        const messageId = first(message?.id, message?.message_id, message?.fb_message_id) || stableEventId({ phone, message });
        events.push({
          eventId: messageId,
          phone,
          displayName: first(contacts?.[0]?.profile?.name, contacts?.[0]?.name, "عميل"),
          timestamp: message?.timestamp || Date.now(),
          message,
          envelope: {
            entry: [{
              ...entry,
              changes: [{ ...change, value: { ...value, contacts, messages: [message] } }],
            }],
          },
        });
      }
    }
  }

  if (!events.length) {
    const roots = [incoming, incoming?.data, incoming?.body, incoming?.payload, incoming?.event]
      .filter((value) => value && typeof value === "object");
    for (const root of roots) {
      const message = root?.message && typeof root.message === "object" ? root.message : root;
      const direction = normalizeStatus(first(message?.direction, root?.direction, "in"));
      const isContact = message?.is_message_by_contact ?? message?.isMessageByContact ?? root?.is_message_by_contact ?? root?.isMessageByContact;
      if (["out", "outbound", "sent"].includes(direction) || Number(isContact) === 0) continue;
      const phone = normalizePhone(first(message?.from, message?.wa_id, root?.waId, root?.wa_id, root?.phone, root?.from, root?.contact?.phone));
      if (!phone) continue;
      const text = inboundText(message) || first(root?.text, root?.body, root?.customer_message, root?.last_input_text);
      const attachment = inboundAttachment(message) || genericAttachment(root);
      if (!text && !attachment) continue;
      const messageId = first(message?.id, message?.message_id, message?.fb_message_id, root?.eventId, root?.event_id, root?.id) || stableEventId({ phone, message, text, attachment });
      events.push({
        eventId: messageId,
        phone,
        displayName: first(root?.customerName, root?.displayName, root?.name, root?.contact?.name, "عميل"),
        timestamp: message?.timestamp || root?.timestamp || root?.createdAt || Date.now(),
        message: { ...message, ...(text && !message?.text ? { text: { body: text } } : {}) },
        envelope: null,
        generic: root,
      });
      break;
    }
  }

  const unique = new Map();
  for (const event of events) if (!unique.has(event.eventId)) unique.set(event.eventId, event);
  return [...unique.values()];
}

async function buildPlatformInboundPayload(event, env) {
  const message = event.message || {};
  const text = inboundText(message) || first(event.generic?.text, event.generic?.body, event.generic?.customer_message, event.generic?.last_input_text);
  let attachment = inboundAttachment(message) || genericAttachment(event.generic || {});

  if (attachment?.hasAttachment) {
    const direct = normalizePublicMediaUrl(attachment.mediaUrl, mersalBase(env));
    attachment = { ...attachment, mediaUrl: direct, fileUrl: direct, attachmentUrl: direct };

    if (!direct || isProtectedWhatsappMediaUrl(direct)) {
      const resolved = await resolveInboundMedia(env, {
        phone: event.phone,
        providerMessageId: event.eventId,
        mediaId: attachment.mediaId,
        messageType: attachment.attachmentType,
        messageTimestamp: event.timestamp,
        fileName: normalizeMediaType(attachment.attachmentType) === "document" ? attachment.fileName : "",
        mimeType: normalizeMediaType(attachment.attachmentType) === "document" ? attachment.mimeType : "",
      });
      if (!resolved?.url) {
        throw new Error(`Inbound media could not be matched safely for ${event.eventId}: ${resolved?.error || "media URL not found"}`);
      }
      attachment = {
        ...attachment,
        mediaUrl: resolved.url,
        fileUrl: resolved.url,
        attachmentUrl: resolved.url,
        attachmentType: resolved.attachmentType || attachment.attachmentType,
        fileName: attachment.fileName || resolved.fileName,
        mimeType: attachment.mimeType || resolved.mimeType,
      };
    }

    const stored = await storeInboundMedia(env, {
      sourceUrl: attachment.mediaUrl,
      eventId: event.eventId,
      conversationId: event.phone,
      mediaType: attachment.attachmentType,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
    });
    attachment = {
      ...attachment,
      storageKey: stored.storageKey,
      mediaAssetId: stored.assetId,
      fileName: stored.fileName,
      mimeType: stored.mimeType,
      fileSize: stored.fileSize,
      mediaStatus: "ready",
      isSensitive: true,
    };
  }

  const messageText = text || attachment?.caption || (attachment?.hasAttachment ? attachmentLabel(attachment.attachmentType) : "");
  const serviceSelection = detectMersalServiceSelection(message, event.generic || {});
  const base = {
    eventId: event.eventId,
    event_id: event.eventId,
    type: "incoming_message",
    direction: "in",
    senderType: "customer",
    provider: "mersal",
    platform: "whatsapp",
    channel: "whatsapp",
    waId: event.phone,
    phone: event.phone,
    participantId: event.phone,
    conversationId: event.phone,
    customerName: event.displayName,
    messageId: event.eventId,
    providerMessageId: event.eventId,
    text: messageText,
    message: messageText,
    messageType: attachment?.hasAttachment ? attachment.attachmentType : normalizeMediaType(message?.type || "text"),
    timestamp: event.timestamp,
    hasAttachment: Boolean(attachment?.hasAttachment),
    attachmentType: attachment?.attachmentType || "",
    mediaType: attachment?.attachmentType || "",
    mediaUrl: attachment?.mediaUrl || "",
    fileUrl: attachment?.fileUrl || "",
    attachmentUrl: attachment?.attachmentUrl || "",
    fileName: attachment?.fileName || "",
    mimeType: attachment?.mimeType || "",
    fileSize: attachment?.fileSize || null,
    caption: attachment?.caption || "",
    mediaId: attachment?.mediaId || "",
    storageKey: attachment?.storageKey || "",
    storage_key: attachment?.storageKey || "",
    mediaAssetId: attachment?.mediaAssetId || "",
    media_asset_id: attachment?.mediaAssetId || "",
    mediaStatus: attachment?.mediaStatus || "",
    isSensitive: attachment?.isSensitive === true,
    providerEntryFlowHandled: true,
    provider_entry_flow_handled: true,
    entryFlowProvider: "mersal",
    entry_flow_provider: "mersal",
    flowAction: serviceSelection ? "service_selection" : "customer_input",
    flow_action: serviceSelection ? "service_selection" : "customer_input",
    serviceSelectionKey: serviceSelection?.key || "",
    service_selection_key: serviceSelection?.key || "",
    serviceSelectionLabel: serviceSelection?.label || "",
    service_selection_label: serviceSelection?.label || "",
    serviceSelectionId: serviceSelection?.id || "",
    service_selection_id: serviceSelection?.id || "",
    trustedServiceClassification: Boolean(serviceSelection),
    trusted_service_classification: Boolean(serviceSelection),
    forceServiceReclassification: Boolean(serviceSelection),
    force_service_reclassification: Boolean(serviceSelection),
    financeDetailsRequired: serviceSelection?.key === "finance",
    finance_details_required: serviceSelection?.key === "finance",
    entryFlowInputText: messageText,
    entry_flow_input_text: messageText,
  };

  return event.envelope ? { ...event.envelope, ...base } : base;
}

async function forwardToPlatform(payload, env) {
  const endpoint = clean(env?.PLATFORM_INBOUND_URL) || DEFAULT_PLATFORM_INBOUND_URL;
  const secret = clean(env?.MZJ_GATEWAY_SECRET);
  if (!endpoint) return { ok: false, status: 0, error: "Missing PLATFORM_INBOUND_URL" };
  if (!secret) return { ok: false, status: 0, error: "Missing MZJ_GATEWAY_SECRET" };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-mzj-gateway-secret": secret,
        "x-mzj-source": "whatsapp",
        "x-event-id": payload.eventId,
      },
      body: JSON.stringify(payload),
    });
    const rawText = await response.text();
    const data = parseJson(rawText);
    return {
      ok: response.ok && data?.ok !== false,
      status: response.status,
      data,
      error: response.ok ? "" : first(data?.error, rawText, `HTTP ${response.status}`),
    };
  } catch (error) {
    return { ok: false, status: 0, error: errorMessage(error) };
  }
}

function normalizedChoiceToken(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ـًٌٍَُِّْ]/g, "")
    .replace(/[_\-–—|/\\]+/g, " ")
    .replace(/[\s،,:؛.!?؟]+/g, " ")
    .trim();
}

function detectMersalServiceSelection(message, generic) {
  const idValue = first(
    message?.interactive?.button_reply?.id,
    message?.interactive?.list_reply?.id,
    message?.button?.payload,
    message?.button?.id,
    generic?.button_id,
    generic?.buttonId,
    generic?.reply_id,
    generic?.replyId,
    generic?.selected_option_id,
    generic?.selectedOptionId,
  );
  const labelValue = first(
    message?.interactive?.button_reply?.title,
    message?.interactive?.list_reply?.title,
    message?.button?.text,
    generic?.button_text,
    generic?.buttonText,
    generic?.selected_option,
    generic?.selectedOption,
    inboundText(message),
  );
  const candidates = [idValue, labelValue].map(normalizedChoiceToken).filter(Boolean);
  const definitions = [
    {
      key: "cash",
      label: "مبيعات الكاش",
      aliases: ["cash", "cash sales", "sales cash", "1", "مبيعات الكاش", "مبيعات كاش", "كاش"],
    },
    {
      key: "finance",
      label: "مبيعات التمويل",
      aliases: ["finance", "finance sales", "sales finance", "2", "مبيعات التمويل", "مبيعات تمويل", "تمويل"],
    },
    {
      key: "service",
      label: "خدمة العملاء",
      aliases: ["service", "customer service", "customer_service", "3", "خدمة العملاء", "خدمه العملاء"],
    },
  ];
  for (const definition of definitions) {
    const aliases = definition.aliases.map(normalizedChoiceToken);
    if (candidates.some((candidate) => aliases.includes(candidate))) {
      return { key: definition.key, label: definition.label, id: idValue || labelValue };
    }
  }
  return null;
}

function inboundText(message) {
  return first(
    message?.text?.body,
    message?.button?.text,
    message?.interactive?.button_reply?.title,
    message?.interactive?.list_reply?.title,
    message?.image?.caption,
    message?.video?.caption,
    message?.document?.caption,
    typeof message?.message === "string" ? message.message : "",
    message?.body,
  );
}

function inboundAttachment(message) {
  const type = normalizeMediaType(message?.type || "");
  if (!["image", "audio", "video", "document", "sticker"].includes(type)) return null;
  const media = message?.[message?.type] || message?.[type] || {};
  const direct = first(media?.url, media?.link, media?.href);
  return {
    hasAttachment: true,
    attachmentType: type,
    mediaId: first(media?.id),
    mediaUrl: direct,
    fileUrl: direct,
    attachmentUrl: direct,
    fileName: first(media?.filename, media?.fileName, media?.name),
    mimeType: first(media?.mime_type, media?.mimeType),
    caption: first(media?.caption),
  };
}

function genericAttachment(payload) {
  if (!payload || typeof payload !== "object") return null;
  const url = first(payload?.mediaUrl, payload?.media_url, payload?.attachmentUrl, payload?.attachment_url, payload?.fileUrl, payload?.file_url);
  const mediaId = first(payload?.mediaId, payload?.media_id);
  const type = normalizeMediaType(first(payload?.mediaType, payload?.media_type, payload?.attachmentType, payload?.attachment_type, payload?.messageType, payload?.message_type, "document"));
  if (!url && !mediaId) return null;
  return {
    hasAttachment: true,
    attachmentType: type,
    mediaId,
    mediaUrl: url,
    fileUrl: url,
    attachmentUrl: url,
    fileName: first(payload?.fileName, payload?.file_name),
    mimeType: first(payload?.mimeType, payload?.mime_type),
    caption: first(payload?.caption),
  };
}

async function resolveInboundMedia(env, input) {
  const token = clean(env?.MERSAL_API_TOKEN);
  if (!token) return { ok: false, error: "Missing MERSAL_API_TOKEN" };

  const contactId = await findMersalContactId(env, token, input.phone);
  if (!contactId) return { ok: false, error: "Mersal contact not found" };

  const targetType = normalizeMediaType(input.messageType);
  const targetMessageId = clean(input.providerMessageId);
  const targetMediaId = clean(input.mediaId);
  const supportedTypes = new Set(["image", "audio", "video", "document", "sticker"]);
  if (!supportedTypes.has(targetType)) {
    return { ok: false, error: `Unsupported inbound media type: ${targetType || "unknown"}` };
  }
  if (!targetMessageId && !targetMediaId) {
    return { ok: false, error: "Inbound media has no WhatsApp message id or media id" };
  }

  // Postman verification showed that Mersal can create the final media row around
  // 11-15 seconds after the WhatsApp webhook. Poll by elapsed time for up to 21
  // seconds, and accept only the row that belongs to this exact webhook message.
  const startedAt = Date.now();
  const pollAtMs = [0, 2000, 5000, 8000, 11000, 14000, 17000, 21000];
  let messagesChecked = 0;
  let exactRowDetected = false;

  for (const targetElapsedMs of pollAtMs) {
    const waitMs = targetElapsedMs - (Date.now() - startedAt);
    if (waitMs > 0) await sleep(waitMs);

    const messages = await mersalApiPost(`${mersalBase(env)}/api/wpbox/getMessages`, {
      token,
      contact_id: contactId,
    });
    const rows = normalizeMersalRows(messages);
    messagesChecked = rows.length;

    const matched = findExactInboundMersalMedia(rows, {
      contactId,
      mediaBase: mersalBase(env),
      targetType,
      targetMessageId,
      targetMediaId,
    });

    if (matched?.rowDetected) exactRowDetected = true;
    if (matched?.media?.url) {
      return {
        ok: true,
        ...matched.media,
        matchReason: matched.matchReason,
        waitedMs: Date.now() - startedAt,
      };
    }
  }

  return {
    ok: false,
    error: exactRowDetected
      ? "The exact Mersal message row was found, but its media URL was not ready"
      : "The exact Mersal message row was not found before the media wait timeout",
    contactId,
    messagesChecked,
    providerMessageId: targetMessageId,
    mediaId: targetMediaId,
    messageType: targetType,
    waitedMs: Date.now() - startedAt,
  };
}

function findExactInboundMersalMedia(rows, input) {
  const list = Array.isArray(rows) ? rows : [];
  const targetMessageId = clean(input.targetMessageId);
  const targetMediaId = clean(input.targetMediaId);
  const targetType = normalizeMediaType(input.targetType);

  if (targetMessageId) {
    const exactRows = list.filter((row) =>
      isInboundMersalRow(row) && mersalRowMessageId(row) === targetMessageId
    );

    for (const row of exactRows) {
      const media = mediaFromMersalRowForType(row, input.contactId, input.mediaBase, targetType);
      if (media?.url) {
        return {
          rowDetected: true,
          media,
          matchReason: "exact_fb_message_id",
        };
      }
    }

    if (exactRows.length) {
      return { rowDetected: true, media: null, matchReason: "exact_fb_message_id_waiting_for_url" };
    }
  }

  // Generic webhook formats may omit fb_message_id. In that case only an exact
  // WhatsApp media id match is allowed. No timestamp or newest-media fallback is used.
  if (!targetMessageId && targetMediaId) {
    for (const row of list) {
      if (!isInboundMersalRow(row)) continue;
      const media = mediaFromMersalRowForType(row, input.contactId, input.mediaBase, targetType);
      if (!media?.url) continue;
      const exactMediaId = mersalRowMediaIds(row).includes(targetMediaId) ||
        clean(media.url).includes(`/${targetMediaId}.`) ||
        clean(media.fileName).startsWith(`${targetMediaId}.`);
      if (exactMediaId) {
        return {
          rowDetected: true,
          media,
          matchReason: "exact_media_id",
        };
      }
    }
  }

  return { rowDetected: false, media: null, matchReason: "not_found" };
}

async function findMersalContactId(env, token, phone) {
  const payload = await mersalApiPost(`${mersalBase(env)}/api/wpbox/getConversations/none?mobile_api=true`, { token });
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.data?.data)
        ? payload.data.data
        : Array.isArray(payload?.conversations)
          ? payload.conversations
          : [];
  const normalized = normalizePhone(phone);
  const found = rows.find((row) => {
    const rowPhone = normalizePhone(row?.phone || row?.name || row?.mobile);
    return rowPhone === normalized || (rowPhone.length >= 9 && normalized.length >= 9 && rowPhone.endsWith(normalized.slice(-9)));
  });
  return first(found?.id, found?.contact_id);
}

async function mersalApiPost(url, body) {
  let jsonError = "";
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const rawText = await response.text();
    const data = parseJson(rawText);
    if (response.ok && !isMersalInvalidTokenResponse(data)) return data;
    jsonError = first(data?.error, data?.message, rawText, `HTTP ${response.status}`);
  } catch (error) {
    jsonError = errorMessage(error);
  }

  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body || {})) form.set(key, String(value ?? ""));
  const response = await fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const rawText = await response.text();
  const data = parseJson(rawText);
  if (!response.ok || isMersalInvalidTokenResponse(data)) {
    throw new Error(first(data?.error, data?.message, rawText, jsonError, `HTTP ${response.status}`));
  }
  return data;
}

function isMersalInvalidTokenResponse(data) {
  const status = clean(data?.status).toLowerCase();
  const message = first(data?.message, data?.errMsg, data?.error).toLowerCase();
  return status === "error" && message.includes("invalid token");
}

function normalizeMersalRows(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.messages)
        ? payload.messages
        : Array.isArray(payload?.data?.messages)
          ? payload.data.messages
          : Array.isArray(payload?.data?.data)
            ? payload.data.data
            : [];
  return rows.slice().sort((a, b) => mersalRowTimestamp(b) - mersalRowTimestamp(a));
}

function mersalRowMessageId(row) {
  return first(
    row?.fb_message_id,
    row?.fbMessageId,
    row?.message_wamid,
    row?.messageWamid,
    row?.wamid,
    row?.provider_message_id,
    row?.providerMessageId,
    row?.message_id,
    row?.messageId,
  );
}

function mersalRowMediaIds(row) {
  const values = [
    row?.media_id,
    row?.mediaId,
    row?.whatsapp_media_id,
    row?.whatsappMediaId,
    row?.header_media_id,
    row?.headerMediaId,
    row?.attachment_id,
    row?.attachmentId,
    row?.image?.id,
    row?.audio?.id,
    row?.video?.id,
    row?.document?.id,
    row?.attachment?.id,
    row?.media?.id,
  ];
  return values.map((value) => clean(value)).filter(Boolean);
}

function mersalRowTimestamp(row) {
  return timestampMs(row?.created_at || row?.createdAt || row?.received_at || row?.receivedAt || row?.updated_at || row?.updatedAt || row?.timestamp);
}

function isInboundMersalRow(row) {
  const flag = row?.is_message_by_contact ?? row?.isMessageByContact;
  if (flag === true || flag === 1 || clean(flag).toLowerCase() === "true" || clean(flag) === "1") return true;
  const direction = first(row?.direction, row?.message_direction, row?.messageDirection).toLowerCase();
  if (["in", "inbound", "received", "receive"].includes(direction)) return true;
  const sender = first(row?.sender_type, row?.senderType, row?.author_type, row?.authorType).toLowerCase();
  return ["customer", "contact", "client"].includes(sender);
}

function mersalMediaField(...values) {
  for (const value of values) {
    const direct = clean(value);
    if (direct) {
      if (/^[{[]/.test(direct)) {
        const parsed = parseJson(direct);
        const nested = first(parsed?.url, parsed?.link, parsed?.href, parsed?.src, parsed?.path, parsed?.download_url, parsed?.downloadUrl);
        if (nested) return nested;
      } else {
        return direct;
      }
    }
    if (value && typeof value === "object") {
      const nested = first(value?.url, value?.link, value?.href, value?.src, value?.path, value?.download_url, value?.downloadUrl);
      if (nested) return nested;
    }
  }
  return "";
}

function mediaFromMersalRowForType(row, contactId, mediaBase, requestedType) {
  if (!row) return null;
  const targetType = normalizeMediaType(requestedType);
  const fieldsByType = {
    image: [row?.header_image, row?.image, row?.image_url, row?.media_image],
    audio: [row?.header_audio, row?.audio, row?.audio_url, row?.voice, row?.voice_url, row?.media_audio],
    video: [row?.header_video, row?.video, row?.video_url, row?.media_video],
    document: [row?.header_document, row?.document, row?.document_url, row?.file, row?.file_url, row?.media_document],
    sticker: [row?.sticker, row?.sticker_url, row?.media_sticker, row?.header_image, row?.image, row?.image_url],
  };
  const values = fieldsByType[targetType];
  if (!values) return null;
  const rawUrl = mersalMediaField(...values);
  const url = normalizePublicMediaUrl(rawUrl, mediaBase || DEFAULT_MERSAL_BASE);
  if (!url || isProtectedWhatsappMediaUrl(url)) return null;
  return {
    url,
    attachmentType: targetType,
    contactId: contactId || first(row?.contact_id),
    providerMessageId: mersalRowMessageId(row),
    mediaId: mersalRowMediaIds(row)[0] || "",
    createdAt: row?.created_at || row?.createdAt || "",
    fileName: fileNameFromUrl(url),
    mimeType: guessMimeType(url, targetType),
  };
}

function mediaFromMersalRow(row, contactId, mediaBase) {
  if (!row) return null;
  for (const type of ["image", "audio", "video", "document", "sticker"]) {
    const media = mediaFromMersalRowForType(row, contactId, mediaBase, type);
    if (media?.url) return media;
  }
  return null;
}

function normalizePublicMediaUrl(value, base) {
  let url = clean(value).replace(/\\\//g, "/").replace(/&amp;/gi, "&");
  if (!url) return "";
  if (url.startsWith("//")) url = `https:${url}`;
  else if (url.startsWith("/")) url = `${clean(base).replace(/\/+$/, "")}${url}`;
  else if (/^(?:uploads?|storage|media|files?|documents?|public)\//i.test(url)) url = `${clean(base).replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && /^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(url)) url = `https://${url}`;
  return /^https?:\/\//i.test(url) ? url : "";
}

function isProtectedWhatsappMediaUrl(url) {
  return /lookaside\.fbsbx\.com\/whatsapp_business\/attachments/i.test(clean(url));
}

async function storeInboundMedia(env, input) {
  const sourceUrl = normalizePublicMediaUrl(input.sourceUrl, mersalBase(env));
  if (!sourceUrl || isProtectedWhatsappMediaUrl(sourceUrl)) throw new Error("Inbound media has no downloadable public URL");

  const mediaResponse = await fetch(sourceUrl, { method: "GET", headers: { accept: "*/*" }, redirect: "follow" });
  if (!mediaResponse.ok) throw new Error(`Failed to download inbound media: HTTP ${mediaResponse.status}`);
  const bytes = await mediaResponse.arrayBuffer();
  if (!bytes.byteLength) throw new Error("Inbound media download returned an empty file");
  if (bytes.byteLength > 50 * 1024 * 1024) throw new Error("Inbound media exceeds the 50MB platform limit");

  const mediaType = normalizeMediaType(input.mediaType);
  const responseMime = clean(mediaResponse.headers.get("content-type")).split(";")[0];
  const mimeType = responseMime || clean(input.mimeType) || guessMimeType(sourceUrl, mediaType);
  const dispositionName = contentDispositionFileName(mediaResponse.headers.get("content-disposition"));
  const fileName = ensureMediaFileName(first(input.fileName, dispositionName, fileNameFromUrl(mediaResponse.url || sourceUrl)), mediaType, mimeType, input.eventId);

  const endpoint = platformMediaEndpoint(env);
  const secret = clean(env?.MZJ_GATEWAY_SECRET);
  if (!endpoint || !secret) throw new Error("Platform inbound media endpoint is not configured");

  const prepareResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-mzj-gateway-secret": secret,
      "x-mzj-source": "whatsapp",
      "x-event-id": clean(input.eventId),
    },
    body: JSON.stringify({
      action: "prepare_upload",
      source: "whatsapp",
      eventKey: clean(input.eventId),
      conversationId: clean(input.conversationId),
      mediaType,
      fileName,
      mimeType,
      fileSize: bytes.byteLength,
      isSensitive: true,
    }),
  });
  const prepareText = await prepareResponse.text();
  const prepared = parseJson(prepareText);
  if (!prepareResponse.ok || prepared?.ok === false || !clean(prepared?.uploadUrl) || !clean(prepared?.storageKey)) {
    throw new Error(first(prepared?.error, prepareText, `Platform media prepare failed: HTTP ${prepareResponse.status}`));
  }

  const uploadResponse = await fetch(clean(prepared.uploadUrl), {
    method: "PUT",
    headers: { "content-type": mimeType || "application/octet-stream" },
    body: bytes,
  });
  if (!uploadResponse.ok) throw new Error(`Platform media upload failed: HTTP ${uploadResponse.status}`);

  return {
    assetId: clean(prepared.assetId),
    storageKey: clean(prepared.storageKey),
    fileName,
    mimeType,
    fileSize: bytes.byteLength,
  };
}

function platformMediaEndpoint(env) {
  const override = clean(env?.PLATFORM_MEDIA_URL);
  if (override) return override;
  const inbound = clean(env?.PLATFORM_INBOUND_URL) || DEFAULT_PLATFORM_INBOUND_URL;
  try {
    const url = new URL(inbound);
    url.pathname = "/api/integrations/media";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function contentDispositionFileName(value) {
  const header = clean(value);
  if (!header) return "";
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded.replace(/^['"]|['"]$/g, "")); }
    catch { return encoded; }
  }
  return clean(header.match(/filename\s*=\s*"([^"]+)"/i)?.[1] || header.match(/filename\s*=\s*([^;]+)/i)?.[1]).replace(/^['"]|['"]$/g, "");
}

function ensureMediaFileName(value, mediaType, mimeType, eventId) {
  let fileName = clean(value).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
  if (!fileName) fileName = `${mediaType || "media"}-${clean(eventId) || Date.now()}`;
  if (!/\.[a-z0-9]{1,8}$/i.test(fileName)) fileName += extensionFromMimeType(mimeType, mediaType);
  return fileName.slice(0, 180);
}

function extensionFromMimeType(mimeType, mediaType) {
  const mime = clean(mimeType).toLowerCase();
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("pdf")) return ".pdf";
  if (mime.includes("mp4")) return ".mp4";
  if (mime.includes("mpeg")) return mediaType === "video" ? ".mpeg" : ".mp3";
  if (mime.includes("ogg") || mime.includes("opus")) return ".ogg";
  if (mime.includes("wav")) return ".wav";
  if (mime.includes("aac")) return ".aac";
  if (mediaType === "image") return ".jpg";
  if (mediaType === "audio") return ".mp3";
  if (mediaType === "video") return ".mp4";
  if (mediaType === "document") return ".pdf";
  return ".bin";
}

function normalizeMediaType(value) {
  const type = clean(value).toLowerCase();
  if (type === "photo" || type === "picture") return "image";
  if (type === "voice" || type === "ptt") return "audio";
  if (type === "file") return "document";
  return type || "text";
}

function attachmentLabel(type) {
  const normalized = normalizeMediaType(type);
  if (normalized === "image") return "صورة من العميل";
  if (normalized === "audio") return "رسالة صوتية من العميل";
  if (normalized === "video") return "فيديو من العميل";
  if (normalized === "document") return "ملف من العميل";
  if (normalized === "sticker") return "ملصق من العميل";
  return "مرفق من العميل";
}

function providerStatusLabel(value) {
  return normalizeStatus(value);
}

function normalizeStatus(value) {
  return clean(value).toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizePhone(value) {
  let phone = String(value || "")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[^\d]/g, "");

  if (phone.startsWith("00")) phone = phone.slice(2);

  if (/^05\d{8}$/.test(phone)) {
    phone = `966${phone.slice(1)}`;
  } else if (/^5\d{8}$/.test(phone)) {
    phone = `966${phone}`;
  }

  return /^\d{8,15}$/.test(phone) ? phone : "";
}

function stableEventId(value) {
  const text = JSON.stringify(value || {});
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `mersal_${(hash >>> 0).toString(16)}`;
}

function gatewayAuthorized(request, env) {
  const expected = clean(env?.MZJ_GATEWAY_SECRET);
  const provided = clean(request.headers.get("x-mzj-gateway-secret"));
  if (!expected || expected.length !== provided.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  return mismatch === 0;
}

function mersalBase(env) {
  return clean(env?.MERSAL_API_ENDPOINT || DEFAULT_MERSAL_BASE).replace(/\/+$/, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestampMs(value) {
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const number = Number(value);
    return number < 1e12 ? number * 1000 : number;
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function fileNameFromUrl(url) {
  try { return decodeURIComponent(new URL(clean(url)).pathname.split("/").pop() || ""); }
  catch { return ""; }
}

function guessMimeType(url, type) {
  const lower = clean(url).toLowerCase().split("?")[0];
  if (/\.jpe?g$/.test(lower)) return "image/jpeg";
  if (/\.png$/.test(lower)) return "image/png";
  if (/\.webp$/.test(lower)) return "image/webp";
  if (/\.mp3$/.test(lower)) return "audio/mpeg";
  if (/\.(ogg|opus)$/.test(lower)) return "audio/ogg";
  if (/\.wav$/.test(lower)) return "audio/wav";
  if (/\.mp4$/.test(lower)) return "video/mp4";
  if (/\.pdf$/.test(lower)) return "application/pdf";
  if (type === "image") return "image/jpeg";
  if (type === "audio") return "audio/mpeg";
  if (type === "video") return "video/mp4";
  return "application/octet-stream";
}

function first(...values) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return "";
}

function clean(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

function parseJson(value) {
  if (value && typeof value === "object") return value;
  try { return value ? JSON.parse(String(value)) : {}; }
  catch { return { raw: String(value || "") }; }
}

async function safeJson(request) {
  try { return await request.json(); }
  catch { return {}; }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

async function kvPutJson(env, key, value) {
  try {
    if (!env?.DEBUG_KV) return;
    await env.DEBUG_KV.put(key, JSON.stringify({ at: new Date().toISOString(), value }), { expirationTtl: 86400 });
  } catch (error) {
    console.error("DEBUG_KV put failed", error);
  }
}

async function kvGetJson(env, key) {
  try {
    if (!env?.DEBUG_KV) return null;
    const value = await env.DEBUG_KV.get(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-mzj-gateway-secret",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), "content-type": "application/json; charset=utf-8" },
  });
}
