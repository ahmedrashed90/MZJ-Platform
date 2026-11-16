import { useEffect, useMemo, useState } from 'react';
import { CalendarBlank, CheckCircle, FolderOpen, LinkSimple, PaperPlaneTilt, Trash, WarningCircle } from '@phosphor-icons/react';
import { Modal } from '../../components/Modal';
import { Empty, Readiness, W, WorkAlert } from './components';
import { showDate, useWorkQuery, workPost } from './api';
import { marketingFetch, marketingQuery } from '../api';
import type { CampaignGoalOption } from '../../../shared/marketing-campaign-goals';
import type { CampaignReportPayload, CampaignReportRow } from '../../../shared/campaign-report';
import type { WorkPlanLine } from '../../../shared/marketing-workflow';
import './strategyDrafts.css';

/** Strategy flow (second flow). Native agenda/campaign screens are unchanged;
 * these components only render drafts created from «إنشاء التكليفات». */
import { StrategyProductsTable, type StrategyDraft, type StrategyDraftIdea, type StrategyDraftPlatform } from './StrategyProductsTable';
export { StrategyPlanProductsSection, StrategyProductsTable } from './StrategyProductsTable';
export type { StrategyDraft, StrategyDraftIdea, StrategyDraftPlatform } from './StrategyProductsTable';

const kindName = (kind: string) => kind === 'campaign' ? W.campaign : W.agenda;
const mediaName = (kind: string) => kind === 'video' ? W.video : W.image;
const period = (from: string | null, to: string | null) => from ? `${showDate(from)} — ${to ? showDate(to) : 'غير محدد'}` : 'تُحدد من تواريخ الأفكار';

/** Outside view = summary only, same layout family as the agenda/campaign card. */
export function StrategyDraftCard({ draft, onOpen, onReport }: { draft: StrategyDraft; onOpen: () => void; onReport: () => void }) {
  const readiness = draft.productCount ? Math.round(draft.readyCount * 100 / draft.productCount) : 0;
  return <article className="mkw-dashboard-publish-card mkw-strategy-draft-card" aria-label={`مسودة ${kindName(draft.kind)} ${draft.name}`}>
    <div className="mkw-dashboard-publish-card-head">
      <div className="mkw-dashboard-publish-head-main">
        <span className="mkw-code">{draft.planNo || 'الكود يُحدد عند الإرسال للمراجعة'}</span>
        <h3>{draft.name}</h3>
        <div className="mkw-dashboard-publish-meta-line">
          <span className="mkw-kind-label">{kindName(draft.kind)}</span>
          <span className="mkw-muted">{draft.platforms.map(platform => platform.name).filter(Boolean).join(' • ') || 'لم تُحدد المنصات بعد'}</span>
        </div>
        <span className="mkw-muted">تاريخ الإنشاء: {showDate(draft.createdAt)}</span>
      </div>
      <div className="mkw-plan-status-badges"><span className="mkw-strategy-draft-badge">مسودة {kindName(draft.kind)}</span></div>
    </div>
    <div className="mkw-dashboard-publish-stats">
      <div><small>{draft.kind === 'agenda' ? 'فترة نشر الأجندة' : 'فترة التمويل'}</small><strong>{period(draft.periodFrom, draft.periodTo)}</strong></div>
      <div><small>عدد الأفكار</small><strong>{draft.ideaCount}</strong></div>
      <div><small>عدد المنصات</small><strong>{draft.platforms.length}</strong></div>
      <div><small>تم التنفيذ</small><strong>{draft.executedCount} / {draft.productCount}</strong></div>
    </div>
    <div className="mkw-dashboard-publish-progress-wrap">
      <Readiness value={readiness} label="جاهزية المسودة"/>
      <div className="mkw-dashboard-publish-quick-stats">
        <span>جاهز للإرسال: <strong>{draft.readyCount}</strong> / {draft.productCount}</span>
        <span>تم الإعداد: <strong>{draft.configuredCount}</strong> / {draft.productCount}</span>
      </div>
    </div>
    <div className="mkw-dashboard-publish-actions">
      <button type="button" className="secondary" onClick={onReport}><CalendarBlank size={17}/>التقرير</button>
      <button type="button" className="primary" onClick={onOpen}><FolderOpen size={17}/>فتح المسودة</button>
    </div>
  </article>;
}

