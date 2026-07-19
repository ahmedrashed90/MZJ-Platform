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
const OperationsInventoryPage = lazy(() => import("./operations/pages/OperationsInventoryPage").then((module) => ({ default: module.OperationsInventoryPage })));
const OperationsVehicleManagementPage = lazy(() => import("./operations/pages/OperationsVehicleManagementPage").then((module) => ({ default: module.OperationsVehicleManagementPage })));
const OperationsMovementPage = lazy(() => import("./operations/pages/OperationsMovementPage").then((module) => ({ default: module.OperationsMovementPage })));
const OperationsBatchMovementPage = lazy(() => import("./operations/pages/OperationsBatchMovementPage").then((module) => ({ default: module.OperationsBatchMovementPage })));
const OperationsRequestsPage = lazy(() => import("./operations/pages/OperationsRequestsPage").then((module) => ({ default: module.OperationsRequestsPage })));
const OperationsAllVehiclesPage = lazy(() => import("./operations/pages/OperationsAllVehiclesPage").then((module) => ({ default: module.OperationsAllVehiclesPage })));
const OperationsMovementHistoryPage = lazy(() => import("./operations/pages/OperationsMovementHistoryPage").then((module) => ({ default: module.OperationsMovementHistoryPage })));
const OperationsApprovalsPage = lazy(() => import("./operations/pages/OperationsApprovalsPage").then((module) => ({ default: module.OperationsApprovalsPage })));
const OperationsArchivePage = lazy(() => import("./operations/pages/OperationsArchivePage").then((module) => ({ default: module.OperationsArchivePage })));

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
            <Route index element={<OperationsInventoryPage />} />
            <Route path="vehicles" element={<OperationsVehicleManagementPage />} />
            <Route path="movement" element={<OperationsMovementPage />} />
            <Route path="batch-movement" element={<OperationsBatchMovementPage />} />
            <Route path="requests" element={<OperationsRequestsPage />} />
            <Route path="all-vehicles" element={<OperationsAllVehiclesPage />} />
            <Route path="movements" element={<OperationsMovementHistoryPage />} />
            <Route path="approvals" element={<OperationsApprovalsPage />} />
            <Route path="archive" element={<OperationsArchivePage />} />
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
