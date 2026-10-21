/**
 * TikTok for Business MCP integration for Marketing > Paid Ads only.
 * Does not use or modify the TikTok organic publishing OAuth connection,
 * Meta Ads, Google Ads, CRM, or the scheduling/engagement data tables.
 */
import { getSql } from './_db.js';
import { decryptPlatformToken, encryptPlatformToken } from './_platform-connections.js';

type Sql = ReturnType<typeof getSql>;
type Json = Record<string, any>;
type Credential = {
  client_id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: Date | string | null;
  updated_at: Date | string;
};
export type TikTokAdsAccount = { id: string; name: string; currency: string; timeZone: string };
export type TikTokAdsMetrics = {
  spend: number | null; impressions: number | null; clicks: number | null;
  ctr: number | null; conversions: number | null; leads: number | null;
  costPerLead: number | null;
};
export type TikTokAdsCampaign = {
  id: string; accountId: string; name: string; status: string; deliveryStatus: string;
  objective: string; type: string; budget: number | null; budgetMode: string;
  createdAt: string; metrics: TikTokAdsMetrics;
};
const MCP_URL = 'https://business-api.tiktok.com/open_mcp/tt-ads-mcp-layer';
const TOKEN_URL = `${MCP_URL}/oauth/token`;
const PROTOCOL_VERSION = '2025-03-26';
const MAX_CAMPAIGN_PAGES = 10;
const CAMPAIGN_PAGE_SIZE = 200;
const CACHE_MS = 90_000;
const clean = (value: unknown) => String(value ?? '').trim();
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const list = (value: unknown): Json[] => Array.isArray(value) ? value.map(object) : [];
const amount = (value: unknown): number | null => value === undefined || value === null || value === '' || !Number.isFinite(Number(value)) ? null : Math.max(0, Number(value));
const advertiserId = (value: unknown) => /^\d{10,25}$/.test(clean(value)) ? clean(value) : '';
const campaignId = (value: unknown) => /^\d{10,25}$/.test(clean(value)) ? clean(value) : '';
const sanitizedError = (value: unknown) => clean(value).replace(/(access_token|refresh_token|authorization|Bearer)\s*[=:]\s*[^\s,&}"']+/gi, '$1=[REDACTED]').slice(0, 350);

// This dedicated table is created ONLY on an explicit TikTok Ads connection POST.
// Ordinary page loads are read-only and never run SQL migrations.
async function ensureCredentialsTable(sql: Sql) {
  await sql`
    create table if not exists marketing.tiktok_ads_mcp_credentials (
      id smallint primary key default 1 check (id = 1),
      client_id text not null,
      access_token_encrypted text not null,
      refresh_token_encrypted text not null,
      token_expires_at timestamptz,
      updated_by uuid,
      updated_at timestamptz not null default now()
    )
  `;
}

async function readCredentials(sql: Sql): Promise<Credential | null> {
  const [check] = await sql<{ exists: boolean }[]>`
    select to_regclass('marketing.tiktok_ads_mcp_credentials') is not null as exists
  `;
  if (!check?.exists) return null;
  const [row] = await sql<Credential[]>`
    select client_id, access_token_encrypted, refresh_token_encrypted,
           token_expires_at, updated_at
    from marketing.tiktok_ads_mcp_credentials where id = 1
  `;
  return row || null;
}

function parseSse(raw: string) {
  const entries = raw.split(/\r?\n\r?\n/);
  for (const entry of entries) {
    const data = entry.split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim()).join('\n');
    if (!data || data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data);
      if (parsed.error || parsed.result) return parsed;
    } catch { /* non-data SSE event */ }
  }
  throw new Error('TikTok MCP returned an invalid event stream');
}

function unpackMcpResult(result: Json) {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const content = list(result.content).filter(item => item.type === 'text').map(item => clean(item.text)).join('\n');
  if (!content) return result;
  try { return JSON.parse(content); } catch { return content; }
}

