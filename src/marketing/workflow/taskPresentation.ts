/** One source of truth for Strategy task titles across execution, detail and delivery calendar.
 * Persisted task and requirement titles are deliberately never modified here. */
/** «بيعي» covers قسط and كاش: the strategy system groups them into one task,
 * so both the grouped title and the older per-kind titles read as «بيعي». */
export const STRATEGY_TASK_CATEGORIES = [
  'تعريفي - مواصفات السيارات',
  'تعريفي - بالويب سايت',
  'تعريفي - بالبراند',
  'بيعي',
] as const;

export function taskCategoryLabel(name: string): string {
  const title = String(name || '').trim();
  return STRATEGY_TASK_CATEGORIES.find(category => title === category || title.startsWith(`${category} `)) || title;
}

/** The same approved idea may have a photographer and an editor: show it once. */
export function taskIdeaTitles(items: ReadonlyArray<{ idea_name: string | null | undefined }>): string[] {
  const titles: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const title = String(item.idea_name || '').trim();
    if (title && !seen.has(title)) { seen.add(title); titles.push(title); }
  }
  return titles;
}

/** Each group is up to 3 ideas on the right and 3 on the left, in task order. */
export function taskIdeaGroups(titles: readonly string[]): string[][] {
  const groups: string[][] = [];
  for (let i = 0; i < titles.length; i += 6) groups.push(titles.slice(i, i + 6));
  return groups;
}
