export type ReviewNoteBlock = { kind: 'paragraph' | 'heading' | 'bullet' | 'numbered'; text: string; number?: string };

/** Retain actual paragraphs and lists. For legacy one-line notes, split only
 * a standalone + separator (used historically for separate review comments),
 * not numbers such as +966 or product names with embedded plus signs. */
export function parseReviewNote(value: unknown): ReviewNoteBlock[] {
  const source = String(value ?? '').replace(/\r\n?/g, '\n');
  const blocks: ReviewNoteBlock[] = [];
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const heading = /^#{1,3}\s+(.+)$/.exec(trimmed);
    if (heading) { blocks.push({ kind: 'heading', text: heading[1] }); continue; }
    const bullet = /^(?:[-•*])\s+(.+)$/.exec(trimmed);
    if (bullet) { blocks.push({ kind: 'bullet', text: bullet[1] }); continue; }
    const numbered = /^([0-9]+)[.)]\s+(.+)$/.exec(trimmed);
    if (numbered) { blocks.push({ kind: 'numbered', number: numbered[1], text: numbered[2] }); continue; }
    const legacyClauses = trimmed.split(/\s+\+\s+/).map(part => part.trim()).filter(Boolean);
    if (legacyClauses.length > 1) {
      for (const part of legacyClauses) blocks.push({ kind: 'bullet', text: part });
    } else blocks.push({ kind: 'paragraph', text: trimmed });
  }
  return blocks;
}
