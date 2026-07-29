import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Briefcase,
  CalendarBlank,
  Car,
  ChartLineUp,
  CheckCircle,
  Clock,
  CurrencyCircleDollar,
  DotsSixVertical,
  FileMagnifyingGlass,
  GearSix,
  Handbag,
  MapPin,
  Megaphone,
  Package,
  PhoneCall,
  SlidersHorizontal,
  Storefront,
  Truck,
  UserCircle,
  Users,
  UsersThree,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useNavigate } from "react-router-dom";
import { useEscapeToClose } from "../components/useEscapeToClose";
import { crmFetch, formatDate } from "../crm/api";
import type { CrmLead } from "../crm/types";
import { formatTrackingDate, trackingFetch, trackingQuery } from "../tracking/api";
import type { TrackingOrderRow, TrackingStatus } from "../tracking/types";
import type { DashboardData, NullableNumber } from "../types";
import { DashboardOperationsModal, type DashboardOperationsSelection } from "../operations/components/DashboardOperationsModal";

const numberFormatter = new Intl.NumberFormat("en-US");

const MAIN_DASHBOARD_WIDGETS = [
  { id: "kpi:total-customers", label: "إجمالي العملاء" },
  { id: "kpi:open-conversations", label: "المحادثات المفتوحة" },
  { id: "kpi:no-answer", label: "لم يتم الرد" },
  { id: "kpi:sold", label: "تم البيع" },
  { id: "analytics:new-customers", label: "العملاء الجدد" },
  { id: "analytics:recent-conversations", label: "آخر المحادثات" },
  { id: "analytics:distribution", label: "توزيع العملاء حسب القسم" },
  { id: "summary:departments", label: "ملخص الإدارات" },
] as const;

type MainDashboardWidgetId = typeof MAIN_DASHBOARD_WIDGETS[number]["id"];
const DEFAULT_MAIN_WIDGET_ORDER = MAIN_DASHBOARD_WIDGETS.map((item) => item.id);

function valueText(value: NullableNumber) {
  return value === null ? "—" : numberFormatter.format(value);
}

function Value({ value, className = "" }: { value: NullableNumber; className?: string }) {
  return <span className={className}>{valueText(value)}</span>;
}

type DashboardLeadItem = {
  lead: CrmLead;
  department: "cash" | "finance" | "service";
};

type DetailPayload = {
  title: string;
  subtitle?: string;
  rows?: Array<{ label: string; value: NullableNumber }>;
  leads?: DashboardLeadItem[];
  trackingOrders?: TrackingOrderRow[];
  loading?: boolean;
  error?: string;
};

