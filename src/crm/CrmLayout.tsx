import { NavLink, Outlet } from "react-router-dom";
import {
  ChartBar,
  ChatCircleDots,
  ClipboardText,
  Database,
  Gauge,
  PlusCircle,
  Robot,
  FlowArrow,
  UserSwitch,
  ChatsCircle,
} from "@phosphor-icons/react";

const items = [
  { href: "/crm", label: "الداش بورد", icon: Gauge, end: true },
  { href: "/crm/database", label: "قاعدة البيانات", icon: Database },
  { href: "/crm/manual-leads", label: "إضافة العملاء", icon: PlusCircle },
  { href: "/crm/finance-history", label: "سجل عملاء التمويل", icon: ClipboardText },
  { href: "/crm/inbox", label: "صندوق الوارد الموحد", icon: ChatsCircle },
  { href: "/crm/inbox-agent", label: "وكيل صندوق الوارد", icon: Robot },
  { href: "/crm/automations", label: "قواعد الأوتوميشن", icon: FlowArrow },
  { href: "/crm/ownership", label: "سجل ملكية العملاء", icon: UserSwitch },
  { href: "/crm/reports", label: "التقارير", icon: ChartBar },
  { href: "/crm/kpi", label: "تقييم المناديب KPI", icon: ChatCircleDots },
];

export function CrmLayout() {
  return (
    <section className="crm-module">
      <nav className="crm-system-nav" aria-label="صفحات CRM">
        {items.map(({ href, label, icon: Icon, end }) => (
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
