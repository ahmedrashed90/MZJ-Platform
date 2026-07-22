import { useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  CaretDown,
  CaretUp,
  CheckCircle,
  ChatCircleDots,
  Database,
  FloppyDisk,
  FlowArrow,
  GearSix,
  LinkSimple,
  Plus,
  Pulse,
  Trash,
} from "@phosphor-icons/react";
import { crmFetch, formatDate } from "../api";

const blankMessage = { id: "", messageKey: "", messageText: "", isActive: true, sortOrder: 10 };
const blankAlias = { aliasType: "text", aliasValue: "" };
const blankStep = {
  id: "",
  stepKey: "",
  stepName: "",
  promptText: "",
  stepType: "text",
  customerField: "",
  isRequired: true,
  validationRules: {},
  validationError: "البيانات المدخلة غير صحيحة، برجاء المحاولة مرة أخرى.",
  maxAttempts: null as number | null,
  isActive: true,
  sortOrder: 10,
};
const blankFlow = {
  id: "",
  flowCode: "",
  displayName: "",
  emoji: "",
  buttonPayload: "",
  serviceKey: "cash",
  departmentCode: "cash_sales",
  branchPolicy: "system",
  branchCode: "",
  finalMessage: "",
  isActive: true,
  sortOrder: 10,
  aliases: [{ ...blankAlias }],
  steps: [] as any[],
  finalAction: {
    createOrUpdateCustomer: true,
    setService: true,
    setDepartment: true,
    assignSales: true,
    assignCallCenter: false,
    assignCustomerService: false,
    sendFinalMessage: true,
  },
};

type Section = "general" | "platforms" | "messages" | "flows" | "sessions";

function toGeneral(settings: any) {
  return {
    automationName: settings?.automation_name || "أوتوميشن استقبال العملاء",
    automationEnabled: settings ? settings.automation_enabled !== false : false,
    triggerPolicy: settings?.trigger_policy || "every_message",
    customIntervalValue: Number(settings?.custom_interval_value || 24),
    customIntervalUnit: settings?.custom_interval_unit || "hour",
  };
}

function fromFlow(row: any) {
  return {
    id: row.id || "",
    flowCode: row.flow_code || "",
    displayName: row.display_name || "",
    emoji: row.emoji || "",
    buttonPayload: row.button_payload || "",
    serviceKey: row.service_key || "cash",
    departmentCode: row.department_code || "cash_sales",
    branchPolicy: row.branch_policy || "system",
    branchCode: row.branch_code || "",
    finalMessage: row.final_message || "",
    isActive: row.is_active !== false,
    sortOrder: Number(row.sort_order || 10),
    aliases: (row.aliases || []).map((alias: any) => ({ aliasType: alias.aliasType || alias.type || "text", aliasValue: alias.aliasValue || alias.value || "" })),
    steps: (row.steps || []).map((step: any) => ({ ...blankStep, ...step })),
    finalAction: { ...blankFlow.finalAction, ...(row.final_action || {}) },
  };
}

function move<T>(items: T[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    awaiting_service: "بانتظار اختيار الخدمة",
    awaiting_answer: "بانتظار إجابة",
    completed: "مكتملة",
    cancelled: "ملغاة",
    expired: "منتهية",
    failed: "فشلت",
    waiting_assignment: "في انتظار التوزيع",
    connected: "متصل",
    disconnected: "غير متصل",
    error: "خطأ",
    unknown: "غير معروف",
  };
  return labels[value] || value || "—";
}

