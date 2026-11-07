/** Google Ads reporting and explicit Search campaign management. Existing Meta/YouTube paths are untouched. */
import { getSql } from './_db.js';
import { getGoogleAdsAccessToken } from './_platform-connections.js';
import { googleAdsCustomerId, googleAdsRequest, googleAdsSearch, type GoogleAdsAccount } from './_google-ads-api.js';
import { metaAdsPreset, metaAdsTimeRange } from './_marketing-meta-ads.js';

type Sql = ReturnType<typeof getSql>;
const clean = (value: unknown) => String(value ?? '').trim();
const number = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const adsId = (value: unknown) => /^[0-9]{1,22}$/.test(clean(value)) ? clean(value) : '';
const LEAD_CATEGORIES = new Set(['SUBMIT_LEAD_FORM','QUALIFIED_LEAD','CONVERTED_LEAD','IMPORTED_LEAD','PHONE_CALL_LEAD','MESSAGE_LEAD','CONTACT','REQUEST_QUOTE','BOOK_APPOINTMENT']);

function period(presetValue: unknown, start: unknown, end: unknown) {
  const explicit = metaAdsTimeRange(start, end);
  const preset = metaAdsPreset(presetValue);
  const clause = explicit ? `BETWEEN '${explicit.since}' AND '${explicit.until}'`
    : `DURING ${({ today: 'TODAY', yesterday: 'YESTERDAY', last_7d: 'LAST_7_DAYS', last_30d: 'LAST_30_DAYS', this_month: 'THIS_MONTH' } as Record<string, string>)[preset]}`;
  return { dateRange: explicit, preset: explicit ? 'custom' : preset, clause };
}

async function loadAccountCampaigns(token: string, account: GoogleAdsAccount, clause: string) {
  const meta = await googleAdsSearch(token, account.id, `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.start_date, campaign.end_date, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED' LIMIT 1000`, account.loginCustomerId, 2);
  const [metricsResult, leadsResult, adsResult] = await Promise.allSettled([
    googleAdsSearch(token, account.id, `SELECT campaign.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.ctr, metrics.engagements, metrics.conversions FROM campaign WHERE segments.date ${clause} AND campaign.status != 'REMOVED' LIMIT 1000`, account.loginCustomerId, 2),
    googleAdsSearch(token, account.id, `SELECT campaign.id, segments.conversion_action_category, metrics.conversions FROM campaign WHERE segments.date ${clause} AND campaign.status != 'REMOVED' LIMIT 2000`, account.loginCustomerId, 3),
    googleAdsSearch(token, account.id, `SELECT campaign.id, ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.status, ad_group.name FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED' LIMIT 1000`, account.loginCustomerId, 2),
  ]);
  const metricsRows = metricsResult.status === 'fulfilled' ? metricsResult.value.rows : [];
  const leadRows = leadsResult.status === 'fulfilled' ? leadsResult.value.rows : [];
  const adRows = adsResult.status === 'fulfilled' ? adsResult.value.rows : [];
  const metricsById = new Map(metricsRows.map(row => [clean(row.campaign?.id), row.metrics || {}]));
  const leadsById = new Map<string, number>();
  for (const row of leadRows) {
    if (!LEAD_CATEGORIES.has(clean(row.segments?.conversionActionCategory))) continue;
    const id = clean(row.campaign?.id);
    leadsById.set(id, (leadsById.get(id) || 0) + number(row.metrics?.conversions));
  }
  const adsByCampaign = new Map<string, Array<{ id: string; name: string; status: string; type: string }>>();
  for (const row of adRows) {
    const campaignId = clean(row.campaign?.id);
    const ad = row.adGroupAd || {};
    const id = clean(ad.ad?.id);
    if (!id) continue;
    const ads = adsByCampaign.get(campaignId) || [];
    ads.push({ id, name: clean(row.adGroup?.name) || `إعلان ${id}`, status: clean(ad.status), type: clean(ad.ad?.type) });
    adsByCampaign.set(campaignId, ads);
  }
  const campaigns = meta.rows.map(row => {
    const campaign = row.campaign || {};
    const id = clean(campaign.id);
    const metric = metricsById.get(id) || {};
    const leads = leadsResult.status === 'fulfilled' ? (leadsById.get(id) || 0) : null;
    const spend = number(metric.costMicros) / 1_000_000;
    return {
      id, accountId: account.id, name: clean(campaign.name) || `حملة ${id}`,
      status: clean(campaign.status), channel: clean(campaign.advertisingChannelType),
      startTime: clean(campaign.startDate), stopTime: clean(campaign.endDate),
      dailyBudget: campaign.campaignBudget?.amountMicros === undefined && row.campaignBudget?.amountMicros === undefined ? null : number(row.campaignBudget?.amountMicros) / 1_000_000,
      metrics: {
        spend, impressions: number(metric.impressions), clicks: number(metric.clicks),
        ctr: number(metric.ctr), engagements: number(metric.engagements),
        conversions: number(metric.conversions), leads,
        costPerLead: leads !== null && leads > 0 ? spend / leads : null,
      },
      ads: adsByCampaign.get(id) || [],
    };
  }).filter(row => row.id);
  const warnings = [
    metricsResult.status === 'rejected' ? 'تعذر قراءة أداء الحملات للفترة المختارة' : '',
    leadsResult.status === 'rejected' ? 'تعذر تصنيف تحويلات الليد؛ ستظهر — بدلًا من عدد الليدات' : '',
    adsResult.status === 'rejected' ? 'تعذر قراءة الإعلانات الفرعية' : '',
  ].filter(Boolean);
  return {
    account, campaigns,
    incomplete: meta.incomplete || (metricsResult.status === 'fulfilled' && metricsResult.value.incomplete) || (leadsResult.status === 'fulfilled' && leadsResult.value.incomplete) || (adsResult.status === 'fulfilled' && adsResult.value.incomplete),
    warnings,
  };
}

