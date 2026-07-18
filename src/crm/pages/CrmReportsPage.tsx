import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, FilePdf, FileXls, MagnifyingGlass, Users, X } from "@phosphor-icons/react";
import { useEscapeToClose } from "../../components/useEscapeToClose";
import { crmFetch, downloadCsv, formatDate, queryString } from "../api";
import { sourceLabel } from "../sourceCatalog";
import type { CrmMeta } from "../types";

type ReportRow = {
  name: string;
  total: number;
  notQualified: number;
  qualified: number;
  delayed: number;
  potential: number;
  sold: number;
  marketingQuality: number;
  salesQuality: number;
  working?: number;
  done?: number;
  customers?: any[];
};

const emptyFilters = { from: "", to: "", department: "", branch: "", agent: "", callCenter: "", source: "", q: "" };

function reportExportRows(section: string, rows: ReportRow[]) {
  return rows.map((row) => ({
    "القسم بالتقرير": section,
    "الاسم": row.name,
    "إجمالي العملاء": row.total,
    "غير مؤهل": row.notQualified,
    "مؤهل": row.qualified,
    "مؤجل": row.delayed,
    "محتمل": row.potential,
    "تم البيع": row.sold,
    "جودة التسويق": `${row.marketingQuality}%`,
    "جودة المبيعات": `${row.salesQuality}%`,
  }));
}