export function CrmConversationAutomationSettings() {
  const [section, setSection] = useState<Section>("general");
  const [data, setData] = useState<any>({ settings: null, startMessages: [], platforms: [], workers: [], flows: [], sessions: [] });
  const [general, setGeneral] = useState(toGeneral(null));
  const [messageForm, setMessageForm] = useState<any>(blankMessage);
  const [flowForm, setFlowForm] = useState<any>(blankFlow);
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const result = await crmFetch<any>("/api/crm/conversation-automation");
      setData(result);
      setGeneral(toGeneral(result.settings));
      if (flowForm.id) {
        const refreshed = (result.flows || []).find((row: any) => row.id === flowForm.id);
        if (refreshed) setFlowForm(fromFlow(refreshed));
      }
      setLoadError("");
      setLoaded(true);
      setNotice("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "تعذر تحميل إعدادات الأوتوميشن";
      setLoadError(message);
      setNotice("");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function save(sectionName: string, payload: any) {
    setSaving(true);
    try {
      const result = await crmFetch<any>("/api/crm/conversation-automation", {
        method: "POST",
        body: JSON.stringify({ section: sectionName, ...payload }),
      });
      setNotice(result.message || "تم الحفظ");
      await load();
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "فشل الحفظ");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function remove(sectionName: string, id: string) {
    if (!window.confirm("متأكد من تنفيذ الحذف؟")) return;
    try {
      const result = await crmFetch<any>("/api/crm/conversation-automation", {
        method: "DELETE",
        body: JSON.stringify({ section: sectionName, id }),
      });
      setNotice(result.message || "تم الحذف");
      if (sectionName === "flow" && flowForm.id === id) setFlowForm({ ...blankFlow, aliases: [{ ...blankAlias }], steps: [] });
      if (sectionName === "start_message" && messageForm.id === id) setMessageForm(blankMessage);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر الحذف");
    }
  }

  async function healthCheck(platformCode: string) {
    try {
      const result = await crmFetch<any>("/api/crm/conversation-automation", {
        method: "POST",
        body: JSON.stringify({ section: "platform_health", platformCode }),
      });
      setNotice(result.ok ? "تم الاتصال بالـWorker بنجاح" : "فشل الاتصال بالـWorker");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "فشل Health Check");
    }
  }

  const activeSessions = useMemo(() => (data.sessions || []).filter((row: any) => ["awaiting_service", "awaiting_answer"].includes(row.status)).length, [data.sessions]);
  const enabledPlatforms = useMemo(() => (data.platforms || []).filter((row: any) => row.is_enabled).length, [data.platforms]);
  const enabledFlows = useMemo(() => (data.flows || []).filter((row: any) => row.is_active).length, [data.flows]);

  function patchStep(index: number, patch: any) {
    setFlowForm((current: any) => ({ ...current, steps: current.steps.map((step: any, itemIndex: number) => itemIndex === index ? { ...step, ...patch } : step) }));
  }

  function patchAlias(index: number, patch: any) {
    setFlowForm((current: any) => ({ ...current, aliases: current.aliases.map((alias: any, itemIndex: number) => itemIndex === index ? { ...alias, ...patch } : alias) }));
  }

  const previewMessages = useMemo(() => (data.startMessages || []).filter((row: any) => row.is_active !== false), [data.startMessages]);
  const previewFlows = useMemo(() => (data.flows || []).filter((row: any) => row.is_active !== false), [data.flows]);

  if (!loaded && !loadError) {
    return (
      <section className="crm-panel crm-automation-load-state">
        <Pulse size={34} weight="duotone" />
        <div><h2>جاري تحميل إعدادات الأوتوميشن</h2><p>يتم التحقق من قاعدة البيانات والمنصات والـWorkers.</p></div>
      </section>
    );
  }

  if (loadError && !data.settings) {
    const migrationRequired = loadError.includes("20260723_crm_conversation_automation_v1181.sql") || loadError.includes("غير جاهزة");
    return (
      <section className="crm-panel crm-automation-load-error">
        <Database size={42} weight="duotone" />
        <div>
          <span>{migrationRequired ? "إعداد قاعدة البيانات مطلوب" : "تعذر تحميل إعدادات الأوتوميشن"}</span>
          <h2>{loadError}</h2>
          <p>{migrationRequired ? "نفّذ ملف الـMigration المرفق مرة واحدة على PostgreSQL، ثم اضغط إعادة المحاولة. لن تعرض الصفحة بيانات افتراضية أو حالة وهمية قبل اكتمال الإعداد." : "تم إيقاف عرض وحفظ الإعدادات لحماية البيانات حتى يعود اتصال الخادم بصورة صحيحة."}</p>
          <button className="crm-primary-button" disabled={loading} onClick={() => void load()}><ArrowClockwise size={18} />{loading ? "جاري التحقق" : "إعادة المحاولة"}</button>
        </div>
      </section>
    );
  }

  return (
    <div className="crm-automation-settings">
      <section className="crm-automation-summary">
        <article><Pulse size={24} weight="duotone" /><span>الحالة</span><strong>{general.automationEnabled ? "نشط" : "متوقف"}</strong></article>
        <article><LinkSimple size={24} weight="duotone" /><span>المنصات النشطة</span><strong>{enabledPlatforms}</strong></article>
        <article><FlowArrow size={24} weight="duotone" /><span>السيناريوهات</span><strong>{enabledFlows}</strong></article>
        <article><CheckCircle size={24} weight="duotone" /><span>جلسات حالية</span><strong>{activeSessions}</strong></article>
      </section>

      <div className="crm-automation-subtabs">
        <button className={section === "general" ? "active" : ""} onClick={() => setSection("general")}><GearSix size={17} />الحالة والسياسة</button>
        <button className={section === "platforms" ? "active" : ""} onClick={() => setSection("platforms")}><LinkSimple size={17} />المنصات والـWorkers</button>
        <button className={section === "messages" ? "active" : ""} onClick={() => setSection("messages")}><Plus size={17} />رسائل البداية</button>
        <button className={section === "flows" ? "active" : ""} onClick={() => setSection("flows")}><FlowArrow size={17} />الاختيارات والفلو</button>
        <button className={section === "sessions" ? "active" : ""} onClick={() => setSection("sessions")}><Pulse size={17} />الجلسات والسجل</button>
        <button className="crm-automation-refresh" onClick={() => void load()}><ArrowClockwise size={17} />{loading ? "جاري التحميل" : "تحديث"}</button>
      </div>

      {notice ? <div className="crm-inline-notice">{notice}</div> : null}
      {general.automationEnabled && enabledPlatforms === 0 ? <div className="crm-automation-warning"><LinkSimple size={19} /><span><strong>الأوتوميشن جاهز لكنه لن يعمل قبل تفعيل منصة واحدة على الأقل.</strong><small>اربط Facebook أو أي منصة من تبويب المنصات والـWorkers ثم نفّذ Health Check.</small></span></div> : null}

      {section === "general" ? (
        <section className="crm-panel crm-automation-general">
          <header><div><h2>الحالة العامة وسياسة التشغيل</h2><p>هذه القيم تُطبق من الـBackend عند وصول الرسائل، وليست إعدادات عرض فقط.</p></div></header>
          <div className="crm-form-grid crm-form-grid-wide">
            <label><span>اسم الأوتوميشن</span><input value={general.automationName} onChange={(event) => setGeneral((current) => ({ ...current, automationName: event.target.value }))} /></label>
            <label><span>متى يعمل الأوتوميشن؟</span><select value={general.triggerPolicy} onChange={(event) => setGeneral((current) => ({ ...current, triggerPolicy: event.target.value }))}><option value="every_message">مع كل رسالة واردة خارج جلسة نشطة</option><option value="once_24_hours">مرة كل 24 ساعة</option><option value="custom">مدة مخصصة</option></select></label>
            {general.triggerPolicy === "custom" ? <><label><span>قيمة المدة</span><input type="number" min={1} value={general.customIntervalValue} onChange={(event) => setGeneral((current) => ({ ...current, customIntervalValue: Number(event.target.value) }))} /></label><label><span>وحدة المدة</span><select value={general.customIntervalUnit} onChange={(event) => setGeneral((current) => ({ ...current, customIntervalUnit: event.target.value }))}><option value="minute">دقيقة</option><option value="hour">ساعة</option><option value="day">يوم</option></select></label></> : null}
          </div>
          <label className="crm-switch-row crm-automation-master-switch"><input type="checkbox" checked={general.automationEnabled} onChange={(event) => setGeneral((current) => ({ ...current, automationEnabled: event.target.checked }))} /><span><strong>تشغيل الأوتوميشن</strong><small>عند الإيقاف تستمر الرسائل والمرفقات في الدخول بدون بدء جلسات أو إرسال ردود تلقائية.</small></span></label>
          <div className="crm-rule-safety"><span>✓ جلسة واحدة فقط للعميل.</span><span>✓ الرسالة داخل الجلسة تعتبر إجابة.</span><span>✓ التوزيع من المحرك المركزي فقط.</span><span>✓ منع تكرار Webhook والإجراء النهائي.</span></div>
          <div className="crm-form-actions"><button className="crm-primary-button" disabled={saving} onClick={() => void save("general", general)}><FloppyDisk size={18} />حفظ الحالة والسياسة</button></div>
        </section>
      ) : null}

      {section === "platforms" ? (
        <div className="crm-automation-platform-list">
          {(data.platforms || []).map((platform: any) => (
            <section className={`crm-panel crm-automation-platform ${platform.connection_status}`} key={platform.id || platform.platform_code}>
              <header><div><h2>{platform.platform_code}</h2><p>{platform.worker_name || "لم يتم اختيار Worker"}</p></div><b>{statusLabel(platform.connection_status)}</b></header>
              <div className="crm-form-grid crm-form-grid-wide">
                <label><span>كود المنصة</span><input value={platform.platform_code} disabled /></label>
                <label><span>الـWorker المرتبط</span><select value={platform.worker_code || ""} onChange={(event) => setData((current: any) => ({ ...current, platforms: current.platforms.map((row: any) => row.id === platform.id ? { ...row, worker_code: event.target.value } : row) }))}><option value="">اختر Worker</option>{(data.workers || []).filter((worker: any) => String(worker.code || "").toLowerCase() === String(platform.platform_code || "").toLowerCase()).map((worker: any) => <option key={worker.code} value={worker.code}>{worker.display_name} ({worker.code})</option>)}</select></label>
                <label><span>Health Check</span><input value={platform.health_url || platform.endpoint_health_url || ""} onChange={(event) => setData((current: any) => ({ ...current, platforms: current.platforms.map((row: any) => row.id === platform.id ? { ...row, health_url: event.target.value } : row) }))} /></label>
                <label className="crm-switch-row"><input type="checkbox" checked={platform.is_enabled !== false} onChange={(event) => setData((current: any) => ({ ...current, platforms: current.platforms.map((row: any) => row.id === platform.id ? { ...row, is_enabled: event.target.checked } : row) }))} /><span>تشغيل الأوتوميشن على المنصة</span></label>
              </div>
              <div className="crm-automation-platform-meta"><span><small>مسار الإرسال</small><strong>{platform.worker_send_url || "غير مضبوط"}</strong></span><span><small>آخر نجاح</small><strong>{platform.last_success_at ? formatDate(platform.last_success_at) : "—"}</strong></span><span><small>آخر خطأ</small><strong>{platform.last_error || "—"}</strong></span></div>
              <footer><button className="crm-secondary-button" disabled={!platform.health_url && !platform.endpoint_health_url} onClick={() => void healthCheck(platform.platform_code)}><Pulse size={17} />Health Check</button><button className="crm-primary-button" onClick={() => void save("platform", { platformCode: platform.platform_code, workerCode: platform.worker_code, isEnabled: platform.is_enabled, healthUrl: platform.health_url || platform.endpoint_health_url })}><FloppyDisk size={17} />حفظ الربط</button></footer>
            </section>
          ))}
          {!data.platforms?.length ? <div className="crm-empty-state">لا توجد منصات مربوطة. أضف الـWorker أولًا من تبويب ربط المنصات والـWorkers.</div> : null}
        </div>
      ) : null}

      {section === "messages" ? (
        <div className="crm-automation-message-workspace">
          <div className="crm-admin-stack">
          <section className="crm-panel crm-form-panel">
            <header><div><h2>{messageForm.id ? "تعديل رسالة بداية" : "إضافة رسالة بداية"}</h2><p>تُرسل الرسائل النشطة حسب الترتيب، وتظهر أزرار الخدمات مع آخر رسالة.</p></div></header>
            <div className="crm-form-grid crm-form-grid-wide"><label><span>المعرف الداخلي</span><input value={messageForm.messageKey} onChange={(event) => setMessageForm((current: any) => ({ ...current, messageKey: event.target.value }))} /></label><label><span>الترتيب</span><input type="number" value={messageForm.sortOrder} onChange={(event) => setMessageForm((current: any) => ({ ...current, sortOrder: Number(event.target.value) }))} /></label></div>
            <label className="crm-form-label"><span>نص الرسالة</span><textarea rows={7} value={messageForm.messageText} onChange={(event) => setMessageForm((current: any) => ({ ...current, messageText: event.target.value }))} /></label>
            <label className="crm-switch-row"><input type="checkbox" checked={messageForm.isActive} onChange={(event) => setMessageForm((current: any) => ({ ...current, isActive: event.target.checked }))} /><span>الرسالة نشطة</span></label>
            <div className="crm-form-actions"><button className="crm-secondary-button" onClick={() => setMessageForm(blankMessage)}><Plus size={17} />رسالة جديدة</button><button className="crm-primary-button" onClick={async () => { if (await save("start_message", messageForm)) setMessageForm(blankMessage); }}><FloppyDisk size={17} />حفظ الرسالة</button></div>
          </section>
          <section className="crm-panel crm-list-panel"><header><h2>ترتيب رسائل البداية</h2><span>{data.startMessages?.length || 0}</span></header><div className="crm-automation-message-list">{(data.startMessages || []).map((row: any, index: number) => <article key={row.id} className={!row.is_active ? "inactive" : ""}><b>{index + 1}</b><div><strong>{row.message_key}</strong><p>{row.message_text}</p></div><span>{row.is_active ? "نشطة" : "موقوفة"}</span><nav><button onClick={() => setMessageForm({ id: row.id, messageKey: row.message_key, messageText: row.message_text, isActive: row.is_active, sortOrder: row.sort_order })}>تعديل</button><button onClick={() => void remove("start_message", row.id)}><Trash size={16} /></button></nav></article>)}</div></section>
          </div>
          <aside className="crm-panel crm-automation-preview">
            <header><ChatCircleDots size={25} weight="duotone" /><div><h2>معاينة بداية المحادثة</h2><p>المعاينة تُظهر الرسائل النشطة وترتيب الاختيارات المحفوظ حاليًا.</p></div></header>
            <div className="crm-automation-phone-preview">
              <div className="crm-automation-phone-head"><span>MZJ</span><small>رد تلقائي</small></div>
              <div className="crm-automation-phone-body">
                {previewMessages.map((row: any) => <p key={row.id || row.message_key}>{row.message_text}</p>)}
                <div className="crm-automation-preview-buttons">{previewFlows.map((flow: any) => <button key={flow.id || flow.flow_code}>{flow.emoji ? `${flow.emoji} ` : ""}{flow.display_name}</button>)}</div>
                {!previewMessages.length ? <em>لا توجد رسائل بداية نشطة.</em> : null}
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {section === "flows" ? (
        <div className="crm-automation-flow-layout">
          <aside className="crm-panel crm-automation-flow-sidebar"><header><h2>الاختيارات</h2><button onClick={() => setFlowForm({ ...blankFlow, aliases: [{ ...blankAlias }], steps: [] })}><Plus size={16} /></button></header>{(data.flows || []).map((row: any) => <button key={row.id} className={flowForm.id === row.id ? "active" : ""} onClick={() => setFlowForm(fromFlow(row))}><span>{row.emoji || "•"}</span><div><strong>{row.display_name}</strong><small>{row.flow_code} · {(row.steps || []).filter((step: any) => step.isActive !== false).length} خطوات</small></div><b>{row.is_active ? "نشط" : "موقوف"}</b></button>)}</aside>
          <section className="crm-panel crm-automation-flow-editor">
            <header><div><h2>{flowForm.id ? `تعديل ${flowForm.displayName}` : "اختيار جديد"}</h2><p>الانتقال يعتمد على المعرفات الداخلية والترتيب، وليس على نص السؤال.</p></div>{flowForm.id ? <button className="crm-danger-link" onClick={() => void remove("flow", flowForm.id)}><Trash size={17} />حذف</button> : null}</header>
            <div className="crm-automation-editor-section"><h3><span>1</span>بيانات الاختيار</h3><div className="crm-form-grid crm-form-grid-wide"><label><span>الاسم الظاهر</span><input value={flowForm.displayName} onChange={(event) => setFlowForm((current: any) => ({ ...current, displayName: event.target.value }))} /></label><label><span>Emoji</span><input value={flowForm.emoji} onChange={(event) => setFlowForm((current: any) => ({ ...current, emoji: event.target.value }))} /></label><label><span>الكود الداخلي</span><input value={flowForm.flowCode} onChange={(event) => setFlowForm((current: any) => ({ ...current, flowCode: event.target.value }))} /></label><label><span>Payload الزر</span><input value={flowForm.buttonPayload} onChange={(event) => setFlowForm((current: any) => ({ ...current, buttonPayload: event.target.value }))} /></label><label><span>الخدمة</span><select value={flowForm.serviceKey} onChange={(event) => { const serviceKey = event.target.value; const departmentCode = serviceKey === "finance" ? "finance_sales" : serviceKey === "service" ? "customer_service" : "cash_sales"; setFlowForm((current: any) => ({ ...current, serviceKey, departmentCode })); }}><option value="cash">مبيعات الكاش</option><option value="finance">مبيعات التمويل</option><option value="service">خدمة العملاء</option></select></label><label><span>القسم</span><select value={flowForm.departmentCode} onChange={(event) => setFlowForm((current: any) => ({ ...current, departmentCode: event.target.value }))}><option value="cash_sales">مبيعات الكاش</option><option value="finance_sales">مبيعات التمويل</option><option value="customer_service">خدمة العملاء</option></select></label><label><span>سياسة الفرع</span><select value={flowForm.branchPolicy} onChange={(event) => setFlowForm((current: any) => ({ ...current, branchPolicy: event.target.value }))}><option value="system">حسب منطق النظام</option><option value="fixed">فرع ثابت</option></select></label>{flowForm.branchPolicy === "fixed" ? <label><span>كود الفرع</span><input value={flowForm.branchCode} onChange={(event) => setFlowForm((current: any) => ({ ...current, branchCode: event.target.value }))} /></label> : null}<label><span>الترتيب</span><input type="number" value={flowForm.sortOrder} onChange={(event) => setFlowForm((current: any) => ({ ...current, sortOrder: Number(event.target.value) }))} /></label><label className="crm-switch-row"><input type="checkbox" checked={flowForm.isActive} onChange={(event) => setFlowForm((current: any) => ({ ...current, isActive: event.target.checked }))} /><span>الاختيار نشط</span></label></div></div>

            <div className="crm-automation-editor-section"><h3><span>2</span>الردود المقبولة</h3><div className="crm-automation-aliases">{flowForm.aliases.map((alias: any, index: number) => <article key={`${index}-${alias.aliasValue}`}><select value={alias.aliasType} onChange={(event) => patchAlias(index, { aliasType: event.target.value })}><option value="text">نص</option><option value="number">رقم</option><option value="payload">Payload</option></select><input value={alias.aliasValue} onChange={(event) => patchAlias(index, { aliasValue: event.target.value })} placeholder="الرد المقبول" /><button onClick={() => setFlowForm((current: any) => ({ ...current, aliases: current.aliases.filter((_: any, itemIndex: number) => itemIndex !== index) }))}><Trash size={16} /></button></article>)}</div><button className="crm-secondary-button" onClick={() => setFlowForm((current: any) => ({ ...current, aliases: [...current.aliases, { ...blankAlias }] }))}><Plus size={16} />إضافة رد مقبول</button></div>

            <div className="crm-automation-editor-section">
              <h3><span>3</span>خطوات الفلو</h3>
              <div className="crm-automation-steps">
                {flowForm.steps.map((step: any, index: number) => (
                  <article key={step.id || `new-${index}`}>
                    <header>
                      <b>{index + 1}</b>
                      <strong>{step.stepName || "خطوة جديدة"}</strong>
                      <nav>
                        <button disabled={index === 0} onClick={() => setFlowForm((current: any) => ({ ...current, steps: move(current.steps, index, -1).map((item: any, idx: number) => ({ ...item, sortOrder: (idx + 1) * 10 })) }))}><CaretUp size={15} /></button>
                        <button disabled={index === flowForm.steps.length - 1} onClick={() => setFlowForm((current: any) => ({ ...current, steps: move(current.steps, index, 1).map((item: any, idx: number) => ({ ...item, sortOrder: (idx + 1) * 10 })) }))}><CaretDown size={15} /></button>
                        <button onClick={() => setFlowForm((current: any) => ({ ...current, steps: current.steps.filter((_: any, itemIndex: number) => itemIndex !== index) }))}><Trash size={15} /></button>
                      </nav>
                    </header>
                    <div className="crm-form-grid crm-form-grid-wide">
                      <label><span>معرف الخطوة</span><input value={step.stepKey} onChange={(event) => patchStep(index, { stepKey: event.target.value })} /></label>
                      <label><span>اسم الخطوة</span><input value={step.stepName} onChange={(event) => patchStep(index, { stepName: event.target.value })} /></label>
                      <label><span>نوع الخطوة</span><select value={step.stepType} onChange={(event) => patchStep(index, { stepType: event.target.value })}><option value="message">رسالة فقط</option><option value="text">سؤال نصي</option><option value="phone">رقم جوال</option><option value="choice">اختيار</option></select></label>
                      <label><span>حقل بيانات العميل</span><select value={step.customerField || ""} onChange={(event) => patchStep(index, { customerField: event.target.value })}><option value="">بدون ربط</option><option value="customer_name">الاسم</option><option value="car_name">السيارة</option><option value="phone">رقم الجوال</option></select></label>
                      <label><span>أقل عدد حروف</span><input type="number" min={0} value={Number(step.validationRules?.minLength || 0)} onChange={(event) => patchStep(index, { validationRules: { ...(step.validationRules || {}), minLength: Number(event.target.value || 0) } })} /></label>
                      <label><span>أقصى عدد حروف</span><input type="number" min={0} value={Number(step.validationRules?.maxLength || 0)} onChange={(event) => patchStep(index, { validationRules: { ...(step.validationRules || {}), maxLength: Number(event.target.value || 0) } })} /></label>
                      <label><span>عدد المحاولات</span><input type="number" min={0} value={step.maxAttempts ?? ""} placeholder="بدون حد" onChange={(event) => patchStep(index, { maxAttempts: event.target.value === "" ? null : Number(event.target.value) })} /></label>
                      <label><span>الترتيب</span><input type="number" value={Number(step.sortOrder || (index + 1) * 10)} onChange={(event) => patchStep(index, { sortOrder: Number(event.target.value || 0) })} /></label>
                    </div>
                    <label className="crm-form-label"><span>نص السؤال أو الرسالة</span><textarea rows={4} value={step.promptText} onChange={(event) => patchStep(index, { promptText: event.target.value })} /></label>
                    {step.stepType === "choice" ? (
                      <label className="crm-form-label"><span>القيم المقبولة للاختيار</span><input value={Array.isArray(step.validationRules?.allowedValues) ? step.validationRules.allowedValues.join("، ") : ""} placeholder="مثال: نعم، لا" onChange={(event) => patchStep(index, { validationRules: { ...(step.validationRules || {}), allowedValues: event.target.value.split(/[,،]/).map((item) => item.trim()).filter(Boolean) } })} /></label>
                    ) : null}
                    <label className="crm-form-label"><span>رسالة خطأ التحقق</span><input value={step.validationError} onChange={(event) => patchStep(index, { validationError: event.target.value })} /></label>
                    <div className="crm-step-switches">
                      <label><input type="checkbox" checked={step.isRequired !== false} onChange={(event) => patchStep(index, { isRequired: event.target.checked })} />الإجابة مطلوبة</label>
                      <label><input type="checkbox" checked={step.isActive !== false} onChange={(event) => patchStep(index, { isActive: event.target.checked })} />الخطوة نشطة</label>
                    </div>
                  </article>
                ))}
              </div>
              <button className="crm-secondary-button" onClick={() => setFlowForm((current: any) => ({ ...current, steps: [...current.steps, { ...blankStep, validationRules: {}, sortOrder: (current.steps.length + 1) * 10 }] }))}><Plus size={16} />إضافة خطوة</button>
            </div>

            <div className="crm-automation-editor-section"><h3><span>4</span>الإجراء النهائي ورسالة النهاية</h3><div className="crm-check-grid">{[["createOrUpdateCustomer","إنشاء أو تحديث العميل"],["setService","تحديد الخدمة"],["setDepartment","تحديد القسم"],["assignSales","توزيع مندوب مبيعات"],["assignCallCenter","توزيع الكول سنتر"],["assignCustomerService","توزيع خدمة العملاء"],["sendFinalMessage","إرسال رسالة النهاية"]].map(([key,label]) => <label key={key}><input type="checkbox" checked={flowForm.finalAction[key] === true} onChange={(event) => setFlowForm((current: any) => ({ ...current, finalAction: { ...current.finalAction, [key]: event.target.checked } }))} />{label}</label>)}</div><label className="crm-form-label"><span>رسالة النهاية</span><textarea rows={5} value={flowForm.finalMessage} onChange={(event) => setFlowForm((current: any) => ({ ...current, finalMessage: event.target.value }))} /></label></div>
            <div className="crm-form-actions"><button className="crm-secondary-button" onClick={() => setFlowForm({ ...blankFlow, aliases: [{ ...blankAlias }], steps: [] })}><Plus size={17} />اختيار جديد</button><button className="crm-primary-button" disabled={saving} onClick={() => void save("flow", flowForm)}><FloppyDisk size={17} />حفظ الاختيار والفلو</button></div>
          </section>
        </div>
      ) : null}

      {section === "sessions" ? (
        <section className="crm-panel crm-list-panel"><header><div><h2>جلسات الأوتوميشن</h2><p>آخر 100 جلسة مع نتيجة الإجراء النهائي والتوزيع.</p></div><span>{data.sessions?.length || 0}</span></header><div className="crm-table-shell"><table className="crm-table"><thead><tr><th>البداية</th><th>العميل</th><th>المنصة</th><th>السيناريو</th><th>الحالة</th><th>الإجراء النهائي</th><th>المندوب</th><th>الكول سنتر</th><th>الخطأ</th></tr></thead><tbody>{(data.sessions || []).map((row: any) => <tr key={row.id}><td>{formatDate(row.started_at)}</td><td>{row.customer_name || "عميل"}</td><td>{row.platform_code}</td><td>{row.flow_name || "بانتظار الاختيار"}</td><td><span className={`crm-automation-status ${row.status}`}>{statusLabel(row.status)}</span></td><td>{statusLabel(row.final_action_status)}</td><td>{row.assigned_name || "—"}</td><td>{row.call_center_name || "—"}</td><td>{row.error_message || "—"}</td></tr>)}</tbody></table></div></section>
      ) : null}
    </div>
  );
}