/** MCP tools never receive credentials in their JSON bodies; auth stays in the Authorization header. */
async function callMcpRaw(accessToken: string, name: string, args: Json, timeout = 13_000): Promise<any> {
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': PROTOCOL_VERSION,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(timeout),
  });
  if (response.status === 401) {
    const error = new Error('انتهت صلاحية الوصول إلى TikTok Ads');
    (error as Error & { code?: string }).code = 'TIKTOK_ADS_TOKEN_EXPIRED';
    throw error;
  }
  if (!response.ok) throw new Error(`TikTok MCP غير متاح حاليًا (${response.status})`);
  const raw = await response.text();
  let rpc: Json;
  try { rpc = (response.headers.get('content-type') || '').includes('text/event-stream') ? parseSse(raw) : JSON.parse(raw); }
  catch { throw new Error('استجابة TikTok MCP غير صالحة'); }
  if (rpc.error) throw new Error(sanitizedError(object(rpc.error).message || 'TikTok MCP request rejected'));
  const result = object(rpc.result);
  const data = unpackMcpResult(result);
  if (result.isError) throw new Error(sanitizedError(typeof data === 'string' ? data : object(data).message || object(data).error || 'TikTok tool rejected the request'));
  const parsed = object(data);
  if (parsed.code !== undefined && Number(parsed.code) !== 0) {
    const code = clean(parsed.code);
    throw new Error(`TikTok Ads: ${sanitizedError(parsed.message || 'فشل تنفيذ الطلب')} (${code})`);
  }
  return Array.isArray(data) ? data : parsed;
}

async function refreshAccessToken(clientId: string, refreshToken: string) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken }),
    signal: AbortSignal.timeout(12_000),
  });
  const payload = object(await response.json().catch(() => ({})));
  const token = object(payload.data).access_token ? object(payload.data) : payload;
  if (!response.ok || !clean(token.access_token)) {
    throw new Error(`تعذر تجديد صلاحية TikTok Ads (${response.status}). أعد استيراد ملف التوكن بعد تجديد التفويض.`);
  }
  return {
    accessToken: clean(token.access_token),
    refreshToken: clean(token.refresh_token) || refreshToken,
    expiresAt: new Date(Date.now() + Math.max(60, Math.min(86400, Number(token.expires_in) || 3600)) * 1000),
  };
}

// Coalesce refresh requests inside the same Vercel instance. Other instances use
// compare-and-swap to avoid overwriting a newer refresh token in PostgreSQL.
let refreshInFlight: Promise<string> | null = null;
async function refreshSavedToken(sql: Sql, stored: Credential): Promise<string> {
  if (refreshInFlight) return refreshInFlight;
  const promise = (async () => {
    const originalEncrypted = stored.refresh_token_encrypted;
    const fresh = await refreshAccessToken(stored.client_id, decryptPlatformToken(originalEncrypted));
    const updated = await sql<{ client_id: string }[]>`
      update marketing.tiktok_ads_mcp_credentials
      set access_token_encrypted=${encryptPlatformToken(fresh.accessToken)},
          refresh_token_encrypted=${encryptPlatformToken(fresh.refreshToken)},
          token_expires_at=${fresh.expiresAt}, updated_at=now()
      where id=1 and refresh_token_encrypted=${originalEncrypted}
      returning client_id
    `;
    if (updated.length) return fresh.accessToken;
    const latest = await readCredentials(sql);
    if (!latest) throw new Error('TikTok Ads غير مرتبط');
    return decryptPlatformToken(latest.access_token_encrypted);
  })();
  refreshInFlight = promise;
  try { return await promise; }
  finally { if (refreshInFlight === promise) refreshInFlight = null; }
}

