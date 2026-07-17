import { useEffect, useState } from "react";
import { ArrowClockwise, FloppyDisk, PencilSimple, Play, Plus, Robot, ToggleLeft, ToggleRight, X } from "@phosphor-icons/react";
import { crmFetch, formatDate } from "../api";

const defaultOptions = [
  { key: "cash", label: "مبيعات كاش", aliases: ["1", "كاش", "مبيعات كاش", "شراء كاش"] },
  { key: "finance", label: "مبيعات تمويل", aliases: ["2", "تمويل", "مبيعات تمويل", "شراء تمويل"] },
  { key: "service", label: "خدمة العملاء", aliases: ["3", "خدمة العملاء", "خدمه العملاء", "خدمة"] },
];

function settingsFromApi(raw: any) {
  return {
    serviceSelectionEnabled: raw?.service_selection_enabled !== false,
    serviceSelectionMessage: raw?.service_selection_message || "",
    serviceOptions: Array.isArray(raw?.service_options) ? raw.service_options : defaultOptions,
    noMatchBehavior: raw?.no_match_behavior || "wait",
    unclassifiedLabel: raw?.unclassified_label || "بانتظار اختيار الخدمة",
    closedStatuses: raw?.closed_statuses || {
      cash: ["تم البيع"],
      finance: ["تم الانتهاء - إنشاء طلب البيع"],
      service: ["تم الانتهاء"],
    },
  };
}

const emptyRule = {
  id: "",
  ruleKey: "",
  name: "",
  description: "",
  triggerEvent: "message.received",
  priority: 100,
  isActive: true,
  runMode: "automatic",
  stopAfterMatch: false,
  maxRunsPerEntity: 1,
  conditionsText: "[]",
  actionsText: "[]",
};

