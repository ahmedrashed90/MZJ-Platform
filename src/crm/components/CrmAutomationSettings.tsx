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
import {
  automationDraftToSettings,
  automationResponseToDraft,
  type AutomationDraft,
} from "../automationModel";
import {
  type AutomationBranchPolicy,
  type AutomationChoice,
  type AutomationChoiceReply,
  type AutomationEndpoint,
  type AutomationFinalAction,
  type AutomationReplyType,
  type AutomationServiceKey,
  type AutomationStep,
  type AutomationStepType,
  type AutomationStepOption,
} from "../../../shared/crmAutomationContract";

type Draft = AutomationDraft;

type PreviewMessage = {
  type: "start" | "question" | "final";
  body: string;
  options?: AutomationStepOption[];
};


const finalActionFields: Array<[keyof AutomationFinalAction, string]> = [
  ["createOrUpdateCustomer", "إنشاء أو تحديث العميل"],
  ["classifyService", "تحديد الخدمة والقسم"],
  ["requestDistribution", "استدعاء محرك التوزيع"],
  ["assignSales", "توزيع مندوب مبيعات"],
  ["assignCallCenter", "توزيع مندوب كول سنتر"],
  ["assignCustomerService", "توزيع خدمة عملاء"],
  ["sendFinalMessage", "إرسال رسالة النهاية"],
];

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
function newChoice(): AutomationChoice {
  const suffix = Date.now().toString(36);
  return {
    id: uid("choice"), choiceCode: `service_${suffix}`, displayName: "خدمة جديدة", emoji: "✨",
    departmentCode: "cash_sales", serviceKey: "cash", branchPolicy: "system", branchCode: "",
    finalAction: { createOrUpdateCustomer: true, classifyService: true, requestDistribution: true, assignSales: true, assignCallCenter: false, assignCustomerService: false, sendFinalMessage: true },
    finalMessage: "سيتم التواصل معك قريباً", isActive: true,
    replies: [{ id: uid("reply"), replyType: "text", replyValue: "خدمة جديدة" }], steps: [],
  };
}
function newStep(choiceCode: string): AutomationStep {
  return {
    id: uid("step"), stepCode: `${choiceCode}_step_${Date.now().toString(36)}`, name: "سؤال جديد", prompt: "اكتب السؤال هنا",
    stepType: "text", customerFieldKey: "", isRequired: true, validationRules: { minLength: 1, maxLength: 120 },
    validationErrorMessage: "برجاء إدخال إجابة صحيحة.", maxAttempts: 3, isActive: true, options: [],
  };
}

