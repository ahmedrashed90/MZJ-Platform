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
import { crmFetch, departmentKeyFromCode, formatDate } from "../api";
import { messagePolicyForLead, providerStatusLabel, sourceLabel } from "../sourceCatalog";
import type { CrmLead, CrmMessage, CrmMeta } from "../types";

type Props = {
  lead: CrmLead | null;
  meta: CrmMeta | null;
  onClose: () => void;
  onSaved: (lead: CrmLead) => void;
};

const emptyMessages: CrmMessage[] = [];

function value(input: unknown) {
  return input == null ? "" : String(input);
}

export function LeadDrawer({ lead, meta, onClose, onSaved }: Props) {
  const [form, setForm] = useState<Record<string, string>>({});
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
    if (!lead) return;
    setForm({
      id: lead.id,
      customerName: value(lead.customer_name),
      phone: value(lead.phone || lead.phone_normalized),
      sourceCode: value(lead.source_code),
      serviceKey: departmentKeyFromCode(lead.department_code || lead.service_key),
      departmentCode: value(lead.department_code),
      branchCode: value(lead.branch_code),
      statusLabel: value(lead.status_label || "عميل جديد"),
      paymentType: value(lead.payment_type),
      carName: value(lead.car_name),
      location: value(lead.location),
      age: value(lead.age),
      salary: value(lead.salary),
      obligation: value(lead.obligation),
      salaryBank: value(lead.salary_bank),
      carModel: value(lead.car_model),
      carType: value(lead.car_type),
      color: value(lead.color),
      financeType: value(lead.finance_type),
      followUpAt: lead.follow_up_at ? new Date(lead.follow_up_at).toISOString().slice(0, 16) : "",
      campaignName: value(lead.campaign_name),
      campaignDate: value(lead.campaign_date).slice(0, 10),
      notes: value(lead.notes),
      statusNote: value(lead.status_note),
      assignedTo: value(lead.assigned_to),
      callCenterAssignedTo: value(lead.call_center_assigned_to),
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
        setConversationChannel(result.conversation?.channel_code || conversationChannel);
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

  const department = form.serviceKey || departmentKeyFromCode(form.departmentCode);
  const statuses = useMemo(
    () => (meta?.statuses || [])
      .filter((item) => item.department_code === department && item.is_active !== false)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
    [meta, department],
  );
  const salesUsers = useMemo(() => {
    const target = department === "finance" ? "finance_sales" : department === "service" ? "customer_service" : "cash_sales";
    return (meta?.users || []).filter((user) => user.department_codes.includes(target));
  }, [meta, department]);
  const callCenterUsers = useMemo(() => (meta?.users || []).filter((user) => user.department_codes.includes("call_center")), [meta]);

  const mappedTemplate = useMemo(() => {
    const departmentCode = department === "finance" ? "finance_sales" : department === "service" ? "customer_service" : "cash_sales";
    const mapping = (meta?.mappings || []).find((item) => item.department_code === departmentCode && item.status_value === form.statusLabel);
    return mapping ? (meta?.templates || []).find((template) => template.id === mapping.template_id) : undefined;
  }, [meta, department, form.statusLabel]);

  useEffect(() => {
    setSelectedTemplate(mappedTemplate?.id || "");
  }, [mappedTemplate?.id]);

  const credit = useMemo(() => {
    const salary = Number(form.salary || 0);
    const obligation = Number(form.obligation || 0);
    const ratio = form.financeType === "rate55" || form.financeType === "55%"
      ? 0.55
      : form.financeType === "realEstate" || form.financeType?.includes("65")
        ? 0.65
        : form.financeType
          ? 0.45
          : 0;
    if (!salary || !ratio) return null;
    const amount = salary * ratio - obligation;
    return { amount, qualified: amount >= 650 };
  }, [form.salary, form.obligation, form.financeType]);

  const policy = useMemo(() => messagePolicyForLead({
    source_code: form.sourceCode || lead?.source_code,
    source_name: lead?.source_name,
    platform_code: lead?.platform_code,
    channel_code: conversationChannel || lead?.channel_code,
  }), [form.sourceCode, lead?.source_code, lead?.source_name, lead?.platform_code, lead?.channel_code, conversationChannel]);

  const availableTemplates = useMemo(() => (meta?.templates || []).filter((template) => {
    if (!template.departments?.length) return true;
    const departmentCode = department === "finance" ? "finance_sales" : department === "service" ? "customer_service" : "cash_sales";
    return template.departments.includes(departmentCode) || template.departments.includes(department);
  }), [meta, department]);

  if (!lead) return null;

  function set(key: string, next: string) {
    setForm((current) => ({ ...current, [key]: next }));
  }

  async function saveLead() {
    setSaving(true);
    setNotice("");
    try {
      const result = await crmFetch<{ ok: boolean; row: CrmLead }>("/api/crm/leads", {
        method: "PATCH",
        body: JSON.stringify(form),
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
              <div><span>بيانات العميل</span><strong>{sourceLabel(form.sourceCode, lead.source_name)}</strong></div>
              <small>تعديل البيانات لا يغيّر قناة الإرسال يدويًا؛ السيرفر يحددها من المصدر.</small>
            </header>
            <div className="crm-form-grid">
              <label><span>حالة العميل</span><select value={form.statusLabel || ""} onChange={(event) => set("statusLabel", event.target.value)}>{statuses.map((status) => <option key={status.id} value={status.value}>{status.label}</option>)}</select></label>
              <label><span>تاريخ المتابعة</span><input type="datetime-local" value={form.followUpAt || ""} onChange={(event) => set("followUpAt", event.target.value)} /></label>
              <label><span>المصدر</span><select value={form.sourceCode || ""} onChange={(event) => set("sourceCode", event.target.value)}><option value="">غير محدد</option>{(meta?.sources || []).map((source) => <option key={source.code} value={source.code}>{sourceLabel(source.code, source.name)}</option>)}</select></label>
              <label><span>القسم</span><select value={department} onChange={(event) => { const key = event.target.value; set("serviceKey", key); set("departmentCode", key === "finance" ? "finance_sales" : key === "service" ? "customer_service" : "cash_sales"); set("branchCode", key === "finance" ? "online" : key === "service" ? "customer_service" : ""); }}><option value="cash">مبيعات الكاش</option><option value="finance">مبيعات التمويل</option><option value="service">خدمة العملاء</option></select></label>
              <label><span>الفرع</span><select value={form.branchCode || ""} onChange={(event) => set("branchCode", event.target.value)}><option value="">بدون فرع</option>{(meta?.branches || []).map((branch) => <option key={branch.code} value={branch.code}>{branch.name}</option>)}</select></label>
              <label><span>المسؤول</span><select value={form.assignedTo || ""} onChange={(event) => set("assignedTo", event.target.value)}><option value="">غير موزع</option>{salesUsers.map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}</select></label>
              {department === "finance" ? <label><span>الكول سنتر</span><select value={form.callCenterAssignedTo || ""} onChange={(event) => set("callCenterAssignedTo", event.target.value)}><option value="">غير موزع</option>{callCenterUsers.map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}</select></label> : null}
              <label><span>اسم العميل</span><input value={form.customerName || ""} onChange={(event) => set("customerName", event.target.value)} /></label>
              <label><span>رقم الجوال</span><input value={form.phone || ""} onChange={(event) => set("phone", event.target.value)} /></label>
              <label><span>العمر</span><input type="number" value={form.age || ""} onChange={(event) => set("age", event.target.value)} /></label>
              <label><span>الراتب</span><input type="number" value={form.salary || ""} onChange={(event) => set("salary", event.target.value)} /></label>
              <label><span>الالتزام إن وجد</span><input type="number" value={form.obligation || ""} onChange={(event) => set("obligation", event.target.value)} /></label>
              <label><span>نزول الراتب على أي بنك</span><input value={form.salaryBank || ""} onChange={(event) => set("salaryBank", event.target.value)} /></label>
              <label><span>المكان</span><input value={form.location || ""} onChange={(event) => set("location", event.target.value)} /></label>
              <label><span>نوع السيارة</span><input value={form.carType || ""} onChange={(event) => set("carType", event.target.value)} /></label>
              <label><span>اسم السيارة</span><input value={form.carName || ""} onChange={(event) => set("carName", event.target.value)} /></label>
              <label><span>الموديل</span><input value={form.carModel || ""} onChange={(event) => set("carModel", event.target.value)} /></label>
              <label><span>اللون</span><input value={form.color || ""} onChange={(event) => set("color", event.target.value)} /></label>
              {department === "finance" ? <label><span>نوع التمويل</span><select value={form.financeType || ""} onChange={(event) => set("financeType", event.target.value)}><option value="">اختر</option><option value="general">عام 45%</option><option value="rate55">55%</option><option value="realEstate">عقاري 65%</option></select></label> : null}
              <label><span>اسم الحملة</span><input value={form.campaignName || ""} onChange={(event) => set("campaignName", event.target.value)} /></label>
              <label><span>تاريخ الحملة</span><input type="date" value={form.campaignDate || ""} onChange={(event) => set("campaignDate", event.target.value)} /></label>
              <label className="crm-field-wide"><span>ملاحظة تغيير الحالة</span><input value={form.statusNote || ""} onChange={(event) => set("statusNote", event.target.value)} /></label>
              <label className="crm-field-wide"><span>ملاحظات</span><textarea rows={4} value={form.notes || ""} onChange={(event) => set("notes", event.target.value)} /></label>
            </div>
            {credit ? <div className={`crm-credit-result ${credit.qualified ? "good" : "bad"}`}>الحد الائتماني = {Math.round(credit.amount).toLocaleString("ar-SA")} ريال - {credit.qualified ? "مؤهل" : "غير مؤهل"}</div> : null}
            {notice ? <div className="crm-inline-notice">{notice}</div> : null}
            <button className="crm-primary-button crm-save-customer-button" type="button" disabled={saving} onClick={() => void saveLead()}>{saving ? "جاري الحفظ..." : "حفظ بيانات العميل"}</button>
          </section>
        </div>
      </aside>
    </div>
  );
}
