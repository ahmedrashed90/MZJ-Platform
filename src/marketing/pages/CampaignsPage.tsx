import { useEffect, useState } from "react";
import { Archive, Eye, MagnifyingGlass, Plus, RocketLaunch } from "@phosphor-icons/react";
import { Link, useSearchParams } from "react-router-dom";
import { marketingFetch, queryString } from "../api";
import type { CampaignRow } from "../types";
import { CampaignDetailView } from "../components/CampaignDetailView";
import { TaskDetailView } from "../components/TaskDetailView";
import { MarketingAlert, MarketingEmpty, MarketingLoading, MarketingModal, MarketingPageHeader, Pagination, ProgressBar, StatusBadge, formatDate, formatMoney } from "../components/Ui";
import { useMarketingMeta } from "../MarketingLayout";

type Payload = { ok: true; rows: CampaignRow[]; total: number; page: number; pageSize: number };

export function CampaignsPage() {
  const { meta } = useMarketingMeta();
  const [params] = useSearchParams();
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selectedId, setSelectedId] = useState(params.get("created") || "");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pageSize = 18;

  async function load() {
    setLoading(true); setError("");
    try {
      const payload = await marketingFetch<Payload>(`/api/marketing?${queryString({ resource: "campaigns", page, pageSize, search, type, status, sourceType, from, to })}`);
      setRows(payload.rows); setTotal(payload.total);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل الحملات"); }
    finally { setLoading(false); }
  }
  useEffect(() => { const timer = window.setTimeout(() => void load(), 240); return () => window.clearTimeout(timer); }, [page, search, type, status, sourceType, from, to]);
  function reset() { setSearch(""); setType(""); setStatus(""); setSourceType(""); setFrom(""); setTo(""); setPage(1); }

  return <div className="marketing-page">
    <MarketingPageHeader title="إدارة الحملات" description="إدارة ومتابعة الحملات والأجندات، تفاصيل الكرييتيف والتوزيع والميزانية والجدول والتقدم." actions={<><button className="marketing-button" onClick={() => setView(view === "cards" ? "table" : "cards")}>{view === "cards" ? "عرض الجدول" : "عرض البطاقات"}</button>{meta.access.campaignsManage ? <Link className="marketing-button primary" to="/marketing/campaigns/new"><Plus />إنشاء حملة</Link> : null}</>} />
    {error ? <MarketingAlert>{error}</MarketingAlert> : null}
    <section className="marketing-panel"><div className="marketing-toolbar"><label className="marketing-field"><span>بحث</span><div style={{ position: "relative" }}><MagnifyingGlass style={{ position: "absolute", right: 10, top: 12 }} /><input style={{ paddingRight: 36 }} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="اسم الحملة أو الكود أو الهدف" /></div></label><label className="marketing-field"><span>نوع الحملة</span><select value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}><option value="">كل الأنواع</option>{meta.campaignTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="marketing-field"><span>المصدر</span><select value={sourceType} onChange={(event) => { setSourceType(event.target.value); setPage(1); }}><option value="">الحملات والأجندات</option><option value="campaign">حملة</option><option value="agenda">أجندة</option></select></label><label className="marketing-field"><span>الحالة</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">كل الحالات</option><option value="draft">مسودة</option><option value="in_progress">جاري العمل</option><option value="ready_for_publish">جاهزة للنشر</option><option value="completed">مكتملة</option><option value="archived">مؤرشفة</option></select></label><label className="marketing-field"><span>من</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label className="marketing-field"><span>إلى</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="marketing-button secondary" type="button" onClick={reset}>تصفير الفلاتر</button></div></section>
    {loading ? <MarketingLoading label="جاري تحميل الحملات..." /> : !rows.length ? <section className="marketing-panel"><MarketingEmpty title="لا توجد حملات مطابقة" description="غيّر الفلاتر أو أنشئ حملة جديدة." /></section> : view === "cards" ? <div className="marketing-grid-3">{rows.map((row) => <article className="marketing-campaign-card" key={row.id} onClick={() => setSelectedId(row.id)}><div className="top"><div><span className="code">{row.campaign_code}</span><h3>{row.name}</h3><small>{row.source_type === "agenda" ? "أجندة" : row.campaign_type}</small></div><StatusBadge status={row.status} type="campaign" /></div><p>{row.objective || "بدون هدف مسجل"}</p><div className="meta"><span>{formatDate(row.campaign_date)}</span><span>{row.creative_count ?? row.creatives_count ?? 0} كرييتيف</span><span>{row.task_count ?? row.tasks_count ?? 0} تاسك</span><span>{formatMoney((row as CampaignRow & { total_budget?: number }).total_budget || 0)}</span></div><ProgressBar value={row.progress_percent} /><div className="departments">{(row.departments || []).map((department) => <span className="marketing-department" key={department.code}>{department.name}</span>)}</div><div className="footer"><span>{formatDate(row.publish_start_date)} — {formatDate(row.publish_end_date)}</span><Eye size={18} /></div></article>)}</div> : <section className="marketing-panel"><div className="marketing-table-wrap"><table className="marketing-table"><thead><tr><th>الكود</th><th>الحملة</th><th>النوع</th><th>الفترة</th><th>الكرييتيف</th><th>التاسكات</th><th>الميزانية</th><th>التقدم</th><th>الحالة</th><th>عرض</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><b>{row.campaign_code}</b></td><td>{row.name}<small style={{ display: "block" }}>{row.objective || "—"}</small></td><td>{row.source_type === "agenda" ? "أجندة" : row.campaign_type}</td><td>{inputRange(row.publish_start_date, row.publish_end_date)}</td><td>{row.creative_count ?? row.creatives_count ?? 0}</td><td>{row.completed_tasks || 0}/{row.task_count ?? row.tasks_count ?? 0}</td><td>{formatMoney((row as CampaignRow & { total_budget?: number }).total_budget || 0)}</td><td style={{ minWidth: 160 }}><ProgressBar compact value={row.progress_percent} /></td><td><StatusBadge status={row.status} type="campaign" /></td><td><button className="marketing-button small" onClick={() => setSelectedId(row.id)}><Eye />تفاصيل</button></td></tr>)}</tbody></table></div></section>}
    <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
    <MarketingModal open={Boolean(selectedId)} title="تفاصيل الحملة" onClose={() => setSelectedId("")} wide>{selectedId ? <CampaignDetailView campaignId={selectedId} onTaskOpen={setSelectedTaskId} onChanged={() => void load()} /> : null}</MarketingModal>
    <MarketingModal open={Boolean(selectedTaskId)} title="تفاصيل التاسك" onClose={() => setSelectedTaskId("")} wide>{selectedTaskId ? <TaskDetailView taskId={selectedTaskId} onChanged={() => void load()} /> : null}</MarketingModal>
  </div>;
}
function inputRange(start?: string | null, end?: string | null) { return `${start ? String(start).slice(0, 10) : "—"} ← ${end ? String(end).slice(0, 10) : "—"}`; }
