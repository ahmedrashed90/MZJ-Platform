import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { CalendarCheck, CheckCircle, ClockCountdown, MegaphoneSimple, Plus, RocketLaunch, WarningCircle } from "@phosphor-icons/react";
import { marketingFetch } from "../api";
import type { MarketingCampaignRow, MarketingTask } from "../types";
import type { MarketingOutletContext } from "../MarketingLayout";
import { formatMarketingDate, statusTone } from "../utils";

type DashboardData = {
  ok: true;
  stats: { campaigns: number; awaiting_structure: number; awaiting_templates: number; ready_execution: number; publishing: number; delayed: number };
  campaigns: MarketingCampaignRow[];
  tasks: MarketingTask[];
};

export function MarketingDashboardPage() {
  const { meta } = useOutletContext<MarketingOutletContext>();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { marketingFetch<DashboardData>("/api/marketing?resource=dashboard").then(setData).catch((failure) => setError(failure.message)); }, []);
  const stats = data?.stats;
  return (
    <div className="module-page marketing-page">
      <header className="module-page-head marketing-page-head">
        <div><span className="marketing-kicker">MZJ MARKETING</span><h1>إدارة التسويق</h1><p>الحملات والكرييتيف والتاسكات وتجهيز النشر داخل فلو واحد معتمد.</p></div>
        {meta.access.canManageCampaigns ? <Link className="marketing-primary-button" to="/marketing/campaigns/new"><Plus size={18} />إنشاء حملة</Link> : null}
      </header>
      {error ? <div className="connection-banner"><WarningCircle size={20} /><span>{error}</span></div> : null}
      <section className="marketing-stat-grid">
        <article><MegaphoneSimple size={25} /><span>إجمالي الحملات</span><b>{stats?.campaigns ?? "—"}</b></article>
        <article><ClockCountdown size={25} /><span>بانتظار اعتماد الهيكل</span><b>{stats?.awaiting_structure ?? "—"}</b></article>
        <article><CalendarCheck size={25} /><span>بانتظار Task Template</span><b>{stats?.awaiting_templates ?? "—"}</b></article>
        <article><CheckCircle size={25} /><span>جاهزة للتنفيذ</span><b>{stats?.ready_execution ?? "—"}</b></article>
        <article><RocketLaunch size={25} /><span>في تجهيز النشر</span><b>{stats?.publishing ?? "—"}</b></article>
        <article className="danger"><WarningCircle size={25} /><span>متأخرة</span><b>{stats?.delayed ?? "—"}</b></article>
      </section>
      <div className="marketing-dashboard-grid">
        <section className="panel marketing-panel">
          <header><div><h2>أحدث الحملات</h2><p>الحالة ونسبة إنجاز التاسكات.</p></div><Link to="/marketing/campaigns">عرض الكل</Link></header>
          <div className="marketing-campaign-list">
            {(data?.campaigns || []).map((campaign) => <Link to={`/marketing/campaigns/${campaign.id}`} key={campaign.id} className="marketing-campaign-row"><div><strong>{campaign.name}</strong><span>{campaign.campaign_code} · {campaign.creatives} كرييتيف</span></div><div className="marketing-row-progress"><span><i style={{ width: `${campaign.progress}%` }} /></span><b>{campaign.progress}%</b></div><em className={`marketing-status ${statusTone(campaign.status)}`}>{campaign.status}</em></Link>)}
            {data && data.campaigns.length === 0 ? <div className="marketing-empty">لا توجد حملات حتى الآن.</div> : null}
          </div>
        </section>
        <section className="panel marketing-panel">
          <header><div><h2>التاسكات الحالية</h2><p>المطلوب منك أو بانتظار الاعتماد.</p></div><Link to="/marketing/tasks">فتح التاسكات</Link></header>
          <div className="marketing-task-mini-list">
            {(data?.tasks || []).map((task) => <Link to={`/marketing/tasks?campaignId=${task.campaign_id}`} key={task.id}><div><strong>{task.title}</strong><span>{task.campaign_name} · {formatMarketingDate(task.due_at, true)}</span></div><em className={`marketing-status ${statusTone(task.status)}`}>{task.status}</em></Link>)}
            {data && data.tasks.length === 0 ? <div className="marketing-empty">لا توجد مهام معلقة.</div> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
