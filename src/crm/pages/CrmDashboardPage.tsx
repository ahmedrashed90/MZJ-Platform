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
  X,
} from "@phosphor-icons/react";
import { useEscapeToClose } from "../../components/useEscapeToClose";
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

const departmentStorageKey = "mzj.crm.dashboard.department";

function initialDepartment(requestedDepartment: string) {
  if (departments.some((item) => item.key === requestedDepartment)) return requestedDepartment;
  try {
    const stored = window.sessionStorage.getItem(departmentStorageKey) || "";
    if (departments.some((item) => item.key === stored)) return stored;
  } catch {}
  return "cash";
}

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

function isDashboardTerminalStatus(department: string, value: string) {
  const status = String(value || "").trim();
  if (department === "cash" || department === "finance") {
    return ["تم البيع", "تم الانتهاء - إنشاء طلب البيع", "تم الإنتهاء - إنشاء طلب البيع"].includes(status);
  }
  if (department === "service") return ["تم الانتهاء", "تم الإنتهاء"].includes(status);
  return false;
}

function isDangerStatusColumn(department: string, value: string) {
  const status = String(value || "").trim();
  return (department === "cash" || department === "finance") && ["غير مؤهل", "تم البيع"].includes(status);
}

function riyadhDateKey(value: unknown) {
  if (!value) return "";
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const part = (type: "year" | "month" | "day") => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function leadHasDueFollowUp(lead: CrmLead) {
  if (leadStatus(lead) !== "مؤجل") return false;
  const followUpDate = riyadhDateKey(lead.follow_up_at);
  if (!followUpDate) return false;
  return followUpDate <= riyadhDateKey(new Date());
}

export function CrmDashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedLeadId = searchParams.get("lead") || "";
  const requestedDepartment = searchParams.get("department") || "";
  const [meta, setMeta] = useState<CrmMeta | null>(null);
  const [department, setDepartment] = useState(() => initialDepartment(requestedDepartment));
  const [q, setQ] = useState("");
  const [branch, setBranch] = useState("");
  const [statuses, setStatuses] = useState<CrmStatus[]>([]);
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [selected, setSelected] = useState<CrmLead | null>(null);
  const [summaryView, setSummaryView] = useState<{ title: string; subtitle: string; leads: CrmLead[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const openedRequestedLead = useRef("");

  useEffect(() => { void loadMeta(); }, []);
  useEffect(() => {
    if (!departments.some((item) => item.key === requestedDepartment) || requestedDepartment === department) return;
    setDepartment(requestedDepartment);
    setBranch("");
    setSelected(null);
    openedRequestedLead.current = "";
    try { window.sessionStorage.setItem(departmentStorageKey, requestedDepartment); } catch {}
  }, [requestedDepartment, department]);
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

  function openLead(lead: CrmLead) {
    const patched = readPatch(lead);
    setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, ...patched } : item));
    setSelected(patched);
  }

  function selectDepartment(nextDepartment: string) {
    setDepartment(nextDepartment);
    setBranch("");
    setSelected(null);
    openedRequestedLead.current = "";
    try { window.sessionStorage.setItem(departmentStorageKey, nextDepartment); } catch {}
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("department", nextDepartment);
    nextParams.delete("lead");
    setSearchParams(nextParams, { replace: true });
  }

  function openSummary(title: string, subtitle: string, matches: (lead: CrmLead) => boolean) {
    setSummaryView({ title, subtitle, leads: leads.filter(matches) });
  }

  useEscapeToClose(Boolean(summaryView), () => setSummaryView(null));

  const groups = useMemo(() => {
    const originalOrder = new Map(leads.map((lead, index) => [lead.id, index]));
    const byUnreadFirst = (left: CrmLead, right: CrmLead) => {
      const unreadDifference = Number(leadHasUnreadMessage(right)) - Number(leadHasUnreadMessage(left));
      return unreadDifference || Number(originalOrder.get(left.id) || 0) - Number(originalOrder.get(right.id) || 0);
    };
    const byPostponedPriority = (left: CrmLead, right: CrmLead) => {
      const followUpDifference = Number(leadHasDueFollowUp(right)) - Number(leadHasDueFollowUp(left));
      if (followUpDifference) return followUpDifference;
      if (leadHasDueFollowUp(left) && leadHasDueFollowUp(right)) {
        const dateDifference = riyadhDateKey(left.follow_up_at).localeCompare(riyadhDateKey(right.follow_up_at));
        if (dateDifference) return dateDifference;
      }
      return byUnreadFirst(left, right);
    };
    const statusGroups = statuses
      .filter((status) => status.is_active !== false)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
      .map((status) => ({
        ...status,
        unread_messages: false,
        leads: leads
          .filter((lead) => leadStatus(lead) === String(status.value || status.label).trim())
          .sort(String(status.value || status.label).trim() === "مؤجل" ? byPostponedPriority : byUnreadFirst),
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
    const completed = leads.filter((lead) => ["تم البيع", "تم الانتهاء"].includes(leadStatus(lead))).length;
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
            onClick={() => selectDepartment(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <section className="crm-dashboard-summary-grid">
        <button type="button" className="crm-dashboard-summary-card" onClick={() => openSummary("إجمالي العملاء", "كل العملاء الظاهرين في القسم الحالي", () => true)}><span className="icon"><UsersThree size={23} /></span><div><small>إجمالي العملاء</small><strong>{summary.total.toLocaleString("ar-SA")}</strong></div></button>
        <button type="button" className="crm-dashboard-summary-card" onClick={() => openSummary("العملاء الجدد", "العملاء الموجودون في حالة عميل جديد", (lead) => leadStatus(lead) === "عميل جديد")}><span className="icon"><UserPlus size={23} /></span><div><small>عملاء جدد</small><strong>{summary.newCount.toLocaleString("ar-SA")}</strong></div></button>
        <button type="button" className="crm-dashboard-summary-card" onClick={() => openSummary("الرسائل غير المقروءة", "العملاء الذين لديهم رسائل واردة لم يفتحها المندوب بعد", leadHasUnreadMessage)}><span className="icon"><ChatCircleDots size={23} /></span><div><small>رسائل غير مقروءة</small><strong>{summary.unread.toLocaleString("ar-SA")}</strong></div></button>
        <button type="button" className="crm-dashboard-summary-card" onClick={() => openSummary("العملاء الموزعون", "العملاء المرتبطون بمندوب أو مسؤول", (lead) => Boolean(lead.assigned_to || lead.assigned_name))}><span className="icon"><PhoneCall size={23} /></span><div><small>عملاء موزعون</small><strong>{summary.assigned.toLocaleString("ar-SA")}</strong></div></button>
        <button type="button" className="crm-dashboard-summary-card" onClick={() => openSummary("مكتمل / تم البيع", "العملاء الموجودون في الحالات المكتملة أو تم البيع", (lead) => ["تم البيع", "تم الانتهاء"].includes(leadStatus(lead)))}><span className="icon"><CheckCircle size={23} /></span><div><small>مكتمل / تم البيع</small><strong>{summary.completed.toLocaleString("ar-SA")}</strong></div></button>
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
            <section className={`crm-status-column ${group.unread_messages ? "crm-unread-status-column" : ""} ${isDangerStatusColumn(department, String(group.value || group.label)) ? "crm-danger-status-column" : ""}`} key={group.id}>
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
                      {leadHasDueFollowUp(lead) ? <span className="crm-follow-up-badge" aria-label="متابعة مستحقة" title="متابعة مستحقة">متابعة</span> : null}
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

      {summaryView ? (
        <div className="crm-modal-backdrop" onMouseDown={() => setSummaryView(null)}>
          <div className="crm-modal-card crm-dashboard-summary-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><h2>{summaryView.title}</h2><p>{summaryView.subtitle}</p></div><button className="crm-icon-button" type="button" onClick={() => setSummaryView(null)} aria-label="إغلاق"><X size={19} /></button></header>
            <div className="crm-dashboard-summary-list">
              {summaryView.leads.map((lead) => (
                <button type="button" key={lead.id} className="crm-dashboard-summary-lead" onClick={() => { setSummaryView(null); openLead(lead); }}>
                  <div><strong>{lead.customer_name || "عميل"}</strong><span>{leadStatus(lead)} · {sourceLabel(lead.source_code, lead.source_name)}</span><small>{lead.phone || lead.phone_normalized || "بدون رقم جوال"}{lead.preview_text ? ` · ${lead.preview_text}` : ""}</small></div>
                  <div className="crm-dashboard-summary-lead-meta">{leadHasUnreadMessage(lead) ? <b>{Math.max(1, Number(lead.unread_count || 0)).toLocaleString("ar-SA")}</b> : null}<time>{formatDate(lead.last_message_at || lead.updated_at)}</time></div>
                </button>
              ))}
              {!summaryView.leads.length ? <div className="crm-empty-state">لا يوجد عملاء داخل هذا الكارت</div> : null}
            </div>
          </div>
        </div>
      ) : null}

      <LeadDrawer
        lead={selected}
        meta={meta}
        onClose={() => setSelected(null)}
        onRead={(updated) => {
          setLeads((current) => current.map((lead) => lead.id === updated.id ? { ...lead, ...updated } : lead));
          setSelected((current) => current?.id === updated.id ? { ...current, ...updated } : current);
        }}
        onSaved={(updated) => {
          if (isDashboardTerminalStatus(department, leadStatus(updated))) {
            setLeads((current) => current.filter((lead) => lead.id !== updated.id));
            setSummaryView((current) => current ? { ...current, leads: current.leads.filter((lead) => lead.id !== updated.id) } : current);
            setSelected(null);
            void loadDashboard(true);
            return;
          }
          setLeads((current) => current.map((lead) => lead.id === updated.id ? { ...lead, ...updated } : lead));
          setSelected((current) => current ? { ...current, ...updated } : current);
        }}
      />
    </div>
  );
}
