/** Dashboard-only ordering by the SAME readiness percentages rendered on the cards.
 * No persisted task, agenda, campaign or draft data is modified.
 */
import type { WorkPlanLine, WorkTask } from '../../../shared/marketing-workflow';
import type { StrategyDraft } from './StrategyProductsTable';

export type PublishingDashboardEntry =
  | { source: 'draft'; id: string; draft: StrategyDraft; readiness: number; createdAt: string }
  | { source: 'plan'; id: string; group: WorkPlanLine[]; readiness: number; createdAt: string };

/** Match the Readiness component's numeric normalization (including decimals). */
function normalizedReadiness(value: unknown): number {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

/** Numeric ascending readiness, then newest creation timestamp first. */
function byReadinessAndCreation(
  a: { id: string; readiness: number; createdAt: string },
  b: { id: string; readiness: number; createdAt: string },
): number {
  return a.readiness - b.readiness ||
    b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
}

/** The execution cards display task.readiness directly, including fractions. */
export function executionDashboardTasks(tasks: ReadonlyArray<WorkTask>): WorkTask[] {
  return [...tasks].sort((a, b) => byReadinessAndCreation(
    { id: a.id, readiness: normalizedReadiness(a.readiness), createdAt: String(a.created_at || '') },
    { id: b.id, readiness: normalizedReadiness(b.readiness), createdAt: String(b.created_at || '') },
  ));
}

/** The plan card displays Math.round(publishedReady / allLines * 100). */
function planEntry(id: string, group: WorkPlanLine[]): PublishingDashboardEntry {
  const readiness = group.length
    ? Math.round(group.filter(line => Boolean(line.published_ready)).length * 100 / group.length)
    : 0;
  return {
    source: 'plan', id, group,
    readiness: normalizedReadiness(readiness),
    createdAt: String(group[0]?.plan_created_at || ''),
  };
}

/** StrategyDraftCard shows readyCount / productCount, not configuredCount. */
function draftEntry(draft: StrategyDraft): PublishingDashboardEntry {
  const readiness = draft.productCount
    ? Math.round(draft.readyCount * 100 / draft.productCount)
    : 0;
  return {
    source: 'draft', id: draft.id, draft,
    readiness: normalizedReadiness(readiness),
    createdAt: String(draft.createdAt || ''),
  };
}

/** Drafts, agendas and campaigns share one ascending readiness order. */
export function publishingDashboardEntries(
  groups: ReadonlyMap<string, WorkPlanLine[]>, drafts: ReadonlyArray<StrategyDraft>,
): PublishingDashboardEntry[] {
  return [
    ...drafts.map(draftEntry),
    ...[...groups.entries()].filter(([, group]) => group.length > 0).map(([id, group]) => planEntry(id, group)),
  ].sort(byReadinessAndCreation);
}
