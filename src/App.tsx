import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { Sidebar } from "./components/Sidebar";
import { DashboardPage } from "./pages/DashboardPage";
import { DatabaseSetupPage } from "./pages/DatabaseSetupPage";
import { EmptyModulePage } from "./pages/EmptyModulePage";
import { FirstAdminSetupPage } from "./pages/FirstAdminSetupPage";
import { LoginPage } from "./pages/LoginPage";
import { PlatformLoadingPage } from "./pages/PlatformLoadingPage";
import { SettingsPage } from "./pages/SettingsPage";
import { canAccessSystem, canOpenSettings, defaultSystemPath, hasPermission, type PlatformSystem } from "./systemAccess";

const CrmLayout = lazy(() => import("./crm/CrmLayout").then((module) => ({ default: module.CrmLayout })));
const CrmDashboardPage = lazy(() => import("./crm/pages/CrmDashboardPage").then((module) => ({ default: module.CrmDashboardPage })));
const CrmDatabasePage = lazy(() => import("./crm/pages/CrmDatabasePage").then((module) => ({ default: module.CrmDatabasePage })));
const CrmManualLeadsPage = lazy(() => import("./crm/pages/CrmManualLeadsPage").then((module) => ({ default: module.CrmManualLeadsPage })));
const CrmFinanceHistoryPage = lazy(() => import("./crm/pages/CrmFinanceHistoryPage").then((module) => ({ default: module.CrmFinanceHistoryPage })));
const CrmInboxAgentPage = lazy(() => import("./crm/pages/CrmInboxAgentPage").then((module) => ({ default: module.CrmInboxAgentPage })));
const CrmReportsPage = lazy(() => import("./crm/pages/CrmReportsPage").then((module) => ({ default: module.CrmReportsPage })));
const CrmKpiPage = lazy(() => import("./crm/pages/CrmKpiPage").then((module) => ({ default: module.CrmKpiPage })));
const CrmInboxPage = lazy(() => import("./crm/pages/CrmInboxPage").then((module) => ({ default: module.CrmInboxPage })));
const CrmContactsPage = lazy(() => import("./crm/pages/CrmContactsPage").then((module) => ({ default: module.CrmContactsPage })));
const TrackingLayout = lazy(() => import("./tracking/TrackingLayout").then((module) => ({ default: module.TrackingLayout })));
const TrackingOrdersPage = lazy(() => import("./tracking/pages/TrackingOrdersPage").then((module) => ({ default: module.TrackingOrdersPage })));
const TrackingDeletePage = lazy(() => import("./tracking/pages/TrackingDeletePage").then((module) => ({ default: module.TrackingDeletePage })));
const PublicTrackingPage = lazy(() => import("./tracking/pages/PublicTrackingPage").then((module) => ({ default: module.PublicTrackingPage })));
const MarketingLayout = lazy(() => import("./marketing/MarketingLayout").then((module) => ({ default: module.MarketingLayout })));
const MarketingDashboardPage = lazy(() => import("./marketing/pages/MarketingDashboardPage").then((module) => ({ default: module.MarketingDashboardPage })));
const CreateCampaignPage = lazy(() => import("./marketing/pages/CreateCampaignPage").then((module) => ({ default: module.CreateCampaignPage })));
const CreateAgendaPage = lazy(() => import("./marketing/pages/CreateAgendaPage").then((module) => ({ default: module.CreateAgendaPage })));
const MarketingDatabasePage = lazy(() => import("./marketing/pages/MarketingDatabasePage").then((module) => ({ default: module.MarketingDatabasePage })));
const PackagesPage = lazy(() => import("./marketing/pages/PackagesPage").then((module) => ({ default: module.PackagesPage })));
const PlatformConnectionsPage = lazy(() => import("./marketing/pages/PlatformConnectionsPage").then((module) => ({ default: module.PlatformConnectionsPage })));
const PublishPrepPage = lazy(() => import("./marketing/pages/PublishPrepPage").then((module) => ({ default: module.PublishPrepPage })));
const MonitoringPage = lazy(() => import("./marketing/pages/MonitoringPage").then((module) => ({ default: module.MonitoringPage })));
const MarketingCalendarPage = lazy(() => import("./marketing/pages/MarketingCalendarPage").then((module) => ({ default: module.MarketingCalendarPage })));
const ReceiptCalendarPage = lazy(() => import("./marketing/pages/ReceiptCalendarPage").then((module) => ({ default: module.ReceiptCalendarPage })));
const StockPage = lazy(() => import("./marketing/pages/StockPage").then((module) => ({ default: module.StockPage })));
const AttendancePage = lazy(() => import("./marketing/pages/AttendancePage").then((module) => ({ default: module.AttendancePage })));