export async function googleAdsData(sql: Sql, preset: unknown, accountId: unknown, dateFrom: unknown, dateTo: unknown) {
  const dates = period(preset, dateFrom, dateTo);
  const empty = { ok: true, status: 'needs_connection', accounts: [] as GoogleAdsAccount[], reports: [], errors: [],
    preset: dates.preset, dateRange: dates.dateRange, syncedAt: new Date().toISOString(), note: '' };
  let connection: Awaited<ReturnType<typeof getGoogleAdsAccessToken>>;
  try { connection = await getGoogleAdsAccessToken(sql); }
  catch (error) { return { ...empty, note: error instanceof Error ? error.message : 'اربط حساب Google Ads أولًا' }; }
  const accounts = connection.accounts.filter(account => !account.manager && connection.selectedAccountIds.includes(account.id));
  if (!accounts.length) return { ...empty, status: 'needs_account', note: 'اختر حسابًا إعلانيًا واحدًا على الأقل من صفحة ربط المنصات.', accounts: connection.accounts };
  const id = googleAdsCustomerId(accountId);
  if (clean(accountId) && (!id || !accounts.some(item => item.id === id))) {
    return { ...empty, status: 'needs_account', accounts, note: 'الحساب المطلوب غير محدد ضمن الحسابات الإعلانية المفعلة.' };
  }
  const targets = id ? accounts.filter(account => account.id === id) : accounts.slice(0, 10);
  const settled = await Promise.allSettled(targets.map(account => loadAccountCampaigns(connection.accessToken, account, dates.clause)));
  const reports = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  const errors = settled.flatMap((result, index) => result.status === 'rejected'
    ? [{ accountId: targets[index].id, message: result.reason instanceof Error ? result.reason.message : 'فشل قراءة حملات Google Ads' }] : []);
  return { ...empty, status: reports.length ? 'ready' : 'failed', accounts, reports, errors,
    note: accounts.length > targets.length ? 'تم عرض أول 10 حسابات فقط لحماية حدود API اليومية.' : '' };
}

async function targetAccount(sql: Sql, idInput: unknown) {
  const id = googleAdsCustomerId(idInput);
  const connection = await getGoogleAdsAccessToken(sql);
  const account = connection.accounts.find(item => item.id === id && !item.manager && connection.selectedAccountIds.includes(item.id));
  if (!account) throw new Error('الحساب الإعلاني غير محدد ضمن حسابات Google Ads المربوطة');
  return { ...connection, account };
}

/** Changing status is explicitly authorized in the UI, never run as a side effect of reading reports. */
export async function changeGoogleAdsCampaignStatus(sql: Sql, body: Record<string, any>) {
  const { accessToken, account } = await targetAccount(sql, body.accountId);
  const campaignId = adsId(body.campaignId);
  const status = clean(body.status);
  if (!campaignId || !['ENABLED', 'PAUSED'].includes(status)) throw new Error('حدد الحملة وحالتها بشكل صحيح');
  if (status === 'ENABLED' && body.confirmSpend !== true) throw new Error('يجب تأكيد تشغيل الحملة واحتمال الإنفاق الإعلاني');
  const actual = await googleAdsSearch(accessToken, account.id, `SELECT campaign.id, campaign.status FROM campaign WHERE campaign.id = ${campaignId} LIMIT 1`, account.loginCustomerId);
  if (!actual.rows.some(row => clean(row.campaign?.id) === campaignId)) throw new Error('الحملة غير موجودة داخل الحساب المختار');
  if (actual.rows[0]?.campaign?.status === 'REMOVED') throw new Error('الحملة محذوفة ولا يمكن إعادة تشغيلها');
  await googleAdsRequest(accessToken, `/customers/${account.id}/campaigns:mutate`, {
    method: 'POST', loginCustomerId: account.loginCustomerId,
    body: { operations: [{ update: { resourceName: `customers/${account.id}/campaigns/${campaignId}`, status }, updateMask: 'status' }] },
  });
  return { ok: true, accountId: account.id, campaignId, status, message: status === 'ENABLED' ? 'تم إرسال طلب تشغيل الحملة إلى Google Ads' : 'تم إرسال طلب إيقاف الحملة إلى Google Ads' };
}

