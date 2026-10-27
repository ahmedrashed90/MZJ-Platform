import { useEffect, useRef, useState } from 'react';
import { CaretDown, CheckCircle, Clock, FileArrowDown, PaperPlaneTilt, UploadSimple, UserCircle, X, Star, PencilSimple, Trash, Plus } from '@phosphor-icons/react';
import { Modal } from '../../components/Modal';
import { useAuth } from '../../auth/AuthContext';
import { hasPermission } from '../../systemAccess';
import { finalCoverage, ideaFileAllowed, workFileMatches, workItemReadiness, workReviewableFormats, type WorkCapabilities, type WorkItem, type WorkTask, type WorkEvaluationSettings, workRatingLevel, isBinaryProductDecisionCriterion, supportsWorkMedia, type WorkFormat, type WorkItemRating } from '../../../shared/marketing-workflow';
import { W, Empty, Field, FileLink, FilesPreview, Formats, FormatSelector, MediaLabel, Readiness, Status, WorkAlert } from './components';
import { showDate, showRange, uploadWorkFile, useWorkQuery, workPost } from './api';
import { parseReviewNote } from '../../../shared/marketing-review-note-format';

function submittedDayInRiyadh(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh' }) : '—';
}

type RejectedRatingItem = {
  id: string; assignee_name: string; idea_name: string; media_kind: 'image' | 'video';
  status: 'rejected'; rejected_at: string; rejection_note: string; rating: WorkItemRating | null;
};

type Detail = {
  task: WorkTask & { items: WorkItem[] };
  rejectedItems: RejectedRatingItem[];
  events: { id: string; action: string; note: string; actor_name: string; created_at: string; item_id: string | null }[];
  formatOptions: WorkFormat[];
  capabilities: WorkCapabilities;
  canRate: boolean;
};

function canEvaluateItem(item: WorkItem | RejectedRatingItem): boolean {
  if (item.status === 'rejected') return true;
  // Rating follows a reviewer approval of the uploaded files, even when other
  // formats or requirements in the task are still awaiting completion.
  return item.status === 'approved' || (item.format_reviews || []).some(row => row.status === 'approved');
}

