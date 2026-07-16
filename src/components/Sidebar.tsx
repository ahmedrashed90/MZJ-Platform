import { NavLink } from "react-router-dom";
import {
  ArrowsClockwise,
  ChartBar,
  Database,
  Gear,
  House,
  Megaphone,
  MapPin,
  Pulse,
  Question,
  SignIn,
  SuitcaseSimple,
  UsersThree,
} from "@phosphor-icons/react";

const items = [
  { href: "/", label: "الداش بورد", icon: House },
  { href: "/crm", label: "CRM", icon: UsersThree },
  { href: "/marketing", label: "التسويق", icon: Megaphone },
  { href: "/operations", label: "العمليات", icon: SuitcaseSimple },
  { href: "/tracking", label: "التتبع", icon: MapPin },
];

const supportItems = [
  { href: "/reports", label: "التقارير", icon: ChartBar },
  { href: "/database", label: "قاعدة البيانات", icon: Database },
  { href: "/settings", label: "الإعدادات", icon: Gear },
  { href: "/activity", label: "سجل النشاط", icon: Pulse },
  { href: "/help", label: "المساعدة", icon: Question },
];

function Item({ href, label, icon: Icon }: (typeof items)[number]) {
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
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <img src="/logo.png" alt="MZJ" />
        <span>مجموعة محمد بن ذعار العجمي</span>
      </div>

      <nav className="sidebar-nav" aria-label="القائمة الرئيسية">
        <div className="nav-group">
          {items.map((item) => <Item key={item.href} {...item} />)}
        </div>
        <div className="nav-separator" />
        <div className="nav-group">
          {supportItems.map((item) => <Item key={item.href} {...item} />)}
        </div>
      </nav>

      <div className="sidebar-account" aria-label="الحساب">
        <div className="account-avatar"><SignIn size={20} /></div>
        <div className="account-copy">
          <strong>تسجيل الدخول</strong>
          <span>لا يوجد مستخدم مسجل</span>
        </div>
        <ArrowsClockwise size={17} />
      </div>
    </aside>
  );
}
