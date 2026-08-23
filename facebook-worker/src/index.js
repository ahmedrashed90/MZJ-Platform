/*
 * MZJ Facebook / ManyChat Worker
 *
 * Full transport-only Worker for MZJ Unified Platform.
 *
 * Responsibilities:
 * - Verify and receive Meta webhooks.
 * - Normalize Messenger text, quick replies, postbacks, referrals and media.
 * - Preserve the real Facebook Page-Scoped ID as the canonical identity.
 * - Correlate Facebook PSID and ManyChat Contact ID without creating duplicate conversations.
 * - Forward every supported inbound event to the platform.
 * - Send text, quick replies and media through Facebook Graph API.
 * - Start a Messenger thread from a Page comment with Facebook Private Replies when no PSID exists yet.
 * - Keep ManyChat as an optional plain-text fallback.
 * - Return real provider send results.
 *
 * The platform is the single source of truth for automation definitions,
 * customer creation, departments, branches, assignment and distribution.
 * This Worker contains no business-flow messages or distribution logic.
 */

const VERSION = "mzj-facebook-worker-v2.0.4-comment-private-reply";
const WORKER_CODE = "facebook";
const DEFAULT_PLATFORM_INBOUND_URL =
  "https://mzj-platform.vercel.app/api/integrations/facebook";
const DEFAULT_GRAPH_API_VERSION = "v20.0";
const DEFAULT_MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const IDENTITY_LINK_TTL_SECONDS = 30 * 24 * 60 * 60;
const PENDING_CORRELATION_TTL_SECONDS = 10 * 60;
const META_CORRELATION_WAIT_MS = 1200;

const FAILURE_STATUSES = new Set([
  "error",
  "failed",
  "failure",
  "rejected",
  "invalid",
]);

const SUCCESS_STATUSES = new Set([
  "ok",
  "success",
  "sent",
  "queued",
  "accepted",
  "submitted",
  "delivered",
  "processing",
]);

const META_WEBHOOK_PATHS = new Set([
  "/meta/webhook",
  "/webhook",
  "/webhook/facebook",
  "/webhook/meta",
  "/facebook/webhook",
]);

const AUTOMATION_PATHS = new Set([
  "/automation",
  "/manychat/automation",
  "/webhook/manychat",
]);

const SEND_PATHS = new Set([
  "/send/facebook",
  "/crm/send",
  "/send/meta",
  "/send",
]);

const memoryIdentityLinks = new Map();
const memoryPendingCorrelations = new Map();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response("", {
        status: 204,
        headers: corsHeaders(),
      });
    }

    if (
      request.method === "GET" &&
      (url.pathname === "/" || url.pathname === "/health")
    ) {
      return healthResponse(env);
    }

    if (request.method === "GET" && url.pathname === "/debug/last") {
      return debugResponse(env);
    }

    if (request.method === "GET" && META_WEBHOOK_PATHS.has(url.pathname)) {
      return handleMetaVerification(url, env);
    }

    if (request.method === "POST" && META_WEBHOOK_PATHS.has(url.pathname)) {
      return handleMetaWebhook(request, env, ctx);
    }

    if (request.method === "POST" && AUTOMATION_PATHS.has(url.pathname)) {
      return handleManyChatCompatibility(request, env, ctx);
    }

    if (request.method === "POST" && SEND_PATHS.has(url.pathname)) {
      if (!gatewayAuthorized(request, env)) {
        return json(
          {
            ok: false,
            status: "failed",
            error: "Unauthorized gateway request",
            version: VERSION,
          },
          401,
        );
      }

      return handleFacebookSend(request, env, ctx);
    }

    return json(
      {
        ok: false,
        error: "Not found",
        version: VERSION,
      },
      404,
    );
  },
};

/* ========================================================================== */
/* HEALTH + DEBUG                                                             */
/* ========================================================================== */

function healthResponse(env) {
  return json(
    {
      ok: true,
      service: "facebook-crm-worker",
      workerCode: WORKER_CODE,
      version: VERSION,
      responsibility: "transport_only",
      storage: "platform_postgresql",
      routes: {
        health: "GET /",
        debug: "GET /debug/last",
        metaWebhook: "GET/POST /meta/webhook",
        manychatCompatibility: "POST /automation",
        send: "POST /send/facebook",
      },
      env_check: {
        has_gateway_secret: Boolean(clean(env?.MZJ_GATEWAY_SECRET)),
        has_platform_inbound_url: Boolean(
          clean(env?.PLATFORM_INBOUND_URL) || DEFAULT_PLATFORM_INBOUND_URL,
        ),
        has_platform_media_url: Boolean(platformMediaEndpoint(env)),
        has_fb_verify_token: Boolean(clean(env?.FB_VERIFY_TOKEN)),
        has_fb_app_secret: Boolean(clean(env?.FB_APP_SECRET)),
        has_fb_page_id: Boolean(clean(env?.FB_PAGE_ID)),
        has_fb_page_access_token: Boolean(clean(env?.FB_PAGE_ACCESS_TOKEN)),
        has_manychat_api_token: Boolean(manychatToken(env)),
        has_manychat_webhook_secret: Boolean(
          clean(env?.MANYCHAT_WEBHOOK_SECRET),
        ),
        has_debug_kv: Boolean(env?.DEBUG_KV),
        has_identity_kv: Boolean(identityKv(env)),
      },
      safeguards: {
        platform_is_automation_source_of_truth: true,
        worker_contains_no_business_flow: true,
        meta_psid_is_canonical_identity: true,
        manychat_contact_id_is_not_used_as_psid: true,
        inbound_media_is_forwarded_to_platform_storage: true,
        provider_send_result_is_returned: true,
      },
    },
    200,
  );
}

async function debugResponse(env) {
  return json(
    {
      ok: true,
      version: VERSION,
      metaPayload: await kvGetJson(env, "DEBUG_FACEBOOK_LAST_META_PAYLOAD"),
      metaForward: await kvGetJson(env, "DEBUG_FACEBOOK_LAST_META_FORWARD"),
      automationPayload: await kvGetJson(
        env,
        "DEBUG_FACEBOOK_LAST_AUTOMATION_PAYLOAD",
      ),
      automationForward: await kvGetJson(
        env,
        "DEBUG_FACEBOOK_LAST_AUTOMATION_FORWARD",
      ),
      send: await kvGetJson(env, "DEBUG_FACEBOOK_LAST_SEND"),
    },
    200,
  );
}

/* ========================================================================== */
/* META WEBHOOK                                                               */
/* ========================================================================== */

function handleMetaVerification(url, env) {
  const mode = clean(url.searchParams.get("hub.mode"));
  const token = clean(url.searchParams.get("hub.verify_token"));
  const challenge = clean(url.searchParams.get("hub.challenge"));
  const expected = clean(env?.FB_VERIFY_TOKEN);

  if (
    mode === "subscribe" &&
    expected &&
    timingSafeEqualText(token, expected)
  ) {
    return text(challenge, 200);
  }

  return text("Forbidden", 403);
}

async function handleMetaWebhook(request, env, ctx) {
  const rawBody = await request.text();

  if (clean(env?.FB_APP_SECRET)) {
    const signature = clean(request.headers.get("x-hub-signature-256"));
    const valid = await verifyXHubSignature256(
      signature,
      rawBody,
      env.FB_APP_SECRET,
    );

    if (!valid) {
      return json(
        {
          ok: false,
          error: "Bad signature",
          version: VERSION,
        },
        401,
      );
    }
  }

  const incoming = parseJsonStrict(rawBody);

  if (!incoming.ok) {
    return json(
      {
        ok: false,
        error: "Invalid JSON",
        version: VERSION,
      },
      400,
    );
  }

  if (ctx?.waitUntil) {
    ctx.waitUntil(
      kvPutJson(env, "DEBUG_FACEBOOK_LAST_META_PAYLOAD", incoming.value),
    );
  }

  if (
    incoming.value?.object !== "page" ||
    !Array.isArray(incoming.value?.entry)
  ) {
    return json(
      {
        ok: true,
        accepted: true,
        ignored: true,
        reason: "unsupported_object",
        version: VERSION,
      },
      200,
    );
  }

  try {
    const events = await normalizeMetaEvents(incoming.value, env);

    if (!events.length) {
      const result = {
        processed: 0,
        forwarded: [],
        note: "webhook received without a supported Messenger event",
      };

      if (ctx?.waitUntil) {
        ctx.waitUntil(
          kvPutJson(env, "DEBUG_FACEBOOK_LAST_META_FORWARD", result),
        );
      }

      return json(
        {
          ok: true,
          accepted: true,
          ...result,
          version: VERSION,
        },
        200,
      );
    }

    const forwarded = [];

    for (const event of events) {
      const payload = await buildMetaPlatformPayload(event, env);
      const result = await forwardToPlatform(payload, env, "facebook");

      if (!result.ok) {
        throw new Error(
          `Platform endpoint rejected ${event.eventId}: HTTP ${result.status} ${result.error}`,
        );
      }

      forwarded.push({
        eventId: event.eventId,
        pageId: event.pageId,
        participantId: payload.participantId,
        direction: payload.direction,
        status: result.status,
        conversationId:
          result.data?.result?.conversationId ||
          result.data?.conversationId ||
          payload.conversationId,
        messageId:
          result.data?.result?.messageId ||
          result.data?.messageId ||
          payload.providerMessageId,
      });
    }

    const finalResult = {
      processed: events.length,
      forwarded,
    };

    if (ctx?.waitUntil) {
      ctx.waitUntil(
        kvPutJson(env, "DEBUG_FACEBOOK_LAST_META_FORWARD", finalResult),
      );
    }

    return json(
      {
        ok: true,
        accepted: true,
        ...finalResult,
        version: VERSION,
      },
      200,
    );
  } catch (error) {
    const message = errorMessage(error);
    console.error("Facebook Meta inbound processing failed", message);

    if (ctx?.waitUntil) {
      ctx.waitUntil(
        kvPutJson(env, "DEBUG_FACEBOOK_LAST_META_FORWARD", {
          ok: false,
          error: message,
        }),
      );
    }

    return json(
      {
        ok: false,
        status: "failed",
        error: message,
        version: VERSION,
      },
      502,
    );
  }
}

