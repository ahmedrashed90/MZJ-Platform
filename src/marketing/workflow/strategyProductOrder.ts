/** Order the strategy products by their real execution (approval) day.
 * The delivery target is NOT an execution date: unfinished requirements stay after executed ones.
 * Sorting is performed on a copy so React query data is never mutated.
 */
export type ExecutionDatedProduct = {
  itemId: string;
  approvedOn?: string | null;
  dueOn?: string | null;
  createdAt?: string | null;
};

function calendarDay(value: string | null | undefined): string | null {
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function sortStrategyProductsByExecutionDate<T extends ExecutionDatedProduct>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const aExecuted = calendarDay(a.approvedOn);
    const bExecuted = calendarDay(b.approvedOn);
    if (Boolean(aExecuted) !== Boolean(bExecuted)) return aExecuted ? -1 : 1;
    if (aExecuted && bExecuted && aExecuted !== bExecuted) return aExecuted.localeCompare(bExecuted);
    const aDue = calendarDay(a.dueOn) || '9999-12-31';
    const bDue = calendarDay(b.dueOn) || '9999-12-31';
    if (aDue !== bDue) return aDue.localeCompare(bDue);
    const byCreation = String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    return byCreation || a.itemId.localeCompare(b.itemId);
  });
}
