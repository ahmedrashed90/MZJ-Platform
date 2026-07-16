import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
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
const CrmAdminPage = lazy(() => import("./crm/pages/CrmAdminPage").then((module) => ({ default: module.CrmAdminPage })));

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
            <Route path="inbox-agent" element={<CrmInboxAgentPage />} />
            <Route path="reports" element={<CrmReportsPage />} />
            <Route path="kpi" element={<CrmKpiPage />} />
            <Route path="admin" element={<CrmAdminPage />} />
          </Route>
          <Route path="/marketing" element={<EmptyModulePage title="التسويق" description="الحملات والأجندة والكرييتيف وجدول النشر والتقويم." />} />
          <Route path="/operations" element={<EmptyModulePage title="العمليات" description="المخزون والمواقع والحركة وطلبات النقل والموافقات ونواقص السيارات." />} />
          <Route path="/tracking" element={<EmptyModulePage title="التتبع" description="طلبات البيع ومراحل التتبع والروابط والـ QR والإشعارات." />} />
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

  if (loading) return <PlatformLoadingPage />;
  if (!status?.databaseConfigured || !status.databaseReachable) return <DatabaseSetupPage />;
  if (!status.schemaReady || !status.adminExists) return <FirstAdminSetupPage />;
  if (!user) return <LoginPage />;
  return <PlatformRoutes />;
}
