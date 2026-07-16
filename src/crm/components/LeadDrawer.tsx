import { useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  CalendarBlank,
  ChatCircleDots,
  PaperPlaneTilt,
  Phone,
  UserCircle,
  WhatsappLogo,
  X,
} from "@phosphor-icons/react";
import { crmFetch, departmentKeyFromCode, departmentLabel, formatDate } from "../api";
import { messagePolicyForLead, providerStatusLabel, sourceLabel } from "../sourceCatalog";
import type { CrmCustomerField, CrmLead, CrmMessage, CrmMeta } from "../types";

type Props = {
  lead: CrmLead | null;
  meta: CrmMeta | null;
  onClose: () => void;
  onSaved: (lead: CrmLead) => void;
};

type ServiceKey = "cash" | "finance" | "service";

type CustomerForm = {
  id: string;
  serviceKey: ServiceKey;
  departmentCode: string;
  branchCode: string;
  paymentType: string;
  values: Record<string, string>;
  customFields: Record<string, string>;
};

const emptyMessages: CrmMessage[] = [];
const fallbackFinanceOptions = [
  { value: "general", label: "عام 45%" },
  { value: "rate55", label: "55%" },
  { value: "realEstate", label: "عقاري 65%" },
];

const fallbackFields: CrmCustomerField[] = [
  { id: "status_label", field_key: "status_label", label: "حالة العميل", field_type: "status", sort_order: 10, department_keys: [], is_active: true, is_required: true, include_in_completion: true, options: [], is_system: true, is_locked: true },
  { id: "follow_up_at", field_key: "follow_up_at", label: "تاريخ المتابعة", field_type: "date", sort_order: 20, department_keys: [], is_active: true, is_required: false, include_in_completion: false, options: [], is_system: true, is_locked: false },
  { id: "source_code", field_key: "source_code", label: "المصدر", field_type: "source", sort_order: 30, department_keys: [], is_active: true, is_required: true, include_in_completion: true, options: [], is_system: true, is_locked: true },
  { id: "department_code", field_key: "department_code", label: "القسم", field_type: "department", sort_order: 40, department_keys: [], is_active: true, is_required: true, include_in_completion: true, options: [], is_system: true, is_locked: true },
  { id: "department_transfer", field_key: "department_transfer", label: "تحويل لقسم آخر", field_type: "transfer", sort_order: 50, department_keys: [], is_active: true, is_required: false, include_in_completion: false, options: [], is_system: true, is_locked: true },
  { id: "customer_name", field_key: "customer_name", label: "اسم العميل", field_type: "text", sort_order: 60, department_keys: [], is_active: true, is_required: true, include_in_completion: true, options: [], is_system: true, is_locked: true },
  { id: "phone", field_key: "phone", label: "رقم الجوال", field_type: "phone", sort_order: 70, department_keys: [], is_active: true, is_required: true, include_in_completion: true, options: [], is_system: true, is_locked: true },
  { id: "age", field_key: "age", label: "العمر", field_type: "number", sort_order: 80, department_keys: [], is_active: true, is_required: false, include_in_completion: true, options: [], is_system: true, is_locked: false },
  { id: "salary", field_key: "salary", label: "الراتب", field_type: "number", sort_order: 90, department_keys: [], is_active: true, is_required: false, include_in_completion: true, options: [], is_system: true, is_locked: true },
  { id: "obligation", field_key: "obligation", label: "الالتزام إن وجد", field_type: "number", sort_order: 100, department_keys: [], is_active: true, is_required: false, include_in_completion: true, options: [], is_system: true, is_locked: true },
  { id: "salary_bank", field_key: "salary_bank", label: "نزول الراتب على أي بنك", field_type: "text", sort_order: 110, department_keys: [], is_active: true, is_required: false, include_in_completion: true, options: [], is_system: true, is_locked: false },
  { id: "location", field_key: "location", label: "المكان", field_type: "text", sort_order: 120, department_keys: [], is_active: true, is_required: false, include_in_completion: true, options: [], is_system: true, is_locked: false },
  { id: "car_type", field_key: "car_type", label: "نوع السيارة", field_type: "text", sort_order: 130, department_keys: [], is_active: true, is_required: false, include_in_completion: true, options: [], is_system: true, is_locked: false },
  { id: "car_model", field_key: "car_model", label: "الموديل", field_type: "text", sort_order: 140, department_keys: [], is_active: true, is_required: false, include_in_completion: true, options: [], is_system: true, is_locked: false },
  { id: "color", field_key: "color", label: "اللون", field_type: "text", sort_order: 150, department_keys: [], is_active: true, is_required: false, include_in_completion: true, options: [], is_system: true, is_locked: false },
  { id: "finance_type", field_key: "finance_type", label: "نوع التمويل", field_type: "select", sort_order: 160, department_keys: ["finance"], is_active: true, is_required: false, include_in_completion: false, options: fallbackFinanceOptions, is_system: true, is_locked: true },
  { id: "notes", field_key: "notes", label: "ملاحظات", field_type: "textarea", sort_order: 170, department_keys: [], is_active: true, is_required: false, include_in_completion: false, options: [], is_system: true, is_locked: false },
];