async function withTikTokAuth<T>(sql: Sql, operation: (token: string) => Promise<T>) {
  const stored = await readCredentials(sql);
  if (!stored) throw new Error('اربط TikTok Ads من ملف OAuth داخل تبويب الحملات الممولة أولًا');
  const expiry = stored.token_expires_at ? new Date(stored.token_expires_at).getTime() : 0;
  let token = expiry && expiry < Date.now() + 120_000
    ? await refreshSavedToken(sql, stored)
    : decryptPlatformToken(stored.access_token_encrypted);
  try { return await operation(token); }
  catch (error) {
    if ((error as { code?: string }).code !== 'TIKTOK_ADS_TOKEN_EXPIRED') throw error;
    const latest = await readCredentials(sql);
    if (!latest) throw error;
    token = await refreshSavedToken(sql, latest);
    return operation(token);
  }
}

async function execute(accessToken: string, name: string, params: Json, timeout?: number) {
  return callMcpRaw(accessToken, 'tool_execute', { tool_name: name, params }, timeout);
}

let cachedAccounts: { expiresAt: number; accounts: TikTokAdsAccount[] } | null = null;
const reportCache = new Map<string, { expiresAt: number; report: Json }>();
function resetCache() { cachedAccounts = null; reportCache.clear(); }

function getAuthorizedAccountsResponse(response: Json): TikTokAdsAccount[] {
  return list(object(response.data).list)
    .map(item => ({ id: advertiserId(item.advertiser_id), name: clean(item.advertiser_name) || clean(item.advertiser_id), currency: '', timeZone: '' }))
    .filter(item => item.id);
}

async function discoverAccounts(token: string, force = false) {
  if (!force && cachedAccounts && cachedAccounts.expiresAt > Date.now()) return cachedAccounts.accounts;
  const authorized = await callMcpRaw(token, 'auth_advertiser_get', {}, 13_000);
  const accounts = getAuthorizedAccountsResponse(authorized);
  // Metadata is informational only; the authenticated advertiser list is the authority.
  if (accounts.length) {
    try {
      const details = await execute(token, 'advertiser_info_get', { advertiser_ids: accounts.map(account => account.id) }, 4_000);
      const detailsList = list(object(details.data).list);
      for (const account of accounts) {
        const matching = detailsList.find(item => clean(item.advertiser_id) === account.id);
        if (matching) {
          account.currency = clean(matching.currency || matching.currency_code);
          account.timeZone = clean(matching.timezone || matching.time_zone);
          account.name = clean(matching.name || matching.advertiser_name) || account.name;
        }
      }
    } catch { /* Account metadata may be restricted; never block campaign reads. */ }
  }
  cachedAccounts = { accounts, expiresAt: Date.now() + 4 * 60_000 };
  return accounts;
}

