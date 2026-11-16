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
  const [expandPhone, setExpandPhone] = useState<string | null>(null);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const result = await crmFetch<{ ok: boolean; rows: Row[] }>(`/api/crm/expiring-windows?hours=${hours}`);
      setRows(result.rows || []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل القائمة");
    } finally {
      if (!silent) setLoading(false);
    }
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
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر الإرسال");
    } finally {
      setBusyId("");
    }
  }

  async function savePhone(row: Row) {
    const phone = (phones[row.id] || "").trim();
    if (!phone) return;
    setBusyId(row.id); setNotice("");
    try {
      await crmFetch("/api/crm/leads", { method: "PUT", body: JSON.stringify({ id: row.lead_id, phone }) });
      setPhones((current) => { const next = { ...current }; delete next[row.id]; return next; });
      setExpandPhone(null);
      setNotice("تم حفظ رقم العميل");
      await load(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر حفظ الرقم");
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="crm-page crm-expiring-page expiring-r11">
      {/* ─── Toolbar ─── */}
      <div className="exp-toolbar">
        <div className="exp-toolbar-left">
          <TimerIcon size={18} weight="duotone" className="exp-icon" />
          <span className="exp-title">المحادثات التي تنتهي نافذتها</span>
          {rows.length > 0 ? <span className="exp-count">{rows.length}</span> : null}
        </div>
        <div className="exp-toolbar-right">
          <label className="exp-hours-select">
            <span>تنتهي خلال</span>
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              {[3, 6, 12, 24].map((v) => <option key={v} value={v}>{v} ساعة</option>)}
            </select>
          </label>
          <button className="crm-secondary-button" type="button" onClick={() => void load()} disabled={loading}>
            <ArrowClockwise size={16} /> {loading ? "جاري التحديث" : "تحديث"}
          </button>
        </div>
      </div>

      {notice ? (
        <div className="exp-notice">
          {notice}
          <button className="exp-notice-close" onClick={() => setNotice("")}>×</button>
        </div>
      ) : null}

      {/* ─── Empty state ─── */}
      {!rows.length && !loading ? (
        <div className="exp-empty">
          <TimerIcon size={40} weight="duotone" />
          <strong>لا توجد محادثات تنتهي نافذتها خلال {hours} ساعة</strong>
          <span>كل المحادثات ضمن النافذة الزمنية الآمنة</span>
        </div>
      ) : null}

      {/* ─── Table ─── */}
      {rows.length > 0 ? (
        <div className="exp-table-wrap">
          <table className="exp-table">
            <thead>
              <tr>
                <th>العميل</th>
                <th>المنصة</th>
                <th>الحالة</th>
                <th>السيارة</th>
                <th>المندوب</th>
                <th>الوقت المتبقي</th>
                <th>الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const name = row.lead_customer_name || row.customer_name || "عميل";
                const isExpand = expandPhone === row.id;
                return [
                  <tr key={row.id} className={isExpand ? "exp-row-active" : undefined}>
                    <td className="exp-td-name">
                      <span className="exp-customer-name">{name}</span>
                    </td>
                    <td>
                      <span className="exp-platform-chip">{sourceLabel(row.channel_code)}</span>
                    </td>
                    <td>
                      {row.status_label ? <span className="exp-status-chip">{row.status_label}</span> : <span className="exp-muted">—</span>}
                    </td>
                    <td>
                      {row.car_name ? <span className="exp-car">{row.car_name}</span> : <span className="exp-muted">—</span>}
                    </td>
                    <td>
                      {row.assigned_name ? <span className="exp-assigned">{row.assigned_name}</span> : <span className="exp-muted">غير محدد</span>}
                    </td>
                    <td>
                      <MessagingWindowBadge expiresAt={row.messaging_window.expiresAt} windowHours={row.messaging_window.windowHours} />
                    </td>
                    <td>
                      <div className="exp-actions">
                        {row.has_phone ? (
                          <span className="exp-phone-num"><Phone size={13} /> {row.phone}</span>
                        ) : (
                          <button
                            type="button"
                            className={`exp-action-btn${isExpand ? " active" : ""}`}
                            disabled={busyId === row.id}
                            onClick={() => setExpandPhone(isExpand ? null : row.id)}
                          >
                            <Phone size={14} /> رقم
                          </button>
                        )}
                        <Link className="exp-action-btn primary" to={`/crm?lead=${encodeURIComponent(row.lead_id)}`}>
                          <ChatCircleDots size={14} /> فتح
                        </Link>
                      </div>
                    </td>
                  </tr>,
                  isExpand ? (
                    <tr key={`${row.id}-phone`} className="exp-phone-row">
                      <td colSpan={7}>
                        <div className="exp-phone-expand">
                          <button type="button" className="crm-secondary-button" disabled={busyId === row.id} onClick={() => void askPhone(row)}>
                            <PaperPlaneTilt size={15} /> اطلب رقم العميل
                          </button>
                          <span className="exp-phone-sep">أو</span>
                          <input
                            dir="ltr" inputMode="tel" placeholder="سجّل رقم العميل يدوياً"
                            className="exp-phone-input"
                            value={phones[row.id] || ""}
                            onChange={(e) => setPhones((p) => ({ ...p, [row.id]: e.target.value }))}
                          />
                          <button
                            type="button" className="crm-primary-button"
                            disabled={busyId === row.id || !(phones[row.id] || "").trim()}
                            onClick={() => void savePhone(row)}
                          >
                            <FloppyDisk size={15} /> حفظ
                          </button>
                          <button type="button" className="crm-secondary-button" onClick={() => setExpandPhone(null)}>إلغاء</button>
                        </div>
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
