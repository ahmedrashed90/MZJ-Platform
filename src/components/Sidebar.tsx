import { NavLink } from "react-router-dom";
import {
  ChartBar,
  Database,
  Gear,
  House,
  Megaphone,
  MapPin,
  Question,
  SignOut,
  SuitcaseSimple,
  UsersThree,
} from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";
import { hasAnyPermission, hasPermission } from "./PermissionGate";

const items = [
  { href: "/", label: "الداش بورد", icon: House },
  { href: "/crm", label: "CRM", icon: UsersThree, permission: "system.crm.access" },
  { href: "/marketing", label: "التسويق", icon: Megaphone, permission: "system.marketing.access" },
  { href: "/operations", label: "العمليات", icon: SuitcaseSimple, permission: "system.operations.access" },
  { href: "/tracking", label: "التتبع", icon: MapPin, permission: "system.tracking.access" },
];

const settingsPermissions = [
  "settings.users.view",
  "settings.users.create",
  "settings.users.update",
  "settings.users.disable",
  "settings.roles.manage",
  "settings.permissions.manage",
  "settings.branches.manage",
  "settings.audit.view",
  "settings.security.view",
  "crm.settings.view",
  "marketing.settings.view",
  "operations.settings.view",
  "tracking.settings.view",
];

const supportItems = [
  { href: "/reports", label: "التقارير", icon: ChartBar },
  { href: "/database", label: "قاعدة البيانات", icon: Database },
  { href: "/settings", label: "الإعدادات", icon: Gear, permissions: settingsPermissions },
  { href: "/help", label: "المساعدة", icon: Question },
];

type NavItem = { href: string; label: string; icon: typeof House; permission?: string; permissions?: string[] };

function Item({ href, label, icon: Icon }: NavItem) {
  return (
    <NavLink
      to={href}
      end={href === "/"}
      className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
    >
      {({ isActive }) => (
        <>
          <Icon size={22} weight={isActive ? "fill" : "regular"} />
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}

export function Sidebar() {
  const { user, logout } = useAuth();
  const visibleItems = items.filter((item) => !item.permission || hasPermission(user, item.permission));
  const visibleSupport = supportItems.filter((item) => !item.permissions || hasAnyPermission(user, item.permissions));
  const roleText = user?.roles.join("، ") || user?.departments.join("، ") || "مستخدم المنصة";

  return (
    <aside className="sidebar">
      <div className="brand-block">
        <img src="/logo.png" alt="MZJ" />
        <span>مجموعة محمد بن ذعار العجمي</span>
      </div>

      <nav className="sidebar-nav" aria-label="القائمة الرئيسية">
        <div className="nav-group">
          {visibleItems.map((item) => <Item key={item.href} {...item} />)}
        </div>
        <div className="nav-separator" />
        <div className="nav-group">
          {visibleSupport.map((item) => <Item key={item.href} {...item} />)}
        </div>
      </nav>

      <div className="sidebar-account" aria-label="الحساب">
        <div className="account-avatar">{user?.fullName.trim().slice(0, 1) || "م"}</div>
        <div className="account-copy">
          <strong>{user?.fullName}</strong>
          <span>{roleText}</span>
        </div>
        <button type="button" className="logout-button" onClick={() => void logout()} aria-label="تسجيل الخروج" title="تسجيل الخروج">
          <SignOut size={18} />
        </button>
      </div>
    </aside>
  );
}
