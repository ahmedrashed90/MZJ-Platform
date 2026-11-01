import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CaretDown, CaretLeft, ClipboardText, Eye, PaperPlaneTilt, Plus, CalendarBlank, Gear, CheckCircle } from '@phosphor-icons/react';
import { Modal } from '../../components/Modal';
import { W, Empty, Readiness, Search, WorkAlert, WorkHeader } from '../workflow/components';
import { showDate, showRange, useWorkQuery, workPost } from '../workflow/api';
import { TaskDetail } from '../workflow/TaskDetail';
import { DeleteTaskButton } from '../workflow/DeleteTaskButton';
import { PreparationModal } from '../workflow/PublishPage';
import { PlanDetail, planStatusName } from '../workflow/PlanDetail';
import { PlanReport } from '../workflow/PlanReport';
import { summarizePublishingDays } from '../workflow/publishingDaySummary';
import { workPlatformSupportsAutoPublish } from '../../../shared/marketing-workflow';
import type { WorkCapabilities, WorkPlanLine, WorkTask } from '../../../shared/marketing-workflow';

type ReviewState = 'in_progress' | 'revision' | 'submitted' | 'publishing' | 'published';

function planVisualState(group: WorkPlanLine[]): ReviewState {
  const reviewStatus = (group[0].review_status || 'in_progress') as ReviewState;
  const published = group.every(line => line.published_ready);
  return (published && reviewStatus === 'publishing') ? 'published' : reviewStatus;
}

function scheduleRange(group: WorkPlanLine[]) {
  const dates = group.map(line => String(line.scheduled_on || '').slice(0, 10)).filter(Boolean).sort();
  if (!dates.length) return '—';
  return dates[0] === dates[dates.length - 1] ? showDate(dates[0]) : `${showDate(dates[0])} ← ${showDate(dates[dates.length - 1])}`;
}

function uniqueValues(values: Array<string | null | undefined>) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