async function normalizeMetaEvents(incoming, env) {
  const events = [];

  for (const entry of Array.isArray(incoming?.entry) ? incoming.entry : []) {
    const pageId = clean(entry?.id || env?.FB_PAGE_ID);
    const entryTime = timestampMs(entry?.time || Date.now());
    const messaging = [
      ...(Array.isArray(entry?.messaging) ? entry.messaging : []),
      ...(Array.isArray(entry?.standby) ? entry.standby : []),
    ];

    for (const evt of messaging) {
      if (!evt || typeof evt !== "object") continue;
      if (evt?.delivery || evt?.read) continue;

      const senderId = clean(evt?.sender?.id);
      const recipientId = clean(evt?.recipient?.id);

      if (!senderId || !pageId) continue;

      const isEcho =
        evt?.message?.is_echo === true ||
        senderId === pageId ||
        senderId === clean(env?.FB_PAGE_ID);

      const customerId = isEcho ? recipientId : senderId;

      if (!customerId) continue;

      const content = extractFacebookEventContent(evt);

      if (!content.hasContent) continue;

      const eventTime = timestampMs(
        evt?.timestamp || entryTime || Date.now(),
      );

      const eventId =
        clean(content.providerMessageId) ||
        stableEventId({
          pageId,
          customerId,
          eventTime,
          text: content.text,
          payload: content.payload,
          attachments: content.attachments.map((item) => ({
            type: item.type,
            url: item.url,
          })),
          isEcho,
        });

      const displayName = isEcho
        ? "Facebook Page"
        : (await fetchFacebookName(customerId, env).catch(() => "")) ||
          `Facebook User (${customerId.slice(-4)})`;

      events.push({
        eventId,
        pageId,
        senderId,
        recipientId,
        customerId,
        displayName,
        timestamp: eventTime,
        isEcho,
        content,
      });
    }
  }

  const unique = new Map();

  for (const event of events) {
    if (!unique.has(event.eventId)) {
      unique.set(event.eventId, event);
    }
  }

  return [...unique.values()];
}

function extractFacebookEventContent(evt) {
  const message = evt?.message || {};
  const postback = evt?.postback || {};
  const referral = evt?.referral || postback?.referral || message?.referral || {};
  const quickReply = message?.quick_reply || {};

  const payload = first(
    quickReply?.payload,
    postback?.payload,
    referral?.ref,
    referral?.ad_id,
  );

  const buttonTitle = first(postback?.title);

  const textValue = first(
    message?.text,
    postback?.title,
    postback?.payload,
    quickReply?.payload,
    referral?.ref,
  );

  const attachments = [];

  for (const attachment of Array.isArray(message?.attachments)
    ? message.attachments
    : []) {
    const normalized = normalizeFacebookAttachment(attachment);
    if (normalized) attachments.push(normalized);
  }

  if (!attachments.length && referral && typeof referral === "object") {
    const referralUrl = first(
      referral?.source === "ADS" ? referral?.ad_id : "",
      referral?.ref,
    );

    if (referralUrl && /^https?:\/\//i.test(referralUrl)) {
      attachments.push({
        type: "link",
        url: referralUrl,
        fileName: fileNameFromUrl(referralUrl),
        mimeType: "text/uri-list",
        title: "",
        stickerId: "",
      });
    }
  }

  let type = "text";

  if (attachments.length) type = attachments[0].type || "attachment";
  else if (postback?.payload) type = "postback";
  else if (quickReply?.payload) type = "quick_reply";
  else if (referral?.ref) type = "referral";

  return {
    providerMessageId: first(message?.mid, postback?.mid),
    replyToProviderMessageId: first(
      message?.reply_to?.mid,
      message?.reply_to?.message_id,
      message?.reply_to?.messageId,
    ),
    text: clean(textValue),
    payload: clean(payload),
    buttonTitle: clean(buttonTitle),
    type,
    attachments,
    hasContent: Boolean(
      clean(textValue) || clean(payload) || attachments.length,
    ),
  };
}

function normalizeFacebookAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") return null;

  const rawType = clean(attachment?.type).toLowerCase();
  const payload =
    attachment?.payload && typeof attachment.payload === "object"
      ? attachment.payload
      : {};

  const url = first(payload?.url, payload?.href, payload?.link);
  const stickerId = first(payload?.sticker_id, payload?.stickerId);
  const title = first(attachment?.title, payload?.title);

  let type = normalizeMediaType(rawType || "attachment");

  if (type === "file") type = "document";
  if (type === "fallback") type = url ? "link" : "attachment";

  if (!url && !stickerId && !title) return null;

  return {
    type,
    url: clean(url),
    fileName: first(
      payload?.filename,
      payload?.file_name,
      attachment?.name,
      fileNameFromUrl(url),
    ),
    mimeType: first(
      payload?.mime_type,
      payload?.mimeType,
      guessMimeType(url, type),
    ),
    title: clean(title),
    stickerId: clean(stickerId),
  };
}

async function buildMetaPlatformPayload(event, env) {
  const content = event.content || {};
  const identity = await resolveMetaEventIdentity(event, env);

  const canonicalParticipantId =
    clean(identity.facebookPsid) || clean(event.customerId);

  const conversationId = facebookConversationId(
    event.pageId,
    canonicalParticipantId,
  );

  const storedAttachments = [];

  for (let index = 0; index < content.attachments.length; index += 1) {
    const attachment = content.attachments[index];

    const stored = await prepareInboundFacebookAttachment(env, {
      attachment,
      eventId: `${event.eventId}_att_${index + 1}`,
      conversationId,
      pageId: event.pageId,
      participantId: canonicalParticipantId,
    });

    storedAttachments.push(stored);
  }

  const primary = storedAttachments[0] || null;
  const direction = event.isEcho ? "out" : "in";

  const messageText =
    clean(content.text) ||
    clean(content.buttonTitle) ||
    clean(content.payload) ||
    (primary ? attachmentLabel(primary.attachmentType) : "");

  const providerMessageId =
    clean(content.providerMessageId) || clean(event.eventId);

  return {
    eventId: event.eventId,
    event_id: event.eventId,
    type: "incoming_message",
    eventType: event.isEcho ? "message_echo" : "incoming_message",
    event_type: event.isEcho ? "message_echo" : "incoming_message",
    direction,
    senderType: event.isEcho ? "agent" : "customer",
    sender_type: event.isEcho ? "agent" : "customer",

    provider: "meta",
    providerName: "facebook_graph",
    provider_name: "facebook_graph",
    platform: "facebook",
    channel: "facebook",
    channelCode: "fb",
    channel_code: "fb",
    workerCode: WORKER_CODE,
    worker_code: WORKER_CODE,
    source: "فيسبوك",
    sourceName: "فيسبوك",
    source_name: "فيسبوك",

    pageId: event.pageId,
    page_id: event.pageId,
    participantId: canonicalParticipantId,
    participant_id: canonicalParticipantId,
    manychatContactId: identity.manychatContactId || "",
    manychat_contact_id: identity.manychatContactId || "",
    facebookPsid: canonicalParticipantId,
    facebook_psid: canonicalParticipantId,
    fbId: canonicalParticipantId,
    fb_id: canonicalParticipantId,
    fbPsid: canonicalParticipantId,
    fb_psid: canonicalParticipantId,
    metaSenderId: clean(event.customerId),
    meta_sender_id: clean(event.customerId),
    canonicalParticipantId,
    canonical_participant_id: canonicalParticipantId,
    identitySource: identity.identitySource,
    identity_source: identity.identitySource,
    identityLinked: identity.linked,
    identity_linked: identity.linked,
    identityAliases: identity.aliases,
    identity_aliases: identity.aliases,
    conversationAliases: identity.conversationAliases,
    conversation_aliases: identity.conversationAliases,
    mergeConversationAliases: identity.linked,
    merge_conversation_aliases: identity.linked,
    conversationId,
    conversation_id: conversationId,
    customerName: event.displayName,
    customer_name: event.displayName,

    messageId: providerMessageId,
    message_id: providerMessageId,
    providerMessageId,
    provider_message_id: providerMessageId,
    replyToProviderMessageId: clean(content.replyToProviderMessageId),
    reply_to_provider_message_id: clean(content.replyToProviderMessageId),
    text: messageText,
    message: messageText,
    messageType: primary?.attachmentType || content.type || "text",
    message_type: primary?.attachmentType || content.type || "text",
    payload: clean(content.payload),
    buttonTitle: clean(content.buttonTitle),
    button_title: clean(content.buttonTitle),
    timestamp: event.timestamp,
    isEcho: event.isEcho,
    is_echo: event.isEcho,

    hasAttachment: storedAttachments.length > 0,
    has_attachment: storedAttachments.length > 0,
    attachmentType: primary?.attachmentType || "",
    attachment_type: primary?.attachmentType || "",
    mediaType: primary?.attachmentType || "",
    media_type: primary?.attachmentType || "",
    mediaUrl: primary?.mediaUrl || "",
    media_url: primary?.mediaUrl || "",
    fileUrl: primary?.fileUrl || "",
    file_url: primary?.fileUrl || "",
    attachmentUrl: primary?.attachmentUrl || "",
    attachment_url: primary?.attachmentUrl || "",
    fileName: primary?.fileName || "",
    file_name: primary?.fileName || "",
    mimeType: primary?.mimeType || "",
    mime_type: primary?.mimeType || "",
    fileSize: primary?.fileSize || null,
    file_size: primary?.fileSize || null,
    storageKey: primary?.storageKey || "",
    storage_key: primary?.storageKey || "",
    mediaAssetId: primary?.mediaAssetId || "",
    media_asset_id: primary?.mediaAssetId || "",
    mediaStatus: primary?.mediaStatus || "",
    media_status: primary?.mediaStatus || "",
    isSensitive: primary?.isSensitive === true,
    is_sensitive: primary?.isSensitive === true,
    attachments: storedAttachments,
  };
}

