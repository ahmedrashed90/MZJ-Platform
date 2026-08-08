import { useCallback, useEffect, useState } from "react";
import { Bell, Check, CheckCircle, Info, Megaphone, MapPin, SuitcaseSimple, UsersThree, WarningCircle } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { fetchNotifications, updateNotifications } from "./api";
import type { NotificationSystem, PlatformNotification } from "./types";
import { notificationResponsibleName } from "./presentation";

const systems: Array<{ code: "all" | NotificationSystem; label: string }> = [
  { code: "all", label: "كل المنصة" }, { code: "crm", label: "CRM" }, { code: "marketing", label: "التسويق" }, { code: "operations", label: "العمليات" }, { code: "tracking", label: "التراكينج" },
];
const labels: Record<NotificationSystem, string> = { crm: "CRM", marketing: "التسويق", operations: "العمليات", tracking: "التراكينج" };
const icons = { crm: UsersThree, marketing: Megaphone, operations: SuitcaseSimple, tracking: MapPin };

function formatDate(value: string) { return new Intl.DateTimeFormat("ar-SA-u-nu-latn", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(new Date(value)); }
function RowIcon({ item }: { item: PlatformNotification }) { const Icon = item.severity === "warning" || item.severity === "danger" ? WarningCircle : item.severity === "success" ? CheckCircle : icons[item.system_code] || Info; return <Icon size={22} weight="duotone" />; }

export function NotificationsCenterPage() {
  const navigate = useNavigate();
  const [system, setSystem] = useState<"all" | NotificationSystem>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [rows, setRows] = useState<PlatformNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const result = await fetchNotifications(system, 100, unreadOnly); setRows(result.rows); setUnread(result.unread); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل الإشعارات"); }
    finally { setLoading(false); }
  }, [system, unreadOnly]);
  useEffect(() => { void load(); const interval = window.setInterval(() => void load(), 15000); return () => window.clearInterval(interval); }, [load]);

  async function markAll() { await updateNotifications({ system, read: true }); await load(); }
  async function openItem(item: PlatformNotification) { if (!item.read_at) await updateNotifications({ ids: [item.id], read: true }).catch(() => undefined); if (item.action_url) navigate(item.action_url); else await load(); }

  return (
    <div className="module-page notifications-center-page">
      <div className="notifications-unread-summary page-top-actions"><strong>{unread}</strong><span>غير مقروء</span></div>
      <section className="notifications-center-card">
        <div className="notifications-center-toolbar">
          <div className="notifications-system-filter">{systems.map((item) => <button type="button" key={item.code} className={system === item.code ? "active" : ""} onClick={() => setSystem(item.code)}>{item.label}</button>)}</div>
          <div className="notifications-center-actions"><label><input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} />غير المقروء فقط</label>{unread ? <button type="button" onClick={() => void markAll()}><Check size={17} />تعيين الكل كمقروء</button> : null}</div>
        </div>
        {error ? <div className="connection-banner"><WarningCircle size={20} /><span>{error}</span><button type="button" onClick={() => void load()}>إعادة المحاولة</button></div> : null}
        <div className="notifications-center-list">
          {loading ? <div className="notification-empty">جاري تحميل الإشعارات...</div> : null}
          {!loading && !rows.length ? <div className="notification-empty"><Bell size={32} weight="duotone" /><span>لا توجد إشعارات مطابقة</span></div> : null}
          {!loading ? rows.map((item) => (
            <button type="button" key={item.id} className={`notifications-center-row ${item.read_at ? "read" : "unread"}`} data-severity={item.severity} onClick={() => void openItem(item)}>
              <span className="notifications-center-icon"><RowIcon item={item} /></span>
              <span className="notifications-center-copy"><span><b>{labels[item.system_code]}</b>{!item.read_at ? <i>جديد</i> : null}</span><strong>{item.title}</strong>{item.body ? <small>{item.body}</small> : null}<span className="notification-responsible"><b>المسؤول:</b> {notificationResponsibleName(item)}</span></span>
              <time>{formatDate(item.created_at)}</time>
            </button>
          )) : null}
        </div>
      </section>
    </div>
  );
}
