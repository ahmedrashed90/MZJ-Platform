const INBOUND_ROUTES = new Map([
  ["/webhooks/facebook", "facebook"],
  ["/webhooks/instagram", "instagram"],
  ["/webhooks/tiktok", "tiktok"],
  ["/imports/tiktok-snapchat", "tiktok-snapchat"],
  ["/imports/installment-calculator", "installment-calculator"],
]);

const OUTBOUND_ROUTES = new Map([
  ["/send/facebook", "facebook"],
  ["/send/instagram", "instagram"],
  ["/send/tiktok", "tiktok"],
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return json({
        ok: true,
        service: "mzj-integration-gateway",
        inbound: [...INBOUND_ROUTES.keys()],
        outbound: [...OUTBOUND_ROUTES.keys()],
        zoho: [
          "POST /zoho/upload-part",
          "POST /zoho/upload-finalize",
          "POST /zoho/upload",
          "GET /zoho/media/:fileId",
        ],
      });
    }

    if (request.method === "GET" && url.pathname === "/webhooks/facebook") {
      return verifyFacebookWebhook(url, env);
    }

    if (request.method === "POST" && url.pathname === "/zoho/upload-part") {
      return handleZohoUploadPart(request, env, url);
    }

    if (request.method === "POST" && url.pathname === "/zoho/upload-finalize") {
      return handleZohoUploadFinalize(env, url);
    }

    // Kept for small-file compatibility. The platform UI uses the chunked routes
    // above so 200-300 MB files do not depend on the Cloudflare plan body limit.
    if (["POST", "PUT"].includes(request.method) && url.pathname === "/zoho/upload") {
      return handleZohoUpload(request, env, url);
    }

    const zohoMediaMatch = url.pathname.match(/^\/zoho\/media\/([^/]+)$/);
    if (request.method === "GET" && zohoMediaMatch) {
      return handleZohoMedia(request, env, url, decodeURIComponent(zohoMediaMatch[1]));
    }

    const inboundSource = INBOUND_ROUTES.get(url.pathname);
    if (inboundSource) {
      if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleInbound(request, env, inboundSource);
    }

    const outboundSource = OUTBOUND_ROUTES.get(url.pathname);
    if (outboundSource) {
      if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      if (!safeEquals(request.headers.get("x-mzj-gateway-secret") || "", env.GATEWAY_SECRET || "")) {
        return json({ ok: false, error: "Unauthorized gateway send" }, 401);
      }
      const payload = await readJson(request);
      return sendOutbound(outboundSource, payload, env);
    }

    return json({ ok: false, error: "Not found" }, 404);
  },
};

function positiveInteger(value, maximum = 10000) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : 0;
}

function zohoStagingBucket(env) {
  const bucket = env.ZOHO_UPLOAD_STAGING;
  if (!bucket) throw new Error("ZOHO_UPLOAD_STAGING R2 binding is not configured");
  return bucket;
}

function stagingPartKey(uploadId, partNumber) {
  const safeUploadId = String(uploadId || "").replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safeUploadId) throw new Error("Zoho upload ID is invalid");
  return `zoho-upload-staging/${safeUploadId}/${String(partNumber).padStart(6, "0")}.part`;
}

