import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarBlank, FilmStrip, ImageSquare, ListChecks, Megaphone, Plus, X } from '@phosphor-icons/react';
import { W, Empty, Field, FormatSelector, ProductViewButton, WorkAlert, WorkHeader } from './components';
import { showDate, uploadWorkFile, useWorkQuery, workPost, type WorkMeta } from './api';
import { ideaFileAllowed, isWorkDate, supportsWorkMedia, type WorkFormat, type WorkMediaKind, type WorkProduct } from '../../../shared/marketing-workflow';
import { splitRequiredMediaSelection } from './requiredMedia';
import { addPlanPlatform, availablePlanPostTypes, availablePlanProducts, planEntriesPayload, planEntryValid, validatePlanComposer, type PlanEntryDraft, type PlanPlatformDraft } from './planComposer';

type IdeaAttachment = { key: string; file: File; fileId?: string };
type RequiredDraft = { key: string; mediaKinds: WorkMediaKind[]; ideaName: string; idea: string; formatIds: string[]; dueOn: string; attachments: IdeaAttachment[] };
type ExecutorDraft = { key: string; departmentId: string; assigneeId: string; items: RequiredDraft[] };
type Reservation = { id: string; task_no: string; created_at: string };
const newRequired = (): RequiredDraft => ({ key: crypto.randomUUID(), mediaKinds: ['image'], ideaName: '', idea: '', formatIds: [], dueOn: '', attachments: [] });
const newExecutor = (): ExecutorDraft => ({ key: crypto.randomUUID(), departmentId: '', assigneeId: '', items: [newRequired()] });