export function MarketingDashboardPage() {
  const [params, setParams] = useSearchParams(), [search, setSearch] = useState('');
  const [deliveryFilter, setDeliveryFilter] = useState<'' | 'on_time' | 'late'>('');
  const [tableId, setTableId] = useState('');
  const [selectPlan, setSelectPlan] = useState(''), [prepareId, setPrepareId] = useState('');
  const [publishingOpen, setPublishingOpen] = useState(true);
  const [expandedPlanIds, setExpandedPlanIds] = useState<Set<string>>(() => new Set());
  function togglePlanProducts(id: string) {
    setExpandedPlanIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const [activationBusy, setActivationBusy] = useState(''), [activationError, setActivationError] = useState(''), [activationMessage, setActivationMessage] = useState('');
  const query = useWorkQuery<{ tasks: WorkTask[]; lines: WorkPlanLine[]; capabilities: WorkCapabilities }>('dashboard');
  const schema = useWorkQuery<{ ready: boolean; baseReady: boolean; performanceReady: boolean; publishSettingsReady?: boolean; canUpgrade: boolean }>('schema_status');
  const publishSettings = useWorkQuery<{ enabled: boolean }>('publish_button_settings');
  const [schemaUpgrading, setSchemaUpgrading] = useState(false), [schemaError, setSchemaError] = useState('');

  async function upgradeSchema() {
    if (schemaUpgrading || !schema.data?.canUpgrade) return;
    setSchemaUpgrading(true); setSchemaError('');
    try {
      const upgraded = await workPost<{ ready: boolean }>('upgrade_schema', {});
      if (!upgraded.ready) throw new Error('لم تكتمل تهيئة قاعدة بيانات التسويق');
      await schema.reload();
      await publishSettings.reload();
      await query.reload();
    } catch (error) {
      setSchemaError(error instanceof Error ? error.message : W.invalid);
    } finally {
      setSchemaUpgrading(false);
    }
  }

  const taskId = params.get('task') || '';
  const planId = params.get('plan') || '';
  const term = search.trim().toLocaleLowerCase();
  const tasks = (query.data?.tasks || []).filter(task => `${task.name} ${task.task_no} ${task.type_name}`.toLocaleLowerCase().includes(term));
  const lines = (query.data?.lines || []).filter(line => `${line.name} ${line.plan_no} ${line.idea_name} ${line.product_idea || ''} ${line.task_name}`.toLocaleLowerCase().includes(term));
  const groups = new Map<string, WorkPlanLine[]>();
  for (const line of lines) groups.set(line.plan_id, [...(groups.get(line.plan_id) || []), line]);

  function openTask(id: string, filter: '' | 'on_time' | 'late' = '') { setDeliveryFilter(filter); setParams({ task: id }); }
  function openPreparation(group: WorkPlanLine[]) { if (group.length === 1) setPrepareId(group[0].id); else setSelectPlan(group[0].plan_id); }
  async function activatePlan(group: WorkPlanLine[]) {
    if (activationBusy || !window.confirm('تفعيل النشر حسب التواريخ والمنصات وأنواع النشر المحددة في الجدول؟')) return;
    setActivationBusy(group[0].plan_id); setActivationError(''); setActivationMessage('');
    try {
      const response = await workPost<{ message?: string }>('activate_plan', { planId: group[0].plan_id });
      setActivationMessage(response.message || 'تم تفعيل النشر');
      await query.reload();
    } catch (error) {
      setActivationError(error instanceof Error ? error.message : W.invalid);
    } finally {
      setActivationBusy('');
    }
  }

  const chooserLines = groups.get(selectPlan) || [];
  const chooserIsCampaign = chooserLines[0]?.kind === 'campaign';

  return <div className="mkw mkw-dashboard"><WorkHeader title={W.dashboard} onRefresh={() => void query.reload()} loading={query.loading}>{query.data?.capabilities.createTask && <Link className="mkw-link-button" to="/marketing/create"><Plus size={17}/>{W.createTask}</Link>}</WorkHeader><WorkAlert>{query.error || activationError || schemaError}</WorkAlert><WorkAlert success>{activationMessage}</WorkAlert>
    {schema.data && !schema.data.ready && <div className="mkw-schema-upgrade" role="alert">
      <span>{schema.data.baseReady ? 'تحتاج قاعدة بيانات التسويق إلى تحديث الجداول حتى تظهر بيانات التنفيذ والنشر الحالية.' : 'قاعدة بيانات التسويق تحتاج إلى التهيئة الأساسية.'}</span>
      {schema.data.canUpgrade && <button type="button" className="primary" disabled={schemaUpgrading} onClick={() => void upgradeSchema()}>{schemaUpgrading ? 'جارٍ تحديث قاعدة البيانات...' : 'تحديث قاعدة بيانات التسويق'}</button>}
      {!schema.data.canUpgrade && <span>يرجى التواصل مع مدير النظام لتنفيذ التحديث.</span>}
    </div>}
    {schema.data?.ready && schema.data.publishSettingsReady === false && schema.data.canUpgrade && <div className="mkw-schema-upgrade" role="status"><span>يتوفر تحديث إعدادات التحكم في زر النشر التلقائي.</span><button type="button" className="secondary" disabled={schemaUpgrading} onClick={() => void upgradeSchema()}>تحديث إعدادات النشر</button></div>}
    {schema.data?.ready && !schema.data.performanceReady && schema.data.canUpgrade && <div className="mkw-schema-upgrade" role="status">
      <span>يتوفر تحسين لفهارس قاعدة بيانات التسويق لتسريع تحميل تفاصيل التاسكات والمراجعات.</span>
      <button type="button" className="secondary" disabled={schemaUpgrading} onClick={() => void upgradeSchema()}>{schemaUpgrading ? 'جارٍ تحسين قاعدة البيانات...' : 'تحسين سرعة تحميل التسويق'}</button>
    </div>}
    <div className="mkw-toolbar mkw-dashboard-search"><Search value={search} onChange={setSearch}/></div>
    <div className="mkw-board mkw-dashboard-board">
      <section className="mkw-column"><header><div className="mkw-column-title"><ClipboardText size={21}/><h2>{W.execution}</h2></div><span>{tasks.length}</span></header>
        <div className="mkw-column-body">{!tasks.length && <Empty>{query.loading ? W.loading : W.noData}</Empty>}
          {tasks.map(task => <article className="mkw-dashboard-task" key={task.id}>
            <div className="mkw-dashboard-task-heading"><div><span className="mkw-code">{task.task_no}</span><h3>{task.name}</h3></div><div className="mkw-dashboard-task-buttons"><button type="button" className="mkw-dashboard-view" aria-label={`${W.open} ${task.name}`} onClick={() => openTask(task.id)}><Eye size={20}/></button><DeleteTaskButton compact id={task.id} name={task.name} code={task.task_no} onDeleted={() => query.reload()}/></div></div>
            <div className="mkw-dashboard-stats"><div><small>{W.createdAt}</small><strong>{showDate(task.created_at)}</strong></div><div><small>{W.dueOn}</small><strong>{showRange(task.due_from, task.due_to)}</strong></div><div><small>{W.productCount}</small><strong>{task.product_count}</strong></div></div>
            <Readiness value={task.readiness}/>
            {((task.submitted_on_time_count ?? 0) > 0 || (task.submitted_late_count ?? 0) > 0) && <div className="mkw-delivery-summary" aria-label="مواعيد تسليم المطلوبات">
              {(task.submitted_on_time_count ?? 0) > 0 && <button type="button" className="mkw-delivery-summary-card is-on-time" onClick={() => openTask(task.id, 'on_time')}><span>{W.deliveryOnTime}</span><strong>{task.submitted_on_time_count}</strong></button>}
              {(task.submitted_late_count ?? 0) > 0 && <button type="button" className="mkw-delivery-summary-card is-late" onClick={() => openTask(task.id, 'late')}><span>{W.deliveryLate}</span><strong>{task.submitted_late_count}</strong></button>}
            </div>}
            <button type="button" className="mkw-dashboard-open" onClick={() => openTask(task.id)}>{W.open}<CaretLeft size={16}/></button>
          </article>)}
        </div>
      </section>

      <section className="mkw-column mkw-publishing-column">
        <header><button type="button" className="mkw-column-toggle" aria-expanded={publishingOpen} aria-controls="mkw-publishing-body" onClick={() => setPublishingOpen(open => !open)}>
          <div className="mkw-column-title"><PaperPlaneTilt size={21}/><h2>{W.publishingSection}</h2><CaretDown className={publishingOpen ? 'mkw-section-open' : ''} size={18}/></div>
          <span className="mkw-column-count">{groups.size}</span>
        </button></header>
        {publishingOpen && <div id="mkw-publishing-body" className="mkw-column-body mkw-publish-column-body">{!groups.size && <Empty>{query.loading ? W.loading : W.noData}</Empty>}
          {[...groups.entries()].map(([id, group]) => {
            const supported = group.every(line => workPlatformSupportsAutoPublish(line.platform_code));
            const prepared = group.every(line => line.prepared_count === 1 && !line.failed_count);
            const activated = !!group[0].activated_at;
            const visualStatus = planVisualState(group);
            const reviewStatus = (group[0].review_status || 'in_progress') as ReviewState;
            const readiness = Math.round(group.filter(line => line.published_ready).length * 100 / group.length);
            const readyLines = group.filter(line => line.published_ready).length;
            const preparedLines = group.filter(line => line.prepared_count === 1 && !line.failed_count).length;
            const platforms = uniqueValues(group.map(line => line.platform_name));
            const kinds = uniqueValues(group.map(line => line.post_type_name));
            const distinctProducts = new Set(group.map(line => line.product_id)).size;
            const days = summarizePublishingDays(group);
            const productsOpen = expandedPlanIds.has(id);
            return <article className={`mkw-dashboard-publish-card mkw-plan-${visualStatus}`} key={id}>
              <div className="mkw-dashboard-publish-card-head">
                <div className="mkw-dashboard-publish-head-main">
                  <span className="mkw-code">{group[0].plan_no}</span>
                  <h3><button
                    type="button"
                    className="mkw-dashboard-publish-title-button"
                    aria-expanded={productsOpen}
                    aria-controls={`mkw-publish-products-${id}`}
                    aria-label={`${productsOpen ? 'إخفاء' : 'عرض'} منتجات ${group[0].name}`}
                    onClick={() => togglePlanProducts(id)}
                  >{group[0].name}<CaretDown size={18} aria-hidden="true"/></button></h3>
                  <div className="mkw-dashboard-publish-meta-line">
                    <span className="mkw-kind-label">{group[0].kind === 'agenda' ? W.agenda : W.campaign}</span>
                    <span className="mkw-muted">{platforms.join(' • ') || '—'}</span>
                  </div>
                  <span className="mkw-muted">تاريخ الإنشاء: {showDate(group[0].plan_created_at)}</span>
                </div>
                {['publishing','published'].includes(reviewStatus) ? <button type="button" className="mkw-approved-plan-badge" onClick={() => setParams({ plan: id })} aria-label={`فتح تفاصيل ${group[0].kind === 'agenda' ? 'الأجندة' : 'الحملة'} المعتمدة`}><CheckCircle size={22} weight="fill"/>{group[0].kind === 'agenda' ? 'أجندة معتمدة' : 'حملة معتمدة'}</button>
                  : <strong className={`mkw-plan-state mkw-plan-state-${visualStatus}`}>{planStatusName(visualStatus)}</strong>}
              </div>

              <div className="mkw-dashboard-publish-stats">
                <div><small>{group[0].kind === 'agenda' ? W.publishDate : W.fundingDate}</small><strong>{scheduleRange(group)}</strong></div>
                <div><small>{W.productCount}</small><strong>{distinctProducts}</strong></div>
                <div><small>عدد المنصات</small><strong>{platforms.length}</strong></div>
                <div><small>أنواع النشر</small><strong>{kinds.length}</strong></div>
              </div>

              <div className="mkw-dashboard-publish-progress-wrap">
                <Readiness value={readiness} label="جاهزية النشر"/>
                <div className="mkw-dashboard-publish-quick-stats">
                  <span>تم التجهيز: <strong>{preparedLines}</strong> / {group.length}</span>
                  <span>تم النشر: <strong>{readyLines}</strong> / {group.length}</span>
                </div>
              </div>

              <div id={`mkw-publish-products-${id}`} className="mkw-dashboard-publish-preview" hidden={!productsOpen}>
                <div className="mkw-dashboard-publish-preview-head"><strong>مواعيد النشر</strong><span>{days.length} يوم · {distinctProducts} منتج · {group.length} منشور</span></div>
                <div className="mkw-dashboard-publish-preview-list">
                  {days.map(day => <article key={day.date} className="mkw-dashboard-preview-item mkw-dashboard-publish-day">
                    <div className="mkw-dashboard-preview-title"><strong><CalendarBlank size={17}/> {showDate(day.date)}</strong><span>{day.publicationCount} {day.publicationCount === 1 ? 'منشور' : 'منشورات'}</span></div>
                    <div className="mkw-dashboard-preview-subline"><span title={day.productNames.join('، ')}>{day.productNames.join('، ')}</span><span>{day.platformNames.join(' · ') || '—'}</span></div>
                    <div className="mkw-dashboard-publish-day-footer"><span>أنواع النشر: {day.postTypeNames.join('، ') || '—'}</span><strong>{day.publishedCount} / {day.publicationCount} تم النشر</strong></div>
                    <div className="mkw-dashboard-day-status">
                      {day.onTimeCount > 0 && <span className="mkw-publish-timing is-on-time">نشر في الموعد: {day.onTimeCount}</span>}
                      {day.lateCount > 0 && <span className="mkw-publish-timing is-late">تأخر في النشر: {day.lateCount}</span>}
                      {day.pendingCount > 0 && <span className="mkw-publish-timing is-pending">بانتظار النشر: {day.pendingCount}</span>}
                      {day.undatedCount > 0 && <span className="mkw-publish-timing is-undated">تاريخ النشر غير مسجل: {day.undatedCount}</span>}
                    </div>
                  </article>)}
                </div>
                <small className="mkw-dashboard-publish-detail-hint">تفاصيل كل منصة ونوع نشر متاحة داخل التقرير.</small>
              </div>

              <div className="mkw-dashboard-publish-tags">
                {prepared && <span className="mkw-dashboard-note-tag is-ready">تم تجهيز جميع المطلوبات</span>}
                {activated && <span className="mkw-dashboard-note-tag is-active"><CheckCircle size={14}/>تم تفعيل النشر</span>}
                {reviewStatus === 'revision' && <span className="mkw-dashboard-note-tag is-danger">يوجد طلب تعديل</span>}
              </div>

              <div className="mkw-dashboard-publish-actions">
                <button type="button" className="secondary" onClick={() => setTableId(id)}><CalendarBlank size={17}/>التقرير</button>
                {['in_progress','revision','submitted'].includes(reviewStatus) && <button type="button" className="secondary" onClick={() => setParams({ plan: id })}><Eye size={17}/>مراجعة واعتماد</button>}
                <button type="button" className="secondary" disabled={!query.data?.capabilities.prepare} onClick={() => openPreparation(group)}><Gear size={17}/>{W.prepare}</button>
                {publishSettings.data?.enabled && <button type="button" className="primary" disabled={!query.data?.capabilities.publish || !prepared || !supported || activated || Boolean(activationBusy) || reviewStatus !== 'publishing'} title={!supported ? 'المنصة لا تدعم النشر عبر الربط الحالي' : !prepared ? 'أكمل تجهيز النشر لكل منتج أولًا' : ''} onClick={() => void activatePlan(group)}><PaperPlaneTilt size={17}/>النشر</button>}
              </div>
            </article>;
          })}
        </div>}
      </section>
    </div>
    {taskId && <TaskDetail id={taskId} deliveryFilter={deliveryFilter} onClose={() => { setParams({}); setDeliveryFilter(''); }} onChanged={() => void query.reload()}/>}
    {planId && <PlanDetail id={planId} onClose={() => setParams({})} onChanged={() => void query.reload()}/>}    
    {tableId && <PlanReport id={tableId} onClose={() => setTableId('')}/>}    
    {selectPlan && <Modal open title={W.prepare} onClose={() => setSelectPlan('')} className="mkw-modal"><div className="mkw"><div className="mkw-table-wrap"><table><thead><tr><th>{W.selectProduct}</th><th>الفكرة (فكرة المطلوب)</th><th>{chooserIsCampaign ? W.fundingDate : W.publishDate}</th><th>المنصة</th><th>نوع النشر</th>{chooserIsCampaign && <th>الميزانية (ر.س)</th>}<th>حالة الكابشن والهاشتاج</th><th>{W.prepare}</th></tr></thead><tbody>{chooserLines.map(line => <tr key={line.id}><td><strong>{line.idea_name}</strong><small className="mkw-muted" style={{ display: 'block' }}>{line.task_no} · {line.task_name}</small></td><td className="mkw-plan-idea-cell">{line.product_idea || '—'}</td><td>{showDate(line.scheduled_on)}</td><td>{line.platform_name || '—'}</td><td>{line.post_type_name || '—'}</td>{chooserIsCampaign && <td className="mkw-budget-value">{Number(line.budget_amount || 0).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2 })}</td>}<td><span className={`mkw-publish-draft-state ${line.prepared_count === 1 && !line.failed_count ? 'is-ready' : ''}`}>{line.prepared_count === 1 && !line.failed_count ? <><CheckCircle size={16} weight="fill"/>تم تجهيز المطلوب</> : 'يحتاج كتابة وحفظ'}</span></td><td><button type="button" className="secondary" onClick={() => { setSelectPlan(''); setPrepareId(line.id); }}>فتح</button></td></tr>)}</tbody></table></div></div></Modal>}
    {prepareId && <PreparationModal id={prepareId} onClose={() => setPrepareId('')} onChanged={() => void query.reload()}/>}  
  </div>;
}
