import { useEffect, useRef, useState } from 'react';
import { CaretDown, CheckCircle, Clock, FileArrowDown, PaperPlaneTilt, UploadSimple, UserCircle, X } from '@phosphor-icons/react';
import { Modal } from '../../components/Modal';
import { useAuth } from '../../auth/AuthContext';
import { hasPermission } from '../../systemAccess';
import { finalCoverage, ideaFileAllowed, workFileMatches, type WorkCapabilities, type WorkItem, type WorkTask } from '../../../shared/marketing-workflow';
import { W, Empty, Field, FileLink, FilesPreview, Formats, MediaLabel, Readiness, Status, WorkAlert } from './components';
import { showDate, showRange, uploadWorkFile, useWorkQuery, workPost } from './api';

// The database uses the same Riyadh civil date for its on-time/late counts.
function submittedDayInRiyadh(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh' }) : '—';
}

type Detail = { task: WorkTask & { items: WorkItem[] }; events: { id: string; action: string; note: string; actor_name: string; created_at: string; item_id: string | null }[]; capabilities: WorkCapabilities };
export function TaskDetail({ id, onClose, onChanged, onlyItems, deliveryFilter = '' }: { id: string; onClose: () => void; onChanged?: () => void; onlyItems?: string[]; deliveryFilter?: '' | 'on_time' | 'late' }) {
  const query = useWorkQuery<Detail>('task', { id });
  const [openedRequirementId, setOpenedRequirementId] = useState('');
  const task = query.data?.task;
  const items = task?.items.filter(item => (!onlyItems || onlyItems.includes(item.id)) && (!deliveryFilter || item.delivery_status === deliveryFilter)) || [];
  async function refresh() { await query.reload(); onChanged?.(); }
  return <Modal open title={task ? `${task.task_no} - ${task.name}` : W.task} onClose={onClose} className="mkw-fullscreen">
    <div className="mkw mkw-detail-view">
      <WorkAlert>{query.error}</WorkAlert>
      {!task ? <Empty>{query.loading ? W.loading : W.noData}</Empty> : <>
        <section className="mkw-detail-overview">
          <div className="mkw-detail-title"><div><span className="mkw-code">{task.task_no}</span><h2>{task.name}</h2></div><Status value={task.status} /></div>
          <div className="mkw-summary"><div><small>{W.taskNo}</small><strong dir="ltr">{task.task_no}</strong></div><div><small>{W.taskType}</small><strong>{task.type_name}</strong></div><div><small>{W.createdAt}</small><strong>{showDate(task.created_at, true)}</strong></div><div><small>{W.dueOn}</small><strong>{showRange(task.due_from, task.due_to)}</strong></div><div><small>{W.productCount}</small><strong>{task.product_count}</strong></div></div>
          <Readiness value={task.readiness} />
        </section>
        <section className="mkw-detail-items"><div className="mkw-section-title"><h2>{deliveryFilter === 'on_time' ? W.deliveryOnTime : deliveryFilter === 'late' ? W.deliveryLate : W.assignments}</h2><span className="mkw-muted">{items.length} {W.required}</span></div>
          {!items.length ? <Empty>{W.emptyTask}</Empty> : <div className="mkw-requirement-review-list">
            <div className="mkw-requirement-review-progress" role="status">تم اعتماد {items.filter(item => item.status === 'approved').length} من {items.length} مطلوب — الاعتماد مستقل لكل مطلوب</div>
            {items.map((item, index) => {
              const opened = openedRequirementId === item.id;
              return <section key={item.id} className={`mkw-requirement-review-entry ${opened ? 'is-open' : ''}`}>
                <button type="button" className="mkw-requirement-review-toggle" aria-expanded={opened} onClick={() => setOpenedRequirementId(opened ? '' : item.id)}>
                  <span className="mkw-item-number">{index + 1}</span>
                  <span className="mkw-requirement-review-identify"><strong>{W.required} {index + 1}: {item.idea_name}</strong><small>{W.assignee}: {item.assignee_name} · {item.media_kind === 'video' ? W.video : W.image}</small></span>
                  <Status value={item.status}/>
                  {item.status === 'approved' ? <span className="mkw-requirement-reviewed"><CheckCircle size={18} weight="fill"/>تم اعتماد المطلوب</span> : item.status === 'submitted' ? <span className="mkw-requirement-waiting">بانتظار اعتماد المطلوب</span> : null}
                  <span className="mkw-requirement-review-label">{opened ? 'إغلاق' : item.status === 'submitted' && query.data!.capabilities.review ? 'فتح واعتماد' : 'فتح المطلوب'}<CaretDown size={16}/></span>
                </button>
                {opened && <ItemEditor key={`${item.id}:${item.version}`} item={item} number={index + 1} capabilities={query.data!.capabilities} refresh={refresh} />}
              </section>;
            })}
          </div>}
        </section>
        <details className="mkw-history"><summary>{W.history}</summary>{query.data!.events.map(event => <article key={event.id}><div className="mkw-section-title"><strong>{event.actor_name}</strong><small>{showDate(event.created_at, true)}</small></div><Status value={event.action} />{event.note && <p>{event.note}</p>}</article>)}</details>
      </>}
    </div>
  </Modal>;
}

