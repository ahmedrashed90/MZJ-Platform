/**
 * Meta account/post discovery. It deliberately does NOT insert into published_posts
 * or post_engagements: those tables drive the existing schedule and CRM workflows.
 */
import { getSql, tryWithDatabaseAdvisoryLock } from './_db.js';
import { ensureMarketingSchema } from './_marketing-schema.js';
import { decryptPlatformToken } from './_platform-connections.js';

type Sql = ReturnType<typeof getSql>;
export type MetaPlatform = 'facebook' | 'instagram';

type DiscoveredPost = {
  platform: MetaPlatform;
  accountId: string;
  providerId: string;
  providerMediaId: string;
  caption: string;
  permalink: string;
  postType: string;
  publishedAt: string;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  views: number | null;
  reach: number | null;
};

type MetaConnection = {
  platform: MetaPlatform;
  accountId: string;
  accountName: string;
  token: string;
  host: 'facebook' | 'instagram';
};

// One Graph page is upserted atomically in ONE SQL statement, not 70 writes.
const BATCH_SIZE = 70;
const RECENT_SIZE = 15;
// Keep ample headroom below Vercel's 120-second function limit.
const SYNC_BUDGET_MS = 72000;
const META_REQUEST_TIMEOUT_MS = 8000;
const PAGE_START_HEADROOM_MS = 22000;
const SINGLE_REQUEST_HEADROOM_MS = 13000;
type SyncBudget = { deadline: number };
const remainingMs = (budget: SyncBudget) => budget.deadline - Date.now();
const hasTime = (budget: SyncBudget, minimumMs: number) => remainingMs(budget) >= minimumMs;
const MAX_RESPONSE_LENGTH = 1800;
const clean = (value: unknown) => String(value ?? '').trim();
const numberOrNull = (value: unknown): number | null => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Math.max(0, Math.trunc(Number(value)));
const asArray = (value: unknown): any[] => Array.isArray(value) ? value : [];
const version = () => clean(process.env.META_GRAPH_VERSION) || 'v25.0';

function normalizedError(error: unknown): string {
  const value = clean((error as Error)?.message || error);
  // Never persist an access token or the URL from a Graph paging.next response.
  return value.replace(/access_token=[^\s&]+/gi, 'access_token=[REDACTED]').slice(0, MAX_RESPONSE_LENGTH) || 'تعذرت مزامنة Meta';
}

async function metaGet(conn: MetaConnection, path: string, params: Record<string, string | number | undefined> = {}, budget?: SyncBudget) {
  const host = conn.host === 'instagram' ? 'graph.instagram.com' : 'graph.facebook.com';
  const url = new URL(`https://${host}/${version()}/${path.replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${conn.token}` },
    signal: AbortSignal.timeout(budget
      ? Math.max(1000, Math.min(META_REQUEST_TIMEOUT_MS, remainingMs(budget) - 5000))
      : META_REQUEST_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    const error = data?.error || {};
    const message = clean(error.error_user_msg || error.message) || `Meta HTTP ${response.status}`;
    const failure = new Error(`${message} (${numberOrNull(error.code) ?? response.status})`) as Error & { metaCode?: number | null };
    failure.metaCode = numberOrNull(error.code);
    throw failure;
  }
  return data;
}

function normalizePost(platform: MetaPlatform, accountId: string, row: any): DiscoveredPost | null {
  const providerId = clean(row?.id);
  const publishedAt = clean(platform === 'facebook' ? row?.created_time : row?.timestamp);
  if (!providerId || !publishedAt || Number.isNaN(new Date(publishedAt).getTime())) return null;
  if (platform === 'facebook') {
    const attachment = asArray(row?.attachments?.data)[0];
    return {
      platform, accountId, providerId, providerMediaId: clean(attachment?.target?.id || providerId),
      caption: clean(row?.message), permalink: clean(row?.permalink_url),
      postType: clean(attachment?.media_type || attachment?.type) || 'POST', publishedAt,
      likes: numberOrNull(row?.reactions?.summary?.total_count),
      comments: numberOrNull(row?.comments?.summary?.total_count),
      shares: numberOrNull(row?.shares?.count), saves: null, views: null, reach: null,
    };
  }
  return {
    platform, accountId, providerId, providerMediaId: providerId,
    caption: clean(row?.caption), permalink: clean(row?.permalink),
    postType: clean(row?.media_product_type || row?.media_type) || 'MEDIA', publishedAt,
    likes: numberOrNull(row?.like_count), comments: numberOrNull(row?.comments_count),
    shares: null, saves: null, views: null, reach: null,
  };
}