function stringList(value: unknown, max: number, maxLength: number): string[] {
  return [...new Set((Array.isArray(value) ? value : clean(value).split(/\r?\n/))
    .map(clean).filter(Boolean))].slice(0, max).filter(x => x.length <= maxLength);
}

/** Create a complete Search campaign in PAUSED status; activation is always separate. */
export async function createPausedGoogleAdsSearchCampaign(sql: Sql, body: Record<string, any>) {
  const { accessToken, account } = await targetAccount(sql, body.accountId);
  const name = clean(body.name);
  const budget = Number(body.dailyBudget);
  const landing = clean(body.finalUrl);
  const headlines = stringList(body.headlines, 15, 30);
  const descriptions = stringList(body.descriptions, 4, 90);
  const keywords = stringList(body.keywords, 20, 80);
  if (!name || name.length > 120) throw new Error('اسم الحملة مطلوب وبحد أقصى 120 حرفًا');
  if (!Number.isFinite(budget) || budget < 10 || budget > 100000) throw new Error('الميزانية اليومية يجب أن تكون بين 10 و100000 بعملة الحساب');
  if (headlines.length < 3 || descriptions.length < 2 || !keywords.length) throw new Error('مطلوب 3 عناوين مختلفة ووصفان مختلفان وكلمة مفتاحية على الأقل');
  let finalUrl: URL;
  try { finalUrl = new URL(landing); } catch { throw new Error('رابط صفحة الهبوط غير صحيح'); }
  if (finalUrl.protocol !== 'https:' || !finalUrl.hostname.includes('.')) throw new Error('رابط صفحة الهبوط يجب أن يبدأ بـ https://');
  // All temporary resource IDs must be unique and parents precede children.
  const id = account.id;
  const budgetResource = `customers/${id}/campaignBudgets/-1`;
  const campaignResource = `customers/${id}/campaigns/-2`;
  const adGroupResource = `customers/${id}/adGroups/-3`;
  const operations: Record<string, any>[] = [
    { campaignBudgetOperation: { create: { resourceName: budgetResource, name: `${name} | Budget`, amountMicros: String(Math.round(budget * 1e6)), deliveryMethod: 'STANDARD', explicitlyShared: false } } },
    { campaignOperation: { create: { resourceName: campaignResource, name, status: 'PAUSED', advertisingChannelType: 'SEARCH', campaignBudget: budgetResource, maximizeClicks: {}, networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false } } } },
    { campaignCriterionOperation: { create: { campaign: campaignResource, location: { geoTargetConstant: 'geoTargetConstants/2682' } } } },
    { adGroupOperation: { create: { resourceName: adGroupResource, campaign: campaignResource, name: `${name} | Search`, status: 'ENABLED', type: 'SEARCH_STANDARD' } } },
    ...keywords.map(keyword => ({ adGroupCriterionOperation: { create: { adGroup: adGroupResource, status: 'ENABLED', keyword: { text: keyword, matchType: 'PHRASE' } } } })),
    { adGroupAdOperation: { create: { adGroup: adGroupResource, status: 'ENABLED', ad: { finalUrls: [finalUrl.toString()], responsiveSearchAd: { headlines: headlines.map(text => ({ text })), descriptions: descriptions.map(text => ({ text })) } } } } },
  ];
  // Validation rejects unsupported combinations before any remote resource is created.
  const endpoint = `/customers/${id}/googleAds:mutate`;
  await googleAdsRequest(accessToken, endpoint, { method: 'POST', loginCustomerId: account.loginCustomerId, body: { mutateOperations: operations, validateOnly: true, partialFailure: false } });
  const result = await googleAdsRequest(accessToken, endpoint, { method: 'POST', loginCustomerId: account.loginCustomerId, body: { mutateOperations: operations, partialFailure: false } });
  const campaignResourceName = (Array.isArray(result.mutateOperationResponses) ? result.mutateOperationResponses : [])
    .map((row: any) => row.campaignResult?.resourceName || row.campaignOperationResponse?.resourceName).find(Boolean) || '';
  return { ok: true, campaignResourceName, accountId: account.id, message: 'تم إنشاء مسودة حملة Search وإعلانها في Google Ads بحالة متوقفة، دون بدء الإنفاق.' };
}

export const googleAdsTestHelpers = { period, stringList, LEAD_CATEGORIES };
