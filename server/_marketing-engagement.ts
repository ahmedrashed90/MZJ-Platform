import { getSql } from "./_db.js";
import { ensureCrmSchema } from "./_crm-schema.js";
import { ensureMarketingSchema } from "./_marketing-schema.js";
import { classifyConversationService, ensureContactIdentity } from "./_crm-lifecycle.js";
import { decryptPlatformToken, getYouTubeAccessToken } from "./_platform-connections.js";
import type { SessionUser } from "./_auth.js";
import { emitSocialEngagementLeadNotification } from "./_notifications.js";

function clean(value: unknown) { return String(value ?? "").trim(); }
function asObject(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function asArray<T = any>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }
function numberValue(value: unknown) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function graphVersion() { return clean(process.env.META_GRAPH_VERSION) || "v25.0"; }

const RESULT_PLATFORMS = ["facebook", "instagram", "tiktok", "snapchat", "youtube"] as const;

type ResultPlatform = typeof RESULT_PLATFORMS[number];

type ResultMetricBucket = {
  posts: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  views: number;
  reach: number;
  identifiedEngagements: number;
  commentEvents: number;
  likeEvents: number;
  shareEvents: number;
  actors: Set<string>;
  leads: Map<string, { sold: boolean; soldQuantity: number }>;
};

function emptyResultMetricBucket(): ResultMetricBucket {
  return {
    posts: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    views: 0,
    reach: 0,
    identifiedEngagements: 0,
    commentEvents: 0,
    likeEvents: 0,
    shareEvents: 0,
    actors: new Set<string>(),
    leads: new Map<string, { sold: boolean; soldQuantity: number }>(),
  };
}

function resultPlatform(value: unknown): ResultPlatform | "" {
  const platform = clean(value).toLowerCase();
  return RESULT_PLATFORMS.includes(platform as ResultPlatform) ? platform as ResultPlatform : "";
}

function addPostMetrics(bucket: ResultMetricBucket, row: any) {
  bucket.posts += 1;
  bucket.likes += numberValue(row.likes_count);
  bucket.comments += numberValue(row.comments_count);
  bucket.shares += numberValue(row.shares_count);
  bucket.saves += numberValue(row.saves_count);
  bucket.views += numberValue(row.views_count);
  bucket.reach += numberValue(row.reach_count);
}

function addLead(bucket: ResultMetricBucket, leadId: string, sold: boolean, soldQuantity: number) {
  if (!leadId) return;
  const current = bucket.leads.get(leadId);
  bucket.leads.set(leadId, {
    sold: Boolean(current?.sold || sold),
    soldQuantity: Math.max(numberValue(current?.soldQuantity), sold ? Math.max(1, numberValue(soldQuantity) || 1) : 0),
  });
}

function addEngagementToBucket(bucket: ResultMetricBucket, row: any) {
  // Individual engagement rows are intentionally comment-only. Likes/reactions and shares
  // remain aggregate platform metrics and must never create CRM identity/event rows.
  if (clean(row.engagement_type) !== "comment") return;
  bucket.identifiedEngagements += 1;
  bucket.commentEvents += 1;
  const actorId = clean(row.actor_id);
  if (actorId) bucket.actors.add(`${clean(row.platform)}:${clean(row.account_id)}:${actorId}`);
  const leadId = clean(row.crm_lead_id);
  if (leadId && row.crm_is_deleted !== true) {
    const sold = clean(row.status_label) === "تم البيع";
    addLead(bucket, leadId, sold, numberValue(row.sold_quantity));
  }
}

function finalizeResultMetricBucket(bucket: ResultMetricBucket) {
  const soldLeads = [...bucket.leads.values()].filter((lead) => lead.sold).length;
  const soldQuantity = [...bucket.leads.values()].reduce((total, lead) => total + numberValue(lead.soldQuantity), 0);
  const crmLeads = bucket.leads.size;
  const identifiedAccounts = bucket.actors.size;
  return {
    posts: bucket.posts,
    likes: bucket.likes,
    comments: bucket.comments,
    shares: bucket.shares,
    saves: bucket.saves,
    views: bucket.views,
    reach: bucket.reach,
    engagements: bucket.likes + bucket.comments + bucket.shares,
    identifiedEngagements: bucket.identifiedEngagements,
    commentEvents: bucket.commentEvents,
    likeEvents: bucket.likeEvents,
    shareEvents: bucket.shareEvents,
    identifiedAccounts,
    crmLeads,
    soldLeads,
    soldQuantity,
    crmConversionRate: identifiedAccounts ? Number(((crmLeads / identifiedAccounts) * 100).toFixed(2)) : 0,
    salesConversionRate: crmLeads ? Number(((soldLeads / crmLeads) * 100).toFixed(2)) : 0,
  };
}

function sourceResultBase(sourceType: string, source: any) {
  return {
    sourceType,
    sourceId: clean(source?.source_id || source?.id),
    name: clean(source?.source_name || source?.name) || (sourceType === "agenda" ? "أجندة" : "حملة"),
    code: clean(source?.source_code || source?.campaign_code || source?.month_key),
    publishStart: source?.publish_start || null,
    publishEnd: source?.publish_end || null,
    status: clean(source?.source_status || source?.status),
  };
}

