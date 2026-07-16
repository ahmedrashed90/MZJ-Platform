import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ChatCircleDots,
  ClockCounterClockwise,
  MagnifyingGlass,
  NotePencil,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { crmFetch, formatDate, queryString } from "../api";
import { LeadDrawer } from "../components/LeadDrawer";
import { sourceLabel } from "../sourceCatalog";
import type { CrmLead, CrmMeta } from "../types";

export function CrmFinanceHistoryPage() {
  const [meta, setMeta] = useState<CrmMeta | null>(null);
  const [filters, setFilters] = useState({ from: "", to: "", status: "", q: "" });
  const [rows, setRows] = useState<CrmLead[]>([]);
  const [selected, setSelected] = useState<{ lead: CrmLead; events: any[] } | null>(null);
  const [conversationLead, setConversationLead] = useState<CrmLead | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void crmFetch<CrmMeta>("/api/crm/meta").then(setMeta).catch((error) => setNotice(error.message));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRows(), 180);
    return () => window.clearTimeout(timer);
  }, [filters]);

  async function loadRows() {
    setLoading(true);
    try {
      const result = await crmFetch<{ ok: boolean; rows: CrmLead[] }>(`/api/crm/history${queryString(filters)}`);
      setRows(result.rows || []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل السجل");
    } finally {
      setLoading(false);
    }
  }

  async function open(row: CrmLead) {
    try {
      const result = await crmFetch<{ ok: boolean; lead: CrmLead; events: any[] }>(`/api/crm/history?leadId=${encodeURIComponent(row.id)}`);
      setSelected({ lead: result.lead, events: result.events || [] });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل سجل العميل");
    }
  }

  const statuses = useMemo(() => [...new Set((meta?.statuses || [])
    .filter((status) => status.department_code === "finance")
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((status) => status.value))], [meta]);

  const allEvents = rows.reduce((sum, row: any) => sum + Number(row.events_count || 0), 0);
  const statusChanges = selected?.events.filter((event) => event.event_type === "status_change").length || 0;
  const notesCount = selected?.events.filter((event) => Boolean(event.note)).length || 0;
  const currentStatuses = new Set(rows.map((row) => row.status_label || "عميل جديد")).size;

  return (
    <div className="crm-page crm-finance-history-page">
      <header className="crm-page-head">
        <div><h1>سجل عملاء التمويل</h1><p>سجل كامل من لحظة دخول العميل، مع كل تغيير حالة والمستخدم والتاريخ والملاحظات.</p></div>
      </header>

      <div className="crm-filter-panel history">
        <label><span>من تاريخ</span><input type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} /></label>
        <label><span>إلى تاريخ</span><input type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} /></label>
        <label><span>الحالة الحالية</span><select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">كل الحالات الحالية</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>
        <label className="crm-search-box wide"><MagnifyingGlass size={18} /><input value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} placeholder="اسم العميل أو الجوال أو الحالة أو الموظف" /></label>
        <button className="crm-secondary-button" onClick={() => setFilters({ from: "", to: "", status: "", q: "" })}>مسح الفلاتر</button>
      </div>

      <section className="crm-history-stats crm-history-stats-wide">
        <article><UsersThree size={24} /><span>العملاء الظاهرون</span><strong>{rows.length.toLocaleString("ar-SA")}</strong></article>
        <article><ClockCounterClockwise size={24} /><span>إجمالي الحركات</span><strong>{allEvents.toLocaleString("ar-SA")}</strong></article>
        <article><ArrowRight size={24} /><span>الحالات الحالية</span><strong>{currentStatuses.toLocaleString("ar-SA")}</strong></article>
      </section>

      {notice ? <div className="crm-inline-notice">{notice}</div> : null}

      <div className="crm-finance-directory">
        {rows.map((row: any) => (
          <article key={row.id} className="crm-finance-record">
            <button type="button" className="crm-finance-record-open" onClick={() => void open(row)}>
              <div className="crm-finance-record-main">
                <strong>{row.customer_name || "عميل"}</strong>
                <span>{row.phone || row.phone_normalized || "بدون رقم جوال"}</span>
                <small>آخر حركة: {formatDate(row.last_event_at || row.updated_at)}</small>
              </div>
              <div className="crm-finance-record-status"><b>{row.status_label || "عميل جديد"}</b><span>{row.events_count || 0} حركة</span></div>
              <div className="crm-finance-record-meta">
                <span>مسؤول المبيعات: <b>{row.assigned_name || "غير موزع"}</b></span>
                <span>الكول سنتر: <b>{row.call_center_name || "غير موزع"}</b></span>
                <span>المصدر: <b>{sourceLabel(row.source_code, row.source_name)}</b></span>
              </div>
            </button>
            <button type="button" className="crm-table-button crm-open-conversation-button" onClick={() => setConversationLead(row)}><ChatCircleDots size={18} />فتح المحادثة</button>
          </article>
        ))}
        {!loading && !rows.length ? <div className="crm-empty-state panel">لا يوجد عملاء مطابقون للفلاتر المحددة</div> : null}
        {loading ? <div className="crm-loading-panel">جاري تحميل سجل العملاء...</div> : null}
      </div>

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
            <div className="crm-modal-actions"><button className="crm-primary-button" onClick={() => { setConversationLead(selected.lead); setSelected(null); }}><ChatCircleDots size={18} />فتح المحادثة</button></div>
          </div>
        </div>
      ) : null}

      <LeadDrawer
        lead={conversationLead}
        meta={meta}
        onClose={() => setConversationLead(null)}
        onSaved={(updated) => {
          setConversationLead((current) => current ? { ...current, ...updated } : current);
          setRows((current) => current.map((row) => row.id === updated.id ? { ...row, ...updated } : row));
        }}
      />
    </div>
  );
}
