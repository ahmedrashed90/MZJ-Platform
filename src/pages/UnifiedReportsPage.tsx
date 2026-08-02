import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, Briefcase, Car, ChartBar, CheckCircle, ClockCounterClockwise, MapPin, Megaphone, Truck, UsersThree, WarningCircle } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { CrmReportsPage } from "../crm/pages/CrmReportsPage";
import { MonitoringPage } from "../marketing/pages/MonitoringPage";
import "../marketing/marketing.css";
import { operationsFetch, formatOperationsDate, queryString as operationsQuery } from "../operations/api";
import { trackingFetch, trackingQuery, trackingStatusLabel, formatTrackingDate } from "../tracking/api";
import type { TrackingCounts, TrackingOrderRow } from "../tracking/types";
import { canAccessMarketing, canAccessOperations, canAccessTracking, canAccessCrm, hasPermission } from "../systemAccess";
import type { DashboardData } from "../types";

type ReportTab = "crm" | "marketing" | "operations" | "tracking";
type MovementRow = {
  id?: string;
  created_at?: string | null;
  vin?: string | null;
  car_name?: string | null;
  from_location_name?: string | null;
  to_location_name?: string | null;
  old_status_name?: string | null;
  new_status_name?: string | null;
  performed_by_name?: string | null;
};

const tabLabels: Record<ReportTab, string> = {
  crm: "تقارير CRM",
  marketing: "تقارير التسويق",
  operations: "تقارير العمليات",
  tracking: "تقارير التراكينج",
};

function metric(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("ar-SA") : "—";
}

