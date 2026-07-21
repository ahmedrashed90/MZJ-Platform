import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChatCircleDots,
  ClockCounterClockwise,
  MagnifyingGlass,
  Minus,
  NotePencil,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { useEscapeToClose } from "../../components/useEscapeToClose";
import { crmFetch, formatDate, queryString } from "../api";
import { sourceLabel } from "../sourceCatalog";
import type { CrmLead, CrmMeta } from "../types";

type DifferenceRow = {
  value: string;
  label: string;
  sort_order: number;
  from: number;
  to: number;
  difference: number;
};

type DifferenceResponse = {
  ok: boolean;
  from: string;
  to: string;
  rows: DifferenceRow[];
  totalFrom: number;
  totalTo: number;
  changedStatuses: number;
};

export function CrmFinanceHistoryPage() {
  const [activeTab, setActiveTab] = useState<"history" | "differences">("history");
  const [meta, setMeta] = useState<CrmMeta | null>(null);
  const [filters, setFilters] = useState({ from: "", to: "", status: "", q: "" });
  const [differenceDates, setDifferenceDates] = useState({ from: "", to: "" });
  const [differences, setDifferences] = useState<DifferenceResponse | null>(null);
  const [rows, setRows] = useState<CrmLead[]>([]);
  const pageSize = 50;
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<{ lead: CrmLead; events: any[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

  useEscapeToClose(Boolean(selected), () => setSelected(null));

  useEffect(() => {
    void crmFetch<CrmMeta>("/api/crm/meta").then(setMeta).catch((error) => setNotice(error.message));
  }, []);

  useEffect(() => {
    if (activeTab !== "history") return;
    const timer = window.setTimeout(() => void loadRows(), 180);
    return () => window.clearTimeout(timer);
  }, [activeTab, filters, page]);

  useEffect(() => {
    if (activeTab !== "differences" || !differenceDates.from || !differenceDates.to) {
      setDifferences(null);
      return;
    }
    const timer = window.setTimeout(() => void loadDifferences(), 180);
    return () => window.clearTimeout(timer);
  }, [activeTab, differenceDates]);

  async function loadRows() {
    setLoading(true);
    setNotice("");
    try {
      const result = await crmFetch<{ ok: boolean; rows: CrmLead[]; total: number }>(`/api/crm/history${queryString({ ...filters, limit: pageSize, offset: page * pageSize })}`);
      setRows(result.rows || []);
      setTotal(result.total || 0);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل السجل");
    } finally {
      setLoading(false);
    }
  }

  async function loadDifferences() {
    setLoading(true);
    setNotice("");
    try {
      const result = await crmFetch<DifferenceResponse>(`/api/crm/history${queryString({ mode: "differences", ...differenceDates })}`);
      setDifferences(result);
    } catch (error) {
      setDifferences(null);
      setNotice(error instanceof Error ? error.message : "تعذر حساب فروقات الحالات");
    } finally {
      setLoading(false);
    }
  }

  async function openHistory(row: CrmLead) {
    try {
      const result = await crmFetch<{ ok: boolean; lead: CrmLead; events: any[] }>(`/api/crm/history?leadId=${encodeURIComponent(row.id)}`);
      setSelected({ lead: result.lead, events: result.events || [] });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل سجل العميل");
    }
  }

  function openConversationInNewTab(row: CrmLead) {
    const url = `/crm?lead=${encodeURIComponent(row.id)}&department=finance`;
    const tab = window.open(url, "_blank", "noopener,noreferrer");
    tab?.focus();
  }

  const statuses = useMemo(() => [...new Set((meta?.statuses || [])
    .filter((status) => status.department_code === "finance")
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((status) => status.value))], [meta]);

  const allEvents = rows.reduce((sum, row: any) => sum + Number(row.events_count || 0), 0);
  const statusChanges = selected?.events.filter((event) => event.event_type === "status_change").length || 0;
  const notesCount = selected?.events.filter((event) => Boolean(event.note)).length || 0;
  const currentStatuses = new Set(rows.map((row) => row.status_label || "عميل جديد")).size;
  const differenceDatesInvalid = Boolean(differenceDates.from && differenceDates.to && differenceDates.from > differenceDates.to);
  function setHistoryFilter(key: keyof typeof filters, value: string) { setPage(0); setFilters((current) => ({ ...current, [key]: value })); }

  return (
    <div className="crm-page crm-finance-history-page">
      <section className="crm-finance-history-hero">
        <div className="crm-finance-history-title">
          <span className="crm-eyebrow">CRM / مبيعات التمويل</span>
          <h1>سجل عملاء التمويل</h1>
          <p>ملف زمني واضح لكل عميل من لحظة دخوله، مع الحالات والملاحظات والمسؤولين وتوقيت كل حركة.</p>
        </div>
        <div className="crm-finance-history-hero-stats">
          <article><UsersThree size={25} weight="duotone" /><span>إجمالي العملاء</span><strong>{total.toLocaleString("ar-SA")}</strong></article>
          <article><ClockCounterClockwise size={25} weight="duotone" /><span>الحركات المعروضة</span><strong>{allEvents.toLocaleString("ar-SA")}</strong></article>
        </div>
      </section>

      <div className="crm-inner-page-tabs crm-finance-history-tabs centered">
        <button type="button" className={activeTab === "history" ? "active" : ""} onClick={() => setActiveTab("history")}><UsersThree size={18} />سجل العملاء</button>
        <button type="button" className={activeTab === "differences" ? "active" : ""} onClick={() => setActiveTab("differences")}><ClockCounterClockwise size={18} />فروقات حالات العملاء</button>
      </div>

      {activeTab === "history" ? (
        <>
          <div className="crm-filter-panel history">
            <label><span>من تاريخ</span><input type="date" value={filters.from} onChange={(event) => setHistoryFilter("from", event.target.value)} /></label>
            <label><span>إلى تاريخ</span><input type="date" value={filters.to} onChange={(event) => setHistoryFilter("to", event.target.value)} /></label>
            <label><span>الحالة الحالية</span><select value={filters.status} onChange={(event) => setHistoryFilter("status", event.target.value)}><option value="">كل الحالات الحالية</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>
            <label className="crm-search-box wide"><MagnifyingGlass size={18} /><input value={filters.q} onChange={(event) => setHistoryFilter("q", event.target.value)} placeholder="اسم العميل أو الجوال أو الحالة أو الموظف" /></label>
            <button className="crm-secondary-button" onClick={() => { setPage(0); setFilters({ from: "", to: "", status: "", q: "" }); }}>مسح الفلاتر</button>
          </div>

          <section className="crm-history-stats crm-history-stats-wide crm-finance-history-mini-stats">
            <article><UsersThree size={24} /><span>نتائج الفلتر</span><strong>{rows.length.toLocaleString("ar-SA")}</strong></article>
            <article><ClockCounterClockwise size={24} /><span>إجمالي الحركات</span><strong>{allEvents.toLocaleString("ar-SA")}</strong></article>
            <article><ArrowRight size={24} /><span>الحالات الحالية</span><strong>{currentStatuses.toLocaleString("ar-SA")}</strong></article>
          </section>

          <div className="crm-finance-directory">
            {rows.map((row: any) => (
              <article key={row.id} className="crm-finance-record">
                <div className="crm-finance-record-open" role="button" tabIndex={0} onClick={() => void openHistory(row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openHistory(row); } }}>
                  <div className="crm-finance-record-main">
                    <button type="button" className="crm-customer-name-link" onClick={(event) => { event.stopPropagation(); openConversationInNewTab(row); }}>{row.customer_name || "عميل"}</button>
                    <span>{row.phone || row.phone_normalized || "بدون رقم جوال"}</span>
                    <small>آخر حركة: {formatDate(row.last_event_at || row.updated_at)}</small>
                  </div>
                  <div className="crm-finance-record-status"><b>{row.status_label || "عميل جديد"}</b><span>{row.events_count || 0} حركة</span></div>
                  <div className="crm-finance-record-meta">
                    <span>مسؤول المبيعات: <b>{row.assigned_name || "غير موزع"}</b></span>
                    <span>الكول سنتر: <b>{row.call_center_name || "غير موزع"}</b></span>
                    <span>المصدر: <b>{sourceLabel(row.source_code, row.source_name)}</b></span>
                  </div>
                </div>
                <button type="button" className="crm-table-button crm-open-conversation-button" onClick={() => openConversationInNewTab(row)}><ChatCircleDots size={18} />فتح المحادثة</button>
              </article>
            ))}
            {!loading && !rows.length ? <div className="crm-empty-state panel">لا يوجد عملاء مطابقون للفلاتر المحددة</div> : null}
            {loading ? <div className="crm-loading-panel">جاري تحميل سجل العملاء...</div> : null}
          </div>
          {total > pageSize ? <div className="crm-pagination"><button className="crm-secondary-button" disabled={page === 0 || loading} onClick={() => setPage((current) => Math.max(0, current - 1))}>السابق</button><span>صفحة {page + 1} من {Math.max(1, Math.ceil(total / pageSize))}</span><button className="crm-secondary-button" disabled={(page + 1) * pageSize >= total || loading} onClick={() => setPage((current) => current + 1)}>التالي</button></div> : null}
        </>
      ) : (
        <>
          <div className="crm-filter-panel crm-difference-filter-panel">
            <label><span>من تاريخ</span><input type="date" value={differenceDates.from} onChange={(event) => setDifferenceDates((current) => ({ ...current, from: event.target.value }))} /></label>
            <label><span>إلى تاريخ</span><input type="date" value={differenceDates.to} onChange={(event) => setDifferenceDates((current) => ({ ...current, to: event.target.value }))} /></label>
            <button className="crm-secondary-button" type="button" onClick={() => setDifferenceDates({ from: "", to: "" })}>مسح التاريخ</button>
          </div>

          {!differenceDates.from || !differenceDates.to ? <div className="crm-empty-state panel">حدد تاريخ البداية وتاريخ النهاية لعرض فروقات أعداد العملاء.</div> : null}
          {differenceDatesInvalid ? <div className="crm-alert error">تاريخ البداية يجب أن يكون قبل تاريخ النهاية أو مساويًا له.</div> : null}
          {loading ? <div className="crm-loading-panel">جاري حساب فروقات الحالات...</div> : null}

          {!loading && differences && !differenceDatesInvalid ? (
            <>
              <section className="crm-history-stats crm-history-stats-wide crm-difference-stats">
                <article><UsersThree size={24} /><span>إجمالي العملاء في تاريخ البداية</span><strong>{differences.totalFrom.toLocaleString("ar-SA")}</strong></article>
                <article><UsersThree size={24} /><span>إجمالي العملاء في تاريخ النهاية</span><strong>{differences.totalTo.toLocaleString("ar-SA")}</strong></article>
                <article><ClockCounterClockwise size={24} /><span>الحالات التي تغير عددها</span><strong>{differences.changedStatuses.toLocaleString("ar-SA")}</strong></article>
              </section>

              <section className="crm-panel crm-difference-card">
                <header><div><h2>فروقات حالات العملاء</h2><p>مقارنة آخر حالة وصل إليها كل عميل حتى نهاية يوم {differences.from} مع نهاية يوم {differences.to}.</p></div></header>
                <div className="crm-table-shell">
                  <table className="crm-table crm-difference-table">
                    <thead><tr><th>الحالة</th><th>عدد يوم البداية</th><th>عدد يوم النهاية</th><th>الفرق</th><th>النتيجة</th></tr></thead>
                    <tbody>
                      {differences.rows.map((row) => (
                        <tr key={row.value} className={row.difference !== 0 ? "changed" : ""}>
                          <td><strong>{row.label}</strong>{row.label !== row.value ? <small>{row.value}</small> : null}</td>
                          <td>{row.from.toLocaleString("ar-SA")}</td>
                          <td>{row.to.toLocaleString("ar-SA")}</td>
                          <td><strong>{row.difference > 0 ? `+${row.difference}` : row.difference.toLocaleString("ar-SA")}</strong></td>
                          <td>
                            <span className={`crm-difference-result ${row.difference > 0 ? "increase" : row.difference < 0 ? "decrease" : "same"}`}>
                              {row.difference > 0 ? <ArrowUp size={16} /> : row.difference < 0 ? <ArrowDown size={16} /> : <Minus size={16} />}
                              {row.difference > 0 ? `زيادة ${Math.abs(row.difference).toLocaleString("ar-SA")}` : row.difference < 0 ? `انخفاض ${Math.abs(row.difference).toLocaleString("ar-SA")}` : "بدون تغيير"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : null}
        </>
      )}

      {notice ? <div className="crm-inline-notice">{notice}</div> : null}

      {selected ? (
        <div className="crm-modal-backdrop" onMouseDown={() => setSelected(null)}>
          <div className="crm-modal-card history-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><h2>سجل الحالات بالكامل</h2><p>{selected.lead.customer_name} - {selected.lead.phone || selected.lead.phone_normalized || "بدون رقم جوال"}</p></div>
              <button className="crm-icon-button" onClick={() => setSelected(null)}><X size={18} /></button>
            </header>
            <div className="crm-history-summary">
              <span>الحالة الحالية <b>{selected.lead.status_label || "عميل جديد"}</b></span>
              <span>تغييرات الحالات <b>{statusChanges}</b></span>
              <span>الملاحظات <b>{notesCount}</b></span>
              <span>المصدر <b>{sourceLabel(selected.lead.source_code, selected.lead.source_name)}</b></span>
            </div>
            <div className="crm-timeline">
              {selected.events.map((event) => (
                <article key={event.id} className="crm-timeline-item">
                  <div className="crm-timeline-dot" />
                  <div>
                    <header>
                      <strong>{event.event_type === "lead_created" || event.event_type === "integration_lead_created" ? "دخول العميل إلى النظام" : event.event_type === "status_change" ? "تغيير حالة العميل" : event.event_type === "department_transfer" ? "تحويل العميل" : event.event_type}</strong>
                      <time>{formatDate(event.created_at)}</time>
                    </header>
                    {event.old_status || event.new_status ? <p><span className="crm-status-pill old">{event.old_status || "غير مسجل"}</span><ArrowRight size={16} /><span className="crm-status-pill new">{event.new_status || "غير مسجل"}</span></p> : null}
                    {event.old_department || event.new_department ? <small>القسم: {event.old_department || "—"} ← {event.new_department || "—"}</small> : null}
                    <small>صفة مغير الحالة: {event.actor_role || "النظام"}</small>
                    <small>اسم مغير الحالة: {event.actor_name || "النظام"}</small>
                    {event.note ? <blockquote><NotePencil size={15} />{event.note}</blockquote> : null}
                  </div>
                </article>
              ))}
              {!selected.events.length ? <div className="crm-empty-state">لا توجد حركات مسجلة</div> : null}
            </div>
            <div className="crm-modal-actions"><button className="crm-primary-button" onClick={() => openConversationInNewTab(selected.lead)}><ChatCircleDots size={18} />فتح المحادثة</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
