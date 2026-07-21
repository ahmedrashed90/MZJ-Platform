import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, FilePdf, FileXls, MagnifyingGlass, Users, X } from "@phosphor-icons/react";
import { useEscapeToClose } from "../../components/useEscapeToClose";
import { crmFetch, formatDate, queryString } from "../api";
import { sourceLabel } from "../sourceCatalog";
import type { CrmMeta } from "../types";
import { downloadXlsx } from "../xlsx";

type ReportRow = {
  name: string;
  total: number;
  notContacted: number;
  notQualified: number;
  qualified: number;
  delayed: number;
  potential: number;
  sold: number;
  marketingQuality: number;
  salesQuality: number;
  working?: number;
  done?: number;
  detailKind: "source" | "department_branch" | "agent" | "service";
  detailValue: string;
};

type ReportSection = { title: string; rows: ReportRow[]; firstColumn: string; description: string };

const emptyFilters = { from: "", to: "", department: "", branch: "", agent: "", callCenter: "", source: "", q: "" };
const summaryCards = {
  marketing: { label: "جودة التسويق", field: "marketingQuality", suffix: "%" },
  total: { label: "إجمالي العملاء", field: "total", suffix: "" },
  notContacted: { label: "لم يتم الاتصال", field: "notContacted", suffix: "" },
  waste: { label: "غير مؤهل", field: "notQualified", suffix: "" },
  qualified: { label: "مؤهل", field: "qualified", suffix: "" },
  delayed: { label: "مؤجل", field: "delayed", suffix: "" },
  potential: { label: "لم يتم الرد", field: "potential", suffix: "" },
  sold: { label: "تم البيع", field: "sold", suffix: "" },
  sales: { label: "جودة المبيعات", field: "salesQuality", suffix: "%" },
} as const;

