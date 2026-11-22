/** Dashboard-only readiness ordering. Never mutate fetched task, draft or plan data. */
import type { WorkPlanLine, WorkTask } from '../../../shared/marketing-workflow';
import type { StrategyDraft } from './StrategyProductsTable';

export type PublishingDashboardEntry =
  | { source: 'draft'; id: string; draft: StrategyDraft; priority: number; progress: number; createdAt: string }
  | { source: 'plan'; id: string; group: WorkPlanLine[]; priority: number; progress: number; createdAt: string };

const safeReadiness = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;

/** The execution cards display task.readiness, so sort using that same number. */
export function executionDashboardTasks(tasks: ReadonlyArray<WorkTask>): WorkTask[] {
  return [...tasks].sort((a, b) =>
    safeReadiness(a.readiness) - safeReadiness(b.readiness) ||
    String(b.created_at || '').localeCompare(String(a.created_at || '')) ||
    a.id.localeCompare(b.id));
}

/** The publishing cards display published-ready lines / all lines. */
function planEntry(id: string, group: WorkPlanLine[]): PublishingDashboardEntry {
  const progress = group.length ? group.filter(line => Boolean(line.published_ready)).length / group.length : 0;
  return { source: 'plan', id, group, priority: progress === 0 ? 0 : progress === 1 ? 2 : 1,
    progress, createdAt: String(group[0]?.plan_created_at || '') };
}

/** A draft's displayed readiness is readyCount / productCount, NOT configuredCount. */
function draftEntry(draft: StrategyDraft): PublishingDashboardEntry {
  const progress = draft.productCount ? Math.min(1, Math.max(0, draft.readyCount / draft.productCount)) : 0;
  return { source: 'draft', id: draft.id, draft, priority: progress === 0 ? 0 : progress === 1 ? 2 : 1,
    progress, createdAt: String(draft.createdAt || '') };
}

/** In BOTH types of publishing cards: 0% first, increasing readiness, 100% last. */
export function publishingDashboardEntries(
  groups: ReadonlyMap<string, WorkPlanLine[]>, drafts: ReadonlyArray<StrategyDraft>,
): PublishingDashboardEntry[] {
  return [
    ...drafts.map(draftEntry),
    ...[...groups.entries()].filter(([, group]) => group.length > 0).map(([id, group]) => planEntry(id, group)),
  ].sort((a, b) =>
    a.progress - b.progress ||
    b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}
