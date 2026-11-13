import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  CaretDown,
  ChartBar,
  Crown,
  Database,
  Gear,
  Globe,
  House,
  List,
  MapPin,
  Megaphone,
  Pulse,
  Question,
  SignIn,
  SignOut,
  SuitcaseSimple,
  UserSwitch,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";
import { attendanceFetch, formatAttendanceTime } from "../attendance/api";
import { NotificationBell } from "../notifications/NotificationBell";
import {
  canAccessCrm,
  canAccessMarketing,
  canAccessOperations,
  canAccessTracking,
  canAccessWebsite,
  canOpenSettings,
  hasPermission,
} from "../systemAccess";
import { firstAllowedPage } from "../../shared/access-control";

const items = [
  { href: "/", label: "الداش بورد", icon: House, permission: "platform.dashboard.view" },
  { href: "/crm", label: "CRM", icon: UsersThree, system: "crm" },
  { href: "/marketing", label: "التسويق", icon: Megaphone, system: "marketing" },
  { href: "/operations", label: "العمليات", icon: SuitcaseSimple, system: "operations" },
  { href: "/tracking", label: "التراكينج", icon: MapPin, system: "tracking" },
  { href: "/website", label: "الموقع الإلكتروني", icon: Globe, system: "website" },
  { href: "/owners-community", label: "MZJ Club Community", icon: Crown, permission: "owners.community.view" },
  { href: "/attendance", label: "الحضور والانصراف", icon: UserSwitch, permission: "platform.superadmin" },
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
      ["/crm/finance-history", "سجل العملاء", "crm.finance_history.view"],
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
      ["/marketing/database", "قاعدة البيانات", "marketing.database.view"],
      ["/marketing/create", "إنشاء", "marketing.create.view"],
      ["/marketing/marketing-tracking", "التراكينج", "marketing.idea_tracking.view"],
      ["/marketing/products", "المنتجات", "marketing.products.view"],
      ["/marketing/packages", "الباقات", "marketing.packages.view"],
      ["/marketing/receipt-calendar", "تقويم الاستلام", "marketing.receipt_calendar.view"],
      ["/marketing/publish-prep", "تجهيز النشر", "marketing.publish_prep.view"],
      ["/marketing/engagement", "تفاعل النشر", "marketing.engagement.view"],
      ["/marketing/ratings", "تقييمات المنفذين", "marketing.dashboard.view"],
      ["/marketing/stock", "الاستوك", "marketing.stock.view"],
      ["/marketing/subscriptions", "الاشتراكات", "marketing.subscriptions.view"],
      ["/marketing/lead-forms", "فورم المنصات", "marketing.lead_forms.view"],
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
  {
    key: "website",
    label: "الموقع الإلكتروني",
    icon: Globe,
    pages: [
      ["/website", "الاستوك في الموقع", "website.stock.view"],
      ["/website/images", "إدارة صور السيارات", "website.stock.view"],
    ],
  },
] as const;

type SelfAttendanceState = {
  enforcementEnabled: boolean;
  assigned: boolean;
  scheduleName: string | null;
  isDayOff: boolean;
  activePeriod: {
    id: string;
    name: string;
    startTime: string;
    endTime: string;
    graceMinutes: number;
    workDate: string;
  } | null;
  record: {
    checkIn: string | null;
    checkOut: string | null;
    checkoutSource: string | null;
    delayMinutes: number;
    workMinutes: number;
    status: string;
  } | null;
  canCheckIn: boolean;
  hasOpenAttendance: boolean;
  deviceAttendanceRole?: "primary" | "secondary" | "exempt" | "unverified";
};

type SelfAttendancePayload = { ok: true; state: SelfAttendanceState };

type NavItem = { href: string; label: string; icon: typeof House; onNavigate?: () => void };

function Item({ href, label, icon: Icon, onNavigate }: NavItem) {
  return (
    <NavLink to={href} end={href === "/"} onClick={onNavigate} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
      {({ isActive }) => <><Icon size={22} weight={isActive ? "fill" : "regular"} /><span>{label}</span></>}
    </NavLink>
  );
}

function attendanceStateLabel(state: SelfAttendanceState | null) {
  if (state?.deviceAttendanceRole === "secondary") return "جهاز ثانوي • الحضور من الجهاز الأساسي";
  if (!state?.assigned) return "";
  if (state.isDayOff) return "اليوم إجازة";
  if (!state.activePeriod) return "خارج فترة العمل";
  if (state.hasOpenAttendance && state.record?.checkIn) {
    return `${state.activePeriod.name} • حضور ${formatAttendanceTime(state.record.checkIn)}`;
  }
  if (state.canCheckIn) return `${state.activePeriod.name} • لم يسجل الحضور`;
  if (state.record?.checkOut) return `${state.activePeriod.name} • تم الانصراف`;
  return state.activePeriod.name;
}