async function prepareInboundFacebookAttachment(env, input) {
  const attachment = input?.attachment || {};
  const attachmentType = normalizeMediaType(
    attachment?.type || "attachment",
  );
  const sourceUrl = clean(attachment?.url);

  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
    return {
      attachmentType,
      mediaType: attachmentType,
      mediaUrl: sourceUrl,
      fileUrl: sourceUrl,
      attachmentUrl: sourceUrl,
      fileName: clean(attachment?.fileName),
      mimeType: clean(attachment?.mimeType),
      fileSize: null,
      storageKey: "",
      mediaAssetId: "",
      mediaStatus: sourceUrl ? "external" : "metadata_only",
      isSensitive: true,
      stickerId: clean(attachment?.stickerId),
      title: clean(attachment?.title),
    };
  }

  const stored = await storeInboundMedia(env, {
    sourceUrl,
    eventId: input.eventId,
    conversationId: input.conversationId,
    mediaType: attachmentType,
    fileName: attachment?.fileName,
    mimeType: attachment?.mimeType,
    pageId: input.pageId,
    participantId: input.participantId,
  });

  return {
    attachmentType,
    mediaType: attachmentType,
    mediaUrl: sourceUrl,
    fileUrl: sourceUrl,
    attachmentUrl: sourceUrl,
    fileName: stored.fileName,
    mimeType: stored.mimeType,
    fileSize: stored.fileSize,
    storageKey: stored.storageKey,
    mediaAssetId: stored.assetId,
    mediaStatus: "ready",
    isSensitive: true,
    stickerId: clean(attachment?.stickerId),
    title: clean(attachment?.title),
  };
}

/* ========================================================================== */
/* MANYCHAT COMPATIBILITY                                                     */
/* ========================================================================== */

async function handleManyChatCompatibility(request, env, ctx) {
  if (!manychatWebhookAuthorized(request, env)) {
    return json(
      {
        ok: false,
        error: "Unauthorized ManyChat request",
        version: VERSION,
      },
      401,
    );
  }

  const body = await safeJson(request);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json(
      {
        ok: false,
        error: "Invalid JSON",
        version: VERSION,
      },
      400,
    );
  }

  if (ctx?.waitUntil) {
    ctx.waitUntil(
      kvPutJson(env, "DEBUG_FACEBOOK_LAST_AUTOMATION_PAYLOAD", body),
    );
  }

  try {
    const contactData = manyChatContactData(body);
    const identity = await resolveManyChatAutomationIdentity(
      body,
      contactData,
      env,
    );

    const incomingText = getCustomerInputText(body);
    const payloadValue = first(
      body?.payload,
      body?.buttonPayload,
      body?.button_payload,
      body?.quickReplyPayload,
      body?.quick_reply_payload,
    );

    const messageText = first(
      incomingText,
      body?.text,
      body?.message,
      body?.previewText,
      body?.preview_text,
      payloadValue,
    );

    const eventId =
      first(
        body?.eventId,
        body?.event_id,
        body?.messageId,
        body?.message_id,
      ) ||
      stableEventId({
        source: "manychat",
        pageId: identity.pageId,
        manychatContactId: identity.manychatContactId,
        facebookPsid: identity.facebookPsid,
        messageText,
        payloadValue,
        timestamp: first(
          body?.timestamp,
          body?.createdAt,
          body?.created_at,
          Date.now(),
        ),
      });

    const correlationRecord = {
      eventId,
      pageId: identity.pageId,
      manychatContactId: identity.manychatContactId,
      canonicalParticipantId:
        identity.facebookPsid || identity.manychatContactId,
      customerName: first(
        body?.customerName,
        body?.customer_name,
        body?.displayName,
        body?.display_name,
        identity.displayName,
      ),
      messageText,
      payloadValue,
      createdAt: Date.now(),
    };

    await rememberAutomationCorrelation(correlationRecord, body, env);

    if (!identity.pageId || !identity.facebookPsid) {
      const responseBody = {
        ok: true,
        accepted: true,
        skipped: true,
        deferredToMetaWebhook: true,
        reason: "verified_facebook_psid_required",
        version: VERSION,
        eventId,
        conversationId: "",
        participantId: "",
        manychatContactId: identity.manychatContactId,
      };

      if (ctx?.waitUntil) {
        ctx.waitUntil(
          kvPutJson(
            env,
            "DEBUG_FACEBOOK_LAST_AUTOMATION_FORWARD",
            responseBody,
          ),
        );
      }

      return json(responseBody, 200);
    }

    if (!messageText && !payloadValue) {
      const responseBody = {
        ok: true,
        accepted: true,
        skipped: true,
        reason: "no_customer_content",
        version: VERSION,
        eventId,
        manychatContactId: identity.manychatContactId,
        participantId: identity.facebookPsid,
      };

      if (ctx?.waitUntil) {
        ctx.waitUntil(
          kvPutJson(
            env,
            "DEBUG_FACEBOOK_LAST_AUTOMATION_FORWARD",
            responseBody,
          ),
        );
      }

      return json(responseBody, 200);
    }

    const participantId = identity.facebookPsid;
    const conversationId = facebookConversationId(
      identity.pageId,
      participantId,
    );

    const providerMessageId = first(
      body?.providerMessageId,
      body?.provider_message_id,
      body?.messageId,
      body?.message_id,
      eventId,
    );

    const customerName = first(
      body?.customerName,
      body?.customer_name,
      body?.displayName,
      body?.display_name,
      body?.fullName,
      body?.full_name,
      contactData?.name,
      [clean(contactData?.first_name), clean(contactData?.last_name)]
        .filter(Boolean)
        .join(" "),
      identity.displayName,
      `Facebook User (${participantId.slice(-4)})`,
    );

    const platformPayload = {
      eventId,
      event_id: eventId,
      type: "incoming_message",
      eventType: "manychat_customer_input",
      event_type: "manychat_customer_input",
      direction: "in",
      senderType: "customer",
      sender_type: "customer",

      provider: "manychat",
      providerName: "manychat",
      provider_name: "manychat",
      platform: "facebook",
      channel: "facebook",
      channelCode: "fb",
      channel_code: "fb",
      workerCode: WORKER_CODE,
      worker_code: WORKER_CODE,
      source: "فيسبوك",
      sourceName: "فيسبوك",
      source_name: "فيسبوك",

      pageId: identity.pageId,
      page_id: identity.pageId,
      participantId,
      participant_id: participantId,
      manychatContactId: identity.manychatContactId,
      manychat_contact_id: identity.manychatContactId,
      facebookPsid: participantId,
      facebook_psid: participantId,
      fbId: participantId,
      fb_id: participantId,
      fbPsid: participantId,
      fb_psid: participantId,
      canonicalParticipantId: participantId,
      canonical_participant_id: participantId,
      identitySource: identity.identitySource,
      identity_source: identity.identitySource,
      identityAliases: identity.aliases,
      identity_aliases: identity.aliases,
      conversationId,
      conversation_id: conversationId,

      customerName,
      customer_name: customerName,
      displayName: customerName,
      display_name: customerName,

      messageId: providerMessageId,
      message_id: providerMessageId,
      providerMessageId,
      provider_message_id: providerMessageId,
      text: messageText,
      message: messageText,
      payload: clean(payloadValue),
      messageType: payloadValue ? "quick_reply" : "text",
      message_type: payloadValue ? "quick_reply" : "text",
      attachments: [],
      hasAttachment: false,
      has_attachment: false,
      timestamp: timestampMs(
        first(
          body?.timestamp,
          body?.createdAt,
          body?.created_at,
          Date.now(),
        ),
      ),
      commentId: first(
        body?.commentId,
        body?.comment_id,
        body?.facebookCommentId,
        body?.facebook_comment_id,
        body?.socialCommentId,
        body?.social_comment_id,
      ),
      comment_id: first(
        body?.commentId,
        body?.comment_id,
        body?.facebookCommentId,
        body?.facebook_comment_id,
        body?.socialCommentId,
        body?.social_comment_id,
      ),
      socialActorId: first(body?.socialActorId, body?.social_actor_id),
      social_actor_id: first(body?.socialActorId, body?.social_actor_id),
      rawAutomation: sanitizeAutomationBody(body),
      raw_automation: sanitizeAutomationBody(body),
    };

    const result = await forwardToPlatform(
      platformPayload,
      env,
      "facebook",
    );

    if (!result.ok) {
      throw new Error(
        `Platform endpoint rejected compatibility event ${eventId}: HTTP ${result.status} ${result.error}`,
      );
    }

    const responseBody = {
      ok: true,
      accepted: true,
      version: VERSION,
      mode: "manychat_compatibility",
      eventId,
      conversationId,
      participantId,
      manychatContactId: identity.manychatContactId,
      identitySource: identity.identitySource,
      platformStatus: result.status,
      result: result.data?.result || result.data || null,
    };

    if (ctx?.waitUntil) {
      ctx.waitUntil(
        kvPutJson(
          env,
          "DEBUG_FACEBOOK_LAST_AUTOMATION_FORWARD",
          responseBody,
        ),
      );
    }

    return json(responseBody, 200);
  } catch (error) {
    const message = errorMessage(error);
    console.error("ManyChat compatibility forwarding failed", message);

    if (ctx?.waitUntil) {
      ctx.waitUntil(
        kvPutJson(env, "DEBUG_FACEBOOK_LAST_AUTOMATION_FORWARD", {
          ok: false,
          error: message,
        }),
      );
    }

    return json(
      {
        ok: false,
        status: "failed",
        error: message,
        version: VERSION,
      },
      502,
    );
  }
}

function manyChatContactData(body) {
  const candidates = [
    body?.fullContactData,
    body?.full_contact_data,
    body?.contactData,
    body?.contact_data,
    body?.subscriber,
    body?.contact,
  ];

  for (const candidate of candidates) {
    if (
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate)
    ) {
      return candidate;
    }
  }

  return {};
}

function getCustomerInputText(body) {
  return clean(
    first(
      body?.lastTextInput,
      body?.last_text_input,
      body?.lastInput,
      body?.last_input,
      body?.userMessage,
      body?.user_message,
      body?.customerMessage,
      body?.customer_message,
      body?.customerReply,
      body?.customer_reply,
    ),
  );
}