async function connections(sql: Sql): Promise<MetaConnection[]> {
  const rows = await sql<any[]>`
    select platform,account_id,account_name,page_id,page_name,ig_user_id,username,scopes,
           page_access_token_encrypted,access_token_encrypted
    from marketing.platform_connections
    where platform in ('facebook','instagram') and connected=true
  `;
  return rows.flatMap((row: any) => {
    const platform = clean(row.platform) as MetaPlatform;
    const accountId = platform === 'facebook'
      ? clean(row.page_id || row.account_id)
      : clean(row.ig_user_id || row.account_id);
    const token = decryptPlatformToken(row.page_access_token_encrypted || row.access_token_encrypted);
    if (!accountId || !token) return [];
    // Supports both legacy Facebook Login and Instagram Login connection types.
    const scopes = asArray(row.scopes).map(clean);
    return [{
      platform,
      accountId,
      accountName: platform === 'facebook' ? clean(row.page_name || row.account_name) : clean(row.username || row.account_name),
      token,
      host: platform === 'instagram' && scopes.some((scope) => scope.startsWith('instagram_business_')) ? 'instagram' as const : 'facebook' as const,
    }];
  });
}

async function snapshotFollowers(sql: Sql, conn: MetaConnection, budget: SyncBudget) {
  const fields = conn.platform === 'facebook'
    ? 'id,name,followers_count,fan_count'
    : 'id,username,followers_count,media_count';
  const payload = await metaGet(conn, conn.accountId, { fields }, budget);
  if (numberOrNull(payload?.followers_count) === null) {
    throw new Error('Meta لم ترجع عدد المتابعين لهذا الحساب');
  }
  const followers = numberOrNull(payload.followers_count) ?? 0;
  const fans = numberOrNull(payload.fan_count);
  const mediaCount = numberOrNull(payload.media_count);
  await sql`
    insert into marketing.meta_follower_snapshots(platform,account_id,account_name,snapshot_date,followers_count,fan_count,media_count)
    values(${conn.platform},${conn.accountId},${clean(payload.name || payload.username || conn.accountName)},current_date,${followers},${fans},${mediaCount})
    on conflict(platform,account_id,snapshot_date) do update set
      account_name=excluded.account_name,followers_count=excluded.followers_count,fan_count=excluded.fan_count,
      media_count=excluded.media_count,updated_at=now()
  `;
  return followers;
}

async function listPosts(conn: MetaConnection, after: string, limit: number, budget: SyncBudget) {
  const fields = conn.platform === 'facebook'
    ? 'id,message,created_time,permalink_url,attachments{media_type,target},reactions.limit(0).summary(true),comments.limit(0).summary(true),shares'
    : 'id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count';
  const edge = conn.platform === 'facebook' ? 'posts' : 'media';
  const params = { fields, limit, after: after || undefined };
  try {
    const response = await metaGet(conn, `${conn.accountId}/${edge}`, params, budget);
    return { response, detailed: true };
  } catch (error) {
    // Retry lighter fields only for rejected Graph field expansions, never for timeouts
    // or expired credentials: retrying a timeout could waste the entire Cron window.
    const code = (error as Error & { metaCode?: number | null })?.metaCode;
    if (code !== 100 && code !== 12) throw error;
    const fallbackFields = conn.platform === 'facebook'
      ? 'id,message,created_time,permalink_url'
      : 'id,caption,media_type,timestamp,permalink,like_count,comments_count';
    return {
      response: await metaGet(conn, `${conn.accountId}/${edge}`, { ...params, fields: fallbackFields }, budget),
      detailed: conn.platform === 'instagram',
    };
  }
}

async function enrichFacebookCount(conn: MetaConnection, row: any, budget: SyncBudget): Promise<any> {
  // Only used when Page/posts rejected expanded fields.
  try {
    const payload = await metaGet(conn, clean(row.id), {
      fields: 'id,reactions.limit(0).summary(true),comments.limit(0).summary(true),shares',
    }, budget);
    return { ...row, ...payload };
  } catch {
    return row; // unknown metrics are null, never silently zeroed
  }
}