function value(input: unknown) {
  return input == null ? "" : String(input);
}

function departmentCodeFor(key: ServiceKey) {
  if (key === "finance") return "finance_sales";
  if (key === "service") return "customer_service";
  return "cash_sales";
}

function branchCodeFor(key: ServiceKey) {
  if (key === "finance") return "online";
  if (key === "service") return "customer_service";
  return "";
}

function paymentTypeFor(key: ServiceKey) {
  if (key === "finance") return "تمويل";
  if (key === "service") return "خدمة عملاء";
  return "كاش";
}

function isPostponed(status?: string) {
  return String(status || "").trim() === "مؤجل";
}

function normalizeOptions(field: CrmCustomerField) {
  if (!Array.isArray(field.options)) return [];
  return field.options.map((item) => typeof item === "string" ? ({ value: item, label: item }) : item).filter((item) => item?.value);
}

function leadCoreValues(lead: CrmLead, serviceKey: ServiceKey) {
  return {
    status_label: value(lead.status_label || "عميل جديد"),
    follow_up_at: lead.follow_up_at ? new Date(lead.follow_up_at).toISOString().slice(0, 10) : "",
    source_code: value(lead.source_code),
    department_code: value(lead.department_code) || departmentCodeFor(serviceKey),
    customer_name: value(lead.customer_name),
    phone: value(lead.phone || lead.phone_normalized),
    age: value(lead.age),
    salary: value(lead.salary),
    obligation: value(lead.obligation),
    salary_bank: value(lead.salary_bank),
    location: value(lead.location),
    car_type: value(lead.car_type || lead.car_name),
    car_model: value(lead.car_model),
    color: value(lead.color),
    finance_type: value(lead.finance_type) || (serviceKey === "finance" ? "general" : ""),
    notes: value(lead.notes),
  };
}