export async function engagementResultsData(
  sql: ReturnType<typeof getSql>,
  input: { sourceType?: string; sourceId?: string; source?: any } = {},
) {
  await ensureCrmSchema();
  const sourceType = clean(input.sourceType);
  const sourceId = clean(input.sourceId);
  const scoped = Boolean(sourceType && sourceId);
  const posts = scoped
    ? await sql<any[]>`
      select pp.*,pp.id::text,pp.source_id::text,pp.creative_id::text,pp.task_id::text,
        coalesce(campaign.name,agenda.name,'—') as source_name,
        coalesce(campaign.campaign_code,agenda.month_key,'') as source_code,
        coalesce(campaign.publish_start,agenda.publish_start) as publish_start,
        coalesce(campaign.publish_end,agenda.publish_end) as publish_end,
        coalesce(campaign.status,agenda.status,'') as source_status,
        coalesce(cr.name,cr.instance_code,cr.creative_type,'—') as creative_name
      from marketing.published_posts pp
      left join marketing.campaigns campaign on pp.source_type='campaign' and campaign.id=pp.source_id
      left join marketing.agendas agenda on pp.source_type='agenda' and agenda.id=pp.source_id
      left join marketing.creatives cr on cr.id=pp.creative_id
      where pp.is_deleted=false and pp.source_type=${sourceType} and pp.source_id=${sourceId}::uuid
      order by pp.published_at desc
    `
    : await sql<any[]>`
      select pp.*,pp.id::text,pp.source_id::text,pp.creative_id::text,pp.task_id::text,
        coalesce(campaign.name,agenda.name,'—') as source_name,
        coalesce(campaign.campaign_code,agenda.month_key,'') as source_code,
        coalesce(campaign.publish_start,agenda.publish_start) as publish_start,
        coalesce(campaign.publish_end,agenda.publish_end) as publish_end,
        coalesce(campaign.status,agenda.status,'') as source_status,
        coalesce(cr.name,cr.instance_code,cr.creative_type,'—') as creative_name
      from marketing.published_posts pp
      left join marketing.campaigns campaign on pp.source_type='campaign' and campaign.id=pp.source_id
      left join marketing.agendas agenda on pp.source_type='agenda' and agenda.id=pp.source_id
      left join marketing.creatives cr on cr.id=pp.creative_id
      where pp.is_deleted=false
      order by pp.published_at desc
    `;
  const engagements = scoped
    ? await sql<any[]>`
      select pe.*,pe.id::text,pe.published_post_id::text,pe.crm_lead_id::text,
        pp.source_type,pp.source_id::text,pp.platform,
        l.status_label,l.sold_quantity,l.is_deleted as crm_is_deleted
      from marketing.post_engagements pe
      join marketing.published_posts pp on pp.id=pe.published_post_id
      left join crm.leads l on l.id=pe.crm_lead_id
      where pe.is_deleted=false and pe.engagement_type='comment' and pp.is_deleted=false and pp.source_type=${sourceType} and pp.source_id=${sourceId}::uuid
      order by coalesce(pe.engaged_at,pe.created_at) desc
    `
    : await sql<any[]>`
      select pe.*,pe.id::text,pe.published_post_id::text,pe.crm_lead_id::text,
        pp.source_type,pp.source_id::text,pp.platform,
        l.status_label,l.sold_quantity,l.is_deleted as crm_is_deleted
      from marketing.post_engagements pe
      join marketing.published_posts pp on pp.id=pe.published_post_id
      left join crm.leads l on l.id=pe.crm_lead_id
      where pe.is_deleted=false and pe.engagement_type='comment' and pp.is_deleted=false
      order by coalesce(pe.engaged_at,pe.created_at) desc
    `;
  const connections = await sql<any[]>`
    select platform,connected,status,state,last_verified_at
    from marketing.platform_connections
    where platform in ('facebook','instagram','tiktok','youtube')
  `;
  const connectionMap = new Map(connections.map((row: any) => [clean(row.platform), row]));
  const eventsByPost = new Map<string, any[]>();
  for (const event of engagements) {
    const postId = clean(event.published_post_id);
    if (!postId) continue;
    const rows = eventsByPost.get(postId) || [];
    rows.push(event);
    eventsByPost.set(postId, rows);
  }

  type GroupState = {
    base: ReturnType<typeof sourceResultBase>;
    summary: ResultMetricBucket;
    platforms: Map<ResultPlatform, ResultMetricBucket>;
    posts: any[];
    creatives: Map<string, { id: string; name: string; bucket: ResultMetricBucket }>;
  };

  const groups = new Map<string, GroupState>();
  const ensureGroup = (row: any) => {
    const rowSourceType = clean(row.source_type || sourceType) || "campaign";
    const rowSourceId = clean(row.source_id || sourceId);
    const key = `${rowSourceType}:${rowSourceId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        base: sourceResultBase(rowSourceType, row),
        summary: emptyResultMetricBucket(),
        platforms: new Map<ResultPlatform, ResultMetricBucket>(),
        posts: [],
        creatives: new Map<string, { id: string; name: string; bucket: ResultMetricBucket }>(),
      };
      groups.set(key, group);
    }
    return group;
  };

  for (const post of posts) {
    const platform = resultPlatform(post.platform);
    if (!platform) continue;
    const group = ensureGroup(post);
    const platformBucket = group.platforms.get(platform) || emptyResultMetricBucket();
    group.platforms.set(platform, platformBucket);
    addPostMetrics(group.summary, post);
    addPostMetrics(platformBucket, post);

    const postBucket = emptyResultMetricBucket();
    addPostMetrics(postBucket, post);
    const postEvents = eventsByPost.get(clean(post.id)) || [];
    for (const event of postEvents) {
      addEngagementToBucket(group.summary, event);
      addEngagementToBucket(platformBucket, event);
      addEngagementToBucket(postBucket, event);
    }
    const postMetrics = finalizeResultMetricBucket(postBucket);
    const score = postMetrics.likes + postMetrics.comments + postMetrics.shares;
    group.posts.push({
      id: clean(post.id),
      sourceType: clean(post.source_type),
      sourceId: clean(post.source_id),
      platform,
      providerPostId: clean(post.provider_post_id),
      permalink: clean(post.permalink),
      postTypeName: clean(post.post_type_name) || "—",
      creativeId: clean(post.creative_id),
      creativeName: clean(post.creative_name) || "—",
      publishedAt: post.published_at,
      lastSyncedAt: post.last_synced_at,
      syncStatus: clean(post.sync_status) || "pending",
      syncError: clean(post.sync_error),
      archivedAt: post.archived_at || null,
      score,
      ...postMetrics,
    });

    const creativeKey = clean(post.creative_id) || `name:${clean(post.creative_name) || "unknown"}`;
    const creative = group.creatives.get(creativeKey) || {
      id: clean(post.creative_id),
      name: clean(post.creative_name) || "—",
      bucket: emptyResultMetricBucket(),
    };
    addPostMetrics(creative.bucket, post);
    for (const event of postEvents) addEngagementToBucket(creative.bucket, event);
    group.creatives.set(creativeKey, creative);
  }

  if (scoped && !groups.size) {
    let source = input.source;
    if (!source) {
      const [loaded] = sourceType === "agenda"
        ? await sql<any[]>`select id::text,name,month_key,publish_start,publish_end,status from marketing.agendas where id=${sourceId}::uuid`
        : await sql<any[]>`select id::text,name,campaign_code,publish_start,publish_end,status from marketing.campaigns where id=${sourceId}::uuid and is_deleted=false`;
      source = loaded;
    }
    if (source) ensureGroup({ ...source, source_type: sourceType, source_id: sourceId });
  }

  const finalizedGroups = [...groups.values()].map((group) => {
    const postsSorted = [...group.posts].sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")));
    const creativeRows = [...group.creatives.values()].map((creative) => ({
      id: creative.id,
      name: creative.name,
      ...finalizeResultMetricBucket(creative.bucket),
    })).sort((a, b) => b.engagements - a.engagements || b.posts - a.posts);
    const platformRows = RESULT_PLATFORMS.map((platform) => {
      const bucket = group.platforms.get(platform) || emptyResultMetricBucket();
      const connection = connectionMap.get(platform);
      const platformPosts = postsSorted.filter((post) => post.platform === platform);
      const platformSyncDates = platformPosts.map((post) => post.lastSyncedAt).filter(Boolean).sort();
      const lastSyncedAt = platformSyncDates[platformSyncDates.length - 1] || null;
      const syncStatus = platformPosts.some((post) => post.syncStatus === "failed")
        ? "failed"
        : platformPosts.length && platformPosts.every((post) => post.syncStatus === "synced")
          ? "synced"
          : platformPosts.length ? "pending" : "waiting";
      return {
        platform,
        connected: Boolean(connection?.connected),
        connectionStatus: clean(connection?.status || connection?.state),
        dataStatus: platformPosts.length ? "available" : (platform === "tiktok" || platform === "snapchat" || platform === "youtube" ? "pending_integration" : "waiting_posts"),
        syncStatus,
        lastSyncedAt,
        ...finalizeResultMetricBucket(bucket),
      };
    });
    const summary = finalizeResultMetricBucket(group.summary);
    const bestPost = [...postsSorted].sort((a, b) => b.score - a.score || b.views - a.views)[0] || null;
    const bestCreative = creativeRows[0] || null;
    const sourceSyncDates = postsSorted.map((post) => post.lastSyncedAt).filter(Boolean).sort();
    const lastSyncedAt = sourceSyncDates[sourceSyncDates.length - 1] || null;
    return {
      ...group.base,
      summary: { ...summary, lastSyncedAt },
      platforms: platformRows,
      posts: postsSorted,
      creatives: creativeRows,
      bestPost,
      bestCreative,
    };
  }).sort((a, b) => String(b.publishEnd || b.publishStart || "").localeCompare(String(a.publishEnd || a.publishStart || "")) || a.name.localeCompare(b.name, "ar"));

  return {
    groups: finalizedGroups,
    campaigns: finalizedGroups.filter((group) => group.sourceType === "campaign"),
    agendas: finalizedGroups.filter((group) => group.sourceType === "agenda"),
    supportedPlatforms: [...RESULT_PLATFORMS],
  };
}


type MetaGraphHost = "facebook" | "instagram";
type MetaGraphFailure = Error & { meta?: Record<string, any> };

function metaGraphOrigin(host: MetaGraphHost) {
  return host === "instagram" ? "https://graph.instagram.com" : "https://graph.facebook.com";
}

async function graphRequest(path: string, method: "GET" | "POST", token: string, params: Record<string, any> = {}, host: MetaGraphHost = "facebook") {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${metaGraphOrigin(host)}/${graphVersion()}${normalizedPath}`);
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    const encoded = typeof value === "object" ? JSON.stringify(value) : String(value);
    if (method === "GET") url.searchParams.set(key, encoded); else body.set(key, encoded);
  }
  if (method === "GET") url.searchParams.set("access_token", token); else body.set("access_token", token);
  const response = await fetch(url, { method, headers: method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : undefined, body: method === "POST" ? body : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    const metaError = asObject(payload?.error);
    const message = clean(metaError.error_user_msg || metaError.message || payload?.message) || `Meta API error (${response.status})`;
    const failure = new Error(message) as MetaGraphFailure;
    failure.meta = {
      host,
      path: normalizedPath,
      status: response.status,
      type: clean(metaError.type),
      code: numberValue(metaError.code) || null,
      subcode: numberValue(metaError.error_subcode) || null,
      traceId: clean(metaError.fbtrace_id),
    };
    throw failure;
  }
  return payload;
}

function connectionScopes(connection: any) {
  return asArray(connection?.scopes).map(clean).filter(Boolean);
}

function missingScopes(granted: string[], required: string[]) {
  return required.filter((scope) => !granted.includes(scope));
}

function subscriptionFields(payload: any) {
  const appId = clean(process.env.META_APP_ID);
  const rows = asArray(payload?.data);
  const row = rows.find((item: any) => appId && clean(item?.id) === appId) || rows[0];
  return asArray(row?.subscribed_fields).map(clean).filter(Boolean);
}

function subscriptionFailure(error: any) {
  const details = asObject((error as MetaGraphFailure)?.meta);
  return {
    error: clean(error?.message) || "تعذر تنفيذ اشتراك Meta",
    errorDetails: {
      status: numberValue(details.status) || null,
      type: clean(details.type),
      code: numberValue(details.code) || null,
      subcode: numberValue(details.subcode) || null,
      traceId: clean(details.traceId),
      host: clean(details.host),
      path: clean(details.path),
    },
  };
}

function platformDisplayName(platform: string) {
  if (platform === "facebook") return "Facebook";
  if (platform === "instagram") return "Instagram";
  if (platform === "youtube") return "YouTube";
  if (platform === "tiktok") return "TikTok";
  if (platform === "snapchat") return "Snapchat";
  return platform;
}

