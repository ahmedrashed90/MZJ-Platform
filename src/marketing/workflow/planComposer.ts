import { isWorkDate, supportsWorkMedia, type WorkMediaKind } from '../../../shared/marketing-workflow';
import type { PlatformPostType } from '../types';

export type PlanPlatformDraft = { platformId: string; postTypeId: string; budget: string };
export type PlanEntryDraft = { key: string; date: string; productId: string; platforms: PlanPlatformDraft[] };
export type PlanProductMedia = { id: string; media_kind: WorkMediaKind };

/** Keep one product per plan day/row. This restriction is scoped to the composer,
 * not to the globally approved-products catalog or another campaign/agenda. */
export function availablePlanProducts<T extends { id: string }>(products: T[], entries: PlanEntryDraft[], currentKey: string): T[] {
  const usedElsewhere = new Set(entries.filter(entry => entry.key !== currentKey).map(entry => entry.productId).filter(Boolean));
  return products.filter(product => !usedElsewhere.has(product.id));
}

/** Marketing platform settings determine publish options; media kind narrows them. */
export function availablePlanPostTypes(postTypes: PlatformPostType[], mediaKind: WorkMediaKind | undefined, platformId: string): PlatformPostType[] {
  return mediaKind ? postTypes.filter(type => type.platform_id === platformId && supportsWorkMedia(mediaKind, type.name)) : [];
}

export function addPlanPlatform(platformId: string, postTypes: PlatformPostType[], mediaKind: WorkMediaKind): PlanPlatformDraft {
  const compatible = availablePlanPostTypes(postTypes, mediaKind, platformId);
  return { platformId, postTypeId: compatible.length === 1 ? compatible[0].id : '', budget: '' };
}

export function planEntryValid(entry: PlanEntryDraft, products: PlanProductMedia[], postTypes: PlatformPostType[], kind: 'agenda' | 'campaign'): boolean {
  const product = products.find(item => item.id === entry.productId);
  if (!isWorkDate(entry.date) || !product || !entry.platforms.length) return false;
  const seen = new Set<string>();
  for (const platform of entry.platforms) {
    if (!platform.platformId || seen.has(platform.platformId)) return false;
    seen.add(platform.platformId);
    if (!availablePlanPostTypes(postTypes, product.media_kind, platform.platformId).some(type => type.id === platform.postTypeId)) return false;
    if (kind === 'campaign' && (platform.budget.trim() === '' || !Number.isFinite(Number(platform.budget)) || Number(platform.budget) < 0 || Number(platform.budget) > 100000000 || Math.abs(Number(platform.budget) * 100 - Math.round(Number(platform.budget) * 100)) > 0.000001)) return false;
  }
  return true;
}

export function validatePlanComposer(entries: PlanEntryDraft[], products: PlanProductMedia[], postTypes: PlatformPostType[], kind: 'agenda' | 'campaign'): string {
  if (!entries.length) return 'أضف يومًا واحدًا على الأقل.';
  const selected = new Set<string>();
  let lineCount = 0;
  for (const entry of entries) {
    if (entry.productId && selected.has(entry.productId)) return 'المطلوب / المنتج مكرر داخل نفس الحملة أو الأجندة. اختر مطلوبًا مختلفًا لكل يوم.';
    if (entry.productId) selected.add(entry.productId);
    if (!planEntryValid(entry, products, postTypes, kind)) return 'أكمل التاريخ والمطلوب والمنصات وأنواع النشر المتوافقة، والميزانية الخاصة بكل منصة عند إنشاء حملة.';
    lineCount += entry.platforms.length;
    if (lineCount > 500) return 'الحد الأقصى 500 موعد نشر داخل الحملة أو الأجندة.';
  }
  return '';
}

/** One independently configurable schedule/amount per platform; never replicate
 * the total budget silently when a second publishing platform is selected. */
export function planEntriesPayload(entries: PlanEntryDraft[], kind: 'agenda' | 'campaign') {
  return entries.map(entry => ({
    date: entry.date, productId: entry.productId,
    platforms: entry.platforms.map(platform => ({
      platformId: platform.platformId,
      postTypeId: platform.postTypeId,
      budget: kind === 'campaign' ? Number(platform.budget) : 0,
    })),
  }));
}
