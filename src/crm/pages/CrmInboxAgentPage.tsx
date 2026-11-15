import { useEffect, useState } from "react";
import { ArrowClockwise, CheckCircle, FloppyDisk, Robot, Trash, XCircle } from "@phosphor-icons/react";
import { crmFetch, formatDate, queryString } from "../api";

const defaults = {
  enabled: false,
  idleMinutes: 60,
  windowHours: 23,
  stepMinutes: 10,
  escalateToBranchManager: true,
  escalateToSalesManager: true,
  escalateToSystemManager: true,
  salesManagerName: "",
  salesManagerPhone: "",
  systemManagerName: "",
  systemManagerPhone: "",
  fallbackPhone: "",
  businessHoursOnly: false,
  businessStart: "09:00",
  businessEnd: "22:00",
  stopKeywords: ["إلغاء", "خلاص", "لا تتواصلون"],
  customerMessage: "",
  escalationTemplateId: "",
  excludedStatuses: [] as string[],
  socialPlatforms: ["instagram", "facebook", "tiktok", "whatsapp"],
};

const platformOptions = [
  { key: "instagram", label: "إنستجرام" },
  { key: "facebook", label: "فيسبوك" },
  { key: "tiktok", label: "تيك توك" },
  { key: "whatsapp", label: "مرسال (واتساب)" },
];

const actionLabels: Record<string, string> = {
  customer_notice: "رسالة للعميل",
  customer_notice_failed: "فشل رسالة العميل",
  branch_manager_escalation: "تصعيد مدير الفرع",
  sales_manager_escalation: "تصعيد مدير المبيعات",
  system_manager_escalation: "تصعيد مدير النظام",
  escalation_skipped: "تصعيد متخطى",
  escalation_failed: "فشل التصعيد",
};

function fromApi(raw: any) {
  if (!raw) return defaults;
  return {
    enabled: Boolean(raw.enabled),
    idleMinutes: raw.idle_minutes ?? 60, windowHours: raw.window_hours ?? 23, stepMinutes: raw.step_minutes ?? 10,
    escalateToBranchManager: raw.escalate_to_branch_manager !== false,
    escalateToSalesManager: raw.escalate_to_sales_manager !== false,
    escalateToSystemManager: raw.escalate_to_system_manager !== false,
    salesManagerName: raw.sales_manager_name || "", salesManagerPhone: raw.sales_manager_phone || "",
    systemManagerName: raw.system_manager_name || "", systemManagerPhone: raw.system_manager_phone || "",
    fallbackPhone: raw.fallback_phone || "",
    businessHoursOnly: Boolean(raw.business_hours_only), businessStart: String(raw.business_start || "09:00").slice(0, 5), businessEnd: String(raw.business_end || "22:00").slice(0, 5),
    stopKeywords: raw.stop_keywords || defaults.stopKeywords,
    customerMessage: raw.customer_message || "",
    escalationTemplateId: raw.escalation_template_id || "",
    excludedStatuses: raw.excluded_statuses || [],
    socialPlatforms: raw.social_platforms || defaults.socialPlatforms,
  };
}

