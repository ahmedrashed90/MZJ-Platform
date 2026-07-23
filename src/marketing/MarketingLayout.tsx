import "./styles/marketing.css";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const tabs = [
  ["/marketing", "لوحة التحكم"],
  ["/marketing/campaigns", "إدارة الحملات"],
  ["/marketing/campaigns/new", "إنشاء حملة"],
  ["/marketing/agendas/new", "إنشاء أجندة"],
  ["/marketing/tasks", "المتابعة والمهام"],
  ["/marketing/publish-prep", "تجهيز النشر"],
  ["/marketing/calendar", "تقويم النشر"],
  ["/marketing/receipt-calendar", "تقويم الاستلام"],
  ["/marketing/stock", "الاستوك"],
  ["/marketing/packages", "الباقات"],
  ["/marketing/attendance", "الحضور"],
  ["/marketing/reports", "التقارير"],
  ["/marketing/checklist-reel", "Checklist ريل"],
  ["/marketing/local-publisher", "النشر المحلي"],
  ["/marketing/platforms", "ربط المنصات"],
  ["/marketing/departments", "الأقسام والكتالوج"],
] as const;

export function MarketingLayout() {
  const { user } = useAuth();
  const canManageSettings = user?.roleCodes.some((code) => ["admin", "system_admin"].includes(code)) || user?.permissions.includes("marketing.settings.manage");
  return (
    <div className="marketing-module">
      <nav className="marketing-tabs" aria-label="صفحات التسويق">
        {tabs.map(([href, label]) => <NavLink key={href} to={href} end={href === "/marketing"} className={({ isActive }) => isActive ? "active" : ""}>{label}</NavLink>)}
        {canManageSettings ? <NavLink to="/settings?section=marketing">الإعدادات</NavLink> : null}
      </nav>
      <Outlet />
    </div>
  );
}
