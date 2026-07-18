import { NavLink, Outlet } from "react-router-dom";
import {
  ChartBar,
  ChatCircleDots,
  ClipboardText,
  Database,
  Gauge,
  PlusCircle,
  Robot,
  UserSwitch,
  ChatsCircle,
} from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";
import { hasPermission } from "../components/PermissionGate";

const items = [
  { href: "/crm", label: "الداش بورد", icon: Gauge, end: true, permission: "crm.dashboard.view" },
  { href: "/crm/database", label: "قاعدة البيانات", icon: Database, permission: "crm.database.view" },
  { href: "/crm/manual-leads", label: "إضافة العملاء", icon: PlusCircle, permission: "crm.manual_leads.view" },
  { href: "/crm/finance-history", label: "سجل عملاء التمويل", icon: ClipboardText, permission: "crm.finance_history.view" },
  { href: "/crm/inbox", label: "صندوق الوارد الموحد", icon: ChatsCircle, permission: "crm.inbox.view" },
  { href: "/crm/inbox-agent", label: "وكيل صندوق الوارد", icon: Robot, permission: "crm.inbox_agent.view" },
  { href: "/crm/ownership", label: "سجل ملكية العملاء", icon: UserSwitch, permission: "crm.ownership.view" },
  { href: "/crm/reports", label: "التقارير", icon: ChartBar, permission: "crm.reports.view" },
  { href: "/crm/kpi", label: "تقييم المناديب KPI", icon: ChatCircleDots, permission: "crm.kpi.view" },
];

export function CrmLayout() {
  const { user } = useAuth();
  const visibleItems = items.filter((item) => hasPermission(user, item.permission));
  return (
    <section className="crm-module">
      <nav className="crm-system-nav" aria-label="صفحات CRM">
        {visibleItems.map(({ href, label, icon: Icon, end }) => (
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
