/**
 * Read-only Meta Ads Manager reporting. This integration intentionally never
 * inserts into the organic post/CRM/scheduled publishing tables and never
 * creates, modifies or pauses a campaign on Meta.
 *
 * Requires a Meta user/system-user token with ads_read (or ads_management) and
 * ad account access. The existing Facebook Page token is NOT an Ads token.
 */
import crypto from 'node:crypto';
import { getSql } from './_db.js';
import { decryptPlatformToken } from './_platform-connections.js';

type Sql = ReturnType<typeof getSql>;
type GraphRow = Record<string, any>;
type MetaAdsPreset = 'today' | 'yesterday' | 'last_7d' | 'last_30d' | 'this_month';
const PRESETS = new Set<MetaAdsPreset>(['today', 'yesterday', 'last_7d', 'last_30d', 'this_month']);
const clean = (value: unknown): string => String(value ?? '').trim();
const rows = (input: unknown): GraphRow[] => Array.isArray(input) ? input as GraphRow[] : [];
const numberOrNull = (input: unknown): number | null => input === null || input === undefined || input === '' || !Number.isFinite(Number(input)) ? null : Math.max(0, Number(input));
const graphVersion = () => clean(process.env.META_GRAPH_VERSION) || 'v25.0';
const maxAccountsPerRequest = 4;
const graphTimeout = 11_000;

export function metaAdsPreset(input: unknown): MetaAdsPreset {
  const value = clean(input) as MetaAdsPreset;
  return PRESETS.has(value) ? value : 'last_30d';
}

function adsError(error: unknown) {
  const original = clean((error as Error)?.message || error);
  // Neither the Graph URL nor an access token may be sent to the browser/log.
  const safe = original.replace(/(?:access_token|token)=[^&\s]+/gi, '[REDACTED]');
  return safe.slice(0, 420) || 'تعذر قراءة بيانات الإعلانات من Meta';
}

async function graphGet(path: string, token: string, parameters: Record<string, string> = {}): Promise<GraphRow> {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${path.replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(parameters)) if (value) url.searchParams.set(key, value);
  const secret = clean(process.env.META_APP_SECRET);
  if (secret) url.searchParams.set('appsecret_proof', crypto.createHmac('sha256', secret).update(token).digest('hex'));
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(graphTimeout) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    const graphError = data?.error || {};
    const code = Number(graphError.code || response.status);
    if ([10, 200, 190, 104].includes(code)) throw new Error('Meta رفضت قراءة الإعلانات. تأكد من ads_read، صلاحية الحساب الإعلاني وصلاحية التوكن ثم أعد ربط Meta.');
    throw new Error(`${clean(graphError.error_user_msg || graphError.message) || 'تعذر الاتصال بـ Meta'} (${code})`);
  }
  return data;
}

// Use cursors, not paging.next URLs: no endpoint can make the server fetch an
// arbitrary URL or serialize a provider URL containing a credential.
async function graphCollection(path: string, token: string, params: Record<string, string>, maxPages = 3): Promise<{ data: GraphRow[]; more: boolean }> {
  const collected: GraphRow[] = [];
  let after = '';
  let more = false;
  for (let page = 0; page < maxPages; page++) {
    const result = await graphGet(path, token, { ...params, ...(after ? { after } : {}) });
    collected.push(...rows(result.data));
    const cursor = clean(result?.paging?.cursors?.after);
    more = Boolean(result?.paging?.next && cursor && cursor !== after);
    if (!more) break;
    after = cursor;
  }
  return { data: collected, more };
}

