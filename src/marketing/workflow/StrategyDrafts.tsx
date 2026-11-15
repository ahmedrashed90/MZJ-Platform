import { useEffect, useMemo, useState } from 'react';
import { CalendarBlank, CheckCircle, FolderOpen, LinkSimple, PaperPlaneTilt, Trash, WarningCircle } from '@phosphor-icons/react';
import { Modal } from '../../components/Modal';
import { Empty, Readiness, W, WorkAlert } from './components';
import { showDate, useWorkQuery, workPost } from './api';
import { CampaignGoalPicker } from './CampaignGoals';
import { marketingFetch, marketingQuery } from '../api';
import type { CampaignGoalOption } from '../../../shared/marketing-campaign-goals';
import type { CampaignReportPayload, CampaignReportRow } from '../../../shared/campaign-report';
import type { WorkPlanLine } from '../../../shared/marketing-workflow';
import './strategyDrafts.css';

/** Strategy flow (second flow). Native agenda/campaign screens are unchanged;
 * these components only render drafts created from «إنشاء التكليفات». */
import { StrategyProductsTable, type StrategyDraft, type StrategyDraftIdea } from './StrategyProductsTable';
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
        <span className="mkw-code">{draft.planNo}</span>
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
        <div className="mkw-section-title"><div><span className="mkw-code">{draft.planNo}</span><strong>مسودة {kindName(draft.kind)} · {draft.name}</strong></div><span className="mkw-strategy-draft-badge">مسودة</span></div>
        <StrategyProductsTable draft={draft}/>
      </>}
    </div>
  </Modal>;
}

type EntryForm = { scheduledOn: string; fundingOn: string; platforms: Record<string, Record<string, string>> };
function formFromIdea(idea: StrategyDraftIdea): EntryForm {
  const platforms: EntryForm['platforms'] = {};
  for (const platform of idea.platforms) platforms[platform.platformId] = Object.fromEntries(platform.postTypes.map(type => [type.postTypeId, String(type.budget ?? '')]));
  return { scheduledOn: idea.scheduledOn || idea.publishOn || idea.fundingOn || '', fundingOn: idea.fundingOn || '', platforms };
}

/** Inside view: ideas list → platforms, publish type and date (campaign: budget,
 * goals). «إرسال للمراجعة» opens the native review flow. */
