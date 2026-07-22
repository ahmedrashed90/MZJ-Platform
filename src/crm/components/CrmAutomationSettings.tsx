import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, FloppyDisk } from "@phosphor-icons/react";
import { crmFetch } from "../api";

type Binding = { platformCode: string; workerCode: string; enabled: boolean };
type Choice = { key: "cash" | "finance" | "service"; label: string; emoji: string; aliases: string[]; enabled: boolean; sortOrder: number };
type Settings = {
  enabled: boolean;
  name: string;
  triggerPolicy: "every_message" | "every_24_hours" | "custom_interval";
  intervalValue: number;
  intervalUnit: "minute" | "hour" | "day";
  bindings: Binding[];
  messages: { greeting: string; servicePrompt: string; noMatch: string };
  choices: Choice[];
  flows: {
    cash: { completionMessage: string };
    finance: {
      startMessage: string;
      nameQuestion: string;
      nameError: string;
      carQuestion: string;
      carError: string;
      phoneQuestion: string;
      phoneError: string;
      completionMessage: string;
    };
    service: { completionMessage: string };
  };
  version: number;
};
type Platform = { code: string; name: string };
type Worker = { code: string; name: string; platformCode: string; active: boolean; sendUrl: string; healthUrl: string };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function textArea(label: string, value: string, onChange: (value: string) => void, rows = 3) {
  return (
    <label className="crm-form-label">
      <span>{label}</span>
      <textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} />
      <small>{value.length} حرف</small>
    </label>
  );
}

