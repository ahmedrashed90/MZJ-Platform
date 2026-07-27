import { useEffect, useState } from "react";
import { ArrowClockwise, CheckCircle, FloppyDisk, Robot, Trash, XCircle } from "@phosphor-icons/react";
import { crmFetch, formatDate, queryString } from "../api";

const defaults = {
  enabled: false,
  firstDelaySeconds: 240,
  betweenRepliesSeconds: 120,
  maxBotMessages: 2,
  escalateToBranchManager: true,
  escalateToSalesManager: true,
  salesManagerDelaySeconds: 300,
  salesManagerName: "",
  salesManagerPhone: "",
  fallbackPhone: "",
  businessHoursOnly: false,
  businessStart: "09:00",
  businessEnd: "22:00",
  stopKeywords: ["إلغاء", "خلاص", "لا تتواصلون"],
  replies: [
    "أهلًا بك، تم استلام رسالتك وجاري تحويل طلبك للمختص. يسعدنا خدمتك.",
    "حتى نساعدك بشكل أسرع، هل استفسارك عن الشراء كاش أم تمويل؟",
    "تم تصعيد طلبك للمسؤول لضمان الرد عليك في أقرب وقت، ونقدّر انتظارك.",
  ],
  branchEscalationTemplate: "",
  socialEnabled: false,
  socialPlatforms: ["instagram", "facebook", "tiktok"],
};

function fromApi(raw: any) {
  if (!raw) return defaults;
  return {
    enabled: Boolean(raw.enabled), firstDelaySeconds: raw.first_delay_seconds ?? 240, betweenRepliesSeconds: raw.between_replies_seconds ?? 120,
    maxBotMessages: raw.max_bot_messages ?? 2, escalateToBranchManager: raw.escalate_to_branch_manager !== false,
    escalateToSalesManager: raw.escalate_to_sales_manager !== false, salesManagerDelaySeconds: raw.sales_manager_delay_seconds ?? 300,
    salesManagerName: raw.sales_manager_name || "", salesManagerPhone: raw.sales_manager_phone || "", fallbackPhone: raw.fallback_phone || "",
    businessHoursOnly: Boolean(raw.business_hours_only), businessStart: String(raw.business_start || "09:00").slice(0,5), businessEnd: String(raw.business_end || "22:00").slice(0,5),
    stopKeywords: raw.stop_keywords || defaults.stopKeywords, replies: raw.replies || defaults.replies, branchEscalationTemplate: raw.branch_escalation_template || "",
    socialEnabled: Boolean(raw.social_enabled), socialPlatforms: raw.social_platforms || defaults.socialPlatforms,
  };
}

