import { Fragment, lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CaretDown, CheckCircle, PaperPlaneTilt } from '@phosphor-icons/react';
import { Modal } from '../../components/Modal';
import { YouTubeOptionsFields } from '../components/YouTubeOptionsFields';
import { marketingFetch, marketingQuery } from '../api';
import { W, Empty, Field, FormatSelector, MediaLabel, ProductViewButton, Search, Status, WorkAlert, WorkHeader } from './components';
import { fileUrl, showDate, useWorkQuery, workPost } from './api';
import type { WorkCapabilities, WorkPlanLine, WorkProduct, WorkFormat } from '../../../shared/marketing-workflow';
import { normalizeYouTubePublishOptions, YOUTUBE_CATEGORY_FALLBACKS, type YouTubePublishOptions, type YouTubePublishSettings, type YouTubeOptionItem } from '../../../shared/youtube-publishing';
const ManualPublishPage = lazy(() => import('../pages/ManualPublishPage').then(module => ({ default: module.ManualPublishPage })));

type PublishTarget = { id: string; post_type_id: string; schedule_id: string; status: string; publish_result: { error?: string; postId?: number; scheduledAt?: string; url?: string }; updated_at?: string; platform_code: string; platform_name: string; post_type_name: string; publish_options: { youtube?: YouTubePublishOptions; publishTime?: string } };
type PrepData = { draftFormatIds?: string[]; plannedFormat?: WorkFormat | null; line: WorkPlanLine & { caption: string; hashtags: string; version: number }; product: WorkProduct; targets: PublishTarget[]; youtubeDefaults: YouTubePublishSettings; capabilities: WorkCapabilities };
type ProductDraft = { product_id: string; format_ids: string[]; caption: string; hashtags: string; updated_at: string };
type PublishingData = { products: WorkProduct[]; lines: WorkPlanLine[]; drafts: ProductDraft[]; capabilities: WorkCapabilities };

