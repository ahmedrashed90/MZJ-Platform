import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowRight,
  CalendarBlank,
  CaretDown,
  CaretUp,
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
import { useEscapeToClose } from "../../components/useEscapeToClose";
import { crmFetch, departmentKeyFromCode, departmentLabel, formatDate } from "../api";
import { messagePolicyForLead, providerStatusLabel, sourceLabel } from "../sourceCatalog";
import type { CrmCustomerField, CrmLead, CrmMessage, CrmMeta } from "../types";

type Props = {
  lead: CrmLead | null;
  meta: CrmMeta | null;
  onClose: () => void;
  onSaved: (lead: CrmLead) => void;
  onRead?: (lead: CrmLead) => void;
  mode?: "workspace" | "edit";
};

type ServiceKey = "cash" | "finance" | "service";

type CustomerForm = {
  id: string;
  serviceKey: ServiceKey;
  departmentCode: string;
  branchCode: string;
  paymentType: string;
  assignedTo: string;
  callCenterAssignedTo: string;
  values: Record<string, string>;
  customFields: Record<string, string>;
};

const emptyMessages: CrmMessage[] = [];
const fallbackFinanceOptions = [
  { value: "general", label: "عام 45%" },
  { value: "rate55", label: "55%" },
  { value: "realEstate", label: "عقاري 65%" },
];

