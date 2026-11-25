import { Fragment, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CaretDown, CaretLeft, ClipboardText, Eye, PaperPlaneTilt, Plus, CalendarBlank, Gear, CheckCircle, MagnifyingGlass, X, LinkSimple } from '@phosphor-icons/react';
import { Modal } from '../../components/Modal';
import { W, Empty, Readiness, WorkAlert, WorkHeader } from '../workflow/components';
import { showDate, showRange, useWorkQuery, workPost } from '../workflow/api';
import { TaskDetail } from '../workflow/TaskDetail';
import { DeleteTaskButton } from '../workflow/DeleteTaskButton';
import { PreparationModal } from '../workflow/PublishPage';
import { AgendaSyncButton } from '../workflow/AgendaSyncButton';
import { AgendaIdeaDateEditor } from '../workflow/AgendaIdeaDateEditor';
import { PlanDetail } from '../workflow/PlanDetail';
import { PlanStatusBadges, planDisplayState, planStateLabels } from '../workflow/PlanStatus';
import { PlanReport } from '../workflow/PlanReport';
import { CampaignOverview, hasPreparationPostLink, preparationLinesByMissingLink, preparationReturnAnchor } from '../workflow/campaignOverview';
import { exportCampaignSummaryPdf, exportPlanSummaryPdf } from '../workflow/campaignPdfExport';
import { summarizePublishingDays } from '../workflow/publishingDaySummary';
import { executionDashboardTasks, publishingDashboardEntries } from '../workflow/publishingPriority';
import { searchMarketingDashboard } from '../workflow/dashboardSearch';
import { taskCategoryLabel } from '../workflow/taskPresentation';
import { DashboardSearchResults } from '../components/DashboardSearchResults';
import { StrategyCampaignLinkModal, StrategyLineCopyModal, StrategyDraftCard, StrategyDraftEditor, StrategyDraftReport, type StrategyDraft } from '../workflow/StrategyDrafts';
import { planProductReadiness, type PlanProductsData } from '../workflow/StrategyProductsTable';
import { workPlatformSupportsAutoPublish } from '../../../shared/marketing-workflow';
import { isPublishContentPrepared, publishContentMissingLabel } from '../../../shared/marketing-publish-preparation';
import type { WorkCapabilities, WorkPlanLine, WorkTask } from '../../../shared/marketing-workflow';

type ReviewState = 'in_progress' | 'revision' | 'submitted' | 'publishing' | 'published';

