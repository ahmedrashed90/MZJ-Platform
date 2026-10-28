import { normalizeMarketingPublishFormat, publishFormatRequiresImages, publishFormatRequiresVideo } from './marketing-publishing.js';

export type WorkMediaKind = 'image' | 'video';
export type WorkItemStatus = 'in_progress' | 'submitted' | 'revision' | 'editing' | 'approved' | 'rejected';
/** Only the product acceptance/rejection criterion is binary; all others keep 0,1,2,3. */
export function isBinaryProductDecisionCriterion(name: unknown): boolean {
  const normalized = String(name ?? '').toLowerCase()
    .replace(/[\u064b-\u065f\u0670]/g,'').replace(/[\u0622\u0623\u0625]/g,'ا').replace(/\s+/g,' ').trim();
  return /قبول\s*(?:او|\/)\s*رفض\s*المنتج/.test(normalized);
}

export type WorkPlanKind = 'agenda' | 'campaign';
export type WorkFormat = { id: string; platform_id: string; platform_name: string; platform_code: string; name: string; width?: number | null; height?: number | null };
export type WorkFile = { id: string; name: string; mime_type: string; file_size: number; category: 'idea' | 'final'; format_id: string; status: string; order_index?: number };
export type WorkItem = {
  id: string; task_id: string; department_id: string; department_name: string; assigned_to: string; assignee_name: string;
  media_kind: WorkMediaKind; idea_name: string; idea: string; formats: WorkFormat[]; due_on: string; status: WorkItemStatus;
  files: WorkFile[]; review_note: string; review_note_type_id?: string | null; review_note_type_name?: string | null;
  review_notes?: WorkItemReviewNote[];
  latest_review_event?: { action: string; note: string; actor_name: string; created_at: string } | null;
  format_reviews?: Array<{ format_id: string; status: 'submitted' | 'approved' | 'revision'; submitted_at?: string | null; approved_at?: string | null }>;
  rating?: WorkItemRating | null; version: number; approved_at?: string | null; submitted_at?: string | null;
  delivery_status?: 'on_time' | 'late' | 'exception_approved' | null;
  deadline_exception?: { id: string; status: 'pending' | 'approved' | 'rejected'; request_note: string; requested_at: string; decision_note?: string; decided_at?: string | null; decided_by_name?: string } | null;
  pending_uploads?: { id: string; name: string; category: string }[];
  sort_order: number; task_name?: string; task_no?: string; actions?: { id: string; name: string; completed: boolean; admin_only: boolean; is_final_approval: boolean }[];
};
export type WorkItemReviewNote = {
  id: string; category_id: string | null; category_name: string;
  note: string; created_at: string; updated_at: string; revision_number: number | null;
  author_name: string; responded_at: string | null; executor_response?: 'accepted' | 'declined' | null;
};
export type WorkItemRating = {
  percentage: number; scores: Array<{ criterionId: string; criterionName: string; score: number }>;
  created_at: string; updated_at: string; reviewer_name: string;
};
export type WorkEvaluationSetting = { id: string; name: string; sort_order: number; is_active: boolean };
export type WorkEvaluationSettings = { ok: true; categories: WorkEvaluationSetting[]; criteria: WorkEvaluationSetting[]; canManage: boolean;
  reviewers: Array<{slot: number; user_id: string; name: string}>;
  reviewerOptions: Array<{id: string; name: string}>; };