export function StrategyDraftReport({ draftId, onClose }: { draftId: string; onClose: () => void }) {
  const query = useWorkQuery<{ draft: StrategyDraft | null }>('strategy_report', { draftId });
  const draft = query.data?.draft;
  return <Modal open title={`التقرير${draft ? ` — ${draft.name}` : ''}`} onClose={onClose} className="mkw-fullscreen mkw-plan-report-modal">
    <div className="mkw mkw-plan-report"><WorkAlert>{query.error}</WorkAlert>
      {!draft ? <Empty>{query.loading ? W.loading : W.noData}</Empty> : <>
        <div className="mkw-section-title"><div><span className="mkw-code">{draft.planNo || '—'}</span><strong>مسودة {kindName(draft.kind)} · {draft.name}</strong></div><span className="mkw-strategy-draft-badge">مسودة</span></div>
        <StrategyProductsTable draft={draft}/>
      </>}
    </div>
  </Modal>;
}

type EntryForm = { scheduledOn: string; fundingOn: string; platforms: Record<string, Record<string, string>> };
type CatalogPlatform = { platformId: string; platformName: string; platformCode: string;
  postTypes: Array<{ id: string; name: string; width: number | null; height: number | null; mediaKinds: Array<'image' | 'video'> }> };
function formFromIdea(idea: StrategyDraftIdea): EntryForm {
  const platforms: EntryForm['platforms'] = {};
  for (const platform of idea.platforms) platforms[platform.platformId] = Object.fromEntries(platform.postTypes.map(type => [type.postTypeId, String(type.budget ?? '')]));
  return { scheduledOn: idea.scheduledOn || idea.publishOn || idea.fundingOn || '', fundingOn: idea.fundingOn || '', platforms };
}
const money = (value: number) => value.toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function formPlatforms(form: EntryForm, campaign: boolean): StrategyDraftPlatform[] {
  return Object.entries(form.platforms).map(([platformId, types]) => ({ platformId,
    postTypes: Object.entries(types).map(([postTypeId, budget]) => ({ postTypeId, budget: (campaign ? budget : 0) as unknown as number })) }));
}

/** Inside view: ideas → ONE step: dates on top, then one row per platform with
 * its publish types (budget per type for a campaign) and the campaign goal.
 * «إرسال للمراجعة» does not wait for execution; preparation does. */
