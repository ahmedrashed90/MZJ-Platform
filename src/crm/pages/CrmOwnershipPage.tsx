import { useEffect, useState } from "react";
import { ArrowClockwise, ArrowRight, ClockCounterClockwise, UserSwitch, UsersThree } from "@phosphor-icons/react";
import { crmFetch, formatDate } from "../api";

type OwnershipMode = "all" | "transferred";

export function CrmOwnershipPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [mode, setMode] = useState<OwnershipMode>("all");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setNotice("");
    try {
      const result = await crmFetch<{ ok: boolean; rows: any[] }>(`/api/crm/ownership${mode === "transferred" ? "?mode=transferred" : ""}`);
      setRows(result.rows || []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل سجل الملكية");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [mode]);

  const uniqueCustomers = new Set(rows.map((row) => row.lead_id || row.contact_id).filter(Boolean)).size;

  return (
    <div className="crm-page crm-ownership-page">
      <header className="crm-page-head crm-ownership-head">
        <div><span className="crm-eyebrow">CRM / سجل التحويلات</span><h1>سجل ملكية العملاء</h1></div>
        <button className="crm-secondary-button" disabled={loading} onClick={() => void load()}><ArrowClockwise size={18} />{loading ? "جاري التحديث..." : "تحديث"}</button>
      </header>

      <div className="crm-department-tabs crm-ownership-tabs centered">
        <button className={mode === "all" ? "active" : ""} onClick={() => setMode("all")}><ClockCounterClockwise size={18} />كل الحركات</button>
        <button className={mode === "transferred" ? "active" : ""} onClick={() => setMode("transferred")}><UserSwitch size={18} />عملاء تم نقلهم</button>
      </div>

      <section className="crm-ownership-summary">
        <article><UserSwitch size={24} weight="duotone" /><span>الحركات المعروضة</span><strong>{rows.length.toLocaleString("ar-SA")}</strong></article>
        <article><UsersThree size={24} weight="duotone" /><span>العملاء</span><strong>{uniqueCustomers.toLocaleString("ar-SA")}</strong></article>
      </section>

      {notice ? <div className="crm-inline-notice">{notice}</div> : null}
      {loading ? <div className="crm-loading-panel">جاري تحميل سجل الملكية...</div> : null}

      {!loading ? <div className="crm-ownership-list">
        {rows.map((row) => (
          <article className="crm-panel crm-ownership-event" key={row.id}>
            <div className="crm-ownership-icon"><UserSwitch size={28} weight="duotone" /></div>
            <div className="crm-ownership-content">
              <header><div><strong>{row.customer_name || "عميل"}</strong><small>{row.phone || row.phone_normalized || "بدون رقم"}</small></div><time>{formatDate(row.created_at)}</time></header>
              <div className="crm-ownership-route">
                <span><small>من</small><b>{row.previous_assigned_name || "غير موزع"}</b></span>
                <ArrowRight size={20} />
                <span><small>إلى</small><b>{row.new_assigned_name || "غير موزع"}</b></span>
              </div>
              <div className="crm-ownership-meta">
                <span>السبب <b>{row.reason || "غير محدد"}</b></span>
                <span>نفذ النقل <b>{row.actor_name || "النظام"}</b></span>
                <span>المسؤول الحالي <b>{row.current_assigned_name || "غير موزع"}</b></span>
                {(row.previous_department_name || row.new_department_name) ? <span>القسم <b>{row.previous_department_name || row.previous_department_code || "—"} ← {row.new_department_name || row.new_department_code || "—"}</b></span> : null}
                {(row.previous_branch_name || row.new_branch_name) ? <span>الفرع <b>{row.previous_branch_name || row.previous_branch_code || "—"} ← {row.new_branch_name || row.new_branch_code || "—"}</b></span> : null}
              </div>
            </div>
          </article>
        ))}
        {!rows.length ? <div className="crm-empty-state panel">لا توجد حركات ملكية بعد.</div> : null}
      </div> : null}
    </div>
  );
}
