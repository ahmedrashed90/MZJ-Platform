import { lazy, Suspense } from "react";
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

const CrmLayout = lazy(() => import("./crm/CrmLayout").then((module) => ({ default: module.CrmLayout })));
const CrmDashboardPage = lazy(() => import("./crm/pages/CrmDashboardPage").then((module) => ({ default: module.CrmDashboardPage })));
const CrmDatabasePage = lazy(() => import("./crm/pages/CrmDatabasePage").then((module) => ({ default: module.CrmDatabasePage })));
const CrmManualLeadsPage = lazy(() => import("./crm/pages/CrmManualLeadsPage").then((module) => ({ default: module.CrmManualLeadsPage })));
const CrmFinanceHistoryPage = lazy(() => import("./crm/pages/CrmFinanceHistoryPage").then((module) => ({ default: module.CrmFinanceHistoryPage })));
const CrmInboxAgentPage = lazy(() => import("./crm/pages/CrmInboxAgentPage").then((module) => ({ default: module.CrmInboxAgentPage })));
const CrmReportsPage = lazy(() => import("./crm/pages/CrmReportsPage").then((module) => ({ default: module.CrmReportsPage })));
const CrmKpiPage = lazy(() => import("./crm/pages/CrmKpiPage").then((module) => ({ default: module.CrmKpiPage })));
const CrmInboxPage = lazy(() => import("./crm/pages/CrmInboxPage").then((module) => ({ default: module.CrmInboxPage })));
const CrmOwnershipPage = lazy(() => import("./crm/pages/CrmOwnershipPage").then((module) => ({ default: module.CrmOwnershipPage })));
const TrackingLayout = lazy(() => import("./tracking/TrackingLayout").then((module) => ({ default: module.TrackingLayout })));
const TrackingOrdersPage = lazy(() => import("./tracking/pages/TrackingOrdersPage").then((module) => ({ default: module.TrackingOrdersPage })));
const TrackingDeletePage = lazy(() => import("./tracking/pages/TrackingDeletePage").then((module) => ({ default: module.TrackingDeletePage })));
const PublicTrackingPage = lazy(() => import("./tracking/pages/PublicTrackingPage").then((module) => ({ default: module.PublicTrackingPage })));
const OperationsLayout = lazy(() => import("./operations/OperationsLayout").then((module) => ({ default: module.OperationsLayout })));
const InventoryPage = lazy(() => import("./operations/pages/InventoryPage").then((module) => ({ default: module.InventoryPage })));
const VehicleManagementPage = lazy(() => import("./operations/pages/VehicleManagementPage").then((module) => ({ default: module.VehicleManagementPage })));
const MovementPage = lazy(() => import("./operations/pages/MovementPage").then((module) => ({ default: module.MovementPage })));
const RequestsPage = lazy(() => import("./operations/pages/RequestsPage").then((module) => ({ default: module.RequestsPage })));
const ApprovalsPage = lazy(() => import("./operations/pages/ApprovalsPage").then((module) => ({ default: module.ApprovalsPage })));
const MovementLogPage = lazy(() => import("./operations/pages/MovementLogPage").then((module) => ({ default: module.MovementLogPage })));


function PlatformRoutes() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="page-shell">
        <Suspense fallback={<div className="crm-loading-panel">جاري تحميل الصفحة...</div>}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/crm" element={<CrmLayout />}>
            <Route index element={<CrmDashboardPage />} />
            <Route path="database" element={<CrmDatabasePage />} />
            <Route path="manual-leads" element={<CrmManualLeadsPage />} />
            <Route path="finance-history" element={<CrmFinanceHistoryPage />} />
            <Route path="inbox" element={<CrmInboxPage />} />
            <Route path="inbox-agent" element={<CrmInboxAgentPage />} />
            <Route path="ownership" element={<CrmOwnershipPage />} />
            <Route path="reports" element={<CrmReportsPage />} />
            <Route path="kpi" element={<CrmKpiPage />} />
            <Route path="admin" element={<Navigate to="/settings?section=crm" replace />} />
          </Route>
          <Route path="/marketing" element={<EmptyModulePage title="التسويق" description="الحملات والأجندة والكرييتيف وجدول النشر والتقويم." />} />
          <Route path="/operations" element={<OperationsLayout />}>
            <Route index element={<InventoryPage />} />
            <Route path="vehicles" element={<VehicleManagementPage />} />
            <Route path="movement" element={<MovementPage />} />
            <Route path="requests" element={<RequestsPage />} />
            <Route path="approvals" element={<ApprovalsPage />} />
            <Route path="all" element={<InventoryPage compact />} />
            <Route path="movements" element={<MovementLogPage />} />
            <Route path="archive" element={<InventoryPage archivedOnly />} />
          </Route>
          <Route path="/tracking" element={<TrackingLayout />}>
            <Route index element={<TrackingOrdersPage />} />
            <Route path="archive" element={<TrackingOrdersPage archivedOnly />} />
            <Route path="delete" element={<TrackingDeletePage />} />
          </Route>
          <Route path="/reports" element={<EmptyModulePage title="التقارير" description="صفحة تقارير موحدة لجميع الأنظمة." />} />
          <Route path="/database" element={<EmptyModulePage title="قاعدة البيانات" description="واجهة موحدة للبحث والعرض والتصفية والتصدير." />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/activity" element={<EmptyModulePage title="سجل النشاط" description="سجل مركزي لجميع الإجراءات والتغييرات داخل المنصة." />} />
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
