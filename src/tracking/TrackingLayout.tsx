import { NavLink, Outlet } from "react-router-dom";
import { Archive, ListMagnifyingGlass, Trash } from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";

export function TrackingLayout() {
  const { user } = useAuth();
  const isAdmin = user?.roleCodes.includes("admin") ?? false;
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
          <NavLink to="/tracking/delete" className={({ isActive }) => `crm-system-link ${isActive ? "active" : ""}`}>
            <Trash size={18} weight="duotone" />
            <span>حذف طلبات التتبع</span>
          </NavLink>
        ) : null}
      </nav>
      <Outlet />
    </section>
  );
}