export function CrmReportsPage() {
  const [meta, setMeta] = useState<CrmMeta | null>(null);
  const [filters, setFilters] = useState(emptyFilters);
  const [data, setData] = useState<any | null>(null);
  const [popup, setPopup] = useState<ReportRow | null>(null);
  const [popupQ, setPopupQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  useEscapeToClose(Boolean(popup), () => setPopup(null));

  useEffect(() => {
    void crmFetch<CrmMeta>("/api/crm/meta").then(setMeta).catch((error) => setNotice(error.message));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [filters]);

  async function load() {
    setLoading(true);
    try {
      setData(await crmFetch(`/api/crm/reports${queryString(filters)}`));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل التقارير");
    } finally {
      setLoading(false);
    }
  }

  const salesUsers = useMemo(() => (meta?.users || []).filter((user) => user.department_codes.some((code) => ["cash_sales", "finance_sales", "customer_service"].includes(code))), [meta]);
  const callCenterUsers = useMemo(() => (meta?.users || []).filter((user) => user.department_codes.includes("call_center")), [meta]);
  const popupRows = (popup?.customers || []).filter((row: any) => !popupQ || [row.customer_name, row.phone, row.phone_normalized, row.car_name, row.source_name, row.status_label, row.notes].join(" ").toLowerCase().includes(popupQ.toLowerCase()));

  const sections: Array<{ title: string; rows: ReportRow[]; firstColumn: string; description: string }> = [
    { title: "تقرير المصدر", rows: data?.sources || [], firstColumn: "المصدر", description: "توزيع العملاء حسب مصدر الدخول الفعلي بالعربي." },
    { title: "تقرير الأقسام والفروع", rows: data?.departments || [], firstColumn: "القسم / الفرع", description: "إجمالي الحالات حسب القسم والفرع." },
    { title: "تقارير المناديب", rows: data?.agents || [], firstColumn: "المندوب", description: "أرقام كل مندوب مع فتح تقرير العملاء المرتبطين به." },
    { title: "تقارير مناديب الكول سنتر", rows: data?.callCenter || [], firstColumn: "مندوب الكول سنتر", description: "مجموعة مستقلة للكول سنتر بدون تغيير إجماليات الأقسام." },
    { title: "تقرير خدمة العملاء", rows: data?.service ? [data.service] : [], firstColumn: "القسم", description: "متابعة جاري العمل وتم الانتهاء داخل خدمة العملاء." },
  ];

  function setFilter(key: keyof typeof emptyFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function exportAll() {
    const rows = sections.flatMap((section) => reportExportRows(section.title, section.rows));
    downloadCsv("تقارير-CRM.csv", rows);
  }

  function printAll() {
    const win = window.open("", "_blank", "width=1400,height=900");
    if (!win) return;
    const sectionHtml = sections.map((section) => `
      <section><h2>${section.title}</h2><table><thead><tr><th>${section.firstColumn}</th><th>إجمالي العملاء</th><th>غير مؤهل</th><th>مؤهل</th><th>مؤجل</th><th>محتمل</th><th>تم البيع</th><th>جودة التسويق</th><th>جودة المبيعات</th></tr></thead><tbody>
      ${section.rows.map((row) => `<tr><td>${row.name}</td><td>${row.total}</td><td>${row.notQualified}</td><td>${row.qualified}</td><td>${row.delayed}</td><td>${row.potential}</td><td>${row.sold}</td><td>${row.marketingQuality}%</td><td>${row.salesQuality}%</td></tr>`).join("")}
      </tbody></table></section>`).join("");
    win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقارير CRM</title><style>body{font-family:Tajawal,Arial;padding:22px;color:#38231d}h1{margin-bottom:4px}h2{margin-top:26px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #dbc8bd;padding:7px;text-align:center}th{background:#f5e8df}section{break-inside:avoid}</style></head><body><h1>تقارير CRM</h1><p>الفترة: ${filters.from || "—"} إلى ${filters.to || "—"}</p>${sectionHtml}<script>window.onload=()=>window.print()</script></body></html>`);
    win.document.close();
  }

  return (
    <div className="crm-page crm-reports-page">
      <header className="crm-page-head">
        <div><h1>التقارير</h1><p>صفحة واحدة تشمل المؤشرات والمصادر والأقسام والمناديب وخدمة العملاء بنفس الفلاتر.</p></div>
        <div className="crm-head-actions">
          <button className="crm-secondary-button" onClick={exportAll}><FileXls size={18} />تصدير Excel</button>
          <button className="crm-secondary-button" onClick={printAll}><FilePdf size={18} />تصدير PDF</button>
          <button className="crm-primary-button" onClick={() => void load()}><ArrowClockwise size={18} />تحديث</button>
        </div>
      </header>

      <div className="crm-filter-panel reports crm-reports-filter-panel">
        <label><span>من تاريخ</span><input type="date" value={filters.from} onChange={(event) => setFilter("from", event.target.value)} /></label>
        <label><span>إلى تاريخ</span><input type="date" value={filters.to} onChange={(event) => setFilter("to", event.target.value)} /></label>
        <label><span>القسم</span><select value={filters.department} onChange={(event) => setFilter("department", event.target.value)}><option value="">كل الأقسام</option><option value="cash_sales">مبيعات الكاش</option><option value="finance_sales">مبيعات التمويل</option><option value="customer_service">خدمة العملاء</option><option value="call_center">كول سنتر</option></select></label>
        <label><span>الفرع</span><select value={filters.branch} onChange={(event) => setFilter("branch", event.target.value)}><option value="">كل الفروع</option>{(meta?.branches || []).map((branch) => <option key={branch.code} value={branch.code}>{branch.name}</option>)}</select></label>
        <label><span>المندوب</span><select value={filters.agent} onChange={(event) => setFilter("agent", event.target.value)}><option value="">كل المناديب</option>{salesUsers.map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}</select></label>
        <label><span>الكول سنتر</span><select value={filters.callCenter} onChange={(event) => setFilter("callCenter", event.target.value)}><option value="">كل مناديب الكول سنتر</option>{callCenterUsers.map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}</select></label>
        <label><span>المصدر</span><select value={filters.source} onChange={(event) => setFilter("source", event.target.value)}><option value="">كل المصادر</option>{(meta?.sources || []).map((source) => <option key={source.code} value={source.code}>{sourceLabel(source.code, source.name)}</option>)}</select></label>
        <label className="crm-search-box wide"><MagnifyingGlass size={18} /><input value={filters.q} onChange={(event) => setFilter("q", event.target.value)} placeholder="بحث بالاسم أو الجوال أو السيارة أو المصدر" /></label>
        <button className="crm-secondary-button" onClick={() => setFilters(emptyFilters)}>مسح الفلاتر</button>
      </div>

      {notice ? <div className="crm-inline-notice">{notice}</div> : null}
      {loading ? <div className="crm-loading-panel">جاري تحميل التقارير...</div> : null}

      {data ? (
        <section className="crm-report-summary crm-report-summary-eight">
          <article><span>جودة التسويق</span><strong>{data.totals.marketingQuality}%</strong></article>
          <article><span>إجمالي العملاء</span><strong>{data.totals.total}</strong></article>
          <article><span>غير مؤهل</span><strong>{data.totals.notQualified}</strong></article>
          <article><span>مؤهل</span><strong>{data.totals.qualified}</strong></article>
          <article><span>مؤجل</span><strong>{data.totals.delayed}</strong></article>
          <article><span>محتمل</span><strong>{data.totals.potential}</strong></article>
          <article><span>تم البيع</span><strong>{data.totals.sold}</strong></article>
          <article><span>جودة المبيعات</span><strong>{data.totals.salesQuality}%</strong></article>
        </section>
      ) : null}

      <div className="crm-report-sections">
        {sections.map((section) => (
          <section className="crm-panel crm-report-section" key={section.title}>
            <header><div><h2>{section.title}</h2><p>{section.description}</p></div><span>{section.rows.length} صف</span></header>
            <div className="crm-table-shell">
              <table className="crm-table reports">
                <thead><tr><th>{section.firstColumn}</th><th>إجمالي العملاء</th><th>غير مؤهل</th><th>مؤهل</th><th>مؤجل</th><th>محتمل</th><th>تم البيع</th><th>جودة التسويق</th><th>جودة المبيعات</th><th>تقارير العملاء</th></tr></thead>
                <tbody>
                  {section.rows.map((row) => (
                    <tr key={`${section.title}-${row.name}`}>
                      <td><strong>{row.name}</strong>{section.title === "تقرير خدمة العملاء" ? <small>جاري العمل: {row.working || 0} - تم الانتهاء: {row.done || 0}</small> : null}</td>
                      <td>{row.total}</td><td>{row.notQualified}</td><td>{row.qualified}</td><td>{row.delayed}</td><td>{row.potential}</td><td>{row.sold}</td>
                      <td><span className="crm-quality-pill">{row.marketingQuality}%</span></td>
                      <td><span className="crm-quality-pill sales">{row.salesQuality}%</span></td>
                      <td><button className="crm-table-button" onClick={() => { setPopup(row); setPopupQ(""); }}><Users size={16} />تقارير العملاء</button></td>
                    </tr>
                  ))}
                  {!loading && !section.rows.length ? <tr><td colSpan={10}><div className="crm-empty-state">لا توجد بيانات ضمن الفلاتر المحددة</div></td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      {popup ? (
        <div className="crm-modal-backdrop" onMouseDown={() => setPopup(null)}>
          <div className="crm-modal-card report-customers-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><h2>تقرير عملاء: {popup.name}</h2><p>عدد النتائج الحالية: {popupRows.length}</p></div><button className="crm-icon-button" onClick={() => setPopup(null)}><X size={18} /></button></header>
            <div className="crm-toolbar compact"><label className="crm-search-box wide"><MagnifyingGlass size={17} /><input value={popupQ} onChange={(event) => setPopupQ(event.target.value)} placeholder="اكتب حالة أو ملاحظة أو اسم عميل" /></label></div>
            <div className="crm-table-shell popup-table"><table className="crm-table"><thead><tr><th>اسم العميل</th><th>الجوال</th><th>السيارة</th><th>المصدر</th><th>الفرع</th><th>الحالة</th><th>التحديثات</th><th>تاريخ التسجيل</th><th>آخر تحديث</th></tr></thead><tbody>{popupRows.map((row: any) => <tr key={row.id}><td>{row.customer_name || "—"}</td><td>{row.phone || row.phone_normalized || "—"}</td><td>{row.car_name || "—"}</td><td>{sourceLabel(row.source_code, row.source_name)}</td><td>{row.branch_name || row.branch_code || "—"}</td><td>{row.status_label || "—"}</td><td>{row.status_note || row.notes || "—"}</td><td>{formatDate(row.created_at)}</td><td>{formatDate(row.updated_at)}</td></tr>)}</tbody></table></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
