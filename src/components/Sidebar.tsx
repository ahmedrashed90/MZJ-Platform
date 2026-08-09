import { NavLink } from "react-router-dom";
import { ChartBar, Crown, Database, Gear, House, MapPin, Megaphone, Pulse, Question, SignOut, SuitcaseSimple, UsersThree } from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";
import { NotificationBell } from "../notifications/NotificationBell";
import { canAccessCrm, canAccessMarketing, canAccessOperations, canAccessTracking, canOpenSettings, hasPermission } from "../systemAccess";
import { firstAllowedPage } from "../../shared/access-control";

const items = [
  { href: "/", label: "الداش بورد", icon: House, permission: "platform.dashboard.view" },
  { href: "/crm", label: "CRM", icon: UsersThree, system: "crm" },
  { href: "/marketing", label: "التسويق", icon: Megaphone, system: "marketing" },
  { href: "/operations", label: "العمليات", icon: SuitcaseSimple, system: "operations" },
  { href: "/tracking", label: "التراكينج", icon: MapPin, system: "tracking" },
  { href: "/owners-community", label: "MZJ Owners", icon: Crown, permission: "owners.community.view" },
] as const;
const supportItems = [
  { href: "/reports", label: "التقارير", icon: ChartBar, permission: "platform.reports.view" },
  { href: "/database", label: "قاعدة البيانات", icon: Database, permission: "platform.database.view" },
  { href: "/settings", label: "الإعدادات", icon: Gear, permission: "settings.view" },
  { href: "/activity", label: "سجل النشاط", icon: Pulse, permission: "platform.activity.view" },
  { href: "/help", label: "المساعدة", icon: Question, permission: "" },
] as const;

type NavItem = { href: string; label: string; icon: typeof House };
function Item({ href, label, icon: Icon }: NavItem) {
  return <NavLink to={href} end={href === "/"} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>{({ isActive }) => <><Icon size={22} weight={isActive ? "fill" : "regular"} /><span>{label}</span></>}</NavLink>;
}

export function Sidebar() {
  const { user, logout } = useAuth();
  const systemAllowed: Record<string, boolean> = { crm: canAccessCrm(user), marketing: canAccessMarketing(user), operations: canAccessOperations(user), tracking: canAccessTracking(user) };
  const visibleItems = items.filter((item) => "permission" in item ? hasPermission(user, item.permission) : systemAllowed[item.system]);
  const resolvedItems = visibleItems.map((item) => "system" in item ? { ...item, href: firstAllowedPage(user, item.system) } : item);
  const visibleSupport = supportItems.filter((item) => item.href === "/settings" ? canOpenSettings(user) : !item.permission || hasPermission(user, item.permission));
  const fullName = user?.fullName?.trim() || "مستخدم المنصة";
  const roleText = user?.roles.join("، ") || user?.departments.join("، ") || "مستخدم المنصة";

  return <aside className="sidebar">
    <div className="brand-block"><img src="/logo.png" alt="MZJ" /><span>مجموعة محمد بن ذعار العجمي</span></div>
    <nav className="sidebar-nav" aria-label="القائمة الرئيسية"><div className="nav-group">{resolvedItems.map((item) => <Item key={`${item.label}-${item.href}`} {...item} />)}</div><div className="nav-separator" /><div className="nav-group">{visibleSupport.map((item) => <Item key={item.href} {...item} />)}</div></nav>
    <div className="sidebar-account" aria-label="الحساب">
      <div className="account-avatar" aria-hidden="true">{fullName.slice(0, 1)}</div>
      <div className="account-details">
        <div className="account-row account-primary">
          <strong className="account-name" title={fullName}>{fullName}</strong>
          <NotificationBell />
        </div>
        <div className="account-row account-secondary">
          <span className="account-role" title={roleText}>{roleText}</span>
          <button type="button" className="logout-button" onClick={() => void logout()} aria-label="تسجيل الخروج" title="تسجيل الخروج"><SignOut size={17} /></button>
        </div>
      </div>
    </div>
  </aside>;
}
