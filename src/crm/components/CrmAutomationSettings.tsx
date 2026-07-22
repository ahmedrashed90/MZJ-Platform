import { useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  CaretDown,
  CaretUp,
  CheckCircle,
  Eye,
  FloppyDisk,
  GitBranch,
  Plus,
  Robot,
  Trash,
} from "@phosphor-icons/react";
import { crmFetch } from "../api";

const blankMessage = (text = "", enabled = true) => ({ enabled, text });
const blankStep = (index = 0) => ({
  key: `step_${Date.now()}_${index}`,
  name: "سؤال جديد",
  prompt: "",
  sortOrder: (index + 1) * 10,
  answerType: "text",
  fieldKey: "",
  required: true,
  errorMessage: "برجاء إدخال البيانات بصورة صحيحة.",
  maxAttempts: 3,
  active: true,
  options: [] as Array<{ value: string; label: string }>,
});
const blankOption = (index = 0) => ({
  key: `service_${Date.now()}_${index}`,
  label: "خدمة جديدة",
  emoji: "🔹",
  active: true,
  sortOrder: (index + 1) * 10,
  serviceKey: "cash",
  departmentCode: "cash_sales",
  defaultBranch: "",
  flowType: "questions",
  aliases: [] as string[],
  startMessage: blankMessage("", false),
  endMessage: blankMessage("تم استلام طلبك وسيتم التواصل معك في أقرب وقت."),
  steps: [] as any[],
  system: false,
});

