import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { ChartBar, Crown, Database, Gear, Globe, House, MapPin, Megaphone, Pulse, Question, SignIn, SignOut, SuitcaseSimple, UserSwitch, UsersThree } from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";
import { attendanceFetch, formatAttendanceTime } from "../attendance/api";
import { getBrowserAttendanceLocation } from "../attendance/location";
import { NotificationBell } from "../notifications/NotificationBell";
import { canAccessCrm, canAccessMarketing, canAccessOperations, canAccessTracking, canAccessWebsite, canOpenSettings, hasPermission } from "../systemAccess";
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
    locationResult: string;
    latitude: number | null;
    longitude: number | null;
    accuracy: number | null;
    distance: number | null;
    nearestDistance: number | null;
    checkInIp: string | null;
    verificationMethod: string;
  } | null;
  canCheckIn: boolean;
  canCheckOut: boolean;
  locationRequired: boolean;
  locationCaptured: boolean;
  needsLocationCapture: boolean;
  networkFallbackConfigured: boolean;
  requiredLocationName: string | null;
};

type SelfAttendancePayload = { ok: true; state: SelfAttendanceState };

type NavItem = { href: string; label: string; icon: typeof House };

function Item({ href, label, icon: Icon }: NavItem) {
  return (
    <NavLink to={href} end={href === "/"} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
      {({ isActive }) => <><Icon size={22} weight={isActive ? "fill" : "regular"} /><span>{label}</span></>}
    </NavLink>
  );
}

function attendanceStateLabel(state: SelfAttendanceState | null) {
  if (!state?.assigned) return "";
  if (state.isDayOff) return "اليوم إجازة";
  if (!state.activePeriod) return "خارج فترة العمل";
  if (state.canCheckOut && state.record?.checkIn) {
    const verificationText = state.record.verificationMethod === "network"
      ? " • شبكة الفرع"
      : state.record.verificationMethod === "gps_and_network"
        ? " • GPS + شبكة الفرع"
        : " • اللوكيشن محفوظ";
    const locationText = state.locationRequired ? (state.locationCaptured ? verificationText : " • إثبات المكان غير محفوظ") : "";
    return `${state.activePeriod.name} • حضور ${formatAttendanceTime(state.record.checkIn)}${locationText}`;
  }
  if (state.canCheckIn) return `${state.activePeriod.name} • لم يسجل الحضور`;
  if (state.record?.checkOut) return `${state.activePeriod.name} • تم الانصراف`;
  return state.activePeriod.name;
}

