import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check, CheckCircle, Info, Megaphone, MapPin, SuitcaseSimple, UsersThree, WarningCircle, X } from "@phosphor-icons/react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { fetchNotificationPreferences, fetchNotifications, updateNotifications } from "./api";
import type { NotificationPreferences, NotificationSystem, PlatformNotification } from "./types";

const systemLabels: Record<NotificationSystem, string> = { crm: "CRM", marketing: "التسويق", operations: "العمليات", tracking: "التراكينج" };
const systemIcons = { crm: UsersThree, marketing: Megaphone, operations: SuitcaseSimple, tracking: MapPin };
const defaultPreferences: NotificationPreferences = {
  soundEnabled: true,
  toastEnabled: true,
  toastDurationSeconds: 5,
  systemAlerts: { crm: true, marketing: true, operations: true, tracking: true },
};

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

function createAudioContext() {
  const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return AudioContextConstructor ? new AudioContextConstructor() : null;
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
  const [preferences, setPreferences] = useState<NotificationPreferences>(defaultPreferences);
  const [toastItem, setToastItem] = useState<PlatformNotification | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const initializedScopeRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const playNotificationSound = useCallback(async () => {
    if (!preferences.soundEnabled) return;
    const context = audioContextRef.current || createAudioContext();
    if (!context) return;
    audioContextRef.current = context;
    try {
      if (context.state === "suspended") await context.resume();
      const start = context.currentTime;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.48);
      gain.connect(context.destination);
      [720, 960].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, start + index * 0.12);
        oscillator.connect(gain);
        oscillator.start(start + index * 0.12);
        oscillator.stop(start + 0.3 + index * 0.12);
      });
    } catch {
      // Browsers can block sound until the first user interaction.
    }
  }, [preferences.soundEnabled]);

  const showLiveAlert = useCallback((items: PlatformNotification[]) => {
    const eligible = items.filter((item) => preferences.systemAlerts[item.system_code]);
    if (!eligible.length) return;
    void playNotificationSound();
    if (preferences.toastEnabled && !open) setToastItem(eligible[0]);
  }, [open, playNotificationSound, preferences.systemAlerts, preferences.toastEnabled]);

  const load = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    try {
      const result = await fetchNotifications(scope, 12);
      const nextIds = new Set(result.rows.map((row) => row.id));
      if (initializedScopeRef.current === scope) {
        const newlyArrived = result.rows.filter((row) => !knownIdsRef.current.has(row.id) && !row.read_at);
        if (newlyArrived.length) showLiveAlert(newlyArrived);
      } else {
        initializedScopeRef.current = scope;
      }
      knownIdsRef.current = new Set([...knownIdsRef.current, ...nextIds]);
      setRows(result.rows);
      setUnread(result.unread);
    } catch {
      if (!silent) setRows([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [scope, showLiveAlert, user]);

  useEffect(() => {
    if (!user) return;
    void fetchNotificationPreferences().then(setPreferences).catch(() => setPreferences(defaultPreferences));
    const onPreferencesUpdated = (event: Event) => {
      const detail = (event as CustomEvent<NotificationPreferences>).detail;
      if (detail) setPreferences(detail);
    };
    window.addEventListener("mzj:notification-preferences", onPreferencesUpdated);
    return () => window.removeEventListener("mzj:notification-preferences", onPreferencesUpdated);
  }, [user]);

  useEffect(() => {
    const unlockAudio = () => {
      const context = audioContextRef.current || createAudioContext();
      if (!context) return;
      audioContextRef.current = context;
      if (context.state === "suspended") void context.resume().catch(() => undefined);
    };
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    return () => window.removeEventListener("pointerdown", unlockAudio);
  }, []);

  useEffect(() => {
    initializedScopeRef.current = null;
    knownIdsRef.current = new Set();
    setToastItem(null);
  }, [scope, user?.id]);

  useEffect(() => {
    void load(true);
    const interval = window.setInterval(() => void load(true), 5000);
    const refresh = () => { if (document.visibilityState === "visible") void load(true); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (open && panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  useEffect(() => { setOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    if (!toastItem) return;
    toastTimerRef.current = window.setTimeout(() => setToastItem(null), preferences.toastDurationSeconds * 1000);
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, [preferences.toastDurationSeconds, toastItem]);

  async function openItem(item: PlatformNotification) {
    if (!item.read_at) {
      await updateNotifications({ ids: [item.id], read: true }).catch(() => undefined);
      setRows((current) => current.map((row) => row.id === item.id ? { ...row, read_at: new Date().toISOString() } : row));
      setUnread((value) => Math.max(0, value - 1));
    }
    setOpen(false);
    setToastItem(null);
    if (item.action_url) navigate(item.action_url);
  }

  async function markAllRead() {
    await updateNotifications({ system: scope, read: true }).catch(() => undefined);
    setRows((current) => current.map((row) => ({ ...row, read_at: row.read_at || new Date().toISOString() })));
    setUnread(0);
  }

  return (
    <>
      <div className="notification-bell-wrap" ref={panelRef}>
        <button type="button" className={`notification-bell-button ${open ? "active" : ""}`} onClick={() => setOpen((value) => !value)} aria-label="الإشعارات" title="الإشعارات">
          <Bell size={20} weight={unread ? "fill" : "duotone"} />
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
      {toastItem ? (
        <div className="notification-toast-stack" aria-live="assertive">
          <article className="notification-toast-card" data-severity={toastItem.severity}>
            <button type="button" className="notification-toast-main" onClick={() => void openItem(toastItem)}>
              <span className="notification-toast-icon"><NotificationIcon item={toastItem} /></span>
              <span className="notification-toast-copy">
                <strong>{toastItem.title}</strong>
                {toastItem.body ? <small>{toastItem.body}</small> : null}
                <time>{relativeTime(toastItem.created_at)}</time>
              </span>
            </button>
            <button type="button" className="notification-toast-close" onClick={() => setToastItem(null)} aria-label="إغلاق الإشعار"><X size={16} /></button>
            <span className="notification-toast-progress" style={{ animationDuration: `${preferences.toastDurationSeconds}s` }} />
          </article>
        </div>
      ) : null}
    </>
  );
}