export function PublishPage() {
  const [params, setParams] = useSearchParams();
  const [manual, setManual] = useState(false), [search, setSearch] = useState('');
  const [expandedProduct, setExpandedProduct] = useState('');
  const query = useWorkQuery<PublishingData>('publishing');
  const selectedLine = params.get('line') || '';
  const term = search.trim().toLocaleLowerCase();
  const products = (query.data?.products || []).filter(product =>
    `${product.task_name} ${product.idea_name} ${product.task_no} ${product.statement}`.toLocaleLowerCase().includes(term));
  const groups = new Map<string, WorkProduct[]>();
  for (const product of products) groups.set(product.task_id, [...(groups.get(product.task_id) || []), product]);
  const plannedCount = (query.data?.lines || []).length;
  const draftCount = (query.data?.products || []).filter(product => { const draft = query.data?.drafts.find(row=>row.product_id===product.id); return String(draft?.caption || product.caption || '').trim() && String(draft?.hashtags || product.hashtags || '').trim(); }).length;

  return <div className="mkw mkw-publishing-page">
    <WorkHeader title={W.publishing} onRefresh={() => void query.reload()} loading={query.loading}>
      {query.data?.capabilities.prepare && <button type="button" className="secondary" onClick={() => setManual(value => !value)}>{manual ? W.prepare : W.manual}</button>}
    </WorkHeader>
    <WorkAlert>{query.error}</WorkAlert>
    {manual ? <Suspense fallback={<Empty>{W.loading}</Empty>}><ManualPublishPage /></Suspense> : <>
      <div className="mkw-publish-summary">
        <div><small>{W.productCount}</small><strong>{query.data?.products.length ?? '—'}</strong></div>
        <div><small>{W.prepare}</small><strong>{query.data ? draftCount : '—'}</strong></div>
        <div><small>{W.agenda} / {W.campaign}</small><strong>{query.data ? plannedCount : '—'}</strong></div>
      </div>
      <div className="mkw-toolbar mkw-publish-toolbar"><Search value={search} onChange={setSearch} /></div>
      {!query.data ? <section className="mkw-panel mkw-loading-panel"><strong>{query.loading ? W.loading : query.error || W.noData}</strong><button className="secondary" type="button" disabled={query.loading} onClick={() => void query.reload()}>{W.refresh}</button></section> : null}
      {query.data && !groups.size && <Empty>{W.noData}</Empty>}
      {[...groups.entries()].map(([taskId, items]) => <details key={taskId} className="mkw-publish-group mkw-publish-table-group">
        <summary className="mkw-publish-group-header"><div><span className="mkw-code">{items[0].task_no}</span><h2>{items[0].task_name}</h2></div><span className="mkw-publish-count">{W.productCount}: {items.length}</span><CaretDown size={18} className="mkw-publish-group-caret" /></summary>
        <div className="mkw-publish-table-scroll"><table className="mkw-publish-list-table"><thead><tr><th>#</th><th>{W.ideaName}</th><th>{W.type}</th><th>{W.sizes}</th><th>{W.assignee}</th><th>{W.agenda} / {W.campaign}</th><th>{W.status}</th><th>{W.view}</th></tr></thead><tbody>
          {items.map((product, index) => {
            const open = expandedProduct === product.id;
            const draft = query.data?.drafts.find(row => row.product_id === product.id);
            const plans = (query.data?.lines || []).filter(line => line.product_id === product.id);
            return <Fragment key={product.id}><tr className={open ? 'mkw-publish-expanded-row' : ''}>
              <td className="mkw-publish-numeric">{index + 1}</td>
              <td className="mkw-publish-product-title"><strong>{product.idea_name || product.statement}</strong></td>
              <td><MediaLabel kind={product.media_kind} /></td>
              <td><span className="mkw-muted">{product.formats.length} {W.sizes}</span></td>
              <td className="mkw-publish-assignee">{product.assignee_name || '—'}</td>
              <td><span className="mkw-publish-count">{plans.length}</span></td>
              <td><span className={`mkw-publish-draft-state ${(draft?.caption || product.caption)?.trim() && (draft?.hashtags || product.hashtags)?.trim() ? 'is-ready' : ''}`}>
                {(draft?.caption || product.caption)?.trim() && (draft?.hashtags || product.hashtags)?.trim() ? <><CheckCircle size={16} weight="fill"/>تم حفظ الكابشن والهاشتاج</> : !(draft?.caption || product.caption)?.trim() ? 'الكابشن لم يُحفظ' : 'الهاشتاج لم يُحفظ'}
              </span></td>
              <td><div className="mkw-publish-row-actions"><ProductViewButton id={product.id} /><button type="button" className="secondary" aria-expanded={open} onClick={() => setExpandedProduct(open ? '' : product.id)}>{open ? 'إغلاق' : W.open}<CaretDown size={15} className={open ? 'mkw-publish-up' : ''}/></button></div></td>
            </tr>{open && <tr className="mkw-publish-detail-row"><td colSpan={8}><div className="mkw-publish-product-body">
              <ProductDraftEditor product={product} draft={draft} canSave={!!query.data?.capabilities.prepare} onSaved={() => void query.reload()}/>
              <div className="mkw-publish-plans"><header><h4>{W.agenda} / {W.campaign}</h4><div className="mkw-actions">
                {query.data?.capabilities.createAgenda && <Link className="mkw-link-button" to={`/marketing/create?mode=agenda&product=${encodeURIComponent(product.id)}`}>{W.createAgenda}</Link>}
                {query.data?.capabilities.createCampaign && <Link className="mkw-link-button" to={`/marketing/create?mode=campaign&product=${encodeURIComponent(product.id)}`}>{W.createCampaign}</Link>}
              </div></header>
                {plans.length ? plans.map(line => <div key={line.id} className="mkw-publish-plan-row"><div><strong>{line.name}</strong><span className="mkw-muted">{line.kind === 'agenda' ? W.publishDate : W.fundingDate}: {showDate(line.scheduled_on)} · {[line.platform_name,line.post_type_name].filter(Boolean).join(' / ')}</span></div><Status value={line.status}/><button type="button" className="secondary" onClick={() => setParams({ line: line.id })}>{W.prepare}</button></div>) : <p className="mkw-muted">اختر المنتج في {W.createAgenda} أو {W.createCampaign} لتحديد تاريخ النشر أو التمويل.</p>}
              </div>
            </div></td></tr>}</Fragment>;
          })}
        </tbody></table></div>
      </details>)}
    </>}
    {selectedLine && <PreparationModal id={selectedLine} onClose={() => setParams({})} onChanged={() => void query.reload()} />}
  </div>;
}

