/** Print-only, read-only campaign and agenda summaries. Publication rows stay
 * exclusively in the existing report; this export never duplicates them. */
import type { WorkPlanLine } from '../../../shared/marketing-workflow';
import { agendaPublicationSummary, campaignContentSummary, campaignSummaryNameKey, moneySAR } from './campaignOverview';
import { showDate } from './api';

export type CampaignPdfExportInput = {
  planName: string;
  planNo: string;
  creatorName?: string;
  createdAt?: string;
  fundingFrom?: string | null;
  fundingTo?: string | null;
  lines: WorkPlanLine[];
  approvedByName?: string | null;
  approvedAt?: string | null;
  publishState?: string;
};

export type PlanPdfExportInput = CampaignPdfExportInput & {
  kind: 'campaign' | 'agenda';
  agendaFrom?: string | null;
  agendaTo?: string | null;
  /** The configured platform catalog, not just platforms present in this plan. */
  platforms?: Array<{ name: string; code?: string }>;
};

const htmlText = (value: unknown): string => String(value ?? '').replace(/&/g, '&amp;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const summaryDate = (value?: string | null) => value ? showDate(value) : 'غير محدد';

export function inclusivePlanDays(from?: string | null, to?: string | null): number | null {
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from.slice(0, 10)) || !/^\d{4}-\d{2}-\d{2}$/.test(to.slice(0, 10))) return null;
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 86400000) + 1;
}

export function planApprovalTime(value?: string | null): string {
  if (!value) return 'غير محدد';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'غير محدد';
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(date);
}

/** One approval label for the report screen and the printable summary. */
export function planApprovalLabel(name?: string | null, approvedAt?: string | null): string {
  return name?.trim() ? `${name.trim()} — ${planApprovalTime(approvedAt)}` : 'لم يتم الاعتماد بعد';
}

/** Use the same legacy-date fallback on-screen and in the exported agenda PDF. */
export function agendaPublicationRange(
  lines: WorkPlanLine[], agendaFrom?: string | null, agendaTo?: string | null,
) {
  const dates = lines.map(line => String(line.scheduled_on || '').slice(0, 10)).filter(Boolean).sort();
  return { from: agendaFrom || dates[0] || null, to: agendaTo || dates.at(-1) || null };
}

function listHtml(values: string[], emptyText = 'لا توجد بيانات'): string {
  return values.length ? `<ul>${values.map(value => `<li>${htmlText(value)}</li>`).join('')}</ul>`
    : `<p class="empty">${htmlText(emptyText)}</p>`;
}
function tile(label: string, value: unknown): string {
  return `<div class="tile"><span>${htmlText(label)}</span><strong>${htmlText(value)}</strong></div>`;
}

