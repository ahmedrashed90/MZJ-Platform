/** Snapchat Ads -> Windsor.ai read-only campaign totals.
 * Windsor supplies DAILY rows. This adapter returns exactly one row per
 * account/campaign for the selected inclusive range, never one row per date.
 * It never uses paid metrics as account followers or organic post metrics.
 */
import { createHash } from 'node:crypto';
import { validateCampaignReportRange } from '../shared/campaign-report.js';

type Json = Record<string, any>;
const text = (value: unknown) => String(value ?? '').trim();
const rowObject = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const metric = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};
const FIELDS = ['date', 'campaign', 'clicks', 'spend', 'native_leads', 'account_name'] as const;
const VERIFIED_DETAILS = ['campaign_id', 'account_id', 'currency', 'source'] as const;
const OPTIONAL_FIELDS = new Set(['engagements', 'impressions', 'swipes', 'video_views']);
type Accumulator = { id: string; name: string; accountId: string; accountName: string;
  currency: string; spend: number; leads: number; clicks: number; interactions: number;
  missingSpend: boolean; missingLeads: boolean; missingClicks: boolean; missingInteractions: boolean; count: number };
export type WindsorPayload = { status: 'ready' | 'unavailable'; note: string;
  reports: Array<{account: { id: string; name: string; currency: string }; campaigns: Array<{ id: string; name: string; metrics: Json }>;
    incomplete: boolean; warnings: string[] }>;
  errors: Array<{accountId: string; message: string}> };

/** Exported pure normalizer: no network or credentials; handles duplicate-free per-day rows. */
export function aggregateWindsorSnapchat(input: unknown, from: string, to: string, defaultCurrency = '') {
  validateCampaignReportRange(from, to);
  if (!Array.isArray(input)) throw new Error('Windsor.ai لم يرجع قائمة بيانات الحملات');
  const campaigns = new Map<string, Accumulator>();
  const duplicates = new Set<string>();
  const warned = new Set<string>();
  let omitted = 0;
  for (const item of input) {
    const r = rowObject(item);
    const source = text(r.source || r.datasource).toLowerCase();
    if (source && !source.includes('snapchat')) continue; // /all can return other connected platforms.
    const date = text(r.date).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < from || date > to) continue;
    const name = text(r.campaign), accountName = text(r.account_name);
    if (!name || !accountName) { omitted++; continue; }
    const accountId = text(r.account_id) || accountName;
    const campaignId = text(r.campaign_id) || name;
    const currency = text(r.currency || defaultCurrency).toUpperCase();
    const campaignKey = JSON.stringify([accountId, campaignId, currency]);
    const values = [metric(r.spend), metric(r.native_leads), metric(r.clicks), metric(r.engagements)] as const;
    // Drop literal duplicate daily records; different rows on a day are left visible and flagged.
    const fingerprint = JSON.stringify([campaignKey, date, ...values]);
    if (duplicates.has(fingerprint)) { warned.add('تم تجاهل صفوف يومية متكررة متطابقة لتجنب مضاعفة النتائج.'); continue; }
    duplicates.add(fingerprint);
    let total = campaigns.get(campaignKey);
    if (!total) {
      total = { id: campaignId, name, accountId, accountName, currency,
        spend: 0, leads: 0, clicks: 0, interactions: 0,
        missingSpend: false, missingLeads: false, missingClicks: false, missingInteractions: false, count: 0 };
      campaigns.set(campaignKey, total);
    }
    total.count++;
    total.spend += values[0] || 0; total.missingSpend ||= values[0] === null;
    total.leads += values[1] || 0; total.missingLeads ||= values[1] === null;
    total.clicks += values[2] || 0; total.missingClicks ||= values[2] === null;
    total.interactions += values[3] || 0; total.missingInteractions ||= values[3] === null;
  }
  if (omitted) warned.add(`تم استبعاد ${omitted} سجلًا لعدم وجود اسم الحساب أو الحملة.`);
  if ([...campaigns.values()].some(x => !x.currency)) warned.add('عملة حساب Snapchat غير محددة في بيانات Windsor.ai. تحقق منها واضبط WINDSOR_SNAPCHAT_CURRENCY على السيرفر لعرض إجمالي الإنفاق حسب العملة.');
  if ([...campaigns.values()].some(x => x.id === x.name)) warned.add('Windsor.ai لم يرجع معرّف حملة مستقلًا؛ يتم التجميع باسم الحملة داخل الحساب. أضف campaign_id ضمن WINDSOR_SNAPCHAT_EXTRA_FIELDS عند دعمه لفصل الأسماء المتطابقة.');
  if (campaigns.size && [...campaigns.values()].every(x => x.missingInteractions)) warned.add('حقل engagements غير موجود في الاستجابة؛ النقرات متاحة بمقياس مستقل، ولا تُعتبر تفاعلات.');
  const reports = new Map<string, { account: { id: string; name: string; currency: string }; campaigns: Array<{ id: string; name: string; metrics: Json }>; incomplete: boolean; warnings: string[] }>();
  for (const campaign of campaigns.values()) {
    const key = JSON.stringify([campaign.accountId, campaign.currency]);
    if (!reports.has(key)) reports.set(key, { account: { id: campaign.accountId, name: campaign.accountName, currency: campaign.currency }, campaigns: [], incomplete: false, warnings: [] });
    reports.get(key)!.campaigns.push({ id: campaign.id, name: campaign.name, metrics: {
      spend: campaign.missingSpend ? null : Number(campaign.spend.toFixed(6)),
      leads: campaign.missingLeads ? null : campaign.leads,
      clicks: campaign.missingClicks ? null : campaign.clicks,
      interactions: campaign.missingInteractions ? null : campaign.interactions,
    } });
    if (campaign.missingSpend || campaign.missingLeads) reports.get(key)!.incomplete = true;
  }
  return { reports: [...reports.values()], warnings: [...warned] };
}

