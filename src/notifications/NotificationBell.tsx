import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check, CheckCircle, Info, Megaphone, MapPin, SuitcaseSimple, UsersThree, WarningCircle, X } from "@phosphor-icons/react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { fetchNotifications, updateNotifications } from "./api";
import type { NotificationSystem, PlatformNotification } from "./types";

const systemLabels: Record<NotificationSystem, string> = { crm: "CRM", marketing: "التسويق", operations: "العمليات", tracking: "التراكينج" };
const systemIcons = { crm: UsersThree, marketing: Megaphone, operations: SuitcaseSimple, tracking: MapPin };

function relativeTime(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return "الآن";
  const minutes = Math.floor(seconds / 60); if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60); if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24); return `منذ ${days} يوم`;
}

function routeSystem(pathname: string): NotificationSystem | null {
  if (pathname.startsWith("/crm")) return "crm";
  if (pathname.startsWith("/marketing")) return "marketing";
  if (pathname.startsWith("/operations")) return "operations";
  if (pathname.startsWith("/tracking")) return "tracking";
  return null;
}

function NotificationIcon({ item }: { item: PlatformNotification }) {
  const SystemIcon = systemIcons[item.system_code];
  if (item.severity === "danger" || item.severity === "warning") return <WarningCircle size={20} weight="duotone" />;
  if (item.severity === "success") return <CheckCircle size={20} weight="duotone" />;
  return SystemIcon ? <SystemIcon size={20} weight="duotone" /> : <Info size={20} weight="duotone" />;
}

export function NotificationBell() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const admin = Boolean(user?.permissions?.includes("platform.superadmin") || user?.roleCodes?.some((code) => ["admin", "system_admin"].includes(code)));
  const currentSystem = routeSystem(location.pathname);
  const scope = currentSystem || (admin ? "all" : "");
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PlatformNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    try {
      const result = await fetchNotifications(scope, 12);
      setRows(result.rows);
      setUnread(result.unread);
    } catch {
      if (!silent) setRows([]);
    } finally { if (!silent) setLoading(false); }
  }, [scope, user]);

  useEffect(() => {
    void load(true);
    const interval = window.setInterval(() => void load(true), 15000);
    const refresh = () => { if (document.visibilityState === "visible") void load(true); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);
  useEffect(() => { if (open) void load(); }, [open, load]);
  useEffect(() => {
    const onPointer = (event: MouseEvent) => { if (open && panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onPointer); return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);
  useEffect(() => { setOpen(false); }, [location.pathname]);

  async function openItem(item: PlatformNotification) {
    if (!item.read_at) {
      await updateNotifications({ ids: [item.id], read: true }).catch(() => undefined);
      setRows((current) => current.map((row) => row.id === item.id ? { ...row, read_at: new Date().toISOString() } : row));
      setUnread((value) => Math.max(0, value - 1));
    }
    setOpen(false);
    if (item.action_url) navigate(item.action_url);
  }

  async function markAllRead() {
    await updateNotifications({ system: scope, read: true }).catch(() => undefined);
    setRows((current) => current.map((row) => ({ ...row, read_at: row.read_at || new Date().toISOString() })));
    setUnread(0);
  }

  return (
    <div className="notification-bell-wrap" ref={panelRef}>
      <button type="button" className={`notification-bell-button ${open ? "active" : ""}`} onClick={() => setOpen((value) => !value)} aria-label="الإشعارات" title="الإشعارات">
        <Bell size={22} weight={unread ? "fill" : "duotone"} />
        {unread > 0 ? <span>{unread > 99 ? "99+" : unread}</span> : null}
      </button>
      {open ? (
        <section className="notification-popover" aria-label="قائمة الإشعارات">
          <header>
            <div><strong>الإشعارات</strong><span>{scope === "all" ? "كل أنظمة المنصة" : scope ? systemLabels[scope as NotificationSystem] : "الأنظمة المتاحة للمستخدم"}</span></div>
            <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق"><X size={18} /></button>
          </header>
          <div className="notification-popover-actions">
            <span>{unread ? `${unread} غير مقروء` : "لا توجد إشعارات جديدة"}</span>
            {unread ? <button type="button" onClick={() => void markAllRead()}><Check size={15} />تعيين الكل كمقروء</button> : null}
          </div>
          <div className="notification-popover-list">
            {loading ? <div className="notification-empty">جاري تحميل الإشعارات...</div> : null}
            {!loading && !rows.length ? <div className="notification-empty"><Bell size={27} weight="duotone" /><span>لا توجد إشعارات</span></div> : null}
            {!loading ? rows.map((item) => (
              <button type="button" key={item.id} className={`notification-row ${item.read_at ? "read" : "unread"}`} data-severity={item.severity} onClick={() => void openItem(item)}>
                <span className="notification-row-icon"><NotificationIcon item={item} /></span>
                <span className="notification-row-copy"><strong>{item.title}</strong>{item.body ? <small>{item.body}</small> : null}<time>{relativeTime(item.created_at)}</time></span>
                {!item.read_at ? <i aria-label="غير مقروء" /> : null}
              </button>
            )) : null}
          </div>
          {admin ? <footer><button type="button" onClick={() => { setOpen(false); navigate("/notifications"); }}>فتح مركز الإشعارات</button></footer> : null}
        </section>
      ) : null}
    </div>
  );
}
