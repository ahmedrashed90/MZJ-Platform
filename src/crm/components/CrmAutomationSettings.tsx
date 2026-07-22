import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, Eye, FloppyDisk, Robot } from "@phosphor-icons/react";
import { crmFetch } from "../api";

function splitReplies(value: string) {
  return value.split(/[،,\n]/).map((row) => row.trim()).filter(Boolean);
}

function textEditor(title: string, value: string, onChange: (value: string) => void, rows = 3, hint = "") {
  return (
    <label className="crm-field-wide crm-automation-fixed-field">
      <span>{title}</span>
      <textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} />
      <small>{hint || `${value.length} حرف`}</small>
    </label>
  );
}

function optionDisplay(option: any) {
  return `${option.emoji ? `${option.emoji} ` : ""}${option.label}`;
}

export function CrmAutomationSettings() {
  const [form, setForm] = useState<any>(null);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [notice, setNotice] = useState("");

  const dirty = Boolean(form && savedSnapshot && JSON.stringify(form) !== savedSnapshot);
  const optionsByKey = useMemo(() => new Map<string, any>((form?.serviceOptions || []).map((row: any) => [String(row.key), row] as [string, any])), [form]);
  const cash: any = optionsByKey.get("cash");
  const finance: any = optionsByKey.get("finance");
  const service: any = optionsByKey.get("service");

  async function load() {
    setLoading(true);
    try {
      const result = await crmFetch<any>("/api/crm/automation-settings");
      setForm(result.settings);
      setSavedSnapshot(JSON.stringify(result.settings));
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل إعدادات الأوتوميشن");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save() {
    setSaving(true);
    setNotice("");
    try {
      const result = await crmFetch<any>("/api/crm/automation-settings", {
        method: "PUT",
        body: JSON.stringify(form),
      });
      setForm(result.settings);
      setSavedSnapshot(JSON.stringify(result.settings));
      setNotice(result.message || "تم حفظ رسائل وردود الأوتوميشن");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر حفظ إعدادات الأوتوميشن");
    } finally {
      setSaving(false);
    }
  }

  function patchMessage(key: string, text: string) {
    setForm((current: any) => ({
      ...current,
      messages: { ...current.messages, [key]: { ...current.messages[key], enabled: true, text } },
    }));
  }

  function patchOption(optionKey: string, updater: (option: any) => any) {
    setForm((current: any) => ({
      ...current,
      serviceOptions: current.serviceOptions.map((row: any) => row.key === optionKey ? updater(row) : row),
    }));
  }

  function patchOptionMessage(optionKey: string, messageKey: "startMessage" | "endMessage", text: string) {
    patchOption(optionKey, (row) => ({ ...row, [messageKey]: { ...row[messageKey], enabled: true, text } }));
  }

  function patchReplies(optionKey: string, value: string) {
    patchOption(optionKey, (row) => ({ ...row, aliases: splitReplies(value) }));
  }

  function patchFinanceStep(stepKey: string, field: "prompt" | "errorMessage", value: string) {
    patchOption("finance", (row) => ({
      ...row,
      steps: row.steps.map((step: any) => step.key === stepKey ? { ...step, [field]: value } : step),
    }));
  }

  if (!form) {
    return <div className="crm-loading-panel">{loading ? "جاري تحميل إعدادات الأوتوميشن..." : notice || "لا توجد إعدادات"}</div>;
  }

  const financeSteps = new Map((finance?.steps || []).map((row: any) => [row.key, row]));
  const nameStep: any = financeSteps.get("name");
  const carStep: any = financeSteps.get("car");
  const phoneStep: any = financeSteps.get("phone");
  const activeOptions = [cash, finance, service].filter(Boolean);
  const startPreview = [
    form.messages.welcome.text,
    form.messages.servicePrompt.text,
    activeOptions.map(optionDisplay).join("\n"),
  ].filter(Boolean).join("\n\n");

  return (
    <div className="crm-automation-settings">
      <section className="crm-automation-hero">
        <div>
          <Robot size={32} weight="duotone" />
          <span>
            <h2>إعدادات الأوتوميشن</h2>
            <p>الفلو ثابت حسب السيناريو المعتمد. المتاح هنا فقط تعديل نصوص الرسائل والردود المقبولة.</p>
          </span>
        </div>
        <nav>
          <button className="crm-secondary-button" onClick={() => void load()} disabled={loading}><ArrowClockwise size={17} />إعادة تحميل</button>
          <button className="crm-primary-button" onClick={() => void save()} disabled={saving || !dirty}><FloppyDisk size={17} />{saving ? "جاري الحفظ..." : "حفظ الرسائل والردود"}</button>
        </nav>
      </section>

      {notice ? <div className="crm-inline-notice">{notice}</div> : null}
      {dirty ? <div className="crm-automation-unsaved">لديك تعديلات غير محفوظة.</div> : null}

      <section className="crm-panel crm-automation-section">
        <header>
          <div><h2>رسالة العميل الجديد</h2><p>أول رسالة واردة من عميل لا يوجد له طلب خدمة مفتوح تبدأ الأوتوميشن، مهما كان نص الرسالة.</p></div>
        </header>
        <div className="crm-form-grid crm-form-grid-wide">
          {textEditor("رسالة الترحيب", form.messages.welcome.text, (value) => patchMessage("welcome", value), 3)}
          {textEditor("رسالة طلب اختيار الخدمة", form.messages.servicePrompt.text, (value) => patchMessage("servicePrompt", value), 3, "قائمة الخدمات والأزرار تُضاف تلقائيًا بعد الرسالة.")}
          {textEditor("الرد عند كتابة اختيار غير معروف", form.messages.noMatch.text, (value) => patchMessage("noMatch", value), 3)}
        </div>
      </section>

      <section className="crm-panel crm-automation-section crm-automation-fixed-option">
        <header><div><h2>💰 مبيعات الكاش</h2><p>اختيار الخدمة يحدد قسم مبيعات الكاش ويطلب التوزيع مرة واحدة، ثم يرسل الرسالة التالية.</p></div></header>
        <div className="crm-form-grid crm-form-grid-wide">
          <label className="crm-field-wide"><span>الردود المقبولة</span><input value={(cash?.aliases || []).join("، ")} onChange={(event) => patchReplies("cash", event.target.value)} /><small>الرقم 1 وزر «مبيعات الكاش» ثابتان ويعملان تلقائيًا.</small></label>
          {textEditor("رسالة مبيعات الكاش", cash?.endMessage?.text || "", (value) => patchOptionMessage("cash", "endMessage", value), 4)}
        </div>
      </section>

      <section className="crm-panel crm-automation-section crm-automation-fixed-option">
        <header><div><h2>🏦 مبيعات التمويل</h2><p>بعد اختيار التمويل تُرسل رسالة البداية مع سؤال الاسم، ثم السيارة، ثم رقم الجوال، ثم رسالة النهاية.</p></div></header>
        <div className="crm-form-grid crm-form-grid-wide">
          <label className="crm-field-wide"><span>الردود المقبولة</span><input value={(finance?.aliases || []).join("، ")} onChange={(event) => patchReplies("finance", event.target.value)} /><small>الرقم 2 وزر «مبيعات التمويل» ثابتان ويعملان تلقائيًا.</small></label>
          {textEditor("رسالة بداية بيانات التمويل", finance?.startMessage?.text || "", (value) => patchOptionMessage("finance", "startMessage", value), 3, "تُرسل في نفس الرسالة مع سؤال الاسم.")}
          {textEditor("سؤال الاسم", nameStep?.prompt || "", (value) => patchFinanceStep("name", "prompt", value), 2)}
          {textEditor("رسالة خطأ الاسم", nameStep?.errorMessage || "", (value) => patchFinanceStep("name", "errorMessage", value), 2)}
          {textEditor("سؤال السيارة", carStep?.prompt || "", (value) => patchFinanceStep("car", "prompt", value), 2)}
          {textEditor("رسالة خطأ السيارة", carStep?.errorMessage || "", (value) => patchFinanceStep("car", "errorMessage", value), 2)}
          {textEditor("سؤال رقم الجوال", phoneStep?.prompt || "", (value) => patchFinanceStep("phone", "prompt", value), 2)}
          {textEditor("رسالة خطأ رقم الجوال", phoneStep?.errorMessage || "", (value) => patchFinanceStep("phone", "errorMessage", value), 2)}
          {textEditor("رسالة نهاية التمويل", finance?.endMessage?.text || "", (value) => patchOptionMessage("finance", "endMessage", value), 4)}
        </div>
      </section>

      <section className="crm-panel crm-automation-section crm-automation-fixed-option">
        <header><div><h2>🛠 خدمة العملاء</h2><p>اختيار الخدمة يحدد قسم خدمة العملاء ويطلب التوزيع مرة واحدة، ثم يرسل الرسالة التالية.</p></div></header>
        <div className="crm-form-grid crm-form-grid-wide">
          <label className="crm-field-wide"><span>الردود المقبولة</span><input value={(service?.aliases || []).join("، ")} onChange={(event) => patchReplies("service", event.target.value)} /><small>الرقم 3 وزر «خدمة العملاء» ثابتان ويعملان تلقائيًا.</small></label>
          {textEditor("رسالة خدمة العملاء", service?.endMessage?.text || "", (value) => patchOptionMessage("service", "endMessage", value), 4)}
        </div>
      </section>

      <section className="crm-panel crm-automation-section crm-automation-boundary">
        <header>
          <div><h2>معاينة الفلو الثابت</h2><p>المعاينة لا ترسل أي رسالة حقيقية.</p></div>
          <button className="crm-secondary-button" onClick={() => setPreview((value) => !value)}><Eye size={17} />{preview ? "إخفاء المعاينة" : "معاينة الفلو"}</button>
        </header>
        {preview ? <div className="crm-automation-preview">
          <div className="crm-preview-bubble bot">{startPreview}</div>
          <article><h4>💰 مبيعات الكاش</h4><div className="crm-preview-bubble bot">{cash?.endMessage?.text}</div></article>
          <article><h4>🏦 مبيعات التمويل</h4><div className="crm-preview-bubble bot">{[finance?.startMessage?.text, nameStep?.prompt].filter(Boolean).join("\n")}</div><div className="crm-preview-bubble bot">{carStep?.prompt}</div><div className="crm-preview-bubble bot">{phoneStep?.prompt}</div><div className="crm-preview-bubble bot">{finance?.endMessage?.text}</div></article>
          <article><h4>🛠 خدمة العملاء</h4><div className="crm-preview-bubble bot">{service?.endMessage?.text}</div></article>
        </div> : null}
      </section>

      <div className="crm-settings-save">
        <button className="crm-secondary-button" disabled={!dirty} onClick={() => setForm(JSON.parse(savedSnapshot))}>إلغاء التغييرات</button>
        <button className="crm-primary-button" disabled={saving || !dirty} onClick={() => void save()}><FloppyDisk size={18} />{saving ? "جاري الحفظ..." : "حفظ الرسائل والردود"}</button>
      </div>
    </div>
  );
}
