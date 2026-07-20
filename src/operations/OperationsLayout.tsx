import { NavLink, Outlet } from "react-router-dom";
import { ArrowsLeftRight, ClipboardText, Database, ListBullets, PlusCircle, SquaresFour } from "@phosphor-icons/react";
import { OperationsProvider } from "./components/OperationsState";

const items = [
  { href: "/operations", label: "قاعدة السيارات", icon: Database, end: true },
  { href: "/operations/manage", label: "إدارة السيارات", icon: PlusCircle },
  { href: "/operations/movements", label: "الحركة", icon: ArrowsLeftRight },
  { href: "/operations/requests", label: "طلبات النقل", icon: ClipboardText },
  { href: "/operations/availability", label: "كل السيارات", icon: SquaresFour },
  { href: "/operations/activity", label: "سجل الحركات", icon: ListBullets },
];

export function OperationsLayout() {
  return (
    <OperationsProvider>
    <section className="operations-module">
      <nav className="crm-system-nav operations-system-nav" aria-label="صفحات العمليات">
        {items.map(({ href, label, icon: Icon, end }) => (
          <NavLink key={href} to={href} end={end} className={({ isActive }) => `crm-system-link ${isActive ? "active" : ""}`}>
            <Icon size={18} weight="duotone" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </section>
    </OperationsProvider>
  );
}
