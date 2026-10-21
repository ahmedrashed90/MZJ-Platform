/** Lightweight connected-platform account overview for Marketing > Engagement > Accounts.
 * Read-only, no campaign/report metric calls, no cross-provider token changes.
 */
import { getSql } from './_db.js';
import { tiktokAdsAccountsOverview } from './_marketing-tiktok-ads.js';

type Sql = ReturnType<typeof getSql>;
const clean = (value: unknown) => String(value ?? '').trim();
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const list = (value: unknown): any[] => Array.isArray(value) ? value : [];

let cachedOrganicTikTok: { expires: number; channels: { id: number; name: string }[]; error: string } | null = null;
async function organicTikTokAccounts() {
  const apiKey = clean(process.env.BULKPUBLISH_API_KEY);
  if (!apiKey) return { connected: false, accounts: [], note: 'أضف BULKPUBLISH_API_KEY لعرض حساب TikTok العضوي المتصل.' };
  if (cachedOrganicTikTok && cachedOrganicTikTok.expires > Date.now()) {
    return { connected: cachedOrganicTikTok.channels.length > 0, accounts: cachedOrganicTikTok.channels, note: cachedOrganicTikTok.error };
  }
  try {
    const result = await fetch('https://app.bulkpublish.com/api/channels', {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(9_000),
    });
    if (!result.ok) throw new Error(`تعذرت قراءة قنوات BulkPublish (${result.status})`);
    const body = record(await result.json());
    const channels = list(body.channels || body.data).filter(item => clean(item.platform).toLowerCase() === 'tiktok'
      && item.isActive === true && item.needsReconnect !== true)
      .map(item => ({ id: Number(item.id), name: clean(item.accountName || item.name || `TikTok ${item.id}`) }))
      .filter(item => Number.isSafeInteger(item.id) && item.id > 0);
    cachedOrganicTikTok = { expires: Date.now() + 10 * 60_000, channels, error: channels.length ? '' : 'لا توجد قناة TikTok عضوية نشطة في BulkPublish.' };
    return { connected: Boolean(channels.length), accounts: channels, note: cachedOrganicTikTok.error };
  } catch (error) {
    const note = error instanceof Error ? error.message : 'تعذر قراءة TikTok من BulkPublish';
    cachedOrganicTikTok = { expires: Date.now() + 60_000, channels: [], error: note };
    return { connected: false, accounts: [], note };
  }
}

export async function marketingSocialAccountsOverview(sql: Sql) {
  const [rows, tiktokAds, organic] = await Promise.all([
    sql<any[]>`select platform,connected,account_name,metadata from marketing.platform_connections where platform='google_ads' limit 1`,
    tiktokAdsAccountsOverview(sql),
    organicTikTokAccounts(),
  ]);
  const row = rows[0];
  const metadata = record(row?.metadata);
  const selected = list(metadata.selectedAccountIds).map(clean);
  const googleAccounts = row?.connected ? list(metadata.accounts)
    .filter(item => !item.manager && selected.includes(clean(item.id)))
    .map(item => ({ id: clean(item.id), name: clean(item.name) || clean(item.id), currency: clean(item.currency), timeZone: clean(item.timeZone) })) : [];
  return {
    ok: true,
    googleAds: { connected: Boolean(row?.connected), accounts: googleAccounts, note: googleAccounts.length ? '' : 'لا توجد حسابات Google Ads مختارة حاليًا.' },
    tiktokAds,
    tiktok: organic,
  };
}
