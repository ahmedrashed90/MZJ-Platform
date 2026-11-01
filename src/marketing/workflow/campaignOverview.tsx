import type { WorkPlanLine } from '../../../shared/marketing-workflow';
import { showDate } from './api';

export type CampaignPeriod = { funding_from?: string | null; funding_to?: string | null };
export type CampaignRequired = { id: string; name: string; idea: string };

/** Keep each content requirement and distinct idea only once even when
 * the same creative is scheduled across several platforms/post formats. */
export function campaignContentSummary(lines: WorkPlanLine[]) {
  const products = new Map<string, CampaignRequired>();
  const ideas = new Map<string, string>();
  const budgets = new Map<string, { platform: string; budget: number; count: number }>();
  for (const line of lines) {
    const productId = String(line.product_id || line.id);
    const name = (line.idea_name || '').trim() || 'مطلوب بدون اسم';
    const idea = (line.product_idea || '').trim();
    if (!products.has(productId)) products.set(productId, { id: productId, name, idea });
    // Normalize whitespace but preserve original Arabic text for display.
    if (idea && !ideas.has(idea.replace(/\s+/g, ' ').toLocaleLowerCase()))
      ideas.set(idea.replace(/\s+/g, ' ').toLocaleLowerCase(), idea);
    const platform = (line.platform_name || 'منصة غير محددة').trim();
    const platformKey = (line.platform_code || platform).trim().toLocaleLowerCase();
    const previous = budgets.get(platformKey) || { platform, budget: 0, count: 0 };
    previous.budget += Number(line.budget_amount || 0);
    previous.count += 1;
    budgets.set(platformKey, previous);
  }
  return {
    products: [...products.values()], ideas: [...ideas.values()],
    platforms: [...budgets.values()].sort((a, b) => a.platform.localeCompare(b.platform, 'ar')),
    total: [...budgets.values()].reduce((total, row) => total + row.budget, 0),
  };
}

/** Group all posts of a platform contiguously while retaining chronological
 * order within that platform. Shared by preparation and read-only report. */
export function campaignLinesByPlatform<T extends WorkPlanLine>(lines: T[]): T[] {
  return [...lines].sort((a, b) =>
    String(a.platform_name || '').localeCompare(String(b.platform_name || ''), 'ar') ||
    String(a.scheduled_on || '').localeCompare(String(b.scheduled_on || '')) ||
    String(a.post_type_name || '').localeCompare(String(b.post_type_name || ''), 'ar') ||
    String(a.id).localeCompare(String(b.id)));
}

export function moneySAR(value: number): string {
  return `${value.toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`;
}

export function CampaignOverview({ lines, fundingFrom, fundingTo }: {
  lines: WorkPlanLine[]; fundingFrom?: string | null; fundingTo?: string | null;
}) {
  const summary = campaignContentSummary(lines);
  const firstDay = fundingFrom || lines.map(line => String(line.scheduled_on || '').slice(0, 10)).filter(Boolean).sort()[0];
  return <section className="mkw-campaign-overview" aria-label="ملخص فترة التمويل والميزانية والمطلوبات">
    <div className="mkw-campaign-overview-stats">
      <div><small>تاريخ التمويل من</small><strong>{firstDay ? showDate(firstDay) : 'غير محدد'}</strong></div>
      <div><small>تاريخ التمويل إلى</small><strong>{fundingTo ? showDate(fundingTo) : 'غير محدد — حملة سابقة'}</strong></div>
      <div><small>إجمالي ميزانية الحملة</small><strong>{moneySAR(summary.total)}</strong></div>
    </div>
    <div className="mkw-campaign-overview-section"><h3>ميزانية كل منصة</h3>
      <div className="mkw-campaign-platform-totals">{summary.platforms.map(platform =>
        <div key={platform.platform}><span>{platform.platform} <small>({platform.count} منشور)</small></span><strong>{moneySAR(platform.budget)}</strong></div>)}</div>
    </div>
    <div className="mkw-campaign-unique-grid">
      <div><h3>المطلوبات ({summary.products.length})</h3><div className="mkw-campaign-unique-list">{summary.products.map(product => <div key={product.id}>{product.name}</div>)}</div></div>
      <div><h3>الأفكار المختلفة ({summary.ideas.length})</h3><div className="mkw-campaign-unique-list">{summary.ideas.length ? summary.ideas.map(idea => <div key={idea}>{idea}</div>) : <div>لم تُسجل فكرة</div>}</div></div>
    </div>
  </section>;
}
