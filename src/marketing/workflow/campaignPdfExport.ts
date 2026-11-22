/** Read-only campaign and agenda summaries. The compact publishing schedule
 * groups matching product/idea pairs without changing publication records. */
import type { WorkPlanLine } from '../../../shared/marketing-workflow';
import { agendaPublicationSummary, campaignContentSummary, campaignSummaryNameKey, moneySAR } from './campaignOverview';
import { showDate } from './api';
import { campaignPlatformGoalRows, type CampaignPlatformGoals } from '../../../shared/marketing-campaign-goals';

export type CampaignPdfExportInput = {
  planName: string;
  planNo: string;
  creatorName?: string;
  createdAt?: string;
  fundingFrom?: string | null;
  fundingTo?: string | null;
  lines: WorkPlanLine[];
  platformGoals?: CampaignPlatformGoals[] | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  publishState?: string;
  /** productId → requirement readiness (execution section). Missing → «—». */
  readinessByProduct?: Record<string, number>;
  /** productId -> the real category returned by plan_products (strategy / task type). */
  categoryByProduct?: Record<string, string>;
};

/** رقم الطلب of a plan line: its task number + requirement order (TSK-000212-01).
 * The internal search-keywords product keeps its bare task number. */
export function planLineRequestNo(line: Pick<WorkPlanLine, 'task_no' | 'requirement_number'>): string {
  const taskNo = String(line.task_no || '').trim();
  const requirement = Number(line.requirement_number || 0);
  return taskNo && requirement > 0 && taskNo !== 'MANUAL-KEYWORDS' ? `${taskNo}-${String(requirement).padStart(2, '0')}` : taskNo;
}

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

function tile(label: string, value: unknown): string {
  return `<div class="tile"><span>${htmlText(label)}</span><strong>${htmlText(value)}</strong></div>`;
}

/** Extract ONLY the idea title from strategy briefs in the compact PDF.
 * Brief instructions, execution style and approved vehicle descriptions stay
 * in the source record and in full-detail views; they are not printed here.
 * Multiple embedded briefs remain separate titles, without their metadata.
 */
export function compactPublishingIdeaTitle(value: unknown): string {
  const raw = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  if (!raw) return '—';
  const briefParts = raw.split(/بريف\s+إبداعي\s*[:：]/gu);
  const candidates = briefParts.length > 1 ? briefParts.slice(1) : [raw];
  const titles = candidates.map(part => {
    const details = /(?:^|\s)(?:أسلوب\s+التنفيذ|السيارات\s+المعتمدة|التصور\s+البصري|التصميم\s+صورة\s+بصورة|تعليمات\s+التنفيذ|الهوك|النص\s*\/\s*الفويس\s*أوفر|الفويس\s*أوفر|السيناريو\s+التفصيلي|الجمهور\s+المستهدف|الكابشن|الهاشتاج|الهاشتاق)\s*[:：]/u.exec(part);
    const heading = (details ? part.slice(0, details.index) : part).replace(/\s+/g, ' ').trim();
    return heading.replace(/^(?:اسم\s+الفكرة|الفكرة)\s*[:：]\s*/u, '').trim();
  }).filter(Boolean);
  return [...new Set(titles)].join('\n') || '—';
}

export type PlanPdfScheduleRow = {
  product: string;
  category: string;
  idea: string;
  mediaKind: WorkPlanLine['media_kind'] | null;
  /** Date, executor, platform and request must remain paired for each scheduled entry. */
  publications: Array<{ platform: string; date: string | null; executor: string; requestNo: string; productId: string }>;
};

/** Display one product/idea pair once. Combine repeated posts by their
 * scheduled date, platform and executor, preserving the association between
 * all three instead of hiding a date or assigning it to the wrong platform.
 * This is display-only: publication records, budgets and post counts stay put. */