async function handleZohoUploadPart(request, env, url) {
  const ticket = String(url.searchParams.get("ticket") || "").trim();
  const partNumber = positiveInteger(url.searchParams.get("partNumber"));
  const totalParts = positiveInteger(url.searchParams.get("totalParts"));
  if (!ticket || !partNumber || !totalParts || partNumber > totalParts) {
    return json({ ok: false, error: "Upload ticket and valid part numbers are required" }, 400);
  }
  if (!request.body) return json({ ok: false, error: "Upload part body is required" }, 400);

  try {
    const prepared = await platformGatewayRequest(env, `/integrations/zoho/upload-ticket?ticket=${encodeURIComponent(ticket)}`);
    if (!prepared.ok) return json({ ok: false, error: prepared.error || "Upload ticket could not be prepared" }, prepared.status || 502);
    const bucket = zohoStagingBucket(env);
    const key = stagingPartKey(prepared.data.uploadId, partNumber);
    const stored = await bucket.put(key, request.body, {
      httpMetadata: { contentType: "application/octet-stream" },
      customMetadata: {
        uploadId: String(prepared.data.uploadId || ""),
        fileId: String(prepared.data.fileId || ""),
        partNumber: String(partNumber),
        totalParts: String(totalParts),
      },
    });
    return json({ ok: true, partNumber, totalParts, size: Number(stored?.size || 0) });
  } catch (failure) {
    return json({ ok: false, error: failure instanceof Error ? failure.message : "Failed to stage upload part" }, 502);
  }
}

function concatenatedR2Stream(bucket, keys) {
  let keyIndex = 0;
  let currentReader = null;
  return new ReadableStream({
    async pull(controller) {
      while (true) {
        if (!currentReader) {
          if (keyIndex >= keys.length) {
            controller.close();
            return;
          }
          const object = await bucket.get(keys[keyIndex]);
          if (!object?.body) throw new Error(`Upload part ${keyIndex + 1} is missing`);
          currentReader = object.body.getReader();
        }
        const chunk = await currentReader.read();
        if (chunk.done) {
          currentReader = null;
          keyIndex += 1;
          continue;
        }
        controller.enqueue(chunk.value);
        return;
      }
    },
    async cancel(reason) {
      if (currentReader) await currentReader.cancel(reason);
    },
  });
}

async function reportZohoUploadCompletion(env, ticket, uploadResponse, uploadResult) {
  const completionPayload = uploadResponse.ok
    ? { ticket, result: uploadResult }
    : { ticket, result: uploadResult, error: providerError(uploadResult, uploadResponse.status) };
  return platformGatewayRequest(env, "/integrations/zoho/upload-complete", {
    method: "POST",
    body: completionPayload,
  });
}

async function reportZohoTransportFailure(env, ticket, failure) {
  const message = failure instanceof Error ? failure.message : String(failure || "Zoho upload transport failed");
  return platformGatewayRequest(env, "/integrations/zoho/upload-complete", {
    method: "POST",
    body: { ticket, error: message },
  });
}

