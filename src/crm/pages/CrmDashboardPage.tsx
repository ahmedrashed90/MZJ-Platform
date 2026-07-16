import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, ChatCircleDots, MagnifyingGlass, UserCircle, UsersThree } from "@phosphor-icons/react";
import { crmFetch, formatDate, queryString } from "../api";
import { LeadDrawer } from "../components/LeadDrawer";
import type { CrmLead, CrmMeta, CrmStatus } from "../types";

const departments = [
  { key: "cash", label: "مبيعات الكاش" },
  { key: "finance", label: "مبيعات التمويل" },
  { key: "service", label: "خدمة العملاء" },
];

export function CrmDashboardPage() {
  const [meta, setMeta] = useState<CrmMeta | null>(null);
  const [department, setDepartment] = useState("cash");
  const [q, setQ] = useState("");
  const [branch, setBranch] = useState("");
  const [statuses, setStatuses] = useState<CrmStatus[]>([]);
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [selected, setSelected] = useState<CrmLead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { void loadMeta(); }, []);
  useEffect(() => { const timer = window.setTimeout(() => void loadDashboard(), 180); return () => window.clearTimeout(timer); }, [department, q, branch]);

  async function loadMeta() {
    try {
      const result = await crmFetch<CrmMeta>("/api/crm/meta");
      setMeta(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل إعدادات CRM");
    }
  }

  async function loadDashboard() {
    setLoading(true);
    setError("");
    try {
      const result = await crmFetch<{ ok: boolean; statuses: CrmStatus[]; leads: CrmLead[] }>(`/api/crm/dashboard${queryString({ department, q, branch })}`);
      setStatuses(result.statuses || []);
      setLeads(result.leads || []);
      setSelected((current) => current ? (result.leads.find((lead) => lead.id === current.id) || current) : null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل الداش بورد");
    } finally {
      setLoading(false);
    }
  }

  const groups = useMemo(() => statuses.map((status) => ({ ...status, leads: leads.filter((lead) => String(lead.status_label || "عميل جديد") === status.value) })), [statuses, leads]);

  return (
    <div className="crm-page crm-dashboard-page">
      <header className="crm-page-head">
        <div>
          <h1>الداش بورد</h1>
          <p>مبيعات الكاش ومبيعات التمويل وخدمة العملاء والمحادثات.</p>
        </div>
        <button className="crm-secondary-button" type="button" onClick={() => void loadDashboard()}><ArrowClockwise size={18} />تحديث البيانات</button>
      </header>

      <div className="crm-department-tabs">
        {departments.map((item) => <button key={item.key} type="button" className={department === item.key ? "active" : ""} onClick={() => { setDepartment(item.key); setBranch(""); }}>{item.label}</button>)}
      </div>

      <div className="crm-toolbar">
        <label className="crm-search-box"><MagnifyingGlass size={18} /><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="بحث باسم العميل أو رقم الجوال" /></label>
        <select value={branch} onChange={(event) => setBranch(event.target.value)}><option value="">كل الفروع</option>{(meta?.branches || []).map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
        <div className="crm-toolbar-summary"><UsersThree size={19} /><strong>{leads.length.toLocaleString("ar-SA")}</strong><span>عميل ظاهر</span></div>
      </div>

      {error ? <div className="crm-alert error">{error}</div> : null}
      {loading ? <div className="crm-loading-panel">جاري تحميل بيانات CRM...</div> : null}

      {!loading ? (
        <div className="crm-board" style={{ gridTemplateColumns: `repeat(${Math.max(1, groups.length)}, minmax(270px, 1fr))` }}>
          {groups.map((group) => (
            <section className="crm-status-column" key={group.id}>
              <header><div><h2>{group.label}</h2><span>{group.value}</span></div><strong>{group.leads.length}</strong></header>
              <div className="crm-status-cards">
                {group.leads.map((lead) => (
                  <button type="button" key={lead.id} className={`crm-lead-card ${String(lead.status_label).includes("غير مؤهل") ? "danger" : ""}`} onClick={() => setSelected(lead)}>
                    <div className="crm-lead-card-head"><span className="crm-lead-avatar"><UserCircle size={25} /></span><div><strong>{lead.customer_name || "عميل"}</strong><small>{lead.phone || lead.phone_normalized || "بدون رقم جوال"}</small></div>{lead.unread_count ? <b className="crm-unread-badge">{lead.unread_count}</b> : null}</div>
                    <div className="crm-lead-card-grid">
                      <span>المسؤول: <b>{lead.assigned_name || "غير موزع"}</b></span>
                      {department === "finance" ? <span>الكول سنتر: <b>{lead.call_center_name || "غير موزع"}</b></span> : null}
                      <span>السيارة: <b>{lead.car_name || "—"}</b></span>
                      <span>المصدر: <b>{lead.source_name || "—"}</b></span>
                    </div>
                    {lead.preview_text ? <p className="crm-lead-preview"><ChatCircleDots size={15} />{lead.preview_text}</p> : null}
                    <footer><span>مكتمل {lead.completion_percent ?? "—"}%</span><time>{formatDate(lead.last_message_at || lead.updated_at)}</time></footer>
                  </button>
                ))}
                {!group.leads.length ? <div className="crm-column-empty">لا يوجد عملاء</div> : null}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      <LeadDrawer lead={selected} meta={meta} onClose={() => setSelected(null)} onSaved={(updated) => { setLeads((current) => current.map((lead) => lead.id === updated.id ? { ...lead, ...updated } : lead)); setSelected((current) => current ? { ...current, ...updated } : current); }} />
    </div>
  );
}