async function enrichRecentInstagramInsights(conn: MetaConnection, record: DiscoveredPost, budget: SyncBudget) {
  if (conn.platform !== 'instagram') return record;
  try {
    const payload = await metaGet(conn, `${record.providerId}/insights`, {
      metric: 'reach,views,saved,shares',
    }, budget);
    for (const metric of asArray(payload?.data)) {
      const value = numberOrNull(metric?.values?.[0]?.value ?? metric?.total_value?.value ?? metric?.value);
      if (value === null) continue;
      if (metric.name === 'reach') record.reach = value;
      if (metric.name === 'views') record.views = value;
      if (metric.name === 'saved') record.saves = value;
      if (metric.name === 'shares') record.shares = value;
    }
  } catch {
    // Unsupported insights vary by media type; preserve nullable unknown metrics.
  }
  return record;
}

/**
 * A Graph page is persisted in a single atomic upsert. A cursor is only saved
 * AFTER the full page commits, so a failed/slow page is safely retried.
 * The unique provider key and existing archive/delete state are preserved.
 */
async function savePostBatch(sql: Sql, records: DiscoveredPost[]) {
  if (!records.length) return;
  const unique = [...new Map(records.map((record) => [record.providerId, record])).values()];
  const payload = JSON.stringify(unique.map((record) => ({
    platform: record.platform, account_id: record.accountId,
    provider_post_id: record.providerId, provider_media_id: record.providerMediaId,
    caption: record.caption, permalink: record.permalink || null,
    post_type_name: record.postType, published_at: record.publishedAt,
    likes_count: record.likes, comments_count: record.comments, shares_count: record.shares,
    saves_count: record.saves, views_count: record.views, reach_count: record.reach,
  })));
  await sql`
    insert into marketing.meta_external_posts(
      platform,account_id,provider_post_id,provider_media_id,caption,permalink,post_type_name,published_at,
      likes_count,comments_count,shares_count,saves_count,views_count,reach_count,sync_status,last_synced_at
    )
    select p.platform,p.account_id,p.provider_post_id,p.provider_media_id,p.caption,p.permalink,p.post_type_name,
      p.published_at::timestamptz,p.likes_count,p.comments_count,p.shares_count,p.saves_count,p.views_count,p.reach_count,
      'synced',now()
    from jsonb_to_recordset(${payload}::jsonb) as p(
      platform text,account_id text,provider_post_id text,provider_media_id text,caption text,permalink text,
      post_type_name text,published_at text,likes_count bigint,comments_count bigint,shares_count bigint,
      saves_count bigint,views_count bigint,reach_count bigint
    )
    where true
    on conflict(platform,account_id,provider_post_id) do update set
      caption=excluded.caption,provider_media_id=excluded.provider_media_id,
      permalink=coalesce(excluded.permalink,marketing.meta_external_posts.permalink),
      post_type_name=excluded.post_type_name,published_at=excluded.published_at,
      likes_count=coalesce(excluded.likes_count,marketing.meta_external_posts.likes_count),
      comments_count=coalesce(excluded.comments_count,marketing.meta_external_posts.comments_count),
      shares_count=coalesce(excluded.shares_count,marketing.meta_external_posts.shares_count),
      saves_count=coalesce(excluded.saves_count,marketing.meta_external_posts.saves_count),
      views_count=coalesce(excluded.views_count,marketing.meta_external_posts.views_count),
      reach_count=coalesce(excluded.reach_count,marketing.meta_external_posts.reach_count),
      sync_status='synced',sync_error=null,last_synced_at=now(),updated_at=now()
  `;
}