export async function linkTikTokAdsToken(sql: Sql, userId: string, body: Json) {
  const input = object(body.token);
  const clientId = clean(body.clientId || input.client_id);
  let accessToken = clean(input.access_token);
  let refreshToken = clean(input.refresh_token);
  if (!/^[A-Za-z0-9_-]{12,160}$/.test(clientId)) throw new Error('Client ID غير صالح. استخدم Client ID الذي سجلناه مع TikTok MCP.');
  if (accessToken.length < 20 || refreshToken.length < 20) throw new Error('ملف OAuth يجب أن يحتوي على access_token وrefresh_token صالحين');
  if (JSON.stringify(input).length > 32_000) throw new Error('ملف OAuth كبير بشكل غير متوقع');
  let expiresAt = new Date(Date.now() + 60 * 60_000);
  const expiration = input.expires_at || input.expiresAt || input.expiry_date || input.expiryDate;
  if (expiration) {
    const numeric = Number(expiration);
    const parsed = Number.isFinite(numeric) && numeric > 1e9
      ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
      : new Date(String(expiration));
    if (Number.isFinite(parsed.getTime())) expiresAt = parsed;
  } else if (Number.isFinite(Number(input.expires_in)) && Number(input.expires_in) > 0) {
    // The local OAuth file may have been saved hours ago. Validate the token
    // against TikTok before relying on its reported remaining lifetime.
    expiresAt = new Date(Date.now() + 60_000);
  }

  let accounts: TikTokAdsAccount[];
  try { accounts = getAuthorizedAccountsResponse(await callMcpRaw(accessToken, 'auth_advertiser_get', {}, 15_000)); }
  catch (error) {
    if ((error as { code?: string }).code !== 'TIKTOK_ADS_TOKEN_EXPIRED') throw error;
    const refreshed = await refreshAccessToken(clientId, refreshToken);
    accessToken = refreshed.accessToken;
    refreshToken = refreshed.refreshToken;
    expiresAt = refreshed.expiresAt;
    accounts = getAuthorizedAccountsResponse(await callMcpRaw(accessToken, 'auth_advertiser_get', {}, 15_000));
  }
  if (!accounts.length) throw new Error('التوكن صالح لكن لا يوجد حساب إعلاني مصرح به في TikTok for Business');
  // No table is created and no credential is persisted until remote authorization succeeds.
  await ensureCredentialsTable(sql);
  await sql`
    insert into marketing.tiktok_ads_mcp_credentials
      (id, client_id, access_token_encrypted, refresh_token_encrypted, token_expires_at, updated_by, updated_at)
    values (1, ${clientId}, ${encryptPlatformToken(accessToken)}, ${encryptPlatformToken(refreshToken)}, ${expiresAt}, ${userId}::uuid, now())
    on conflict (id) do update set
      client_id=excluded.client_id,
      access_token_encrypted=excluded.access_token_encrypted,
      refresh_token_encrypted=excluded.refresh_token_encrypted,
      token_expires_at=excluded.token_expires_at,
      updated_by=excluded.updated_by, updated_at=now()
  `;
  resetCache();
  return { ok: true, status: 'connected', accounts, message: `تم ربط TikTok Ads بشكل مستقل، ووجدنا ${accounts.length} حساب إعلاني.` };
}

export async function disconnectTikTokAds(sql: Sql) {
  const current = await readCredentials(sql);
  if (current) await sql`delete from marketing.tiktok_ads_mcp_credentials where id=1`;
  resetCache();
  return { ok: true, message: 'تم فصل ربط TikTok Ads فقط. لم يتغير ربط TikTok للنشر أو أي منصة أخرى.' };
}

function period(presetInput: unknown, fromInput: unknown, toInput: unknown) {
  const preset = clean(presetInput);
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  const start = clean(fromInput);
  const end = clean(toInput);
  if (start || end) {
    if (!valid(start) || !valid(end) || start > end) throw new Error('نطاق التاريخ غير صالح');
    if ((Date.parse(end) - Date.parse(start)) / 86400000 > 366) throw new Error('الحد الأقصى لنطاق التاريخ سنة واحدة');
    return { since: start, until: end, preset: 'custom' };
  }
  // Default display corresponds to the account's Saudi operating date; these
  // are date boundaries, NOT an assumption about TikTok currency or lead type.
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const day = new Date(`${todayKey}T00:00:00.000Z`);
  const key = (date: Date) => date.toISOString().slice(0, 10);
  const subtract = (days: number) => { const value = new Date(day); value.setUTCDate(value.getUTCDate() - days); return key(value); };
  if (preset === 'today') return { since: key(day), until: key(day), preset };
  if (preset === 'yesterday') return { since: subtract(1), until: subtract(1), preset };
  if (preset === 'last_7d') return { since: subtract(6), until: key(day), preset };
  if (preset === 'this_month') return { since: `${todayKey.slice(0, 7)}-01`, until: key(day), preset };
  return { since: subtract(29), until: key(day), preset: 'last_30d' };
}

