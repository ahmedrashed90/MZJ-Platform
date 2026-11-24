import { taskCategoryLabel, STRATEGY_TASK_CATEGORIES } from './taskPresentation';

/** Group the list visually only. Keep every original idea id and selection;
 * never merge two ideas just because their titles are alike. */
export function ideaTaskCategory(idea: { taskName?: string | null; category?: string | null }): string {
  const taskName = String(idea.taskName || '').trim();
  const normalizedTask = taskCategoryLabel(taskName);
  if (STRATEGY_TASK_CATEGORIES.includes(normalizedTask as typeof STRATEGY_TASK_CATEGORIES[number])) return normalizedTask;
  return String(idea.category || '').trim() || normalizedTask || 'بدون تصنيف';
}
export function groupDraftIdeas<T extends { taskName?: string | null; category?: string | null }>(ideas: readonly T[]): Array<{ category: string; items: T[] }> {
  const groups = new Map<string,T[]>();
  for (const idea of ideas) {
    const category = ideaTaskCategory(idea);
    const group = groups.get(category) || [];
    group.push(idea);
    groups.set(category, group);
  }
  return Array.from(groups, ([category, items]) => ({ category, items }));
}