const OperationsLayout = lazy(() => import("./operations/OperationsLayout").then((module) => ({ default: module.OperationsLayout })));
const InventoryPage = lazy(() => import("./operations/pages/InventoryPage").then((module) => ({ default: module.InventoryPage })));
const VehicleManagementPage = lazy(() => import("./operations/pages/VehicleManagementPage").then((module) => ({ default: module.VehicleManagementPage })));
const MovementPage = lazy(() => import("./operations/pages/MovementPage").then((module) => ({ default: module.MovementPage })));
const TransferRequestsPage = lazy(() => import("./operations/pages/TransferRequestsPage").then((module) => ({ default: module.TransferRequestsPage })));
const ApprovalsPage = lazy(() => import("./operations/pages/ApprovalsPage").then((module) => ({ default: module.ApprovalsPage })));
const MovementHistoryPage = lazy(() => import("./operations/pages/MovementHistoryPage").then((module) => ({ default: module.MovementHistoryPage })));


function SystemGuard({ system, children }: { system: PlatformSystem; children: ReactNode }) {
  const { user } = useAuth();
  if (!canAccessSystem(user, system)) return <Navigate to={defaultSystemPath(user)} replace />;
  return <>{children}</>;
}

function PermissionGuard({ permission, children }: { permission: string; children: ReactNode }) {
  const { user } = useAuth();
  if (!hasPermission(user, permission)) return <Navigate to={defaultSystemPath(user)} replace />;
  return <>{children}</>;
}

function HomeRoute() {
  return <PermissionGuard permission="platform.dashboard.view"><DashboardPage /></PermissionGuard>;
}

function SettingsRoute() {
  const { user } = useAuth();
  if (!canOpenSettings(user)) return <Navigate to={defaultSystemPath(user)} replace />;
  return <SettingsPage />;
}