async function campaignsForAccount(token: string, account: TikTokAdsAccount) {
  const campaigns: Json[] = [];
  let page = 1;
  let incomplete = false;
  do {
    const payload = await execute(token, 'campaign_get', {
      advertiser_id: account.id, page, page_size: CAMPAIGN_PAGE_SIZE,
    }, 17_000);
    const data = object(payload.data);
    campaigns.push(...list(data.list));
    const info = object(data.page_info);
    const pages = Number(info.total_page) || 0;
    const more = pages > page;
    incomplete = more && page >= MAX_CAMPAIGN_PAGES;
    if (!more || incomplete || !list(data.list).length) break;
    page++;
  } while (page <= MAX_CAMPAIGN_PAGES);
  return { campaigns, incomplete };
}

const BASIC_METRICS = ['spend', 'impressions', 'clicks', 'ctr', 'conversion'];
const LEAD_METRIC_CANDIDATES = ['onsite_conversion.lead', 'onsite_conversion.lead_grouped', 'onsite_conversion.total_lead', 'lead', 'total_lead'];
let cachedReportSpec: { expiresAt: number; allowed: Set<string> | null } | null = null;
let reportSpecInFlight: Promise<Set<string> | null> | null = null;
async function getReportMetricOptions(token: string): Promise<Set<string> | null> {
  if (cachedReportSpec && cachedReportSpec.expiresAt > Date.now()) return cachedReportSpec.allowed;
  if (reportSpecInFlight) return reportSpecInFlight;
  const promise = (async () => {
    let allowed: Set<string> | null = null;
    try {
      const result = await callMcpRaw(token, 'tool_get', { tool_name_list: ['report_integrated_get'] }, 10_000);
      const schema = Array.isArray(result) ? object(result[0]) : object(result);
      const definition = object(schema.inputSchema);
      const enumerated = object(object(definition.properties).metrics).items?.enum;
      if (Array.isArray(enumerated) && enumerated.length) allowed = new Set(enumerated.map(clean));
    } catch { /* A missing tool schema must not stop the basic report attempt. */ }
    cachedReportSpec = { allowed, expiresAt: Date.now() + 30 * 60_000 };
    return allowed;
  })();
  reportSpecInFlight = promise;
  try { return await promise; }
  finally { if (reportSpecInFlight === promise) reportSpecInFlight = null; }
}

function reportValuesFromRow(row: Json, leadMetric: string | null): TikTokAdsMetrics {
  const metrics = object(row.metrics);
  const spend = amount(metrics.spend);
  const impressions = amount(metrics.impressions);
  const clicks = amount(metrics.clicks);
  const conversions = amount(metrics.conversion);
  const leads = leadMetric ? amount(metrics[leadMetric]) : null;
  const ctr = amount(metrics.ctr) ?? (clicks !== null && impressions ? clicks / impressions * 100 : null);
  return { spend, impressions, clicks, ctr, conversions, leads, costPerLead: spend !== null && leads !== null && leads > 0 ? spend / leads : null };
}

