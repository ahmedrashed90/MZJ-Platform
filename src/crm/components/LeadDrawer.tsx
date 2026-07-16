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
import type { CrmLead, CrmMessage, CrmMeta } from "../types";

type Props = {
  lead: CrmLead | null;
  meta: CrmMeta | null;
  onClose: () => void;
  onSaved: (lead: CrmLead) => void;
};

type CustomerForm = {
  id: string;
  customerName: string;
  phone: string;
  sourceCode: string;
  serviceKey: "cash" | "finance" | "service";
  departmentCode: string;
  branchCode: string;
  statusLabel: string;
  paymentType: string;
  followUpAt: string;
  age: string;
  salary: string;
  obligation: string;
  salaryBank: string;
  location: string;
  carType: string;
  carModel: string;
  color: string;
  financeType: string;
  notes: string;
};

const emptyMessages: CrmMessage[] = [];
const financeTypes = [
  { key: "general", label: "عام 45%", ratio: 0.45 },
  { key: "rate55", label: "55%", ratio: 0.55 },
  { key: "realEstate", label: "عقاري 65%", ratio: 0.65 },
] as const;

function value(input: unknown) {
  return input == null ? "" : String(input);
}

function departmentCodeFor(key: CustomerForm["serviceKey"]) {
  if (key === "finance") return "finance_sales";
  if (key === "service") return "customer_service";
  return "cash_sales";
}

function branchCodeFor(key: CustomerForm["serviceKey"]) {
  if (key === "finance") return "online";
  if (key === "service") return "customer_service";
  return "";
}

function paymentTypeFor(key: CustomerForm["serviceKey"]) {
  if (key === "finance") return "تمويل";
  if (key === "service") return "خدمة عملاء";
  return "كاش";
}