async function resolveManyChatAutomationIdentity(body, contactData, env) {
  const requestedConversationId = clean(
    first(body?.conversationId, body?.conversation_id, body?.convId),
  );

  const parsedConversation = parseFacebookConversationId(
    requestedConversationId,
  );

  const explicitFacebookPsid = clean(
    first(
      body?.facebookPsid,
      body?.facebook_psid,
      body?.fbPsid,
      body?.fb_psid,
      body?.psid,
      body?.pageScopedId,
      body?.page_scoped_id,
      body?.facebookUserId,
      body?.facebook_user_id,
      body?.metaSenderId,
      body?.meta_sender_id,
      body?.lastIncomingParticipantId,
      body?.last_incoming_participant_id,
      contactData?.facebook_psid,
      contactData?.fb_psid,
      contactData?.psid,
      contactData?.page_scoped_id,
    ),
  );

  const manychatContactId = clean(
    first(
      body?.manychatContactId,
      body?.manychat_contact_id,
      body?.subscriber_id,
      body?.subscriberId,
      body?.contactId,
      body?.contact_id,
      body?.manychatId,
      body?.manychat_id,
      contactData?.id,
      body?.id,
    ),
  );

  let subscriberInfo = null;

  if (manychatContactId) {
    subscriberInfo = await fetchManyChatSubscriberInfo(
      manychatContactId,
      env,
    ).catch(() => null);
  }

  const subscriberPsid = extractFacebookPsidFromManyChatInfo(
    subscriberInfo,
  );

  const pageId = clean(
    first(
      body?.pageId,
      body?.page_id,
      contactData?.page_id,
      subscriberInfo?.subscriber?.page_id,
      subscriberInfo?.root?.page_id,
      parsedConversation?.pageId,
      env?.FB_PAGE_ID,
    ),
  );

  const storedLink =
    manychatContactId && pageId
      ? await getIdentityLinkByManyChat(pageId, manychatContactId, env)
      : null;

  const linkedPsid = clean(storedLink?.facebookPsid);

  const candidates = [
    explicitFacebookPsid,
    subscriberPsid,
    linkedPsid,
    parsedConversation?.participantId,
  ]
    .map(clean)
    .filter(Boolean);

  let graphValidatedPsid = "";

  for (const candidate of candidates) {
    const graphName = await fetchFacebookGraphName(candidate, env).catch(
      () => "",
    );

    if (graphName) {
      graphValidatedPsid = candidate;
      break;
    }
  }

  const facebookPsid = clean(
    first(
      graphValidatedPsid,
      linkedPsid,
      subscriberPsid,
      explicitFacebookPsid,
      parsedConversation?.participantId,
    ),
  );

  const aliases = [
    ...new Set(
      [
        facebookPsid,
        manychatContactId,
        explicitFacebookPsid,
        subscriberPsid,
        linkedPsid,
        parsedConversation?.participantId,
      ]
        .map(clean)
        .filter(Boolean),
    ),
  ];

  let identitySource = "";

  if (graphValidatedPsid) identitySource = "graph_validated_psid";
  else if (linkedPsid) identitySource = "stored_identity_link";
  else if (subscriberPsid) identitySource = "manychat_subscriber_psid";
  else if (explicitFacebookPsid) identitySource = "explicit_psid";
  else if (parsedConversation?.participantId) {
    identitySource = "conversation_id";
  } else if (manychatContactId) {
    identitySource = "manychat_contact_without_psid";
  }

  if (pageId && facebookPsid) {
    await rememberIdentityLink(
      pageId,
      facebookPsid,
      facebookPsid,
      {
        manychatContactId,
        source: identitySource || "manychat_compatibility",
      },
      env,
    );
  }

  const displayName = clean(
    first(
      subscriberInfo?.subscriber?.name,
      subscriberInfo?.subscriber?.full_name,
      subscriberInfo?.root?.name,
      subscriberInfo?.root?.full_name,
      [
        clean(
          subscriberInfo?.subscriber?.first_name ||
            subscriberInfo?.root?.first_name,
        ),
        clean(
          subscriberInfo?.subscriber?.last_name ||
            subscriberInfo?.root?.last_name,
        ),
      ]
        .filter(Boolean)
        .join(" "),
    ),
  );

  return {
    facebookPsid,
    manychatContactId,
    pageId,
    aliases,
    identitySource,
    displayName,
  };
}

/* ========================================================================== */
/* IDENTITY CORRELATION                                                       */
/* ========================================================================== */

async function resolveMetaEventIdentity(event, env) {
  const pageId = clean(event?.pageId || env?.FB_PAGE_ID);
  const facebookPsid = clean(event?.customerId);

  if (!pageId || !facebookPsid) {
    return {
      linked: false,
      canonicalParticipantId: facebookPsid,
      manychatContactId: "",
      facebookPsid,
      aliases: [facebookPsid].filter(Boolean),
      conversationAliases: [],
      identitySource: "meta_psid_only",
    };
  }

  let link = await getIdentityLinkByPsid(pageId, facebookPsid, env);

  if (!link) {
    const info = await fetchManyChatSubscriberInfo(facebookPsid, env).catch(
      () => null,
    );

    const manychatContactId = extractManyChatContactId(info);

    if (manychatContactId) {
      link = await rememberIdentityLink(
        pageId,
        facebookPsid,
        facebookPsid,
        {
          manychatContactId,
          source: "manychat_lookup_by_psid",
        },
        env,
      );
    }
  }

  if (!link) {
    let pending = await findPendingCorrelationForMeta(event, env);

    if (!pending) {
      await sleep(META_CORRELATION_WAIT_MS);
      pending = await findPendingCorrelationForMeta(event, env);
    }

    if (pending?.manychatContactId) {
      link = await rememberIdentityLink(
        pageId,
        facebookPsid,
        facebookPsid,
        {
          manychatContactId: pending.manychatContactId,
          source: `correlated_${pending.source || "event"}`,
        },
        env,
      );
    }
  }

  const canonicalParticipantId = facebookPsid;
  const manychatContactId = clean(link?.manychatContactId);

  const aliases = [
    ...new Set(
      [
        facebookPsid,
        canonicalParticipantId,
        manychatContactId,
        ...(Array.isArray(link?.aliases) ? link.aliases : []),
      ]
        .map(clean)
        .filter(Boolean),
    ),
  ];

  const conversationAliases = aliases.map((id) =>
    facebookConversationId(pageId, id),
  );

  return {
    linked: Boolean(link),
    canonicalParticipantId,
    manychatContactId,
    facebookPsid,
    aliases,
    conversationAliases,
    identitySource:
      clean(link?.source) ||
      (link ? "stored_identity_link" : "meta_psid_unresolved"),
  };
}

async function rememberAutomationCorrelation(record, body, env) {
  const pageId = clean(record?.pageId);
  const manychatContactId = clean(record?.manychatContactId);

  if (!pageId || !manychatContactId) return;

  const storedRecord = {
    pageId,
    manychatContactId,
    canonicalParticipantId: clean(
      record?.canonicalParticipantId || manychatContactId,
    ),
    customerName: clean(record?.customerName),
    source: "manychat_compatibility",
    createdAt: Number(record?.createdAt || Date.now()),
  };

  const tokens = correlationTokens([
    record?.messageText,
    record?.payloadValue,
    body?.lastTextInput,
    body?.last_text_input,
    body?.message,
    body?.text,
    body?.previewText,
    body?.preview_text,
  ]);

  await storePendingCorrelationRecords(
    pageId,
    storedRecord.customerName,
    tokens,
    storedRecord,
    env,
  );
}

async function rememberOutboundCorrelation(target, body, env) {
  const pageId = clean(first(target?.pageId, env?.FB_PAGE_ID));
  const parsed = parseFacebookConversationId(clean(target?.conversationId));

  const manychatContactId = clean(
    first(
      target?.manychatContactId,
      body?.manychatContactId,
      body?.manychat_contact_id,
    ),
  );

  const canonicalParticipantId = clean(
    first(parsed?.participantId, target?.participantId),
  );

  if (!pageId || !canonicalParticipantId) return;

  const record = {
    pageId,
    manychatContactId: manychatContactId || canonicalParticipantId,
    canonicalParticipantId,
    customerName: clean(
      first(
        body?.customerName,
        body?.customer_name,
        body?.displayName,
        body?.display_name,
      ),
    ),
    source: "outbound_send",
    createdAt: Date.now(),
  };

  const tokens = correlationTokens([
    body?.text,
    body?.message,
    ...normalizeButtons(body).flatMap((button) => [
      button.title,
      button.payload,
    ]),
  ]);

  await storePendingCorrelationRecords(
    pageId,
    record.customerName,
    tokens,
    record,
    env,
  );
}

async function findPendingCorrelationForMeta(event, env) {
  const pageId = clean(event?.pageId || env?.FB_PAGE_ID);
  const name = event?.isEcho ? "" : clean(event?.displayName);

  const tokens = correlationTokens([
    event?.content?.text,
    event?.content?.buttonTitle,
    event?.content?.payload,
  ]);

  for (const token of tokens) {
    if (name) {
      const precise = await readPendingCorrelationCandidates(
        pendingCorrelationKey(pageId, name, token),
        env,
      );

      const match = uniqueFreshCorrelation(precise);
      if (match) return match;
    }

    const broad = await readPendingCorrelationCandidates(
      pendingCorrelationKey(pageId, "", token),
      env,
    );

    const match = uniqueFreshCorrelation(broad);
    if (match) return match;
  }

  return null;
}

async function storePendingCorrelationRecords(
  pageId,
  customerName,
  tokens,
  record,
  env,
) {
  for (const token of tokens) {
    if (customerName) {
      await appendPendingCorrelation(
        pendingCorrelationKey(pageId, customerName, token),
        record,
        env,
      );
    }

    await appendPendingCorrelation(
      pendingCorrelationKey(pageId, "", token),
      record,
      env,
    );
  }
}

function correlationTokens(values) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map(normalizeCorrelationText)
        .filter(Boolean),
    ),
  ];
}

