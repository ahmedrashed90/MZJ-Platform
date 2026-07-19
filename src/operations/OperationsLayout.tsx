import { useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Archive, Car, ClipboardText, ListMagnifyingGlass, MapTrifold, SealCheck, SlidersHorizontal, Truck } from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";

const tabs = [
  { to: "/operations", label: "مخزون السيارات", icon: Car, end: true },
  { to: "/operations/vehicles", label: "إدارة السيارات", icon: SlidersHorizontal },
  { to: "/operations/movement", label: "الحركة", icon: MapTrifold },
  { to: "/operations/requests", label: "طلبات النقل", icon: Truck },
  { to: "/operations/approvals", label: "الموافقات", icon: SealCheck },
  { to: "/operations/all", label: "جميع السيارات", icon: ListMagnifyingGlass },
  { to: "/operations/movements", label: "سجل الحركات", icon: ClipboardText },
  { to: "/operations/archive", label: "الأرشيف", icon: Archive },
];

export function OperationsLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const tabsRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const activeTab = tabsRef.current?.querySelector<HTMLElement>("a.active");
    activeTab?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [location.pathname]);
  const allowed = user?.isSystemAdmin || user?.departmentCodes.includes("operations") || user?.roleCodes.some((code) => ["operations_manager", "operations_user", "accounting_manager", "branch_manager"].includes(code)) || user?.permissions.some((code) => code.startsWith("operations."));
  if (!allowed) return <section className="panel operations-access-denied"><h1>نظام العمليات</h1><p>ليس لديك صلاحية الدخول إلى هذا النظام.</p></section>;
  return (
    <section className="operations-module">
      <header className="operations-module-head">
        <div><span>المنصة الموحدة</span><h1>نظام العمليات</h1><p>إدارة مخزون السيارات والحركات والطلبات والموافقات من مصدر بيانات واحد.</p></div>
      </header>
      <nav ref={tabsRef} className="operations-tabs" aria-label="صفحات العمليات">
        {tabs.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({isActive})=>isActive?"active":""}><Icon size={19}/><span>{label}</span></NavLink>)}
      </nav>
      <Outlet />
    </section>
  );
}