export function planPdfScheduleRows(lines: ReadonlyArray<WorkPlanLine>, categoryByProduct: Readonly<Record<string, string>> = {}): PlanPdfScheduleRow[] {
  type Group = PlanPdfScheduleRow & { publicationKeys: Set<string> };
  const grouped = new Map<string, Group>();
  for (const line of lines) {
    const product = String(line.idea_name || '').trim() || 'مطلوب بدون اسم';
    const category = String(categoryByProduct[line.product_id] || '').trim() || '—';
    const idea = compactPublishingIdeaTitle(line.product_idea);
    const mediaKind = line.media_kind === 'image' || line.media_kind === 'video' ? line.media_kind : null;
    const key = `${campaignSummaryNameKey(product)}\u0000${campaignSummaryNameKey(idea)}\u0000${mediaKind || ''}\u0000${campaignSummaryNameKey(category)}`;
    let group = grouped.get(key);
    if (!group) {
      group = { product, category, idea, mediaKind, publications: [], publicationKeys: new Set() };
      grouped.set(key, group);
    }
    const platform = String(line.platform_name || '').trim() || 'منصة غير محددة';
    const platformKey = String(line.platform_code || '').trim().toLocaleLowerCase('en') || campaignSummaryNameKey(platform);
    const executor = String(line.assignee_name || '').trim() || 'غير محدد';
    const rawDate = String(line.scheduled_on || '').slice(0, 10);
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? new Date(`${rawDate}T00:00:00Z`) : null;
    const date = parsedDate && !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === rawDate ? rawDate : null;
    const requestNo = planLineRequestNo(line);
    const productId = String(line.product_id || '');
    const publicationKey = `${platformKey}\u0000${date || ''}\u0000${campaignSummaryNameKey(executor)}\u0000${productId}`;
    if (!group.publicationKeys.has(publicationKey)) {
      group.publicationKeys.add(publicationKey);
      group.publications.push({ platform, date, executor, requestNo, productId });
    }
  }
  return [...grouped.values()].map(group => ({
    product: group.product, category: group.category, idea: group.idea, mediaKind: group.mediaKind,
    publications: group.publications.sort((a, b) =>
      (a.date || '9999-12-31').localeCompare(b.date || '9999-12-31') ||
      a.platform.localeCompare(b.platform, 'ar') || a.executor.localeCompare(b.executor, 'ar')),
  })).sort((a, b) =>
    (a.publications[0]?.date || '9999-12-31').localeCompare(b.publications[0]?.date || '9999-12-31') ||
    a.product.localeCompare(b.product, 'ar') || a.idea.localeCompare(b.idea, 'ar'));
}

/** The printable schedule is chronological across ALL product/idea groups.
 * A group can publish in both November and December, so sorting the product
 * groups by their first date is not sufficient: it interleaves the months.
 * Keep the original normalized groups for counting while flattening them to
 * one display row per (scheduled date, product, idea).
 */
export type PlanPdfChronologicalRow = {
  date: string | null;
  product: string;
  category: string;
  idea: string;
  mediaKind: WorkPlanLine['media_kind'] | null;
  executors: string[];
  platforms: string[];
  /** Unique products of this row: رقم الطلب + its product for readiness. */
  requests: Array<{ requestNo: string; productId: string }>;
};