export function Sidebar() {
  const { user, logout } = useAuth();
  const [attendanceState, setAttendanceState] = useState<SelfAttendanceState | null>(null);
  const [attendanceBusy, setAttendanceBusy] = useState<"" | "checkin" | "location" | "logout">("");
  const [attendanceError, setAttendanceError] = useState("");
  const locationRecoveryAttempt = useRef("");

  const systemAllowed: Record<string, boolean> = {
    crm: canAccessCrm(user),
    marketing: canAccessMarketing(user),
    operations: canAccessOperations(user),
    tracking: canAccessTracking(user),
    website: canAccessWebsite(user),
  };
  const visibleItems = items.filter((item) => "permission" in item ? !item.permission || hasPermission(user, item.permission) : systemAllowed[item.system]);
  const resolvedItems = visibleItems.map((item) => "system" in item ? { ...item, href: firstAllowedPage(user, item.system) } : item);
  const visibleSupport = supportItems.filter((item) => item.href === "/settings" ? canOpenSettings(user) : !item.permission || hasPermission(user, item.permission));
  const fullName = user?.fullName?.trim() || "مستخدم المنصة";
  const roleText = user?.roles.join("، ") || user?.departments.join("، ") || "مستخدم المنصة";

  useEffect(() => {
    if (!user?.id) {
      setAttendanceState(null);
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

  async function captureMissingAttendanceLocation() {
    if (!attendanceState?.needsLocationCapture || !attendanceState.locationRequired) return attendanceState;
    setAttendanceBusy("location");
    setAttendanceError("");
    try {
      let location = null;
      try {
        location = await getBrowserAttendanceLocation();
      } catch (locationError) {
        if (!attendanceState.networkFallbackConfigured) throw locationError;
      }
      const payload = await attendanceFetch<SelfAttendancePayload>("/api/attendance", {
        method: "POST",
        body: JSON.stringify({
          action: "self_check_in",
          location,
          allowNetworkFallback: attendanceState.networkFallbackConfigured,
        }),
      });
      setAttendanceState(payload.state);
      return payload.state;
    } catch (error) {
      setAttendanceError(error instanceof Error ? error.message : "تعذر حفظ لوكيشن الحضور");
      throw error;
    } finally {
      setAttendanceBusy("");
    }
  }

  useEffect(() => {
    const key = attendanceState?.needsLocationCapture && attendanceState.record?.checkIn
      ? `${user?.id || ""}:${attendanceState.record.checkIn}`
      : "";
    if (!key || locationRecoveryAttempt.current === key) return;
    locationRecoveryAttempt.current = key;
    void captureMissingAttendanceLocation().catch(() => undefined);
  }, [attendanceState?.needsLocationCapture, attendanceState?.record?.checkIn, user?.id]);

  async function handleCheckIn() {
    if (attendanceBusy) return;
    setAttendanceBusy("checkin");
    setAttendanceError("");
    try {
      let location = null;
      if (attendanceState?.locationRequired) {
        try {
          location = await getBrowserAttendanceLocation();
        } catch (locationError) {
          if (!attendanceState.networkFallbackConfigured) throw locationError;
        }
      }
      const payload = await attendanceFetch<SelfAttendancePayload>("/api/attendance", {
        method: "POST",
        body: JSON.stringify({
          action: "self_check_in",
          location,
          allowNetworkFallback: Boolean(attendanceState?.networkFallbackConfigured),
        }),
      });
      setAttendanceState(payload.state);
    } catch (error) {
      setAttendanceError(error instanceof Error ? error.message : "تعذر تسجيل الحضور");
    } finally {
      setAttendanceBusy("");
    }
  }

  async function handleLogout() {
    if (attendanceBusy) return;
    setAttendanceError("");
    try {
      if (attendanceState?.needsLocationCapture) {
        await captureMissingAttendanceLocation();
      }
      setAttendanceBusy("logout");
      await logout();
    } catch (error) {
      setAttendanceError(error instanceof Error ? error.message : "تعذر تسجيل الانصراف وتسجيل الخروج");
    } finally {
      setAttendanceBusy("");
    }
  }

  const needsCheckIn = Boolean(attendanceState?.canCheckIn);
  const hasOpenAttendance = Boolean(attendanceState?.canCheckOut);
  const actionLabel = needsCheckIn
    ? attendanceBusy === "checkin" ? "جاري تسجيل الحضور..." : "تسجيل حضور"
    : hasOpenAttendance
      ? attendanceBusy === "location" ? "جاري حفظ اللوكيشن..." : attendanceBusy === "logout" ? "جاري تسجيل الانصراف..." : "تسجيل انصراف وتسجيل خروج"
      : attendanceBusy === "logout" ? "جاري تسجيل الخروج..." : "تسجيل خروج";
  const ActionIcon = needsCheckIn ? SignIn : SignOut;
  const stateLabel = attendanceStateLabel(attendanceState);

  return (
    <aside className="sidebar">
      <div className="brand-block"><img src="/logo.png" alt="MZJ" /><span>مجموعة محمد بن ذعار العجمي</span></div>
      <nav className="sidebar-nav" aria-label="القائمة الرئيسية">
        <div className="nav-group">{resolvedItems.map((item) => <Item key={`${item.label}-${item.href}`} {...item} />)}</div>
        <div className="nav-separator" />
        <div className="nav-group">{visibleSupport.map((item) => <Item key={item.href} {...item} />)}</div>
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
            className={`attendance-account-action ${needsCheckIn ? "checkin" : hasOpenAttendance ? "checkout" : "logout"}`}
            onClick={() => needsCheckIn ? void handleCheckIn() : void handleLogout()}
            disabled={Boolean(attendanceBusy)}
            aria-label={actionLabel}
            title={actionLabel}
          >
            <ActionIcon size={17} />
            <span>{actionLabel}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
