import { useEffect, useRef, useState } from 'react';
import { CheckCircle, PaperPlaneTilt, UploadSimple, X } from '@phosphor-icons/react';
import { Modal } from '../../components/Modal';
import { useAuth } from '../../auth/AuthContext';
import { hasPermission } from '../../systemAccess';
import { finalCoverage, ideaFileAllowed, workFileMatches, type WorkCapabilities, type WorkItem, type WorkTask } from '../../../shared/marketing-workflow';
import { W, Empty, Field, FileLink, FilesPreview, Formats, MediaLabel, Readiness, Status, WorkAlert } from './components';
import { showDate, showRange, uploadWorkFile, useWorkQuery, workPost, type WorkMeta } from './api';

type Detail = { task: WorkTask & { items: WorkItem[] }; events: { id: string; action: string; note: string; actor_name: string; created_at: string; item_id: string | null }[]; capabilities: WorkCapabilities };
export function TaskDetail({ id, onClose, onChanged, onlyItems }: { id: string; onClose: () => void; onChanged?: () => void; onlyItems?: string[] }) {
  const query = useWorkQuery<Detail>('task', { id }), meta = useWorkQuery<WorkMeta>('meta');
  const task = query.data?.task;
  async function refresh() { await query.reload(); onChanged?.(); }
  return <Modal open title={task ? `${task.task_no} - ${task.name}` : W.task} onClose={onClose} className="mkw-modal"><div className="mkw">
    <WorkAlert>{query.error || meta.error}</WorkAlert>
    {!task ? <Empty>{query.loading ? W.loading : W.noData}</Empty> : <>
      <div className="mkw-summary"><div><small>{W.taskType}</small><strong>{task.type_name}</strong></div><div><small>{W.createdAt}</small><strong>{showDate(task.created_at, true)}</strong></div><div><small>{W.dueOn}</small><strong>{showRange(task.due_from, task.due_to)}</strong></div><div><small>{W.productCount}</small><strong>{task.product_count}</strong></div></div>
      <Readiness value={task.readiness} />
      {!task.items.length ? <Empty>{W.emptyTask}</Empty> : task.items.filter(item => !onlyItems || onlyItems.includes(item.id)).map(item => <ItemEditor key={`${item.id}:${item.version}`} item={item} capabilities={query.data!.capabilities} meta={meta.data} refresh={refresh} />)}
      <details className="mkw-history"><summary>{W.history}</summary>{query.data!.events.map(event => <article key={event.id}><div className="mkw-section-title"><strong>{event.actor_name}</strong><small>{showDate(event.created_at, true)}</small></div><Status value={event.action} />{event.note && <p>{event.note}</p>}</article>)}</details>
    </>}
  </div></Modal>;
}

