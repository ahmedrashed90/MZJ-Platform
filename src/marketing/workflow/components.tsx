import { cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from 'react';
import { ArrowClockwise, Eye, FileArrowDown, FilmStrip, ImageSquare, MagnifyingGlass, X, XCircle } from '@phosphor-icons/react';
import { Modal } from '../../components/Modal';
import type { WorkFile, WorkFormat, WorkMediaKind, WorkProduct } from '../../../shared/marketing-workflow';
import { W } from '../../../shared/marketing-workflow-labels';
import { fileUrl, useWorkQuery } from './api';
export { W };

export function WorkAlert({ children, success = false }: { children?: ReactNode; success?: boolean }) {
  return children ? <div className={`mkw-alert ${success ? 'success' : ''}`} role={success ? 'status' : 'alert'}>{children}</div> : null;
}
export function Empty({ children = W.noData }: { children?: ReactNode }) { return <div className="mkw-empty">{children}</div>; }
export function WorkHeader({ title, children, onRefresh, loading }: { title: string; children?: ReactNode; onRefresh?: () => void; loading?: boolean }) {
  return <header className="mkw-page-header"><h1>{title}</h1><div className="mkw-actions">{children}{onRefresh && <button type="button" className="secondary" onClick={onRefresh} disabled={loading}><ArrowClockwise size={18} />{W.refresh}</button>}</div></header>;
}
export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`mkw-field ${className}`}><span>{label}</span>{isValidElement(children) && typeof children.type === 'string' && ['input','select','textarea'].includes(children.type) ? cloneElement(children as ReactElement<{ 'aria-label'?: string }>, { 'aria-label': label }) : children}</label>;
}
export function Search({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label className="mkw-search"><MagnifyingGlass size={19} /><input aria-label={W.search} placeholder={W.search} value={value} onChange={event => onChange(event.target.value)} /></label>;
}
export function MediaLabel({ kind }: { kind: WorkMediaKind }) { return <span className="mkw-media-label">{kind === 'video' ? <FilmStrip size={19} /> : <ImageSquare size={19} />}{kind === 'video' ? W.video : W.image}</span>; }
const statuses: Record<string, string> = { in_progress: W.in_progress, submitted: W.submitted, revision: W.revision, editing: "قيد التعديل", approved: W.approved, completed: W.completed, active: W.execution, empty: W.emptyTask, waiting: W.waiting, ready_publish: W.prepared, publishing: W.processing, prepared: W.prepared, processing: W.processing, scheduled: "مجدول للنشر", published: W.published, failed: W.failed, verification_required: W.verificationRequired, cancelled: W.cancel, created: W.createdEvent, edited: W.edit, file_removed: W.fileRemoved, formats_added: W.addFormats, action: W.assignmentActions, rejected: 'مرفوض' };
export function Status({ value }: { value: string }) { return <span className={`mkw-status status-${value}`}>{value === 'rejected' && <XCircle size={15} weight="fill" aria-hidden="true" />}{statuses[value] || value}</span>; }
export function Readiness({ value, label = W.readiness }: { value: number; label?: string }) { const normalized = Math.max(0, Math.min(100, Number(value) || 0)); return <div className="mkw-readiness"><span>{label}<strong>{normalized}%</strong></span><progress aria-label={label} max={100} value={normalized} /></div>; }
export function workFormatDisplay(format: WorkFormat): string {
  return Number(format.width) > 0 && Number(format.height) > 0
    ? `${format.width} × ${format.height}` : format.name;
}
export function Formats({ formats }: { formats: WorkFormat[] }) {
  // Task/performer views show the requested OUTPUT SIZE, never the source
  // platform or its publishing purpose. Historical format IDs stay intact.
  const seen = new Set<string>();
  return <div className="mkw-chips">{formats.filter(format => {
    const label = workFormatDisplay(format);
    if(seen.has(label))return false;
    seen.add(label);return true;
  }).map(format => <span key={format.id} dir="ltr">{workFormatDisplay(format)}</span>)}</div>;
}
export function FormatSelector({ formats, selected, onChange, disabled }: { formats: WorkFormat[]; selected: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  // One visible checkbox per output dimension, even for older published formats.
  const uniqueFormats = [...new Map(formats.map(format => [workFormatDisplay(format),format])).values()];
  const selectedDimensions = new Set(formats.filter(format => selected.includes(format.id)).map(workFormatDisplay));
  return <details className="mkw-format-disclosure" open={uniqueFormats.length <= 5}>
    <summary><strong>{W.sizes}</strong><span className="mkw-muted">{selectedDimensions.size} / {uniqueFormats.length} ▾</span></summary>
    <div className="mkw-format-select">
      <div className="mkw-section-title"><strong>مقاسات التنفيذ</strong><label className="mkw-checkbox" onClick={event => event.stopPropagation()}><input type="checkbox" disabled={disabled || !uniqueFormats.length} checked={!!uniqueFormats.length && uniqueFormats.every(format => selectedDimensions.has(workFormatDisplay(format)))} onChange={event => onChange(event.target.checked ? uniqueFormats.map(format => format.id) : [])} />{W.selectAll}</label></div>
      {!uniqueFormats.length ? <Empty>{W.noSizes}</Empty> : <div className="mkw-chips mkw-dimension-options">{uniqueFormats.map(format => {
        const label = workFormatDisplay(format);
        const checked = selectedDimensions.has(label);
        return <label key={format.id} className={`mkw-format-chip ${checked ? 'selected' : ''}`}>
          <input type="checkbox" disabled={disabled} checked={checked} onChange={event => {
            const remainder=selected.filter(id => !formats.some(source => source.id === id && workFormatDisplay(source) === label));
            onChange(event.target.checked ? [...remainder,format.id] : remainder);
          }}/><span dir="ltr">{label}</span>
        </label>;
      })}</div>}
    </div>
  </details>;
}
export function FileLink({ file, onRemove }: { file: WorkFile; onRemove?: () => void }) { return <div className="mkw-file-link"><FileArrowDown size={20} /><a href={fileUrl(file.id, true)} target="_blank" rel="noreferrer">{file.name}</a><small>{(Number(file.file_size || 0) / 1024 / 1024).toFixed(1)} MB</small>{onRemove && <button type="button" className="icon-button" aria-label={W.remove} onClick={onRemove}><X size={16} /></button>}</div>; }
export function FilesPreview({ files }: { files: WorkFile[] }) {
  const unique = files.filter((file, index) => files.findIndex(other => other.id === file.id) === index);
  return <div className="mkw-preview-grid">{unique.map(file => <article key={file.id} className="mkw-preview-file">{file.mime_type.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(file.name) ? <video controls preload="metadata" src={fileUrl(file.id)} /> : <img src={fileUrl(file.id)} alt={file.name} loading="lazy" />}<FileLink file={file} /><a href={fileUrl(file.id)} target="_blank" rel="noreferrer">{W.newWindow}</a></article>)}</div>;
}
export function ProductPreview({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error, loading } = useWorkQuery<{ product: WorkProduct }>('product', { id });
  return <Modal open title={W.viewProduct} onClose={onClose} level={2} className="mkw-modal"><div className="mkw"><WorkAlert>{error}</WorkAlert>{loading && !data ? <Empty>{W.loading}</Empty> : data ? <><h3>{data.product.idea_name}</h3><div className="mkw-muted">{data.product.manual_product ? 'منتج يدوي' : `${data.product.task_no} — ${data.product.task_name}`}</div><Formats formats={data.product.formats} />{!data.product.manual_product && <FilesPreview files={data.product.files.filter(file => file.category === 'final')} />}</> : null}</div></Modal>;
}
export function ProductViewButton({ id }: { id: string }) { const [open, setOpen] = useState(false); return <><button type="button" className="secondary" onClick={() => setOpen(true)}><Eye size={17} />{W.viewProduct}</button>{open && <ProductPreview id={id} onClose={() => setOpen(false)} />}</>; }
