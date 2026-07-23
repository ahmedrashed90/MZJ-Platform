import { useEffect, useState } from "react";
import { Archive, ArrowClockwise, Eye, MagnifyingGlass, RocketLaunch } from "@phosphor-icons/react";
import { Link, useSearchParams } from "react-router-dom";
import { formatMarketingDate, marketingFetch, marketingQuery } from "../api";
import type { CampaignSummary } from "../types";
import { MarketingPageHeader } from "../components/MarketingPageHeader";
import { MarketingLoading, MarketingError } from "../components/MarketingLoading";
import { MarketingStatusBadge } from "../components/MarketingStatusBadge";
import { MarketingEmpty } from "../components/MarketingEmpty";

export function CampaignsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [status, setStatus] = useState(searchParams.get("status") || "");
  const [sourceType, setSourceType] = useState(searchParams.get("sourceType") || "");

  async function load() {
    setLoading(true); setError("");
    try {
      const query = marketingQuery({ resource: "campaigns", search, status, sourceType });
      const result = await marketingFetch<{ ok: boolean; campaigns: CampaignSummary[] }>(query);
      setCampaigns(result.campaigns);
      const selectedId = searchParams.get("id");
      if (selectedId) {
        const detail = await marketingFetch<{ ok: boolean; campaign: any }>(`resource=campaign&id=${selectedId}`);
        setSelected(detail.campaign);
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل الحملات"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [searchParams]);

  function applyFilters(event: React.FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams();
    if (search) next.set("search", search);
    if (status) next.set("status", status);
    if (sourceType) next.set("sourceType", sourceType);
    setSearchParams(next);
  }

  async function action(id: string, actionName: "archive" | "release") {
    if (!window.confirm(actionName === "archive" ? "هل تريد أرشفة الحملة؟" : "هل تريد تحرير الحملة للنشر؟")) return;
    try {
      await marketingFetch("resource=campaign-action", { method: "PATCH", body: JSON.stringify({ id, action: actionName }) });
      setSelected(null); setSearchParams((current) => { current.delete("id"); return current; });
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تنفيذ الإجراء"); }
  }

  if (loading && campaigns.length === 0 && !selected) return <MarketingLoading label="جاري تحميل الحملات..." />;

  return (
    <div className="marketing-page">
      <MarketingPageHeader title="إدارة الحملات" description="الحملات والأجندة والتقدم والمهام المرتبطة بها." actions={<Link className="marketing-button" to="/marketing/campaigns/new">إنشاء حملة</Link>} />
      {error ? <MarketingError message={error} onRetry={() => void load()} /> : null}
      <form className="marketing-filter-bar" onSubmit={applyFilters}>
        <label className="marketing-search"><MagnifyingGlass size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث بالاسم أو الكود" /></label>
        <select value={sourceType} onChange={(event) => setSourceType(event.target.value)}><option value="">كل الأنواع</option><option value="campaign">حملات</option><option value="agenda">أجندة</option></select>
        <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">كل الحالات</option><option value="in_progress">جاري العمل</option><option value="ready_for_publish">جاهزة للنشر</option><option value="completed">مكتملة</option><option value="archived">مؤرشفة</option></select>
        <button className="marketing-button compact" type="submit">تطبيق</button>
        <button className="marketing-icon-button" type="button" onClick={() => void load()} title="تحديث"><ArrowClockwise size={18} /></button>
      </form>
      <section className="marketing-panel">
        {campaigns.length ? <div className="marketing-table-wrap"><table className="marketing-table"><thead><tr><th>الحملة</th><th>النوع</th><th>الفترة</th><th>الكرييتيف</th><th>المهام</th><th>التقدم</th><th>الحالة</th><th></th></tr></thead><tbody>{campaigns.map((campaign) => <tr key={campaign.id}><td><strong>{campaign.name}</strong><small>{campaign.campaign_code}</small></td><td>{campaign.source_type === "agenda" ? "أجندة" : "حملة"}</td><td>{formatMarketingDate(campaign.starts_at, false)} — {formatMarketingDate(campaign.ends_at, false)}</td><td>{campaign.creative_count}</td><td>{campaign.completed_task_count}/{campaign.task_count}</td><td><div className="marketing-progress inline"><span><i style={{ width: `${campaign.progress_percent}%` }} /></span><b>{campaign.progress_percent}%</b></div></td><td><MarketingStatusBadge status={campaign.status} /></td><td><button className="marketing-icon-button" type="button" onClick={() => setSearchParams((current) => { current.set("id", campaign.id); return current; })}><Eye size={18} /></button></td></tr>)}</tbody></table></div> : <MarketingEmpty title="لا توجد نتائج" description="غيّر الفلاتر أو أنشئ حملة جديدة." />}
      </section>
      {selected ? <div className="marketing-drawer-backdrop" onMouseDown={() => { setSelected(null); setSearchParams((current) => { current.delete("id"); return current; }); }}><aside className="marketing-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><small>{selected.campaign_code}</small><h2>{selected.name}</h2></div><button type="button" onClick={() => { setSelected(null); setSearchParams((current) => { current.delete("id"); return current; }); }}>×</button></header>
        <div className="marketing-drawer-body">
          <div className="marketing-detail-grid"><article><span>النوع</span><strong>{selected.source_type === "agenda" ? "أجندة" : "حملة"}</strong></article><article><span>الحالة</span><MarketingStatusBadge status={selected.status} /></article><article><span>البداية</span><strong>{formatMarketingDate(selected.starts_at, false)}</strong></article><article><span>النهاية</span><strong>{formatMarketingDate(selected.ends_at, false)}</strong></article></div>
          <section><h3>الهدف</h3><p>{selected.objective || "—"}</p></section>
          <section><h3>المطلوب / Content Brief</h3><p>{selected.content_brief || "—"}</p></section>
          <section><h3>الكرييتيفات</h3><div className="marketing-mini-list">{selected.creatives?.map((item: any) => <article key={item.id}><div><strong>{item.catalog_name || item.creative_type}</strong><span>{item.instance_code}</span></div><MarketingStatusBadge status={item.status} /></article>)}</div></section>
          <section><h3>المهام</h3><div className="marketing-mini-list">{selected.tasks?.map((task: any) => <Link to={`/marketing/tasks?id=${task.id}`} key={task.id}><div><strong>{task.task_type === "content_template" ? "Task Template" : task.department_code}</strong><span>{task.assigned_to_name || "غير مسندة"}</span></div><MarketingStatusBadge status={task.status} /></Link>)}</div></section>
        </div>
        <footer><button className="marketing-button secondary" type="button" onClick={() => void action(selected.id, "archive")}><Archive size={18} />أرشفة</button><button className="marketing-button" type="button" onClick={() => void action(selected.id, "release")}><RocketLaunch size={18} />تحرير للنشر</button></footer>
      </aside></div> : null}
    </div>
  );
}