export function StrategyDraftEditor({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const query = useWorkQuery<{ draft: StrategyDraft; platforms: CatalogPlatform[] }>('strategy_draft', { id });
  const draft = query.data?.draft;
  const catalog = query.data?.platforms || [];
  const campaign = draft?.kind === 'campaign';
  const goalsQuery = useWorkQuery<{ goals: CampaignGoalOption[]; migrationRequired: boolean }>('campaign_goal_settings', {}, campaign);
  const goalOptions = goalsQuery.data?.goals || [];
  const [selectedId, setSelectedId] = useState(''), [filter, setFilter] = useState<'all' | 'incomplete' | 'ready'>('all');
  const [form, setForm] = useState<EntryForm | null>(null), [dirty, setDirty] = useState(false);
  const [goals, setGoals] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const ideas = draft?.ideas || [];
  const selected = ideas.find(idea => idea.id === selectedId) || null;
  useEffect(() => { if (!selectedId && ideas.length) setSelectedId((ideas.find(idea => !idea.configured) || ideas[0]).id); }, [ideas.length, selectedId]);
  useEffect(() => { if (selected) { setForm(formFromIdea(selected)); setDirty(false); } }, [selected?.id, selected?.version]);
  useEffect(() => { if (draft) setGoals(Object.fromEntries(draft.platformGoals.map(row => [row.platformId, row.goalIds]))); }, [draft?.id, JSON.stringify(draft?.platformGoals)]);
  const usedPlatforms = draft?.platforms || [];
  const platformsWithoutGoal = campaign ? usedPlatforms.filter(platform => !(draft!.platformGoals.find(row => row.platformId === platform.platformId)?.goalIds.length)) : [];
  const allReady = Boolean(draft && ideas.length && ideas.every(idea => idea.ready) && !platformsWithoutGoal.length);
  const visibleIdeas = ideas.filter(idea => filter === 'all' || (filter === 'ready' ? idea.ready : !idea.ready));
  const producedIds = new Set(selected?.formats.map(format => format.id) || []);
  const rows = selected ? catalog.map(platform => ({ ...platform, postTypes: platform.postTypes.filter(type => type.mediaKinds.includes(selected.mediaKind)) })) : [];
  const usable = rows.filter(row => row.postTypes.length), unusable = rows.filter(row => !row.postTypes.length);
  const ideaBudget = form ? Object.values(form.platforms).reduce((sum, types) => sum + Object.values(types).reduce((total, value) => total + (Number(value) || 0), 0), 0) : 0;
  const selectedCount = form ? Object.values(form.platforms).reduce((sum, types) => sum + Object.keys(types).length, 0) : 0;
  const readiness = draft?.productCount ? Math.round(draft.readyCount * 100 / draft.productCount) : 0;

  async function run(action: string, body: Record<string, unknown>, done: string) {
    setBusy(true); setError(''); setMessage('');
    try { await workPost(action, body); await query.reload(); onChanged(); setMessage(done); return true; }
    catch (failure) { setError(failure instanceof Error ? failure.message : W.invalid); return false; }
    finally { setBusy(false); }
  }
  function update(next: (current: EntryForm) => EntryForm) { setForm(current => current ? next(current) : current); setDirty(true); setMessage(''); }
  function togglePlatform(platformId: string, checked: boolean) {
    update(current => { const platforms = { ...current.platforms };
      if (checked) platforms[platformId] = platforms[platformId] || {}; else delete platforms[platformId];
      return { ...current, platforms }; });
  }
  function toggleType(platformId: string, postTypeId: string) {
    update(current => { const types = { ...(current.platforms[platformId] || {}) };
      if (types[postTypeId] !== undefined) delete types[postTypeId]; else types[postTypeId] = '';
      return { ...current, platforms: { ...current.platforms, [platformId]: types } }; });
  }
  function toggleGoal(platformId: string, goalId: string) {
    setGoals(current => { const list = current[platformId] || [];
      return { ...current, [platformId]: list.includes(goalId) ? list.filter(value => value !== goalId) : [...list, goalId] }; });
    setDirty(true); setMessage('');
  }
  function validate(): string {
    if (!form || !draft) return W.invalid;
    if (!form.scheduledOn) return 'حدد تاريخ النشر';
    if (campaign && !form.fundingOn) return 'حدد تاريخ التمويل';
    const entries = Object.entries(form.platforms);
    if (!entries.length) return 'اختر منصة واحدة على الأقل';
    if (entries.some(([, types]) => !Object.keys(types).length)) return 'اختر نوع نشر واحدًا على الأقل لكل منصة محددة';
    if (campaign && entries.some(([, types]) => Object.values(types).some(value => value === '' || !(Number(value) >= 0)))) return 'أدخل ميزانية لكل نوع نشر';
    return '';
  }
  function goalsPayload(extraPlatformIds: string[]) {
    const ids = [...new Set([...usedPlatforms.map(platform => platform.platformId), ...extraPlatformIds])];
    return ids.map(platformId => ({ platformId, goalIds: goals[platformId] || [] }));
  }
  async function saveIdea() {
    if (!selected || !form || !draft) return;
    const problem = validate();
    if (problem) { setError(problem); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      await workPost('strategy_save_entry', { draftId: draft.id, entryId: selected.id, version: selected.version,
        scheduledOn: form.scheduledOn, ...(campaign ? { fundingOn: form.fundingOn } : {}), platforms: formPlatforms(form, campaign) });
      if (campaign) await workPost('strategy_save_draft', { draftId: draft.id, platformGoals: goalsPayload(Object.keys(form.platforms)) });
      await query.reload(); onChanged(); setDirty(false); setMessage('تم حفظ إعداد الفكرة');
    } catch (failure) { setError(failure instanceof Error ? failure.message : W.invalid); }
    finally { setBusy(false); }
  }
  /** Same platforms/types (and budgets) for ideas not configured yet; each idea
   * keeps its own dates, and only types matching its media are copied. */
  async function copyToIncomplete() {
    if (!form || !draft || !selected) return;
    const problem = validate();
    if (problem) { setError(problem); return; }
    const targets = ideas.filter(idea => idea.id !== selected.id && !idea.configured);
    if (!targets.length) { setMessage('كل الأفكار الأخرى معدّة بالفعل'); return; }
    if (!window.confirm(`تطبيق نفس المنصات وأنواع النشر${campaign ? ' والميزانيات' : ''} على ${targets.length} فكرة غير مكتملة؟ تاريخ كل فكرة يظل كما هو.`)) return;
    setBusy(true); setError(''); setMessage('');
    let done = 0; const skipped: string[] = [];
    try {
      for (const idea of targets) {
        const platforms = formPlatforms(form, campaign).map(platform => ({ ...platform, postTypes: platform.postTypes.filter(type =>
          catalog.find(row => row.platformId === platform.platformId)?.postTypes.find(row => row.id === type.postTypeId)?.mediaKinds.includes(idea.mediaKind)) }))
          .filter(platform => platform.postTypes.length);
        const scheduledOn = idea.scheduledOn || idea.publishOn || form.scheduledOn;
        if (!platforms.length || !scheduledOn) { skipped.push(idea.ideaName); continue; }
        await workPost('strategy_save_entry', { draftId: draft.id, entryId: idea.id, version: idea.version, scheduledOn,
          ...(campaign ? { fundingOn: idea.fundingOn || form.fundingOn } : {}), platforms });
        done++;
      }
      if (campaign) await workPost('strategy_save_draft', { draftId: draft.id, platformGoals: goalsPayload(Object.keys(form.platforms)) });
      setMessage(`تم تطبيق الإعداد على ${done} فكرة${skipped.length ? ` · لم يُطبق على: ${skipped.join('، ')} (نوع الوسائط مختلف)` : ''}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : W.invalid); }
    finally { setBusy(false); await query.reload(); onChanged(); }
  }

  return <Modal open title={draft ? `مسودة ${kindName(draft.kind)} — ${draft.name}` : 'المسودة'} onClose={onClose} className="mkw-fullscreen mkw-strategy-draft-modal">
    <div className="mkw mkw-strategy-draft-editor">
      {!draft ? <Empty>{query.loading ? W.loading : query.error || W.noData}</Empty> : <>
        <section className="mkw-sd-hero">
          <div className="mkw-sd-hero-title">
            <span className="mkw-code">{draft.planNo || 'الكود يُحدد عند الإرسال للمراجعة'}</span>
            <h2>{draft.name}</h2>
            <div className="mkw-sd-chips"><span className="mkw-strategy-draft-badge">مسودة {kindName(draft.kind)}</span><span>تاريخ الإنشاء: {showDate(draft.createdAt)}</span></div>
          </div>
          <div className="mkw-sd-tiles">
            <div><small>عدد الأفكار</small><strong>{draft.ideaCount}</strong></div>
            <div><small>مكتمل الإعداد</small><strong>{draft.configuredCount}<em>/ {draft.productCount}</em></strong></div>
            <div><small>تم التنفيذ</small><strong>{draft.executedCount}<em>/ {draft.productCount}</em></strong></div>
            <div><small>{draft.kind === 'agenda' ? 'فترة نشر الأجندة' : 'فترة التمويل'}</small><strong className="mkw-sd-period">{period(draft.periodFrom, draft.periodTo)}</strong></div>
          </div>
          <Readiness value={readiness} label={`جاهز للإرسال ${draft.readyCount} من ${draft.productCount}`}/>
        </section>
        <WorkAlert>{query.error || error}</WorkAlert><WorkAlert success>{message}</WorkAlert>
        <div className="mkw-strategy-draft-layout">
          <aside className="mkw-strategy-draft-ideas" aria-label="أفكار المسودة">
            <div className="mkw-sd-filter" role="tablist">
              {([['all', `الكل (${ideas.length})`], ['incomplete', `غير مكتمل (${ideas.filter(idea => !idea.ready).length})`], ['ready', `مكتمل (${draft.readyCount})`]] as const).map(([key, label]) =>
                <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
            </div>
            {visibleIdeas.map(idea => <button type="button" key={idea.id} className={`mkw-strategy-draft-idea ${idea.id === selectedId ? 'is-active' : ''} ${idea.ready ? 'is-ready' : 'is-incomplete'}`}
              onClick={() => { if (dirty && !window.confirm('توجد تعديلات غير محفوظة على الفكرة الحالية. الانتقال بدون حفظ؟')) return; setSelectedId(idea.id); }}>
              <span className="mkw-sd-idea-index">{ideas.indexOf(idea) + 1}</span>
              <span className="mkw-sd-idea-body">
                <strong>{idea.ideaName}</strong>
                <small>{mediaName(idea.mediaKind)} · <span dir="ltr">{idea.assignmentNo}</span></small>
                <span className="mkw-sd-idea-flags">
                  <span className={idea.configured ? 'is-ok' : 'is-wait'}>{idea.configured ? `${idea.platforms.length} منصة` : 'الإعداد ناقص'}</span>
                  <span className={idea.executed ? 'is-ok' : 'is-info'}>{idea.executed ? 'منفذة' : 'لم تُنفذ بعد'}</span>
                </span>
              </span>
              {idea.ready ? <CheckCircle size={18} weight="fill" className="mkw-sd-ok"/> : <WarningCircle size={18} weight="fill" className="mkw-sd-warn"/>}
            </button>)}
            {!visibleIdeas.length && <Empty>لا توجد أفكار في هذا الفلتر</Empty>}
          </aside>
          <section className="mkw-strategy-draft-panel">
            {!selected || !form ? <Empty>اختر فكرة من القائمة.</Empty> : <>
              <header className="mkw-sd-idea-head">
                <div><strong>{selected.ideaName}</strong>
                  <div className="mkw-sd-chips"><span>{mediaName(selected.mediaKind)}</span><span>{selected.category || 'بدون تصنيف'}</span><span dir="ltr">{selected.taskNo}</span><span>المنفذ: {selected.assigneeName || '—'}</span><span>موعد التسليم: {showDate(selected.dueOn)}</span></div></div>
                <span className={`mkw-publish-timing ${selected.executed ? 'is-on-time' : 'is-pending'}`} title={selected.executed ? '' : 'لا يمنع الإرسال للمراجعة؛ تجهيز النشر ينتظر التنفيذ'}>{selected.executed ? 'تم التنفيذ والاعتماد' : 'لم يتم التنفيذ بعد'}</span>
              </header>
              {!!selected.missing.length && <div className="mkw-sd-missing"><WarningCircle size={16} weight="fill"/>{selected.missing.join(' · ')}</div>}
              <div className="mkw-sd-setup">
                <div className="mkw-sd-setup-top">
                  <label className="mkw-field"><span>تاريخ النشر</span><input type="date" value={form.scheduledOn} disabled={!draft.canEdit || busy} onChange={event => update(current => ({ ...current, scheduledOn: event.target.value }))}/></label>
                  {campaign && <label className="mkw-field"><span>تاريخ التمويل</span><input type="date" value={form.fundingOn} disabled={!draft.canEdit || busy} onChange={event => update(current => ({ ...current, fundingOn: event.target.value }))}/></label>}
                  <div className="mkw-sd-summary"><strong>{Object.keys(form.platforms).length}</strong> منصة · <strong>{selectedCount}</strong> نوع نشر{campaign && <> · الإجمالي <strong>{money(ideaBudget)}</strong> ر.س</>}</div>
                </div>
                <div className={`mkw-sd-rows ${campaign ? 'is-campaign' : ''}`} role="table" aria-label="المنصات وأنواع النشر">
                  <div className="mkw-sd-row mkw-sd-row-head" role="row"><span role="columnheader">المنصة</span><span role="columnheader">{campaign ? 'أنواع النشر والميزانية (ر.س)' : 'أنواع النشر'}</span>{campaign && <span role="columnheader">الهدف من الحملة</span>}</div>
                  {usable.map(platform => {
                    const checked = Boolean(form.platforms[platform.platformId]);
                    const chosen = form.platforms[platform.platformId] || {};
                    const platformGoals = goals[platform.platformId] || [];
                    return <div key={platform.platformId} role="row" className={`mkw-sd-row ${checked ? 'is-checked' : ''}`}>
                      <label className="mkw-sd-row-platform" role="cell"><input type="checkbox" disabled={!draft.canEdit || busy} checked={checked} onChange={event => togglePlatform(platform.platformId, event.target.checked)}/><strong>{platform.platformName}</strong></label>
                      <div className="mkw-sd-row-types" role="cell">
                        {platform.postTypes.map(type => {
                          const on = chosen[type.id] !== undefined;
                          return <span key={type.id} className={`mkw-sd-pill ${on ? 'is-on' : ''}`}>
                            <button type="button" disabled={!draft.canEdit || busy} aria-pressed={on} onClick={() => { if (!checked) togglePlatform(platform.platformId, true); toggleType(platform.platformId, type.id); }}>
                              {type.name}{producedIds.has(type.id) && <i title="مقاس منفذ في التاسك">●</i>}</button>
                            {campaign && on && <input type="number" min={0} step="0.01" inputMode="decimal" placeholder="الميزانية" aria-label={`ميزانية ${platform.platformName} ${type.name}`} disabled={!draft.canEdit || busy}
                              value={chosen[type.id]} onChange={event => { const value = event.target.value; update(current => ({ ...current, platforms: { ...current.platforms, [platform.platformId]: { ...current.platforms[platform.platformId], [type.id]: value } } })); }}/>}
                          </span>;
                        })}
                      </div>
                      {campaign && <div className="mkw-sd-row-goals" role="cell">
                        {checked ? goalOptions.map(goal => <button type="button" key={goal.id} disabled={!draft.canEdit || busy} aria-pressed={platformGoals.includes(goal.id)}
                          className={`mkw-sd-goal ${platformGoals.includes(goal.id) ? 'is-on' : ''}`} onClick={() => toggleGoal(platform.platformId, goal.id)}>{goal.name}</button>)
                          : <small className="mkw-muted">اختر المنصة أولًا</small>}
                        {checked && !goalOptions.length && <small className="mkw-muted">{goalsQuery.data?.migrationRequired ? 'حدّث أهداف الحملات من الإعدادات' : 'لا توجد أهداف في الإعدادات'}</small>}
                      </div>}
                    </div>;
                  })}
                  {!usable.length && <Empty>لا توجد منصات فعالة مناسبة.</Empty>}
                </div>
                {!!unusable.length && <small className="mkw-muted">غير متاحة لـ{mediaName(selected.mediaKind)}: {unusable.map(row => row.platformName).join('، ')}</small>}
                <small className="mkw-muted mkw-sd-legend"><i>●</i> مقاس منفذ في التاسك</small>
              </div>
              {draft.canEdit && <div className="mkw-sd-panel-actions">
                <button type="button" className="secondary" disabled={busy} onClick={() => void copyToIncomplete()}>تطبيق نفس الإعداد على الأفكار غير المكتملة</button>
                <button type="button" className="primary" disabled={busy} onClick={() => void saveIdea()}>{dirty ? 'حفظ إعداد الفكرة *' : 'حفظ إعداد الفكرة'}</button>
              </div>}
            </>}
          </section>
        </div>
        {draft.canEdit && <div className="mkw-strategy-draft-footer">
          <span className={allReady ? 'mkw-sd-ready-note' : 'mkw-muted'}>{allReady ? 'كل الأفكار مكتملة الإعداد — جاهزة للإرسال للمراجعة. التنفيذ غير مطلوب للإرسال، وتجهيز النشر ينتظر الملفات النهائية.'
            : platformsWithoutGoal.length && ideas.every(idea => idea.ready) ? `اختر الهدف من الحملة لمنصة: ${platformsWithoutGoal.map(platform => platform.name).join('، ')}`
            : `أكمل إعداد كل الأفكار أولًا — مكتمل ${draft.readyCount} من ${draft.productCount}.`}</span>
          <button type="button" className="danger secondary" disabled={busy} onClick={() => { if (window.confirm('حذف المسودة؟ لن يتم حذف التاسكات أو المنتجات.')) void run('strategy_delete_draft', { draftId: draft.id }, 'تم حذف المسودة').then(ok => { if (ok) onClose(); }); }}><Trash size={17}/>حذف المسودة</button>
          <button type="button" className="primary" disabled={busy || !allReady} onClick={() => void run('strategy_submit_draft', { draftId: draft.id }, 'تم الإرسال للمراجعة').then(ok => { if (ok) onClose(); })}><PaperPlaneTilt size={17}/>إرسال للمراجعة</button>
        </div>}
      </>}
    </div>
  </Modal>;
}

/** Strategy plans: caption + hashtags before the product is delivered. The
 * post link (نشر في الموعد / تأخر) is entered from «فتح» after delivery. */
export function StrategyLineCopyModal({ line, onClose, onChanged }: { line: WorkPlanLine; onClose: () => void; onChanged: () => void }) {
  const [caption, setCaption] = useState(String(line.caption || '')), [hashtags, setHashtags] = useState(String(line.hashtags || ''));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  async function save() {
    setBusy(true); setError(''); setMessage('');
    try { await workPost('strategy_save_line_copy', { lineId: line.id, caption, hashtags }); setMessage('تم حفظ الكابشن والهاشتاج'); onChanged(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : W.invalid); }
    finally { setBusy(false); }
  }
  return <Modal open level={1} title={`الكابشن والهاشتاج — ${line.idea_name}`} onClose={onClose} className="mkw-modal">
    <div className="mkw mkw-strategy-copy">
      <div className="mkw-sd-chips"><span>{line.platform_name || '—'} · {line.post_type_name || '—'}</span><span>تاريخ النشر: {showDate(line.scheduled_on)}</span>{line.strategy_funding_on && <span>تاريخ التمويل: {showDate(line.strategy_funding_on)}</span>}</div>
      <WorkAlert>{error}</WorkAlert><WorkAlert success>{message}</WorkAlert>
      <label className="mkw-field"><span>الكابشن</span><textarea rows={6} value={caption} disabled={busy} onChange={event => setCaption(event.target.value)}/></label>
      <label className="mkw-field"><span>الهاشتاج</span><textarea rows={3} value={hashtags} disabled={busy} onChange={event => setHashtags(event.target.value)}/></label>
      <div className="mkw-sd-missing"><WarningCircle size={16} weight="fill"/>رابط المنشور (نشر في الموعد / تأخر في النشر) يُضاف من زر «فتح» في تجهيز النشر بعد تسليم الملفات النهائية واعتمادها.</div>
      <div className="mkw-actions"><button type="button" className="secondary" onClick={onClose}>إغلاق</button><button type="button" className="primary" disabled={busy} onClick={() => void save()}>حفظ الكابشن والهاشتاج</button></div>
    </div>
  </Modal>;
}

/** «تجهيز النشر» for strategy campaigns: choose the published campaign from
 * «تفاعل النشر — تقارير الحملات». The link day vs funding day decides
 * «نشر في الموعد» / «تأخر في النشر». */
export function StrategyCampaignLinkModal({ lines, onClose, onChanged }: { lines: WorkPlanLine[]; onClose: () => void; onChanged: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  // نجلب كل الحملات بدون قيد تاريخ (3 سنوات للخلف) حتى لا تختفي أي حملة بسبب التاريخ
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - 3 * 365 * 86400000).toISOString().slice(0, 10);
  // لو كل السطور على منصة واحدة، نفلتر قائمة الحملات على هذه المنصة فقط
  const platformCodes = Array.from(new Set(lines.map(line => String(line.platform_code || '').toLowerCase()).filter(Boolean)));
  const singlePlatform = platformCodes.length === 1 ? platformCodes[0] : '';
  const platformLabel = singlePlatform ? (lines.find(line => String(line.platform_code || '').toLowerCase() === singlePlatform)?.platform_name || '') : '';
  const [report, setReport] = useState<CampaignReportPayload | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [search, setSearch] = useState(''), [selectedKey, setSelectedKey] = useState('');
  const [lineIds, setLineIds] = useState<string[]>(() => lines.filter(line => !line.strategy_campaign_link).map(line => line.id));
  useEffect(() => {
    let active = true;
    setLoading(true);
    marketingFetch<CampaignReportPayload>(`/api/marketing${marketingQuery({ resource: 'campaign_report', dateFrom: from, dateTo: today })}`)
      .then(result => { if (active) setReport(result); })
      .catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'تعذر قراءة تقارير الحملات'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [from, today]);
  const term = search.trim().toLocaleLowerCase();
  const rows: CampaignReportRow[] = (report?.rows || []).filter(row =>
    (!singlePlatform || String(row.platform || '').toLowerCase() === singlePlatform) &&
    (!term || `${row.campaignName} ${row.accountName} ${row.platformName}`.toLocaleLowerCase().includes(term)));
  const selected = (report?.rows || []).find(row => row.key === selectedKey) || null;
  async function save() {
    if (!selected || !lineIds.length || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      // حملات الاستراتيجية تمر بتحقق ملفات الاستراتيجية؛ الحملات المستقلة تُربط مباشرة
      const action = lines[0]?.strategy_draft_id ? 'strategy_link_campaign' : 'save_prep_campaign_link';
      await workPost(action, { planId: lines[0].plan_id, lineIds, platform: selected.platform, accountId: selected.accountId,
        campaignId: selected.campaignId, campaignName: selected.campaignName });
      setMessage('تم ربط الحملة بتقارير الحملات'); onChanged();
    } catch (failure) { setError(failure instanceof Error ? failure.message : W.invalid); }
    finally { setBusy(false); }
  }
  return <Modal open level={1} title={singlePlatform ? `ربط الحملة بتقارير الحملات — ${platformLabel}` : 'ربط الحملة بتقارير الحملات'} onClose={onClose} className="mkw-fullscreen mkw-strategy-link-modal">
    <div className="mkw mkw-strategy-link">
      <WorkAlert>{error}</WorkAlert><WorkAlert success>{message}</WorkAlert>
      <p className="mkw-muted">اختر الحملة المنشورة من «تفاعل النشر — تقارير الحملات»{singlePlatform ? ` الخاصة بمنصة ${platformLabel}` : ''}. يوم الربط يُقارن بتاريخ النشر المخطط: في نفس اليوم أو قبله = نشر في الموعد، بعده = تأخر في النشر.</p>
      <div className="mkw-table-wrap"><table>
        <thead><tr><th>اختيار</th><th>الفكرة</th><th>المنصة · نوع النشر</th><th>تاريخ التمويل</th><th>الحالة</th></tr></thead>
        <tbody>{lines.map(line => <tr key={line.id}>
          <td><input type="checkbox" aria-label={`اختيار ${line.idea_name}`} checked={lineIds.includes(line.id)} onChange={event => setLineIds(current => event.target.checked ? [...current, line.id] : current.filter(value => value !== line.id))}/></td>
          <td>{line.idea_name}</td><td>{line.platform_name || '—'} · {line.post_type_name || '—'}</td>
          <td>{showDate(line.strategy_funding_on || line.scheduled_on)}</td>
          <td>{line.strategy_campaign_link ? <span className={`mkw-publish-timing ${line.publication_timing === 'late' ? 'is-late' : 'is-on-time'}`}>مرتبطة: {line.strategy_campaign_link.campaignName} · {showDate(line.strategy_campaign_link.linkedOn)}</span> : <span className="mkw-publish-timing is-pending">غير مرتبطة</span>}</td>
        </tr>)}</tbody>
      </table></div>
      <label className="mkw-search"><input placeholder="ابحث باسم الحملة أو الحساب" value={search} onChange={event => setSearch(event.target.value)}/></label>
      {loading ? <Empty>جاري قراءة الحملات من المنصات الإعلانية…</Empty> : <div className="mkw-strategy-link-list" role="radiogroup" aria-label="حملات تقارير الحملات">
        {rows.map(row => <label key={row.key} className={row.key === selectedKey ? 'is-checked' : ''}>
          <input type="radio" name="strategy-campaign" checked={row.key === selectedKey} onChange={() => setSelectedKey(row.key)}/>
          <span><strong>{row.campaignName}</strong><small>{row.platformName} · {row.accountName}</small></span>
        </label>)}
        {!rows.length && <Empty>{singlePlatform ? `لا توجد حملات لمنصة ${platformLabel} في تقارير الحملات.` : 'لا توجد حملات في تقارير الحملات.'}</Empty>}
      </div>}
      <div className="mkw-actions"><button type="button" className="primary" disabled={busy || !selected || !lineIds.length} onClick={() => void save()}><LinkSimple size={17}/>ربط {lineIds.length} منشور بالحملة المختارة</button></div>
    </div>
  </Modal>;
}

type StrategyProductRow = {
  serial: number; itemId: string; ideaCode: string; createdAt: string; category: string; taskName: string; mediaKind: 'image' | 'video';
  itemStatus: string; assignmentNo: string; taskNo: string; orderNo: string; orderName: string; orderKind: string; orderStatus: string;
  assigneeName: string; ideaName: string; readiness: number; dueOn: string | null; approvedOn: string | null; publishOn: string | null; fundingOn: string | null;
};
/** Products tab «منتجات الاستراتيجية» with the requested tracking columns. */
export function StrategyProductsTab({ search }: { search: string }) {
  const query = useWorkQuery<{ ready: boolean; rows: StrategyProductRow[] }>('strategy_products');
  const term = search.trim().toLocaleLowerCase();
  const rows = (query.data?.rows || []).filter(row => !term || `${row.ideaName} ${row.ideaCode} ${row.taskNo} ${row.orderNo} ${row.orderName} ${row.assigneeName} ${row.category}`.toLocaleLowerCase().includes(term));
  return <>
    <WorkAlert>{query.error}</WorkAlert>
    <div className="mkw-table-wrap mkw-strategy-products-table"><table>
      <thead>
        <tr><th rowSpan={2}>م</th><th rowSpan={2}>تاريخ الإنشاء</th><th colSpan={7}>البيان</th><th colSpan={4}>التراكينج</th></tr>
        <tr><th>التصنيف</th><th>المطلوب</th><th>رقم التكليف</th><th>رقم التاسك</th><th>رقم الطلب</th><th>اسم المنفذ</th><th>اسم الفكرة</th><th>الجاهزية</th><th>تاريخ التنفيذ</th><th>تاريخ النشر</th><th>تاريخ التمويل</th></tr>
      </thead>
      <tbody>{rows.map((row, index) => <tr key={row.itemId}>
        <td><span className="mkw-code">{index + 1}</span></td>
        <td>{showDate(row.createdAt)}</td>
        <td>{row.category || '—'}</td>
        <td>{mediaName(row.mediaKind)}</td>
        <td dir="ltr">{row.assignmentNo || '—'}</td>
        <td dir="ltr">{row.taskNo || '—'}</td>
        <td>{row.orderNo ? <><span dir="ltr">{row.orderNo}</span><small className="mkw-muted" style={{ display: 'block' }}>{row.orderKind === 'campaign' ? W.campaign : W.agenda}: {row.orderName}{row.orderStatus === 'draft' ? ' (مسودة)' : ''}</small></> : '—'}</td>
        <td>{row.assigneeName || '—'}</td>
        <td>{row.ideaName}{row.ideaCode && <small className="mkw-muted" style={{ display: 'block' }}>كود الفكرة: <span dir="ltr">{row.ideaCode}</span></small>}</td>
        <td className="mkw-sp-readiness"><span><b style={{ width: `${Math.max(0, Math.min(100, row.readiness || 0))}%` }}/></span><small>{Math.round(row.readiness || 0)}%</small></td>
        <td>{row.approvedOn ? showDate(row.approvedOn) : <span className="mkw-muted">لم يُنفذ (التسليم {showDate(row.dueOn)})</span>}</td>
        <td>{showDate(row.publishOn)}</td>
        <td>{showDate(row.fundingOn)}</td>
      </tr>)}</tbody>
    </table>{!rows.length && <Empty>{query.loading ? W.loading : query.data && !query.data.ready ? 'حدّث قاعدة بيانات التسويق لعرض ربط الأجندة والحملة.' : W.noData}</Empty>}</div>
  </>;
}
