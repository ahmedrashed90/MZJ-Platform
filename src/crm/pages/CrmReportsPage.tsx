import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, Buildings, CalendarBlank, FilePdf, FileXls, FunnelSimple, MagnifyingGlass, UserFocus, Users, X } from "@phosphor-icons/react";
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
  quality?: number;
  department?: string;
  branch?: string;
  detailKind: "source" | "department_branch" | "agent" | "service";
  detailValue: string;
};

type ReportSectionKind = "source" | "department" | "agent" | "service";
type ReportSummary = Pick<ReportRow, "marketingQuality" | "salesQuality">;
type ReportSection = {
  title: string;
  rows: ReportRow[];
  firstColumn: string;
  description: string;
  kind: ReportSectionKind;
  countLabel?: string;
  summary?: ReportSummary | null;
};
type ReportColumn = {
  key: keyof ReportRow | "customers" | "serial";
  label: string;
  percentage?: boolean;
  action?: boolean;
};

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

type SummaryCardKey = keyof typeof summaryCards;
type SummaryCardTone = "blue" | "green" | "amber" | "red";

function monthDateRange(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${value}-01`, to: `${value}-${String(lastDay).padStart(2, "0")}` };
}

function summaryMetricPercentage(key: SummaryCardKey, value: number, total: number) {
  if (key === "marketing" || key === "sales") return Math.max(0, Math.min(100, value));
  if (key === "total") return total > 0 ? 100 : 0;
  return total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;
}

function summaryCardTone(key: SummaryCardKey, value: number, total: number): SummaryCardTone {
  if (key === "total") return "blue";
  const percentage = summaryMetricPercentage(key, value, total);
  if (key === "notContacted" || key === "waste" || key === "potential" || key === "delayed") {
    if (percentage <= 10) return "green";
    if (percentage <= 25) return "amber";
    return "red";
  }
  if (percentage >= 70) return "green";
  if (percentage >= 40) return "amber";
  return "red";
}

function htmlEscape(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function columnsForSection(section: ReportSection): ReportColumn[] {
  if (section.kind === "service") {
    return [
      { key: "name", label: "القسم" },
      { key: "total", label: "إجمالي العملاء" },
      { key: "working", label: "جاري العمل" },
      { key: "done", label: "تم الانتهاء" },
      { key: "quality", label: "جودة القسم", percentage: true },
    ];
  }
  const metricColumns: ReportColumn[] = [
    { key: "marketingQuality", label: "جودة التسويق", percentage: true },
    { key: "total", label: "إجمالي العملاء" },
    { key: "notContacted", label: "لم يتم الاتصال" },
    { key: "potential", label: "لم يتم الرد" },
    { key: "notQualified", label: "غير مؤهل" },
    { key: "qualified", label: "مؤهل" },
    { key: "sold", label: "تم البيع" },
  ];
  if (section.kind === "agent") {
    return [
      { key: "serial", label: "مسلسل" },
      { key: "name", label: "المندوب" },
      { key: "department", label: "القسم" },
      { key: "branch", label: "الفرع" },
      ...metricColumns,
      { key: "salesQuality", label: "جودة المندوب", percentage: true },
      { key: "customers", label: "تقارير العملاء", action: true },
    ];
  }
  if (section.kind === "department") {
    return [
      { key: "serial", label: "مسلسل" },
      { key: "department", label: "القسم" },
      { key: "branch", label: "الفرع" },
      ...metricColumns,
      { key: "salesQuality", label: "جودة القسم / الفرع", percentage: true },
      { key: "customers", label: "تقارير العملاء", action: true },
    ];
  }
  return [
    { key: "serial", label: "مسلسل" },
    { key: "name", label: section.firstColumn },
    ...metricColumns,
    { key: "salesQuality", label: "جودة المبيعات", percentage: true },
    { key: "customers", label: "تقارير العملاء", action: true },
  ];
}

function reportCellValue(row: ReportRow, column: ReportColumn, serial?: number) {
  if (column.action) return "";
  if (column.key === "serial") return serial ?? 0;
  const value = row[column.key as keyof ReportRow] ?? 0;
  return column.percentage ? `${value}%` : value;
}

function reportExportRows(section: ReportSection) {
  const columns = columnsForSection(section).filter((column) => !column.action);
  return section.rows.map((row, index) => {
    const record: Record<string, string | number> = { "القسم بالتقرير": section.title };
    for (const column of columns) record[column.label] = reportCellValue(row, column, index + 1);
    return record;
  });
}

export function CrmReportsPage() {
  const [meta, setMeta] = useState<CrmMeta | null>(null);
  const [filters, setFilters] = useState(emptyFilters);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [data, setData] = useState<any | null>(null);
  const [popup, setPopup] = useState<ReportRow | null>(null);
  const [popupQ, setPopupQ] = useState("");
  const [popupStatus, setPopupStatus] = useState("");
  const [popupRows, setPopupRows] = useState<any[]>([]);
  const [popupTotal, setPopupTotal] = useState(0);
  const [popupPage, setPopupPage] = useState(1);
  const [popupLoading, setPopupLoading] = useState(false);
  const [popupPdfLoading, setPopupPdfLoading] = useState(false);
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
  }, [popup, popupQ, popupStatus, popupPage, filters]);

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
      const result = await crmFetch<{ ok: boolean; rows: any[]; total: number }>(`/api/crm/reports${queryString({ ...filters, detailKind: popup.detailKind, detailValue: popup.detailValue, detailQ: popupQ, detailStatus: popupStatus, detailPage: popupPage, detailPageSize: popupPageSize })}`);
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
    setPopupStatus("");
    setPopupPage(1);
    setPopupRows([]);
    setPopupTotal(0);
  }

  const salesUsers = useMemo(() => (meta?.users || []).filter((user) => ["cash_sales", "finance_sales", "wholesale", "wholesale_sales", "customer_service"].includes(user.primary_department_code || "") || (!user.primary_department_code && user.department_codes.some((code) => ["cash_sales", "finance_sales", "wholesale", "wholesale_sales", "customer_service"].includes(code)))), [meta]);
  const callCenterUsers = useMemo(() => (meta?.users || []).filter((user) => user.primary_department_code === "call_center" || (!user.primary_department_code && user.department_codes.includes("call_center"))), [meta]);
  const selectedAgentIds = useMemo(() => filters.agent.split(",").map((value) => value.trim()).filter(Boolean), [filters.agent]);
  const selectedAgentNames = useMemo(() => salesUsers.filter((user) => selectedAgentIds.includes(user.id)).map((user) => user.full_name), [salesUsers, selectedAgentIds]);
  const agentFilterLabel = selectedAgentNames.length === 0 ? "كل المناديب" : selectedAgentNames.length <= 2 ? selectedAgentNames.join("، ") : `${selectedAgentNames.length} مناديب محددين`;
  const sections: ReportSection[] = [
    { title: "مصادر التسويق الرقمي", rows: data?.digitalSources || [], firstColumn: "المصدر", description: "المصادر الرقمية المصنفة من إعدادات المصدر، بما فيها حاسبة التقسيط واتصال الرقم الموحد.", kind: "source", countLabel: "إجمالي المصادر", summary: data?.sectionSummaries?.digitalSources },
    { title: "مصادر التسويق المباشر", rows: data?.directSources || [], firstColumn: "المصدر", description: "المصادر المباشرة المعتمدة في قاعدة البيانات بدون تصنيف نصي داخل الواجهة.", kind: "source", countLabel: "إجمالي المصادر", summary: data?.sectionSummaries?.directSources },
    ...(data?.otherSources?.length ? [{ title: "مصادر أخرى", rows: data.otherSources, firstColumn: "المصدر", description: "مصادر لم يتم تصنيفها بعد كرقمية أو مباشرة.", kind: "source" as const, countLabel: "إجمالي المصادر", summary: data?.sectionSummaries?.otherSources }] : []),
    { title: "تقرير الأقسام والفروع", rows: data?.departments || [], firstColumn: "القسم", description: "إجمالي حالات المبيعات حسب القسم والفرع بالمسمّيات المعتمدة.", kind: "department", countLabel: "إجمالي الأقسام والفروع", summary: data?.sectionSummaries?.departments },
    { title: "تقارير المناديب", rows: data?.agents || [], firstColumn: "المندوب", description: "أرقام كل مندوب مبيعات مع فتح تقرير العملاء المرتبطين به.", kind: "agent", countLabel: "إجمالي المناديب", summary: data?.sectionSummaries?.agents },
    { title: "تقرير خدمة العملاء", rows: data?.service ? [data.service] : [], firstColumn: "القسم", description: "متابعة جاري العمل وتم الانتهاء داخل خدمة العملاء.", kind: "service" },
  ];

  function setFilter(key: keyof typeof emptyFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function toggleAgentFilter(agentId: string) {
    setFilters((current) => {
      const selected = current.agent.split(",").map((value) => value.trim()).filter(Boolean);
      const next = selected.includes(agentId) ? selected.filter((id) => id !== agentId) : [...selected, agentId];
      return { ...current, agent: next.join(",") };
    });
  }

  function setReportMonth(value: string) {
    setSelectedMonth(value);
    const range = monthDateRange(value);
    setFilters((current) => ({ ...current, from: range?.from || "", to: range?.to || "" }));
  }

  function setCustomReportDate(key: "from" | "to", value: string) {
    setSelectedMonth("");
    setFilter(key, value);
  }

  function clearReportFilters() {
    setSelectedMonth("");
    setFilters(emptyFilters);
  }

  function exportAll() {
    const rows = sections.flatMap((section) => reportExportRows(section));
    downloadXlsx("تقارير-CRM.xlsx", rows, "تقارير CRM");
  }

  function printAll() {
    const win = window.open("", "_blank", "width=1400,height=900");
    if (!win) return;
    const sectionHtml = sections.map((section) => {
      const columns = columnsForSection(section).filter((column) => !column.action);
      return `<section><h2>${htmlEscape(section.title)}</h2><table><thead><tr>${columns.map((column) => `<th>${htmlEscape(column.label)}</th>`).join("")}</tr></thead><tbody>
      ${section.rows.map((row, index) => `<tr>${columns.map((column) => `<td>${htmlEscape(reportCellValue(row, column, index + 1))}</td>`).join("")}</tr>`).join("")}
      </tbody></table></section>`;
    }).join("");
    win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقارير CRM</title><style>body{font-family:Tajawal,Arial;padding:22px;color:#38231d}h1{margin-bottom:4px}h2{margin-top:26px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #dbc8bd;padding:7px;text-align:center}th{background:#f5e8df}section{break-inside:avoid}</style></head><body><h1>تقارير CRM</h1><p>الفترة: ${htmlEscape(filters.from || "—")} إلى ${htmlEscape(filters.to || "—")}</p>${sectionHtml}<script>window.onload=()=>window.print()</script></body></html>`);
    win.document.close();
  }

  async function exportPopupPdf() {
    if (!popup || popupPdfLoading) return;
    const win = window.open("", "_blank", "width=1400,height=900");
    if (!win) {
      setNotice("تعذر فتح نافذة تصدير PDF. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.");
      return;
    }
    win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>جاري تجهيز التقرير</title><style>body{font-family:Tajawal,Arial;padding:30px;text-align:center;font-weight:700;color:#38231d}</style></head><body>جاري تجهيز تقرير العملاء...</body></html>`);
    win.document.close();
    setPopupPdfLoading(true);
    try {
      const allRows: any[] = [];
      let page = 1;
      let total = 0;
      do {
        const result = await crmFetch<{ ok: boolean; rows: any[]; total: number }>(`/api/crm/reports${queryString({ ...filters, detailKind: popup.detailKind, detailValue: popup.detailValue, detailQ: popupQ, detailStatus: popupStatus, detailPage: page, detailPageSize: 200 })}`);
        const pageRows = result.rows || [];
        allRows.push(...pageRows);
        total = Number(result.total || 0);
        if (!pageRows.length) break;
        page += 1;
      } while (allRows.length < total && page <= 500);

      const rowsHtml = allRows.map((row) => `<tr><td>${htmlEscape(row.customer_name || "—")}</td><td>${htmlEscape(row.phone || row.phone_normalized || "—")}</td><td>${htmlEscape(row.car_name || "—")}</td><td>${htmlEscape(sourceLabel(row.source_code, row.source_name))}</td><td>${htmlEscape(row.branch_name || row.branch_code || "—")}</td><td>${htmlEscape(row.status_label || "—")}</td><td>${htmlEscape(row.sold_quantity ?? "—")}</td><td>${htmlEscape(row.status_note || row.notes || "—")}</td><td>${htmlEscape(formatDate(row.sold_at))}</td><td>${htmlEscape(formatDate(row.registered_at || row.created_at))}</td><td>${htmlEscape(formatDate(row.updated_at))}</td></tr>`).join("");
      win.document.open();
      win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير عملاء - ${htmlEscape(popup.name)}</title><style>@page{size:A4 landscape;margin:10mm}body{font-family:Tajawal,Arial;color:#38231d;font-size:11px;font-weight:700}h1{margin:0 0 6px;font-size:23px}p{margin:0 0 16px;color:#6d554d}table{width:100%;border-collapse:collapse}th,td{border:1px solid #dbc8bd;padding:7px;text-align:right;vertical-align:top}th{background:#f5e8df;font-weight:800}td:first-child{font-weight:800}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body><h1>تقرير عملاء: ${htmlEscape(popup.name)}</h1><p>إجمالي العملاء: ${total.toLocaleString("ar-SA-u-nu-latn")} — الفترة: ${htmlEscape(filters.from || "—")} إلى ${htmlEscape(filters.to || "—")}${popupStatus ? ` — الحالة: ${htmlEscape(popupStatus)}` : ""}${popupQ ? ` — البحث: ${htmlEscape(popupQ)}` : ""}</p><table><thead><tr><th>اسم العميل</th><th>الجوال</th><th>السيارة</th><th>المصدر</th><th>الفرع</th><th>الحالة</th><th>عدد المباع</th><th>التحديثات</th><th>تاريخ تم البيع</th><th>تاريخ التسجيل</th><th>آخر تحديث</th></tr></thead><tbody>${rowsHtml || '<tr><td colspan="11">لا توجد نتائج</td></tr>'}</tbody></table><script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`);
      win.document.close();
    } catch (error) {
      win.close();
      setNotice(error instanceof Error ? error.message : "تعذر تصدير تقرير العملاء PDF");
    } finally {
      setPopupPdfLoading(false);
    }
  }

  const reportStatuses = useMemo(() => {
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const status of meta?.statuses || []) {
      const label = String(status.label || status.value || "").trim();
      if (!label || status.is_active === false || seen.has(label)) continue;
      seen.add(label);
      labels.push(label);
    }
    if (!seen.has("تم البيع")) labels.push("تم البيع");
    return labels;
  }, [meta]);

  const configuredCards = (data?.quality?.summary_cards || Object.keys(summaryCards)).filter((key: string) => key in summaryCards);

  return (
    <div className="crm-page crm-reports-page">
      <div className="crm-head-actions page-top-actions">
        <button className="crm-secondary-button" onClick={exportAll}><FileXls size={18} />تصدير Excel</button>
        <button className="crm-secondary-button" onClick={printAll}><FilePdf size={18} />تصدير PDF</button>
        <button className="crm-primary-button" onClick={() => void load()}><ArrowClockwise size={18} />تحديث</button>
      </div>

      <section className="crm-reports-filters-pro">
        <header>
          <div className="crm-report-filter-title">
            <span className="crm-report-filter-title-icon"><FunnelSimple size={24} weight="duotone" /></span>
            <div><h2>فلاتر التقارير</h2><p>حدد نطاق التقرير بدقة؛ كل مجموعة مستقلة وواضحة مثل نموذج تقييم المناديب.</p></div>
          </div>
          <button type="button" className="crm-secondary-button" onClick={clearReportFilters}>مسح الفلاتر</button>
        </header>
        <div className="crm-report-filter-blocks">
          <section className="crm-report-filter-block">
            <div className="crm-report-filter-block-head"><span><CalendarBlank size={19} /></span><div><strong>الفترة الزمنية</strong><small>المبيعات حسب تاريخ كل عملية بيع، وباقي الحالات حسب آخر تحديث</small></div></div>
            <div className="crm-report-filter-fields three-columns">
              <label><span>اختيار شهر</span><input type="month" value={selectedMonth} onChange={(event) => setReportMonth(event.target.value)} /></label>
              <label><span>من تاريخ</span><input type="date" value={filters.from} onChange={(event) => setCustomReportDate("from", event.target.value)} /></label>
              <label><span>إلى تاريخ</span><input type="date" value={filters.to} onChange={(event) => setCustomReportDate("to", event.target.value)} /></label>
            </div>
          </section>
          <section className="crm-report-filter-block">
            <div className="crm-report-filter-block-head"><span><Buildings size={19} /></span><div><strong>القسم والفرع</strong><small>حدد نطاق الإدارة أو الموقع</small></div></div>
            <div className="crm-report-filter-fields two-columns">
              <label><span>القسم</span><select value={filters.department} onChange={(event) => setFilter("department", event.target.value)}><option value="">كل الأقسام</option><option value="cash_sales">مبيعات الكاش</option><option value="finance_sales">مبيعات التمويل</option><option value="wholesale">قسم الجملة</option><option value="customer_service">خدمة العملاء</option><option value="call_center">كول سنتر</option></select></label>
              <label><span>الفرع</span><select value={filters.branch} onChange={(event) => setFilter("branch", event.target.value)}><option value="">كل الفروع</option>{(meta?.branches || []).map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
            </div>
          </section>
          <section className="crm-report-filter-block wide">
            <div className="crm-report-filter-block-head"><span><UserFocus size={19} /></span><div><strong>المسؤول والمصدر</strong><small>المندوب والكول سنتر ومصدر العميل</small></div></div>
            <div className="crm-report-filter-fields three-columns">
              <div className="crm-report-agent-multi-filter"><span>المندوب</span><details className="crm-report-agent-multi-select"><summary title={selectedAgentNames.join("، ") || "كل المناديب"}>{agentFilterLabel}</summary><div className="crm-report-agent-multi-options"><label className={selectedAgentIds.length === 0 ? "selected" : ""}><input type="checkbox" checked={selectedAgentIds.length === 0} onChange={() => setFilter("agent", "")} /><span>كل المناديب</span></label>{salesUsers.map((item) => { const checked = selectedAgentIds.includes(item.id); return <label key={item.id} className={checked ? "selected" : ""}><input type="checkbox" checked={checked} onChange={() => toggleAgentFilter(item.id)} /><span>{item.full_name}</span></label>; })}</div></details></div>
              <label><span>الكول سنتر</span><select value={filters.callCenter} onChange={(event) => setFilter("callCenter", event.target.value)}><option value="">كل مناديب الكول سنتر</option>{callCenterUsers.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label>
              <label><span>المصدر</span><select value={filters.source} onChange={(event) => setFilter("source", event.target.value)}><option value="">كل المصادر</option>{(meta?.sources || []).filter((item) => !["manual", "manual_entry", "manual-entry"].includes(String(item.code || "").toLowerCase())).map((item) => <option key={item.code} value={item.code}>{sourceLabel(item.code, item.name)}</option>)}</select></label>
            </div>
          </section>
          <section className="crm-report-filter-block search-block">
            <div className="crm-report-filter-block-head"><span><MagnifyingGlass size={19} /></span><div><strong>البحث داخل النتائج</strong><small>بالاسم أو الجوال أو السيارة أو المصدر</small></div></div>
            <label className="crm-search-box wide crm-report-search"><MagnifyingGlass size={18} /><input value={filters.q} onChange={(event) => setFilter("q", event.target.value)} placeholder="اكتب كلمة البحث" /></label>
          </section>
        </div>
      </section>

      {notice ? <div className="crm-inline-notice">{notice}</div> : null}
      {loading ? <div className="crm-loading-panel">جاري تحميل التقارير...</div> : null}

      {data ? <section className="crm-report-summary crm-report-summary-eight" aria-label="ملخص مؤشرات تقارير CRM">
        {configuredCards.map((key: SummaryCardKey) => {
          const card = summaryCards[key];
          const value = Number(data.totals?.[card.field] ?? 0);
          const total = Number(data.totals?.total ?? 0);
          const tone = summaryCardTone(key, value, total);
          return <article key={key} data-tone={tone}><span>{card.label}</span><strong>{value}{card.suffix}</strong></article>;
        })}
      </section> : null}

      <div className="crm-report-sections">
        {sections.map((section) => (
          <section className="crm-panel crm-report-section" key={section.title}>
            <header><div><h2>{section.title}</h2><p>{section.description}</p></div>{section.countLabel ? <div className="crm-report-section-metrics"><span>{section.countLabel}<b>{section.rows.length.toLocaleString("ar-SA-u-nu-latn")}</b></span><span>جودة التسويق<b>{section.summary?.marketingQuality ?? 0}%</b></span><span>جودة المبيعات<b>{section.summary?.salesQuality ?? 0}%</b></span><span>إجمالي المبيعات<b>{section.rows.reduce((sum, row) => sum + Number(row.sold || 0), 0).toLocaleString("ar-SA-u-nu-latn")}</b></span></div> : <span>{section.rows.length} صف</span>}</header>
            <div className="crm-table-shell">
              <table className="crm-table reports">
                <thead><tr>{columnsForSection(section).map((column) => <th key={`${section.title}-${String(column.key)}`}>{column.label}</th>)}</tr></thead>
                <tbody>
                  {section.rows.map((row, index) => (
                    <tr key={`${section.title}-${row.detailValue || row.name}`}>
                      {columnsForSection(section).map((column) => {
                        if (column.action) return <td key={String(column.key)}><button className="crm-table-button" onClick={() => openPopup(row)}><Users size={16} />تقارير العملاء</button></td>;
                        if (column.key === "serial") return <td key={String(column.key)}>{index + 1}</td>;
                        if (column.key === "name") return <td key={String(column.key)}><strong className="crm-report-row-name">{row.name}</strong></td>;
                        if (column.percentage) return <td key={String(column.key)}><span className={`crm-quality-pill${column.key === "marketingQuality" ? "" : " sales"}`}>{row[column.key as keyof ReportRow] ?? 0}%</span></td>;
                        return <td key={String(column.key)}>{row[column.key as keyof ReportRow] ?? 0}</td>;
                      })}
                    </tr>
                  ))}
                  {!loading && !section.rows.length ? <tr><td colSpan={columnsForSection(section).length}><div className="crm-empty-state">لا توجد بيانات ضمن الفلاتر المحددة</div></td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      {popup ? (
        <div className="crm-modal-backdrop" onMouseDown={() => setPopup(null)}>
          <div className="crm-modal-card report-customers-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><h2>تقرير عملاء: {popup.name}</h2><p>عدد النتائج: {popupTotal.toLocaleString("ar-SA-u-nu-latn")}</p></div><button className="crm-icon-button" onClick={() => setPopup(null)}><X size={18} /></button></header>
            <div className="crm-toolbar compact crm-report-customers-toolbar"><label className="crm-search-box wide"><MagnifyingGlass size={17} /><input value={popupQ} onChange={(event) => { setPopupQ(event.target.value); setPopupPage(1); }} placeholder="اكتب حالة أو ملاحظة أو اسم عميل" /></label><label className="crm-report-status-filter"><span>الحالة</span><select value={popupStatus} onChange={(event) => { setPopupStatus(event.target.value); setPopupPage(1); }}><option value="">كل الحالات</option>{reportStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label><button type="button" className="crm-secondary-button" disabled={popupLoading || popupPdfLoading} onClick={() => void exportPopupPdf()}><FilePdf size={17} />{popupPdfLoading ? "جاري تجهيز PDF..." : "تصدير PDF"}</button></div>
            <div className="crm-table-shell popup-table"><table className="crm-table"><thead><tr><th>اسم العميل</th><th>الجوال</th><th>السيارة</th><th>المصدر</th><th>الفرع</th><th>الحالة</th><th>عدد المباع</th><th>التحديثات</th><th>تاريخ تم البيع</th><th>تاريخ التسجيل</th><th>آخر تحديث</th></tr></thead><tbody>{popupRows.map((row: any) => <tr key={row.id}><td><strong className="crm-report-customer-name">{row.customer_name || "—"}</strong></td><td>{row.phone || row.phone_normalized || "—"}</td><td>{row.car_name || "—"}</td><td>{sourceLabel(row.source_code, row.source_name)}</td><td>{row.branch_name || row.branch_code || "—"}</td><td>{row.status_label || "—"}</td><td>{row.sold_quantity ?? "—"}</td><td>{row.status_note || row.notes || "—"}</td><td>{formatDate(row.sold_at)}</td><td>{formatDate(row.registered_at || row.created_at)}</td><td>{formatDate(row.updated_at)}</td></tr>)}{!popupLoading && !popupRows.length ? <tr><td colSpan={11}><div className="crm-empty-state">لا توجد نتائج</div></td></tr> : null}</tbody></table></div>
            <div className="crm-form-actions"><button className="crm-secondary-button" disabled={popupLoading || popupPage <= 1} onClick={() => setPopupPage((current) => Math.max(1, current - 1))}>السابق</button><span>{popupLoading ? "جاري التحميل..." : `صفحة ${popupPage} من ${Math.max(1, Math.ceil(popupTotal / popupPageSize))}`}</span><button className="crm-secondary-button" disabled={popupLoading || popupPage * popupPageSize >= popupTotal} onClick={() => setPopupPage((current) => current + 1)}>التالي</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
