/*
 * MZJ Instagram / ManyChat Worker
 *
 * Full transport-only Worker for MZJ Unified Platform.
 *
 * Responsibilities:
 * - Verify and receive Meta webhooks.
 * - Normalize Instagram text, quick replies, postbacks, referrals and media.
 * - Preserve the real Instagram-scoped ID (IGSID) as the canonical identity.
 * - Resolve ManyChat Contact ID, Instagram IGSID, name and username directly from ManyChat getInfo.
 * - Keep the Instagram IGSID as the canonical platform identity.
 * - Use the ManyChat Contact ID only for outbound sendContent delivery.
 * - Use ManyChat External Request only to resolve Contact ID, IGSID and customer name.
 * - Forward inbound text and media from Meta exactly once after the identity link exists.
 * - Queue Meta events briefly when ManyChat identity arrives after the Meta webhook.
 * - Send text, quick replies and media through ManyChat sendContent using the proven Contact ID contract.
 * - Return real provider send results.
 *
 * The platform is the single source of truth for automation definitions,
 * customer creation, departments, branches, assignment and distribution.
 * This Worker contains no business-flow messages or distribution logic.
 */

const VERSION = "mzj-instagram-worker-v2.0.16-social-chat-identity";
const WORKER_CODE = "instagram";
const DEFAULT_PLATFORM_INBOUND_URL =
  "https://mzj-platform.vercel.app/api/integrations/instagram";
const DEFAULT_GRAPH_API_VERSION = "v20.0";
const DEFAULT_PUBLIC_BASE_URL = "https://instagram.next-erp-mzj.workers.dev";
const DEFAULT_MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const IDENTITY_LINK_TTL_SECONDS = 30 * 24 * 60 * 60;
const PENDING_CORRELATION_TTL_SECONDS = 10 * 60;
const META_CORRELATION_WAIT_MS = 1200;
const PENDING_META_EVENT_TTL_SECONDS = 10 * 60;
const MAX_PENDING_META_EVENTS = 10;

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
  "/webhook/instagram",
  "/webhook/meta",
  "/instagram/webhook",
]);

const AUTOMATION_PATHS = new Set([
  "/automation",
  "/manychat/automation",
  "/webhook/manychat",
  "/",
]);

const SEND_PATHS = new Set([
  "/send/instagram",
  "/crm/send",
  "/send/meta",
  "/send",
]);

const QUICK_REPLY_CALLBACK_PATHS = new Set([
  "/manychat/quick-reply",
  "/quick-reply",
]);