export function CrmAutomationsPage() {
  const [data, setData] = useState<any>({ settings: null, rules: [], runs: [], jobs: [] });
  const [form, setForm] = useState<any>(settingsFromApi(null));
  const [tab, setTab] = useState<"settings" | "rules" | "runs">("settings");
  const [ruleForm, setRuleForm] = useState<any>(emptyRule);
  const [showRuleEditor, setShowRuleEditor] = useState(false);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const result = await crmFetch<any>("/api/crm/automations");
      setData(result);
      setForm(settingsFromApi(result.settings));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل الأوتوميشن");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function saveSettings() {
    try {
      await crmFetch("/api/crm/automations", { method: "PUT", body: JSON.stringify({ section: "settings", ...form }) });
      setNotice("تم حفظ إعدادات التصنيف وقواعد إغلاق الطلب.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "فشل الحفظ");
    }
  }

  async function toggleRule(rule: any) {
    try {
      await crmFetch("/api/crm/automations", {
        method: "POST",
        body: JSON.stringify({
          section: "rule", id: rule.id, ruleKey: rule.rule_key, name: rule.name, description: rule.description,
          triggerEvent: rule.trigger_event, priority: rule.priority, isActive: !rule.is_active, runMode: rule.run_mode,
          conditions: rule.conditions, actions: rule.actions, stopAfterMatch: rule.stop_after_match, maxRunsPerEntity: rule.max_runs_per_entity,
        }),
      });
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تعديل القاعدة");
    }
  }

  function editRule(rule?: any) {
    if (!rule) setRuleForm(emptyRule);
    else setRuleForm({
      id: rule.id,
      ruleKey: rule.rule_key,
      name: rule.name,
      description: rule.description || "",
      triggerEvent: rule.trigger_event,
      priority: Number(rule.priority || 100),
      isActive: rule.is_active !== false,
      runMode: rule.run_mode || "automatic",
      stopAfterMatch: rule.stop_after_match === true,
      maxRunsPerEntity: Number(rule.max_runs_per_entity || 1),
      conditionsText: JSON.stringify(rule.conditions || [], null, 2),
      actionsText: JSON.stringify(rule.actions || [], null, 2),
    });
    setShowRuleEditor(true);
  }

  async function saveRule() {
    try {
      const conditions = JSON.parse(ruleForm.conditionsText || "[]");
      const actions = JSON.parse(ruleForm.actionsText || "[]");
      if (!Array.isArray(conditions) || !Array.isArray(actions)) throw new Error("الشروط والإجراءات يجب أن تكون مصفوفات JSON");
      await crmFetch("/api/crm/automations", {
        method: "POST",
        body: JSON.stringify({ section: "rule", ...ruleForm, conditions, actions }),
      });
      setShowRuleEditor(false);
      setRuleForm(emptyRule);
      setNotice("تم حفظ قاعدة الأوتوميشن.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر حفظ القاعدة");
    }
  }

  async function processDue() {
    try {
      const result = await crmFetch<any>("/api/crm/automations", { method: "POST", body: JSON.stringify({ action: "process_due" }) });
      setNotice(`تم فحص ${result.processed || 0} مهمة مستحقة.`);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "فشل تشغيل المهام");
    }
  }

  function setOption(index: number, key: string, value: any) {
    setForm((current: any) => ({
      ...current,
      serviceOptions: current.serviceOptions.map((item: any, itemIndex: number) => itemIndex === index ? { ...item, [key]: value } : item),
    }));
  }

  return (
    <div className="crm-page crm-automation-page">
      <header className="crm-page-head">
        <div><h1>قواعد الأوتوميشن</h1><p>المنصة هي صاحبة القرار: تصنيف الخدمة، إنشاء الطلب، التوزيع، إغلاق الطلب، ووكيل صندوق الوارد.</p></div>
        <div className="crm-head-actions">
          <button className="crm-secondary-button" onClick={() => void processDue()}><Play size={18} />تشغيل المهام المستحقة</button>
          <button className="crm-secondary-button" onClick={() => void load()}><ArrowClockwise size={18} />{loading ? "جاري التحميل" : "تحديث"}</button>
        </div>
      </header>

      {notice ? <div className="crm-inline-notice">{notice}</div> : null}
      <div className="crm-department-tabs">
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>اختيار الخدمة</button>
        <button className={tab === "rules" ? "active" : ""} onClick={() => setTab("rules")}>القواعد</button>
        <button className={tab === "runs" ? "active" : ""} onClick={() => setTab("runs")}>سجل التشغيل</button>
      </div>

      {tab === "settings" ? (
        <div className="crm-settings-grid">
          <section className="crm-panel settings-card full">
            <h2>رسالة اختيار الخدمة</h2>
            <label className="crm-switch-row"><input type="checkbox" checked={form.serviceSelectionEnabled} onChange={(event) => setForm((current: any) => ({ ...current, serviceSelectionEnabled: event.target.checked }))} /><span>إرسال الرسالة تلقائيًا عند عدم وجود طلب مفتوح</span></label>
            <label className="crm-form-label"><span>نص الرسالة</span><textarea rows={7} value={form.serviceSelectionMessage} onChange={(event) => setForm((current: any) => ({ ...current, serviceSelectionMessage: event.target.value }))} /></label>
            <p className="crm-help-text">العميل يختار الخدمة فقط. اختيار الفرع مغلق دائمًا ويتم داخليًا من قواعد التوزيع. الاختيارات الثلاثة تُرسل كأزرار عندما يدعمها مزود القناة، ويظل نص الأرقام بديلًا مضمونًا.</p>
          </section>
          <section className="crm-panel settings-card full">
            <h2>الخدمات والردود المقبولة</h2>
            <div className="crm-service-option-editor">
              {form.serviceOptions.map((option: any, index: number) => (
                <article key={option.key}>
                  <strong>{option.label}</strong>
                  <label><span>الاسم الظاهر</span><input value={option.label} onChange={(event) => setOption(index, "label", event.target.value)} /></label>
                  <label><span>الكلمات والأرقام المقبولة</span><input value={(option.aliases || []).join("، ")} onChange={(event) => setOption(index, "aliases", event.target.value.split(/[،,]/).map((item) => item.trim()).filter(Boolean))} /></label>
                </article>
              ))}
            </div>
          </section>
          <section className="crm-panel settings-card">
            <h2>إغلاق الطلب</h2>
            {["cash", "finance", "service"].map((key) => (
              <label className="crm-form-label" key={key}>
                <span>{key === "cash" ? "مبيعات الكاش" : key === "finance" ? "مبيعات التمويل" : "خدمة العملاء"}</span>
                <input value={(form.closedStatuses[key] || []).join("، ")} onChange={(event) => setForm((current: any) => ({ ...current, closedStatuses: { ...current.closedStatuses, [key]: event.target.value.split(/[،,]/).map((item) => item.trim()).filter(Boolean) } }))} />
              </label>
            ))}
          </section>
          <section className="crm-panel settings-card"><h2>ضوابط ثابتة</h2><div className="crm-rule-safety"><span>✓ لا يتم إنشاء ليد قبل تحديد الخدمة</span><span>✓ لا يتم سؤال العميل عن الفرع</span><span>✓ لا يتم توزيع العميل مرتين</span><span>✓ الطلب المغلق لا يُفتح تلقائيًا</span></div></section>
          <div className="crm-settings-save"><button className="crm-primary-button" onClick={() => void saveSettings()}><FloppyDisk size={18} />حفظ الإعدادات</button></div>
        </div>
      ) : null}

      {tab === "rules" ? (
        <div className="crm-automation-rules">
          <div className="crm-rules-toolbar"><button className="crm-primary-button" onClick={() => editRule()}><Plus size={18} />إضافة قاعدة</button></div>
          {showRuleEditor ? (
            <section className="crm-panel crm-rule-editor">
              <header><h2>{ruleForm.id ? "تعديل القاعدة" : "إضافة قاعدة جديدة"}</h2><button className="crm-icon-button" onClick={() => setShowRuleEditor(false)}><X size={19} /></button></header>
              <div className="crm-rule-editor-grid">
                <label><span>اسم القاعدة</span><input value={ruleForm.name} onChange={(event) => setRuleForm((current: any) => ({ ...current, name: event.target.value }))} /></label>
                <label><span>كود القاعدة</span><input value={ruleForm.ruleKey} onChange={(event) => setRuleForm((current: any) => ({ ...current, ruleKey: event.target.value }))} /></label>
                <label><span>المحفز</span><select value={ruleForm.triggerEvent} onChange={(event) => setRuleForm((current: any) => ({ ...current, triggerEvent: event.target.value }))}><option value="message.received">وصول رسالة عميل</option><option value="message.sent">إرسال رد بشري</option><option value="lead.status_changed">تغيير حالة العميل</option><option value="lead.assigned">تعيين العميل</option><option value="service_request.closed">إغلاق الطلب</option></select></label>
                <label><span>الأولوية</span><input type="number" value={ruleForm.priority} onChange={(event) => setRuleForm((current: any) => ({ ...current, priority: Number(event.target.value) }))} /></label>
                <label className="full"><span>الوصف</span><input value={ruleForm.description} onChange={(event) => setRuleForm((current: any) => ({ ...current, description: event.target.value }))} /></label>
                <label className="full"><span>الشروط JSON</span><textarea rows={7} dir="ltr" value={ruleForm.conditionsText} onChange={(event) => setRuleForm((current: any) => ({ ...current, conditionsText: event.target.value }))} /></label>
                <label className="full"><span>الإجراءات JSON</span><textarea rows={7} dir="ltr" value={ruleForm.actionsText} onChange={(event) => setRuleForm((current: any) => ({ ...current, actionsText: event.target.value }))} /></label>
                <label className="crm-switch-row"><input type="checkbox" checked={ruleForm.isActive} onChange={(event) => setRuleForm((current: any) => ({ ...current, isActive: event.target.checked }))} /><span>القاعدة فعالة</span></label>
                <label className="crm-switch-row"><input type="checkbox" checked={ruleForm.stopAfterMatch} onChange={(event) => setRuleForm((current: any) => ({ ...current, stopAfterMatch: event.target.checked }))} /><span>إيقاف بقية القواعد بعد التطابق</span></label>
              </div>
              <button className="crm-primary-button" onClick={() => void saveRule()}><FloppyDisk size={18} />حفظ القاعدة</button>
            </section>
          ) : null}
          {data.rules.map((rule: any) => (
            <article className="crm-panel crm-automation-rule" key={rule.id}>
              <div><Robot size={24} weight="duotone" /><span><strong>{rule.name}</strong><small>{rule.description || rule.trigger_event}</small></span></div>
              <div className="crm-rule-meta"><span>المحفز: {rule.trigger_event}</span><span>الأولوية: {rule.priority}</span><button onClick={() => editRule(rule)}><PencilSimple size={18} /> تعديل</button><button onClick={() => void toggleRule(rule)}>{rule.is_active ? <ToggleRight size={30} weight="fill" /> : <ToggleLeft size={30} />} {rule.is_active ? "مفعلة" : "متوقفة"}</button></div>
            </article>
          ))}
        </div>
      ) : null}

      {tab === "runs" ? (
        <div className="crm-table-shell"><table className="crm-table"><thead><tr><th>الوقت</th><th>القاعدة</th><th>النتيجة</th><th>الخطأ</th></tr></thead><tbody>{data.runs.map((run: any) => <tr key={run.id}><td>{formatDate(run.started_at)}</td><td>{run.rule_name || run.rule_key || "—"}</td><td>{run.status}</td><td>{run.error_message || "—"}</td></tr>)}{!data.runs.length ? <tr><td colSpan={4}><div className="crm-empty-state">لا توجد عمليات بعد.</div></td></tr> : null}</tbody></table></div>
      ) : null}
    </div>
  );
}