function DetailsDrawer({ details, onClose, onLeadOpen }: { details: DetailPayload | null; onClose: () => void; onLeadOpen: (item: DashboardLeadItem) => void }) {
  useEscapeToClose(Boolean(details), onClose);
  if (!details) return null;

  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside className={`details-drawer ${details.trackingOrders ? "tracking-orders-drawer" : ""}`} onMouseDown={(event) => event.stopPropagation()}>
        <header className="drawer-head">
          <div>
            <span>التفاصيل</span>
            <h2>{details.title}</h2>
            {details.subtitle ? <p>{details.subtitle}</p> : null}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="إغلاق">
            <X size={20} />
          </button>
        </header>
        <div className="drawer-body">
          {(details.rows || []).map((row) => (
            <div className="drawer-row" key={row.label}>
              <span>{row.label}</span>
              <Value value={row.value} className="drawer-value" />
            </div>
          ))}
          {details.loading ? <div className="drawer-loading">{details.trackingOrders ? "جاري تحميل الطلبات..." : "جاري تحميل العملاء..."}</div> : null}
          {details.error ? <div className="drawer-error">{details.error}</div> : null}
          {(details.leads || []).map((item) => {
            const lead = item.lead;
            const unread = Math.max(0, Number(lead.unread_count || 0));
            return (
              <button className="drawer-customer-row" key={lead.id} type="button" onClick={() => onLeadOpen(item)}>
                <div><strong>{lead.customer_name || "عميل"}</strong><span>{lead.status_label || "عميل جديد"} · {item.department === "finance" ? "مبيعات التمويل" : item.department === "service" ? "خدمة العملاء" : "مبيعات الكاش"}</span><small>{lead.phone || lead.phone_normalized || "بدون رقم جوال"}{lead.preview_text ? ` · ${lead.preview_text}` : ""}</small></div>
                <div className="drawer-customer-meta">{unread > 0 ? <b>{unread.toLocaleString("ar-SA")}</b> : null}<time>{formatDate(lead.last_message_at || lead.updated_at || lead.created_at)}</time></div>
              </button>
            );
          })}
          {details.trackingOrders ? (
            <div className="drawer-tracking-table-wrap">
              <table className="drawer-tracking-table">
                <thead><tr><th>رقم الطلب</th><th>العميل</th><th>الفرع</th><th>التقدم</th><th>آخر تحديث</th></tr></thead>
                <tbody>
                  {details.trackingOrders.map((order) => {
                    const total = Number(order.total_stages || 0);
                    const percent = total > 0 ? Math.round((Number(order.completed_stages || 0) / total) * 100) : 0;
                    return (
                      <tr key={order.id}>
                        <td><strong>{order.sales_order_no || "—"}</strong></td>
                        <td>{order.customer_name || "—"}</td>
                        <td>{order.branch || "—"}</td>
                        <td><div className="drawer-tracking-progress"><span style={{ width: `${percent}%` }} /></div><small>{percent}%</small></td>
                        <td>{formatTrackingDate(order.updated_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          {!details.loading && !details.error && details.leads && !details.leads.length ? <div className="drawer-empty">لا توجد بيانات داخل هذا الكارت</div> : null}
          {!details.loading && !details.error && details.trackingOrders && !details.trackingOrders.length ? <div className="drawer-empty">لا توجد طلبات في هذه الحالة</div> : null}
        </div>
      </aside>
    </div>
  );
}

function KpiCard({
  title,
  value,
  icon: Icon,
  tone,
  onOpen,
}: {
  title: string;
  value: NullableNumber;
  icon: typeof Users;
  tone: string;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="kpi-card" onClick={onOpen}>
      <div className="kpi-icon" data-tone={tone}><Icon size={31} weight="duotone" /></div>
      <div className="kpi-copy">
        <h3>{title}</h3>
        <Value value={value} className="kpi-value" />
        <span className="data-source">من قاعدة البيانات</span>
      </div>
    </button>
  );
}

function SmallMetric({ label, value, onClick }: { label: string; value: NullableNumber; onClick?: () => void }) {
  const content = (
    <>
      <span>{label}</span>
      <Value value={value} />
    </>
  );
  return onClick ? <button className="small-metric" type="button" onClick={onClick}>{content}</button> : <div className="small-metric">{content}</div>;
}

function DepartmentCard({
  title,
  icon: Icon,
  metrics,
  onOpen,
}: {
  title: string;
  icon: typeof Users;
  metrics: Array<{ label: string; value: NullableNumber }>;
  onOpen: () => void;
}) {
  return (
    <button className="department-card" type="button" onClick={onOpen}>
      <div className="department-card-head">
        <div className="department-icon"><Icon size={20} weight="duotone" /></div>
        <strong>{title}</strong>
      </div>
      <div className="department-metrics">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <span>{metric.label}</span>
            <Value value={metric.value} />
          </div>
        ))}
      </div>
    </button>
  );
}

function OperationMetric({ label, value, onOpen }: { label: string; value: NullableNumber; onOpen: () => void }) {
  return (
    <button type="button" className="operation-metric" onClick={onOpen}>
      <span>{label}</span>
      <Value value={value} />
    </button>
  );
}

function OperationCard({
  title,
  badge,
  children,
  onView,
  className = "",
}: {
  title: string;
  badge?: NullableNumber;
  children: React.ReactNode;
  onView: () => void;
  className?: string;
}) {
  return (
    <section
      className={`operation-card operation-card-clickable ${className}`}
      role="button"
      tabIndex={0}
      aria-label={`عرض ${title}`}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button, a, input, select, textarea")) return;
        onView();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onView();
        }
      }}
    >
      <header className="operation-card-head">
        <h3>{title}</h3>
        {badge !== undefined ? <Value value={badge} className="operation-badge" /> : null}
      </header>
      <div className="operation-card-body">
        {children}
        <div className="operation-actions">
          <button className="view-button" type="button" onClick={onView}>عرض</button>
        </div>
      </div>
    </section>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="empty-chart">
      <FileMagnifyingGlass size={32} weight="duotone" />
      <strong>{label}</strong>
      <span>ستظهر البيانات بعد ربط PostgreSQL</span>
    </div>
  );
}

function dashboardDepartment(lead: CrmLead): "cash" | "finance" | "service" {
  const code = String(lead.department_code || lead.service_key || "").toLowerCase();
  if (code.includes("finance") || code.includes("call_center")) return "finance";
  if (code.includes("service")) return "service";
  return "cash";
}

function leadStatus(lead: CrmLead) {
  return String(lead.status_label || lead.status_code || "عميل جديد").trim();
}

function riyadhDateKey(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function riyadhWeekStartKey() {
  const todayKey = riyadhDateKey(new Date());
  const [year, month, day] = todayKey.split("-").map(Number);
  if (!year || !month || !day) return "";
  const riyadhNoonAsUtc = new Date(Date.UTC(year, month - 1, day, 9));
  const daysSinceMonday = (riyadhNoonAsUtc.getUTCDay() + 6) % 7;
  riyadhNoonAsUtc.setUTCDate(riyadhNoonAsUtc.getUTCDate() - daysSinceMonday);
  return riyadhNoonAsUtc.toISOString().slice(0, 10);
}

function isToday(value: unknown) {
  return riyadhDateKey(value) === riyadhDateKey(new Date());
}

function defaultDashboardRange() {
  return { from: riyadhDateKey(new Date(Date.now() - 6 * 86400000)), to: riyadhDateKey(new Date()) };
}

function dashboardRangeLabel(range: { from: string; to: string }) {
  const defaultRange = defaultDashboardRange();
  if (range.from === defaultRange.from && range.to === defaultRange.to) return "آخر 7 أيام";
  return `${range.from} — ${range.to}`;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [details, setDetails] = useState<DetailPayload | null>(null);
  const [operationsSelection, setOperationsSelection] = useState<DashboardOperationsSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const [appliedRange, setAppliedRange] = useState(defaultDashboardRange);
  const [draftRange, setDraftRange] = useState(defaultDashboardRange);
  const [dateOpen, setDateOpen] = useState(false);
  const [operationWidgetOrder, setOperationWidgetOrder] = useState<string[]>([]);
  const [draggedOperationWidget, setDraggedOperationWidget] = useState<string | null>(null);
  const [mainWidgetOrder, setMainWidgetOrder] = useState<string[]>(DEFAULT_MAIN_WIDGET_ORDER);
  const [hiddenMainWidgets, setHiddenMainWidgets] = useState<string[]>([]);
  const [draggedMainWidget, setDraggedMainWidget] = useState<MainDashboardWidgetId | null>(null);
  const [dashboardCustomizeOpen, setDashboardCustomizeOpen] = useState(false);
  const detailsRequestId = useRef(0);
  useEscapeToClose(dateOpen, () => setDateOpen(false));
  useEscapeToClose(dashboardCustomizeOpen, () => setDashboardCustomizeOpen(false));

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams(appliedRange);
    fetch(`/api/dashboard?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || "تعذر تحميل الداش بورد");
        return payload as DashboardData;
      })
      .then((payload) => {
        if (active) {
          setData(payload);
          setOperationWidgetOrder(payload.layout?.operationWidgetOrder || []);
          setMainWidgetOrder(payload.layout?.mainWidgetOrder || DEFAULT_MAIN_WIDGET_ORDER);
          setHiddenMainWidgets(payload.layout?.hiddenMainWidgets || []);
        }
      })
      .catch(() => {
        if (active) setData(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [appliedRange.from, appliedRange.to]);

  const current = data;
  const pieData = useMemo(() => {
    if (!current?.connected) return [];
    return [
      { name: "مبيعات الكاش", value: current.crm.cashSales ?? 0 },
      { name: "مبيعات التمويل", value: current.crm.financeSales ?? 0 },
      { name: "خدمة العملاء", value: current.crm.customerService ?? 0 },
    ].filter((item) => item.value > 0);
  }, [current]);

  const open = (title: string, rows: NonNullable<DetailPayload["rows"]>, subtitle?: string) => setDetails({ title, rows, subtitle });

  async function allVisibleCrmLeads() {
    const departments = ["cash", "finance", "service"] as const;
    const results = await Promise.all(departments.map((department) => {
      const params = new URLSearchParams({ department, from: appliedRange.from, to: appliedRange.to, includeClosed: "1" });
      return crmFetch<{ ok: boolean; leads: CrmLead[] }>(`/api/crm/dashboard?${params.toString()}`);
    }));
    const unique = new Map<string, CrmLead>();
    results.flatMap((result) => result.leads || []).forEach((lead) => unique.set(lead.id, lead));
    return [...unique.values()];
  }

  async function openCrmList(title: string, subtitle: string, predicate: (lead: CrmLead) => boolean) {
    const requestId = ++detailsRequestId.current;
    setDetails({ title, subtitle, loading: true, leads: [] });
    try {
      const leads = (await allVisibleCrmLeads()).filter(predicate);
      if (detailsRequestId.current !== requestId) return;
      setDetails({ title, subtitle, leads: leads.map((lead) => ({ lead, department: dashboardDepartment(lead) })) });
    } catch (failure) {
      if (detailsRequestId.current !== requestId) return;
      setDetails({ title, subtitle, leads: [], error: failure instanceof Error ? failure.message : "تعذر تحميل تفاصيل العملاء" });
    }
  }

  async function openTrackingList(title: string, status: TrackingStatus) {
    const requestId = ++detailsRequestId.current;
    const archived = status === "completed";
    setDetails({ title, subtitle: "بيانات الطلبات حسب الحالة", loading: true, trackingOrders: [] });
    try {
      const payload = await trackingFetch<{ ok: boolean; orders: TrackingOrderRow[] }>(`/api/tracking/orders${trackingQuery({ status, archived, limit: 2000, from: appliedRange.from, to: appliedRange.to })}`);
      if (detailsRequestId.current !== requestId) return;
      setDetails({ title, subtitle: "بيانات الطلبات حسب الحالة", trackingOrders: payload.orders || [] });
    } catch (failure) {
      if (detailsRequestId.current !== requestId) return;
      setDetails({ title, subtitle: "بيانات الطلبات حسب الحالة", trackingOrders: [], error: failure instanceof Error ? failure.message : "تعذر تحميل بيانات الطلبات" });
    }
  }

  function openCrmLead(item: DashboardLeadItem) {
    setDetails(null);
    navigate(`/crm?department=${item.department}&lead=${encodeURIComponent(item.lead.id)}`);
  }

  const disconnected = !loading && !current?.connected;
  const sectionErrorLabels = Object.keys(current?.sectionErrors || {}).map((key) => ({ crm: "CRM", marketing: "التسويق", tracking: "التراكينج", operations: "العمليات" }[key] || key));
  const crm = current?.crm;
  const marketing = current?.marketing;
  const tracking = current?.tracking;
  const operations = current?.operations;
  const rangeInvalid = !draftRange.from || !draftRange.to || draftRange.from > draftRange.to;

  function applyDashboardRange() {
    if (rangeInvalid) return;
    setAppliedRange({ ...draftRange });
    setDateOpen(false);
    setDetails(null);
    setOperationsSelection(null);
  }

  function resetDashboardRange() {
    const next = defaultDashboardRange();
    setDraftRange(next);
    setAppliedRange(next);
    setDateOpen(false);
    setDetails(null);
    setOperationsSelection(null);
  }

  const effectiveMainWidgetOrder = [...mainWidgetOrder, ...DEFAULT_MAIN_WIDGET_ORDER.filter((id) => !mainWidgetOrder.includes(id))] as MainDashboardWidgetId[];
  const mainWidgetPosition = (id: MainDashboardWidgetId) => effectiveMainWidgetOrder.indexOf(id);
  const mainWidgetVisible = (id: MainDashboardWidgetId) => !hiddenMainWidgets.includes(id);
  const visibleMainWidgets = MAIN_DASHBOARD_WIDGETS.some((item) => mainWidgetVisible(item.id));

  async function persistMainWidgetLayout(nextOrder: string[], nextHidden: string[]) {
    const previousOrder = mainWidgetOrder;
    const previousHidden = hiddenMainWidgets;
    setMainWidgetOrder(nextOrder);
    setHiddenMainWidgets(nextHidden);
    try {
      const response = await fetch("/api/dashboard", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mainWidgetOrder: nextOrder, hiddenMainWidgets: nextHidden }),
      });
      if (!response.ok) throw new Error("تعذر حفظ تخصيص كروت الداش بورد");
    } catch {
      setMainWidgetOrder(previousOrder);
      setHiddenMainWidgets(previousHidden);
    }
  }

  function setMainWidgetVisibility(id: MainDashboardWidgetId, visible: boolean) {
    const nextHidden = visible
      ? hiddenMainWidgets.filter((item) => item !== id)
      : [...new Set([...hiddenMainWidgets, id])];
    void persistMainWidgetLayout(effectiveMainWidgetOrder, nextHidden);
  }

  function resetMainWidgetLayout() {
    void persistMainWidgetLayout(DEFAULT_MAIN_WIDGET_ORDER, []);
  }

  function dropMainWidget(targetId: MainDashboardWidgetId) {
    if (!draggedMainWidget || draggedMainWidget === targetId) return;
    const next = effectiveMainWidgetOrder.filter((id) => id !== draggedMainWidget);
    const targetIndex = Math.max(0, next.indexOf(targetId));
    next.splice(targetIndex, 0, draggedMainWidget);
    setDraggedMainWidget(null);
    void persistMainWidgetLayout(next, hiddenMainWidgets);
  }

  function customizableMainWidget(id: MainDashboardWidgetId, content: React.ReactNode) {
    if (!mainWidgetVisible(id)) return null;
    const sizeClass = id.startsWith("kpi:")
      ? "dashboard-main-widget-kpi"
      : id === "summary:departments"
        ? "dashboard-main-widget-summary"
        : "dashboard-main-widget-analytics";
    return <div
      key={id}
      className={`dashboard-main-widget ${sizeClass} ${draggedMainWidget === id ? "dragging" : ""}`}
      style={{ order: mainWidgetPosition(id) }}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
      onDrop={(event) => { event.preventDefault(); dropMainWidget(id); }}
    >
      <div className="dashboard-main-widget-controls">
        <span
          className="dashboard-main-widget-drag"
          title="اسحب لتغيير ترتيب الكارت"
          draggable
          onDragStart={(event) => { setDraggedMainWidget(id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id); }}
          onDragEnd={() => setDraggedMainWidget(null)}
        ><DotsSixVertical size={17} weight="bold" /></span>
        <button type="button" title="إخفاء الكارت" aria-label={`إخفاء ${MAIN_DASHBOARD_WIDGETS.find((item) => item.id === id)?.label || "الكارت"}`} onClick={() => setMainWidgetVisibility(id, false)}><X size={14} weight="bold" /></button>
      </div>
      {content}
    </div>;
  }

  const defaultOperationWidgetOrder = ["inventory", "location:warehouse", "location:agency", "location:hall", "location:qadisiyah", "location:multaqa", "approvals", "shortages", "transfers", "sales-tracking"];
  const effectiveOperationWidgetOrder = [...operationWidgetOrder, ...defaultOperationWidgetOrder.filter((id) => !operationWidgetOrder.includes(id))];
  const operationWidgetPosition = (id: string) => effectiveOperationWidgetOrder.indexOf(id);

  async function persistOperationWidgetOrder(next: string[]) {
    setOperationWidgetOrder(next);
    try {
      const response = await fetch("/api/dashboard", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationWidgetOrder: next }) });
      if (!response.ok) throw new Error("تعذر حفظ ترتيب الكروت");
    } catch {
      setOperationWidgetOrder(data?.layout?.operationWidgetOrder || defaultOperationWidgetOrder);
    }
  }

  function dropOperationWidget(targetId: string) {
    if (!draggedOperationWidget || draggedOperationWidget === targetId) return;
    const next = effectiveOperationWidgetOrder.filter((id) => id !== draggedOperationWidget);
    const targetIndex = Math.max(0, next.indexOf(targetId));
    next.splice(targetIndex, 0, draggedOperationWidget);
    setDraggedOperationWidget(null);
    void persistOperationWidgetOrder(next);
  }

  function draggableOperationWidget(id: string, content: React.ReactNode) {
    return <div
      key={id}
      className={`dashboard-operation-widget ${draggedOperationWidget === id ? "dragging" : ""}`}
      style={{ order: operationWidgetPosition(id) }}
      draggable
      onDragStart={(event) => { setDraggedOperationWidget(id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id); }}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
      onDrop={(event) => { event.preventDefault(); dropOperationWidget(id); }}
      onDragEnd={() => setDraggedOperationWidget(null)}
    >
      <span className="dashboard-card-drag-handle" title="اسحب لتغيير ترتيب الكارت"><DotsSixVertical size={20} weight="bold" /></span>
      {content}
    </div>;
  }

  return (
    <>
      <div className="dashboard-page">
        <header className="dashboard-head">
          <div className="dashboard-title">
            <h1>الداش بورد</h1>
            <p>نظرة عامة على أداء جميع الأنظمة</p>
          </div>
          <div className="dashboard-controls">
            <div className="dashboard-widget-settings">
              <button className="icon-button" type="button" aria-label="تخصيص كروت الداش بورد" title="تخصيص كروت الداش بورد" onClick={() => { setDateOpen(false); setDashboardCustomizeOpen((value) => !value); }} aria-expanded={dashboardCustomizeOpen}><GearSix size={20} /></button>
              {dashboardCustomizeOpen ? <div className="dashboard-widget-settings-popover">
                <header><strong>تخصيص كروت الداش بورد</strong><span>أظهر أو أخفِ الكروت، واسحب أي كارت لتغيير مكانه في الداش بورد.</span></header>
                <div className="dashboard-widget-visibility-list">
                  {MAIN_DASHBOARD_WIDGETS.map((item) => <label key={item.id}><input type="checkbox" checked={mainWidgetVisible(item.id)} onChange={(event) => setMainWidgetVisibility(item.id, event.target.checked)} /><span>{item.label}</span></label>)}
                </div>
                <button type="button" className="dashboard-widget-reset" onClick={resetMainWidgetLayout}>إرجاع الشكل الافتراضي</button>
              </div> : null}
            </div>
            <button className="icon-button" type="button" aria-label="اختيار مدة الداش بورد" onClick={() => { setDashboardCustomizeOpen(false); setDraftRange(appliedRange); setDateOpen((value) => !value); }}><SlidersHorizontal size={20} /></button>
            <div className="dashboard-date-filter">
              <button className="date-button" type="button" onClick={() => { setDashboardCustomizeOpen(false); setDraftRange(appliedRange); setDateOpen((value) => !value); }} aria-expanded={dateOpen}>
                <CalendarBlank size={19} /> {dashboardRangeLabel(appliedRange)}
              </button>
              {dateOpen ? <div className="dashboard-date-popover">
                <header><strong>مدة بيانات الداش بورد</strong><span>اختر تاريخ البداية والنهاية</span></header>
                <div className="dashboard-date-fields">
                  <label><span>من تاريخ</span><input type="date" value={draftRange.from} max={draftRange.to || undefined} onChange={(event) => setDraftRange((currentRange) => ({ ...currentRange, from: event.target.value }))} /></label>
                  <label><span>إلى تاريخ</span><input type="date" value={draftRange.to} min={draftRange.from || undefined} onChange={(event) => setDraftRange((currentRange) => ({ ...currentRange, to: event.target.value }))} /></label>
                </div>
                {rangeInvalid ? <p>تأكد أن تاريخ البداية يسبق تاريخ النهاية.</p> : null}
                <footer><button type="button" className="dashboard-range-reset" onClick={resetDashboardRange}>آخر 7 أيام</button><button type="button" className="dashboard-range-apply" disabled={rangeInvalid || loading} onClick={applyDashboardRange}>{loading ? "جاري التحديث..." : "تطبيق المدة"}</button></footer>
              </div> : null}
            </div>
          </div>
        </header>

        {disconnected ? (
          <div className="connection-banner">
            <WarningCircle size={20} weight="fill" />
            <span>تعذر الاتصال بقاعدة PostgreSQL، لذلك لا يتم عرض أي أرقام أو بيانات وهمية.</span>
          </div>
        ) : null}
        {!disconnected && sectionErrorLabels.length ? (
          <div className="connection-banner warning">
            <WarningCircle size={20} weight="fill" />
            <span>تعذر تحديث بعض أقسام الداش بورد: {sectionErrorLabels.join("، ")}. بقية الأقسام المتاحة ما زالت تعمل بصورة طبيعية.</span>
          </div>
        ) : null}

        {visibleMainWidgets ? <section className="dashboard-main-widget-grid">
          {customizableMainWidget("kpi:total-customers", <KpiCard title="إجمالي العملاء" value={crm?.totalCustomers ?? null} icon={Users} tone="brown" onOpen={() => void openCrmList("إجمالي العملاء", "اضغط على اسم أي عميل لفتح ملفه ومحادثته", () => true)} />)}
          {customizableMainWidget("kpi:open-conversations", <KpiCard title="المحادثات المفتوحة" value={crm?.openConversations ?? null} icon={PhoneCall} tone="purple" onOpen={() => void openCrmList("المحادثات المفتوحة", "العملاء الذين لديهم محادثة مفتوحة", (lead) => lead.conversation_status === "open")} />)}
          {customizableMainWidget("kpi:no-answer", <KpiCard title="لم يتم الرد" value={crm?.noAnswerCustomers ?? null} icon={UsersThree} tone="orange" onOpen={() => void openCrmList("لم يتم الرد", "العملاء الموجودون في حالة لم يتم الرد", (lead) => leadStatus(lead) === "لم يتم الرد")} />)}
          {customizableMainWidget("kpi:sold", <KpiCard title="تم البيع" value={crm?.sold ?? null} icon={Handbag} tone="green" onOpen={() => void openCrmList("تم البيع", "العملاء الموجودون في حالات البيع المكتملة", (lead) => leadStatus(lead) === "تم البيع")} />)}

          {customizableMainWidget("analytics:new-customers", <article className="panel chart-panel">
            <h2>العملاء الجدد</h2>
            {current?.connected && (crm?.newCustomersSeries.length ?? 0) > 0 ? (
              <>
                <div className="line-chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={crm?.newCustomersSeries ?? []} margin={{ top: 18, right: 8, left: 0, bottom: 2 }}>
                      <defs>
                        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#d86d47" stopOpacity={0.23} />
                          <stop offset="100%" stopColor="#d86d47" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="#f1e8e4" />
                      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#8c7f7a", fontSize: 11 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: "#8c7f7a", fontSize: 11 }} width={28} />
                      <Tooltip />
                      <Area type="monotone" dataKey="value" stroke="#d86d47" strokeWidth={2.4} fill="url(#chartFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="chart-summary">
                  <SmallMetric label="جدد هذا الأسبوع" value={crm?.newThisWeek ?? null} onClick={() => void openCrmList("جدد هذا الأسبوع", "العملاء المسجلون منذ بداية الأسبوع الحالي", (lead) => riyadhDateKey(lead.registered_at || lead.created_at) >= riyadhWeekStartKey())} />
                  <SmallMetric label="جدد اليوم" value={crm?.newToday ?? null} onClick={() => void openCrmList("جدد اليوم", "العملاء المسجلون اليوم", (lead) => isToday(lead.registered_at || lead.created_at))} />
                </div>
              </>
            ) : <EmptyChart label="العملاء الجدد" />}
          </article>)}

          {customizableMainWidget("analytics:recent-conversations", <article className="panel conversations-panel">
            <h2>آخر المحادثات</h2>
            {current?.connected && (crm?.recentConversations.length ?? 0) > 0 ? (
              <div className="conversation-list">
                {crm?.recentConversations.map((conversation) => (
                  <button type="button" className="conversation-row" key={conversation.id} onClick={() => navigate(`/crm?department=${conversation.department}&lead=${encodeURIComponent(conversation.leadId || conversation.id)}`)}>
                    <div className="conversation-avatar"><UserCircle size={27} weight="duotone" /></div>
                    <div className="conversation-copy"><strong>{conversation.customerName}</strong><span>{conversation.preview || "بدون نص"}</span></div>
                    <div className="conversation-meta"><span>{conversation.time}</span>{conversation.unreadCount > 0 ? <b>{conversation.unreadCount}</b> : null}</div>
                  </button>
                ))}
              </div>
            ) : <EmptyChart label="آخر المحادثات" />}
          </article>)}

          {customizableMainWidget("analytics:distribution", <article className="panel distribution-panel">
            <h2>توزيع العملاء حسب القسم</h2>
            {pieData.length > 0 ? (
              <div className="distribution-content">
                <div className="pie-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" innerRadius="57%" outerRadius="88%" paddingAngle={1}>
                        {pieData.map((entry, index) => <Cell key={entry.name} fill={["#5b291f", "#e88b63", "#c3a28d"][index]} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pie-center"><Value value={crm?.totalCustomers ?? null} /><span>إجمالي العملاء</span></div>
                </div>
                <div className="distribution-legend">
                  {pieData.map((entry, index) => (
                    <button type="button" key={entry.name} onClick={() => void openCrmList(entry.name, `عملاء ${entry.name}`, (lead) => dashboardDepartment(lead) === (entry.name === "مبيعات التمويل" ? "finance" : entry.name === "خدمة العملاء" ? "service" : "cash"))}>
                      <i style={{ background: ["#5b291f", "#e88b63", "#c3a28d"][index] }} />
                      <span>{entry.name}</span>
                      <strong>{numberFormatter.format(entry.value)}</strong>
                    </button>
                  ))}
                </div>
              </div>
            ) : <EmptyChart label="توزيع العملاء حسب القسم" />}
          </article>)}

          {customizableMainWidget("summary:departments", <section className="summary-panel panel">
            <h2>ملخص الإدارات</h2>
            <div className="department-grid">
              <DepartmentCard title="مبيعات الكاش" icon={Handbag} metrics={[
                { label: "العملاء", value: crm?.cashSales ?? null },
                { label: "تم البيع", value: crm?.sold ?? null },
                { label: "محادثات مفتوحة", value: crm?.openCashConversations ?? null },
              ]} onOpen={() => void openCrmList("مبيعات الكاش", "كل عملاء مبيعات الكاش", (lead) => dashboardDepartment(lead) === "cash")} />
              <DepartmentCard title="مبيعات التمويل" icon={UsersThree} metrics={[
                { label: "العملاء", value: crm?.financeSales ?? null },
                { label: "تم البيع", value: crm?.sold ?? null },
                { label: "محادثات مفتوحة", value: crm?.openFinanceConversations ?? null },
              ]} onOpen={() => void openCrmList("مبيعات التمويل", "كل عملاء مبيعات التمويل", (lead) => dashboardDepartment(lead) === "finance")} />
              <DepartmentCard title="خدمة العملاء" icon={PhoneCall} metrics={[
                { label: "العملاء", value: crm?.customerService ?? null },
                { label: "تم البيع", value: crm?.sold ?? null },
                { label: "محادثات مفتوحة", value: crm?.openServiceConversations ?? null },
              ]} onOpen={() => void openCrmList("خدمة العملاء", "كل عملاء خدمة العملاء", (lead) => dashboardDepartment(lead) === "service")} />
              <DepartmentCard title="التسويق" icon={Megaphone} metrics={[
                { label: "الحملات", value: marketing?.campaigns ?? null },
                { label: "مجدولة", value: marketing?.scheduled ?? null },
                { label: "متأخرة", value: marketing?.delayed ?? null },
              ]} onOpen={() => open("التسويق", [{ label: "الحملات", value: marketing?.campaigns ?? null }, { label: "مجدولة", value: marketing?.scheduled ?? null }, { label: "متأخرة", value: marketing?.delayed ?? null }])} />
              <DepartmentCard title="التراكينج" icon={MapPin} metrics={[
                { label: "الطلبات", value: tracking?.requests ?? null },
                { label: "متابعة", value: tracking?.inProgress ?? null },
                { label: "مكتملة", value: tracking?.completed ?? null },
              ]} onOpen={() => open("التراكينج", [{ label: "الطلبات", value: tracking?.requests ?? null }, { label: "متابعة", value: tracking?.inProgress ?? null }, { label: "مكتملة", value: tracking?.completed ?? null }])} />
            </div>
          </section>)}
        </section> : null}

        <section className="operations-dashboard-section">
          <div className="section-title-row">
            <div>
              <span className="section-kicker">سيستم العمليات</span>
              <h2>بيانات العمليات</h2>
            </div>
            <div className="operation-layout-actions"><button type="button" className="secondary" onClick={() => void persistOperationWidgetOrder(defaultOperationWidgetOrder)}>إعادة الترتيب الافتراضي</button><Briefcase size={26} weight="duotone" /></div>
          </div>

          <div className="operations-grid operations-widget-grid reorderable-operations-grid">
            {draggableOperationWidget("inventory", <OperationCard title="إجمالي المخزون" className="inventory-card" onView={() => setOperationsSelection({ mode: "vehicles", locationCode: "", locationName: "كل الفروع", metric: "actual_total", metricName: "الإجمالي الفعلي" })}>
              <div className="inventory-primary">
                <span>الإجمالي الفعلي</span>
                <Value value={operations?.inventory.actualTotal ?? null} />
              </div>
              <div className="inventory-tags">
                <OperationMetric label="الوكالة" value={operations?.inventory.agency ?? null} onOpen={() => setOperationsSelection({ mode: "vehicles", locationCode: "agency", locationName: "الوكالة", metric: "actual_total", metricName: "الإجمالي الفعلي" })} />
                <OperationMetric label="حجز" value={operations?.inventory.reserved ?? null} onOpen={() => setOperationsSelection({ mode: "vehicles", locationCode: "", locationName: "كل الفروع", metric: "reserved", metricName: "حجز", branchesOnly: true })} />
                <OperationMetric label="المتاح للبيع" value={operations?.inventory.availableForSale ?? null} onOpen={() => setOperationsSelection({ mode: "vehicles", locationCode: "", locationName: "كل الفروع", metric: "available_for_sale", metricName: "متاح للبيع" })} />
                <OperationMetric label="بها ملاحظات" value={operations?.inventory.hasNotes ?? null} onOpen={() => setOperationsSelection({ mode: "vehicles", locationCode: "", locationName: "كل الفروع", metric: "has_notes", metricName: "بها ملاحظات" })} />
                <OperationMetric label="مباع تحت التسليم" value={operations?.inventory.underDelivery ?? null} onOpen={() => setOperationsSelection({ mode: "vehicles", locationCode: "", locationName: "كل الفروع", metric: "under_delivery", metricName: "مباع تحت التسليم" })} />
              </div>
              <p className="operation-note">الإجمالي الفعلي = مخزون الفروع + الوكالة بدون (مباع تحت التسليم) و(مباع تم التسليم)</p>
              <div className="inventory-reserved-branches">
                <strong>الحجز حسب الفروع</strong>
                <div>{(operations?.inventory.reservedByLocation || []).map((item) => <button type="button" key={item.key} onClick={() => setOperationsSelection({ mode: "vehicles", locationCode: item.key, locationName: item.name, metric: "reserved", metricName: "حجز" })}><span>{item.name}</span><Value value={item.value} /></button>)}</div>
              </div>
            </OperationCard>)}

            {(operations?.locations ?? [
              { key: "warehouse", name: "المستودع", actualTotal: null, underDelivery: null, availableForSale: null, reserved: null, delivered: null, hasNotes: null },
              { key: "agency", name: "الوكالة", actualTotal: null, underDelivery: null, availableForSale: null, reserved: null, delivered: null, hasNotes: null },
              { key: "hall", name: "الصالة", actualTotal: null, underDelivery: null, availableForSale: null, reserved: null, delivered: null, hasNotes: null },
              { key: "qadisiyah", name: "القادسية", actualTotal: null, underDelivery: null, availableForSale: null, reserved: null, delivered: null, hasNotes: null },
              { key: "multaqa", name: "الملتقى", actualTotal: null, underDelivery: null, availableForSale: null, reserved: null, delivered: null, hasNotes: null },
            ]).map((location) => {
              const rows = [
                { label: "الإجمالي الفعلي", value: location.actualTotal },
                { label: "مباع تحت التسليم", value: location.underDelivery },
                { label: "متاح للبيع", value: location.availableForSale },
                { label: "حجز", value: location.reserved },
                { label: "مباع تم التسليم", value: location.delivered },
                { label: "بها ملاحظات", value: location.hasNotes },
              ];
              return draggableOperationWidget(`location:${location.key}`,
                <OperationCard key={location.key} title={location.name} onView={() => setOperationsSelection({ mode: "vehicles", locationCode: location.key, locationName: location.name, metric: "actual_total", metricName: "الإجمالي الفعلي" })}>
                  <div className="operation-metrics-grid">
                    {rows.map((row) => {
                      const metricCodes: Record<string, string> = { "الإجمالي الفعلي": "actual_total", "مباع تحت التسليم": "under_delivery", "متاح للبيع": "available_for_sale", "حجز": "reserved", "مباع تم التسليم": "delivered", "بها ملاحظات": "has_notes" };
                      return <OperationMetric key={row.label} label={row.label} value={row.value} onOpen={() => setOperationsSelection({ mode: "vehicles", locationCode: location.key, locationName: location.name, metric: metricCodes[row.label] || "actual_total", metricName: row.label })} />;
                    })}
                  </div>
                </OperationCard>
              );
            })}

            {draggableOperationWidget("approvals", <OperationCard
              title="كارت الموافقة المالية والإدارية"
              badge={operations?.approvals.total ?? null}
              onView={() => setOperationsSelection({ mode: "approvals", filter: "", title: "كل سيارات الموافقات المالية والإدارية" })}
            >
              <div className="operation-metrics-grid">
                <OperationMetric
                  label="ناقص موافقة مالية"
                  value={operations?.approvals.missingFinancial ?? null}
                  onOpen={() => setOperationsSelection({ mode: "approvals", filter: "missing_financial", title: "السيارات الناقصة موافقة مالية" })}
                />
                <OperationMetric
                  label="ناقص موافقة إدارية"
                  value={operations?.approvals.missingAdministrative ?? null}
                  onOpen={() => setOperationsSelection({ mode: "approvals", filter: "missing_administrative", title: "السيارات الناقصة موافقة إدارية" })}
                />
                <OperationMetric
                  label="موافقات مكتملة"
                  value={operations?.approvals.completed ?? null}
                  onOpen={() => setOperationsSelection({ mode: "approvals", filter: "completed", title: "السيارات مكتملة الموافقات" })}
                />
              </div>
              <div className="dashboard-approval-notes-preview">
                <strong>آخر ملاحظات الموافقات</strong>
                {(operations?.approvals.recentNotes || []).length ? (operations?.approvals.recentNotes || []).map((note) => (
                  <button key={note.id} type="button" onClick={() => setOperationsSelection({ mode: "approvals", filter: "", title: "كل سيارات الموافقات المالية والإدارية" })}>
                    <span><b dir="ltr">{note.vin || "—"}</b><small>{note.carName || "—"}</small></span>
                    <p>{note.financialNote ? `مالي: ${note.financialNote}` : ""}{note.financialNote && note.administrativeNote ? " · " : ""}{note.administrativeNote ? `إداري: ${note.administrativeNote}` : ""}</p>
                  </button>
                )) : <span className="dashboard-approval-notes-empty">لا توجد ملاحظات مسجلة حاليًا</span>}
              </div>
            </OperationCard>)}

            {draggableOperationWidget("shortages", <OperationCard title="نواقص السيارات" badge={operations?.shortages.total ?? null} onView={() => setOperationsSelection({ mode: "shortages", locationCode: "", locationName: "كل الفروع" })}>
              <div className="operation-metrics-grid three-columns">
                <OperationMetric label="الملتقى" value={operations?.shortages.multaqa ?? null} onOpen={() => setOperationsSelection({ mode: "shortages", locationCode: "multaqa", locationName: "الملتقى" })} />
                <OperationMetric label="الصالة" value={operations?.shortages.hall ?? null} onOpen={() => setOperationsSelection({ mode: "shortages", locationCode: "hall", locationName: "الصالة" })} />
                <OperationMetric label="القادسية" value={operations?.shortages.qadisiyah ?? null} onOpen={() => setOperationsSelection({ mode: "shortages", locationCode: "qadisiyah", locationName: "القادسية" })} />
              </div>
            </OperationCard>)}

            {draggableOperationWidget("transfers", <OperationCard title="طلبات النقل والتصوير" badge={operations?.transfers.total ?? null} onView={() => setOperationsSelection({ mode: "requests", kind: "all", title: "طلبات النقل والتصوير" })}>
              <div className="operation-metrics-grid">
                <OperationMetric label="طلبات النقل" value={operations?.transfers.transferTotal ?? null} onOpen={() => setOperationsSelection({ mode: "requests", kind: "transfer", title: "طلبات النقل" })} />
                <OperationMetric label="طلبات التصوير" value={operations?.transfers.photographyTotal ?? null} onOpen={() => setOperationsSelection({ mode: "requests", kind: "photography", title: "طلبات التصوير" })} />
                <OperationMetric label="تم استلام الطلب" value={operations?.transfers.requestReceived ?? null} onOpen={() => setOperationsSelection({ mode: "requests", kind: "all", status: "request_received", title: "الطلبات — تم استلام الطلب" })} />
                <OperationMetric label="تم استلام السيارة" value={operations?.transfers.vehicleReceived ?? null} onOpen={() => setOperationsSelection({ mode: "requests", kind: "all", status: "vehicle_received", title: "الطلبات — تم استلام السيارة" })} />
                <OperationMetric label="تم إرسال السيارة" value={operations?.transfers.vehicleSent ?? null} onOpen={() => setOperationsSelection({ mode: "requests", kind: "all", status: "vehicle_sent", title: "الطلبات — تم إرسال السيارة" })} />
                <OperationMetric label="تم الانتهاء" value={operations?.transfers.completed ?? null} onOpen={() => setOperationsSelection({ mode: "requests", kind: "all", status: "completed", title: "الطلبات — تم الانتهاء" })} />
              </div>
            </OperationCard>)}

            {draggableOperationWidget("sales-tracking", <OperationCard title="تتبع إجراءات البيع (Tracking)" badge={operations?.salesTracking.total ?? null} className="tracking-operation-card" onView={() => open("تتبع إجراءات البيع (Tracking)", [
              { label: "طلبات لم تبدأ", value: operations?.salesTracking.notStarted ?? null },
              { label: "طلبات تحت الإجراء", value: operations?.salesTracking.inProgress ?? null },
              { label: "طلبات مكتملة", value: operations?.salesTracking.completed ?? null },
            ])}>
              <div className="tracking-search-line">
                <div><FileMagnifyingGlass size={19} /><span>بحث في طلبات التتبع</span></div>
                <button type="button" onClick={() => open("جميع طلبات التتبع", [{ label: "الإجمالي", value: operations?.salesTracking.total ?? null }])}>عرض الكل</button>
              </div>
              <div className="operation-metrics-grid three-columns">
                <OperationMetric label="طلبات لم تبدأ" value={operations?.salesTracking.notStarted ?? null} onOpen={() => void openTrackingList("طلبات لم تبدأ", "not_started")} />
                <OperationMetric label="طلبات تحت الإجراء" value={operations?.salesTracking.inProgress ?? null} onOpen={() => void openTrackingList("طلبات تحت الإجراء", "in_progress")} />
                <OperationMetric label="طلبات مكتملة" value={operations?.salesTracking.completed ?? null} onOpen={() => void openTrackingList("طلبات مكتملة", "completed")} />
              </div>
            </OperationCard>)}
          </div>
        </section>
      </div>
      <DetailsDrawer details={details} onClose={() => { detailsRequestId.current += 1; setDetails(null); }} onLeadOpen={openCrmLead} />
      <DashboardOperationsModal selection={operationsSelection} onClose={() => setOperationsSelection(null)} />
    </>
  );
}