async function importPage(sql: Sql, conn: MetaConnection, after: string, limit: number, insights: boolean, budget: SyncBudget) {
  const { response, detailed } = await listPosts(conn, after, limit, budget);
  const unique = new Map<string, DiscoveredPost>();
  for (const row of asArray(response?.data)) {
    const normalized = normalizePost(conn.platform, conn.accountId, row);
    if (normalized) unique.set(normalized.providerId, normalized);
  }
  const records = [...unique.values()];
  // No per-post network requests on historical pages. A single bounded request
  // is allowed on recent content when there is enough time left in this run.
  if (insights && records.length && hasTime(budget, SINGLE_REQUEST_HEADROOM_MS)) {
    if (conn.platform === 'facebook' && !detailed) {
      const first = asArray(response?.data).find((row: any) => unique.has(clean(row?.id)));
      if (first) {
        const enriched = normalizePost(conn.platform, conn.accountId, await enrichFacebookCount(conn, first, budget));
        if (enriched) unique.set(enriched.providerId, enriched);
      }
    } else if (conn.platform === 'instagram') {
      await enrichRecentInstagramInsights(conn, records[0], budget);
    }
  }
  await savePostBatch(sql, [...unique.values()]);
  const cursor = clean(response?.paging?.cursors?.after);
  const hasNext = Boolean(response?.paging?.next && cursor && cursor !== after);
  return { imported: unique.size, cursor: hasNext ? cursor : '', complete: !hasNext };
}

// Old content is rotated in small batches, and never allowed to consume the
// remaining run budget needed for other accounts and cursor persistence.
async function refreshOlderMetrics(sql: Sql, conn: MetaConnection, budget: SyncBudget, limit = 4) {
  const candidates = await sql<any[]>`
    select id::text,provider_post_id from marketing.meta_external_posts
    where platform=${conn.platform} and account_id=${conn.accountId} and is_deleted=false
    order by last_synced_at asc nulls first limit ${limit}
  `;
  let refreshed = 0;
  for (const row of candidates) {
    if (!hasTime(budget, SINGLE_REQUEST_HEADROOM_MS)) break;
    try {
      const fields = conn.platform === 'facebook'
        ? 'id,reactions.limit(0).summary(true),comments.limit(0).summary(true),shares'
        : 'id,like_count,comments_count';
      const payload = await metaGet(conn, clean(row.provider_post_id), { fields }, budget);
      const updates = conn.platform === 'facebook'
        ? { likes: numberOrNull(payload?.reactions?.summary?.total_count), comments: numberOrNull(payload?.comments?.summary?.total_count), shares: numberOrNull(payload?.shares?.count) }
        : { likes: numberOrNull(payload?.like_count), comments: numberOrNull(payload?.comments_count), shares: null };
      await sql`
        update marketing.meta_external_posts set
          likes_count=coalesce(${updates.likes},likes_count),
          comments_count=coalesce(${updates.comments},comments_count),
          shares_count=coalesce(${updates.shares},shares_count),
          last_synced_at=now(),sync_status='synced',sync_error=null,updated_at=now()
        where id=${row.id}::uuid
      `;
      refreshed += 1;
    } catch (error) {
      await sql`update marketing.meta_external_posts set sync_status='failed',sync_error=${normalizedError(error)},last_synced_at=now(),updated_at=now() where id=${row.id}::uuid`;
    }
  }
  return refreshed;
}

