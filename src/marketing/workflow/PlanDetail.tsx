import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { W, Empty, WorkAlert } from './components';
import { parseReviewNote } from '../../../shared/marketing-review-note-format';
import { showDate, useWorkQuery, workPost, type WorkMeta } from './api';
import { availablePlanPostTypes } from './planComposer';
import { PlanStatusBadges, planStateLabels } from './PlanStatus';
import { CampaignOverview } from './campaignOverview';
import { isWorkDate } from '../../../shared/marketing-workflow';
import type { WorkPlanLine, WorkProduct } from '../../../shared/marketing-workflow';
import { ProductReference } from './ProductReference';
import { productChoiceGroups, productChoiceLabel } from './productChoice';
import { CampaignGoalPicker } from './CampaignGoals';
import type { CampaignGoalOption, CampaignPlatformGoals } from '../../../shared/marketing-campaign-goals';
import { campaignPlatformGoalRows } from '../../../shared/marketing-campaign-goals';

type PlanState = 'in_progress' | 'revision' | 'submitted' | 'publishing' | 'published';
type Plan = {
  id: string; plan_no: string; name: string; kind: 'agenda' | 'campaign'; created_by: string; creator_name?: string; created_at: string;
  review_status: PlanState; review_note: string; review_note_category_id?: string | null; review_revision: number; status: PlanState;
  readiness: number; canReview: boolean; canEditGoals?: boolean; platform_goals?: CampaignPlatformGoals[] | null; canEdit: boolean; canEditFunding?: boolean; canEditAgendaWindow?: boolean; canSaveLinks: boolean; funding_from?: string | null; funding_to?: string | null; agenda_from?: string | null; agenda_to?: string | null; activated_at?: string | null;
};
type PlanData = { plan: Plan; lines: WorkPlanLine[]; history: Array<{ action: string; note: string; actor_name: string; created_at: string; category_name: string }> };
type EditableLine = { id: string; date: string; productId: string; postTypeId: string; budget: string };
export function planStatusName(status: string) { return planStateLabels[status as PlanState] || status; }

export function PublicationTiming({ line }: { line: WorkPlanLine }) {
  if (!line.published_ready && line.publication_timing === 'overdue') return <span className="mkw-publish-timing is-late">متأخر ولم يُنشر</span>;
  if (!line.published_ready) return <span className="mkw-publish-timing is-pending">بانتظار النشر</span>;
  if (line.publication_timing === 'on_time') return <span className="mkw-publish-timing is-on-time">نشر في الموعد</span>;
  if (line.publication_timing === 'late') return <span className="mkw-publish-timing is-late">تأخر في النشر</span>;
  return <span className="mkw-publish-timing is-undated">تاريخ النشر غير مسجل</span>;
}