export function CrmInboxAgentPage() {
  const [tab, setTab] = useState<"general" | "replies" | "logs">("general");
  const [settings, setSettings] = useState(defaults);
  const [managers, setManagers] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const logsPageSize = 100;
  const [logsPage, setLogsPage] = useState(0);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsToday, setLogsToday] = useState(0);
  const [manager, setManager] = useState({ scopeCode: "", managerName: "", whatsappPhone: "", isActive: true });
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { void load(); }, [logsPage]);

  async function load() {
    try {
      const result = await crmFetch<{ ok: boolean; settings: any; managers: any[]; logs: any[]; logsTotal: number; logsToday: number }>(`/api/crm/inbox-agent${queryString({ limit: logsPageSize, offset: logsPage * logsPageSize })}`);
      setSettings(fromApi(result.settings)); setManagers(result.managers || []); setLogs(result.logs || []); setLogsTotal(result.logsTotal || 0); setLogsToday(result.logsToday || 0);
    } catch (error) { setNotice(error instanceof Error ? error.message : "فشل تحميل البيانات"); }
  }

  function set(key: keyof typeof defaults, value: any) { setSettings((current) => ({ ...current, [key]: value })); }
  async function saveSettings() {
    setSaving(true);
    try { await crmFetch("/api/crm/inbox-agent", { method: "PUT", body: JSON.stringify(settings) }); setNotice(settings.enabled ? "تم تشغيل الوكيل وحفظ الإعدادات." : "تم إيقاف الوكيل وحفظ الإعدادات."); await load(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "فشل حفظ الإعدادات"); }
    finally { setSaving(false); }
  }

  async function saveManager() {
    try { await crmFetch("/api/crm/inbox-agent", { method: "POST", body: JSON.stringify({ section: "manager", ...manager }) }); setNotice("تم حفظ مدير التصعيد."); setManager({ scopeCode: "", managerName: "", whatsappPhone: "", isActive: true }); await load(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "تعذر حفظ مدير التصعيد"); }
  }

  async function deleteManager(scopeCode: string) {
    if (!confirm("مسح إعداد التصعيد؟")) return;
    try { await crmFetch("/api/crm/inbox-agent", { method: "DELETE", body: JSON.stringify({ scopeCode }) }); setNotice("تم مسح إعداد المدير."); await load(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "تعذر مسح إعداد المدير"); }
  }



  return (
    <div className="crm-page inbox-agent-page">
      <header className="crm-page-head"><div><h1>وكيل صندوق الوارد</h1><p>وكيل مركزي داخل المنصة يراقب تأخر الرد البشري على كل القنوات المفعلة، ويرد ويصعّد وفق الإعدادات.</p></div><button className="crm-secondary-button" onClick={() => void load()}><ArrowClockwise size={18} />تحديث</button></header>
      <div className="crm-agent-status-grid"><div className={`crm-agent-status ${settings.enabled ? "on" : "off"}`}><Robot size={30} weight="duotone" /><span>حالة الوكيل</span><strong>{settings.enabled ? "مفعل" : "متوقف"}</strong></div><div><span>أول رد بعد</span><strong>{settings.firstDelaySeconds}</strong><small>بالثواني</small></div><div><span>مديرو التصعيد</span><strong>{managers.filter((m) => m.is_active).length}</strong><small>مدير مفعّل</small></div><div><span>إجراءات اليوم</span><strong>{logsToday}</strong><small>ردود وتصعيدات</small></div><div><span>وكيل السوشيال</span><strong>{settings.socialEnabled ? "مفعل" : "متوقف"}</strong><small>{settings.socialPlatforms.join("، ") || "لا توجد منصات"}</small></div></div>
      {notice ? <div className="crm-inline-notice">{notice}</div> : null}
      <div className="crm-department-tabs"><button className={tab === "general" ? "active" : ""} onClick={() => setTab("general")}>الإعدادات العامة</button><button className={tab === "replies" ? "active" : ""} onClick={() => setTab("replies")}>الردود</button><button className={tab === "logs" ? "active" : ""} onClick={() => setTab("logs")}>السجل</button></div>

      {tab === "general" ? <div className="crm-settings-grid">
        <section className="crm-panel settings-card"><h2>تشغيل / إيقاف</h2><label className="crm-switch-row"><input type="checkbox" checked={settings.enabled} onChange={(event) => set("enabled", event.target.checked)} /><span>تفعيل وكيل صندوق الوارد</span></label><label className="crm-switch-row"><input type="checkbox" checked={settings.escalateToBranchManager} onChange={(event) => set("escalateToBranchManager", event.target.checked)} /><span>تفعيل التصعيد لمدير الفرع</span></label><label className="crm-switch-row"><input type="checkbox" checked={settings.escalateToSalesManager} onChange={(event) => set("escalateToSalesManager", event.target.checked)} /><span>تفعيل التصعيد لمدير المبيعات</span></label><label className="crm-switch-row"><input type="checkbox" checked={settings.businessHoursOnly} onChange={(event) => set("businessHoursOnly", event.target.checked)} /><span>العمل داخل أوقات العمل فقط</span></label></section>
        <section className="crm-panel settings-card"><h2>التوقيت والحدود</h2><div className="crm-form-grid"><label><span>أول رد بعد - بالثواني</span><input type="number" value={settings.firstDelaySeconds} onChange={(e) => set("firstDelaySeconds", Number(e.target.value))} /></label><label><span>الفاصل بين الردود - بالثواني</span><input type="number" value={settings.betweenRepliesSeconds} onChange={(e) => set("betweenRepliesSeconds", Number(e.target.value))} /></label><label><span>أقصى عدد ردود تلقائية</span><input type="number" value={settings.maxBotMessages} onChange={(e) => set("maxBotMessages", Number(e.target.value))} /></label><label><span>تصعيد مدير المبيعات بعد مدير الفرع - بالثواني</span><input type="number" value={settings.salesManagerDelaySeconds} onChange={(e) => set("salesManagerDelaySeconds", Number(e.target.value))} /></label><label><span>بداية وقت العمل</span><input type="time" value={settings.businessStart} onChange={(e) => set("businessStart", e.target.value)} /></label><label><span>نهاية وقت العمل</span><input type="time" value={settings.businessEnd} onChange={(e) => set("businessEnd", e.target.value)} /></label></div></section>
        <section className="crm-panel settings-card"><h2>مدير المبيعات</h2><div className="crm-form-grid"><label><span>اسم مدير المبيعات</span><input value={settings.salesManagerName} onChange={(e) => set("salesManagerName", e.target.value)} /></label><label><span>رقم واتساب مدير المبيعات</span><input value={settings.salesManagerPhone} onChange={(e) => set("salesManagerPhone", e.target.value)} /></label><label className="crm-field-wide"><span>رقم احتياطي عام عند عدم وجود مدير</span><input value={settings.fallbackPhone} onChange={(e) => set("fallbackPhone", e.target.value)} /></label></div></section>
        <section className="crm-panel settings-card"><h2>القنوات الاجتماعية</h2><label className="crm-switch-row"><input type="checkbox" checked={settings.socialEnabled} onChange={(event) => set("socialEnabled", event.target.checked)} /><span>تفعيل الوكيل للقنوات الاجتماعية</span></label><div className="crm-check-grid">{[{key:"instagram",label:"إنستجرام"},{key:"facebook",label:"فيسبوك"},{key:"tiktok",label:"تيك توك"}].map((platform) => <label key={platform.key}><input type="checkbox" checked={settings.socialPlatforms.includes(platform.key)} onChange={() => set("socialPlatforms", settings.socialPlatforms.includes(platform.key) ? settings.socialPlatforms.filter((item) => item !== platform.key) : [...settings.socialPlatforms, platform.key])} />{platform.label}</label>)}</div><p className="crm-help-text">لا يوجد Worker منفصل للوكيل. المنصة المركزية تبدأ العداد وتقرر الرد أو التصعيد، والـWorker الخاص بكل قناة ينفذ الإرسال فقط.</p></section>
        <section className="crm-panel settings-card full"><h2>مديرو التصعيد</h2><div className="crm-manager-form"><select value={manager.scopeCode} onChange={(e) => setManager((current) => ({ ...current, scopeCode: e.target.value }))}><option value="">القسم / الفرع</option><option value="cash_sales">مبيعات الكاش - عام</option><option value="hall">فرع الصالة</option><option value="qadisiyah">فرع القادسية</option><option value="multaqa">فرع الملتقى</option><option value="finance_sales">مبيعات التمويل</option><option value="online">فرع الأونلاين</option><option value="customer_service">خدمة العملاء</option><option value="call_center">الكول سنتر</option><option value="__unassigned__">قبل اختيار الخدمة</option></select><input placeholder="اسم المدير" value={manager.managerName} onChange={(e) => setManager((current) => ({ ...current, managerName: e.target.value }))} /><input placeholder="رقم واتساب المدير" value={manager.whatsappPhone} onChange={(e) => setManager((current) => ({ ...current, whatsappPhone: e.target.value }))} /><button className="crm-primary-button" onClick={() => void saveManager()}>إضافة / تحديث</button></div><div className="crm-table-shell compact"><table className="crm-table"><thead><tr><th>الفرع / القسم</th><th>اسم المدير</th><th>رقم الواتساب</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{managers.map((row) => <tr key={row.id}><td>{row.scope_code}</td><td>{row.manager_name}</td><td>{row.whatsapp_phone}</td><td>{row.is_active ? "مفعل" : "متوقف"}</td><td><button className="crm-row-delete" onClick={() => void deleteManager(row.scope_code)}><Trash size={16} />مسح</button></td></tr>)}{!managers.length ? <tr><td colSpan={5}><div className="crm-empty-state">لا توجد إعدادات مديرين بعد.</div></td></tr> : null}</tbody></table></div></section>
        <div className="crm-settings-save"><button className="crm-primary-button" disabled={saving} onClick={() => void saveSettings()}><FloppyDisk size={18} />{saving ? "جاري الحفظ..." : "حفظ الإعدادات"}</button></div>
      </div> : null}

      {tab === "replies" ? <div className="crm-settings-grid"><section className="crm-panel settings-card full"><h2>الردود</h2>{settings.replies.map((reply, index) => <label className="crm-form-label" key={index}><span>الرد {index + 1}</span><textarea rows={3} value={reply} onChange={(event) => set("replies", settings.replies.map((item, i) => i === index ? event.target.value : item))} /></label>)}<button className="crm-secondary-button" onClick={() => set("replies", [...settings.replies, ""])}>إضافة رد</button></section><section className="crm-panel settings-card full"><h2>كلمات توقف الوكيل</h2><input value={settings.stopKeywords.join("، ")} onChange={(event) => set("stopKeywords", event.target.value.split(/[،,]/).map((item) => item.trim()).filter(Boolean))} /><h2>نص تصعيد مدير الفرع</h2><textarea rows={6} value={settings.branchEscalationTemplate} onChange={(event) => set("branchEscalationTemplate", event.target.value)} /></section><div className="crm-settings-save"><button className="crm-primary-button" onClick={() => void saveSettings()}><FloppyDisk size={18} />حفظ الإعدادات</button></div></div> : null}

      {tab === "logs" ? <><div className="crm-table-shell"><table className="crm-table"><thead><tr><th>الوقت</th><th>الإجراء</th><th>العميل</th><th>الفرع</th><th>السبب</th><th>الرسالة</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id}><td>{formatDate(log.created_at)}</td><td>{log.action === "bot_reply" ? <span className="crm-log-action good"><CheckCircle size={16} />رد الوكيل</span> : log.action?.includes("escalat") ? <span className="crm-log-action warn"><Robot size={16} />تصعيد</span> : <span className="crm-log-action"><XCircle size={16} />{log.action}</span>}</td><td>{log.customer_name || "عميل"}<small>{log.customer_phone || ""}</small></td><td>{log.branch_code || "—"}</td><td>{log.reason || "—"}</td><td>{log.message_text || "—"}</td></tr>)}{!logs.length ? <tr><td colSpan={6}><div className="crm-empty-state">لا توجد سجلات بعد.</div></td></tr> : null}</tbody></table></div>{logsTotal > logsPageSize ? <div className="crm-pagination"><button className="crm-secondary-button" disabled={logsPage === 0} onClick={() => setLogsPage((current) => Math.max(0, current - 1))}>السابق</button><span>صفحة {logsPage + 1} من {Math.max(1, Math.ceil(logsTotal / logsPageSize))}</span><button className="crm-secondary-button" disabled={(logsPage + 1) * logsPageSize >= logsTotal} onClick={() => setLogsPage((current) => current + 1)}>التالي</button></div> : null}</> : null}
    </div>
  );
}
