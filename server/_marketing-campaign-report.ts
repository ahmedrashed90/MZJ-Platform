/** Read-only consolidated report; does not modify ads, CRM or organic publishing.
 * Platform adapters have one stable contract. Future Snapchat Ads can be added
 * here without altering the report page, charts or exports.
 */
import { getSql } from './_db.js';
import { metaAdsData } from './_marketing-meta-ads.js';
import { googleAdsData } from './_marketing-google-ads.js';
import { tiktokAdsData } from './_marketing-tiktok-ads.js';
import { windsorSnapchatAdsData } from './_marketing-windsor-snapchat.js';
import { normalizeCampaignReportRow, validateCampaignReportRange,
  type CampaignReportPayload, type CampaignReportProvider, type CampaignReportRow } from '../shared/campaign-report.js';

type Sql = ReturnType<typeof getSql>;
type Json = Record<string, any>;
type Adapter = { code: string; name: string; interactionField: string; interactionDefinition: string;
  read: (sql: Sql, from: string, to: string, fresh: boolean) => Promise<Json> };

/** Canonical provider registry. Register additional paid-ad sources here. */
const ADAPTERS: readonly Adapter[] = [
  { code: 'meta', name: 'Meta Ads', interactionField: 'interactions', interactionDefinition: 'تفاعلات الإعلانات كما تعيدها Meta (post_engagement/page_engagement)',
    read: (sql, from, to) => metaAdsData(sql, 'last_30d', '', from, to) },
  { code: 'google', name: 'Google Ads', interactionField: 'engagements', interactionDefinition: 'مقياس engagements في Google Ads (قد يختلف عن إعجابات وتعليقات Meta)',
    read: (sql, from, to) => googleAdsData(sql, 'last_30d', '', from, to) },
  { code: 'tiktok', name: 'TikTok Ads', interactionField: 'interactions', interactionDefinition: 'تفاعلات TikTok الإعلانية عند إتاحتها (إعجابات + تعليقات + مشاركات)، دون المشاهدات',
    read: (sql, from, to, fresh) => tiktokAdsData(sql, 'last_30d', '', from, to, fresh ? 'true' : false) },
  { code: 'snapchat', name: 'Snapchat Ads', interactionField: 'interactions', interactionDefinition: 'تفاعلات إعلانات Snapchat عند توفر engagements من Windsor.ai؛ لا تُحسب النقرات تفاعلات',
    read: (_sql, from, to, fresh) => windsorSnapchatAdsData(from, to, fresh) },
];