function ProductDraftEditor({ product, draft, canSave, onSaved }: {
  product: WorkProduct; draft?: ProductDraft; canSave: boolean; onSaved: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(() => draft?.format_ids?.length ? draft.format_ids : product.formats.map(f => f.id));
  const [caption, setCaption] = useState(draft?.caption || product.caption || ''), [hashtags, setHashtags] = useState(draft?.hashtags || product.hashtags || '');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  useEffect(() => {
    setSelected(draft?.format_ids?.length ? draft.format_ids : product.formats.map(f => f.id));
    setCaption(draft?.caption || product.caption || ''); setHashtags(draft?.hashtags || product.hashtags || '');
  }, [draft?.updated_at, product.id]);
  const groups = new Map<string, typeof product.formats>();
  for (const format of product.formats) {
    const key = format.platform_id;
    groups.set(key, [...(groups.get(key) || []), format]);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !canSave) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await workPost('save_product_draft', { productId: product.id, formatIds: selected, caption, hashtags });
      setMessage(W.saved); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : W.invalid); }
    finally { setBusy(false); }
  }
  return <form className="mkw-publish-draft" onSubmit={save}>
    <div className="mkw-publish-copy-title"><div><h4>{W.required}: {product.idea_name || product.statement}</h4><small>{product.task_no} · {product.task_name} · {product.assignee_name}</small></div>
      <span className={`mkw-publish-draft-state ${(draft?.caption || product.caption)?.trim() && (draft?.hashtags || product.hashtags)?.trim() ? 'is-ready' : ''}`}>
        {(draft?.caption || product.caption)?.trim() && (draft?.hashtags || product.hashtags)?.trim() ? <><CheckCircle size={17} weight="fill"/>تم حفظ النصوص</> : 'أكمل النصوص واحفظها'}
      </span>
    </div>
    <p className="mkw-muted">كل مطلوب له كابشن وهاشتاج مستقلان. اكتب النصين واضغط حفظ؛ بعدها تظهر علامة صح للمطلوب في الجدول.</p>
    <div className="mkw-publish-copy"><div className="mkw-publish-copy-field"><div className="mkw-publish-field-state"><strong>{W.caption}</strong>{(draft?.caption || product.caption)?.trim() && caption === (draft?.caption || product.caption) ? <span className="is-saved"><CheckCircle size={17} weight="fill"/> محفوظ</span> : <span>{caption.trim() ? 'غير محفوظ' : 'لم يُكتب'}</span>}</div><Field label={W.caption}><textarea rows={4} value={caption} maxLength={10000} disabled={busy} readOnly={!canSave} placeholder={W.caption} onChange={event => setCaption(event.target.value)} /></Field></div>
      <div className="mkw-publish-copy-field"><div className="mkw-publish-field-state"><strong>{W.hashtags}</strong>{(draft?.hashtags || product.hashtags)?.trim() && hashtags === (draft?.hashtags || product.hashtags) ? <span className="is-saved"><CheckCircle size={17} weight="fill"/> محفوظ</span> : <span>{hashtags.trim() ? 'غير محفوظ' : 'لم يُكتب'}</span>}</div><Field label={W.hashtags}><textarea rows={4} value={hashtags} maxLength={3000} disabled={busy} readOnly={!canSave} placeholder="#" onChange={event => setHashtags(event.target.value)} /></Field></div></div>
    <details className="mkw-publish-format-details"><summary><strong>المنصات والمقاسات الخاصة بالمطلوب</strong><span>{selected.length} / {product.formats.length} ▾</span></summary>
    <header className="mkw-publish-draft-head"><h4>{W.platforms}</h4><div className="mkw-actions"><span className="mkw-muted">{selected.length} / {product.formats.length}</span>
      <label className="mkw-checkbox"><input type="checkbox" disabled={!canSave || busy || !product.formats.length} checked={!!product.formats.length && product.formats.every(f => selected.includes(f.id))} onChange={event => setSelected(event.target.checked ? product.formats.map(f => f.id) : [])}/>{W.selectAll}</label>
    </div></header>
    <div className="mkw-publish-platforms">{[...groups.entries()].map(([id, formats]) => <section className="mkw-publish-platform" key={id}>
      <header><strong>{formats[0].platform_name}</strong><span className="mkw-muted">{formats.filter(f => selected.includes(f.id)).length} / {formats.length}</span></header>
      <div className="mkw-publish-format-grid">{formats.map(format => <label key={format.id} className={`mkw-publish-format ${selected.includes(format.id) ? 'selected' : ''}`}>
        <input type="checkbox" disabled={!canSave || busy} checked={selected.includes(format.id)} onChange={event => setSelected(current => event.target.checked ? [...current, format.id] : current.filter(id => id !== format.id))}/>
        <span>{format.name}{format.width && format.height ? <small dir="ltr">{format.width} × {format.height}</small> : null}</span>
      </label>)}</div>
    </section>)}</div>
    </details>
    <div className="mkw-publish-files"><strong>{W.finalFiles}</strong><div>{product.files.filter(file => file.category === 'final' && file.status === 'ready').map(file => <a key={file.id} className="mkw-publish-file" href={fileUrl(file.id, true)} target="_blank" rel="noreferrer">{file.name}</a>)}</div></div>
    <div className="mkw-publish-draft-footer"><div><WorkAlert>{error}</WorkAlert><WorkAlert success>{message}</WorkAlert></div>{canSave && <button type="submit" className="primary" disabled={busy || !selected.length}>{busy ? W.loading : W.save}</button>}</div>
  </form>;
}