function isPostponed(status?: string) {
  return String(status || "").trim() === "مؤجل";
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
    const serviceKey = departmentKeyFromCode(lead.department_code || lead.service_key) as CustomerForm["serviceKey"];
    setForm({
      id: lead.id,
      customerName: value(lead.customer_name),
      phone: value(lead.phone || lead.phone_normalized),
      sourceCode: value(lead.source_code),
      serviceKey,
      departmentCode: value(lead.department_code) || departmentCodeFor(serviceKey),
      branchCode: value(lead.branch_code) || branchCodeFor(serviceKey),
      statusLabel: value(lead.status_label || "عميل جديد"),
      paymentType: value(lead.payment_type) || paymentTypeFor(serviceKey),
      followUpAt: lead.follow_up_at ? new Date(lead.follow_up_at).toISOString().slice(0, 10) : "",
      age: value(lead.age),
      salary: value(lead.salary),
      obligation: value(lead.obligation),
      salaryBank: value(lead.salary_bank),
      location: value(lead.location),
      carType: value(lead.car_type || lead.car_name),
      carModel: value(lead.car_model),
      color: value(lead.color),
      financeType: value(lead.finance_type) || (serviceKey === "finance" ? "general" : ""),
      notes: value(lead.notes),
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
        const result = await crmFetch<{ ok: boolean; rows: Array<{ id: string; channel_code?: string | null }> }>(
          `/api/crm/conversations?leadId=${encodeURIComponent(leadId)}&limit=1`,
        );
        id = result.rows[0]?.id || "";
        setConversationId(id);
        setConversationChannel(result.rows[0]?.channel_code || "");
      }
      if (id) {
        const result = await crmFetch<{ ok: boolean; conversation?: { channel_code?: string | null }; messages: CrmMessage[] }>(
          `/api/crm/conversations?conversationId=${encodeURIComponent(id)}&limit=300`,
        );
        setConversationChannel(result.conversation?.channel_code || "");
        setMessages(result.messages || []);
      } else {
        setMessages([]);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل المحادثة");
    } finally {
      setLoadingMessages(false);
    }
  }

  const department = form?.serviceKey || "cash";
  const statuses = useMemo(
    () => (meta?.statuses || [])
      .filter((item) => item.department_code === department && item.is_active !== false)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
    [meta, department],
  );

  const mappedTemplate = useMemo(() => {
    if (!form) return undefined;
    const departmentCode = departmentCodeFor(form.serviceKey);
    const mapping = (meta?.mappings || []).find((item) => item.department_code === departmentCode && item.status_value === form.statusLabel);
    return mapping ? (meta?.templates || []).find((template) => template.id === mapping.template_id) : undefined;
  }, [meta, form?.serviceKey, form?.statusLabel]);

  useEffect(() => {
    setSelectedTemplate(mappedTemplate?.id || "");
  }, [mappedTemplate?.id]);

  const credit = useMemo(() => {
    if (!form || form.serviceKey !== "finance") return null;
    const salary = Number(form.salary || 0);
    const obligation = Number(form.obligation || 0);
    const selected = financeTypes.find((item) => item.key === form.financeType || item.label === form.financeType);
    if (!salary || !selected) return { amount: null as number | null, qualified: null as boolean | null };
    const amount = salary * selected.ratio - obligation;
    return { amount, qualified: amount >= 650 };
  }, [form?.salary, form?.obligation, form?.financeType, form?.serviceKey]);

  const selectedSourceConfig = useMemo(
    () => (meta?.sources || []).find((source) => source.code === (form?.sourceCode || lead?.source_code)),
    [meta, form?.sourceCode, lead?.source_code],
  );

  const policy = useMemo(() => messagePolicyForLead({
    source_code: form?.sourceCode || lead?.source_code,
    source_name: selectedSourceConfig?.name || lead?.source_name,
    platform_code: lead?.platform_code,
    channel_code: conversationChannel || lead?.channel_code,
  }, selectedSourceConfig), [form?.sourceCode, lead?.source_code, lead?.source_name, lead?.platform_code, lead?.channel_code, conversationChannel, selectedSourceConfig]);

  const availableTemplates = useMemo(() => (meta?.templates || []).filter((template) => {
    if (!template.departments?.length) return true;
    const departmentCode = departmentCodeFor(department);
    return template.departments.includes(departmentCode) || template.departments.includes(department);
  }), [meta, department]);

  if (!lead || !form) return null;

  function set<K extends keyof CustomerForm>(key: K, next: CustomerForm[K]) {
    setForm((current) => current ? ({ ...current, [key]: next }) : current);
  }

  function changeDepartment(next: CustomerForm["serviceKey"]) {
    setForm((current) => current ? ({
      ...current,
      serviceKey: next,
      departmentCode: departmentCodeFor(next),
      branchCode: branchCodeFor(next),
      paymentType: paymentTypeFor(next),
      statusLabel: "عميل جديد",
      followUpAt: "",
      financeType: next === "finance" ? (current.financeType || "general") : current.financeType,
    }) : current);
  }

  async function saveLead() {
    const current = form;
    if (!current) return;
    setSaving(true);
    setNotice("");
    try {
      const payload = {
        id: current.id,
        customerName: current.customerName,
        phone: current.phone,
        sourceCode: current.sourceCode,
        serviceKey: current.serviceKey,
        departmentCode: current.departmentCode,
        branchCode: current.branchCode,
        statusLabel: current.statusLabel,
        paymentType: current.paymentType,
        followUpAt: current.followUpAt || null,
        age: current.age,
        salary: current.salary,
        obligation: current.obligation,
        salaryBank: current.salaryBank,
        location: current.location,
        carType: current.carType,
        carName: current.carType,
        carModel: current.carModel,
        color: current.color,
        financeType: current.financeType,
        notes: current.notes,
      };
      const result = await crmFetch<{ ok: boolean; row: CrmLead }>("/api/crm/leads", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      onSaved(result.row);
      setNotice("تم حفظ بيانات العميل");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر حفظ بيانات العميل");
    } finally {
      setSaving(false);
    }
  }

  async function sendMessage() {
    if (!conversationId) {
      setNotice("تعذر تجهيز قناة الإرسال لهذا العميل");
      return;
    }
    if (policy.templateOnly && !selectedTemplate) {
      setNotice("مصدر العميل يسمح بالإرسال عن طريق قالب واتساب فقط");
      return;
    }
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

  return (
    <div className="crm-drawer-backdrop crm-customer-workspace-backdrop" onMouseDown={onClose}>
      <aside className="crm-lead-drawer crm-customer-workspace" onMouseDown={(event) => event.stopPropagation()}>
        <header className="crm-drawer-head crm-customer-workspace-head">
          <div className="crm-customer-title">
            <span className="crm-customer-avatar"><UserCircle size={34} weight="duotone" /></span>
            <div>
              <span>محادثة العميل</span>
              <h2>{lead.customer_name || "عميل"}</h2>
              <p><Phone size={14} /> {lead.phone || lead.phone_normalized || "بدون رقم جوال"}</p>
            </div>
          </div>
          <div className="crm-customer-head-meta">
            <span><b>المسؤول:</b> {lead.assigned_name || "غير موزع"}</span>
            {department === "finance" ? <span><b>الكول سنتر:</b> {lead.call_center_name || "غير موزع"}</span> : null}
            <span><CalendarBlank size={14} /><b>دخول السيستم:</b> {formatDate(lead.registered_at || lead.created_at)}</span>
          </div>
          <button className="crm-icon-button" type="button" onClick={onClose}><X size={21} /></button>
        </header>

        <div className="crm-drawer-grid crm-customer-workspace-grid">
          <section className="crm-conversation-panel crm-customer-conversation">
            <header>
              <div>
                <span>المحادثة</span>
                <strong>{policy.routeLabel}</strong>
                <small>{policy.reason}</small>
              </div>
              <button className="crm-icon-button" type="button" onClick={() => void loadConversation(lead.id, conversationId)}><ArrowClockwise size={18} /></button>
            </header>

            <div className="crm-messages-list">
              {loadingMessages ? <div className="crm-empty-state">جاري تحميل رسائل المحادثة...</div> : null}
              {!loadingMessages && !messages.length ? (
                <div className="crm-empty-state crm-empty-conversation">
                  <ChatCircleDots size={38} weight="duotone" />
                  <strong>لا توجد رسائل مسجلة</strong>
                  <span>يمكن بدء الإرسال من الأسفل حسب قناة ومصدر العميل.</span>
                </div>
              ) : null}
              {messages.map((message) => (
                <div key={message.id} className={`crm-message ${message.direction === "out" ? "out" : "in"}`}>
                  {message.body ? <p>{message.body}</p> : null}
                  {message.attachment_url ? <a href={message.attachment_url} target="_blank" rel="noreferrer">{message.file_name || "فتح المرفق"}</a> : null}
                  <small>{formatDate(message.created_at)} {message.provider_status ? `• ${providerStatusLabel(message.provider_status)}` : ""}</small>
                </div>
              ))}
            </div>

            <div className={`crm-message-composer ${policy.templateOnly ? "template-only" : ""}`}>
              <div className="crm-message-route-note">
                {policy.route === "whatsapp" ? <WhatsappLogo size={19} weight="fill" /> : <ChatCircleDots size={19} />}
                <span>{policy.reason}</span>
              </div>
              <select value={selectedTemplate} onChange={(event) => setSelectedTemplate(event.target.value)}>
                <option value="">{policy.templateOnly ? "اختر قالب واتساب" : "رسالة بدون قالب"}</option>
                {availableTemplates.map((template) => <option key={template.id} value={template.id}>{template.display_name}</option>)}
              </select>
              {policy.allowFreeText ? (
                <textarea
                  value={messageText}
                  onChange={(event) => setMessageText(event.target.value)}
                  placeholder="اكتب رسالتك هنا... Enter للإرسال و Shift + Enter لسطر جديد"
                  rows={3}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                />
              ) : (
                <div className="crm-template-only-warning">النص الحر غير متاح لهذا المصدر. اختار قالب واتساب معتمد ثم اضغط إرسال.</div>
              )}
              <button
                type="button"
                disabled={sending || (policy.templateOnly ? !selectedTemplate : (!messageText.trim() && !selectedTemplate))}
                onClick={() => void sendMessage()}
              >
                <PaperPlaneTilt size={18} />{sending ? "جاري الإرسال..." : "إرسال"}
              </button>
            </div>
          </section>

          <section className="crm-drawer-details crm-customer-details-panel">
            <header className="crm-customer-details-title">
              <h3>بيانات العميل</h3>
              <span className="crm-customer-department-pill">{departmentLabel(form.departmentCode)}</span>
            </header>
            <div className="crm-form-grid">
              <label>
                <span>حالة العميل</span>
                <select value={form.statusLabel} onChange={(event) => set("statusLabel", event.target.value)}>
                  {statuses.map((status) => <option key={status.id} value={status.value}>{status.label}</option>)}
                </select>
              </label>
              {isPostponed(form.statusLabel) ? (
                <label>
                  <span>تاريخ المتابعة</span>
                  <input type="date" value={form.followUpAt} onChange={(event) => set("followUpAt", event.target.value)} />
                </label>
              ) : null}
              <label>
                <span>المصدر</span>
                <select value={form.sourceCode} onChange={(event) => set("sourceCode", event.target.value)}>
                  <option value="">غير محدد</option>
                  {(meta?.sources || []).map((source) => <option key={source.code} value={source.code}>{sourceLabel(source.code, source.name)}</option>)}
                </select>
              </label>
              <label>
                <span>القسم</span>
                <input value={departmentLabel(form.departmentCode)} readOnly />
              </label>
              <label>
                <span>تحويل لقسم آخر</span>
                <select value={form.serviceKey} onChange={(event) => changeDepartment(event.target.value as CustomerForm["serviceKey"])}>
                  <option value="cash">مبيعات الكاش</option>
                  <option value="finance">مبيعات التمويل</option>
                  <option value="service">خدمة العملاء</option>
                </select>
              </label>
              <label>
                <span>اسم العميل</span>
                <input value={form.customerName} onChange={(event) => set("customerName", event.target.value)} />
              </label>
              <label>
                <span>رقم الجوال</span>
                <input value={form.phone} onChange={(event) => set("phone", event.target.value)} />
              </label>
              <label>
                <span>العمر</span>
                <input value={form.age} onChange={(event) => set("age", event.target.value)} />
              </label>
              <label>
                <span>الراتب</span>
                <input type="number" value={form.salary} onChange={(event) => set("salary", event.target.value)} />
              </label>
              <label>
                <span>الالتزام إن وجد</span>
                <input type="number" value={form.obligation} onChange={(event) => set("obligation", event.target.value)} />
              </label>
              <label>
                <span>نزول الراتب على أي بنك</span>
                <input value={form.salaryBank} onChange={(event) => set("salaryBank", event.target.value)} />
              </label>
              <label>
                <span>المكان</span>
                <input value={form.location} onChange={(event) => set("location", event.target.value)} />
              </label>
              <label>
                <span>نوع السيارة</span>
                <input value={form.carType} onChange={(event) => set("carType", event.target.value)} />
              </label>
              <label>
                <span>الموديل</span>
                <input value={form.carModel} onChange={(event) => set("carModel", event.target.value)} />
              </label>
              <label>
                <span>اللون</span>
                <input value={form.color} onChange={(event) => set("color", event.target.value)} />
              </label>
              {department === "finance" ? (
                <label>
                  <span>نوع التمويل</span>
                  <select value={form.financeType} onChange={(event) => set("financeType", event.target.value)}>
                    {financeTypes.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                  </select>
                </label>
              ) : null}
              <label className="crm-field-wide">
                <span>ملاحظات</span>
                <textarea rows={4} value={form.notes} onChange={(event) => set("notes", event.target.value)} />
              </label>
            </div>
            {department === "finance" ? (
              credit?.amount == null ? (
                <div className="crm-credit-result neutral">الحد الائتماني = أدخل الراتب واختر نوع التمويل</div>
              ) : (
                <div className={`crm-credit-result ${credit.qualified ? "good" : "bad"}`}>
                  الحد الائتماني = {Math.round(credit.amount).toLocaleString("ar-SA")} ريال - {credit.qualified ? "مؤهل" : "غير مؤهل"}
                </div>
              )
            ) : null}
            {notice ? <div className="crm-inline-notice">{notice}</div> : null}
            <button className="crm-primary-button crm-save-customer-button" type="button" disabled={saving} onClick={() => void saveLead()}>{saving ? "جاري الحفظ..." : "حفظ بيانات العميل"}</button>
          </section>
        </div>
      </aside>
    </div>
  );
}
