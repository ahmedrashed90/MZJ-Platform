import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CaretDown, PaperPlaneTilt } from '@phosphor-icons/react';
import { Modal } from '../../components/Modal';
import { YouTubeOptionsFields } from '../components/YouTubeOptionsFields';
import { marketingFetch, marketingQuery } from '../api';
import { W, Empty, Field, FormatSelector, MediaLabel, ProductViewButton, Search, Status, WorkAlert, WorkHeader } from './components';
import { showDate, useWorkQuery, workPost } from './api';
import type { WorkCapabilities, WorkPlanLine, WorkProduct } from '../../../shared/marketing-workflow';
import { normalizeYouTubePublishOptions, YOUTUBE_CATEGORY_FALLBACKS, type YouTubePublishOptions, type YouTubePublishSettings, type YouTubeOptionItem } from '../../../shared/youtube-publishing';
const ManualPublishPage = lazy(() => import('../pages/ManualPublishPage').then(module => ({ default: module.ManualPublishPage })));

type PublishTarget = { id: string; post_type_id: string; schedule_id: string; status: string; publish_result: { error?: string }; updated_at?: string; platform_code: string; platform_name: string; post_type_name: string; publish_options: { youtube?: YouTubePublishOptions } };
type PrepData = { line: WorkPlanLine & { caption: string; hashtags: string; version: number }; product: WorkProduct; targets: PublishTarget[]; youtubeDefaults: YouTubePublishSettings; capabilities: WorkCapabilities };
export function PublishPage() {
  const [params, setParams] = useSearchParams(), [manual, setManual] = useState(false), [search, setSearch] = useState('');
  const query = useWorkQuery<{ products: WorkProduct[]; lines: WorkPlanLine[]; capabilities: WorkCapabilities }>('publishing');
  const selectedLine = params.get('line') || '', term = search.trim().toLocaleLowerCase();
  const groups = new Map<string, WorkProduct[]>();
  for (const product of (query.data?.products || []).filter(row => `${row.task_name} ${row.idea_name} ${row.task_no}`.toLocaleLowerCase().includes(term))) groups.set(product.task_id, [...(groups.get(product.task_id) || []), product]);
  return <div className="mkw"><WorkHeader title={W.publishing} onRefresh={() => void query.reload()} loading={query.loading}>{query.data?.capabilities.prepare && <button type="button" className="secondary" onClick={() => setManual(value => !value)}>{manual ? W.prepare : W.manual}</button>}</WorkHeader><WorkAlert>{query.error}</WorkAlert>
    {manual ? <Suspense fallback={<Empty>{W.loading}</Empty>}><ManualPublishPage /></Suspense> : <><div className="mkw-toolbar"><Search value={search} onChange={setSearch} /></div>
      {!groups.size && <Empty>{query.loading ? W.loading : W.noData}</Empty>}
      {[...groups.entries()].map(([id, products]) => <details key={id} className="mkw-plan-group" open={!!term}><summary><div><h3>{products[0].task_name}</h3><span className="mkw-code">{products[0].task_no}</span></div><div className="mkw-actions"><span>{W.productCount}: {products.length}</span><CaretDown size={18} /></div></summary><div className="mkw-plan-lines">{products.map(product => <article key={product.id} className="mkw-plan-line"><div className="mkw-section-title"><div><h3>{product.idea_name}</h3><MediaLabel kind={product.media_kind} /></div><ProductViewButton id={product.id} /></div>
        <div className="mkw-actions">{query.data?.capabilities.createAgenda && <Link className="mkw-link-button" to={`/marketing/create?mode=agenda&product=${encodeURIComponent(product.id)}`}>{W.createAgenda}</Link>}{query.data?.capabilities.createCampaign && <Link className="mkw-link-button" to={`/marketing/create?mode=campaign&product=${encodeURIComponent(product.id)}`}>{W.createCampaign}</Link>}</div>
        {(query.data?.lines || []).filter(line => line.product_id === product.id).map(line => <div key={line.id} className="mkw-upload-format"><div className="mkw-section-title"><strong>{line.name}</strong><Status value={line.status} /></div><div className="mkw-section-title"><span>{line.kind === 'agenda' ? W.publishDate : W.fundingDate}: {showDate(line.scheduled_on)}</span><button type="button" className="secondary" onClick={() => setParams({ line: line.id })}>{W.prepare}</button></div></div>)}
      </article>)}</div></details>)}
    </>}
    {selectedLine && <PreparationModal id={selectedLine} onClose={() => setParams({})} onChanged={() => void query.reload()} />}
  </div>;
}
function PreparationModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const query = useWorkQuery<PrepData>('prep', { id });
  async function refresh() { await query.reload(); onChanged(); }
  return <Modal open title={W.prepare} onClose={onClose} className="mkw-modal"><div className="mkw"><WorkAlert>{query.error}</WorkAlert>{!query.data ? <Empty>{query.loading ? W.loading : W.noData}</Empty> : <PreparationEditor key={`${query.data.line.version}:${query.data.targets.map(t => t.status).join(',')}`} data={query.data} refresh={refresh} />}</div></Modal>;
}
function PreparationEditor({ data, refresh }: { data: PrepData; refresh: () => Promise<void> }) {
  const initialSelected = data.targets.filter(target => target.status !== 'cancelled').map(target => target.post_type_id);
  const [formatIds, setFormatIds] = useState(initialSelected.length ? initialSelected : data.product.formats.map(format => format.id));
  const [caption, setCaption] = useState(data.line.caption || ''), [hashtags, setHashtags] = useState(data.line.hashtags || '');
  const originalYouTube = normalizeYouTubePublishOptions(data.targets.find(target => target.platform_code === 'youtube')?.publish_options?.youtube || {}, data.youtubeDefaults, { title: data.line.caption, description: [data.line.caption, data.line.hashtags].filter(Boolean).join('\n\n') });
  const [youtube, setYouTube] = useState(originalYouTube);
  const [categories, setCategories] = useState<YouTubeOptionItem[]>(YOUTUBE_CATEGORY_FALLBACKS), [playlists, setPlaylists] = useState<YouTubeOptionItem[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const isYouTube = data.product.formats.some(format => format.platform_code === 'youtube' && formatIds.includes(format.id));
  const locked = data.targets.some(target => ['published', 'processing', 'verification_required'].includes(target.status));
  const dirty = caption !== (data.line.caption || '') || hashtags !== (data.line.hashtags || '') || JSON.stringify([...formatIds].sort()) !== JSON.stringify([...initialSelected].sort()) || JSON.stringify(youtube) !== JSON.stringify(originalYouTube);
  useEffect(() => {
    if (!isYouTube) return;
    let active = true;
    void marketingFetch<{ categories: YouTubeOptionItem[]; playlists: YouTubeOptionItem[] }>(`/api/marketing${marketingQuery({ resource: 'youtube_publish_options' })}`).then(result => { if (active) { setCategories(result.categories?.length ? result.categories : YOUTUBE_CATEGORY_FALLBACKS); setPlaylists(result.playlists || []); } }).catch(() => undefined);
    return () => { active = false; };
  }, [isYouTube]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { await workPost('save_prep', { lineId: data.line.id, version: data.line.version, formatIds, caption, hashtags, youtubeOptions: youtube }); await refresh(); setMessage(W.saved); }
    catch (e) { setError(e instanceof Error ? e.message : W.invalid); }
    finally { setBusy(false); }
  }
  async function publish(target: PublishTarget) {
    if (busy || !window.confirm(`${W.confirmPublish}\n${target.platform_name} - ${target.post_type_name}`)) return;
    setBusy(true); setError(''); setMessage('');
    try { await workPost('publish', { scheduleId: target.schedule_id }); setMessage(W.published); }
    catch (e) { setError(e instanceof Error ? e.message : W.invalid); }
    finally { await refresh(); setBusy(false); }
  }
  async function resetAfterCheck(target: PublishTarget) {
    if (busy || !window.confirm(W.confirmNotPublished)) return;
    setBusy(true); setError('');
    try { await workPost('reset_publication', { scheduleId: target.schedule_id, confirmedNotPublished: true }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : W.invalid); }
    finally { setBusy(false); }
  }
  return <form className="mkw" onSubmit={save}><WorkAlert>{error}</WorkAlert><WorkAlert success>{message}</WorkAlert><div className="mkw-summary"><div><small>{W.name}</small><strong>{data.line.name}</strong></div><div><small>{W.ideaName}</small><strong>{data.product.idea_name}</strong></div><div><small>{data.line.kind === 'agenda' ? W.publishDate : W.fundingDate}</small><strong>{showDate(data.line.scheduled_on)}</strong></div><div><small>{W.taskNo}</small><strong>{data.product.task_no}</strong></div></div><div className="mkw-actions"><ProductViewButton id={data.product.id} /><MediaLabel kind={data.product.media_kind} /></div>
    <FormatSelector formats={data.product.formats} selected={formatIds} onChange={setFormatIds} disabled={busy || !data.capabilities.prepare || locked} />
    <Field label={W.caption}><textarea required value={caption} maxLength={10000} readOnly={!data.capabilities.prepare || locked} disabled={busy} onChange={event => setCaption(event.target.value)} /></Field><Field label={W.hashtags}><textarea required value={hashtags} maxLength={3000} readOnly={!data.capabilities.prepare || locked} disabled={busy} onChange={event => setHashtags(event.target.value)} /></Field>
    {isYouTube && <fieldset disabled={busy || !data.capabilities.prepare || locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><YouTubeOptionsFields value={youtube} onChange={setYouTube} categories={categories} playlists={playlists} loading={false} /></fieldset>}
    {data.capabilities.prepare && !locked && <footer className="mkw-form-footer"><button type="submit" className="primary" disabled={busy}>{busy ? W.loading : W.save}</button></footer>}
    {data.line.kind === 'campaign' && <div className="mkw-muted">{W.fundingPlan}</div>}
    <div className="mkw-upload-section">{data.targets.filter(target => target.status !== 'cancelled').map(target => <article className="mkw-upload-format" key={target.id}><div className="mkw-section-title"><strong>{target.platform_name} - {target.post_type_name}</strong><Status value={target.status} /></div>{target.publish_result?.error && <WorkAlert>{target.publish_result.error}</WorkAlert>}{data.capabilities.publish && data.capabilities.prepare && (target.status === 'verification_required' || (target.status === 'processing' && !!target.updated_at && Date.now() - new Date(target.updated_at).getTime() > 900000)) && <button type="button" className="secondary" disabled={busy} onClick={() => void resetAfterCheck(target)}>{W.resetAfterCheck}</button>}{data.line.kind === 'agenda' && data.capabilities.publish && ['facebook', 'instagram', 'youtube'].includes(target.platform_code) && ['waiting', 'failed'].includes(target.status) && <button type="button" className="primary" disabled={busy || dirty} onClick={() => void publish(target)}><PaperPlaneTilt size={18} />{W.publishNow}</button>}</article>)}</div>
  </form>;
}