/** Preserve the dashboard's public card-name contract with the shared task-title presenter. */
export function executionCardName(name: string): string {
  return taskCategoryLabel(name);
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
  const [captureOnly,setCaptureOnly] = useState(false);
  const [searchTaskAssignees, setSearchTaskAssignees] = useState<string[]>([]);
  const [tableId, setTableId] = useState('');
  const [pdfError, setPdfError] = useState('');
  const [selectPlan, setSelectPlan] = useState(''), [prepareId, setPrepareId] = useState('');
  const chooserContentRef = useRef<HTMLDivElement>(null);
  const reviewPosition = useRef<{ id: string; day: string; linked: boolean; nearbyIds: string[]; top: number; left: number; offset: number } | null>(null);
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
  const query = useWorkQuery<{ tasks: WorkTask[]; lines: WorkPlanLine[]; capabilities: WorkCapabilities; canReviewPlans: boolean; userId: string }>('dashboard');
  const schema = useWorkQuery<{ ready: boolean; baseReady: boolean; performanceReady: boolean; publishSettingsReady?: boolean; planReviewersReady?: boolean; campaignGoalsReady?: boolean; strategyDraftsReady?: boolean; executorDatesReady?: boolean; draftReviewNotesReady?: boolean; canUpgrade: boolean }>('schema_status');
  const publishSettings = useWorkQuery<{ enabled: boolean }>('publish_button_settings');
  // Strategy flow: agenda/campaign drafts filled from «إنشاء التكليفات».
  const strategyDrafts = useWorkQuery<{ ready: boolean; drafts: StrategyDraft[] }>('strategy_drafts');
  const [copyLine, setCopyLine] = useState<WorkPlanLine | null>(null);
  const [draftOpenId, setDraftOpenId] = useState(''), [draftReportId, setDraftReportId] = useState(''), [linkPlanId, setLinkPlanId] = useState('');
  const [linkPlatformLines, setLinkPlatformLines] = useState<WorkPlanLine[] | null>(null);
  const drafts = strategyDrafts.data?.drafts || [];
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
      await strategyDrafts.reload();
    } catch (error) {
      setSchemaError(error instanceof Error ? error.message : W.invalid);
    } finally {
      setSchemaUpgrading(false);
    }
  }

  const taskId = params.get('task') || '';
  const planId = params.get('plan') || '';
  // Keep the normal execution/publishing cards unchanged. Search renders a
  // separate, keyword-matched result list with exact publication dates.
  const tasks = query.data?.tasks || [];
  const executionTasks = useMemo(() => executionDashboardTasks(tasks), [tasks]);
  const lines = query.data?.lines || [];
  const searchResults = useMemo(() => searchMarketingDashboard(tasks, lines, search), [tasks, lines, search]);
  const groups = useMemo(() => {
    const grouped = new Map<string, WorkPlanLine[]>();
    for (const line of lines) {
      const group = grouped.get(line.plan_id);
      if (group) group.push(line);
      else grouped.set(line.plan_id, [line]);
    }
    return grouped;
  }, [lines]);
  const publishingEntries = useMemo(() => publishingDashboardEntries(groups, drafts), [groups, drafts]);

  function openTask(id: string, filter: '' | 'on_time' | 'late' = '', assigneeNames: string[] = [], capture = false) {
    setCaptureOnly(capture);
    setDeliveryFilter(filter);
    setSearchTaskAssignees(assigneeNames);
    setParams({ task: id });
  }
  function openPreparation(group: WorkPlanLine[]) {
    setPdfError('');
    // Campaigns always show the complete funding/creative budget overview,
    // even if the campaign currently contains only one publish line.
    if (group[0]?.kind === 'campaign' || group.length > 1 || group[0]?.strategy_draft_id) setSelectPlan(group[0].plan_id);
    else if (group.length) setPrepareId(group[0].id);
  }
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

  const chooserSourceLines = groups.get(selectPlan) || [];
  // Requirement readiness per product for the printable compact schedule.
  const chooserProducts = useWorkQuery<PlanProductsData>('plan_products', { planId: selectPlan }, Boolean(selectPlan));
  const chooserLines = useMemo(() => preparationLinesByMissingLink(chooserSourceLines), [chooserSourceLines]);
  const chooserIsCampaign = chooserLines[0]?.kind === 'campaign';
  const missingLinkCount = chooserLines.filter(line => !hasPreparationPostLink(line)).length;

  function openChooserLine(line: WorkPlanLine, event: MouseEvent<HTMLButtonElement>) {
    const content = chooserContentRef.current;
    const body = content?.closest<HTMLElement>('.mzj-modal-body');
    const row = event.currentTarget.closest('tr');
    if (content && body && row) {
      const index = chooserLines.findIndex(entry => entry.id === line.id);
      const table = content.querySelector<HTMLElement>('.mkw-publishing-chooser-table');
      reviewPosition.current = {
        id: line.id, day: String(line.scheduled_on || '').slice(0, 10), linked: hasPreparationPostLink(line),
        nearbyIds: [...chooserLines.slice(index + 1), ...chooserLines.slice(0, index).reverse()].map(entry => entry.id),
        top: body.scrollTop, left: table?.scrollLeft || 0,
        offset: row.getBoundingClientRect().top - body.getBoundingClientRect().top,
      };
    }
    if (line.strategy_product_pending) setCopyLine(line);
    else setPrepareId(line.id);
  }

  // Keep the chooser mounted behind the child editor. If saving a URL moves
  // the row, anchor to another post from that review group/date rather than
  // scrolling down to the newly completed post. Restore after async reloads.
  useLayoutEffect(() => {
    const position = reviewPosition.current;
    if (!position || !selectPlan) return;
    const content = chooserContentRef.current;
    const body = content?.closest<HTMLElement>('.mzj-modal-body');
    if (!content || !body) return;
    const anchor = preparationReturnAnchor(chooserLines, position);
    const row = Array.from(content.querySelectorAll<HTMLElement>('[data-preparation-line]'))
      .find(entry => entry.dataset.preparationLine === anchor);
    body.scrollTop = row
      ? body.scrollTop + row.getBoundingClientRect().top - body.getBoundingClientRect().top - position.offset
      : position.top;
    const table = content.querySelector<HTMLElement>('.mkw-publishing-chooser-table');
    if (table) table.scrollLeft = position.left;
    if (!prepareId && !copyLine && !query.loading) reviewPosition.current = null;
  }, [selectPlan, prepareId, copyLine, chooserLines, query.loading]);
  // Read the same server-derived edit permission as the plan report. Never infer
  // it from general publication-preparation access or agenda ownership alone.
  const chooserAgendaPlan = useWorkQuery<{ plan: { canRescheduleIdeas?: boolean } }>(
    'plan', { id: selectPlan }, Boolean(selectPlan && chooserSourceLines[0]?.kind === 'agenda')
  );

  return <div className="mkw mkw-dashboard"><WorkHeader title={W.dashboard} onRefresh={() => { void query.reload(); void strategyDrafts.reload(); }} loading={query.loading}>{query.data?.capabilities.createTask && <Link className="mkw-link-button" to="/marketing/create"><Plus size={17}/>{W.createTask}</Link>}</WorkHeader><WorkAlert>{query.error || activationError || schemaError}</WorkAlert><WorkAlert success>{activationMessage}</WorkAlert>
    {schema.data && !schema.data.ready && <div className="mkw-schema-upgrade" role="alert">
      <span>{schema.data.baseReady ? 'تحتاج قاعدة بيانات التسويق إلى تحديث الجداول حتى تظهر بيانات التنفيذ والنشر الحالية.' : 'قاعدة بيانات التسويق تحتاج إلى التهيئة الأساسية.'}</span>
      {schema.data.canUpgrade && <button type="button" className="primary" disabled={schemaUpgrading} onClick={() => void upgradeSchema()}>{schemaUpgrading ? 'جارٍ تحديث قاعدة البيانات...' : 'تحديث قاعدة بيانات التسويق'}</button>}
      {!schema.data.canUpgrade && <span>يرجى التواصل مع مدير النظام لتنفيذ التحديث.</span>}
    </div>}
    {schema.data?.ready && schema.data.draftReviewNotesReady === false && <div className="mkw-schema-upgrade" role="alert">
      <span>يوجد تحديث لحفظ ملاحظات المراجعة مع مسودات الحملات والأجندات.</span>
      {schema.data.canUpgrade
        ? <button type="button" className="secondary" disabled={schemaUpgrading} onClick={() => void upgradeSchema()}>تحديث ملاحظات المسودات</button>
        : <span>يلزم الدخول بحساب المسؤول العام لتنفيذ التحديث.</span>}
    </div>}
    {schema.data?.ready && schema.data.executorDatesReady === false && <div className="mkw-schema-upgrade" role="alert">
      <span>تحديث تواريخ تسليم المنفذين وتاريخ نهاية الحملات لم يُفعّل بعد في قاعدة بيانات التسويق.</span>
      {schema.data.canUpgrade
        ? <button type="button" className="secondary" disabled={schemaUpgrading} onClick={() => void upgradeSchema()}>{schemaUpgrading ? 'جارٍ تحديث قاعدة البيانات...' : 'تحديث تواريخ المنفذين والحملات'}</button>
        : <span>يلزم الدخول بحساب المسؤول العام لتنفيذ التحديث.</span>}
    </div>}
    {schema.data?.ready && schema.data.campaignGoalsReady === false && schema.data.canUpgrade && <div className="mkw-schema-upgrade" role="status"><span>يوجد تحديث جديد لإعدادات «الهدف من الحملة» دون حذف أي حملة سابقة.</span><button type="button" className="secondary" disabled={schemaUpgrading} onClick={() => void upgradeSchema()}>تحديث أهداف الحملات</button></div>}
    {schema.data?.ready && schema.data.strategyDraftsReady === false && schema.data.canUpgrade && <div className="mkw-schema-upgrade" role="status"><span>يتوفر تحديث لتفعيل مسودات الأجندة والحملة القادمة من استراتيجية المحتوى (بدون تغيير أي أجندة أو حملة حالية).</span><button type="button" className="secondary" disabled={schemaUpgrading} onClick={() => void upgradeSchema()}>تفعيل مسودات الاستراتيجية</button></div>}
    {schema.data?.ready && schema.data.publishSettingsReady === false && schema.data.canUpgrade && <div className="mkw-schema-upgrade" role="status"><span>يتوفر تحديث إعدادات التحكم في زر النشر التلقائي.</span><button type="button" className="secondary" disabled={schemaUpgrading} onClick={() => void upgradeSchema()}>تحديث إعدادات النشر</button></div>}
    {schema.data?.ready && !schema.data.performanceReady && schema.data.canUpgrade && <div className="mkw-schema-upgrade" role="status">
      <span>يتوفر تحسين لفهارس قاعدة بيانات التسويق لتسريع تحميل تفاصيل التاسكات والمراجعات.</span>
      <button type="button" className="secondary" disabled={schemaUpgrading} onClick={() => void upgradeSchema()}>{schemaUpgrading ? 'جارٍ تحسين قاعدة البيانات...' : 'تحسين سرعة تحميل التسويق'}</button>
    </div>}
    <div className="mkw-toolbar mkw-dashboard-search" role="search">
      <div className="mkw-search mkw-dashboard-search-input"><MagnifyingGlass size={19} aria-hidden="true" />
        <input aria-label="بحث" placeholder="بحث..." type="search" autoComplete="off" value={search} onChange={event => setSearch(event.target.value)} />
        {search && <button type="button" className="mkw-dashboard-search-clear" aria-label="مسح البحث" onClick={() => setSearch('')}><X size={17}/></button>}
      </div>
    </div>
    <DashboardSearchResults query={search} results={searchResults} loading={query.loading}
      onOpenTask={(id, assigneeNames) => openTask(id, '', assigneeNames)} onOpenPlan={id => setParams({ plan: id })}
      onOpenPublication={id => setTableId(id)} />
    <div className="mkw-board mkw-dashboard-board">
      <section className="mkw-column"><header><div className="mkw-column-title"><ClipboardText size={21}/><h2>{W.execution}</h2></div><span>{tasks.length}</span></header>
        <div className="mkw-column-body">{!tasks.length && <Empty>{query.loading ? W.loading : W.noData}</Empty>}
          {executionTasks.map(task => <article className="mkw-dashboard-task" key={task.id}>
            <div className="mkw-dashboard-task-heading"><div><span className="mkw-code">{task.task_no}</span><h3 title={task.name}>{executionCardName(task.name)}</h3></div><div className="mkw-dashboard-task-buttons"><button type="button" className="mkw-dashboard-view" aria-label={`${W.open} ${task.name}`} onClick={() => openTask(task.id)}><Eye size={20}/></button><DeleteTaskButton compact id={task.id} name={task.name} code={task.task_no} onDeleted={() => query.reload()}/></div></div>
            <div className="mkw-dashboard-stats"><div><small>{W.createdAt}</small><strong>{showDate(task.created_at)}</strong></div><div><small>{W.dueOn}</small><strong>{showRange(task.due_from, task.due_to)}</strong></div><div><small>{W.productCount}</small><strong>{task.product_count}</strong></div></div>
            <Readiness value={task.readiness}/>
            {((task.submitted_on_time_count ?? 0) > 0 || (task.submitted_late_count ?? 0) > 0) && <div className="mkw-delivery-summary" aria-label="مواعيد تسليم المطلوبات">
              {(task.submitted_on_time_count ?? 0) > 0 && <button type="button" className="mkw-delivery-summary-card is-on-time" onClick={() => openTask(task.id, 'on_time')}><span>{W.deliveryOnTime}</span><strong>{task.submitted_on_time_count}</strong></button>}
              {(task.submitted_late_count ?? 0) > 0 && <button type="button" className="mkw-delivery-summary-card is-late" onClick={() => openTask(task.id, 'late')}><span>{W.deliveryLate}</span><strong>{task.submitted_late_count}</strong></button>}
            </div>}
            {((task.capture_on_time_count ?? 0) > 0 || (task.capture_late_count ?? 0) > 0) && <div className="mkw-delivery-summary mkw-photography-delivery" aria-label="مواعيد تسليم التصوير">
              {(task.capture_on_time_count ?? 0) > 0 && <button type="button" className="mkw-delivery-summary-card is-on-time" onClick={() => openTask(task.id, 'on_time', [], true)}><span>التصوير في الموعد</span><strong>{task.capture_on_time_count}</strong></button>}
              {(task.capture_late_count ?? 0) > 0 && <button type="button" className="mkw-delivery-summary-card is-late" onClick={() => openTask(task.id, 'late', [], true)}><span>تأخر في التصوير</span><strong>{task.capture_late_count}</strong></button>}
            </div>}
            <button type="button" className="mkw-dashboard-open" onClick={() => openTask(task.id)}>{W.open}<CaretLeft size={16}/></button>
          </article>)}
        </div>
      </section>

      <section className="mkw-column mkw-publishing-column">
        <header><button type="button" className="mkw-column-toggle" aria-expanded={publishingOpen} aria-controls="mkw-publishing-body" onClick={() => setPublishingOpen(open => !open)}>
          <div className="mkw-column-title"><PaperPlaneTilt size={21}/><h2>{W.publishingSection}</h2><CaretDown className={publishingOpen ? 'mkw-section-open' : ''} size={18}/></div>
          <span className="mkw-column-count">{groups.size + drafts.length}</span>
        </button></header>
        {publishingOpen && <div id="mkw-publishing-body" className="mkw-column-body mkw-publish-column-body">{!groups.size && !drafts.length && <Empty>{query.loading ? W.loading : W.noData}</Empty>}
          {publishingEntries.map(entry => {
            if (entry.source === 'draft') return <StrategyDraftCard key={entry.id} draft={entry.draft} onOpen={() => setDraftOpenId(entry.id)} onReport={() => setDraftReportId(entry.id)}/>;
            const { id, group } = entry;
            const supported = group.every(line => workPlatformSupportsAutoPublish(line.platform_code));
            // "تم التجهيز" is a content checklist, not a publish_schedule count.
            const contentPrepared = group.every(isPublishContentPrepared);
            // Keep the separate automatic-scheduling gate unchanged: merely
            // having copy and a final file does not create provider schedules.
            const activationPrepared = group.every(line => line.prepared_count === 1 && !line.failed_count);
            const activated = !!group[0].activated_at;
            const reviewStatus = (group[0].review_status || 'in_progress') as ReviewState;
            const readyLines = group.filter(line => line.published_ready).length;
            const visualStatus = planDisplayState(reviewStatus, readyLines, group.length);
            const readiness = Math.round(readyLines * 100 / group.length);
            const preparedLines = group.filter(isPublishContentPrepared).length;
            const platforms = uniqueValues(group.map(line => line.platform_name));
            const kinds = uniqueValues(group.map(line => line.post_type_name));
            const distinctProducts = new Set(group.map(line => line.product_id)).size;
            const days = summarizePublishingDays(group);
            const onTimePosts = days.reduce((total, day) => total + day.onTimeCount, 0);
            const latePosts = days.reduce((total, day) => total + day.lateCount, 0);
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
                <PlanStatusBadges kind={group[0].kind} reviewStatus={reviewStatus} publishedCount={readyLines} totalCount={group.length} onDetails={() => setParams({ plan: id })}/>
              </div>

              <div className="mkw-dashboard-publish-stats">
                <div><small>{group[0].kind === 'agenda' ? 'فترة نشر الأجندة' : 'فترة التمويل'}</small><strong>{group[0].kind === 'campaign' ? `${group[0].funding_from ? showDate(group[0].funding_from) : scheduleRange(group)} — ${group[0].funding_to ? showDate(group[0].funding_to) : 'غير محدد'}` : `${group[0].agenda_from ? showDate(group[0].agenda_from) : scheduleRange(group)} — ${group[0].agenda_to ? showDate(group[0].agenda_to) : 'غير محدد'}`}</strong></div>
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

              {(onTimePosts > 0 || latePosts > 0) &&
                <div className="mkw-dashboard-plan-timing mkw-delivery-summary" aria-label="الالتزام بمواعيد النشر">
                  {onTimePosts > 0 && <div className="mkw-delivery-summary-card is-on-time"><span>نشر في الموعد</span><strong>{onTimePosts}</strong></div>}
                  {latePosts > 0 && <div className="mkw-delivery-summary-card is-late"><span>تأخر في النشر</span><strong>{latePosts}</strong></div>}
                </div>}

              <div id={`mkw-publish-products-${id}`} className="mkw-dashboard-publish-preview" hidden={!productsOpen}>
                <div className="mkw-dashboard-publish-preview-head"><strong>مواعيد النشر</strong><span>{days.length} يوم · {distinctProducts} منتج · {group.length} منشور</span></div>
                <div className="mkw-dashboard-publish-preview-list">
                  {days.map(day => <article key={day.date} className="mkw-dashboard-preview-item mkw-dashboard-publish-day">
                    <div className="mkw-dashboard-preview-title"><strong><CalendarBlank size={17}/> {showDate(day.date)}</strong><span>{day.publicationCount} {day.publicationCount === 1 ? 'منشور' : 'منشورات'}</span></div>
                    <div className="mkw-dashboard-preview-subline"><span title={day.productNames.join('، ')}>{day.productNames.join('، ')}</span><span>{day.platformNames.join(' · ') || '—'}</span></div>
                    <div className="mkw-dashboard-publish-day-footer"><span>أنواع النشر: {day.postTypeNames.join('، ') || '—'}</span><strong>{day.publishedCount} / {day.publicationCount} تم النشر</strong></div>
                    <div className="mkw-dashboard-day-status">
                      {day.onTimeCount > 0 && <span className="mkw-publish-timing is-on-time">نشر في الموعد: {day.onTimeCount}</span>}
                      {day.publishedLateCount > 0 && <span className="mkw-publish-timing is-late">نُشر متأخرًا: {day.publishedLateCount}</span>}
                      {day.overdueCount > 0 && <span className="mkw-publish-timing is-late">متأخر ولم يُنشر: {day.overdueCount}</span>}
                      {day.pendingCount > 0 && <span className="mkw-publish-timing is-pending">بانتظار النشر: {day.pendingCount}</span>}
                      {day.undatedCount > 0 && <span className="mkw-publish-timing is-undated">تاريخ النشر غير مسجل: {day.undatedCount}</span>}
                    </div>
                  </article>)}
                </div>
                <small className="mkw-dashboard-publish-detail-hint">تفاصيل كل منصة ونوع نشر متاحة داخل التقرير.</small>
              </div>

              <div className="mkw-dashboard-publish-tags">
                {contentPrepared && <span className="mkw-dashboard-note-tag is-ready">تم تجهيز جميع المطلوبات</span>}
                {activated && <span className="mkw-dashboard-note-tag is-active"><CheckCircle size={14}/>تم تفعيل النشر</span>}
                {reviewStatus === 'revision' && <span className="mkw-dashboard-note-tag is-danger">يوجد طلب تعديل</span>}
              </div>

              <div className="mkw-dashboard-publish-actions">
                <button type="button" className="secondary" onClick={() => setTableId(id)}><CalendarBlank size={17}/>التقرير</button>
                {!['publishing', 'published'].includes(reviewStatus) && ((query.data?.canReviewPlans && (['in_progress','submitted'].includes(reviewStatus) || group[0].kind === 'campaign')) || (group[0].created_by === query.data?.userId && ['in_progress','revision','submitted'].includes(reviewStatus))) && <button type="button" className="secondary" onClick={() => setParams({ plan: id })}><Eye size={17}/>{reviewStatus === 'revision' ? '\u0639\u0631\u0636 \u0637\u0644\u0628 \u0627\u0644\u062a\u0639\u062f\u064a\u0644' : query.data?.canReviewPlans ? '\u0645\u0631\u0627\u062c\u0639\u0629 \u0648\u0627\u0639\u062a\u0645\u0627\u062f' : '\u062a\u0641\u0627\u0635\u064a\u0644 \u0627\u0644\u062d\u0645\u0644\u0629 \u0623\u0648 \u0627\u0644\u0623\u062c\u0646\u062f\u0629'}</button>}
                <button type="button" className="secondary" disabled={!query.data?.capabilities.prepare && !query.data?.canReviewPlans} onClick={() => openPreparation(group)}><Gear size={17}/>{W.prepare}</button>
                {publishSettings.data?.enabled && <button type="button" className="primary" disabled={!query.data?.capabilities.publish || !activationPrepared || !supported || activated || Boolean(activationBusy) || reviewStatus !== 'publishing'} title={!supported ? 'المنصة لا تدعم النشر عبر الربط الحالي' : !activationPrepared ? 'أكمل حفظ إعدادات الجدولة لكل منشور قبل تفعيل النشر الآلي' : ''} onClick={() => void activatePlan(group)}><PaperPlaneTilt size={17}/>النشر</button>}
              </div>
            </article>;
          })}
        </div>}
      </section>
    </div>
    {taskId && <TaskDetail id={taskId} deliveryFilter={deliveryFilter} captureOnly={captureOnly} searchAssigneeNames={searchTaskAssignees}
      onClose={() => { setParams({}); setDeliveryFilter(''); setCaptureOnly(false); setSearchTaskAssignees([]); }} onChanged={() => void query.reload()}/>}
    {planId && <PlanDetail id={planId} onClose={() => setParams({})} onChanged={() => void query.reload()}/>}    
    {tableId && <PlanReport id={tableId} onClose={() => setTableId('')} onChanged={() => void query.reload()}/>}    
    {selectPlan && <Modal open title={`${W.prepare} — ${chooserSourceLines[0]?.name || ''}`} onClose={() => { reviewPosition.current = null; setSelectPlan(''); }} className="mkw-fullscreen mkw-publishing-chooser-fullscreen"><div ref={chooserContentRef} className="mkw mkw-publishing-chooser-content">
      {!!chooserSourceLines.length && <div className="mkw-campaign-chooser-toolbar">
        <strong>{chooserIsCampaign ? 'ملخص الحملة وجدول تجهيز المنشورات' : 'ملخص الأجندة وجدول تجهيز المنشورات'}</strong>
        {!chooserIsCampaign && <AgendaSyncButton planId={selectPlan} canSync={Boolean(query.data?.capabilities.prepare || query.data?.canReviewPlans)}/>} 
        <button type="button" className="secondary mkw-campaign-export-pdf" title="اختر حفظ كـ PDF من نافذة الطباعة" disabled={chooserProducts.loading && !chooserProducts.data} onClick={() => {
          const first = chooserSourceLines[0];
          if (!first) return;
          try {
            setPdfError('');
            const options = { planName: first.name, planNo: first.plan_no,
              creatorName: first.creator_name, createdAt: first.plan_created_at,
              fundingFrom: first.funding_from, fundingTo: first.funding_to, platformGoals:first.campaign_platform_goals,
              approvedByName: ['publishing', 'published'].includes(first.review_status || '') ? first.approved_by_name : null,
              approvedAt: ['publishing', 'published'].includes(first.review_status || '') ? first.approved_at : null,
              publishState: planStateLabels[planDisplayState(first.review_status || 'in_progress', chooserSourceLines.filter(line => line.published_ready).length, chooserSourceLines.length)],
              lines: chooserSourceLines, readinessByProduct: planProductReadiness(chooserProducts.data?.rows) };
            if (chooserIsCampaign) exportCampaignSummaryPdf(options);
            else exportPlanSummaryPdf({ ...options, kind: 'agenda', agendaFrom: first.agenda_from, agendaTo: first.agenda_to });
          } catch (error) { setPdfError(error instanceof Error ? error.message : 'تعذر تجهيز ملف PDF'); }
        }}>{chooserIsCampaign ? 'تصدير PDF — ملخص الحملة' : 'تصدير PDF — ملخص الأجندة'}</button>
        {chooserIsCampaign && chooserSourceLines[0]?.strategy_draft_id && <button type="button" className="primary" disabled={!['publishing','published'].includes(chooserSourceLines[0]?.review_status || '')}
          title={['publishing','published'].includes(chooserSourceLines[0]?.review_status || '') ? '' : 'متاح بعد اعتماد الحملة'}
          onClick={() => setLinkPlanId(chooserSourceLines[0].plan_id)}>ربط الحملة بتقارير الحملات (تفاعل النشر)</button>}
      </div>}
      <WorkAlert>{pdfError}</WorkAlert>
      {!chooserIsCampaign && !!chooserSourceLines.length &&
        ['publishing','published'].includes(chooserSourceLines[0]?.review_status || '') && (
          chooserAgendaPlan.data?.plan?.canRescheduleIdeas
            ? <AgendaIdeaDateEditor planId={selectPlan} onChanged={() => {
                void query.reload();
                void chooserAgendaPlan.reload();
                void chooserProducts.reload();
              }}/>
            : chooserAgendaPlan.data && <button type="button" className="secondary" disabled
                title="تعديل المواعيد متاح لمنشئ الأجندة أو المراجع المصرح له بصلاحية تعديل الأجندة">
                تعديل مواعيد نشر أفكار الأجندة — لا توجد صلاحية
              </button>
        )}
      {chooserIsCampaign && <CampaignOverview lines={chooserSourceLines} fundingFrom={chooserSourceLines[0]?.funding_from} fundingTo={chooserSourceLines[0]?.funding_to} platformGoals={chooserSourceLines[0]?.campaign_platform_goals}/>}
      {!chooserIsCampaign && !!chooserSourceLines.length && <section className="mkw-agenda-window-overview mkw-summary" aria-label="فترة نشر الأجندة">
        <div><small>تاريخ نشر الأجندة من</small><strong>{showDate(chooserSourceLines[0]?.agenda_from)}</strong></div>
        <div><small>تاريخ نشر الأجندة إلى</small><strong>{showDate(chooserSourceLines[0]?.agenda_to)}</strong></div>
      </section>}<div className="mkw-table-wrap mkw-publishing-chooser-table"><table><thead><tr><th>{W.selectProduct}</th><th>الفكرة (فكرة المطلوب)</th><th>{chooserIsCampaign ? 'تاريخ النشر المخطط' : W.publishDate}</th><th>المنصة</th><th>نوع النشر</th>{chooserIsCampaign && <th>الميزانية (ر.س)</th>}<th>حالة الكابشن والهاشتاج</th><th>رابط المنشور</th><th>{W.prepare}</th></tr></thead><tbody>{chooserLines.map((line, index) => <Fragment key={line.id}>{(index === 0 || hasPreparationPostLink(chooserLines[index - 1]) !== hasPreparationPostLink(line)) && <tr className="mkw-platform-row-heading"><th colSpan={chooserIsCampaign ? 9 : 8}>{hasPreparationPostLink(line) ? `تم حفظ رابط المنشور (${chooserLines.length - missingLinkCount})` : `ناقص رابط المنشور (${missingLinkCount})`}</th></tr>}{chooserIsCampaign && (index === 0 || hasPreparationPostLink(chooserLines[index - 1]) !== hasPreparationPostLink(line) || chooserLines[index - 1]?.platform_name !== line.platform_name) &&
      <tr className="mkw-platform-row-heading" key={`platform-${line.platform_code || line.platform_name}-${index}`}><th colSpan={9}><div className="mkw-platform-head-row"><span>{line.platform_name || 'منصة غير محددة'}</span>{chooserIsCampaign && (() => {
        const platformLines = chooserLines.filter(row => (row.platform_code || row.platform_name) === (line.platform_code || line.platform_name));
        const approved = ['publishing','published'].includes(chooserSourceLines[0]?.review_status || '');
        const linkedCount = platformLines.filter(row => row.strategy_campaign_link).length;
        return <button type="button" className="secondary mkw-platform-link-btn" disabled={!approved}
          title={approved ? 'اختر الحملة الإعلانية من تقارير الحملات لهذه المنصة' : 'متاح بعد اعتماد الحملة'}
          onClick={() => setLinkPlatformLines(platformLines)}><LinkSimple size={15}/>{linkedCount === platformLines.length && platformLines.length ? 'تغيير الحملة المرتبطة' : linkedCount ? `اختيار الحملة (${linkedCount}/${platformLines.length} مرتبط)` : 'اختيار الحملة'}</button>;
      })()}</div></th></tr>}
      <tr key={line.id} data-preparation-line={line.id}><td><strong>{line.idea_name}</strong><small className="mkw-muted" style={{ display: 'block' }}>{line.task_no} · {line.task_name}</small></td><td className="mkw-plan-idea-cell">{line.product_idea || '—'}</td><td>{showDate(line.scheduled_on)}{line.strategy_funding_on && <small className="mkw-muted" style={{ display: 'block' }}>تاريخ التمويل: {showDate(line.strategy_funding_on)}{line.strategy_campaign_link ? ` · مرتبطة بـ ${line.strategy_campaign_link.campaignName}` : ''}</small>}</td><td>{line.platform_name || '—'}</td><td>{line.post_type_name || '—'}</td>{chooserIsCampaign && <td className="mkw-budget-value">{Number(line.budget_amount || 0).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2 })}</td>}<td>{line.strategy_draft_id
        ? <button type="button" className={`mkw-publish-draft-state mkw-copy-state-button ${isPublishContentPrepared(line) ? 'is-ready' : ''}`}
            title="كتابة الكابشن والهاشتاج ورابط المنشور"
            onClick={event => openChooserLine(line, event)}>
            {isPublishContentPrepared(line) ? <><CheckCircle size={16} weight="fill"/>تم تجهيز المطلوب</> : publishContentMissingLabel(line)}</button>
        : <span className={`mkw-publish-draft-state ${isPublishContentPrepared(line) ? 'is-ready' : ''}`}>{isPublishContentPrepared(line) ? <><CheckCircle size={16} weight="fill"/>تم تجهيز المطلوب</> : publishContentMissingLabel(line)}</span>}</td><td><span className={`mkw-publish-timing ${hasPreparationPostLink(line) ? 'is-on-time' : 'is-pending'}`}>{hasPreparationPostLink(line) ? 'الرابط موجود' : 'ناقص الرابط'}</span></td><td>{line.strategy_product_pending ? <span className="mkw-publish-timing is-pending" title="يتاح التجهيز بعد تنفيذ المنتج واعتماد ملفاته النهائية">بانتظار تسليم الملفات النهائية</span> : <button type="button" className="secondary" onClick={event => openChooserLine(line, event)}>فتح</button>}</td></tr></Fragment>)}</tbody></table></div></div></Modal>}
    {draftOpenId && <StrategyDraftEditor id={draftOpenId} onClose={() => setDraftOpenId('')} onChanged={() => { void strategyDrafts.reload(); void query.reload(); }}/>}
    {draftReportId && <StrategyDraftReport draftId={draftReportId} onClose={() => setDraftReportId('')}/>}
    {copyLine && <StrategyLineCopyModal line={copyLine} onClose={() => setCopyLine(null)} onChanged={async () => { await query.reload(); }}/>}
    {linkPlanId && <StrategyCampaignLinkModal lines={groups.get(linkPlanId) || []} onClose={() => setLinkPlanId('')} onChanged={() => void query.reload()}/>}
    {linkPlatformLines && <StrategyCampaignLinkModal lines={linkPlatformLines} onClose={() => setLinkPlatformLines(null)} onChanged={() => { void query.reload(); }}/>}
    {prepareId && <PreparationModal id={prepareId} level={selectPlan ? 1 : 0} onClose={() => setPrepareId('')} onChanged={async () => { await query.reload(); }}/>}  
  </div>;
}
