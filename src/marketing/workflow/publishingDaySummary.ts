import type { WorkPlanLine } from '../../../shared/marketing-workflow';

export type PublishingDaySummary = {
  date: string;
  publicationCount: number;
  productNames: string[];
  platformNames: string[];
  postTypeNames: string[];
  publishedCount: number;
  onTimeCount: number;
  lateCount: number;
  pendingCount: number;
  undatedCount: number;
};

const distinct = (items: Array<string | null | undefined>) =>
  [...new Set(items.map(item => String(item || '').trim()).filter(Boolean))];

/** Aggregate the dashboard once per calendar day, without altering the
 * per-platform/per-post-type source lines used by the full report. */
export function summarizePublishingDays(lines: WorkPlanLine[]): PublishingDaySummary[] {
  const days = new Map<string, WorkPlanLine[]>();
  for (const line of lines) {
    const date = String(line.scheduled_on || '').slice(0, 10);
    if (!days.has(date)) days.set(date, []);
    days.get(date)!.push(line);
  }
  return [...days.entries()].sort(([first], [second]) => first.localeCompare(second)).map(([date, dayLines]) => {
    const publishedCount = dayLines.filter(line => line.published_ready).length;
    const onTimeCount = dayLines.filter(line => line.published_ready && line.publication_timing === 'on_time').length;
    const lateCount = dayLines.filter(line => line.published_ready && line.publication_timing === 'late').length;
    return {
      date,
      publicationCount: dayLines.length,
      productNames: distinct(dayLines.map(line => line.idea_name)),
      platformNames: distinct(dayLines.map(line => line.platform_name)),
      postTypeNames: distinct(dayLines.map(line => line.post_type_name)),
      publishedCount,
      onTimeCount,
      lateCount,
      pendingCount: dayLines.length - publishedCount,
      undatedCount: publishedCount - onTimeCount - lateCount,
    };
  });
}