function normalizeCorrelationText(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function pendingCorrelationKey(pageId, customerName, token) {
  return `pending:${clean(pageId)}:${normalizeCorrelationText(
    customerName,
  )}:${normalizeCorrelationText(token)}`;
}

async function appendPendingCorrelation(key, record, env) {
  const existing = await readPendingCorrelationCandidates(key, env);
  const now = Date.now();

  const fresh = existing.filter(
    (item) =>
      now - Number(item?.createdAt || 0) <=
      PENDING_CORRELATION_TTL_SECONDS * 1000,
  );

  fresh.push(record);

  const deduped = [];
  const seen = new Set();

  for (const item of fresh.reverse()) {
    const signature = `${clean(item?.manychatContactId)}:${clean(
      item?.canonicalParticipantId,
    )}`;

    if (!signature || seen.has(signature)) continue;

    seen.add(signature);
    deduped.push(item);

    if (deduped.length >= 5) break;
  }

  deduped.reverse();
  memoryPendingCorrelations.set(key, deduped);

  await statePutJson(
    env,
    `facebook:${key}`,
    deduped,
    PENDING_CORRELATION_TTL_SECONDS,
  );
}

async function readPendingCorrelationCandidates(key, env) {
  const memory = memoryPendingCorrelations.get(key);

  if (Array.isArray(memory)) return memory;

  const stored = await stateGetJson(env, `facebook:${key}`);
  const value = Array.isArray(stored) ? stored : [];

  if (value.length) {
    memoryPendingCorrelations.set(key, value);
  }

  return value;
}

function uniqueFreshCorrelation(candidates) {
  const now = Date.now();

  const fresh = (Array.isArray(candidates) ? candidates : []).filter(
    (item) =>
      item?.manychatContactId &&
      now - Number(item?.createdAt || 0) <=
        PENDING_CORRELATION_TTL_SECONDS * 1000,
  );

  const unique = new Map();

  for (const item of fresh) {
    unique.set(clean(item.manychatContactId), item);
  }

  return unique.size === 1 ? [...unique.values()][0] : null;
}

async function rememberIdentityLink(
  pageId,
  facebookPsid,
  canonicalParticipantId,
  details,
  env,
) {
  const manychatContactId = clean(details?.manychatContactId);

  const link = {
    pageId: clean(pageId),
    facebookPsid: clean(facebookPsid),
    canonicalParticipantId: clean(
      first(canonicalParticipantId, facebookPsid),
    ),
    manychatContactId,
    aliases: [
      ...new Set(
        [facebookPsid, canonicalParticipantId, manychatContactId]
          .map(clean)
          .filter(Boolean),
      ),
    ],
    source: clean(details?.source) || "identity_link",
    updatedAt: Date.now(),
  };

  if (!link.pageId || !link.facebookPsid) return null;

  const psidKey = identityPsidKey(link.pageId, link.facebookPsid);
  memoryIdentityLinks.set(psidKey, link);

  await statePutJson(
    env,
    `facebook:${psidKey}`,
    link,
    IDENTITY_LINK_TTL_SECONDS,
  );

  if (link.manychatContactId) {
    const manychatKey = identityManyChatKey(
      link.pageId,
      link.manychatContactId,
    );

    memoryIdentityLinks.set(manychatKey, link);

    await statePutJson(
      env,
      `facebook:${manychatKey}`,
      link,
      IDENTITY_LINK_TTL_SECONDS,
    );
  }

  return link;
}

async function getIdentityLinkByPsid(pageId, facebookPsid, env) {
  return getIdentityLink(identityPsidKey(pageId, facebookPsid), env);
}

async function getIdentityLinkByManyChat(pageId, manychatContactId, env) {
  return getIdentityLink(
    identityManyChatKey(pageId, manychatContactId),
    env,
  );
}

async function getIdentityLink(key, env) {
  const memory = memoryIdentityLinks.get(key);

  if (memory) return memory;

  const stored = await stateGetJson(env, `facebook:${key}`);

  if (stored && typeof stored === "object") {
    memoryIdentityLinks.set(key, stored);
    return stored;
  }

  return null;
}

function identityPsidKey(pageId, facebookPsid) {
  return `identity:psid:${clean(pageId)}:${clean(facebookPsid)}`;
}

function identityManyChatKey(pageId, manychatContactId) {
  return `identity:manychat:${clean(pageId)}:${clean(
    manychatContactId,
  )}`;
}

function extractManyChatContactId(info) {
  return clean(
    first(
      info?.subscriber?.id,
      info?.subscriber?.subscriber_id,
      info?.subscriber?.subscriberId,
      info?.root?.id,
      info?.root?.subscriber_id,
      info?.root?.subscriberId,
      info?.raw?.data?.id,
      info?.raw?.data?.subscriber_id,
    ),
  );
}

function extractFacebookPsidFromManyChatInfo(info) {
  return clean(
    first(
      info?.subscriber?.facebook_psid,
      info?.subscriber?.fb_psid,
      info?.subscriber?.psid,
      info?.subscriber?.page_scoped_id,
      info?.subscriber?.facebook_id,
      info?.subscriber?.fb_id,
      info?.root?.facebook_psid,
      info?.root?.fb_psid,
      info?.root?.psid,
      info?.root?.page_scoped_id,
      info?.root?.facebook_id,
      info?.root?.fb_id,
    ),
  );
}

async function statePutJson(env, key, value, ttlSeconds) {
  const kv = identityKv(env);

  if (kv?.put) {
    try {
      await kv.put(key, JSON.stringify(value), {
        expirationTtl: ttlSeconds,
      });
    } catch (error) {
      console.error("Facebook identity KV put failed", errorMessage(error));
    }
  }

  const cache = globalThis?.caches?.default;

  if (cache?.put) {
    try {
      await cache.put(
        stateCacheRequest(key),
        new Response(JSON.stringify(value), {
          headers: {
            "content-type": "application/json",
            "cache-control": `public, max-age=${ttlSeconds}`,
          },
        }),
      );
    } catch (error) {
      console.error(
        "Facebook identity cache put failed",
        errorMessage(error),
      );
    }
  }
}

async function stateGetJson(env, key) {
  const kv = identityKv(env);

  if (kv?.get) {
    try {
      const raw = await kv.get(key);
      if (raw) return JSON.parse(raw);
    } catch (error) {
      console.error("Facebook identity KV get failed", errorMessage(error));
    }
  }

  const cache = globalThis?.caches?.default;

  if (cache?.match) {
    try {
      const response = await cache.match(stateCacheRequest(key));
      if (response) return await response.json();
    } catch (error) {
      console.error(
        "Facebook identity cache get failed",
        errorMessage(error),
      );
    }
  }

  return null;
}

function stateCacheRequest(key) {
  return new Request(
    `https://mzj-facebook-identity.invalid/${encodeURIComponent(
      stableEventId(key),
    )}`,
  );
}

function identityKv(env) {
  return (
    env?.FACEBOOK_IDENTITY_KV || env?.IDENTITY_KV || env?.DEBUG_KV || null
  );
}

function sanitizeAutomationBody(body) {
  const blocked = new Set([
    "token",
    "access_token",
    "api_token",
    "secret",
    "authorization",
    "password",
  ]);

  const output = {};

  for (const [key, value] of Object.entries(body || {})) {
    if (blocked.has(String(key).toLowerCase())) continue;
    if (value === undefined) continue;
    output[key] = value;
  }

  return output;
}

/* ========================================================================== */
/* FACEBOOK SEND                                                              */
/* ========================================================================== */

async function handleFacebookSend(request, env, ctx) {
  const body = await safeJson(request);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json(
      {
        ok: false,
        status: "failed",
        error: "Invalid JSON",
        version: VERSION,
      },
      400,
    );
  }

  const target = await resolveFacebookSendTarget(body, env);

  if (!target.participantId && !target.manychatContactId && !target.commentId) {
    return json(
      {
        ok: false,
        status: "failed",
        error:
          "participantId/psid, manychatContactId, commentId, or a valid facebook:PAGE_ID:PSID conversationId is required",
        version: VERSION,
      },
      400,
    );
  }

  const type = outboundType(body);

  if (!type) {
    return json(
      {
        ok: false,
        status: "failed",
        error: "missing text, buttons or media",
        version: VERSION,
      },
      400,
    );
  }

  const privateReplyRequested =
    toBool(body?.privateReply ?? body?.private_reply) ||
    Boolean(target.commentId && !target.participantId);

  if (privateReplyRequested && target.commentId && (type !== "text" || normalizeButtons(body).length)) {
    return json(
      {
        ok: false,
        status: "failed",
        error: "Facebook private reply to a comment supports text only",
        commentId: target.commentId,
        version: VERSION,
      },
      400,
    );
  }

  if (type === "text" || type === "buttons") {
    await rememberOutboundCorrelation(target, body, env);
  }

  let result;

  if (type === "media") {
    result = await sendFacebookMedia(env, {
      participantId: target.participantId,
      pageId: target.pageId,
      mediaUrl: clean(
        first(
          body?.media_url,
          body?.mediaUrl,
          body?.file_url,
          body?.fileUrl,
          body?.attachment_url,
          body?.attachmentUrl,
        ),
      ),
      mediaType: normalizeOutboundFacebookMediaType(
        first(
          body?.media_type,
          body?.mediaType,
          body?.attachment_type,
          body?.attachmentType,
          body?.type,
          "file",
        ),
      ),
      messagingType: clean(
        first(body?.messaging_type, body?.messagingType, "RESPONSE"),
      ),
      tag: clean(first(body?.tag, body?.message_tag, body?.messageTag)),
      isReusable:
        body?.is_reusable === undefined && body?.isReusable === undefined
          ? true
          : toBool(body?.is_reusable ?? body?.isReusable),
    });
  } else {
    result = await sendFacebookTextOrButtons(env, target, { ...body, privateReply: privateReplyRequested });
  }

  const responseBody = {
    ...result,
    provider: "facebook",
    platform: "facebook",
    channel: "facebook",
    workerCode: WORKER_CODE,
    worker_code: WORKER_CODE,
    message_type: type,
    participantId: target.participantId,
    manychatContactId: target.manychatContactId,
    pageId: target.pageId,
    conversationId: target.conversationId,
    commentId: target.commentId,
    socialActorId: target.socialActorId,
    identityResolution: target.identityResolution,
    privateReply: result?.private_reply === true,
    private_reply: result?.private_reply === true,
    version: VERSION,
  };

  if (ctx?.waitUntil) {
    ctx.waitUntil(
      kvPutJson(env, "DEBUG_FACEBOOK_LAST_SEND", responseBody),
    );
  }

  return json(responseBody, result.ok ? 200 : 502);
}

