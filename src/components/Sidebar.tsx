import { NavLink } from "react-router-dom";
import { ChartBar, Database, Gear, House, MapPin, Megaphone, Pulse, Question, SignOut, SuitcaseSimple, UsersThree } from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";
import { canAccessCrm, canAccessMarketing, canAccessOperations, canAccessTracking, canOpenSettings, hasPermission } from "../systemAccess";

const items = [
  { href: "/", label: "الداش بورد", icon: House, permission: "platform.dashboard.view" },
  { href: "/crm", label: "CRM", icon: UsersThree, system: "crm" },
  { href: "/marketing", label: "التسويق", icon: Megaphone, system: "marketing" },
  { href: "/operations", label: "العمليات", icon: SuitcaseSimple, system: "operations" },
  { href: "/tracking", label: "التراكينج", icon: MapPin, system: "tracking" },
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
  const visibleSupport = supportItems.filter((item) => item.href === "/settings" ? canOpenSettings(user) : !item.permission || hasPermission(user, item.permission));
  const roleText = user?.roles.join("، ") || user?.departments.join("، ") || "مستخدم المنصة";
  return <aside className="sidebar">
    <div className="brand-block"><img src="/logo.png" alt="MZJ" /><span>مجموعة محمد بن ذعار العجمي</span></div>
    <nav className="sidebar-nav" aria-label="القائمة الرئيسية"><div className="nav-group">{visibleItems.map((item) => <Item key={item.href} {...item} />)}</div><div className="nav-separator" /><div className="nav-group">{visibleSupport.map((item) => <Item key={item.href} {...item} />)}</div></nav>
    <div className="sidebar-account" aria-label="الحساب"><div className="account-avatar">{user?.fullName.trim().slice(0, 1) || "م"}</div><div className="account-copy"><strong>{user?.fullName}</strong><span>{roleText}</span></div><button type="button" className="logout-button" onClick={() => void logout()} aria-label="تسجيل الخروج" title="تسجيل الخروج"><SignOut size={18} /></button></div>
  </aside>;
}
