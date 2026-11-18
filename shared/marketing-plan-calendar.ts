/** Marketing events in the delivery calendar are *milestones*, not every day
 * of a funding period. Historical campaigns may have no funding end date. */
export type CalendarPlanRow = {
  plan_id: string; plan_no: string; name: string; kind: 'campaign' | 'agenda';
  review_status: string; creator_name: string; scheduled_on: string;
  funding_from: string | null; funding_to: string | null;
  agenda_from?: string | null; agenda_to?: string | null;
};
export type CalendarPlanEvent = {
  id: string; plan_id: string; plan_no: string; name: string;
  kind: 'campaign' | 'agenda'; review_status: string; creator_name: string;
  event_on: string; event_type: 'funding_start' | 'funding_end' | 'funding_both' | 'agenda_publish' | 'agenda_start' | 'agenda_end' | 'agenda_both';
};
function datePart(value: unknown): string {
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const parsed = new Date(`${raw}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw ? '' : raw;
}
/** Deduplicate many post-type/product rows into one event per plan/day. */
export function buildCalendarPlanEvents(rows: CalendarPlanRow[], from: string, to: string): CalendarPlanEvent[] {
  const result = new Map<string, CalendarPlanEvent>();
  for (const row of rows) {
    const add = (day: string, type: CalendarPlanEvent['event_type']) => {
      if (!day || day < from || day > to) return;
      const key = `${row.plan_id}:${day}:${type}`;
      if (!result.has(key)) result.set(key, {
        id: key, plan_id: row.plan_id, plan_no: row.plan_no, name: row.name,
        kind: row.kind, review_status: row.review_status, creator_name: row.creator_name,
        event_on: day, event_type: type,
      });
    };
    if (row.kind === 'agenda') {
      const agendaFrom = datePart(row.agenda_from), agendaTo = datePart(row.agenda_to);
      // New agendas use their explicitly chosen boundaries; historic agendas
      // without stored periods keep their individual publication-day events.
      if (agendaFrom && agendaTo) {
        if (agendaFrom === agendaTo) add(agendaFrom, 'agenda_both');
        else { add(agendaFrom, 'agenda_start'); add(agendaTo, 'agenda_end'); }
      } else add(datePart(row.scheduled_on), 'agenda_publish');
      continue;
    }
    if (row.kind !== 'campaign') continue;
    const start = datePart(row.funding_from) || datePart(row.scheduled_on);
    const end = datePart(row.funding_to);
    if (start && end && start === end) add(start, 'funding_both');
    else { add(start, 'funding_start'); add(end, 'funding_end'); }
  }
  return [...result.values()].sort((a, b) => a.event_on.localeCompare(b.event_on) ||
    a.name.localeCompare(b.name, 'ar') || a.event_type.localeCompare(b.event_type));
}