function publishedIds(platform: string, resultInput: unknown) {
  const result = asObject(resultInput);
  const publish = asObject(result.publish);
  if (platform === "facebook") {
    const format = clean(result.publishFormat).toLowerCase();
    const uploads = asArray(result.uploads);
    // Facebook video/Reels publishing returns a media/video id, not a Page Post id.
    // Keep those identifiers separate. A real Page Post id is resolved from the Page feed below.
    const providerPostId = clean(
      result.post_id
      || result.page_post_id
      || publish.post_id
      || (uploads.length || format === "carousel" ? publish.id : ""),
    );
    const providerMediaId = clean(
      result.video_id
      || result.media_id
      || result.id
      || uploads[0]?.id
      || providerPostId,
    );
    const permalink = clean(result.permalink_url || publish.permalink_url || result.url);
    return { providerPostId, providerMediaId, permalink };
  }
  if (platform === "instagram") {
    const providerPostId = clean(publish.id || result.id);
    const providerMediaId = providerPostId;
    const permalink = clean(result.permalink || publish.permalink || result.url);
    return { providerPostId, providerMediaId, permalink };
  }
  if (platform === "youtube") {
    const video = asObject(result.video);
    const providerPostId = clean(result.id || video.id);
    const providerMediaId = providerPostId;
    const permalink = clean(result.url) || (providerPostId ? `https://www.youtube.com/watch?v=${encodeURIComponent(providerPostId)}` : "");
    return { providerPostId, providerMediaId, permalink };
  }
  const providerPostId = clean(result.id || publish.id || result.post_id || result.video_id);
  const providerMediaId = clean(result.media_id || result.video_id || providerPostId);
  const permalink = clean(result.permalink || result.permalink_url || result.url || publish.permalink);
  return { providerPostId, providerMediaId, permalink };
}

function attachmentTargetIds(value: unknown): string[] {
  const output = new Set<string>();
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const item of node) visit(item); return; }
    const object = node as Record<string, any>;
    const targetId = clean(object.target?.id);
    if (targetId) output.add(targetId);
    for (const child of Object.values(object)) visit(child);
  };
  visit(value);
  return [...output];
}

function sameFacebookPermalink(left: unknown, right: unknown, mediaId: string) {
  const a = clean(left).replace(/\/$/, "");
  const b = clean(right).replace(/\/$/, "");
  if (a && b && a === b) return true;
  if (!mediaId) return false;
  return Boolean((a && a.includes(mediaId)) || (b && b.includes(mediaId)));
}

async function resolveFacebookPagePostId(pageId: string, token: string, mediaId: string) {
  const normalizedPageId = clean(pageId);
  const normalizedMediaId = clean(mediaId);
  if (!normalizedPageId || !normalizedMediaId) return { postId: "", permalink: "" };

  let mediaPermalink = "";
  try {
    const media = await graphRequest(`/${encodeURIComponent(normalizedMediaId)}`, "GET", token, {
      fields: "id,permalink_url,created_time",
    });
    mediaPermalink = clean(media?.permalink_url);
  } catch {
    // A video/reel node is not a Page Post node. Feed matching below remains authoritative.
  }

  const edges = ["published_posts", "feed"];
  for (const edge of edges) {
    let collection: { data: any[] };
    try {
      collection = await graphCollection(`/${encodeURIComponent(normalizedPageId)}/${edge}`, token, {
        fields: "id,created_time,permalink_url,attachments{target}",
        limit: 100,
      }, "facebook", 5);
    } catch {
      try {
        collection = await graphCollection(`/${encodeURIComponent(normalizedPageId)}/${edge}`, token, {
          fields: "id,created_time,permalink_url",
          limit: 100,
        }, "facebook", 5);
      } catch {
        continue;
      }
    }

    for (const row of collection.data) {
      const targetIds = attachmentTargetIds(row?.attachments);
      if (targetIds.includes(normalizedMediaId) || sameFacebookPermalink(row?.permalink_url, mediaPermalink, normalizedMediaId)) {
        return { postId: clean(row?.id), permalink: clean(row?.permalink_url || mediaPermalink) };
      }
    }
  }
  return { postId: "", permalink: mediaPermalink };
}

async function resolveFacebookPostForStoredRow(sql: ReturnType<typeof getSql>, post: any, token: string) {
  const storedPostId = clean(post.provider_post_id);
  const mediaId = clean(post.provider_media_id || storedPostId);
  const pageId = clean(post.account_id);
  const suspiciousComposedId = Boolean(storedPostId && mediaId && storedPostId === `${pageId}_${mediaId}`);

  // Media/video ids and Page Post ids are separate identifiers. When media is available,
  // resolve the real Page Post from the Page collection instead of manufacturing or guessing an id.
  if (mediaId && (!storedPostId || storedPostId === mediaId || suspiciousComposedId)) {
    const resolved = await resolveFacebookPagePostId(pageId, token, mediaId);
    if (resolved.postId) {
      await sql`
        update marketing.published_posts
        set provider_post_id=${resolved.postId},permalink=coalesce(nullif(${resolved.permalink},''),permalink),updated_at=now()
        where id=${post.id}::uuid
      `;
      return { postId: resolved.postId, permalink: clean(resolved.permalink || post.permalink), resolved: true };
    }
    return { postId: "", permalink: clean(resolved.permalink || post.permalink), resolved: false };
  }

  // IDs returned directly by a Page publishing endpoint (for example feed/carousel posts)
  // are already Page Post ids and can be used as-is.
  if (storedPostId) return { postId: storedPostId, permalink: clean(post.permalink), resolved: true };
  return { postId: "", permalink: clean(post.permalink), resolved: false };
}

export async function recordPublishedPost(sql: ReturnType<typeof getSql>, schedule: any, result: unknown) {
  const platform = resultPlatform(schedule.platform_code || schedule.platform);
  if (!platform) return null;
  let { providerPostId, providerMediaId, permalink } = publishedIds(platform, result);
  const [connection] = await sql<any[]>`
    select platform,page_id,ig_user_id,account_id from marketing.platform_connections where platform=${platform} and connected=true limit 1
  `;
  const accountId = platform === "facebook"
    ? clean(connection?.page_id || connection?.account_id)
    : platform === "instagram"
      ? clean(connection?.ig_user_id || connection?.account_id)
      : clean(connection?.account_id);
  if (!accountId) throw new Error(`حساب ${platformDisplayName(platform)} غير مكتمل`);
  if (!providerPostId && !providerMediaId) throw new Error("لم ترجع المنصة معرف المنشور أو الميديا بعد نجاح النشر");

  let resolutionWarning = "";
  if (platform === "facebook" && !providerPostId && providerMediaId) {
    try {
      const linked = await platformConnection(sql, "facebook");
      const resolved = await resolveFacebookPagePostId(accountId, linked.token, providerMediaId);
      providerPostId = clean(resolved.postId);
      permalink = clean(resolved.permalink || permalink);
      if (!providerPostId) resolutionWarning = "بانتظار ظهور معرف Page Post الحقيقي من Facebook";
    } catch (error: any) {
      resolutionWarning = clean(error?.message) || "تعذر تحديد معرف Page Post من Facebook";
    }
  }

  const [row] = await sql<any[]>`
    insert into marketing.published_posts(
      schedule_id,source_type,source_id,creative_id,task_id,platform,account_id,provider_post_id,provider_media_id,permalink,post_type_name,published_at,raw_metrics
    ) values(
      ${schedule.id}::uuid,${schedule.source_type},${schedule.source_id}::uuid,${schedule.creative_id || null}::uuid,${schedule.task_id || null}::uuid,
      ${platform},${accountId},${providerPostId || null},${providerMediaId || null},${permalink || null},${clean(schedule.post_type_name) || null},now(),
      ${sql.json({ publishResult: result, providerPostResolution: resolutionWarning ? { status: "pending", warning: resolutionWarning } : { status: "resolved" } } as any)}
    ) on conflict(schedule_id) do update set
      platform=excluded.platform,account_id=excluded.account_id,provider_post_id=coalesce(excluded.provider_post_id,marketing.published_posts.provider_post_id),provider_media_id=coalesce(excluded.provider_media_id,marketing.published_posts.provider_media_id),
      permalink=coalesce(excluded.permalink,marketing.published_posts.permalink),post_type_name=excluded.post_type_name,published_at=excluded.published_at,
      sync_status='pending',sync_error=null,raw_metrics=coalesce(marketing.published_posts.raw_metrics,'{}'::jsonb)||excluded.raw_metrics,updated_at=now()
    returning *,id::text,schedule_id::text,source_id::text,creative_id::text,task_id::text
  `;
  return row;
}

export async function backfillPublishedPosts(sql: ReturnType<typeof getSql>) {
  const schedules = await sql<any[]>`
    select s.*,s.id::text,s.source_id::text,s.creative_id::text,s.task_id::text,p.code as platform_code,pt.name as post_type_name
    from marketing.publish_schedule s
    join marketing.platforms p on p.id=s.platform_id
    left join marketing.platform_post_types pt on pt.id=s.post_type_id
    left join marketing.published_posts pp on pp.schedule_id=s.id
    where s.status='published' and pp.id is null and p.code in ('facebook','instagram','tiktok','snapchat','youtube') and coalesce(s.publish_result,'{}'::jsonb)<>'{}'::jsonb
    order by s.published_at
  `;
  let created = 0;
  for (const schedule of schedules) {
    try { if (await recordPublishedPost(sql, schedule, schedule.publish_result)) created += 1; }
    catch (error) { console.error("Engagement backfill skipped", { scheduleId: schedule.id, error }); }
  }
  return created;
}

async function cleanupLegacyTestEngagementRows(sql: ReturnType<typeof getSql>) {
  await sql.begin(async tx => {
    const [claimed] = await tx<any[]>`
      insert into marketing.data_migrations(migration_key,details)
      values('20260730_remove_test_engagement_rows',${tx.json({ scope: 'engagement_page', match: 'source_name=test' } as any)})
      on conflict(migration_key) do nothing
      returning migration_key
    `;
    if (!claimed) return;
    await tx`
      update marketing.published_posts pp
      set is_deleted=true,deleted_at=coalesce(deleted_at,now()),updated_at=now()
      where exists(
        select 1 from marketing.campaigns c
        where pp.source_type='campaign' and c.id=pp.source_id and lower(btrim(c.name))='test'
      ) or exists(
        select 1 from marketing.agendas a
        where pp.source_type='agenda' and a.id=pp.source_id and lower(btrim(a.name))='test'
      )
    `;
  });
}