const memoryIdentityLinks = new Map();
const memoryPendingCorrelations = new Map();
const memoryPendingMetaEvents = new Map();

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

    if (
      request.method === "POST" &&
      QUICK_REPLY_CALLBACK_PATHS.has(url.pathname)
    ) {
      return handleManyChatQuickReplyCallback(request, env, ctx);
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

      return handleInstagramSend(request, env, ctx);
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
      service: "instagram-crm-worker",
      workerCode: WORKER_CODE,
      version: VERSION,
      responsibility: "transport_only",
      storage: "platform_postgresql",
      routes: {
        health: "GET /",
        debug: "GET /debug/last",
        metaWebhook: "GET/POST /meta/webhook",
        instagramWebhook: "GET/POST /webhook/instagram",
        manychatCompatibility: "POST /automation",
        manychatWebhook: "POST /webhook/manychat",
        manychatQuickReply: "POST /manychat/quick-reply",
        send: "POST /send/instagram",
      },
      env_check: {
        has_gateway_secret: Boolean(clean(env?.MZJ_GATEWAY_SECRET)),
        has_platform_inbound_url: Boolean(
          clean(env?.PLATFORM_INBOUND_URL) || DEFAULT_PLATFORM_INBOUND_URL,
        ),
        has_platform_media_url: Boolean(platformMediaEndpoint(env)),
        has_ig_verify_token: Boolean(instagramVerifyToken(env)),
        has_ig_app_secret: Boolean(instagramAppSecret(env)),
        has_ig_professional_account_id: Boolean(instagramAccountId(env)),
        has_ig_access_token: Boolean(instagramAccessToken(env)),
        has_ig_page_access_token: Boolean(
          clean(
            env?.IG_PAGE_ACCESS_TOKEN ||
              env?.INSTAGRAM_PAGE_ACCESS_TOKEN ||
              env?.FB_PAGE_ACCESS_TOKEN,
          ),
        ),
        outbound_provider: "manychat",
        outbound_contract: "sendContent_by_manychat_contact_id",
      inbound_contract: "meta_event_after_manychat_identity_link",
        has_manychat_api_token: Boolean(manychatToken(env)),
        has_manychat_webhook_secret: Boolean(
          clean(env?.MANYCHAT_WEBHOOK_SECRET),
        ),
        manychat_webhook_secret_mode: "configured_but_not_required",
        has_debug_kv: Boolean(env?.DEBUG_KV),
        has_identity_kv: Boolean(identityKv(env)),
      },
      safeguards: {
        platform_is_automation_source_of_truth: true,
        worker_contains_no_business_flow: true,
        instagram_scoped_id_is_canonical_identity: true,
        manychat_contact_id_is_not_used_as_instagram_scoped_id: true,
        inbound_media_is_forwarded_to_platform_storage: true,
        provider_send_result_is_returned: true,
        manychat_getinfo_is_identity_source: true,
        meta_is_single_inbound_source: true,
        manychat_is_identity_source_only: true,
        pending_meta_events_flush_after_identity: true,
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
      metaPayload: await kvGetJson(env, "DEBUG_INSTAGRAM_LAST_META_PAYLOAD"),
      metaForward: await kvGetJson(env, "DEBUG_INSTAGRAM_LAST_META_FORWARD"),
      automationRaw: await kvGetJson(
        env,
        "DEBUG_INSTAGRAM_LAST_AUTOMATION_RAW",
      ),
      automationPayload: await kvGetJson(
        env,
        "DEBUG_INSTAGRAM_LAST_AUTOMATION_PAYLOAD",
      ),
      automationForward: await kvGetJson(
        env,
        "DEBUG_INSTAGRAM_LAST_AUTOMATION_FORWARD",
      ),
      send: await kvGetJson(env, "DEBUG_INSTAGRAM_LAST_SEND"),
      quickReply: await kvGetJson(
        env,
        "DEBUG_INSTAGRAM_LAST_QUICK_REPLY",
      ),
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
  const expected = instagramVerifyToken(env);

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

  const appSecret = instagramAppSecret(env);

  if (appSecret) {
    const signature = clean(request.headers.get("x-hub-signature-256"));
    const valid = await verifyXHubSignature256(
      signature,
      rawBody,
      appSecret,
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
      kvPutJson(env, "DEBUG_INSTAGRAM_LAST_META_PAYLOAD", incoming.value),
    );
  }

  if (
    incoming.value?.object !== "instagram" ||
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
        deferred: [],
        note: "webhook received without a supported Instagram messaging event",
      };

      if (ctx?.waitUntil) {
        ctx.waitUntil(
          kvPutJson(env, "DEBUG_INSTAGRAM_LAST_META_FORWARD", result),
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
    const deferred = [];
    const skipped = [];

    for (const event of events) {
      if (event.isEcho) {
        skipped.push({
          eventId: event.eventId,
          reason: "outbound_echo_already_persisted",
        });
        continue;
      }

      const identity = await resolveMetaEventIdentity(event, env);

      if (!identity.linked || !clean(identity.manychatContactId)) {
        const queued = await queuePendingMetaEvent(event, env);
        deferred.push({
          eventId: event.eventId,
          pageId: event.pageId,
          participantId: event.customerId,
          reason: "waiting_for_manychat_identity",
          pendingCount: queued.pendingCount,
        });
        continue;
      }

      if (identity.displayName) event.displayName = identity.displayName;

      const payload = await buildMetaPlatformPayload(event, env);
      const result = await forwardToPlatform(payload, env, "instagram");

      if (!result.ok) {
        throw new Error(
          `Platform endpoint rejected ${event.eventId}: HTTP ${result.status} ${result.error}`,
        );
      }

      forwarded.push({
        eventId: event.eventId,
        pageId: event.pageId,
        participantId: payload.participantId,
        manychatContactId: payload.manychatContactId,
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
      deferred,
      skipped,
      inboundSource: "meta",
      identitySource: "manychat_getinfo",
    };

    if (ctx?.waitUntil) {
      ctx.waitUntil(
        kvPutJson(env, "DEBUG_INSTAGRAM_LAST_META_FORWARD", finalResult),
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
    console.error("Instagram Meta inbound processing failed", message);

    if (ctx?.waitUntil) {
      ctx.waitUntil(
        kvPutJson(env, "DEBUG_INSTAGRAM_LAST_META_FORWARD", {
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
    const pageId = clean(entry?.id || instagramAccountId(env));
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
        senderId === instagramAccountId(env);

      const customerId = isEcho ? recipientId : senderId;

      if (!customerId) continue;

      const content = extractInstagramEventContent(evt);

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
        ? "Instagram Professional Account"
        : (await fetchInstagramName(customerId, env).catch(() => "")) ||
          `Instagram User (${customerId.slice(-4)})`;

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

function extractInstagramEventContent(evt) {
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
    const normalized = normalizeInstagramAttachment(attachment);
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

function normalizeInstagramAttachment(attachment) {
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
    clean(identity.instagramScopedId) || clean(event.customerId);

  const conversationId = instagramConversationId(
    event.pageId,
    canonicalParticipantId,
  );

  const storedAttachments = [];

  for (let index = 0; index < content.attachments.length; index += 1) {
    const attachment = content.attachments[index];

    const stored = await prepareInboundInstagramAttachment(env, {
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
    providerName: "instagram_graph",
    provider_name: "instagram_graph",
    platform: "instagram",
    channel: "instagram",
    channelCode: "ig",
    channel_code: "ig",
    workerCode: WORKER_CODE,
    worker_code: WORKER_CODE,
    source: "إنستجرام",
    sourceName: "إنستجرام",
    source_name: "إنستجرام",

    pageId: event.pageId,
    page_id: event.pageId,
    instagramAccountId: event.pageId,
    instagram_account_id: event.pageId,
    participantId: canonicalParticipantId,
    participant_id: canonicalParticipantId,
    manychatContactId: identity.manychatContactId || "",
    manychat_contact_id: identity.manychatContactId || "",
    instagramScopedId: canonicalParticipantId,
    instagram_scoped_id: canonicalParticipantId,
    igsid: canonicalParticipantId,
    igSid: canonicalParticipantId,
    ig_sid: canonicalParticipantId,
    igId: canonicalParticipantId,
    ig_id: canonicalParticipantId,
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
    customerName: first(identity.displayName, event.displayName),
    customer_name: first(identity.displayName, event.displayName),
    displayName: first(identity.displayName, event.displayName),
    display_name: first(identity.displayName, event.displayName),
    instagramUsername: identity.instagramUsername || "",
    instagram_username: identity.instagramUsername || "",
    profilePic: identity.profilePic || "",
    profile_pic: identity.profilePic || "",

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

async function prepareInboundInstagramAttachment(env, input) {
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
/* MANYCHAT QUICK REPLY CALLBACK                                              */
/* ========================================================================== */

async function handleManyChatQuickReplyCallback(request, env, ctx) {
  if (!manychatWebhookAuthorized(request, env)) {
    return json(
      {
        ok: false,
        error: "Unauthorized ManyChat quick reply request",
        version: VERSION,
      },
      401,
    );
  }

  const parsedRequest = await readJsonRequest(request);
  const body = parsedRequest.value;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json(
      {
        ok: false,
        error: "Invalid JSON",
        parseError: parsedRequest.error,
        version: VERSION,
      },
      400,
    );
  }

  try {
    const pageId = clean(
      first(
        body?.instagramAccountId,
        body?.instagram_account_id,
        body?.pageId,
        body?.page_id,
        instagramAccountId(env),
      ),
    );

    let participantId = clean(
      first(
        body?.participantId,
        body?.participant_id,
        body?.instagramScopedId,
        body?.instagram_scoped_id,
        body?.igId,
        body?.ig_id,
      ),
    );

    let manychatContactId = clean(
      first(
        body?.manychatContactId,
        body?.manychat_contact_id,
        body?.subscriberId,
        body?.subscriber_id,
        body?.contactId,
        body?.contact_id,
      ),
    );

    let link = null;

    if (pageId && participantId) {
      link = await getIdentityLinkByScopedId(pageId, participantId, env);
      manychatContactId = clean(
        first(link?.manychatContactId, manychatContactId),
      );
    }

    if (!participantId && pageId && manychatContactId) {
      link =
        link ||
        (await getIdentityLinkByManyChat(pageId, manychatContactId, env));
      participantId = clean(link?.instagramScopedId);
    }

    const payloadValue = clean(
      first(
        body?.payload,
        body?.value,
        body?.buttonPayload,
        body?.button_payload,
      ),
    );

    const buttonTitle = clean(
      first(
        body?.text,
        body?.title,
        body?.caption,
        body?.buttonTitle,
        body?.button_title,
        payloadValue,
      ),
    );

    if (!pageId || !participantId || !manychatContactId) {
      throw new Error(
        "Instagram identity link is incomplete for ManyChat quick reply",
      );
    }

    if (!buttonTitle && !payloadValue) {
      throw new Error("Quick reply text/payload is missing");
    }

    const conversationId =
      clean(first(body?.conversationId, body?.conversation_id)) ||
      instagramConversationId(pageId, participantId);

    const timestamp = timestampMs(
      first(body?.timestamp, body?.createdAt, body?.created_at, Date.now()),
    );

    const eventId =
      clean(first(body?.eventId, body?.event_id)) ||
      stableEventId({
        source: "manychat_quick_reply",
        pageId,
        participantId,
        manychatContactId,
        payloadValue,
        buttonTitle,
        timestamp,
      });

    const customerName = clean(
      first(
        body?.customerName,
        body?.customer_name,
        body?.displayName,
        body?.display_name,
        link?.displayName,
      ),
    );

    const platformPayload = {
      eventId,
      event_id: eventId,
      type: "incoming_message",
      eventType: "incoming_message",
      event_type: "incoming_message",
      direction: "in",
      senderType: "customer",
      sender_type: "customer",

      provider: "manychat",
      providerName: "manychat_dynamic_block_callback",
      provider_name: "manychat_dynamic_block_callback",
      platform: "instagram",
      channel: "instagram",
      channelCode: "ig",
      channel_code: "ig",
      workerCode: WORKER_CODE,
      worker_code: WORKER_CODE,
      source: "إنستجرام",
      sourceName: "إنستجرام",
      source_name: "إنستجرام",

      pageId,
      page_id: pageId,
      instagramAccountId: pageId,
      instagram_account_id: pageId,
      participantId,
      participant_id: participantId,
      instagramScopedId: participantId,
      instagram_scoped_id: participantId,
      igsid: participantId,
      igSid: participantId,
      ig_id: participantId,
      manychatContactId,
      manychat_contact_id: manychatContactId,
      subscriberId: manychatContactId,
      subscriber_id: manychatContactId,
      canonicalParticipantId: participantId,
      canonical_participant_id: participantId,
      identitySource: "stored_identity_link_quick_reply",
      identity_source: "stored_identity_link_quick_reply",
      identityLinked: true,
      identity_linked: true,
      conversationId,
      conversation_id: conversationId,

      customerName,
      customer_name: customerName,
      displayName: customerName,
      display_name: customerName,
      instagramUsername: clean(link?.instagramUsername),
      instagram_username: clean(link?.instagramUsername),
      profilePic: clean(link?.profilePic),
      profile_pic: clean(link?.profilePic),

      messageId: eventId,
      message_id: eventId,
      providerMessageId: eventId,
      provider_message_id: eventId,
      text: buttonTitle || payloadValue,
      message: buttonTitle || payloadValue,
      messageType: "quick_reply",
      message_type: "quick_reply",
      payload: payloadValue,
      buttonTitle,
      button_title: buttonTitle,
      timestamp,
      isEcho: false,
      is_echo: false,
      hasAttachment: false,
      has_attachment: false,
      attachments: [],
    };

    const result = await forwardToPlatform(platformPayload, env, "instagram");

    if (!result.ok) {
      throw new Error(
        `Platform endpoint rejected quick reply: HTTP ${result.status} ${result.error}`,
      );
    }

    const debugResult = {
      ok: true,
      accepted: true,
      eventId,
      pageId,
      participantId,
      manychatContactId,
      text: buttonTitle || payloadValue,
      payload: payloadValue,
      platformStatus: result.status,
      platformResult: result.data || null,
      version: VERSION,
    };

    if (ctx?.waitUntil) {
      ctx.waitUntil(
        kvPutJson(env, "DEBUG_INSTAGRAM_LAST_QUICK_REPLY", debugResult),
      );
    }

    return json(
      {
        version: "v2",
        content: {
          type: "instagram",
          messages: [],
          actions: [],
          quick_replies: [],
        },
      },
      200,
    );
  } catch (error) {
    const message = errorMessage(error);

    if (ctx?.waitUntil) {
      ctx.waitUntil(
        kvPutJson(env, "DEBUG_INSTAGRAM_LAST_QUICK_REPLY", {
          ok: false,
          error: message,
          version: VERSION,
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

  const parsedRequest = await readJsonRequest(request);
  const body = parsedRequest.value;

  if (ctx?.waitUntil) {
    ctx.waitUntil(
      kvPutJson(env, "DEBUG_INSTAGRAM_LAST_AUTOMATION_RAW", {
        raw: parsedRequest.raw,
        repaired: parsedRequest.repaired,
        parseError: parsedRequest.error,
      }),
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json(
      {
        ok: false,
        error: "Invalid JSON",
        parseError: parsedRequest.error,
        version: VERSION,
      },
      400,
    );
  }

  if (ctx?.waitUntil) {
    ctx.waitUntil(
      kvPutJson(env, "DEBUG_INSTAGRAM_LAST_AUTOMATION_PAYLOAD", body),
    );
  }

  try {
    const contactData = manyChatContactData(body);
    const identity = await resolveManyChatAutomationIdentity(
      body,
      contactData,
      env,
    );

    const eventId =
      first(body?.eventId, body?.event_id, body?.messageId, body?.message_id) ||
      stableEventId({
        source: "manychat_identity",
        manychatContactId: identity.manychatContactId,
        instagramScopedId: identity.instagramScopedId,
        timestamp: first(body?.timestamp, body?.createdAt, body?.created_at, Date.now()),
      });

    if (!identity.manychatContactId) {
      throw new Error("ManyChat Contact ID is missing from External Request");
    }

    if (!identity.pageId || !identity.instagramScopedId) {
      const responseBody = {
        ok: false,
        accepted: false,
        status: "failed",
        error: "ManyChat getInfo did not return a valid Instagram ig_id",
        version: VERSION,
        eventId,
        manychatContactId: identity.manychatContactId,
        manychatPageId: identity.manychatPageId,
      };

      if (ctx?.waitUntil) {
        ctx.waitUntil(
          kvPutJson(env, "DEBUG_INSTAGRAM_LAST_AUTOMATION_FORWARD", responseBody),
        );
      }

      return json(responseBody, 422);
    }

    const flush = await flushPendingMetaEvents(identity, env);

    const responseBody = {
      ok: true,
      accepted: true,
      version: VERSION,
      mode: "manychat_identity_link_and_meta_flush",
      eventId,
      participantId: identity.instagramScopedId,
      manychatContactId: identity.manychatContactId,
      manychatPageId: identity.manychatPageId,
      customerName: identity.displayName,
      instagramUsername: identity.instagramUsername,
      identitySource: identity.identitySource,
      linked: true,
      flushed: flush.forwarded.length,
      pendingFailures: flush.failed.length,
      flush,
    };

    if (ctx?.waitUntil) {
      ctx.waitUntil(
        kvPutJson(env, "DEBUG_INSTAGRAM_LAST_AUTOMATION_FORWARD", responseBody),
      );
    }

    return json(responseBody, 200);
  } catch (error) {
    const message = errorMessage(error);
    console.error("ManyChat identity linking failed", message);

    if (ctx?.waitUntil) {
      ctx.waitUntil(
        kvPutJson(env, "DEBUG_INSTAGRAM_LAST_AUTOMATION_FORWARD", {
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

  const parsedConversation = parseInstagramConversationId(
    requestedConversationId,
  );

  const requestedManyChatContactId = clean(
    first(
      body?.manychatContactId,
      body?.manychat_contact_id,
      body?.participantId,
      body?.participant_id,
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

  if (requestedManyChatContactId) {
    subscriberInfo = await fetchManyChatSubscriberInfo(
      requestedManyChatContactId,
      env,
    ).catch(() => null);
  }

  const manychatContactId = clean(
    first(
      extractManyChatContactId(subscriberInfo),
      requestedManyChatContactId,
    ),
  );

  const subscriberScopedId = extractInstagramScopedIdFromManyChatInfo(
    subscriberInfo,
  );

  const explicitInstagramScopedId = clean(
    first(
      body?.instagramScopedId,
      body?.instagram_scoped_id,
      body?.igsid,
      body?.igSid,
      body?.ig_sid,
      body?.igId,
      body?.ig_id,
      body?.pageScopedId,
      body?.page_scoped_id,
      body?.instagramUserId,
      body?.instagram_user_id,
      body?.metaSenderId,
      body?.meta_sender_id,
      body?.lastIncomingParticipantId,
      body?.last_incoming_participant_id,
      contactData?.instagram_scoped_id,
      contactData?.instagram_igsid,
      contactData?.ig_igsid,
      contactData?.igsid,
      contactData?.igSid,
      contactData?.ig_id,
      contactData?.page_scoped_id,
    ),
  );

  const manychatPageId = clean(
    first(
      subscriberInfo?.subscriber?.page_id,
      subscriberInfo?.root?.page_id,
      contactData?.page_id,
    ),
  );

  // The ManyChat page_id is the Facebook Page ID, not the Instagram account ID.
  // Always key the identity link by the real Instagram professional account ID.
  const pageId = clean(
    first(
      body?.instagramAccountId,
      body?.instagram_account_id,
      parsedConversation?.pageId,
      instagramAccountId(env),
      body?.pageId,
      body?.page_id,
    ),
  );

  const storedLink =
    manychatContactId && pageId
      ? await getIdentityLinkByManyChat(pageId, manychatContactId, env)
      : null;

  const linkedScopedId = clean(storedLink?.instagramScopedId);

  // ManyChat getInfo is authoritative here. It returns data.id + data.ig_id.
  const instagramScopedId = clean(
    first(
      subscriberScopedId,
      linkedScopedId,
      explicitInstagramScopedId,
      parsedConversation?.participantId,
    ),
  );

  const aliases = [
    ...new Set(
      [
        instagramScopedId,
        manychatContactId,
        subscriberScopedId,
        linkedScopedId,
        explicitInstagramScopedId,
        parsedConversation?.participantId,
      ]
        .map(clean)
        .filter(Boolean),
    ),
  ];

  let identitySource = "";

  if (subscriberScopedId) identitySource = "manychat_getinfo_ig_id";
  else if (linkedScopedId) identitySource = "stored_identity_link";
  else if (explicitInstagramScopedId) {
    identitySource = "explicit_instagram_scoped_id";
  } else if (parsedConversation?.participantId) {
    identitySource = "conversation_id";
  } else if (manychatContactId) {
    identitySource = "manychat_contact_without_instagram_scoped_id";
  }

  const displayName = extractManyChatDisplayName(subscriberInfo);
  const instagramUsername = extractInstagramUsernameFromManyChatInfo(
    subscriberInfo,
  );
  const profilePic = clean(
    first(
      subscriberInfo?.subscriber?.profile_pic,
      subscriberInfo?.root?.profile_pic,
    ),
  );

  if (pageId && instagramScopedId) {
    await rememberIdentityLink(
      pageId,
      instagramScopedId,
      instagramScopedId,
      {
        manychatContactId,
        manychatPageId,
        displayName,
        instagramUsername,
        profilePic,
        source: identitySource || "manychat_getinfo",
      },
      env,
    );
  }

  return {
    instagramScopedId,
    manychatContactId,
    pageId,
    manychatPageId,
    aliases,
    identitySource,
    displayName,
    instagramUsername,
    profilePic,
  };
}

/* ========================================================================== */
/* IDENTITY CORRELATION                                                       */
/* ========================================================================== */

async function resolveMetaEventIdentity(event, env) {
  const pageId = clean(event?.pageId || instagramAccountId(env));
  const instagramScopedId = clean(event?.customerId);

  if (!pageId || !instagramScopedId) {
    return {
      linked: false,
      canonicalParticipantId: instagramScopedId,
      manychatContactId: "",
      instagramScopedId,
      aliases: [instagramScopedId].filter(Boolean),
      conversationAliases: [],
      identitySource: "meta_instagram_scoped_id_only",
    };
  }

  let link = await getIdentityLinkByScopedId(pageId, instagramScopedId, env);

  if (!link) {
    const info = await fetchManyChatSubscriberInfo(instagramScopedId, env).catch(
      () => null,
    );

    const manychatContactId = extractManyChatContactId(info);

    if (manychatContactId) {
      link = await rememberIdentityLink(
        pageId,
        instagramScopedId,
        instagramScopedId,
        {
          manychatContactId,
          source: "manychat_lookup_by_instagram_scoped_id",
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
        instagramScopedId,
        instagramScopedId,
        {
          manychatContactId: pending.manychatContactId,
          source: `correlated_${pending.source || "event"}`,
        },
        env,
      );
    }
  }

  const canonicalParticipantId = instagramScopedId;
  const manychatContactId = clean(link?.manychatContactId);

  const aliases = [
    ...new Set(
      [
        instagramScopedId,
        canonicalParticipantId,
        manychatContactId,
        ...(Array.isArray(link?.aliases) ? link.aliases : []),
      ]
        .map(clean)
        .filter(Boolean),
    ),
  ];

  const conversationAliases = aliases.map((id) =>
    instagramConversationId(pageId, id),
  );

  return {
    linked: Boolean(link),
    canonicalParticipantId,
    manychatContactId,
    instagramScopedId,
    displayName: clean(link?.displayName),
    instagramUsername: clean(link?.instagramUsername),
    profilePic: clean(link?.profilePic),
    manychatPageId: clean(link?.manychatPageId),
    aliases,
    conversationAliases,
    identitySource:
      clean(link?.source) ||
      (link ? "stored_identity_link" : "meta_instagram_scoped_id_unresolved"),
  };
}


function pendingMetaEventKey(pageId, instagramScopedId) {
  return `pending_meta:${clean(pageId)}:${clean(instagramScopedId)}`;
}

async function queuePendingMetaEvent(event, env) {
  const pageId = clean(event?.pageId || instagramAccountId(env));
  const instagramScopedId = clean(event?.customerId);

  if (!pageId || !instagramScopedId) {
    return { pendingCount: 0 };
  }

  const key = pendingMetaEventKey(pageId, instagramScopedId);
  const now = Date.now();
  const current = await readPendingMetaEvents(pageId, instagramScopedId, env);
  const fresh = current.filter(
    (item) =>
      now - Number(item?.createdAt || 0) <=
      PENDING_META_EVENT_TTL_SECONDS * 1000,
  );

  const deduped = fresh.filter(
    (item) => clean(item?.event?.eventId) !== clean(event?.eventId),
  );

  deduped.push({
    createdAt: now,
    event,
  });

  const finalItems = deduped.slice(-MAX_PENDING_META_EVENTS);
  memoryPendingMetaEvents.set(key, finalItems);
  await statePutJson(
    env,
    `instagram:${key}`,
    finalItems,
    PENDING_META_EVENT_TTL_SECONDS,
  );

  return { pendingCount: finalItems.length };
}

async function readPendingMetaEvents(pageId, instagramScopedId, env) {
  const key = pendingMetaEventKey(pageId, instagramScopedId);
  const memory = memoryPendingMetaEvents.get(key);

  if (Array.isArray(memory)) return memory;

  const stored = await stateGetJson(env, `instagram:${key}`);
  const items = Array.isArray(stored) ? stored : [];

  if (items.length) memoryPendingMetaEvents.set(key, items);
  return items;
}

async function clearPendingMetaEvents(pageId, instagramScopedId, env) {
  const key = pendingMetaEventKey(pageId, instagramScopedId);
  memoryPendingMetaEvents.delete(key);
  await stateDeleteJson(env, `instagram:${key}`);
}

async function flushPendingMetaEvents(identity, env) {
  const pageId = clean(identity?.pageId || instagramAccountId(env));
  const instagramScopedId = clean(identity?.instagramScopedId);
  const forwarded = [];
  const failed = [];

  if (!pageId || !instagramScopedId) return { forwarded, failed };

  const items = await readPendingMetaEvents(pageId, instagramScopedId, env);

  for (const item of items) {
    const event = item?.event;
    if (!event || typeof event !== "object") continue;

    if (identity.displayName) event.displayName = identity.displayName;

    try {
      const payload = await buildMetaPlatformPayload(event, env);
      const result = await forwardToPlatform(payload, env, "instagram");

      if (!result.ok) {
        failed.push({
          eventId: clean(event?.eventId),
          status: result.status,
          error: result.error,
          item,
        });
        continue;
      }

      forwarded.push({
        eventId: clean(event?.eventId),
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
    } catch (error) {
      failed.push({
        eventId: clean(event?.eventId),
        error: errorMessage(error),
        item,
      });
    }
  }

  if (failed.length) {
    const retryItems = failed
      .map((entry) => entry.item)
      .filter(Boolean)
      .slice(-MAX_PENDING_META_EVENTS);
    const key = pendingMetaEventKey(pageId, instagramScopedId);
    memoryPendingMetaEvents.set(key, retryItems);
    await statePutJson(
      env,
      `instagram:${key}`,
      retryItems,
      PENDING_META_EVENT_TTL_SECONDS,
    );
  } else {
    await clearPendingMetaEvents(pageId, instagramScopedId, env);
  }

  return {
    forwarded,
    failed: failed.map(({ item, ...entry }) => entry),
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
  const pageId = clean(first(target?.pageId, instagramAccountId(env)));
  const parsed = parseInstagramConversationId(clean(target?.conversationId));

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
  const pageId = clean(event?.pageId || instagramAccountId(env));
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
    `instagram:${key}`,
    deduped,
    PENDING_CORRELATION_TTL_SECONDS,
  );
}

async function readPendingCorrelationCandidates(key, env) {
  const memory = memoryPendingCorrelations.get(key);

  if (Array.isArray(memory)) return memory;

  const stored = await stateGetJson(env, `instagram:${key}`);
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
  instagramScopedId,
  canonicalParticipantId,
  details,
  env,
) {
  const manychatContactId = clean(details?.manychatContactId);

  const link = {
    pageId: clean(pageId),
    instagramScopedId: clean(instagramScopedId),
    canonicalParticipantId: clean(
      first(canonicalParticipantId, instagramScopedId),
    ),
    manychatContactId,
    manychatPageId: clean(details?.manychatPageId),
    displayName: clean(details?.displayName),
    instagramUsername: clean(details?.instagramUsername),
    profilePic: clean(details?.profilePic),
    aliases: [
      ...new Set(
        [instagramScopedId, canonicalParticipantId, manychatContactId]
          .map(clean)
          .filter(Boolean),
      ),
    ],
    source: clean(details?.source) || "identity_link",
    updatedAt: Date.now(),
  };

  if (!link.pageId || !link.instagramScopedId) return null;

  const igsidKey = identityScopedIdKey(link.pageId, link.instagramScopedId);
  memoryIdentityLinks.set(igsidKey, link);

  await statePutJson(
    env,
    `instagram:${igsidKey}`,
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
      `instagram:${manychatKey}`,
      link,
      IDENTITY_LINK_TTL_SECONDS,
    );
  }

  return link;
}

async function getIdentityLinkByScopedId(pageId, instagramScopedId, env) {
  return getIdentityLink(identityScopedIdKey(pageId, instagramScopedId), env);
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

  const stored = await stateGetJson(env, `instagram:${key}`);

  if (stored && typeof stored === "object") {
    memoryIdentityLinks.set(key, stored);
    return stored;
  }

  return null;
}

function identityScopedIdKey(pageId, instagramScopedId) {
  return `identity:igsid:${clean(pageId)}:${clean(instagramScopedId)}`;
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

function extractInstagramScopedIdFromManyChatInfo(info) {
  return clean(
    first(
      info?.subscriber?.instagram_scoped_id,
      info?.subscriber?.instagram_igsid,
      info?.subscriber?.ig_igsid,
      info?.subscriber?.igsid,
      info?.subscriber?.ig_sid,
      info?.subscriber?.page_scoped_id,
      info?.subscriber?.instagram_id,
      info?.subscriber?.ig_id,
      info?.root?.instagram_scoped_id,
      info?.root?.instagram_igsid,
      info?.root?.ig_igsid,
      info?.root?.igsid,
      info?.root?.ig_sid,
      info?.root?.page_scoped_id,
      info?.root?.instagram_id,
      info?.root?.ig_id,
    ),
  );
}


function extractManyChatDisplayName(info) {
  const root = info?.root || {};
  const subscriber = info?.subscriber || root;

  return clean(
    first(
      subscriber?.name,
      subscriber?.full_name,
      root?.name,
      root?.full_name,
      [
        clean(subscriber?.first_name || root?.first_name),
        clean(subscriber?.last_name || root?.last_name),
      ]
        .filter(Boolean)
        .join(" "),
    ),
  );
}

function extractInstagramUsernameFromManyChatInfo(info) {
  return clean(
    first(
      info?.subscriber?.ig_username,
      info?.subscriber?.instagram_username,
      info?.root?.ig_username,
      info?.root?.instagram_username,
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
      console.error("Instagram identity KV put failed", errorMessage(error));
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
        "Instagram identity cache put failed",
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
      console.error("Instagram identity KV get failed", errorMessage(error));
    }
  }

  const cache = globalThis?.caches?.default;

  if (cache?.match) {
    try {
      const response = await cache.match(stateCacheRequest(key));
      if (response) return await response.json();
    } catch (error) {
      console.error(
        "Instagram identity cache get failed",
        errorMessage(error),
      );
    }
  }

  return null;
}

async function stateDeleteJson(env, key) {
  const kv = identityKv(env);

  if (kv?.delete) {
    try {
      await kv.delete(key);
    } catch (error) {
      console.error("Instagram identity KV delete failed", errorMessage(error));
    }
  }

  const cache = globalThis?.caches?.default;

  if (cache?.delete) {
    try {
      await cache.delete(stateCacheRequest(key));
    } catch (error) {
      console.error(
        "Instagram identity cache delete failed",
        errorMessage(error),
      );
    }
  }
}


function stateCacheRequest(key) {
  return new Request(
    `https://mzj-instagram-identity.invalid/${encodeURIComponent(
      stableEventId(key),
    )}`,
  );
}

function identityKv(env) {
  return (
    env?.INSTAGRAM_IDENTITY_KV || env?.IDENTITY_KV || env?.DEBUG_KV || null
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
/* INSTAGRAM SEND                                                             */
/* ========================================================================== */

async function handleInstagramSend(request, env, ctx) {
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

  const target = await resolveInstagramSendTarget(body, env);

  if (!target.participantId && !target.manychatContactId && !target.commentId) {
    return json(
      {
        ok: false,
        status: "failed",
        error:
          "participantId/IGSID, manychatContactId, commentId, or a valid instagram:ACCOUNT_ID:IGSID conversationId is required",
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

  if (type === "text" || type === "buttons") {
    await rememberOutboundCorrelation(target, body, env);
  }

  const result =
    type === "media"
      ? await sendInstagramMedia(env, target, body)
      : await sendInstagramTextOrButtons(env, target, body);

  const responseBody = {
    ...result,
    provider: result?.provider || "manychat",
    platform: "instagram",
    channel: "instagram",
    channelCode: "ig",
    workerCode: WORKER_CODE,
    worker_code: WORKER_CODE,
    message_type: type,
    participantId: target.participantId,
    manychatContactId: target.manychatContactId,
    requestedManyChatContactId: target.requestedManyChatContactId,
    identityResolution: target.identityResolution,
    pageId: target.pageId,
    instagramAccountId: target.pageId,
    conversationId: target.conversationId,
    commentId: target.commentId,
    privateReply: result?.private_reply === true || result?.privateReply === true,
    version: VERSION,
  };

  if (ctx?.waitUntil) {
    ctx.waitUntil(
      kvPutJson(env, "DEBUG_INSTAGRAM_LAST_SEND", responseBody),
    );
  }

  return json(responseBody, result.ok ? 200 : 502);
}

async function resolveInstagramSendTarget(body, env) {
  const conversationId = clean(
    first(body?.convId, body?.conversationId, body?.conversation_id),
  );

  const parsed = parseInstagramConversationId(conversationId);

  // The Instagram professional account ID is the canonical namespace for
  // identity links. Prefer the explicit Instagram account fields and parsed
  // conversation before generic pageId values supplied by the platform.
  let pageId = clean(
    first(
      body?.instagramAccountId,
      body?.instagram_account_id,
      parsed?.pageId,
      instagramAccountId(env),
      body?.pageId,
      body?.page_id,
    ),
  );

  let participantId = clean(
    first(
      body?.participantId,
      body?.participant_id,
      body?.instagramScopedId,
      body?.instagram_scoped_id,
      body?.igsid,
      body?.igSid,
      body?.ig_sid,
      body?.igId,
      body?.ig_id,
      body?.recipientId,
      body?.recipient_id,
      parsed?.participantId,
    ),
  );

  const requestedManyChatContactId = clean(
    first(
      body?.manychatContactId,
      body?.manychat_contact_id,
      body?.subscriberId,
      body?.subscriber_id,
      body?.contactId,
      body?.contact_id,
    ),
  );
  const commentId = clean(
    first(
      body?.commentId,
      body?.comment_id,
      body?.instagramCommentId,
      body?.instagram_comment_id,
      body?.socialCommentId,
      body?.social_comment_id,
    ),
  );

  let manychatContactId = requestedManyChatContactId;
  let identityResolution = requestedManyChatContactId
    ? "request_manychat_contact_id"
    : "";

  if (!pageId) pageId = instagramAccountId(env);

  // The platform may echo participantId into manychatContactId. That value is
  // not authoritative. When an Instagram scoped ID is known, always prefer the
  // persisted direct KV link created from ManyChat getInfo.
  if (pageId && participantId) {
    const link = await getIdentityLinkByScopedId(
      pageId,
      participantId,
      env,
    );

    const linkedManyChatContactId = clean(link?.manychatContactId);

    if (linkedManyChatContactId) {
      manychatContactId = linkedManyChatContactId;
      identityResolution = "stored_identity_link_by_instagram_scoped_id";
    } else if (manychatContactId === participantId) {
      manychatContactId = "";
      identityResolution = "rejected_self_mapped_manychat_contact_id";
    }
  }

  if (!participantId && pageId && manychatContactId) {
    const link = await getIdentityLinkByManyChat(
      pageId,
      manychatContactId,
      env,
    );

    participantId = clean(link?.instagramScopedId);

    if (participantId) {
      manychatContactId = clean(link?.manychatContactId || manychatContactId);
      identityResolution = "stored_identity_link_by_manychat_contact_id";
    }
  }

  // A final lookup covers cases where participantId was resolved above.
  if (pageId && participantId && !manychatContactId) {
    const link = await getIdentityLinkByScopedId(
      pageId,
      participantId,
      env,
    );

    manychatContactId = clean(link?.manychatContactId);

    if (manychatContactId) {
      identityResolution = "stored_identity_link_by_instagram_scoped_id";
    }
  }

  return {
    conversationId:
      conversationId ||
      (pageId && participantId
        ? instagramConversationId(pageId, participantId)
        : ""),
    pageId,
    participantId,
    manychatContactId,
    requestedManyChatContactId,
    commentId,
    identityResolution,
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

async function sendInstagramTextOrButtons(env, target, body) {
  const textValue = clean(first(body?.text, body?.message));
  const buttons = normalizeButtons(body);
  const manychatContactId = clean(target?.manychatContactId);

  if (!manychatContactId) {
    const commentId = clean(target?.commentId);
    if (commentId && textValue && !buttons.length) {
      return sendInstagramPrivateReply(env, {
        commentId,
        text: textValue,
        participantId: clean(target?.participantId),
        pageId: clean(target?.pageId),
      });
    }
    return {
      ...failedProviderResult(
        commentId
          ? "Instagram private reply supports text only"
          : "ManyChat Contact ID mapping missing for Instagram participant",
      ),
      provider: commentId ? "instagram_graph" : "manychat",
      send_method: commentId ? "graph_private_reply" : "manychat",
      participantId: clean(target?.participantId),
      manychatContactId: "",
      commentId,
      attempts: [],
    };
  }

  const manychat = await sendManyChatInstagramContent(
    manychatContactId,
    {
      type: buttons.length ? "buttons" : "text",
      text: textValue || (buttons.length ? "اختر من القائمة" : ""),
      buttons,
      participantId: clean(target?.participantId),
      pageId: clean(target?.pageId),
      conversationId: clean(target?.conversationId),
    },
    env,
  );

  const attempts = [providerAttemptSummary("manychat", manychat)];

  return {
    ...manychat,
    provider: "manychat",
    send_method: "manychat",
    subscriber_id: manychatContactId,
    manychatContactId,
    attempts,
  };
}

async function sendInstagramPrivateReply(env, input) {
  const commentId = clean(input?.commentId);
  const textValue = clean(input?.text);
  const accessToken = instagramAccessToken(env);
  const accountId = clean(first(input?.pageId, instagramAccountId(env)));

  if (!commentId) return failedProviderResult("commentId missing");
  if (!textValue) return failedProviderResult("private reply text missing");
  if (!accessToken) return failedProviderResult("IG_PAGE_ACCESS_TOKEN missing");
  if (!accountId) return failedProviderResult("Instagram professional account ID missing");

  try {
    const response = await fetch(`${graphBase(env)}/${encodeURIComponent(accountId)}/messages`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text: textValue },
      }),
    });
    const rawText = await response.text();
    const raw = parseJson(rawText);
    const normalized = normalizeProviderResponse(response.status, response.ok, raw, rawText);
    const recipientId = clean(raw?.recipient_id || raw?.recipientId || input?.participantId);
    return {
      ...normalized,
      provider: "instagram_graph",
      send_method: "graph_private_reply",
      private_reply: true,
      privateReply: true,
      comment_id: commentId,
      commentId,
      recipient_id: recipientId,
      recipientId,
      participantId: recipientId,
      attempts: [providerAttemptSummary("instagram_graph_private_reply", normalized)],
    };
  } catch (error) {
    return {
      ...failedProviderResult(errorMessage(error)),
      provider: "instagram_graph",
      send_method: "graph_private_reply",
      private_reply: true,
      privateReply: true,
      comment_id: commentId,
      commentId,
      attempts: [],
    };
  }
}

async function sendInstagramMedia(env, target, body) {
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

  const mediaType = normalizeOutboundInstagramMediaType(
    first(
      body?.media_type,
      body?.mediaType,
      body?.attachment_type,
      body?.attachmentType,
      body?.type,
      "file",
    ),
  );

  if (!mediaUrl) return failedProviderResult("missing media_url");

  const manychatContactId = clean(target?.manychatContactId);

  if (!manychatContactId) {
    return {
      ...failedProviderResult(
        "ManyChat Contact ID mapping missing for Instagram participant",
      ),
      provider: "manychat",
      send_method: "manychat",
      participantId: clean(target?.participantId),
      manychatContactId: "",
      media_type: mediaType,
      media_url: mediaUrl,
      attempts: [],
    };
  }

  const manychat = await sendManyChatInstagramContent(
    manychatContactId,
    {
      type: "media",
      mediaType,
      mediaUrl,
    },
    env,
  );

  const attempts = [providerAttemptSummary("manychat", manychat)];

  return {
    ...manychat,
    provider: "manychat",
    send_method: "manychat",
    subscriber_id: manychatContactId,
    manychatContactId,
    media_type: mediaType,
    media_url: mediaUrl,
    attempts,
  };
}

async function sendManyChatInstagramContent(subscriberId, input, env) {
  const token = manychatToken(env);
  const cleanSubscriberId = clean(subscriberId);

  if (!token) return failedProviderResult("MANYCHAT_API_TOKEN missing");
  if (!cleanSubscriberId) {
    return failedProviderResult("manychatContactId/subscriberId missing");
  }

  let message = null;
  let quickReplies = [];

  if (input?.type === "media") {
    const mediaUrl = clean(input?.mediaUrl);
    const mediaType = normalizeManyChatMediaType(input?.mediaType);

    if (!mediaUrl) return failedProviderResult("missing media_url");

    message = {
      type: mediaType,
      url: mediaUrl,
    };
  } else {
    const textValue = clean(input?.text);
    const buttons = Array.isArray(input?.buttons) ? input.buttons : [];

    if (!textValue && !buttons.length) {
      return failedProviderResult("text/buttons missing");
    }

    message = {
      type: "text",
      text: textValue || "اختر من القائمة",
    };

    if (buttons.length) {
      const callbackUrl = manychatQuickReplyCallbackUrl(env);
      const callbackSecret = clean(env?.MANYCHAT_WEBHOOK_SECRET);
      const participantId = clean(input?.participantId);
      const pageId = clean(first(input?.pageId, instagramAccountId(env)));
      const conversationId =
        clean(input?.conversationId) ||
        (pageId && participantId
          ? instagramConversationId(pageId, participantId)
          : "");

      quickReplies = buttons.slice(0, 11).map((button) => {
        const reply = {
          type: "dynamic_block_callback",
          caption: clean(button?.title).slice(0, 20),
          url: callbackUrl,
          method: "post",
          payload: {
            participantId,
            manychatContactId: cleanSubscriberId,
            instagramAccountId: pageId,
            conversationId,
            text: clean(button?.title).slice(0, 20),
            payload: clean(button?.payload),
          },
        };

        if (callbackSecret) {
          reply.headers = {
            "x-manychat-webhook-secret": callbackSecret,
          };
        }

        return reply;
      });
    }
  }

  const payload = {
    subscriber_id: cleanSubscriberId,
    data: {
      version: "v2",
      content: {
        type: "instagram",
        messages: [message],
        actions: [],
        quick_replies: quickReplies,
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

async function sendInstagramGraphMessage(env, input) {
  const accessToken = instagramAccessToken(env);
  const participantId = clean(input?.participantId);

  if (!accessToken) {
    return failedProviderResult("IG_PAGE_ACCESS_TOKEN missing");
  }

  if (!participantId) {
    return failedProviderResult("participantId/IGSID missing");
  }

  const payload = {
    recipient: {
      id: participantId,
    },
    message: input?.message || {},
  };

  try {
    const response = await fetch(instagramSendEndpoint(env), {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
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

function normalizeManyChatMediaType(value) {
  const type = normalizeMediaType(value);

  if (type === "document" || type === "attachment" || type === "link") {
    return "file";
  }

  if (["image", "audio", "video", "file"].includes(type)) {
    return type;
  }

  return "file";
}

function failedSendResultFromAttempts(attempts, fallbackMessage) {
  const errors = (Array.isArray(attempts) ? attempts : [])
    .map((item) => clean(item?.error))
    .filter(Boolean);

  return {
    ...failedProviderResult(first(errors.join(" | "), fallbackMessage)),
    attempts: Array.isArray(attempts) ? attempts : [],
    send_method: "",
  };
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
    error: clean(message) || "Instagram request failed",
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
        "x-mzj-source": clean(sourceHeader) || "instagram",
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
    throw new Error("Instagram attachment has no downloadable URL");
  }

  const mediaResponse = await fetchInstagramAttachment(sourceUrl, env);

  if (!mediaResponse.ok) {
    throw new Error(
      `Failed to download Instagram attachment: HTTP ${mediaResponse.status}`,
    );
  }

  const bytes = await mediaResponse.arrayBuffer();

  if (!bytes.byteLength) {
    throw new Error("Instagram attachment download returned an empty file");
  }

  const maxBytes = positiveInteger(
    env?.MAX_MEDIA_BYTES,
    DEFAULT_MAX_MEDIA_BYTES,
  );

  if (bytes.byteLength > maxBytes) {
    throw new Error(
      `Instagram attachment exceeds the ${maxBytes} byte platform limit`,
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
      "x-mzj-source": "instagram",
      "x-event-id": clean(input?.eventId),
    },
    body: JSON.stringify({
      action: "prepare_upload",
      source: "instagram",
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

async function fetchInstagramAttachment(url, env) {
  const attempts = [];
  const pageToken = instagramAccessToken(env);

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
/* INSTAGRAM + MANYCHAT LOOKUPS                                               */
/* ========================================================================== */

async function fetchInstagramName(participantId, env) {
  const fromGraph = await fetchInstagramGraphName(participantId, env).catch(
    () => "",
  );

  if (fromGraph) return fromGraph;

  return fetchManyChatName(participantId, env).catch(() => "");
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

async function fetchInstagramGraphName(participantId, env) {
  const token = instagramAccessToken(env);

  if (!token || !clean(participantId)) return "";

  const url = new URL(
    `${graphBase(env)}/${encodeURIComponent(clean(participantId))}`,
  );

  url.searchParams.set("fields", "name,username");
  url.searchParams.set("access_token", token);

  const response = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) return "";

  const raw = await response.json().catch(() => null);

  return first(
    raw?.name,
    raw?.username ? `@${clean(raw.username)}` : "",
  );
}

/* ========================================================================== */
/* ENDPOINTS + AUTH                                                           */
/* ========================================================================== */

function instagramVerifyToken(env) {
  return clean(
    env?.IG_VERIFY_TOKEN ||
      env?.INSTAGRAM_VERIFY_TOKEN ||
      env?.META_VERIFY_TOKEN,
  );
}

function instagramAppSecret(env) {
  return clean(
    env?.IG_APP_SECRET ||
      env?.INSTAGRAM_APP_SECRET ||
      env?.META_APP_SECRET,
  );
}

function instagramAccountId(env) {
  return clean(
    env?.IG_USER_ID ||
      env?.IG_PROFESSIONAL_ACCOUNT_ID ||
      env?.INSTAGRAM_USER_ID ||
      env?.INSTAGRAM_BUSINESS_ACCOUNT_ID ||
      env?.IG_PAGE_ID ||
      env?.INBOX_PAGE_ID,
  );
}

function instagramAccessToken(env) {
  // This app uses Facebook Login for Business. Prefer the Page Access Token
  // generated for the Facebook Page connected to the Instagram professional account.
  // Keep the legacy Instagram-token names only as a final compatibility fallback.
  return clean(
    env?.IG_PAGE_ACCESS_TOKEN ||
      env?.INSTAGRAM_PAGE_ACCESS_TOKEN ||
      env?.FB_PAGE_ACCESS_TOKEN ||
      env?.IG_ACCESS_TOKEN ||
      env?.INSTAGRAM_ACCESS_TOKEN,
  );
}

function graphBase(env) {
  const version =
    clean(env?.IG_GRAPH_API_VERSION || env?.INSTAGRAM_GRAPH_API_VERSION) ||
    DEFAULT_GRAPH_API_VERSION;

  // Facebook Login for Business + Page Access Token uses graph.facebook.com.
  return `https://graph.facebook.com/${version}`;
}

function instagramSendEndpoint(env) {
  const override = clean(
    env?.INSTAGRAM_SEND_URL || env?.IG_SEND_URL,
  );

  if (override) return override;

  const accountId = instagramAccountId(env);
  return accountId
    ? `${graphBase(env)}/${encodeURIComponent(accountId)}/messages`
    : `${graphBase(env)}/me/messages`;
}

function manychatSendEndpoint(env) {
  return (
    clean(env?.MANYCHAT_SEND_URL) ||
    "https://api.manychat.com/fb/sending/sendContent"
  );
}

function manychatQuickReplyCallbackUrl(env) {
  const explicit = clean(env?.MANYCHAT_QUICK_REPLY_CALLBACK_URL);
  if (explicit) return explicit;

  const base = clean(
    env?.WORKER_PUBLIC_URL || env?.PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL,
  ).replace(/\/+$/, "");

  return `${base}/manychat/quick-reply`;
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

  // ManyChat External Request in the current live flow sends no custom header.
  // Keep the configured secret optional so the identity callback is not rejected.
  if (!expected) return true;

  const provided = first(
    request.headers.get("x-manychat-webhook-secret"),
    request.headers.get("x-mzj-gateway-secret"),
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""),
    new URL(request.url).searchParams.get("secret"),
  );

  if (!provided) return true;
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

function instagramConversationId(pageId, participantId) {
  return `instagram:${clean(pageId)}:${clean(participantId)}`;
}

function parseInstagramConversationId(value) {
  const match = clean(value).match(/^instagram:([^:]+):(.+)$/);

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

function normalizeOutboundInstagramMediaType(value) {
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

  return `instagram_${(hash >>> 0).toString(16)}`;
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
  const parsed = await readJsonRequest(request);
  return parsed.value || {};
}

async function readJsonRequest(request) {
  const raw = await request.text();

  try {
    return {
      value: raw ? JSON.parse(raw) : {},
      raw,
      repaired: false,
      error: "",
    };
  } catch (firstError) {
    const repairedRaw = escapeUnescapedJsonControlCharacters(raw);

    try {
      return {
        value: repairedRaw ? JSON.parse(repairedRaw) : {},
        raw,
        repaired: repairedRaw !== raw,
        error: "",
      };
    } catch (secondError) {
      return {
        value: null,
        raw,
        repaired: repairedRaw !== raw,
        error: errorMessage(secondError || firstError),
      };
    }
  }
}

function escapeUnescapedJsonControlCharacters(value) {
  const raw = String(value || "");
  let output = "";
  let inString = false;
  let escaped = false;

  for (const char of raw) {
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      output += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      output += char;
      inString = !inString;
      continue;
    }

    if (inString) {
      if (char === "\n") {
        output += "\\n";
        continue;
      }
      if (char === "\r") {
        output += "\\r";
        continue;
      }
      if (char === "\t") {
        output += "\\t";
        continue;
      }
      if (char === "\b") {
        output += "\\b";
        continue;
      }
      if (char === "\f") {
        output += "\\f";
        continue;
      }

      const code = char.charCodeAt(0);
      if (code >= 0 && code <= 31) {
        output += `\\u${code.toString(16).padStart(4, "0")}`;
        continue;
      }
    }

    output += char;
  }

  return output;
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
