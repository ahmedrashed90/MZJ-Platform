import { useEffect, useMemo, useState } from "react";
import { FloppyDisk, Plus, Trash } from "@phosphor-icons/react";
import { crmFetch } from "../api";

type OptionRow = {
  key: string;
  label: string;
  aliases: string[];
  departmentCode: string;
  isActive: boolean;
  sortOrder: number;
};

type Props = {
  initial: any;
  endpoints: any[];
  sources: any[];
  onSaved: () => Promise<void> | void;
  onNotice: (message: string) => void;
};

const defaultOptions: OptionRow[] = [
  { key: "cash", label: "💰 مبيعات الكاش", aliases: ["1", "كاش", "مبيعات الكاش"], departmentCode: "cash_sales", isActive: true, sortOrder: 10 },
  { key: "finance", label: "🏦 مبيعات التمويل", aliases: ["2", "تمويل", "مبيعات التمويل"], departmentCode: "finance_sales", isActive: true, sortOrder: 20 },
  { key: "service", label: "🛠 خدمة العملاء", aliases: ["3", "خدمة العملاء", "خدمة"], departmentCode: "customer_service", isActive: true, sortOrder: 30 },
];

function normalized(raw: any) {
  return {
    automationEnabled: raw?.automation_enabled !== false,
    serviceSelectionEnabled: raw?.service_selection_enabled !== false,
    welcomeMessage: raw?.welcome_message || "مرحباً بك في مجموعة محمد بن ذعار العجمي للسيارات 👋",
    serviceSelectionMessage: raw?.service_selection_message || "برجاء اختيار الخدمة:",
    financeIntroMessage: raw?.finance_intro_message || "برجاء إدخال بيانات التمويل 👇",
    triggerMode: raw?.trigger_mode || "every_message",
    triggerIntervalMinutes: Number(raw?.trigger_interval_minutes || 1440),
    enabledPlatforms: Array.isArray(raw?.enabled_platforms) ? raw.enabled_platforms : [],
    enabledWorkers: Array.isArray(raw?.enabled_workers) ? raw.enabled_workers : [],
    serviceOptions: Array.isArray(raw?.service_options) && raw.service_options.length
      ? raw.service_options.map((row: any, index: number) => ({
          key: row.key || "",
          label: row.label || "",
          aliases: Array.isArray(row.aliases) ? row.aliases : [],
          departmentCode: row.departmentCode || row.department_code || "",
          isActive: row.isActive !== false,
          sortOrder: Number(row.sortOrder ?? index * 10),
        }))
      : defaultOptions,
    fieldPrompts: raw?.field_prompts || {
      finance: [
        { key: "customer_name", label: "الاسم" },
        { key: "car_name", label: "السيارة" },
        { key: "phone", label: "رقم الجوال" },
      ],
    },
    completionMessages: raw?.completion_messages || {
      cash: "تم تحويل طلبك إلى قسم مبيعات الكاش ✅\nسيتم التواصل معك قريباً",
      finance: "سيتم التواصل معك في أقرب وقت\nنسعد بخدمتكم دائمًا 🌹",
      service: "سيتم التواصل معك قريباً من أحد ممثلي قسم خدمة العملاء 👨‍🔧",
    },
  };
}