/** Pure, safe HTML generator. Clicking Print > Save as PDF creates the file. */
export function planPdfSummaryHtml(input: PlanPdfExportInput): string {
  const campaign = input.kind === 'campaign';
  const summary = campaignContentSummary(input.lines);
  const agendaSummary = campaign ? null : agendaPublicationSummary(input.lines, input.platforms || []);
  const published = input.lines.filter(line => line.published_ready).length;
  const firstScheduled = input.lines.map(line => String(line.scheduled_on || '').slice(0, 10)).filter(Boolean).sort()[0];
  const agendaRange = agendaSummary ? agendaPublicationRange(input.lines, input.agendaFrom, input.agendaTo) : null;
  const from = campaign ? input.fundingFrom || firstScheduled || null : agendaRange?.from || null;
  const to = campaign ? input.fundingTo || null : agendaRange?.to || null;
  const days = inclusivePlanDays(from, to);
  const approval = planApprovalLabel(input.approvedByName, input.approvedAt);
  const platformCounts = new Map(summary.platforms.map(item => [campaignSummaryNameKey(item.platform), item]));
  const platformRows = (campaign ? summary.platforms.map(item => item.platform) : agendaSummary?.platforms.map(item => item.name) || []).map(name => {
    const value = platformCounts.get(campaignSummaryNameKey(name));
    return `<tr><td>${htmlText(name)}</td><td>${htmlText(value?.count ?? 0)}</td>${campaign ? `<td class="money">${htmlText(moneySAR(value?.budget || 0))}</td>` : ''}</tr>`;
  }).join('');
  const requirements = campaign ? summary.products.map(product => product.name) : agendaSummary?.requirements || [];
  const title = campaign ? 'الحملة' : 'الأجندة';
  const periodTitle = campaign ? 'التمويل والميزانية' : 'فترة نشر الأجندة';
  const overview = [
    tile('تاريخ الإنشاء', summaryDate(input.createdAt)),
    tile(`منشئ ${title}`, input.creatorName?.trim() || 'غير محدد'),
    tile('إجمالي المنشورات', input.lines.length),
    tile('حالة النشر', input.publishState || (published === input.lines.length && input.lines.length ? 'تم النشر' : 'جاري النشر')),
    tile('تم نشره', `${published} من ${input.lines.length}`),
    tile('الاعتماد — المستخدم والتاريخ والساعة', approval),
  ].join('');
  const funding = [
    tile(campaign ? 'تاريخ التمويل من' : 'تاريخ نشر الأجندة من', summaryDate(from)),
    tile(campaign ? 'تاريخ التمويل إلى' : 'تاريخ نشر الأجندة إلى', summaryDate(to)),
    tile('المدة', days == null ? 'غير محددة' : `${days} يوم`),
    ...(campaign ? [tile('إجمالي ميزانية الحملة', moneySAR(summary.total))] : []),
  ].join('');
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8"/>
<title>${htmlText(`ملخص ${title} - ${input.planName}`)}</title>
<style>
@page{size:A4 portrait;margin:11mm 12mm}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#4a211c;font-family:Tajawal,Tahoma,Arial,sans-serif;direction:rtl}
body{font-size:9.6pt;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
main{max-width:210mm;margin:auto}header{border-bottom:3px solid #4a211c;padding-bottom:9px;margin-bottom:11px}
header small{color:#92776f;font-size:9pt}h1{font-size:17pt;margin:2px 0 4px;font-weight:800;overflow-wrap:anywhere}
header p{margin:0;color:#80665c}section{margin-top:11px;break-inside:avoid}
h2{font-size:11pt;margin:0 0 6px;border-right:4px solid #4a211c;padding-right:10px}
.meta,.stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.tile{border:1px solid #e5d7cd;background:#f9f5f0;border-radius:8px;padding:7px 9px;min-width:0}
.tile span{display:block;font-size:8.5pt;color:#80665c;margin-bottom:3px}.tile strong{font-size:10.1pt;overflow-wrap:anywhere}
table{width:100%;border-collapse:collapse;text-align:right;direction:rtl}th,td{padding:6px 9px;border:1px solid #e5d7cd}
th{background:#f3e8dc}tr{break-inside:avoid}.money{font-weight:800;white-space:nowrap}
ul{margin:0;padding:0 20px 0 0;list-style:disc}li{padding:3px 0;border-bottom:1px solid #eee3da;overflow-wrap:anywhere;break-inside:avoid}
.empty{color:#80665c}@media screen{body{background:#eee8e2;padding:24px}main{background:#fff;padding:26px;box-shadow:0 8px 24px #0002}}
</style></head><body><main>
<header><small>منصة MZJ • تقرير ملخص ${htmlText(title)}</small><h1>${htmlText(input.planName)}</h1><p>رقم ${htmlText(title)}: ${htmlText(input.planNo)}</p></header>
<section><h2>بيانات ${htmlText(title)}</h2><div class="meta">${overview}</div></section>
<section><h2>${htmlText(periodTitle)}</h2><div class="stats">${funding}</div></section>
<section><h2>${campaign ? 'ميزانية كل منصة' : 'المنصات وعدد المنشورات'}</h2><table><thead><tr><th>المنصة</th><th>عدد المنشورات</th>${campaign ? '<th>الميزانية (ر.س)</th>' : ''}</tr></thead>
<tbody>${platformRows || `<tr><td colspan="${campaign ? 3 : 2}">لا توجد منصات</td></tr>`}</tbody></table></section>
<section><h2>المطلوبات المختلفة (${requirements.length})</h2>${listHtml(requirements)}</section>
<section><h2>الأفكار المختلفة (${summary.ideas.length})</h2>${listHtml(summary.ideas)}</section>
</main></body></html>`;
}

/** Backward-compatible campaign export for existing report and preparation. */
export function campaignPdfSummaryHtml(input: CampaignPdfExportInput): string {
  return planPdfSummaryHtml({ ...input, kind: 'campaign' });
}

/** Open the printable HTML synchronously from the user click (popup safe). */
export function exportPlanSummaryPdf(input: PlanPdfExportInput): void {
  const popup = window.open('', '_blank', 'width=1000,height=900');
  if (!popup) throw new Error('تعذر فتح نافذة تصدير PDF؛ اسمح بفتح النوافذ المنبثقة ثم حاول مجددًا.');
  popup.document.open();
  popup.document.write(planPdfSummaryHtml(input));
  popup.document.close();
  popup.focus();
  popup.setTimeout(() => popup.print(), 350);
}
export function exportCampaignSummaryPdf(input: CampaignPdfExportInput): void {
  exportPlanSummaryPdf({ ...input, kind: 'campaign' });
}
