/** Display-only ordering for publishing cards in the Marketing dashboard.
 * Neither the source queries nor stored agenda/campaign status are changed.
 * Unstarted items are first, work in progress next, completed items last.
 */
import type { WorkPlanLine } from '../../../shared/marketing-workflow';
import type { StrategyDraft } from './StrategyProductsTable';

export type PublishingDashboardEntry =
  | { source: 'draft'; id: string; draft: StrategyDraft; priority: number; progress: number; createdAt: string }
  | { source: 'plan'; id: string; group: WorkPlanLine[]; priority: number; progress: number; createdAt: string };

/** A review/approval, preparation, activation or publication is an action. */
function planEntry(id: string, group: WorkPlanLine[]): PublishingDashboardEntry {
  const total = group.length;
  const prepared = group.filter(line => Number(line.prepared_count || 0) > 0 || Number(line.failed_count || 0) > 0).length;
  const published = group.filter(line => line.published_ready || Number(line.published_count || 0) > 0).length;
  const status = group[0]?.review_status || 'in_progress';
  const activated = group.some(line => Boolean(line.activated_at));
  const finished = status === 'published' || (total > 0 && group.every(line => Boolean(line.published_ready)));
  const untouched = status === 'in_progress' && prepared === 0 && published === 0 && !activated;
  return {
    source: 'plan', id, group,
    priority: finished ? 2 : untouched ? 0 : 1,
    progress: total ? (prepared + published) / (total * 2) : 0,
    createdAt: String(group[0]?.plan_created_at || ''),
  };
}

function draftEntry(draft: StrategyDraft): PublishingDashboardEntry {
  const total = draft.productCount || 0;
  const worked = Math.max(draft.configuredCount || 0, draft.executedCount || 0, draft.readyCount || 0);
  const untouched = draft.status === 'draft' && worked === 0;
  return {
    source: 'draft', id: draft.id, draft,
    priority: draft.status === 'submitted' ? 2 : untouched ? 0 : 1,
    progress: total ? worked / total : 0,
    createdAt: String(draft.createdAt || ''),
  };
}

/** Both strategy drafts and saved plans participate in the SAME priority order. */
export function publishingDashboardEntries(
  groups: ReadonlyMap<string, WorkPlanLine[]>, drafts: ReadonlyArray<StrategyDraft>,
): PublishingDashboardEntry[] {
  return [
    ...drafts.map(draftEntry),
    ...[...groups.entries()].filter(([, group]) => group.length > 0).map(([id, group]) => planEntry(id, group)),
  ].sort((a, b) =>
    a.priority - b.priority || a.progress - b.progress ||
    b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}
