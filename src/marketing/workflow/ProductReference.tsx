import type { WorkPlanLine, WorkProduct } from '../../../shared/marketing-workflow';

type ProductDetails = Pick<WorkPlanLine,'task_no'|'requirement_number'|'assignee_name'> | Pick<WorkProduct,'task_no'|'requirement_number'|'assignee_name'>;

/** Requirement position is assigned by the server over the task's original item order. */
export function ProductReference({title,details}:{title:string;details:ProductDetails}) {
  const manual = details.task_no === 'MANUAL-KEYWORDS';
  const number = manual ? 0 : Number(details.requirement_number || 0);
  return <span className="mkw-product-reference">
    <strong>{title || '—'}</strong>
    <small>{manual ? 'منتج يدوي' : <span dir="ltr">{details.task_no || '—'}</span>}
      {number > 0 && <> - المطلوب {number}</>}
      {!manual && <> {' - '}{details.assignee_name?.trim() || 'منفذ غير محدد'}</>}
    </small>
  </span>;
}
