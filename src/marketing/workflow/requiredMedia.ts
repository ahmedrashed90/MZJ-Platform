import { supportsWorkMedia, type WorkFormat, type WorkMediaKind } from '../../../shared/marketing-workflow';

/** A user may request both media kinds, but the persisted workflow intentionally
 * stores one medium per item so reviews, uploads and publishing stay compatible. */
export function splitRequiredMediaSelection(
  mediaKinds: readonly WorkMediaKind[], formatIds: readonly string[], formats: readonly WorkFormat[],
): Array<{ mediaKind: WorkMediaKind; formatIds: string[] }> {
  const uniqueKinds = [...new Set(mediaKinds)].filter(kind => kind === 'image' || kind === 'video');
  const uniqueFormats = [...new Set(formatIds)];
  const selections = uniqueKinds.map(mediaKind => ({
    mediaKind,
    formatIds: uniqueFormats.filter(id => formats.some(format => format.id === id && supportsWorkMedia(mediaKind, format.name))),
  }));
  // Never save only half a combined request: each selected kind needs at least
  // one compatible configured output size / publication format.
  return selections.every(selection => selection.formatIds.length) ? selections : [];
}