function move<T extends { sortOrder?: number }>(rows: T[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  [next[index], next[target]] = [next[target], next[index]];
  return next.map((row, rowIndex) => ({ ...row, sortOrder: (rowIndex + 1) * 10 }));
}

function appendOrdered<T extends { sortOrder?: number }>(rows: T[], row: T) {
  const nextOrder = Math.max(0, ...rows.map((item) => Number(item.sortOrder || 0))) + 10;
  return [...rows, { ...row, sortOrder: nextOrder }];
}

function removeOrdered<T extends { sortOrder?: number }>(rows: T[], index: number) {
  return rows.filter((_, rowIndex) => rowIndex !== index).map((row, rowIndex) => ({ ...row, sortOrder: (rowIndex + 1) * 10 }));
}

function messageEditor(title: string, value: any, onChange: (value: any) => void) {
  return (
    <article className="crm-automation-message-card">
      <label className="crm-switch-row"><input type="checkbox" checked={value.enabled} onChange={(event) => onChange({ ...value, enabled: event.target.checked })} /><span>{title}</span></label>
      <textarea rows={4} disabled={!value.enabled} value={value.text} onChange={(event) => onChange({ ...value, text: event.target.value })} />
      <small>{value.text.length} حرف</small>
    </article>
  );
}

export function CrmAutomationSettings() {
  const [data, setData] = useState<any>({ settings: null, workers: [], fields: [], departments: [], branches: [] });
  const [form, setForm] = useState<any>(null);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [selectedOption, setSelectedOption] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [notice, setNotice] = useState("");

  const dirty = Boolean(form && savedSnapshot && JSON.stringify(form) !== savedSnapshot);
  const option = form?.serviceOptions?.[selectedOption] || null;

  async function load() {
    setLoading(true);
    try {
      const result = await crmFetch<any>("/api/crm/automation-settings");
      setData(result);
      setForm(result.settings);
      setSavedSnapshot(JSON.stringify(result.settings));
      setSelectedOption(0);
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
      const result = await crmFetch<any>("/api/crm/automation-settings", { method: "PUT", body: JSON.stringify(form) });
      setForm(result.settings);
      setSavedSnapshot(JSON.stringify(result.settings));
      setNotice(result.message || "تم حفظ إعدادات الأوتوميشن");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر حفظ إعدادات الأوتوميشن");
    } finally {
      setSaving(false);
    }
  }

  function patch(key: string, value: any) { setForm((current: any) => ({ ...current, [key]: value })); }
  function patchMessage(key: string, value: any) { setForm((current: any) => ({ ...current, messages: { ...current.messages, [key]: value } })); }
  function patchOption(key: string, value: any) {
    setForm((current: any) => ({
      ...current,
      serviceOptions: current.serviceOptions.map((row: any, index: number) => index === selectedOption ? { ...row, [key]: value } : row),
    }));
  }
  function patchStep(index: number, key: string, value: any) {
    patchOption("steps", option.steps.map((row: any, rowIndex: number) => rowIndex === index ? { ...row, [key]: value } : row));
  }

  const activePreviewOptions = useMemo(() => (form?.serviceOptions || []).filter((row: any) => row.active).sort((a: any, b: any) => a.sortOrder - b.sortOrder), [form]);

  if (!form) return <div className="crm-loading-panel">{loading ? "جاري تحميل إعدادات الأوتوميشن..." : notice || "لا توجد إعدادات"}</div>;

  return (
    <div className="crm-automation-settings">
      <section className="crm-automation-hero">
        <div><Robot size={32} weight="duotone" /><span><h2>إعدادات الأوتوميشن</h2><p>المصدر المركزي الوحيد لرسائل الدخول، اختيارات الخدمات، الفلو والأسئلة. قواعد توزيع الموظفين تعمل بصورة مستقلة بعد تحديد الخدمة.</p></span></div>
        <nav><button className="crm-secondary-button" onClick={() => void load()} disabled={loading}><ArrowClockwise size={17} />إعادة تحميل</button><button className="crm-primary-button" onClick={() => void save()} disabled={saving || !dirty}><FloppyDisk size={17} />{saving ? "جاري الحفظ..." : "حفظ الإعدادات"}</button></nav>
      </section>

      {notice ? <div className="crm-inline-notice">{notice}</div> : null}
      {dirty ? <div className="crm-automation-unsaved">لديك تعديلات غير محفوظة.</div> : null}

      <section className="crm-panel crm-automation-section">
        <header><div><h2>الحالة العامة</h2><p>تعطيل الأوتوميشن لا يمنع حفظ رسائل العملاء الواردة.</p></div></header>
        <div className="crm-form-grid crm-form-grid-wide">
          <label className="crm-switch-row"><input type="checkbox" checked={form.enabled} onChange={(event) => patch("enabled", event.target.checked)} /><span>الأوتوميشن نشط</span></label>
          <label><span>اسم الأوتوميشن</span><input value={form.name} onChange={(event) => patch("name", event.target.value)} /></label>
        </div>
      </section>

      <section className="crm-panel crm-automation-section">
        <header><div><h2>المنصات والـ Workers</h2><p>تشغيل الـWorker هنا خاص باستقبال وإرسال الرسائل فقط، ولا يختار الموظف المستلم للعميل.</p></div></header>
        <div className="crm-automation-worker-grid">
          {data.workers.map((worker: any) => {
            const binding = form.platformWorkers.find((row: any) => row.workerCode === worker.workerCode && row.platformCode === worker.platformCode);
            return <article key={`${worker.platformCode}:${worker.workerCode}`} className={binding?.enabled ? "active" : ""}><div><strong>{worker.displayName}</strong><small>{worker.platformCode} · {worker.workerCode}</small></div><span>{worker.inboundConnected ? "استقبال مربوط" : "مسار الاستقبال غير مسجل"} · {worker.outboundConnected ? "إرسال مربوط" : "مسار الإرسال غير مسجل"}</span><label className="crm-switch-row"><input type="checkbox" disabled={!worker.active} checked={binding?.enabled === true} onChange={(event) => {
              const exists = form.platformWorkers.some((row: any) => row.workerCode === worker.workerCode && row.platformCode === worker.platformCode);
              const next = exists
                ? form.platformWorkers.map((row: any) => row.workerCode === worker.workerCode && row.platformCode === worker.platformCode ? { ...row, enabled: event.target.checked } : row)
                : [...form.platformWorkers, { platformCode: worker.platformCode, workerCode: worker.workerCode, enabled: event.target.checked }];
              patch("platformWorkers", next);
            }} /><span>تشغيل الأوتوميشن</span></label></article>;
          })}
        </div>
      </section>

      <section className="crm-panel crm-automation-section">
        <header><div><h2>سياسة التشغيل</h2><p>لا يبدأ Trigger جديد أثناء انتظار إجابة داخل فلو نشط.</p></div></header>
        <div className="crm-form-grid crm-form-grid-wide">
          <label><span>متى يتم تشغيل الأوتوميشن؟</span><select value={form.triggerMode} onChange={(event) => patch("triggerMode", event.target.value)}><option value="every_message">مع كل رسالة واردة</option><option value="once_24h">مرة كل 24 ساعة</option><option value="custom">مدة مخصصة</option></select></label>
          {form.triggerMode === "custom" ? <><label><span>قيمة المدة</span><input type="number" min={1} value={form.customIntervalValue} onChange={(event) => patch("customIntervalValue", Number(event.target.value))} /></label><label><span>وحدة المدة</span><select value={form.customIntervalUnit} onChange={(event) => patch("customIntervalUnit", event.target.value)}><option value="minute">دقيقة</option><option value="hour">ساعة</option><option value="day">يوم</option></select></label></> : null}
          <label className="crm-switch-row"><input type="checkbox" checked={form.scheduleEnabled} onChange={(event) => patch("scheduleEnabled", event.target.checked)} /><span>تشغيل في أوقات وأيام محددة</span></label>
          {form.scheduleEnabled ? <><label><span>وقت البداية</span><input type="time" value={form.scheduleStart} onChange={(event) => patch("scheduleStart", event.target.value)} /></label><label><span>وقت النهاية</span><input type="time" value={form.scheduleEnd} onChange={(event) => patch("scheduleEnd", event.target.value)} /></label><div className="crm-field-wide"><span className="crm-field-caption">أيام التشغيل</span><div className="crm-check-grid">{["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"].map((label, day) => <label key={label}><input type="checkbox" checked={form.scheduleDays.includes(day)} onChange={() => patch("scheduleDays", form.scheduleDays.includes(day) ? form.scheduleDays.filter((row: number) => row !== day) : [...form.scheduleDays, day])} />{label}</label>)}</div></div></> : null}
        </div>
      </section>

      <section className="crm-panel crm-automation-section">
        <header><div><h2>رسائل بداية الأوتوميشن</h2><p>تُرسل الرسائل المفعلة بالترتيب التالي فقط.</p></div></header>
        <div className="crm-automation-message-grid">
          {messageEditor("1. رسالة البداية", form.messages.start, (value) => patchMessage("start", value))}
          {messageEditor("2. رسالة الترحيب", form.messages.welcome, (value) => patchMessage("welcome", value))}
          {messageEditor("3. طلب اختيار الخدمة", form.messages.servicePrompt, (value) => patchMessage("servicePrompt", value))}
          {messageEditor("الرد غير المطابق", form.messages.noMatch, (value) => patchMessage("noMatch", value))}
          {messageEditor("رسالة تحقق افتراضية", form.messages.validationFallback, (value) => patchMessage("validationFallback", value))}
          {messageEditor("رسالة إلغاء الفلو", form.messages.cancelled, (value) => patchMessage("cancelled", value))}
          {messageEditor("رسالة إعادة البداية", form.messages.restarted, (value) => patchMessage("restarted", value))}
        </div>
      </section>

      <section className="crm-panel crm-automation-section">
        <header><div><h2>اختيارات الأوتوميشن ومنشئ الفلو</h2><p>اختيار الخدمة يحدد القسم ثم يستدعي محرك التوزيع الأصلي مرة واحدة. نجاح أو فشل التوزيع لا يوقف الأسئلة.</p></div><button className="crm-secondary-button" onClick={() => { const next = appendOrdered(form.serviceOptions, blankOption(form.serviceOptions.length)); patch("serviceOptions", next); setSelectedOption(next.length - 1); }}><Plus size={17} />إضافة اختيار</button></header>
        <div className="crm-automation-builder">
          <aside>{form.serviceOptions.map((row: any, index: number) => <article key={row.key} className={`${index === selectedOption ? "selected" : ""} ${!row.active ? "inactive" : ""}`} onClick={() => setSelectedOption(index)}><b>{row.emoji}</b><span><strong>{row.label}</strong><small>{row.key} · {row.active ? "نشط" : "موقوف"}</small></span><nav><button type="button" disabled={index === 0} onClick={(event) => { event.stopPropagation(); patch("serviceOptions", move(form.serviceOptions, index, -1)); setSelectedOption(index - 1); }}><CaretUp size={14} /></button><button type="button" disabled={index === form.serviceOptions.length - 1} onClick={(event) => { event.stopPropagation(); patch("serviceOptions", move(form.serviceOptions, index, 1)); setSelectedOption(index + 1); }}><CaretDown size={14} /></button></nav></article>)}</aside>
          {option ? <div className="crm-automation-option-editor">
            <div className="crm-form-grid crm-form-grid-wide">
              <label><span>الاسم الظاهر</span><input value={option.label} onChange={(event) => patchOption("label", event.target.value)} /></label>
              <label><span>Emoji</span><input value={option.emoji} onChange={(event) => patchOption("emoji", event.target.value)} /></label>
              <label><span>الكود الداخلي الثابت</span><input disabled={option.system} value={option.key} onChange={(event) => patchOption("key", event.target.value)} /></label>
              <label><span>الخدمة</span><select value={option.serviceKey} onChange={(event) => patchOption("serviceKey", event.target.value)}><option value="cash">كاش</option><option value="finance">تمويل</option><option value="service">خدمة العملاء</option></select></label>
              <label><span>نوع الفلو</span><select value={option.flowType || "questions"} onChange={(event) => patchOption("flowType", event.target.value)}><option value="questions">أسئلة متتابعة</option><option value="message">رسالة فقط بدون أسئلة</option></select></label>
              <label><span>القسم المرتبط</span><select value={option.departmentCode} onChange={(event) => patchOption("departmentCode", event.target.value)}>{data.departments.map((row: any) => <option key={row.code} value={row.code}>{row.name}</option>)}</select></label>
              <label><span>الفرع الافتراضي</span><select value={option.defaultBranch} onChange={(event) => patchOption("defaultBranch", event.target.value)}><option value="">حسب منطق النظام</option>{data.branches.map((row: any) => <option key={row.code} value={row.code}>{row.name}</option>)}</select></label>
              <label className="crm-field-wide"><span>الردود المقبولة</span><input value={(option.aliases || []).join("، ")} onChange={(event) => patchOption("aliases", event.target.value.split(/[،,]/).map((row) => row.trim()).filter(Boolean))} /></label>
              <label className="crm-switch-row"><input type="checkbox" checked={option.active} onChange={(event) => patchOption("active", event.target.checked)} /><span>الاختيار نشط</span></label>
            </div>
            <div className="crm-automation-option-messages">{messageEditor("رسالة بداية الفلو", option.startMessage, (value) => patchOption("startMessage", value))}{messageEditor("رسالة نهاية الفلو", option.endMessage, (value) => patchOption("endMessage", value))}</div>

            <div className="crm-automation-steps-head"><div><h3>خطوات الفلو</h3><p>يُرسل سؤال واحد فقط في كل مرة وتُحفظ الإجابة في حقل العميل المحدد.</p></div><button className="crm-secondary-button" disabled={option.flowType === "message"} onClick={() => patchOption("steps", appendOrdered(option.steps, blankStep(option.steps.length)))}><Plus size={16} />إضافة خطوة</button></div>
            {option.flowType === "message" ? <div className="crm-inline-notice">هذا الفلو يرسل رسالة البداية ثم رسالة النهاية بدون انتظار إجابات. الخطوات المحفوظة لن تعمل حتى تعيد النوع إلى «أسئلة متتابعة».</div> : null}
            <div className="crm-automation-steps">
              {option.steps.map((step: any, index: number) => <article key={step.key} className={!step.active ? "inactive" : ""}>
                <header><b>{index + 1}</b><strong>{step.name || "خطوة"}</strong><nav><button type="button" disabled={index === 0} onClick={() => patchOption("steps", move(option.steps, index, -1))}><CaretUp size={14} /></button><button type="button" disabled={index === option.steps.length - 1} onClick={() => patchOption("steps", move(option.steps, index, 1))}><CaretDown size={14} /></button><button type="button" onClick={() => { if (!window.confirm("حذف هذه الخطوة من الفلو؟ سيتم الاحتفاظ بسجل الإجابات القديمة.")) return; patchOption("steps", removeOrdered(option.steps, index)); }}><Trash size={14} /></button></nav></header>
                <div className="crm-form-grid crm-form-grid-wide">
                  <label><span>اسم داخلي</span><input value={step.name} onChange={(event) => patchStep(index, "name", event.target.value)} /></label>
                  <label><span>كود الخطوة</span><input value={step.key} onChange={(event) => patchStep(index, "key", event.target.value)} /></label>
                  <label className="crm-field-wide"><span>السؤال أو الرسالة</span><textarea rows={3} value={step.prompt} onChange={(event) => patchStep(index, "prompt", event.target.value)} /></label>
                  <label><span>نوع الإجابة</span><select value={step.answerType} onChange={(event) => patchStep(index, "answerType", event.target.value)}><option value="text">نص</option><option value="phone">رقم جوال</option><option value="number">رقم</option><option value="email">بريد إلكتروني</option><option value="select">اختيار من قائمة</option><option value="date">تاريخ</option><option value="message">بدون إجابة</option></select></label>
                  <label><span>حقل حفظ الإجابة</span><select disabled={step.answerType === "message"} value={step.fieldKey} onChange={(event) => patchStep(index, "fieldKey", event.target.value)}><option value="">اختر الحقل</option>{data.fields.map((row: any) => <option key={row.field_key} value={row.field_key}>{row.label}</option>)}</select></label>
                  <label><span>عدد المحاولات</span><input type="number" min={1} value={step.maxAttempts} onChange={(event) => patchStep(index, "maxAttempts", Number(event.target.value))} /></label>
                  <label className="crm-field-wide"><span>رسالة خطأ التحقق</span><input value={step.errorMessage} onChange={(event) => patchStep(index, "errorMessage", event.target.value)} /></label>
                  {step.answerType === "select" ? <label className="crm-field-wide"><span>اختيارات القائمة — كل سطر: القيمة|الاسم</span><textarea rows={4} value={(step.options || []).map((row: any) => `${row.value}|${row.label}`).join("\n")} onChange={(event) => patchStep(index, "options", event.target.value.split(/\r?\n/).map((line) => { const [value, ...rest] = line.split("|"); return { value: value.trim(), label: rest.join("|").trim() || value.trim() }; }).filter((row) => row.value))} /></label> : null}
                  <label className="crm-switch-row"><input type="checkbox" checked={step.required} onChange={(event) => patchStep(index, "required", event.target.checked)} /><span>إجبارية</span></label>
                  <label className="crm-switch-row"><input type="checkbox" checked={step.active} onChange={(event) => patchStep(index, "active", event.target.checked)} /><span>الخطوة نشطة</span></label>
                </div>
              </article>)}
              {!option.steps.length ? <div className="crm-empty-state">لا توجد أسئلة. بعد اختيار الخدمة سيتم إرسال رسالة النهاية مباشرة.</div> : null}
            </div>
            {!option.system ? <button className="crm-danger-button" onClick={() => { if (!window.confirm("حذف الاختيار الجديد؟")) return; const next = removeOrdered(form.serviceOptions, selectedOption); patch("serviceOptions", next); setSelectedOption(Math.max(0, selectedOption - 1)); }}><Trash size={16} />حذف الاختيار</button> : null}
          </div> : null}
        </div>
      </section>

      <section className="crm-panel crm-automation-section">
        <header><div><h2>انتهاء الفلو والتحكم</h2><p>إجابات العميل لا تُعتبر Trigger جديدًا أثناء الفلو.</p></div></header>
        <div className="crm-form-grid crm-form-grid-wide">
          <label><span>مدة انتظار إجابة العميل</span><input type="number" min={1} value={form.flowTimeoutValue} onChange={(event) => patch("flowTimeoutValue", Number(event.target.value))} /></label>
          <label><span>الوحدة</span><select value={form.flowTimeoutUnit} onChange={(event) => patch("flowTimeoutUnit", event.target.value)}><option value="minute">دقيقة</option><option value="hour">ساعة</option></select></label>
          <label className="crm-field-wide"><span>كلمات إعادة البداية</span><input value={form.restartKeywords.join("، ")} onChange={(event) => patch("restartKeywords", event.target.value.split(/[،,]/).map((row) => row.trim()).filter(Boolean))} /></label>
          <label className="crm-field-wide"><span>كلمات إلغاء الفلو</span><input value={form.cancelKeywords.join("، ")} onChange={(event) => patch("cancelKeywords", event.target.value.split(/[،,]/).map((row) => row.trim()).filter(Boolean))} /></label>
        </div>
      </section>

      <section className="crm-panel crm-automation-section crm-automation-boundary">
        <header><div><h2>حدود الربط مع التوزيع</h2><p>الأوتوميشن يحفظ الخدمة والبيانات ويكمل الفلو. محرك توزيع الموظفين يحاول الإسناد بصورة مستقلة، ولا يرسل رسائل ولا يغير خطوة الفلو.</p></div><button className="crm-secondary-button" onClick={() => setPreview((value) => !value)}><Eye size={17} />{preview ? "إخفاء المعاينة" : "معاينة الفلو"}</button></header>
        <div className="crm-automation-boundary-grid"><span><GitBranch size={22} /><b>اختيار الخدمة</b><small>من إعدادات الأوتوميشن</small></span><span><CheckCircle size={22} /><b>إنشاء الطلب</b><small>مرة واحدة مع منع التكرار</small></span><span><Robot size={22} /><b>استكمال الأسئلة</b><small>لا ينتظر نتيجة التوزيع</small></span></div>
        {preview ? <div className="crm-automation-preview"><div className="crm-preview-bubble bot">{form.messages.start.enabled ? form.messages.start.text : null}</div><div className="crm-preview-bubble bot">{form.messages.welcome.enabled ? form.messages.welcome.text : null}</div><div className="crm-preview-bubble bot">{[form.messages.servicePrompt.enabled ? form.messages.servicePrompt.text : "", activePreviewOptions.map((row: any, index: number) => optionDisplay(row, index)).join("\n")].filter(Boolean).join("\n\n")}</div>{activePreviewOptions.map((row: any) => <article key={row.key}><h4>{row.emoji} {row.label}</h4>{row.startMessage.enabled ? <div className="crm-preview-bubble bot">{row.startMessage.text}</div> : null}{row.flowType === "message" ? null : row.steps.filter((step: any) => step.active).sort((a: any, b: any) => a.sortOrder - b.sortOrder).map((step: any) => <div className="crm-preview-bubble bot" key={step.key}>{step.prompt}</div>)}{row.endMessage.enabled ? <div className="crm-preview-bubble bot">{row.endMessage.text}</div> : null}</article>)}</div> : null}
      </section>

      <div className="crm-settings-save"><button className="crm-secondary-button" disabled={!dirty} onClick={() => setForm(JSON.parse(savedSnapshot))}>إلغاء التغييرات</button><button className="crm-primary-button" disabled={saving || !dirty} onClick={() => void save()}><FloppyDisk size={18} />{saving ? "جاري الحفظ..." : "حفظ إعدادات الأوتوميشن"}</button></div>
    </div>
  );
}

function optionDisplay(option: any, index: number) {
  return `${index + 1}- ${option.emoji ? `${option.emoji} ` : ""}${option.label}`;
}
