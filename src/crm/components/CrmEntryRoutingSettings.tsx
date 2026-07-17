import { useEffect, useState } from "react";
import { ArrowClockwise, CheckCircle, FloppyDisk, GitBranch, UserCirclePlus } from "@phosphor-icons/react";
import { crmFetch } from "../api";

const defaultOptions = [
  { key: "cash", label: "مبيعات كاش", aliases: ["1", "كاش", "مبيعات كاش", "شراء كاش"] },
  { key: "finance", label: "مبيعات تمويل", aliases: ["2", "تمويل", "مبيعات تمويل", "شراء تمويل"] },
  { key: "service", label: "خدمة العملاء", aliases: ["3", "خدمة العملاء", "خدمه العملاء", "خدمة"] },
];

function fromApi(raw: any) {
  return {
    serviceSelectionEnabled: raw?.service_selection_enabled !== false,
    serviceSelectionMessage: raw?.service_selection_message || "",
    serviceOptions: Array.isArray(raw?.service_options) && raw.service_options.length ? raw.service_options : defaultOptions,
    noMatchBehavior: raw?.no_match_behavior || "wait",
    unclassifiedLabel: raw?.unclassified_label || "بانتظار اختيار الخدمة",
  };
}

export function CrmEntryRoutingSettings() {
  const [form, setForm] = useState<any>(fromApi(null));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    try {
      const result = await crmFetch<any>("/api/crm/entry-routing");
      setForm(fromApi(result.settings));
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل إعدادات دخول العملاء");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function setOption(index: number, key: string, value: any) {
    setForm((current: any) => ({
      ...current,
      serviceOptions: current.serviceOptions.map((item: any, itemIndex: number) => itemIndex === index ? { ...item, [key]: value } : item),
    }));
  }

  async function save() {
    setSaving(true);
    try {
      await crmFetch("/api/crm/entry-routing", {
        method: "PUT",
        body: JSON.stringify({ section: "entry_routing", ...form }),
      });
      await load();
      setNotice("تم حفظ إعدادات دخول وتوزيع العملاء.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر حفظ الإعدادات");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="crm-entry-routing-settings">
      <section className="crm-entry-routing-flow">
        <article><UserCirclePlus size={28} weight="duotone" /><span><b>1</b><strong>استقبال العميل</strong><small>تسجيل العميل والمحادثة والرسالة مرة واحدة بدون توزيع مبكر.</small></span></article>
        <article><GitBranch size={28} weight="duotone" /><span><b>2</b><strong>اختيار الخدمة</strong><small>كاش أو تمويل أو خدمة العملاء فقط، بدون سؤال العميل عن الفرع.</small></span></article>
        <article><CheckCircle size={28} weight="duotone" /><span><b>3</b><strong>إنشاء الطلب والتوزيع</strong><small>إنشاء طلب الخدمة ثم تطبيق قاعدة التوزيع المناسبة للقسم والفرع.</small></span></article>
      </section>

      {notice ? <div className="crm-inline-notice">{notice}</div> : null}

      <div className="crm-settings-grid crm-entry-routing-grid">
        <section className="crm-panel settings-card full">
          <header className="crm-settings-section-head"><div><h2>رسالة اختيار الخدمة</h2><p>تُرسل فقط للعميل الجديد أو للعميل الذي لا يملك طلب خدمة مفتوحًا.</p></div><button className="crm-secondary-button" type="button" onClick={() => void load()}><ArrowClockwise size={17} />{loading ? "جاري التحميل" : "تحديث"}</button></header>
          <label className="crm-switch-row"><input type="checkbox" checked={form.serviceSelectionEnabled} onChange={(event) => setForm((current: any) => ({ ...current, serviceSelectionEnabled: event.target.checked }))} /><span>تشغيل اختيار الخدمة عند دخول العميل</span></label>
          <label className="crm-form-label"><span>نص الرسالة</span><textarea rows={8} value={form.serviceSelectionMessage} onChange={(event) => setForm((current: any) => ({ ...current, serviceSelectionMessage: event.target.value }))} /></label>
          <div className="crm-form-grid crm-form-grid-wide">
            <label><span>عند رد غير معروف</span><select value={form.noMatchBehavior} onChange={(event) => setForm((current: any) => ({ ...current, noMatchBehavior: event.target.value }))}><option value="wait">الانتظار حتى يختار خدمة صحيحة</option></select></label>
            <label><span>اسم الحالة قبل اختيار الخدمة</span><input value={form.unclassifiedLabel} onChange={(event) => setForm((current: any) => ({ ...current, unclassifiedLabel: event.target.value }))} /></label>
          </div>
        </section>

        <section className="crm-panel settings-card full">
          <h2>الخدمات والردود المقبولة</h2>
          <p className="crm-help-text">العميل يختار الخدمة فقط. الفرع والقسم والمندوب يتم تحديدهم داخليًا بعد الاختيار.</p>
          <div className="crm-service-option-editor">
            {form.serviceOptions.map((option: any, index: number) => (
              <article key={option.key}>
                <strong>{option.label}</strong>
                <label><span>الاسم الظاهر للعميل</span><input value={option.label} onChange={(event) => setOption(index, "label", event.target.value)} /></label>
                <label><span>الردود المقبولة</span><input value={(option.aliases || []).join("، ")} onChange={(event) => setOption(index, "aliases", event.target.value.split(/[،,]/).map((item) => item.trim()).filter(Boolean))} /></label>
              </article>
            ))}
          </div>
        </section>

        <section className="crm-panel settings-card">
          <h2>العميل الموجود وله طلب مفتوح</h2>
          <div className="crm-rule-safety"><span>✓ الرسالة تدخل نفس المحادثة.</span><span>✓ يظل العميل مع نفس المندوب.</span><span>✓ لا يتم إنشاء عميل أو طلب جديد.</span><span>✓ لا يتم تشغيل توزيع جديد.</span></div>
        </section>

        <section className="crm-panel settings-card">
          <h2>العميل الجديد أو الطلب السابق المغلق</h2>
          <div className="crm-rule-safety"><span>✓ الاحتفاظ بسجل العميل نفسه.</span><span>✓ إرسال اختيار الخدمة مرة واحدة.</span><span>✓ إنشاء طلب خدمة جديد بعد الاختيار.</span><span>✓ تشغيل التوزيع بعد إنشاء الطلب فقط.</span></div>
        </section>

        <section className="crm-panel settings-card full crm-entry-routing-boundary">
          <h2>حدود التشغيل</h2>
          <p>هذا الجزء مسؤول فقط عن أول دخول للعميل، تحديد الخدمة، إنشاء طلب الخدمة والتوزيع. تغيير الحالات وإرسال الرسائل والقوالب ونقل العميل تظل إجراءات يدوية ينفذها المستخدم من ملف العميل.</p>
        </section>

        <div className="crm-settings-save"><button className="crm-primary-button" type="button" disabled={saving} onClick={() => void save()}><FloppyDisk size={18} />{saving ? "جاري الحفظ..." : "حفظ إعدادات دخول العملاء"}</button></div>
      </div>
    </div>
  );
}
