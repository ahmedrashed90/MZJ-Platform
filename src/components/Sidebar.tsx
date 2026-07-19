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

const items = [
  { href: "/", label: "الداش بورد", icon: House },
  { href: "/crm", label: "CRM", icon: UsersThree },
  { href: "/marketing", label: "التسويق", icon: Megaphone },
  { href: "/operations", label: "العمليات", icon: SuitcaseSimple },
  { href: "/tracking", label: "التراكينج", icon: MapPin, trackingOnly: true },
];

const supportItems = [
  { href: "/reports", label: "التقارير", icon: ChartBar },
  { href: "/database", label: "قاعدة البيانات", icon: Database },
  { href: "/settings", label: "الإعدادات", icon: Gear, adminOnly: true },
  { href: "/activity", label: "سجل النشاط", icon: Pulse },
  { href: "/help", label: "المساعدة", icon: Question },
];

type NavItem = { href: string; label: string; icon: typeof House; adminOnly?: boolean; trackingOnly?: boolean };

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
  const isAdmin = user?.roleCodes.includes("admin") ?? false;
  const canViewOperations = isAdmin || Boolean(user?.permissions?.includes("operations.view")) || Boolean(user?.roleCodes.includes("operations_user"));
  const canViewTracking = isAdmin || user?.roleCodes.some((code) => ["tracking_user", "sales_manager", "branch_manager", "operations_user"].includes(code)) || (user?.departmentCodes.includes("tracking") || user?.departmentCodes.includes("operations"));
  const visibleItems = items.filter((item) => item.href !== "/operations" ? (!item.trackingOnly || canViewTracking) : canViewOperations);
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