async function repairStoredEngagementSources(sql: ReturnType<typeof getSql>) {
  await sql.begin(async tx => {
    const [claimed] = await tx<any[]>`
      insert into marketing.data_migrations(migration_key,details)
      values('20260730_repair_engagement_crm_sources',${tx.json({ scope: 'crm_leads', source: 'published_post_platform' } as any)})
      on conflict(migration_key) do nothing
      returning migration_key
    `;
    if (!claimed) return;
    await tx`
      with latest_platform as (
        select distinct on(pe.crm_lead_id) pe.crm_lead_id,pp.platform
        from marketing.post_engagements pe
        join marketing.published_posts pp on pp.id=pe.published_post_id
        where pe.crm_lead_id is not null and pe.engagement_type='comment' and pe.processing_status='created' and pe.is_deleted=false and pp.is_deleted=false
        order by pe.crm_lead_id,coalesce(pe.engaged_at,pe.created_at) desc
      )
      update crm.leads l
      set source_code=case when latest_platform.platform='instagram' then 'instagram_post' else 'facebook_post' end,
        source_name=case when latest_platform.platform='instagram' then 'بوست انستجرام' else 'بوست فيس بوك' end,
        platform_code=latest_platform.platform,
        updated_at=now()
      from latest_platform
      where l.id=latest_platform.crm_lead_id
        and (
          l.source_code is distinct from case when latest_platform.platform='instagram' then 'instagram_post' else 'facebook_post' end
          or l.source_name is distinct from case when latest_platform.platform='instagram' then 'بوست انستجرام' else 'بوست فيس بوك' end
          or l.platform_code is distinct from latest_platform.platform
        )
    `;
  });
}

async function platformConnection(sql: ReturnType<typeof getSql>, platform: string) {
  const [connection] = await sql<any[]>`select * from marketing.platform_connections where platform=${platform} and connected=true limit 1`;
  if (!connection) throw new Error(`ربط ${platformDisplayName(platform)} غير متاح`);
  const token = decryptPlatformToken(connection.page_access_token_encrypted || connection.access_token_encrypted || connection.user_access_token_encrypted);
  if (!token) throw new Error(`توكن ${platformDisplayName(platform)} غير متاح`);
  return { connection, token };
}

function graphHostForConnection(platform: string, connection: any): MetaGraphHost {
  if (platform === "instagram" && connectionScopes(connection).some((scope) => scope.startsWith("instagram_business_"))) {
    return "instagram";
  }
  return "facebook";
}

async function graphCollection(
  path: string,
  token: string,
  params: Record<string, any> = {},
  host: MetaGraphHost = "facebook",
  maxPages = 25,
) {
  const data: any[] = [];
  let after = "";
  let pages = 0;
  let complete = true;
  while (pages < maxPages) {
    const payload = await graphRequest(path, "GET", token, { ...params, after: after || undefined }, host);
    data.push(...asArray(payload?.data));
    pages += 1;
    const nextAfter = clean(payload?.paging?.cursors?.after);
    const hasNext = Boolean(payload?.paging?.next && nextAfter && nextAfter !== after);
    if (!hasNext) break;
    if (pages >= maxPages) {
      complete = false;
      break;
    }
    after = nextAfter;
  }
  return { data, pages, complete };
}

async function youtubeVideoStatistics(sql: ReturnType<typeof getSql>, post: any) {
  const { accessToken } = await getYouTubeAccessToken(sql);
  const videoId = clean(post.provider_media_id || post.provider_post_id);
  if (!videoId) throw new Error("معرف فيديو YouTube غير موجود");
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "statistics,snippet,status");
  url.searchParams.set("id", videoId);
  const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw new Error(clean(payload?.error?.message) || `تعذر تحديث أرقام YouTube (${response.status})`);
  const video = asArray(payload?.items)[0];
  if (!video) throw new Error("فيديو YouTube غير متاح للحساب المربوط");
  return { payload, videoId, video };
}

type CommentEngagementInput = {
  platform: "facebook" | "instagram";
  accountId: string;
  postIds: string[];
  eventId: string;
  actorId: string;
  actorName: string;
  text: string;
  engagedAt: string;
  raw: any;
};

function commentTimestamp(value: unknown, fallback: unknown = Date.now()) {
  const text = clean(value);
  if (text) {
    const parsed = Date.parse(text);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    const numeric = numberValue(value);
    if (numeric > 0) return new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000).toISOString();
  }
  const fallbackNumber = numberValue(fallback);
  return new Date(fallbackNumber > 10_000_000_000 ? fallbackNumber : fallbackNumber > 0 ? fallbackNumber * 1000 : Date.now()).toISOString();
}

function remoteCommentInput(platform: "facebook" | "instagram", post: any, row: any): CommentEngagementInput | null {
  const eventId = clean(row?.id || row?.comment_id);
  if (!eventId) return null;
  const from = asObject(row?.from);
  const actorId = clean(from?.id || from?.ig_scoped_id || from?.username);
  const accountId = clean(post.account_id);
  if (!actorId || actorId === accountId) return null;
  if (platform === "facebook") {
    return {
      platform,
      accountId,
      postIds: [clean(post.provider_post_id)].filter(Boolean),
      eventId,
      actorId,
      actorName: clean(from?.name) || "عميل Facebook",
      text: clean(row?.message),
      engagedAt: commentTimestamp(row?.created_time),
      raw: row,
    };
  }
  return {
    platform,
    accountId,
    postIds: [clean(post.provider_media_id || post.provider_post_id)].filter(Boolean),
    eventId,
    actorId,
    actorName: clean(from?.username || from?.name) || "عميل Instagram",
    text: clean(row?.text || row?.message),
    engagedAt: commentTimestamp(row?.timestamp),
    raw: row,
  };
}

async function upsertCommentAndCrm(sql: ReturnType<typeof getSql>, post: any, item: CommentEngagementInput) {
  if (!item.eventId || !item.actorId || item.actorId === item.accountId) {
    return { status: "ignored" as const, leadId: "", createdEvent: false };
  }

  const [existing] = await sql<any[]>`
    select *,id::text,crm_lead_id::text from marketing.post_engagements
    where platform=${item.platform} and engagement_type='comment' and provider_event_id=${item.eventId}
    limit 1
  `;

  const [eventRow] = await sql<any[]>`
    insert into marketing.post_engagements(
      published_post_id,platform,engagement_type,provider_event_id,provider_post_id,account_id,actor_id,actor_name,event_text,engaged_at,raw_payload
    ) values(
      ${post.id}::uuid,${item.platform},'comment',${item.eventId},${item.postIds[0] || post.provider_post_id || post.provider_media_id || null},${item.accountId},
      ${item.actorId},${item.actorName},${item.text || null},${item.engagedAt}::timestamptz,${sql.json(item.raw as any)}
    ) on conflict(platform,engagement_type,provider_event_id) do update set
      published_post_id=excluded.published_post_id,
      provider_post_id=coalesce(excluded.provider_post_id,marketing.post_engagements.provider_post_id),
      account_id=excluded.account_id,
      actor_id=excluded.actor_id,
      actor_name=coalesce(nullif(excluded.actor_name,''),marketing.post_engagements.actor_name),
      event_text=coalesce(excluded.event_text,marketing.post_engagements.event_text),
      engaged_at=coalesce(excluded.engaged_at,marketing.post_engagements.engaged_at),
      raw_payload=coalesce(marketing.post_engagements.raw_payload,'{}'::jsonb)||excluded.raw_payload,
      is_deleted=case when marketing.post_engagements.deleted_by is null then false else marketing.post_engagements.is_deleted end,
      deleted_at=case when marketing.post_engagements.deleted_by is null then null else marketing.post_engagements.deleted_at end,
      updated_at=now()
    returning *,id::text,crm_lead_id::text
  `;

  if (existing?.deleted_by) return { status: "hidden" as const, leadId: clean(existing.crm_lead_id), createdEvent: false };
  const existingLeadId = clean(eventRow?.crm_lead_id || existing?.crm_lead_id);
  if (existingLeadId && ["created", "reused"].includes(clean(eventRow?.processing_status || existing?.processing_status))) {
    return { status: "duplicate" as const, leadId: existingLeadId, createdEvent: !existing };
  }

  try {
    const lead = await createCrmLeadFromComment(sql, post, item);
    await sql`
      update marketing.post_engagements
      set crm_lead_id=${lead.leadId}::uuid,processing_status=${lead.reused ? 'reused' : 'created'},processing_error=null,updated_at=now()
      where id=${eventRow.id}::uuid
    `;
    if (!lead.reused) {
      await emitSocialEngagementLeadNotification({
        eventKey: item.eventId,
        leadId: lead.leadId,
        publishedPostId: post.id,
        platform: item.platform,
        engagementType: "comment",
        actorId: item.actorId,
        actorName: item.actorName,
        eventText: item.text,
        engagedAt: item.engagedAt,
      }).catch((notificationError: unknown) => console.error("Post comment CRM notification failed", {
        eventId: item.eventId,
        leadId: lead.leadId,
        notificationError,
      }));
    }
    return { status: lead.reused ? "reused" as const : "created" as const, leadId: lead.leadId, createdEvent: !existing };
  } catch (error: any) {
    const message = clean(error?.message) || "تعذر تحويل التعليق إلى CRM";
    await sql`
      update marketing.post_engagements
      set processing_status='failed',processing_error=${message},updated_at=now()
      where id=${eventRow.id}::uuid
    `;
    throw error;
  }
}