export type WorkTask = {
  id: string; task_no: string; name: string; type_id: string; type_name: string; created_at: string; created_by: string;
  status: 'active' | 'completed' | 'empty'; due_from: string | null; due_to: string | null; product_count: number;
  approved_count: number; readiness: number; version: number; completed_at?: string | null; items?: WorkItem[];
  submitted_on_time_count?: number; submitted_late_count?: number;
};
export type WorkProduct = WorkItem & { task_no: string; task_name: string; released_at: string; statement: string };
export type WorkPlanLine = {
  id: string; plan_id: string; plan_no: string; kind: WorkPlanKind; name: string; scheduled_on: string;
  post_type_id?: string | null; platform_name?: string | null; post_type_name?: string | null; platform_code?: string | null; budget_amount?: number; activated_at?: string | null;
  product_id: string; idea_name: string; task_no: string; task_name: string; media_kind: WorkMediaKind;
  prepared_count: number; published_count: number; scheduled_count?: number; failed_count: number; status: string; files?: WorkFile[];
};
export type WorkCapabilities = { createTask: boolean; editTask: boolean; review: boolean; createAgenda: boolean; createCampaign: boolean; products: boolean; prepare: boolean; publish: boolean; viewAll: boolean };

/** Whether the selected platform has an implemented automatic-publishing adapter.
 * Work plans created before platform selection may not contain platform_code.
 * Such plans remain editable but cannot be activated for automatic publishing. */
export function workPlatformSupportsAutoPublish(platformCode: WorkPlanLine['platform_code']): boolean {
  return typeof platformCode === 'string' && ['facebook', 'instagram', 'youtube', 'tiktok'].includes(platformCode);
}

export function supportsWorkMedia(kind: WorkMediaKind, postTypeName: string): boolean {
  const text = String(postTypeName || '').toLowerCase();
  const explicitVideo = /video|\u0641\u064a\u062f\u064a\u0648/.test(text);
  const explicitImage = /photo|image|\u0635\u0648\u0631|\u0635\u0648\u0631\u0629|\u0635\u0648\u0631\u0647/.test(text);
  if (explicitVideo && !explicitImage) return kind === 'video';
  if (explicitImage && !explicitVideo) return kind === 'image';
  const format = normalizeMarketingPublishFormat(text);
  if (publishFormatRequiresVideo(format)) return kind === 'video';
  if (publishFormatRequiresImages(format)) return kind === 'image';
  return true; // A generic Story/Post supports either medium; settings remain the source.
}

export function finalCoverage(item: Pick<WorkItem, 'formats' | 'files'> & Partial<Pick<WorkItem, 'media_kind'>>): boolean {
  return item.formats.length > 0 && item.formats.every(format => {
    const files = item.files.filter(file => file.category === 'final' && file.format_id === format.id && file.status === 'ready');
    if (!files.length || (item.media_kind === 'video' && files.length !== 1)) return false;
    if (normalizeMarketingPublishFormat(format.name) === 'carousel' && files.length < 2) return false;
    return !item.media_kind || files.every(file => workFileMatches(item.media_kind!, file.name, file.mime_type));
  });
}
/** Reuse an approved final file for another platform only when its media
 * kind and exact configured output dimensions agree. Keep task files intact. */
export function matchingWorkflowPublishFiles(
  files: WorkFile[], taskFormats: WorkFormat[], target: WorkFormat, kind: WorkMediaKind,
): WorkFile[] {
  // Prefer precisely the requested type. When reusing from another platform,
  // select ONE compatible source format, never mix unrelated images/videos
  // from several task formats merely because their dimensions agree.
  const matchingFiles = (formatId: string) => files.filter(file => file.category === 'final' &&
    file.status === 'ready' && file.format_id === formatId &&
    workFileMatches(kind, file.name, file.mime_type));
  const exact = matchingFiles(target.id);
  if (exact.length) return exact;
  for (const source of taskFormats) {
    if (source.width != null && source.height != null && target.width != null && target.height != null &&
      Number(source.width) === Number(target.width) && Number(source.height) === Number(target.height)) {
      const compatible = matchingFiles(source.id);
      if (compatible.length) return compatible;
    }
  }
  return [];
}

/**
 * Each requirement contributes equally to the parent task: 0 before its
 * final outputs are complete, 50 after complete final uploads, and 100 once
 * the reviewer approves them. A rejected requirement is 100% ready
 * (terminal decision), but never becomes an approved product. Both screens
 * use these same milestones.
 */
