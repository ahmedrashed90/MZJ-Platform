/** Unified, source-preserving paid-ad report contract.
 * Adding a platform requires only another registered server adapter returning this shape.
 * Reporting values are normalized to SAR. Unsupported/unknown source currencies
 * never contribute an invented conversion to paid spend or CPL.
 */
export type CampaignReportMetric = number | null;
export type CampaignReportRow = {
  key: string; platform: string; platformName: string; accountId: string;
  accountName: string; currency: string; sourceCurrency: string; exchangeRate: number | null; campaignId: string; campaignName: string;
  status: string; spend: CampaignReportMetric; clicks: CampaignReportMetric; leads: CampaignReportMetric;
  costPerLead: CampaignReportMetric; interactions: CampaignReportMetric;
  interactionsDefinition: string; managerName: string;
};
export type CampaignReportProvider = {
  platform: string; name: string; status: 'ready' | 'unavailable' | 'failed';
  note: string; incomplete: boolean; warnings: string[]; campaignCount: number;
};
export type CampaignReportPayload = {
  ok: true; from: string; to: string; generatedAt: string;
  rows: CampaignReportRow[]; providers: CampaignReportProvider[]; canEditManager?: boolean;
};

/** Accounting conversion requested by MZJ: fixed USD/SAR peg for reports. */
export const REPORT_CURRENCY = 'SAR' as const;
export const USD_TO_SAR = 3.75;
export function sarExchangeRate(sourceCurrency: unknown): number | null {
  const code = String(sourceCurrency ?? '').trim().toUpperCase();
  return code === 'SAR' ? 1 : code === 'USD' ? USD_TO_SAR : null;
}

const finiteMetric = (input: unknown): CampaignReportMetric => {
  if (input === null || input === undefined || input === '') return null;
  const result = Number(input);
  return Number.isFinite(result) && result >= 0 ? result : null;
};
export function normalizeCampaignReportRow(input: {
  platform: string; platformName: string; accountId: unknown; accountName: unknown;
  currency: unknown; campaignId: unknown; campaignName: unknown; managerName?: unknown; status: unknown;
  metrics: Record<string, unknown>; interactionField: string; interactionsDefinition: string;
}): CampaignReportRow {
  const metrics = input.metrics || {};
  const sourceCurrency = String(input.currency ?? '').trim().toUpperCase();
  const exchangeRate = sarExchangeRate(sourceCurrency);
  const nativeSpend = finiteMetric(metrics.spend);
  const spend = nativeSpend === null || exchangeRate === null ? null : Number((nativeSpend * exchangeRate).toFixed(6));
  const leads = finiteMetric(metrics.leads);
  const interactions = finiteMetric(metrics[input.interactionField]);
  const platform = String(input.platform || 'unknown');
  const accountId = String(input.accountId || '');
  const campaignId = String(input.campaignId || '');
  return {
    key: `${platform}:${accountId}:${campaignId}`, platform, platformName: input.platformName,
    accountId, accountName: String(input.accountName || accountId), currency: REPORT_CURRENCY, sourceCurrency, exchangeRate,
    campaignId, campaignName: String(input.campaignName || campaignId), status: String(input.status || ''),
    spend, clicks: finiteMetric(metrics.clicks), leads, costPerLead: spend !== null && leads !== null && leads > 0 ? spend / leads : null,
    interactions, interactionsDefinition: input.interactionsDefinition, managerName: String(input.managerName || '').trim(),
  };
}
export function validateCampaignReportRange(from: unknown, to: unknown) {
  const start = String(from ?? '');
  const end = String(to ?? '');
  const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
  if (!valid(start) || !valid(end) || start > end) throw new Error('حدد تاريخ «من» و«إلى» بصورة صحيحة.');
  if ((Date.parse(end) - Date.parse(start)) / 86_400_000 > 366) throw new Error('أقصى فترة للتقرير سنة واحدة.');
  return { from: start, to: end };
}