export function CrmAutomationSettings({ initial, endpoints, sources, onSaved, onNotice }: Props) {
  const [form, setForm] = useState(() => normalized(initial));
  const [saving, setSaving] = useState(false);

  useEffect(() => setForm(normalized(initial)), [initial]);

  const platformRows = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of sources || []) map.set(String(row.code), String(row.name || row.code));
    for (const row of endpoints || []) map.set(String(row.source_code), String(row.display_name || row.source_code));
    return Array.from(map.entries()).map(([code, name]) => ({ code, name }));
  }, [endpoints, sources]);

  function toggleList(key: "enabledPlatforms" | "enabledWorkers", value: string) {
    setForm((current: any) => ({
      ...current,
      [key]: current[key].includes(value) ? current[key].filter((item: string) => item !== value) : [...current[key], value],
    }));
  }

  function updateOption(index: number, patch: Partial<OptionRow>) {
    setForm((current: any) => ({
      ...current,
      serviceOptions: current.serviceOptions.map((row: OptionRow, rowIndex: number) => rowIndex === index ? { ...row, ...patch } : row),
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const result = await crmFetch<any>("/api/crm/settings", {
        method: "POST",
        body: JSON.stringify({ section: "automation_flow", ...form }),
      });
      onNotice(result.message || "تم حفظ إعدادات الأوتوميشن");
      await onSaved();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "تعذر حفظ إعدادات الأوتوميشن");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="crm-admin-stack">
      <section className="crm-panel crm-form-panel crm-settings-wide-editor">
        <header>
          <div>
            <h2>إعدادات أوتوميشن استقبال العملاء</h2>
            <p>تحكم في المنصات والـ Workers والرسائل والاختيارات ومعدل تكرار بداية الفلو.</p>
          </div>
        </header>

        <div className="crm-form-grid crm-form-grid-wide">
          <label className="crm-toggle-row">
            <input type="checkbox" checked={form.automationEnabled} onChange={(event) => setForm((current: any) => ({ ...current, automationEnabled: event.target.checked }))} />
            <span>تشغيل الأوتوميشن</span>
          </label>
          <label className="crm-toggle-row">
            <input type="checkbox" checked={form.serviceSelectionEnabled} onChange={(event) => setForm((current: any) => ({ ...current, serviceSelectionEnabled: event.target.checked }))} />
            <span>تشغيل اختيار الخدمة</span>
          </label>

          <label>
            <span>تكرار بداية الأوتوميشن</span>
            <select value={form.triggerMode} onChange={(event) => setForm((current: any) => ({ ...current, triggerMode: event.target.value }))}>
              <option value="every_message">مع كل رسالة جديدة</option>
              <option value="24_hours">مرة كل 24 ساعة</option>
              <option value="custom_interval">مدة مخصصة</option>
            </select>
          </label>
          {form.triggerMode === "custom_interval" ? (
            <label>
              <span>المدة بالدقائق</span>
              <input type="number" min={1} max={10080} value={form.triggerIntervalMinutes} onChange={(event) => setForm((current: any) => ({ ...current, triggerIntervalMinutes: Number(event.target.value || 1) }))} />
            </label>
          ) : null}

          <label className="crm-field-span-2">
            <span>رسالة الترحيب</span>
            <textarea rows={3} value={form.welcomeMessage} onChange={(event) => setForm((current: any) => ({ ...current, welcomeMessage: event.target.value }))} />
          </label>
          <label className="crm-field-span-2">
            <span>رسالة الاختيارات</span>
            <textarea rows={3} value={form.serviceSelectionMessage} onChange={(event) => setForm((current: any) => ({ ...current, serviceSelectionMessage: event.target.value }))} />
          </label>
          <label className="crm-field-span-2">
            <span>رسالة بداية فلو التمويل</span>
            <textarea rows={2} value={form.financeIntroMessage} onChange={(event) => setForm((current: any) => ({ ...current, financeIntroMessage: event.target.value }))} />
          </label>
        </div>

        <h3>المنصات التي يعمل عليها الأوتوميشن</h3>
        <div className="crm-checkbox-grid">
          {platformRows.map((row) => (
            <label key={row.code} className="crm-toggle-row">
              <input type="checkbox" checked={form.enabledPlatforms.includes(row.code)} onChange={() => toggleList("enabledPlatforms", row.code)} />
              <span>{row.name}</span>
            </label>
          ))}
        </div>

        <h3>الـ Workers المسموح لهم بتشغيل الأوتوميشن</h3>
        <div className="crm-checkbox-grid">
          {(endpoints || []).map((row: any) => (
            <label key={row.source_code} className="crm-toggle-row">
              <input type="checkbox" checked={form.enabledWorkers.includes(row.source_code)} onChange={() => toggleList("enabledWorkers", row.source_code)} />
              <span>{row.display_name || row.source_code}</span>
            </label>
          ))}
          {!endpoints?.length ? <p className="crm-muted">لا توجد Workers محفوظة في إعدادات الربط حالياً.</p> : null}
        </div>

        <h3>اختيارات الخدمة</h3>
        <div className="crm-settings-list">
          {form.serviceOptions.map((row: OptionRow, index: number) => (
            <div className="crm-settings-list-row" key={`${row.key}-${index}`}>
              <input placeholder="الكود" value={row.key} onChange={(event) => updateOption(index, { key: event.target.value })} />
              <input placeholder="النص الظاهر للعميل" value={row.label} onChange={(event) => updateOption(index, { label: event.target.value })} />
              <select value={row.departmentCode} onChange={(event) => updateOption(index, { departmentCode: event.target.value })}>
                <option value="cash_sales">مبيعات الكاش</option>
                <option value="finance_sales">مبيعات التمويل</option>
                <option value="customer_service">خدمة العملاء</option>
                <option value="call_center">الكول سنتر</option>
              </select>
              <input placeholder="المرادفات مفصولة بفاصلة" value={row.aliases.join(", ")} onChange={(event) => updateOption(index, { aliases: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} />
              <label className="crm-toggle-row"><input type="checkbox" checked={row.isActive} onChange={(event) => updateOption(index, { isActive: event.target.checked })} /><span>نشط</span></label>
              <button type="button" className="crm-icon-button danger" onClick={() => setForm((current: any) => ({ ...current, serviceOptions: current.serviceOptions.filter((_: any, rowIndex: number) => rowIndex !== index) }))}><Trash size={18} /></button>
            </div>
          ))}
        </div>
        <button type="button" className="crm-secondary-button" onClick={() => setForm((current: any) => ({ ...current, serviceOptions: [...current.serviceOptions, { key: "", label: "", aliases: [], departmentCode: "cash_sales", isActive: true, sortOrder: current.serviceOptions.length * 10 + 10 }] }))}><Plus size={18} />إضافة اختيار</button>

        <h3>أسئلة فلو التمويل</h3>
        <div className="crm-settings-list">
          {(form.fieldPrompts.finance || []).map((row: any, index: number) => (
            <div className="crm-settings-list-row" key={`${row.key}-${index}`}>
              <input value={row.key} onChange={(event) => setForm((current: any) => ({ ...current, fieldPrompts: { ...current.fieldPrompts, finance: current.fieldPrompts.finance.map((item: any, itemIndex: number) => itemIndex === index ? { ...item, key: event.target.value } : item) } }))} />
              <input value={row.label} onChange={(event) => setForm((current: any) => ({ ...current, fieldPrompts: { ...current.fieldPrompts, finance: current.fieldPrompts.finance.map((item: any, itemIndex: number) => itemIndex === index ? { ...item, label: event.target.value } : item) } }))} />
              <button type="button" className="crm-icon-button danger" onClick={() => setForm((current: any) => ({ ...current, fieldPrompts: { ...current.fieldPrompts, finance: current.fieldPrompts.finance.filter((_: any, itemIndex: number) => itemIndex !== index) } }))}><Trash size={18} /></button>
            </div>
          ))}
        </div>
        <button type="button" className="crm-secondary-button" onClick={() => setForm((current: any) => ({ ...current, fieldPrompts: { ...current.fieldPrompts, finance: [...(current.fieldPrompts.finance || []), { key: "", label: "" }] } }))}><Plus size={18} />إضافة سؤال</button>

        <h3>رسائل نهاية الفلو</h3>
        <div className="crm-form-grid crm-form-grid-wide">
          {["cash", "finance", "service"].map((key) => (
            <label key={key}>
              <span>{key === "cash" ? "مبيعات الكاش" : key === "finance" ? "مبيعات التمويل" : "خدمة العملاء"}</span>
              <textarea rows={4} value={form.completionMessages[key] || ""} onChange={(event) => setForm((current: any) => ({ ...current, completionMessages: { ...current.completionMessages, [key]: event.target.value } }))} />
            </label>
          ))}
        </div>

        <div className="crm-form-actions">
          <button type="button" className="crm-primary-button" disabled={saving} onClick={() => void save()}><FloppyDisk size={18} />{saving ? "جاري الحفظ..." : "حفظ إعدادات الأوتوميشن"}</button>
        </div>
      </section>
    </div>
  );
}