const LEAD_ACTIONS = ['lead', 'onsite_conversion.lead_grouped', 'onsite_conversion.lead', 'leadgen.other', 'offsite_conversion.fb_pixel_lead'];
function actionMetric(actions: unknown, type: string) {
  const entry = rows(actions).find(row => clean(row.action_type) === type);
  return entry ? numberOrNull(entry.value) : null;
}
export function metaLeadCount(actions: unknown): number | null {
  // `lead` is already an aggregated Meta action and must NOT be summed with
  // `onsite_conversion.lead_grouped`, which would double-count instant forms.
  for (const action of LEAD_ACTIONS) {
    const value = actionMetric(actions, action);
    if (value !== null) return value;
  }
  return null;
}
function metaInteractions(actions: unknown) {
  return actionMetric(actions, 'post_engagement') ?? actionMetric(actions, 'page_engagement');
}
function insightView(raw?: GraphRow) {
  if (!raw) return { spend: 0, reach: null, impressions: null, clicks: null, ctr: null, leads: null, costPerLead: null, interactions: null };
  const spend = numberOrNull(raw.spend) ?? 0;
  const leads = metaLeadCount(raw.actions);
  return {
    spend,
    reach: numberOrNull(raw.reach),
    impressions: numberOrNull(raw.impressions),
    clicks: numberOrNull(raw.clicks),
    ctr: numberOrNull(raw.ctr),
    leads,
    costPerLead: leads && leads > 0 ? spend / leads : null,
    interactions: metaInteractions(raw.actions),
  };
}
function minorUnits(currency: string): number {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits; }
  catch { return 2; }
}
function budgetAmount(input: unknown, currency: string): number | null {
  const value = numberOrNull(input);
  return value === null ? null : value / 10 ** minorUnits(currency);
}
function safeAccountId(input: unknown) {
  const text = clean(input);
  return /^(?:act_)?[0-9]{4,30}$/.test(text) ? `act_${text.replace(/^act_/, '')}` : '';
}

async function adsCredential(sql: Sql) {
  // A dedicated ads_read system-user token avoids being tied to a short-lived
  // personal login. A stored FB *user* token is also supported, not Page token.
  const supplied = clean(process.env.META_ADS_ACCESS_TOKEN);
  if (supplied) return { token: supplied, source: 'env' as const, granted: true };
  const [connection] = await sql<GraphRow[]>`select scopes,user_access_token_encrypted,token_expires_at
    from marketing.platform_connections where platform='facebook' and connected=true limit 1`;
  if (!connection?.user_access_token_encrypted) return { token: '', source: 'connection' as const, granted: false };
  const grantedScopes = rows(connection.scopes).map(clean);
  const granted = grantedScopes.includes('ads_read') || grantedScopes.includes('ads_management');
  if (connection.token_expires_at && new Date(connection.token_expires_at).getTime() < Date.now()) {
    return { token: '', source: 'connection' as const, granted: false, expired: true };
  }
  return { token: granted ? decryptPlatformToken(connection.user_access_token_encrypted) : '', source: 'connection' as const, granted };
}

type MetaAdAccount = { id: string; name: string; currency: string; status: number | null };
async function availableAccounts(token: string): Promise<{ accounts: MetaAdAccount[]; truncated: boolean }> {
  const configured = [...new Set(clean(process.env.META_AD_ACCOUNT_IDS).split(/[\s,;]+/).map(safeAccountId).filter(Boolean))];
  if (configured.length) {
    const ids = configured.slice(0, maxAccountsPerRequest);
    const results = await Promise.allSettled(ids.map(id => graphGet(id, token, { fields: 'id,name,currency,account_status' })));
    const accounts = results.flatMap((result, index) => result.status === 'fulfilled' ? [{
      id: ids[index], name: clean(result.value.name) || ids[index], currency: clean(result.value.currency) || 'SAR', status: numberOrNull(result.value.account_status),
    }] : []);
    if (!accounts.length) throw new Error('لم يتمكن Meta Ads من قراءة الحسابات المحددة في META_AD_ACCOUNT_IDS. تحقق من الصلاحيات أو التوكن.');
    return { accounts, truncated: configured.length > ids.length };
  }
  const response = await graphCollection('me/adaccounts', token, { fields: 'id,name,currency,account_status', limit: '50' }, 2);
  const accounts = response.data.slice(0, maxAccountsPerRequest).map((raw) => ({
    id: safeAccountId(raw.id), name: clean(raw.name) || clean(raw.id), currency: clean(raw.currency) || 'SAR', status: numberOrNull(raw.account_status),
  })).filter(item => Boolean(item.id));
  return { accounts, truncated: response.more || response.data.length > accounts.length };
}

