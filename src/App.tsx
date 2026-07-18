import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { Sidebar } from "./components/Sidebar";
import { AnyPermissionRoute, PermissionRoute } from "./components/PermissionGate";
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

function PlatformRoutes() {
  const settingsPermissions = [
    "settings.users.view",
    "settings.users.create",
    "settings.users.update",
    "settings.users.disable",
    "settings.roles.manage",
    "settings.permissions.manage",
    "settings.branches.manage",
    "settings.audit.view",
    "settings.security.view",
    "crm.settings.view",
    "marketing.settings.view",
    "operations.settings.view",
    "tracking.settings.view",
  ];

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="page-shell">
        <Suspense fallback={<div className="crm-loading-panel">جاري تحميل الصفحة...</div>}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/crm" element={<PermissionRoute permission="system.crm.access"><CrmLayout /></PermissionRoute>}>
            <Route index element={<PermissionRoute permission="crm.dashboard.view"><CrmDashboardPage /></PermissionRoute>} />
            <Route path="database" element={<PermissionRoute permission="crm.database.view"><CrmDatabasePage /></PermissionRoute>} />
            <Route path="manual-leads" element={<PermissionRoute permission="crm.manual_leads.view"><CrmManualLeadsPage /></PermissionRoute>} />
            <Route path="finance-history" element={<PermissionRoute permission="crm.finance_history.view"><CrmFinanceHistoryPage /></PermissionRoute>} />
            <Route path="inbox" element={<PermissionRoute permission="crm.inbox.view"><CrmInboxPage /></PermissionRoute>} />
            <Route path="inbox-agent" element={<PermissionRoute permission="crm.inbox_agent.view"><CrmInboxAgentPage /></PermissionRoute>} />
            <Route path="ownership" element={<PermissionRoute permission="crm.ownership.view"><CrmOwnershipPage /></PermissionRoute>} />
            <Route path="reports" element={<PermissionRoute permission="crm.reports.view"><CrmReportsPage /></PermissionRoute>} />
            <Route path="kpi" element={<PermissionRoute permission="crm.kpi.view"><CrmKpiPage /></PermissionRoute>} />
            <Route path="admin" element={<Navigate to="/settings?section=crm" replace />} />
          </Route>
          <Route path="/marketing" element={<PermissionRoute permission="system.marketing.access"><EmptyModulePage title="التسويق" description="الحملات والأجندة والكرييتيف وجدول النشر والتقويم." /></PermissionRoute>} />
          <Route path="/operations" element={<PermissionRoute permission="system.operations.access"><EmptyModulePage title="العمليات" description="المخزون والمواقع والحركة وطلبات النقل والموافقات ونواقص السيارات." /></PermissionRoute>} />
          <Route path="/tracking" element={<PermissionRoute permission="system.tracking.access"><EmptyModulePage title="التتبع" description="طلبات البيع ومراحل التتبع والروابط والـ QR والإشعارات." /></PermissionRoute>} />
          <Route path="/reports" element={<EmptyModulePage title="التقارير" description="صفحة تقارير موحدة لجميع الأنظمة." />} />
          <Route path="/database" element={<EmptyModulePage title="قاعدة البيانات" description="واجهة موحدة للبحث والعرض والتصفية والتصدير." />} />
          <Route path="/settings" element={<AnyPermissionRoute permissions={settingsPermissions}><SettingsPage /></AnyPermissionRoute>} />
          <Route path="/activity" element={<Navigate to="/settings?section=users&tab=security" replace />} />
          <Route path="/help" element={<EmptyModulePage title="المساعدة" description="مركز المساعدة والتوثيق الخاص بمنصة MZJ." />} />
        </Routes>
        </Suspense>
      </main>
    </div>
  );
}

export default function App() {
  const { loading, status, user } = useAuth();

  if (loading) return <PlatformLoadingPage />;
  if (!status?.databaseConfigured || !status.databaseReachable) return <DatabaseSetupPage />;
  if (!status.schemaReady || !status.adminExists) return <FirstAdminSetupPage />;
  if (!user) return <LoginPage />;
  return <PlatformRoutes />;
}