async function resolveFacebookSendTarget(body, env) {
  const conversationId = clean(
    first(body?.convId, body?.conversationId, body?.conversation_id),
  );

  const parsed = parseFacebookConversationId(conversationId);

  let pageId = clean(
    first(body?.pageId, body?.page_id, parsed?.pageId, env?.FB_PAGE_ID),
  );

  let participantId = clean(
    first(
      body?.participantId,
      body?.participant_id,
      body?.psid,
      body?.fbPsid,
      body?.fb_psid,
      body?.facebookPsid,
      body?.facebook_psid,
      body?.recipientId,
      body?.recipient_id,
      parsed?.participantId,
    ),
  );

  let manychatContactId = clean(
    first(
      body?.manychatContactId,
      body?.manychat_contact_id,
      body?.subscriberId,
      body?.subscriber_id,
    ),
  );

  const commentId = clean(
    first(
      body?.commentId,
      body?.comment_id,
      body?.facebookCommentId,
      body?.facebook_comment_id,
      body?.socialCommentId,
      body?.social_comment_id,
    ),
  );

  const socialActorId = clean(
    first(body?.socialActorId, body?.social_actor_id),
  );

  if (!pageId) pageId = clean(env?.FB_PAGE_ID);

  let identityResolution = participantId ? "request_psid" : "";

  if (!participantId && pageId && manychatContactId) {
    const stored = await getIdentityLinkByManyChat(pageId, manychatContactId, env);
    participantId = clean(stored?.facebookPsid);
    if (participantId) identityResolution = "stored_identity_link_by_manychat";

    if (!participantId) {
      const info = await fetchManyChatSubscriberInfo(manychatContactId, env).catch(() => null);
      const resolvedPsid = extractFacebookPsidFromManyChatInfo(info);
      const resolvedManyChatId = extractManyChatContactId(info);
      if (resolvedManyChatId) manychatContactId = resolvedManyChatId;
      if (resolvedPsid) {
        participantId = resolvedPsid;
        identityResolution = "manychat_getinfo_psid";
        await rememberIdentityLink(pageId, participantId, participantId, {
          manychatContactId,
          source: identityResolution,
        }, env);
      }
    }
  }

  if (!participantId && pageId && socialActorId) {
    const stored = await getIdentityLinkByPsid(pageId, socialActorId, env);
    const linkedPsid = clean(stored?.facebookPsid);
    if (linkedPsid) {
      participantId = linkedPsid;
      manychatContactId = clean(stored?.manychatContactId || manychatContactId);
      identityResolution = "stored_identity_link_by_social_actor";
    }
  }

  if (!participantId && socialActorId && manychatToken(env)) {
    const info = await fetchManyChatSubscriberInfo(socialActorId, env).catch(() => null);
    const resolvedPsid = extractFacebookPsidFromManyChatInfo(info);
    const resolvedManyChatId = extractManyChatContactId(info);
    if (resolvedPsid) {
      participantId = resolvedPsid;
      manychatContactId = clean(resolvedManyChatId || manychatContactId);
      identityResolution = "manychat_lookup_by_social_actor";
      if (pageId) {
        await rememberIdentityLink(pageId, participantId, participantId, {
          manychatContactId,
          source: identityResolution,
        }, env);
      }
    }
  }

  return {
    conversationId:
      conversationId ||
      (pageId && participantId
        ? facebookConversationId(pageId, participantId)
        : ""),
    pageId,
    participantId,
    manychatContactId,
    commentId,
    socialActorId,
    identityResolution: identityResolution || (commentId ? "comment_private_reply" : "unresolved"),
  };
}

function outboundType(body) {
  const requested = clean(body?.type).toLowerCase();
  const textValue = clean(first(body?.message, body?.text));
  const buttons = normalizeButtons(body);

  const mediaUrl = clean(
    first(
      body?.media_url,
      body?.mediaUrl,
      body?.file_url,
      body?.fileUrl,
      body?.attachment_url,
      body?.attachmentUrl,
    ),
  );

  if (
    ["media", "image", "audio", "video", "file", "document"].includes(
      requested,
    )
  ) {
    return mediaUrl ? "media" : "";
  }

  if (requested === "buttons" || requested === "quick_replies") {
    return buttons.length ? "buttons" : "";
  }

  if (requested === "text") {
    if (buttons.length) return "buttons";
    return textValue ? "text" : "";
  }

  if (mediaUrl) return "media";
  if (buttons.length) return "buttons";
  if (textValue) return "text";

  return "";
}

function normalizeButtons(body) {
  const source =
    (Array.isArray(body?.buttons) && body.buttons) ||
    (Array.isArray(body?.quickReplies) && body.quickReplies) ||
    (Array.isArray(body?.quick_replies) && body.quick_replies) ||
    (Array.isArray(body?.choices) && body.choices) ||
    [];

  return source
    .map((item, index) => {
      if (typeof item === "string") {
        return {
          title: clean(item).slice(0, 20),
          payload: clean(item),
        };
      }

      return {
        title: first(item?.title, item?.label, item?.text).slice(0, 20),
        payload: first(
          item?.payload,
          item?.id,
          item?.value,
          `choice_${index + 1}`,
        ),
      };
    })
    .filter((item) => item.title && item.payload)
    .slice(0, 13);
}

async function sendFacebookTextOrButtons(env, target, body) {
  const textValue = clean(first(body?.text, body?.message));
  const buttons = normalizeButtons(body);
  const attempts = [];
  const privateReplyRequested = toBool(body?.privateReply ?? body?.private_reply);

  const message = buttons.length
    ? {
        text: textValue || "اختر من القائمة",
        quick_replies: buttons.map((button) => ({
          content_type: "text",
          title: button.title,
          payload: button.payload,
        })),
      }
    : {
        text: textValue,
      };

  if (clean(target?.participantId)) {
    const graph = await sendFacebookGraphMessage(env, {
      participantId: target.participantId,
      pageId: target.pageId,
      message,
      messagingType: clean(
        first(body?.messaging_type, body?.messagingType, "RESPONSE"),
      ),
      tag: clean(first(body?.tag, body?.message_tag, body?.messageTag)),
    });

    attempts.push(providerAttemptSummary("graph", graph));

    if (graph.ok) {
      return {
        ...graph,
        send_method: "graph",
        private_reply: false,
        attempts,
      };
    }
  }

  const canUseManyChat = Boolean(
    !buttons.length &&
      textValue &&
      manychatToken(env) &&
      clean(target?.manychatContactId),
  );

  if (canUseManyChat) {
    const manychat = await sendManyChatText(
      target.manychatContactId,
      textValue,
      env,
    );

    attempts.push(providerAttemptSummary("manychat", manychat));

    if (manychat.ok) {
      return {
        ...manychat,
        send_method: "manychat",
        private_reply: false,
        attempts,
      };
    }
  }

  const canUsePrivateReply = Boolean(
    privateReplyRequested &&
      !buttons.length &&
      textValue &&
      clean(target?.commentId),
  );

  if (canUsePrivateReply) {
    const privateReply = await sendFacebookCommentPrivateReply(env, {
      commentId: target.commentId,
      text: textValue,
    });
    attempts.push(providerAttemptSummary("facebook_private_reply", privateReply));
    if (privateReply.ok) {
      return {
        ...privateReply,
        send_method: "graph_private_reply",
        private_reply: true,
        comment_id: target.commentId,
        commentId: target.commentId,
        attempts,
      };
    }
  }

  const errors = attempts.map((item) => item.error).filter(Boolean);
  return {
    ...failedProviderResult(first(errors.join(" | "), "Facebook send failed")),
    send_method: "",
    private_reply: false,
    attempts,
  };
}

async function sendFacebookMedia(env, input) {
  const mediaUrl = clean(input?.mediaUrl);
  const participantId = clean(input?.participantId);

  if (!mediaUrl) return failedProviderResult("missing media_url");
  if (!participantId) {
    return failedProviderResult("missing participantId/psid");
  }

  const type = normalizeOutboundFacebookMediaType(input?.mediaType);

  const attachment = {
    type,
    payload: {
      url: mediaUrl,
      is_reusable: input?.isReusable !== false,
    },
  };

  const result = await sendFacebookGraphMessage(env, {
    participantId,
    pageId: clean(input?.pageId),
    message: {
      attachment,
    },
    messagingType: input?.messagingType,
    tag: input?.tag,
  });

  return {
    ...result,
    send_method: "graph",
    media_type: type,
    media_url: mediaUrl,
    attempts: [providerAttemptSummary("graph", result)],
  };
}

async function sendFacebookCommentPrivateReply(env, input) {
  const pageToken = clean(env?.FB_PAGE_ACCESS_TOKEN);
  const commentId = clean(input?.commentId);
  const textValue = clean(input?.text);

  if (!pageToken) return failedProviderResult("FB_PAGE_ACCESS_TOKEN missing");
  if (!commentId) return failedProviderResult("commentId missing");
  if (!textValue) return failedProviderResult("private reply text missing");

  const endpoint = `${graphBase(env)}/${encodeURIComponent(commentId)}/private_replies`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${pageToken}`,
      },
      body: JSON.stringify({ message: textValue }),
    });

    const rawText = await response.text();
    const raw = parseJson(rawText);
    const normalized = normalizeProviderResponse(
      response.status,
      response.ok,
      raw,
      rawText,
    );
    const privateReplyMessageId = first(
      normalized.provider_message_id,
      raw?.message_id,
      raw?.messageId,
      raw?.id,
    );

    const result = {
      ...normalized,
      ok: normalized.ok || Boolean(privateReplyMessageId),
      status: normalized.ok || privateReplyMessageId ? "sent" : "failed",
      provider_status: normalized.ok || privateReplyMessageId ? "sent" : "failed",
      provider_message_id: privateReplyMessageId,
      providerMessageId: privateReplyMessageId,
      message_id: privateReplyMessageId,
      recipient_id: first(raw?.recipient_id, raw?.recipientId),
      private_reply: true,
      comment_id: commentId,
      commentId,
    };

    if (!result.ok) {
      console.error("Facebook private reply rejected", {
        endpoint,
        httpStatus: result.httpStatus,
        code: raw?.error?.code || null,
        subcode: raw?.error?.error_subcode || null,
        type: raw?.error?.type || null,
        message: result.error,
        fbtraceId: raw?.error?.fbtrace_id || null,
      });
    }

    return result;
  } catch (error) {
    const failed = failedProviderResult(errorMessage(error));
    console.error("Facebook private reply request failed", failed.error);
    return {
      ...failed,
      private_reply: true,
      comment_id: commentId,
      commentId,
    };
  }
}

async function sendManyChatText(subscriberId, textValue, env) {
  const token = manychatToken(env);

  if (!token) return failedProviderResult("MANYCHAT_API_TOKEN missing");

  if (!clean(subscriberId) || !clean(textValue)) {
    return failedProviderResult("subscriberId/text missing");
  }

  const payload = {
    subscriber_id: clean(subscriberId),
    data: {
      version: "v2",
      content: {
        messages: [
          {
            type: "text",
            text: clean(textValue),
          },
        ],
      },
    },
  };

  try {
    const response = await fetch(manychatSendEndpoint(env), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    const raw = parseJson(rawText);

    return normalizeProviderResponse(
      response.status,
      response.ok,
      raw,
      rawText,
    );
  } catch (error) {
    return failedProviderResult(errorMessage(error));
  }
}

async function sendFacebookGraphMessage(env, input) {
  const pageToken = clean(env?.FB_PAGE_ACCESS_TOKEN);
  const participantId = clean(input?.participantId);
  const pageId = clean(input?.pageId || env?.FB_PAGE_ID);

  if (!pageToken) {
    return failedProviderResult("FB_PAGE_ACCESS_TOKEN missing");
  }

  if (!participantId) {
    return failedProviderResult("participantId/psid missing");
  }

  const payload = {
    recipient: {
      id: participantId,
    },
    message: input?.message || {},
  };

  const messagingType = clean(input?.messagingType || "RESPONSE");
  const tag = clean(input?.tag);

  if (tag) {
    payload.messaging_type = "MESSAGE_TAG";
    payload.tag = tag;
  } else if (messagingType) {
    payload.messaging_type = messagingType;
  }

  try {
    const endpoint = facebookSendEndpoint(env, pageId);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${pageToken}`,
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    const raw = parseJson(rawText);
    const normalized = normalizeProviderResponse(
      response.status,
      response.ok,
      raw,
      rawText,
    );

    if (!normalized.ok) {
      console.error("Facebook Graph send rejected", {
        endpoint,
        httpStatus: normalized.httpStatus,
        code: raw?.error?.code || null,
        subcode: raw?.error?.error_subcode || null,
        type: raw?.error?.type || null,
        message: normalized.error,
        fbtraceId: raw?.error?.fbtrace_id || null,
      });
    }

    return normalized;
  } catch (error) {
    const failed = failedProviderResult(errorMessage(error));
    console.error("Facebook Graph send request failed", failed.error);
    return failed;
  }
}