export function LeadDrawer({ lead, meta, onClose, onSaved }: Props) {
  const [form, setForm] = useState<CustomerForm | null>(null);
  const [messages, setMessages] = useState<CrmMessage[]>(emptyMessages);
  const [conversationId, setConversationId] = useState("");
  const [conversationChannel, setConversationChannel] = useState("");
  const [messageText, setMessageText] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!lead) {
      setForm(null);
      return;
    }
    const serviceKey = departmentKeyFromCode(lead.department_code || lead.service_key) as ServiceKey;
    const extra = lead.extra_data && typeof lead.extra_data === "object" ? lead.extra_data : {};
    setForm({
      id: lead.id,
      serviceKey,
      departmentCode: value(lead.department_code) || departmentCodeFor(serviceKey),
      branchCode: value(lead.branch_code) || branchCodeFor(serviceKey),
      paymentType: value(lead.payment_type) || paymentTypeFor(serviceKey),
      values: leadCoreValues(lead, serviceKey),
      customFields: Object.fromEntries(Object.entries(extra).map(([key, raw]) => [key, value(raw)])),
    });
    setMessages([]);
    setConversationId(lead.conversation_id || "");
    setConversationChannel(lead.channel_code || "");
    setMessageText("");
    setNotice("");
    void loadConversation(lead.id, lead.conversation_id || "");
  }, [lead?.id]);

  async function loadConversation(leadId: string, preferredId = "") {
    setLoadingMessages(true);
    try {
      let id = preferredId;
      if (!id) {
        const result = await crmFetch<{ ok: boolean; rows: Array<{ id: string; channel_code?: string | null }> }>(`/api/crm/conversations?leadId=${encodeURIComponent(leadId)}&limit=1`);
        id = result.rows[0]?.id || "";
        setConversationId(id);
        setConversationChannel(result.rows[0]?.channel_code || "");
      }
      if (id) {
        const result = await crmFetch<{ ok: boolean; conversation?: { channel_code?: string | null }; messages: CrmMessage[] }>(`/api/crm/conversations?conversationId=${encodeURIComponent(id)}&limit=300`);
        setConversationChannel(result.conversation?.channel_code || "");
        setMessages(result.messages || []);
      } else setMessages([]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل المحادثة");
    } finally {
      setLoadingMessages(false);
    }
  }

  const department = form?.serviceKey || "cash";
  const statuses = useMemo(() => (meta?.statuses || [])
    .filter((item) => item.department_code === department && item.is_active !== false)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)), [meta, department]);

  const configuredFields = useMemo(() => {
    const source = meta?.customerFields?.length ? meta.customerFields : fallbackFields;
    return source.filter((field) => field.is_active !== false && (!field.department_keys?.length || field.department_keys.includes(department)))
      .filter((field) => field.field_key !== "follow_up_at" || isPostponed(form?.values.status_label))
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  }, [meta?.customerFields, department, form?.values.status_label]);

  const mappedTemplate = useMemo(() => {
    if (!form) return undefined;
    const mapping = (meta?.mappings || []).find((item) => item.department_code === departmentCodeFor(form.serviceKey) && item.status_value === form.values.status_label);
    return mapping ? (meta?.templates || []).find((template) => template.id === mapping.template_id) : undefined;
  }, [meta, form?.serviceKey, form?.values.status_label]);

  useEffect(() => { setSelectedTemplate(mappedTemplate?.id || ""); }, [mappedTemplate?.id]);

  const credit = useMemo(() => {
    if (!form || form.serviceKey !== "finance") return null;
    const salary = Number(form.values.salary || 0);
    const obligation = Number(form.values.obligation || 0);
    const financeField = configuredFields.find((field) => field.field_key === "finance_type");
    const options = financeField ? normalizeOptions(financeField) : fallbackFinanceOptions;
    const selectedValue = form.values.finance_type;
    const selectedLabel = options.find((item) => item.value === selectedValue)?.label || selectedValue;
    const ratio = selectedValue === "rate55" || selectedLabel.includes("55") ? 0.55 : selectedValue === "realEstate" || selectedLabel.includes("65") || selectedLabel.includes("عقاري") ? 0.65 : selectedValue ? 0.45 : 0;
    if (!salary || !ratio) return { amount: null as number | null, qualified: null as boolean | null };
    const amount = salary * ratio - obligation;
    return { amount, qualified: amount >= 650 };
  }, [form?.values.salary, form?.values.obligation, form?.values.finance_type, form?.serviceKey, configuredFields]);

  const selectedSourceConfig = useMemo(() => (meta?.sources || []).find((source) => source.code === (form?.values.source_code || lead?.source_code)), [meta, form?.values.source_code, lead?.source_code]);
  const policy = useMemo(() => messagePolicyForLead({
    source_code: form?.values.source_code || lead?.source_code,
    source_name: selectedSourceConfig?.name || lead?.source_name,
    platform_code: lead?.platform_code,
    channel_code: conversationChannel || lead?.channel_code,
  }, selectedSourceConfig), [form?.values.source_code, lead?.source_code, lead?.source_name, lead?.platform_code, lead?.channel_code, conversationChannel, selectedSourceConfig]);

  const availableTemplates = useMemo(() => (meta?.templates || []).filter((template) => {
    if (!template.departments?.length) return true;
    const code = departmentCodeFor(department);
    return template.departments.includes(code) || template.departments.includes(department);
  }), [meta, department]);

  if (!lead || !form) return null;
  const activeForm = form;

  function fieldValue(field: CrmCustomerField) {
    if (field.field_key === "department_transfer") return activeForm.serviceKey || "cash";
    if (field.is_system) return activeForm.values[field.field_key] || "";
    return activeForm.customFields[field.field_key] || "";
  }

  function setField(field: CrmCustomerField, next: string) {
    setForm((current) => {
      if (!current) return current;
      if (field.field_key === "department_transfer") return changeDepartmentState(current, next as ServiceKey);
      if (field.is_system) return { ...current, values: { ...current.values, [field.field_key]: next } };
      return { ...current, customFields: { ...current.customFields, [field.field_key]: next } };
    });
  }

  function changeDepartmentState(current: CustomerForm, next: ServiceKey) {
    return {
      ...current,
      serviceKey: next,
      departmentCode: departmentCodeFor(next),
      branchCode: branchCodeFor(next),
      paymentType: paymentTypeFor(next),
      values: {
        ...current.values,
        department_code: departmentCodeFor(next),
        status_label: "عميل جديد",
        follow_up_at: "",
        finance_type: next === "finance" ? (current.values.finance_type || "general") : current.values.finance_type,
      },
    };
  }

  async function saveLead() {
    setSaving(true);
    setNotice("");
    try {
      const payload = {
        id: activeForm.id,
        customerName: activeForm.values.customer_name,
        phone: activeForm.values.phone,
        sourceCode: activeForm.values.source_code,
        serviceKey: activeForm.serviceKey,
        departmentCode: activeForm.departmentCode,
        branchCode: activeForm.branchCode,
        statusLabel: activeForm.values.status_label,
        paymentType: activeForm.paymentType,
        followUpAt: activeForm.values.follow_up_at || null,
        age: activeForm.values.age,
        salary: activeForm.values.salary,
        obligation: activeForm.values.obligation,
        salaryBank: activeForm.values.salary_bank,
        location: activeForm.values.location,
        carType: activeForm.values.car_type,
        carName: activeForm.values.car_type,
        carModel: activeForm.values.car_model,
        color: activeForm.values.color,
        financeType: activeForm.values.finance_type,
        notes: activeForm.values.notes,
        customFields: activeForm.customFields,
      };
      const result = await crmFetch<{ ok: boolean; row: CrmLead }>("/api/crm/leads", { method: "PATCH", body: JSON.stringify(payload) });
      onSaved(result.row);
      setNotice("تم حفظ بيانات العميل");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر حفظ بيانات العميل");
    } finally {
      setSaving(false);
    }
  }

  async function sendMessage() {
    if (!conversationId) return setNotice("تعذر تجهيز قناة الإرسال لهذا العميل");
    if (policy.templateOnly && !selectedTemplate) return setNotice("مصدر العميل يسمح بالإرسال عن طريق قالب واتساب فقط");
    if (!messageText.trim() && !selectedTemplate) return;
    setSending(true);
    setNotice("");
    try {
      const result = await crmFetch<{ ok: boolean; message: CrmMessage; providerStatus: string }>("/api/crm/conversations", {
        method: "POST",
        body: JSON.stringify({ conversationId, text: policy.allowFreeText ? messageText : "", templateId: selectedTemplate }),
      });
      if (result.message) setMessages((current) => [...current, result.message]);
      setMessageText("");
      setNotice(result.providerStatus === "queued" ? "تم حفظ الرسالة في قائمة الإرسال" : "تم إرسال الرسالة");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "فشل إرسال الرسالة");
    } finally {
      setSending(false);
    }
  }

  function renderField(field: CrmCustomerField) {
    const currentValue = fieldValue(field);
    const label = <span>{field.label}{field.is_required ? <b className="crm-required-mark"> *</b> : null}</span>;
    if (field.field_type === "status") return <label key={field.id}>{label}<select value={currentValue} onChange={(event) => setField(field, event.target.value)}>{statuses.map((status) => <option key={status.id} value={status.value}>{status.label}</option>)}</select></label>;
    if (field.field_type === "source") return <label key={field.id}>{label}<select value={currentValue} onChange={(event) => setField(field, event.target.value)}><option value="">غير محدد</option>{(meta?.sources || []).map((source) => <option key={source.code} value={source.code}>{sourceLabel(source.code, source.name)}</option>)}</select></label>;
    if (field.field_type === "department") return <label key={field.id}>{label}<input value={departmentLabel(activeForm.departmentCode)} readOnly /></label>;
    if (field.field_type === "transfer") return <label key={field.id}>{label}<select value={activeForm.serviceKey} onChange={(event) => setField(field, event.target.value)}><option value="cash">مبيعات الكاش</option><option value="finance">مبيعات التمويل</option><option value="service">خدمة العملاء</option></select></label>;
    if (field.field_type === "textarea") return <label key={field.id} className="crm-field-wide">{label}<textarea rows={4} value={currentValue} onChange={(event) => setField(field, event.target.value)} /></label>;
    if (field.field_type === "select") {
      const options = normalizeOptions(field);
      return <label key={field.id}>{label}<select value={currentValue} onChange={(event) => setField(field, event.target.value)}><option value="">اختر</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
    }
    return <label key={field.id}>{label}<input type={field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"} inputMode={field.field_type === "phone" ? "tel" : undefined} value={currentValue} onChange={(event) => setField(field, event.target.value)} /></label>;
  }

  return (
    <div className="crm-drawer-backdrop crm-customer-workspace-backdrop" onMouseDown={onClose}>
      <aside className="crm-lead-drawer crm-customer-workspace" onMouseDown={(event) => event.stopPropagation()}>
        <header className="crm-drawer-head crm-customer-workspace-head">
          <div className="crm-customer-title"><span className="crm-customer-avatar"><UserCircle size={34} weight="duotone" /></span><div><span>محادثة العميل</span><h2>{lead.customer_name || "عميل"}</h2><p><Phone size={14} /> {lead.phone || lead.phone_normalized || "بدون رقم جوال"}</p></div></div>
          <div className="crm-customer-head-meta"><span><b>المسؤول:</b> {lead.assigned_name || "غير موزع"}</span>{department === "finance" ? <span><b>الكول سنتر:</b> {lead.call_center_name || "غير موزع"}</span> : null}<span><CalendarBlank size={14} /><b>دخول السيستم:</b> {formatDate(lead.registered_at || lead.created_at)}</span></div>
          <button className="crm-icon-button" type="button" onClick={onClose}><X size={21} /></button>
        </header>

        <div className="crm-drawer-grid crm-customer-workspace-grid">
          <section className="crm-conversation-panel crm-customer-conversation">
            <header><div><span>المحادثة</span><strong>{policy.routeLabel}</strong><small>{policy.reason}</small></div><button className="crm-icon-button" type="button" onClick={() => void loadConversation(lead.id, conversationId)}><ArrowClockwise size={18} /></button></header>
            <div className="crm-messages-list">
              {loadingMessages ? <div className="crm-empty-state">جاري تحميل رسائل المحادثة...</div> : null}
              {!loadingMessages && !messages.length ? <div className="crm-empty-state crm-empty-conversation"><ChatCircleDots size={38} weight="duotone" /><strong>لا توجد رسائل مسجلة</strong><span>يمكن بدء الإرسال من الأسفل حسب قناة ومصدر العميل.</span></div> : null}
              {messages.map((message) => <div key={message.id} className={`crm-message ${message.direction === "out" ? "out" : "in"}`}>{message.body ? <p>{message.body}</p> : null}{message.attachment_url ? <a href={message.attachment_url} target="_blank" rel="noreferrer">{message.file_name || "فتح المرفق"}</a> : null}<small>{formatDate(message.created_at)} {message.provider_status ? `• ${providerStatusLabel(message.provider_status)}` : ""}</small></div>)}
            </div>
            <div className={`crm-message-composer ${policy.templateOnly ? "template-only" : ""}`}>
              <div className="crm-message-route-note">{policy.route === "whatsapp" ? <WhatsappLogo size={19} weight="fill" /> : <ChatCircleDots size={19} />}<span>{policy.reason}</span></div>
              <select value={selectedTemplate} onChange={(event) => setSelectedTemplate(event.target.value)}><option value="">{policy.templateOnly ? "اختر قالب واتساب" : "رسالة بدون قالب"}</option>{availableTemplates.map((template) => <option key={template.id} value={template.id}>{template.display_name}</option>)}</select>
              {policy.allowFreeText ? <textarea value={messageText} onChange={(event) => setMessageText(event.target.value)} placeholder="اكتب رسالتك هنا... Enter للإرسال و Shift + Enter لسطر جديد" rows={3} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} /> : <div className="crm-template-only-warning">النص الحر غير متاح لهذا المصدر. اختار قالب واتساب معتمد ثم اضغط إرسال.</div>}
              <button type="button" disabled={sending || (policy.templateOnly ? !selectedTemplate : (!messageText.trim() && !selectedTemplate))} onClick={() => void sendMessage()}><PaperPlaneTilt size={18} />{sending ? "جاري الإرسال..." : "إرسال"}</button>
            </div>
          </section>

          <section className="crm-drawer-details crm-customer-details-panel">
            <header className="crm-customer-details-title"><h3>بيانات العميل</h3><span className="crm-customer-department-pill">{departmentLabel(form.departmentCode)}</span></header>
            <div className="crm-form-grid">{configuredFields.map(renderField)}</div>
            {department === "finance" ? credit?.amount == null ? <div className="crm-credit-result neutral">الحد الائتماني = أدخل الراتب واختر نوع التمويل</div> : <div className={`crm-credit-result ${credit.qualified ? "good" : "bad"}`}>الحد الائتماني = {Math.round(credit.amount).toLocaleString("ar-SA")} ريال - {credit.qualified ? "مؤهل" : "غير مؤهل"}</div> : null}
            {notice ? <div className="crm-inline-notice">{notice}</div> : null}
            <button className="crm-primary-button crm-save-customer-button" type="button" disabled={saving} onClick={() => void saveLead()}>{saving ? "جاري الحفظ..." : "حفظ بيانات العميل"}</button>
          </section>
        </div>
      </aside>
    </div>
  );
}