export function PlanDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged?: () => void }) {
  const query = useWorkQuery<PlanData>('plan', { id });
  const plan = query.data?.plan;
  const settings = useWorkQuery<{ categories: Array<{ id: string; name: string; is_active: boolean }> }>('evaluation_settings', {}, !!plan?.canReview);
  const productsQuery = useWorkQuery<{ rows: WorkProduct[] }>('products', {}, !!plan?.canEdit);
  const goalsQuery = useWorkQuery<{ goals: CampaignGoalOption[]; migrationRequired: boolean }>('campaign_goal_settings',{},!!plan?.canEditGoals);
  const metaQuery = useWorkQuery<WorkMeta>('meta', {}, !!plan?.canEdit);
  const [editing, setEditing] = useState(false), [rows, setRows] = useState<EditableLine[]>([]);
  const [goalEditing, setGoalEditing] = useState(false);
  const [goalSelection, setGoalSelection] = useState<Record<string,string[]>>({});
  const [fundingEditing, setFundingEditing] = useState(false);
  const [fundingFrom, setFundingFrom] = useState(''), [fundingTo, setFundingTo] = useState('');
  const [agendaEditing, setAgendaEditing] = useState(false);
  const [agendaFrom, setAgendaFrom] = useState(''), [agendaTo, setAgendaTo] = useState('');
  const [note, setNote] = useState(''), [noteType, setNoteType] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  useEffect(() => {
    if (query.data && !editing) setRows(query.data.lines.map(line => ({ id: line.id, date: String(line.scheduled_on).slice(0, 10), productId: line.product_id,
      postTypeId: line.post_type_id || '', budget: String(line.budget_amount || 0) })));
  }, [query.data, editing]);
  useEffect(() => {
    if (!query.data || fundingEditing) return;
    setFundingFrom(String(query.data.plan.funding_from || '').slice(0, 10));
    setFundingTo(String(query.data.plan.funding_to || '').slice(0, 10));
  }, [query.data, fundingEditing]);
  useEffect(() => {
    if (!query.data || agendaEditing) return;
    setAgendaFrom(String(query.data.plan.agenda_from || '').slice(0, 10));
    setAgendaTo(String(query.data.plan.agenda_to || '').slice(0, 10));
  }, [query.data, agendaEditing]);
  useEffect(() => {
    if (!plan || goalEditing) return;
    setGoalSelection(Object.fromEntries((plan.platform_goals || []).map(row=>[row.platformId,row.goals.map(goal=>goal.id)])));
  }, [query.data,goalEditing]);
  const campaignPlatformRows = campaignPlatformGoalRows(query.data?.lines || [],plan?.platform_goals);
  const availableGoalIds = new Set((goalsQuery.data?.goals || []).map(goal => goal.id));
  async function saveGoals() {
    if (!goalsQuery.data || goalsQuery.data.migrationRequired) { setError('حدّث أهداف الحملات من إعدادات التسويق أولًا.'); return; }
    // Old campaign snapshots keep names after goal catalog deletion. Only
    // currently active catalog options are selectable for a NEW review save.
    const currentGoals = campaignPlatformRows.map(row => ({ platformId: row.platformId,
      goalIds: (goalSelection[row.platformId] || []).filter(goalId => availableGoalIds.has(goalId)) }));
    if (currentGoals.some(platform => !platform.platformId || !platform.goalIds.length)) { setError('اختر هدفًا واحدًا على الأقل لكل منصة في الحملة.'); return; }
    const ok = await run('save_campaign_platform_goals',{planId:id,platformGoals:currentGoals});
    if (ok) setGoalEditing(false);
  }
  useEffect(() => { if (plan?.kind === 'campaign' && plan.review_status === 'revision' && plan.canEditFunding) setFundingEditing(true); }, [plan?.id, plan?.review_status, plan?.canEditFunding, plan?.kind]);
  useEffect(() => { if (plan?.kind === 'agenda' && plan.review_status === 'revision' && plan.canEditAgendaWindow) setAgendaEditing(true); }, [plan?.id, plan?.review_status, plan?.canEditAgendaWindow, plan?.kind]);
  async function saveFundingPeriod() {
    if (!isWorkDate(fundingFrom) || (fundingTo && (!isWorkDate(fundingTo) || fundingFrom > fundingTo))) {
      setError('حدد تاريخ التمويل من، والنهاية اختيارية بشرط ألا تكون قبل البداية.'); return;
    }
    const ok = await run('update_plan_funding', { planId: id, fundingFrom, fundingTo });
    if (ok) setFundingEditing(false);
  }
  async function saveAgendaWindow() {
    if (!isWorkDate(agendaFrom) || !isWorkDate(agendaTo) || agendaFrom > agendaTo) {
      setError('حدد بداية ونهاية نشر الأجندة، ويجب ألا تسبق النهاية البداية.'); return;
    }
    const ok = await run('update_plan_agenda_window', { planId: id, agendaFrom, agendaTo });
    if (ok) setAgendaEditing(false);
  }
  async function run(action: string, payload: Record<string, unknown>): Promise<boolean> {
    if (busy) return false;
    setBusy(true); setError(''); setMessage('');
    try {
      await workPost(action, payload);
      await query.reload(); onChanged?.();
      setMessage(action === 'update_plan' ? 'تم حفظ التعديلات وإرسالها للمراجعة تلقائيًا' : 'تم الحفظ بنجاح');
      return true;
    } catch (failure) { setError(failure instanceof Error ? failure.message : W.invalid); return false; }
    finally { setBusy(false); }
  }
  async function review(decision: 'revision' | 'submitted' | 'approved') {
    if (decision === 'revision' && !note.trim()) { setError('اكتب ملاحظة التعديل أولًا'); return; }
    const ok = await run('plan_review', {
      planId: id, decision, note: decision === 'revision' ? note.trim() : '',
      categoryId: decision === 'revision' ? settings.data?.categories.find(item => item.is_active && item.name.trim() === noteType.trim())?.id : undefined,
      categoryName: decision === 'revision' ? noteType.trim() : undefined,
    });
    if (ok) { setNote(''); setNoteType(''); }
  }
  const products = productsQuery.data?.rows || [], meta = metaQuery.data;
  const productGroups = productChoiceGroups(products);
  function changeRow(index: number, patch: Partial<EditableLine>) { setRows(old => old.map((row, i) => i === index ? { ...row, ...patch } : row)); }
  function addRow() { setRows(old => [...old, { id: '', date: '', productId: '', postTypeId: '', budget: '0' }]); }

  return <Modal open title={`تفاصيل ومراجعة${plan ? ` — ${plan.name}` : ''}`} onClose={onClose} className="mkw-fullscreen mkw-plan-review-modal"><div className="mkw mkw-plan-review">
    <WorkAlert>{query.error || error}</WorkAlert><WorkAlert success>{message}</WorkAlert>
    {!query.data ? <Empty>{query.loading ? W.loading : W.noData}</Empty> : <>
      <div className="mkw-section-title"><strong>{plan!.plan_no} · {plan!.kind === 'agenda' ? 'أجندة' : 'حملة'}</strong><PlanStatusBadges kind={plan!.kind} reviewStatus={plan!.review_status} publishedCount={query.data.lines.filter(line => line.published_ready).length} totalCount={query.data.lines.length}/></div>
      <div className="mkw-summary"><div><small>منشئ {plan!.kind === 'agenda' ? 'الأجندة' : 'الحملة'}</small><strong>{plan!.creator_name?.trim() || '—'}</strong></div><div><small>تاريخ الإنشاء</small><strong>{showDate(plan!.created_at)}</strong></div><div><small>عدد المنشورات</small><strong>{query.data.lines.length}</strong></div><div><small>حالة المراجعة</small><strong>{planStatusName(plan!.review_status)}</strong></div>{plan!.kind === 'campaign' && <div><small>إجمالي الميزانية (ر.س)</small><strong>{query.data.lines.reduce((sum, line) => sum + Number(line.budget_amount || 0), 0).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2 })}</strong></div>}</div>
      {plan!.kind === 'campaign' && <>
        <CampaignOverview lines={query.data.lines} fundingFrom={plan!.funding_from} fundingTo={plan!.funding_to} platformGoals={plan!.platform_goals}/> 
        {plan!.canEditGoals && <section className="mkw-panel mkw-campaign-goals-review">
          <header className="mkw-section-title"><div><h3>تحديد أهداف منصات الحملة</h3><p className="mkw-muted">المراجع المعتمد يقدر يضيف أهداف الحملة الحالية أو يعدّلها دون تغيير حالتها أو ميزانياتها.</p></div><button type="button" className="secondary" disabled={busy} onClick={()=>setGoalEditing(value=>!value)}>{goalEditing ? 'إلغاء' : 'اختيار المنصات والأهداف'}</button></header>
          {goalEditing && <><WorkAlert>{goalsQuery.error}</WorkAlert>
            {goalsQuery.data?.migrationRequired && <p className="mkw-muted">يلزم تحديث جدول أهداف الحملات من الداش بورد أولًا.</p>}
            <div className="mkw-campaign-goal-picker-grid">{campaignPlatformRows.map(row=><CampaignGoalPicker key={row.platformId || row.platformName} platformName={row.platformName} goals={goalsQuery.data?.goals || []}
              selectedIds={(goalSelection[row.platformId] || []).filter(goalId => availableGoalIds.has(goalId))} onChange={goalIds=>setGoalSelection(current=>({...current,[row.platformId]:goalIds}))} disabled={busy || !goalsQuery.data || goalsQuery.data.migrationRequired}/>)}</div>
            <button type="button" className="primary" disabled={busy || !goalsQuery.data || goalsQuery.data.migrationRequired} onClick={()=>void saveGoals()}>حفظ أهداف الحملة</button>
          </>}
        </section>}
        {!!plan!.canEditFunding && <section className="mkw-campaign-funding-edit">
          <div className="mkw-section-title"><strong>فترة تمويل الحملة</strong><button type="button" className="secondary" disabled={busy} onClick={() => setFundingEditing(open => !open)}>{fundingEditing ? 'إلغاء تعديل فترة التمويل' : 'تعديل فترة التمويل'}</button></div>
          {fundingEditing && <div className="mkw-campaign-funding-fields">
            <label>تاريخ التمويل من<input aria-label="تعديل تاريخ التمويل من" type="date" value={fundingFrom} disabled={busy} onChange={event => setFundingFrom(event.target.value)}/></label>
            <label>تاريخ التمويل إلى<input aria-label="تعديل تاريخ التمويل إلى" type="date" min={fundingFrom || undefined} value={fundingTo} disabled={busy} onChange={event => setFundingTo(event.target.value)}/></label>
            <button type="button" className="primary" disabled={busy} onClick={() => void saveFundingPeriod()}>{plan!.review_status==='revision'?'\u062d\u0641\u0638 \u0641\u062a\u0631\u0629 \u0627\u0644\u062a\u0645\u0648\u064a\u0644 \u0648\u0625\u0631\u0633\u0627\u0644\u0647\u0627 \u0644\u0644\u0645\u0631\u0627\u062c\u0639\u0629':'\u062d\u0641\u0638 \u0641\u062a\u0631\u0629 \u0627\u0644\u062a\u0645\u0648\u064a\u0644'}</button>
          </div>}
        </section>}
      </>}
      {plan!.kind === 'agenda' && <>
        <section className="mkw-agenda-window-overview mkw-summary" aria-label="فترة نشر الأجندة">
          <div><small>تاريخ نشر الأجندة من</small><strong>{showDate(plan!.agenda_from)}</strong></div>
          <div><small>تاريخ نشر الأجندة إلى</small><strong>{showDate(plan!.agenda_to)}</strong></div>
        </section>
        {!!plan!.canEditAgendaWindow && <section className="mkw-campaign-funding-edit">
          <div className="mkw-section-title"><strong>فترة نشر الأجندة</strong><button type="button" className="secondary" disabled={busy} onClick={() => setAgendaEditing(open => !open)}>{agendaEditing ? 'إلغاء تعديل فترة نشر الأجندة' : 'تعديل فترة نشر الأجندة'}</button></div>
          {agendaEditing && <div className="mkw-campaign-funding-fields">
            <label>تاريخ نشر الأجندة من<input aria-label="تعديل تاريخ نشر الأجندة من" type="date" value={agendaFrom} disabled={busy} onChange={event => setAgendaFrom(event.target.value)}/></label>
            <label>تاريخ نشر الأجندة إلى<input aria-label="تعديل تاريخ نشر الأجندة إلى" type="date" min={agendaFrom || undefined} value={agendaTo} disabled={busy} onChange={event => setAgendaTo(event.target.value)}/></label>
            <button type="button" className="primary" disabled={busy} onClick={() => void saveAgendaWindow()}>{plan!.review_status === 'revision' ? 'حفظ فترة الأجندة وإرسالها للمراجعة' : 'حفظ فترة نشر الأجندة'}</button>
          </div>}
        </section>}
      </>}
      <div className="mkw-plan-progress"><span>جاهزية النشر: {plan!.readiness}% · {query.data.lines.filter(line => line.published_ready).length} من {query.data.lines.length} روابط نشر</span><progress max={100} value={plan!.readiness}/></div>
      {plan!.review_status === 'revision' && <section className="mkw-plan-review-note"><strong>مطلوب تعديل</strong><p>{plan!.review_note}</p></section>}
      {plan!.canReview && ['in_progress', 'submitted'].includes(plan!.review_status) && <section className="mkw-plan-review-actions"><label>نوع الملاحظة (اختياري)<input type="text" list="mkw-plan-note-types" maxLength={100} value={noteType} onChange={e => setNoteType(e.target.value)} placeholder="عام — أو اكتب نوع الملاحظة بحرية"/><datalist id="mkw-plan-note-types">{(settings.data?.categories || []).filter(category => category.is_active).map(category => <option key={category.id} value={category.name}/>)}</datalist></label>
        <label>ملاحظة التعديل<div className="mkw-actions"><button type="button" className="secondary" onClick={() => setNote(old => `${old}**نص مهم**`)}>غامق</button><button type="button" className="secondary" onClick={() => setNote(old => `${old}\n• نقطة تعديل`)}>نقطة</button></div><textarea value={note} maxLength={10000} onChange={e => setNote(e.target.value)} placeholder="اكتب المطلوب تعديله في المنتجات أو الجدول أو فترة التمويل" /></label>
        <div className="mkw-actions">
        <button type="button" className="secondary" disabled={busy || !note.trim()} onClick={() => void review('revision')}>
          {'\u0625\u0631\u0633\u0627\u0644 \u0637\u0644\u0628 \u0627\u0644\u062a\u0639\u062f\u064a\u0644 \u0644\u0645\u0646\u0634\u0626 \u0627\u0644\u062d\u0645\u0644\u0629 \u0623\u0648 \u0627\u0644\u0623\u062c\u0646\u062f\u0629'}
        </button>
        <button type="button" className="primary" disabled={busy || editing} onClick={() => void review('approved')}>اعتماد {plan!.kind === 'campaign' ? 'الحملة' : 'الأجندة'} — جاهزة للنشر</button>
      </div></section>}
      {plan!.created_by && plan!.canEdit && <div className="mkw-actions">
        <button type="button" className="secondary" disabled={busy} onClick={() => setEditing(current => !current)}>{editing ? 'إلغاء تعديل المنتجات' : 'تعديل المنتجات والجدول'}</button>
        {plan!.review_status === 'in_progress' && <button type="button" className="primary" disabled={busy || editing} onClick={() => void review('submitted')}>إرسال للمراجعة</button>}
      </div>}
      {!!query.data.history.length && <details className="mkw-plan-history" open={editing || plan!.review_status === 'revision'}><summary>سجل المراجعات والملاحظات السابقة ({query.data.history.length})</summary>{query.data.history.map((entry, index) => <article key={index}><strong>{planStatusName(entry.action === 'approved' ? 'publishing' : entry.action === 'revision' ? 'revision' : 'submitted')} — {entry.actor_name}</strong><small>{showDate(entry.created_at, true)}</small>{entry.category_name && <small>نوع الملاحظة: {entry.category_name}</small>}{entry.note && <div className="mkw-review-document">{parseReviewNote(entry.note).map((block, i) => <p key={i}>{block.text}</p>)}</div>}</article>)}</details>}
      {editing && plan!.canEdit ? <section className="mkw-plan-edit-lines"><div className="mkw-table-wrap"><table><thead><tr><th>التاريخ</th><th>المنتج</th><th>الفكرة (فكرة المطلوب)</th><th>المنصة ونوع النشر</th>{plan!.kind === 'campaign' && <th>الميزانية</th>}<th>حذف</th></tr></thead><tbody>
        {rows.map((row, index) => { const product = products.find(item => item.id === row.productId); const types = meta?.postTypes.filter(type => product && availablePlanPostTypes(meta.postTypes, product.media_kind, type.platform_id).some(format => format.id === type.id)) || [];
          return <tr key={row.id || `new-${index}`}><td><input type="date" value={row.date} onChange={e => changeRow(index, { date: e.target.value })} /></td>
          <td><select value={row.productId} onChange={e => changeRow(index, { productId: e.target.value, postTypeId: '' })}><option value="">اختر المنتج</option>{productGroups.map(group => <optgroup key={group.title} label={group.title}>{group.rows.map(item => <option key={item.id} value={item.id}>{productChoiceLabel(item)}</option>)}</optgroup>)}</select></td>
          <td className="mkw-plan-idea-cell">{product?.idea || '—'}</td>
          <td><select value={row.postTypeId} onChange={e => changeRow(index, { postTypeId: e.target.value })}><option value="">اختر نوع النشر</option>{types.map(type => <option key={type.id} value={type.id}>{meta?.platforms.find(p => p.id === type.platform_id)?.name} — {type.name}</option>)}</select></td>
          {plan!.kind === 'campaign' && <td><input type="number" min="0" step="0.01" value={row.budget} onChange={e => changeRow(index, { budget: e.target.value })} /></td>}
          <td><button type="button" className="secondary" disabled={rows.length === 1} onClick={() => setRows(old => old.filter((_, i) => i !== index))}>حذف</button></td></tr>;
        })}</tbody></table></div><div className="mkw-actions"><button type="button" className="secondary" disabled={rows.length >= 500} onClick={addRow}>إضافة منتج</button><button type="button" className="primary" disabled={busy || !rows.length || rows.some(row => !row.date || !row.productId || !row.postTypeId)} onClick={() => void run('update_plan', { planId: id, entries: rows.map(row => ({ ...row, budget: Number(row.budget) })) }).then(ok => { if (ok) setEditing(false); })}>حفظ التعديلات وإرسالها للمراجعة</button></div></section> : null}
      <section className="mkw-plan-review-table"><h3>الجدول الكامل للمراجعة — المنتجات والفكرة والمنصات والميزانية</h3>
      <div className="mkw-table-wrap"><table><thead><tr><th>{plan!.kind === 'agenda' ? W.publishDate : 'تاريخ النشر المخطط'}</th><th>تاريخ النشر الفعلي</th><th>المنتج</th><th>الفكرة (فكرة المطلوب)</th><th>المنصة</th><th>نوع النشر</th>{plan!.kind === 'campaign' && <th>الميزانية (ر.س)</th>}<th>الالتزام بالموعد</th><th>الحالة</th><th>رابط المنشور</th></tr></thead><tbody>{query.data.lines.map(line => <tr key={line.id}>
        <td>{showDate(line.scheduled_on)}</td><td>{showDate(line.published_on)}</td><td><ProductReference title={line.idea_name} details={line}/></td><td className="mkw-plan-idea-cell">{line.product_idea || '—'}</td><td>{line.platform_name || '—'}</td><td>{line.post_type_name || '—'}</td>{plan!.kind === 'campaign' && <td className="mkw-budget-value">{Number(line.budget_amount || 0).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2 })}</td>}<td><PublicationTiming line={line} /></td><td>{line.published_ready ? 'تم النشر' : planStatusName(plan!.status)}</td>
        <td>{line.effective_post_url ? <a href={line.effective_post_url} target="_blank" rel="noopener noreferrer">فتح المنشور</a> : 'لم يُنشر بعد'}</td>
      </tr>)}</tbody></table></div></section>
    </>}
  </div></Modal>;
}
