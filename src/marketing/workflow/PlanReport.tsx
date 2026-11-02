import { Fragment, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Empty, WorkAlert } from './components';
import { showDate, useWorkQuery } from './api';
import { PublicationTiming, planStatusName } from './PlanDetail';
import { PlanStatusBadges, planDisplayState } from './PlanStatus';
import { parseReviewNote } from '../../../shared/marketing-review-note-format';
import { CampaignOverview, campaignLinesByPlatform } from './campaignOverview';
import { exportCampaignSummaryPdf, exportPlanSummaryPdf } from './campaignPdfExport';
import type { WorkPlanLine } from '../../../shared/marketing-workflow';

type ReportPlan = {
  id: string; plan_no: string; name: string; kind: 'agenda' | 'campaign';
  created_at: string; creator_name?: string; review_status: string; status: string; review_note?: string;
  readiness: number; funding_from?: string | null; funding_to?: string | null; agenda_from?: string | null; agenda_to?: string | null;
};
type ReportHistory = {
  action: string; note: string; actor_name: string; created_at: string; category_name: string;
};
type ReportData = { plan: ReportPlan; lines: WorkPlanLine[]; history: ReportHistory[]; platforms?: Array<{ name: string; code?: string }> };

/** The dashboard report is read-only. Editing and approval remain in PlanDetail
 * (database management); post copy and URLs are entered in PreparationModal. */
