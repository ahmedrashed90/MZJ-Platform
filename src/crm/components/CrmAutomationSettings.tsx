import { useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  CaretDown,
  CaretUp,
  CheckCircle,
  FlowArrow,
  FloppyDisk,
  GearSix,
  Lightning,
  Plus,
  Robot,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { crmFetch } from "../api";

type Draft = {
  name: string;
  isActive: boolean;
  triggerPolicy: "every_message" | "once_24_hours" | "custom_duration";
  customValue: number;
  customUnit: "minute" | "hour" | "day";
  platforms: any[];
  startMessages: any[];
  choices: any[];
};

const platformLabels: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  tiktok: "TikTok",
};

function uid(prefix: string) { return `${prefix}_${Math.random().toString(36).slice(2, 9)}`; }
function move<T>(items: T[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
function secondsToCustom(seconds: number) {
  if (seconds > 0 && seconds % 86400 === 0) return { customValue: seconds / 86400, customUnit: "day" as const };
  if (seconds > 0 && seconds % 3600 === 0) return { customValue: seconds / 3600, customUnit: "hour" as const };
  return { customValue: Math.max(1, Math.round((seconds || 60) / 60)), customUnit: "minute" as const };
}
function customToSeconds(value: number, unit: Draft["customUnit"]) {
  return Math.max(1, Number(value || 1)) * (unit === "day" ? 86400 : unit === "hour" ? 3600 : 60);
}
function fromApi(result: any): Draft {
  const definition = result?.definition || {};
  const custom = secondsToCustom(Number(definition.trigger_interval_seconds || 60));
  return {
    name: definition.name || "أوتوميشن استقبال وتوزيع العملاء",
    isActive: definition.is_active !== false,
    triggerPolicy: definition.trigger_policy || "every_message",
    ...custom,
    platforms: (result?.platforms || []).map((item: any) => ({
      sourceCode: item.source_code,
      workerCode: item.worker_code || "",
      isEnabled: item.is_enabled === true,
      workerName: item.worker_name || "",
      workerIsActive: item.worker_is_active === true,
      workerSendUrl: item.worker_send_url || "",
      healthUrl: item.health_url || "",
      lastHealthStatus: item.last_health_status || "",
      lastHealthAt: item.last_health_at || "",
      lastSuccessAt: item.last_success_at || "",
      lastError: item.last_error || "",
    })),
    startMessages: (result?.startMessages || []).map((item: any) => ({
      localId: item.id || uid("message"),
      messageCode: item.message_code,
      body: item.body,
      isActive: item.is_active !== false,
    })),
    choices: (result?.choices || []).map((choice: any) => ({
      localId: choice.id || uid("choice"),
      choiceCode: choice.choice_code,
      displayName: choice.display_name,
      emoji: choice.emoji || "",
      departmentCode: choice.department_code,
      serviceKey: choice.service_key,
      branchPolicy: choice.branch_policy || "system",
      branchCode: choice.branch_code || "",
      finalAction: choice.final_action || {},
      finalMessage: choice.final_message || "",
      isActive: choice.is_active !== false,
      replies: (choice.replies || []).map((reply: any) => ({
        localId: reply.id || uid("reply"),
        replyType: reply.reply_type || "text",
        replyValue: reply.reply_value || "",
      })),
      steps: (choice.steps || []).map((step: any) => ({
        localId: step.id || uid("step"),
        stepCode: step.step_code,
        name: step.name,
        prompt: step.prompt,
        stepType: step.step_type || "text",
        customerFieldKey: step.customer_field_key || "",
        isRequired: step.is_required !== false,
        validationRules: step.validation_rules || {},
        validationErrorMessage: step.validation_error_message || "",
        maxAttempts: step.max_attempts ?? 3,
        isActive: step.is_active !== false,
        options: (step.options || []).map((option: any) => ({
          localId: option.id || uid("option"),
          optionCode: option.option_code || "",
          label: option.label || "",
          acceptedReplies: Array.isArray(option.accepted_replies) ? option.accepted_replies : [],
          isActive: option.is_active !== false,
        })),
      })),
    })),
  };
}

function newChoice(): any {
  const suffix = Date.now().toString(36);
  return {
    localId: uid("choice"), choiceCode: `service_${suffix}`, displayName: "خدمة جديدة", emoji: "✨",
    departmentCode: "cash_sales", serviceKey: "cash", branchPolicy: "system", branchCode: "",
    finalAction: { createOrUpdateCustomer: true, classifyService: true, requestDistribution: true, assignSales: true, assignCallCenter: false, assignCustomerService: false, sendFinalMessage: true },
    finalMessage: "سيتم التواصل معك قريباً", isActive: true,
    replies: [{ localId: uid("reply"), replyType: "text", replyValue: "خدمة جديدة" }], steps: [],
  };
}
function newStep(choiceCode: string): any {
  return {
    localId: uid("step"), stepCode: `${choiceCode}_step_${Date.now().toString(36)}`, name: "سؤال جديد", prompt: "اكتب السؤال هنا",
    stepType: "text", customerFieldKey: "", isRequired: true, validationRules: { minLength: 1, maxLength: 120 },
    validationErrorMessage: "برجاء إدخال إجابة صحيحة.", maxAttempts: 3, isActive: true, options: [],
  };
}

export function CrmAutomationSettings() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [endpoints, setEndpoints] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    try {
      const result = await crmFetch<any>("/api/crm/automation-settings");
      const next = fromApi(result);
      setDraft(next);
      setEndpoints(result.endpoints || []);
      setExpanded(next.choices[0]?.localId || "");
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل إعدادات الأوتوميشن");
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const previewMessages = useMemo(() => {
    if (!draft) return [];
    const messages = draft.startMessages.filter((item) => item.isActive && item.body).map((item) => ({ type: "start", body: item.body }));
    const activeChoice = draft.choices.find((item) => item.isActive);
    if (activeChoice?.steps?.length) messages.push(...activeChoice.steps.filter((step: any) => step.isActive).map((step: any) => ({ type: step.stepType === "message" ? "start" : "question", body: step.prompt, options: step.stepType === "choice" ? step.options.filter((option: any) => option.isActive) : [] })));
    if (activeChoice?.finalAction?.sendFinalMessage !== false && activeChoice?.finalMessage) messages.push({ type: "final", body: activeChoice.finalMessage });
    return messages;
  }, [draft]);

  function patchChoice(index: number, patch: Record<string, unknown>) {
    setDraft((current) => current ? ({ ...current, choices: current.choices.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }) : current);
  }
  function patchStep(choiceIndex: number, stepIndex: number, patch: Record<string, unknown>) {
    setDraft((current) => current ? ({
      ...current,
      choices: current.choices.map((choice, index) => index === choiceIndex ? {
        ...choice, steps: choice.steps.map((step: any, index2: number) => index2 === stepIndex ? { ...step, ...patch } : step),
      } : choice),
    }) : current);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const payload = {
        ...draft,
        triggerIntervalSeconds: draft.triggerPolicy === "custom_duration" ? customToSeconds(draft.customValue, draft.customUnit) : null,
      };
      const result = await crmFetch<any>("/api/crm/automation-settings", { method: "PUT", body: JSON.stringify({ automation: payload }) });
      setDraft(fromApi(result));
      setEndpoints(result.endpoints || endpoints);
      setNotice(result.message || "تم حفظ إعدادات الأوتوميشن");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر حفظ إعدادات الأوتوميشن");
    } finally { setSaving(false); }
  }

  if (!draft) return <div className="crm-automation-loading"><Robot size={32} weight="duotone" /><strong>{loading ? "جاري تحميل محرك الأوتوميشن..." : "تعذر تحميل الإعدادات"}</strong>{notice ? <span>{notice}</span> : null}</div>;

  return (
    <div className="crm-automation-settings">
      <section className="crm-automation-hero">
        <div className="crm-automation-hero-icon"><Robot size={34} weight="duotone" /></div>
        <div><span>CRM Automation Engine</span><h2>بناء فلو دخول العميل وإدارته من مكان واحد</h2><p>الرسائل والأسئلة والتحقق والإجراء النهائي هنا، بينما التوزيع الفعلي يظل مسؤولية محرك دخول وتوزيع العملاء.</p></div>
        <div className={`crm-automation-state ${draft.isActive ? "on" : "off"}`}><i />{draft.isActive ? "نشط" : "متوقف"}</div>
      </section>

      {notice ? <div className="crm-inline-notice">{notice}</div> : null}

      <section className="crm-automation-toolbar">
        <button className="crm-secondary-button" type="button" onClick={() => void load()} disabled={loading}><ArrowClockwise size={17} />{loading ? "جاري التحديث" : "إعادة تحميل"}</button>
        <button className="crm-primary-button" type="button" onClick={() => void save()} disabled={saving}><FloppyDisk size={18} />{saving ? "جاري الحفظ..." : "حفظ وتفعيل الإعدادات"}</button>
      </section>

      <div className="crm-automation-layout">
        <main className="crm-automation-builder">
          <section className="crm-panel crm-automation-section">
            <header><div><GearSix size={22} weight="duotone" /><span><h3>الحالة العامة وسياسة التشغيل</h3><p>تحكم في وقت بداية جلسة جديدة بدون التأثير على حفظ الرسائل الواردة.</p></span></div></header>
            <div className="crm-form-grid crm-form-grid-wide">
              <label><span>اسم الأوتوميشن</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
              <label className="crm-switch-row crm-automation-switch"><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} /><span>تشغيل الأوتوميشن</span></label>
            </div>
            <div className="crm-automation-policy-grid">
              {[
                ["every_message", "مع كل رسالة واردة", "تبدأ جلسة جديدة عندما لا توجد جلسة نشطة."],
                ["once_24_hours", "مرة كل 24 ساعة", "يحفظ الرد دون إعادة الفلو داخل فترة 24 ساعة."],
                ["custom_duration", "مدة مخصصة", "حدد بالدقائق أو الساعات أو الأيام."],
              ].map(([value, title, description]) => <button type="button" key={value} className={draft.triggerPolicy === value ? "active" : ""} onClick={() => setDraft({ ...draft, triggerPolicy: value as Draft["triggerPolicy"] })}><Lightning size={20} /><strong>{title}</strong><small>{description}</small></button>)}
            </div>
            {draft.triggerPolicy === "custom_duration" ? <div className="crm-automation-duration"><label><span>القيمة</span><input type="number" min={1} value={draft.customValue} onChange={(event) => setDraft({ ...draft, customValue: Math.max(1, Number(event.target.value || 1)) })} /></label><label><span>الوحدة</span><select value={draft.customUnit} onChange={(event) => setDraft({ ...draft, customUnit: event.target.value as Draft["customUnit"] })}><option value="minute">دقيقة</option><option value="hour">ساعة</option><option value="day">يوم</option></select></label></div> : null}
          </section>

          <section className="crm-panel crm-automation-section">
            <header><div><FlowArrow size={22} weight="duotone" /><span><h3>المنصات والـWorkers</h3><p>لا يمكن تشغيل منصة إلا مع Worker نشط ومسار إرسال صالح تابع لنفس المنصة.</p></span></div></header>
            <div className="crm-automation-platforms">
              {draft.platforms.map((platform, index) => {
                const compatible = endpoints.filter((endpoint) => platform.sourceCode === "whatsapp" ? ["whatsapp", "mersal"].includes(endpoint.source_code) : endpoint.source_code === platform.sourceCode);
                const endpoint = endpoints.find((item) => item.source_code === platform.workerCode);
                const ready = endpoint?.is_active && endpoint?.send_url;
                return <article key={platform.sourceCode} className={platform.isEnabled ? "enabled" : ""}>
                  <div className="crm-automation-platform-title"><strong>{platformLabels[platform.sourceCode] || platform.sourceCode}</strong><span className={ready ? "ready" : "not-ready"}>{ready ? <CheckCircle size={15} /> : <WarningCircle size={15} />}{ready ? "جاهز" : "غير جاهز"}</span></div>
                  <label><span>Worker المرتبط</span><select value={platform.workerCode} onChange={(event) => setDraft({ ...draft, platforms: draft.platforms.map((item, itemIndex) => itemIndex === index ? { ...item, workerCode: event.target.value } : item) })}><option value="">اختر Worker</option>{compatible.map((item) => <option key={item.source_code} value={item.source_code}>{item.display_name} ({item.source_code})</option>)}</select></label>
                  <label className="crm-switch-row"><input type="checkbox" checked={platform.isEnabled} onChange={(event) => setDraft({ ...draft, platforms: draft.platforms.map((item, itemIndex) => itemIndex === index ? { ...item, isEnabled: event.target.checked } : item) })} /><span>تشغيل على المنصة</span></label>
                  <div className="crm-automation-platform-meta">
                    <small>حالة الربط: <b>{ready ? "متصل وجاهز" : "غير مكتمل"}</b></small>
                    {platform.lastSuccessAt ? <small>آخر نجاح: {new Date(platform.lastSuccessAt).toLocaleString("ar-SA")}</small> : <small>لا يوجد إرسال ناجح مسجل بعد</small>}
                    {endpoint?.health_url ? <a href={endpoint.health_url} target="_blank" rel="noreferrer">فتح Health Check</a> : null}
                  </div>
                  {platform.lastError ? <small className="crm-automation-error">{platform.lastError}</small> : null}
                </article>;
              })}
            </div>
          </section>

          <section className="crm-panel crm-automation-section">
            <header><div><Robot size={22} weight="duotone" /><span><h3>رسائل بداية الأوتوميشن</h3><p>تُرسل بالترتيب، وتظهر أزرار الخدمات مع آخر رسالة.</p></span></div><button type="button" className="crm-secondary-button" onClick={() => setDraft({ ...draft, startMessages: [...draft.startMessages, { localId: uid("message"), messageCode: uid("message"), body: "رسالة جديدة", isActive: true }] })}><Plus size={16} />إضافة رسالة</button></header>
            <div className="crm-automation-message-list">
              {draft.startMessages.map((message, index) => <article key={message.localId}>
                <div className="crm-automation-order"><button type="button" onClick={() => setDraft({ ...draft, startMessages: move(draft.startMessages, index, -1) })}><CaretUp /></button><b>{index + 1}</b><button type="button" onClick={() => setDraft({ ...draft, startMessages: move(draft.startMessages, index, 1) })}><CaretDown /></button></div>
                <textarea rows={5} value={message.body} onChange={(event) => setDraft({ ...draft, startMessages: draft.startMessages.map((item, itemIndex) => itemIndex === index ? { ...item, body: event.target.value } : item) })} />
                <div className="crm-automation-row-actions"><label className="crm-switch-row"><input type="checkbox" checked={message.isActive} onChange={(event) => setDraft({ ...draft, startMessages: draft.startMessages.map((item, itemIndex) => itemIndex === index ? { ...item, isActive: event.target.checked } : item) })} /><span>نشطة</span></label><button type="button" className="danger" disabled={draft.startMessages.length === 1} onClick={() => setDraft({ ...draft, startMessages: draft.startMessages.filter((_, itemIndex) => itemIndex !== index) })}><Trash size={16} />حذف</button></div>
              </article>)}
            </div>
          </section>

          <section className="crm-panel crm-automation-section">
            <header><div><FlowArrow size={22} weight="duotone" /><span><h3>الاختيارات وخطوات الفلو</h3><p>كل اختيار له ردود مقبولة وأسئلة وإجراء نهائي مستقل.</p></span></div><button type="button" className="crm-secondary-button" onClick={() => { const choice = newChoice(); setDraft({ ...draft, choices: [...draft.choices, choice] }); setExpanded(choice.localId); }}><Plus size={16} />إضافة اختيار</button></header>
            <div className="crm-automation-choice-list">
              {draft.choices.map((choice, choiceIndex) => {
                const open = expanded === choice.localId;
                return <article key={choice.localId} className={open ? "open" : ""}>
                  <button type="button" className="crm-automation-choice-head" onClick={() => setExpanded(open ? "" : choice.localId)}><span className="crm-automation-choice-icon">{choice.emoji || "•"}</span><span><strong>{choice.displayName || "اختيار بدون اسم"}</strong><small>{choice.choiceCode} · {choice.steps.length} خطوات</small></span><i className={choice.isActive ? "active" : "inactive"}>{choice.isActive ? "نشط" : "متوقف"}</i>{open ? <CaretUp /> : <CaretDown />}</button>
                  {open ? <div className="crm-automation-choice-body">
                    <div className="crm-form-grid crm-form-grid-wide">
                      <label><span>الاسم الظاهر</span><input value={choice.displayName} onChange={(event) => patchChoice(choiceIndex, { displayName: event.target.value })} /></label>
                      <label><span>Emoji</span><input value={choice.emoji} onChange={(event) => patchChoice(choiceIndex, { emoji: event.target.value })} /></label>
                      <label><span>الكود الداخلي</span><input dir="ltr" value={choice.choiceCode} onChange={(event) => patchChoice(choiceIndex, { choiceCode: event.target.value })} /></label>
                      <label><span>الخدمة</span><select value={choice.serviceKey} onChange={(event) => patchChoice(choiceIndex, { serviceKey: event.target.value, departmentCode: event.target.value === "finance" ? "finance_sales" : event.target.value === "service" ? "customer_service" : "cash_sales" })}><option value="cash">مبيعات الكاش</option><option value="finance">مبيعات التمويل</option><option value="service">خدمة العملاء</option></select></label>
                      <label><span>القسم المرتبط</span><input dir="ltr" value={choice.departmentCode} onChange={(event) => patchChoice(choiceIndex, { departmentCode: event.target.value })} /></label>
                      <label><span>سياسة الفرع</span><select value={choice.branchPolicy} onChange={(event) => patchChoice(choiceIndex, { branchPolicy: event.target.value })}><option value="system">حسب محرك التوزيع</option><option value="fixed">فرع ثابت</option></select></label>
                    </div>
                    {choice.branchPolicy === "fixed" ? <label className="crm-form-label"><span>كود الفرع</span><input dir="ltr" value={choice.branchCode} onChange={(event) => patchChoice(choiceIndex, { branchCode: event.target.value })} /></label> : null}
                    <label className="crm-form-label"><span>الردود المقبولة (كل رد في سطر)</span><textarea rows={4} value={choice.replies.map((item: any) => `${item.replyType}|${item.replyValue}`).join("\n")} onChange={(event) => patchChoice(choiceIndex, { replies: event.target.value.split("\n").map((line) => { const [replyType, ...value] = line.split("|"); return { localId: uid("reply"), replyType: ["text", "number", "payload"].includes(replyType) ? replyType : "text", replyValue: value.length ? value.join("|").trim() : replyType.trim() }; }).filter((item) => item.replyValue) })} /></label>

                    <div className="crm-automation-steps-head"><div><strong>خطوات الفلو</strong><small>الانتقال يعتمد على الكود والترتيب، وليس نص السؤال.</small></div><button type="button" className="crm-secondary-button" onClick={() => patchChoice(choiceIndex, { steps: [...choice.steps, newStep(choice.choiceCode)] })}><Plus size={15} />إضافة خطوة</button></div>
                    <div className="crm-automation-steps">
                      {choice.steps.map((step: any, stepIndex: number) => <article key={step.localId}>
                        <div className="crm-automation-step-number">{stepIndex + 1}</div>
                        <div className="crm-automation-step-fields">
                          <div className="crm-form-grid crm-form-grid-wide">
                            <label><span>اسم الخطوة</span><input value={step.name} onChange={(event) => patchStep(choiceIndex, stepIndex, { name: event.target.value })} /></label>
                            <label><span>الكود الداخلي</span><input dir="ltr" value={step.stepCode} onChange={(event) => patchStep(choiceIndex, stepIndex, { stepCode: event.target.value })} /></label>
                            <label><span>نوع الخطوة</span><select value={step.stepType} onChange={(event) => { const stepType = event.target.value; patchStep(choiceIndex, stepIndex, { stepType, isRequired: stepType === "message" ? false : step.isRequired, customerFieldKey: stepType === "message" ? "" : step.customerFieldKey, options: stepType === "choice" && !step.options.length ? [{ localId: uid("option"), optionCode: "option_1", label: "اختيار 1", acceptedReplies: [], isActive: true }] : step.options }); }}><option value="message">رسالة فقط</option><option value="text">سؤال نصي</option><option value="phone">رقم جوال</option><option value="choice">اختيار</option></select></label>
                            <label><span>حقل العميل</span><select value={step.customerFieldKey} onChange={(event) => patchStep(choiceIndex, stepIndex, { customerFieldKey: event.target.value })}><option value="">بدون ربط</option><option value="customer_name">اسم العميل</option><option value="car_name">السيارة</option><option value="phone">رقم الجوال</option></select></label>
                            {step.stepType !== "message" ? <label><span>عدد المحاولات</span><input type="number" min={1} max={50} value={step.maxAttempts || 3} onChange={(event) => patchStep(choiceIndex, stepIndex, { maxAttempts: Math.max(1, Number(event.target.value || 1)) })} /></label> : null}
                            {step.stepType === "text" ? <><label><span>أقل عدد حروف</span><input type="number" min={0} value={Number(step.validationRules?.minLength || 0)} onChange={(event) => patchStep(choiceIndex, stepIndex, { validationRules: { ...step.validationRules, minLength: Math.max(0, Number(event.target.value || 0)) } })} /></label><label><span>أقصى عدد حروف</span><input type="number" min={0} value={Number(step.validationRules?.maxLength || 0)} onChange={(event) => patchStep(choiceIndex, stepIndex, { validationRules: { ...step.validationRules, maxLength: Math.max(0, Number(event.target.value || 0)) } })} /></label></> : null}
                          </div>
                          <label><span>{step.stepType === "message" ? "نص الرسالة" : "نص السؤال"}</span><textarea rows={3} value={step.prompt} onChange={(event) => patchStep(choiceIndex, stepIndex, { prompt: event.target.value })} /></label>
                          {step.stepType !== "message" ? <label><span>رسالة خطأ التحقق</span><input value={step.validationErrorMessage} onChange={(event) => patchStep(choiceIndex, stepIndex, { validationErrorMessage: event.target.value })} /></label> : null}
                          <div className="crm-automation-step-switches">
                            {step.stepType !== "message" ? <label className="crm-switch-row"><input type="checkbox" checked={step.isRequired !== false} onChange={(event) => patchStep(choiceIndex, stepIndex, { isRequired: event.target.checked })} /><span>الإجابة مطلوبة</span></label> : null}
                            <label className="crm-switch-row"><input type="checkbox" checked={step.isActive !== false} onChange={(event) => patchStep(choiceIndex, stepIndex, { isActive: event.target.checked })} /><span>الخطوة نشطة</span></label>
                          </div>
                          {step.stepType === "choice" ? <div className="crm-automation-step-options">
                            <div className="crm-automation-options-head"><strong>اختيارات الخطوة</strong><button type="button" className="crm-secondary-button" onClick={() => patchStep(choiceIndex, stepIndex, { options: [...step.options, { localId: uid("option"), optionCode: `option_${step.options.length + 1}`, label: `اختيار ${step.options.length + 1}`, acceptedReplies: [], isActive: true }] })}><Plus size={14} />إضافة اختيار</button></div>
                            {step.options.map((option: any, optionIndex: number) => <div className="crm-automation-option-row" key={option.localId}>
                              <input dir="ltr" aria-label="كود الاختيار" value={option.optionCode} onChange={(event) => patchStep(choiceIndex, stepIndex, { options: step.options.map((item: any, index: number) => index === optionIndex ? { ...item, optionCode: event.target.value } : item) })} />
                              <input aria-label="اسم الاختيار" value={option.label} onChange={(event) => patchStep(choiceIndex, stepIndex, { options: step.options.map((item: any, index: number) => index === optionIndex ? { ...item, label: event.target.value } : item) })} />
                              <input aria-label="الردود المقبولة" placeholder="رد 1، رد 2" value={(option.acceptedReplies || []).join("، ")} onChange={(event) => patchStep(choiceIndex, stepIndex, { options: step.options.map((item: any, index: number) => index === optionIndex ? { ...item, acceptedReplies: event.target.value.split(/[،,\n]/).map((value) => value.trim()).filter(Boolean) } : item) })} />
                              <label className="crm-switch-row"><input type="checkbox" checked={option.isActive !== false} onChange={(event) => patchStep(choiceIndex, stepIndex, { options: step.options.map((item: any, index: number) => index === optionIndex ? { ...item, isActive: event.target.checked } : item) })} /><span>نشط</span></label>
                              <button type="button" className="danger" disabled={step.options.length === 1} onClick={() => patchStep(choiceIndex, stepIndex, { options: step.options.filter((_: any, index: number) => index !== optionIndex) })}><Trash size={15} /></button>
                            </div>)}
                          </div> : null}
                        </div>
                        <div className="crm-automation-step-actions"><button type="button" onClick={() => patchChoice(choiceIndex, { steps: move(choice.steps, stepIndex, -1) })}><CaretUp /></button><button type="button" onClick={() => patchChoice(choiceIndex, { steps: move(choice.steps, stepIndex, 1) })}><CaretDown /></button><button type="button" className="danger" onClick={() => patchChoice(choiceIndex, { steps: choice.steps.filter((_: any, index: number) => index !== stepIndex) })}><Trash /></button></div>
                      </article>)}
                      {!choice.steps.length ? <div className="crm-automation-empty">هذا الاختيار ينفذ الإجراء النهائي مباشرة بعد اختياره.</div> : null}
                    </div>
                    <label className="crm-form-label"><span>رسالة النهاية</span><textarea rows={3} disabled={choice.finalAction?.sendFinalMessage === false} value={choice.finalMessage} onChange={(event) => patchChoice(choiceIndex, { finalMessage: event.target.value })} /></label>
                    <div className="crm-automation-final-actions">
                      {[
                        ['createOrUpdateCustomer','إنشاء أو تحديث العميل'],
                        ['classifyService','تحديد الخدمة والقسم'],
                        ['requestDistribution','استدعاء محرك التوزيع'],
                        ['assignSales','توزيع مندوب مبيعات'],
                        ['assignCallCenter','توزيع مندوب كول سنتر'],
                        ['assignCustomerService','توزيع خدمة عملاء'],
                        ['sendFinalMessage','إرسال رسالة النهاية'],
                      ].map(([key,label]) => <label className="crm-switch-row" key={key}><input type="checkbox" checked={choice.finalAction?.[key] !== false} onChange={(event) => patchChoice(choiceIndex, { finalAction: { ...choice.finalAction, [key]: event.target.checked } })} /><span>{label}</span></label>)}
                    </div>
                    <footer><label className="crm-switch-row"><input type="checkbox" checked={choice.isActive} onChange={(event) => patchChoice(choiceIndex, { isActive: event.target.checked })} /><span>الاختيار نشط</span></label><div><button type="button" onClick={() => setDraft({ ...draft, choices: move(draft.choices, choiceIndex, -1) })}><CaretUp />أعلى</button><button type="button" onClick={() => setDraft({ ...draft, choices: move(draft.choices, choiceIndex, 1) })}><CaretDown />أسفل</button><button type="button" className="danger" disabled={draft.choices.length === 1} onClick={() => setDraft({ ...draft, choices: draft.choices.filter((_, index) => index !== choiceIndex) })}><Trash />حذف</button></div></footer>
                  </div> : null}
                </article>;
              })}
            </div>
          </section>
        </main>

        <aside className="crm-automation-preview">
          <div className="crm-automation-preview-sticky">
            <header><Robot size={20} /><span><strong>معاينة الفلو</strong><small>مثال للاختيار النشط الأول</small></span></header>
            <div className="crm-automation-phone">
              <div className="crm-automation-phone-top"><i /><strong>MZJ</strong><span>متصل الآن</span></div>
              <div className="crm-automation-chat">
                {previewMessages.map((item: any, index) => <div key={`${item.type}-${index}`} className={`crm-automation-bubble ${item.type}`}><p>{item.body}</p>{item.type === "start" && index === draft.startMessages.filter((message) => message.isActive).length - 1 ? <div className="crm-automation-preview-buttons">{draft.choices.filter((choice) => choice.isActive).map((choice) => <button type="button" key={choice.localId}>{choice.emoji} {choice.displayName}</button>)}</div> : null}{item.options?.length ? <div className="crm-automation-preview-buttons">{item.options.map((option: any) => <button type="button" key={option.localId}>{option.label}</button>)}</div> : null}</div>)}
              </div>
            </div>
            <div className="crm-automation-safety"><CheckCircle size={18} weight="fill" /><p><strong>تنفيذ آمن مرة واحدة</strong><span>معرف الحدث والجلسة والإجراء النهائي يمنعون تكرار العميل والتوزيع والرسالة.</span></p></div>
          </div>
        </aside>
      </div>
    </div>
  );
}
