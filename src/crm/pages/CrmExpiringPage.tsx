import { useEffect, useState } from "react";
import { ArrowClockwise, ChatCircleDots, FloppyDisk, PaperPlaneTilt, Phone, TimerIcon } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { crmFetch } from "../api";
import { sourceLabel } from "../sourceCatalog";
import { MessagingWindowBadge } from "../components/MessagingWindowBadge";

type Row = {
  id: string; lead_id: string; channel_code: string; customer_name?: string | null; lead_customer_name?: string | null;
  phone?: string | null; has_phone: boolean; status_label?: string | null; car_name?: string | null; assigned_name?: string | null;
  messaging_window: { expiresAt: string | null; windowHours: number };
};

export function CrmExpiringPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [hours, setHours] = useState(12);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [phones, setPhones] = useState<Record<string, string>>({});

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const result = await crmFetch<{ ok: boolean; rows: Row[] }>(`/api/crm/expiring-windows?hours=${hours}`);
      setRows(result.rows || []);
    } catch (error) { setNotice(error instanceof Error ? error.message : "تعذر تحميل القائمة"); }
    finally { if (!silent) setLoading(false); }
  }
  useEffect(() => { void load(); }, [hours]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(true); }, 60_000);
    return () => window.clearInterval(timer);
  }, [hours]);

  async function askPhone(row: Row) {
    setBusyId(row.id); setNotice("");
    try {
      await crmFetch("/api/crm/expiring-windows", { method: "POST", body: JSON.stringify({ action: "ask_phone", conversationId: row.id }) });
      setNotice(`تم إرسال طلب الرقم إلى ${row.lead_customer_name || row.customer_name || "العميل"}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "تعذر الإرسال"); }
    finally { setBusyId(""); }
  }

  async function savePhone(row: Row) {
    const phone = (phones[row.id] || "").trim();
    if (!phone) return;
    setBusyId(row.id); setNotice("");
    try {
      await crmFetch("/api/crm/leads", { method: "PUT", body: JSON.stringify({ id: row.lead_id, phone }) });
      setPhones((current) => { const next = { ...current }; delete next[row.id]; return next; });
      setNotice("تم حفظ رقم العميل");
      await load(true);
    } catch (error) { setNotice(error instanceof Error ? error.message : "تعذر حفظ الرقم"); }
    finally { setBusyId(""); }
  }

  return (
    <div className="crm-page crm-expiring-page">
      <div className="page-top-actions">
        <label className="crm-expiring-hours">تنتهي خلال
          <select value={hours} onChange={(event) => setHours(Number(event.target.value))}>
            {[3, 6, 12, 24].map((value) => <option key={value} value={value}>{value} ساعة</option>)}
          </select>
        </label>
        <button className="crm-secondary-button" type="button" onClick={() => void load()} disabled={loading}><ArrowClockwise size={18} />{loading ? "جاري التحديث" : "تحديث"}</button>
      </div>
      {notice ? <div className="crm-inline-notice">{notice}</div> : null}
      {!rows.length && !loading ? <div className="crm-empty-state"><TimerIcon size={36} weight="duotone" /><strong>لا توجد محادثات تنتهي نافذتها خلال {hours} ساعة</strong></div> : null}
      <div className="crm-expiring-list">
        {rows.map((row) => {
          const name = row.lead_customer_name || row.customer_name || "عميل";
          return (
            <article className="crm-expiring-card" key={row.id}>
              <header>
                <div><strong>{name}</strong><small>{sourceLabel(row.channel_code)}{row.status_label ? ` • ${row.status_label}` : ""}{row.car_name ? ` • ${row.car_name}` : ""}</small></div>
                <MessagingWindowBadge expiresAt={row.messaging_window.expiresAt} windowHours={row.messaging_window.windowHours} />
              </header>
              <footer>
                {row.has_phone
                  ? <span className="crm-expiring-phone"><Phone size={15} /> {row.phone}</span>
                  : <div className="crm-expiring-phone-form">
                      <button type="button" className="crm-secondary-button" disabled={busyId === row.id} onClick={() => void askPhone(row)}><PaperPlaneTilt size={16} />اطلب الرقم</button>
                      <input dir="ltr" inputMode="tel" placeholder="سجّل رقم العميل" value={phones[row.id] || ""} onChange={(event) => setPhones((current) => ({ ...current, [row.id]: event.target.value }))} />
                      <button type="button" className="crm-primary-button" disabled={busyId === row.id || !(phones[row.id] || "").trim()} onClick={() => void savePhone(row)}><FloppyDisk size={16} />حفظ</button>
                    </div>}
                <Link className="crm-secondary-button" to={`/crm?lead=${encodeURIComponent(row.lead_id)}`}><ChatCircleDots size={16} />فتح المحادثة</Link>
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}