export function CrmAutomationSettings() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [endpoints, setEndpoints] = useState<AutomationEndpoint[]>([]);
  const [expanded, setExpanded] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    try {
      const result = await crmFetch<unknown>("/api/crm/automation-settings");
      const next = automationResponseToDraft(result);
      setDraft(next.draft);
      setEndpoints(next.endpoints);
      setExpanded(next.draft.choices[0]?.id || "");
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل إعدادات الأوتوميشن");
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const previewMessages = useMemo(() => {
    if (!draft) return [];
    const messages: PreviewMessage[] = draft.startMessages.filter((item) => item.isActive && item.body).map((item) => ({ type: "start", body: item.body }));
    const activeChoice = draft.choices.find((item) => item.isActive);
    if (activeChoice?.steps.length) {
      messages.push(...activeChoice.steps.filter((step) => step.isActive).map((step): PreviewMessage => ({
        type: step.stepType === "message" ? "start" : "question",
        body: step.prompt,
        options: step.stepType === "choice" ? step.options.filter((option) => option.isActive) : [],
      })));
    }
    if (activeChoice?.finalAction?.sendFinalMessage !== false && activeChoice?.finalMessage) messages.push({ type: "final", body: activeChoice.finalMessage });
    return messages;
  }, [draft]);

  function patchChoice(index: number, patch: Partial<AutomationChoice>) {
    setDraft((current) => current ? ({ ...current, choices: current.choices.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }) : current);
  }
  function patchStep(choiceIndex: number, stepIndex: number, patch: Partial<AutomationStep>) {
    setDraft((current) => current ? ({
      ...current,
      choices: current.choices.map((choice, index) => index === choiceIndex ? {
        ...choice, steps: choice.steps.map((step, index2) => index2 === stepIndex ? { ...step, ...patch } : step),
      } : choice),
    }) : current);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const result = await crmFetch<unknown>("/api/crm/automation-settings", { method: "PUT", body: JSON.stringify({ automation: automationDraftToSettings(draft) }) });
      const next = automationResponseToDraft(result);
      setDraft(next.draft);
      setEndpoints(next.endpoints);
      setExpanded((current) => next.draft.choices.some((choice) => choice.id === current) ? current : (next.draft.choices[0]?.id || ""));
      setNotice(next.message || "تم حفظ إعدادات الأوتوميشن");
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
                const compatible = endpoints.filter((endpoint) => platform.sourceCode === "whatsapp" ? ["whatsapp", "mersal"].includes(endpoint.sourceCode) : endpoint.sourceCode === platform.sourceCode);
                const endpoint = endpoints.find((item) => item.sourceCode === platform.workerCode);
                const ready = endpoint?.isActive && endpoint?.sendUrl;
                return <article key={platform.sourceCode} className={platform.isEnabled ? "enabled" : ""}>
                  <div className="crm-automation-platform-title"><strong>{platformLabels[platform.sourceCode] || platform.sourceCode}</strong><span className={ready ? "ready" : "not-ready"}>{ready ? <CheckCircle size={15} /> : <WarningCircle size={15} />}{ready ? "جاهز" : "غير جاهز"}</span></div>
                  <label><span>Worker المرتبط</span><select value={platform.workerCode} onChange={(event) => setDraft({ ...draft, platforms: draft.platforms.map((item, itemIndex) => itemIndex === index ? { ...item, workerCode: event.target.value } : item) })}><option value="">اختر Worker</option>{compatible.map((item) => <option key={item.sourceCode} value={item.sourceCode}>{item.displayName} ({item.sourceCode})</option>)}</select></label>
                  <label className="crm-switch-row"><input type="checkbox" checked={platform.isEnabled} onChange={(event) => setDraft({ ...draft, platforms: draft.platforms.map((item, itemIndex) => itemIndex === index ? { ...item, isEnabled: event.target.checked } : item) })} /><span>تشغيل على المنصة</span></label>
                  <div className="crm-automation-platform-meta">
                    <small>حالة الربط: <b>{ready ? "متصل وجاهز" : "غير مكتمل"}</b></small>
                    {platform.lastSuccessAt ? <small>آخر نجاح: {new Date(platform.lastSuccessAt).toLocaleString("ar-SA")}</small> : <small>لا يوجد إرسال ناجح مسجل بعد</small>}
                    {endpoint?.healthUrl ? <a href={endpoint.healthUrl} target="_blank" rel="noreferrer">فتح Health Check</a> : null}
                  </div>
                  {platform.lastError ? <small className="crm-automation-error">{platform.lastError}</small> : null}
                </article>;
              })}
            </div>
          </section>

          <section className="crm-panel crm-automation-section">
            <header><div><Robot size={22} weight="duotone" /><span><h3>رسائل بداية الأوتوميشن</h3><p>تُرسل بالترتيب، وتظهر أزرار الخدمات مع آخر رسالة.</p></span></div><button type="button" className="crm-secondary-button" onClick={() => setDraft({ ...draft, startMessages: [...draft.startMessages, { id: uid("message"), messageCode: uid("message"), body: "رسالة جديدة", isActive: true }] })}><Plus size={16} />إضافة رسالة</button></header>
            <div className="crm-automation-message-list">
              {draft.startMessages.map((message, index) => <article key={message.id}>
                <div className="crm-automation-order"><button type="button" onClick={() => setDraft({ ...draft, startMessages: move(draft.startMessages, index, -1) })}><CaretUp /></button><b>{index + 1}</b><button type="button" onClick={() => setDraft({ ...draft, startMessages: move(draft.startMessages, index, 1) })}><CaretDown /></button></div>
                <textarea rows={5} value={message.body} onChange={(event) => setDraft({ ...draft, startMessages: draft.startMessages.map((item, itemIndex) => itemIndex === index ? { ...item, body: event.target.value } : item) })} />
                <div className="crm-automation-row-actions"><label className="crm-switch-row"><input type="checkbox" checked={message.isActive} onChange={(event) => setDraft({ ...draft, startMessages: draft.startMessages.map((item, itemIndex) => itemIndex === index ? { ...item, isActive: event.target.checked } : item) })} /><span>نشطة</span></label><button type="button" className="danger" disabled={draft.startMessages.length === 1} onClick={() => setDraft({ ...draft, startMessages: draft.startMessages.filter((_, itemIndex) => itemIndex !== index) })}><Trash size={16} />حذف</button></div>
              </article>)}
            </div>
          </section>

          <section className="crm-panel crm-automation-section">
            <header><div><FlowArrow size={22} weight="duotone" /><span><h3>الاختيارات وخطوات الفلو</h3><p>كل اختيار له ردود مقبولة وأسئلة وإجراء نهائي مستقل.</p></span></div><button type="button" className="crm-secondary-button" onClick={() => { const choice = newChoice(); setDraft({ ...draft, choices: [...draft.choices, choice] }); setExpanded(choice.id); }}><Plus size={16} />إضافة اختيار</button></header>
            <div className="crm-automation-choice-list">
              {draft.choices.map((choice, choiceIndex) => {
                const open = expanded === choice.id;
                return <article key={choice.id} className={open ? "open" : ""}>
                  <button type="button" className="crm-automation-choice-head" onClick={() => setExpanded(open ? "" : choice.id)}><span className="crm-automation-choice-icon">{choice.emoji || "•"}</span><span><strong>{choice.displayName || "اختيار بدون اسم"}</strong><small>{choice.choiceCode} · {choice.steps.length} خطوات</small></span><i className={choice.isActive ? "active" : "inactive"}>{choice.isActive ? "نشط" : "متوقف"}</i>{open ? <CaretUp /> : <CaretDown />}</button>
                  {open ? <div className="crm-automation-choice-body">
                    <div className="crm-form-grid crm-form-grid-wide">
                      <label><span>الاسم الظاهر</span><input value={choice.displayName} onChange={(event) => patchChoice(choiceIndex, { displayName: event.target.value })} /></label>
                      <label><span>Emoji</span><input value={choice.emoji} onChange={(event) => patchChoice(choiceIndex, { emoji: event.target.value })} /></label>
                      <label><span>الكود الداخلي</span><input dir="ltr" value={choice.choiceCode} onChange={(event) => patchChoice(choiceIndex, { choiceCode: event.target.value })} /></label>
                      <label><span>الخدمة</span><select value={choice.serviceKey} onChange={(event) => patchChoice(choiceIndex, { serviceKey: event.target.value as AutomationServiceKey, departmentCode: event.target.value === "finance" ? "finance_sales" : event.target.value === "service" ? "customer_service" : "cash_sales" })}><option value="cash">مبيعات الكاش</option><option value="finance">مبيعات التمويل</option><option value="service">خدمة العملاء</option></select></label>
                      <label><span>القسم المرتبط</span><input dir="ltr" value={choice.departmentCode} onChange={(event) => patchChoice(choiceIndex, { departmentCode: event.target.value })} /></label>
                      <label><span>سياسة الفرع</span><select value={choice.branchPolicy} onChange={(event) => patchChoice(choiceIndex, { branchPolicy: event.target.value as AutomationBranchPolicy })}><option value="system">حسب محرك التوزيع</option><option value="fixed">فرع ثابت</option></select></label>
                    </div>
                    {choice.branchPolicy === "fixed" ? <label className="crm-form-label"><span>كود الفرع</span><input dir="ltr" value={choice.branchCode} onChange={(event) => patchChoice(choiceIndex, { branchCode: event.target.value })} /></label> : null}
                    <label className="crm-form-label"><span>الردود المقبولة (كل رد في سطر)</span><textarea rows={4} value={choice.replies.map((item) => `${item.replyType}|${item.replyValue}`).join("\n")} onChange={(event) => patchChoice(choiceIndex, { replies: event.target.value.split("\n").map((line): AutomationChoiceReply => { const [replyType, ...value] = line.split("|"); return { id: uid("reply"), replyType: (["text", "number", "payload"].includes(replyType) ? replyType : "text") as AutomationReplyType, replyValue: value.length ? value.join("|").trim() : replyType.trim() }; }).filter((item) => item.replyValue) })} /></label>

                    <div className="crm-automation-steps-head"><div><strong>خطوات الفلو</strong><small>الانتقال يعتمد على الكود والترتيب، وليس نص السؤال.</small></div><button type="button" className="crm-secondary-button" onClick={() => patchChoice(choiceIndex, { steps: [...choice.steps, newStep(choice.choiceCode)] })}><Plus size={15} />إضافة خطوة</button></div>
                    <div className="crm-automation-steps">
                      {choice.steps.map((step, stepIndex) => <article key={step.id}>
                        <div className="crm-automation-step-number">{stepIndex + 1}</div>
                        <div className="crm-automation-step-fields">
                          <div className="crm-form-grid crm-form-grid-wide">
                            <label><span>اسم الخطوة</span><input value={step.name} onChange={(event) => patchStep(choiceIndex, stepIndex, { name: event.target.value })} /></label>
                            <label><span>الكود الداخلي</span><input dir="ltr" value={step.stepCode} onChange={(event) => patchStep(choiceIndex, stepIndex, { stepCode: event.target.value })} /></label>
                            <label><span>نوع الخطوة</span><select value={step.stepType} onChange={(event) => { const stepType = event.target.value as AutomationStepType; patchStep(choiceIndex, stepIndex, { stepType, isRequired: stepType === "message" ? false : step.isRequired, customerFieldKey: stepType === "message" ? "" : step.customerFieldKey, options: stepType === "choice" && !step.options.length ? [{ id: uid("option"), optionCode: "option_1", label: "اختيار 1", acceptedReplies: [], isActive: true }] : step.options }); }}><option value="message">رسالة فقط</option><option value="text">سؤال نصي</option><option value="phone">رقم جوال</option><option value="choice">اختيار</option></select></label>
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
                            <div className="crm-automation-options-head"><strong>اختيارات الخطوة</strong><button type="button" className="crm-secondary-button" onClick={() => patchStep(choiceIndex, stepIndex, { options: [...step.options, { id: uid("option"), optionCode: `option_${step.options.length + 1}`, label: `اختيار ${step.options.length + 1}`, acceptedReplies: [], isActive: true }] })}><Plus size={14} />إضافة اختيار</button></div>
                            {step.options.map((option, optionIndex) => <div className="crm-automation-option-row" key={option.id}>
                              <input dir="ltr" aria-label="كود الاختيار" value={option.optionCode} onChange={(event) => patchStep(choiceIndex, stepIndex, { options: step.options.map((item, index) => index === optionIndex ? { ...item, optionCode: event.target.value } : item) })} />
                              <input aria-label="اسم الاختيار" value={option.label} onChange={(event) => patchStep(choiceIndex, stepIndex, { options: step.options.map((item, index) => index === optionIndex ? { ...item, label: event.target.value } : item) })} />
                              <input aria-label="الردود المقبولة" placeholder="رد 1، رد 2" value={(option.acceptedReplies || []).join("، ")} onChange={(event) => patchStep(choiceIndex, stepIndex, { options: step.options.map((item, index) => index === optionIndex ? { ...item, acceptedReplies: event.target.value.split(/[،,\n]/).map((value) => value.trim()).filter(Boolean) } : item) })} />
                              <label className="crm-switch-row"><input type="checkbox" checked={option.isActive !== false} onChange={(event) => patchStep(choiceIndex, stepIndex, { options: step.options.map((item, index) => index === optionIndex ? { ...item, isActive: event.target.checked } : item) })} /><span>نشط</span></label>
                              <button type="button" className="danger" disabled={step.options.length === 1} onClick={() => patchStep(choiceIndex, stepIndex, { options: step.options.filter((_, index) => index !== optionIndex) })}><Trash size={15} /></button>
                            </div>)}
                          </div> : null}
                        </div>
                        <div className="crm-automation-step-actions"><button type="button" onClick={() => patchChoice(choiceIndex, { steps: move(choice.steps, stepIndex, -1) })}><CaretUp /></button><button type="button" onClick={() => patchChoice(choiceIndex, { steps: move(choice.steps, stepIndex, 1) })}><CaretDown /></button><button type="button" className="danger" onClick={() => patchChoice(choiceIndex, { steps: choice.steps.filter((_, index) => index !== stepIndex) })}><Trash /></button></div>
                      </article>)}
                      {!choice.steps.length ? <div className="crm-automation-empty">هذا الاختيار ينفذ الإجراء النهائي مباشرة بعد اختياره.</div> : null}
                    </div>
                    <label className="crm-form-label"><span>رسالة النهاية</span><textarea rows={3} disabled={choice.finalAction?.sendFinalMessage === false} value={choice.finalMessage} onChange={(event) => patchChoice(choiceIndex, { finalMessage: event.target.value })} /></label>
                    <div className="crm-automation-final-actions">
                      {finalActionFields.map(([key, label]) => <label className="crm-switch-row" key={key}><input type="checkbox" checked={choice.finalAction[key] !== false} onChange={(event) => patchChoice(choiceIndex, { finalAction: { ...choice.finalAction, [key]: event.target.checked } })} /><span>{label}</span></label>)}
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
                {previewMessages.map((item, index) => <div key={`${item.type}-${index}`} className={`crm-automation-bubble ${item.type}`}><p>{item.body}</p>{item.type === "start" && index === draft.startMessages.filter((message) => message.isActive).length - 1 ? <div className="crm-automation-preview-buttons">{draft.choices.filter((choice) => choice.isActive).map((choice) => <button type="button" key={choice.id}>{choice.emoji} {choice.displayName}</button>)}</div> : null}{item.options?.length ? <div className="crm-automation-preview-buttons">{item.options.map((option) => <button type="button" key={option.id}>{option.label}</button>)}</div> : null}</div>)}
              </div>
            </div>
            <div className="crm-automation-safety"><CheckCircle size={18} weight="fill" /><p><strong>تنفيذ آمن مرة واحدة</strong><span>معرف الحدث والجلسة والإجراء النهائي يمنعون تكرار العميل والتوزيع والرسالة.</span></p></div>
          </div>
        </aside>
      </div>
    </div>
  );
}
