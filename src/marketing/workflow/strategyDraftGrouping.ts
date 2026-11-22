import type { StrategyDraftIdea } from './StrategyProductsTable';

/** Preserve original idea order and identity while grouping the visible subset
 * by its authoritative strategy classification (agenda + campaign drafts). */
export function groupStrategyDraftIdeas(ideas: ReadonlyArray<StrategyDraftIdea>): Array<{
  category: string; entries: StrategyDraftIdea[];
}> {
  const groups = new Map<string, StrategyDraftIdea[]>();
  for (const idea of ideas) {
    const category = idea.category?.trim() || 'بدون تصنيف';
    const entries = groups.get(category);
    if (entries) entries.push(idea);
    else groups.set(category, [idea]);
  }
  return [...groups.entries()].map(([category, entries]) => ({ category, entries }));
}