async function reportForAccount(token: string, account: TikTokAdsAccount, since: string, until: string) {
  const allowed = await getReportMetricOptions(token);
  // When TikTok omits the metric enum, probe the documented instant-lead
  // metric once. If unavailable, retry without it and show leads as unknown.
  const leadMetric = LEAD_METRIC_CANDIDATES.find(metric => allowed?.has(metric)) || (!allowed ? 'onsite_conversion.lead' : null);
  const selected = [...BASIC_METRICS.filter(metric => !allowed || allowed.has(metric)), ...(leadMetric ? [leadMetric] : [])];
  // TikTok's integrated report accepts campaign dimensions and returns values
  // by campaign_id. Generic 'conversion' is NOT silently counted as leads.
  const metricsById = new Map<string, TikTokAdsMetrics>();
  let incomplete = false;
  let page = 1;
  let retryStep = 0;
  while (page <= MAX_CAMPAIGN_PAGES) {
    let payload: Json;
    try {
      payload = await execute(token, 'report_integrated_get', {
        advertiser_id: account.id, report_type: 'BASIC', data_level: 'AUCTION_CAMPAIGN',
        dimensions: ['campaign_id'], metrics: selected,
        start_date: since, end_date: until, page, page_size: 1000,
      }, 21_000);
    } catch (error) {
      // First remove just the optional lead metric; preserve conversion.
      // Only then try the bare traffic/spend metrics if the account rejects
      // conversions too. A failed optional measure cannot blank a campaign.
      const fallback = retryStep === 0 && leadMetric && selected.includes(leadMetric)
        ? selected.filter(metric => metric !== leadMetric)
        : ['spend', 'impressions', 'clicks'].filter(metric => !allowed || allowed.has(metric));
      if (retryStep >= 2 || selected.join() === fallback.join()) throw error;
      selected.splice(0, selected.length, ...fallback);
      retryStep++;
      page = 1;
      metricsById.clear();
      continue;
    }
    const data = object(payload.data);
    for (const row of list(data.list)) {
      const id = campaignId(object(row.dimensions).campaign_id || row.campaign_id);
      if (!id) continue;
      metricsById.set(id, reportValuesFromRow(row, selected.includes(leadMetric || '') ? leadMetric : null));
    }
    const info = object(data.page_info);
    const pages = Number(info.total_page) || 0;
    if (pages <= page || !list(data.list).length) break;
    if (page >= MAX_CAMPAIGN_PAGES) { incomplete = true; break; }
    page++;
  }
  return { metricsById, incomplete, leadMetric: selected.includes(leadMetric || '') ? leadMetric : null };
}

const EMPTY_METRICS: TikTokAdsMetrics = { spend: null, impressions: null, clicks: null, ctr: null, conversions: null, leads: null, costPerLead: null };
async function accountReport(token: string, account: TikTokAdsAccount, since: string, until: string, fresh: boolean) {
  const key = `${account.id}:${since}:${until}`;
  const cached = reportCache.get(key);
  if (!fresh && cached && cached.expiresAt > Date.now()) return cached.report;
  const [source, metricAttempt] = await Promise.all([
    campaignsForAccount(token, account),
    reportForAccount(token, account, since, until).then(value => ({ value, failed: false as const }))
      .catch(() => ({ value: null, failed: true as const })),
  ]);
  const warnings: string[] = [];
  const metrics = metricAttempt.value;
  if (metricAttempt.failed) warnings.push('تعذر قراءة الأداء للفترة المحددة. عدد الحملات وحالتها والميزانية ما زالت صحيحة؛ أرقام الصرف والليدات غير متاحة.');
  if (metrics && !metrics.leadMetric) warnings.push('TikTok لم يوفر مقياس ليدات مباشرًا لهذا التقرير؛ لا نعتبر جميع التحويلات ليدات.');
  if (source.incomplete || metrics?.incomplete) warnings.push('عدد كبير من النتائج: تم وضع حد للصفحات حفاظًا على سرعة التحميل.');
  const campaigns: TikTokAdsCampaign[] = source.campaigns.map(campaign => {
    const id = campaignId(campaign.campaign_id);
    return {
      id, accountId: account.id, name: clean(campaign.campaign_name) || `حملة ${id}`,
      status: clean(campaign.operation_status), deliveryStatus: clean(campaign.secondary_status),
      objective: clean(campaign.objective_type), type: clean(campaign.campaign_automation_type || campaign.campaign_type),
      budget: amount(campaign.budget), budgetMode: clean(campaign.budget_mode),
      createdAt: clean(campaign.create_time), metrics: metrics?.metricsById.get(id) || (metrics ? {
        // The report returned successfully, so missing campaigns have zero measured delivery.
        spend: 0, impressions: 0, clicks: 0, ctr: 0, conversions: null, leads: metrics.leadMetric ? 0 : null, costPerLead: null,
      } : { ...EMPTY_METRICS }),
    };
  }).filter(campaign => campaign.id);
  const report = { account, campaigns, warnings, incomplete: source.incomplete || Boolean(metrics?.incomplete), metricsAvailable: Boolean(metrics) };
  reportCache.set(key, { report, expiresAt: Date.now() + CACHE_MS });
  if (reportCache.size > 24) reportCache.delete(reportCache.keys().next().value || key);
  return report;
}

