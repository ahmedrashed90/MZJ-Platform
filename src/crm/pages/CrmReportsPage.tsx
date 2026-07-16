import { useEffect, useState } from "react";
import { FilePdf, FileXls, MagnifyingGlass, Users, X } from "@phosphor-icons/react";
import { crmFetch, downloadCsv, formatDate, queryString } from "../api";

const tabs = [
  { key: "sources", label: "تقرير المصدر" },
  { key: "departments", label: "تقرير الأقسام" },
  { key: "agents", label: "تقارير المناديب" },
  { key: "service", label: "تقرير خدمة العملاء" },
] as const;

type TabKey = typeof tabs[number]["key"];

export function CrmReportsPage() {
  const [tab, setTab] = useState<TabKey>("sources");
  const [filters, setFilters] = useState({ from: "", to: "", q: "" });
  const [data, setData] = useState<any | null>(null);
  const [popup, setPopup] = useState<any | null>(null);
  const [popupQ, setPopupQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  useEffect(() => { const timer = setTimeout(() => void load(), 180); return () => clearTimeout(timer); }, [filters]);

  async function load() {
    setLoading(true);
    try { setData(await crmFetch(`/api/crm/reports${queryString(filters)}`)); }
    catch (error) { setNotice(error instanceof Error ? error.message : "تعذر تحميل التقارير"); }
    finally { setLoading(false); }
  }

  const rows = tab === "service" ? (data ? [{ name: "خدمة العملاء", ...data.service }] : []) : (data?.[tab] || []);
  const popupRows = (popup?.customers || []).filter((row: any) => !popupQ || [row.customer_name,row.phone,row.phone_normalized,row.car_name,row.source_name,row.status_label,row.notes].join(" ").toLowerCase().includes(popupQ.toLowerCase()));

  function exportCurrent() {
    downloadCsv(`تقرير-${tabs.find((item) => item.key === tab)?.label}.csv`, rows.map((row: any) => ({
      "الاسم": row.name, "إجمالي العملاء": row.total, "غير مؤهل": row.notQualified, "مؤهل": row.qualified,
      "مؤجل": row.delayed, "محتمل": row.potential, "تم البيع": row.sold,
      "جودة التسويق": `${row.marketingQuality}%`, "جودة المبيعات": `${row.salesQuality}%`,
    })));
  }

  function printCurrent() {
    const win = window.open("", "_blank", "width=1200,height=800");
    if (!win) return;
    const title = tabs.find((item) => item.key === tab)?.label || "التقرير";
    win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:Tajawal,Arial;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px;text-align:center}th{background:#f5e8df}</style></head><body><h1>${title}</h1><p>الفترة: ${filters.from || "—"} إلى ${filters.to || "—"}</p><table><thead><tr><th>الاسم</th><th>إجمالي العملاء</th><th>غير مؤهل</th><th>مؤهل</th><th>مؤجل</th><th>محتمل</th><th>تم البيع</th><th>جودة التسويق</th><th>جودة المبيعات</th></tr></thead><tbody>${rows.map((row: any) => `<tr><td>${row.name}</td><td>${row.total}</td><td>${row.notQualified}</td><td>${row.qualified}</td><td>${row.delayed}</td><td>${row.potential}</td><td>${row.sold}</td><td>${row.marketingQuality}%</td><td>${row.salesQuality}%</td></tr>`).join("")}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`);
    win.document.close();
  }

  return (
    <div className="crm-page crm-reports-page">
      <header className="crm-page-head"><div><h1>التقارير</h1><p>المصدر والأقسام والمناديب وخدمة العملاء بنفس قاعدة البيانات والفلاتر.</p></div><div className="crm-head-actions"><button className="crm-secondary-button" onClick={exportCurrent}><FileXls size={18} />تصدير Excel</button><button className="crm-secondary-button" onClick={printCurrent}><FilePdf size={18} />تصدير PDF</button></div></header>
      <div className="crm-department-tabs report-tabs">{tabs.map((item) => <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}>{item.label}</button>)}</div>
      <div className="crm-filter-panel reports"><label><span>من تاريخ</span><input type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} /></label><label><span>إلى تاريخ</span><input type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} /></label><label className="crm-search-box wide"><MagnifyingGlass size={18} /><input value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} placeholder="بحث بالاسم / الجوال / السيارة / المصدر" /></label><button className="crm-secondary-button" onClick={() => setFilters({ from: "", to: "", q: "" })}>مسح الفلتر</button></div>
      {notice ? <div className="crm-inline-notice">{notice}</div> : null}
      {data ? <div className="crm-report-summary"><div><span>إجمالي العملاء</span><strong>{data.totals.total}</strong></div><div><span>جودة التسويق</span><strong>{data.totals.marketingQuality}%</strong></div><div><span>جودة المبيعات</span><strong>{data.totals.salesQuality}%</strong></div><div><span>تم البيع</span><strong>{data.totals.sold}</strong></div></div> : null}
      <div className="crm-table-shell"><table className="crm-table reports"><thead><tr><th>{tab === "sources" ? "المصدر" : tab === "departments" ? "القسم / الفرع" : tab === "agents" ? "المندوب" : "القسم"}</th><th>إجمالي العملاء</th><th>غير مؤهل</th><th>مؤهل</th><th>مؤجل</th><th>محتمل</th><th>تم البيع</th><th>جودة التسويق</th><th>جودة المبيعات</th><th>تقارير العملاء</th></tr></thead><tbody>{rows.map((row: any) => <tr key={row.name}><td><strong>{row.name}</strong>{tab === "service" ? <small>جاري العمل: {row.working} - تم الانتهاء: {row.done}</small> : null}</td><td>{row.total}</td><td>{row.notQualified}</td><td>{row.qualified}</td><td>{row.delayed}</td><td>{row.potential}</td><td>{row.sold}</td><td><span className="crm-quality-pill">{row.marketingQuality}%</span></td><td><span className="crm-quality-pill sales">{row.salesQuality}%</span></td><td><button className="crm-table-button" onClick={() => { setPopup(row); setPopupQ(""); }}><Users size={16} />تقارير العملاء</button></td></tr>)}{!loading && !rows.length ? <tr><td colSpan={10}><div className="crm-empty-state">لا توجد بيانات ضمن الفترة المحددة</div></td></tr> : null}{loading ? <tr><td colSpan={10}><div className="crm-empty-state">جاري تحميل التقارير...</div></td></tr> : null}</tbody></table></div>

      {popup ? <div className="crm-modal-backdrop" onMouseDown={() => setPopup(null)}><div className="crm-modal-card report-customers-modal" onMouseDown={(event) => event.stopPropagation()}><header><div><h2>تقرير عملاء: {popup.name}</h2><p>عدد النتائج الحالية: {popupRows.length}</p></div><button className="crm-icon-button" onClick={() => setPopup(null)}><X size={18} /></button></header><div className="crm-toolbar compact"><label className="crm-search-box wide"><MagnifyingGlass size={17} /><input value={popupQ} onChange={(event) => setPopupQ(event.target.value)} placeholder="اكتب حالة أو ملاحظة أو اسم عميل" /></label></div><div className="crm-table-shell popup-table"><table className="crm-table"><thead><tr><th>اسم العميل</th><th>الجوال</th><th>السيارة</th><th>المصدر</th><th>الفرع</th><th>الحالة</th><th>التحديثات</th><th>تاريخ التسجيل</th><th>آخر تحديث</th></tr></thead><tbody>{popupRows.map((row: any) => <tr key={row.id}><td>{row.customer_name || "—"}</td><td>{row.phone || row.phone_normalized || "—"}</td><td>{row.car_name || "—"}</td><td>{row.source_name || "—"}</td><td>{row.branch_name || row.branch_code || "—"}</td><td>{row.status_label || "—"}</td><td>{row.status_note || row.notes || "—"}</td><td>{formatDate(row.created_at)}</td><td>{formatDate(row.updated_at)}</td></tr>)}</tbody></table></div></div></div> : null}
    </div>
  );
}
