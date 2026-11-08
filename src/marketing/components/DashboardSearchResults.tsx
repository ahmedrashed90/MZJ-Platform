import { useEffect, useState } from 'react';
import { CalendarBlank, ClipboardText, ImageSquare, Megaphone, CaretLeft } from '@phosphor-icons/react';
import type { WorkPlanLine, WorkTask } from '../../../shared/marketing-workflow';
import type { DashboardSearchPlan, DashboardSearchResults as Results } from '../workflow/dashboardSearch';
import { showDate, showRange } from '../workflow/api';
import { Status } from '../workflow/components';
import '../workflow/dashboardSearch.css';

const PAGE_SIZE = 12;
type Section = keyof Results;
type Limits = Record<Section, number>;
const defaultLimits: Limits = { tasks: PAGE_SIZE, publications: PAGE_SIZE, agendas: PAGE_SIZE, campaigns: PAGE_SIZE };

function publicationStatus(line: WorkPlanLine): string {
  if (line.published_ready) return line.publication_timing === 'late' ? 'نُشر متأخرًا' : 'تم النشر';
  return line.publication_timing === 'overdue' ? 'متأخر ولم يُنشر' : 'بانتظار النشر';
}

function planPeriod(plan: DashboardSearchPlan): { title: string; value: string } {
  const { first, scheduledFrom, scheduledTo } = plan;
  const start = plan.kind === 'agenda' ? first.agenda_from : first.funding_from;
  const end = plan.kind === 'agenda' ? first.agenda_to : first.funding_to;
  const title = plan.kind === 'agenda' ? 'فترة نشر الأجندة' : 'فترة التمويل';
  // Do not present an inferred last date as the end of an explicitly open-ended period.
  const firstDay = start || scheduledFrom;
  const lastDay = end || (start ? '' : scheduledTo);
  return { title, value: `${showDate(firstDay)} — ${lastDay ? showDate(lastDay) : 'غير محدد'}` };
}

