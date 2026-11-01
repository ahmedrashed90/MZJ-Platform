import { Check } from '@phosphor-icons/react';

/** Review approval and publication progress are independent stages. */
export type PlanPublicationState = 'in_progress' | 'revision' | 'submitted' | 'publishing' | 'published';

export function planDisplayState(reviewStatus: string, publishedCount: number, totalCount: number): PlanPublicationState {
  if (reviewStatus === 'publishing' || reviewStatus === 'published') {
    return totalCount > 0 && publishedCount >= totalCount ? 'published' : 'publishing';
  }
  if (reviewStatus === 'revision' || reviewStatus === 'submitted') return reviewStatus;
  return 'in_progress';
}

export const planStateLabels: Record<PlanPublicationState, string> = {
  in_progress: 'قيد التنفيذ',
  revision: 'مطلوب تعديل',
  submitted: 'قيد المراجعة',
  publishing: 'جاري النشر',
  published: 'تم النشر',
};

/** Shared, unobtrusive indicators for the dashboard, review and read-only report. */
export function PlanStatusBadges({ kind, reviewStatus, publishedCount, totalCount, onDetails }: {
  kind: 'agenda' | 'campaign';
  reviewStatus: string;
  publishedCount: number;
  totalCount: number;
  onDetails?: () => void;
}) {
  const status = planDisplayState(reviewStatus, publishedCount, totalCount);
  const approved = reviewStatus === 'publishing' || reviewStatus === 'published';
  const approvalLabel = kind === 'agenda' ? 'أجندة معتمدة' : 'حملة معتمدة';
  return <div className="mkw-plan-status-badges" aria-label="الاعتماد وحالة النشر">
    {approved && (onDetails
      ? <button type="button" className="mkw-plan-approval-tag" title="فتح تفاصيل الاعتماد" onClick={onDetails}><Check size={14} weight="bold"/>{approvalLabel}</button>
      : <span className="mkw-plan-approval-tag"><Check size={14} weight="bold"/>{approvalLabel}</span>)}
    <span className={`mkw-plan-progress-tag is-${status}`} role="status">
      <span className="mkw-plan-progress-dot" aria-hidden="true"/>
      {planStateLabels[status]}
      {approved && <small dir="ltr">{publishedCount}/{totalCount}</small>}
    </span>
  </div>;
}
