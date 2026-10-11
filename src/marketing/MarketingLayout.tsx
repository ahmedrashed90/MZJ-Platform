import { W } from "../../shared/marketing-workflow-labels";
import "./workflow/workflow.css";
import { NavLink, Outlet } from "react-router-dom";
import {
  CalendarBlank,
  CalendarCheck,
  Car,
  ChartLineUp,
  CreditCard,
  ChatCircleDots,
  CirclesFour,
  Database,
  Megaphone,
  Package,
  PaperPlaneTilt,
  PlusCircle,
} from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";
import { hasPermission } from "../systemAccess";
import "./marketing.css";

const links = [
  { to: "/marketing", label: W.dashboard, icon: CirclesFour, end: true, permission: "marketing.dashboard.view" },
  { to: "/marketing/database", label: W.database, icon: Database, permission: "marketing.database.view" },
  { to: "/marketing/create", label: W.create, icon: PlusCircle, permission: "marketing.create.view" },
  { to: "/marketing/products", label: W.products, icon: Package, permission: "marketing.products.view" },
  { to: "/marketing/receipt-calendar", label: W.calendar, icon: CalendarCheck, permission: "marketing.receipt_calendar.view" },
  { to: "/marketing/publish-prep", label: W.publishing, icon: PaperPlaneTilt, permission: "marketing.publish_prep.view" },
  { to: "/marketing/engagement", label: "\u062a\u0641\u0627\u0639\u0644 \u0627\u0644\u0646\u0634\u0631", icon: ChatCircleDots, permission: "marketing.engagement.view" },
  { to: "/marketing/stock", label: "\u0627\u0644\u0627\u0633\u062a\u0648\u0643", icon: Car, permission: "marketing.stock.view" },
  { to: "/marketing/subscriptions", label: "\u0627\u0644\u0627\u0634\u062a\u0631\u0627\u0643\u0627\u062a", icon: CreditCard, permission: "marketing.subscriptions.view" },
];

export function MarketingLayout() {
  const { user } = useAuth();
  const visibleLinks = links.filter((item) => hasPermission(user, item.permission));
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