export function DashboardSearchResults({ query, results, loading, onOpenTask, onOpenPlan, onOpenPublication }: {
  query: string;
  results: Results;
  loading: boolean;
  onOpenTask: (id: string) => void;
  onOpenPlan: (id: string) => void;
  onOpenPublication: (planId: string) => void;
}) {
  const [limits, setLimits] = useState<Limits>(defaultLimits);
  useEffect(() => setLimits(defaultLimits), [query]);
  if (!query.trim()) return null;
  const total = results.tasks.length + results.publications.length + results.agendas.length + results.campaigns.length;
  const more = (section: Section, count: number) => count > limits[section]
    ? <button type="button" className="mkw-dashboard-results-more" onClick={() => setLimits(current => ({ ...current, [section]: current[section] + PAGE_SIZE }))}>
        عرض المزيد ({count - limits[section]} متبقي) <CaretLeft size={16} />
      </button> : null;

  return <div className="mkw-dashboard-search-results" aria-label="نتائج البحث" dir="rtl">
    <div className="mkw-dashboard-results-summary" role="status" aria-live="polite">
      <strong>نتائج البحث</strong>
      <span>{loading ? 'جاري تحديث النتائج...' : `${total} نتيجة`}</span>
    </div>
    {!total && <div className="mkw-dashboard-results-empty">{loading ? 'جاري البحث...' : 'لا توجد نتائج مطابقة. جرب كلمة أخرى أو جزءًا من الاسم أو التاريخ.'}</div>}

    {results.tasks.length > 0 && <section className="mkw-dashboard-result-group" aria-label="نتائج التاسكات">
      <h3><ClipboardText size={19} /> التاسكات <small>({results.tasks.length})</small></h3>
      <div className="mkw-dashboard-result-list">{results.tasks.slice(0, limits.tasks).map((task: WorkTask) => <article key={task.id} className="mkw-dashboard-result-row">
        <div className="mkw-dashboard-result-primary"><span className="mkw-code">{task.task_no}</span><strong>{task.name}</strong></div>
        <div className="mkw-dashboard-result-details">
          <span>المنفذ: <b>{task.assignee_names?.length ? task.assignee_names.join('، ') : '—'}</b></span>
          <span>تاريخ التسليم: <b>{showRange(task.due_from, task.due_to)}</b></span>
          <span>تاريخ الإنشاء: <b>{showDate(task.created_at)}</b></span>
          <Status value={task.status} />
        </div>
        <button type="button" className="mkw-dashboard-result-open" onClick={() => onOpenTask(task.id)} aria-label={`فتح التاسك ${task.task_no}`}>فتح <CaretLeft size={16}/></button>
      </article>)}</div>
      {more('tasks', results.tasks.length)}
    </section>}

    {results.publications.length > 0 && <section className="mkw-dashboard-result-group" aria-label="نتائج المنشورات">
      <h3><ImageSquare size={19} /> المنشورات <small>({results.publications.length})</small></h3>
      <div className="mkw-dashboard-result-list">{results.publications.slice(0, limits.publications).map((line: WorkPlanLine) => <article key={line.id} className="mkw-dashboard-result-row">
        <div className="mkw-dashboard-result-primary"><span className="mkw-code">{line.plan_no}</span><strong>{line.idea_name || line.task_name || line.name}</strong><small>{line.kind === 'agenda' ? 'أجندة' : 'حملة'}: {line.name}</small></div>
        <div className="mkw-dashboard-result-details">
          <span>المنصة: <b>{line.platform_name || '—'}</b></span>
          <span>نوع النشر: <b>{line.post_type_name || '—'}</b></span>
          <span><CalendarBlank size={15}/> تاريخ النشر المخطط: <b>{showDate(line.scheduled_on)}</b></span>
          <span className={line.publication_timing === 'overdue' || line.publication_timing === 'late' ? 'mkw-dashboard-result-late' : ''}>{publicationStatus(line)}</span>
          {line.published_ready && <span>تاريخ النشر الفعلي: <b>{line.published_on ? showDate(line.published_on) : 'غير مسجل'}</b></span>}
          {line.assignee_name && <span>المنفذ: <b>{line.assignee_name}</b></span>}
        </div>
        {line.product_idea && <p className="mkw-dashboard-result-idea">الفكرة: {line.product_idea}</p>}
        <button type="button" className="mkw-dashboard-result-open" onClick={() => onOpenPublication(line.plan_id)} aria-label={`فتح تقرير المنشور ${line.idea_name || line.task_name}`}>عرض التقرير <CaretLeft size={16}/></button>
      </article>)}</div>
      {more('publications', results.publications.length)}
    </section>}

    {([['agendas', 'الأجندات', CalendarBlank], ['campaigns', 'الحملات', Megaphone]] as const).map(([section, label, Icon]) =>
      results[section].length > 0 ? <section key={section} className="mkw-dashboard-result-group" aria-label={`نتائج ${label}`}>
        <h3><Icon size={19}/> {label} <small>({results[section].length})</small></h3>
        <div className="mkw-dashboard-result-list">{results[section].slice(0, limits[section]).map((plan: DashboardSearchPlan) => {
          const period = planPeriod(plan);
          return <article key={plan.id} className="mkw-dashboard-result-row">
            <div className="mkw-dashboard-result-primary"><span className="mkw-code">{plan.first.plan_no}</span><strong>{plan.first.name}</strong></div>
            <div className="mkw-dashboard-result-details">
              <span>{period.title}: <b>{period.value}</b></span>
              <span>تاريخ الإنشاء: <b>{showDate(plan.first.plan_created_at)}</b></span>
              <span>عدد المنشورات: <b>{plan.lines.length}</b></span>
              {plan.first.creator_name && <span>المنشئ: <b>{plan.first.creator_name}</b></span>}
              <Status value={plan.first.review_status || 'in_progress'} />
            </div>
            <button type="button" className="mkw-dashboard-result-open" onClick={() => onOpenPlan(plan.id)} aria-label={`فتح ${label} ${plan.first.plan_no}`}>فتح <CaretLeft size={16}/></button>
          </article>;
        })}</div>
        {more(section, results[section].length)}
      </section> : null)}
  </div>;
}