export function planPdfChronologicalRows(lines: ReadonlyArray<WorkPlanLine>, categoryByProduct: Readonly<Record<string, string>> = {}): PlanPdfChronologicalRow[] {
  const chronological: PlanPdfChronologicalRow[] = [];
  for (const group of planPdfScheduleRows(lines, categoryByProduct)) {
    const dayRows = new Map<string, PlanPdfChronologicalRow & {
      executorKeys: Set<string>;
      platformKeys: Set<string>;
      requestKeys: Set<string>;
    }>();
    for (const item of group.publications) {
      const dayKey = item.date || '';
      let row = dayRows.get(dayKey);
      if (!row) {
        row = {
          date: item.date, product: group.product, category: group.category, idea: group.idea, mediaKind: group.mediaKind,
          executors: [], platforms: [], requests: [], executorKeys: new Set(), platformKeys: new Set(), requestKeys: new Set(),
        };
        dayRows.set(dayKey, row);
      }
      const requestKey = item.productId || item.requestNo;
      if (requestKey && !row.requestKeys.has(requestKey)) {
        row.requestKeys.add(requestKey);
        row.requests.push({ requestNo: item.requestNo, productId: item.productId });
      }
      const executorKey = campaignSummaryNameKey(item.executor);
      if (!row.executorKeys.has(executorKey)) {
        row.executorKeys.add(executorKey);
        row.executors.push(item.executor);
      }
      const platformKey = campaignSummaryNameKey(item.platform);
      if (!row.platformKeys.has(platformKey)) {
        row.platformKeys.add(platformKey);
        row.platforms.push(item.platform);
      }
    }
    for (const day of dayRows.values()) {
      chronological.push({
        date: day.date, product: day.product, category: day.category, idea: day.idea, mediaKind: day.mediaKind,
        executors: day.executors, platforms: day.platforms, requests: day.requests,
      });
    }
  }
  // Valid normalized ISO dates compare in year-month-day order. Undated rows
  // come last; within the same day, use a deterministic product/idea order.
  return chronological.sort((a, b) =>
    (a.date || '9999-12-31').localeCompare(b.date || '9999-12-31') ||
    a.product.localeCompare(b.product, 'ar') ||
    a.idea.localeCompare(b.idea, 'ar'));
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
  const goalRows = campaign ? campaignPlatformGoalRows(input.lines,input.platformGoals) : [];
  const goalTableRows = goalRows.map(row=>`<tr><td>${htmlText(row.platformName)}</td><td>${row.goals.length ? row.goals.map(goal=>htmlText(goal.name)).join('، ') : 'لم تُحدَّد أهداف بعد'}</td></tr>`).join('');
  const requirements = campaign ? summary.products.map(product => product.name) : agendaSummary?.requirements || [];
  const scheduleRows = planPdfScheduleRows(input.lines, input.categoryByProduct);
  // Flatten product/idea groups BEFORE printing so every day in November is
  // before every day in December. Merge repeated calendar days, and merge
  // adjacent identical products/ideas only when that does not break date order.
  const chronologicalRows = planPdfChronologicalRows(input.lines, input.categoryByProduct);
  const uniqueNames = (values: string[]) => values.map(value => `<div class="schedule-unique-name">${htmlText(value)}</div>`).join('');
  // رقم الطلب and الجاهزية are listed in the same order, one entry per product.
  const readinessOf = (productId: string) => {
    const value = input.readinessByProduct?.[productId];
    return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(Math.max(0, Math.min(100, value)))}%` : '—';
  };
  const requestCell = (row: PlanPdfChronologicalRow) => `<td class="schedule-requests">${row.requests.length
    ? row.requests.map(request => `<div class="schedule-meta-value" dir="ltr">${htmlText(request.requestNo || '—')}</div>`).join('') : '—'}</td>`;
  const readinessCell = (row: PlanPdfChronologicalRow) => `<td class="schedule-readiness">${row.requests.length
    ? row.requests.map(request => `<div class="schedule-meta-value">${htmlText(readinessOf(request.productId))}</div>`).join('') : '—'}</td>`;
  const sameContent = (a: PlanPdfChronologicalRow, b: PlanPdfChronologicalRow) =>
    campaignSummaryNameKey(a.product) === campaignSummaryNameKey(b.product) &&
    campaignSummaryNameKey(a.idea) === campaignSummaryNameKey(b.idea) &&
    campaignSummaryNameKey(a.category) === campaignSummaryNameKey(b.category) && a.mediaKind === b.mediaKind;
  const scheduleTableRows = `<tbody class="schedule-chronological">${chronologicalRows.map((row, index) => {
    const previous = chronologicalRows[index - 1];
    const dayStarts = !previous || row.date !== previous.date;
    const contentStarts = !previous || !sameContent(row, previous);
    const spanUntil = (predicate: (next: PlanPdfChronologicalRow) => boolean) => {
      let count = 1;
      while (index + count < chronologicalRows.length && predicate(chronologicalRows[index + count])) count++;
      return count;
    };
    const dateCell = dayStarts
      ? `<td class="schedule-dates" rowspan="${spanUntil(next => next.date === row.date)}">${htmlText(row.date ? summaryDate(row.date) : 'غير محدد')}</td>`
      : '';
    const contentSpan = contentStarts ? spanUntil(next => sameContent(row, next)) : 0;
    const ideaTitles = row.idea.split('\n').map(htmlText);
    const displayIdea = ideaTitles.length === 1 ? ideaTitles[0] : ideaTitles.map(title => `<div class="schedule-idea-title">${title}</div>`).join('');
    const mediaLabel = row.mediaKind === 'video' ? 'فيديو' : row.mediaKind === 'image' ? 'صورة' : '—';
    const contentCells = contentStarts
      ? `<td class="schedule-product" rowspan="${contentSpan}">${mediaLabel}</td><td class="schedule-category" rowspan="${contentSpan}">${htmlText(row.category)}</td><td class="schedule-idea" rowspan="${contentSpan}">${displayIdea}</td>`
      : '';
    return `<tr>${dateCell}${requestCell(row)}${contentCells}<td class="schedule-executors">${uniqueNames(row.executors)}</td>${readinessCell(row)}<td class="schedule-platforms">${uniqueNames(row.platforms)}</td></tr>`;
  }).join('')}</tbody>`;
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
.schedule-section{break-inside:auto}.schedule-section thead{display:table-header-group}
.schedule-section .schedule-chronological tr{break-inside:avoid;page-break-inside:avoid}
.schedule-section th{font-size:9pt}.schedule-section td{vertical-align:middle;overflow-wrap:anywhere;font-size:9pt}
.schedule-section th:nth-child(1){width:11%}.schedule-section th:nth-child(2){width:15%}
.schedule-section th:nth-child(3){width:9%}.schedule-section th:nth-child(4){width:13%}
.schedule-section th:nth-child(5){width:21%}.schedule-section th:nth-child(6){width:11%}
.schedule-section th:nth-child(7){width:9%}.schedule-section th:nth-child(8){width:11%}
.schedule-section td.schedule-dates{font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums}
.schedule-section td.schedule-product,.schedule-section td.schedule-category,.schedule-section td.schedule-idea{vertical-align:top}
.schedule-section td.schedule-executors,.schedule-section td.schedule-platforms,.schedule-section td.schedule-requests,.schedule-section td.schedule-readiness{padding-top:5px;padding-bottom:5px}
.schedule-section td.schedule-requests{font-size:8pt;font-variant-numeric:tabular-nums;overflow-wrap:normal;white-space:nowrap}
.schedule-section td.schedule-readiness{text-align:center;font-weight:700;font-variant-numeric:tabular-nums}
.schedule-unique-name,.schedule-meta-value{line-height:1.5;padding:2px 0}
.schedule-idea-title+.schedule-idea-title{margin-top:4px;padding-top:4px;border-top:1px dotted #e9ddd5}
.schedule-unique-name+.schedule-unique-name,.schedule-meta-value+.schedule-meta-value{border-top:1px dotted #e9ddd5}
.schedule-note{margin:0 0 6px;color:#80665c;font-size:8pt}
ul{margin:0;padding:0 20px 0 0;list-style:disc}li{padding:3px 0;border-bottom:1px solid #eee3da;overflow-wrap:anywhere;break-inside:avoid}
.empty{color:#80665c}@media screen{body{background:#eee8e2;padding:24px}main{background:#fff;padding:26px;box-shadow:0 8px 24px #0002}}
</style></head><body><main>
<header><small>منصة MZJ • تقرير ملخص ${htmlText(title)}</small><h1>${htmlText(input.planName)}</h1><p>رقم ${htmlText(title)}: ${htmlText(input.planNo)}</p></header>
<section><h2>بيانات ${htmlText(title)}</h2><div class="meta">${overview}</div></section>
<section><h2>${htmlText(periodTitle)}</h2><div class="stats">${funding}</div></section>
<section><h2>${campaign ? 'ميزانية كل منصة' : 'المنصات وعدد المنشورات'}</h2><table><thead><tr><th>المنصة</th><th>عدد المنشورات</th>${campaign ? '<th>الميزانية (ر.س)</th>' : ''}</tr></thead>
<tbody>${platformRows || `<tr><td colspan="${campaign ? 3 : 2}">لا توجد منصات</td></tr>`}</tbody></table></section>
${campaign ? `<section><h2>الهدف من الحملة حسب المنصة</h2><table><thead><tr><th>المنصة</th><th>الأهداف</th></tr></thead><tbody>${goalTableRows || '<tr><td colspan="2">لا توجد منصات</td></tr>'}</tbody></table></section>` : ''}
<section class="schedule-section"><h2>جدول النشر المختصر (${scheduleRows.length})</h2>
<p class="schedule-note">المطلوبات المختلفة (${requirements.length}) · الأفكار المختلفة (${summary.ideas.length}) — مرتب زمنيًا حسب السنة والشهر واليوم؛ لا يتكرر التاريخ داخل اليوم، ولا المنفذ أو المنصة داخل المنتج والفكرة في اليوم نفسه.</p>
<table><thead><tr><th>التاريخ</th><th>رقم الطلب</th><th>نوع المنتج</th><th>التصنيف</th><th>الفكرة</th><th>المنفذ</th><th>الجاهزية</th><th>المنصة</th></tr></thead>
${chronologicalRows.length ? scheduleTableRows : '<tbody><tr><td colspan="8">لا توجد منشورات</td></tr></tbody>'}</table></section>

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
