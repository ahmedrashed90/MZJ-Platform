import { useEffect, useState } from "react";
import { ArrowClockwise, Briefcase, CalendarDots, ChartLineUp, CheckCircle, ClockCountdown, ListChecks, UsersThree, WarningCircle } from "@phosphor-icons/react";
import { marketingDate, marketingFetch, marketingQuery } from "../api";
import { MarketingAlert, MarketingPage, ProgressBar } from "../components/MarketingPage";

function number(value: unknown) {
  return Number(value || 0).toLocaleString("ar-SA");
}

function percentage(value: unknown) {
  return `${Number(value || 0).toLocaleString("ar-SA", { maximumFractionDigits: 1 })}%`;
}

export function MonitoringPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setData(await marketingFetch<any>(`/api/marketing${marketingQuery({ resource: "monitoring" })}`));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل المتابعة");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  const totals = data?.totals || {};

  return <MarketingPage title="المتابعة" description="لوحة تشغيلية لمتابعة الحملات والأجندات والتاسكات والتأخير وأداء الأقسام والموظفين." actions={<button type="button" className="secondary" onClick={() => void load()} disabled={loading}><ArrowClockwise size={18} />تحديث البيانات</button>}>
    {error ? <MarketingAlert>{error}</MarketingAlert> : null}
    {!data ? <div className="marketing-empty"><ChartLineUp size={38} />جاري تحميل المتابعة...</div> : <>
      <section className="marketing-monitor-hero">
        <div><span>نسبة الإنجاز العامة</span><strong>{percentage(totals.progress)}</strong><p>متوسط التقدم لجميع التاسكات الظاهرة حسب صلاحياتك.</p></div>
        <div className="marketing-monitor-hero-progress"><ProgressBar value={Number(totals.progress || 0)} /></div>
      </section>

      <section className="marketing-monitor-kpis">
        <article><span><Briefcase size={22} /></span><div><small>إجمالي الحملات</small><strong>{number(totals.campaigns)}</strong><p>{number(totals.active_campaigns)} حملة نشطة</p></div></article>
        <article><span><CalendarDots size={22} /></span><div><small>إجمالي الأجندات</small><strong>{number(totals.agendas)}</strong><p>الأجندات داخل نطاق المتابعة</p></div></article>
        <article><span><ListChecks size={22} /></span><div><small>إجمالي التاسكات</small><strong>{number(totals.tasks)}</strong><p>{number(totals.active)} تاسك قيد التنفيذ</p></div></article>
        <article className="warning"><span><WarningCircle size={22} /></span><div><small>التاسكات المتأخرة</small><strong>{number(totals.delayed)}</strong><p>تحتاج متابعة فورية</p></div></article>
        <article><span><ClockCountdown size={22} /></span><div><small>قائمة الانتظار</small><strong>{number(totals.waiting)}</strong><p>لم يبدأ تنفيذها بعد</p></div></article>
        <article className="success"><span><CheckCircle size={22} /></span><div><small>التاسكات النشطة</small><strong>{number(totals.active)}</strong><p>تقدم أكبر من صفر</p></div></article>
      </section>

      <div className="marketing-monitor-layout">
        <section className="panel marketing-monitor-section">
          <header><div><h2>توزيع حالات التاسكات</h2><p>عدد ونسبة التاسكات في كل حالة تشغيلية.</p></div><span>{number(totals.tasks)} تاسك</span></header>
          <div className="marketing-monitor-bars">{data.statuses.map((item: any) => {
            const value = totals.tasks ? (item.count / totals.tasks) * 100 : 0;
            return <article key={item.status}><div><strong>{item.status}</strong><span>{number(item.count)} تاسك</span></div><ProgressBar value={value} /><b>{percentage(value)}</b></article>;
          })}</div>
        </section>

        <section className="panel marketing-monitor-section">
          <header><div><h2>اكتمال الحملات والأجندات</h2><p>نسبة التقدم الحالية لكل عنصر.</p></div><span>{number(data.entities.length)} عنصر</span></header>
          <div className="marketing-monitor-entities">{data.entities.map((item: any) => <article key={`${item.source_type}-${item.id}`}><div><span className="marketing-type-badge">{item.source_type === "agenda" ? "أجندة" : "حملة"}</span><strong>{item.name}</strong><small>{item.status || "—"}</small></div><div><b>{percentage(item.progress)}</b><ProgressBar value={item.progress} /></div></article>)}</div>
        </section>
      </div>

      <section className="panel marketing-monitor-section marketing-monitor-delayed">
        <header><div><h2><WarningCircle size={22} />التاسكات المتأخرة</h2><p>التاسكات التي تجاوزت موعد التسليم ولم تصل إلى 100%.</p></div><span className="danger-count">{number(data.delayed.length)}</span></header>
        <div className="marketing-table-wrap"><table><thead><tr><th>الحملة أو الأجندة</th><th>التاسك</th><th>الموظف</th><th>القسم</th><th>موعد التسليم</th><th>أيام التأخير</th><th>التقدم</th></tr></thead><tbody>{data.delayed.map((item: any) => <tr key={item.id}><td><strong>{item.source_name}</strong></td><td>{item.title}</td><td>{item.full_name}</td><td>{item.department_name || "قسم المحتوى"}</td><td>{marketingDate(item.due_at)}</td><td><span className="marketing-delay-badge">{number(item.delay_days)} يوم</span></td><td><div className="marketing-table-progress"><ProgressBar value={item.progress} /><b>{percentage(item.progress)}</b></div></td></tr>)}{!data.delayed.length ? <tr><td colSpan={7}><div className="marketing-empty small"><CheckCircle size={26} />لا توجد تاسكات متأخرة.</div></td></tr> : null}</tbody></table></div>
      </section>

      <div className="marketing-monitor-layout">
        <section className="panel marketing-monitor-section">
          <header><div><h2>أداء الأقسام</h2><p>حجم العمل ومتوسط الإنجاز داخل كل قسم.</p></div><UsersThree size={23} /></header>
          <div className="marketing-performance-cards">{data.departments.map((item: any) => <article key={item.id}><header><div><strong>{item.name}</strong><small>{number(item.tasks)} تاسك</small></div><b>{percentage(item.progress)}</b></header><ProgressBar value={item.progress} /></article>)}</div>
        </section>
        <section className="panel marketing-monitor-section">
          <header><div><h2>أداء الموظفين</h2><p>التاسكات والتأخير ومتوسط التقدم لكل موظف.</p></div><UsersThree size={23} /></header>
          <div className="marketing-employee-performance">{data.employees.map((item: any) => <article key={item.id}><div className="marketing-employee-avatar">{String(item.full_name || "م").trim().charAt(0)}</div><div><strong>{item.full_name}</strong><p>{number(item.tasks)} تاسك · {number(item.delayed)} متأخر · {number(item.delay_days)} يوم تأخير</p><ProgressBar value={item.progress} /></div><b>{percentage(item.progress)}</b></article>)}</div>
        </section>
      </div>
    </>}
  </MarketingPage>;
}