export function PlanReport({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useWorkQuery<ReportData>('plan', { id });
  const [pdfError, setPdfError] = useState('');
  const plan = query.data?.plan;
  const lines = query.data?.lines || [];
  const displayLines = plan?.kind === 'campaign' ? campaignLinesByPlatform(lines) : lines;
  const published = lines.filter(line => line.published_ready).length;
  const isCampaign = plan?.kind === 'campaign';
  const approval = ['publishing', 'published'].includes(plan?.review_status || '')
    ? query.data?.history.find(entry => entry.action === 'approved') : null;
  const publishState = plan ? planStatusName(planDisplayState(plan.review_status, published, lines.length)) : ''; 

  return <Modal open title={`التقرير${plan ? ` — ${plan.name}` : ''}`} onClose={onClose} className="mkw-fullscreen mkw-plan-report-modal">
    <div className="mkw mkw-plan-report">
      <WorkAlert>{query.error || pdfError}</WorkAlert>
      {!plan ? <Empty>{query.loading ? 'جاري تحميل التقرير...' : query.error || 'لا توجد بيانات'}</Empty> : <>
        <div className="mkw-section-title mkw-plan-report-heading">
          <div><span className="mkw-code">{plan.plan_no}</span><strong>{isCampaign ? 'حملة' : 'أجندة'} · {plan.name}</strong></div>
          <div className="mkw-plan-report-badges">
            <button type="button" className="secondary mkw-campaign-export-pdf" title="اختر حفظ كـ PDF من نافذة الطباعة" onClick={() => {
              try {
                setPdfError('');
                const options = { planName: plan.name, planNo: plan.plan_no, creatorName: plan.creator_name,
                  createdAt: plan.created_at, fundingFrom: plan.funding_from, fundingTo: plan.funding_to,
                  lines, publishState, approvedByName: approval?.actor_name, approvedAt: approval?.created_at };
                if (isCampaign) exportCampaignSummaryPdf(options);
                else exportPlanSummaryPdf({ ...options, kind: 'agenda', agendaFrom: plan.agenda_from,
                  agendaTo: plan.agenda_to, platforms: query.data?.platforms || [] });
              } catch (error) { setPdfError(error instanceof Error ? error.message : 'تعذر تجهيز ملف PDF'); }
            }}>{isCampaign ? 'تصدير PDF — ملخص الحملة' : 'تصدير PDF — ملخص الأجندة'}</button>
            <span className="mkw-plan-report-readonly">للعرض فقط</span><PlanStatusBadges kind={plan.kind} reviewStatus={plan.review_status} publishedCount={published} totalCount={lines.length}/></div>
        </div>
        <div className="mkw-summary mkw-plan-report-summary">
          <div><small>منشئ {isCampaign ? 'الحملة' : 'الأجندة'}</small><strong>{plan.creator_name?.trim() || '—'}</strong></div>
          <div><small>تاريخ إنشاء الأجندة أو الحملة</small><strong>{showDate(plan.created_at)}</strong></div>
          <div><small>عدد المنشورات</small><strong>{lines.length}</strong></div>
          <div><small>حالة النشر</small><strong>{planStatusName(planDisplayState(plan.review_status, published, lines.length))}</strong></div>
          <div><small>المنشورات المنشورة</small><strong>{published} من {lines.length}</strong></div>
        </div>
        {isCampaign && <CampaignOverview lines={lines} fundingFrom={plan.funding_from} fundingTo={plan.funding_to}/>}
        {!isCampaign && <section className="mkw-agenda-window-overview mkw-summary" aria-label="فترة نشر الأجندة">
          <div><small>تاريخ نشر الأجندة من</small><strong>{showDate(plan.agenda_from)}</strong></div>
          <div><small>تاريخ نشر الأجندة إلى</small><strong>{showDate(plan.agenda_to)}</strong></div>
        </section>}
        <div className="mkw-plan-progress"><span>جاهزية النشر: {plan.readiness}% · {published} من {lines.length} روابط نشر</span><progress max={100} value={plan.readiness}/></div>
        {plan.review_status === 'revision' && !!plan.review_note && <section className="mkw-plan-review-note"><strong>مطلوب تعديل</strong><p>{plan.review_note}</p></section>}
        {!!query.data?.history.length && <details className="mkw-plan-history"><summary>سجل المراجعات والملاحظات السابقة ({query.data.history.length})</summary>
          {query.data.history.map((entry, index) => <article key={index}>
            <strong>{planStatusName(entry.action === 'approved' ? 'publishing' : entry.action === 'revision' ? 'revision' : 'submitted')} — {entry.actor_name}</strong>
            <small>{showDate(entry.created_at, true)}</small>
            {entry.category_name && <small>نوع الملاحظة: {entry.category_name}</small>}
            {entry.note && <div className="mkw-review-document">{parseReviewNote(entry.note).map((block, i) => <p key={i}>{block.text}</p>)}</div>}
          </article>)}
        </details>}
        <section className="mkw-plan-report-list" aria-label="تفاصيل المنشورات">
          <h3>تفاصيل النشر حسب المنصة ونوع المنشور ({lines.length})</h3>
          <div className="mkw-table-wrap mkw-plan-report-table"><table>
            <thead><tr>
              <th scope="col">{isCampaign ? 'تاريخ النشر المخطط' : 'تاريخ النشر'}</th>
              <th scope="col">المنتج</th>
              <th scope="col">الفكرة (فكرة المطلوب)</th>
              <th scope="col">المنصة</th>
              <th scope="col">نوع النشر</th>
              {isCampaign && <th scope="col">الميزانية (ر.س)</th>}
              <th scope="col">الكابشن</th>
              <th scope="col">الهاشتاج</th>
              <th scope="col">الالتزام بالموعد</th>
              <th scope="col">الحالة</th>
              <th scope="col">رابط المنشور</th>
            </tr></thead>
            <tbody>{displayLines.map((line, index) => <Fragment key={line.id}>{isCampaign && (index === 0 || displayLines[index - 1]?.platform_name !== line.platform_name) &&
              <tr className="mkw-platform-row-heading" key={`platform-${line.platform_code || line.platform_name}`}><th scope="rowgroup" colSpan={11}>{line.platform_name || 'منصة غير محددة'}</th></tr>}
              <tr key={line.id}>
              <td>{showDate(line.scheduled_on)}</td>
              <td className="mkw-plan-report-product"><strong>{line.idea_name}</strong><small>{line.task_no} · {line.task_name}</small></td>
              <td className="mkw-plan-idea-cell">{line.product_idea || '—'}</td>
              <td>{line.platform_name || '—'}</td>
              <td>{line.post_type_name || '—'}</td>
              {isCampaign && <td>{Number(line.budget_amount || 0).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2 })}</td>}
              <td><div className="mkw-plan-report-copy">{line.caption || 'لم يتم تجهيز الكابشن'}</div></td>
              <td><div className="mkw-plan-report-copy">{line.hashtags || 'لم يتم تجهيز الهاشتاج'}</div></td>
              <td><PublicationTiming line={line}/></td>
              <td>{line.published_ready ? 'تم النشر' : planStatusName(plan.status)}</td>
              <td>{line.effective_post_url
                ? <a className="mkw-plan-report-link" href={line.effective_post_url} target="_blank" rel="noopener noreferrer">فتح المنشور</a>
                : <span className="mkw-muted">لم يُنشر بعد</span>}</td>
            </tr></Fragment>)}</tbody>
          </table></div>
        </section>
      </>}
    </div>
  </Modal>;
}