function ItemEditor({ item, capabilities, meta, refresh }: { item: WorkItem; capabilities: WorkCapabilities; meta: WorkMeta | null; refresh: () => Promise<void> }) {
  const { user } = useAuth();
  const own = user?.id === item.assigned_to;
  const editable = ['in_progress', 'revision'].includes(item.status) && (own || capabilities.editTask);
  const canUpload = editable && own && hasPermission(user, 'marketing.task.final_file.upload');
  const [idea, setIdea] = useState(item.idea), [ideaName, setIdeaName] = useState(item.idea_name), [dueOn, setDueOn] = useState(item.due_on);
  const [departmentId, setDepartmentId] = useState(item.department_id), [assigneeId, setAssigneeId] = useState(item.assigned_to);
  const [note, setNote] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ name: string; percent: number } | null>(null);
  const controller = useRef<AbortController | null>(null), version = useRef(item.version);
  useEffect(() => () => controller.current?.abort(), []);
  const ideaFiles = item.files.filter(file => file.category === 'idea'), finals = item.files.filter(file => file.category === 'final');
  async function persist() {
    if (!editable) return version.current;
    if (idea === item.idea && ideaName === item.idea_name && dueOn === item.due_on && departmentId === item.department_id && assigneeId === item.assigned_to) return version.current;
    const result = await workPost<{ version: number }>('save_item', { itemId: item.id, version: version.current, idea, ideaName,
      ...(capabilities.editTask ? { dueOn, departmentId, assigneeId } : {}) });
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
  return <article className="mkw-execution-item"><header className="mkw-section-title"><div><h3>{item.assignee_name}</h3><span className="mkw-muted">{item.department_name}</span></div><div className="mkw-actions"><MediaLabel kind={item.media_kind} /><Status value={item.status} /></div></header><div className="mkw-item">
    <WorkAlert>{error}</WorkAlert>
    {item.review_note && <div className="mkw-alert"><strong>{W.reviewNote}</strong><p className="mkw-idea-text">{item.review_note}</p></div>}
    <div className="mkw-fields"><Field label={W.ideaName}><input value={ideaName} readOnly={!editable} disabled={busy} maxLength={250} onChange={event => setIdeaName(event.target.value)} /></Field><Field label={W.dueOn}><input type="date" value={dueOn} readOnly={!editable || !capabilities.editTask} disabled={busy} onChange={event => setDueOn(event.target.value)} /></Field>
      {editable && capabilities.editTask && meta ? <><Field label={W.department}><select value={departmentId} disabled={busy} onChange={event => { setDepartmentId(event.target.value); setAssigneeId(''); }}>{meta.departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}</select></Field><Field label={W.assignee}><select value={assigneeId} disabled={busy} onChange={event => setAssigneeId(event.target.value)}><option value="">{W.choose}</option>{meta.departments.find(department => department.id === departmentId)?.users.map(member => <option key={member.id} value={member.id}>{member.fullName || member.full_name}</option>)}</select></Field></> : null}
    </div>
    <Field label={W.idea}>{editable ? <textarea value={idea} disabled={busy} maxLength={20000} onChange={event => setIdea(event.target.value)} /> : <p className="mkw-idea-text">{idea}</p>}</Field>
    {ideaFiles.length > 0 && <section className="mkw-upload-section"><h4>{W.ideaFile}</h4>{ideaFiles.map(file => <FileLink key={file.id} file={file} onRemove={editable && !busy ? () => void run(async () => { await persist(); await workPost('remove_upload', { itemId: item.id, fileId: file.id }); }) : undefined} />)}</section>}
    {editable && <Field label={W.ideaFile}><input type="file" accept=".doc,.docx,.xls,.xlsx" multiple disabled={busy} onChange={event => { void upload(event.target.files, 'idea'); event.target.value = ''; }} /></Field>}
    <Formats formats={item.formats} />
    <section className="mkw-upload-section"><h4>{W.finalFiles}</h4>{item.formats.map(format => <div className="mkw-upload-format" key={format.id}><div className="mkw-section-title"><strong>{format.platform_name} - {format.name}{format.width && format.height ? ` (${format.width} x ${format.height})` : ''}</strong>{finals.some(file => file.format_id === format.id) ? <CheckCircle size={19} /> : <UploadSimple size={19} />}</div>
      {finals.filter(file => file.format_id === format.id).map(file => <FileLink key={`${format.id}:${file.id}`} file={file} onRemove={canUpload && !busy ? () => void run(async () => { await persist(); await workPost('remove_upload', { itemId: item.id, fileId: file.id }); }) : undefined} />)}
      {canUpload && <input aria-label={`${W.upload} ${format.platform_name} ${format.name}`} type="file" accept={item.media_kind === 'image' ? '.jpg,.jpeg,.png,.webp,.gif,.heic,.heif' : '.mp4,.mov,.m4v,.webm'} multiple={item.media_kind === 'image'} disabled={busy} onChange={event => { void upload(event.target.files, 'final', [format.id]); event.target.value = ''; }} />}
    </div>)}</section>
    {item.pending_uploads?.map(file => <div className="mkw-file-link" key={file.id}><span>{file.name}</span><span className="mkw-muted">{W.loading}</span>{canUpload && <button type="button" className="icon-button" aria-label={W.cancel} disabled={busy} onClick={() => void run(() => workPost('remove_upload', { itemId: item.id, fileId: file.id }))}><X size={15} /></button>}</div>)}
    {progress && <div className="mkw-upload-format"><span>{progress.name} {progress.percent}%</span><progress max={100} value={progress.percent} /><button type="button" className="secondary" onClick={() => controller.current?.abort()}>{W.cancel}</button></div>}
    {!!finals.length && <details><summary>{W.viewProduct}</summary><FilesPreview files={finals} /></details>}
    {!!item.actions?.length && <section className="mkw-upload-section"><h4>{W.assignmentActions}</h4><div className="mkw-chips">{item.actions.filter(action => !action.is_final_approval).map(action => <label key={action.id} className="mkw-checkbox"><input type="checkbox" checked={action.completed} disabled={busy || !editable || !hasPermission(user, action.admin_only ? 'marketing.assignment_action.admin' : 'marketing.assignment_action.execute')} onChange={event => { const completed = event.target.checked; void run(async () => { const nextVersion = await persist(); await workPost('action', { itemId: item.id, actionId: action.id, version: nextVersion, completed }); }); }} />{action.name}</label>)}</div></section>}
    {editable && <footer className="mkw-actions"><button type="button" className="secondary" disabled={busy || (capabilities.editTask && !assigneeId)} onClick={() => void run(persist)}>{W.save}</button>{canUpload && <button type="button" className="primary" disabled={busy || !finalCoverage(item) || !!item.pending_uploads?.length} onClick={() => void run(async () => { const nextVersion = await persist(); await workPost('submit', { itemId: item.id, version: nextVersion }); })}><PaperPlaneTilt size={18} />{W.submit}</button>}</footer>}
    {capabilities.review && item.status === 'submitted' && <section className="mkw-review-controls"><Field label={W.reviewNote}><textarea value={note} disabled={busy} onChange={event => setNote(event.target.value)} /></Field><div className="mkw-actions"><button type="button" className="primary" disabled={busy} onClick={() => void review('approve')}>{W.approve}</button><button type="button" className="secondary" disabled={busy} onClick={() => void review('revise')}>{W.revise}</button><button type="button" className="secondary danger" disabled={busy} onClick={() => void review('reject')}>{W.reject}</button></div></section>}
  </div></article>;
}