async function syncOne(sql: Sql, conn: MetaConnection, budget: SyncBudget) {
  const [state] = await sql<any[]>`
    insert into marketing.meta_sync_state(platform,account_id)
    values(${conn.platform},${conn.accountId})
    on conflict(platform,account_id) do update set account_id=excluded.account_id
    returning *
  `;
  let followers: number | null = null;
  let followersError = '';
  if (hasTime(budget, SINGLE_REQUEST_HEADROOM_MS)) {
    try { followers = await snapshotFollowers(sql, conn, budget); }
    catch (error) { followersError = normalizedError(error); }
  }
  let imported = 0;
  let olderRefreshed = 0;
  let recentUpdated = false;
  let backfillPage: { cursor: string; complete: boolean } | null = null;
  try {
    // First backfill page contains the recent posts already, avoiding duplicate
    // Graph reads and doubled writes on the initial synchronization.
    if (!state.backfill_complete && !clean(state.next_after)) {
      if (hasTime(budget, PAGE_START_HEADROOM_MS)) {
        const history = await importPage(sql, conn, '', BATCH_SIZE, false, budget);
        imported += history.imported;
        backfillPage = history;
        recentUpdated = true;
      }
    } else {
      if (hasTime(budget, PAGE_START_HEADROOM_MS)) {
        const recent = await importPage(sql, conn, '', RECENT_SIZE, true, budget);
        imported += recent.imported;
        recentUpdated = true;
      }
      if (!state.backfill_complete && hasTime(budget, PAGE_START_HEADROOM_MS)) {
        const history = await importPage(sql, conn, clean(state.next_after), BATCH_SIZE, false, budget);
        imported += history.imported;
        backfillPage = history;
      } else if (state.backfill_complete && hasTime(budget, SINGLE_REQUEST_HEADROOM_MS)) {
        olderRefreshed = await refreshOlderMetrics(sql, conn, budget);
      }
    }
    if (backfillPage) {
      await sql`
        update marketing.meta_sync_state set next_after=${backfillPage.cursor || null},backfill_complete=${backfillPage.complete},
          last_backfill_at=now(),last_recent_at=now(),last_success_at=now(),last_error=${followersError || null},updated_at=now()
        where platform=${conn.platform} and account_id=${conn.accountId}
      `;
    } else if (recentUpdated || olderRefreshed) {
      await sql`
        update marketing.meta_sync_state set last_recent_at=now(),last_success_at=now(),
          last_error=${followersError || null},updated_at=now()
        where platform=${conn.platform} and account_id=${conn.accountId}
      `;
    } else if (followersError) {
      await sql`update marketing.meta_sync_state set last_error=${followersError},updated_at=now() where platform=${conn.platform} and account_id=${conn.accountId}`;
    }
    return {
      platform: conn.platform, accountId: conn.accountId, imported, olderRefreshed, followers,
      followersError, backfillComplete: backfillPage?.complete ?? Boolean(state.backfill_complete),
      deferred: !recentUpdated && !olderRefreshed,
    };
  } catch (error) {
    const message = normalizedError(error);
    await sql`update marketing.meta_sync_state set last_error=${message},updated_at=now() where platform=${conn.platform} and account_id=${conn.accountId}`;
    return { platform: conn.platform, accountId: conn.accountId, imported, followers, backfillComplete: Boolean(state.backfill_complete), error: message };
  }
}

export type MetaSyncOptions = { scheduled?: boolean; runtimeBudgetMs?: number };

export async function syncMetaEngagement(sql: Sql, options: MetaSyncOptions = {}) {
  const startedAt = Date.now();
  if (options.scheduled) {
    // The full marketing migration runs hundreds of sequential DDL statements.
    // Never repeat it in a short-lived Cron invocation on every cold start.
    const [tables] = await sql<any[]>`
      select to_regclass('marketing.meta_external_posts') is not null as posts_ready,
             to_regclass('marketing.meta_sync_state') is not null as state_ready,
             to_regclass('marketing.meta_follower_snapshots') is not null as followers_ready
    `;
    if (!tables?.posts_ready || !tables?.state_ready || !tables?.followers_ready) {
      throw new Error('META_SYNC_SCHEMA_NOT_READY');
    }
  } else {
    await ensureMarketingSchema();
  }
  const acquired = await tryWithDatabaseAdvisoryLock('marketing:meta-engagement-sync', async () => {
    const accounts = await connections(sql);
    // Alternate which account goes first to prevent a slow account from
    // starving the other when the bounded job must defer the last phase.
    const offset = accounts.length ? Math.floor(Date.now() / 900000) % accounts.length : 0;
    const orderedAccounts = accounts.slice(offset).concat(accounts.slice(0, offset));
    const budget = { deadline: Date.now() + Math.min(SYNC_BUDGET_MS, Math.max(0, options.runtimeBudgetMs ?? SYNC_BUDGET_MS)) };
    const results = [];
    for (const conn of orderedAccounts) {
      if (!hasTime(budget, 2500)) break;
      results.push(await syncOne(sql, conn, budget));
    }
    return {
      ok: true, accounts: results, imported: results.reduce((sum, row) => sum + row.imported, 0),
      deferred: results.length < accounts.length || results.some((row) => row.deferred),
      elapsedMs: Date.now() - startedAt,
    };
  });
  return acquired.acquired
    ? acquired.result!
    : { ok: true, skipped: true, reason: 'META_SYNC_ALREADY_RUNNING', accounts: [], imported: 0, elapsedMs: Date.now() - startedAt };
}

