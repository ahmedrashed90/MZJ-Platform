/**
 * Meta account/post discovery. It deliberately does NOT insert into published_posts
 * or post_engagements: those tables drive the existing schedule and CRM workflows.
 */
import { getSql, withDatabaseAdvisoryLock } from './_db.js';
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

const BATCH_SIZE = 70;
const RECENT_SIZE = 15;
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

async function metaGet(conn: MetaConnection, path: string, params: Record<string, string | number | undefined> = {}) {
  const host = conn.host === 'instagram' ? 'graph.instagram.com' : 'graph.facebook.com';
  const url = new URL(`https://${host}/${version()}/${path.replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${conn.token}` },
    signal: AbortSignal.timeout(12000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    const error = data?.error || {};
    const message = clean(error.error_user_msg || error.message) || `Meta HTTP ${response.status}`;
    throw new Error(`${message} (${numberOrNull(error.code) ?? response.status})`);
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

async function snapshotFollowers(sql: Sql, conn: MetaConnection) {
  const fields = conn.platform === 'facebook'
    ? 'id,name,followers_count,fan_count'
    : 'id,username,followers_count,media_count';
  const payload = await metaGet(conn, conn.accountId, { fields });
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

async function listPosts(conn: MetaConnection, after: string, limit: number) {
  const fields = conn.platform === 'facebook'
    ? 'id,message,created_time,permalink_url,attachments{media_type,target},reactions.limit(0).summary(true),comments.limit(0).summary(true),shares'
    : 'id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count';
  const edge = conn.platform === 'facebook' ? 'posts' : 'media';
  const params = { fields, limit, after: after || undefined };
  try {
    const response = await metaGet(conn, `${conn.accountId}/${edge}`, params);
    return { response, detailed: true };
  } catch (error) {
    // A few legacy posts/media types reject expanded fields; fall back to tested public fields.
    const fallbackFields = conn.platform === 'facebook'
      ? 'id,message,created_time,permalink_url'
      : 'id,caption,media_type,timestamp,permalink,like_count,comments_count';
    return {
      response: await metaGet(conn, `${conn.accountId}/${edge}`, { ...params, fields: fallbackFields }),
      detailed: conn.platform === 'instagram',
    };
  }
}

async function enrichFacebookCount(conn: MetaConnection, row: any): Promise<any> {
  // Only used when Page/posts rejected expanded fields.
  try {
    const payload = await metaGet(conn, clean(row.id), {
      fields: 'id,reactions.limit(0).summary(true),comments.limit(0).summary(true),shares',
    });
    return { ...row, ...payload };
  } catch {
    return row; // unknown metrics are null, never silently zeroed
  }
}

async function enrichRecentInstagramInsights(conn: MetaConnection, record: DiscoveredPost) {
  if (conn.platform !== 'instagram') return record;
  try {
    const payload = await metaGet(conn, `${record.providerId}/insights`, {
      metric: 'reach,views,saved,shares',
    });
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

async function savePost(sql: Sql, record: DiscoveredPost) {
  // External posts never generate post_engagements or CRM leads automatically.
  await sql`
    insert into marketing.meta_external_posts(
      platform,account_id,provider_post_id,provider_media_id,caption,permalink,post_type_name,published_at,
      likes_count,comments_count,shares_count,saves_count,views_count,reach_count,
      sync_status,last_synced_at
    ) values(
      ${record.platform},${record.accountId},${record.providerId},${record.providerMediaId},${record.caption},
      ${record.permalink || null},${record.postType},${record.publishedAt}::timestamptz,
      ${record.likes},${record.comments},${record.shares},${record.saves},${record.views},${record.reach},'synced',now()
    ) on conflict(platform,account_id,provider_post_id) do update set
      caption=excluded.caption,provider_media_id=excluded.provider_media_id,permalink=coalesce(excluded.permalink,marketing.meta_external_posts.permalink),
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

async function importPage(sql: Sql, conn: MetaConnection, after: string, limit: number, insights: boolean) {
  const { response, detailed } = await listPosts(conn, after, limit);
  const incoming = asArray(response?.data);
  let imported = 0;
  for (const raw of incoming) {
    let row = raw;
    if (conn.platform === 'facebook' && !detailed && imported < 5) row = await enrichFacebookCount(conn, raw);
    const record = normalizePost(conn.platform, conn.accountId, row);
    if (!record) continue;
    if (insights && conn.platform === 'instagram' && imported < 5) {
      await enrichRecentInstagramInsights(conn, record);
    }
    await savePost(sql, record);
    imported += 1;
  }
  const cursor = clean(response?.paging?.cursors?.after);
  const hasNext = Boolean(response?.paging?.next && cursor && cursor !== after);
  return { imported, cursor: hasNext ? cursor : '', complete: !hasNext };
}

// Rotate through older media in small batches after backfill completes. This keeps
// historical engagement fresh without loading thousands of posts every 15 minutes.
async function refreshOlderMetrics(sql: Sql, conn: MetaConnection, limit = 8) {
  const candidates = await sql<any[]>`
    select id::text,provider_post_id from marketing.meta_external_posts
    where platform=${conn.platform} and account_id=${conn.accountId} and is_deleted=false
    order by last_synced_at asc nulls first limit ${limit}
  `;
  let refreshed = 0;
  for (const row of candidates) {
    try {
      const fields = conn.platform === 'facebook'
        ? 'id,reactions.limit(0).summary(true),comments.limit(0).summary(true),shares'
        : 'id,like_count,comments_count';
      const payload = await metaGet(conn, clean(row.provider_post_id), { fields });
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

async function syncOne(sql: Sql, conn: MetaConnection) {
  const [state] = await sql<any[]>`
    insert into marketing.meta_sync_state(platform,account_id)
    values(${conn.platform},${conn.accountId})
    on conflict(platform,account_id) do update set account_id=excluded.account_id
    returning *
  `;
  let followers: number | null = null;
  let followersError = '';
  try { followers = await snapshotFollowers(sql, conn); }
  catch (error) { followersError = normalizedError(error); }
  let imported = 0;
  try {
    const recent = await importPage(sql, conn, '', RECENT_SIZE, true);
    imported += recent.imported;
    // Backfill cursor is stored, so every run advances one bounded historical page.
    if (!state.backfill_complete) {
      const history = await importPage(sql, conn, clean(state.next_after), BATCH_SIZE, false);
      imported += history.imported;
      await sql`
        update marketing.meta_sync_state set next_after=${history.cursor || null},backfill_complete=${history.complete},
          last_backfill_at=now(),last_recent_at=now(),last_success_at=now(),last_error=${followersError || null},updated_at=now()
        where platform=${conn.platform} and account_id=${conn.accountId}
      `;
      return { platform: conn.platform, accountId: conn.accountId, imported, followers, followersError, backfillComplete: history.complete };
    }
    const olderRefreshed = await refreshOlderMetrics(sql, conn);
    await sql`
      update marketing.meta_sync_state set last_recent_at=now(),last_success_at=now(),
        last_error=${followersError || null},updated_at=now()
      where platform=${conn.platform} and account_id=${conn.accountId}
    `;
    return { platform: conn.platform, accountId: conn.accountId, imported, olderRefreshed, followers, followersError, backfillComplete: true };
  } catch (error) {
    const message = normalizedError(error);
    await sql`update marketing.meta_sync_state set last_error=${message},updated_at=now() where platform=${conn.platform} and account_id=${conn.accountId}`;
    return { platform: conn.platform, accountId: conn.accountId, imported, followers, backfillComplete: Boolean(state.backfill_complete), error: message };
  }
}

export async function syncMetaEngagement(sql: Sql) {
  await ensureMarketingSchema();
  return withDatabaseAdvisoryLock('marketing:meta-engagement-sync', async () => {
    const accounts = await connections(sql);
    const results = [];
    for (const conn of accounts) results.push(await syncOne(sql, conn));
    return { ok: true, accounts: results, imported: results.reduce((sum, r) => sum + r.imported, 0) };
  });
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
