import { useEffect, useMemo, useState } from "react";
import { Archive, ArrowClockwise, Database, Eye, FileXls, MagnifyingGlass, Trash } from "@phosphor-icons/react";
import { exportXlsx } from "../../operations/excel";
import { formatMarketingDate, marketingFetch, marketingPost, marketingQuery } from "../api";
import { useMarketing } from "../MarketingContext";
import type { CampaignSummary, MarketingCampaignList } from "../types";
import { CampaignDetailModal } from "./CampaignDetailModal";

export function CampaignListView({ mode }: { mode: "database" | "management" }) {
  const { meta } = useMarketing();
  const [rows, setRows] = useState<CampaignSummary[]>([]);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [archive, setArchive] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await marketingFetch<MarketingCampaignList>(`/api/marketing${marketingQuery({ action: "campaigns", search, kind, status, archive: archive ? 1 : 0 })}`);
      setRows(payload.rows);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل الحملات والأجندات");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [archive]);
  const sorted = useMemo(() => [...rows].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), [rows]);

  const action = async (campaignId: string, campaignAction: "archive" | "restore" | "delete") => {
    if (campaignAction === "delete" && !window.confirm("سيتم حذف السجل من نظام التسويق. هل أنت متأكد؟")) return;
    try {
      await marketingPost({ action: "campaign_action", campaignId, campaignAction });
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "تعذر تنفيذ الإجراء");
    }
  };

  const exportRows = () => exportXlsx(
    archive ? "marketing-archive.xlsx" : "marketing-database.xlsx",
    ["م", "التاريخ", "الكود", "الاسم", "النوع", "نوع المصدر", "الهدف", "بداية النشر", "نهاية النشر", "الحالة", "التقدم", "التاسكات"],
    sorted.map((row, index) => [index + 1, formatMarketingDate(row.campaign_date), row.campaign_code, row.name, row.campaign_type || "", row.source_kind === "agenda" ? "أجندة" : "حملة", row.objective || "", row.publish_start, row.publish_end, row.status, `${Math.round(row.progress)}%`, row.tasks_count]),
    archive ? "الأرشيف" : "قاعدة البيانات",
  );

  return <div className="marketing-page">
    <header className="marketing-page-title"><div><h2>{mode === "database" ? "قاعدة البيانات" : "إدارة الحملات"}</h2><p>{mode === "database" ? "جدول بيانات الحملات والأجندات وملفات النتائج وروابط المنصات والأرشفة." : "عرض وإدارة الحملات والأجندات وتفاصيل الكرييتيفات والتاسكات والملفات."}</p></div><div className="marketing-title-actions"><button type="button" onClick={() => void load()}><ArrowClockwise />تحديث</button><button type="button" onClick={exportRows}><FileXls />تصدير Excel</button></div></header>
    <section className="marketing-filter-bar">
      <label className="marketing-search"><MagnifyingGlass /><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} placeholder="بحث بالاسم أو الكود..." /></label>
      <select value={kind} onChange={(event) => setKind(event.target.value)}><option value="">كل المصادر</option><option value="campaign">الحملات</option><option value="agenda">الأجندات</option></select>
      <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">كل الحالات</option><option value="active">نشطة</option><option value="publish">قسم النشر</option><option value="completed">مكتملة</option></select>
      <button type="button" className="primary" onClick={() => void load()}>بحث</button>
      <button type="button" className={archive ? "active" : ""} onClick={() => setArchive((value) => !value)}><Archive />{archive ? "عرض البيانات" : "الأرشيف"}</button>
    </section>
    {error ? <div className="marketing-error">{error}</div> : null}
    <section className="marketing-table-panel">
      <div className="marketing-table-scroll"><table><thead><tr><th>م</th><th>التاريخ</th><th>كود الحملة</th><th>اسم الحملة</th><th>نوع الحملة</th><th>الهدف من الحملة</th><th>تاريخ بداية الحملة</th><th>تاريخ نهاية الحملة</th><th>التقدم</th><th>عرض البيانات</th><th>إجراءات</th></tr></thead><tbody>
        {sorted.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td>{formatMarketingDate(row.campaign_date)}</td><td><strong>{row.campaign_code}</strong><small>{row.source_kind === "agenda" ? "أجندة" : "حملة"}</small></td><td>{row.name}</td><td>{row.campaign_type || (row.source_kind === "agenda" ? "أجندة" : "—")}</td><td>{row.objective || "—"}</td><td>{formatMarketingDate(row.publish_start)}</td><td>{formatMarketingDate(row.publish_end)}</td><td><div className="marketing-mini-progress"><span style={{ width: `${Math.min(100, Math.max(0, row.progress))}%` }} /><b>{Math.round(row.progress)}%</b></div></td><td><button type="button" onClick={() => setSelected(row.id)}><Eye />عرض البيانات</button></td><td><div className="marketing-row-actions">{archive ? <button type="button" onClick={() => void action(row.id, "restore")}><Archive />استرجاع</button> : <button type="button" onClick={() => void action(row.id, "archive")}><Archive />أرشيف</button>}{meta?.permissions.manageCampaigns ? <button type="button" className="danger" onClick={() => void action(row.id, "delete")}><Trash />مسح</button> : null}</div></td></tr>)}
      </tbody></table></div>
      {!loading && !sorted.length ? <div className="marketing-empty"><Database size={32} />لا توجد سجلات مطابقة.</div> : null}
      {loading ? <div className="marketing-loading">جاري تحميل البيانات...</div> : null}
    </section>
    <CampaignDetailModal campaignId={selected} onClose={() => setSelected(null)} onChanged={() => void load()} />
  </div>;
}