export function StrategyDraftEditor({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const query = useWorkQuery<{ draft: StrategyDraft }>('strategy_draft', { id });
  const draft = query.data?.draft;
  const goalsQuery = useWorkQuery<{ goals: CampaignGoalOption[]; migrationRequired: boolean }>('campaign_goal_settings', {}, draft?.kind === 'campaign');
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState<EntryForm | null>(null);
  const [goals, setGoals] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const selected = draft?.ideas.find(idea => idea.id === selectedId) || null;
  useEffect(() => { if (selected) setForm(formFromIdea(selected)); }, [selected?.id, selected?.version]);
  useEffect(() => { if (draft) setGoals(Object.fromEntries(draft.platformGoals.map(row => [row.platformId, row.goalIds]))); }, [draft?.id, JSON.stringify(draft?.platformGoals)]);
  const platformGroups = useMemo(() => {
    const map = new Map<string, { platformId: string; platformName: string; formats: StrategyDraftIdea['formats'] }>();
    for (const format of selected?.formats || []) {
      const row = map.get(format.platformId) || { platformId: format.platformId, platformName: format.platformName, formats: [] };
      row.formats.push(format); map.set(format.platformId, row);
    }
    return [...map.values()];
  }, [selected?.id, selected?.version]);
  const usedPlatforms = draft?.platforms || [];
  const goalsMissing = draft?.kind === 'campaign' && usedPlatforms.some(platform => !(draft.platformGoals.find(row => row.platformId === platform.platformId)?.goalIds.length));
  const allReady = Boolean(draft && draft.ideas.length && draft.ideas.every(idea => idea.ready) && !goalsMissing);

  async function run(action: string, body: Record<string, unknown>, done: string) {
    if (busy) return false;
    setBusy(true); setError(''); setMessage('');
    try { await workPost(action, body); await query.reload(); onChanged(); setMessage(done); return true; }
    catch (failure) { setError(failure instanceof Error ? failure.message : W.invalid); return false; }
    finally { setBusy(false); }
  }
  function togglePlatform(platformId: string, checked: boolean) {
    setForm(current => { if (!current) return current; const platforms = { ...current.platforms };
      if (checked) platforms[platformId] = platforms[platformId] || {}; else delete platforms[platformId];
      return { ...current, platforms }; });
  }
  function toggleType(platformId: string, postTypeId: string, checked: boolean) {
    setForm(current => { if (!current) return current; const types = { ...(current.platforms[platformId] || {}) };
      if (checked) types[postTypeId] = types[postTypeId] ?? ''; else delete types[postTypeId];
      return { ...current, platforms: { ...current.platforms, [platformId]: types } }; });
  }
  function setBudget(platformId: string, postTypeId: string, value: string) {
    setForm(current => current ? { ...current, platforms: { ...current.platforms, [platformId]: { ...current.platforms[platformId], [postTypeId]: value } } } : current);
  }
  async function saveIdea() {
    if (!selected || !form || !draft) return;
    const platforms = Object.entries(form.platforms).map(([platformId, types]) => ({ platformId,
      postTypes: Object.entries(types).map(([postTypeId, budget]) => ({ postTypeId, budget: draft.kind === 'campaign' ? budget : 0 })) }));
    if (platforms.some(platform => !platform.postTypes.length)) { setError('اختر نوع نشر واحدًا على الأقل لكل منصة محددة'); return; }
    await run('strategy_save_entry', { draftId: draft.id, entryId: selected.id, version: selected.version,
      scheduledOn: form.scheduledOn, ...(draft.kind === 'campaign' ? { fundingOn: form.fundingOn } : {}), platforms }, 'تم حفظ إعداد الفكرة');
  }

  return <Modal open title={draft ? `مسودة ${kindName(draft.kind)} — ${draft.name}` : 'المسودة'} onClose={onClose} className="mkw-fullscreen mkw-strategy-draft-modal">
    <div className="mkw mkw-strategy-draft-editor">
      <WorkAlert>{query.error || error}</WorkAlert><WorkAlert success>{message}</WorkAlert>
      {!draft ? <Empty>{query.loading ? W.loading : W.noData}</Empty> : <>
        <div className="mkw-summary">
          <div><small>كود المسودة</small><strong dir="ltr">{draft.planNo}</strong></div>
          <div><small>الحالة</small><strong>مسودة</strong></div>
          <div><small>عدد الأفكار</small><strong>{draft.ideaCount}</strong></div>
          <div><small>جاهز للإرسال</small><strong>{draft.readyCount} / {draft.productCount}</strong></div>
          <div><small>{draft.kind === 'agenda' ? 'فترة نشر الأجندة' : 'فترة التمويل'}</small><strong>{period(draft.periodFrom, draft.periodTo)}</strong></div>
        </div>
        <div className="mkw-strategy-draft-layout">
          <aside className="mkw-strategy-draft-ideas" aria-label="أفكار المسودة">
            <h3>الأفكار ونوعها</h3>
            {draft.ideas.map(idea => <button type="button" key={idea.id} className={`mkw-strategy-draft-idea ${idea.id === selectedId ? 'is-active' : ''} ${idea.ready ? 'is-ready' : 'is-incomplete'}`} onClick={() => setSelectedId(idea.id)}>
              <strong>{idea.ideaName}</strong>
              <small>{mediaName(idea.mediaKind)} · {idea.category || 'بدون تصنيف'} · <span dir="ltr">{idea.assignmentNo}</span></small>
              <span className="mkw-strategy-draft-idea-state">{idea.ready ? <><CheckCircle size={15} weight="fill"/>مكتملة</> : <><WarningCircle size={15} weight="fill"/>{idea.missing[0] || 'غير مكتملة'}</>}</span>
            </button>)}
            {!draft.ideas.length && <Empty>لا توجد أفكار</Empty>}
          </aside>
          <section className="mkw-strategy-draft-panel">
            {!selected || !form ? <Empty>اختر فكرة من القائمة لتحديد المنصة ونوع النشر والتاريخ.</Empty> : <>
              <header className="mkw-section-title"><div><strong>{selected.ideaName}</strong><small className="mkw-muted" style={{ display: 'block' }}>{mediaName(selected.mediaKind)} · {selected.taskNo} · المنفذ: {selected.assigneeName || '—'} · موعد التسليم: {showDate(selected.dueOn)}</small></div>
                <span className={`mkw-publish-timing ${selected.executed ? 'is-on-time' : 'is-pending'}`}>{selected.executed ? 'تم التنفيذ والاعتماد' : 'لم يتم التنفيذ بعد'}</span></header>
              {!!selected.missing.length && <ul className="mkw-strategy-draft-missing">{selected.missing.map(reason => <li key={reason}>{reason}</li>)}</ul>}
              <div className="mkw-strategy-draft-dates">
                <label className="mkw-field"><span>تاريخ النشر</span><input type="date" value={form.scheduledOn} disabled={!draft.canEdit || busy} onChange={event => setForm({ ...form, scheduledOn: event.target.value })}/></label>
                {draft.kind === 'campaign' && <label className="mkw-field"><span>تاريخ التمويل</span><input type="date" value={form.fundingOn} disabled={!draft.canEdit || busy} onChange={event => setForm({ ...form, fundingOn: event.target.value })}/></label>}
              </div>
              <div className="mkw-strategy-draft-platforms">
                {platformGroups.map(group => {
                  const checked = Boolean(form.platforms[group.platformId]);
                  return <fieldset key={group.platformId} className={checked ? 'is-checked' : ''}>
                    <legend><label className="mkw-checkbox"><input type="checkbox" disabled={!draft.canEdit || busy} checked={checked} onChange={event => togglePlatform(group.platformId, event.target.checked)}/>{group.platformName || 'منصة'}</label></legend>
                    {checked && group.formats.map(format => {
                      const typeChecked = form.platforms[group.platformId]?.[format.id] !== undefined;
                      return <div className="mkw-strategy-draft-type" key={format.id}>
                        <label className="mkw-checkbox"><input type="checkbox" disabled={!draft.canEdit || busy} checked={typeChecked} onChange={event => toggleType(group.platformId, format.id, event.target.checked)}/>{format.name}</label>
                        {draft.kind === 'campaign' && typeChecked && <label className="mkw-field mkw-strategy-draft-budget"><span>الميزانية (ر.س)</span><input type="number" min={0} step="0.01" inputMode="decimal" disabled={!draft.canEdit || busy}
                          value={form.platforms[group.platformId][format.id]} onChange={event => setBudget(group.platformId, format.id, event.target.value)}/></label>}
                      </div>;
                    })}
                  </fieldset>;
                })}
                {!platformGroups.length && <Empty>لا توجد مقاسات محددة لهذه الفكرة في التاسك.</Empty>}
              </div>
              {draft.canEdit && <div className="mkw-actions"><button type="button" className="primary" disabled={busy} onClick={() => void saveIdea()}>حفظ إعداد الفكرة</button></div>}
            </>}
          </section>
        </div>
        {draft.kind === 'campaign' && <section className="mkw-panel mkw-strategy-draft-goals">
          <header className="mkw-section-title"><div><h3>الهدف من الحملة — حسب المنصة</h3><p className="mkw-muted">تظهر المنصات بعد حفظ إعداد الأفكار.</p></div></header>
          <WorkAlert>{goalsQuery.data?.migrationRequired ? 'حدّث أهداف الحملات من إعدادات التسويق أولًا.' : goalsQuery.error}</WorkAlert>
          {usedPlatforms.map(platform => <CampaignGoalPicker key={platform.platformId} platformName={platform.name || 'منصة'} goals={goalsQuery.data?.goals || []}
            selectedIds={goals[platform.platformId] || []} disabled={!draft.canEdit || busy} onChange={next => setGoals(current => ({ ...current, [platform.platformId]: next }))}/>)}
          {!usedPlatforms.length && <Empty>لم تُحدد منصات بعد.</Empty>}
          {draft.canEdit && !!usedPlatforms.length && <div className="mkw-actions"><button type="button" className="secondary" disabled={busy}
            onClick={() => void run('strategy_save_draft', { draftId: draft.id, platformGoals: usedPlatforms.map(platform => ({ platformId: platform.platformId, goalIds: goals[platform.platformId] || [] })) }, 'تم حفظ أهداف الحملة')}>حفظ أهداف الحملة</button></div>}
        </section>}
        {draft.canEdit && <div className="mkw-strategy-draft-footer">
          <span className="mkw-muted">{allReady ? 'كل الأفكار مكتملة ويمكن الإرسال للمراجعة.' : `أكمل كل الأفكار${draft.kind === 'campaign' ? ' وأهداف الحملة' : ''} أولًا — تم ${draft.readyCount} من ${draft.productCount}.`}</span>
          <button type="button" className="danger secondary" disabled={busy} onClick={() => { if (window.confirm('حذف المسودة؟ لن يتم حذف التاسكات أو المنتجات.')) void run('strategy_delete_draft', { draftId: draft.id }, 'تم حذف المسودة').then(ok => { if (ok) onClose(); }); }}><Trash size={17}/>حذف المسودة</button>
          <button type="button" className="primary" disabled={busy || !allReady} onClick={() => void run('strategy_submit_draft', { draftId: draft.id }, 'تم الإرسال للمراجعة').then(ok => { if (ok) onClose(); })}><PaperPlaneTilt size={17}/>إرسال للمراجعة</button>
        </div>}
      </>}
    </div>
  </Modal>;
}

/** «تجهيز النشر» for strategy campaigns: choose the published campaign from
 * «تفاعل النشر — تقارير الحملات». The link day vs funding day decides
 * «نشر في الموعد» / «تأخر في النشر». */
export function StrategyCampaignLinkModal({ lines, onClose, onChanged }: { lines: WorkPlanLine[]; onClose: () => void; onChanged: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const earliest = lines.map(line => String(line.strategy_funding_on || line.scheduled_on || '').slice(0, 10)).filter(Boolean).sort()[0] || today;
  const from = new Date(Date.parse(`${earliest}T12:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
  const [report, setReport] = useState<CampaignReportPayload | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [search, setSearch] = useState(''), [selectedKey, setSelectedKey] = useState('');
  const [lineIds, setLineIds] = useState<string[]>(() => lines.filter(line => !line.strategy_campaign_link).map(line => line.id));
  useEffect(() => {
    let active = true;
    setLoading(true);
    marketingFetch<CampaignReportPayload>(`/api/marketing${marketingQuery({ resource: 'campaign_report', dateFrom: from < today ? from : today, dateTo: today })}`)
      .then(result => { if (active) setReport(result); })
      .catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'تعذر قراءة تقارير الحملات'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [from, today]);
  const term = search.trim().toLocaleLowerCase();
  const rows: CampaignReportRow[] = (report?.rows || []).filter(row => !term || `${row.campaignName} ${row.accountName} ${row.platformName}`.toLocaleLowerCase().includes(term));
  const selected = (report?.rows || []).find(row => row.key === selectedKey) || null;
  async function save() {
    if (!selected || !lineIds.length || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await workPost('strategy_link_campaign', { planId: lines[0].plan_id, lineIds, platform: selected.platform, accountId: selected.accountId,
        campaignId: selected.campaignId, campaignName: selected.campaignName });
      setMessage('تم ربط الحملة بتقارير الحملات'); onChanged();
    } catch (failure) { setError(failure instanceof Error ? failure.message : W.invalid); }
    finally { setBusy(false); }
  }
  return <Modal open level={1} title="ربط الحملة بتقارير الحملات" onClose={onClose} className="mkw-fullscreen mkw-strategy-link-modal">
    <div className="mkw mkw-strategy-link">
      <WorkAlert>{error}</WorkAlert><WorkAlert success>{message}</WorkAlert>
      <p className="mkw-muted">اختر الحملة المنشورة من «تفاعل النشر — تقارير الحملات». يوم الربط يُقارن بتاريخ التمويل: في نفس اليوم أو قبله = نشر في الموعد، بعده = تأخر في النشر.</p>
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
        {!rows.length && <Empty>لا توجد حملات في تقارير الحملات للفترة {showDate(from)} — {showDate(today)}.</Empty>}
      </div>}
      <div className="mkw-actions"><button type="button" className="primary" disabled={busy || !selected || !lineIds.length} onClick={() => void save()}><LinkSimple size={17}/>ربط {lineIds.length} منشور بالحملة المختارة</button></div>
    </div>
  </Modal>;
}

type StrategyProductRow = {
  serial: number; itemId: string; ideaCode: string; createdAt: string; category: string; taskName: string; mediaKind: 'image' | 'video';
  itemStatus: string; assignmentNo: string; taskNo: string; orderNo: string; orderName: string; orderKind: string; orderStatus: string;
  assigneeName: string; ideaName: string; dueOn: string | null; approvedOn: string | null; publishOn: string | null; fundingOn: string | null;
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
        <tr><th rowSpan={2}>م</th><th rowSpan={2}>تاريخ الإنشاء</th><th colSpan={7}>البيان</th><th colSpan={3}>التراكينج</th></tr>
        <tr><th>التصنيف</th><th>المطلوب</th><th>رقم التكليف</th><th>رقم التاسك</th><th>رقم الطلب</th><th>اسم المنفذ</th><th>اسم الفكرة</th><th>تاريخ التنفيذ</th><th>تاريخ النشر</th><th>تاريخ التمويل</th></tr>
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
        <td>{row.approvedOn ? showDate(row.approvedOn) : <span className="mkw-muted">لم يُنفذ (التسليم {showDate(row.dueOn)})</span>}</td>
        <td>{showDate(row.publishOn)}</td>
        <td>{showDate(row.fundingOn)}</td>
      </tr>)}</tbody>
    </table>{!rows.length && <Empty>{query.loading ? W.loading : query.data && !query.data.ready ? 'حدّث قاعدة بيانات التسويق لعرض ربط الأجندة والحملة.' : W.noData}</Empty>}</div>
  </>;
}