async function reconcileRemovedComments(sql: ReturnType<typeof getSql>, post: any, activeCommentIds: string[]) {
  if (activeCommentIds.length) {
    const removed = await sql<any[]>`
      update marketing.post_engagements
      set is_deleted=true,deleted_at=coalesce(deleted_at,now()),processing_error=null,updated_at=now()
      where published_post_id=${post.id}::uuid and engagement_type='comment' and is_deleted=false and deleted_by is null
        and not(provider_event_id=any(${activeCommentIds}::text[]))
      returning id::text,provider_event_id
    `;
    return removed.length;
  }
  const removed = await sql<any[]>`
    update marketing.post_engagements
    set is_deleted=true,deleted_at=coalesce(deleted_at,now()),processing_error=null,updated_at=now()
    where published_post_id=${post.id}::uuid and engagement_type='comment' and is_deleted=false and deleted_by is null
    returning id::text,provider_event_id
  `;
  return removed.length;
}

async function syncRemoteComments(
  sql: ReturnType<typeof getSql>,
  post: any,
  token: string,
  host: MetaGraphHost,
) {
  const platform = clean(post.platform) as "facebook" | "instagram";
  if (platform !== "facebook" && platform !== "instagram") return { synced: 0, removed: 0, skipped: 0, pages: 0 };
  const nodeId = platform === "facebook" ? clean(post.provider_post_id) : clean(post.provider_media_id || post.provider_post_id);
  if (!nodeId) return { synced: 0, removed: 0, skipped: 0, pages: 0 };

  const collection = platform === "facebook"
    ? await graphCollection(`/${encodeURIComponent(nodeId)}/comments`, token, {
      fields: "id,from,message,created_time,parent",
      limit: 100,
      order: "chronological",
    }, "facebook")
    : await graphCollection(`/${encodeURIComponent(nodeId)}/comments`, token, {
      fields: "id,from,text,timestamp,media,parent_id",
      limit: 100,
    }, host);

  const activeIds: string[] = [];
  let synced = 0;
  let skipped = 0;
  for (const row of collection.data) {
    const eventId = clean(row?.id || row?.comment_id);
    if (eventId) activeIds.push(eventId);
    const item = remoteCommentInput(platform, post, row);
    if (!item) { skipped += 1; continue; }
    try {
      await upsertCommentAndCrm(sql, post, item);
      synced += 1;
    } catch (error) {
      console.error("Remote post comment CRM sync failed", { platform, postId: post.id, eventId: item.eventId, error });
      skipped += 1;
    }
  }
  const removed = collection.complete ? await reconcileRemovedComments(sql, post, [...new Set(activeIds)]) : 0;
  return { synced, removed, skipped, pages: collection.pages, complete: collection.complete };
}

async function refreshOne(sql: ReturnType<typeof getSql>, post: any) {
  try {
    let payload: any;
    let likes = numberValue(post.likes_count), comments = numberValue(post.comments_count), shares = numberValue(post.shares_count);
    let saves = numberValue(post.saves_count), views = numberValue(post.views_count), reach = numberValue(post.reach_count);
    let permalink = clean(post.permalink);
    let syncStatus: "pending" | "synced" = "synced";
    let syncError = "";
    let commentSync: any = null;

    if (post.platform === "facebook") {
      const linked = await platformConnection(sql, post.platform);
      const resolved = await resolveFacebookPostForStoredRow(sql, post, linked.token);
      if (!resolved.resolved || !resolved.postId) {
        syncStatus = "pending";
        syncError = "بانتظار ظهور معرف Page Post الحقيقي من Facebook";
        payload = {
          warning: syncError,
          providerMediaId: clean(post.provider_media_id),
          providerPostId: clean(post.provider_post_id),
        };
        permalink = clean(resolved.permalink || permalink);
      } else {
        const workingPost = { ...post, provider_post_id: resolved.postId, permalink: resolved.permalink || post.permalink };
        payload = await graphRequest(`/${encodeURIComponent(resolved.postId)}`, "GET", linked.token, {
          fields: "id,permalink_url,reactions.limit(0).summary(true),comments.limit(0).summary(true),shares",
        }, "facebook");
        likes = numberValue(payload?.reactions?.summary?.total_count);
        comments = numberValue(payload?.comments?.summary?.total_count);
        shares = numberValue(payload?.shares?.count);
        permalink = clean(payload?.permalink_url || resolved.permalink || permalink);
        try {
          commentSync = await syncRemoteComments(sql, workingPost, linked.token, "facebook");
        } catch (error: any) {
          commentSync = { warning: clean(error?.message) || "تعذر مزامنة تعليقات Facebook" };
        }
      }
    } else if (post.platform === "instagram") {
      const linked = await platformConnection(sql, post.platform);
      const host = graphHostForConnection(post.platform, linked.connection);
      const mediaId = clean(post.provider_media_id || post.provider_post_id);
      if (!mediaId) throw new Error("معرف Media الخاص بـInstagram غير موجود");
      payload = await graphRequest(`/${encodeURIComponent(mediaId)}`, "GET", linked.token, {
        fields: "id,permalink,like_count,comments_count,media_type,timestamp",
      }, host);
      likes = numberValue(payload?.like_count);
      comments = numberValue(payload?.comments_count);
      permalink = clean(payload?.permalink || permalink);
      try {
        const insight = await graphRequest(`/${encodeURIComponent(mediaId)}/insights`, "GET", linked.token, {
          metric: "reach,views,saved,shares",
        }, host);
        for (const metric of asArray(insight?.data)) {
          const value = numberValue(asArray(metric?.values)[0]?.value ?? metric?.value);
          if (metric?.name === "reach") reach = value;
          if (metric?.name === "views") views = value;
          if (metric?.name === "saved") saves = value;
          if (metric?.name === "shares") shares = value;
        }
        payload = { ...payload, insights: insight };
      } catch (error: any) {
        payload = { ...payload, insightsWarning: clean(error?.message) };
      }
      try {
        commentSync = await syncRemoteComments(sql, { ...post, provider_media_id: mediaId }, linked.token, host);
      } catch (error: any) {
        commentSync = { warning: clean(error?.message) || "تعذر مزامنة تعليقات Instagram" };
      }
    } else if (post.platform === "youtube") {
      const youtube = await youtubeVideoStatistics(sql, post);
      payload = youtube.payload;
      likes = numberValue(youtube.video?.statistics?.likeCount);
      comments = numberValue(youtube.video?.statistics?.commentCount);
      views = numberValue(youtube.video?.statistics?.viewCount);
      shares = 0;
      saves = 0;
      reach = 0;
      permalink = `https://www.youtube.com/watch?v=${encodeURIComponent(youtube.videoId)}`;
    } else {
      payload = { warning: `تحديث الأرقام التلقائي لمنصة ${platformDisplayName(post.platform)} غير مفعّل بعد` };
      syncStatus = "pending";
      syncError = clean(payload.warning);
    }

    if (commentSync) payload = { ...asObject(payload), commentSync };
    await sql.begin(async tx => {
      await tx`
        update marketing.published_posts set permalink=${permalink || null},likes_count=${likes},comments_count=${comments},shares_count=${shares},
          saves_count=${saves},views_count=${views},reach_count=${reach},last_synced_at=now(),sync_status=${syncStatus},sync_error=${syncError || null},
          raw_metrics=coalesce(raw_metrics,'{}'::jsonb)||${tx.json({ latest: payload } as any)}::jsonb,updated_at=now()
        where id=${post.id}::uuid
      `;
      await tx`
        insert into marketing.engagement_snapshots(published_post_id,snapshot_date,likes_count,comments_count,shares_count,saves_count,views_count,reach_count)
        values(${post.id}::uuid,current_date,${likes},${comments},${shares},${saves},${views},${reach})
        on conflict(published_post_id,snapshot_date) do update set likes_count=excluded.likes_count,comments_count=excluded.comments_count,
          shares_count=excluded.shares_count,saves_count=excluded.saves_count,views_count=excluded.views_count,reach_count=excluded.reach_count,updated_at=now()
      `;
    });
    return { id: post.id, ok: true, skipped: syncStatus === "pending", commentSync };
  } catch (error: any) {
    const message = clean(error?.message) || "تعذر تحديث التفاعل";
    await sql`update marketing.published_posts set last_synced_at=now(),sync_status='failed',sync_error=${message},updated_at=now() where id=${post.id}::uuid`;
    return { id: post.id, ok: false, error: message };
  }
}

export async function refreshEngagementMetrics(sql: ReturnType<typeof getSql>, ids: string[] = []) {
  await backfillPublishedPosts(sql);
  await cleanupLegacyTestEngagementRows(sql);
  await repairStoredEngagementSources(sql);
  const rows = ids.length
    ? await sql<any[]>`select *,id::text from marketing.published_posts where id=any(${ids}::uuid[]) and is_deleted=false order by published_at desc`
    : await sql<any[]>`select *,id::text from marketing.published_posts where is_deleted=false order by published_at desc`;
  const results = [];
  for (const row of rows) results.push(await refreshOne(sql, row));
  return { ok: true, results, updated: results.filter(item => item.ok).length, failed: results.filter(item => !item.ok).length };
}