function htmlEscape(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function reportExportRows(section: string, rows: ReportRow[]) {
  return rows.map((row) => ({
    "القسم بالتقرير": section,
    "الاسم": row.name,
    "إجمالي العملاء": row.total,
    "لم يتم الاتصال": row.notContacted,
    "غير مؤهل": row.notQualified,
    "مؤهل": row.qualified,
    "مؤجل": row.delayed,
    "لم يتم الرد": row.potential,
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
  const [popupRows, setPopupRows] = useState<any[]>([]);
  const [popupTotal, setPopupTotal] = useState(0);
  const [popupPage, setPopupPage] = useState(1);
  const [popupLoading, setPopupLoading] = useState(false);
  const popupPageSize = 100;
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

  useEffect(() => {
    if (!popup) return;
    const timer = window.setTimeout(() => void loadPopup(), 180);
    return () => window.clearTimeout(timer);
  }, [popup, popupQ, popupPage, filters]);

  async function load() {
    setLoading(true);
    setNotice("");
    try {
      setData(await crmFetch(`/api/crm/reports${queryString(filters)}`));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل التقارير");
    } finally {
      setLoading(false);
    }
  }

  async function loadPopup() {
    if (!popup) return;
    setPopupLoading(true);
    try {
      const result = await crmFetch<{ ok: boolean; rows: any[]; total: number }>(`/api/crm/reports${queryString({ ...filters, detailKind: popup.detailKind, detailValue: popup.detailValue, detailQ: popupQ, detailPage: popupPage, detailPageSize: popupPageSize })}`);
      setPopupRows(result.rows || []);
      setPopupTotal(Number(result.total || 0));
    } catch (error) {
      setPopupRows([]);
      setPopupTotal(0);
      setNotice(error instanceof Error ? error.message : "تعذر تحميل عملاء التقرير");
    } finally {
      setPopupLoading(false);
    }
  }

  function openPopup(row: ReportRow) {
    setPopup(row);
    setPopupQ("");
    setPopupPage(1);
    setPopupRows([]);
    setPopupTotal(0);
  }

  const salesUsers = useMemo(() => (meta?.users || []).filter((user) => user.department_codes.some((code) => ["cash_sales", "finance_sales", "customer_service"].includes(code))), [meta]);
  const callCenterUsers = useMemo(() => (meta?.users || []).filter((user) => user.department_codes.includes("call_center")), [meta]);
  const sections: ReportSection[] = [
    { title: "مصادر التسويق الرقمي", rows: data?.digitalSources || [], firstColumn: "المصدر", description: "المصادر الرقمية المصنفة من إعدادات المصدر، بما فيها حاسبة التقسيط واتصال الرقم الموحد." },
    { title: "مصادر التسويق المباشر", rows: data?.directSources || [], firstColumn: "المصدر", description: "المصادر المباشرة المعتمدة في قاعدة البيانات بدون تصنيف نصي داخل الواجهة." },
    ...(data?.otherSources?.length ? [{ title: "مصادر أخرى", rows: data.otherSources, firstColumn: "المصدر", description: "مصادر لم يتم تصنيفها بعد كرقمية أو مباشرة." }] : []),
    { title: "تقرير الأقسام والفروع", rows: data?.departments || [], firstColumn: "القسم / الفرع", description: "إجمالي حالات المبيعات حسب القسم والفرع." },
    { title: "تقارير المناديب", rows: data?.agents || [], firstColumn: "المندوب", description: "أرقام كل مندوب مبيعات مع فتح تقرير العملاء المرتبطين به." },
    { title: "تقرير خدمة العملاء", rows: data?.service ? [data.service] : [], firstColumn: "القسم", description: "متابعة جاري العمل وتم الانتهاء داخل خدمة العملاء." },
  ];

  function setFilter(key: keyof typeof emptyFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function exportAll() {
    const rows = sections.flatMap((section) => reportExportRows(section.title, section.rows));
    downloadXlsx("تقارير-CRM.xlsx", rows, "تقارير CRM");
  }

  function printAll() {
    const win = window.open("", "_blank", "width=1400,height=900");
    if (!win) return;
    const sectionHtml = sections.map((section) => `
      <section><h2>${htmlEscape(section.title)}</h2><table><thead><tr><th>${htmlEscape(section.firstColumn)}</th><th>إجمالي العملاء</th><th>لم يتم الاتصال</th><th>غير مؤهل</th><th>مؤهل</th><th>مؤجل</th><th>لم يتم الرد</th><th>تم البيع</th><th>جودة التسويق</th><th>جودة المبيعات</th></tr></thead><tbody>
      ${section.rows.map((row) => `<tr><td>${htmlEscape(row.name)}</td><td>${row.total}</td><td>${row.notContacted}</td><td>${row.notQualified}</td><td>${row.qualified}</td><td>${row.delayed}</td><td>${row.potential}</td><td>${row.sold}</td><td>${row.marketingQuality}%</td><td>${row.salesQuality}%</td></tr>`).join("")}
      </tbody></table></section>`).join("");
    win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقارير CRM</title><style>body{font-family:Tajawal,Arial;padding:22px;color:#38231d}h1{margin-bottom:4px}h2{margin-top:26px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #dbc8bd;padding:7px;text-align:center}th{background:#f5e8df}section{break-inside:avoid}</style></head><body><h1>تقارير CRM</h1><p>الفترة: ${htmlEscape(filters.from || "—")} إلى ${htmlEscape(filters.to || "—")}</p>${sectionHtml}<script>window.onload=()=>window.print()</script></body></html>`);
    win.document.close();
  }

  const configuredCards = (data?.quality?.summary_cards || Object.keys(summaryCards)).filter((key: string) => key in summaryCards);

  return (
    <div className="crm-page crm-reports-page">
      <header className="crm-page-head">
        <div><h1>التقارير</h1><p>المؤشرات والمصادر والأقسام والمناديب وخدمة العملاء تعتمد على نفس الفلاتر ومصدر الحساب.</p></div>
        <div className="crm-head-actions">
          <button className="crm-secondary-button" onClick={exportAll}><FileXls size={18} />تصدير Excel</button>
          <button className="crm-secondary-button" onClick={printAll}><FilePdf size={18} />تصدير PDF</button>
          <button className="crm-primary-button" onClick={() => void load()}><ArrowClockwise size={18} />تحديث</button>
        </div>
      </header>

      <section className="crm-reports-filters-pro">
        <header><div><h2>فلاتر التقارير</h2><p>حدد الفترة والقسم والمسؤول والمصدر، ثم استخدم البحث لتضييق النتائج.</p></div><button type="button" className="crm-secondary-button" onClick={() => setFilters(emptyFilters)}>مسح الفلاتر</button></header>
        <div className="crm-report-filter-row crm-report-filter-row-primary">
          <div className="crm-report-filter-group dates">
            <label><span>من تاريخ</span><input type="date" value={filters.from} onChange={(event) => setFilter("from", event.target.value)} /></label>
            <label><span>إلى تاريخ</span><input type="date" value={filters.to} onChange={(event) => setFilter("to", event.target.value)} /></label>
          </div>
          <div className="crm-report-filter-group organization">
            <label><span>القسم</span><select value={filters.department} onChange={(event) => setFilter("department", event.target.value)}><option value="">كل الأقسام</option><option value="cash_sales">مبيعات الكاش</option><option value="finance_sales">مبيعات التمويل</option><option value="customer_service">خدمة العملاء</option><option value="call_center">كول سنتر</option></select></label>
            <label><span>الفرع</span><select value={filters.branch} onChange={(event) => setFilter("branch", event.target.value)}><option value="">كل الفروع</option>{(meta?.branches || []).map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
          </div>
        </div>
        <div className="crm-report-filter-row crm-report-filter-row-secondary">
          <label><span>المندوب</span><select value={filters.agent} onChange={(event) => setFilter("agent", event.target.value)}><option value="">كل المناديب</option>{salesUsers.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label>
          <label><span>الكول سنتر</span><select value={filters.callCenter} onChange={(event) => setFilter("callCenter", event.target.value)}><option value="">كل مناديب الكول سنتر</option>{callCenterUsers.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label>
          <label><span>المصدر</span><select value={filters.source} onChange={(event) => setFilter("source", event.target.value)}><option value="">كل المصادر</option>{(meta?.sources || []).map((item) => <option key={item.code} value={item.code}>{sourceLabel(item.code, item.name)}</option>)}</select></label>
          <label className="crm-search-box wide crm-report-search"><MagnifyingGlass size={18} /><input value={filters.q} onChange={(event) => setFilter("q", event.target.value)} placeholder="بحث بالاسم أو الجوال أو السيارة أو المصدر" /></label>
        </div>
      </section>

      {notice ? <div className="crm-inline-notice">{notice}</div> : null}
      {loading ? <div className="crm-loading-panel">جاري تحميل التقارير...</div> : null}

      {data ? <section className="crm-report-summary crm-report-summary-eight">
        {configuredCards.map((key: keyof typeof summaryCards) => {
          const card = summaryCards[key];
          return <article key={key}><span>{card.label}</span><strong>{data.totals?.[card.field] ?? 0}{card.suffix}</strong></article>;
        })}
      </section> : null}

      <div className="crm-report-sections">
        {sections.map((section) => (
          <section className="crm-panel crm-report-section" key={section.title}>
            <header><div><h2>{section.title}</h2><p>{section.description}</p></div><span>{section.rows.length} صف</span></header>
            <div className="crm-table-shell">
              <table className="crm-table reports">
                <thead><tr><th>{section.firstColumn}</th><th>إجمالي العملاء</th><th>لم يتم الاتصال</th><th>غير مؤهل</th><th>مؤهل</th><th>مؤجل</th><th>لم يتم الرد</th><th>تم البيع</th><th>جودة التسويق</th><th>جودة المبيعات</th><th>تقارير العملاء</th></tr></thead>
                <tbody>
                  {section.rows.map((row) => (
                    <tr key={`${section.title}-${row.name}`}>
                      <td><strong className="crm-report-row-name">{row.name}</strong>{section.title === "تقرير خدمة العملاء" ? <small>جاري العمل: {row.working || 0} - تم الانتهاء: {row.done || 0}</small> : null}</td>
                      <td>{row.total}</td><td>{row.notContacted}</td><td>{row.notQualified}</td><td>{row.qualified}</td><td>{row.delayed}</td><td>{row.potential}</td><td>{row.sold}</td>
                      <td><span className="crm-quality-pill">{row.marketingQuality}%</span></td>
                      <td><span className="crm-quality-pill sales">{row.salesQuality}%</span></td>
                      <td><button className="crm-table-button" onClick={() => openPopup(row)}><Users size={16} />تقارير العملاء</button></td>
                    </tr>
                  ))}
                  {!loading && !section.rows.length ? <tr><td colSpan={11}><div className="crm-empty-state">لا توجد بيانات ضمن الفلاتر المحددة</div></td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      {popup ? (
        <div className="crm-modal-backdrop" onMouseDown={() => setPopup(null)}>
          <div className="crm-modal-card report-customers-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><h2>تقرير عملاء: {popup.name}</h2><p>عدد النتائج: {popupTotal.toLocaleString("ar-SA")}</p></div><button className="crm-icon-button" onClick={() => setPopup(null)}><X size={18} /></button></header>
            <div className="crm-toolbar compact"><label className="crm-search-box wide"><MagnifyingGlass size={17} /><input value={popupQ} onChange={(event) => { setPopupQ(event.target.value); setPopupPage(1); }} placeholder="اكتب حالة أو ملاحظة أو اسم عميل" /></label></div>
            <div className="crm-table-shell popup-table"><table className="crm-table"><thead><tr><th>اسم العميل</th><th>الجوال</th><th>السيارة</th><th>المصدر</th><th>الفرع</th><th>الحالة</th><th>التحديثات</th><th>تاريخ التسجيل</th><th>آخر تحديث</th></tr></thead><tbody>{popupRows.map((row: any) => <tr key={row.id}><td><strong className="crm-report-customer-name">{row.customer_name || "—"}</strong></td><td>{row.phone || row.phone_normalized || "—"}</td><td>{row.car_name || "—"}</td><td>{sourceLabel(row.source_code, row.source_name)}</td><td>{row.branch_name || row.branch_code || "—"}</td><td>{row.status_label || "—"}</td><td>{row.status_note || row.notes || "—"}</td><td>{formatDate(row.registered_at || row.created_at)}</td><td>{formatDate(row.updated_at)}</td></tr>)}{!popupLoading && !popupRows.length ? <tr><td colSpan={9}><div className="crm-empty-state">لا توجد نتائج</div></td></tr> : null}</tbody></table></div>
            <div className="crm-form-actions"><button className="crm-secondary-button" disabled={popupLoading || popupPage <= 1} onClick={() => setPopupPage((current) => Math.max(1, current - 1))}>السابق</button><span>{popupLoading ? "جاري التحميل..." : `صفحة ${popupPage} من ${Math.max(1, Math.ceil(popupTotal / popupPageSize))}`}</span><button className="crm-secondary-button" disabled={popupLoading || popupPage * popupPageSize >= popupTotal} onClick={() => setPopupPage((current) => current + 1)}>التالي</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
