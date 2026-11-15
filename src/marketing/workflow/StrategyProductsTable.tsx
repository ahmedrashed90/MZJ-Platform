import { Empty } from './components';
import { showDate, useWorkQuery } from './api';

/** Light module (no icons, no CSS): the native PlanReport imports it, so the
 * strategy section adds nothing to plans that did not come from a draft. */
export type StrategyDraftPlatform = { platformId: string; postTypes: Array<{ postTypeId: string; budget: number }> };
export type StrategyDraftIdea = {
  id: string; draftId: string; itemId: string; taskId: string; version: number;
  ideaCode: string; category: string; ideaName: string; mediaKind: 'image' | 'video'; itemStatus: string;
  taskNo: string; taskName: string; assignmentNo: string; orderNo: string; assigneeName: string;
  createdAt: string; dueOn: string | null; approvedOn: string | null; executionOn: string | null;
  publishOn: string | null; fundingOn: string | null; targetOn: string | null; scheduledOn: string | null;
  platforms: StrategyDraftPlatform[];
  formats: Array<{ id: string; platformId: string; platformName: string; platformCode: string; name: string }>;
  configured: boolean; executed: boolean; ready: boolean; missing: string[];
};
export type StrategyDraft = {
  id: string; kind: 'agenda' | 'campaign'; name: string; planNo: string; status: 'draft' | 'submitted'; workPlanId: string | null;
  createdAt: string; creatorName: string; platformGoals: Array<{ platformId: string; goalIds: string[] }>;
  ideas: StrategyDraftIdea[]; ideaCount: number; productCount: number; readyCount: number; executedCount: number; configuredCount: number;
  periodFrom: string | null; periodTo: string | null; platforms: Array<{ platformId: string; name: string }>; canEdit: boolean;
};

const mediaName = (kind: string) => kind === 'video' ? 'فيديو' : 'صورة';

/** Product table shared by the draft card report and the plan report. */
export function StrategyProductsTable({ draft }: { draft: StrategyDraft }) {
  return <div className="mkw-table-wrap mkw-strategy-products-table"><table>
    <thead><tr><th>م</th><th>التصنيف</th><th>المطلوب</th><th>رقم التكليف</th><th>رقم التاسك</th><th>رقم الطلب</th><th>اسم المنفذ</th><th>اسم الفكرة</th><th>تاريخ التنفيذ</th></tr></thead>
    <tbody>{draft.ideas.map((idea, index) => <tr key={idea.id}>
      <td><span className="mkw-code">{index + 1}</span></td>
      <td>{idea.category || '—'}</td>
      <td>{mediaName(idea.mediaKind)}</td>
      <td dir="ltr">{idea.assignmentNo || '—'}</td>
      <td dir="ltr">{idea.taskNo || '—'}</td>
      <td dir="ltr">{idea.orderNo || '—'}</td>
      <td>{idea.assigneeName || '—'}</td>
      <td>{idea.ideaName}{idea.ideaCode && <small className="mkw-muted" style={{ display: 'block' }}>كود الفكرة: <span dir="ltr">{idea.ideaCode}</span></small>}</td>
      <td>{showDate(idea.executionOn)}{!idea.approvedOn && <small className="mkw-muted" style={{ display: 'block' }}>موعد التسليم — لم يُنفذ بعد</small>}</td>
    </tr>)}</tbody>
  </table>{!draft.ideas.length && <Empty>لا توجد أفكار</Empty>}</div>;
}

/** Shown inside the native PlanReport only for plans created from a strategy draft. */
export function StrategyPlanProductsSection({ planId }: { planId: string }) {
  const query = useWorkQuery<{ draft: StrategyDraft | null }>('strategy_report', { planId });
  if (!query.data?.draft) return null;
  return <section className="mkw-plan-report-list mkw-strategy-plan-products" aria-label="منتجات الاستراتيجية">
    <h3>بيانات المنتجات — من استراتيجية المحتوى ({query.data.draft.ideas.length})</h3>
    <StrategyProductsTable draft={query.data.draft}/>
  </section>;
}

