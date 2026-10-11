import { useCallback, useEffect, useRef, useState } from 'react';
import { marketingFetch, marketingQuery } from '../api';
import type { MarketingMeta } from '../types';
import type { WorkCapabilities } from '../../../shared/marketing-workflow';
import { W } from '../../../shared/marketing-workflow-labels';

export type WorkMeta = MarketingMeta & { capabilities: WorkCapabilities; userId: string };
export function workGet<T>(resource: string, query: Record<string, unknown> = {}, signal?: AbortSignal) {
  return marketingFetch<T>(`/api/marketing${marketingQuery({ resource: `work_${resource}`, ...query })}`, { signal });
}
export async function workPost<T = { ok: boolean; message?: string; id?: string; version?: number }>(action: string, body: Record<string, unknown>) {
  const result = await marketingFetch<T>('/api/marketing', { method: 'POST', body: JSON.stringify({ ...body, action: `work_${action}` }) });
  window.dispatchEvent(new Event('mzj-marketing-work-changed'));
  return result;
}
export const fileUrl = (id: string, download = false) => `/api/marketing${marketingQuery({ resource: 'work_file', id, download: download ? 1 : undefined })}`;

export function useWorkQuery<T>(resource: string, query: Record<string, unknown> = {}, enabled = true) {
  const key = JSON.stringify(query), current = useRef<AbortController | null>(null);
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    if (!enabled) return null;
    current.current?.abort();
    const controller = new AbortController(); current.current = controller;
    setLoading(true); setError('');
    try {
      const result = await workGet<T>(resource, JSON.parse(key), controller.signal);
      if (!controller.signal.aborted) setData(result);
      return result;
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : W.invalid);
      return null;
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, [resource, key, enabled]);
  useEffect(() => { setData(null); void reload(); return () => current.current?.abort(); }, [reload]);
  useEffect(() => {
    if (!enabled || !['dashboard','database','products','publishing','calendar'].includes(resource)) return;
    let active = true, checking = false, seen = '';
    const check = async () => {
      if (!active || checking || document.visibilityState !== 'visible') return;
      checking = true;
      try {
        const result = await workGet<{ version: string }>('version');
        if (active && seen && seen !== result.version) await reload();
        seen = result.version;
      } catch { /* A transient live-check failure must not discard displayed data. */ }
      finally { checking = false; }
    };
    const refreshVisible = () => { if (document.visibilityState === 'visible') void reload(); };
    const timer = window.setInterval(() => void check(), 20000);
    void check();
    document.addEventListener('visibilitychange', refreshVisible);
    window.addEventListener('focus', refreshVisible);
    window.addEventListener('mzj-marketing-work-changed', refreshVisible);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshVisible); window.removeEventListener('focus', refreshVisible); window.removeEventListener('mzj-marketing-work-changed', refreshVisible); };
  }, [resource, enabled, reload]);
  return { data, error, loading, reload };
}

export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function showDate(value: unknown, time = false) {
  if (!value) return '\u2014';
  const str = String(value), date = new Date(str.length === 10 ? `${str}T12:00:00` : str);
  if (!Number.isFinite(date.getTime())) return '\u2014';
  return time ? date.toLocaleString('ar-SA-u-ca-gregory-nu-latn') : date.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn');
}
export function showRange(from: string | null, to: string | null) {
  return from && to && from !== to ? `${showDate(from)} \u2190 ${showDate(to)}` : showDate(to || from);
}
export type WorkUploadInput = { reservationId?: string; itemId?: string; category: 'idea' | 'final'; formatIds?: string[] };
export async function uploadWorkFile(file: File, input: WorkUploadInput, onProgress: (percent: number) => void, signal?: AbortSignal) {
  const prepared = await workPost<{ fileId: string; uploadUrl: string; storageProvider: string }>('prepare_upload', {
    ...input, fileName: file.name, mimeType: file.type || 'application/octet-stream', fileSize: file.size,
  });
  let externalId = '';
  try {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const abort = () => xhr.abort();
      const done = (fn: () => void) => { signal?.removeEventListener('abort', abort); fn(); };
      xhr.open('PUT', prepared.uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.min(99, Math.round(event.loaded * 100 / event.total))); };
      xhr.onload = () => done(() => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { externalId = JSON.parse(xhr.responseText || '{}').id || ''; } catch { /* R2 has no JSON body. */ }
          resolve();
        } else reject(new Error(`${W.uploadFailed} (${xhr.status})`));
      });
      xhr.onerror = () => done(() => reject(new Error(W.uploadFailed)));
      xhr.onabort = () => done(() => reject(new DOMException(W.cancel, 'AbortError')));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { reject(new DOMException(W.cancel, 'AbortError')); return; }
      xhr.send(file);
    });
  } catch (error) {
    // Google may hide the successful resumable response behind CORS. Verify
    // ownership/size server-side before deciding whether the upload failed.
    if (!signal?.aborted && prepared.storageProvider === 'google-drive') {
      try { await workPost('commit_upload', { fileId: prepared.fileId }); onProgress(100); return prepared.fileId; } catch { /* Keep original error. */ }
    }
    await workPost('remove_upload', { fileId: prepared.fileId, itemId: input.itemId }).catch(() => undefined);
    throw error;
  }
  try {
    await workPost('commit_upload', { fileId: prepared.fileId, externalId }); onProgress(100); return prepared.fileId;
  } catch (error) {
    await workPost('remove_upload', { fileId: prepared.fileId, itemId: input.itemId }).catch(() => undefined);
    throw error;
  }
}
