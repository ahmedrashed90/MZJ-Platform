import { useEffect, useState } from "react";
import { Bell, CheckCircle, Clock, FloppyDisk, Megaphone, MapPin, SuitcaseSimple, UsersThree, WarningCircle } from "@phosphor-icons/react";
import { fetchNotificationPreferences, saveNotificationPreferences } from "./api";
import type { NotificationPreferences, NotificationSystem } from "./types";

const defaults: NotificationPreferences = {
  soundEnabled: true,
  toastEnabled: true,
  toastDurationSeconds: 5,
  systemAlerts: { crm: true, marketing: true, operations: true, tracking: true },
};

const systems: Array<{ code: NotificationSystem; label: string; description: string; icon: typeof Bell }> = [
  { code: "crm", label: "CRM", description: "العملاء والرسائل والحالات والتحويلات", icon: UsersThree },
  { code: "marketing", label: "التسويق", description: "الحملات والأجندات والتكليفات ونسب التقدم", icon: Megaphone },
  { code: "operations", label: "العمليات", description: "الطلبات والسيارات والموافقات وحركات المخزون", icon: SuitcaseSimple },
  { code: "tracking", label: "التراكينج", description: "إنشاء الطلب والمراحل والتسليم والأرشفة", icon: MapPin },
];

function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} className={`notification-setting-toggle ${checked ? "active" : ""}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function NotificationSettingsPanel() {
  const [preferences, setPreferences] = useState<NotificationPreferences>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetchNotificationPreferences()
      .then((result) => { if (active) setPreferences(result); })
      .catch((reason) => { if (active) setError(String(reason?.message || "تعذر تحميل إعدادات الإشعارات")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function setSystem(code: NotificationSystem, enabled: boolean) {
    setPreferences((current) => ({ ...current, systemAlerts: { ...current.systemAlerts, [code]: enabled } }));
  }

  async function save() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const saved = await saveNotificationPreferences(preferences);
      setPreferences(saved);
      setMessage("تم حفظ إعدادات الإشعارات");
      window.dispatchEvent(new CustomEvent<NotificationPreferences>("mzj:notification-preferences", { detail: saved }));
    } catch (reason: any) {
      setError(String(reason?.message || "تعذر حفظ إعدادات الإشعارات"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="notification-settings-loading"><Bell size={25} weight="duotone" /><span>جاري تحميل إعدادات الإشعارات...</span></div>;

  return (
    <div className="notification-settings-panel">
      {error ? <div className="notification-settings-message error"><WarningCircle size={18} />{error}</div> : null}
      {message ? <div className="notification-settings-message success"><CheckCircle size={18} />{message}</div> : null}

      <section className="notification-settings-card notification-settings-intro">
        <span className="notification-settings-card-icon"><Bell size={24} weight="duotone" /></span>
        <div><h3>تنبيه الإشعار الجديد</h3><p>الإشعارات تظل محفوظة في الجرس ومركز الإشعارات. الإعدادات التالية تتحكم في الصوت والكارت المؤقت فقط.</p></div>
      </section>

      <div className="notification-settings-grid">
        <section className="notification-settings-card">
          <div className="notification-settings-card-head">
            <div><strong>صوت الإشعار</strong><small>تشغيل صوت تنبيه عند وصول إشعار جديد.</small></div>
            <Toggle checked={preferences.soundEnabled} onChange={(soundEnabled) => setPreferences((current) => ({ ...current, soundEnabled }))} />
          </div>
        </section>
        <section className="notification-settings-card">
          <div className="notification-settings-card-head">
            <div><strong>الكارت المؤقت</strong><small>إظهار كارت صغير داخل الصفحة عند وصول إشعار جديد.</small></div>
            <Toggle checked={preferences.toastEnabled} onChange={(toastEnabled) => setPreferences((current) => ({ ...current, toastEnabled }))} />
          </div>
        </section>
      </div>

      <section className="notification-settings-card">
        <div className="notification-settings-section-title"><Clock size={20} weight="duotone" /><div><strong>مدة ظهور الكارت</strong><small>المدة الافتراضية والمحددة حاليًا هي 5 ثوانٍ.</small></div></div>
        <div className="notification-duration-options">
          {([3, 5, 8, 10] as const).map((duration) => (
            <button type="button" key={duration} disabled={!preferences.toastEnabled} className={preferences.toastDurationSeconds === duration ? "active" : ""} onClick={() => setPreferences((current) => ({ ...current, toastDurationSeconds: duration }))}>{duration} ثوانٍ</button>
          ))}
        </div>
      </section>

      <section className="notification-settings-card">
        <div className="notification-settings-section-title"><Bell size={20} weight="duotone" /><div><strong>تنبيهات الأنظمة</strong><small>إيقاف نظام هنا يمنع الصوت والكارت المؤقت لهذا النظام فقط، مع بقاء الإشعارات محفوظة في الجرس.</small></div></div>
        <div className="notification-system-settings">
          {systems.map(({ code, label, description, icon: Icon }) => (
            <div className="notification-system-setting" key={code}>
              <span><Icon size={21} weight="duotone" /></span>
              <div><strong>{label}</strong><small>{description}</small></div>
              <Toggle checked={preferences.systemAlerts[code]} onChange={(enabled) => setSystem(code, enabled)} />
            </div>
          ))}
        </div>
      </section>

      <div className="notification-settings-save">
        <button type="button" className="primary-button" disabled={saving} onClick={() => void save()}><FloppyDisk size={18} />{saving ? "جاري الحفظ..." : "حفظ إعدادات الإشعارات"}</button>
      </div>
    </div>
  );
}
