/** Read-only consolidated report; does not modify ads, CRM or organic publishing.
 * Platform adapters have one stable contract. Future Snapchat Ads can be added
 * here without altering the report page, charts or exports.
 */
import { getSql } from './_db.js';
import { metaAdsData } from './_marketing-meta-ads.js';
import { googleAdsData } from './_marketing-google-ads.js';
import { tiktokAdsData } from './_marketing-tiktok-ads.js';
import { normalizeCampaignReportRow, validateCampaignReportRange,
  type CampaignReportPayload, type CampaignReportProvider, type CampaignReportRow } from '../shared/campaign-report.js';

type Sql = ReturnType<typeof getSql>;
type Json = Record<string, any>;
type Adapter = { code: string; name: string; interactionField: string; interactionDefinition: string;
  read: (sql: Sql, from: string, to: string) => Promise<Json> };

/** Canonical provider registry. Register additional paid-ad sources here. */
const ADAPTERS: readonly Adapter[] = [
  { code: 'meta', name: 'Meta Ads', interactionField: 'interactions', interactionDefinition: 'تفاعلات الإعلانات كما تعيدها Meta (post_engagement/page_engagement)',
    read: (sql, from, to) => metaAdsData(sql, 'last_30d', '', from, to) },
  { code: 'google', name: 'Google Ads', interactionField: 'engagements', interactionDefinition: 'مقياس engagements في Google Ads (قد يختلف عن إعجابات وتعليقات Meta)',
    read: (sql, from, to) => googleAdsData(sql, 'last_30d', '', from, to) },
  { code: 'tiktok', name: 'TikTok Ads', interactionField: 'interactions', interactionDefinition: 'تفاعلات TikTok الإعلانية عند إتاحتها (إعجابات + تعليقات + مشاركات)، دون المشاهدات',
    read: (sql, from, to) => tiktokAdsData(sql, 'last_30d', '', from, to, false) },
];

export async function consolidatedCampaignReport(sql: Sql, fromInput: unknown, toInput: unknown): Promise<CampaignReportPayload> {
  const { from, to } = validateCampaignReportRange(fromInput, toInput);
  const completed = await Promise.allSettled(ADAPTERS.map(adapter => adapter.read(sql, from, to)));
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
        rows.push(normalizeCampaignReportRow({
          platform: adapter.code, platformName: adapter.name,
          accountId: account.id, accountName: account.name, currency: account.currency,
          campaignId: campaign.id, campaignName: campaign.name, status: campaign.status || campaign.deliveryStatus,
          metrics: campaign.metrics || {}, interactionField: adapter.interactionField,
          interactionsDefinition: adapter.interactionDefinition,
        }));
      }
    }
    const connected = data.status === 'ready';
    providers.push({ platform: adapter.code, name: adapter.name,
      status: connected ? 'ready' : data.status === 'failed' ? 'failed' : 'unavailable',
      note: String(data.note || ''),
      incomplete: reports.some(report => Boolean(report.incomplete)) || Boolean(data.truncatedAccounts) || errors.length > 0,
      warnings, campaignCount });
  }
  // Neither empty API responses nor missing lead metrics can be treated as zero.
  rows.sort((a, b) => (b.spend ?? -1) - (a.spend ?? -1) || a.campaignName.localeCompare(b.campaignName, 'ar'));
  return { ok: true, from, to, generatedAt: new Date().toISOString(), rows, providers };
}