export async function engagementData(sql: ReturnType<typeof getSql>) {
  await ensureCrmSchema();
  await backfillPublishedPosts(sql);
  await cleanupLegacyTestEngagementRows(sql);
  await repairStoredEngagementSources(sql);
  const rows = await sql<any[]>`
    select pp.*,pp.id::text,pp.schedule_id::text,pp.source_id::text,pp.creative_id::text,pp.task_id::text,
      pp.archived_by::text,pp.deleted_by::text,
      coalesce(campaign.name,agenda.name,'—') as source_name,
      coalesce(cr.name,cr.instance_code,cr.creative_type,'—') as creative_name,
      coalesce(t.title,'—') as task_name,
      coalesce(u.full_name,'—') as assigned_name
    from marketing.published_posts pp
    left join marketing.campaigns campaign on pp.source_type='campaign' and campaign.id=pp.source_id
    left join marketing.agendas agenda on pp.source_type='agenda' and agenda.id=pp.source_id
    left join marketing.creatives cr on cr.id=pp.creative_id
    left join marketing.tasks t on t.id=pp.task_id
    left join core.users u on u.id=t.assigned_to
    where pp.is_deleted=false
    order by pp.published_at desc
  `;
  const engagements = await sql<any[]>`
    select pe.*,pe.id::text,pe.published_post_id::text,pe.crm_lead_id::text,pe.archived_by::text,pe.deleted_by::text,
      pp.platform,pp.archived_at as post_archived_at,coalesce(campaign.name,agenda.name,'—') as campaign_name,
      coalesce(cr.name,cr.instance_code,cr.creative_type,'—') as creative_name,
      l.customer_name,l.branch_code,l.status_label,l.source_name as crm_source_name,l.is_deleted as crm_is_deleted,
      sales.full_name as assigned_name
    from marketing.post_engagements pe
    join marketing.published_posts pp on pp.id=pe.published_post_id
    left join marketing.campaigns campaign on pp.source_type='campaign' and campaign.id=pp.source_id
    left join marketing.agendas agenda on pp.source_type='agenda' and agenda.id=pp.source_id
    left join marketing.creatives cr on cr.id=pp.creative_id
    left join crm.leads l on l.id=pe.crm_lead_id
    left join core.users sales on sales.id=l.assigned_to
    where pe.is_deleted=false and pe.engagement_type='comment' and pp.is_deleted=false
    order by coalesce(pe.engaged_at,pe.created_at) desc limit 500
  `;
  const activeRows = rows.filter((row: any) => !row.archived_at);
  const activeEngagements = engagements.filter((row: any) => !row.archived_at && !row.post_archived_at);
  const summary = activeRows.reduce((total: any, row: any) => ({
    posts: total.posts + 1,
    likes: total.likes + numberValue(row.likes_count),
    comments: total.comments + numberValue(row.comments_count),
    shares: total.shares + numberValue(row.shares_count),
    saves: total.saves + numberValue(row.saves_count),
    views: total.views + numberValue(row.views_count),
    reach: total.reach + numberValue(row.reach_count),
  }), { posts: 0, likes: 0, comments: 0, shares: 0, saves: 0, views: 0, reach: 0 });
  const engagementSummary = {
    engagements: activeEngagements.length,
    commentEvents: activeEngagements.length,
    likeEvents: 0,
    shareEvents: 0,
  };
  const crmLeads = new Set(activeEngagements.map((row: any) => clean(row.crm_lead_id)).filter(Boolean)).size;
  const connections = await sql<any[]>`select platform,metadata from marketing.platform_connections where platform in ('facebook','instagram') order by platform`;
  const subscriptionResults = connections.flatMap((row: any) => {
    const stored = asObject(asObject(row.metadata).engagementWebhookSubscription);
    const direct = asObject(stored.result);
    if (clean(direct.platform)) return [direct];
    return asArray(stored.results).filter((item: any) => clean(item?.platform) === clean(row.platform));
  });
  const callbackBase = clean(process.env.MZJ_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : ''));
  const results = await engagementResultsData(sql);
  return {
    ok: true,
    rows,
    engagements,
    comments: engagements.filter((row: any) => row.engagement_type === 'comment'),
    summary: { ...summary, ...engagementSummary, crmLeads },
    results,
    webhook: {
      callbackUrl: callbackBase ? `${callbackBase.replace(/\/$/,'')}/api/integrations/meta/engagement-webhook` : '/api/integrations/meta/engagement-webhook',
      verifyTokenConfigured: Boolean(clean(process.env.META_WEBHOOK_VERIFY_TOKEN)),
      subscriptionResults,
    },
  };
}

type SubscriptionTarget = {
  platform: 'facebook' | 'instagram';
  field: 'feed' | 'comments';
  accountId: string;
  accountName: string;
  host: MetaGraphHost;
  token: string;
  grantedScopes: string[];
  requiredScopes: string[];
};

async function subscribeTarget(target: SubscriptionTarget) {
  const missing = missingScopes(target.grantedScopes, target.requiredScopes);
  const base = {
    platform: target.platform,
    field: target.field,
    accountId: target.accountId,
    accountName: target.accountName,
    host: target.host,
    endpoint: `/${target.accountId}/subscribed_apps`,
    grantedScopes: target.grantedScopes,
    requiredScopes: target.requiredScopes,
    missingScopes: missing,
  };
  if (missing.length) return { ...base, ok: false, error: `التوكن الحالي لا يحتوي الصلاحيات المطلوبة: ${missing.join(', ')}`, errorDetails: {} };
  try {
    const result = await graphRequest(`/${encodeURIComponent(target.accountId)}/subscribed_apps`, 'POST', target.token, { subscribed_fields: target.field }, target.host);
    const verification = await graphRequest(`/${encodeURIComponent(target.accountId)}/subscribed_apps`, 'GET', target.token, {}, target.host);
    const fields = subscriptionFields(verification);
    if (!fields.includes(target.field)) {
      return { ...base, ok: false, result, verification, subscribedFields: fields, error: `Meta استقبلت طلب الاشتراك لكن الحقل ${target.field} لم يظهر ضمن الاشتراكات الفعلية`, errorDetails: {} };
    }
    return { ...base, ok: true, result, verification, subscribedFields: fields };
  } catch (error: any) {
    return { ...base, ok: false, ...subscriptionFailure(error) };
  }
}

async function verifyInstagramFacebookLoginSubscription(linked: any, grantedScopes: string[]) {
  const accountId = clean(linked.connection.ig_user_id || linked.connection.account_id);
  const pageId = clean(linked.connection.page_id);
  const requiredScopes = ['instagram_basic', 'instagram_manage_comments', 'pages_read_engagement', 'pages_manage_metadata'];
  const missing = missingScopes(grantedScopes, requiredScopes);
  const base = {
    platform: 'instagram' as const,
    field: 'comments' as const,
    accountId,
    accountName: clean(linked.connection.account_name || linked.connection.username),
    host: 'facebook' as const,
    endpoint: `/${pageId}/subscribed_apps`,
    linkedPageId: pageId,
    activationMode: 'facebook_page_subscription',
    grantedScopes,
    requiredScopes,
    missingScopes: missing,
  };
  if (!accountId) return { ...base, ok: false, error: 'Instagram Account ID غير موجود', errorDetails: {} };
  if (!pageId) return { ...base, ok: false, error: 'صفحة Facebook المرتبطة بحساب Instagram غير موجودة', errorDetails: {} };
  if (missing.length) return { ...base, ok: false, error: `التوكن الحالي لا يحتوي الصلاحيات المطلوبة: ${missing.join(', ')}`, errorDetails: {} };
  try {
    // Facebook Login for Business installs the app on the linked Page. We only verify that existing
    // Page subscription here; no Facebook subscription field or Facebook flow is changed by Instagram.
    const verification = await graphRequest(`/${encodeURIComponent(pageId)}/subscribed_apps`, 'GET', linked.token, {}, 'facebook');
    const fields = subscriptionFields(verification);
    if (!fields.includes('feed')) {
      return {
        ...base,
        ok: false,
        verification,
        subscribedFields: fields,
        error: 'اشتراك صفحة Facebook الحالي لا يحتوي الحقل feed المطلوب لتوصيل أحداث الحساب المرتبط. فعّل Facebook كما كان ثم تأكد من تفعيل comments داخل Webhooks > Instagram في Meta App.',
        errorDetails: {},
      };
    }
    return {
      ...base,
      ok: true,
      verification,
      subscribedFields: fields,
      note: 'تم التحقق من تثبيت التطبيق على الصفحة المرتبطة. استقبال comments يعتمد على تفعيل حقل Instagram داخل Meta App.',
    };
  } catch (error: any) {
    return { ...base, ok: false, ...subscriptionFailure(error) };
  }
}

