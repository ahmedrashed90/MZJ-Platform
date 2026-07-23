import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  CalendarBlank,
  CalendarCheck,
  Car,
  ChartBar,
  ClipboardText,
  Gift,
  Megaphone,
  PlusCircle,
  ShareNetwork,
  SquaresFour,
  UserCheck,
} from "@phosphor-icons/react";
import { marketingFetch, marketingPost } from "./api";
import type { MarketingMeta } from "./types";
import { MarketingAlert, MarketingLoading, MarketingModal } from "./components/Ui";
import "./marketing.css";

const MarketingContext = createContext<{ meta: MarketingMeta; reloadMeta: () => Promise<void> } | null>(null);

export function useMarketingMeta() {
  const context = useContext(MarketingContext);
  if (!context) throw new Error("useMarketingMeta must be used inside MarketingLayout");
  return context;
}

type AccessKey = keyof MarketingMeta["access"];

const navigation: Array<{ to: string; label: string; icon: typeof SquaresFour; end?: boolean; access: AccessKey }> = [
  { to: "/marketing", label: "لوحة التحكم", icon: SquaresFour, end: true, access: "dashboard" },
  { to: "/marketing/database", label: "قاعدة البيانات", icon: ClipboardText, access: "reportsView" },
  { to: "/marketing/campaigns/new", label: "إنشاء حملة", icon: PlusCircle, access: "campaignsManage" },
  { to: "/marketing/agendas/new", label: "إنشاء أجندة", icon: CalendarCheck, access: "campaignsManage" },
  { to: "/marketing/campaigns", label: "إدارة الحملات", icon: Megaphone, access: "campaignsView" },
  { to: "/marketing/packages", label: "إدارة الباقات", icon: Gift, access: "packagesManage" },
  { to: "/marketing/platforms", label: "ربط المنصات", icon: ShareNetwork, access: "platformsManage" },
  { to: "/marketing/publish-prep", label: "تجهيز النشر", icon: ShareNetwork, access: "publishPrepView" },
  { to: "/marketing/tasks", label: "المتابعة", icon: ChartBar, access: "tasksView" },
  { to: "/marketing/calendar", label: "التقويم", icon: CalendarBlank, access: "campaignsView" },
  { to: "/marketing/receipt-calendar", label: "تقويم الاستلام", icon: CalendarCheck, access: "tasksView" },
  { to: "/marketing/stock", label: "الاستوك", icon: Car, access: "stockView" },
  { to: "/marketing/attendance", label: "الحضور والانصراف", icon: UserCheck, access: "attendanceSelf" },
];

export function MarketingLayout() {
  const [meta, setMeta] = useState<MarketingMeta | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attendanceDismissed, setAttendanceDismissed] = useState(false);
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const [attendanceMessage, setAttendanceMessage] = useState("");

  async function loadMeta() {
    setLoading(true); setError("");
    try { setMeta(await marketingFetch<MarketingMeta>("/api/marketing?resource=meta")); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل إعدادات التسويق"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadMeta(); }, []);

  async function checkInFromReminder() {
    setAttendanceBusy(true);
    setAttendanceMessage("");
    try {
      const result = await marketingPost<{ message: string }>({ action: "attendance_check_in" });
      setAttendanceMessage(result.message || "تم تسجيل الحضور");
      await loadMeta();
    } catch (failure) {
      setAttendanceMessage(failure instanceof Error ? failure.message : "تعذر تسجيل الحضور");
    } finally {
      setAttendanceBusy(false);
    }
  }

  if (loading && !meta) return <MarketingLoading label="جاري تجهيز نظام التسويق..." />;
  if (!meta) return <MarketingAlert>{error || "تعذر فتح نظام التسويق"}</MarketingAlert>;

  const currentMeta = meta;
  const contextValue = { meta: currentMeta, reloadMeta: loadMeta };

  return (
    <MarketingContext.Provider value={contextValue}>
      <div className="marketing-module" dir="rtl">
        <nav className="marketing-tabs" aria-label="صفحات نظام التسويق">
          {navigation.filter((item) => currentMeta.access[item.access]).map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => isActive ? "active" : ""}>
              <Icon size={18} weight="duotone" /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        {error ? <MarketingAlert>{error}</MarketingAlert> : null}
        <Outlet />
        <MarketingModal
          open={Boolean(currentMeta.attendanceReminder.required && !attendanceDismissed)}
          title="تسجيل الحضور"
          subtitle={`الدوام ${String(currentMeta.attendanceReminder.workStart || "16:00").slice(0, 5)} — ${String(currentMeta.attendanceReminder.workEnd || "21:00").slice(0, 5)}`}
          onClose={() => setAttendanceDismissed(true)}
          footer={<><button type="button" className="marketing-button" onClick={() => setAttendanceDismissed(true)}>لاحقًا</button><button type="button" className="marketing-button primary" disabled={attendanceBusy} onClick={() => void checkInFromReminder()}>{attendanceBusy ? "جاري التسجيل..." : "تسجيل الحضور الآن"}</button></>}
        >
          <div className="marketing-stack">
            <MarketingAlert type="info">لم يتم تسجيل حضورك اليوم. سجّل الحضور ليبدأ احتساب وقت العمل والحالة اللحظية.</MarketingAlert>
            {attendanceMessage ? <MarketingAlert type={attendanceMessage.includes("تم") ? "success" : "error"}>{attendanceMessage}</MarketingAlert> : null}
          </div>
        </MarketingModal>
      </div>
    </MarketingContext.Provider>
  );
}
