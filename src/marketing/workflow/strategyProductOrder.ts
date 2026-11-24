/** Sort products by their planned publication date, not execution/approval.
 * A product may appear in multiple agendas; its earliest scheduled day wins.
 * Products with no publish date are shown after dated ones.
 * Pure display ordering: never mutate the API response or stored dates.
 */
export type PublicationDatedProduct = {
  itemId?: string;
  id?: string;
  publishOn?: string | null;
  publishDates?: readonly string[] | null;
  publish_on?: string | null;
  createdAt?: string | null;
  approved_at?: string | null;
  released_at?: string | null;
};

function calendarDay(value: string | null | undefined): string | null {
  const day = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const parsed = new Date(`${day}T12:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
}

export function productPublicationDay(row: PublicationDatedProduct): string | null {
  const days = [...(row.publishDates || []), row.publishOn, row.publish_on]
    .map(calendarDay).filter((day): day is string => Boolean(day));
  return days.length ? days.sort()[0] : null;
}

export function sortProductsByPublishDate<T extends PublicationDatedProduct>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const aDay = productPublicationDay(a);
    const bDay = productPublicationDay(b);
    if (aDay && bDay && aDay !== bDay) return aDay.localeCompare(bDay);
    if (Boolean(aDay) !== Boolean(bDay)) return aDay ? -1 : 1;
    // Newest-created first only when publish dates are equal or unavailable.
    const byCreation = String(b.createdAt || b.approved_at || b.released_at || '')
      .localeCompare(String(a.createdAt || a.approved_at || a.released_at || ''));
    return byCreation || String(a.itemId || a.id || '').localeCompare(String(b.itemId || b.id || ''));
  });
}