export function PreparationModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const query = useWorkQuery<PrepData>('prep', { id });
  async function refresh() { await query.reload(); onChanged(); }
  return <Modal open title={W.prepare} onClose={onClose} className="mkw-modal"><div className="mkw"><WorkAlert>{query.error}</WorkAlert>{!query.data ? <Empty>{query.loading ? W.loading : W.noData}</Empty> : <PreparationEditor key={`${query.data.line.version}:${query.data.targets.map(t => t.status).join(',')}`} data={query.data} refresh={refresh} />}</div></Modal>;
}
function PreparationEditor({ data, refresh }: { data: PrepData; refresh: () => Promise<void> }) {
  const plannedIds = data.line.post_type_id ? [data.line.post_type_id] : [];
  const initialSelected = plannedIds.length ? plannedIds : data.targets.filter(target => target.status !== 'cancelled').map(target => target.post_type_id);
  const availableFormats = data.plannedFormat && !data.product.formats.some(format => format.id === data.plannedFormat?.id)
    ? [...data.product.formats, data.plannedFormat] : data.product.formats;
  const [formatIds, setFormatIds] = useState(initialSelected.length ? initialSelected : (data.draftFormatIds?.length ? data.draftFormatIds : data.product.formats.map(format => format.id)));
  const [caption, setCaption] = useState(data.line.caption || ''), [hashtags, setHashtags] = useState(data.line.hashtags || '');
  const [publishTime, setPublishTime] = useState(data.targets.find(target => target.platform_code === 'tiktok')?.publish_options?.publishTime || '20:00');
  const [rescheduleDate, setRescheduleDate] = useState(String(data.line.scheduled_on).slice(0, 10));
  const [rescheduleTime, setRescheduleTime] = useState(data.targets.find(target => target.platform_code === 'tiktok')?.publish_options?.publishTime || '20:00');
  const originalYouTube = normalizeYouTubePublishOptions(data.targets.find(target => target.platform_code === 'youtube')?.publish_options?.youtube || {}, data.youtubeDefaults, { title: data.line.caption, description: [data.line.caption, data.line.hashtags].filter(Boolean).join('\n\n') });
  const [youtube, setYouTube] = useState(originalYouTube);
  const [categories, setCategories] = useState<YouTubeOptionItem[]>(YOUTUBE_CATEGORY_FALLBACKS), [playlists, setPlaylists] = useState<YouTubeOptionItem[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const isYouTube = availableFormats.some(format => format.platform_code === 'youtube' && formatIds.includes(format.id));
  const isTikTok = availableFormats.some(format => format.platform_code === 'tiktok' && formatIds.includes(format.id));
  const tiktokTargets = data.targets.filter(target => target.platform_code === 'tiktok' && target.status !== 'cancelled');
  const hasTikTokWaiting = tiktokTargets.some(target => target.status === 'waiting');
  const locked = data.targets.some(target => ['published', 'scheduled', 'processing', 'verification_required'].includes(target.status));
  useEffect(() => {
    if (!isYouTube) return;
    let active = true;
    void marketingFetch<{ categories: YouTubeOptionItem[]; playlists: YouTubeOptionItem[] }>(`/api/marketing${marketingQuery({ resource: 'youtube_publish_options' })}`).then(result => { if (active) { setCategories(result.categories?.length ? result.categories : YOUTUBE_CATEGORY_FALLBACKS); setPlaylists(result.playlists || []); } }).catch(() => undefined);
    return () => { active = false; };
  }, [isYouTube]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { await workPost('save_prep', { lineId: data.line.id, version: data.line.version, formatIds, caption, hashtags, youtubeOptions: youtube, publishTime }); await refresh(); setMessage(W.saved); }
    catch (e) { setError(e instanceof Error ? e.message : W.invalid); }
    finally { setBusy(false); }
  }
  async function activateTikTok() {
    if (busy || !isTikTok || !data.capabilities.publish) return;
    if (caption !== data.line.caption || hashtags !== data.line.hashtags ||
      tiktokTargets.some(target => (target.publish_options?.publishTime || '20:00') !== publishTime)) {
      setError('احفظ الكابشن والهاشتاج ووقت النشر أولًا قبل الضغط على نشر.'); return;
    }
    if (!window.confirm(`جدولة فيديو TikTok على التاريخ ${showDate(data.line.scheduled_on)} الساعة ${publishTime} بتوقيت السعودية؟\nلن يتم نشره الآن. سيتم تفعيل جدول النشر بالكامل حسب تواريخه.`)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await workPost<{ message?: string; errors?: string[] }>('activate_plan', { planId: data.line.plan_id });
      setMessage(result.message || 'تم إرسال الجدولة');
      if (result.errors?.length) setError(result.errors.join('؛ '));
      await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : W.invalid); }
    finally { setBusy(false); }
  }
  async function checkTikTok(target: PublishTarget) {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await workPost<{ message?: string; status: string }>('tiktok_status', { scheduleId: target.schedule_id });
      setMessage(result.message || (result.status === 'published' ? 'تم النشر' : 'لم يحن موعد النشر بعد'));
      await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : W.invalid); }
    finally { setBusy(false); }
  }
  async function updateTikTokSchedule(target: PublishTarget) {
    if (busy || !data.capabilities.publish || !data.capabilities.prepare) return;
    if (!window.confirm(`تغيير موعد المنشور المجدول نفسه إلى ${rescheduleDate} الساعة ${rescheduleTime} بتوقيت السعودية؟\nلن يتم إنشاء منشور TikTok جديد.`)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await workPost<{ message?: string }>('tiktok_reschedule', {
        scheduleId: target.schedule_id, date: rescheduleDate, time: rescheduleTime,
      });
      setMessage(result.message || 'تم تعديل موعد الجدولة');
      await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : W.invalid); }
    finally { setBusy(false); }
  }
  async function resetAfterCheck(target: PublishTarget) {
    if (busy || !window.confirm(W.confirmNotPublished)) return;
    setBusy(true); setError('');
    try { await workPost('reset_publication', { scheduleId: target.schedule_id, confirmedNotPublished: true }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : W.invalid); }
    finally { setBusy(false); }
  }
  return <form className="mkw" onSubmit={save}><WorkAlert>{error}</WorkAlert><WorkAlert success>{message}</WorkAlert><div className="mkw-summary"><div><small>{W.name}</small><strong>{data.line.name}</strong></div><div><small>{W.ideaName}</small><strong>{data.product.idea_name}</strong></div><div><small>{data.line.kind === 'agenda' ? W.publishDate : W.fundingDate}</small><strong>{showDate(data.line.scheduled_on)}</strong></div><div><small>{W.taskNo}</small><strong>{data.product.task_no}</strong></div></div><div className="mkw-actions"><ProductViewButton id={data.product.id} /><MediaLabel kind={data.product.media_kind} /></div>
    <div className="mkw-preparation-copy-status"><strong>مطلوب: {data.product.idea_name}</strong><span>{data.line.platform_name} · {data.line.post_type_name}</span></div>
    <div className="mkw-publish-copy"><div className="mkw-publish-copy-field"><div className="mkw-publish-field-state"><strong>{W.caption}</strong>{data.line.caption?.trim() && caption === data.line.caption ? <span className="is-saved"><CheckCircle size={17} weight="fill"/> محفوظ</span> : <span>بانتظار الحفظ</span>}</div><Field label={W.caption}><textarea required value={caption} maxLength={10000} readOnly={!data.capabilities.prepare || locked} disabled={busy} onChange={event => setCaption(event.target.value)} /></Field></div>
    <div className="mkw-publish-copy-field"><div className="mkw-publish-field-state"><strong>{W.hashtags}</strong>{data.line.hashtags?.trim() && hashtags === data.line.hashtags ? <span className="is-saved"><CheckCircle size={17} weight="fill"/> محفوظ</span> : <span>بانتظار الحفظ</span>}</div><Field label={W.hashtags}><textarea required value={hashtags} maxLength={3000} readOnly={!data.capabilities.prepare || locked} disabled={busy} onChange={event => setHashtags(event.target.value)} /></Field></div></div>
    <details className="mkw-publish-format-details"><summary><strong>المقاس ونوع النشر</strong><span>{formatIds.length} محدد ▾</span></summary>
    <FormatSelector formats={data.line.post_type_id ? availableFormats.filter(format => format.id === data.line.post_type_id) : availableFormats} selected={formatIds} onChange={setFormatIds} disabled={busy || !data.capabilities.prepare || locked || !!data.line.post_type_id} />
    </details>
    {isTikTok && <div className="mkw-tiktok-schedule-editor"><div><strong>جدولة TikTok</strong><p>اختر وقت النشر مع تاريخ الجدول. الضغط على نشر يرسل الفيديو إلى BulkPublish لينشر تلقائيًا في موعده، وليس فورًا.</p></div><Field label="وقت نشر TikTok (السعودية)"><input type="time" required value={publishTime} disabled={busy || !data.capabilities.prepare || locked} onChange={event => setPublishTime(event.target.value)} /></Field></div>}
    {isYouTube && <fieldset disabled={busy || !data.capabilities.prepare || locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><YouTubeOptionsFields value={youtube} onChange={setYouTube} categories={categories} playlists={playlists} loading={false} /></fieldset>}
    {data.capabilities.prepare && !locked && <footer className="mkw-form-footer"><button type="submit" className="primary" disabled={busy}>{busy ? W.loading : W.save}</button></footer>}
    {isTikTok && data.capabilities.publish && hasTikTokWaiting && <div className="mkw-tiktok-publish-actions"><button type="button" className="primary" disabled={busy || !data.capabilities.prepare} onClick={() => void activateTikTok()}><PaperPlaneTilt size={17}/> نشر في التاريخ والوقت المحددين</button><small>يلزم تجهيز جميع بنود جدول النشر قبل التفعيل.</small></div>}
    {data.line.kind === 'campaign' && <div className="mkw-muted">{W.fundingPlan}</div>}
    {data.line.platform_code && !['facebook', 'instagram', 'youtube', 'tiktok'].includes(data.line.platform_code) && <WorkAlert>يمكن حفظ التجهيز لهذه المنصة، لكن النشر التلقائي غير متاح لها عبر الربط الحالي. لا يُعتبر تجهيز المحتوى نشرًا فعليًا.</WorkAlert>}
    <div className="mkw-upload-section">{data.targets.filter(target => target.status !== 'cancelled').map(target => <article className="mkw-upload-format" key={target.id}><div className="mkw-section-title"><strong>{target.platform_name} - {target.post_type_name}</strong><Status value={target.status} /></div>{target.publish_result?.error && <WorkAlert>{target.publish_result.error}</WorkAlert>}{target.platform_code === 'tiktok' && target.status === 'scheduled' && <div className="mkw-tiktok-scheduled-state"><p>المنشور مجدول عبر BulkPublish{target.publish_result.scheduledAt ? ` · ${new Date(target.publish_result.scheduledAt).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', hour12: true })}` : ''}. لم يتم تأكيد نشره بعد.</p><button type="button" className="secondary" disabled={busy} onClick={() => void checkTikTok(target)}>التحقق من حالة النشر</button>{data.capabilities.publish && data.capabilities.prepare && <div className="mkw-tiktok-reschedule"><Field label="تاريخ النشر الجديد"><input type="date" value={rescheduleDate} disabled={busy || data.targets.filter(item => item.status !== 'cancelled').length > 1} onChange={event => setRescheduleDate(event.target.value)} /></Field><Field label="وقت النشر الجديد (السعودية)"><input type="time" value={rescheduleTime} disabled={busy} onChange={event => setRescheduleTime(event.target.value)} /></Field><button type="button" className="secondary" disabled={busy || (rescheduleDate === String(data.line.scheduled_on).slice(0,10) && rescheduleTime === (target.publish_options?.publishTime || '20:00'))} onClick={() => void updateTikTokSchedule(target)}>تحديث الموعد دون تكرار</button></div>}</div>}{target.platform_code === 'tiktok' && target.status === 'published' && !!target.publish_result?.url && <a href={target.publish_result.url} target="_blank" rel="noreferrer">فتح فيديو TikTok المنشور</a>}{data.capabilities.publish && data.capabilities.prepare && (target.status === 'verification_required' || (target.status === 'processing' && !!target.updated_at && Date.now() - new Date(target.updated_at).getTime() > 900000)) && <button type="button" className="secondary" disabled={busy} onClick={() => void resetAfterCheck(target)}>{W.resetAfterCheck}</button>}</article>)}</div>
  </form>;
}
