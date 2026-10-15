import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarBlank, FilmStrip, ImageSquare, ListChecks, Megaphone, Plus, X } from '@phosphor-icons/react';
import { W, Empty, Field, FormatSelector, ProductViewButton, WorkAlert, WorkHeader } from './components';
import { showDate, uploadWorkFile, useWorkQuery, workPost, type WorkMeta } from './api';
import { ideaFileAllowed, isWorkDate, supportsWorkMedia, type WorkFormat, type WorkMediaKind, type WorkProduct } from '../../../shared/marketing-workflow';

type IdeaAttachment = { key: string; file: File; fileId?: string };
type RequiredDraft = { key: string; departmentId: string; assigneeId: string; mediaKind: WorkMediaKind; ideaName: string; idea: string; formatIds: string[]; dueOn: string; attachments: IdeaAttachment[] };
type Reservation = { id: string; task_no: string; created_at: string };
const newRequired = (): RequiredDraft => ({ key: crypto.randomUUID(), departmentId: '', assigneeId: '', mediaKind: 'image', ideaName: '', idea: '', formatIds: [], dueOn: '', attachments: [] });

type PlanEntry = { key: string; date: string; productId: string; platformId: string; postTypeId: string; budget: string };
const newEntry = (productId = ''): PlanEntry => ({ key: crypto.randomUUID(), date: '', productId, platformId: '', postTypeId: '', budget: '' });

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
    {!query.data ? <section className="mkw-panel mkw-loading-panel"><div className="mkw-loading-indicator" aria-hidden="true" /><strong>{query.loading ? W.loading : W.noData}</strong>{!query.loading && <button type="button" className="secondary" onClick={() => void query.reload()}>{W.refresh}</button>}</section> : !choices.find(choice => choice.key === mode)?.allowed ? <WorkAlert>{W.denied}</WorkAlert> : mode === 'task'
      ? <TaskComposer meta={query.data} /> : <PlanComposer key={mode} kind={mode as 'campaign' | 'agenda'} initialProduct={params.get('product') || ''} meta={query.data} />}
  </div>;
}