export async function subscribeMetaEngagementWebhooks(sql: ReturnType<typeof getSql>) {
  const results: any[] = [];
  for (const platform of ['facebook','instagram'] as const) {
    try {
      const linked = await platformConnection(sql, platform);
      const grantedScopes = connectionScopes(linked.connection);
      const isFacebook = platform === 'facebook';
      const accountId = isFacebook
        ? clean(linked.connection.page_id || linked.connection.account_id)
        : clean(linked.connection.ig_user_id || linked.connection.account_id);
      if (!accountId) throw new Error(isFacebook ? 'Page ID الخاص بـFacebook غير موجود' : 'Instagram Account ID غير موجود');
      const instagramLogin = !isFacebook && grantedScopes.some((scope) => scope.startsWith('instagram_business_'));
      if (!isFacebook && !instagramLogin) {
        results.push(await verifyInstagramFacebookLoginSubscription(linked, grantedScopes));
        continue;
      }
      results.push(await subscribeTarget({
        platform,
        field: isFacebook ? 'feed' : 'comments',
        accountId,
        accountName: clean(linked.connection.page_name || linked.connection.account_name || linked.connection.username),
        host: instagramLogin ? 'instagram' : 'facebook',
        token: linked.token,
        grantedScopes,
        requiredScopes: isFacebook ? ['pages_manage_metadata'] : ['instagram_business_manage_comments'],
      }));
    } catch (error: any) {
      results.push({ platform, field: platform === 'facebook' ? 'feed' : 'comments', ok: false, ...subscriptionFailure(error) });
    }
  }
  const updatedAt = new Date().toISOString();
  for (const item of results) {
    await sql`
      update marketing.platform_connections
      set metadata=coalesce(metadata,'{}'::jsonb)||${sql.json({ engagementWebhookSubscription: { result: item, updatedAt } } as any)}::jsonb,updated_at=now()
      where platform=${item.platform}
    `;
  }
  const subscriptionOk = results.every((item) => item.ok);
  return {
    ok: true,
    subscriptionOk,
    results,
    message: subscriptionOk ? 'تم تفعيل استقبال تعليقات Facebook وInstagram والتحقق من الاشتراكات' : 'تعذر تفعيل استقبال التعليقات على منصة أو أكثر؛ راجع التفاصيل أدناه',
  };
}

type NormalizedMetaEvent = {
  platform: "facebook" | "instagram";
  kind: "comment_added" | "comment_removed" | "metrics_changed";
  metric?: "reaction" | "share";
  verb?: "add" | "remove" | "update";
  accountId: string;
  postIds: string[];
  eventId: string;
  actorId: string;
  actorName: string;
  text: string;
  engagedAt: string;
  raw: any;
};

function normalizedChanges(entry: any) {
  const changes = asArray(entry?.changes);
  if (changes.length) return changes;
  const field = clean(entry?.field);
  return field ? [{ field, value: entry?.value }] : [];
}

function normalizeWebhook(payload: any): NormalizedMetaEvent[] {
  const output: NormalizedMetaEvent[] = [];
  const object = clean(payload?.object).toLowerCase();
  for (const entry of asArray(payload?.entry)) {
    const accountId = clean(entry?.id);
    for (const change of normalizedChanges(entry)) {
      const value = asObject(change?.value);
      const field = clean(change?.field);
      if (object === "page" && field === "feed") {
        const item = clean(value?.item).toLowerCase();
        const verbRaw = clean(value?.verb).toLowerCase();
        const verb = verbRaw === "remove" ? "remove" : verbRaw === "update" ? "update" : "add";
        const from = asObject(value?.from || value?.actor);
        const actorId = clean(from?.id);
        const actorName = clean(from?.name) || "عميل Facebook";
        const postIds = [...new Set([
          clean(value?.post_id),
          clean(value?.parent_id),
          clean(value?.video_id),
        ].filter(Boolean))];
        const engagedAt = commentTimestamp(value?.created_time, entry?.time);

        if (item === "comment") {
          const eventId = clean(value?.comment_id || value?.id);
          if (!eventId) continue;
          if (verb === "remove") {
            output.push({
              platform: "facebook", kind: "comment_removed", verb, accountId, postIds, eventId,
              actorId, actorName, text: clean(value?.message), engagedAt, raw: change,
            });
          } else if (actorId) {
            output.push({
              platform: "facebook", kind: "comment_added", verb, accountId, postIds, eventId,
              actorId, actorName, text: clean(value?.message), engagedAt, raw: change,
            });
          }
          continue;
        }

        if (item === "reaction" || item === "share") {
          const metric = item === "reaction" ? "reaction" : "share";
          const eventId = clean(value?.reaction_id || value?.share_id || value?.id)
            || `${postIds[0] || "post"}:${metric}:${verb}:${clean(value?.reaction_type) || actorId || "aggregate"}`;
          output.push({
            platform: "facebook", kind: "metrics_changed", metric, verb, accountId, postIds, eventId,
            actorId, actorName, text: metric === "reaction" ? clean(value?.reaction_type) : "", engagedAt, raw: change,
          });
        }
      }

      if (object === "instagram" && field === "comments") {
        const from = asObject(value?.from);
        const media = asObject(value?.media);
        const eventId = clean(value?.id || value?.comment_id);
        if (!eventId) continue;
        const actorId = clean(from?.id || from?.ig_scoped_id || from?.username);
        const verbRaw = clean(value?.verb).toLowerCase();
        const removed = verbRaw === "remove" || value?.deleted === true || value?.is_deleted === true;
        const postIds = [...new Set([clean(media?.id), clean(value?.media_id)].filter(Boolean))];
        output.push({
          platform: "instagram",
          kind: removed ? "comment_removed" : "comment_added",
          verb: removed ? "remove" : "add",
          accountId,
          postIds,
          eventId,
          actorId,
          actorName: clean(from?.username || from?.name) || "عميل Instagram",
          text: clean(value?.text || value?.message),
          engagedAt: commentTimestamp(value?.timestamp, entry?.time),
          raw: change,
        });
      }
    }
  }
  return output;
}

async function exactPublishedPost(sql: ReturnType<typeof getSql>, item: NormalizedMetaEvent) {
  const candidates = [...new Set(item.postIds.map(clean).filter(Boolean))];
  if (!candidates.length) return null;
  const [post] = await sql<any[]>`
    select *,id::text,source_id::text,creative_id::text,task_id::text from marketing.published_posts
    where platform=${item.platform} and account_id=${item.accountId} and is_deleted=false
      and (coalesce(provider_post_id,'')=any(${candidates}::text[]) or coalesce(provider_media_id,'')=any(${candidates}::text[]))
    order by published_at desc limit 1
  `;
  return post || null;
}

async function findPublishedPost(sql: ReturnType<typeof getSql>, item: NormalizedMetaEvent) {
  const direct = await exactPublishedPost(sql, item);
  if (direct || item.platform !== "facebook") return direct;
  const candidates = [...new Set(item.postIds.map(clean).filter(Boolean))];
  if (!candidates.length) return null;

  let token = "";
  try {
    token = (await platformConnection(sql, "facebook")).token;
  } catch {
    return null;
  }

  // A Page feed webhook contains the real post id. Resolve its attachment target(s) back to
  // the media/video id saved during publishing, then persist the real Page Post id once.
  for (const candidate of candidates) {
    try {
      const node = await graphRequest(`/${encodeURIComponent(candidate)}`, "GET", token, {
        fields: "id,permalink_url,attachments{target}",
      }, "facebook");
      const mediaIds = attachmentTargetIds(node?.attachments);
      if (!mediaIds.length) continue;
      const [matched] = await sql<any[]>`
        select *,id::text,source_id::text,creative_id::text,task_id::text from marketing.published_posts
        where platform='facebook' and account_id=${item.accountId} and is_deleted=false
          and coalesce(provider_media_id,'')=any(${mediaIds}::text[])
        order by published_at desc limit 1
      `;
      if (!matched) continue;
      const realPostId = clean(node?.id || candidate);
      const permalink = clean(node?.permalink_url || matched.permalink);
      await sql`
        update marketing.published_posts
        set provider_post_id=${realPostId},permalink=coalesce(nullif(${permalink},''),permalink),updated_at=now()
        where id=${matched.id}::uuid
      `;
      return { ...matched, provider_post_id: realPostId, permalink };
    } catch {
      // Candidate may be a parent comment id rather than a post id. Try the next candidate.
    }
  }

  const unresolved = await sql<any[]>`
    select *,id::text,source_id::text,creative_id::text,task_id::text from marketing.published_posts
    where platform='facebook' and account_id=${item.accountId} and is_deleted=false and provider_media_id is not null
    order by published_at desc limit 12
  `;
  for (const row of unresolved) {
    try {
      const resolved = await resolveFacebookPostForStoredRow(sql, row, token);
      if (resolved.postId && candidates.includes(resolved.postId)) {
        return { ...row, provider_post_id: resolved.postId, permalink: resolved.permalink || row.permalink };
      }
    } catch {
      // Continue scanning recent unresolved records.
    }
  }
  return null;
}