function normalizeProviderResponse(httpStatus, httpOk, raw, rawText) {
  const providerMessageId = providerMessageIdFrom(raw);

  const statusValue = normalizeStatus(
    first(
      raw?.provider_status,
      raw?.providerStatus,
      raw?.status,
      raw?.data?.status,
      raw?.result?.status,
      raw?.response?.status,
    ),
  );

  const graphError =
    raw?.error && typeof raw.error === "object" ? raw.error : null;

  const explicitFailure =
    Boolean(graphError) ||
    raw?.ok === false ||
    raw?.success === false ||
    raw?.status === false ||
    FAILURE_STATUSES.has(statusValue);

  const explicitSuccess =
    raw?.ok === true ||
    raw?.success === true ||
    raw?.status === true ||
    SUCCESS_STATUSES.has(statusValue);

  const accepted =
    Boolean(providerMessageId) ||
    explicitSuccess ||
    (httpOk && !explicitFailure);

  const error = accepted
    ? ""
    : first(
        graphError?.message,
        raw?.error,
        raw?.message,
        raw?.data?.message,
        rawText,
        `HTTP ${httpStatus}`,
      );

  return {
    ok: accepted,
    status: accepted ? "sent" : "failed",
    provider_status: accepted ? "sent" : "failed",
    provider_message_id: providerMessageId || "",
    providerMessageId: providerMessageId || "",
    message_id: providerMessageId || "",
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
    message_id: "",
    http_status: 0,
    httpStatus: 0,
    error: clean(message) || "Facebook request failed",
    raw: null,
  };
}

function providerMessageIdFrom(raw) {
  return first(
    raw?.provider_message_id,
    raw?.providerMessageId,
    raw?.message_id,
    raw?.messageId,
    raw?.mid,
    raw?.data?.provider_message_id,
    raw?.data?.providerMessageId,
    raw?.data?.message_id,
    raw?.data?.messageId,
    raw?.result?.provider_message_id,
    raw?.result?.message_id,
    raw?.response?.provider_message_id,
    raw?.response?.message_id,
  );
}

function providerAttemptSummary(provider, result) {
  return {
    provider,
    ok: result?.ok === true,
    httpStatus: Number(result?.http_status || result?.httpStatus || 0),
    providerMessageId: clean(
      result?.provider_message_id ||
        result?.providerMessageId ||
        result?.message_id,
    ),
    error: clean(result?.error),
  };
}

/* ========================================================================== */
/* PLATFORM FORWARDING + MEDIA                                                */
/* ========================================================================== */

async function forwardToPlatform(payload, env, sourceHeader) {
  const endpoint =
    clean(env?.PLATFORM_INBOUND_URL) || DEFAULT_PLATFORM_INBOUND_URL;
  const secret = clean(env?.MZJ_GATEWAY_SECRET);

  if (!endpoint) {
    return {
      ok: false,
      status: 0,
      error: "Missing PLATFORM_INBOUND_URL",
    };
  }

  if (!secret) {
    return {
      ok: false,
      status: 0,
      error: "Missing MZJ_GATEWAY_SECRET",
    };
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-mzj-gateway-secret": secret,
        "x-mzj-source": clean(sourceHeader) || "facebook",
        "x-event-id": clean(payload?.eventId || payload?.event_id),
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    const data = parseJson(rawText);

    return {
      ok: response.ok && data?.ok !== false,
      status: response.status,
      data,
      error: response.ok
        ? ""
        : first(data?.error, rawText, `HTTP ${response.status}`),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: errorMessage(error),
    };
  }
}

async function storeInboundMedia(env, input) {
  const sourceUrl = clean(input?.sourceUrl);

  if (!/^https?:\/\//i.test(sourceUrl)) {
    throw new Error("Facebook attachment has no downloadable URL");
  }

  const mediaResponse = await fetchFacebookAttachment(sourceUrl, env);

  if (!mediaResponse.ok) {
    throw new Error(
      `Failed to download Facebook attachment: HTTP ${mediaResponse.status}`,
    );
  }

  const bytes = await mediaResponse.arrayBuffer();

  if (!bytes.byteLength) {
    throw new Error("Facebook attachment download returned an empty file");
  }

  const maxBytes = positiveInteger(
    env?.MAX_MEDIA_BYTES,
    DEFAULT_MAX_MEDIA_BYTES,
  );

  if (bytes.byteLength > maxBytes) {
    throw new Error(
      `Facebook attachment exceeds the ${maxBytes} byte platform limit`,
    );
  }

  const mediaType = normalizeMediaType(input?.mediaType);
  const responseMime = clean(
    mediaResponse.headers.get("content-type"),
  ).split(";")[0];

  const mimeType =
    responseMime ||
    clean(input?.mimeType) ||
    guessMimeType(sourceUrl, mediaType);

  const dispositionName = contentDispositionFileName(
    mediaResponse.headers.get("content-disposition"),
  );

  const fileName = ensureMediaFileName(
    first(
      input?.fileName,
      dispositionName,
      fileNameFromUrl(mediaResponse.url || sourceUrl),
    ),
    mediaType,
    mimeType,
    input?.eventId,
  );

  const endpoint = platformMediaEndpoint(env);
  const secret = clean(env?.MZJ_GATEWAY_SECRET);

  if (!endpoint || !secret) {
    throw new Error("Platform inbound media endpoint is not configured");
  }

  const prepareResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-mzj-gateway-secret": secret,
      "x-mzj-source": "facebook",
      "x-event-id": clean(input?.eventId),
    },
    body: JSON.stringify({
      action: "prepare_upload",
      source: "facebook",
      eventKey: clean(input?.eventId),
      conversationId: clean(input?.conversationId),
      pageId: clean(input?.pageId),
      participantId: clean(input?.participantId),
      mediaType,
      fileName,
      mimeType,
      fileSize: bytes.byteLength,
      isSensitive: true,
    }),
  });

  const prepareText = await prepareResponse.text();
  const prepared = parseJson(prepareText);

  if (
    !prepareResponse.ok ||
    prepared?.ok === false ||
    !clean(prepared?.uploadUrl) ||
    !clean(prepared?.storageKey)
  ) {
    throw new Error(
      first(
        prepared?.error,
        prepareText,
        `Platform media prepare failed: HTTP ${prepareResponse.status}`,
      ),
    );
  }

  const uploadResponse = await fetch(clean(prepared.uploadUrl), {
    method: "PUT",
    headers: {
      "content-type": mimeType || "application/octet-stream",
    },
    body: bytes,
  });

  if (!uploadResponse.ok) {
    throw new Error(
      `Platform media upload failed: HTTP ${uploadResponse.status}`,
    );
  }

  return {
    assetId: clean(prepared.assetId),
    storageKey: clean(prepared.storageKey),
    fileName,
    mimeType,
    fileSize: bytes.byteLength,
  };
}

async function fetchFacebookAttachment(url, env) {
  const attempts = [];
  const pageToken = clean(env?.FB_PAGE_ACCESS_TOKEN);

  attempts.push({
    headers: {
      accept: "*/*",
    },
    url,
  });

  if (pageToken) {
    attempts.push({
      headers: {
        accept: "*/*",
        authorization: `Bearer ${pageToken}`,
      },
      url,
    });

    try {
      const withToken = new URL(url);

      if (!withToken.searchParams.has("access_token")) {
        withToken.searchParams.set("access_token", pageToken);
      }

      attempts.push({
        headers: {
          accept: "*/*",
        },
        url: withToken.toString(),
      });
    } catch {
      // Ignore invalid URL fallback construction.
    }
  }

  let lastResponse = null;

  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url, {
        method: "GET",
        headers: attempt.headers,
        redirect: "follow",
      });

      lastResponse = response;

      if (response.ok) return response;
    } catch {
      // Try the next safe download strategy.
    }
  }

  return (
    lastResponse ||
    new Response("Attachment download failed", {
      status: 502,
    })
  );
}

function platformMediaEndpoint(env) {
  const override = clean(env?.PLATFORM_MEDIA_URL);

  if (override) return override;

  const inbound =
    clean(env?.PLATFORM_INBOUND_URL) || DEFAULT_PLATFORM_INBOUND_URL;

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

/* ========================================================================== */
/* FACEBOOK + MANYCHAT LOOKUPS                                                */
/* ========================================================================== */

async function fetchFacebookName(participantId, env) {
  const fromManyChat = await fetchManyChatName(participantId, env).catch(
    () => "",
  );

  if (fromManyChat) return fromManyChat;

  return fetchFacebookGraphName(participantId, env).catch(() => "");
}

async function fetchManyChatSubscriberInfo(subscriberId, env) {
  const token = manychatToken(env);

  if (!token || !clean(subscriberId)) return null;

  const endpointTemplate = clean(env?.MANYCHAT_SUBSCRIBER_URL);

  const endpoint = endpointTemplate
    ? endpointTemplate.replaceAll(
        "{subscriber_id}",
        encodeURIComponent(clean(subscriberId)),
      )
    : `https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${encodeURIComponent(
        clean(subscriberId),
      )}`;

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) return null;

  const raw = await response.json().catch(() => null);
  const root = raw?.data || raw || {};
  const subscriber = root?.subscriber || root;

  return {
    raw,
    root,
    subscriber,
  };
}