function TaskComposer({ meta }: { meta: WorkMeta }) {
  const navigate = useNavigate(), requestKey = useRef(crypto.randomUUID());
  const [reservation, setReservation] = useState<Reservation | null>(null), [name, setName] = useState(''), [typeId, setTypeId] = useState('');
  const [items, setItems] = useState<RequiredDraft[]>([newRequired()]);
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
  function changeItem(key: string, patch: Partial<RequiredDraft>) {
    setItems(current => current.map(item => item.key === key ? { ...item, ...patch } : item));
  }
  function attachFiles(item: RequiredDraft, files: FileList | null) {
    if (!files) return;
    const next = Array.from(files);
    if (next.some(file => !ideaFileAllowed(file.name) || file.size <= 0 || file.size > 50 * 1024 ** 2)) { setError(W.fileInvalid); return; }
    changeItem(item.key, { attachments: [...item.attachments, ...next.map(file => ({ key: crypto.randomUUID(), file }))] });
  }
  async function removeAttachment(item: RequiredDraft, key: string) {
    const file = item.attachments.find(entry => entry.key === key);
    if (file?.fileId) await workPost('remove_upload', { fileId: file.fileId }).catch(() => undefined);
    changeItem(item.key, { attachments: item.attachments.filter(entry => entry.key !== key) });
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return; setError('');
    if (!reservation || !name.trim() || !typeId || !items.length || items.some(item => !item.departmentId || !item.assigneeId || !item.ideaName.trim() || !isWorkDate(item.dueOn) || !item.formatIds.length || (!item.idea.trim() && !item.attachments.length))) { setError(W.requiredFields); return; }
    setBusy(true); uploadController.current = new AbortController();
    try {
      const created = [];
      for (const item of items) {
        const fileIds: string[] = [];
        for (const attachment of item.attachments) {
          let fileId = attachment.fileId;
          if (!fileId) {
            fileId = await uploadWorkFile(attachment.file, { reservationId: reservation.id, category: 'idea' }, percent => setProgress({ name: attachment.file.name, percent }), uploadController.current.signal);
            attachment.fileId = fileId;
            setItems(current => current.map(row => ({ ...row, attachments: row.attachments.map(file => file.key === attachment.key ? { ...file, fileId } : file) })));
          }
          fileIds.push(fileId);
        }
        created.push({ clientKey: item.key, departmentId: item.departmentId, assigneeId: item.assigneeId, mediaKind: item.mediaKind,
          ideaName: item.ideaName.trim(), idea: item.idea, formatIds: item.formatIds, dueOn: item.dueOn, ideaFileIds: fileIds });
      }
      const result = await workPost<{ id: string }>('create_task', { reservationId: reservation.id, typeId, name: name.trim(), items: created });
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
    <section className="mkw-panel mkw-requirements-panel"><header className="mkw-section-title"><h2>{W.assignments}</h2><span className="mkw-muted">{items.length} {W.required}</span></header>
      <div className="mkw-horizontal-scroll"><div className="mkw-horizontal-table"><div className="mkw-horizontal-heading"><span>{W.assignee}</span><span>{W.required}</span><span>{W.sizes}</span><span>{W.idea}</span><span>{W.dueOn}</span><span>{W.remove}</span></div>
      {items.map(item => <div className="mkw-horizontal-row" key={item.key}>
        <div><select aria-label={W.assignee} required value={item.departmentId && item.assigneeId ? `${item.departmentId}|${item.assigneeId}` : ''} disabled={busy} onChange={event => { const [departmentId, assigneeId] = event.target.value.split('|'); changeItem(item.key, { departmentId: departmentId || '', assigneeId: assigneeId || '' }); }}><option value="">{W.choose}</option>{Array.from(new Map(meta.departments.flatMap(department => department.users.map(user => [user.id, { departmentId: department.id, user }] as const))).values()).sort((a, b) => String(a.user.fullName || a.user.full_name || '').localeCompare(String(b.user.fullName || b.user.full_name || ''), 'ar')).map(({ departmentId, user }) => <option key={user.id} value={`${departmentId}|${user.id}`}>{user.fullName || user.full_name}</option>)}</select></div>
        <div className="mkw-requirement-type"><input aria-label={W.required} required maxLength={250} value={item.ideaName} disabled={busy} placeholder={W.required} onChange={event => changeItem(item.key, { ideaName: event.target.value })}/><div className="mkw-kind-toggle">{(['image', 'video'] as const).map(kind => <button type="button" key={kind} className={item.mediaKind === kind ? 'active' : ''} disabled={busy} onClick={() => changeItem(item.key, { mediaKind: kind, formatIds: item.formatIds.filter(id => supportsWorkMedia(kind, formats.find(format => format.id === id)?.name || '')) })}>{kind === 'image' ? <ImageSquare size={16}/> : <FilmStrip size={16}/>} {kind === 'image' ? W.image : W.video}</button>)}</div></div>
        <div className="mkw-requirement-formats"><FormatSelector formats={formats.filter(format => supportsWorkMedia(item.mediaKind, format.name))} selected={item.formatIds} disabled={busy} onChange={formatIds => changeItem(item.key, { formatIds })} /></div>
        <div className="mkw-requirement-idea"><textarea aria-label={W.idea} value={item.idea} maxLength={20000} disabled={busy} placeholder={W.idea} onChange={event => changeItem(item.key, { idea: event.target.value })}/><label className="mkw-inline-file">{W.ideaFile}<input type="file" accept=".doc,.docx,.xls,.xlsx" multiple disabled={busy} onChange={event => { attachFiles(item, event.target.files); event.target.value = ''; }}/></label>{item.attachments.map(file => <span className="mkw-requirement-file" key={file.key}>{file.file.name}<button type="button" className="icon-button" aria-label={W.remove} disabled={busy} onClick={() => void removeAttachment(item, file.key)}><X size={13}/></button></span>)}</div>
        <div><input type="date" aria-label={W.dueOn} required value={item.dueOn} disabled={busy} onChange={event => changeItem(item.key, { dueOn: event.target.value })}/></div>
        <div><button type="button" className="icon-button mkw-remove-requirement" aria-label={W.remove} disabled={busy || items.length === 1} onClick={() => setItems(current => current.filter(row => row.key !== item.key))}><X size={18}/></button></div>
      </div>)}</div></div><footer className="mkw-requirement-footer"><button type="button" className="secondary" disabled={busy} onClick={() => setItems(current => [...current, newRequired()])}><Plus size={17}/>{W.addItem}</button></footer>
    </section>
    {progress && <div className="mkw-panel"><span>{progress.name} {progress.percent}%</span><progress value={progress.percent} max={100}/><button type="button" className="secondary" onClick={() => uploadController.current?.abort()}>{W.cancel}</button></div>}
    <footer className="mkw-form-footer"><button type="button" className="secondary" disabled={busy} onClick={() => navigate('/marketing')}>{W.cancel}</button><button type="submit" className="primary" disabled={busy || !reservation}>{busy ? W.loading : W.createTask}</button></footer>
  </form>;
}

function PlanComposer({ kind, initialProduct, meta }: { kind: 'agenda' | 'campaign'; initialProduct: string; meta: WorkMeta }) {
  const navigate = useNavigate(), requestKey = useRef(crypto.randomUUID());
  const productsQuery = useWorkQuery<{ rows: WorkProduct[] }>('products');
  const [name, setName] = useState('');
  const [entries, setEntries] = useState<PlanEntry[]>([newEntry(initialProduct)]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const dateLabel = kind === 'agenda' ? W.publishDate : W.fundingDate;
  const label = kind === 'agenda' ? W.agenda : W.campaign;
  // The publishing catalog is controlled in marketing settings, not by a task's requested formats.
  const activePlatforms = meta.platforms.filter(platform => meta.postTypes.some(type => type.platform_id === platform.id));
  const productGroups = useMemo(() => {
    const groups = new Map<string, { title: string; rows: WorkProduct[] }>();
    for (const product of productsQuery.data?.rows || []) {
      const key = product.task_id || product.task_no;
      if (!groups.has(key)) groups.set(key, { title: `${product.task_no} — ${product.task_name}`, rows: [] });
      groups.get(key)!.rows.push(product);
    }
    return Array.from(groups.values());
  }, [productsQuery.data]);
  const previewRows = entries.map((entry, index) => ({
    index: index + 1,
    entry,
    product: productsQuery.data?.rows.find(product => product.id === entry.productId),
    platform: meta.platforms.find(platform => platform.id === entry.platformId),
    postType: meta.postTypes.find(type => type.id === entry.postTypeId),
    valid: isWorkDate(entry.date) && Boolean(entry.productId && entry.platformId && entry.postTypeId) && (kind === 'agenda' || (entry.budget !== '' && Number.isFinite(Number(entry.budget)) && Number(entry.budget) >= 0)),
  }));
  function updateEntry(key: string, patch: Partial<PlanEntry>) { setEntries(current => current.map(row => row.key === key ? { ...row, ...patch } : row)); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return; setError('');
    if (!entries.length || entries.some(entry => !isWorkDate(entry.date) || !entry.productId || !entry.platformId || !entry.postTypeId || (kind === 'campaign' && (!entry.budget || Number(entry.budget) < 0)))) { setError(W.requiredFields); return; }
    setBusy(true);
    try { await workPost('create_plan', { requestKey: requestKey.current, kind, name: name.trim(), entries: entries.map(entry => ({ date: entry.date, productId: entry.productId, postTypeId: entry.postTypeId, budget: kind === 'campaign' ? Number(entry.budget) : 0 })) }); navigate('/marketing'); }
    catch (e) { setError(e instanceof Error ? e.message : W.invalid); }
    finally { setBusy(false); }
  }
  return <form className="mkw mkw-plan-composer" onSubmit={save}><section className="mkw-panel"><header><h2>بيانات {label}</h2></header><div className="mkw-fields"><Field label={`اسم ${label}`}><input maxLength={250} value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder={`اسم ${label}`}/></Field></div></section>
    <section className="mkw-panel"><header className="mkw-section-title"><h2>{kind === 'campaign' ? W.createCampaign : W.createAgenda}</h2><span>{entries.length} {W.addDate}</span></header><WorkAlert>{error || productsQuery.error}</WorkAlert>
    {productsQuery.loading && !productsQuery.data ? <Empty>{W.loading}</Empty> : <div className="mkw-horizontal-scroll"><div className={`mkw-plan-table ${kind === 'agenda' ? 'agenda' : ''}`}><div className="mkw-plan-heading"><span>{dateLabel}</span><span>{W.selectProduct}</span><span>المنصة</span><span>نوع النشر</span>{kind === 'campaign' && <span>الميزانية</span>}<span>{W.remove}</span></div>
      {entries.map(entry => {
        const product = productsQuery.data?.rows.find(product => product.id === entry.productId);
        const platforms = activePlatforms.filter(platform => meta.postTypes.some(type => type.platform_id === platform.id && (!product || supportsWorkMedia(product.media_kind, type.name))));
        const postTypes = meta.postTypes.filter(type => type.platform_id === entry.platformId && (!product || supportsWorkMedia(product.media_kind, type.name)));
        return <div className="mkw-plan-table-row" key={entry.key}>
          <input aria-label={dateLabel} type="date" required value={entry.date} disabled={busy} onChange={event => updateEntry(entry.key, { date: event.target.value })}/>
          <div className="mkw-plan-product-picker">
            <select aria-label={W.selectProduct} required value={entry.productId} disabled={busy} onChange={event => updateEntry(entry.key, { productId: event.target.value, platformId: '', postTypeId: '' })}>
              <option value="">اختر المطلوب / المنتج من التاسك</option>
              {productGroups.map(group => <optgroup key={group.title} label={group.title}>{group.rows.map(candidate => <option key={candidate.id} value={candidate.id}>المطلوب {candidate.sort_order} — {candidate.idea_name} — {candidate.media_kind === 'video' ? 'فيديو' : 'صورة'} — {candidate.assignee_name || '—'} — {candidate.idea.slice(0, 65)}</option>)}</optgroup>)}
            </select>
            {product && <div className="mkw-plan-product-preview" role="status">
              <strong>{product.idea_name}</strong>
              <span><b>التاسك:</b> {product.task_no} — {product.task_name}</span>
              <span><b>الفكرة:</b> {product.idea || '—'}</span>
              <span><b>النوع:</b> {product.media_kind === 'video' ? 'فيديو' : 'صورة'} · <b>المنفذ:</b> {product.assignee_name || '—'} · <b>المقاسات:</b> {product.formats.length}</span>
              <div className="mkw-plan-product-view"><ProductViewButton id={product.id}/></div>
            </div>}
          </div>
          <select aria-label="المنصة" required value={entry.platformId} disabled={busy || !entry.productId} onChange={event => updateEntry(entry.key, { platformId: event.target.value, postTypeId: '' })}><option value="">{W.choose}</option>{platforms.map(platform => <option key={platform.id} value={platform.id}>{platform.name}</option>)}</select>
          <select aria-label="نوع النشر" required value={entry.postTypeId} disabled={busy || !entry.platformId} onChange={event => updateEntry(entry.key, { postTypeId: event.target.value })}><option value="">{W.choose}</option>{postTypes.map(format => <option key={format.id} value={format.id}>{format.name}</option>)}</select>
          {kind === 'campaign' && <input aria-label="الميزانية" type="number" min="0" step="0.01" max="100000000" required value={entry.budget} disabled={busy} onChange={event => updateEntry(entry.key, { budget: event.target.value })} placeholder="ر.س"/>}
          <button type="button" className="icon-button mkw-remove-requirement" aria-label={W.remove} disabled={busy || entries.length === 1} onClick={() => setEntries(current => current.filter(row => row.key !== entry.key))}><X size={18}/></button>
        </div>;
      })}</div></div>}
    <footer className="mkw-requirement-footer"><button className="secondary" type="button" disabled={busy} onClick={() => setEntries(current => [...current, newEntry()])}><Plus size={17}/>{W.addDate}</button></footer></section>
    {previewOpen && <section className="mkw-panel mkw-plan-preview" aria-label="معاينة جدول النشر"><header><h2>معاينة جدول {kind === 'campaign' ? 'التمويل' : 'النشر'} — {previewRows.length} يوم</h2></header>
      <div className="mkw-horizontal-scroll"><table className="mkw-plan-preview-table"><thead><tr><th>{dateLabel}</th><th>المنتج / المطلوب</th><th>الفكرة</th><th>المنصة</th><th>نوع النشر</th>{kind === 'campaign' && <th>الميزانية</th>}<th>النتيجة</th></tr></thead><tbody>
      {previewRows.map(({ index, entry, product, platform, postType, valid }) => <tr key={entry.key}><td>{entry.date || '—'}</td><td>{product ? `${product.task_no} — المطلوب ${product.sort_order}: ${product.idea_name}` : '—'}</td><td>{product?.idea || '—'}</td><td>{platform?.name || '—'}</td><td>{postType?.name || '—'}</td>{kind === 'campaign' && <td>{entry.budget !== '' ? `${entry.budget} ر.س` : '—'}</td>}<td className={valid ? 'mkw-preview-ok' : 'mkw-preview-missing'}>{valid ? 'مكتمل' : `الصف ${index}: بيانات ناقصة`}</td></tr>)}
      </tbody></table></div><p className="mkw-muted">المعاينة لا تنشئ حملة ولا أجندة ولا تنشر محتوى. راجع الصفوف ثم احفظ الجدول.</p>
    </section>}
    <footer className="mkw-form-footer"><button type="button" className="secondary" disabled={busy} onClick={() => navigate('/marketing')}>{W.cancel}</button><button type="button" className="secondary" disabled={busy} onClick={() => setPreviewOpen(current => !current)}>{previewOpen ? 'إغلاق المعاينة' : 'معاينة'}</button><button type="submit" className="primary" disabled={busy || !productsQuery.data?.rows.length}>{busy ? W.loading : kind === 'campaign' ? 'حفظ الجدول وإنشاء الحملة' : 'حفظ الجدول وإنشاء الأجندة'}</button></footer>
  </form>;
}