function OperationsReports() {
  const { user } = useAuth();
  const canViewMovements = hasPermission(user, "operations.movements.view");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const dashboardRequest = fetch("/api/dashboard", { credentials: "include", cache: "no-store" }).then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || "تعذر تحميل ملخص العمليات");
        return payload as DashboardData;
      });
      const movementRequest = canViewMovements
        ? operationsFetch<{ rows: MovementRow[] }>(`/api/operations${operationsQuery({ resource: "movements", page: 1, pageSize: 20 })}`)
        : Promise.resolve({ rows: [] as MovementRow[] });
      const [dashboardResult, movementResult] = await Promise.allSettled([dashboardRequest, movementRequest]);
      if (dashboardResult.status === "fulfilled") setDashboard(dashboardResult.value);
      else setDashboard(null);
      if (movementResult.status === "fulfilled") setMovements(movementResult.value.rows || []);
      else setMovements([]);
      if (dashboardResult.status === "rejected" && movementResult.status === "rejected") throw dashboardResult.reason;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل تقرير العمليات");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  const operations = dashboard?.operations;

  return (
    <section className="unified-report-content">
      <header className="unified-section-heading">
        <div><h2>تقارير العمليات</h2><p>ملخص المخزون والموافقات والطلبات والتراكينج التشغيلي، مع آخر الحركات المسجلة.</p></div>
        <div className="unified-heading-actions">{canViewMovements ? <Link to="/operations/movements">فتح سجل الحركات الكامل</Link> : null}<button type="button" onClick={() => void load()} disabled={loading}><ArrowClockwise size={17} />تحديث</button></div>
      </header>
      {error ? <div className="unified-data-alert"><WarningCircle size={18} />{error}</div> : null}
      <div className="unified-report-kpis">
        <article><span><Car size={22} /></span><div><small>إجمالي المخزون الفعلي</small><strong>{metric(operations?.inventory.actualTotal)}</strong><p>المركبات الفعلية داخل النظام</p></div></article>
        <article><span><CheckCircle size={22} /></span><div><small>متاح للبيع</small><strong>{metric(operations?.inventory.availableForSale)}</strong><p>مركبات جاهزة للبيع</p></div></article>
        <article><span><Truck size={22} /></span><div><small>تحت التسليم</small><strong>{metric(operations?.inventory.underDelivery)}</strong><p>مركبات في مرحلة التسليم</p></div></article>
        <article><span><Briefcase size={22} /></span><div><small>إجمالي الطلبات</small><strong>{metric(operations?.transfers.total)}</strong><p>نقل وتصوير ومراحل تنفيذ</p></div></article>
        <article><span><WarningCircle size={22} /></span><div><small>الموافقات الناقصة</small><strong>{metric((operations?.approvals.missingFinancial || 0) + (operations?.approvals.missingAdministrative || 0))}</strong><p>مالية وإدارية</p></div></article>
        <article><span><ClockCounterClockwise size={22} /></span><div><small>نواقص السيارات</small><strong>{metric(operations?.shortages.total)}</strong><p>كل السيارات المسجلة بنواقص</p></div></article>
      </div>

      <div className="unified-report-grid">
        <section className="panel unified-report-panel">
          <header><div><h3>المخزون حسب المكان</h3><p>الأعداد الفعلية وحالات البيع والتسليم في كل موقع.</p></div><MapPin size={22} /></header>
          <div className="unified-table-wrap"><table><thead><tr><th>المكان</th><th>الإجمالي</th><th>متاح للبيع</th><th>محجوز</th><th>تحت التسليم</th><th>تم التسليم</th><th>بها ملاحظات</th></tr></thead><tbody>
            {(operations?.locations || []).map((row) => <tr key={row.key}><td><strong>{row.name}</strong></td><td>{metric(row.actualTotal)}</td><td>{metric(row.availableForSale)}</td><td>{metric(row.reserved)}</td><td>{metric(row.underDelivery)}</td><td>{metric(row.delivered)}</td><td>{metric(row.hasNotes)}</td></tr>)}
            {!operations?.locations?.length ? <tr><td colSpan={7}><div className="unified-empty-row">لا توجد بيانات مواقع متاحة.</div></td></tr> : null}
          </tbody></table></div>
        </section>

        <section className="panel unified-report-panel">
          <header><div><h3>مؤشرات التشغيل</h3><p>الموافقات والطلبات ومراحل التراكينج المرتبطة بالعمليات.</p></div><ChartBar size={22} /></header>
          <div className="unified-stat-list">
            <div><span>الموافقات المكتملة</span><strong>{metric(operations?.approvals.completed)}</strong></div>
            <div><span>طلبات النقل</span><strong>{metric(operations?.transfers.transferTotal)}</strong></div>
            <div><span>طلبات التصوير</span><strong>{metric(operations?.transfers.photographyTotal)}</strong></div>
            <div><span>الطلبات المكتملة</span><strong>{metric(operations?.transfers.completed)}</strong></div>
            <div><span>تراكينج لم يبدأ</span><strong>{metric(operations?.salesTracking.notStarted)}</strong></div>
            <div><span>تراكينج تحت الإجراء</span><strong>{metric(operations?.salesTracking.inProgress)}</strong></div>
            <div><span>تراكينج مكتمل</span><strong>{metric(operations?.salesTracking.completed)}</strong></div>
          </div>
        </section>
      </div>

      <section className="panel unified-report-panel">
        <header><div><h3>آخر الحركات</h3><p>أحدث الحركات التي تمت على السيارات داخل نظام العمليات.</p></div><ClockCounterClockwise size={22} /></header>
        <div className="unified-table-wrap"><table><thead><tr><th>التاريخ</th><th>رقم الهيكل</th><th>السيارة</th><th>من</th><th>إلى</th><th>الحالة السابقة</th><th>الحالة الجديدة</th><th>المنفذ</th></tr></thead><tbody>
          {movements.map((row, index) => <tr key={row.id || `${row.vin}-${index}`}><td>{formatOperationsDate(row.created_at)}</td><td>{row.vin || "—"}</td><td>{row.car_name || "—"}</td><td>{row.from_location_name || "—"}</td><td>{row.to_location_name || "—"}</td><td>{row.old_status_name || "—"}</td><td>{row.new_status_name || "—"}</td><td>{row.performed_by_name || "—"}</td></tr>)}
          {!movements.length && !loading ? <tr><td colSpan={8}><div className="unified-empty-row">لا توجد حركات متاحة.</div></td></tr> : null}
        </tbody></table></div>
      </section>
    </section>
  );
}

