import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  CalendarBlank,
  CalendarCheck,
  Car,
  ChartLineUp,
  CirclesFour,
  Database,
  LinkSimple,
  Megaphone,
  Package,
  PaperPlaneTilt,
  PlusCircle,
  UserSwitch,
} from "@phosphor-icons/react";
import { marketingFetch } from "./api";
import { useAuth } from "../auth/AuthContext";
import { hasPermission } from "../systemAccess";
import "./marketing.css";

const links = [
  { to: "/marketing", label: "الداش بورد", icon: CirclesFour, end: true, permission: "marketing.dashboard.view" },
  { to: "/marketing/create-campaign", label: "إنشاء حملة", icon: Megaphone, permission: "marketing.create_campaign.view" },
  { to: "/marketing/create-agenda", label: "إنشاء أجندة", icon: PlusCircle, permission: "marketing.create_agenda.view" },
  { to: "/marketing/database", label: "قاعدة البيانات", icon: Database, permission: "marketing.database.view" },
  { to: "/marketing/packages", label: "إدارة الباقات", icon: Package, permission: "marketing.packages.view" },
  { to: "/marketing/platforms", label: "ربط المنصات", icon: LinkSimple, permission: "marketing.platforms.view" },
  { to: "/marketing/publish-prep", label: "تجهيز النشر", icon: PaperPlaneTilt, permission: "marketing.publish_prep.view" },
  { to: "/marketing/monitoring", label: "المتابعة", icon: ChartLineUp, permission: "marketing.monitoring.view" },
  { to: "/marketing/calendar", label: "التقويم", icon: CalendarBlank, permission: "marketing.calendar.view" },
  { to: "/marketing/receipt-calendar", label: "تقويم الاستلام", icon: CalendarCheck, permission: "marketing.receipt_calendar.view" },
  { to: "/marketing/stock", label: "الاستوك", icon: Car, permission: "marketing.stock.view" },
  { to: "/marketing/attendance", label: "الحضور والانصراف", icon: UserSwitch, permission: "marketing.attendance.view" },
];

export function MarketingLayout() {
  const { user } = useAuth();
  const visibleLinks = links.filter((item) => hasPermission(user, item.permission));
  useEffect(() => {
    const ping = () => {
      void marketingFetch("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "attendance", attendanceAction: "ping", activityType: window.location.pathname }),
      }).catch(() => undefined);
    };
    ping();
    const interval = window.setInterval(ping, 120000);
    const onVisibility = () => { if (document.visibilityState === "visible") ping(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div className="marketing-shell">
      <nav className="marketing-nav" aria-label="صفحات سيستم التسويق">
        {visibleLinks.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => isActive ? "active" : ""}>
            <Icon size={18} weight="duotone" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <section className="marketing-content"><Outlet /></section>
    </div>
  );
}
