import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowClockwise,
  ChatCircleDots,
  CheckCircle,
  MagnifyingGlass,
  PhoneCall,
  UserPlus,
  UsersThree,
} from "@phosphor-icons/react";
import { crmFetch, formatDate, queryString } from "../api";
import { LeadDrawer } from "../components/LeadDrawer";
import { leadHasUnreadMessage } from "../unreadState";
import { sourceLabel } from "../sourceCatalog";
import type { CrmLead, CrmMeta, CrmStatus } from "../types";

const departments = [
  { key: "cash", label: "مبيعات الكاش" },
  { key: "finance", label: "مبيعات التمويل" },
  { key: "service", label: "خدمة العملاء" },
];

function leadStatus(lead: CrmLead) {
  return String(lead.status_label || lead.status_code || "عميل جديد").trim();
}

function readPatch(lead: CrmLead): CrmLead {
  return {
    ...lead,
    unread_count: 0,
    dashboard_unread: false,
    has_unread_message: false,
    has_unread_messages: false,
    message_unread: false,
    is_unread: false,
    dashboard_message_read_at: new Date().toISOString(),
  };
}

export function CrmDashboardPage() {
  const [searchParams] = useSearchParams();
  const requestedLeadId = searchParams.get("lead") || "";
  const requestedDepartment = searchParams.get("department") || "";
  const [meta, setMeta] = useState<CrmMeta | null>(null);
  const [department, setDepartment] = useState(() => departments.some((item) => item.key === requestedDepartment) ? requestedDepartment : "cash");
  const [q, setQ] = useState("");
  const [branch, setBranch] = useState("");
  const [statuses, setStatuses] = useState<CrmStatus[]>([]);
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [selected, setSelected] = useState<CrmLead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const openedRequestedLead = useRef("");

  useEffect(() => { void loadMeta(); }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadDashboard(), 180);
    return () => window.clearTimeout(timer);
  }, [department, q, branch]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadDashboard(true);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [department, q, branch]);

  useEffect(() => {
    if (!requestedLeadId || loading || openedRequestedLead.current === requestedLeadId) return;
    const requested = leads.find((lead) => lead.id === requestedLeadId || lead.legacy_id === requestedLeadId || lead.conversation_id === requestedLeadId);
    if (!requested) return;
    openedRequestedLead.current = requestedLeadId;
    openLead(requested);
  }, [requestedLeadId, loading, leads]);



  async function loadMeta() {
    try {
      const result = await crmFetch<CrmMeta>("/api/crm/meta");
      setMeta(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل إعدادات CRM");
    }
  }

  async function loadDashboard(silent = false) {
    if (!silent) setLoading(true);
    if (!silent) setError("");
    try {
      const result = await crmFetch<{ ok: boolean; statuses: CrmStatus[]; leads: CrmLead[] }>(
        `/api/crm/dashboard${queryString({ department, q, branch })}`,
      );
      setStatuses(result.statuses || []);
      setLeads(result.leads || []);
      setSelected((current) => current ? (result.leads.find((lead) => lead.id === current.id) || current) : null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل الداش بورد");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function markLeadRead(lead: CrmLead) {
    const readThroughAt = lead.last_incoming_message_at || lead.last_message_at || new Date().toISOString();
    const readThroughMessageKey = String(lead.extra_data?.lastUnreadMessageKey || "").trim();
    try {
      const result = await crmFetch<{ ok: boolean; row?: CrmLead | null; cleared?: boolean }>("/api/crm/unread", {
        method: "POST",
        body: JSON.stringify({
          action: "mark_read",
          leadId: lead.id,
          conversationId: lead.conversation_id,
          readThroughAt,
          readThroughMessageKey,
        }),
      });
      const next = result.cleared === false
        ? { ...lead, ...(result.row || {}) }
        : { ...readPatch(lead), ...(result.row || {}) };
      setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, ...next } : item));
      setSelected((current) => current?.id === lead.id ? { ...current, ...next } : current);
    } catch (failure) {
      console.warn("تعذر حفظ قراءة محادثة العميل", failure);
    }
  }

  function openLead(lead: CrmLead) {
    setSelected(lead);
    if (leadHasUnreadMessage(lead)) void markLeadRead(lead);
  }

  const groups = useMemo(() => {
    const originalOrder = new Map(leads.map((lead, index) => [lead.id, index]));
    const byUnreadFirst = (left: CrmLead, right: CrmLead) => {
      const unreadDifference = Number(leadHasUnreadMessage(right)) - Number(leadHasUnreadMessage(left));
      return unreadDifference || Number(originalOrder.get(left.id) || 0) - Number(originalOrder.get(right.id) || 0);
    };
    const statusGroups = statuses
      .filter((status) => status.is_active !== false)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
      .map((status) => ({
        ...status,
        unread_messages: false,
        leads: leads.filter((lead) => leadStatus(lead) === String(status.value || status.label).trim()).sort(byUnreadFirst),
      }));
    return [
      ...statusGroups,
      {
        id: `${department}-unread-messages`,
        department_code: department,
        label: "الرسائل غير المقروءة",
        value: "__unread_messages__",
        sort_order: Number.MAX_SAFE_INTEGER,
        is_active: true,
        unread_messages: true,
        leads: leads.filter(leadHasUnreadMessage).sort(byUnreadFirst),
      },
    ];
  }, [statuses, leads, department]);

  const summary = useMemo(() => {
    const newCount = leads.filter((lead) => leadStatus(lead) === "عميل جديد").length;
    const unread = leads.reduce((sum, lead) => sum + Math.max(Number(lead.unread_count || 0), leadHasUnreadMessage(lead) ? 1 : 0), 0);
    const assigned = leads.filter((lead) => Boolean(lead.assigned_to || lead.assigned_name)).length;
    const completed = leads.filter((lead) => ["تم البيع", "تم الانتهاء", "تم الإنتهاء - إنشاء طلب البيع", "تم الانتهاء - إنشاء طلب البيع"].includes(leadStatus(lead))).length;
    return { total: leads.length, newCount, unread, assigned, completed };
  }, [leads]);

  const visibleBranches = useMemo(() => {
    const all = meta?.branches || [];
    if (department === "finance") return all.filter((item) => item.code === "online" || item.name.includes("اونلاين") || item.name.includes("أونلاين"));
    if (department === "service") return all.filter((item) => item.code === "customer_service" || item.name.includes("خدمة"));
    return all.filter((item) => item.code !== "online" && item.code !== "customer_service");
  }, [meta, department]);

  return (
    <div className="crm-page crm-dashboard-page">
      <header className="crm-page-head">
        <div>
          <h1>الداش بورد</h1>
          <p>متابعة العملاء والمحادثات حسب القسم والحالة، بنفس ترتيب الحالات المحفوظ في الإدارة.</p>
        </div>
        <button className="crm-secondary-button" type="button" onClick={() => void loadDashboard()}>
          <ArrowClockwise size={18} />تحديث البيانات
        </button>
      </header>

      <div className="crm-department-tabs crm-main-department-tabs">
        {departments.map((item) => (
          <button
            key={item.key}
            type="button"
            className={department === item.key ? "active" : ""}
            onClick={() => { setDepartment(item.key); setBranch(""); }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <section className="crm-dashboard-summary-grid">
        <article><span className="icon"><UsersThree size={23} /></span><div><small>إجمالي العملاء</small><strong>{summary.total.toLocaleString("ar-SA")}</strong></div></article>
        <article><span className="icon"><UserPlus size={23} /></span><div><small>عملاء جدد</small><strong>{summary.newCount.toLocaleString("ar-SA")}</strong></div></article>
        <article><span className="icon"><ChatCircleDots size={23} /></span><div><small>رسائل غير مقروءة</small><strong>{summary.unread.toLocaleString("ar-SA")}</strong></div></article>
        <article><span className="icon"><PhoneCall size={23} /></span><div><small>عملاء موزعون</small><strong>{summary.assigned.toLocaleString("ar-SA")}</strong></div></article>
        <article><span className="icon"><CheckCircle size={23} /></span><div><small>مكتمل / تم البيع</small><strong>{summary.completed.toLocaleString("ar-SA")}</strong></div></article>
      </section>

      <div className="crm-toolbar crm-dashboard-toolbar">
        <label className="crm-search-box"><MagnifyingGlass size={18} /><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="بحث باسم العميل أو رقم الجوال" /></label>
        <select value={branch} onChange={(event) => setBranch(event.target.value)}>
          <option value="">كل الفروع</option>
          {visibleBranches.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
        </select>
        <div className="crm-toolbar-summary"><UsersThree size={19} /><strong>{leads.length.toLocaleString("ar-SA")}</strong><span>عميل ظاهر</span></div>
      </div>

      {error ? <div className="crm-alert error">{error}</div> : null}
      {loading ? <div className="crm-loading-panel">جاري تحميل بيانات CRM...</div> : null}

      {!loading ? (
        <div className="crm-board crm-board-five">
          {groups.map((group) => (
            <section className={`crm-status-column ${group.unread_messages ? "crm-unread-status-column" : ""}`} key={group.id}>
              <header>
                <div><h2>{group.label}</h2></div>
                <strong>{group.leads.length.toLocaleString("ar-SA")}</strong>
              </header>
              <div className="crm-status-cards">
                {group.leads.map((lead) => (
                  <button
                    type="button"
                    key={lead.id}
                    className={`crm-lead-card ${leadStatus(lead).includes("غير مؤهل") ? "danger" : ""}`}
                    onClick={() => openLead(lead)}
                  >
                    <div className="crm-lead-card-head compact">
                      <div className="crm-lead-name-block">
                        <strong>{lead.customer_name || "عميل"}</strong>
                        <small>{sourceLabel(lead.source_code, lead.source_name)} · {lead.phone || lead.phone_normalized || "بدون رقم جوال"}</small>
                      </div>
                      <span className="crm-completion-badge">مكتمل {lead.completion_percent ?? 0}%</span>
                      {leadHasUnreadMessage(lead) ? <span className="crm-unread-dot" aria-label="رسالة غير مقروءة" title="رسالة غير مقروءة" /> : null}
                    </div>
                    <div className="crm-lead-card-grid compact">
                      <span>المسؤول: <b>{lead.assigned_name || "غير موزع"}</b></span>
                      {department === "finance" ? <span>الكول سنتر: <b>{lead.call_center_name || "غير موزع"}</b></span> : null}
                    </div>
                    <footer><span>{lead.car_name || lead.car_type || "بدون سيارة"}</span><time>{formatDate(lead.last_message_at || lead.updated_at)}</time></footer>
                  </button>
                ))}
                {!group.leads.length ? <div className="crm-column-empty">لا يوجد عملاء</div> : null}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      <LeadDrawer
        lead={selected}
        meta={meta}
        onClose={() => setSelected(null)}
        onSaved={(updated) => {
          setLeads((current) => current.map((lead) => lead.id === updated.id ? { ...lead, ...updated } : lead));
          setSelected((current) => current ? { ...current, ...updated } : current);
        }}
      />
    </div>
  );
}
