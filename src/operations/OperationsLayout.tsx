import { NavLink, Outlet } from "react-router-dom";
import { Archive, ArrowsLeftRight, Car, ClipboardText, Files, Garage, ListMagnifyingGlass, SlidersHorizontal, Stack, Table } from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";

const links = [
  { to: "/operations", end: true, label: "مخزون السيارات", icon: Garage },
  { to: "/operations/vehicles", label: "إدارة السيارات", icon: Car },
  { to: "/operations/movement", label: "حركة سيارة", icon: ArrowsLeftRight },
  { to: "/operations/batch-movement", label: "حركة جماعية", icon: Stack },
  { to: "/operations/requests", label: "طلبات النقل والتصوير", icon: ClipboardText },
  { to: "/operations/all-vehicles", label: "جميع السيارات", icon: Table },
  { to: "/operations/movements", label: "سجل الحركات", icon: ListMagnifyingGlass },
  { to: "/operations/approvals", label: "الموافقات", icon: Files },
  { to: "/operations/archive", label: "الأرشيف", icon: Archive },
];

export function OperationsLayout() {
  const { user } = useAuth();
  const canSettings = user?.isSystemAdmin || user?.permissions?.includes("operations.settings.manage");
  return (
    <section className="operations-module">
      <nav className="crm-system-nav operations-system-nav" aria-label="صفحات العمليات">
        {links.map(({ to, end, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `crm-system-link ${isActive ? "active" : ""}`}>
            <Icon size={18} weight="duotone" /><span>{label}</span>
          </NavLink>
        ))}
        {canSettings ? <NavLink to="/settings?section=operations" className="crm-system-link"><SlidersHorizontal size={18} weight="duotone" /><span>إعدادات العمليات</span></NavLink> : null}
      </nav>
      <Outlet />
    </section>
  );
}