function TrackingReports() {
  const [orders, setOrders] = useState<TrackingOrderRow[]>([]);
  const [counts, setCounts] = useState<TrackingCounts>({ total: 0, not_started: 0, in_progress: 0, completed: 0, archived: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const payload = await trackingFetch<{ orders: TrackingOrderRow[]; counts: TrackingCounts }>(`/api/tracking/orders${trackingQuery({ archived: "false" })}`);
      setOrders(payload.orders || []);
      setCounts(payload.counts || { total: 0, not_started: 0, in_progress: 0, completed: 0, archived: 0 });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل تقارير التراكينج");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <section className="unified-report-content">
      <header className="unified-section-heading">
        <div><h2>تقارير التراكينج</h2><p>حالات الطلبات ونسب الإنجاز وآخر طلبات التتبع المسجلة.</p></div>
        <div className="unified-heading-actions"><Link to="/tracking">فتح التراكينج الكامل</Link><button type="button" onClick={() => void load()} disabled={loading}><ArrowClockwise size={17} />تحديث</button></div>
      </header>
      {error ? <div className="unified-data-alert"><WarningCircle size={18} />{error}</div> : null}
      <div className="unified-report-kpis">
        <article><span><ChartBar size={22} /></span><div><small>إجمالي الطلبات</small><strong>{metric(counts.total)}</strong><p>كل الطلبات النشطة</p></div></article>
        <article><span><ClockCounterClockwise size={22} /></span><div><small>لم يبدأ</small><strong>{metric(counts.not_started)}</strong><p>لم تبدأ أي مرحلة</p></div></article>
        <article><span><Truck size={22} /></span><div><small>تحت الإجراء</small><strong>{metric(counts.in_progress)}</strong><p>بدأ تنفيذ مراحل التتبع</p></div></article>
        <article><span><CheckCircle size={22} /></span><div><small>مكتمل</small><strong>{metric(counts.completed)}</strong><p>اكتملت جميع المراحل</p></div></article>
        <article><span><Briefcase size={22} /></span><div><small>المؤرشف</small><strong>{metric(counts.archived)}</strong><p>طلبات محفوظة بالأرشيف</p></div></article>
      </div>
      <section className="panel unified-report-panel">
        <header><div><h3>آخر طلبات التراكينج</h3><p>أحدث الطلبات مع العميل والفرع والحالة ونسبة إتمام المراحل.</p></div><Truck size={22} /></header>
        <div className="unified-table-wrap"><table><thead><tr><th>رقم الطلب</th><th>العميل</th><th>الفرع</th><th>المندوب</th><th>السيارات</th><th>الحالة</th><th>التقدم</th><th>آخر تحديث</th></tr></thead><tbody>
          {orders.slice(0, 50).map((order) => {
            const totalStages = Number(order.total_stages || 0);
            const progress = totalStages ? Math.round((Number(order.completed_stages || 0) / totalStages) * 100) : 0;
            return <tr key={order.id}><td><strong>{order.sales_order_no}</strong></td><td>{order.customer_name || "—"}</td><td>{order.branch || "—"}</td><td>{order.sales_person || "—"}</td><td>{metric(order.vehicles_count)}</td><td>{trackingStatusLabel(order.status, Boolean(order.is_archived), Boolean(order.is_cancelled))}</td><td>{progress.toLocaleString("ar-SA")}%</td><td>{formatTrackingDate(order.updated_at)}</td></tr>;
          })}
          {!orders.length && !loading ? <tr><td colSpan={8}><div className="unified-empty-row">لا توجد طلبات تراكينج متاحة.</div></td></tr> : null}
        </tbody></table></div>
      </section>
    </section>
  );
}

export function UnifiedReportsPage() {
  const { user } = useAuth();
  const tabs = useMemo(() => [
    canAccessCrm(user) && hasPermission(user, "crm.reports.view") ? "crm" : null,
    canAccessMarketing(user) && hasPermission(user, "marketing.monitoring.view") ? "marketing" : null,
    canAccessOperations(user) && (hasPermission(user, "operations.inventory.view") || hasPermission(user, "operations.movements.view")) ? "operations" : null,
    canAccessTracking(user) && hasPermission(user, "tracking.orders.view") ? "tracking" : null,
  ].filter(Boolean) as ReportTab[], [user]);
  const [active, setActive] = useState<ReportTab>(tabs[0] || "crm");

  useEffect(() => {
    if (!tabs.includes(active) && tabs[0]) setActive(tabs[0]);
  }, [active, tabs]);

  return (
    <div className="module-page unified-center-page">
      {tabs.length ? (
        <>
          <nav className="unified-system-tabs" aria-label="أنظمة التقارير">
            {tabs.map((tab) => <button type="button" key={tab} className={active === tab ? "active" : ""} onClick={() => setActive(tab)}>{tab === "crm" ? <UsersThree size={19} /> : tab === "marketing" ? <Megaphone size={19} /> : tab === "operations" ? <Briefcase size={19} /> : <Truck size={19} />}<span>{tabLabels[tab]}</span></button>)}
          </nav>
          <div className="unified-system-content">
            {active === "crm" ? <CrmReportsPage /> : null}
            {active === "marketing" ? <MonitoringPage /> : null}
            {active === "operations" ? <OperationsReports /> : null}
            {active === "tracking" ? <TrackingReports /> : null}
          </div>
        </>
      ) : <section className="module-empty"><div><WarningCircle size={45} /><h2>لا توجد تقارير متاحة</h2><p>لا يملك الحساب صلاحية قراءة تقارير أي نظام حاليًا.</p></div></section>}
    </div>
  );
}