async function createCrmLeadFromComment(sql: ReturnType<typeof getSql>, post: any, item: CommentEngagementInput) {
  const sourceCode = item.platform === "facebook" ? "facebook_post" : "instagram_post";
  const sourceName = item.platform === "facebook" ? "بوست فيس بوك" : "بوست انستجرام";
  const preview = item.text || "تعليق على منشور";
  const { contact } = await ensureContactIdentity({
    channelCode: item.platform,
    externalId: item.actorId,
    participantId: item.actorId,
    pageId: item.accountId,
    displayName: item.actorName,
    metadata: { origin: "post_comment", engagementType: "comment", sourceCode, providerPostId: post.provider_post_id, providerMediaId: post.provider_media_id },
  });
  const legacyId = `post-comment:${item.platform}:${item.accountId}:${item.actorId}`;
  const [conversation] = await sql<any[]>`
    insert into crm.conversations(
      legacy_id,contact_id,channel_code,customer_name,participant_id,status,preview_text,unread_count,last_message_at,
      provider,page_id,classification_state,last_customer_message_at,metadata
    ) values(
      ${legacyId},${contact.id}::uuid,${item.platform},${item.actorName},${item.actorId},'open',${preview},1,${item.engagedAt}::timestamptz,
      'meta',${item.accountId},'new',${item.engagedAt}::timestamptz,${sql.json({ origin: 'post_comment', engagementType: 'comment', sourceCode, publishedPostId: post.id, providerPostId: post.provider_post_id, providerMediaId: post.provider_media_id } as any)}
    ) on conflict(legacy_id) do update set
      contact_id=excluded.contact_id,customer_name=coalesce(nullif(excluded.customer_name,''),crm.conversations.customer_name),
      preview_text=coalesce(nullif(excluded.preview_text,''),crm.conversations.preview_text),unread_count=greatest(crm.conversations.unread_count,1),
      last_message_at=greatest(coalesce(crm.conversations.last_message_at,'epoch'),excluded.last_message_at),
      last_customer_message_at=greatest(coalesce(crm.conversations.last_customer_message_at,'epoch'),excluded.last_customer_message_at),
      metadata=coalesce(crm.conversations.metadata,'{}'::jsonb)||excluded.metadata,updated_at=now()
    returning *,id::text,contact_id::text,lead_id::text,service_request_id::text
  `;
  const classification = await classifyConversationService({
    conversationId: conversation.id,
    serviceKey: "cash",
    sourceCode,
    classificationMethod: "meta_post_comment",
    eventKey: `${item.platform}:comment:${item.eventId}`,
    skipAutomaticTemplate: true,
    assignPrimary: true,
    assignCallCenter: false,
  });
  const [source] = post.source_type === "agenda"
    ? await sql<any[]>`select name from marketing.agendas where id=${post.source_id}::uuid`
    : await sql<any[]>`select name from marketing.campaigns where id=${post.source_id}::uuid`;
  const leadId = clean(classification.leadId || classification.request?.lead_id);
  if (!leadId) throw new Error("تعذر تحديد عميل CRM بعد توزيع التعليق");
  await sql`
    update crm.leads set source_code=${sourceCode},source_name=${sourceName},platform_code=${item.platform},campaign_name=${clean(source?.name) || null},
      extra_data=coalesce(extra_data,'{}'::jsonb)||${sql.json({
        socialEngagement: true,
        engagementType: "comment",
        publishedPostId: post.id,
        providerPostId: post.provider_post_id,
        providerMediaId: post.provider_media_id,
        latestEngagementId: item.eventId,
        latestEngagementText: item.text,
      } as any)}::jsonb,updated_at=now()
    where id=${leadId}::uuid
  `;
  return { leadId, reused: Boolean(classification.reused) };
}

async function markCommentRemoved(sql: ReturnType<typeof getSql>, post: any, eventId: string) {
  const removed = await sql<any[]>`
    update marketing.post_engagements
    set is_deleted=true,deleted_at=coalesce(deleted_at,now()),processing_error=null,updated_at=now()
    where published_post_id=${post.id}::uuid and engagement_type='comment' and provider_event_id=${eventId} and is_deleted=false and deleted_by is null
    returning id::text,crm_lead_id::text
  `;
  return removed.length;
}

function commentInputFromWebhook(item: NormalizedMetaEvent): CommentEngagementInput {
  return {
    platform: item.platform,
    accountId: item.accountId,
    postIds: item.postIds,
    eventId: item.eventId,
    actorId: item.actorId,
    actorName: item.actorName,
    text: item.text,
    engagedAt: item.engagedAt,
    raw: item.raw,
  };
}

export async function processMetaEngagementWebhook(payload: any) {
  await Promise.all([ensureMarketingSchema(), ensureCrmSchema()]);
  const sql = getSql();
  const events = normalizeWebhook(payload);
  const results: any[] = [];

  for (const item of events) {
    try {
      const post = await findPublishedPost(sql, item);
      if (!post) {
        results.push({ eventId: item.eventId, kind: item.kind, status: "ignored", reason: "post_not_published_by_platform" });
        continue;
      }

      if (item.kind === "metrics_changed") {
        // Reactions/likes and shares are aggregate metrics only. Never create an identity,
        // engagement row, Contact, Conversation, or Lead for them. Refresh authoritative counts.
        const refreshed = await refreshOne(sql, post);
        results.push({
          eventId: item.eventId,
          kind: item.kind,
          metric: item.metric,
          status: refreshed.ok ? "metrics_synced" : "metrics_sync_failed",
          error: refreshed.ok ? undefined : refreshed.error,
        });
        continue;
      }

      if (item.kind === "comment_removed") {
        const removed = await markCommentRemoved(sql, post, item.eventId);
        const refreshed = await refreshOne(sql, post);
        results.push({
          eventId: item.eventId,
          kind: item.kind,
          status: "comment_removed",
          removed,
          metricsSynced: refreshed.ok,
          metricsError: refreshed.ok ? undefined : refreshed.error,
        });
        continue;
      }

      if (!item.actorId || item.actorId === item.accountId) {
        const refreshed = await refreshOne(sql, post);
        results.push({
          eventId: item.eventId,
          kind: item.kind,
          status: "ignored",
          reason: item.actorId === item.accountId ? "own_account_comment" : "comment_actor_unavailable",
          metricsSynced: refreshed.ok,
        });
        continue;
      }

      const stored = await upsertCommentAndCrm(sql, post, commentInputFromWebhook(item));
      const refreshed = await refreshOne(sql, post);
      results.push({
        eventId: item.eventId,
        kind: item.kind,
        engagementType: "comment",
        status: stored.status,
        leadId: stored.leadId || undefined,
        metricsSynced: refreshed.ok,
        metricsError: refreshed.ok ? undefined : refreshed.error,
      });
    } catch (error: any) {
      results.push({
        eventId: item.eventId,
        kind: item.kind,
        status: "failed",
        error: clean(error?.message) || "تعذر معالجة حدث Meta",
      });
    }
  }
  return { ok: true, received: events.length, results };
}

export async function manageEngagementItem(sql: ReturnType<typeof getSql>, body: any, user: SessionUser) {
  const entity = clean(body.entity);
  const operation = clean(body.operation);
  const id = clean(body.id);
  if (!id || !['post','engagement'].includes(entity) || !['archive','restore','delete','delete_customer'].includes(operation)) {
    throw new Error('إجراء تفاعل النشر غير صالح');
  }
  if (entity === 'post') {
    if (operation === 'delete_customer') throw new Error('هذا الإجراء متاح للتفاعلات المرتبطة بعميل فقط');
    const [row] = await sql<any[]>`select id::text from marketing.published_posts where id=${id}::uuid and is_deleted=false`;
    if (!row) throw new Error('المنشور غير موجود');
    if (operation === 'archive') {
      await sql`update marketing.published_posts set archived_at=now(),archived_by=${user.id}::uuid,updated_at=now() where id=${id}::uuid`;
      return { ok: true, message: 'تمت أرشفة المنشور' };
    }
    if (operation === 'restore') {
      await sql`update marketing.published_posts set archived_at=null,archived_by=null,updated_at=now() where id=${id}::uuid`;
      return { ok: true, message: 'تمت استعادة المنشور' };
    }
    await sql`update marketing.published_posts set is_deleted=true,deleted_at=now(),deleted_by=${user.id}::uuid,updated_at=now() where id=${id}::uuid`;
    return { ok: true, message: 'تم مسح المنشور من تفاعل النشر' };
  }

  const [row] = await sql<any[]>`
    select id::text,crm_lead_id::text,processing_status from marketing.post_engagements where id=${id}::uuid and is_deleted=false
  `;
  if (!row) throw new Error('التفاعل غير موجود');
  if (operation === 'archive') {
    await sql`update marketing.post_engagements set archived_at=now(),archived_by=${user.id}::uuid,updated_at=now() where id=${id}::uuid`;
    return { ok: true, message: 'تمت أرشفة التفاعل' };
  }
  if (operation === 'restore') {
    await sql`update marketing.post_engagements set archived_at=null,archived_by=null,updated_at=now() where id=${id}::uuid`;
    return { ok: true, message: 'تمت استعادة التفاعل' };
  }
  if (operation === 'delete_customer') {
    const leadId = clean(row.crm_lead_id);
    if (!leadId) throw new Error('لا يوجد عميل CRM مرتبط بهذا التفاعل');
    if (clean(row.processing_status) !== 'created') throw new Error('هذا العميل كان موجودًا مسبقًا في CRM؛ يمكن مسح التفاعل فقط دون مسح العميل');
    await sql.begin(async tx => {
      await tx`update crm.leads set is_deleted=true,deleted_by=${user.id}::uuid,deleted_at=now(),updated_at=now() where id=${leadId}::uuid and is_deleted=false`;
      await tx`update marketing.post_engagements set is_deleted=true,deleted_at=now(),deleted_by=${user.id}::uuid,updated_at=now() where crm_lead_id=${leadId}::uuid and is_deleted=false`;
    });
    return { ok: true, message: 'تم مسح العميل الذي أُنشئ من التفاعل وسجل تفاعلاته' };
  }
  await sql`update marketing.post_engagements set is_deleted=true,deleted_at=now(),deleted_by=${user.id}::uuid,updated_at=now() where id=${id}::uuid`;
  return { ok: true, message: 'تم مسح التفاعل من السجل' };
}