async function accountReport(account: MetaAdAccount, token: string, preset: MetaAdsPreset) {
  const path = account.id;
  const campaignInsightFields = 'campaign_id,campaign_name,reach,impressions,clicks,ctr,spend,actions';
  const adInsightFields = 'campaign_id,ad_id,ad_name,reach,impressions,clicks,ctr,spend,actions';
  // Independent errors are retained per account: one revoked account should
  // not remove the campaigns/ads from another account.
  const [campaignList, adsList, campaignInsights, adInsights] = await Promise.all([
    graphCollection(`${path}/campaigns`, token, { fields: 'id,name,objective,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time,created_time', limit: '100' }, 3),
    graphCollection(`${path}/ads`, token, { fields: 'id,name,campaign_id,status,effective_status,adset{id,name},creative{id,thumbnail_url,effective_object_story_id}', limit: '100' }, 3),
    graphCollection(`${path}/insights`, token, { level: 'campaign', fields: campaignInsightFields, date_preset: preset, limit: '100' }, 3),
    graphCollection(`${path}/insights`, token, { level: 'ad', fields: adInsightFields, date_preset: preset, limit: '100' }, 4),
  ]);
  const campaignById = new Map(campaignInsights.data.map(row => [clean(row.campaign_id), row]));
  const adById = new Map(adInsights.data.map(row => [clean(row.ad_id), row]));
  const ads = adsList.data.map(ad => ({
    id: clean(ad.id), campaignId: clean(ad.campaign_id), name: clean(ad.name) || 'إعلان بدون اسم',
    status: clean(ad.effective_status || ad.status), adsetName: clean(ad.adset?.name),
    thumbnailUrl: clean(ad.creative?.thumbnail_url), storyId: clean(ad.creative?.effective_object_story_id),
    metrics: insightView(adById.get(clean(ad.id))),
  })).filter(ad => Boolean(ad.id));
  const campaigns = campaignList.data.map(campaign => ({
    id: clean(campaign.id), accountId: account.id, name: clean(campaign.name) || 'حملة بدون اسم',
    status: clean(campaign.effective_status || campaign.status), objective: clean(campaign.objective),
    startTime: clean(campaign.start_time || campaign.created_time), stopTime: clean(campaign.stop_time),
    dailyBudget: budgetAmount(campaign.daily_budget, account.currency), lifetimeBudget: budgetAmount(campaign.lifetime_budget, account.currency),
    metrics: insightView(campaignById.get(clean(campaign.id))),
    ads: ads.filter(ad => ad.campaignId === clean(campaign.id)),
  })).filter(campaign => Boolean(campaign.id));
  return {
    account, campaigns,
    incomplete: campaignList.more || adsList.more || campaignInsights.more || adInsights.more,
    adsUnlinked: ads.filter(ad => !campaigns.some(campaign => campaign.id === ad.campaignId)).length,
  };
}

export async function metaAdsData(sql: Sql, presetInput: unknown, accountIdInput?: unknown) {
  const preset = metaAdsPreset(presetInput);
  const credentials = await adsCredential(sql);
  const empty = { ok: true, preset, accounts: [], reports: [], errors: [], syncedAt: new Date().toISOString() };
  if (!credentials.token) {
    return { ...empty, status: 'needs_permission',
      note: credentials.expired ? 'انتهت صلاحية توكن Meta. أعد ربط الحساب أو استخدم META_ADS_ACCESS_TOKEN بصلاحية ads_read.'
        : 'ربط المنشورات الحالي لا يشمل صلاحية ads_read لقراءة الحملات والإعلانات. فعّلها في Meta Login for Business وأعد ربط Meta، أو جهز META_ADS_ACCESS_TOKEN بصلاحية ads_read.' };
  }
  try {
    const found = await availableAccounts(credentials.token);
    if (!found.accounts.length) return { ...empty, status: 'needs_account', note: 'لا توجد حسابات إعلانية متاحة لهذا التوكن. امنحه حق الوصول إلى الحساب الإعلاني في Meta Business Settings.' };
    const selected = safeAccountId(accountIdInput);
    const accounts = found.accounts;
    if (selected && !accounts.some(account => account.id === selected)) return { ...empty, status: 'needs_account', accounts, note: 'الحساب الإعلاني المطلوب غير متاح لهذا الربط.' };
    const targets = selected ? accounts.filter(account => account.id === selected) : accounts;
    const results = await Promise.allSettled(targets.map(account => accountReport(account, credentials.token, preset)));
    const reports = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    const errors = results.flatMap((result, index) => result.status === 'rejected' ? [{ accountId: targets[index].id, message: adsError(result.reason) }] : []);
    return { ...empty, status: reports.length ? 'ready' : 'failed', accounts, reports, errors,
      truncatedAccounts: found.truncated,
      note: errors.length && !reports.length ? 'تعذرت قراءة الحملات من Meta. راجع صلاحية ads_read وأذونات الحساب الإعلاني.' : '' };
  } catch (error) {
    return { ...empty, status: 'failed', note: adsError(error) };
  }
}

export const metaAdsTestHelpers = { metaAdsPreset, metaLeadCount, budgetAmount, insightView, safeAccountId };