export function workItemReadiness(item: Pick<WorkItem, 'status' | 'formats' | 'files'> & Partial<Pick<WorkItem, 'media_kind' | 'format_reviews'>>): number {
  // Rejection closes the requirement without producing an approved product.
  // Retain its denominator and record the terminal decision as 100% readiness.
  if (item.status === 'rejected') return 100;
  if (!item.formats.length) return 0;
  const byFormat = new Map((item.format_reviews || []).map(format => [format.format_id, format.status]));
  const total = item.formats.reduce((sum, format) => {
    const uploaded = finalCoverage({ formats: [format], files: item.files, media_kind: item.media_kind });
    if (!uploaded) return sum;
    const approved = byFormat.get(format.id) === 'approved' ||
      (!item.format_reviews && item.status === 'approved');
    return sum + (approved ? 100 : 50);
  }, 0);
  return Math.round(total * 10 / item.formats.length) / 10;
}
/** A reviewer may act on uploaded final files without waiting for the executor
 * to press Submit. Approved formats stay locked; a format sent for revision
 * becomes reviewable again only after the executor uploads a NEW final file. */
export function workReviewableFormats(
  item: Pick<WorkItem, 'formats' | 'files' | 'media_kind'> & Partial<Pick<WorkItem, 'format_reviews'>>,
  decision: 'approve' | 'revise',
): WorkFormat[] {
  const states = new Map((item.format_reviews || []).map(row => [row.format_id, row.status]));
  return item.formats.filter(format => {
    const state = states.get(format.id);
    if (state === 'approved' || state === 'revision') return false;
    const uploaded = item.files.some(file => file.category === 'final' && file.status === 'ready' && file.format_id === format.id);
    if (!uploaded) return false;
    return decision === 'revise' || finalCoverage({ formats: [format], files: item.files, media_kind: item.media_kind });
  });
}

export function workReadiness(items: Array<Pick<WorkItem, 'status' | 'formats' | 'files'> & Partial<Pick<WorkItem, 'media_kind' | 'format_reviews'>>>) {
  const total = items.length;
  let approved = 0;
  let resolved = 0;
  let readinessPoints = 0;
  for (const item of items) {
    const itemPercent = workItemReadiness(item);
    readinessPoints += itemPercent;
    if (itemPercent === 100) {
      resolved += 1;
      if (item.status !== 'rejected') approved += 1;
    }
  }
  return { total, approved, percent: total ? Math.round(readinessPoints * 10 / total) / 10 : 0,
    complete: total > 0 && resolved === total };
}
export function isWorkDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export function isTerminalApproval(name: unknown): boolean {
  return String(name || '').replace(/[\s\-\u2013\u2014_]+/g, '').includes('\u0627\u0639\u062a\u0645\u0627\u062f\u0627\u0644\u0645\u0646\u062a\u062c100%');
}
export function workFileMatches(kind: WorkMediaKind, name: string, mime: string): boolean {
  return kind === 'image'
    ? /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(name) && (!mime || mime === 'application/octet-stream' || mime.startsWith('image/'))
    : /\.(mp4|mov|m4v|webm)$/i.test(name) && (!mime || mime === 'application/octet-stream' || mime.startsWith('video/'));
}
export function ideaFileAllowed(name: string) { return /\.(docx?|xlsx?)$/i.test(name); }
export function workDate(value: unknown) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : '';
  return String(value || '').slice(0, 10);
}

export function workRatingLevel(value: number) {
  return value >= 100 ? { label: 'ممتاز', stars: 5, css: 'excellent' } :
    value >= 90 ? { label: 'جيد', stars: 4, css: 'good' } :
    value >= 60 ? { label: 'مقبول', stars: 3, css: 'acceptable' } :
    value >= 50 ? { label: 'ضعيف', stars: 2, css: 'weak' } :
    { label: 'غير مناسب', stars: 1, css: 'unsuitable' };
}
