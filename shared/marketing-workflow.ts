import { normalizeMarketingPublishFormat, publishFormatRequiresImages, publishFormatRequiresVideo } from './marketing-publishing.js';

export type WorkMediaKind = 'image' | 'video';
export type WorkItemStatus = 'in_progress' | 'submitted' | 'revision' | 'approved';
export type WorkPlanKind = 'agenda' | 'campaign';
export type WorkFormat = { id: string; platform_id: string; platform_name: string; platform_code: string; name: string; width?: number | null; height?: number | null };
export type WorkFile = { id: string; name: string; mime_type: string; file_size: number; category: 'idea' | 'final'; format_id: string; status: string; order_index?: number };
export type WorkItem = {
  id: string; task_id: string; department_id: string; department_name: string; assigned_to: string; assignee_name: string;
  media_kind: WorkMediaKind; idea_name: string; idea: string; formats: WorkFormat[]; due_on: string; status: WorkItemStatus;
  files: WorkFile[]; review_note: string; version: number; approved_at?: string | null; submitted_at?: string | null;
  delivery_status?: 'on_time' | 'late' | null;
  pending_uploads?: { id: string; name: string; category: string }[];
  sort_order: number; task_name?: string; task_no?: string; actions?: { id: string; name: string; completed: boolean; admin_only: boolean; is_final_approval: boolean }[];
};
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
  prepared_count: number; published_count: number; failed_count: number; status: string; files?: WorkFile[];
};
export type WorkCapabilities = { createTask: boolean; editTask: boolean; review: boolean; createAgenda: boolean; createCampaign: boolean; products: boolean; prepare: boolean; publish: boolean; viewAll: boolean };

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
export function workReadiness(items: Array<Pick<WorkItem, 'status' | 'formats' | 'files'> & Partial<Pick<WorkItem, 'media_kind'>>>) {
  const total = items.length;
  const approved = items.filter(item => item.status === 'approved' && finalCoverage(item)).length;
  return { total, approved, percent: total ? Math.round(approved * 1000 / total) / 10 : 0, complete: total > 0 && approved === total };
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
