import { NavLink, Outlet } from "react-router-dom";
import {
  CalendarDots,
  ChartBar,
  CheckSquareOffset,
  ClockCounterClockwise,
  Database,
  Gear,
  Gift,
  House,
  LinkSimple,
  Megaphone,
  Package,
  PlusCircle,
  RocketLaunch,
  Stack,
  UsersThree,
} from "@phosphor-icons/react";
import { MarketingProvider, useMarketing } from "./MarketingContext";

type MarketingNavPermission = "manageCampaigns" | "managePackages" | "viewReports" | "manageSettings";

const navItems: Array<{ to: string; label: string; icon: typeof House; end?: boolean; permission?: MarketingNavPermission }> = [
  { to: "/marketing", label: "لوحة التحكم", icon: House, end: true },
  { to: "/marketing/database", label: "قاعدة البيانات", icon: Database, permission: "manageCampaigns" },
  { to: "/marketing/create-campaign", label: "إنشاء حملة", icon: PlusCircle, permission: "manageCampaigns" },
  { to: "/marketing/create-agenda", label: "إنشاء أجندة", icon: CalendarDots, permission: "manageCampaigns" },
  { to: "/marketing/campaigns", label: "إدارة الحملات", icon: Megaphone, permission: "manageCampaigns" },
  { to: "/marketing/packages", label: "إدارة الباقات", icon: Gift, permission: "managePackages" },
  { to: "/marketing/publish-prep", label: "تجهيز النشر", icon: RocketLaunch },
  { to: "/marketing/requests", label: "متابعة الطلبات", icon: CheckSquareOffset },
  { to: "/marketing/calendar", label: "التقويم", icon: CalendarDots },
  { to: "/marketing/stock", label: "الاستوك", icon: Stack },
  { to: "/marketing/reports", label: "التقارير", icon: ChartBar, permission: "viewReports" },
  { to: "/marketing/attendance", label: "الحضور والانصراف", icon: ClockCounterClockwise },
  { to: "/marketing/connections", label: "ربط المنصات", icon: LinkSimple, permission: "manageSettings" },
];

function MarketingShell() {
  const { meta, loading, error } = useMarketing();
  const visibleItems = navItems.filter((item) => !item.permission || Boolean(meta?.permissions[item.permission]));
  return (
    <div className="marketing-shell" dir="rtl">
      <header className="marketing-module-head">
        <div>
          <span className="marketing-kicker">MZJ Marketing</span>
          <h1>نظام التسويق</h1>
          <p>الحملات والأجندات والكرييتيفات والتاسكات وجدول النشر من داخل المنصة الموحدة.</p>
        </div>
        {meta?.permissions.manageSettings ? <div className="marketing-head-actions">
          <NavLink to="/settings?section=marketing"><Gear size={18} /> إعدادات التسويق</NavLink>
        </div> : null}
      </header>
      <nav className="marketing-local-nav" aria-label="صفحات التسويق">
        {visibleItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => isActive ? "active" : ""}>
            <Icon size={17} weight="duotone" /><span>{label}</span>
          </NavLink>
        ))}
      </nav>
      {loading ? <div className="marketing-loading"><Package size={24} /> جاري تحميل بيانات التسويق...</div> : null}
      {error ? <div className="marketing-error"><UsersThree size={20} /> {error}</div> : null}
      {!loading && !error ? <Outlet /> : null}
    </div>
  );
}

export function MarketingLayout() {
  return <MarketingProvider><MarketingShell /></MarketingProvider>;
}
