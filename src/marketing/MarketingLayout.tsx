import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  CalendarBlank,
  CalendarCheck,
  Car,
  ChartLineUp,
  CirclesFour,
  ClipboardText,
  Database,
  Gear,
  LinkSimple,
  Megaphone,
  Package,
  PaperPlaneTilt,
  PlusCircle,
  UsersThree,
  UserSwitch,
} from "@phosphor-icons/react";
import { marketingFetch } from "./api";
import "./marketing.css";

const links = [
  { to: "/marketing", label: "الداش بورد", icon: CirclesFour, end: true },
  { to: "/marketing/create-campaign", label: "إنشاء حملة", icon: Megaphone },
  { to: "/marketing/create-agenda", label: "إنشاء أجندة", icon: PlusCircle },
  { to: "/marketing/database", label: "قاعدة البيانات", icon: Database },
  { to: "/marketing/packages", label: "إدارة الباقات", icon: Package },
  { to: "/marketing/platforms", label: "ربط المنصات", icon: LinkSimple },
  { to: "/marketing/publish-prep", label: "تجهيز النشر", icon: PaperPlaneTilt },
  { to: "/marketing/monitoring", label: "المتابعة", icon: ChartLineUp },
  { to: "/marketing/calendar", label: "التقويم", icon: CalendarBlank },
  { to: "/marketing/receipt-calendar", label: "تقويم الاستلام", icon: CalendarCheck },
  { to: "/marketing/stock", label: "الاستوك", icon: Car },
  { to: "/marketing/departments", label: "الأقسام", icon: UsersThree },
  { to: "/marketing/attendance", label: "الحضور والانصراف", icon: UserSwitch },
  { to: "/settings?section=marketing", label: "الإعدادات", icon: Gear },
];

export function MarketingLayout() {
  useEffect(() => {
    const ping = () => { void marketingFetch("/api/marketing", { method: "POST", body: JSON.stringify({ action: "attendance", attendanceAction: "ping", activityType: window.location.pathname }) }).catch(() => undefined); };
    ping();
    const interval = window.setInterval(ping, 120000);
    const onVisibility = () => { if (document.visibilityState === "visible") ping(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);

  return (
    <div className="marketing-shell">
      <aside className="marketing-nav" aria-label="قائمة سيستم التسويق">
        <div className="marketing-nav-title"><ClipboardText size={23} weight="duotone" /><span>سيستم التسويق</span></div>
        <nav>{links.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => isActive ? "active" : ""}><Icon size={19} /><span>{label}</span></NavLink>)}</nav>
      </aside>
      <section className="marketing-content"><Outlet /></section>
    </div>
  );
}