export function TaskDetail({ id, onClose, onChanged, onlyItems, deliveryFilter = '' }: { id: string; onClose: () => void; onChanged?: () => void; onlyItems?: string[]; deliveryFilter?: '' | 'on_time' | 'late' }) {
  const query = useWorkQuery<Detail>('task', { id });
  const settings = useWorkQuery<WorkEvaluationSettings>('evaluation_settings');
  const [ratingItemId, setRatingItemId] = useState('');
  const [ratingScores, setRatingScores] = useState<Record<string, number | ''>>({});
  const [ratingBusy, setRatingBusy] = useState(false);
  const [ratingError, setRatingError] = useState('');
  const [openedRequirementId, setOpenedRequirementId] = useState('');
  const task = query.data?.task;
  const items = task?.items.filter(item => (!onlyItems || onlyItems.includes(item.id)) && (!deliveryFilter || item.delivery_status === deliveryFilter)) || [];
  const rejectedItems = !deliveryFilter ? (query.data?.rejectedItems || []).filter(item => !onlyItems || onlyItems.includes(item.id)) : [];
  async function refresh() { await query.reload(); onChanged?.(); }
  const selectedRatingItem = task?.items.find(item => item.id === ratingItemId)
    || query.data?.rejectedItems?.find(item => item.id === ratingItemId);
  const canRate = Boolean(query.data?.canRate);
  const ratingRows = canRate ? (settings.data?.criteria || []).map(c => ({ id: c.id, name: c.name, binary: isBinaryProductDecisionCriterion(c.name) }))
    : (selectedRatingItem?.rating?.scores || []).map(c => ({ id: c.criterionId, name: c.criterionName, binary: isBinaryProductDecisionCriterion(c.criterionName) }));
  const ratingAllowed = Boolean(canRate && selectedRatingItem && canEvaluateItem(selectedRatingItem));
  const scored = ratingRows.length > 0 && ratingRows.every(c => Number.isInteger(ratingScores[c.id]) && ratingScores[c.id] !== ''
    && Number(ratingScores[c.id]) >= 0 && Number(ratingScores[c.id]) <= 3 && (!c.binary || [0,3].includes(Number(ratingScores[c.id]))));
  function openItemRating(item: WorkItem | RejectedRatingItem) {
    const rows = canRate ? (settings.data?.criteria || []).map(c => ({ id: c.id })) : (item.rating?.scores || []).map(c => ({ id: c.criterionId }));
    setRatingScores(Object.fromEntries(rows.map(c => [c.id,
      item.rating?.scores.find(s => s.criterionId === c.id)?.score ?? ''])));
    setRatingError(''); setRatingItemId(item.id);
  }
  async function saveItemRating() {
    if (!selectedRatingItem || !ratingAllowed || !scored) { setRatingError('أكمل التقييم بعد اعتماد الملفات المرفوعة أو رفض المطلوب، وبدرجة 0 أو 3 لبند القبول والرفض'); return; }
    setRatingBusy(true); setRatingError('');
    try {
      await workPost(selectedRatingItem.status === 'rejected' ? 'save_rejected_rating' : 'save_rating', { itemId: selectedRatingItem.id,
        scores: ratingRows.map(row => ({ criterionId: row.id, score: ratingScores[row.id] })) });
      await refresh(); setRatingItemId('');
    } catch (e) { setRatingError(e instanceof Error ? e.message : W.invalid); }
    finally { setRatingBusy(false); }
  }
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
            {items.map((item, index) => {
              const opened = openedRequirementId === item.id;
              const reviews = item.format_reviews || [];
              const pending = reviews.filter(r => r.status === 'submitted').length;
              const approved = reviews.filter(r => r.status === 'approved').length;
              const gradeReady = canEvaluateItem(item);
              return <section key={item.id} className={`mkw-requirement-review-entry ${opened ? 'is-open' : ''}`}>
                <button type="button" className="mkw-requirement-review-toggle" aria-expanded={opened} onClick={() => setOpenedRequirementId(opened ? '' : item.id)}>
                  <span className="mkw-item-number">{index + 1}</span>
                  <span className="mkw-requirement-review-identify"><strong>{W.required} {index + 1}: {item.idea_name} <span className="mkw-requirement-review-idea">({item.idea?.trim() || 'لم تُحدد الفكرة'})</span></strong><small>{W.assignee}: {item.assignee_name} · {item.media_kind === 'video' ? W.video : W.image}</small></span>
                  <Status value={item.status}/>
                  {approved > 0 && <span className="mkw-requirement-reviewed"><CheckCircle size={18} weight="fill"/>{approved} / {item.formats.length} مقاس معتمد</span>}
                  {pending > 0 && <span className="mkw-requirement-waiting">{pending} قيد المراجعة</span>}
                  {item.status === 'submitted' && item.latest_review_event?.action === 'revision_declined' && <span className="mkw-requirement-waiting">المنفذ رفض التعديل · بانتظار قرار المراجع</span>}
                  <span className="mkw-requirement-review-label">{opened ? 'إغلاق' : 'فتح المطلوب'}<CaretDown size={16}/></span>
                </button>
                <div className="mkw-requirement-rating-strip">
                  {item.rating ? <div className="mkw-requirement-rating-result"><strong>تقييم المنفذ</strong>
                    <strong dir="ltr">{Number(item.rating.percentage).toLocaleString('ar-SA-u-nu-latn',{maximumFractionDigits:2})}%</strong>
                    <span className={`mkw-rating-level is-${workRatingLevel(Number(item.rating.percentage)).css}`}>{workRatingLevel(Number(item.rating.percentage)).label}</span>
                    <RatingStars percentage={Number(item.rating.percentage)}/></div>
                    : <span className="mkw-rating-unrated">لم يتم التقييم</span>}
                  {gradeReady && (canRate || item.rating) && <button type="button" className="secondary" onClick={() => openItemRating(item)}>
                    {canRate ? (item.rating ? 'تعديل التقييم' : 'تقييم المنفذ') : 'عرض التقييم'}
                  </button>}
                  {!gradeReady && canRate && <span className="mkw-rating-gate">التقييم متاح بعد اعتماد الملفات المرفوعة أو رفض المطلوب</span>}
                </div>
                <div className="mkw-requirement-item-readiness"><Readiness value={workItemReadiness(item)} /></div>
                {opened && <ItemEditor key={`${item.id}:${item.version}`} item={item} number={index + 1} capabilities={query.data!.capabilities}
                  formatOptions={query.data!.formatOptions || []} canRate={query.data!.canRate} settings={settings.data} refresh={refresh} />}
              </section>;
            })}
          </div>}
          {!!rejectedItems.length && <div className="mkw-rejected-section">
            <h3>المطلوبات المرفوضة — محفوظة للتقييم فقط ولا تدخل في الجاهزية</h3>
            {rejectedItems.map(item => <section key={item.id} className="mkw-requirement-review-entry is-rejected">
              <div className="mkw-rejected-summary">
                <div><strong>{item.idea_name}</strong><small>المنفذ: {item.assignee_name} · مرفوض · {showDate(item.rejected_at,true)}</small>
                  {item.rejection_note && <small>{item.rejection_note}</small>}</div>
                <div className="mkw-actions">
                  {item.rating && <div className="mkw-requirement-rating-result"><strong>تقييم المنفذ</strong>
                    <strong dir="ltr">{Number(item.rating.percentage).toLocaleString('ar-SA-u-nu-latn',{maximumFractionDigits:2})}%</strong>
                    <span className={`mkw-rating-level is-${workRatingLevel(Number(item.rating.percentage)).css}`}>{workRatingLevel(Number(item.rating.percentage)).label}</span>
                    <RatingStars percentage={Number(item.rating.percentage)}/>
                  </div>}
                  {(canRate || item.rating) && <button type="button" className="secondary" onClick={() => openItemRating(item)}>
                    {canRate ? item.rating ? 'تعديل التقييم' : 'تقييم المنفذ' : 'عرض التقييم'}
                  </button>}
                </div>
              </div>
            </section>)}
          </div>}
        </section>
        <details className="mkw-history"><summary>{W.history}</summary>{query.data!.events.map(event => <article key={event.id}><div className="mkw-section-title"><strong>{event.actor_name}</strong><small>{showDate(event.created_at, true)}</small></div><Status value={event.action} />{event.note && <p>{event.note}</p>}</article>)}</details>
      </>}
      <Modal open={Boolean(ratingItemId && selectedRatingItem)} title={`تقييم المنفذ — ${selectedRatingItem?.assignee_name || ''}`}
        onClose={() => setRatingItemId('')} className="mkw-rating-modal">
        <div className="mkw mkw-rating-form">
          <WorkAlert>{ratingError}</WorkAlert>
          <div className="mkw-rating-criteria-grid">
            {ratingRows.map(row => <label key={row.id} className="mkw-rating-criterion">
              <span>{row.name}</span>
              {ratingAllowed ? (row.binary
                ? <select className="mkw-rating-binary" value={ratingScores[row.id] ?? ''} disabled={ratingBusy}
                    aria-label={`${row.name} — 0 أو 3 فقط`}
                    onChange={event => setRatingScores(current => ({...current,[row.id]:event.target.value === '' ? '' : Number(event.target.value)}))}>
                    <option value="">اختر 0 أو 3</option><option value="0">0 — رفض</option><option value="3">3 — قبول</option>
                  </select>
                : <input type="number" min="0" max="3" step="1" value={ratingScores[row.id] ?? ''}
                    disabled={ratingBusy} placeholder="0 - 3"
                    onChange={event => { const value = event.target.value;
                      if (value === '') setRatingScores(current => ({...current,[row.id]:''}));
                      else if (/^[0-3]$/.test(value)) setRatingScores(current => ({...current,[row.id]:Number(value)})); }} />)
                : <strong>{ratingScores[row.id] ?? '—'} / 3</strong>}
            </label>)}
          </div>
          {ratingAllowed && <div className="mkw-actions"><button type="button" className="primary" disabled={ratingBusy || !scored}
            onClick={() => void saveItemRating()}>حفظ التقييم</button></div>}
        </div>
      </Modal>
    </div>
  </Modal>;
}

