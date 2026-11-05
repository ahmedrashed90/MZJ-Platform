/** Publication punctuality is based on Saudi calendar days, not the UTC day.
 * Keep publication date and planned date independent from plan approval status.
 * A missing URL past its scheduled day is overdue even though it is not published. */
export type WorkPublicationTiming = 'on_time' | 'late' | 'overdue' | null;

export function saudiCalendarDay(now: Date = new Date()): string {
  const fields = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const field = (name: string) => fields.find(part => part.type === name)?.value || '';
  return `${field('year')}-${field('month')}-${field('day')}`;
}

export function classifyWorkPublicationTiming(
  scheduledOn: string | null | undefined,
  publishedReady: boolean,
  publishedOn: string | null | undefined,
  today: string = saudiCalendarDay(),
): WorkPublicationTiming {
  const scheduled = String(scheduledOn || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduled)) return null;
  if (publishedReady) {
    const actual = String(publishedOn || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(actual)) return null;
    return actual <= scheduled ? 'on_time' : 'late';
  }
  return scheduled < today ? 'overdue' : null;
}
