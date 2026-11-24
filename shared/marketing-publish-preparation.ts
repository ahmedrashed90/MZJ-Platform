/**
 * The user-facing "تم التجهيز" checklist is about SAVED CONTENT, not provider
 * scheduling or whether the post has already been published. The final asset
 * must be a ready final file suitable for this plan line's publication type.
 * A line is counted once, regardless of how many source files/schedules exist.
 */
export type PublishContentFields = {
  final_file_ready?: boolean | null;
  caption?: string | null;
  hashtags?: string | null;
};

export function publishContentMissing(line: PublishContentFields): Array<'file' | 'caption' | 'hashtags'> {
  const missing: Array<'file' | 'caption' | 'hashtags'> = [];
  if (line.final_file_ready !== true) missing.push('file');
  if (!String(line.caption ?? '').trim()) missing.push('caption');
  if (!String(line.hashtags ?? '').trim()) missing.push('hashtags');
  return missing;
}

export function isPublishContentPrepared(line: PublishContentFields): boolean {
  return publishContentMissing(line).length === 0;
}

/** Human-readable reasons in the plan preparation table, from the same checks. */
export function publishContentMissingLabel(line: PublishContentFields): string {
  const names: Record<'file' | 'caption' | 'hashtags', string> = {
    file: 'الملف النهائي', caption: 'الكابشن', hashtags: 'الهاشتاج',
  };
  return `ناقص: ${publishContentMissing(line).map(field => names[field]).join('، ')}`;
}