export function Sidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [attendanceState, setAttendanceState] = useState<SelfAttendanceState | null>(null);
  const [attendanceBusy, setAttendanceBusy] = useState<"" | "checkin" | "logout">("");
  const [attendanceError, setAttendanceError] = useState("");
  const autoCheckInAttempts = useRef(new Set<string>());
  const currentSystem = mobileSystems.find((system) => location.pathname === `/${system.key}` || location.pathname.startsWith(`/${system.key}/`))?.key || "";
  const [expandedSystem, setExpandedSystem] = useState<string>(currentSystem);

  const systemAllowed: Record<string, boolean> = {
    crm: canAccessCrm(user),
    marketing: canAccessMarketing(user),
    operations: canAccessOperations(user),
    tracking: canAccessTracking(user),
    website: canAccessWebsite(user),
  };
  const visibleItems = items.filter((item) => "permission" in item ? !item.permission || hasPermission(user, item.permission) : systemAllowed[item.system]);
  const resolvedItems = visibleItems.map((item) => "system" in item ? { ...item, href: firstAllowedPage(user, item.system) } : item);
  const mobileStandaloneItems = resolvedItems.filter((item) => "permission" in item && item.href !== "/");
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

  useEffect(() => {
    if (!user?.id) {
      setAttendanceState(null);
      autoCheckInAttempts.current.clear();
      return;
    }
    let stopped = false;
    const load = async () => {
      try {
        const payload = await attendanceFetch<SelfAttendancePayload>("/api/attendance?view=self");
        if (!stopped) setAttendanceState(payload.state);
      } catch {
        if (!stopped) setAttendanceState(null);
      }
    };
    void load();
    const interval = window.setInterval(() => { void load(); }, 30000);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [user?.id]);

  async function handleCheckIn() {
    if (attendanceBusy) return;
    setAttendanceBusy("checkin");
    setAttendanceError("");
    try {
      const payload = await attendanceFetch<SelfAttendancePayload>("/api/attendance", {
        method: "POST",
        body: JSON.stringify({ action: "self_check_in" }),
      });
      setAttendanceState(payload.state);
    } catch (error) {
      setAttendanceError(error instanceof Error ? error.message : "تعذر تسجيل الحضور");
    } finally {
      setAttendanceBusy("");
    }
  }

  useEffect(() => {
    if (!user?.id || !attendanceState?.canCheckIn || !attendanceState.activePeriod || attendanceBusy) return;
    if (!['primary', 'exempt'].includes(attendanceState.deviceAttendanceRole || '')) return;
    const period = attendanceState.activePeriod;
    const key = `${user.id}:${period.id}:${period.workDate}`;
    if (autoCheckInAttempts.current.has(key)) return;
    autoCheckInAttempts.current.add(key);
    void handleCheckIn();
  }, [user?.id, attendanceState?.canCheckIn, attendanceState?.activePeriod?.id,
    attendanceState?.activePeriod?.workDate, attendanceState?.deviceAttendanceRole, attendanceBusy]);

  async function handleLogout() {
    if (attendanceBusy) return;
    setAttendanceBusy("logout");
    setAttendanceError("");
    try {
      await logout();
    } catch (error) {
      setAttendanceError(error instanceof Error ? error.message : "تعذر تسجيل الخروج");
    } finally {
      setAttendanceBusy("");
    }
  }

  const needsCheckIn = Boolean(attendanceState?.canCheckIn);
  const hasOpenAttendance = Boolean(attendanceState?.hasOpenAttendance);
  const actionLabel = needsCheckIn
    ? attendanceBusy === "checkin" ? "جاري تسجيل الحضور..." : "تسجيل حضور"
    : attendanceBusy === "logout" ? "جاري تسجيل الخروج..." : "تسجيل خروج";
  const ActionIcon = needsCheckIn ? SignIn : SignOut;
  const stateLabel = attendanceStateLabel(attendanceState);
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
        {mobileStandaloneItems.length ? <>
          <div className="nav-separator" />
          <div className="nav-group">{mobileStandaloneItems.map((item) => <Item key={item.href} {...item} onNavigate={closeMobile} />)}</div>
        </> : null}
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
          <span className="account-role" title={roleText}>{roleText}</span>
          {stateLabel ? <span className={`attendance-account-state ${needsCheckIn ? "needs-checkin" : hasOpenAttendance ? "checked-in" : ""}`}>{stateLabel}</span> : null}
          {attendanceError ? <span className="attendance-account-error" title={attendanceError}>{attendanceError}</span> : null}
          <button
            type="button"
            className={`attendance-account-action ${needsCheckIn ? "checkin" : "logout"}`}
            onClick={() => needsCheckIn ? void handleCheckIn() : void handleLogout()}
            disabled={Boolean(attendanceBusy)}
            aria-label={actionLabel}
            title={needsCheckIn ? actionLabel : hasOpenAttendance ? "تسجيل الخروج من المنصة - الانصراف يتم تلقائيًا حسب نهاية الدوام" : actionLabel}
          >
            <ActionIcon size={17} />
            <span>{actionLabel}</span>
          </button>
        </div>
      </div>
    </aside>
  </>;
}
