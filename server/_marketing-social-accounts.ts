/** Read-only, per-account organic analytics from BulkPublish.
 * Snapchat and TikTok share the same provider but never share ad campaign data.
 * A transient provider/DB failure must not disconnect accounts or erase last
 * successfully observed metrics. Unknown fields stay null, never invented.
 */
import { getSql } from './_db.js';

type Sql = ReturnType<typeof getSql>;
export type OrganicPlatform = 'tiktok' | 'snapchat';
type Channel = { id: number; name: string; platform: OrganicPlatform; connected: boolean; reconnect: boolean };
type Snapshot = { date: string; followers: number };
export type OrganicAccount = {
  id: number; name: string; connected: boolean; reconnect: boolean; stale: boolean; note: string;
  followers: number | null; monthlyChange: number | null; dailyChange: number | null;
  videoCount: number | null; likesCount: number | null; impressions: number | null;
  profileViews: number | null; views: number | null; reach: number | null;
  lastDate: string | null; snapshots: Snapshot[];
  topPost: { id: string; caption: string; permalink: string; publishedAt: string;
    likes: number | null; comments: number | null; shares: number | null; engagementTotal: number } | null;
};
const clean = (v: unknown) => String(v ?? '').trim();
const obj = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
const arr = (v: unknown): any[] => Array.isArray(v) ? v : [];
const metric = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};
const dateValue = (v: unknown): string | null => {
  const date = clean(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
};
function riyadhToday() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (p: string) => parts.find(x => x.type === p)?.value || '01';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function daysBefore(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
export function socialAnalyticsRange(query: Record<string, unknown>) {
  const today = riyadhToday();
  const dateFrom = dateValue(query.dateFrom) || daysBefore(today, 13);
  const dateTo = dateValue(query.dateTo) || today;
  const duration = (Date.parse(dateTo) - Date.parse(dateFrom)) / 86400000;
  if (dateFrom > dateTo || duration > 365 || dateTo > today) throw new Error('فترة المتابعين غير صالحة');
  return { dateFrom, dateTo };
}

type Entry<T> = { expires: number; value: T };
let cacheIdentity = '';
let channelsCache: Entry<Channel[]> | null = null;
const providerCache = new Map<string, Entry<Record<string, any>>>();
const latestAccounts = new Map<string, OrganicAccount>();
const cacheTTL = 10 * 60_000; // BulkPublish Free: 30 API calls/day, avoid refresh storms.
function credential() {
  const key = clean(process.env.BULKPUBLISH_API_KEY);
  // Rotating the key must not accidentally reuse results authenticated by the previous one.
  if (key !== cacheIdentity) { cacheIdentity = key; channelsCache = null; providerCache.clear(); latestAccounts.clear(); }
  return key;
}
async function get(path: string, apiKey: string, force = false): Promise<Record<string, any>> {
  const old = providerCache.get(path);
  if (old && old.expires > Date.now()) return old.value; // Manual refresh honors the cache to protect API quota.
  const response = await fetch(`https://app.bulkpublish.com${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    redirect: 'manual', signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`BulkPublish HTTP ${response.status}`);
  const payload = obj(await response.json());
  if (payload.error || payload.success === false) throw new Error('BulkPublish لم يرجع إحصائيات صالحة');
  providerCache.set(path, { expires: Date.now() + cacheTTL, value: payload });
  if (providerCache.size > 64) providerCache.delete(providerCache.keys().next().value!);
  return payload;
}
function platformOf(value: unknown): OrganicPlatform | null {
  const platform = clean(value).toLowerCase();
  return platform === 'tiktok' || platform === 'snapchat' ? platform : null;
}
async function storedChannels(sql: Sql): Promise<Channel[]> {
  try {
    // Serverless cold starts have no in-memory cache. Keep saved accounts visible
    // if BulkPublish's channel-list endpoint is temporarily unavailable.
    const rows = await sql<any[]>`
      select distinct on (platform,channel_id) platform,channel_id,account_name
      from marketing.social_follower_snapshots
      where platform in ('tiktok','snapchat')
      order by platform,channel_id,snapshot_date desc`;
    return rows.flatMap(row => {
      const platform = platformOf(row.platform), id = Number(row.channel_id);
      return platform && Number.isSafeInteger(id) && id > 0 ? [{ platform, id,
        name: clean(row.account_name) || `${platform} ${id}`, connected: false, reconnect: false }] : [];
    });
  } catch { return []; }
}
async function listChannels(key: string, force: boolean): Promise<{ channels: Channel[]; warning: string }> {
  try {
    if (channelsCache && channelsCache.expires > Date.now()) return { channels: channelsCache.value, warning: '' };
    const payload = await get('/api/channels', key, force);
    const items = arr(payload.channels || payload.data);
    if (!Array.isArray(payload.channels) && !Array.isArray(payload.data)) throw new Error('BulkPublish لم يرجع قائمة الحسابات');
    const channels: Channel[] = items.flatMap(raw => {
      const c = obj(raw); const platform = platformOf(c.platform); const id = Number(c.id);
      if (!platform || !Number.isSafeInteger(id) || id <= 0) return [];
      const reconnect = c.needsReconnect === true;
      return [{ id, platform, name: clean(c.accountName || c.name || `${platform} ${id}`),
        connected: c.isActive === true && !reconnect, reconnect }];
    });
    channelsCache = { value: channels, expires: Date.now() + cacheTTL };
    return { channels, warning: '' };
  } catch (error) {
    const warning = `تعذر تحديث قائمة حسابات BulkPublish (${error instanceof Error ? error.message : 'فشل الاتصال'}).`;
    if (channelsCache) return { channels: channelsCache.value, warning };
    return { channels: [], warning };
  }
}
function metricsRows(payload: Record<string, any>) { return arr(payload.metrics || obj(payload.data).metrics); }
function snapshotsFrom(payload: Record<string, any>, channel: Channel): Snapshot[] {
  const observed = new Map<string, Snapshot>();
  for (const row of metricsRows(payload)) {
    const m = obj(row), id = Number(m.channelId), platform = platformOf(m.platform);
    if (id !== channel.id || (platform && platform !== channel.platform)) continue;
    const date = dateValue(m.date), followers = metric(m.followers);
    if (date && followers !== null) observed.set(date, { date, followers });
  }
  return [...observed.values()].sort((a, b) => a.date.localeCompare(b.date));
}
function topPost(payload: Record<string, any>, channel: Channel) {
  const data = obj(payload.data);
  const items = arr(payload.topPosts || payload.rankedPosts || payload.posts || data.topPosts || data.rankedPosts || data.posts);
  const ranked = items.flatMap(raw => {
    const p = obj(raw), post = obj(p.post);
    if (p.channelId != null && Number(p.channelId) !== channel.id) return [];
    if (platformOf(p.platform) && platformOf(p.platform) !== channel.platform) return [];
    const details = obj(p.metrics || p.latest || obj(arr(p.platforms)[0]).latest || p);
    const likes = metric(details.likes ?? details.likesCount);
    const comments = metric(details.comments ?? details.commentsCount);
    const shares = metric(details.shares ?? details.sharesCount);
    const explicit = metric(p.engagementTotal ?? p.totalEngagement ?? details.engagementTotal);
    if ([likes, comments, shares, explicit].every(x => x === null)) return [];
    return [{ id: clean(p.postId || p.id || post.id), caption: clean(p.content || p.caption || post.content),
      permalink: clean(p.permalink || p.url || post.permalink || post.url),
      publishedAt: clean(p.publishedAt || post.publishedAt || p.date),
      likes, comments, shares, engagementTotal: explicit ?? (likes || 0) + (comments || 0) + (shares || 0) }];
  });
  return ranked.sort((a, b) => b.engagementTotal - a.engagementTotal)[0] || null;
}
function dayChange(rows: Snapshot[]) {
  if (rows.length < 2) return null;
  const last = rows.at(-1)!, prev = rows[rows.length - 2];
  return daysBefore(last.date, 1) === prev.date ? last.followers - prev.followers : null;
}
function unavailableTable(error: unknown) {
  const code = clean(obj(error).code);
  return ['42P01','3F000','42703'].includes(code) || /social_follower_snapshots|relation .* does not exist/i.test(clean(obj(error).message));
}
async function history(sql: Sql, channel: Channel, from: string, to: string): Promise<Snapshot[] | null> {
  try {
    const rows = await sql<any[]>`
      select snapshot_date::text as date,followers
      from marketing.social_follower_snapshots
      where platform=${channel.platform} and channel_id=${channel.id} and snapshot_date between ${from}::date and ${to}::date
      order by snapshot_date asc`;
    return rows.map(row => ({ date: clean(row.date).slice(0, 10), followers: Number(row.followers) }));
  } catch (error) {
    if (unavailableTable(error)) return null; // Existing deployment may not have run the migration yet.
    throw error;
  }
}
async function store(sql: Sql, channel: Channel, snapshots: Snapshot[]) {
  if (!snapshots.length) return;
  try {
    await sql`
      insert into marketing.social_follower_snapshots(platform,channel_id,account_name,snapshot_date,followers)
      select ${channel.platform},${channel.id},${channel.name},snap.date::date,snap.followers
      from jsonb_to_recordset(${sql.json(snapshots)}::jsonb) as snap(date text,followers bigint)
      on conflict(platform,channel_id,snapshot_date) do update
        set followers=excluded.followers,account_name=excluded.account_name,updated_at=now()`;
  } catch (error) {
    if (!unavailableTable(error) && clean(obj(error).code) !== '23514') throw error;
    // Missing migration or old CHECK constraint must not disconnect an account.
  }
}
async function oneAccount(sql: Sql, channel: Channel, from: string, to: string, force: boolean): Promise<OrganicAccount> {
  const cacheKey = `${channel.platform}:${channel.id}`;
  const previous = latestAccounts.get(cacheKey);
  const localFrom = from < daysBefore(to, 29) ? daysBefore(to, 29) : from;
  const query = new URLSearchParams({ channelIds: String(channel.id), platforms: channel.platform, from: localFrom, to });
  let payload: Record<string, any> | null = null;
  let warning = '';
  if (channel.connected) {
    try {
      // Some BulkPublish subscriptions accept channelIds but not date filters.
      try { payload = await get(`/api/analytics/account?${query}`, cacheIdentity, force); }
      catch { payload = await get(`/api/analytics/account?channelIds=${channel.id}&platforms=${channel.platform}`, cacheIdentity, force); }
    } catch (error) {
      warning = `تعذر تحديث إحصائيات الحساب (${error instanceof Error ? error.message : 'فشل الاتصال'}).`;
    }
  } else warning = channel.reconnect ? 'الحساب يحتاج إعادة ربط داخل BulkPublish.' : 'حالة القناة غير نشطة داخل BulkPublish.';

  const remote = payload ? snapshotsFrom(payload, channel) : [];
  if (remote.length) { try { await store(sql, channel, remote); } catch { warning += ' تعذر حفظ التاريخ.'; } }
  let stored: Snapshot[] | null = null;
  try {
    stored = await history(sql, channel, from, to);
    if (stored === null) warning += ' سجل المتابعين يحتاج تشغيل ترحيل قاعدة البيانات.';
  } catch { warning += ' تعذر قراءة سجل المتابعين.'; }
  const fromProvider = remote.filter(x => x.date >= from && x.date <= to);
  const snapshots = stored?.length ? stored : fromProvider;
  const mostRecent = snapshots.at(-1) || null;
  const selected = remote.filter(x => x.date >= from && x.date <= to).at(-1);
  // Post/account performance may exist even when the provider has no follower count (Snapchat).
  const raw = metricsRows(payload || {}).filter(m => Number(m?.channelId) === channel.id &&
    (!platformOf(m?.platform) || platformOf(m?.platform) === channel.platform) &&
    dateValue(m?.date) !== null && dateValue(m?.date)! >= from && dateValue(m?.date)! <= to)
    .sort((a, b) => String(a.date).localeCompare(String(b.date))).at(-1);
  const m = obj(raw), specific = obj(m.platformSpecific);
  const monthStart = `${(mostRecent?.date || to).slice(0, 7)}-01`;
  let monthly = snapshots.filter(x => x.date >= monthStart);
  if (stored) {
    try { monthly = await history(sql, channel, monthStart, mostRecent?.date || to) || monthly; }
    catch { /* use available snapshots */ }
  }
  let post = previous?.topPost || null;
  if (channel.connected) {
    try { post = topPost(await get(`/api/analytics/engagement?${query}`, cacheIdentity, force), channel); }
    catch { /* Optional endpoint must never hide the account itself. */ }
  }
  const fallbackAllowed = !!previous && previous.lastDate !== null && previous.lastDate >= from && previous.lastDate <= to;
  const account: OrganicAccount = {
    id: channel.id, name: clean(arr(payload?.channels).find(c => Number(c?.id) === channel.id)?.accountName) || channel.name,
    connected: channel.connected, reconnect: channel.reconnect, stale: payload === null || (!remote.length && fallbackAllowed), note: warning,
    followers: mostRecent?.followers ?? (fallbackAllowed ? previous!.followers : null),
    monthlyChange: monthly.length > 1 ? monthly.at(-1)!.followers - monthly[0].followers : (fallbackAllowed ? previous!.monthlyChange : null),
    dailyChange: dayChange(snapshots),
    videoCount: metric(specific.videoCount ?? specific.spotlightCount ?? m.videoCount),
    likesCount: metric(specific.likesCount ?? m.likesCount),
    impressions: metric(m.impressions), profileViews: metric(m.profileViews),
    views: metric(m.videoViews ?? m.views), reach: metric(m.reach),
    lastDate: mostRecent?.date || (fallbackAllowed ? previous!.lastDate : null), snapshots: snapshots.length ? snapshots : (fallbackAllowed ? previous!.snapshots.filter(x => x.date >= from && x.date <= to) : []),
    topPost: post,
  };
  // If refreshing failed, preserve the previous metrics rather than repainting them as missing.
  if ((payload === null || !remote.length) && fallbackAllowed) {
    account.videoCount = previous!.videoCount; account.likesCount = previous!.likesCount;
    account.impressions = previous!.impressions; account.profileViews = previous!.profileViews;
    account.views = previous!.views; account.reach = previous!.reach;
    account.dailyChange = dayChange(account.snapshots);
  }
  latestAccounts.set(cacheKey, account);
  return account;
}
export async function marketingSocialAccountsOverview(sql: Sql, query: Record<string, unknown> = {}) {
  const key = credential();
  const { dateFrom, dateTo } = socialAnalyticsRange(query);
  const empty = { connected: false, accounts: [] as OrganicAccount[], note: '' };
  if (!key) return { ok: true as const, tiktok: { ...empty, note: 'اضبط BULKPUBLISH_API_KEY على السيرفر.' }, snapchat: { ...empty, note: 'اضبط BULKPUBLISH_API_KEY على السيرفر.' } };
  const refreshed = query.refresh === '1';
  const fetched = await listChannels(key, refreshed);
  const channels = fetched.warning && !fetched.channels.length ? await storedChannels(sql) : fetched.channels;
  const warning = fetched.warning;
  const forPlatform = async (platform: OrganicPlatform) => {
    const selected = channels.filter(c => c.platform === platform).slice(0, 8);
    const accounts = await Promise.all(selected.map(async channel => {
      try { return await oneAccount(sql, channel, dateFrom, dateTo, refreshed); }
      catch (error) {
        const cached = latestAccounts.get(`${channel.platform}:${channel.id}`);
        if (cached) return { ...cached, connected: channel.connected, reconnect: channel.reconnect, stale: true,
          note: 'تعذر التحديث؛ يتم عرض آخر بيانات ناجحة للحساب.' };
        return { id: channel.id, name: channel.name, connected: channel.connected, reconnect: channel.reconnect, stale: true,
          note: error instanceof Error ? error.message.slice(0, 150) : 'تعذر قراءة إحصائيات الحساب',
          followers: null, monthlyChange: null, dailyChange: null, videoCount: null, likesCount: null,
          impressions: null, profileViews: null, views: null, reach: null, lastDate: null, snapshots: [], topPost: null } as OrganicAccount;
      }
    }));
    if (warning) for (const account of accounts) {
      account.stale = true;
      account.note = [account.note, warning].filter(Boolean).join(' ');
    }
    return { connected: accounts.some(a => a.connected), accounts,
      note: warning || (!accounts.length ? `لم يتم العثور على حساب ${platform === 'tiktok' ? 'TikTok' : 'Snapchat'} مرتبط داخل BulkPublish.` : '') };
  };
  const [tiktok, snapchat] = await Promise.all([forPlatform('tiktok'), forPlatform('snapchat')]);
  return { ok: true as const, tiktok, snapchat };
}