function PlatformRoutes() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="page-shell">
        <Suspense fallback={<div className="crm-loading-panel">جاري تحميل الصفحة...</div>}>
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/crm" element={<SystemGuard system="crm"><CrmLayout /></SystemGuard>}>
            <Route index element={<PermissionGuard permission="crm.dashboard.view"><CrmDashboardPage /></PermissionGuard>} />
            <Route path="database" element={<PermissionGuard permission="crm.database.view"><CrmDatabasePage /></PermissionGuard>} />
            <Route path="manual-leads" element={<PermissionGuard permission="crm.manual_leads.view"><CrmManualLeadsPage /></PermissionGuard>} />
            <Route path="finance-history" element={<PermissionGuard permission="crm.finance_history.view"><CrmFinanceHistoryPage /></PermissionGuard>} />
            <Route path="inbox" element={<PermissionGuard permission="crm.inbox.view"><CrmInboxPage /></PermissionGuard>} />
            <Route path="contacts" element={<PermissionGuard permission="crm.contacts.view"><CrmContactsPage /></PermissionGuard>} />
            <Route path="inbox-agent" element={<PermissionGuard permission="crm.inbox_agent.view"><CrmInboxAgentPage /></PermissionGuard>} />
            <Route path="reports" element={<PermissionGuard permission="crm.reports.view"><CrmReportsPage /></PermissionGuard>} />
            <Route path="kpi" element={<PermissionGuard permission="crm.kpi.view"><CrmKpiPage /></PermissionGuard>} />
            <Route path="admin" element={<Navigate to="/settings?section=crm" replace />} />
          </Route>
          <Route path="/marketing" element={<SystemGuard system="marketing"><MarketingLayout /></SystemGuard>}>
            <Route index element={<PermissionGuard permission="marketing.dashboard.view"><MarketingDashboardPage /></PermissionGuard>} />
            <Route path="create-campaign" element={<PermissionGuard permission="marketing.create_campaign.view"><CreateCampaignPage /></PermissionGuard>} />
            <Route path="create-agenda" element={<PermissionGuard permission="marketing.create_agenda.view"><CreateAgendaPage /></PermissionGuard>} />
            <Route path="database" element={<PermissionGuard permission="marketing.database.view"><MarketingDatabasePage /></PermissionGuard>} />
            <Route path="packages" element={<PermissionGuard permission="marketing.packages.view"><PackagesPage /></PermissionGuard>} />
            <Route path="platforms" element={<PermissionGuard permission="marketing.platforms.view"><PlatformConnectionsPage /></PermissionGuard>} />
            <Route path="publish-prep" element={<PermissionGuard permission="marketing.publish_prep.view"><PublishPrepPage /></PermissionGuard>} />
            <Route path="monitoring" element={<PermissionGuard permission="marketing.monitoring.view"><MonitoringPage /></PermissionGuard>} />
            <Route path="calendar" element={<PermissionGuard permission="marketing.calendar.view"><MarketingCalendarPage /></PermissionGuard>} />
            <Route path="receipt-calendar" element={<PermissionGuard permission="marketing.receipt_calendar.view"><ReceiptCalendarPage /></PermissionGuard>} />
            <Route path="stock" element={<PermissionGuard permission="marketing.stock.view"><StockPage /></PermissionGuard>} />
            <Route path="departments" element={<Navigate to="/settings?section=marketing&tab=departments" replace />} />
            <Route path="attendance" element={<PermissionGuard permission="marketing.attendance.view"><AttendancePage /></PermissionGuard>} />
          </Route>
          <Route path="/operations" element={<SystemGuard system="operations"><OperationsLayout /></SystemGuard>}>
            <Route index element={<PermissionGuard permission="operations.inventory.view"><InventoryPage /></PermissionGuard>} />
            <Route path="manage" element={<PermissionGuard permission="operations.manage.view"><VehicleManagementPage /></PermissionGuard>} />
            <Route path="movement" element={<PermissionGuard permission="operations.movement.view"><MovementPage /></PermissionGuard>} />
            <Route path="transfers" element={<PermissionGuard permission="operations.transfers.view"><TransferRequestsPage /></PermissionGuard>} />
            <Route path="photography" element={<Navigate to="/operations/transfers" replace />} />
            <Route path="approvals" element={<PermissionGuard permission="operations.approvals.view"><ApprovalsPage /></PermissionGuard>} />
            <Route path="all" element={<PermissionGuard permission="operations.all.view"><InventoryPage all /></PermissionGuard>} />
            <Route path="movements" element={<PermissionGuard permission="operations.movements.view"><MovementHistoryPage /></PermissionGuard>} />
            <Route path="archive" element={<PermissionGuard permission="operations.archive.view"><InventoryPage archived /></PermissionGuard>} />
          </Route>
          <Route path="/tracking" element={<SystemGuard system="tracking"><TrackingLayout /></SystemGuard>}>
            <Route index element={<PermissionGuard permission="tracking.orders.view"><TrackingOrdersPage /></PermissionGuard>} />
            <Route path="archive" element={<PermissionGuard permission="tracking.archive.view"><TrackingOrdersPage archivedOnly /></PermissionGuard>} />
            <Route path="delete" element={<PermissionGuard permission="tracking.delete.view"><TrackingDeletePage /></PermissionGuard>} />
          </Route>
          <Route path="/reports" element={<PermissionGuard permission="platform.reports.view"><EmptyModulePage title="التقارير" description="صفحة تقارير موحدة لجميع الأنظمة." /></PermissionGuard>} />
          <Route path="/database" element={<PermissionGuard permission="platform.database.view"><EmptyModulePage title="قاعدة البيانات" description="واجهة موحدة للبحث والعرض والتصفية والتصدير." /></PermissionGuard>} />
          <Route path="/settings" element={<SettingsRoute />} />
          <Route path="/activity" element={<PermissionGuard permission="platform.activity.view"><EmptyModulePage title="سجل النشاط" description="سجل مركزي لجميع الإجراءات والتغييرات داخل المنصة." /></PermissionGuard>} />
          <Route path="/help" element={<EmptyModulePage title="المساعدة" description="مركز المساعدة والتوثيق الخاص بمنصة MZJ." />} />
        </Routes>
        </Suspense>
      </main>
    </div>
  );
}

export default function App() {
  const { loading, status, user } = useAuth();
  const location = useLocation();
  const isPublicTracking = ["/track", "/track.html", "/Test-Track.html"].includes(location.pathname);

  if (loading) return <PlatformLoadingPage />;
  if (isPublicTracking) {
    return (
      <Suspense fallback={<div className="crm-loading-panel">جاري تحميل صفحة التتبع...</div>}>
        <Routes>
          <Route path="/track" element={<PublicTrackingPage />} />
          <Route path="/track.html" element={<Navigate to={`/track${location.search}`} replace />} />
          <Route path="/Test-Track.html" element={<Navigate to={`/track${location.search}`} replace />} />
        </Routes>
      </Suspense>
    );
  }
  if (!status?.databaseConfigured || !status.databaseReachable) return <DatabaseSetupPage />;
  if (!status.schemaReady || !status.adminExists) return <FirstAdminSetupPage />;
  if (!user) return <LoginPage />;
  return <PlatformRoutes />;
}
