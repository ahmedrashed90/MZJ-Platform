/** Read-only, per-account organic analytics from BulkPublish.
 * TikTok uses the existing BULKPUBLISH_API_KEY and publishing channel.
 * Snapchat uses ONLY BULKPUBLISH_SNAPCHAT_API_KEY (optional channel selector).
 * Each credential owns its channel discovery, analytics and 429 quota state.
 * Failed reads must not disconnect accounts or erase their last verified metrics.
 */
import { getSql } from './_db.js';
import { cachedBulkPublishRead } from './_marketing-bulkpublish-read-cache.js';

type Sql = ReturnType<typeof getSql>;
export type OrganicPlatform = 'tiktok' | 'snapchat';
type Channel = { id: number; name: string; platform: OrganicPlatform; connected: boolean; reconnect: boolean; verified: boolean };
type Snapshot = { date: string; followers: number };
export type OrganicAccount = {
  id: number; name: string; connected: boolean; reconnect: boolean; connectionVerified: boolean; stale: boolean; note: string;
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

const latestAccounts = new Map<string, OrganicAccount>();
const organicKeyIdentity: Record<OrganicPlatform, string> = { tiktok: '', snapchat: '' };
/** Never fall back from Snapchat to TikTok's API key. */
function credential(platform: OrganicPlatform): string {
  const key = clean(platform === 'tiktok' ? process.env.BULKPUBLISH_API_KEY : process.env.BULKPUBLISH_SNAPCHAT_API_KEY);
  if (key !== organicKeyIdentity[platform]) {
    organicKeyIdentity[platform] = key;
    for (const cacheKey of latestAccounts.keys()) {
      if (cacheKey.startsWith(`${platform}:`)) latestAccounts.delete(cacheKey);
    }
  }
  return key;
}
function configuredChannelId(platform: OrganicPlatform): number | null {
  if (platform !== 'snapchat') return null; // Keep TikTok read behavior unchanged.
  const raw = clean(process.env.BULKPUBLISH_SNAPCHAT_CHANNEL_ID);
  if (!raw) return null; // Automatically discover Snapchat channels under its own key.
  const id = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(id) || id < 1) {
    throw new Error('BULKPUBLISH_SNAPCHAT_CHANNEL_ID غير صالح؛ استخدم معرّف قناة Snapchat الرقمي فقط.');
  }
  return id;
}
function platformOf(value: unknown): OrganicPlatform | null {
  const platform = clean(value).toLowerCase();
  return platform === 'tiktok' || platform === 'snapchat' ? platform : null;
}
async function storedChannels(sql: Sql, platform: OrganicPlatform, channelId: number | null): Promise<Channel[]> {
  try {
    // Cold Vercel instances can still show previously recorded followers when
    // this platform's own API key is temporarily throttled (not the other key).
    const rows = await sql<any[]>`
      select distinct on (platform,channel_id) platform,channel_id,account_name
      from marketing.social_follower_snapshots
      where platform=${platform}
      order by platform,channel_id,snapshot_date desc`;
    return rows.flatMap(row => {
      const found = platformOf(row.platform), id = Number(row.channel_id);
      return found === platform && Number.isSafeInteger(id) && id > 0 && (channelId === null || id === channelId)
        ? [{ platform, id, name: clean(row.account_name) || `${platform} ${id}`,
          connected: false, reconnect: false, verified: false }] : [];
    });
  } catch { return []; }
}
async function listChannels(sql: Sql, key: string, platform: OrganicPlatform, channelId: number | null): Promise<{ channels: Channel[]; warning: string }> {
  try {
    const read = await cachedBulkPublishRead(sql, key, '/api/channels');
    const payload = read.payload;
    const items = arr(payload.channels || payload.data);
    if (!Array.isArray(payload.channels) && !Array.isArray(payload.data)) throw new Error('BulkPublish لم يرجع قائمة الحسابات');
    // An API key can belong to a different BulkPublish organisation. Never
    // infer a Snapchat connection from the TikTok key's channels (or vice versa).
    const channels: Channel[] = items.flatMap(raw => {
      const c = obj(raw), actualPlatform = platformOf(c.platform), id = Number(c.id);
      if (actualPlatform !== platform || !Number.isSafeInteger(id) || id <= 0 || (channelId !== null && channelId !== id)) return [];
      const reconnect = c.needsReconnect === true;
      return [{ id, platform, name: clean(c.accountName || c.name || `${platform} ${id}`),
        connected: c.isActive === true && !reconnect, reconnect, verified: true }];
    });
    return { channels, warning: read.warning };
  } catch (error) {
    return { channels: [], warning: `تعذر التحقق من قائمة ${platform === 'snapchat' ? 'Snapchat' : 'TikTok'} في BulkPublish (${error instanceof Error ? error.message : 'فشل الاتصال'}).` };
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
async function oneAccount(sql: Sql, channel: Channel, from: string, to: string, apiKey: string): Promise<OrganicAccount> {
  const cacheKey = `${channel.platform}:${channel.id}`;
  const previous = latestAccounts.get(cacheKey);
  // Fixed rolling window regardless of the user's historical filter. Changing
  // filter dates must not create a different upstream request on every click.
  // Historical follower values come from the Marketing database.
  const today = riyadhToday();
  const query = new URLSearchParams({ channelIds: String(channel.id), platforms: channel.platform, from: daysBefore(today,29), to:today });
  let payload: Record<string, any> | null = null;
  let warning = '';
  let providerStale = false;
  if (channel.connected) {
    try {
      // Some BulkPublish subscriptions accept channelIds but not date filters.
      try {
        const response = await cachedBulkPublishRead(sql,apiKey,`/api/analytics/account?${query}`);
        payload = response.payload; providerStale ||= response.stale;
        if (response.warning) warning = response.warning;
      } catch (error) {
        // Fallback only for unsupported date-filter variants, NEVER for 429 or
        // provider downtime; otherwise the fallback doubles rate-limit usage.
        const message = error instanceof Error ? error.message : String(error);
        if (!/BulkPublish HTTP (400|404|422)\b|حقول التاريخ غير مدعومة/i.test(message)) throw error;
        const response = await cachedBulkPublishRead(sql,apiKey,`/api/analytics/account?channelIds=${channel.id}&platforms=${channel.platform}`);
        payload = response.payload; providerStale ||= response.stale;
        if (response.warning) warning = response.warning;
      }
    } catch (error) {
      warning = `تعذر تحديث إحصائيات الحساب (${error instanceof Error ? error.message : 'فشل الاتصال'}).`;
      providerStale = true;
    }
  } else warning = !channel.verified ? 'تعذر التحقق من حالة القناة حاليًا؛ لا يُعتبر الحساب مفصولًا.' : channel.reconnect ? 'الحساب يحتاج إعادة ربط داخل BulkPublish.' : 'أكد BulkPublish أن القناة غير نشطة في آخر تحديث ناجح.';

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
    try {
      const response = await cachedBulkPublishRead(sql,apiKey,`/api/analytics/engagement?${query}`);
      post = topPost(response.payload,channel) || post;
      providerStale ||= response.stale;
      if (response.warning) warning = [warning,response.warning].filter(Boolean).join(' ');
    } catch { /* Optional endpoint must never hide the account itself. */ }
  }
  const fallbackAllowed = !!previous && previous.lastDate !== null && previous.lastDate >= from && previous.lastDate <= to;
  const account: OrganicAccount = {
    id: channel.id, name: clean(arr(payload?.channels).find(c => Number(c?.id) === channel.id)?.accountName) || channel.name,
    connected: channel.connected, reconnect: channel.reconnect, connectionVerified: channel.verified, stale: providerStale || payload === null || (!remote.length && fallbackAllowed), note: warning,
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
  const { dateFrom, dateTo } = socialAnalyticsRange(query);
  const empty = { connected: false, accounts: [] as OrganicAccount[], note: '' };
  const forPlatform = async (platform: OrganicPlatform) => {
    const apiKey = credential(platform);
    const variable = platform === 'tiktok' ? 'BULKPUBLISH_API_KEY' : 'BULKPUBLISH_SNAPCHAT_API_KEY';
    if (!apiKey) return { ...empty, note: `أضف ${variable} في متغيرات Vercel لربط ${platform === 'tiktok' ? 'TikTok' : 'Snapchat'}.` };
    if (platform === 'snapchat' && apiKey === credential('tiktok')) {
      return { ...empty, note: 'مفتاح Snapchat يطابق مفتاح TikTok؛ أدخل مفتاح BulkPublish المستقل الخاص بسناب شات في BULKPUBLISH_SNAPCHAT_API_KEY.' };
    }

    let channelId: number | null;
    try { channelId = configuredChannelId(platform); }
    catch (error) { return { ...empty, note: error instanceof Error ? error.message : 'معرّف القناة غير صالح.' }; }

    const fetched = await listChannels(sql, apiKey, platform, channelId);
    const selected = (fetched.warning && !fetched.channels.length
      ? await storedChannels(sql, platform, channelId) : fetched.channels).slice(0, 8);
    const accounts = await Promise.all(selected.map(async channel => {
      try { return await oneAccount(sql, channel, dateFrom, dateTo, apiKey); }
      catch (error) {
        const cached = latestAccounts.get(`${channel.platform}:${channel.id}`);
        if (cached) return { ...cached, connected: channel.connected, reconnect: channel.reconnect, connectionVerified: channel.verified, stale: true,
          note: 'تعذر التحديث؛ يتم عرض آخر بيانات ناجحة للحساب.' };
        return { id: channel.id, name: channel.name, connected: channel.connected, reconnect: channel.reconnect, connectionVerified: channel.verified, stale: true,
          note: error instanceof Error ? error.message.slice(0, 150) : 'تعذر قراءة إحصائيات الحساب',
          followers: null, monthlyChange: null, dailyChange: null, videoCount: null, likesCount: null,
          impressions: null, profileViews: null, views: null, reach: null, lastDate: null, snapshots: [], topPost: null } as OrganicAccount;
      }
    }));
    if (fetched.warning) for (const account of accounts) {
      account.stale = true;
      account.note = [account.note, fetched.warning].filter(Boolean).join(' ');
    }
    const emptyNote = !accounts.length ? channelId !== null
      ? `معرّف قناة ${platform === 'snapchat' ? 'Snapchat' : 'TikTok'} (${channelId}) غير موجود ضمن القنوات المتاحة بهذا المفتاح. راجع معرّف القناة.`
      : `لم يُعثر على حساب ${platform === 'tiktok' ? 'TikTok' : 'Snapchat'} في قائمة قنوات هذا المفتاح.` : '';
    return { connected: accounts.some(a => a.connected), accounts, note: fetched.warning || emptyNote };
  };
  // Each platform resolves its own API key, channel list and quota cache.
  // TikTok's scheduling code continues using its original environment vars.
  const tiktok = await forPlatform('tiktok');
  const snapchat = await forPlatform('snapchat');
  return { ok: true as const, tiktok, snapchat };
}