export function CrmInboxAgentPage() {
  const [tab, setTab] = useState<"general" | "logs">("general");
  const [settings, setSettings] = useState(defaults);
  const [managers, setManagers] = useState<any[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [defaultCustomerMessage, setDefaultCustomerMessage] = useState("");
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
      const result = await crmFetch<{ ok: boolean; settings: any; managers: any[]; logs: any[]; logsTotal: number; logsToday: number; statuses: string[]; templates: any[]; defaultCustomerMessage: string }>(`/api/crm/inbox-agent${queryString({ limit: logsPageSize, offset: logsPage * logsPageSize })}`);
      setSettings(fromApi(result.settings)); setManagers(result.managers || []); setLogs(result.logs || []); setLogsTotal(result.logsTotal || 0); setLogsToday(result.logsToday || 0);
      setStatuses(result.statuses || []); setTemplates(result.templates || []); setDefaultCustomerMessage(result.defaultCustomerMessage || "");
    } catch (error) { setNotice(error instanceof Error ? error.message : "فشل تحميل البيانات"); }
  }

  function set(key: keyof typeof defaults, value: any) { setSettings((current) => ({ ...current, [key]: value })); }
  function toggleIn(key: "excludedStatuses" | "socialPlatforms", value: string) {
    setSettings((current) => ({ ...current, [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value] }));
  }

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

  const selectedTemplate = templates.find((template) => template.id === settings.escalationTemplateId);

  return (
    <div className="crm-page inbox-agent-page">
      <div className="page-top-actions"><button className="crm-secondary-button" onClick={() => void load()}><ArrowClockwise size={18} />تحديث</button></div>
      <div className="crm-agent-status-grid">
        <div className={`crm-agent-status ${settings.enabled ? "on" : "off"}`}><Robot size={30} weight="duotone" /><span>حالة الوكيل</span><strong>{settings.enabled ? "مفعل" : "متوقف"}</strong></div>
        <div><span>التصعيد الأول بعد</span><strong>{settings.idleMinutes}</strong><small>دقيقة بدون تواصل</small></div>
        <div><span>الفاصل بين التصعيدات</span><strong>{settings.stepMinutes}</strong><small>دقيقة</small></div>
        <div><span>إجراءات اليوم</span><strong>{logsToday}</strong><small>رسائل وتصعيدات</small></div>
        <div><span>المنصات</span><strong>{settings.socialPlatforms.length}</strong><small>{platformOptions.filter((p) => settings.socialPlatforms.includes(p.key)).map((p) => p.label).join("، ") || "لا توجد منصات"}</small></div>
      </div>
      {notice ? <div className="crm-inline-notice">{notice}</div> : null}
      <div className="crm-department-tabs"><button className={tab === "general" ? "active" : ""} onClick={() => setTab("general")}>الإعدادات العامة</button><button className={tab === "logs" ? "active" : ""} onClick={() => setTab("logs")}>السجل</button></div>

      {tab === "general" ? <div className="crm-settings-grid">
        <section className="crm-panel settings-card"><h2>تشغيل / إيقاف</h2>
          <label className="crm-switch-row"><input type="checkbox" checked={settings.enabled} onChange={(event) => set("enabled", event.target.checked)} /><span>تفعيل وكيل صندوق الوارد</span></label>
          <label className="crm-switch-row"><input type="checkbox" checked={settings.escalateToBranchManager} onChange={(event) => set("escalateToBranchManager", event.target.checked)} /><span>التصعيد الأول: مدير الفرع</span></label>
          <label className="crm-switch-row"><input type="checkbox" checked={settings.escalateToSalesManager} onChange={(event) => set("escalateToSalesManager", event.target.checked)} /><span>التصعيد الثاني: مدير المبيعات</span></label>
          <label className="crm-switch-row"><input type="checkbox" checked={settings.escalateToSystemManager} onChange={(event) => set("escalateToSystemManager", event.target.checked)} /><span>التصعيد الثالث: مدير النظام</span></label>
          <label className="crm-switch-row"><input type="checkbox" checked={settings.businessHoursOnly} onChange={(event) => set("businessHoursOnly", event.target.checked)} /><span>العمل داخل أوقات العمل فقط</span></label>
        </section>
        <section className="crm-panel settings-card"><h2>التوقيت</h2>
          <div className="crm-form-grid">
            <label><span>الشرط الأول: العميل بدون تواصل لمدة (دقيقة)</span><input type="number" min={1} value={settings.idleMinutes} onChange={(e) => set("idleMinutes", Number(e.target.value))} /></label>
            <label><span>الشرط الثاني: بعد آخر رسالة من العميل بـ (ساعة)</span><input type="number" min={2} max={23} value={settings.windowHours} onChange={(e) => set("windowHours", Number(e.target.value))} /></label>
            <label><span>الفاصل بين كل تصعيد (دقيقة)</span><input type="number" min={1} value={settings.stepMinutes} onChange={(e) => set("stepMinutes", Number(e.target.value))} /></label>
            <label><span>بداية وقت العمل</span><input type="time" value={settings.businessStart} onChange={(e) => set("businessStart", e.target.value)} /></label>
            <label><span>نهاية وقت العمل</span><input type="time" value={settings.businessEnd} onChange={(e) => set("businessEnd", e.target.value)} /></label>
          </div>
          <p className="crm-help-text">كل شرط ينفذ نفس التسلسل: رسالة للعميل + تصعيد مدير الفرع، ثم مدير المبيعات، ثم مدير النظام، كل واحد بعد الفاصل، وبشرط ألا يتواصل أي موظف مع العميل.</p>
        </section>
        <section className="crm-panel settings-card full"><h2>الرسالة التي تصل للعميل</h2>
          <textarea rows={3} placeholder={defaultCustomerMessage} value={settings.customerMessage} onChange={(event) => set("customerMessage", event.target.value)} />
          <p className="crm-help-text">إذا تركتها فارغة تُستخدم الرسالة الافتراضية الظاهرة في الخانة.</p>
        </section>
        <section className="crm-panel settings-card full"><h2>قالب رسالة التصعيد (مرسال)</h2>
          <select value={settings.escalationTemplateId} onChange={(event) => set("escalationTemplateId", event.target.value)}>
            <option value="">اختر القالب المعتمد من مرسال</option>
            {templates.map((template) => <option key={template.id} value={template.id}>{template.display_name || template.name}</option>)}
          </select>
          {selectedTemplate ? <pre className="crm-template-preview">{selectedTemplate.content}</pre> : null}
          <p className="crm-help-text">متغيرات القالب بالترتيب: {"{{1}}"} اسم العميل، {"{{2}}"} المنصة، {"{{3}}"} المندوب المسؤول، {"{{4}}"} مرحلة التصعيد (مدير الفرع / المبيعات / النظام). لازم يكون القالب معتمدًا من واتساب لأن المديرين خارج نافذة الـ24 ساعة. بدون قالب يُرسل نص عادي ولن يصل إلا داخل النافذة.</p>
        </section>
        <section className="crm-panel settings-card"><h2>مدير المبيعات</h2><div className="crm-form-grid">
          <label><span>اسم مدير المبيعات</span><input value={settings.salesManagerName} onChange={(e) => set("salesManagerName", e.target.value)} /></label>
          <label><span>رقم واتساب مدير المبيعات</span><input value={settings.salesManagerPhone} onChange={(e) => set("salesManagerPhone", e.target.value)} /></label>
          <label className="crm-field-wide"><span>رقم احتياطي عام عند عدم وجود مدير فرع</span><input value={settings.fallbackPhone} onChange={(e) => set("fallbackPhone", e.target.value)} /></label>
        </div></section>
        <section className="crm-panel settings-card"><h2>مدير النظام</h2><div className="crm-form-grid">
          <label><span>اسم مدير النظام</span><input value={settings.systemManagerName} onChange={(e) => set("systemManagerName", e.target.value)} /></label>
          <label><span>رقم واتساب مدير النظام</span><input value={settings.systemManagerPhone} onChange={(e) => set("systemManagerPhone", e.target.value)} /></label>
        </div></section>
        <section className="crm-panel settings-card"><h2>المنصات</h2>
          <div className="crm-check-grid">{platformOptions.map((platform) => <label key={platform.key}><input type="checkbox" checked={settings.socialPlatforms.includes(platform.key)} onChange={() => toggleIn("socialPlatforms", platform.key)} />{platform.label}</label>)}</div>
          <p className="crm-help-text">لا يوجد Worker منفصل للوكيل. المنصة المركزية تفحص كل دقيقة وتقرر الإرسال، والـWorker الخاص بكل قناة ينفذ الإرسال فقط.</p>
        </section>
        <section className="crm-panel settings-card"><h2>الحالات المستثناة من التصعيد</h2>
          <div className="crm-check-grid">{statuses.map((status) => <label key={status}><input type="checkbox" checked={settings.excludedStatuses.includes(status)} onChange={() => toggleIn("excludedStatuses", status)} />{status}</label>)}{!statuses.length ? <span className="crm-help-text">لا توجد حالات.</span> : null}</div>
          <p className="crm-help-text">العملاء بهذه الحالات لا يصلهم أي تصعيد ولا رسالة من الوكيل.</p>
          <label className="crm-form-label"><span>كلمات توقف الوكيل</span><input value={settings.stopKeywords.join("، ")} onChange={(event) => set("stopKeywords", event.target.value.split(/[،,]/).map((item) => item.trim()).filter(Boolean))} /></label>
        </section>
        <section className="crm-panel settings-card full"><h2>مديرو الفروع (التصعيد الأول)</h2><div className="crm-manager-form"><select value={manager.scopeCode} onChange={(e) => setManager((current) => ({ ...current, scopeCode: e.target.value }))}><option value="">القسم / الفرع</option><option value="cash_sales">مبيعات الكاش - عام</option><option value="hall">فرع الصالة</option><option value="qadisiyah">فرع القادسية</option><option value="multaqa">فرع الملتقى</option><option value="finance_sales">مبيعات التمويل</option><option value="customer_service">خدمة العملاء</option><option value="call_center">الكول سنتر</option><option value="__unassigned__">قبل اختيار الخدمة</option></select><input placeholder="اسم المدير" value={manager.managerName} onChange={(e) => setManager((current) => ({ ...current, managerName: e.target.value }))} /><input placeholder="رقم واتساب المدير" value={manager.whatsappPhone} onChange={(e) => setManager((current) => ({ ...current, whatsappPhone: e.target.value }))} /><button className="crm-primary-button" onClick={() => void saveManager()}>إضافة / تحديث</button></div><div className="crm-table-shell compact"><table className="crm-table"><thead><tr><th>الفرع / القسم</th><th>اسم المدير</th><th>رقم الواتساب</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{managers.map((row) => <tr key={row.id}><td>{row.scope_code}</td><td>{row.manager_name}</td><td>{row.whatsapp_phone}</td><td>{row.is_active ? "مفعل" : "متوقف"}</td><td><button className="crm-row-delete" onClick={() => void deleteManager(row.scope_code)}><Trash size={16} />مسح</button></td></tr>)}{!managers.length ? <tr><td colSpan={5}><div className="crm-empty-state">لا توجد إعدادات مديرين بعد.</div></td></tr> : null}</tbody></table></div></section>
        <div className="crm-settings-save"><button className="crm-primary-button" disabled={saving} onClick={() => void saveSettings()}><FloppyDisk size={18} />{saving ? "جاري الحفظ..." : "حفظ الإعدادات"}</button></div>
      </div> : null}

      {tab === "logs" ? <><div className="crm-table-shell"><table className="crm-table"><thead><tr><th>الوقت</th><th>الإجراء</th><th>العميل</th><th>الفرع</th><th>السبب</th><th>الرسالة</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id}><td>{formatDate(log.created_at)}</td><td>{log.action === "customer_notice" ? <span className="crm-log-action good"><CheckCircle size={16} />{actionLabels.customer_notice}</span> : log.action?.endsWith("_escalation") ? <span className="crm-log-action warn"><Robot size={16} />{actionLabels[log.action] || "تصعيد"}</span> : <span className="crm-log-action"><XCircle size={16} />{actionLabels[log.action] || log.action}</span>}</td><td>{log.customer_name || "عميل"}<small>{log.customer_phone || ""}</small></td><td>{log.branch_code || "—"}</td><td>{log.reason || "—"}</td><td>{log.message_text || "—"}</td></tr>)}{!logs.length ? <tr><td colSpan={6}><div className="crm-empty-state">لا توجد سجلات بعد.</div></td></tr> : null}</tbody></table></div>{logsTotal > logsPageSize ? <div className="crm-pagination"><button className="crm-secondary-button" disabled={logsPage === 0} onClick={() => setLogsPage((current) => Math.max(0, current - 1))}>السابق</button><span>صفحة {logsPage + 1} من {Math.max(1, Math.ceil(logsTotal / logsPageSize))}</span><button className="crm-secondary-button" disabled={(logsPage + 1) * logsPageSize >= logsTotal} onClick={() => setLogsPage((current) => current + 1)}>التالي</button></div> : null}</> : null}
    </div>
  );
}
