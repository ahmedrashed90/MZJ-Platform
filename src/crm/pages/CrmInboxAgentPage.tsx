import { useEffect, useState } from "react";
import { ArrowClockwise, CheckCircle, FloppyDisk, Funnel, PlusCircle, Robot, Trash, Warning, XCircle } from "@phosphor-icons/react";
import { crmFetch, formatDate, queryString } from "../api";

const defaults = {
  enabled: false,
  idleMinutes: 60,
  windowHours: 23,
  stepMinutes: 10,
  autoAssignMinutes: 1,
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
  disableCustomerMessage: false,
  escalationTemplateId: "",
  statusEscalationTemplateId: "",
  excludedStatuses: [] as string[],
  socialPlatforms: ["instagram", "facebook", "tiktok", "whatsapp"],
};

const platformOptions = [
  { key: "instagram", label: "إنستجرام" },
  { key: "facebook", label: "فيسبوك" },
  { key: "tiktok", label: "تيك توك" },
  { key: "whatsapp", label: "مرسال (واتساب)" },
];

const targetOptions = [
  { key: "branch_manager", label: "مدير الفرع" },
  { key: "sales_manager", label: "مدير المبيعات" },
  { key: "system_manager", label: "مدير النظام" },
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
    idleMinutes: raw.idle_minutes ?? 60,
    windowHours: raw.window_hours ?? 23,
    stepMinutes: raw.step_minutes ?? 10,
    autoAssignMinutes: raw.auto_assign_minutes ?? 1,
    escalateToBranchManager: raw.escalate_to_branch_manager !== false,
    escalateToSalesManager: raw.escalate_to_sales_manager !== false,
    escalateToSystemManager: raw.escalate_to_system_manager !== false,
    salesManagerName: raw.sales_manager_name || "",
    salesManagerPhone: raw.sales_manager_phone || "",
    systemManagerName: raw.system_manager_name || "",
    systemManagerPhone: raw.system_manager_phone || "",
    fallbackPhone: raw.fallback_phone || "",
    businessHoursOnly: Boolean(raw.business_hours_only),
    businessStart: String(raw.business_start || "09:00").slice(0, 5),
    businessEnd: String(raw.business_end || "22:00").slice(0, 5),
    stopKeywords: raw.stop_keywords || defaults.stopKeywords,
    customerMessage: raw.customer_message || "",
    disableCustomerMessage: Boolean(raw.disable_customer_message),
    escalationTemplateId: raw.escalation_template_id || "",
    statusEscalationTemplateId: raw.status_escalation_template_id || "",
    excludedStatuses: raw.excluded_statuses || [],
    socialPlatforms: raw.social_platforms || defaults.socialPlatforms,
  };
}

const emptyStages = () => [
  { stage: 1, delayMinutes: 60, target: "branch_manager" },
];

type StageRow = { stage: number; delayMinutes: number; target: string };

function delayLabel(minutes: number) {
  if (minutes >= 1440) return `${Math.round(minutes / 1440)} يوم`;
  if (minutes >= 60) return `${Math.round(minutes / 60)} ساعة`;
  return `${minutes} دقيقة`;
}