const databaseDepartmentOptions = [
  { value: "cash_sales", label: "مبيعات الكاش", serviceKey: "cash" as ServiceKey },
  { value: "finance_sales", label: "مبيعات التمويل", serviceKey: "finance" as ServiceKey },
  { value: "customer_service", label: "خدمة العملاء", serviceKey: "service" as ServiceKey },
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

function comparableValue(input: unknown) {
  return input == null ? "" : String(input).trim();
}

function comparableDate(input: unknown) {
  const raw = comparableValue(input);
  if (!raw) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function riyadhDateInput(input: unknown = new Date()) {
  const raw = input instanceof Date ? input.toISOString() : comparableValue(input);
  if (!raw) return "";
  const parsed = input instanceof Date ? input : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw.slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addChangedField(payload: Record<string, unknown>, key: string, next: unknown, previous: unknown) {
  if (comparableValue(next) !== comparableValue(previous)) payload[key] = next;
}

function addChangedDateField(payload: Record<string, unknown>, key: string, next: unknown, previous: unknown) {
  if (comparableDate(next) !== comparableDate(previous)) payload[key] = next || null;
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
    sold_quantity: value(lead.sold_quantity || 1),
    sold_at: lead.sold_at ? riyadhDateInput(lead.sold_at) : "",
    notes: value(lead.notes),
  };
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
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

export function LeadDrawer({ lead, meta, onClose, onSaved, onRead, mode = "workspace" }: Props) {
  const showConversation = mode !== "edit";
  const [form, setForm] = useState<CustomerForm | null>(null);
  const [messages, setMessages] = useState<CrmMessage[]>(emptyMessages);
  const [conversationId, setConversationId] = useState("");
  const [conversationChannel, setConversationChannel] = useState("");
  const [messageText, setMessageText] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"conversation" | "details">(showConversation ? "conversation" : "details");
  const [savingStatus, setSavingStatus] = useState(false);
  const [statusNotice, setStatusNotice] = useState("");
  const [compactComposerViewport, setCompactComposerViewport] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches);
  const [composerExpanded, setComposerExpanded] = useState(() => typeof window === "undefined" || !window.matchMedia("(max-width: 760px)").matches);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const messagesListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 760px)");
    const syncViewport = () => {
      setCompactComposerViewport(media.matches);
      if (!media.matches) setComposerExpanded(true);
    };
    syncViewport();
    media.addEventListener("change", syncViewport);
    return () => media.removeEventListener("change", syncViewport);
  }, []);

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
      assignedTo: value(lead.assigned_to),
      callCenterAssignedTo: value(lead.call_center_assigned_to),
      values: leadCoreValues(lead, serviceKey),
      customFields: Object.fromEntries(Object.entries(extra).map(([key, raw]) => [key, value(raw)])),
    });
    setMessages([]);
    setConversationId(lead.conversation_id || "");
    setConversationChannel(lead.channel_code || "");
    setMessageText("");
    setSelectedTemplate("");
    setNoteDraft("");
    setNotice("");
    setPendingFile(null);
    setMobilePanel(showConversation ? "conversation" : "details");
    setSavingStatus(false);
    setStatusNotice("");
    setComposerExpanded(typeof window === "undefined" || !window.matchMedia("(max-width: 760px)").matches);
    setMediaUrls({});
    if (showConversation) {
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
      onRead?.(readLead);
      void crmFetch("/api/crm/unread", {
        method: "POST",
        body: JSON.stringify({ action: "mark_read", leadId: lead.id, conversationId: lead.conversation_id }),
      }).catch((failure) => console.warn("تعذر حفظ قراءة محادثة العميل", failure));
    }
  }, [lead?.id, showConversation]);

  useEscapeToClose(Boolean(lead), onClose);

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
    if (!showConversation || !lead || !conversationId) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadConversation(activeForm.id, conversationId, true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [lead?.id, conversationId, showConversation]);

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

  const editableBranches = useMemo(() => {
    const branches = meta?.branches || [];
    const departmentCode = form?.departmentCode || departmentCodeFor(department);
    const userBranchCodes = new Set((meta?.users || [])
      .filter((user) => user.department_codes.includes(departmentCode))
      .flatMap((user) => user.branch_codes || []));
    const currentBranch = form?.branchCode || "";
    const matching = branches.filter((branch) => {
      if (userBranchCodes.size) return userBranchCodes.has(branch.code) || branch.code === currentBranch;
      if (department === "finance") return branch.code === "online" || branch.code === currentBranch;
      if (department === "service") return branch.code === "customer_service" || branch.code === currentBranch;
      return !["online", "customer_service"].includes(branch.code) || branch.code === currentBranch;
    });
    return matching.length ? matching : branches;
  }, [meta?.branches, meta?.users, form?.departmentCode, form?.branchCode, department]);

  const editableAgents = useMemo(() => {
    const departmentCode = form?.departmentCode || departmentCodeFor(department);
    const matching = (meta?.users || []).filter((user) => user.department_codes.includes(departmentCode));
    const current = (meta?.users || []).find((user) => user.id === form?.assignedTo);
    return current && !matching.some((user) => user.id === current.id) ? [current, ...matching] : matching;
  }, [meta?.users, form?.departmentCode, form?.assignedTo, department]);

  const editableCallCenterUsers = useMemo(() => {
    const matching = (meta?.users || []).filter((user) => user.department_codes.includes("call_center"));
    const current = (meta?.users || []).find((user) => user.id === form?.callCenterAssignedTo);
    return current && !matching.some((user) => user.id === current.id) ? [current, ...matching] : matching;
  }, [meta?.users, form?.callCenterAssignedTo]);

  const configuredFields = useMemo(() => {
    const source = meta?.customerFields?.length ? meta.customerFields : fallbackFields;
    return source.filter((field) => field.is_active !== false && (!field.department_keys?.length || field.department_keys.includes(department)))
      .filter((field) => showConversation || !["status_label", "department_code", "department_transfer"].includes(field.field_key))
      .filter((field) => field.field_key !== "follow_up_at" || isPostponed(form?.values.status_label))
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  }, [meta?.customerFields, department, form?.values.status_label, showConversation]);

  function renderTemplateInComposer(template: { content?: string | null } | undefined, sourceForm: CustomerForm | null = form) {
    if (!template?.content || !sourceForm) return "";
    const values: Record<string, string> = {
      customer_name: sourceForm.values.customer_name || lead?.customer_name || "",
      customerName: sourceForm.values.customer_name || lead?.customer_name || "",
      name: sourceForm.values.customer_name || lead?.customer_name || "",
      phone: sourceForm.values.phone || lead?.phone || lead?.phone_normalized || "",
      car: sourceForm.values.car_type || lead?.car_name || "",
      car_name: sourceForm.values.car_type || lead?.car_name || "",
      carType: sourceForm.values.car_type || lead?.car_type || lead?.car_name || "",
      category: sourceForm.values.car_category || lead?.car_category || "",
      model: sourceForm.values.car_model || lead?.car_model || "",
      color: sourceForm.values.color || lead?.color || "",
      status: sourceForm.values.status_label || lead?.status_label || "",
      agent_name: lead?.assigned_name || "",
      agentName: lead?.assigned_name || "",
    };
    return String(template.content).replace(/{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g, (match, key) => values[key] || match);
  }

  function applyStatusTemplate(sourceForm: CustomerForm) {
    const mapping = (meta?.mappings || []).find((item) =>
      item.department_code === departmentCodeFor(sourceForm.serviceKey)
      && item.status_value === sourceForm.values.status_label,
    );
    const template = mapping ? (meta?.templates || []).find((item) => item.id === mapping.template_id) : undefined;
    if (template?.id) {
      setSelectedTemplate(template.id);
      setMessageText(renderTemplateInComposer(template, sourceForm));
      return;
    }
    if (selectedTemplate) setMessageText("");
    setSelectedTemplate("");
  }

  useEffect(() => {
    if (!showConversation) return;
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
  }, [messages, mediaUrls, showConversation]);

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
    if (field.field_key === "status_label") {
      const nextForm = {
        ...activeForm,
        values: {
          ...activeForm.values,
          status_label: next,
          sold_quantity: next === "تم البيع" ? (activeForm.values.sold_quantity || "1") : activeForm.values.sold_quantity,
          sold_at: next === "تم البيع" ? (activeForm.values.sold_at || riyadhDateInput()) : activeForm.values.sold_at,
        },
      };
      setForm(nextForm);
      applyStatusTemplate(nextForm);
      return;
    }
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

  function changeDatabaseDepartment(nextDepartmentCode: string) {
    setForm((current) => {
      if (!current) return current;
      const option = databaseDepartmentOptions.find((item) => item.value === nextDepartmentCode) || databaseDepartmentOptions[0];
      const nextServiceKey = option.serviceKey;
      const nextStatuses = (meta?.statuses || [])
        .filter((item) => item.department_code === nextServiceKey && item.is_active !== false)
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
      const statusStillValid = nextStatuses.some((item) => item.value === current.values.status_label);
      const departmentUsers = (meta?.users || []).filter((user) => user.department_codes.includes(nextDepartmentCode));
      const allowedBranchCodes = new Set(departmentUsers.flatMap((user) => user.branch_codes || []));
      const candidateBranches = (meta?.branches || []).filter((branch) => {
        if (allowedBranchCodes.size) return allowedBranchCodes.has(branch.code);
        if (nextServiceKey === "finance") return branch.code === "online";
        if (nextServiceKey === "service") return branch.code === "customer_service";
        return !["online", "customer_service"].includes(branch.code);
      });
      const currentBranchIsValid = candidateBranches.some((branch) => branch.code === current.branchCode);
      const nextBranchCode = currentBranchIsValid
        ? current.branchCode
        : branchCodeFor(nextServiceKey) || candidateBranches[0]?.code || "";
      const currentAgentIsValid = departmentUsers.some((user) => user.id === current.assignedTo);
      return {
        ...current,
        serviceKey: nextServiceKey,
        departmentCode: nextDepartmentCode,
        branchCode: nextBranchCode,
        paymentType: paymentTypeFor(nextServiceKey),
        assignedTo: currentAgentIsValid ? current.assignedTo : "",
        values: {
          ...current.values,
          department_code: nextDepartmentCode,
          status_label: statusStillValid ? current.values.status_label : (nextStatuses.find((item) => item.value === "عميل جديد")?.value || nextStatuses[0]?.value || "عميل جديد"),
          follow_up_at: statusStillValid && isPostponed(current.values.status_label) ? current.values.follow_up_at : "",
          finance_type: nextServiceKey === "finance" ? (current.values.finance_type || "general") : current.values.finance_type,
        },
      };
    });
  }

  async function saveLead() {
    const currentLead = lead;
    if (!currentLead) return;
    setSaving(true);
    setNotice("");
    try {
      const originalServiceKey = departmentKeyFromCode(currentLead.department_code || currentLead.service_key) as ServiceKey;
      const originalValues = leadCoreValues(currentLead, originalServiceKey);
      const originalDepartmentCode = value(currentLead.department_code) || departmentCodeFor(originalServiceKey);
      const originalBranchCode = value(currentLead.branch_code) || branchCodeFor(originalServiceKey);
      const originalPaymentType = value(currentLead.payment_type) || paymentTypeFor(originalServiceKey);
      const payload: Record<string, unknown> = { id: activeForm.id };
      if (!showConversation) payload.databaseEdit = true;

      addChangedField(payload, "customerName", activeForm.values.customer_name, originalValues.customer_name);
      addChangedField(payload, "phone", activeForm.values.phone, originalValues.phone);
      addChangedField(payload, "sourceCode", activeForm.values.source_code, originalValues.source_code);
      addChangedField(payload, "serviceKey", activeForm.serviceKey, originalServiceKey);
      addChangedField(payload, "departmentCode", activeForm.departmentCode, originalDepartmentCode);
      addChangedField(payload, "branchCode", activeForm.branchCode, originalBranchCode);
      addChangedField(payload, "statusLabel", activeForm.values.status_label, originalValues.status_label);
      addChangedField(payload, "paymentType", activeForm.paymentType, originalPaymentType);
      addChangedDateField(payload, "followUpAt", activeForm.values.follow_up_at, originalValues.follow_up_at);
      addChangedField(payload, "age", activeForm.values.age, originalValues.age);
      addChangedField(payload, "salary", activeForm.values.salary, originalValues.salary);
      addChangedField(payload, "obligation", activeForm.values.obligation, originalValues.obligation);
      addChangedField(payload, "salaryBank", activeForm.values.salary_bank, originalValues.salary_bank);
      addChangedField(payload, "location", activeForm.values.location, originalValues.location);
      addChangedField(payload, "carType", activeForm.values.car_type, originalValues.car_type);
      addChangedField(payload, "carCategory", activeForm.values.car_category, originalValues.car_category);
      addChangedField(payload, "carModel", activeForm.values.car_model, originalValues.car_model);
      addChangedField(payload, "color", activeForm.values.color, originalValues.color);
      addChangedField(payload, "financeType", activeForm.values.finance_type, originalValues.finance_type);

      if (!showConversation) {
        addChangedField(payload, "assignedTo", activeForm.assignedTo || null, value(currentLead.assigned_to) || null);
        addChangedField(payload, "callCenterAssignedTo", activeForm.callCenterAssignedTo || null, value(currentLead.call_center_assigned_to) || null);
        if (activeForm.values.status_label === "تم البيع") {
          addChangedDateField(payload, "soldAt", activeForm.values.sold_at, originalValues.sold_at);
        }
      }

      if (activeForm.values.status_label === "تم البيع") {
        addChangedField(payload, "soldQuantity", Math.max(1, Math.floor(Number(activeForm.values.sold_quantity || 1))), originalValues.sold_quantity || "1");
      }

      const originalCustomFields = currentLead.extra_data && typeof currentLead.extra_data === "object" ? currentLead.extra_data : {};
      const customFields = Object.fromEntries(
        Object.entries(activeForm.customFields).filter(([key, next]) => comparableValue(next) !== comparableValue(originalCustomFields[key])),
      );
      if (Object.keys(customFields).length) payload.customFields = customFields;
      if (noteDraft.trim()) payload.newNote = noteDraft.trim();

      const changedKeys = Object.keys(payload).filter((key) => !["id", "databaseEdit"].includes(key));
      if (!changedKeys.length) {
        setNotice("لا توجد تغييرات لحفظها");
        return;
      }

      const result = await crmFetch<{ ok: boolean; row: CrmLead }>("/api/crm/leads", { method: "PATCH", body: JSON.stringify(payload) });
      setForm((current) => current ? { ...current, values: { ...current.values, notes: value(result.row.notes) } } : current);
      setNoteDraft("");
      onSaved(result.row);
      setNotice("تم حفظ بيانات العميل");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر حفظ بيانات العميل");
    } finally {
      setSaving(false);
    }
  }

  async function changeConversationStatus(nextStatus: string) {
    if (!nextStatus || nextStatus === activeForm.values.status_label || savingStatus) return;
    const previousStatus = activeForm.values.status_label;
    const previousFollowUpAt = activeForm.values.follow_up_at;
    const previousSoldAt = activeForm.values.sold_at;
    const nextForm: CustomerForm = {
      ...activeForm,
      values: {
        ...activeForm.values,
        status_label: nextStatus,
        follow_up_at: isPostponed(nextStatus) ? activeForm.values.follow_up_at : "",
        sold_quantity: nextStatus === "تم البيع" ? (activeForm.values.sold_quantity || "1") : activeForm.values.sold_quantity,
        sold_at: nextStatus === "تم البيع" ? (activeForm.values.sold_at || riyadhDateInput()) : activeForm.values.sold_at,
      },
    };

    setForm(nextForm);
    applyStatusTemplate(nextForm);
    setSavingStatus(true);
    setStatusNotice("");
    try {
      const payload: Record<string, unknown> = { id: nextForm.id, statusLabel: nextStatus };
      if (!isPostponed(nextStatus) && previousFollowUpAt) payload.followUpAt = null;
      if (nextStatus === "تم البيع") {
        payload.soldQuantity = Math.max(1, Math.floor(Number(nextForm.values.sold_quantity || 1)));
      }
      const result = await crmFetch<{ ok: boolean; row: CrmLead }>("/api/crm/leads", { method: "PATCH", body: JSON.stringify(payload) });
      setForm((current) => current ? {
        ...current,
        values: {
          ...current.values,
          status_label: value(result.row.status_label || nextStatus),
          follow_up_at: result.row.follow_up_at ? comparableDate(result.row.follow_up_at) : current.values.follow_up_at,
          sold_quantity: value(result.row.sold_quantity || current.values.sold_quantity || "1"),
          sold_at: result.row.sold_at ? riyadhDateInput(result.row.sold_at) : current.values.sold_at,
        },
      } : current);
      onSaved(result.row);
      setStatusNotice("تم تحديث حالة العميل");
    } catch (error) {
      setForm((current) => current ? {
        ...current,
        values: {
          ...current.values,
          status_label: previousStatus,
          follow_up_at: previousFollowUpAt,
          sold_at: previousSoldAt,
        },
      } : current);
      setStatusNotice(error instanceof Error ? error.message : "تعذر تحديث حالة العميل");
    } finally {
      setSavingStatus(false);
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

  async function resolveMessageMediaUrl(message: CrmMessage, refresh = false) {
    const cached = message.media_asset_id ? mediaUrls[message.media_asset_id] : "";
    if (cached && !refresh) return cached;
    if (!message.media_asset_id) return message.attachment_url || "";
    const result = await crmFetch<{ ok: boolean; url: string }>(`/api/crm/media?assetId=${encodeURIComponent(message.media_asset_id)}`);
    setMediaUrls((current) => ({ ...current, [message.media_asset_id || ""]: result.url }));
    return result.url;
  }

  async function openMedia(message: CrmMessage) {
    let mediaWindow: Window | null = null;
    try { mediaWindow = window.open("about:blank", "_blank"); } catch { mediaWindow = null; }
    try {
      const url = await resolveMessageMediaUrl(message, true);
      if (!url) throw new Error("رابط الملف غير متاح");
      if (mediaWindow && !mediaWindow.closed) mediaWindow.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      if (mediaWindow && !mediaWindow.closed) mediaWindow.close();
      setNotice(error instanceof Error ? error.message : "تعذر فتح الملف");
    }
  }

  async function downloadMedia(message: CrmMessage) {
    let fallbackWindow: Window | null = null;
    try { fallbackWindow = window.open("about:blank", "_blank"); } catch { fallbackWindow = null; }
    try {
      const url = await resolveMessageMediaUrl(message, true);
      if (!url) throw new Error("رابط الملف غير متاح");
      const response = await fetch(url, { method: "GET", cache: "no-store" });
      if (!response.ok) throw new Error("تعذر تحميل الملف");
      const blob = await response.blob();
      if (fallbackWindow && !fallbackWindow.closed) fallbackWindow.close();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = message.file_name || "attachment";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    } catch (error) {
      const url = await resolveMessageMediaUrl(message).catch(() => "");
      if (fallbackWindow && !fallbackWindow.closed && url) fallbackWindow.location.href = url;
      else if (url) window.open(url, "_blank", "noopener,noreferrer");
      else setNotice(error instanceof Error ? error.message : "تعذر تحميل الملف");
    }
  }

  function renderMessageMedia(message: CrmMessage) {
    const url = (message.media_asset_id && mediaUrls[message.media_asset_id]) || message.attachment_url || "";
    const type = String(message.attachment_type || message.message_type || "").toLowerCase();
    if ((type === "image" || type === "sticker") && url) return <img className="crm-chat-media-image" src={url} alt={message.file_name || "صورة العميل"} title="فتح الصورة" role="button" tabIndex={0} onClick={() => void openMedia(message)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") void openMedia(message); }} />;
    if (type === "audio" && url) return <audio className="crm-chat-media-player" controls preload="metadata" src={url} />;
    if (type === "video" && url) return <video className="crm-chat-media-video" controls preload="metadata" src={url} />;
    if (message.media_asset_id || message.attachment_url || message.storage_key) {
      const Icon = type === "image" ? ImageSquare : type === "audio" ? FileAudio : type === "video" ? FileVideo : FilePdf;
      return <div className="crm-chat-file-card" role="button" tabIndex={0} onClick={() => void openMedia(message)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") void openMedia(message); }}><Icon size={24} /><span><strong>{message.file_name || "مرفق"}</strong><small>{message.mime_type || type || "ملف"}{message.file_size ? ` • ${Math.max(1, Math.round(message.file_size / 1024)).toLocaleString("ar-SA")} KB` : ""}</small></span><button type="button" className="crm-icon-button" title="تحميل الملف" onClick={(event) => { event.stopPropagation(); void downloadMedia(message); }}><DownloadSimple size={18} /></button></div>;
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
    if (field.field_type === "textarea" && field.field_key === "notes") return <label key={field.id} className="crm-field-wide crm-notes-field">{label}{currentValue ? <div className="crm-notes-history">{currentValue}</div> : <div className="crm-notes-history empty">لا توجد ملاحظات محفوظة</div>}<textarea rows={4} value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="اكتب ملاحظة جديدة، وسيتم حفظها بتاريخ اليوم عند الضغط على حفظ بيانات العميل" /></label>;
    if (field.field_type === "textarea") return <label key={field.id} className="crm-field-wide">{label}<textarea rows={4} value={currentValue} onChange={(event) => setField(field, event.target.value)} /></label>;
    if (field.field_type === "select") {
      const options = normalizeOptions(field);
      return <label key={field.id}>{label}<select value={currentValue} onChange={(event) => setField(field, event.target.value)}><option value="">اختر</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
    }
    return <label key={field.id}>{label}<input type={field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"} inputMode={field.field_type === "phone" ? "tel" : undefined} value={currentValue} onChange={(event) => setField(field, event.target.value)} /></label>;
  }

  return (
    <div className={`crm-drawer-backdrop crm-customer-workspace-backdrop ${showConversation ? "" : "crm-edit-customer-backdrop"}`} onMouseDown={onClose}>
      <aside className={`crm-lead-drawer crm-customer-workspace crm-mobile-panel-${mobilePanel} ${showConversation ? "" : "crm-edit-customer-workspace"}`} onMouseDown={(event) => event.stopPropagation()}>
        <header className="crm-drawer-head crm-customer-workspace-head">
          {showConversation ? (
            <button className="crm-customer-title crm-customer-title-button" type="button" onClick={() => setMobilePanel("details")} aria-label="فتح بيانات العميل">
              <span className="crm-customer-avatar"><UserCircle size={34} weight="duotone" /></span>
              <div><span>محادثة العميل</span><h2>{lead.customer_name || "عميل"}</h2><p><Phone size={14} /> {lead.phone || lead.phone_normalized || "بدون رقم جوال"}</p></div>
            </button>
          ) : (
            <div className="crm-customer-title"><span className="crm-customer-avatar"><UserCircle size={34} weight="duotone" /></span><div><span>تعديل بيانات العميل</span><h2>{lead.customer_name || "عميل"}</h2><p><Phone size={14} /> {lead.phone || lead.phone_normalized || "بدون رقم جوال"}</p></div></div>
          )}
          <div className="crm-customer-head-meta"><span><b>المسؤول:</b> {lead.assigned_name || "غير موزع"}</span>{department === "finance" ? <span><b>الكول سنتر:</b> {lead.call_center_name || "غير موزع"}</span> : null}<span><CalendarBlank size={14} /><b>دخول السيستم:</b> {formatDate(lead.registered_at || lead.created_at)}</span></div>
          <button className="crm-icon-button crm-customer-workspace-close" type="button" onClick={onClose} aria-label="إغلاق"><X size={21} /></button>
        </header>

        <div className={`crm-drawer-grid crm-customer-workspace-grid ${showConversation ? "" : "crm-edit-customer-grid"}`}>
          {showConversation ? <section className="crm-conversation-panel crm-customer-conversation">
            <header className="crm-conversation-toolbar">
              <div className="crm-mobile-workspace-nav">
                <button className="crm-mobile-drawer-back" type="button" onClick={onClose}><ArrowRight size={18} />رجوع</button>
                <label className="crm-mobile-conversation-status-control">
                  <span>تغيير الحالة</span>
                  <select value={activeForm.values.status_label} disabled={savingStatus} onChange={(event) => void changeConversationStatus(event.target.value)} aria-label="تغيير حالة العميل">
                    {activeForm.values.status_label && !statuses.some((status) => status.value === activeForm.values.status_label) ? <option value={activeForm.values.status_label}>{activeForm.values.status_label}</option> : null}
                    {statuses.map((status) => <option key={status.id} value={status.value}>{status.label}</option>)}
                  </select>
                </label>
                <button className="crm-mobile-open-details" type="button" onClick={() => setMobilePanel("details")}><UserCircle size={18} />بيانات العميل</button>
              </div>
              <div className="crm-conversation-header-content">
                <div className="crm-conversation-route"><span>المحادثة</span><strong>{policy.routeLabel}</strong><small>{policy.reason}</small></div>
                <div className="crm-conversation-header-actions">
                  <button className="crm-icon-button" type="button" onClick={() => void loadConversation(lead.id, conversationId, false)} aria-label="تحديث المحادثة"><ArrowClockwise size={18} /></button>
                  {statusNotice ? <small className={`crm-conversation-status-notice ${statusNotice.includes("تعذر") || statusNotice.includes("لا توجد صلاحية") ? "error" : ""}`}>{statusNotice}</small> : null}
                </div>
              </div>
            </header>
            <div className="crm-messages-list" ref={messagesListRef}>
              {loadingMessages ? <div className="crm-empty-state">جاري تحميل رسائل المحادثة...</div> : null}
              {!loadingMessages && !messages.length ? <div className="crm-empty-state crm-empty-conversation"><ChatCircleDots size={38} weight="duotone" /><strong>لا توجد رسائل مسجلة</strong><span>يمكن بدء الإرسال من الأسفل حسب قناة ومصدر العميل.</span></div> : null}
              {messages.map((message) => <div key={message.id} className={`crm-message ${isOutboundMessage(message) ? "out" : "in"}`}>{renderMessageMedia(message)}{message.body ? <p>{message.body}</p> : null}<small>{message.sender_type === "bot" ? "وكيل صندوق الوارد • " : ""}{formatDate(message.created_at)} {visibleProviderStatus(message) ? `• ${visibleProviderStatus(message)}` : ""}</small></div>)}
            </div>
            <div className={`crm-message-composer-shell ${composerExpanded ? "is-expanded" : "is-collapsed"}`}>
              {compactComposerViewport ? <button className="crm-message-composer-toggle" type="button" onClick={() => setComposerExpanded((current) => !current)} aria-expanded={composerExpanded} aria-controls="crm-message-composer-body">
                <span className="crm-message-composer-toggle-main">
                  <span className="crm-message-composer-toggle-icon"><ChatCircleDots size={20} weight="duotone" /></span>
                  <span><strong>{composerExpanded ? "إخفاء منطقة الكتابة" : "كتابة رسالة"}</strong><small>{messageText.trim() || pendingFile ? "يوجد مسودة محفوظة" : "اضغط لفتح الإرسال والمرفقات"}</small></span>
                </span>
                {composerExpanded ? <CaretDown size={19} /> : <CaretUp size={19} />}
              </button> : null}
              {(!compactComposerViewport || composerExpanded) ? <div className="crm-message-composer" id="crm-message-composer-body">
                <div className="crm-message-route-note">{policy.route === "whatsapp" ? <WhatsappLogo size={19} weight="fill" /> : <ChatCircleDots size={19} />}<span>{policy.reason}</span></div>
                <textarea value={messageText} onChange={(event) => {
                  const nextText = event.target.value;
                  setMessageText(nextText);
                  if (selectedTemplate) {
                    const template = (meta?.templates || []).find((item) => item.id === selectedTemplate);
                    const rendered = renderTemplateInComposer(template);
                    if (!editedTextStillMatchesTemplate(rendered, nextText)) setSelectedTemplate("");
                  }
                }} placeholder={selectedTemplate ? "راجع القالب واستكمل المتغيرات الظاهرة، أو اكتب نصًا مختلفًا ليُرسل كنص حر" : "اكتب رسالتك هنا... Enter للإرسال و Shift + Enter لسطر جديد"} rows={5} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} />
                <div className="crm-composer-actions">
                  <div className="crm-composer-attachments">
                    <label className="crm-attachment-button" title="إرفاق صورة أو فيديو أو PDF"><Paperclip size={19} /><span>{pendingFile ? pendingFile.name : "مرفق"}</span><input type="file" accept="image/*,video/*,.pdf,application/pdf" onChange={(event) => setPendingFile(event.target.files?.[0] || null)} /></label>
                  </div>
                  <button type="button" disabled={sending || (!messageText.trim() && !selectedTemplate && !pendingFile)} onClick={() => void sendMessage()}><PaperPlaneTilt size={18} />{sending ? "جاري الإرسال..." : "إرسال"}</button>
                </div>
              </div> : null}
            </div>
          </section> : null}

          <section className="crm-drawer-details crm-customer-details-panel">
            <header className="crm-customer-details-title">
              <div className="crm-customer-details-nav">
                {showConversation ? <button className="crm-mobile-back-to-chat" type="button" onClick={() => setMobilePanel("conversation")}><ArrowRight size={18} />العودة للمحادثة</button> : <button className="crm-mobile-back-to-chat" type="button" onClick={onClose}><ArrowRight size={18} />رجوع</button>}
              </div>
              <div className="crm-customer-details-heading">
                <div><span>ملف العميل</span><h3>بيانات العميل</h3></div>
                <span className="crm-customer-department-pill">{departmentLabel(form.departmentCode)}</span>
              </div>
            </header>
            <section className="crm-customer-details-summary" aria-label="ملخص بيانات العميل">
              <div className="crm-customer-summary-main"><span className="crm-customer-summary-avatar"><UserCircle size={30} weight="duotone" /></span><div><small>العميل</small><strong>{activeForm.values.customer_name || lead.customer_name || "عميل"}</strong><span><Phone size={13} /> {activeForm.values.phone || lead.phone || lead.phone_normalized || "بدون رقم جوال"}</span></div></div>
              <div className="crm-customer-summary-meta"><span><b>الحالة الحالية</b>{activeForm.values.status_label || "غير محدد"}</span><span><b>المسؤول</b>{lead.assigned_name || "غير موزع"}</span></div>
            </section>
            <div className="crm-customer-details-form-shell">
            {!showConversation ? (
              <section className="crm-database-edit-routing" aria-label="تعديل بيانات توزيع العميل">
                <header><div><strong>بيانات التوزيع والحالة</strong><span>الحفظ يحدّث نفس العميل الحالي ولا ينشئ عميلاً جديدًا.</span></div></header>
                <div className="crm-database-edit-routing-grid">
                  <label><span>القسم</span><select value={activeForm.departmentCode} onChange={(event) => changeDatabaseDepartment(event.target.value)}>{databaseDepartmentOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                  <label><span>الفرع</span><select value={activeForm.branchCode} onChange={(event) => setForm((current) => current ? { ...current, branchCode: event.target.value } : current)}><option value="">بدون فرع</option>{editableBranches.map((branch) => <option key={branch.code} value={branch.code}>{branch.name}</option>)}</select></label>
                  <label><span>الدفع</span><select value={activeForm.paymentType} onChange={(event) => setForm((current) => current ? { ...current, paymentType: event.target.value } : current)}><option value="كاش">كاش</option><option value="تمويل">تمويل</option><option value="خدمة عملاء">خدمة عملاء</option></select></label>
                  <label><span>الحالة</span><select value={activeForm.values.status_label} onChange={(event) => {
                    const nextStatus = event.target.value;
                    setForm((current) => current ? {
                      ...current,
                      values: {
                        ...current.values,
                        status_label: nextStatus,
                        follow_up_at: isPostponed(nextStatus) ? current.values.follow_up_at : "",
                        sold_at: nextStatus === "تم البيع" ? (current.values.sold_at || riyadhDateInput()) : current.values.sold_at,
                      },
                    } : current);
                  }}>{activeForm.values.status_label && !statuses.some((status) => status.value === activeForm.values.status_label) ? <option value={activeForm.values.status_label}>{activeForm.values.status_label}</option> : null}{statuses.map((status) => <option key={status.id} value={status.value}>{status.label}</option>)}</select></label>
                  {activeForm.values.status_label === "تم البيع" ? <label className="crm-sold-at-field"><span>تاريخ تم البيع</span><input type="date" value={activeForm.values.sold_at || ""} onChange={(event) => setForm((current) => current ? { ...current, values: { ...current.values, sold_at: event.target.value } } : current)} /></label> : null}
                  <label><span>المسؤول</span><select value={activeForm.assignedTo} onChange={(event) => setForm((current) => current ? { ...current, assignedTo: event.target.value } : current)}><option value="">غير موزع</option>{editableAgents.map((user) => <option key={user.id} value={user.id}>{user.full_name}{user.branches.length ? ` - ${user.branches.join("، ")}` : ""}</option>)}</select></label>
                  <label><span>الكول سنتر</span><select value={activeForm.callCenterAssignedTo} onChange={(event) => setForm((current) => current ? { ...current, callCenterAssignedTo: event.target.value } : current)}><option value="">بدون كول سنتر</option>{editableCallCenterUsers.map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}</select></label>
                </div>
              </section>
            ) : null}
            <div className="crm-form-grid">
              {configuredFields.map(renderField)}
              {activeForm.values.status_label === "تم البيع" && (department === "cash" || department === "finance") ? (
                <label className="crm-sold-quantity-field"><span>عدد المباع <b className="crm-required-mark"> *</b></span><input type="number" min="1" step="1" value={activeForm.values.sold_quantity || "1"} onChange={(event) => setForm((current) => current ? { ...current, values: { ...current.values, sold_quantity: String(Math.max(1, Math.floor(Number(event.target.value || 1)))) } } : current)} /></label>
              ) : null}
            </div>
            {department === "finance" ? credit?.amount == null ? <div className="crm-credit-result neutral">الحد الائتماني = أدخل الراتب واختر نوع التمويل</div> : <div className={`crm-credit-result ${credit.qualified ? "good" : "bad"}`}>الحد الائتماني = {Math.round(credit.amount).toLocaleString("ar-SA")} ريال - {credit.qualified ? "مؤهل" : "غير مؤهل"}</div> : null}
            {notice ? <div className="crm-inline-notice">{notice}</div> : null}
            <button className="crm-primary-button crm-save-customer-button" type="button" disabled={saving} onClick={() => void saveLead()}>{saving ? "جاري الحفظ..." : "حفظ بيانات العميل"}</button>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
