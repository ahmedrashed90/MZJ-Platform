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

function PlatformRoutes() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="page-shell">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/crm" element={<EmptyModulePage title="CRM" description="مبيعات الكاش ومبيعات التمويل وخدمة العملاء والمحادثات." />} />
          <Route path="/marketing" element={<EmptyModulePage title="التسويق" description="الحملات والأجندة والكرييتيف وجدول النشر والتقويم." />} />
          <Route path="/operations" element={<EmptyModulePage title="العمليات" description="المخزون والمواقع والحركة وطلبات النقل والموافقات ونواقص السيارات." />} />
          <Route path="/tracking" element={<EmptyModulePage title="التتبع" description="طلبات البيع ومراحل التتبع والروابط والـ QR والإشعارات." />} />
          <Route path="/reports" element={<EmptyModulePage title="التقارير" description="صفحة تقارير موحدة لجميع الأنظمة." />} />
          <Route path="/database" element={<EmptyModulePage title="قاعدة البيانات" description="واجهة موحدة للبحث والعرض والتصفية والتصدير." />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/activity" element={<EmptyModulePage title="سجل النشاط" description="سجل مركزي لجميع الإجراءات والتغييرات داخل المنصة." />} />
          <Route path="/help" element={<EmptyModulePage title="المساعدة" description="مركز المساعدة والتوثيق الخاص بمنصة MZJ." />} />
        </Routes>
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
