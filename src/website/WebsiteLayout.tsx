import { NavLink, Outlet } from "react-router-dom";
import { CarProfile, ImageSquare } from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";
import { hasPermission } from "../systemAccess";

const items = [
  { href: "/website", label: "الاستوك في الموقع", icon: CarProfile, permission: "website.stock.view", end: true },
  { href: "/website/images", label: "إدارة صور السيارات", icon: ImageSquare, permission: "website.stock.view", end: true },
];

export function WebsiteLayout() {
  const { user } = useAuth();
  return (
    <section className="website-module" dir="rtl">
      <nav className="crm-system-nav" aria-label="صفحات الموقع الإلكتروني">
        {items.filter((item) => hasPermission(user, item.permission)).map(({ href, label, icon: Icon, end }) => (
          <NavLink key={href} to={href} end={end} className={({ isActive }) => `crm-system-link ${isActive ? "active" : ""}`}>
            <Icon size={18} weight="duotone" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </section>
  );
}