const resultCache = new Map<string, { time: number; payload: WindsorPayload }>();
async function windsorRows(key: string, from: string, to: string, fields: string[], connector: 'snapchat' | 'all'): Promise<unknown> {
  const url = new URL(`https://connectors.windsor.ai/${connector}`);
  url.searchParams.set('date_from', from);
  url.searchParams.set('date_to', to);
  url.searchParams.set('fields', fields.join(','));
  url.searchParams.set('api_key', key);
  url.searchParams.set('_max_rows', '50000');
  let response: Response;
  try { response = await fetch(url, { headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(22_000) }); }
  catch { throw new Error('تعذر الوصول لخدمة Windsor.ai أو انتهت المهلة'); }
  // Never include the upstream URL, query, headers or full error body: API key is in the URL.
  if (!response.ok) throw new Error(`Windsor.ai HTTP ${response.status} - تحقق من صلاحية مفتاح API والاشتراك`);
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > 16_000_000) throw new Error('نتيجة Windsor.ai كبيرة جدًا؛ اختر فترة أقصر');
  let data: Json;
  try { data = rowObject(await response.json()); }
  catch { throw new Error('Windsor.ai أعاد استجابة غير صالحة'); }
  if (!Array.isArray(data.data)) throw new Error('Windsor.ai لم يرجع حقل data كقائمة حملات');
  if (data.data.length > 35_000) throw new Error('عدد السجلات كبير؛ اختر فترة أقصر لتجنب النتائج الناقصة');
  return data.data;
}
export async function windsorSnapchatAdsData(from: string, to: string): Promise<WindsorPayload> {
  validateCampaignReportRange(from, to);
  const key = text(process.env.WINDSOR_SNAPCHAT_API_KEY);
  if (!key) return { status: 'unavailable', note: 'اضبط WINDSOR_SNAPCHAT_API_KEY داخل متغيرات Vercel لربط Snapchat Ads عبر Windsor.ai.', reports: [], errors: [] };
  const cacheKey = createHash('sha256').update(`${key}|${from}|${to}|${text(process.env.WINDSOR_SNAPCHAT_CURRENCY)}|${text(process.env.WINDSOR_SNAPCHAT_EXTRA_FIELDS)}`).digest('hex');
  const old = resultCache.get(cacheKey);
  if (old && old.time > Date.now()) return old.payload;
  const extra = text(process.env.WINDSOR_SNAPCHAT_EXTRA_FIELDS).split(',').map(x => x.trim()).filter(x => OPTIONAL_FIELDS.has(x));
  const detailedFields = [...new Set([...FIELDS, ...VERIFIED_DETAILS, ...extra])];
  let rows: unknown;
  let fallback: 'none' | 'all' | 'basic' = 'none';
  // Official Snapchat connector has account/campaign IDs and account currency.
  // Preserve the proven /all six-field Postman request as a last fallback.
  try { rows = await windsorRows(key, from, to, detailedFields, 'snapchat'); }
  catch {
    try { rows = await windsorRows(key, from, to, detailedFields, 'all'); fallback = 'all'; }
    catch { rows = await windsorRows(key, from, to, [...FIELDS], 'all'); fallback = 'basic'; }
  }
  const aggregated = aggregateWindsorSnapchat(rows, from, to, text(process.env.WINDSOR_SNAPCHAT_CURRENCY));
  const warnings = [...aggregated.warnings];
  if (fallback === 'basic') warnings.push('الحقول الموسعة غير متاحة لهذا الحساب؛ تم استخدام طلب Postman المجرب. راجع العملات ومعرفات الحملات.');
  if (fallback === 'all') warnings.push('تم جلب البيانات عبر /all بدل مسار Snapchat المباشر.');
  if (Array.isArray(rows) && rows.length >= 50000) warnings.push('نتيجة Windsor وصلت للحد الأعلى من الصفوف؛ قد تكون الفترة غير مكتملة. اختر فترة أقصر.');
  const payload: WindsorPayload = { status: 'ready',
    // Informational connector implementation notes are internal only. The
    // report shows real provider failures, not technical explanations.
    note: '', reports: aggregated.reports.map(report => ({ ...report, warnings })), errors: [] };
  resultCache.set(cacheKey, { time: Date.now() + 5 * 60_000, payload });
  if (resultCache.size > 16) resultCache.delete(resultCache.keys().next().value!);
  return payload;
}
