import { NavLink } from "react-router-dom";
import {
  ChartBar,
  Database,
  Gear,
  House,
  Megaphone,
  MapPin,
  Pulse,
  Question,
  SignOut,
  SuitcaseSimple,
  UsersThree,
} from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";
import { canAccessCrm, canAccessMarketing, canAccessOperations, canAccessTracking, isPlatformAdmin } from "../systemAccess";

const items = [
  { href: "/", label: "الداش بورد", icon: House, adminOnly: true },
  { href: "/crm", label: "CRM", icon: UsersThree, crmOnly: true },
  { href: "/marketing", label: "التسويق", icon: Megaphone, marketingOnly: true },
  { href: "/operations", label: "العمليات", icon: SuitcaseSimple, operationsOnly: true },
  { href: "/tracking", label: "التراكينج", icon: MapPin, trackingOnly: true },
];

const supportItems = [
  { href: "/reports", label: "التقارير", icon: ChartBar, adminOnly: true },
  { href: "/database", label: "قاعدة البيانات", icon: Database, adminOnly: true },
  { href: "/settings", label: "الإعدادات", icon: Gear, adminOnly: true },
  { href: "/activity", label: "سجل النشاط", icon: Pulse, adminOnly: true },
  { href: "/help", label: "المساعدة", icon: Question },
];

type NavItem = { href: string; label: string; icon: typeof House; adminOnly?: boolean; crmOnly?: boolean; trackingOnly?: boolean; operationsOnly?: boolean; marketingOnly?: boolean };

function Item({ href, label, icon: Icon }: NavItem) {
  return (
    <NavLink
      to={href}
      end={href === "/"}
      className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
    >
      {({ isActive }: { isActive: boolean }) => (
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
  const isAdmin = isPlatformAdmin(user);
  const canViewCrm = canAccessCrm(user);
  const canViewMarketing = canAccessMarketing(user);
  const canViewOperations = canAccessOperations(user);
  const canViewTracking = canAccessTracking(user);
  const visibleItems = items.filter((item) =>
    (!item.adminOnly || isAdmin)
    && (!item.crmOnly || canViewCrm)
    && (!item.marketingOnly || canViewMarketing)
    && (!item.trackingOnly || canViewTracking)
    && (!item.operationsOnly || canViewOperations));
  const visibleSupport = supportItems.filter((item) => !item.adminOnly || isAdmin);
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
