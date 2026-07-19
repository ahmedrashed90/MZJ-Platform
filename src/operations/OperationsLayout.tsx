import { NavLink, Outlet } from "react-router-dom";
import { Archive, ArrowsLeftRight, Car, CheckSquare, ClipboardText, ListBullets, Table, Wrench } from "@phosphor-icons/react";

const tabs = [
  { to: "/operations", end: true, label: "مخزون السيارات", icon: Car },
  { to: "/operations/manage", label: "إدارة السيارات", icon: Wrench },
  { to: "/operations/movement", label: "الحركة", icon: ArrowsLeftRight },
  { to: "/operations/transfers", label: "طلبات النقل", icon: ClipboardText },
  { to: "/operations/approvals", label: "الموافقات", icon: CheckSquare },
  { to: "/operations/all", label: "جميع السيارات", icon: Table },
  { to: "/operations/movements", label: "سجل الحركات", icon: ListBullets },
  { to: "/operations/archive", label: "الأرشيف", icon: Archive },
];

export function OperationsLayout() {
  return <div className="operations-module">
    <nav className="operations-tabs" aria-label="تبويبات العمليات">
      {tabs.map(({to,end,label,icon:Icon}) => <NavLink key={to} to={to} end={end} className={({isActive})=>isActive?"active":""}><Icon size={18}/><span>{label}</span></NavLink>)}
    </nav>
    <Outlet />
  </div>;
}
