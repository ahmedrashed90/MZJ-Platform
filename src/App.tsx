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
import { canAccessSystem, defaultSystemPath, isPlatformAdmin, type PlatformSystem } from "./systemAccess";

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

function HomeRoute() {
  const { user } = useAuth();
  if (!isPlatformAdmin(user)) return <Navigate to={defaultSystemPath(user)} replace />;
  return <DashboardPage />;
}

function AdminRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!isPlatformAdmin(user)) return <Navigate to={defaultSystemPath(user)} replace />;
  return <>{children}</>;
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
            <Route index element={<CrmDashboardPage />} />
            <Route path="database" element={<CrmDatabasePage />} />
            <Route path="manual-leads" element={<CrmManualLeadsPage />} />
            <Route path="finance-history" element={<CrmFinanceHistoryPage />} />
            <Route path="inbox" element={<CrmInboxPage />} />
            <Route path="contacts" element={<CrmContactsPage />} />
            <Route path="inbox-agent" element={<CrmInboxAgentPage />} />
            <Route path="reports" element={<CrmReportsPage />} />
            <Route path="kpi" element={<CrmKpiPage />} />
            <Route path="admin" element={<Navigate to="/settings?section=crm" replace />} />
          </Route>
          <Route path="/marketing" element={<SystemGuard system="marketing"><MarketingLayout /></SystemGuard>}>
            <Route index element={<MarketingDashboardPage />} />
            <Route path="create-campaign" element={<CreateCampaignPage />} />
            <Route path="create-agenda" element={<CreateAgendaPage />} />
            <Route path="database" element={<MarketingDatabasePage />} />
            <Route path="packages" element={<PackagesPage />} />
            <Route path="platforms" element={<PlatformConnectionsPage />} />
            <Route path="publish-prep" element={<PublishPrepPage />} />
            <Route path="monitoring" element={<MonitoringPage />} />
            <Route path="calendar" element={<MarketingCalendarPage />} />
            <Route path="receipt-calendar" element={<ReceiptCalendarPage />} />
            <Route path="stock" element={<StockPage />} />
            <Route path="departments" element={<Navigate to="/settings?section=marketing&tab=departments" replace />} />
            <Route path="attendance" element={<AttendancePage />} />
          </Route>
          <Route path="/operations" element={<SystemGuard system="operations"><OperationsLayout /></SystemGuard>}>
            <Route index element={<InventoryPage />} />
            <Route path="manage" element={<VehicleManagementPage />} />
            <Route path="movement" element={<MovementPage />} />
            <Route path="transfers" element={<TransferRequestsPage />} />
            <Route path="photography" element={<Navigate to="/operations/transfers" replace />} />
            <Route path="approvals" element={<ApprovalsPage />} />
            <Route path="all" element={<InventoryPage all />} />
            <Route path="movements" element={<MovementHistoryPage />} />
            <Route path="archive" element={<InventoryPage archived />} />
          </Route>
          <Route path="/tracking" element={<SystemGuard system="tracking"><TrackingLayout /></SystemGuard>}>
            <Route index element={<TrackingOrdersPage />} />
            <Route path="archive" element={<TrackingOrdersPage archivedOnly />} />
            <Route path="delete" element={<TrackingDeletePage />} />
          </Route>
          <Route path="/reports" element={<AdminRoute><EmptyModulePage title="التقارير" description="صفحة تقارير موحدة لجميع الأنظمة." /></AdminRoute>} />
          <Route path="/database" element={<AdminRoute><EmptyModulePage title="قاعدة البيانات" description="واجهة موحدة للبحث والعرض والتصفية والتصدير." /></AdminRoute>} />
          <Route path="/settings" element={<AdminRoute><SettingsPage /></AdminRoute>} />
          <Route path="/activity" element={<AdminRoute><EmptyModulePage title="سجل النشاط" description="سجل مركزي لجميع الإجراءات والتغييرات داخل المنصة." /></AdminRoute>} />
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
