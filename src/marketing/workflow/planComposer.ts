import { isWorkDate, supportsWorkMedia, type WorkMediaKind } from '../../../shared/marketing-workflow';
import type { PlatformPostType } from '../types';

/** Every selected post type has an independent budget. `budget` is retained
 * solely to read older, per-platform draft shapes without changing old plans. */
export type PlanPlatformDraft = {
  platformId: string; postTypeId: string; postTypeIds?: string[];
  budget: string; postTypeBudgets?: Record<string, string>;
};
export type PlanEntryDraft = { key: string; date: string; productId: string; platforms: PlanPlatformDraft[] };
export type PlanProductMedia = { id: string; media_kind: WorkMediaKind };

/** Keep one product per plan day/row; other campaigns may reuse that product. */
export function availablePlanProducts<T extends { id: string }>(products: T[], entries: PlanEntryDraft[], currentKey: string): T[] {
  const usedElsewhere = new Set(entries.filter(entry => entry.key !== currentKey).map(entry => entry.productId).filter(Boolean));
  return products.filter(product => !usedElsewhere.has(product.id));
}

export function availablePlanPostTypes(postTypes: PlatformPostType[], mediaKind: WorkMediaKind | undefined, platformId: string): PlatformPostType[] {
  return mediaKind ? postTypes.filter(type => type.platform_id === platformId && supportsWorkMedia(mediaKind, type.name)) : [];
}

export function addPlanPlatform(platformId: string, postTypes: PlatformPostType[], mediaKind: WorkMediaKind): PlanPlatformDraft {
  const compatible = availablePlanPostTypes(postTypes, mediaKind, platformId);
  const singleId = compatible.length === 1 ? compatible[0].id : '';
  return { platformId, postTypeId: singleId, postTypeIds: singleId ? [singleId] : [], budget: '',
    postTypeBudgets: singleId ? { [singleId]: '' } : {} };
}

export function selectedPlanPostTypeIds(platform: PlanPlatformDraft): string[] {
  return platform.postTypeIds || (platform.postTypeId ? [platform.postTypeId] : []);
}

function budgetValid(value: string | undefined): boolean {
  if (value === undefined || value.trim() === '') return false;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 && amount <= 100000000 &&
    Math.abs(amount * 100 - Math.round(amount * 100)) <= 0.000001;
}

/** The composer always supplies per-type amounts; older unsaved drafts can
 * still be interpreted with the historical first-post-type budget. */
export function planPostTypeBudget(platform: PlanPlatformDraft, postTypeId: string, index: number): string {
  if (platform.postTypeBudgets !== undefined) return platform.postTypeBudgets[postTypeId] ?? '';
  return index === 0 ? platform.budget : '0';
}

export function planEntryValid(entry: PlanEntryDraft, products: PlanProductMedia[], postTypes: PlatformPostType[], kind: 'agenda' | 'campaign'): boolean {
  const product = products.find(item => item.id === entry.productId);
  if (!isWorkDate(entry.date) || !product || !entry.platforms.length) return false;
  const seen = new Set<string>();
  for (const platform of entry.platforms) {
    if (!platform.platformId || seen.has(platform.platformId)) return false;
    seen.add(platform.platformId);
    const selected = selectedPlanPostTypeIds(platform);
    const available = new Set(availablePlanPostTypes(postTypes, product.media_kind, platform.platformId).map(type => type.id));
    if (!selected.length || new Set(selected).size !== selected.length || selected.some(id => !available.has(id))) return false;
    if (kind === 'campaign' && selected.some((id, index) => !budgetValid(planPostTypeBudget(platform, id, index)))) return false;
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
    if (!planEntryValid(entry, products, postTypes, kind)) return 'أكمل التاريخ والمطلوب والمنصات وأنواع النشر المتوافقة، وميزانية كل نوع نشر عند إنشاء حملة.';
    lineCount += entry.platforms.reduce((sum, platform) => sum + selectedPlanPostTypeIds(platform).length, 0);
    if (lineCount > 500) return 'الحد الأقصى 500 موعد نشر داخل الحملة أو الأجندة.';
  }
  return '';
}

/** Persist each selected post type with its exact amount. The server verifies
 * the post type belongs to its platform and inserts one row per post type. */
export function planEntriesPayload(entries: PlanEntryDraft[], kind: 'agenda' | 'campaign') {
  return entries.map(entry => ({
    date: entry.date, productId: entry.productId,
    platforms: entry.platforms.map(platform => {
      const selected = selectedPlanPostTypeIds(platform);
      const postTypes = selected.map((postTypeId, index) => ({
        postTypeId, budget: kind === 'campaign' ? Number(planPostTypeBudget(platform, postTypeId, index)) : 0,
      }));
      return {
        platformId: platform.platformId, postTypeId: selected[0] || '', postTypeIds: selected,
        // Legacy first-type field retained so earlier consumers can identify
        // the first budget; only `postTypes` is used for current creation.
        budget: postTypes[0]?.budget ?? 0,
        postTypes,
      };
    }),
  }));
}
