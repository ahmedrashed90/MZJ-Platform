type InstagramGraphMethod = "GET" | "POST";

type InstagramMediaInput = {
  url: string;
  isVideo: boolean;
};

type InstagramPublishInput = {
  instagramUserId: string;
  accessToken: string;
  publishFormat: string;
  caption: string;
  media: InstagramMediaInput[];
};

type InstagramPublisherRuntime = {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  graphVersion?: string;
  processingTimeoutMs?: number;
  pollingIntervalMs?: number;
  publishRetryCount?: number;
};

type InstagramGraphErrorDetails = {
  httpStatus: number;
  code?: number;
  subcode?: number;
  type?: string;
  traceId?: string;
  payload?: unknown;
};

class InstagramGraphError extends Error {
  readonly httpStatus: number;
  readonly code?: number;
  readonly subcode?: number;
  readonly type?: string;
  readonly traceId?: string;
  readonly payload?: unknown;

  constructor(message: string, details: InstagramGraphErrorDetails) {
    super(message);
    this.name = "InstagramGraphError";
    this.httpStatus = details.httpStatus;
    this.code = details.code;
    this.subcode = details.subcode;
    this.type = details.type;
    this.traceId = details.traceId;
    this.payload = details.payload;
  }
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function positiveInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function environmentInteger(name: string, fallback: number, minimum: number, maximum: number) {
  return positiveInteger(process.env[name], fallback, minimum, maximum);
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeStatus(value: unknown) {
  return clean(value).replace(/[\s-]+/g, "_").toUpperCase();
}

function errorText(error: unknown) {
  return error instanceof Error ? clean(error.message) : clean(error);
}

function errorNumber(error: unknown, key: "code" | "subcode") {
  if (!error || typeof error !== "object") return 0;
  const value = Number((error as Record<string, unknown>)[key]);
  return Number.isFinite(value) ? value : 0;
}

function isTransientContainerLookupError(error: unknown) {
  const message = errorText(error).toLowerCase();
  const code = errorNumber(error, "code");
  const subcode = errorNumber(error, "subcode");
  return (
    (code === 100 && subcode === 33)
    || message.includes("unsupported get request")
    || message.includes("object with id") && message.includes("does not exist")
    || message.includes("media id is not available")
    || message.includes("media id not available")
  );
}

function isTransientPublishAvailabilityError(error: unknown) {
  const message = errorText(error).toLowerCase();
  const code = errorNumber(error, "code");
  return (
    code === 9007
    || message.includes("media id is not available")
    || message.includes("media id not available")
    || message.includes("media id not found")
  );
}

function graphErrorMessage(payload: any, httpStatus: number) {
  const apiError = payload?.error;
  return clean(apiError?.error_user_msg)
    || clean(apiError?.message)
    || clean(payload?.message)
    || `Instagram API error ${httpStatus}`;
}

function createInstagramGraphRequest(input: {
  accessToken: string;
  graphVersion: string;
  fetchImpl: typeof fetch;
}) {
  return async function instagramGraphRequest(
    path: string,
    method: InstagramGraphMethod,
    params: Record<string, unknown> = {},
  ) {
    const url = new URL(`https://graph.facebook.com/${input.graphVersion}${path}`);
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      const text = typeof value === "object" ? JSON.stringify(value) : String(value);
      if (method === "GET") url.searchParams.set(key, text);
      else body.set(key, text);
    }
    if (method === "GET") url.searchParams.set("access_token", input.accessToken);
    else body.set("access_token", input.accessToken);

    const response = await input.fetchImpl(url.toString(), {
      method,
      body: method === "POST" ? body : undefined,
    });
    const payload = await response.json().catch(() => ({} as any));
    if (!response.ok || payload?.error) {
      const apiError = payload?.error || {};
      throw new InstagramGraphError(graphErrorMessage(payload, response.status), {
        httpStatus: response.status,
        code: Number(apiError.code) || undefined,
        subcode: Number(apiError.error_subcode) || undefined,
        type: clean(apiError.type) || undefined,
        traceId: clean(apiError.fbtrace_id) || undefined,
        payload,
      });
    }
    return payload;
  };
}

async function waitForInstagramContainer(input: {
  creationId: string;
  label: string;
  request: ReturnType<typeof createInstagramGraphRequest>;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => number;
  timeoutMs: number;
  intervalMs: number;
}) {
  const startedAt = input.now();
  let attempt = 0;
  let lastStatus = "IN_PROGRESS";
  let lastPayload: any = null;

  while (input.now() - startedAt < input.timeoutMs) {
    attempt += 1;
    try {
      const status = await input.request(`/${input.creationId}`, "GET", {
        fields: "id,status_code,status",
      });
      lastPayload = status;
      lastStatus = normalizeStatus(status?.status_code || status?.status || "IN_PROGRESS");

      if (lastStatus === "FINISHED") {
        return {
          ...status,
          attempts: attempt,
          waitedMs: input.now() - startedAt,
        };
      }
      if (lastStatus === "ERROR" || lastStatus === "EXPIRED") {
        const detail = clean(status?.status) || clean(status?.error_message) || lastStatus;
        throw new Error(`فشلت معالجة ${input.label} على Instagram: ${detail}`);
      }
    } catch (error) {
      const elapsed = input.now() - startedAt;
      if (!isTransientContainerLookupError(error) || elapsed >= input.timeoutMs) throw error;
      lastPayload = { transientError: errorText(error) };
    }

    const remaining = input.timeoutMs - (input.now() - startedAt);
    if (remaining <= 0) break;
    await input.sleep(Math.min(input.intervalMs, remaining));
  }

  const detail = clean(lastPayload?.status) || clean(lastPayload?.transientError) || lastStatus;
  throw new Error(`انتهت مهلة معالجة ${input.label} على Instagram قبل أن يصبح جاهزًا للنشر (${detail})`);
}

async function publishInstagramContainer(input: {
  instagramUserId: string;
  creationId: string;
  label: string;
  request: ReturnType<typeof createInstagramGraphRequest>;
  sleep: (milliseconds: number) => Promise<void>;
  retryCount: number;
}) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= input.retryCount; attempt += 1) {
    try {
      const publish = await input.request(`/${input.instagramUserId}/media_publish`, "POST", {
        creation_id: input.creationId,
      });
      return { ...publish, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (!isTransientPublishAvailabilityError(error) || attempt >= input.retryCount) throw error;
      await input.sleep(1500 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`تعذر نشر ${input.label} على Instagram`);
}

async function createReadyAndPublish(input: {
  instagramUserId: string;
  label: string;
  createParams: Record<string, unknown>;
  request: ReturnType<typeof createInstagramGraphRequest>;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => number;
  timeoutMs: number;
  intervalMs: number;
  retryCount: number;
}) {
  const create = await input.request(`/${input.instagramUserId}/media`, "POST", input.createParams);
  const creationId = clean(create?.id || create?.creation_id);
  if (!creationId) throw new Error(`تعذر إنشاء ${input.label} على Instagram`);
  const readiness = await waitForInstagramContainer({
    creationId,
    label: input.label,
    request: input.request,
    sleep: input.sleep,
    now: input.now,
    timeoutMs: input.timeoutMs,
    intervalMs: input.intervalMs,
  });
  const publish = await publishInstagramContainer({
    instagramUserId: input.instagramUserId,
    creationId,
    label: input.label,
    request: input.request,
    sleep: input.sleep,
    retryCount: input.retryCount,
  });
  return { creationId, create, readiness, publish };
}

export async function publishInstagramContent(
  input: InstagramPublishInput,
  runtime: InstagramPublisherRuntime = {},
) {
  const instagramUserId = clean(input.instagramUserId);
  const accessToken = clean(input.accessToken);
  const media = Array.isArray(input.media)
    ? input.media.map((item) => ({ url: clean(item?.url), isVideo: Boolean(item?.isVideo) })).filter((item) => item.url)
    : [];
  if (!instagramUserId || !accessToken) throw new Error("بيانات Instagram غير مكتملة");
  if (!media.length) throw new Error("ملف Instagram النهائي غير موجود");

  const sleep = runtime.sleep || defaultSleep;
  const now = runtime.now || Date.now;
  const graphVersion = clean(runtime.graphVersion || process.env.META_GRAPH_VERSION) || "v25.0";
  const timeoutMs = positiveInteger(
    runtime.processingTimeoutMs,
    environmentInteger("INSTAGRAM_MEDIA_PROCESSING_TIMEOUT_MS", 90000, 10000, 105000),
    10000,
    105000,
  );
  const intervalMs = positiveInteger(
    runtime.pollingIntervalMs,
    environmentInteger("INSTAGRAM_MEDIA_POLL_INTERVAL_MS", 4000, 1000, 15000),
    1000,
    15000,
  );
  const retryCount = positiveInteger(
    runtime.publishRetryCount,
    environmentInteger("INSTAGRAM_MEDIA_PUBLISH_RETRY_COUNT", 4, 1, 6),
    1,
    6,
  );
  const request = createInstagramGraphRequest({ accessToken, graphVersion, fetchImpl: runtime.fetchImpl || fetch });
  const format = clean(input.publishFormat).toLowerCase();
  const first = media[0];

  if (format === "story") {
    const createParams: Record<string, unknown> = { media_type: "STORIES" };
    if (first.isVideo) createParams.video_url = first.url;
    else createParams.image_url = first.url;
    return createReadyAndPublish({
      instagramUserId,
      label: "Story",
      createParams,
      request,
      sleep,
      now,
      timeoutMs,
      intervalMs,
      retryCount,
    });
  }

  if (format === "reel" || format === "short" || format === "video") {
    return createReadyAndPublish({
      instagramUserId,
      label: "Reel",
      createParams: {
        caption: clean(input.caption),
        video_url: first.url,
        media_type: "REELS",
        share_to_feed: true,
      },
      request,
      sleep,
      now,
      timeoutMs,
      intervalMs,
      retryCount,
    });
  }

  if (media.length > 1) {
    const childCreates = await Promise.all(media.map(async (item, index) => {
      const createParams: Record<string, unknown> = { is_carousel_item: true };
      if (item.isVideo) {
        createParams.media_type = "VIDEO";
        createParams.video_url = item.url;
      } else {
        createParams.image_url = item.url;
      }
      const create = await request(`/${instagramUserId}/media`, "POST", createParams);
      const creationId = clean(create?.id || create?.creation_id);
      if (!creationId) throw new Error(`تعذر تجهيز العنصر رقم ${index + 1} في Carousel على Instagram`);
      return { creationId, create, index };
    }));

    const childReadiness = await Promise.all(childCreates.map((child) => waitForInstagramContainer({
      creationId: child.creationId,
      label: `عنصر Carousel رقم ${child.index + 1}`,
      request,
      sleep,
      now,
      timeoutMs,
      intervalMs,
    })));

    const parent = await createReadyAndPublish({
      instagramUserId,
      label: "Carousel",
      createParams: {
        media_type: "CAROUSEL",
        children: childCreates.map((child) => child.creationId).join(","),
        caption: clean(input.caption),
      },
      request,
      sleep,
      now,
      timeoutMs,
      intervalMs,
      retryCount,
    });
    return {
      children: childCreates.map((child, index) => ({
        creationId: child.creationId,
        create: child.create,
        readiness: childReadiness[index],
      })),
      ...parent,
    };
  }

  return createReadyAndPublish({
    instagramUserId,
    label: "بوست صور",
    createParams: {
      caption: clean(input.caption),
      image_url: first.url,
    },
    request,
    sleep,
    now,
    timeoutMs,
    intervalMs,
    retryCount,
  });
}
