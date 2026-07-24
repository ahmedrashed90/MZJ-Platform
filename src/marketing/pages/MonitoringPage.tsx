import { useEffect, useState } from "react";
import { ClockCountdown, WarningCircle } from "@phosphor-icons/react";
import { marketingDate, marketingFetch, marketingQuery } from "../api";
import { MarketingAlert, MarketingPage, ProgressBar } from "../components/MarketingPage";

export function MonitoringPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => { marketingFetch<any>(`/api/marketing${marketingQuery({ resource: "monitoring" })}`).then(setData).catch((failure) => setError(failure instanceof Error ? failure.message : "تعذر تحميل المتابعة")); }, []);
  const totals = data?.totals || {};
  return <MarketingPage title="المتابعة" description="مؤشرات الحملات والتاسكات والتأخير وأداء الأقسام والموظفين.">
    {error ? <MarketingAlert>{error}</MarketingAlert> : null}
    {!data ? <div className="marketing-empty">جاري تحميل المتابعة...</div> : <>
      <div className="marketing-stats eight"><article><small>إجمالي الحملات</small><strong>{totals.campaigns || 0}</strong></article><article><small>الحملات النشطة</small><strong>{totals.active_campaigns || 0}</strong></article><article><small>إجمالي الأجندات</small><strong>{totals.agendas || 0}</strong></article><article><small>إجمالي التاسكات</small><strong>{totals.tasks || 0}</strong></article><article className="danger"><small>التاسكات المتأخرة</small><strong>{totals.delayed || 0}</strong></article><article><small>في قائمة الانتظار</small><strong>{totals.waiting || 0}</strong></article><article><small>التاسكات النشطة</small><strong>{totals.active || 0}</strong></article><article><small>نسبة الإنجاز العامة</small><strong>{Number(totals.progress || 0).toLocaleString("ar-SA", { maximumFractionDigits: 1 })}%</strong></article></div>
      <div className="marketing-monitor-grid"><section className="panel"><h2>عدد التاسكات في كل حالة</h2><div className="marketing-status-bars">{data.statuses.map((item: any) => <div key={item.status}><span>{item.status}</span><ProgressBar value={totals.tasks ? (item.count / totals.tasks) * 100 : 0} /><b>{item.count}</b></div>)}</div></section><section className="panel"><h2>نسبة اكتمال كل حملة</h2><div className="marketing-status-bars">{data.entities.map((item: any) => <div key={`${item.source_type}-${item.id}`}><span>{item.name}</span><ProgressBar value={item.progress} /><b>{Number(item.progress).toLocaleString("ar-SA", { maximumFractionDigits: 1 })}%</b></div>)}</div></section></div>
      <section className="panel marketing-table-panel"><h2><WarningCircle size={21} />التاسكات المتأخرة</h2><div className="marketing-table-wrap"><table><thead><tr><th>الحملة أو الأجندة</th><th>التاسك</th><th>الموظف</th><th>القسم</th><th>موعد التسليم</th><th>أيام التأخير</th><th>التقدم</th></tr></thead><tbody>{data.delayed.map((item: any) => <tr key={item.id}><td>{item.source_name}</td><td>{item.title}</td><td>{item.full_name}</td><td>{item.department_name || "قسم المحتوى"}</td><td>{marketingDate(item.due_at)}</td><td><span className="danger-text">{item.delay_days}</span></td><td>{Number(item.progress).toLocaleString("ar-SA")}%</td></tr>)}{!data.delayed.length ? <tr><td colSpan={7}>لا توجد تاسكات متأخرة.</td></tr> : null}</tbody></table></div></section>
      <div className="marketing-monitor-grid"><section className="panel"><h2>أداء كل قسم</h2><div className="marketing-performance-list">{data.departments.map((item: any) => <article key={item.id}><div><strong>{item.name}</strong><span>{item.tasks} تاسك</span></div><ProgressBar value={item.progress} /></article>)}</div></section><section className="panel"><h2>أداء كل موظف</h2><div className="marketing-performance-list">{data.employees.map((item: any) => <article key={item.id}><div><strong>{item.full_name}</strong><span>{item.tasks} تاسك · {item.delayed} متأخر · {item.delay_days} يوم تأخير</span></div><ProgressBar value={item.progress} /></article>)}</div></section></div>
    </>}
  </MarketingPage>;
}