export function RatingStars({ percentage }: { percentage: number }) {
  const level = workRatingLevel(percentage);
  return <span className={`mkw-rating-stars is-${level.css}`} aria-label={`${level.stars} نجوم`}>{Array.from({ length: 5 }, (_, n) =>
    <Star key={n} size={17} weight={n < level.stars ? 'fill' : 'regular'} />)}</span>;
}


function ReviewNoteDocument({ text }: { text: string }) {
  const blocks = parseReviewNote(text);
  return <div className="mkw-review-document" dir="rtl">
    {blocks.map((block, index) => {
      const content = block.text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, partIndex) =>
        part.startsWith('**') && part.endsWith('**')
          ? <strong key={partIndex}>{part.slice(2,-2)}</strong> : <span key={partIndex}>{part}</span>);
      if (block.kind === 'heading') return <h5 key={index}>{content}</h5>;
      if (block.kind === 'bullet' || block.kind === 'numbered') return <div key={index} className="mkw-review-document-point">
        <span aria-hidden="true">{block.kind === 'bullet' ? '•' : `${block.number}.`}</span><p>{content}</p>
      </div>;
      return <p key={index}>{content}</p>;
    })}
  </div>;
}

function ItemEditor({ item, number, capabilities, formatOptions, canRate, settings, refresh }: {
  item: WorkItem; number: number; capabilities: WorkCapabilities; formatOptions: WorkFormat[]; canRate: boolean;
  settings: WorkEvaluationSettings | null; refresh: () => Promise<void>;
}) {
  const { user } = useAuth();
  const own = user?.id === item.assigned_to;
  const editable = item.status !== 'approved' && (own || capabilities.editTask);
  const canUpload = item.status !== 'approved' && own && hasPermission(user, 'marketing.task.final_file.upload');
  const [idea, setIdea] = useState(item.idea), [ideaName, setIdeaName] = useState(item.idea_name), [dueOn, setDueOn] = useState(item.due_on);
  const [note, setNote] = useState(''), [noteType, setNoteType] = useState('');
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [revisionFormat, setRevisionFormat] = useState<string | null>(null);
  const [showFormatPicker, setShowFormatPicker] = useState(false);
  const [newFormatIds, setNewFormatIds] = useState<string[]>([]);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ name: string; percent: number } | null>(null);
  const controller = useRef<AbortController | null>(null), version = useRef(item.version);
  useEffect(() => () => controller.current?.abort(), []);
  const ideaFiles = item.files.filter(file => file.category === 'idea');
  const finals = item.files.filter(file => file.category === 'final');
  const states = new Map((item.format_reviews || []).map(r => [r.format_id, r.status]));
  const readyToSubmit = item.formats.some(format => !states.has(format.id) && finalCoverage({ formats: [format], files: item.files, media_kind: item.media_kind }));
  const reviewableFormats = workReviewableFormats(item, 'revise');
  const approvableFormats = workReviewableFormats(item, 'approve');
  const reviewableFormatIds = new Set(reviewableFormats.map(format => format.id));
  const approvableFormatIds = new Set(approvableFormats.map(format => format.id));
  const approvedFormatIds = new Set((item.format_reviews || []).filter(row => row.status === 'approved').map(row => row.format_id));
  const configuredIds = new Set(item.formats.map(format => format.id));
  const availableFormats = formatOptions.filter(format => !configuredIds.has(format.id) && supportsWorkMedia(item.media_kind, format.name));
  const categories = settings?.categories || [];
  const rating = item.rating;
  const revisionPending = (item.format_reviews || []).some(row => row.status === 'revision');
  const canDeclineRevision = own && canUpload && revisionPending;
  const awaitingDecision = item.status === 'submitted' && item.latest_review_event?.action === 'revision_declined';
  const [declineEditor, setDeclineEditor] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const noteEditorRef = useRef<HTMLTextAreaElement | null>(null);
  function formatNote(style: 'bold' | 'bullet' | 'numbered' | 'heading') {
    const editor = noteEditorRef.current;
    const from = editor?.selectionStart ?? note.length;
    const to = editor?.selectionEnd ?? note.length;
    const selected = note.slice(from, to);
    const replacement = style === 'bold' ? `**${selected || 'نص مهم'}**`
      : style === 'heading' ? `# ${selected || 'عنوان الملاحظة'}`
      : (selected || 'نقطة جديدة').split('\n').map((line, index) => `${style === 'bullet' ? '•' : `${index + 1}.`} ${line}`).join('\n');
    setNote(note.slice(0, from) + replacement + note.slice(to));
    window.requestAnimationFrame(() => { editor?.focus(); editor?.setSelectionRange(from, from + replacement.length); });
  }
  async function declineRevision() {
    const saved = await run(() => workPost('decline_revision', {
      itemId: item.id, version: version.current, reason: declineReason.trim(),
    }));
    if (saved) { setDeclineEditor(false); setDeclineReason(''); }
  }

  async function persist() {
    if (!editable) return version.current;
    if (idea === item.idea && ideaName === item.idea_name && dueOn === item.due_on) return version.current;
    const result = await workPost<{ version: number }>('save_item', { itemId: item.id, version: version.current, idea, ideaName,
      ...(capabilities.editTask ? { dueOn } : {}) });
    version.current = result.version; return result.version;
  }
  async function run(operation: () => Promise<unknown>): Promise<boolean> {
    if (busy) return false;
    setBusy(true); setError('');
    try { await operation(); await refresh(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : W.invalid); return false; }
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
  function beginRevision(formatId?: string) {
    setRevisionFormat(formatId || 'all');
    setEditingNoteId(null); setNoteType(''); setNote(''); setShowNoteEditor(false); setError('');
  }
  async function review(decision: 'approve' | 'revise' | 'reject', formatId?: string) {
    if (decision === 'revise' && (!note.trim() || !noteType)) { setError('اختر نوع الملاحظة واكتب التفاصيل'); return; }
    if (decision === 'reject' && !window.confirm(W.rejectedConfirm)) return;
    const saved = await run(() => workPost('review', { itemId: item.id, version: version.current, decision,
      ...(formatId ? { formatId } : {}), note: decision === 'revise' ? note : '', categoryId: decision === 'revise' ? noteType : undefined }));
    if (saved) { setRevisionFormat(null); setShowNoteEditor(false); setNote(''); setNoteType(''); }
  }
  async function undoApproval(formatId?: string) {
    const message = formatId
      ? 'تراجع عن اعتماد هذا المقاس؟ ستبقى الملفات مرفوعة ويعود المقاس للمراجعة.'
      : 'تراجع عن اعتماد المنتج 100% للملفات المرفوعة؟ ستبقى الملفات مرفوعة وتعود المقاسات المعتمدة للمراجعة.';
    if (!window.confirm(message)) return;
    await run(() => workPost('unapprove', { itemId: item.id, version: version.current,
      ...(formatId ? { formatId } : {}) }));
  }
  async function addFormats() {
    if (!newFormatIds.length) { setError(W.selectFormats); return; }
    const saved = await run(() => workPost('add_item_formats', { itemId: item.id, version: version.current, formatIds: newFormatIds }));
    if (saved) { setNewFormatIds([]); setShowFormatPicker(false); }
  }
  async function manageNote(remove = false, noteId: string | null = editingNoteId) {
    if (remove && !noteId) return;
    if (remove && !window.confirm('حذف الملاحظة؟')) return;
    if (!remove && (!noteType || !note.trim())) { setError('اختر نوع الملاحظة واكتب التفاصيل'); return; }
    const saved = await run(() => workPost('manage_note', { itemId: item.id,
      ...(noteId ? { noteId } : {}), remove,
      categoryId: remove ? null : noteType, note: remove ? '' : note.trim() }));
    if (saved) { setNote(''); setNoteType(''); setEditingNoteId(null); setShowNoteEditor(false); }
  }
  function editNote(id: string, categoryId: string | null, text: string) {
    setEditingNoteId(id); setNoteType(categoryId || ''); setNote(text); setShowNoteEditor(true);
  }
  const activeNotes = (item.review_notes || []).filter(row => !row.responded_at);
  const completedNotes = (item.review_notes || []).filter(row => Boolean(row.responded_at));
  return <article className="mkw-execution-item"><header className="mkw-execution-header"><div className="mkw-execution-title"><span className="mkw-item-number">{number}</span><div><h3>{W.required} {number}</h3><div className="mkw-muted"><UserCircle size={16} />{W.assignee}: {item.assignee_name} · {W.department}: {item.department_name}</div></div></div><div className="mkw-actions"><MediaLabel kind={item.media_kind} /><Status value={item.status} />{item.delivery_status && <span className={`mkw-delivery-badge ${item.delivery_status === 'on_time' ? 'is-on-time' : 'is-late'}`}>{item.delivery_status === 'on_time' ? W.deliveryOnTime : W.deliveryLate}</span>}</div></header>
    <div className="mkw-item"><WorkAlert>{error}</WorkAlert>
      {awaitingDecision && <div className="mkw-revision-declined-state" role="status">
        <strong>المنفذ رفض التعديل المطلوب — بانتظار قرار المراجع</strong>
        <p>يمكن للأدمن أو مدير النظام اعتماد الملفات المرفوعة المستوفية للمقاسات أو رفض المنتج. لا يتم الاعتماد تلقائيًا.</p>
        {item.latest_review_event?.note && <p><strong>رد المنفذ:</strong> {item.latest_review_event.note}</p>}
      </div>}
      {item.delivery_status && <div className="mkw-execution-delivery"><span>{W.dueOn}: <strong>{showDate(item.due_on)}</strong></span><span>{W.deliveredAt}: <strong>{submittedDayInRiyadh(item.submitted_at)}</strong></span></div>}
      <section className="mkw-note-management">
        <div className="mkw-section-title"><h4>ملاحظات المراجعة</h4>
          {canRate && revisionFormat !== null && reviewableFormats.length > 0 && <button type="button" className="secondary" disabled={busy} onClick={() => {
            setEditingNoteId(null); setNote(''); setNoteType(''); setShowNoteEditor(true);
          }}>إضافة ملاحظة</button>}
        </div>
        {activeNotes.length > 0 && <div className="mkw-review-notes-list">{activeNotes.map(reviewNote =>
          <article key={reviewNote.id} className="mkw-current-review">
            <div className="mkw-review-note-content"><div className="mkw-review-note-heading">{reviewNote.category_name || W.reviewNote}</div>
              <ReviewNoteDocument text={reviewNote.note}/>
              <small>{reviewNote.author_name} · {showDate(reviewNote.created_at,true)}</small></div>
            {canRate && <div className="mkw-actions">
              <button type="button" className="secondary" disabled={busy} onClick={() => editNote(reviewNote.id,reviewNote.category_id,reviewNote.note)}><PencilSimple size={15}/> تعديل</button>
              <button type="button" className="secondary danger" disabled={busy} onClick={() => void manageNote(true,reviewNote.id)}><Trash size={15}/> حذف</button>
            </div>}
          </article>)}</div>}
        {completedNotes.length > 0 && <details className="mkw-reviewed-notes-history"><summary>سجل الملاحظات السابقة ({completedNotes.length})</summary>
          <div className="mkw-review-notes-list">{completedNotes.map(reviewNote => <article key={reviewNote.id} className="mkw-current-review is-resolved">
            <div className="mkw-review-note-content"><div className="mkw-review-note-heading">{reviewNote.category_name || W.reviewNote}</div>
              <ReviewNoteDocument text={reviewNote.note}/>
              <small>{reviewNote.author_name} · {showDate(reviewNote.created_at,true)}</small></div>
            {canRate && <div className="mkw-actions">
              <button type="button" className="secondary" disabled={busy} onClick={() => editNote(reviewNote.id,reviewNote.category_id,reviewNote.note)}><PencilSimple size={15}/> تعديل</button>
              <button type="button" className="secondary danger" disabled={busy} onClick={() => void manageNote(true,reviewNote.id)}><Trash size={15}/> حذف</button>
            </div>}
          </article>)}</div>
        </details>}
        {showNoteEditor && canRate && (editingNoteId !== null || revisionFormat !== null) && <div className="mkw-review-controls"><div className="mkw-note-fields">
          <Field label="نوع الملاحظة"><select value={noteType} disabled={busy} onChange={event => setNoteType(event.target.value)}><option value="">اختر النوع</option>{categories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
          <div className="mkw-field"><span>تفاصيل الملاحظة</span><div className="mkw-note-composer">
            <div className="mkw-note-toolbar" aria-label="تنسيق الملاحظة">
              <button type="button" className="secondary" disabled={busy} onClick={() => formatNote('heading')}>عنوان</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => formatNote('bold')}>غامق</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => formatNote('bullet')}>• نقاط</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => formatNote('numbered')}>1. ترقيم</button>
            </div>
            <textarea ref={noteEditorRef} rows={5} dir="rtl" aria-label="تفاصيل الملاحظة" value={note} disabled={busy} maxLength={10000}
              placeholder="اكتب كل ملاحظة في سطر منفصل، ويمكنك استخدام النقاط أو الترقيم"
              onChange={event => setNote(event.target.value)} />
            <small>سيظهر كل سطر في فقرة واضحة، وتُعرض النقاط والعناوين بتنسيق منظم.</small>
            {!!note.trim() && <details className="mkw-note-preview"><summary>معاينة تنسيق الملاحظة</summary><ReviewNoteDocument text={note}/></details>}
          </div></div>
        </div><div className="mkw-actions"><button type="button" className="primary" disabled={busy || !noteType || !note.trim()}
          onClick={() => editingNoteId ? void manageNote(false) : void review('revise', revisionFormat === 'all' ? undefined : revisionFormat || undefined)}>
          {editingNoteId ? 'حفظ التعديل' : 'إضافة ملاحظة وتأكيد التعديل'}</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => { setShowNoteEditor(false); setRevisionFormat(null); setEditingNoteId(null); }}>إلغاء</button></div></div>}
        {canDeclineRevision && <div className="mkw-revision-decline-action">
          {!declineEditor ? <button type="button" className="secondary danger" disabled={busy} onClick={() => setDeclineEditor(true)}>
            رفض التعديل
          </button> : <div className="mkw-revision-decline-form">
            <strong>رفض التعديل المطلوب</strong>
            <p>هيتم إرسال الملفات الحالية للمراجعة مرة أخرى دون تغييرها. الأدمن أو مدير النظام هو اللي يقرر اعتماد المنتج 100% أو رفضه.</p>
            <label>سبب رفض التعديل (اختياري)
              <textarea rows={3} value={declineReason} maxLength={2000} disabled={busy}
                placeholder="اكتب سبب الاعتراض لو محتاج توضّح موقفك للمراجع"
                onChange={event => setDeclineReason(event.target.value)}/>
            </label>
            <div className="mkw-actions">
              <button type="button" className="primary" disabled={busy} onClick={() => void declineRevision()}>تأكيد رفض التعديل وإرساله للمراجعة</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => { setDeclineEditor(false); setDeclineReason(''); }}>إلغاء</button>
            </div>
          </div>}
        </div>}
      </section>
      {rating && <div className="mkw-rating-reviewer">{rating.reviewer_name} · {showDate(rating.updated_at,true)}</div>}
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
        <section className="mkw-item-finals"><div className="mkw-section-title"><h4>{W.finalFiles}</h4><div className="mkw-actions"><span className="mkw-muted"><Clock size={16} /> {finals.length} / {item.formats.length}</span>
          {capabilities.review && <button type="button" className="secondary" disabled={busy} onClick={() => { setShowFormatPicker(open => !open); setNewFormatIds([]); setError(''); }}><Plus size={17}/>{W.addFormats}</button>}</div></div>
          {showFormatPicker && capabilities.review && <div className="mkw-upload-format">
            <strong>{W.addFormats} — {item.media_kind === 'image' ? W.image : W.video}</strong>
            <FormatSelector formats={availableFormats} selected={newFormatIds} disabled={busy} onChange={setNewFormatIds}/>
            <div className="mkw-actions"><button type="button" className="primary" disabled={busy || newFormatIds.length === 0} onClick={() => void addFormats()}>{W.save} {W.sizes}</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => { setShowFormatPicker(false); setNewFormatIds([]); }}>{W.cancel}</button></div>
          </div>}
          <div className="mkw-final-grid">{item.formats.map(format => {
            const state = states.get(format.id);
            const locked = state === 'submitted' || state === 'approved';
            const formatFiles = finals.filter(file => file.format_id === format.id);
            return <div className={`mkw-upload-format ${state === 'approved' ? 'mkw-format-approved' : ''}`} key={format.id}>
              <div className="mkw-section-title"><strong>{format.platform_name} · {format.name}{format.width && format.height ? ` (${format.width} × ${format.height})` : ''}</strong><span className="mkw-format-state">{state === 'approved' ? 'معتمد' : state === 'submitted' ? 'قيد المراجعة' : state === 'revision' ? 'مطلوب تعديل' : formatFiles.length ? 'تم الرفع' : 'لم يُرفع'} {state === 'approved' ? <CheckCircle size={19} weight="fill"/> : <UploadSimple size={19}/>}</span></div>
              {formatFiles.map(file => <FileLink key={`${format.id}:${file.id}`} file={file} onRemove={canUpload && !locked && !busy ? () => void run(async () => { await persist(); await workPost('remove_upload', { itemId: item.id, fileId: file.id }); }) : undefined} />)}
              {canUpload && !locked && <label className="mkw-upload-action"><UploadSimple size={17}/><span>{W.upload} {W.finalFiles}</span><input type="file" accept={item.media_kind === 'image' ? '.jpg,.jpeg,.png,.webp,.gif,.heic,.heif' : '.mp4,.mov,.m4v,.webm'} multiple={item.media_kind === 'image'} disabled={busy} onChange={event => { void upload(event.target.files, 'final', [format.id]); event.target.value = ''; }} /></label>}
              {capabilities.review && reviewableFormatIds.has(format.id) && <div className="mkw-format-review-actions"><button type="button" className="primary" disabled={busy || !approvableFormatIds.has(format.id)} onClick={() => void review('approve', format.id)}>اعتماد المقاس</button><button type="button" className="secondary" disabled={busy} onClick={() => beginRevision(format.id)}>تعديل</button></div>}
              {capabilities.review && approvedFormatIds.has(format.id) && <div className="mkw-format-review-actions"><button type="button" className="secondary" disabled={busy} onClick={() => void undoApproval(format.id)}>تراجع عن الاعتماد</button></div>}
            </div>;
          })}</div>
          {item.pending_uploads?.map(file => <div className="mkw-file-link" key={file.id}><span>{file.name}</span><span className="mkw-muted">{W.loading}</span>{canUpload && <button type="button" className="icon-button" aria-label={W.cancel} disabled={busy} onClick={() => void run(() => workPost('remove_upload', { itemId: item.id, fileId: file.id }))}><X size={15} /></button>}</div>)}
          {progress && <div className="mkw-upload-format"><span>{progress.name} {progress.percent}%</span><progress max={100} value={progress.percent} /><button type="button" className="secondary" onClick={() => controller.current?.abort()}>{W.cancel}</button></div>}
          {!!finals.length && <details><summary><FileArrowDown size={17} />{W.viewProduct}</summary><FilesPreview files={finals} /></details>}
        </section>
      </div>
      {editable && <footer className="mkw-actions"><button type="button" className="secondary" disabled={busy} onClick={() => void run(persist)}>{W.save}</button>{canUpload && <button type="button" className="primary" disabled={busy || !readyToSubmit || !!item.pending_uploads?.length} onClick={() => void run(async () => { const nextVersion = await persist(); await workPost('submit', { itemId: item.id, version: nextVersion }); })}><PaperPlaneTilt size={18} />{W.submit}</button>}</footer>}
      {capabilities.review && (item.status !== 'approved' || approvedFormatIds.size > 0) && <section className="mkw-review-controls"><div className="mkw-actions">{item.status !== 'approved' && reviewableFormats.length > 0 && <><button type="button" className="primary" disabled={busy || approvableFormats.length === 0} onClick={() => void review('approve')}>{W.approve} الملفات المرفوعة</button><button type="button" className="secondary" disabled={busy} onClick={() => beginRevision()}>تعديل الملفات المرفوعة</button></>}{approvedFormatIds.size > 0 && <button type="button" className="secondary" disabled={busy} onClick={() => void undoApproval()}>تراجع عن اعتماد - المنتج 100% الملفات المرفوعة</button>}{item.status !== 'approved' && <button type="button" className="secondary danger" disabled={busy} onClick={() => void review('reject')}>{W.reject}</button>}</div></section>}
    </div>

  </article>;
}