export async function consolidatedCampaignReport(sql: Sql, fromInput: unknown, toInput: unknown, fresh = false): Promise<CampaignReportPayload> {
  const { from, to } = validateCampaignReportRange(fromInput, toInput);
  const completed = await Promise.allSettled(ADAPTERS.map(adapter => adapter.read(sql, from, to, fresh)));
  const rows: CampaignReportRow[] = [];
  const providers: CampaignReportProvider[] = [];
  for (let index = 0; index < ADAPTERS.length; index++) {
    const adapter = ADAPTERS[index];
    const result = completed[index];
    if (result.status === 'rejected') {
      providers.push({ platform: adapter.code, name: adapter.name, status: 'failed',
        note: 'تعذر الاتصال بالمنصة الإعلانية. افتح لوحة المنصة للتحقق من حالة الربط.', incomplete: true, warnings: [], campaignCount: 0 });
      continue;
    }
    const data = result.value;
    const reports: Json[] = Array.isArray(data.reports) ? data.reports : [];
    const errors = Array.isArray(data.errors) ? data.errors : [];
    const warnings = reports.flatMap(report => Array.isArray(report.warnings) ? report.warnings.map(String) : [])
      .concat(errors.map(error => `${String(error.accountId || '')}: ${String(error.message || 'تعذر قراءة الحساب')}`));
    let campaignCount = 0;
    for (const report of reports) {
      const account = report.account || {};
      const campaigns: Json[] = Array.isArray(report.campaigns) ? report.campaigns : [];
      for (const campaign of campaigns) {
        if (!campaign.id) continue;
        campaignCount++;
        const reportRow = normalizeCampaignReportRow({
          platform: adapter.code, platformName: adapter.name,
          accountId: account.id, accountName: account.name, currency: account.currency,
          campaignId: campaign.id, campaignName: campaign.name, managerName: campaign.managerName, status: campaign.status || campaign.deliveryStatus,
          metrics: campaign.metrics || {}, interactionField: adapter.interactionField,
          interactionsDefinition: adapter.interactionDefinition,
        });
        if (reportRow.exchangeRate === null && reportRow.spend === null) {
          const source = reportRow.sourceCurrency || 'غير محددة';
          const message = `عملة ${source} غير مدعومة للتحويل إلى الريال السعودي في حساب ${reportRow.accountName}؛ لم يُحتسب الصرف أو تكلفة الليد حتى لا يظهر رقم مضلل.`;
          if (!warnings.includes(message)) warnings.push(message);
        }
        rows.push(reportRow);
      }
    }
    const connected = data.status === 'ready';
    providers.push({ platform: adapter.code, name: adapter.name,
      status: connected ? 'ready' : data.status === 'failed' ? 'failed' : 'unavailable',
      note: String(data.note || ''),
      incomplete: reports.some(report => Boolean(report.incomplete)) || Boolean(data.truncatedAccounts) || errors.length > 0 || warnings.some(x => x.startsWith('عملة ')),
      warnings, campaignCount });
  }
  // Local names take priority over provider-local legacy Meta annotations.
  if (rows.length) {
    try {
      const saved = await sql<Array<{platform:string;account_id:string;campaign_id:string;manager_name:string}>>`
        select platform,account_id,campaign_id,manager_name from marketing.campaign_report_managers`;
      const byKey = new Map(saved.map(row => [`${row.platform}:${row.account_id}:${row.campaign_id}`,row.manager_name]));
      for (const row of rows) if (byKey.has(row.key)) row.managerName = byKey.get(row.key)!;
    } catch (error) {
      // A database not yet migrated retains the provider's read-only report.
      const code = String((error as {code?:string})?.code || '');
      if (!['42P01','3F000'].includes(code)) throw error;
    }
  }
  // Neither empty API responses nor missing lead metrics can be treated as zero.
  rows.sort((a, b) => (b.spend ?? -1) - (a.spend ?? -1) || a.campaignName.localeCompare(b.campaignName, 'ar'));
  return { ok: true, from, to, generatedAt: new Date().toISOString(), rows, providers };
}

/** Local annotation only. Does not touch budgets, ads or external providers. */
export async function saveCampaignReportManager(sql: Sql, input: {
  platform: unknown; accountId: unknown; campaignId: unknown; managerName: unknown; updatedBy: string;
}) {
  const platform = String(input.platform || '').trim().toLowerCase();
  const accountId = String(input.accountId || '').trim();
  const campaignId = String(input.campaignId || '').trim();
  const managerName = String(input.managerName || '').trim().replace(/\s+/g,' ');
  if (!ADAPTERS.some(adapter => adapter.code === platform)) throw new Error('منصة الحملات غير صالحة');
  if (!accountId || !campaignId || accountId.length > 180 || campaignId.length > 180 ||
      /[\u0000-\u001f]/.test(accountId+campaignId)) throw new Error('معرّف الحساب أو الحملة غير صالح');
  if (managerName.length > 120) throw new Error('اسم مدير الحملة يجب ألا يتجاوز 120 حرفًا');
  await sql`insert into marketing.campaign_report_managers
    (platform,account_id,campaign_id,manager_name,updated_by)
    values(${platform},${accountId},${campaignId},${managerName},${input.updatedBy}::uuid)
    on conflict(platform,account_id,campaign_id) do update
    set manager_name=excluded.manager_name,updated_by=excluded.updated_by,updated_at=now()`;
  return {ok:true,platform,accountId,campaignId,managerName};
}
