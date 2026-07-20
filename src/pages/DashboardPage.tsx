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
    <section className={`operation-card ${className}`}>
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

function startOfCurrentWeekMs() {
  const date = new Date();
  const daysSinceMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - daysSinceMonday);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function isToday(value: unknown) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return false;
  const today = new Date();
  return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [details, setDetails] = useState<DetailPayload | null>(null);
  const [operationsSelection, setOperationsSelection] = useState<DashboardOperationsSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const detailsRequestId = useRef(0);

  useEffect(() => {
    let active = true;
    fetch("/api/dashboard", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: DashboardData) => {
        if (active) setData(payload);
      })
      .catch(() => {
        if (active) setData(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

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
    const results = await Promise.all(departments.map((department) => crmFetch<{ ok: boolean; leads: CrmLead[] }>(`/api/crm/dashboard?department=${department}`)));
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
      const payload = await trackingFetch<{ ok: boolean; orders: TrackingOrderRow[] }>(`/api/tracking/orders${trackingQuery({ status, archived, limit: 2000 })}`);
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

  return (
    <>
      <div className="dashboard-page">
        <header className="dashboard-head">
          <div className="dashboard-title">
            <h1>الداش بورد</h1>
            <p>نظرة عامة على أداء جميع الأنظمة</p>
          </div>
          <div className="dashboard-controls">
            <button className="icon-button" type="button" aria-label="الفلاتر"><SlidersHorizontal size={20} /></button>
            <button className="date-button" type="button"><CalendarBlank size={19} /> آخر 7 أيام</button>
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

        <section className="kpi-grid">
          <KpiCard title="إجمالي العملاء" value={crm?.totalCustomers ?? null} icon={Users} tone="brown" onOpen={() => void openCrmList("إجمالي العملاء", "اضغط على اسم أي عميل لفتح ملفه ومحادثته", () => true)} />
          <KpiCard title="المحادثات المفتوحة" value={crm?.openConversations ?? null} icon={PhoneCall} tone="purple" onOpen={() => void openCrmList("المحادثات المفتوحة", "العملاء الذين لديهم محادثة مفتوحة", (lead) => lead.conversation_status === "open")}  />
          <KpiCard title="العملاء المحتملون" value={crm?.potentialCustomers ?? null} icon={UsersThree} tone="orange" onOpen={() => void openCrmList("العملاء المحتملون", "العملاء الموجودون في حالة محتمل", (lead) => leadStatus(lead) === "محتمل")} />
          <KpiCard title="تم البيع" value={crm?.sold ?? null} icon={Handbag} tone="green" onOpen={() => void openCrmList("تم البيع", "العملاء الموجودون في حالات البيع المكتملة", (lead) => ["تم البيع", "تم الانتهاء - إنشاء طلب البيع", "تم الإنتهاء - إنشاء طلب البيع"].includes(leadStatus(lead)))} />
        </section>

        <section className="analytics-grid">
          <article className="panel chart-panel">
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
                  <SmallMetric label="جدد هذا الأسبوع" value={crm?.newThisWeek ?? null} onClick={() => void openCrmList("جدد هذا الأسبوع", "العملاء المسجلون منذ بداية الأسبوع الحالي", (lead) => Date.parse(String(lead.created_at || lead.registered_at || 0)) >= startOfCurrentWeekMs())} />
                  <SmallMetric label="جدد اليوم" value={crm?.newToday ?? null} onClick={() => void openCrmList("جدد اليوم", "العملاء المسجلون اليوم", (lead) => isToday(lead.created_at || lead.registered_at))} />
                </div>
              </>
            ) : <EmptyChart label="العملاء الجدد" />}
          </article>

          <article className="panel conversations-panel">
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
          </article>

          <article className="panel distribution-panel">
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
          </article>
        </section>

        <section className="summary-panel panel">
          <h2>ملخص الإدارات</h2>
          <div className="department-grid">
            <DepartmentCard title="مبيعات الكاش" icon={Handbag} metrics={[
              { label: "العملاء", value: crm?.cashSales ?? null },
              { label: "تم البيع", value: crm?.sold ?? null },
              { label: "محادثات مفتوحة", value: crm?.openConversations ?? null },
            ]} onOpen={() => void openCrmList("مبيعات الكاش", "كل عملاء مبيعات الكاش", (lead) => dashboardDepartment(lead) === "cash")} />
            <DepartmentCard title="مبيعات التمويل" icon={UsersThree} metrics={[
              { label: "العملاء", value: crm?.financeSales ?? null },
              { label: "تم البيع", value: crm?.sold ?? null },
              { label: "محادثات مفتوحة", value: crm?.openConversations ?? null },
            ]} onOpen={() => void openCrmList("مبيعات التمويل", "كل عملاء مبيعات التمويل", (lead) => dashboardDepartment(lead) === "finance")} />
            <DepartmentCard title="خدمة العملاء" icon={PhoneCall} metrics={[
              { label: "العملاء", value: crm?.customerService ?? null },
              { label: "تم البيع", value: crm?.sold ?? null },
              { label: "محادثات مفتوحة", value: crm?.openConversations ?? null },
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
        </section>

        <section className="operations-dashboard-section">
          <div className="section-title-row">
            <div>
              <span className="section-kicker">سيستم العمليات</span>
              <h2>بيانات العمليات</h2>
            </div>
            <Briefcase size={26} weight="duotone" />
          </div>

          <div className="operations-grid locations-row">
            <OperationCard title="إجمالي المخزون" className="inventory-card" onView={() => setOperationsSelection({ mode: "vehicles", locationCode: "", locationName: "كل الفروع", metric: "actual_total", metricName: "الإجمالي الفعلي" })}>
              <div className="inventory-primary">
                <span>الإجمالي الفعلي</span>
                <Value value={operations?.inventory.actualTotal ?? null} />
              </div>
              <div className="inventory-tags">
                <OperationMetric label="الوكالة" value={operations?.inventory.agency ?? null} onOpen={() => setOperationsSelection({ mode: "vehicles", locationCode: "agency", locationName: "الوكالة", metric: "actual_total", metricName: "الإجمالي الفعلي" })} />
                <OperationMetric label="المتاح للبيع" value={operations?.inventory.availableForSale ?? null} onOpen={() => setOperationsSelection({ mode: "vehicles", locationCode: "", locationName: "كل الفروع", metric: "available_for_sale", metricName: "متاح للبيع" })} />
                <OperationMetric label="بها ملاحظات" value={operations?.inventory.hasNotes ?? null} onOpen={() => setOperationsSelection({ mode: "vehicles", locationCode: "", locationName: "كل الفروع", metric: "has_notes", metricName: "بها ملاحظات" })} />
                <OperationMetric label="مباع تحت التسليم" value={operations?.inventory.underDelivery ?? null} onOpen={() => setOperationsSelection({ mode: "vehicles", locationCode: "", locationName: "كل الفروع", metric: "under_delivery", metricName: "مباع تحت التسليم" })} />
              </div>
              <p className="operation-note">الإجمالي الفعلي = إجمالي السيارات بدون (مباع تحت التسليم) - (مباع تم التسليم)</p>
            </OperationCard>

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
              return (
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
          </div>

          <div className="operations-grid lower-row">
            <OperationCard title="كارت الموافقة المالية والإدارية" badge={operations?.approvals.total ?? null} onView={() => open("كارت الموافقة المالية والإدارية", [
              { label: "الإجمالي", value: operations?.approvals.total ?? null },
              { label: "ناقص موافقة مالية", value: operations?.approvals.missingFinancial ?? null },
              { label: "ناقص موافقة إدارية", value: operations?.approvals.missingAdministrative ?? null },
              { label: "موافقات مكتملة", value: operations?.approvals.completed ?? null },
            ])}>
              <div className="operation-metrics-grid">
                <OperationMetric label="ناقص موافقة مالية" value={operations?.approvals.missingFinancial ?? null} onOpen={() => open("ناقص موافقة مالية", [{ label: "ناقص موافقة مالية", value: operations?.approvals.missingFinancial ?? null }])} />
                <OperationMetric label="ناقص موافقة إدارية" value={operations?.approvals.missingAdministrative ?? null} onOpen={() => open("ناقص موافقة إدارية", [{ label: "ناقص موافقة إدارية", value: operations?.approvals.missingAdministrative ?? null }])} />
                <OperationMetric label="موافقات مكتملة" value={operations?.approvals.completed ?? null} onOpen={() => open("موافقات مكتملة", [{ label: "موافقات مكتملة", value: operations?.approvals.completed ?? null }])} />
              </div>
            </OperationCard>

            <OperationCard title="نواقص السيارات" badge={operations?.shortages.total ?? null} onView={() => open("نواقص السيارات", [
              { label: "الإجمالي", value: operations?.shortages.total ?? null },
              { label: "الملتقى", value: operations?.shortages.multaqa ?? null },
              { label: "الصالة", value: operations?.shortages.hall ?? null },
              { label: "القادسية", value: operations?.shortages.qadisiyah ?? null },
            ])}>
              <div className="operation-metrics-grid three-columns">
                <OperationMetric label="الملتقى" value={operations?.shortages.multaqa ?? null} onOpen={() => open("نواقص السيارات - الملتقى", [{ label: "الملتقى", value: operations?.shortages.multaqa ?? null }])} />
                <OperationMetric label="الصالة" value={operations?.shortages.hall ?? null} onOpen={() => open("نواقص السيارات - الصالة", [{ label: "الصالة", value: operations?.shortages.hall ?? null }])} />
                <OperationMetric label="القادسية" value={operations?.shortages.qadisiyah ?? null} onOpen={() => open("نواقص السيارات - القادسية", [{ label: "القادسية", value: operations?.shortages.qadisiyah ?? null }])} />
              </div>
            </OperationCard>

            <OperationCard title="طلبات النقل والتصوير" badge={operations?.transfers.total ?? null} onView={() => setOperationsSelection({ mode: "requests" })}>
              <div className="operation-metrics-grid">
                <OperationMetric label="طلبات النقل" value={operations?.transfers.transferTotal ?? null} onOpen={() => setOperationsSelection({ mode: "requests" })} />
                <OperationMetric label="طلبات التصوير" value={operations?.transfers.photographyTotal ?? null} onOpen={() => setOperationsSelection({ mode: "requests" })} />
                <OperationMetric label="تم استلام الطلب" value={operations?.transfers.requestReceived ?? null} onOpen={() => setOperationsSelection({ mode: "requests" })} />
                <OperationMetric label="تم استلام السيارة" value={operations?.transfers.vehicleReceived ?? null} onOpen={() => setOperationsSelection({ mode: "requests" })} />
                <OperationMetric label="تم إرسال السيارة" value={operations?.transfers.vehicleSent ?? null} onOpen={() => setOperationsSelection({ mode: "requests" })} />
                <OperationMetric label="تم الانتهاء" value={operations?.transfers.completed ?? null} onOpen={() => setOperationsSelection({ mode: "requests" })} />
              </div>
            </OperationCard>

            <OperationCard title="تتبع إجراءات البيع (Tracking)" badge={operations?.salesTracking.total ?? null} className="tracking-operation-card" onView={() => open("تتبع إجراءات البيع (Tracking)", [
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
            </OperationCard>
          </div>
        </section>
      </div>
      <DetailsDrawer details={details} onClose={() => { detailsRequestId.current += 1; setDetails(null); }} onLeadOpen={openCrmLead} />
      <DashboardOperationsModal selection={operationsSelection} onClose={() => setOperationsSelection(null)} />
    </>
  );
}