export function CrmInboxAgentPage() {
  const [tab, setTab] = useState<"general" | "status_rules" | "status_logs" | "logs">("general");
  const [settings, setSettings] = useState(defaults);
  const [managers, setManagers] = useState<any[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [defaultCustomerMessage, setDefaultCustomerMessage] = useState("");
  const [logs, setLogs] = useState<any[]>([]);
  const [statusLogs, setStatusLogs] = useState<any[]>([]);
  const logsPageSize = 100;
  const [logsPage, setLogsPage] = useState(0);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsToday, setLogsToday] = useState(0);
  const [manager, setManager] = useState({ scopeCode: "", managerName: "", whatsappPhone: "", isActive: true });
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  // Status rules – r11 multi-stage
  const [statusRules, setStatusRules] = useState<any[]>([]);
  const [editingRule, setEditingRule] = useState<{ statusLabel: string; isActive: boolean; stages: StageRow[] } | null>(null);
  const [savingRule, setSavingRule] = useState(false);

  useEffect(() => { void load(); }, [logsPage]);

  async function load() {
    try {
      const result = await crmFetch<{
        ok: boolean; settings: any; managers: any[]; logs: any[];
        logsTotal: number; logsToday: number; statuses: string[];
        templates: any[]; defaultCustomerMessage: string; statusRules: any[];
      }>(`/api/crm/inbox-agent${queryString({ limit: logsPageSize, offset: logsPage * logsPageSize })}`);
      setSettings(fromApi(result.settings));
      setManagers(result.managers || []);
      setLogs(result.logs || []);
      setLogsTotal(result.logsTotal || 0);
      setLogsToday(result.logsToday || 0);
      setStatuses(result.statuses || []);
      setTemplates(result.templates || []);
      setDefaultCustomerMessage(result.defaultCustomerMessage || "");
      setStatusRules(result.statusRules || []);
      // Filter status_rule logs
      setStatusLogs((result.logs || []).filter((l: any) => l.reason?.startsWith("status_rule:")));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "فشل تحميل البيانات");
    }
  }

  function set(key: keyof typeof defaults, value: any) {
    setSettings((current) => ({ ...current, [key]: value }));
  }
  function toggleIn(key: "excludedStatuses" | "socialPlatforms", value: string) {
    setSettings((current) => ({
      ...current,
      [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value],
    }));
  }

  async function saveSettings() {
    setSaving(true);
    try {
      await crmFetch("/api/crm/inbox-agent", { method: "PUT", body: JSON.stringify(settings) });
      setNotice(settings.enabled ? "تم تشغيل الوكيل وحفظ الإعدادات." : "تم إيقاف الوكيل وحفظ الإعدادات.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "فشل حفظ الإعدادات");
    } finally {
      setSaving(false);
    }
  }

  async function saveManager() {
    try {
      await crmFetch("/api/crm/inbox-agent", { method: "POST", body: JSON.stringify({ section: "manager", ...manager }) });
      setNotice("تم حفظ مدير التصعيد.");
      setManager({ scopeCode: "", managerName: "", whatsappPhone: "", isActive: true });
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر حفظ مدير التصعيد");
    }
  }

  async function deleteManager(scopeCode: string) {
    if (!confirm("مسح إعداد التصعيد؟")) return;
    try {
      await crmFetch("/api/crm/inbox-agent", { method: "DELETE", body: JSON.stringify({ scopeCode }) });
      setNotice("تم مسح إعداد المدير.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر مسح إعداد المدير");
    }
  }

  // Open rule editor (new or existing)
  function openRuleEditor(rule?: any) {
    if (rule) {
      const stages: StageRow[] = Array.isArray(rule.stages) && rule.stages.length > 0
        ? rule.stages.map((s: any) => ({ stage: s.stage, delayMinutes: s.delay_minutes, target: s.target }))
        : emptyStages();
      setEditingRule({ statusLabel: rule.status_label, isActive: rule.is_active !== false, stages });
    } else {
      setEditingRule({ statusLabel: "", isActive: true, stages: emptyStages() });
    }
  }

  function addStage() {
    if (!editingRule) return;
    const next = editingRule.stages.length + 1;
    if (next > 3) return;
    setEditingRule({ ...editingRule, stages: [...editingRule.stages, { stage: next, delayMinutes: 240, target: "sales_manager" }] });
  }

  function removeStage(idx: number) {
    if (!editingRule) return;
    const newStages = editingRule.stages.filter((_, i) => i !== idx).map((s, i) => ({ ...s, stage: i + 1 }));
    setEditingRule({ ...editingRule, stages: newStages });
  }

  function updateStage(idx: number, field: keyof StageRow, value: any) {
    if (!editingRule) return;
    const newStages = editingRule.stages.map((s, i) => i === idx ? { ...s, [field]: value } : s);
    setEditingRule({ ...editingRule, stages: newStages });
  }

  async function saveStatusRule() {
    if (!editingRule?.statusLabel) { setNotice("اختر الحالة أولاً"); return; }
    setSavingRule(true);
    try {
      await crmFetch("/api/crm/inbox-agent", {
        method: "POST",
        body: JSON.stringify({
          section: "status_rule",
          statusLabel: editingRule.statusLabel,
          isActive: editingRule.isActive,
          stages: editingRule.stages,
        }),
      });
      setNotice("تم حفظ قاعدة التصعيد بنجاح.");
      setEditingRule(null);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر حفظ القاعدة");
    } finally {
      setSavingRule(false);
    }
  }

  async function deleteStatusRule(statusLabel: string) {
    if (!confirm(`مسح قاعدة التصعيد للحالة "${statusLabel}"؟`)) return;
    try {
      await crmFetch("/api/crm/inbox-agent", { method: "POST", body: JSON.stringify({ section: "status_rule", delete: true, statusLabel }) });
      setNotice("تم مسح القاعدة.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر مسح القاعدة");
    }
  }

  const selectedTemplate = templates.find((t) => t.id === settings.escalationTemplateId);

  const tabs = [
    { key: "general", label: "الإعدادات العامة" },
    { key: "status_rules", label: "تصعيد تغيير الحالة" },
    { key: "status_logs", label: "سجل تصعيد الحالة" },
    { key: "logs", label: "السجل الكامل" },
  ] as const;

  return (
    <div className="crm-page inbox-agent-page ia-r11">
      {/* ─── Header ─── */}
      <div className="ia-header">
        <div className="ia-header-left">
          <div className={`ia-status-badge ${settings.enabled ? "on" : "off"}`}>
            <Robot size={18} weight="duotone" />
            <span>{settings.enabled ? "الوكيل مفعّل" : "الوكيل متوقف"}</span>
          </div>
          <div className="ia-stat"><span>إجراءات اليوم</span><strong>{logsToday}</strong></div>
          <div className="ia-stat"><span>قواعد الحالة</span><strong>{statusRules.length}</strong></div>
          <div className="ia-stat"><span>النافذة</span><strong>{settings.windowHours}س</strong></div>
        </div>
        <button className="crm-secondary-button ia-refresh" onClick={() => void load()}>
          <ArrowClockwise size={16} /> تحديث
        </button>
      </div>

      {notice ? (
        <div className="ia-notice">
          <CheckCircle size={16} weight="duotone" /> {notice}
          <button className="ia-notice-close" onClick={() => setNotice("")}>×</button>
        </div>
      ) : null}

      {/* ─── Tabs ─── */}
      <div className="ia-tabs">
        {tabs.map((t) => (
          <button key={t.key} className={`ia-tab${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === "status_logs" && statusLogs.length > 0 ? <span className="ia-tab-badge">{statusLogs.length}</span> : null}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════
          TAB: الإعدادات العامة
      ══════════════════════════════════════ */}
      {tab === "general" ? (
        <div className="ia-grid">
          {/* تشغيل / إيقاف */}
          <div className="ia-card">
            <div className="ia-card-title">تشغيل الوكيل</div>
            <label className="ia-toggle-row">
              <span>تفعيل وكيل صندوق الوارد</span>
              <input type="checkbox" checked={settings.enabled} onChange={(e) => set("enabled", e.target.checked)} />
            </label>
            <label className="ia-toggle-row">
              <span>تصعيد → مدير الفرع</span>
              <input type="checkbox" checked={settings.escalateToBranchManager} onChange={(e) => set("escalateToBranchManager", e.target.checked)} />
            </label>
            <label className="ia-toggle-row">
              <span>تصعيد → مدير المبيعات</span>
              <input type="checkbox" checked={settings.escalateToSalesManager} onChange={(e) => set("escalateToSalesManager", e.target.checked)} />
            </label>
            <label className="ia-toggle-row">
              <span>تصعيد → مدير النظام</span>
              <input type="checkbox" checked={settings.escalateToSystemManager} onChange={(e) => set("escalateToSystemManager", e.target.checked)} />
            </label>
            <label className="ia-toggle-row">
              <span>أوقات العمل فقط</span>
              <input type="checkbox" checked={settings.businessHoursOnly} onChange={(e) => set("businessHoursOnly", e.target.checked)} />
            </label>
          </div>

          {/* التوقيت */}
          <div className="ia-card">
            <div className="ia-card-title">التوقيت</div>
            <div className="ia-fields">
              <label className="ia-field"><span>تعيين تلقائي للمحادثات الجديدة بعد (دقيقة)</span><input type="number" min={1} max={60} value={settings.autoAssignMinutes} onChange={(e) => set("autoAssignMinutes", Number(e.target.value))} /></label>
              <label className="ia-field"><span>بدون تواصل (دقيقة)</span><input type="number" min={1} value={settings.idleMinutes} onChange={(e) => set("idleMinutes", Number(e.target.value))} /></label>
              <label className="ia-field"><span>نافذة العميل (ساعة)</span><input type="number" min={2} max={23} value={settings.windowHours} onChange={(e) => set("windowHours", Number(e.target.value))} /></label>
              <label className="ia-field"><span>الفاصل بين التصعيدات (دقيقة)</span><input type="number" min={1} value={settings.stepMinutes} onChange={(e) => set("stepMinutes", Number(e.target.value))} /></label>
              <label className="ia-field"><span>بداية الدوام</span><input type="time" value={settings.businessStart} onChange={(e) => set("businessStart", e.target.value)} /></label>
              <label className="ia-field"><span>نهاية الدوام</span><input type="time" value={settings.businessEnd} onChange={(e) => set("businessEnd", e.target.value)} /></label>
            </div>
          </div>

          {/* رسالة العميل */}
          <div className="ia-card ia-card-wide">
            <div className="ia-card-title">الرسالة التي تصل للعميل</div>
            <label className="ia-toggle-row" style={{marginBottom:"8px"}}>
              <input type="checkbox" checked={settings.disableCustomerMessage} onChange={(e) => set("disableCustomerMessage", e.target.checked)} />
              <span>لا ترسل رسالة للعميل</span>
            </label>
            {!settings.disableCustomerMessage && <>
              <textarea rows={3} className="ia-textarea" placeholder={defaultCustomerMessage} value={settings.customerMessage} onChange={(e) => set("customerMessage", e.target.value)} />
              <p className="ia-hint">إذا تركتها فارغة تُستخدم الرسالة الافتراضية.</p>
            </>}
          </div>

          {/* قالب مرسال — النظام الأول (idle) */}
          <div className="ia-card ia-card-wide">
            <div className="ia-card-title">قالب التصعيد — عدم الرد على العميل (مرسال)</div>
            <select className="ia-select" value={settings.escalationTemplateId} onChange={(e) => set("escalationTemplateId", e.target.value)}>
              <option value="">اختر القالب</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.display_name || t.name}</option>)}
            </select>
            {selectedTemplate ? <pre className="ia-template-preview">{selectedTemplate.content}</pre> : null}
            <p className="ia-hint">متغيرات القالب: {"{{1}}"} اسم العميل، {"{{2}}"} المنصة، {"{{3}}"} المندوب، {"{{4}}"} مرحلة التصعيد.</p>
          </div>

          {/* قالب مرسال — النظام الثاني (status change) */}
          {(() => {
            const selectedStatusTemplate = templates.find((t) => t.id === settings.statusEscalationTemplateId);
            return (
              <div className="ia-card ia-card-wide">
                <div className="ia-card-title">قالب التصعيد — تغيير الحالة (مرسال)</div>
                <select className="ia-select" value={settings.statusEscalationTemplateId} onChange={(e) => set("statusEscalationTemplateId", e.target.value)}>
                  <option value="">اختر القالب</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.display_name || t.name}</option>)}
                </select>
                {selectedStatusTemplate ? <pre className="ia-template-preview">{selectedStatusTemplate.content}</pre> : null}
                <p className="ia-hint">متغيرات القالب: {"{{1}}"} اسم العميل، {"{{2}}"} المنصة، {"{{3}}"} المندوب، {"{{4}}"} الحالة المغيّرة، {"{{5}}"} الوقت منذ التغيير.</p>
              </div>
            );
          })()}

          {/* مديرو المبيعات والنظام */}
          <div className="ia-card">
            <div className="ia-card-title">مدير المبيعات</div>
            <div className="ia-fields">
              <label className="ia-field"><span>الاسم</span><input value={settings.salesManagerName} onChange={(e) => set("salesManagerName", e.target.value)} /></label>
              <label className="ia-field"><span>رقم الواتساب</span><input value={settings.salesManagerPhone} onChange={(e) => set("salesManagerPhone", e.target.value)} /></label>
              <label className="ia-field ia-field-wide"><span>رقم احتياطي (بدون مدير فرع)</span><input value={settings.fallbackPhone} onChange={(e) => set("fallbackPhone", e.target.value)} /></label>
            </div>
          </div>
          <div className="ia-card">
            <div className="ia-card-title">مدير النظام</div>
            <div className="ia-fields">
              <label className="ia-field"><span>الاسم</span><input value={settings.systemManagerName} onChange={(e) => set("systemManagerName", e.target.value)} /></label>
              <label className="ia-field"><span>رقم الواتساب</span><input value={settings.systemManagerPhone} onChange={(e) => set("systemManagerPhone", e.target.value)} /></label>
            </div>
          </div>

          {/* المنصات */}
          <div className="ia-card">
            <div className="ia-card-title">المنصات</div>
            <div className="ia-checks">
              {platformOptions.map((p) => (
                <label key={p.key} className="ia-check">
                  <input type="checkbox" checked={settings.socialPlatforms.includes(p.key)} onChange={() => toggleIn("socialPlatforms", p.key)} />
                  {p.label}
                </label>
              ))}
            </div>
          </div>

          {/* الحالات المستثناة */}
          <div className="ia-card">
            <div className="ia-card-title">الحالات المستثناة</div>
            <div className="ia-checks">
              {statuses.map((s) => (
                <label key={s} className="ia-check">
                  <input type="checkbox" checked={settings.excludedStatuses.includes(s)} onChange={() => toggleIn("excludedStatuses", s)} />
                  {s}
                </label>
              ))}
              {!statuses.length ? <span className="ia-hint">لا توجد حالات.</span> : null}
            </div>
            <label className="ia-field ia-field-wide" style={{ marginTop: 12 }}>
              <span>كلمات توقف الوكيل</span>
              <input value={settings.stopKeywords.join("، ")} onChange={(e) => set("stopKeywords", e.target.value.split(/[،,]/).map((k) => k.trim()).filter(Boolean))} />
            </label>
          </div>

          {/* مديرو الفروع */}
          <div className="ia-card ia-card-full">
            <div className="ia-card-title">مديرو الفروع (التصعيد الأول)</div>
            <div className="ia-manager-row">
              <select value={manager.scopeCode} onChange={(e) => setManager((m) => ({ ...m, scopeCode: e.target.value }))}>
                <option value="">القسم / الفرع</option>
                <option value="cash_sales">مبيعات الكاش</option>
                <option value="hall">فرع الصالة</option>
                <option value="qadisiyah">فرع القادسية</option>
                <option value="multaqa">فرع الملتقى</option>
                <option value="finance_sales">مبيعات التمويل</option>
                <option value="customer_service">خدمة العملاء</option>
                <option value="call_center">الكول سنتر</option>
                <option value="__unassigned__">قبل اختيار الخدمة</option>
              </select>
              <input placeholder="اسم المدير" value={manager.managerName} onChange={(e) => setManager((m) => ({ ...m, managerName: e.target.value }))} />
              <input placeholder="رقم واتساب" value={manager.whatsappPhone} onChange={(e) => setManager((m) => ({ ...m, whatsappPhone: e.target.value }))} />
              <button className="crm-primary-button" onClick={() => void saveManager()}>إضافة / تحديث</button>
            </div>
            <table className="ia-table">
              <thead><tr><th>الفرع / القسم</th><th>اسم المدير</th><th>رقم الواتساب</th><th>الحالة</th><th></th></tr></thead>
              <tbody>
                {managers.map((row) => (
                  <tr key={row.id}>
                    <td>{row.scope_code}</td>
                    <td>{row.manager_name}</td>
                    <td dir="ltr">{row.whatsapp_phone}</td>
                    <td>{row.is_active ? <span className="ia-pill green">مفعّل</span> : <span className="ia-pill gray">متوقف</span>}</td>
                    <td><button className="ia-row-delete" onClick={() => void deleteManager(row.scope_code)}><Trash size={15} /></button></td>
                  </tr>
                ))}
                {!managers.length ? <tr><td colSpan={5} className="ia-empty">لا توجد إعدادات مديرين بعد.</td></tr> : null}
              </tbody>
            </table>
          </div>

          <div className="ia-save-row">
            <button className="crm-primary-button ia-save-btn" disabled={saving} onClick={() => void saveSettings()}>
              <FloppyDisk size={18} /> {saving ? "جاري الحفظ..." : "حفظ الإعدادات"}
            </button>
          </div>
        </div>
      ) : null}

      {/* ══════════════════════════════════════
          TAB: تصعيد تغيير الحالة
      ══════════════════════════════════════ */}
      {tab === "status_rules" ? (
        <div className="ia-rules-layout">
          {/* قائمة القواعد */}
          <div className="ia-rules-list">
            <div className="ia-rules-list-header">
              <span>قواعد تغيير الحالة</span>
              <button className="ia-add-rule-btn" onClick={() => openRuleEditor()}>
                <PlusCircle size={16} /> قاعدة جديدة
              </button>
            </div>
            {statusRules.length === 0 ? (
              <div className="ia-rules-empty">
                <Funnel size={32} weight="duotone" />
                <p>لا توجد قواعد بعد</p>
                <p className="ia-hint">أضف قاعدة لتبدأ تصعيد تغيير الحالة</p>
              </div>
            ) : (
              statusRules.map((rule) => {
                const stages: any[] = Array.isArray(rule.stages) ? rule.stages : [];
                return (
                  <div key={rule.id} className={`ia-rule-card${!rule.is_active ? " ia-rule-disabled" : ""}`}>
                    <div className="ia-rule-card-top">
                      <span className="ia-rule-label">{rule.status_label}</span>
                      <div className="ia-rule-card-actions">
                        {rule.is_active ? <span className="ia-pill green">مفعّل</span> : <span className="ia-pill gray">متوقف</span>}
                        <button className="ia-icon-btn" title="تعديل" onClick={() => openRuleEditor(rule)}>✏️</button>
                        <button className="ia-icon-btn ia-icon-delete" title="مسح" onClick={() => void deleteStatusRule(rule.status_label)}><Trash size={15} /></button>
                      </div>
                    </div>
                    <div className="ia-stages-track">
                      {stages.map((s, idx) => (
                        <div key={idx} className="ia-stage-chip">
                          <span className="ia-stage-num">{idx + 1}</span>
                          <span className="ia-stage-delay">{delayLabel(s.delay_minutes)}</span>
                          <span className="ia-stage-target">{targetOptions.find((t) => t.key === s.target)?.label || s.target}</span>
                        </div>
                      ))}
                      {stages.length === 0 ? <span className="ia-hint">لا توجد مراحل</span> : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* محرر القاعدة */}
          {editingRule ? (
            <div className="ia-rule-editor">
              <div className="ia-rule-editor-title">
                {editingRule.statusLabel ? `تعديل قاعدة: ${editingRule.statusLabel}` : "قاعدة جديدة"}
              </div>

              <label className="ia-field">
                <span>الحالة</span>
                <select
                  className="ia-select"
                  value={editingRule.statusLabel}
                  onChange={(e) => setEditingRule({ ...editingRule, statusLabel: e.target.value })}
                  disabled={!!statusRules.find((r) => r.status_label === editingRule.statusLabel)}
                >
                  <option value="">اختر الحالة</option>
                  {statuses
                    .filter((s) => !statusRules.find((r) => r.status_label === s) || s === editingRule.statusLabel)
                    .map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>

              <label className="ia-toggle-row" style={{ marginBottom: 16 }}>
                <span>تفعيل هذه القاعدة</span>
                <input type="checkbox" checked={editingRule.isActive} onChange={(e) => setEditingRule({ ...editingRule, isActive: e.target.checked })} />
              </label>

              <div className="ia-stages-editor">
                <div className="ia-stages-editor-title">مراحل التصعيد</div>
                {editingRule.stages.map((stage, idx) => (
                  <div key={idx} className="ia-stage-row">
                    <div className="ia-stage-row-num">{idx + 1}</div>
                    <label className="ia-field">
                      <span>التأخير (دقيقة)</span>
                      <input
                        type="number" min={1} max={10080}
                        value={stage.delayMinutes}
                        onChange={(e) => updateStage(idx, "delayMinutes", Number(e.target.value))}
                      />
                    </label>
                    <label className="ia-field">
                      <span>المستلم</span>
                      <select value={stage.target} onChange={(e) => updateStage(idx, "target", e.target.value)}>
                        {targetOptions.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                      </select>
                    </label>
                    <div className="ia-stage-delay-label">{delayLabel(stage.delayMinutes)}</div>
                    {editingRule.stages.length > 1 ? (
                      <button className="ia-icon-btn ia-icon-delete" onClick={() => removeStage(idx)}><Trash size={14} /></button>
                    ) : null}
                  </div>
                ))}
                {editingRule.stages.length < 3 ? (
                  <button className="ia-add-stage-btn" onClick={addStage}>
                    <PlusCircle size={15} /> إضافة مرحلة {editingRule.stages.length + 1}
                  </button>
                ) : null}
              </div>

              <div className="ia-rule-editor-actions">
                <button className="crm-primary-button" disabled={savingRule} onClick={() => void saveStatusRule()}>
                  <FloppyDisk size={16} /> {savingRule ? "جاري الحفظ..." : "حفظ القاعدة"}
                </button>
                <button className="crm-secondary-button" onClick={() => setEditingRule(null)}>إلغاء</button>
              </div>

              <p className="ia-hint" style={{ marginTop: 12 }}>
                <Warning size={13} weight="duotone" /> التصعيد يتوقف تلقائياً إذا رد موظف على المحادثة أو تغيرت الحالة مرة أخرى.
              </p>
            </div>
          ) : (
            <div className="ia-rule-editor-placeholder">
              <Robot size={40} weight="duotone" />
              <p>اختر قاعدة للتعديل أو أنشئ قاعدة جديدة</p>
            </div>
          )}
        </div>
      ) : null}

      {/* ══════════════════════════════════════
          TAB: سجل تصعيد الحالة
      ══════════════════════════════════════ */}
      {tab === "status_logs" ? (
        <div className="ia-table-wrap">
          <table className="ia-table">
            <thead>
              <tr>
                <th>الوقت</th>
                <th>الحالة</th>
                <th>المرحلة</th>
                <th>العميل</th>
                <th>المندوب</th>
                <th>الفرع</th>
                <th>النتيجة</th>
              </tr>
            </thead>
            <tbody>
              {statusLogs.map((log) => {
                const cycleMatch = log.reason?.match(/^status_rule:(.+?)(?::stage(\d+))?$/);
                const statusLabel = cycleMatch?.[1] || log.reason?.replace("status_rule:", "") || "—";
                const stageNum = cycleMatch?.[2] || "—";
                return (
                  <tr key={log.id}>
                    <td dir="ltr">{formatDate(log.created_at)}</td>
                    <td><span className="ia-status-chip">{statusLabel}</span></td>
                    <td className="ia-center">{stageNum}</td>
                    <td>
                      {log.customer_name || "عميل"}
                      {log.customer_phone ? <div className="ia-sub" dir="ltr">{log.customer_phone}</div> : null}
                    </td>
                    <td>{log.branch_code || "—"}</td>
                    <td>{log.branch_code || "—"}</td>
                    <td>
                      {log.action?.endsWith("_escalation") ? (
                        <span className="ia-pill amber"><Robot size={13} />{actionLabels[log.action] || "تصعيد"}</span>
                      ) : log.action === "escalation_failed" ? (
                        <span className="ia-pill red"><XCircle size={13} />فشل</span>
                      ) : (
                        <span className="ia-pill gray">{actionLabels[log.action] || log.action}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!statusLogs.length ? (
                <tr><td colSpan={7} className="ia-empty">لا توجد سجلات تصعيد حالة بعد.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* ══════════════════════════════════════
          TAB: السجل الكامل
      ══════════════════════════════════════ */}
      {tab === "logs" ? (
        <>
          <div className="ia-table-wrap">
            <table className="ia-table">
              <thead>
                <tr><th>الوقت</th><th>الإجراء</th><th>العميل</th><th>الفرع</th><th>السبب</th><th>الرسالة</th></tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td dir="ltr">{formatDate(log.created_at)}</td>
                    <td>
                      {log.action === "customer_notice" ? (
                        <span className="ia-pill green"><CheckCircle size={13} />{actionLabels.customer_notice}</span>
                      ) : log.action?.endsWith("_escalation") ? (
                        <span className="ia-pill amber"><Robot size={13} />{actionLabels[log.action] || "تصعيد"}</span>
                      ) : (
                        <span className="ia-pill gray"><XCircle size={13} />{actionLabels[log.action] || log.action}</span>
                      )}
                    </td>
                    <td>
                      {log.customer_name || "عميل"}
                      {log.customer_phone ? <div className="ia-sub" dir="ltr">{log.customer_phone}</div> : null}
                    </td>
                    <td>{log.branch_code || "—"}</td>
                    <td>{log.reason || "—"}</td>
                    <td>{log.message_text || "—"}</td>
                  </tr>
                ))}
                {!logs.length ? <tr><td colSpan={6} className="ia-empty">لا توجد سجلات بعد.</td></tr> : null}
              </tbody>
            </table>
          </div>
          {logsTotal > logsPageSize ? (
            <div className="ia-pagination">
              <button className="crm-secondary-button" disabled={logsPage === 0} onClick={() => setLogsPage((p) => Math.max(0, p - 1))}>السابق</button>
              <span>صفحة {logsPage + 1} من {Math.max(1, Math.ceil(logsTotal / logsPageSize))}</span>
              <button className="crm-secondary-button" disabled={(logsPage + 1) * logsPageSize >= logsTotal} onClick={() => setLogsPage((p) => p + 1)}>التالي</button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
