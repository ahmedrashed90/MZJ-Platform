import { useEffect, useState } from "react";
import { CalendarCheck, CheckCircle, ClockCountdown, Megaphone, TrendUp, Warning } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { marketingFetch, formatMarketingDate } from "../api";
import type { DashboardResponse } from "../types";
import { MarketingPageHeader } from "../components/MarketingPageHeader";
import { MarketingLoading, MarketingError } from "../components/MarketingLoading";
import { MarketingStatusBadge } from "../components/MarketingStatusBadge";
import { MarketingEmpty } from "../components/MarketingEmpty";

export function MarketingDashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true); setError("");
    try { setData(await marketingFetch<DashboardResponse>("resource=dashboard")); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل لوحة التسويق"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  if (loading && !data) return <MarketingLoading />;
  if (!data) return <MarketingError message={error || "تعذر تحميل لوحة التسويق"} onRetry={() => void load()} />;

  const cards = [
    { label: "إجمالي الحملات", value: data.campaignStats.total, icon: Megaphone, tone: "brown" },
    { label: "إجمالي المهام", value: data.taskStats.total, icon: CalendarCheck, tone: "purple" },
    { label: "جاهز للنشر", value: data.campaignStats.ready, icon: CheckCircle, tone: "green" },
    { label: "مهام متأخرة", value: data.campaignStats.delayed, icon: Warning, tone: "orange" },
  ];

  return (
    <div className="marketing-page">
      <MarketingPageHeader
        title="لوحة تحكم التسويق"
        description="متابعة الحملات والأجندة والمهام والجاهزية للنشر من مصدر واحد."
        actions={<><Link className="marketing-button secondary" to="/marketing/agendas/new">أجندة جديدة</Link><Link className="marketing-button" to="/marketing/campaigns/new">حملة جديدة</Link></>}
      />
      {error ? <MarketingError message={error} onRetry={() => void load()} /> : null}
      <section className="marketing-kpis">
        {cards.map(({ label, value, icon: Icon, tone }) => <article key={label} className="marketing-kpi"><span data-tone={tone}><Icon size={26} weight="duotone" /></span><div><small>{label}</small><strong>{value ?? 0}</strong></div></article>)}
      </section>
      <section className="marketing-dashboard-grid">
        <article className="marketing-panel">
          <div className="marketing-panel-title"><div><TrendUp size={21} /><h2>أحدث الحملات</h2></div><Link to="/marketing/campaigns">عرض الكل</Link></div>
          {data.campaigns.length ? <div className="marketing-campaign-list">{data.campaigns.map((campaign) => (
            <Link key={campaign.id} to={`/marketing/campaigns?id=${campaign.id}`} className="marketing-campaign-row">
              <div><strong>{campaign.name}</strong><span>{campaign.campaign_code} · {campaign.source_type === "agenda" ? "أجندة" : "حملة"}</span></div>
              <div className="marketing-progress"><span><i style={{ width: `${campaign.progress_percent || 0}%` }} /></span><b>{campaign.progress_percent || 0}%</b></div>
              <MarketingStatusBadge status={campaign.status} />
            </Link>
          ))}</div> : <MarketingEmpty title="لا توجد حملات بعد" description="ابدأ بإنشاء أول حملة أو أجندة." />}
        </article>
        <article className="marketing-panel">
          <div className="marketing-panel-title"><div><ClockCountdown size={21} /><h2>المهام الحالية</h2></div><Link to="/marketing/tasks">عرض الكل</Link></div>
          {data.tasks.length ? <div className="marketing-task-list">{data.tasks.map((task) => (
            <Link key={task.id} to={`/marketing/tasks?id=${task.id}`} className="marketing-task-row">
              <div><strong>{task.creative_type || "مهمة تسويق"}</strong><span>{task.campaign_name} · {task.assigned_to_name || "غير مسندة"}</span></div>
              <div><MarketingStatusBadge status={task.status} /><small>{formatMarketingDate(task.due_at)}</small></div>
            </Link>
          ))}</div> : <MarketingEmpty title="لا توجد مهام حالية" />}
        </article>
      </section>
      <section className="marketing-panel">
        <div className="marketing-panel-title"><div><Warning size={21} /><h2>المهام المتأخرة</h2></div></div>
        {data.lateTasks.length ? <div className="marketing-table-wrap"><table className="marketing-table"><thead><tr><th>الحملة</th><th>الكرييتيف</th><th>المسؤول</th><th>موعد التسليم</th><th>الحالة</th></tr></thead><tbody>{data.lateTasks.map((task) => <tr key={task.id}><td><strong>{task.campaign_name}</strong><small>{task.campaign_code}</small></td><td>{task.creative_type || "—"}</td><td>{task.assigned_to_name || "—"}</td><td>{formatMarketingDate(task.due_at)}</td><td><MarketingStatusBadge status={task.status} /></td></tr>)}</tbody></table></div> : <MarketingEmpty title="لا توجد مهام متأخرة" description="كل المواعيد الحالية ضمن النطاق." />}
      </section>
    </div>
  );
}
