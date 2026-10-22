/** Organic TikTok account analytics via the connected BulkPublish channel.
 * Paid advertisements are intentionally outside the followers dashboard.
 * Metrics are read from the provider, never inferred from TikTok Ads reports.
 */
import { getSql } from './_db.js';

type Sql = ReturnType<typeof getSql>;
const clean = (value: unknown) => String(value ?? '').trim();
const record = (value: unknown): Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const list = (value: unknown): any[] => Array.isArray(value) ? value : [];
const numberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && Number.isSafeInteger(n) ? n : null;
};
const validDate = (value: unknown): string | null => {
  const date = clean(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
};
function todayRiyadh() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const val = (part: string) => parts.find(p => p.type === part)?.value || '01';
  return `${val('year')}-${val('month')}-${val('day')}`;
}
function before(date: string, days: number) {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}

export function socialAnalyticsRange(query: Record<string, unknown>) {
  const today = todayRiyadh();
  const dateFrom = validDate(query.dateFrom) || before(today, 13);
  const dateTo = validDate(query.dateTo) || today;
  const duration = (Date.parse(dateTo) - Date.parse(dateFrom)) / 86400000;
  if (dateFrom > dateTo || duration > 365 || dateTo > today) throw new Error('فترة المتابعين غير صالحة');
  return { dateFrom, dateTo };
}

type TikTokChannel = { id: number; name: string };
export type TikTokOrganicAccount = TikTokChannel & {
  followers: number | null;
  monthlyChange: number | null;
  dailyChange: number | null;
  videoCount: number | null;
  likesCount: number | null;
  impressions: number | null;
  profileViews: number | null;
  lastDate: string | null;
  snapshots: Array<{ date: string; followers: number }>;
  topPost: { id: string; caption: string; permalink: string; publishedAt: string;
    likes: number | null; comments: number | null; shares: number | null; engagementTotal: number } | null;
};