/** Account identity only: do not load expensive campaign or report data in the followers tab. */
export async function tiktokAdsAccountsOverview(sql: Sql) {
  if (!await readCredentials(sql)) return { connected: false, accounts: [] as TikTokAdsAccount[], note: 'TikTok Ads غير مربوط.' };
  try {
    const accounts = await withTikTokAuth(sql, token => discoverAccounts(token));
    return { connected: accounts.length > 0, accounts, note: accounts.length ? '' : 'لا توجد حسابات إعلانية متاحة.' };
  } catch (error) {
    return { connected: false, accounts: [] as TikTokAdsAccount[], note: sanitizedError(error instanceof Error ? error.message : error) };
  }
}

export async function tiktokAdsData(sql: Sql, presetInput: unknown, accountInput: unknown, fromInput: unknown, toInput: unknown, refreshInput: unknown) {
  const dates = period(presetInput, fromInput, toInput);
  const base = { ok: true, status: 'needs_connection', accounts: [] as TikTokAdsAccount[], reports: [] as Json[], errors: [] as Json[],
    dateRange: { since: dates.since, until: dates.until }, preset: dates.preset, syncedAt: new Date().toISOString(), note: '' };
  if (!await readCredentials(sql)) return { ...base, note: 'اربط TikTok Ads مرة واحدة باستيراد ملف tiktok-mcp-token.json من جهازك. هذا الربط مستقل عن TikTok للنشر.' };
  try {
    return await withTikTokAuth(sql, async token => {
      const accounts = await discoverAccounts(token, refreshInput === 'true');
      const selected = advertiserId(accountInput);
      if (clean(accountInput) && (!selected || !accounts.some(account => account.id === selected))) {
        return { ...base, status: 'needs_account', accounts, note: 'الحساب الإعلاني غير متاح للتوكن المربوط.' };
      }
      const targets = selected ? accounts.filter(account => account.id === selected) : accounts.slice(0, 6);
      if (!targets.length) return { ...base, status: 'needs_account', note: 'لا توجد حسابات إعلانية مصرح بها.' };
      const settled = await Promise.allSettled(targets.map(account => accountReport(token, account, dates.since, dates.until, refreshInput === 'true')));
      const reports = settled.flatMap(outcome => outcome.status === 'fulfilled' ? [outcome.value] : []);
      const errors = settled.flatMap((outcome, index) => outcome.status === 'rejected'
        ? [{ accountId: targets[index].id, message: sanitizedError(outcome.reason instanceof Error ? outcome.reason.message : outcome.reason) }] : []);
      return { ...base, status: reports.length ? 'ready' : 'failed', accounts, reports, errors,
        syncedAt: new Date().toISOString(), note: accounts.length > targets.length ? 'تم عرض أول 6 حسابات فقط لحماية سرعة TikTok MCP؛ اختر حسابًا بعينه لعرضه.' : '' };
    });
  } catch (error) {
    return { ...base, status: 'failed', note: sanitizedError(error instanceof Error ? error.message : error) };
  }
}

