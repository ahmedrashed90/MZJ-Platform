import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  CaretDown,
  ChartBar,
  Database,
  Gear,
  House,
  List,
  MapPin,
  Megaphone,
  Pulse,
  Question,
  SignOut,
  SuitcaseSimple,
  UsersThree,
  X,
} from "@phosphor-icons/react";
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
] as const;

const supportItems = [
  { href: "/reports", label: "التقارير", icon: ChartBar, permission: "platform.reports.view" },
  { href: "/database", label: "قاعدة البيانات", icon: Database, permission: "platform.database.view" },
  { href: "/settings", label: "الإعدادات", icon: Gear, permission: "settings.view" },
  { href: "/activity", label: "سجل النشاط", icon: Pulse, permission: "platform.activity.view" },
  { href: "/help", label: "المساعدة", icon: Question, permission: "" },
] as const;

const mobileSystems = [
  {
    key: "crm",
    label: "CRM",
    icon: UsersThree,
    pages: [
      ["/crm", "الداش بورد", "crm.dashboard.view"],
      ["/crm/database", "قاعدة البيانات", "crm.database.view"],
      ["/crm/manual-leads", "إضافة العملاء", "crm.manual_leads.view"],
      ["/crm/finance-history", "سجل عملاء التمويل", "crm.finance_history.view"],
      ["/crm/inbox", "رسائل غير مصنفة", "crm.inbox.view"],
      ["/crm/contacts", "جهات الاتصال", "crm.contacts.view"],
      ["/crm/inbox-agent", "وكيل صندوق الوارد", "crm.inbox_agent.view"],
      ["/crm/reports", "التقارير", "crm.reports.view"],
      ["/crm/kpi", "تقييم المناديب KPI", "crm.kpi.view"],
    ],
  },
  {
    key: "marketing",
    label: "التسويق",
    icon: Megaphone,
    pages: [
      ["/marketing", "الداش بورد", "marketing.dashboard.view"],
      ["/marketing/create-campaign", "إنشاء حملة", "marketing.create_campaign.view"],
      ["/marketing/create-agenda", "إنشاء أجندة", "marketing.create_agenda.view"],
      ["/marketing/database", "قاعدة البيانات", "marketing.database.view"],
      ["/marketing/packages", "إدارة الباقات", "marketing.packages.view"],
      ["/marketing/publish-prep", "تجهيز النشر", "marketing.publish_prep.view"],
      ["/marketing/engagement", "تفاعل النشر", "marketing.engagement.view"],
      ["/marketing/monitoring", "المتابعة", "marketing.monitoring.view"],
      ["/marketing/calendar", "التقويم", "marketing.calendar.view"],
      ["/marketing/receipt-calendar", "تقويم الاستلام", "marketing.receipt_calendar.view"],
      ["/marketing/stock", "الاستوك", "marketing.stock.view"],
      ["/marketing/attendance", "الحضور والانصراف", "marketing.attendance.view"],
    ],
  },
  {
    key: "operations",
    label: "العمليات",
    icon: SuitcaseSimple,
    pages: [
      ["/operations", "مخزون السيارات", "operations.inventory.view"],
      ["/operations/manage", "إدارة السيارات", "operations.manage.view"],
      ["/operations/movement", "الحركة", "operations.movement.view"],
      ["/operations/transfers", "الطلبات", "operations.transfers.view"],
      ["/operations/approvals", "الموافقات", "operations.approvals.view"],
      ["/operations/sales-orders", "متابعة طلبات البيع", "operations.sales_orders_followup.view"],
      ["/operations/movements", "سجل الحركات", "operations.movements.view"],
      ["/operations/archive", "الأرشيف", "operations.archive.view"],
    ],
  },
  {
    key: "tracking",
    label: "التراكينج",
    icon: MapPin,
    pages: [
      ["/tracking", "طلبات التراكينج", "tracking.orders.view"],
      ["/tracking/archive", "أرشيف الطلبات", "tracking.archive.view"],
      ["/tracking/delete", "حذف طلبات التراكينج", "tracking.delete.view"],
    ],
  },
] as const;

type NavItem = { href: string; label: string; icon: typeof House; onNavigate?: () => void };
function Item({ href, label, icon: Icon, onNavigate }: NavItem) {
  return (
    <NavLink to={href} end={href === "/"} onClick={onNavigate} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
      {({ isActive }) => <><Icon size={22} weight={isActive ? "fill" : "regular"} /><span>{label}</span></>}
    </NavLink>
  );
}

