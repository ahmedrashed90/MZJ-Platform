import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarBlank, FilmStrip, ImageSquare, ListChecks, Megaphone, Plus, X } from '@phosphor-icons/react';
import { W, Empty, Field, FormatSelector, ProductViewButton, WorkAlert, WorkHeader } from './components';
import { showDate, uploadWorkFile, useWorkQuery, workPost, type WorkMeta } from './api';
import { ideaFileAllowed, isWorkDate, supportsWorkMedia, type WorkFormat, type WorkMediaKind, type WorkProduct } from '../../../shared/marketing-workflow';

type IdeaAttachment = { key: string; file: File; fileId?: string };
type RequiredDraft = { key: string; mediaKind: WorkMediaKind; idea: string; formatIds: string[]; dueOn: string; attachments: IdeaAttachment[] };
type AssigneeDraft = { key: string; departmentId: string; assigneeId: string; items: RequiredDraft[] };
type Reservation = { id: string; task_no: string; created_at: string };
const newRequired = (): RequiredDraft => ({ key: crypto.randomUUID(), mediaKind: 'image', idea: '', formatIds: [], dueOn: '', attachments: [] });
const newAssignee = (): AssigneeDraft => ({ key: crypto.randomUUID(), departmentId: '', assigneeId: '', items: [newRequired()] });

export function MarketingCreatePage() {
  const [params, setParams] = useSearchParams();
  const mode = ['task', 'campaign', 'agenda'].includes(params.get('mode') || '') ? params.get('mode')! : 'task';
  const query = useWorkQuery<WorkMeta>('meta');
  const choices = [
    { key: 'task', label: W.createTask, icon: ListChecks, allowed: query.data?.capabilities.createTask },
    { key: 'campaign', label: W.createCampaign, icon: Megaphone, allowed: query.data?.capabilities.createCampaign },
    { key: 'agenda', label: W.createAgenda, icon: CalendarBlank, allowed: query.data?.capabilities.createAgenda },
  ];
  return <div className="mkw"><WorkHeader title={W.create} /><WorkAlert>{query.error}</WorkAlert>
    <div className="mkw-create-tabs" role="tablist" aria-label={W.create}>{choices.map(choice => <button key={choice.key} type="button" role="tab" aria-selected={mode === choice.key} className={mode === choice.key ? 'active' : ''} disabled={!!query.data && !choice.allowed} onClick={() => setParams({ mode: choice.key })}><choice.icon size={21} />{choice.label}</button>)}</div>
    {!query.data ? <Empty>{query.loading ? W.loading : W.noData}</Empty> : !choices.find(choice => choice.key === mode)?.allowed ? <WorkAlert>{W.denied}</WorkAlert> : mode === 'task'
      ? <TaskComposer meta={query.data} /> : <PlanComposer key={mode} kind={mode as 'campaign' | 'agenda'} initialProduct={params.get('product') || ''} />}
  </div>;
}

