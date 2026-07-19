import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  ArrowsLeftRight,
  Car,
  ClipboardText,
  ListMagnifyingGlass,
  SlidersHorizontal,
  Table,
} from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";
import { OperationsProvider, useOperations } from "./OperationsContext";

const links = [
  { to: "/operations/inventory", label: "المخزون", icon: Car, permission: "operations.vehicles.view" },
  { to: "/operations/vehicles", label: "إدارة السيارات", icon: SlidersHorizontal, permission: "operations.vehicles.view" },
  { to: "/operations/movements", label: "حركة السيارات", icon: ArrowsLeftRight, permission: "operations.movements.view" },
  { to: "/operations/requests", label: "طلبات النقل والتصوير", icon: ClipboardText, permission: "operations.requests.view" },
  { to: "/operations/all-cars", label: "جميع السيارات", icon: Table, permission: "operations.reports.all_cars" },
  { to: "/operations/movement-log", label: "سجل الحركات", icon: ListMagnifyingGlass, permission: "operations.logs.view" },
];

function OperationsShell() {
  const { user } = useAuth();
  const location = useLocation();
  const { can, loading, error } = useOperations();
  const isAdmin = Boolean(user?.roleCodes.includes("admin"));
  const canEnter = isAdmin
    || Boolean(user?.roleCodes.some((code) => ["operations_user", "sales_manager", "branch_manager"].includes(code)))
    || Boolean(user?.departmentCodes.includes("operations"))
    || Boolean(user?.permissionCodes.some((code) => code.startsWith("operations.")));

  if (!canEnter) {
    return <div className="ops-state-card error"><strong>لا توجد لديك صلاحية للدخول إلى نظام العمليات.</strong></div>;
  }

  const visibleLinks = links.filter((item) => isAdmin || can(item.permission));
  const currentLink = links.find((item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`));
  const currentPageAllowed = !currentLink || isAdmin || can(currentLink.permission);
  const canManageSettings = isAdmin || can("operations.settings.manage");

  return (
    <section className="ops-module">
      <nav className="crm-system-nav ops-system-nav" aria-label="صفحات العمليات">
        {visibleLinks.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => `crm-system-link ${isActive ? "active" : ""}`}>
            <Icon size={18} weight="duotone" />
            <span>{label}</span>
          </NavLink>
        ))}
        {canManageSettings ? (
          <NavLink to="/settings?section=operations" className="crm-system-link ops-settings-link">
            <SlidersHorizontal size={18} weight="duotone" />
            <span>إعدادات العمليات</span>
          </NavLink>
        ) : null}
      </nav>
      {loading ? <div className="ops-state-card">جاري تحميل إعدادات العمليات...</div> : null}
      {error ? <div className="ops-state-card error">{error}</div> : null}
      {!loading && !error && visibleLinks.length && currentPageAllowed ? <Outlet /> : null}
      {!loading && !error && visibleLinks.length && !currentPageAllowed ? <div className="ops-state-card error">لا توجد لديك صلاحية لعرض هذه الصفحة.</div> : null}
      {!loading && !error && !visibleLinks.length ? <div className="ops-state-card error">لا توجد صفحات عمليات متاحة ضمن صلاحياتك الحالية.</div> : null}
    </section>
  );
}

export function OperationsLayout() {
  return (
    <OperationsProvider>
      <OperationsShell />
    </OperationsProvider>
  );
}