type Cache<T> = { expires: number; value: T };
let channelCache: Cache<TikTokChannel[]> | null = null;
const apiCache = new Map<string, Cache<Record<string, any>>>();
async function providerGet(path: string, apiKey: string, refresh = false) {
  const cached = apiCache.get(path);
  if (!refresh && cached && cached.expires > Date.now()) return cached.value;
  const response = await fetch(`https://app.bulkpublish.com${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`BulkPublish (${response.status})`);
  const payload = record(await response.json());
  if (payload.error || payload.success === false) throw new Error('تعذر قراءة بيانات BulkPublish');
  apiCache.set(path, { expires: Date.now() + 5 * 60_000, value: payload });
  return payload;
}
async function connectedChannels(apiKey: string, refresh: boolean): Promise<TikTokChannel[]> {
  if (!refresh && channelCache && channelCache.expires > Date.now()) return channelCache.value;
  const response = await providerGet('/api/channels', apiKey, refresh);
  const channels = list(response.channels || response.data)
    .filter((channel) => clean(channel.platform).toLowerCase() === 'tiktok'
      && channel.isActive === true && channel.needsReconnect !== true)
    .map(channel => ({ id: Number(channel.id), name: clean(channel.accountName || channel.name || `TikTok ${channel.id}`) }))
    .filter(channel => Number.isSafeInteger(channel.id) && channel.id > 0);
  channelCache = { expires: Date.now() + 5 * 60_000, value: channels };
  return channels;
}

function normalizeSnapshots(payload: Record<string, any>, channelId: number) {
  const metrics = list(payload.metrics || record(payload.data).metrics);
  const byDate = new Map<string, { date: string; followers: number }>();
  for (const raw of metrics) {
    const m = record(raw);
    if (Number(m.channelId) !== channelId || clean(m.platform).toLowerCase() !== 'tiktok') continue;
    const date = validDate(m.date);
    const followers = numberOrNull(m.followers);
    if (date && followers !== null) byDate.set(date, { date, followers });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Only use actual provider metric values: unavailable fields stay null. */
function normalizeTopPost(payload: Record<string, any>) {
  const data = record(payload.data);
  const candidates = list(payload.topPosts || payload.rankedPosts || payload.posts || data.topPosts || data.rankedPosts || data.posts);
  const ranked = candidates.flatMap(raw => {
    const p = record(raw), post = record(p.post);
    const metrics = record(p.metrics || p.latest || record(p.platforms?.[0]).latest || p);
    const likes = numberOrNull(metrics.likes ?? metrics.likesCount);
    const comments = numberOrNull(metrics.comments ?? metrics.commentsCount);
    const shares = numberOrNull(metrics.shares ?? metrics.sharesCount);
    const explicit = numberOrNull(p.engagementTotal ?? p.totalEngagement ?? metrics.engagementTotal);
    if (likes === null && comments === null && shares === null && explicit === null) return [];
    const engagementTotal = explicit ?? (likes || 0) + (comments || 0) + (shares || 0);
    return [{ id: clean(p.postId || p.id || post.id), caption: clean(p.content || p.caption || post.content),
      permalink: clean(p.permalink || p.url || post.permalink || post.url),
      publishedAt: clean(p.publishedAt || post.publishedAt || p.date), likes, comments, shares, engagementTotal }];
  });
  ranked.sort((a, b) => b.engagementTotal - a.engagementTotal);
  return ranked[0] || null;
}

async function loadHistory(sql: Sql, channelId: number, from: string, to: string) {
  const rows = await sql<any[]>`
    select snapshot_date::text as date,followers
    from marketing.social_follower_snapshots
    where platform='tiktok' and channel_id=${channelId} and snapshot_date between ${from}::date and ${to}::date
    order by snapshot_date asc`;
  return rows.map(row => ({ date: String(row.date).slice(0, 10), followers: Number(row.followers) }));
}

async function saveProviderSnapshots(sql: Sql, channel: TikTokChannel, snapshots: Array<{date:string;followers:number}>) {
  if (!snapshots.length) return;
  const batch = snapshots.map(row => ({ date: row.date, followers: row.followers }));
  await sql`
    insert into marketing.social_follower_snapshots(platform,channel_id,account_name,snapshot_date,followers)
    select 'tiktok',${channel.id},${channel.name},snap.date::date,snap.followers
    from jsonb_to_recordset(${sql.json(batch)}::jsonb) as snap(date text,followers bigint)
    on conflict(platform,channel_id,snapshot_date) do update
      set followers=excluded.followers,account_name=excluded.account_name,updated_at=now()`;
}

function dayDelta(rows: Array<{date:string;followers:number}>) {
  if (rows.length < 2) return null;
  const last = rows.at(-1)!, previous = rows[rows.length - 2];
  if (before(last.date, 1) !== previous.date) return null;
  return last.followers - previous.followers;
}

async function organicTikTokAccounts(sql: Sql, query: Record<string, unknown>) {
  const apiKey = clean(process.env.BULKPUBLISH_API_KEY);
  if (!apiKey) return { connected: false, accounts: [] as TikTokOrganicAccount[] };
  const refresh = query.refresh === '1';
  const { dateFrom, dateTo } = socialAnalyticsRange(query);
  const channels = await connectedChannels(apiKey, refresh);
  const accounts = await Promise.all(channels.slice(0, 8).map(async channel => {
    const from = dateFrom < before(dateTo, 29) ? before(dateTo, 29) : dateFrom;
    const params = new URLSearchParams({ channelIds: String(channel.id), platforms: 'tiktok', from, to: dateTo });
    // The same no-date request was verified against this connected account.
    // Prefer the date range; preserve basic counts when a provider plan does not accept it.
    const metricsRequest = async () => {
      try { return await providerGet(`/api/analytics/account?${params.toString()}`, apiKey, refresh); }
      catch { return providerGet(`/api/analytics/account?channelIds=${channel.id}&platforms=tiktok`, apiKey, refresh); }
    };
    const [metricResponse, engagementResponse] = await Promise.allSettled([
      metricsRequest(),
      providerGet(`/api/analytics/engagement?${params.toString()}`, apiKey, refresh),
    ]);
    const payload = metricResponse.status === 'fulfilled' ? metricResponse.value : {};
    const snapshots = normalizeSnapshots(payload, channel.id);
    const latest = snapshots.at(-1);
    const selectedLatest = [...snapshots].reverse().find(row => row.date >= dateFrom && row.date <= dateTo);
    const lastMetric = [...list(payload.metrics || record(payload.data).metrics)].reverse().find(m => Number(m?.channelId) === channel.id && m?.date === selectedLatest?.date);
    const p = record(lastMetric), specific = record(p.platformSpecific);
    if (snapshots.length) await saveProviderSnapshots(sql, channel, snapshots);
    const history = await loadHistory(sql, channel.id, dateFrom, dateTo);
    const referenceDate = history.at(-1)?.date || latest?.date || dateTo;
    const currentMonthFrom = `${referenceDate.slice(0,7)}-01`;
    const monthHistory = await loadHistory(sql, channel.id, currentMonthFrom, referenceDate);
    return {
      id: channel.id, name: clean(list(payload.channels).find(c => Number(c?.id) === channel.id)?.accountName) || channel.name,
      followers: history.at(-1)?.followers ?? selectedLatest?.followers ?? null,
      monthlyChange: monthHistory.length > 1 ? monthHistory.at(-1)!.followers - monthHistory[0].followers : null,
      dailyChange: dayDelta(history),
      videoCount: numberOrNull(specific.videoCount),
      likesCount: numberOrNull(specific.likesCount),
      impressions: numberOrNull(p.impressions),
      profileViews: numberOrNull(p.profileViews),
      lastDate: history.at(-1)?.date || selectedLatest?.date || null,
      snapshots: history,
      topPost: engagementResponse.status === 'fulfilled' ? normalizeTopPost(engagementResponse.value) : null,
    } satisfies TikTokOrganicAccount;
  }));
  return { connected: channels.length > 0, accounts };
}

export async function marketingSocialAccountsOverview(sql: Sql, query: Record<string, unknown> = {}) {
  const tiktok = await organicTikTokAccounts(sql, query);
  return { ok: true, tiktok };
}
