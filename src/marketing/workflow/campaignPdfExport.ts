/** Print-ready, read-only summary for an MZJ campaign.
 * Browser native Print > Save as PDF avoids adding unreviewed client PDF
 * dependencies and retains proper Arabic shaping and selectable text.
 * Only campaign overview information is included; no publication rows,
 * captions, links, notes or unrelated dashboard content are exported.
 */
import type { WorkPlanLine } from '../../../shared/marketing-workflow';
import { campaignContentSummary, moneySAR } from './campaignOverview';
import { showDate } from './api';

export type CampaignPdfExportInput = {
  planName: string;
  planNo: string;
  creatorName?: string;
  createdAt?: string;
  fundingFrom?: string | null;
  fundingTo?: string | null;
  lines: WorkPlanLine[];
};

function htmlText(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function summaryDate(value?: string | null): string {
  return value ? showDate(value) : 'غير محدد';
}

function listHtml(values: string[], emptyText = 'لا توجد بيانات'): string {
  return values.length
    ? `<ul>${values.map(value => `<li>${htmlText(value)}</li>`).join('')}</ul>`
    : `<p class="empty">${htmlText(emptyText)}</p>`;
}

/** Pure HTML builder so content and totals can be regression-tested offline. */
export function campaignPdfSummaryHtml(input: CampaignPdfExportInput): string {
  const summary = campaignContentSummary(input.lines);
  const firstScheduled = input.lines.map(line => String(line.scheduled_on || '').slice(0, 10))
    .filter(Boolean).sort()[0];
  const from = input.fundingFrom || firstScheduled || null;
  const publishedCount = input.lines.filter(line => line.published_ready).length;
  const platformRows = summary.platforms.map(platform => `
      <tr><td>${htmlText(platform.platform)}</td>
          <td>${htmlText(String(platform.count))}</td>
          <td class="money">${htmlText(moneySAR(platform.budget))}</td></tr>`).join('');
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8"/>
<title>${htmlText(`ملخص الحملة - ${input.planName}`)}</title>
<style>
@page{size:A4 portrait;margin:15mm 14mm}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#4a211c;font-family:Tahoma,Arial,sans-serif;direction:rtl}
body{font-size:11pt;line-height:1.7;-webkit-print-color-adjust:exact;print-color-adjust:exact}
main{max-width:210mm;margin:auto}
header{border-bottom:3px solid #4a211c;padding-bottom:14px;margin-bottom:18px}
header small{color:#92776f;font-size:10pt}h1{font-size:20pt;margin:0 0 5px;font-weight:800}
header p{margin:0;color:#80665c}
section{margin-top:17px;page-break-inside:avoid;break-inside:avoid}
h2{font-size:12pt;margin:0 0 10px;font-weight:800;border-right:4px solid #4a211c;padding-right:10px}
.meta,.stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
.stats{grid-template-columns:repeat(3,minmax(0,1fr))}
.tile{border:1px solid #e5d7cd;background:#faf6f2;border-radius:8px;padding:11px;min-width:0}
.tile span{display:block;font-size:9pt;color:#82675f;margin-bottom:3px}
.tile strong{font-size:12pt;font-weight:800;overflow-wrap:anywhere}
.wide{grid-column:1/-1}
table{width:100%;border-collapse:collapse;text-align:right;direction:rtl;page-break-inside:auto}
th,td{padding:10px;border:1px solid #e5d7cd}th{background:#f3e8dc;color:#4a211c}tr{page-break-inside:avoid}
.money{font-weight:800;white-space:nowrap}ul{margin:0;padding:0 20px 0 0;list-style-type:disc}
li{padding:7px 0;border-bottom:1px solid #eee3da;overflow-wrap:anywhere;break-inside:avoid}
.empty{color:#80665c}@media screen{body{background:#eee8e2;padding:25px}main{background:white;padding:25px;box-shadow:0 8px 24px #0002}}
</style></head><body><main>
<header><small>منصة MZJ • تقرير ملخص الحملة</small><h1>${htmlText(input.planName)}</h1><p>رقم الحملة: ${htmlText(input.planNo)}</p></header>
<section><h2>بيانات الحملة</h2><div class="meta">
<div class="tile"><span>منشئ الحملة</span><strong>${htmlText(input.creatorName?.trim() || 'غير محدد')}</strong></div>
<div class="tile"><span>تاريخ الإنشاء</span><strong>${htmlText(summaryDate(input.createdAt))}</strong></div>
<div class="tile"><span>إجمالي المنشورات</span><strong>${htmlText(input.lines.length)}</strong></div>
<div class="tile"><span>تم نشره</span><strong>${htmlText(publishedCount)} من ${htmlText(input.lines.length)}</strong></div>
</div></section>
<section><h2>التمويل والميزانية</h2><div class="stats">
<div class="tile"><span>تاريخ التمويل من</span><strong>${htmlText(summaryDate(from))}</strong></div>
<div class="tile"><span>تاريخ التمويل إلى</span><strong>${htmlText(summaryDate(input.fundingTo))}</strong></div>
<div class="tile"><span>إجمالي ميزانية الحملة</span><strong>${htmlText(moneySAR(summary.total))}</strong></div>
</div></section>
<section><h2>ميزانية كل منصة</h2><table><thead><tr><th>المنصة</th><th>عدد المنشورات</th><th>الميزانية (ر.س)</th></tr></thead>
<tbody>${platformRows || '<tr><td colspan="3">لا توجد منصات</td></tr>'}</tbody></table></section>
<section><h2>المطلوبات المختلفة (${summary.products.length})</h2>${listHtml(summary.products.map(product => product.name))}</section>
<section><h2>الأفكار المختلفة (${summary.ideas.length})</h2>${listHtml(summary.ideas)}</section>
</main></body></html>`;
}

/** Called synchronously from a real click to satisfy popup restrictions.
 * In the new window the user selects Save as PDF in the print destination. */
export function exportCampaignSummaryPdf(input: CampaignPdfExportInput): void {
  const reportWindow = window.open('', '_blank', 'width=1000,height=900');
  if (!reportWindow) {
    throw new Error('تعذر فتح نافذة تصدير PDF؛ اسمح بفتح النوافذ المنبثقة ثم حاول مجددًا.');
  }
  reportWindow.document.open();
  reportWindow.document.write(campaignPdfSummaryHtml(input));
  reportWindow.document.close();
  reportWindow.focus();
  reportWindow.setTimeout(() => reportWindow.print(), 350);
}
