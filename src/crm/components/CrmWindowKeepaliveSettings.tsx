import { useEffect, useState } from "react";
import { FloppyDisk, Timer } from "@phosphor-icons/react";
import { crmFetch, formatDate } from "../api";

type Settings = {
  enabled: boolean;
  channels: Record<"facebook" | "instagram" | "tiktok" | "whatsapp", boolean>;
  leadMinutes: number;
  maxCycles: number;
  humanQuietMinutes: number;
  messages: { default: string; cash: string; finance: string; service: string };
};
type LogRow = { id: string; customer_name?: string | null; channel_code?: string | null; status: string; error_message?: string | null; created_at: string };

const channelLabels: Array<[keyof Settings["channels"], string]> = [["facebook", "فيسبوك"], ["instagram", "إنستجرام"], ["tiktok", "تيك توك"], ["whatsapp", "مرسال / واتساب"]];
const messageLabels: Array<[keyof Settings["messages"], string]> = [["default", "الرسالة الافتراضية"], ["cash", "مبيعات الكاش"], ["finance", "مبيعات التمويل"], ["service", "خدمة العملاء"]];
const statusLabel: Record<string, string> = { sent: "تم الإرسال", failed: "فشل", pending: "قيد الإرسال" };

export function CrmWindowKeepaliveSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [stats, setStats] = useState({ sent_24h: 0, failed_24h: 0 });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  async function load() {
    try {
      const result = await crmFetch<{ settings: Settings; log: LogRow[]; stats: { sent_24h: number; failed_24h: number } }>("/api/crm/window-keepalive");
      setSettings(result.settings); setLog(result.log || []); setStats(result.stats || { sent_24h: 0, failed_24h: 0 });
    } catch (error) { setNotice(error instanceof Error ? error.message : "تعذر تحميل الإعدادات"); }
  }
  useEffect(() => { void load(); }, []);

  async function save() {
    if (!settings) return;
    setSaving(true); setNotice("");
    try {
      const result = await crmFetch<{ settings: Settings }>("/api/crm/window-keepalive", { method: "PUT", body: JSON.stringify({ settings }) });
      setSettings(result.settings); setNotice("تم حفظ الإعدادات");
    } catch (error) { setNotice(error instanceof Error ? error.message : "تعذر الحفظ"); }
    finally { setSaving(false); }
  }

  if (!settings) return <div className="crm-empty-state">{notice || "جاري تحميل الإعدادات..."}</div>;
  const patch = (next: Partial<Settings>) => setSettings({ ...settings, ...next });

  return (
    <div className="crm-keepalive-settings">
      <section className="crm-panel settings-card full">
        <div className="settings-card-title"><div><Timer size={22} weight="duotone" /><h2>إبقاء المحادثات مفتوحة</h2></div></div>
        <p>قبل انتهاء نافذة الرد بوقت قصير، يرسل النظام رسالة واحدة تشجع العميل على الرد. رد العميل وحده هو الذي يجدد النافذة 24 ساعة. تُرسل الرسالة داخل النافذة فقط، وتتوقف بعد عدد الدورات المحدد، وتُلغى إذا رد المندوب مؤخرًا.</p>
        <label className="crm-keepalive-toggle"><input type="checkbox" checked={settings.enabled} onChange={(event) => patch({ enabled: event.target.checked })} /> <b>تشغيل الإرسال التلقائي</b></label>
        <div className="crm-keepalive-channels">
          {channelLabels.map(([key, label]) => <label key={key}><input type="checkbox" checked={settings.channels[key]} onChange={(event) => patch({ channels: { ...settings.channels, [key]: event.target.checked } })} /> {label}</label>)}
        </div>
        <div className="crm-form-grid">
          <label><span>الإرسال قبل انتهاء النافذة بـ (دقيقة)</span><input type="number" min={15} max={360} value={settings.leadMinutes} onChange={(event) => patch({ leadMinutes: Number(event.target.value) })} /></label>
          <label><span>أقصى عدد دورات بدون رد من المندوب</span><input type="number" min={1} max={10} value={settings.maxCycles} onChange={(event) => patch({ maxCycles: Number(event.target.value) })} /></label>
          <label><span>عدم الإرسال إذا ردّ المندوب خلال (دقيقة)</span><input type="number" min={0} max={1440} value={settings.humanQuietMinutes} onChange={(event) => patch({ humanQuietMinutes: Number(event.target.value) })} /></label>
        </div>
        <div className="crm-form-grid">
          {messageLabels.map(([key, label]) => <label key={key}><span>{label}</span><textarea rows={3} maxLength={900} value={settings.messages[key]} onChange={(event) => patch({ messages: { ...settings.messages, [key]: event.target.value } })} /></label>)}
        </div>
        {notice ? <div className="crm-inline-notice">{notice}</div> : null}
        <button type="button" className="crm-primary-button" disabled={saving} onClick={() => void save()}><FloppyDisk size={18} />{saving ? "جاري الحفظ..." : "حفظ الإعدادات"}</button>
      </section>
      <section className="crm-panel settings-card full">
        <div className="settings-card-title"><div><h2>سجل الرسائل التلقائية</h2></div><small>آخر 24 ساعة: {stats.sent_24h} مرسلة • {stats.failed_24h} فاشلة</small></div>
        {!log.length ? <div className="crm-empty-state">لا توجد رسائل مرسلة بعد.</div> : (
          <div className="crm-keepalive-log">
            {log.map((row) => <div key={row.id}><b>{row.customer_name || "عميل"}</b><span>{row.channel_code}</span><span className={`crm-keepalive-status ${row.status}`}>{statusLabel[row.status] || row.status}</span><small>{formatDate(row.created_at)}</small>{row.error_message ? <small className="err">{row.error_message}</small> : null}</div>)}
          </div>
        )}
      </section>
    </div>
  );
}
