import { Empty } from './components';
import { showDate } from './api';

/** Light module (no icons, no extra CSS): the native PlanReport imports it. */
export type StrategyDraftPlatform = { platformId: string; postTypes: Array<{ postTypeId: string; budget: number }> };
export type StrategyDraftIdea = {
  id: string; draftId: string; itemId: string; taskId: string; version: number;
  ideaCode: string; category: string; ideaName: string; mediaKind: 'image' | 'video'; itemStatus: string;
  taskNo: string; taskName: string; assignmentNo: string; orderNo: string; assigneeName: string;
  createdAt: string; dueOn: string | null; approvedOn: string | null; executionOn: string | null;
  publishOn: string | null; fundingOn: string | null; targetOn: string | null; scheduledOn: string | null;
  /** Read-only publication date linked to the same idea's agenda (campaign only). */
  agendaName?: string; agendaDraftId?: string;
  platforms: StrategyDraftPlatform[];
  formats: Array<{ id: string; platformId: string; platformName: string; platformCode: string; name: string }>;
  configured: boolean; executed: boolean; ready: boolean; missing: string[]; notes?: string[];
  /** Requirement readiness from the execution section (report only). */
  readiness?: number;
};
export type StrategyDraft = {
  id: string; kind: 'agenda' | 'campaign'; name: string; planNo: string | null; status: 'draft' | 'submitted'; workPlanId: string | null;
  createdAt: string; creatorName: string; platformGoals: Array<{ platformId: string; goalIds: string[] }>;
  ideas: StrategyDraftIdea[]; ideaCount: number; productCount: number; readyCount: number; executedCount: number; configuredCount: number;
  periodFrom: string | null; periodTo: string | null; platforms: Array<{ platformId: string; name: string }>; canEdit: boolean;
};

/** One product (work item) of an agenda/campaign, from strategy or marketing. */
export type PlanProductRow = {
  productId: string; taskNo: string;
  /** رقم الطلب: task number + requirement order, e.g. TSK-000212-01. */
  requestNo: string;
  /** رقم الحملة / رقم الأجندة. */
  planNo: string;
  category: string; mediaKind: string; assigneeName: string; ideaName: string; ideaCode: string;
  approvedOn: string | null; executionOn: string | null;
  readiness: number | null;
};
export type PlanProductsData = { ok: true; planNo: string; kind: 'agenda' | 'campaign'; rows: PlanProductRow[] };

const mediaName = (kind: string) => kind === 'video' ? 'فيديو' : 'صورة';
export const planNumberLabel = (kind: 'agenda' | 'campaign') => kind === 'campaign' ? 'رقم الحملة' : 'رقم الأجندة';

/** productId → readiness, for the printable compact schedule. */
export function planProductReadiness(rows: ReadonlyArray<PlanProductRow> | null | undefined): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows || []) if (row.readiness != null) result[row.productId] = row.readiness;
  return result;
}

function Readiness({ value }: { value: number | null }) {
  if (value == null) return <span className="mkw-muted">—</span>;
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  return <div className="mkw-product-readiness" title={`${percent}%`}><span><b style={{ width: `${percent}%` }}/></span><small>{percent}%</small></div>;
}

/** «بيانات المنتجات»: رقم التاسك ← رقم الطلب ← رقم الحملة/الأجندة ← باقي البيانات ← الجاهزية. */
export function PlanProductsTable({ rows, kind }: { rows: ReadonlyArray<PlanProductRow>; kind: 'agenda' | 'campaign' }) {
  return <div className="mkw-table-wrap mkw-strategy-products-table"><table>
    <thead><tr><th>م</th><th>رقم التاسك</th><th>رقم الطلب</th><th>{planNumberLabel(kind)}</th><th>التصنيف</th><th>المطلوب</th><th>اسم المنفذ</th><th>اسم الفكرة</th><th>تاريخ التنفيذ</th><th>الجاهزية</th></tr></thead>
    <tbody>{rows.map((row, index) => <tr key={row.productId || index}>
      <td><span className="mkw-code">{index + 1}</span></td>
      <td dir="ltr">{row.taskNo || '—'}</td>
      <td dir="ltr">{row.requestNo || '—'}</td>
      <td dir="ltr">{row.planNo || '—'}</td>
      <td>{row.category || '—'}</td>
      <td>{mediaName(row.mediaKind)}</td>
      <td>{row.assigneeName || '—'}</td>
      <td>{row.ideaName || '—'}{row.ideaCode && <small className="mkw-muted" style={{ display: 'block' }}>كود الفكرة: <span dir="ltr">{row.ideaCode}</span></small>}</td>
      <td>{showDate(row.executionOn)}{!row.approvedOn && <small className="mkw-muted" style={{ display: 'block' }}>موعد التسليم — لم يُنفذ بعد</small>}</td>
      <td><Readiness value={row.readiness}/></td>
    </tr>)}</tbody>
  </table>{!rows.length && <Empty>لا توجد منتجات</Empty>}</div>;
}

/** Strategy draft report: the same table built from the draft ideas. */
export function StrategyProductsTable({ draft }: { draft: StrategyDraft }) {
  const rows: PlanProductRow[] = draft.ideas.map(idea => ({
    productId: idea.itemId || idea.id, taskNo: idea.taskNo, requestNo: idea.assignmentNo, planNo: idea.orderNo || draft.planNo || '',
    category: idea.category, mediaKind: idea.mediaKind, assigneeName: idea.assigneeName, ideaName: idea.ideaName, ideaCode: idea.ideaCode,
    approvedOn: idea.approvedOn, executionOn: idea.executionOn, readiness: idea.readiness ?? null,
  }));
  return <PlanProductsTable rows={rows} kind={draft.kind}/>;
}

/** Shown in the plan report for EVERY agenda/campaign (strategy or marketing). */
export function PlanProductsSection({ data, loading, error }: { data: PlanProductsData | null; loading?: boolean; error?: string }) {
  if (!data) return loading || error ? <section className="mkw-plan-report-list mkw-strategy-plan-products" aria-label="بيانات المنتجات">
    <h3>بيانات المنتجات</h3><Empty>{error || 'جاري تحميل بيانات المنتجات...'}</Empty></section> : null;
  return <section className="mkw-plan-report-list mkw-strategy-plan-products" aria-label="بيانات المنتجات">
    <h3>بيانات المنتجات ({data.rows.length})</h3>
    <PlanProductsTable rows={data.rows} kind={data.kind}/>
  </section>;
}