export async function metaAccountData(sql: Sql) {
  const activeAccounts = await sql<any[]>`
    select platform,coalesce(nullif(case when platform='facebook' then page_id else ig_user_id end,''),account_id) as account_id,
           case when platform='facebook' then page_name else coalesce(username,account_name) end as account_name,
           connected,status from marketing.platform_connections where platform in ('facebook','instagram')
  `;
  const snapshots = await sql<any[]>`
    select platform,account_id,account_name,snapshot_date::text,followers_count,fan_count,media_count
    from marketing.meta_follower_snapshots order by snapshot_date asc
  `;
  const states = await sql<any[]>`
    select platform,account_id,backfill_complete,last_recent_at,last_backfill_at,last_success_at,last_error
    from marketing.meta_sync_state
  `;
  const discoveredCounts = await sql<any[]>`
    select platform,account_id,count(*)::integer as discovered_count
    from marketing.meta_external_posts where is_deleted=false
    group by platform,account_id
  `;
  return activeAccounts.map((account: any) => {
    const history = snapshots.filter((row: any) => row.platform === account.platform && row.account_id === account.account_id);
    const current = history[history.length - 1];
    const now = new Date();
    const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const monthly = history.filter((row: any) => clean(row.snapshot_date).startsWith(monthKey));
    const firstMonth = monthly[0];
    const previous = history.length > 1 ? history[history.length - 2] : null;
    return {
      platform: account.platform, accountId: account.account_id, accountName: clean(current?.account_name || account.account_name),
      connected: Boolean(account.connected), followers: current?.followers_count ?? null,
      discoveredCount: Number(discoveredCounts.find((row: any) => row.platform === account.platform && row.account_id === account.account_id)?.discovered_count || 0),
      fans: current?.fan_count ?? null, mediaCount: current?.media_count ?? null,
      dailyChange: current && previous ? Number(current.followers_count) - Number(previous.followers_count) : null,
      monthlyChange: monthly.length > 1 && firstMonth && current ? Number(current.followers_count) - Number(firstMonth.followers_count) : null,
      snapshots: history.map((row: any) => ({ date: row.snapshot_date, followers: Number(row.followers_count) })),
      state: states.find((row: any) => row.platform === account.platform && row.account_id === account.account_id) || null,
    };
  });
}

export async function externalMetaPosts(sql: Sql) {
  // Match already published system posts using a genuine provider id, media id or canonical permalink.
  // Their original schedule, campaign, reports, webhook and CRM paths remain untouched.
  return sql<any[]>`
    select mp.*,mp.id::text,mp.archived_by::text,mp.deleted_by::text,
      'meta'::text as source_type,'Meta مباشرة'::text as source_name,
      'منشور خارجي'::text as creative_name,'غير مرتبط بجدول النشر'::text as task_name,
      'meta'::text as publication_origin
    from marketing.meta_external_posts mp
    where mp.is_deleted=false
      and not exists (
        select 1 from marketing.published_posts pp
        where pp.platform=mp.platform and pp.account_id=mp.account_id
          and (
            (pp.provider_post_id is not null and pp.provider_post_id=mp.provider_post_id)
            or (pp.provider_media_id is not null and pp.provider_media_id in (mp.provider_post_id,mp.provider_media_id))
            or (pp.permalink is not null and mp.permalink is not null
                and trim(trailing '/' from pp.permalink)=trim(trailing '/' from mp.permalink))
          )
      )
    order by mp.published_at desc
  `;
}

export async function manageExternalMetaPost(sql: Sql, id: string, operation: string, userId: string) {
  const [row] = await sql<any[]>`select id::text from marketing.meta_external_posts where id=${id}::uuid and is_deleted=false`;
  if (!row) throw new Error('المنشور الخارجي غير موجود');
  if (operation === 'archive') {
    await sql`update marketing.meta_external_posts set archived_at=now(),archived_by=${userId}::uuid,updated_at=now() where id=${id}::uuid`;
    return { ok: true, message: 'تمت أرشفة المنشور الخارجي' };
  }
  if (operation === 'restore') {
    await sql`update marketing.meta_external_posts set archived_at=null,archived_by=null,updated_at=now() where id=${id}::uuid`;
    return { ok: true, message: 'تمت استعادة المنشور الخارجي' };
  }
  if (operation === 'delete') {
    await sql`update marketing.meta_external_posts set is_deleted=true,deleted_at=now(),deleted_by=${userId}::uuid,updated_at=now() where id=${id}::uuid`;
    return { ok: true, message: 'تم إخفاء المنشور الخارجي من تفاعل النشر دون حذفه من Meta' };
  }
  throw new Error('إجراء غير صالح للمنشور الخارجي');
}

export const metaSyncTestHelpers = { normalizePost, numberOrNull };