function TaskComposer({ meta }: { meta: WorkMeta }) {
  const navigate = useNavigate(), requestKey = useRef(crypto.randomUUID());
  const [reservation, setReservation] = useState<Reservation | null>(null), [name, setName] = useState(''), [typeId, setTypeId] = useState('');
  const [assignees, setAssignees] = useState<AssigneeDraft[]>([newAssignee()]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [progress, setProgress] = useState<{ name: string; percent: number } | null>(null);
  const uploadController = useRef<AbortController | null>(null);
  useEffect(() => () => uploadController.current?.abort(), []);
  const reserve = useCallback(async () => {
    setError('');
    try { const result = await workPost<{ reservation: Reservation }>('reserve', { requestKey: requestKey.current }); setReservation(result.reservation); }
    catch (e) { setError(e instanceof Error ? e.message : W.invalid); }
  }, []);
  useEffect(() => { void reserve(); }, [reserve]);
  const formats = useMemo<WorkFormat[]>(() => meta.postTypes.flatMap(post => {
    const platform = meta.platforms.find(item => item.id === post.platform_id);
    return platform ? [{ ...post, platform_name: platform.name, platform_code: platform.code }] : [];
  }), [meta]);
  function changeAssignee(key: string, patch: Partial<AssigneeDraft>) { setAssignees(current => current.map(row => row.key === key ? { ...row, ...patch } : row)); }
  function changeItem(assigneeKey: string, key: string, patch: Partial<RequiredDraft>) {
    setAssignees(current => current.map(row => row.key === assigneeKey ? { ...row, items: row.items.map(item => item.key === key ? { ...item, ...patch } : item) } : row));
  }
  function attachFiles(assigneeKey: string, item: RequiredDraft, files: FileList | null) {
    if (!files) return;
    const next = Array.from(files);
    if (next.some(file => !ideaFileAllowed(file.name) || file.size <= 0 || file.size > 50 * 1024 ** 2)) { setError(W.fileInvalid); return; }
    changeItem(assigneeKey, item.key, { attachments: [...item.attachments, ...next.map(file => ({ key: crypto.randomUUID(), file }))] });
  }
  async function removeAttachment(assigneeKey: string, item: RequiredDraft, key: string) {
    const file = item.attachments.find(entry => entry.key === key);
    if (file?.fileId) await workPost('remove_upload', { fileId: file.fileId }).catch(() => undefined);
    changeItem(assigneeKey, item.key, { attachments: item.attachments.filter(entry => entry.key !== key) });
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return; setError('');
    if (!reservation || !name.trim() || !typeId || !assignees.length || assignees.some(row => !row.departmentId || !row.assigneeId || !row.items.length || row.items.some(item => !isWorkDate(item.dueOn) || !item.formatIds.length || (!item.idea.trim() && !item.attachments.length)))) { setError(W.requiredFields); return; }
    setBusy(true); uploadController.current = new AbortController();
    try {
      const items = [];
      for (const assignee of assignees) for (const item of assignee.items) {
        const fileIds: string[] = [];
        for (const attachment of item.attachments) {
          let fileId = attachment.fileId;
          if (!fileId) {
            fileId = await uploadWorkFile(attachment.file, { reservationId: reservation.id, category: 'idea' }, percent => setProgress({ name: attachment.file.name, percent }), uploadController.current.signal);
            attachment.fileId = fileId;
            setAssignees(current => current.map(row => ({ ...row, items: row.items.map(required => ({ ...required, attachments: required.attachments.map(file => file.key === attachment.key ? { ...file, fileId } : file) })) })));
          }
          fileIds.push(fileId);
        }
        items.push({ clientKey: item.key, departmentId: assignee.departmentId, assigneeId: assignee.assigneeId, mediaKind: item.mediaKind,
          idea: item.idea, formatIds: item.formatIds, dueOn: item.dueOn, ideaFileIds: fileIds });
      }
      const result = await workPost<{ id: string }>('create_task', { reservationId: reservation.id, typeId, name: name.trim(), items });
      navigate(`/marketing?task=${encodeURIComponent(result.id)}`);
    } catch (e) { setError(e instanceof Error ? e.message : W.invalid); }
    finally { setBusy(false); setProgress(null); uploadController.current = null; }
  }
  return <form onSubmit={save} className="mkw" aria-label={W.createTask}>
    <WorkAlert>{error}</WorkAlert>
    {!reservation && <button type="button" className="secondary" onClick={() => void reserve()}>{W.refresh}</button>}
    <section className="mkw-panel"><header><h2>{W.taskData}</h2></header><div className="mkw-fields">
      <Field label={W.taskNo}><input readOnly value={reservation?.task_no || ''} dir="ltr" /></Field>
      <Field label={W.createdAt}><input readOnly value={reservation ? showDate(reservation.created_at, true) : ''} /></Field>
      <Field label={W.taskType}><select required value={typeId} disabled={busy} onChange={event => setTypeId(event.target.value)}><option value="">{W.choose}</option>{meta.campaignTypes.map(type => <option value={type.id} key={type.id}>{type.name}</option>)}</select></Field>
      <Field label={W.taskName}><input required maxLength={250} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></Field>
    </div></section>
    <section className="mkw-panel"><header className="mkw-section-title"><h2>{W.assignments}</h2><button type="button" className="secondary" disabled={busy} onClick={() => setAssignees(current => [...current, newAssignee()])}><Plus size={17} />{W.addAssignee}</button></header>
      {assignees.map(assignee => <article className="mkw-assignee" key={assignee.key}><header>
        <Field label={W.department}><select required value={assignee.departmentId} disabled={busy} onChange={event => changeAssignee(assignee.key, { departmentId: event.target.value, assigneeId: '' })}><option value="">{W.choose}</option>{meta.departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}</select></Field>
        <Field label={W.assignee}><select required value={assignee.assigneeId} disabled={busy || !assignee.departmentId} onChange={event => changeAssignee(assignee.key, { assigneeId: event.target.value })}><option value="">{W.choose}</option>{meta.departments.find(department => department.id === assignee.departmentId)?.users.map(user => <option value={user.id} key={user.id}>{user.fullName || user.full_name}</option>)}</select></Field>
        <button type="button" className="icon-button" aria-label={W.remove} disabled={busy || assignees.length === 1} onClick={() => setAssignees(current => current.filter(row => row.key !== assignee.key))}><X size={18} /></button>
      </header>
      {assignee.items.map((item, index) => <section className="mkw-item" key={item.key}><div className="mkw-item-top"><div className="mkw-kind-picker"><strong>{W.required} {index + 1}</strong>{(['image', 'video'] as const).map(kind => <button type="button" key={kind} className={item.mediaKind === kind ? 'active' : ''} disabled={busy} onClick={() => changeItem(assignee.key, item.key, { mediaKind: kind, formatIds: item.formatIds.filter(id => supportsWorkMedia(kind, formats.find(format => format.id === id)?.name || '')) })}>{kind === 'image' ? <ImageSquare size={18} /> : <FilmStrip size={18} />}{kind === 'image' ? W.image : W.video}</button>)}</div><button type="button" className="icon-button" disabled={busy || assignee.items.length === 1} aria-label={W.remove} onClick={() => changeAssignee(assignee.key, { items: assignee.items.filter(row => row.key !== item.key) })}><X size={17} /></button></div>
        <div className="mkw-item-body"><Field label={W.idea}><textarea value={item.idea} maxLength={20000} disabled={busy} onChange={event => changeItem(assignee.key, item.key, { idea: event.target.value })} /></Field><div className="mkw"><Field label={W.ideaFile}><input type="file" accept=".doc,.docx,.xls,.xlsx" multiple disabled={busy} onChange={event => { attachFiles(assignee.key, item, event.target.files); event.target.value = ''; }} /></Field>{item.attachments.map(attachment => <div className="mkw-file-link" key={attachment.key}><span>{attachment.file.name}</span><button type="button" className="icon-button" aria-label={W.remove} disabled={busy} onClick={() => void removeAttachment(assignee.key, item, attachment.key)}><X size={14} /></button></div>)}<Field label={W.dueOn}><input type="date" required value={item.dueOn} disabled={busy} onChange={event => changeItem(assignee.key, item.key, { dueOn: event.target.value })} /></Field></div></div>
        <FormatSelector formats={formats.filter(format => supportsWorkMedia(item.mediaKind, format.name))} selected={item.formatIds} disabled={busy} onChange={formatIds => changeItem(assignee.key, item.key, { formatIds })} />
      </section>)}<footer className="mkw-assignee-footer"><button type="button" className="secondary" disabled={busy} onClick={() => changeAssignee(assignee.key, { items: [...assignee.items, newRequired()] })}><Plus size={17} />{W.addItem}</button></footer></article>)}
    </section>
    {progress && <div className="mkw-panel"><span>{progress.name} {progress.percent}%</span><progress value={progress.percent} max={100} /><button type="button" className="secondary" onClick={() => uploadController.current?.abort()}>{W.cancel}</button></div>}
    <footer className="mkw-form-footer"><button type="button" className="secondary" disabled={busy} onClick={() => navigate('/marketing')}>{W.cancel}</button><button type="submit" className="primary" disabled={busy || !reservation}>{busy ? W.loading : W.createTask}</button></footer>
  </form>;
}

function PlanComposer({ kind, initialProduct }: { kind: 'agenda' | 'campaign'; initialProduct: string }) {
  const navigate = useNavigate(), requestKey = useRef(crypto.randomUUID());
  const productsQuery = useWorkQuery<{ rows: WorkProduct[] }>('products');
  const [entries, setEntries] = useState([{ key: crypto.randomUUID(), date: '', productId: initialProduct }]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const dateLabel = kind === 'agenda' ? W.publishDate : W.fundingDate;
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return; setError('');
    if (!entries.length || entries.some(entry => !isWorkDate(entry.date) || !entry.productId)) { setError(W.requiredFields); return; }
    setBusy(true);
    try { await workPost('create_plan', { requestKey: requestKey.current, kind, entries }); navigate('/marketing'); }
    catch (e) { setError(e instanceof Error ? e.message : W.invalid); }
    finally { setBusy(false); }
  }
  return <form className="mkw-panel" onSubmit={save}><header className="mkw-section-title"><h2>{kind === 'agenda' ? W.createAgenda : W.createCampaign}</h2><button className="secondary" type="button" disabled={busy} onClick={() => setEntries(current => [...current, { key: crypto.randomUUID(), date: '', productId: '' }])}><Plus size={17} />{W.addDate}</button></header><WorkAlert>{error || productsQuery.error}</WorkAlert>
    {productsQuery.loading && !productsQuery.data ? <Empty>{W.loading}</Empty> : entries.map(entry => <div className="mkw-plan-editor-row" key={entry.key}>
      <Field label={dateLabel}><input required type="date" value={entry.date} disabled={busy} onChange={event => setEntries(current => current.map(row => row.key === entry.key ? { ...row, date: event.target.value } : row))} /></Field>
      <Field label={W.selectProduct}><select required value={entry.productId} disabled={busy} onChange={event => setEntries(current => current.map(row => row.key === entry.key ? { ...row, productId: event.target.value } : row))}><option value="">{W.choose}</option>{productsQuery.data?.rows.map(product => <option key={product.id} value={product.id}>{product.idea_name} - {product.task_no} - {product.media_kind === 'image' ? W.image : W.video}</option>)}</select></Field>
      {entry.productId ? <ProductViewButton id={entry.productId} /> : <span />}
      <button type="button" className="icon-button" aria-label={W.remove} disabled={busy || entries.length === 1} onClick={() => setEntries(current => current.filter(row => row.key !== entry.key))}><X size={18} /></button>
    </div>)}
    <footer className="mkw-form-footer"><button type="button" className="secondary" disabled={busy} onClick={() => navigate('/marketing')}>{W.cancel}</button><button type="submit" className="primary" disabled={busy || !productsQuery.data?.rows.length}>{busy ? W.loading : W.save}</button></footer>
  </form>;
}
