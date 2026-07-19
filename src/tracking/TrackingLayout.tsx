import { NavLink, Outlet } from "react-router-dom";
import { Archive, ListMagnifyingGlass, SlidersHorizontal } from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";

export function TrackingLayout() {
  const { user } = useAuth();
  const isAdmin = user?.roleCodes.some((code) => code === "admin" || code === "system_admin") ?? false;
  return (
    <section className="tracking-module">
      <nav className="crm-system-nav tracking-system-nav" aria-label="صفحات التتبع">
        <NavLink to="/tracking" end className={({ isActive }) => `crm-system-link ${isActive ? "active" : ""}`}>
          <ListMagnifyingGlass size={18} weight="duotone" />
          <span>طلبات التراكينج</span>
        </NavLink>
        <NavLink to="/tracking/archive" className={({ isActive }) => `crm-system-link ${isActive ? "active" : ""}`}>
          <Archive size={18} weight="duotone" />
          <span>أرشيف الطلبات</span>
        </NavLink>
        {isAdmin ? (
          <NavLink to="/settings?section=tracking" className="crm-system-link">
            <SlidersHorizontal size={18} weight="duotone" />
            <span>إعدادات التتبع</span>
          </NavLink>
        ) : null}
      </nav>
      <Outlet />
    </section>
  );
}