export async function changeTikTokAdsCampaignStatus(sql: Sql, input: Json) {
  const accountId = advertiserId(input.accountId);
  const id = campaignId(input.campaignId);
  const desired = clean(input.status);
  if (!accountId || !id || !['ENABLE', 'DISABLE'].includes(desired)) throw new Error('الحساب أو الحملة أو الحالة غير صالحة');
  if (desired === 'ENABLE' && input.confirmSpend !== true) throw new Error('يجب تأكيد التشغيل واحتمال الإنفاق الإعلاني صراحة');
  const result = await withTikTokAuth(sql, async token => {
    const accounts = await discoverAccounts(token);
    if (!accounts.some(account => account.id === accountId)) throw new Error('الحساب غير مصرح به ضمن الحسابات المرتبطة');
    // Read back the exact target before any write; never update an arbitrary advertiser.
    const actual = await execute(token, 'campaign_get', { advertiser_id: accountId, filtering: { campaign_ids: [id] }, page: 1, page_size: 10 });
    const campaign = list(object(actual.data).list).find(item => clean(item.campaign_id) === id);
    if (!campaign) throw new Error('الحملة غير موجودة داخل الحساب المحدد');
    if (clean(campaign.secondary_status).includes('DELETE')) throw new Error('لا يمكن تشغيل حملة محذوفة');
    // Upgraded Smart+ has a separate TikTok status endpoint.
    const statusTool = clean(campaign.campaign_automation_type) === 'UPGRADED_SMART_PLUS'
      ? 'smart_plus_campaign_status_update' : 'campaign_status_update';
    await execute(token, statusTool, { advertiser_id: accountId, campaign_ids: [id], operation_status: desired }, 16_000);
    return { ok: true, message: desired === 'ENABLE' ? 'تم إرسال طلب تشغيل الحملة إلى TikTok Ads؛ قد يبدأ الإنفاق.' : 'تم إرسال طلب إيقاف الحملة إلى TikTok Ads.' };
  });
  resetCache();
  return result;
}

/** Create only a PAUSED, empty campaign shell; no ad groups, ads or spend. */
export async function createPausedTikTokAdsCampaign(sql: Sql, input: Json) {
  const accountId = advertiserId(input.accountId);
  const name = clean(input.name);
  const objective = clean(input.objective);
  const budgetMode = clean(input.budgetMode);
  const budget = Number(input.budget);
  const permittedObjectives = new Set(['LEAD_GENERATION', 'TRAFFIC', 'REACH', 'VIDEO_VIEWS']);
  if (!accountId) throw new Error('حدد الحساب الإعلاني الذي ستُنشأ فيه الحملة');
  if (name.length < 3 || name.length > 120 || /[<>]/.test(name)) throw new Error('اسم الحملة مطلوب من 3 إلى 120 حرفًا');
  if (!permittedObjectives.has(objective)) throw new Error('هدف الحملة غير مدعوم في إنشاء المسودات');
  if (!['BUDGET_MODE_DAY', 'BUDGET_MODE_TOTAL'].includes(budgetMode)) throw new Error('نوع الميزانية غير صالح');
  if (!Number.isFinite(budget) || budget < 50 || budget > 10_000_000) throw new Error('الميزانية يجب أن تكون 50 أو أكثر بعملة الحساب (وتخضع لحد TikTok الفعلي)');
  return withTikTokAuth(sql, async token => {
    const accounts = await discoverAccounts(token);
    if (!accounts.some(account => account.id === accountId)) throw new Error('الحساب الإعلاني غير مصرح به ضمن حسابات TikTok المربوطة');
    const result = await execute(token, 'campaign_create', {
      advertiser_id: accountId,
      campaign_name: name,
      objective_type: objective,
      budget_mode: budgetMode,
      budget,
      operation_status: 'DISABLE',
    }, 20_000);
    const id = campaignId(object(result.data).campaign_id);
    if (!id) throw new Error('TikTok ردّ بنجاح لكنه لم يُرجع رقم الحملة. تحقق داخل Ads Manager قبل إعادة الإرسال لتجنب التكرار.');
    resetCache();
    return { ok: true, campaignId: id, accountId, message: 'تم إنشاء مسودة حملة متوقفة داخل TikTok Ads. أضف المجموعة الإعلانية والكرييتيف قبل تشغيلها؛ لا توجد تكلفة من المسودة وحدها.' };
  });
}

/** Testable pure pieces; never includes tokens. */
export const tiktokAdsTestHelpers = { period, parseSse, unpackMcpResult, getAuthorizedAccountsResponse, reportValuesFromRow, advertiserId, campaignId };