export function CrmAutomationSettings() {
  const [form, setForm] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const dirty = useMemo(() => Boolean(form && saved && JSON.stringify(form) !== JSON.stringify(saved)), [form, saved]);

  async function load() {
    setLoading(true);
    try {
      const result = await crmFetch<{ settings: Settings; platforms: Platform[]; workers: Worker[] }>("/api/crm/automation-settings");
      setForm(clone(result.settings));
      setSaved(clone(result.settings));
      setPlatforms(result.platforms || []);
      setWorkers(result.workers || []);
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل إعدادات الأوتوميشن");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const listener = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [dirty]);

  function updateBinding(platformCode: string, patch: Partial<Binding>) {
    setForm((current) => {
      if (!current) return current;
      const existing = current.bindings.find((binding) => binding.platformCode === platformCode);
      const matchingWorkers = workers.filter((worker) => worker.platformCode === platformCode && worker.active);
      const next: Binding = {
        platformCode,
        workerCode: existing?.workerCode || matchingWorkers[0]?.code || "",
        enabled: existing?.enabled || false,
        ...patch,
      };
      return {
        ...current,
        bindings: [...current.bindings.filter((binding) => binding.platformCode !== platformCode), next],
      };
    });
  }

  function updateChoice(key: Choice["key"], patch: Partial<Choice>) {
    setForm((current) => current ? {
      ...current,
      choices: current.choices.map((choice) => choice.key === key ? { ...choice, ...patch } : choice),
    } : current);
  }

  async function save() {
    if (!form || saving) return;
    setSaving(true);
    try {
      const result = await crmFetch<{ settings: Settings; message: string }>("/api/crm/automation-settings", {
        method: "PUT",
        body: JSON.stringify(form),
      });
      setForm(clone(result.settings));
      setSaved(clone(result.settings));
      setNotice(result.message || "تم حفظ إعدادات الأوتوميشن");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر حفظ إعدادات الأوتوميشن");
    } finally {
      setSaving(false);
    }
  }

  if (!form) return <div className="crm-inline-notice">{loading ? "جاري تحميل إعدادات الأوتوميشن..." : notice || "تعذر تحميل الإعدادات"}</div>;

  return (
    <div className="crm-settings-grid crm-automation-settings-grid">
      {notice ? <div className="crm-inline-notice full">{notice}</div> : null}

      <section className="crm-panel settings-card full">
        <header className="crm-settings-section-head">
          <div><h2>الحالة العامة</h2><p>إيقاف الأوتوميشن لا يمنع حفظ رسائل العملاء داخل المحادثات.</p></div>
          <button className="crm-secondary-button" type="button" onClick={() => void load()} disabled={loading}><ArrowClockwise size={17} />{loading ? "جاري التحميل" : "إعادة تحميل"}</button>
        </header>
        <label className="crm-switch-row"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /><span>تشغيل الأوتوميشن</span></label>
        <label className="crm-form-label"><span>اسم الأوتوميشن</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      </section>

      <section className="crm-panel settings-card full">
        <h2>المنصات والـWorkers</h2>
        <p className="crm-help-text">يعمل الأوتوميشن فقط على الربط المفعّل هنا، والـWorker يجب أن يكون تابعًا لنفس المنصة.</p>
        <div className="crm-service-option-editor">
          {platforms.map((platform) => {
            const binding = form.bindings.find((item) => item.platformCode === platform.code);
            const platformWorkers = workers.filter((worker) => worker.platformCode === platform.code);
            return (
              <article key={platform.code}>
                <strong>{platform.name}</strong>
                <label className="crm-switch-row"><input type="checkbox" checked={binding?.enabled === true} onChange={(event) => updateBinding(platform.code, { enabled: event.target.checked })} /><span>تشغيل الأوتوميشن على المنصة</span></label>
                <label><span>الـWorker</span><select value={binding?.workerCode || ""} onChange={(event) => updateBinding(platform.code, { workerCode: event.target.value })}><option value="">اختر الـWorker</option>{platformWorkers.map((worker) => <option key={worker.code} value={worker.code}>{worker.name}{worker.active ? "" : " - غير نشط"}</option>)}</select></label>
                <small>{binding?.workerCode && platformWorkers.find((worker) => worker.code === binding.workerCode)?.active ? "الربط متاح" : "اختر Worker نشطًا"}</small>
              </article>
            );
          })}
        </div>
      </section>

      <section className="crm-panel settings-card full">
        <h2>متى يتم تشغيل الأوتوميشن؟</h2>
        <div className="crm-form-grid crm-form-grid-wide">
          <label><span>سياسة التشغيل</span><select value={form.triggerPolicy} onChange={(event) => setForm({ ...form, triggerPolicy: event.target.value as Settings["triggerPolicy"] })}><option value="every_message">مع كل رسالة واردة خارج فلو نشط</option><option value="every_24_hours">مرة كل 24 ساعة</option><option value="custom_interval">مدة مخصصة</option></select></label>
          {form.triggerPolicy === "custom_interval" ? <>
            <label><span>قيمة المدة</span><input type="number" min={1} value={form.intervalValue} onChange={(event) => setForm({ ...form, intervalValue: Math.max(1, Number(event.target.value) || 1) })} /></label>
            <label><span>وحدة المدة</span><select value={form.intervalUnit} onChange={(event) => setForm({ ...form, intervalUnit: event.target.value as Settings["intervalUnit"] })}><option value="minute">دقيقة</option><option value="hour">ساعة</option><option value="day">يوم</option></select></label>
          </> : null}
        </div>
      </section>

      <section className="crm-panel settings-card full">
        <h2>رسالة بداية الأوتوميشن</h2>
        <p className="crm-help-text">تُرسل في رسالة واحدة: الترحيب، ثم طلب اختيار الخدمة، ثم الاختيارات النشطة.</p>
        <div className="crm-form-grid crm-form-grid-wide">
          {textArea("رسالة الترحيب", form.messages.greeting, (value) => setForm({ ...form, messages: { ...form.messages, greeting: value } }), 4)}
          {textArea("رسالة طلب اختيار الخدمة", form.messages.servicePrompt, (value) => setForm({ ...form, messages: { ...form.messages, servicePrompt: value } }), 4)}
          {textArea("الرد غير المطابق", form.messages.noMatch, (value) => setForm({ ...form, messages: { ...form.messages, noMatch: value } }), 4)}
        </div>
      </section>

      <section className="crm-panel settings-card full">
        <h2>اختيارات الخدمة</h2>
        <p className="crm-help-text">الخدمات الثلاث ومسار كل خدمة ثابتان حسب الفلو المعتمد. يمكن تعديل الاسم والرمز والردود المقبولة وحالة الظهور والترتيب فقط.</p>
        <div className="crm-service-option-editor">
          {[...form.choices].sort((a, b) => a.sortOrder - b.sortOrder).map((choice) => (
            <article key={choice.key}>
              <strong>{choice.emoji} {choice.label}</strong>
              <label className="crm-switch-row"><input type="checkbox" checked={choice.enabled} onChange={(event) => updateChoice(choice.key, { enabled: event.target.checked })} /><span>الاختيار نشط</span></label>
              <label><span>الاسم الظاهر</span><input value={choice.label} onChange={(event) => updateChoice(choice.key, { label: event.target.value })} /></label>
              <label><span>Emoji</span><input value={choice.emoji} onChange={(event) => updateChoice(choice.key, { emoji: event.target.value })} /></label>
              <label><span>الردود المقبولة</span><input value={choice.aliases.join("، ")} onChange={(event) => updateChoice(choice.key, { aliases: event.target.value.split(/[،,]/).map((item) => item.trim()).filter(Boolean) })} /></label>
              <label><span>الترتيب</span><input type="number" min={1} value={choice.sortOrder} onChange={(event) => updateChoice(choice.key, { sortOrder: Math.max(1, Number(event.target.value) || 1) })} /></label>
              <small>الكود الداخلي الثابت: {choice.key}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="crm-panel settings-card full">
        <h2>فلو مبيعات الكاش</h2>
        {textArea("رسالة التحويل والنهاية", form.flows.cash.completionMessage, (value) => setForm({ ...form, flows: { ...form.flows, cash: { completionMessage: value } } }), 5)}
      </section>

      <section className="crm-panel settings-card full">
        <h2>فلو مبيعات التمويل</h2>
        <p className="crm-help-text">الترتيب ثابت: الاسم ← السيارة ← رقم الجوال ← رسالة النهاية. كل إجابة تُحفظ مباشرة في بيانات العميل.</p>
        <div className="crm-form-grid crm-form-grid-wide">
          {textArea("رسالة بداية بيانات التمويل", form.flows.finance.startMessage, (value) => setForm({ ...form, flows: { ...form.flows, finance: { ...form.flows.finance, startMessage: value } } }))}
          {textArea("سؤال الاسم", form.flows.finance.nameQuestion, (value) => setForm({ ...form, flows: { ...form.flows, finance: { ...form.flows.finance, nameQuestion: value } } }))}
          {textArea("رسالة خطأ الاسم", form.flows.finance.nameError, (value) => setForm({ ...form, flows: { ...form.flows, finance: { ...form.flows.finance, nameError: value } } }))}
          {textArea("سؤال السيارة", form.flows.finance.carQuestion, (value) => setForm({ ...form, flows: { ...form.flows, finance: { ...form.flows.finance, carQuestion: value } } }))}
          {textArea("رسالة خطأ السيارة", form.flows.finance.carError, (value) => setForm({ ...form, flows: { ...form.flows, finance: { ...form.flows.finance, carError: value } } }))}
          {textArea("سؤال رقم الجوال", form.flows.finance.phoneQuestion, (value) => setForm({ ...form, flows: { ...form.flows, finance: { ...form.flows.finance, phoneQuestion: value } } }))}
          {textArea("رسالة خطأ رقم الجوال", form.flows.finance.phoneError, (value) => setForm({ ...form, flows: { ...form.flows, finance: { ...form.flows.finance, phoneError: value } } }))}
          {textArea("رسالة نهاية التمويل", form.flows.finance.completionMessage, (value) => setForm({ ...form, flows: { ...form.flows, finance: { ...form.flows.finance, completionMessage: value } } }), 5)}
        </div>
      </section>

      <section className="crm-panel settings-card full">
        <h2>فلو خدمة العملاء</h2>
        {textArea("رسالة التحويل والنهاية", form.flows.service.completionMessage, (value) => setForm({ ...form, flows: { ...form.flows, service: { completionMessage: value } } }), 5)}
      </section>

      <div className="crm-settings-save full">
        <button className="crm-secondary-button" type="button" disabled={!dirty || saving} onClick={() => saved && setForm(clone(saved))}>إلغاء التغييرات</button>
        <button className="crm-primary-button" type="button" disabled={!dirty || saving} onClick={() => void save()}><FloppyDisk size={18} />{saving ? "جاري الحفظ..." : "حفظ إعدادات الأوتوميشن"}</button>
      </div>
    </div>
  );
}