async function handleZohoUploadFinalize(env, url) {
  const ticket = String(url.searchParams.get("ticket") || "").trim();
  const totalParts = positiveInteger(url.searchParams.get("totalParts"));
  if (!ticket || !totalParts) return json({ ok: false, error: "Upload ticket and total parts are required" }, 400);

  let keys = [];
  let bucket;
  try {
    const prepared = await platformGatewayRequest(env, `/integrations/zoho/upload-ticket?ticket=${encodeURIComponent(ticket)}`);
    if (!prepared.ok) return json({ ok: false, error: prepared.error || "Upload ticket could not be prepared" }, prepared.status || 502);
    bucket = zohoStagingBucket(env);
    keys = Array.from({ length: totalParts }, (_, index) => stagingPartKey(prepared.data.uploadId, index + 1));

    let stagedSize = 0;
    for (let index = 0; index < keys.length; index += 1) {
      const part = await bucket.head(keys[index]);
      if (!part) return json({ ok: false, error: `Upload part ${index + 1} is missing` }, 409);
      stagedSize += Number(part.size || 0);
    }
    const expectedSize = Number(prepared.data.fileSize || 0);
    if (expectedSize > 0 && stagedSize !== expectedSize) {
      return json({ ok: false, error: `Staged file size mismatch (${stagedSize}/${expectedSize})` }, 409);
    }

    const uploadResponse = await fetch(prepared.data.uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${prepared.data.accessToken}`,
        Accept: "application/vnd.api+json",
        "content-type": "application/octet-stream",
        "content-length": String(stagedSize),
        "x-filename": encodeURIComponent(String(prepared.data.fileName || "upload.bin")),
        "x-parent_id": String(prepared.data.parentFolderId || ""),
        "upload-id": String(prepared.data.uploadId || crypto.randomUUID()),
        "x-override-name-exist": "false",
        "x-streammode": "1",
      },
      body: concatenatedR2Stream(bucket, keys),
    });
    const uploadText = await uploadResponse.text();
    const uploadResult = parseJson(uploadText);
    const completed = await reportZohoUploadCompletion(env, ticket, uploadResponse, uploadResult);
    if (!uploadResponse.ok || !completed.ok) {
      return json({
        ok: false,
        error: completed.error || providerError(uploadResult, uploadResponse.status),
        zohoStatus: uploadResponse.status,
      }, completed.status || uploadResponse.status || 502);
    }
    return json({ ok: true, ...completed.data }, 200);
  } catch (failure) {
    await reportZohoTransportFailure(env, ticket, failure).catch(() => null);
    return json({ ok: false, error: failure instanceof Error ? failure.message : "Zoho upload failed" }, 502);
  } finally {
    if (bucket && keys.length) await Promise.allSettled(keys.map((key) => bucket.delete(key)));
  }
}

async function handleZohoUpload(request, env, url) {
  const ticket = String(url.searchParams.get("ticket") || "").trim();
  if (!ticket) return json({ ok: false, error: "Upload ticket is required" }, 400);

  try {
    const prepared = await platformGatewayRequest(env, `/integrations/zoho/upload-ticket?ticket=${encodeURIComponent(ticket)}`);
    if (!prepared.ok) return json({ ok: false, error: prepared.error || "Upload ticket could not be prepared" }, prepared.status || 502);

    const fileName = String(prepared.data.fileName || "upload.bin");
    const mimeType = String(prepared.data.mimeType || request.headers.get("content-type") || "application/octet-stream");
    const uploadResponse = await fetch(prepared.data.uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${prepared.data.accessToken}`,
        Accept: "application/vnd.api+json",
        "content-type": mimeType,
        "x-filename": encodeURIComponent(fileName),
        "x-parent_id": String(prepared.data.parentFolderId || ""),
        "upload-id": String(prepared.data.uploadId || crypto.randomUUID()),
        "x-override-name-exist": "false",
        "x-streammode": "1",
      },
      body: request.body,
    });

    const uploadText = await uploadResponse.text();
    const uploadResult = parseJson(uploadText);
    const completed = await reportZohoUploadCompletion(env, ticket, uploadResponse, uploadResult);
    if (!uploadResponse.ok || !completed.ok) {
      return json({
        ok: false,
        error: completed.error || providerError(uploadResult, uploadResponse.status),
        zohoStatus: uploadResponse.status,
      }, completed.status || uploadResponse.status || 502);
    }
    return json({ ok: true, ...completed.data }, 200);
  } catch (failure) {
    await reportZohoTransportFailure(env, ticket, failure).catch(() => null);
    return json({ ok: false, error: failure instanceof Error ? failure.message : "Zoho upload failed" }, 502);
  }
}