const newEntry = (productId = ''): PlanEntryDraft => ({ key: crypto.randomUUID(), date: '', productId, platforms: [] });

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
  const [executors, setExecutors] = useState<ExecutorDraft[]>([newExecutor()]);
  const [targetExecutorKey, setTargetExecutorKey] = useState('');
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
  const assignees = useMemo(() => meta.departments.flatMap(department =>
    department.users.map(user => ({ departmentId: department.id, departmentName: department.name, user })))
    .sort((a, b) => String(a.user.fullName || a.user.full_name || '').localeCompare(String(b.user.fullName || b.user.full_name || ''), 'ar')), [meta.departments]);
  // One visible request may produce two independent image/video approvals.
  const requiredCount = executors.reduce((sum, executor) => sum + executor.items.reduce((total, item) => total + item.mediaKinds.length, 0), 0);
  const selectedExecutor = executors.find(executor => executor.key === targetExecutorKey) || executors[executors.length - 1];
  function addExecutor() {
    const executor = newExecutor();
    setExecutors(current => [...current, executor]);
    setTargetExecutorKey(executor.key);
  }
  function addRequired() {
    if (!selectedExecutor || requiredCount >= 100) return;
    setExecutors(current => current.map(executor => executor.key === selectedExecutor.key ? { ...executor, items: [...executor.items, newRequired()] } : executor));
  }
  function toggleMedia(executor: ExecutorDraft, item: RequiredDraft, kind: WorkMediaKind) {
    const mediaKinds = item.mediaKinds.includes(kind) ? item.mediaKinds.filter(media => media !== kind) : [...item.mediaKinds, kind];
    if (!mediaKinds.length || requiredCount + mediaKinds.length - item.mediaKinds.length > 100) return;
    changeItem(executor.key, item.key, { mediaKinds, formatIds: item.formatIds.filter(id => mediaKinds.some(media => supportsWorkMedia(media, formats.find(format => format.id === id)?.name || ''))) });
  }

  function updateExecutor(key: string, patch: Partial<ExecutorDraft>) {
    setExecutors(current => current.map(executor => executor.key === key ? { ...executor, ...patch } : executor));
  }
  function changeItem(executorKey: string, itemKey: string, patch: Partial<RequiredDraft>) {
    setExecutors(current => current.map(executor => executor.key === executorKey ? {
      ...executor, items: executor.items.map(item => item.key === itemKey ? { ...item, ...patch } : item),
    } : executor));
  }
  function attachFiles(executor: ExecutorDraft, item: RequiredDraft, files: FileList | null) {
    if (!files) return;
    const next = Array.from(files);
    if (next.some(file => !ideaFileAllowed(file.name) || file.size <= 0 || file.size > 50 * 1024 ** 2)) { setError(W.fileInvalid); return; }
    changeItem(executor.key, item.key, { attachments: [...item.attachments, ...next.map(file => ({ key: crypto.randomUUID(), file }))] });
  }
  async function removeAttachment(executor: ExecutorDraft, item: RequiredDraft, key: string) {
    const file = item.attachments.find(entry => entry.key === key);
    if (file?.fileId) await workPost('remove_upload', { fileId: file.fileId }).catch(() => undefined);
    changeItem(executor.key, item.key, { attachments: item.attachments.filter(entry => entry.key !== key) });
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return; setError('');
    if (executors.some(executor => executor.items.some(item => item.mediaKinds.length > 0 &&
        splitRequiredMediaSelection(item.mediaKinds, item.formatIds, formats).length !== item.mediaKinds.length))) {
      setError('اختر مقاسًا مناسبًا لكل نوع مطلوب: صورة وفيديو عند اختيار الاثنين معًا.'); return;
    }
    if (!reservation || !name.trim() || !typeId || !requiredCount || requiredCount > 100 ||
        executors.some(executor => !executor.departmentId || !executor.assigneeId || !executor.items.length ||
          executor.items.some(item => !item.ideaName.trim() || !isWorkDate(item.dueOn) ||
            splitRequiredMediaSelection(item.mediaKinds, item.formatIds, formats).length !== item.mediaKinds.length ||
            (!item.idea.trim() && !item.attachments.length)))) {
      setError(W.requiredFields); return;
    }
    setBusy(true); uploadController.current = new AbortController();
    try {
      const created = [];
      // Each required deliverable is a separate work item owned by exactly one
      // executor. Existing dashboard/calendar permissions and file approvals are retained.
      for (const executor of executors) for (const item of executor.items) {
        const fileIds: string[] = [];
        for (const attachment of item.attachments) {
          let fileId = attachment.fileId;
          if (!fileId) {
            fileId = await uploadWorkFile(attachment.file, { reservationId: reservation.id, category: 'idea' }, percent => setProgress({ name: attachment.file.name, percent }), uploadController.current.signal);
            attachment.fileId = fileId;
            setExecutors(current => current.map(row => ({ ...row, items: row.items.map(required => ({
              ...required, attachments: required.attachments.map(file => file.key === attachment.key ? { ...file, fileId } : file),
            })) })));
          }
          fileIds.push(fileId);
        }
        // Keep the existing single-medium schema and approval flow: a combined
        // selection creates two real deliverables with distinct identities.
        for (const [index, medium] of splitRequiredMediaSelection(item.mediaKinds, item.formatIds, formats).entries()) {
          created.push({ clientKey: index ? crypto.randomUUID() : item.key, departmentId: executor.departmentId, assigneeId: executor.assigneeId, mediaKind: medium.mediaKind,
            ideaName: item.ideaName.trim(), idea: item.idea, formatIds: medium.formatIds, dueOn: item.dueOn, ideaFileIds: fileIds });
        }
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
    <section className="mkw-panel mkw-requirements-panel"><header className="mkw-section-title"><div><h2>{W.assignments}</h2><small className="mkw-muted">{executors.length} منفذ · {requiredCount} مطلوب — لكل منفذ مطلوباته الخاصة</small></div>
      <div className="mkw-assignment-actions"><button type="button" className="secondary" disabled={busy || requiredCount >= 100} onClick={addRequired} title="إضافة المطلوب إلى المنفذ المحدد"><Plus size={17}/>{W.addItem}</button>
      <button type="button" className="secondary" disabled={busy || requiredCount >= 100} onClick={addExecutor}><Plus size={17}/> إضافة منفذ جديد</button></div>
    </header>
      <div className="mkw-executors-list">{executors.map((executor, executorIndex) => <section className={`mkw-executor-group ${selectedExecutor?.key === executor.key ? 'is-target' : ''}`} key={executor.key}>
        <header className="mkw-executor-header"><div className="mkw-executor-identity"><div className="mkw-executor-picker"><select aria-label={`اختيار المنفذ ${executorIndex + 1}`} required value={executor.departmentId && executor.assigneeId ? `${executor.departmentId}|${executor.assigneeId}` : ''} disabled={busy} onFocus={() => setTargetExecutorKey(executor.key)} onChange={event => { setTargetExecutorKey(executor.key); const [departmentId, assigneeId] = event.target.value.split('|'); updateExecutor(executor.key, { departmentId: departmentId || '', assigneeId: assigneeId || '' }); }}>
            <option value="">اختر المنفذ</option>{assignees.map(({ departmentId, departmentName, user }) => <option key={`${departmentId}:${user.id}`} value={`${departmentId}|${user.id}`}>{user.fullName || user.full_name} — {departmentName}</option>)}
          </select></div><div className="mkw-executor-number"><strong>المنفذ {executorIndex + 1}</strong><small>{executor.items.length} مطلوب في الشاشة</small></div></div>
          {executors.length > 1 && <button type="button" className={`secondary mkw-executor-target ${selectedExecutor?.key === executor.key ? 'active' : ''}`} disabled={busy} onClick={() => setTargetExecutorKey(executor.key)}>{selectedExecutor?.key === executor.key ? 'المنفذ المحدد لإضافة مطلوب' : 'اختيار لإضافة مطلوب'}</button>}
          <button type="button" className="icon-button" title="إزالة المنفذ" aria-label={`إزالة المنفذ ${executorIndex + 1}`} disabled={busy || executors.length === 1} onClick={() => setExecutors(current => current.filter(row => row.key !== executor.key))}><X size={18}/></button>
        </header>
        <div className="mkw-horizontal-scroll"><div className="mkw-horizontal-table mkw-executor-requirements"><div className="mkw-horizontal-heading"><span>{W.required}</span><span>{W.sizes}</span><span>{W.idea}</span><span>{W.dueOn}</span><span>{W.remove}</span></div>
          {executor.items.map(item => <div className="mkw-horizontal-row" key={item.key}>
            <div className="mkw-requirement-type"><input aria-label={W.required} required maxLength={250} value={item.ideaName} disabled={busy} placeholder={W.required} onChange={event => changeItem(executor.key, item.key, { ideaName: event.target.value })}/><div className="mkw-kind-toggle" role="group" aria-label="نوع المطلوب: اختر صورة أو فيديو أو الاثنين معًا">{(['image', 'video'] as const).map(kind => <button type="button" key={kind} aria-pressed={item.mediaKinds.includes(kind)} className={item.mediaKinds.includes(kind) ? 'active' : ''} disabled={busy || (!item.mediaKinds.includes(kind) && requiredCount >= 100)} onClick={() => toggleMedia(executor, item, kind)}>{kind === 'image' ? <ImageSquare size={16}/> : <FilmStrip size={16}/>} {kind === 'image' ? W.image : W.video}</button>)}</div>{item.mediaKinds.length === 2 && <small className="mkw-media-pair-note">صورة + فيديو: مطلوبان مستقلان في التنفيذ والاعتماد</small>}</div>
            <div className="mkw-requirement-formats"><FormatSelector formats={formats.filter(format => item.mediaKinds.some(kind => supportsWorkMedia(kind, format.name)))} selected={item.formatIds} disabled={busy} onChange={formatIds => changeItem(executor.key, item.key, { formatIds })} /></div>
            <div className="mkw-requirement-idea"><textarea aria-label={W.idea} value={item.idea} maxLength={20000} disabled={busy} placeholder={W.idea} onChange={event => changeItem(executor.key, item.key, { idea: event.target.value })}/><label className="mkw-inline-file">{W.ideaFile}<input type="file" accept=".doc,.docx,.xls,.xlsx" multiple disabled={busy} onChange={event => { attachFiles(executor, item, event.target.files); event.target.value = ''; }}/></label>{item.attachments.map(file => <span className="mkw-requirement-file" key={file.key}>{file.file.name}<button type="button" className="icon-button" aria-label={W.remove} disabled={busy} onClick={() => void removeAttachment(executor, item, file.key)}><X size={13}/></button></span>)}</div>
            <div><input type="date" aria-label={W.dueOn} required value={item.dueOn} disabled={busy} onChange={event => changeItem(executor.key, item.key, { dueOn: event.target.value })}/></div>
            <div><button type="button" className="icon-button mkw-remove-requirement" aria-label={W.remove} disabled={busy || executor.items.length === 1} onClick={() => updateExecutor(executor.key, { items: executor.items.filter(row => row.key !== item.key) })}><X size={18}/></button></div>
          </div>)}</div></div>
      </section>)}</div>
    </section>
    {progress && <div className="mkw-panel"><span>{progress.name} {progress.percent}%</span><progress value={progress.percent} max={100}/><button type="button" className="secondary" onClick={() => uploadController.current?.abort()}>{W.cancel}</button></div>}
    <footer className="mkw-form-footer"><button type="button" className="secondary" disabled={busy} onClick={() => navigate('/marketing')}>{W.cancel}</button><button type="submit" className="primary" disabled={busy || !reservation}>{busy ? W.loading : W.createTask}</button></footer>
  </form>;
}

function PlanComposer({ kind, initialProduct, meta }: { kind: 'agenda' | 'campaign'; initialProduct: string; meta: WorkMeta }) {
  const navigate = useNavigate(), requestKey = useRef(crypto.randomUUID());
  const productsQuery = useWorkQuery<{ rows: WorkProduct[] }>('products');
  const [name, setName] = useState('');
  const [entries, setEntries] = useState<PlanEntryDraft[]>([newEntry(initialProduct)]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const dateLabel = kind === 'agenda' ? W.publishDate : W.fundingDate;
  const label = kind === 'agenda' ? W.agenda : W.campaign;
  const products = productsQuery.data?.rows || [];
  // Publishing formats come from marketing platform settings, and the selected
  // product's approved image/video type determines which choices are valid.
  const activePlatforms = useMemo(() => meta.platforms.filter(platform =>
    meta.postTypes.some(type => type.platform_id === platform.id)), [meta.platforms, meta.postTypes]);
  const productGroups = useMemo(() => {
    const groups = new Map<string, { title: string; rows: WorkProduct[] }>();
    for (const product of products) {
      const key = product.task_id || product.task_no;
      if (!groups.has(key)) groups.set(key, { title: `${product.task_no} — ${product.task_name}`, rows: [] });
      groups.get(key)!.rows.push(product);
    }
    return Array.from(groups.values());
  }, [products]);
  const selectedProductIds = useMemo(() => new Set(entries.map(entry => entry.productId).filter(Boolean)), [entries]);
  const platformLineCount = entries.reduce((total, entry) => total + entry.platforms.reduce((count, platform) => count + (platform.postTypeIds?.length || (platform.postTypeId ? 1 : 0)), 0), 0);
  const noMoreProducts = Boolean(productsQuery.data?.rows?.length) && products.every(product => selectedProductIds.has(product.id));
  const previewRows = entries.flatMap((entry, entryIndex) => {
    const product = products.find(item => item.id === entry.productId);
    const rowValid = planEntryValid(entry, products, meta.postTypes, kind) &&
      entries.filter(other => other.productId && other.productId === entry.productId).length === 1;
    return (entry.platforms.length ? entry.platforms : [null]).flatMap(platform =>
      (platform ? (platform.postTypeIds?.length ? platform.postTypeIds : [platform.postTypeId]) : ['']).map((postTypeId, typeIndex) => ({
        key: `${entry.key}:${platform?.platformId || 'empty'}:${postTypeId}`, index: entryIndex + 1, entry, product,
        platform: meta.platforms.find(item => item.id === platform?.platformId),
        postType: meta.postTypes.find(item => item.id === postTypeId),
        budget: typeIndex === 0 ? platform?.budget || '' : '0', valid: rowValid,
      })));
  });

  function updateEntry(key: string, patch: Partial<PlanEntryDraft>) {
    setEntries(current => current.map(row => row.key === key ? { ...row, ...patch } : row));
  }
  function changePlatform(key: string, platformId: string, patch: Partial<PlanPlatformDraft>) {
    setEntries(current => current.map(entry => entry.key === key ? {
      ...entry, platforms: entry.platforms.map(platform => platform.platformId === platformId ? { ...platform, ...patch } : platform),
    } : entry));
  }
  function togglePlatform(key: string, platformId: string) {
    setEntries(current => current.map(entry => {
      if (entry.key !== key) return entry;
      const product = products.find(item => item.id === entry.productId);
      if (!product) return entry;
      if (entry.platforms.some(platform => platform.platformId === platformId)) {
        return { ...entry, platforms: entry.platforms.filter(platform => platform.platformId !== platformId) };
      }
      if (!availablePlanPostTypes(meta.postTypes, product.media_kind, platformId).length) return entry;
      return { ...entry, platforms: [...entry.platforms, addPlanPlatform(platformId, meta.postTypes, product.media_kind)] };
    }));
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return; setError('');
    const validationError = validatePlanComposer(entries, products, meta.postTypes, kind);
    if (validationError) { setError(validationError); return; }
    setBusy(true);
    try {
      // One product is chosen once; each platform creates its own publish line.
      // Budget belongs to the platform line and is never duplicated implicitly.
      await workPost('create_plan', {
        requestKey: requestKey.current, kind, name: name.trim(),
        entries: planEntriesPayload(entries, kind),
      });
      navigate('/marketing');
    } catch (e) { setError(e instanceof Error ? e.message : W.invalid); }
    finally { setBusy(false); }
  }
  return <form className="mkw mkw-plan-composer" onSubmit={save}>
    <section className="mkw-panel"><header><h2>بيانات {label}</h2></header>
      <div className="mkw-fields"><Field label={`اسم ${label}`}><input maxLength={250} value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder={`اسم ${label}`}/></Field></div>
    </section>
    <section className="mkw-panel"><header className="mkw-section-title"><h2>{kind === 'campaign' ? W.createCampaign : W.createAgenda}</h2><span>{entries.length} {W.addDate}</span></header>
      <WorkAlert>{error || productsQuery.error}</WorkAlert>
      {kind === 'campaign' && <p className="mkw-plan-budget-hint">الميزانية مستقلة لكل منصة. يتم جمع ميزانيات المنصات في إجمالي اليوم، بدون تكرار المبلغ عند تحديد أكثر من منصة.</p>}
      {productsQuery.loading && !productsQuery.data ? <Empty>{W.loading}</Empty> :
        <div className="mkw-horizontal-scroll"><div className={`mkw-plan-table ${kind === 'agenda' ? 'agenda' : ''}`}>
          <div className="mkw-plan-heading"><span>{dateLabel}</span><span>{W.selectProduct}</span><span>المنصات (اختيار متعدد)</span><span>نوع النشر لكل منصة</span>{kind === 'campaign' && <span>ميزانية كل منصة</span>}<span>{W.remove}</span></div>
          {entries.map((entry, entryIndex) => {
            const product = products.find(item => item.id === entry.productId);
            const availableIds = new Set(availablePlanProducts(products, entries, entry.key).map(item => item.id));
            const selectableGroups = productGroups.map(group => ({ ...group, rows: group.rows.filter(item => availableIds.has(item.id)) })).filter(group => group.rows.length);
            const platforms = product ? activePlatforms.filter(platform => availablePlanPostTypes(meta.postTypes, product.media_kind, platform.id).length) : [];
            const selected = new Map(entry.platforms.map(platform => [platform.platformId, platform]));
            return <div className="mkw-plan-table-row" key={entry.key}>
              <input aria-label={dateLabel} type="date" required value={entry.date} disabled={busy} onChange={event => updateEntry(entry.key, { date: event.target.value })}/>
              <div className="mkw-plan-product-picker">
                <select aria-label={W.selectProduct} required value={entry.productId} disabled={busy} onChange={event => updateEntry(entry.key, { productId: event.target.value, platforms: [] })}>
                  <option value="">اختر المطلوب / المنتج من التاسك</option>
                  {selectableGroups.map(group => <optgroup key={group.title} label={group.title}>{group.rows.map(candidate => <option key={candidate.id} value={candidate.id}>المطلوب {candidate.sort_order} — {candidate.idea_name} — {candidate.media_kind === 'video' ? 'فيديو' : 'صورة'} — {candidate.assignee_name || '—'} — {candidate.idea.slice(0, 65)}</option>)}</optgroup>)}
                </select>
                {!entry.productId && !selectableGroups.length && <small className="mkw-muted">كل المنتجات المتاحة مختارة بالفعل في أيام أخرى.</small>}
                {product && <div className="mkw-plan-product-preview" role="status">
                  <strong>{product.idea_name}</strong>
                  <span><b>التاسك:</b> {product.task_no} — {product.task_name}</span>
                  <span><b>الفكرة:</b> {product.idea || '—'}</span>
                  <span><b>النوع:</b> {product.media_kind === 'video' ? 'فيديو' : 'صورة'} · <b>المنفذ:</b> {product.assignee_name || '—'} · <b>المقاسات:</b> {product.formats.length}</span>
                  <div className="mkw-plan-product-view"><ProductViewButton id={product.id}/></div>
                </div>}
              </div>
              <div className="mkw-plan-platform-options" role="group" aria-label={`منصات اليوم ${entryIndex + 1}`}>
                {!product ? <small className="mkw-muted">اختر المنتج أولًا</small> : !platforms.length ? <small className="mkw-muted">لا توجد منصة متوافقة مع نوع المطلوب في الإعدادات.</small> : platforms.map(platform =>
                  <label key={platform.id} className={selected.has(platform.id) ? 'is-checked' : ''}>
                    <input type="checkbox" checked={selected.has(platform.id)} disabled={busy} onChange={() => togglePlatform(entry.key, platform.id)}/>
                    <span>{platform.name}</span>
                  </label>)}
              </div>
              <div className="mkw-plan-per-platform">
                {!entry.platforms.length ? <small className="mkw-muted">حدد منصة أو أكثر</small> : entry.platforms.map(platform => {
                  const formats = availablePlanPostTypes(meta.postTypes, product?.media_kind, platform.platformId);
                  return <label className="mkw-plan-platform-field" key={platform.platformId}>
                    <small>{meta.platforms.find(item => item.id === platform.platformId)?.name || 'المنصة'}</small>
                    <div className="mkw-post-type-multi" role="group" aria-label={`أنواع النشر — ${meta.platforms.find(item => item.id === platform.platformId)?.name || 'المنصة'}`}>
                      {formats.map(format => {
                        const selected = platform.postTypeIds || (platform.postTypeId ? [platform.postTypeId] : []);
                        return <label key={format.id} className={selected.includes(format.id) ? 'is-checked' : ''}>
                          <input type="checkbox" disabled={busy} checked={selected.includes(format.id)} onChange={() => {
                            const ids = selected.includes(format.id) ? selected.filter(value => value !== format.id) : [...selected, format.id];
                            changePlatform(entry.key, platform.platformId, { postTypeIds: ids, postTypeId: ids[0] || '' });
                          }}/><span>{format.name}</span>
                        </label>;
                      })}
                    </div>
                  </label>;
                })}
              </div>
              {kind === 'campaign' && <div className="mkw-plan-per-platform mkw-plan-platform-budgets">
                {!entry.platforms.length ? <small className="mkw-muted">حدد منصة أو أكثر</small> : entry.platforms.map(platform =>
                  <label className="mkw-plan-platform-field" key={platform.platformId}>
                    <small>{meta.platforms.find(item => item.id === platform.platformId)?.name || 'المنصة'}</small>
                    <input aria-label={`ميزانية ${meta.platforms.find(item => item.id === platform.platformId)?.name || 'المنصة'}`} type="number" min="0" step="0.01" max="100000000" required value={platform.budget} disabled={busy} onChange={event => changePlatform(entry.key, platform.platformId, { budget: event.target.value })} placeholder="ر.س"/>
                  </label>)}
                {!!entry.platforms.length && <strong className="mkw-plan-day-total">الإجمالي: {entry.platforms.reduce((total, platform) => total + (Number(platform.budget) || 0), 0).toLocaleString('ar-SA-u-nu-latn', { maximumFractionDigits: 2 })} ر.س</strong>}
              </div>}
              <button type="button" className="icon-button mkw-remove-requirement" aria-label={W.remove} disabled={busy || entries.length === 1} onClick={() => setEntries(current => current.filter(row => row.key !== entry.key))}><X size={18}/></button>
            </div>;
          })}
        </div></div>}
      <footer className="mkw-requirement-footer"><button className="secondary" type="button" disabled={busy || noMoreProducts || entries.length >= 500} onClick={() => setEntries(current => [...current, newEntry()])}><Plus size={17}/>{W.addDate}</button></footer>
    </section>
    {previewOpen && <section className="mkw-panel mkw-plan-preview" aria-label="معاينة جدول النشر"><header><h2>معاينة جدول {kind === 'campaign' ? 'التمويل' : 'النشر'} — {entries.length} يوم · {platformLineCount} موعد منصة</h2></header>
      <div className="mkw-horizontal-scroll"><table className="mkw-plan-preview-table"><thead><tr><th>{dateLabel}</th><th>المنتج / المطلوب</th><th>الفكرة</th><th>المنصة</th><th>نوع النشر</th>{kind === 'campaign' && <th>الميزانية</th>}<th>النتيجة</th></tr></thead><tbody>
        {previewRows.map(({ key, index, entry, product, platform, postType, budget, valid }) => <tr key={key}>
          <td>{entry.date || '—'}</td><td>{product ? `${product.task_no} — المطلوب ${product.sort_order}: ${product.idea_name}` : '—'}</td><td>{product?.idea || '—'}</td>
          <td>{platform?.name || '—'}</td><td>{postType?.name || '—'}</td>{kind === 'campaign' && <td>{budget !== '' ? `${budget} ر.س` : '—'}</td>}
          <td className={valid ? 'mkw-preview-ok' : 'mkw-preview-missing'}>{valid ? 'مكتمل' : `اليوم ${index}: بيانات ناقصة`}</td>
        </tr>)}
      </tbody></table></div><p className="mkw-muted">كل نوع نشر مختار له موعد مستقل. عند اختيار أكثر من نوع للمنصة نفسها تُسجل الميزانية مرة واحدة فقط، ولا تُكرر على الأنواع الإضافية. المعاينة لا تنشئ حملة ولا أجندة ولا تنشر محتوى.</p>
    </section>}
    <footer className="mkw-form-footer"><button type="button" className="secondary" disabled={busy} onClick={() => navigate('/marketing')}>{W.cancel}</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => setPreviewOpen(current => !current)}>{previewOpen ? 'إغلاق المعاينة' : 'معاينة'}</button>
      <button type="submit" className="primary" disabled={busy || !productsQuery.data?.rows.length}>{busy ? W.loading : kind === 'campaign' ? 'حفظ الجدول وإنشاء الحملة' : 'حفظ الجدول وإنشاء الأجندة'}</button>
    </footer>
  </form>;
}