export function Sidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const currentSystem = mobileSystems.find((system) => location.pathname === `/${system.key}` || location.pathname.startsWith(`/${system.key}/`))?.key || "";
  const [expandedSystem, setExpandedSystem] = useState<string>(currentSystem);

  const systemAllowed: Record<string, boolean> = {
    crm: canAccessCrm(user),
    marketing: canAccessMarketing(user),
    operations: canAccessOperations(user),
    tracking: canAccessTracking(user),
  };
  const visibleItems = items.filter((item) => "permission" in item ? hasPermission(user, item.permission) : systemAllowed[item.system]);
  const resolvedItems = visibleItems.map((item) => "system" in item ? { ...item, href: firstAllowedPage(user, item.system) } : item);
  const visibleSupport = supportItems.filter((item) => item.href === "/settings" ? canOpenSettings(user) : !item.permission || hasPermission(user, item.permission));
  const visibleMobileSystems = useMemo(() => mobileSystems
    .filter((system) => systemAllowed[system.key])
    .map((system) => ({ ...system, pages: system.pages.filter(([, , permission]) => hasPermission(user, permission)) }))
    .filter((system) => system.pages.length > 0), [user]);
  const fullName = user?.fullName?.trim() || "مستخدم المنصة";
  const roleText = user?.roles.join("، ") || user?.departments.join("، ") || "مستخدم المنصة";

  useEffect(() => {
    setMobileOpen(false);
    if (currentSystem) setExpandedSystem(currentSystem);
  }, [location.pathname]);

  useEffect(() => {
    document.body.classList.toggle("mobile-sidebar-open", mobileOpen);
    return () => document.body.classList.remove("mobile-sidebar-open");
  }, [mobileOpen]);

  const closeMobile = () => setMobileOpen(false);

  return <>
    <button type="button" className="mobile-menu-trigger" onClick={() => setMobileOpen(true)} aria-label="فتح قائمة المنصة" aria-expanded={mobileOpen}>
      <List size={21} weight="bold" />
      <span>القائمة</span>
    </button>
    <button type="button" className={`mobile-sidebar-backdrop ${mobileOpen ? "is-open" : ""}`} onClick={closeMobile} aria-label="إغلاق القائمة" />
    <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="brand-block">
        <button type="button" className="mobile-sidebar-close" onClick={closeMobile} aria-label="إغلاق القائمة"><X size={21} /></button>
        <img src="/logo.png" alt="MZJ" />
        <span>مجموعة محمد بن ذعار العجمي</span>
      </div>

      <nav className="sidebar-nav sidebar-nav-desktop" aria-label="القائمة الرئيسية">
        <div className="nav-group">{resolvedItems.map((item) => <Item key={`${item.label}-${item.href}`} {...item} />)}</div>
        <div className="nav-separator" />
        <div className="nav-group">{visibleSupport.map((item) => <Item key={item.href} {...item} />)}</div>
      </nav>

      <nav className="sidebar-nav sidebar-nav-mobile" aria-label="قائمة المنصة للموبايل">
        {hasPermission(user, "platform.dashboard.view") ? <Item href="/" label="الداش بورد" icon={House} onNavigate={closeMobile} /> : null}
        <div className="mobile-system-groups">
          {visibleMobileSystems.map((system) => {
            const Icon = system.icon;
            const expanded = expandedSystem === system.key;
            const active = currentSystem === system.key;
            return <section className={`mobile-system-group ${active ? "active" : ""}`} key={system.key}>
              <button type="button" className="mobile-system-toggle" onClick={() => setExpandedSystem((current) => current === system.key ? "" : system.key)} aria-expanded={expanded}>
                <span><Icon size={21} weight={active ? "fill" : "duotone"} />{system.label}</span>
                <CaretDown size={18} className={expanded ? "expanded" : ""} />
              </button>
              {expanded ? <div className="mobile-system-pages">
                {system.pages.map(([href, label]) => <NavLink key={href} to={href} end={href === `/${system.key}`} onClick={closeMobile} className={({ isActive }) => isActive ? "active" : ""}>{label}</NavLink>)}
              </div> : null}
            </section>;
          })}
        </div>
        <div className="nav-separator" />
        <div className="nav-group">{visibleSupport.map((item) => <Item key={item.href} {...item} onNavigate={closeMobile} />)}</div>
      </nav>

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
    </aside>
  </>;
}
