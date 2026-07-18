import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise,
  CalendarBlank,
  ChatCircleDots,
  PaperPlaneTilt,
  Paperclip,
  DownloadSimple,
  FilePdf,
  ImageSquare,
  FileAudio,
  FileVideo,
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
  { id: "car_category", field_key: "car_category", label: "الفئة", field_type: "text", sort_order: 135, department_keys: [], is_active: true, is_required: false, include_in_completion: true, options: [], is_system: true, is_locked: false },
  { id: "car_model", field_key: "car_model", label: "الموديل", field_type: "text", sort_order: 140, department_keys: [], is_active: true, is_required: false, include_in_completion: true, options: [], is_system: true, is_locked: false },
  { id: "color", field_key: "color", label: "اللون", field_type: "text", sort_order: 150, department_keys: [], is_active: true, is_required: false, include_in_completion: true, options: [], is_system: true, is_locked: false },
  { id: "finance_type", field_key: "finance_type", label: "نوع التمويل", field_type: "select", sort_order: 160, department_keys: ["finance"], is_active: true, is_required: false, include_in_completion: false, options: fallbackFinanceOptions, is_system: true, is_locked: true },
  { id: "notes", field_key: "notes", label: "ملاحظات", field_type: "textarea", sort_order: 170, department_keys: [], is_active: true, is_required: false, include_in_completion: false, options: [], is_system: true, is_locked: false },
];

function value(input: unknown) {
  return input == null ? "" : String(input);
}

function isOutboundMessage(message: CrmMessage) {
  const senderType = String(message.sender_type || "").trim().toLowerCase();
  const providerStatus = String(message.provider_status || "").trim().toLowerCase();
  if (senderType === "customer" || providerStatus === "received") return false;
  const direction = String(message.direction || "").trim().toLowerCase();
  if (["in", "inbound", "received", "receive"].includes(direction)) return false;
  if (["out", "outbound", "sent", "send"].includes(direction)) return true;
  return ["human", "agent", "bot", "system"].includes(senderType);
}

function visibleProviderStatus(message: CrmMessage) {
  return isOutboundMessage(message) ? providerStatusLabel(message.provider_status) : "";
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
    car_category: value(lead.car_category),
    car_model: value(lead.car_model),
    color: value(lead.color),
    finance_type: value(lead.finance_type) || (serviceKey === "finance" ? "general" : ""),
    notes: value(lead.notes),
  };
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