async function handleZohoMedia(_request, env, url, fileId) {
  const ticket = String(url.searchParams.get("ticket") || "").trim();
  if (!ticket || !fileId) return json({ ok: false, error: "Media ticket and file ID are required" }, 400);

  const prepared = await platformGatewayRequest(
    env,
    `/integrations/zoho/media-ticket?fileId=${encodeURIComponent(fileId)}&ticket=${encodeURIComponent(ticket)}`,
  );
  if (!prepared.ok) return json({ ok: false, error: prepared.error || "Media ticket is invalid" }, prepared.status || 404);

  const upstream = await fetch(prepared.data.downloadUrl, {
    headers: {
      Authorization: `Zoho-oauthtoken ${prepared.data.accessToken}`,
      Accept: "*/*",
    },
  });
  if (!upstream.ok || !upstream.body) {
    return json({ ok: false, error: `Zoho media download failed (${upstream.status})` }, upstream.status || 502);
  }

  const headers = new Headers(corsHeaders());
  headers.set("content-type", upstream.headers.get("content-type") || prepared.data.mimeType || "application/octet-stream");
  const length = upstream.headers.get("content-length");
  if (length) headers.set("content-length", length);
  headers.set("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(prepared.data.fileName || "media")}`);
  headers.set("cache-control", "private, no-store");
  return new Response(upstream.body, { status: 200, headers });
}

async function platformGatewayRequest(env, path, options = {}) {
  const base = String(env.PLATFORM_API_BASE_URL || "").replace(/\/$/, "");
  if (!base) return { ok: false, status: 503, error: "PLATFORM_API_BASE_URL is not configured", data: {} };
  if (!env.GATEWAY_SECRET) return { ok: false, status: 503, error: "GATEWAY_SECRET is not configured", data: {} };
  const response = await fetch(`${base}${path}`, {
    method: options.method || "GET",
    headers: {
      "x-mzj-gateway-secret": env.GATEWAY_SECRET,
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const data = parseJson(text);
  return {
    ok: response.ok && data?.ok !== false,
    status: response.status,
    error: response.ok ? String(data?.error || "") : String(data?.error || data?.message || `Platform API ${response.status}`),
    data,
  };
}

function providerError(payload, status) {
  return String(payload?.errors?.[0]?.detail || payload?.error?.message || payload?.message || payload?.error || `Zoho upload failed (${status})`);
}

async function handleInbound(request, env, routeSource) {
  const rawBody = await request.text();
  const payload = parseJson(rawBody);
  const verified = await verifyInbound(request, env, routeSource, rawBody);
  if (!verified.ok) return json({ ok: false, error: verified.error }, verified.status || 401);

  if (routeSource === "facebook" && payload?.object === "page") {
    const events = normalizeFacebookEvents(payload);
    const results = [];
    for (const event of events) {
      results.push(await forwardToPlatform(env, routeSource, event.payload, event.eventId));
    }
    return aggregateResponse(routeSource, results);
  }

  if (["tiktok-snapchat", "installment-calculator"].includes(routeSource)) {
    const rows = Array.isArray(payload?.rows) ? payload.rows : [payload?.row && typeof payload.row === "object" ? payload.row : payload];
    const results = [];
    for (const row of rows.filter(Boolean)) {
      const eventId = String(row.eventId || row.event_id || row.id || hashText(JSON.stringify(row)));
      results.push(await forwardToPlatform(env, routeSource, row, eventId));
    }
    return aggregateResponse(routeSource, results);
  }

  const eventId = String(payload?.eventId || payload?.event_id || payload?.messageId || payload?.message_id || payload?.id || hashText(rawBody));
  const result = await forwardToPlatform(env, routeSource, payload, eventId);
  return new Response(result.body, { status: result.status, headers: { ...corsHeaders(), "content-type": result.contentType } });
}

async function verifyInbound(request, env, source, rawBody) {
  if (source === "facebook" && env.FB_APP_SECRET && request.headers.get("x-hub-signature-256")) {
    const valid = await verifyMetaSignature(request.headers.get("x-hub-signature-256"), rawBody, env.FB_APP_SECRET);
    return valid ? { ok: true } : { ok: false, status: 401, error: "Bad Facebook signature" };
  }

  const sourceKey = `${source.toUpperCase().replace(/-/g, "_")}_WEBHOOK_SECRET`;
  const expected = String(env[sourceKey] || env.INBOUND_SHARED_SECRET || "").trim();
  if (!expected) return { ok: false, status: 503, error: `${sourceKey} or INBOUND_SHARED_SECRET is not configured` };
  const provided = String(request.headers.get("x-webhook-secret") || new URL(request.url).searchParams.get("secret") || "").trim();
  return safeEquals(provided, expected) ? { ok: true } : { ok: false, status: 401, error: "Invalid webhook secret" };
}

function verifyFacebookWebhook(url, env) {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && safeEquals(token, env.FB_VERIFY_TOKEN || "")) {
    return new Response(challenge || "", { status: 200, headers: corsHeaders() });
  }
  return new Response("Forbidden", { status: 403, headers: corsHeaders() });
}

async function forwardToPlatform(env, source, payload, eventId) {
  const base = String(env.PLATFORM_API_BASE_URL || "").replace(/\/$/, "");
  if (!base) return { status: 503, body: JSON.stringify({ ok: false, error: "PLATFORM_API_BASE_URL is not configured" }), contentType: "application/json" };
  const upstream = await fetch(`${base}/integrations/${source}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mzj-source": source,
      "x-mzj-gateway-secret": env.GATEWAY_SECRET || "",
      "x-event-id": eventId || "",
    },
    body: JSON.stringify({ ...payload, eventId: payload?.eventId || eventId }),
  });
  return {
    status: upstream.status,
    body: await upstream.text(),
    contentType: upstream.headers.get("content-type") || "application/json",
  };
}

function normalizeFacebookEvents(payload) {
  const events = [];
  for (const entry of payload?.entry || []) {
    const pageId = String(entry?.id || "");
    for (const item of [...(entry?.messaging || []), ...(entry?.standby || [])]) {
      const senderId = String(item?.sender?.id || "");
      const recipientId = String(item?.recipient?.id || "");
      const isEcho = item?.message?.is_echo === true || senderId === pageId;
      const participantId = isEcho ? recipientId : senderId;
      if (!participantId) continue;
      const attachment = item?.message?.attachments?.[0] || {};
      const messageId = String(item?.message?.mid || item?.postback?.mid || `${entry?.time || Date.now()}_${participantId}`);
      const text = String(item?.message?.text || item?.postback?.title || item?.postback?.payload || "");
      events.push({
        eventId: `facebook_${messageId}`,
        payload: {
          participantId,
          pageId,
          conversationId: `facebook:${pageId}:${participantId}`,
          messageId,
          message: text,
          text,
          direction: isEcho ? "out" : "in",
          provider: "meta",
          platform: "facebook",
          attachmentUrl: attachment?.payload?.url || "",
          attachmentType: attachment?.type || "",
          saveMessage: true,
          createLead: false,
          timestamp: item?.timestamp || entry?.time || Date.now(),
        },
      });
    }
  }
  return events;
}

async function sendOutbound(source, payload, env) {
  if (source === "instagram") return responseFromResult(await sendManyChat(payload, env.MANYCHAT_INSTAGRAM_TOKEN || env.MANYCHAT_API_TOKEN));
  if (source === "facebook") {
    const manychat = await sendManyChat(payload, env.MANYCHAT_FACEBOOK_TOKEN || env.MANYCHAT_API_TOKEN);
    if (manychat.ok) return responseFromResult(manychat);
    return responseFromResult(await sendFacebookGraph(payload, env.FB_PAGE_ACCESS_TOKEN));
  }
  if (source === "tiktok") return responseFromResult(await sendTikTok(payload, env));
  return json({ ok: false, error: "Unknown send source" }, 400);
}

async function sendManyChat(payload, token) {
  const subscriberId = String(payload?.participantId || payload?.subscriber_id || payload?.subscriberId || "").trim();
  const text = String(payload?.message || payload?.text || "").trim();
  if (!subscriberId || !text) return { ok: false, error: "participantId and message are required" };
  if (!token) return { ok: false, error: "ManyChat token is not configured" };
  const response = await fetch("https://api.manychat.com/fb/sending/sendContent", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ subscriber_id: subscriberId, data: { version: "v2", content: { messages: [{ type: "text", text }] } } }),
  });
  return providerResult(response, "manychat");
}

async function sendFacebookGraph(payload, token) {
  const participantId = String(payload?.participantId || "").trim();
  const text = String(payload?.message || payload?.text || "").trim();
  if (!participantId || !text) return { ok: false, error: "participantId and message are required" };
  if (!token) return { ok: false, error: "FB_PAGE_ACCESS_TOKEN is not configured" };
  const response = await fetch(`https://graph.facebook.com/v20.0/me/messages?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient: { id: participantId }, message: { text } }),
  });
  return providerResult(response, "facebook_graph");
}

async function sendTikTok(payload, env) {
  const subscriberId = String(payload?.participantId || payload?.subscriber_id || payload?.subscriberId || "").trim();
  const text = String(payload?.message || payload?.text || "").trim();
  const token = env.MANYCHAT_TIKTOK_TOKEN || env.MANYCHAT_API_KEY;
  const fieldId = Number(env.MANYCHAT_MESSAGE_FIELD_ID);
  const tagId = Number(env.MANYCHAT_TRIGGER_TAG_ID);
  if (!subscriberId || !text) return { ok: false, error: "participantId and message are required" };
  if (!token || !fieldId || !tagId) return { ok: false, error: "TikTok ManyChat settings are not configured" };
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  await callManyChat("https://api.manychat.com/fb/subscriber/removeTag", headers, { subscriber_id: subscriberId, tag_id: tagId });
  await sleep(700);
  const field = await callManyChat("https://api.manychat.com/fb/subscriber/setCustomField", headers, { subscriber_id: subscriberId, field_id: fieldId, field_value: text });
  await sleep(700);
  const tag = await callManyChat("https://api.manychat.com/fb/subscriber/addTag", headers, { subscriber_id: subscriberId, tag_id: tagId });
  return { ok: field.ok && tag.ok, provider: "manychat_tiktok", setField: field, addTag: tag };
}

async function callManyChat(url, headers, payload) {
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  const result = await providerResult(response, "manychat");
  return { ok: result.ok, status: result.httpStatus, response: result.raw };
}

async function providerResult(response, provider) {
  const text = await response.text();
  let raw = text;
  try { raw = text ? JSON.parse(text) : {}; } catch {}
  return { ok: response.ok && raw?.ok !== false, provider, httpStatus: response.status, raw, error: response.ok ? "" : raw?.error || `HTTP ${response.status}` };
}

function responseFromResult(result) {
  return json(result, result.ok ? 200 : 502);
}

function aggregateResponse(source, results) {
  const ok = results.every((item) => item.status >= 200 && item.status < 300);
  return json({
    ok,
    source,
    count: results.length,
    results: results.map((item) => ({ status: item.status, response: parseJson(item.body) })),
  }, ok ? 202 : 502);
}

async function verifyMetaSignature(signatureHeader, rawBody, secret) {
  const expectedPrefix = "sha256=";
  if (!signatureHeader?.startsWith(expectedPrefix)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = expectedPrefix + [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return safeEquals(signatureHeader, expected);
}

function safeEquals(left, right) {
  const a = new TextEncoder().encode(String(left || ""));
  const b = new TextEncoder().encode(String(right || ""));
  if (!a.length || a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

function normalizePhone(value) {
  let phone = String(value || "").replace(/\D/g, "");
  if (/^05\d{8}$/.test(phone)) phone = `966${phone.slice(1)}`;
  if (/^5\d{8}$/.test(phone)) phone = `966${phone}`;
  return /^9665\d{8}$/.test(phone) ? phone : "";
}

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function parseJson(text) {
  if (text && typeof text === "object") return text;
  try { return JSON.parse(String(text || "{}")); } catch { return { raw: String(text || "") }; }
}

async function readJson(request) {
  return parseJson(await request.text());
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-webhook-secret,x-hub-signature-256,x-mzj-gateway-secret",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() },
  });
}