function ItemEditor({ item, number, capabilities, refresh }: { item: WorkItem; number: number; capabilities: WorkCapabilities; refresh: () => Promise<void> }) {
  const { user } = useAuth();
  const own = user?.id === item.assigned_to;
  const editable = ['in_progress', 'revision'].includes(item.status) && (own || capabilities.editTask);
  const canUpload = editable && own && hasPermission(user, 'marketing.task.final_file.upload');
  const [idea, setIdea] = useState(item.idea), [ideaName, setIdeaName] = useState(item.idea_name), [dueOn, setDueOn] = useState(item.due_on);

  const [note, setNote] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ name: string; percent: number } | null>(null);
  const controller = useRef<AbortController | null>(null), version = useRef(item.version);
  useEffect(() => () => controller.current?.abort(), []);
  const ideaFiles = item.files.filter(file => file.category === 'idea'), finals = item.files.filter(file => file.category === 'final');
  async function persist() {
    if (!editable) return version.current;
    if (idea === item.idea && ideaName === item.idea_name && dueOn === item.due_on) return version.current;
    const result = await workPost<{ version: number }>('save_item', { itemId: item.id, version: version.current, idea, ideaName,
      ...(capabilities.editTask ? { dueOn } : {}) });
    version.current = result.version; return result.version;
  }
  async function run(operation: () => Promise<unknown>) {
    if (busy) return; setBusy(true); setError('');
    try { await operation(); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : W.invalid); }
    finally { setBusy(false); }
  }
  async function upload(files: FileList | null, category: 'idea' | 'final', formatIds: string[] = []) {
    if (!files?.length || busy) return;
    const selected = Array.from(files);
    if (selected.some(file => category === 'idea' ? !ideaFileAllowed(file.name) : !workFileMatches(item.media_kind, file.name, file.type))) { setError(W.fileInvalid); return; }
    await run(async () => {
      await persist(); controller.current = new AbortController();
      try { for (const file of selected) await uploadWorkFile(file, { itemId: item.id, category, formatIds }, percent => setProgress({ name: file.name, percent }), controller.current.signal); }
      finally { setProgress(null); controller.current = null; }
    });
  }
  async function review(decision: 'approve' | 'revise' | 'reject') {
    if (decision === 'revise' && !note.trim()) { setError(W.notesRequired); return; }
    if (decision === 'reject' && !window.confirm(W.rejectedConfirm)) return;
    await run(() => workPost('review', { itemId: item.id, version: version.current, decision, note }));
  }
  return <article className="mkw-execution-item"><header className="mkw-execution-header"><div className="mkw-execution-title"><span className="mkw-item-number">{number}</span><div><h3>{W.required} {number}</h3><div className="mkw-muted"><UserCircle size={16} />{W.assignee}: {item.assignee_name} · {W.department}: {item.department_name}</div></div></div><div className="mkw-actions"><MediaLabel kind={item.media_kind} /><Status value={item.status} />{item.delivery_status && <span className={`mkw-delivery-badge ${item.delivery_status === 'on_time' ? 'is-on-time' : 'is-late'}`}>{item.delivery_status === 'on_time' ? W.deliveryOnTime : W.deliveryLate}</span>}</div></header>
    <div className="mkw-item"><WorkAlert>{error}</WorkAlert>
      {item.delivery_status && <div className="mkw-execution-delivery"><span>{W.dueOn}: <strong>{showDate(item.due_on)}</strong></span><span>{W.deliveredAt}: <strong>{submittedDayInRiyadh(item.submitted_at)}</strong></span></div>}
      {item.review_note && <div className="mkw-alert"><strong>{W.reviewNote}</strong><p className="mkw-idea-text">{item.review_note}</p></div>}
      <div className="mkw-item-detail-grid">
        <section className="mkw-item-idea"><div className="mkw-section-title"><h4>{W.idea}</h4></div>
          <div className="mkw-execution-quick-row">
            <Field label={W.required}><input value={ideaName} readOnly={!editable} disabled={busy} maxLength={250} onChange={event => setIdeaName(event.target.value)} /></Field>
            <div className="mkw-execution-formats"><strong>{W.sizes}</strong><Formats formats={item.formats}/></div>
            <Field label={W.idea}>{editable ? <textarea value={idea} disabled={busy} maxLength={20000} onChange={event => setIdea(event.target.value)}/> : <p className="mkw-idea-text">{idea}</p>}</Field>
            <Field label={W.dueOn}><input type="date" value={dueOn} readOnly={!editable || !capabilities.editTask} disabled={busy} onChange={event => setDueOn(event.target.value)}/></Field>
          </div>
          <section className="mkw-upload-section"><h4>{W.ideaFile}</h4>{ideaFiles.map(file => <FileLink key={file.id} file={file} onRemove={editable && !busy ? () => void run(async () => { await persist(); await workPost('remove_upload', { itemId: item.id, fileId: file.id }); }) : undefined} />)}
            {editable && <input type="file" aria-label={W.ideaFile} accept=".doc,.docx,.xls,.xlsx" multiple disabled={busy} onChange={event => { void upload(event.target.files, 'idea'); event.target.value = ''; }} />}
            {!ideaFiles.length && !editable && <span className="mkw-muted">—</span>}
          </section>

        </section>
        <section className="mkw-item-finals"><div className="mkw-section-title"><h4>{W.finalFiles}</h4><span className="mkw-muted"><Clock size={16} /> {finals.length} / {item.formats.length}</span></div>
          <div className="mkw-final-grid">{item.formats.map(format => <div className="mkw-upload-format" key={format.id}><div className="mkw-section-title"><strong>{format.platform_name} · {format.name}{format.width && format.height ? ` (${format.width} × ${format.height})` : ''}</strong>{finals.some(file => file.format_id === format.id) ? <CheckCircle size={19} /> : <UploadSimple size={19} />}</div>
            {finals.filter(file => file.format_id === format.id).map(file => <FileLink key={`${format.id}:${file.id}`} file={file} onRemove={canUpload && !busy ? () => void run(async () => { await persist(); await workPost('remove_upload', { itemId: item.id, fileId: file.id }); }) : undefined} />)}
            {canUpload && <label className="mkw-upload-action"><UploadSimple size={17} /><span>{W.upload} {W.finalFiles}</span><input type="file" accept={item.media_kind === 'image' ? '.jpg,.jpeg,.png,.webp,.gif,.heic,.heif' : '.mp4,.mov,.m4v,.webm'} multiple={item.media_kind === 'image'} disabled={busy} onChange={event => { void upload(event.target.files, 'final', [format.id]); event.target.value = ''; }} /></label>}
          </div>)}</div>
          {item.pending_uploads?.map(file => <div className="mkw-file-link" key={file.id}><span>{file.name}</span><span className="mkw-muted">{W.loading}</span>{canUpload && <button type="button" className="icon-button" aria-label={W.cancel} disabled={busy} onClick={() => void run(() => workPost('remove_upload', { itemId: item.id, fileId: file.id }))}><X size={15} /></button>}</div>)}
          {progress && <div className="mkw-upload-format"><span>{progress.name} {progress.percent}%</span><progress max={100} value={progress.percent} /><button type="button" className="secondary" onClick={() => controller.current?.abort()}>{W.cancel}</button></div>}
          {!!finals.length && <details><summary><FileArrowDown size={17} />{W.viewProduct}</summary><FilesPreview files={finals} /></details>}
        </section>
      </div>
      {editable && <footer className="mkw-actions"><button type="button" className="secondary" disabled={busy} onClick={() => void run(persist)}>{W.save}</button>{canUpload && <button type="button" className="primary" disabled={busy || !finalCoverage(item) || !!item.pending_uploads?.length} onClick={() => void run(async () => { const nextVersion = await persist(); await workPost('submit', { itemId: item.id, version: nextVersion }); })}><PaperPlaneTilt size={18} />{W.submit}</button>}</footer>}
      {capabilities.review && item.status === 'submitted' && <section className="mkw-review-controls"><Field label={W.reviewNote}><textarea value={note} disabled={busy} onChange={event => setNote(event.target.value)} /></Field><div className="mkw-actions"><button type="button" className="primary" disabled={busy} onClick={() => void review('approve')}>{W.approve}</button><button type="button" className="secondary" disabled={busy} onClick={() => void review('revise')}>{W.revise}</button><button type="button" className="secondary danger" disabled={busy} onClick={() => void review('reject')}>{W.reject}</button></div></section>}
    </div>
  </article>;
}