function normalizeChatMediaUrl(value: unknown) {
  let url = String(value || "").trim().replace(/\\\//g, "/").replace(/&amp;/gi, "&");
  if (!url || /lookaside\.fbsbx\.com\/whatsapp_business\/attachments/i.test(url)) return "";
  if (url.startsWith("//")) url = `https:${url}`;
  else if (url.startsWith("/")) url = `https://w-mersal.com${url}`;
  else if (/^(?:uploads?|storage|media|files?|documents?|public)\//i.test(url)) url = `https://w-mersal.com/${url.replace(/^\/+/, "")}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && /^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(url)) url = `https://${url}`;
  return /^https?:\/\//i.test(url) ? url : "";
}

function editedTextStillMatchesTemplate(renderedTemplate: string, editedText: string) {
  const source = String(renderedTemplate || "");
  const placeholders = [...source.matchAll(/{{\s*\d+\s*}}/g)];
  if (!placeholders.length) return source.trim() === String(editedText || "").trim();
  let pattern = "^";
  let cursor = 0;
  for (const placeholder of placeholders) {
    pattern += escapeRegex(source.slice(cursor, placeholder.index));
    pattern += "[\\s\\S]+?";
    cursor = Number(placeholder.index) + placeholder[0].length;
  }
  pattern += escapeRegex(source.slice(cursor)) + "$";
  return new RegExp(pattern, "i").test(String(editedText || "").trim());
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
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const messagesListRef = useRef<HTMLDivElement | null>(null);

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
    setPendingFile(null);
    setMediaUrls({});
    void loadConversation(lead.id, lead.conversation_id || "", false);
    const readLead = {
      ...lead,
      unread_count: 0,
      dashboard_unread: false,
      has_unread_message: false,
      has_unread_messages: false,
      message_unread: false,
      is_unread: false,
      dashboard_message_read_at: new Date().toISOString(),
    };
    onSaved(readLead);
  }, [lead?.id]);

  useEffect(() => {
    if (!lead) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lead?.id, onClose]);

  async function loadConversation(leadId: string, preferredId = "", silent = false) {
    if (!silent) setLoadingMessages(true);
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
      } else if (!silent) {
        setMessages([]);
      }
    } catch (error) {
      if (!silent) setNotice(error instanceof Error ? error.message : "تعذر تحميل المحادثة");
    } finally {
      if (!silent) setLoadingMessages(false);
    }
  }

  useEffect(() => {
    if (!lead || !conversationId) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadConversation(activeForm.id, conversationId, true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [lead?.id, conversationId]);

  useEffect(() => {
    const list = messagesListRef.current;
    if (!list) return;
    const frame = window.requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages.length, messages.at(-1)?.id]);


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

  function renderTemplateInComposer(template: { content?: string | null } | undefined) {
    if (!template?.content || !form) return "";
    const values: Record<string, string> = {
      customer_name: form.values.customer_name || lead?.customer_name || "",
      customerName: form.values.customer_name || lead?.customer_name || "",
      name: form.values.customer_name || lead?.customer_name || "",
      phone: form.values.phone || lead?.phone || lead?.phone_normalized || "",
      car: form.values.car_type || lead?.car_name || "",
      car_name: form.values.car_type || lead?.car_name || "",
      carType: form.values.car_type || lead?.car_type || lead?.car_name || "",
      category: form.values.car_category || lead?.car_category || "",
      model: form.values.car_model || lead?.car_model || "",
      color: form.values.color || lead?.color || "",
      status: form.values.status_label || lead?.status_label || "",
      agent_name: lead?.assigned_name || "",
      agentName: lead?.assigned_name || "",
    };
    return String(template.content).replace(/{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g, (match, key) => values[key] || match);
  }

  useEffect(() => {
    if (mappedTemplate?.id) {
      setSelectedTemplate(mappedTemplate.id);
      setMessageText(renderTemplateInComposer(mappedTemplate));
      return;
    }
    setSelectedTemplate("");
    setMessageText("");
  }, [mappedTemplate?.id]);

  useEffect(() => {
    const missing = messages.filter((message) => message.media_asset_id && !mediaUrls[message.media_asset_id]);
    if (!missing.length) return;
    let cancelled = false;
    Promise.all(missing.map(async (message) => {
      try {
        const result = await crmFetch<{ ok: boolean; url: string }>(`/api/crm/media?assetId=${encodeURIComponent(message.media_asset_id || "")}`);
        return [message.media_asset_id || "", result.url] as const;
      } catch { return [message.media_asset_id || "", ""] as const; }
    })).then((entries) => {
      if (cancelled) return;
      setMediaUrls((current) => ({ ...current, ...Object.fromEntries(entries.filter((entry) => entry[0] && entry[1])) }));
    });
    return () => { cancelled = true; };
  }, [messages, mediaUrls]);

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
        carCategory: activeForm.values.car_category,
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

  function mediaTypeForFile(file: File) {
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("audio/")) return "audio";
    if (file.type.startsWith("video/")) return "video";
    return "document";
  }

  async function uploadPendingFile(file: File) {
    const prepared = await crmFetch<{ ok: boolean; assetId: string; uploadUrl: string }>("/api/crm/media", {
      method: "POST",
      body: JSON.stringify({ action: "prepare_upload", conversationId, mediaType: mediaTypeForFile(file), fileName: file.name, mimeType: file.type || "application/octet-stream", fileSize: file.size, isSensitive: true }),
    });
    const upload = await fetch(prepared.uploadUrl, { method: "PUT", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
    if (!upload.ok) throw new Error("فشل رفع الملف إلى التخزين الآمن");
    await crmFetch("/api/crm/media", { method: "POST", body: JSON.stringify({ action: "mark_ready", assetId: prepared.assetId }) });
    return prepared.assetId;
  }

  async function openMedia(message: CrmMessage) {
    if (!message.media_asset_id) {
      const directUrl = normalizeChatMediaUrl(message.attachment_url);
      if (directUrl) window.open(directUrl, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      const result = await crmFetch<{ ok: boolean; url: string }>(`/api/crm/media?assetId=${encodeURIComponent(message.media_asset_id)}`);
      setMediaUrls((current) => ({ ...current, [message.media_asset_id || ""]: result.url }));
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (error) { setNotice(error instanceof Error ? error.message : "تعذر فتح الملف"); }
  }

  function renderMessageMedia(message: CrmMessage) {
    const url = normalizeChatMediaUrl((message.media_asset_id && mediaUrls[message.media_asset_id]) || message.attachment_url || "");
    const type = String(message.attachment_type || message.message_type || "").toLowerCase();
    if (type === "image" && url) return <a href={url} target="_blank" rel="noopener noreferrer"><img className="crm-chat-media-image" src={url} alt={message.file_name || "صورة العميل"} loading="lazy" /></a>;
    if (type === "audio" && url) return <audio className="crm-chat-media-player" controls preload="metadata" src={url} />;
    if (type === "video" && url) return <video className="crm-chat-media-video" controls preload="metadata" src={url} />;
    if (message.media_asset_id || url || message.storage_key) {
      const Icon = type === "image" ? ImageSquare : type === "audio" ? FileAudio : type === "video" ? FileVideo : FilePdf;
      return <button type="button" className="crm-chat-file-card" onClick={() => void openMedia(message)}><Icon size={24} /><span><strong>{message.file_name || "مرفق"}</strong><small>{message.mime_type || type || "ملف"}{message.file_size ? ` • ${Math.max(1, Math.round(message.file_size / 1024)).toLocaleString("ar-SA")} KB` : ""}</small></span><DownloadSimple size={18} /></button>;
    }
    return null;
  }

  async function sendMessage() {
    if (!conversationId) return setNotice("تعذر تجهيز قناة الإرسال لهذا العميل");
    if (!messageText.trim() && !selectedTemplate && !pendingFile) return;

    const draftText = messageText;
    const draftTemplate = selectedTemplate;
    const draftFile = pendingFile;
    const tempId = `temp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tempMessage: CrmMessage = {
      id: tempId,
      direction: "out",
      message_type: draftFile ? mediaTypeForFile(draftFile) : draftTemplate ? "template" : "text",
      body: draftText || null,
      attachment_type: draftFile ? mediaTypeForFile(draftFile) : null,
      file_name: draftFile?.name || null,
      mime_type: draftFile?.type || null,
      file_size: draftFile?.size || null,
      provider_status: "queued",
      sender_type: "human",
      created_at: new Date().toISOString(),
    };

    setMessageText("");
    setSelectedTemplate("");
    setPendingFile(null);
    setMessages((current) => [...current, tempMessage]);
    setSending(true);
    setNotice("");

    try {
      const mediaAssetId = draftFile ? await uploadPendingFile(draftFile) : "";
      const result = await crmFetch<{ ok: boolean; message: CrmMessage; providerStatus: string }>("/api/crm/conversations", {
        method: "POST",
        body: JSON.stringify({ conversationId, text: draftText, templateId: draftTemplate, mediaAssetId }),
      });
      setMessages((current) => current.map((message) => message.id === tempId
        ? { ...result.message, media_asset_id: mediaAssetId || result.message.media_asset_id }
        : message));
      setNotice(result.providerStatus === "queued" ? "تم تسليم الرسالة للإرسال" : "تم إرسال الرسالة");
      window.setTimeout(() => void loadConversation(activeForm.id, conversationId, true), 1200);
      window.setTimeout(() => void loadConversation(activeForm.id, conversationId, true), 3500);
    } catch (error) {
      setMessages((current) => current.filter((message) => message.id !== tempId));
      setMessageText((current) => current.trim() ? current : draftText);
      setSelectedTemplate((current) => current || draftTemplate);
      setPendingFile((current) => current || draftFile);
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
            <header><div><span>المحادثة</span><strong>{policy.routeLabel}</strong><small>{policy.reason}</small></div><button className="crm-icon-button" type="button" onClick={() => void loadConversation(lead.id, conversationId, false)}><ArrowClockwise size={18} /></button></header>
            <div className="crm-messages-list" ref={messagesListRef}>
              {loadingMessages ? <div className="crm-empty-state">جاري تحميل رسائل المحادثة...</div> : null}
              {!loadingMessages && !messages.length ? <div className="crm-empty-state crm-empty-conversation"><ChatCircleDots size={38} weight="duotone" /><strong>لا توجد رسائل مسجلة</strong><span>يمكن بدء الإرسال من الأسفل حسب قناة ومصدر العميل.</span></div> : null}
              {messages.map((message) => <div key={message.id} className={`crm-message ${isOutboundMessage(message) ? "out" : "in"}`}>{renderMessageMedia(message)}{message.body ? <p>{message.body}</p> : null}<small>{message.sender_type === "bot" ? "وكيل صندوق الوارد • " : ""}{formatDate(message.created_at)} {visibleProviderStatus(message) ? `• ${visibleProviderStatus(message)}` : ""}</small></div>)}
            </div>
            <div className="crm-message-composer">
              <div className="crm-message-route-note">{policy.route === "whatsapp" ? <WhatsappLogo size={19} weight="fill" /> : <ChatCircleDots size={19} />}<span>{policy.reason}</span></div>
              <textarea value={messageText} onChange={(event) => {
                const nextText = event.target.value;
                setMessageText(nextText);
                if (selectedTemplate) {
                  const template = (meta?.templates || []).find((item) => item.id === selectedTemplate);
                  const rendered = renderTemplateInComposer(template);
                  if (!editedTextStillMatchesTemplate(rendered, nextText)) setSelectedTemplate("");
                }
              }} placeholder={selectedTemplate ? "راجع القالب واستكمل المتغيرات الظاهرة، أو اكتب نصًا مختلفًا ليُرسل كنص حر" : "اكتب رسالتك هنا... Enter للإرسال و Shift + Enter لسطر جديد"} rows={9} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} />
              <label className="crm-attachment-button" title="إرفاق صورة أو صوت أو فيديو أو PDF"><Paperclip size={19} /><span>{pendingFile ? pendingFile.name : "مرفق"}</span><input type="file" accept="image/*,audio/*,video/*,.pdf,application/pdf" onChange={(event) => setPendingFile(event.target.files?.[0] || null)} /></label>
              <button type="button" disabled={sending || (!messageText.trim() && !selectedTemplate && !pendingFile)} onClick={() => void sendMessage()}><PaperPlaneTilt size={18} />{sending ? "جاري الإرسال..." : "إرسال"}</button>
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