async function fetchManyChatName(subscriberId, env) {
  const info = await fetchManyChatSubscriberInfo(subscriberId, env);

  if (!info) return "";

  const root = info.root || {};
  const subscriber = info.subscriber || root;

  const direct = first(
    subscriber?.name,
    subscriber?.full_name,
    root?.name,
    root?.full_name,
  );

  if (direct) return direct;

  return [
    first(subscriber?.first_name, root?.first_name),
    first(subscriber?.last_name, root?.last_name),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

async function fetchFacebookGraphName(participantId, env) {
  const token = clean(env?.FB_PAGE_ACCESS_TOKEN);

  if (!token || !clean(participantId)) return "";

  const url = new URL(
    `${graphBase(env)}/${encodeURIComponent(clean(participantId))}`,
  );

  url.searchParams.set("fields", "first_name,last_name,name");
  url.searchParams.set("access_token", token);

  const response = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) return "";

  const raw = await response.json().catch(() => null);

  return first(
    [clean(raw?.first_name), clean(raw?.last_name)]
      .filter(Boolean)
      .join(" "),
    raw?.name,
  );
}

/* ========================================================================== */
/* ENDPOINTS + AUTH                                                           */
/* ========================================================================== */

function graphBase(env) {
  const version =
    clean(env?.FB_GRAPH_API_VERSION) || DEFAULT_GRAPH_API_VERSION;

  return `https://graph.facebook.com/${version}`;
}

function facebookSendEndpoint(env, pageId = "") {
  const override = clean(env?.FACEBOOK_SEND_URL);

  if (override) return override;

  const resolvedPageId = clean(pageId || env?.FB_PAGE_ID);
  return resolvedPageId
    ? `${graphBase(env)}/${encodeURIComponent(resolvedPageId)}/messages`
    : `${graphBase(env)}/me/messages`;
}

function manychatSendEndpoint(env) {
  return (
    clean(env?.MANYCHAT_SEND_URL) ||
    "https://api.manychat.com/fb/sending/sendContent"
  );
}

function manychatToken(env) {
  return clean(env?.MANYCHAT_API_TOKEN || env?.MANYCHAT_API_KEY);
}

function gatewayAuthorized(request, env) {
  const expected = clean(env?.MZJ_GATEWAY_SECRET);
  const provided = clean(request.headers.get("x-mzj-gateway-secret"));

  return Boolean(expected && timingSafeEqualText(expected, provided));
}

function manychatWebhookAuthorized(request, env) {
  const expected = clean(env?.MANYCHAT_WEBHOOK_SECRET);

  if (!expected) return true;

  const provided = first(
    request.headers.get("x-manychat-webhook-secret"),
    request.headers.get("x-mzj-gateway-secret"),
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""),
    new URL(request.url).searchParams.get("secret"),
  );

  return timingSafeEqualText(expected, provided);
}

async function verifyXHubSignature256(headerValue, rawBody, appSecret) {
  const prefix = "sha256=";

  if (!clean(headerValue).startsWith(prefix)) return false;

  const providedHex = clean(headerValue)
    .slice(prefix.length)
    .trim()
    .toLowerCase();

  if (!/^[a-f0-9]{64}$/.test(providedHex)) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(clean(appSecret)),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(String(rawBody || "")),
  );

  const computedHex = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqualText(computedHex, providedHex);
}

function timingSafeEqualText(left, right) {
  const a = String(left || "");
  const b = String(right || "");

  if (!a || a.length !== b.length) return false;

  let mismatch = 0;

  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return mismatch === 0;
}

/* ========================================================================== */
/* MEDIA + ID HELPERS                                                         */
/* ========================================================================== */

function facebookConversationId(pageId, participantId) {
  return `facebook:${clean(pageId)}:${clean(participantId)}`;
}

function parseFacebookConversationId(value) {
  const match = clean(value).match(/^facebook:([^:]+):(.+)$/);

  if (!match) return null;

  return {
    pageId: match[1],
    participantId: match[2],
  };
}

function normalizeMediaType(value) {
  const type = clean(value).toLowerCase();

  if (type === "photo" || type === "picture") return "image";
  if (type === "voice" || type === "ptt") return "audio";
  if (type === "file") return "document";

  return type || "attachment";
}

function normalizeOutboundFacebookMediaType(value) {
  const type = normalizeMediaType(value);

  if (
    type === "document" ||
    type === "attachment" ||
    type === "link" ||
    type === "sticker"
  ) {
    return "file";
  }

  if (["image", "audio", "video", "file"].includes(type)) {
    return type;
  }

  return "file";
}

function attachmentLabel(type) {
  const normalized = normalizeMediaType(type);

  if (normalized === "image") return "صورة من العميل";
  if (normalized === "audio") return "رسالة صوتية من العميل";
  if (normalized === "video") return "فيديو من العميل";
  if (normalized === "document" || normalized === "file") {
    return "ملف من العميل";
  }
  if (normalized === "sticker") return "ملصق من العميل";
  if (normalized === "link") return "رابط من العميل";

  return "مرفق من العميل";
}

function contentDispositionFileName(value) {
  const header = clean(value);

  if (!header) return "";

  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];

  if (encoded) {
    try {
      return decodeURIComponent(encoded.replace(/^[\'"]|[\'"]$/g, ""));
    } catch {
      return encoded;
    }
  }

  return clean(
    header.match(/filename\s*=\s*"([^"]+)"/i)?.[1] ||
      header.match(/filename\s*=\s*([^;]+)/i)?.[1],
  ).replace(/^[\'"]|[\'"]$/g, "");
}

function ensureMediaFileName(value, mediaType, mimeType, eventId) {
  let fileName = clean(value).replace(
    /[\\/:*?"<>|\u0000-\u001f]/g,
    "_",
  );

  if (!fileName) {
    fileName = `${normalizeMediaType(mediaType)}-${
      clean(eventId) || Date.now()
    }`;
  }

  if (!/\.[a-z0-9]{1,10}$/i.test(fileName)) {
    fileName += extensionFromMimeType(mimeType, mediaType);
  }

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
  if (mime.includes("mpeg")) {
    return normalizeMediaType(mediaType) === "video" ? ".mpeg" : ".mp3";
  }
  if (mime.includes("ogg") || mime.includes("opus")) return ".ogg";
  if (mime.includes("wav")) return ".wav";
  if (mime.includes("aac")) return ".aac";
  if (mime.includes("zip")) return ".zip";
  if (mime.includes("plain")) return ".txt";

  const type = normalizeMediaType(mediaType);

  if (type === "image") return ".jpg";
  if (type === "audio") return ".mp3";
  if (type === "video") return ".mp4";

  return ".bin";
}

function guessMimeType(url, mediaType) {
  const lower = clean(url).toLowerCase().split("?")[0];

  if (/\.jpe?g$/.test(lower)) return "image/jpeg";
  if (/\.png$/.test(lower)) return "image/png";
  if (/\.webp$/.test(lower)) return "image/webp";
  if (/\.gif$/.test(lower)) return "image/gif";
  if (/\.mp3$/.test(lower)) return "audio/mpeg";
  if (/\.(ogg|opus)$/.test(lower)) return "audio/ogg";
  if (/\.wav$/.test(lower)) return "audio/wav";
  if (/\.aac$/.test(lower)) return "audio/aac";
  if (/\.mp4$/.test(lower)) return "video/mp4";
  if (/\.pdf$/.test(lower)) return "application/pdf";
  if (/\.zip$/.test(lower)) return "application/zip";
  if (/\.txt$/.test(lower)) return "text/plain";

  const type = normalizeMediaType(mediaType);

  if (type === "image") return "image/jpeg";
  if (type === "audio") return "audio/mpeg";
  if (type === "video") return "video/mp4";

  return "application/octet-stream";
}

function fileNameFromUrl(value) {
  try {
    const url = new URL(clean(value));
    return decodeURIComponent(url.pathname.split("/").pop() || "");
  } catch {
    return "";
  }
}

/* ========================================================================== */
/* GENERIC HELPERS                                                            */
/* ========================================================================== */

function stableEventId(value) {
  const serialized =
    typeof value === "string" ? value : JSON.stringify(value || {});

  let hash = 2166136261;

  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `facebook_${(hash >>> 0).toString(16)}`;
}

function normalizeStatus(value) {
  return clean(value).toLowerCase().replace(/[\s-]+/g, "_");
}

function timestampMs(value) {
  if (typeof value === "number") {
    return value < 1e12 ? value * 1000 : value;
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    const number = Number(value);
    return number < 1e12 ? number * 1000 : number;
  }

  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function toBool(value) {
  if (typeof value === "boolean") return value;

  return ["1", "true", "yes", "on"].includes(
    clean(value).toLowerCase(),
  );
}

function first(...values) {
  for (const value of values) {
    const textValue = clean(value);
    if (textValue) return textValue;
  }

  return "";
}

function clean(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }

  return "";
}

function parseJson(value) {
  if (value && typeof value === "object") return value;

  try {
    return value ? JSON.parse(String(value)) : {};
  } catch {
    return {
      raw: String(value || ""),
    };
  }
}

function parseJsonStrict(value) {
  try {
    return {
      ok: true,
      value: JSON.parse(String(value || "")),
    };
  } catch {
    return {
      ok: false,
      value: null,
    };
  }
}

async function safeJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function errorMessage(error) {
  return error instanceof Error
    ? error.message
    : String(error || "Unknown error");
}

function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, Number(ms || 0))),
  );
}

async function kvPutJson(env, key, value) {
  try {
    if (!env?.DEBUG_KV?.put) return;

    await env.DEBUG_KV.put(
      key,
      JSON.stringify({
        at: new Date().toISOString(),
        value,
      }),
      {
        expirationTtl: 86400,
      },
    );
  } catch (error) {
    console.error("DEBUG_KV put failed", errorMessage(error));
  }
}

async function kvGetJson(env, key) {
  try {
    if (!env?.DEBUG_KV?.get) return null;

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
    "access-control-allow-headers":
      "content-type,authorization,x-mzj-gateway-secret,x-manychat-webhook-secret,x-hub-signature-256",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(),
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function text(value, status = 200) {
  return new Response(String(value || ""), {
    status,
    headers: {
      ...corsHeaders(),
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
