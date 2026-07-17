import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowClockwise,
  CaretDown,
  CaretUp,
  CheckCircle,
  FloppyDisk,
  LinkSimple,
  PencilSimple,
  Plus,
  Shuffle,
  Trash,
  UsersThree,
} from "@phosphor-icons/react";
import { crmFetch, formatDate } from "../api";
import { sourceLabel } from "../sourceCatalog";
import { CrmEntryRoutingSettings } from "../components/CrmEntryRoutingSettings";

const tabs = [
  { key: "entry_routing", label: "دخول وتوزيع العملاء" },
  { key: "statuses", label: "حالات العملاء" },
  { key: "customer_fields", label: "بيانات العميل" },
  { key: "sources", label: "المصادر" },
  { key: "templates", label: "القوالب والرسائل" },
  { key: "mappings", label: "ربط الحالات بالقوالب" },
  { key: "quality", label: "مؤشرات التقارير" },
  { key: "endpoints", label: "ربط المنصات والـ Workers" },
  { key: "branches", label: "الفروع" },
  { key: "distribution", label: "توزيع العملاء" },
] as const;

type Tab = typeof tabs[number]["key"];
type Props = { embedded?: boolean };

const blankStatus = { id: "", departmentCode: "cash", label: "", value: "", sortOrder: 10, isActive: true };
const blankCustomerField = { id: "", fieldKey: "", label: "", fieldType: "text", sortOrder: 10, departmentKeys: [] as string[], isActive: true, isRequired: false, includeInCompletion: false, optionsText: "", isSystem: false, isLocked: false };
const blankSource = { code: "", name: "", sortOrder: 10, systemCodes: ["crm", "marketing"] as string[], deliveryRoute: "whatsapp", allowFreeText: false, isActive: true };
const blankTemplate = { id: "", displayName: "", name: "", content: "", templateType: "quick_message", provider: "manual", externalId: "", departments: [] as string[], isActive: true };
const blankMapping = { id: "", departmentCode: "cash_sales", statusValue: "", statusLabel: "", templateId: "", messageType: "template", isActive: true };
const blankEndpoint = { sourceCode: "", displayName: "", sendUrl: "", templatesSyncUrl: "", inboundWebhookUrl: "", healthUrl: "", secretName: "", isActive: true };
const blankBranch = { code: "", name: "", sortOrder: 0, isActive: true };
const blankRule = { id: "", name: "", departmentCode: "cash_sales", branchCode: "", sourceCodes: [] as string[], memberIds: [] as string[], sortOrder: 10, preventConsecutive: true, isActive: true };

function dbToQuality(raw: any) {
  return {
    marketingNumeratorStatuses: raw?.marketing_numerator_statuses || ["مؤهل"],
    marketingDenominatorMode: raw?.marketing_denominator_mode || "all",
    marketingDenominatorStatuses: raw?.marketing_denominator_statuses || [],
    salesNumeratorStatuses: raw?.sales_numerator_statuses || ["تم البيع", "تم الانتهاء - إنشاء طلب البيع"],
    salesDenominatorMode: raw?.sales_denominator_mode || "statuses",
    salesDenominatorStatuses: raw?.sales_denominator_statuses || [],
  };
}

function departmentLabel(code: string) {
  if (code === "cash" || code === "cash_sales") return "مبيعات الكاش";
  if (code === "finance" || code === "finance_sales") return "مبيعات التمويل";
  if (code === "service" || code === "customer_service") return "خدمة العملاء";
  if (code === "call_center") return "الكول سنتر";
  return code;
}

function customerFieldTypeLabel(type: string) {
  const labels: Record<string, string> = {
    text: "نص",
    phone: "رقم جوال",
    number: "رقم",
    date: "تاريخ",
    textarea: "ملاحظات كبيرة",
    select: "قائمة اختيارات",
    status: "حالات العملاء",
    source: "المصادر",
    department: "القسم",
    transfer: "تحويل القسم",
  };
  return labels[type] || type;
}

function optionsTextToRows(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [value, ...labelParts] = line.split("|");
      return { value: value.trim(), label: labelParts.join("|").trim() || value.trim() };
    })
    .filter((row) => row.value);
}

function optionsRowsToText(options: any[]) {
  return (options || []).map((row) => `${row.value}|${row.label || row.value}`).join("\n");
}

function toggleList(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function moveListItem(list: string[], value: string, direction: -1 | 1) {
  const index = list.indexOf(value);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function AdminStack({ editor, list }: { editor: ReactNode; list: ReactNode }) {
  return <div className="crm-admin-stack">{editor}{list}</div>;
}

function templateTypeLabel(row: any) {
  return row.template_type === "template" || row.provider === "mersal" ? "قالب مرسال" : "رسالة سريعة";
}

function templateStatusLabel(row: any) {
  if (row.provider === "mersal") return row.status || (row.is_active ? "APPROVED" : "غير نشط");
  return row.is_active ? "نشط" : "موقوف";
}

export function CrmAdminPage({ embedded = false }: Props) {
  const [tab, setTab] = useState<Tab>("entry_routing");
  const [data, setData] = useState<any>({ statuses: [], customerFields: [], sources: [], templates: [], mappings: [], endpoints: [], branches: [], quality: null, assignmentRules: [], assignmentLogs: [], assignmentUsers: [] });
  const [statusForm, setStatusForm] = useState(blankStatus);
  const [customerFieldForm, setCustomerFieldForm] = useState(blankCustomerField);
  const [sourceForm, setSourceForm] = useState(blankSource);
  const [templateForm, setTemplateForm] = useState(blankTemplate);
  const [mappingForm, setMappingForm] = useState(blankMapping);
  const [endpointForm, setEndpointForm] = useState(blankEndpoint);
  const [branchForm, setBranchForm] = useState(blankBranch);
  const [ruleForm, setRuleForm] = useState(blankRule);
  const [quality, setQuality] = useState(dbToQuality(null));
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncingMersal, setSyncingMersal] = useState(false);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const result = await crmFetch<any>("/api/crm/settings");
      setData(result);
      setQuality(dbToQuality(result.quality));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل إعدادات CRM");
    } finally {
      setLoading(false);
    }
  }

  async function save(section: string, payload: any) {
    try {
      const result = await crmFetch<any>("/api/crm/settings", {
        method: "POST",
        body: JSON.stringify({ section, ...payload }),
      });
      setNotice(result.message || "تم حفظ الإعدادات");
      await load();
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "فشل الحفظ");
      return false;
    }
  }

  async function remove(section: string, id: string, extra: any = {}) {
    if (!window.confirm("متأكد من تنفيذ الحذف؟")) return;
    try {
      const result = await crmFetch<any>("/api/crm/settings", {
        method: "DELETE",
        body: JSON.stringify({ section, id, action: "delete", ...extra }),
      });
      setNotice(result.message || (result.deactivated ? "تم إيقاف العنصر لأنه مستخدم في بيانات سابقة" : "تم الحذف"));
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر الحذف");
    }
  }

  async function syncMersalTemplates() {
    setSyncingMersal(true);
    setNotice("جاري مزامنة قوالب مرسال...");
    try {
      const result = await crmFetch<any>("/api/crm/mersal-templates", { method: "POST" });
      setNotice(result.message || "تمت مزامنة قوالب مرسال");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "فشل مزامنة قوالب مرسال");
    } finally {
      setSyncingMersal(false);
    }
  }

  const allStatusValues = useMemo(() => [...new Set((data.statuses || []).map((row: any) => row.value))] as string[], [data.statuses]);
  const endpointSources = useMemo(() => {
    const map = new Map<string, { code: string; name: string }>();
    for (const row of data.sources || []) map.set(row.code, { code: row.code, name: row.name });
    for (const row of data.endpoints || []) {
      if (!map.has(row.source_code)) map.set(row.source_code, { code: row.source_code, name: sourceLabel(row.source_code, row.display_name) });
    }
    return [...map.values()];
  }, [data.sources, data.endpoints]);

  const departmentStatuses = (departmentCode: string) => (data.statuses || []).filter((row: any) => row.department_code === (departmentCode === "cash_sales" ? "cash" : departmentCode === "finance_sales" ? "finance" : departmentCode === "customer_service" ? "service" : departmentCode));

  const eligibleRuleUsers = useMemo(() => (data.assignmentUsers || []).filter((row: any) => {
    if (!row.is_active || !row.can_receive_leads) return false;
    if (!(row.department_codes || []).includes(ruleForm.departmentCode)) return false;
    if (ruleForm.branchCode && !(row.branch_codes || []).includes(ruleForm.branchCode)) return false;
    return true;
  }), [data.assignmentUsers, ruleForm.departmentCode, ruleForm.branchCode]);

  const selectedRuleUsers = useMemo(() => ruleForm.memberIds
    .map((id) => (data.assignmentUsers || []).find((row: any) => row.id === id))
    .filter(Boolean), [data.assignmentUsers, ruleForm.memberIds]);

  const distributionSummary = useMemo(() => ({
    activeRules: (data.assignmentRules || []).filter((row: any) => row.is_active).length,
    eligibleUsers: (data.assignmentUsers || []).filter((row: any) => row.is_active && row.can_receive_leads).length,
    loggedAssignments: (data.assignmentLogs || []).length,
  }), [data.assignmentRules, data.assignmentUsers, data.assignmentLogs]);

  function toggleQuality(key: keyof typeof quality, status: string) {
    setQuality((current) => ({ ...current, [key]: toggleList(current[key] as string[], status) }));
  }

  function editCustomerField(row: any) {
    setCustomerFieldForm({
      id: row.id,
      fieldKey: row.field_key,
      label: row.label,
      fieldType: row.field_type,
      sortOrder: Number(row.sort_order || 0),
      departmentKeys: row.department_keys || [],
      isActive: row.is_active !== false,
      isRequired: row.is_required === true,
      includeInCompletion: row.include_in_completion === true,
      optionsText: optionsRowsToText(row.options || []),
      isSystem: row.is_system === true,
      isLocked: row.is_locked === true,
    });
  }

  function editRule(row: any) {
    setRuleForm({
      id: row.id,
      name: row.name,
      departmentCode: row.department_code,
      branchCode: row.branch_code || "",
      sourceCodes: row.source_codes || [],
      memberIds: (row.members || []).filter((member: any) => member.is_active).map((member: any) => member.user_id),
      sortOrder: row.sort_order || 0,
      preventConsecutive: row.prevent_consecutive !== false,
      isActive: row.is_active !== false,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className={`crm-page crm-admin-page ${embedded ? "embedded" : ""}`}>
      {!embedded ? (
        <header className="crm-page-head">
          <div><h1>إعدادات CRM</h1><p>كل الإعدادات التشغيلية في مكان واحد بدون تعديل السورس.</p></div>
          <button className="crm-secondary-button" onClick={() => void load()}><ArrowClockwise size={18} />إعادة تحميل</button>
        </header>
      ) : (
        <div className="crm-embedded-settings-head">
          <div><h2>إعدادات CRM</h2><p>الحالات والمصادر والقوالب والفروع والتوزيع والربط مع المنصات.</p></div>
          <button className="crm-secondary-button" onClick={() => void load()}><ArrowClockwise size={18} />تحديث</button>
        </div>
      )}

      <div className="crm-admin-tabs">
        {tabs.map((item) => <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}>{item.label}</button>)}
      </div>
      {notice ? <div className="crm-inline-notice">{notice}</div> : null}
      {loading ? <div className="crm-loading-panel">جاري تحميل الإعدادات...</div> : null}


      {tab === "entry_routing" ? <CrmEntryRoutingSettings /> : null}

      {tab === "statuses" ? (
        <AdminStack
          editor={(
            <section className="crm-panel crm-form-panel crm-settings-wide-editor">
              <header><div><h2>{statusForm.id ? "تعديل حالة" : "إضافة حالة جديدة"}</h2><p>ترتيب الحالات هنا هو نفس ترتيب أعمدة الكانبان.</p></div></header>
              <div className="crm-form-grid crm-form-grid-wide">
                <label><span>القسم</span><select value={statusForm.departmentCode} onChange={(event) => setStatusForm((current) => ({ ...current, departmentCode: event.target.value }))}><option value="cash">مبيعات الكاش</option><option value="finance">مبيعات التمويل</option><option value="service">خدمة العملاء</option></select></label>
                <label><span>اسم الحالة في الداش بورد</span><input value={statusForm.label} onChange={(event) => setStatusForm((current) => ({ ...current, label: event.target.value }))} /></label>
                <label><span>قيمة الحالة</span><input value={statusForm.value} onChange={(event) => setStatusForm((current) => ({ ...current, value: event.target.value }))} /></label>
                <label><span>ترتيب الظهور</span><input type="number" value={statusForm.sortOrder} onChange={(event) => setStatusForm((current) => ({ ...current, sortOrder: Number(event.target.value) }))} /></label>
                <label className="crm-switch-row"><input type="checkbox" checked={statusForm.isActive} onChange={(event) => setStatusForm((current) => ({ ...current, isActive: event.target.checked }))} /><span>نشطة</span></label>
              </div>
              <div className="crm-form-actions"><button className="crm-secondary-button" onClick={() => setStatusForm(blankStatus)}>جديد</button><button className="crm-primary-button" onClick={async () => { const id = statusForm.id || `${statusForm.departmentCode}-${Date.now()}`; if (await save("status", { ...statusForm, id })) setStatusForm(blankStatus); }}><FloppyDisk size={18} />حفظ الحالة</button></div>
            </section>
          )}
          list={(
            <section className="crm-panel crm-list-panel crm-settings-full-table">
              <header><h2>الحالات المسجلة</h2><span>{data.statuses.length}</span></header>
              <div className="crm-table-shell"><table className="crm-table"><thead><tr><th>القسم</th><th>اسم الكارت</th><th>قيمة الحالة</th><th>الترتيب</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>{data.statuses.map((row: any) => <tr key={row.id}><td>{departmentLabel(row.department_code)}</td><td>{row.label}</td><td>{row.value}</td><td>{row.sort_order}</td><td>{row.is_active ? "نشطة" : "موقوفة"}</td><td><div className="crm-row-actions"><button onClick={() => setStatusForm({ id: row.id, departmentCode: row.department_code, label: row.label, value: row.value, sortOrder: row.sort_order, isActive: row.is_active })}><PencilSimple size={16} /></button><button onClick={() => void remove("status", row.id)}><Trash size={16} /></button></div></td></tr>)}</tbody></table></div>
            </section>
          )}
        />
      ) : null}

      {tab === "customer_fields" ? (
        <AdminStack
          editor={(
            <section className="crm-panel crm-form-panel crm-settings-wide-editor">
              <header><div><h2>{customerFieldForm.id ? "تعديل حقل بيانات" : "إضافة حقل بيانات"}</h2><p>النموذج ونسبة اكتمال الملف يعتمدان على هذه الإعدادات مباشرة.</p></div></header>
              <div className="crm-form-grid crm-form-grid-wide">
                <label><span>الكود الداخلي (اختياري)</span><input disabled={Boolean(customerFieldForm.id)} placeholder="يُنشأ تلقائيًا عند تركه فارغًا" value={customerFieldForm.fieldKey} onChange={(event) => setCustomerFieldForm((current) => ({ ...current, fieldKey: event.target.value }))} /></label>
                <label><span>اسم الحقل</span><input value={customerFieldForm.label} onChange={(event) => setCustomerFieldForm((current) => ({ ...current, label: event.target.value }))} /></label>
                <label><span>نوع الحقل</span><select disabled={customerFieldForm.isSystem} value={customerFieldForm.fieldType} onChange={(event) => setCustomerFieldForm((current) => ({ ...current, fieldType: event.target.value }))}><option value="text">نص</option><option value="phone">رقم جوال</option><option value="number">رقم</option><option value="date">تاريخ</option><option value="textarea">ملاحظات كبيرة</option><option value="select">قائمة اختيارات</option>{customerFieldForm.isSystem ? <><option value="status">حالات العملاء</option><option value="source">المصادر</option><option value="department">القسم</option><option value="transfer">تحويل القسم</option></> : null}</select></label>
                <label><span>ترتيب الظهور</span><input type="number" value={customerFieldForm.sortOrder} onChange={(event) => setCustomerFieldForm((current) => ({ ...current, sortOrder: Number(event.target.value) }))} /></label>
                <div className="crm-field-wide"><span className="crm-field-caption">يظهر في الأقسام</span><p className="crm-field-help">عدم اختيار قسم يعني أن الحقل يظهر في كل الأقسام.</p><div className="crm-check-grid"><label><input type="checkbox" disabled={customerFieldForm.isLocked} checked={customerFieldForm.departmentKeys.includes("cash")} onChange={() => setCustomerFieldForm((current) => ({ ...current, departmentKeys: toggleList(current.departmentKeys, "cash") }))} />مبيعات الكاش</label><label><input type="checkbox" disabled={customerFieldForm.isLocked} checked={customerFieldForm.departmentKeys.includes("finance")} onChange={() => setCustomerFieldForm((current) => ({ ...current, departmentKeys: toggleList(current.departmentKeys, "finance") }))} />مبيعات التمويل</label><label><input type="checkbox" disabled={customerFieldForm.isLocked} checked={customerFieldForm.departmentKeys.includes("service")} onChange={() => setCustomerFieldForm((current) => ({ ...current, departmentKeys: toggleList(current.departmentKeys, "service") }))} />خدمة العملاء</label></div></div>
                {customerFieldForm.fieldType === "select" ? <label className="crm-field-wide"><span>اختيارات القائمة</span><textarea rows={6} placeholder={"القيمة|الاسم الظاهر\nمثال: yes|نعم"} value={customerFieldForm.optionsText} onChange={(event) => setCustomerFieldForm((current) => ({ ...current, optionsText: event.target.value }))} /></label> : null}
                <label className="crm-switch-row"><input type="checkbox" disabled={customerFieldForm.isLocked} checked={customerFieldForm.isActive} onChange={(event) => setCustomerFieldForm((current) => ({ ...current, isActive: event.target.checked }))} /><span>الحقل ظاهر ونشط</span></label>
                <label className="crm-switch-row"><input type="checkbox" disabled={customerFieldForm.isLocked} checked={customerFieldForm.isRequired} onChange={(event) => setCustomerFieldForm((current) => ({ ...current, isRequired: event.target.checked }))} /><span>حقل إجباري عند الحفظ</span></label>
                <label className="crm-switch-row"><input type="checkbox" checked={customerFieldForm.includeInCompletion} onChange={(event) => setCustomerFieldForm((current) => ({ ...current, includeInCompletion: event.target.checked }))} /><span>يدخل في نسبة اكتمال الملف</span></label>
              </div>
              {customerFieldForm.isSystem ? <div className="crm-system-field-note">هذا حقل أساسي مرتبط بالنظام. يمكن تعديل الاسم والترتيب والنسبة، ولا يمكن حذف بنيته.</div> : null}
              <div className="crm-form-actions"><button className="crm-secondary-button" onClick={() => setCustomerFieldForm(blankCustomerField)}><Plus size={18} />حقل جديد</button><button className="crm-primary-button" onClick={async () => { const payload = { ...customerFieldForm, options: optionsTextToRows(customerFieldForm.optionsText) }; if (await save("customer_field", payload)) setCustomerFieldForm(blankCustomerField); }}><FloppyDisk size={18} />حفظ الحقل</button></div>
            </section>
          )}
          list={(
            <section className="crm-panel crm-list-panel crm-settings-full-table">
              <header><h2>حقول بيانات العميل</h2><span>{data.customerFields.length}</span></header>
              <div className="crm-table-shell"><table className="crm-table"><thead><tr><th>الترتيب</th><th>اسم الحقل</th><th>النوع</th><th>الأقسام</th><th>في النسبة</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>{data.customerFields.map((row: any) => <tr key={row.id} className={!row.is_active ? "crm-row-inactive" : ""}><td>{row.sort_order}</td><td><strong>{row.label}</strong><small>{row.is_system ? "حقل أساسي" : row.field_key}</small></td><td>{customerFieldTypeLabel(row.field_type)}</td><td>{(row.department_keys || []).length ? row.department_keys.map(departmentLabel).join("، ") : "كل الأقسام"}</td><td>{row.include_in_completion ? "نعم" : "لا"}</td><td>{row.is_active ? "نشط" : "موقوف"}</td><td><div className="crm-row-actions"><button onClick={() => editCustomerField(row)}><PencilSimple size={16} /></button>{!row.is_system ? <button onClick={() => void remove("customer_field", row.id)}><Trash size={16} /></button> : null}</div></td></tr>)}</tbody></table></div>
            </section>
          )}
        />
      ) : null}

      {tab === "sources" ? (
        <AdminStack
          editor={(
            <section className="crm-panel crm-form-panel crm-settings-wide-editor">
              <header><div><h2>{sourceForm.code ? "تعديل المصدر" : "إضافة مصدر"}</h2><p>قائمة مركزية مشتركة بين CRM والتسويق وباقي أجزاء المنصة.</p></div></header>
              <div className="crm-form-grid crm-form-grid-wide">
                <label><span>كود المصدر</span><input disabled={Boolean(data.sources.find((row: any) => row.code === sourceForm.code))} placeholder="مثال: showroom_event" value={sourceForm.code} onChange={(event) => setSourceForm((current) => ({ ...current, code: event.target.value }))} /></label>
                <label><span>اسم المصدر بالعربي</span><input placeholder="مثال: فعالية المعرض" value={sourceForm.name} onChange={(event) => setSourceForm((current) => ({ ...current, name: event.target.value }))} /></label>
                <label><span>ترتيب الظهور</span><input type="number" value={sourceForm.sortOrder} onChange={(event) => setSourceForm((current) => ({ ...current, sortOrder: Number(event.target.value) }))} /></label>
                <label><span>قناة الإرسال</span><select value={sourceForm.deliveryRoute} onChange={(event) => setSourceForm((current) => ({ ...current, deliveryRoute: event.target.value }))}><option value="whatsapp">واتساب</option><option value="facebook">فيسبوك</option><option value="instagram">إنستجرام</option><option value="tiktok">تيك توك</option></select></label>
                <label className="crm-switch-row"><input type="checkbox" checked={sourceForm.allowFreeText} onChange={(event) => setSourceForm((current) => ({ ...current, allowFreeText: event.target.checked }))} /><span>السماح بالنص الحر</span></label>
                <label className="crm-switch-row"><input type="checkbox" checked={sourceForm.isActive} onChange={(event) => setSourceForm((current) => ({ ...current, isActive: event.target.checked }))} /><span>المصدر نشط</span></label>
                <div className="crm-field-wide"><span className="crm-field-caption">يُستخدم في</span><div className="crm-check-grid"><label><input type="checkbox" checked={sourceForm.systemCodes.includes("crm")} onChange={() => setSourceForm((current) => ({ ...current, systemCodes: toggleList(current.systemCodes, "crm") }))} />CRM</label><label><input type="checkbox" checked={sourceForm.systemCodes.includes("marketing")} onChange={() => setSourceForm((current) => ({ ...current, systemCodes: toggleList(current.systemCodes, "marketing") }))} />التسويق</label><label><input type="checkbox" checked={sourceForm.systemCodes.includes("operations")} onChange={() => setSourceForm((current) => ({ ...current, systemCodes: toggleList(current.systemCodes, "operations") }))} />العمليات</label><label><input type="checkbox" checked={sourceForm.systemCodes.includes("tracking")} onChange={() => setSourceForm((current) => ({ ...current, systemCodes: toggleList(current.systemCodes, "tracking") }))} />التتبع</label></div></div>
              </div>
              <div className="crm-form-actions"><button className="crm-secondary-button" onClick={() => setSourceForm(blankSource)}>جديد</button><button className="crm-primary-button" onClick={async () => { if (await save("source", sourceForm)) setSourceForm(blankSource); }}><FloppyDisk size={18} />حفظ المصدر</button></div>
            </section>
          )}
          list={(
            <section className="crm-panel crm-list-panel crm-settings-full-table">
              <header><h2>المصادر الموحدة</h2><span>{data.sources.length}</span></header>
              <div className="crm-table-shell"><table className="crm-table"><thead><tr><th>المصدر</th><th>الكود</th><th>الأنظمة</th><th>الإرسال</th><th>الاستخدام</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>{data.sources.map((row: any) => <tr key={row.code}><td><strong>{row.name}</strong></td><td>{row.code}</td><td>{(row.system_codes || []).map((code: string) => code === "crm" ? "CRM" : code === "marketing" ? "التسويق" : code === "operations" ? "العمليات" : "التتبع").join("، ")}</td><td>{row.delivery_route === "whatsapp" ? `واتساب ${row.allow_free_text ? "نص وقوالب" : "قوالب فقط"}` : sourceLabel(row.delivery_route)}</td><td>{Number(row.crm_usage_count || 0) + Number(row.request_usage_count || 0)}</td><td>{row.is_active ? "نشط" : "موقوف"}</td><td><div className="crm-row-actions"><button onClick={() => setSourceForm({ code: row.code, name: row.name, sortOrder: row.sort_order, systemCodes: row.system_codes || [], deliveryRoute: row.delivery_route || "whatsapp", allowFreeText: row.allow_free_text, isActive: row.is_active })}><PencilSimple size={16} /></button><button onClick={() => void remove("source", "", { code: row.code })}><Trash size={16} /></button></div></td></tr>)}</tbody></table></div>
            </section>
          )}
        />
      ) : null}

      {tab === "templates" ? (
        <AdminStack
          editor={(
            <section className="crm-panel crm-form-panel crm-settings-wide-editor">
              <header><div><h2>{templateForm.id ? "تعديل الرسالة" : "إضافة رسالة يدوية"}</h2><p>اكتب رسالة واحفظها هنا، وبعدها اربطها بالحالة من تبويب ربط الحالات بالقوالب.</p></div></header>
              <div className="crm-form-grid crm-form-grid-wide">
                <label><span>الاسم الظاهر</span><input value={templateForm.displayName} onChange={(event) => setTemplateForm((current) => ({ ...current, displayName: event.target.value }))} /></label>
                <label><span>النوع</span><select disabled={templateForm.provider === "mersal"} value={templateForm.templateType} onChange={(event) => setTemplateForm((current) => ({ ...current, templateType: event.target.value }))}><option value="quick_message">رسالة سريعة</option><option value="template">قالب مرسال</option></select></label>
                <div className="crm-field-wide"><span className="crm-field-caption">الأقسام</span><p className="crm-field-help">عدم اختيار قسم يعني أن الرسالة متاحة لكل الأقسام.</p><div className="crm-check-grid"><label><input type="checkbox" checked={templateForm.departments.includes("cash_sales")} onChange={() => setTemplateForm((current) => ({ ...current, departments: toggleList(current.departments, "cash_sales") }))} />مبيعات الكاش</label><label><input type="checkbox" checked={templateForm.departments.includes("finance_sales")} onChange={() => setTemplateForm((current) => ({ ...current, departments: toggleList(current.departments, "finance_sales") }))} />مبيعات التمويل</label><label><input type="checkbox" checked={templateForm.departments.includes("customer_service")} onChange={() => setTemplateForm((current) => ({ ...current, departments: toggleList(current.departments, "customer_service") }))} />خدمة العملاء</label></div></div>
                <label className="crm-field-wide"><span>محتوى الرسالة</span><textarea rows={6} placeholder="اكتب نص الرسالة هنا" value={templateForm.content} onChange={(event) => setTemplateForm((current) => ({ ...current, content: event.target.value }))} /></label>
                {templateForm.provider === "mersal" ? <div className="crm-system-field-note crm-field-wide">هذا قالب متزامن من مرسال. اسم القالب الخارجي: {templateForm.externalId || "—"}</div> : null}
                <label className="crm-switch-row"><input type="checkbox" checked={templateForm.isActive} onChange={(event) => setTemplateForm((current) => ({ ...current, isActive: event.target.checked }))} /><span>نشط</span></label>
              </div>
              <div className="crm-form-actions"><button className="crm-secondary-button" onClick={() => setTemplateForm(blankTemplate)}>رسالة جديدة</button><button className="crm-primary-button" onClick={async () => { if (await save("template", templateForm)) setTemplateForm(blankTemplate); }}><FloppyDisk size={18} />حفظ الرسالة</button></div>
            </section>
          )}
          list={(
            <section className="crm-panel crm-list-panel crm-settings-full-table crm-templates-table-panel">
              <header className="crm-list-header-with-action">
                <div><h2>قوالب مرسال والرسائل المحفوظة في السيستم</h2><p>اضغط مزامنة لجلب القوالب المعتمدة من مرسال وحفظها أو تحديثها، ثم اربطها بالحالات.</p></div>
                <button type="button" className="crm-primary-button" disabled={syncingMersal} onClick={() => void syncMersalTemplates()}><ArrowClockwise size={18} className={syncingMersal ? "crm-spin" : ""} />{syncingMersal ? "جاري المزامنة..." : "مزامنة قوالب مرسال"}</button>
              </header>
              <div className="crm-table-shell"><table className="crm-table crm-templates-table"><thead><tr><th>الاسم الظاهر</th><th>المحتوى</th><th>النوع</th><th>الأقسام</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>{data.templates.map((row: any) => <tr key={row.id}><td><strong>{row.display_name}</strong><small>{row.provider || "manual"}</small></td><td className="crm-template-content-cell">{row.content || "—"}</td><td>{templateTypeLabel(row)}</td><td>{(row.departments || []).length ? row.departments.map(departmentLabel).join("، ") : "كل الأقسام"}</td><td>{templateStatusLabel(row)}</td><td><div className="crm-row-actions"><button onClick={() => setTemplateForm({ id: row.id, displayName: row.display_name, name: row.name, content: row.content, templateType: row.template_type, provider: row.provider || "manual", externalId: row.external_id || "", departments: row.departments || [], isActive: row.is_active })}><PencilSimple size={16} /></button><button onClick={() => void remove("template", row.id)}><Trash size={16} /></button></div></td></tr>)}</tbody></table></div>
            </section>
          )}
        />
      ) : null}

      {tab === "mappings" ? (
        <AdminStack
          editor={(
            <section className="crm-panel crm-form-panel crm-settings-wide-editor">
              <header><div><h2>ربط الحالات بالقوالب والرسائل</h2><p>اختيار الرسالة التي تستخدم تلقائيًا عند تغيير حالة العميل.</p></div></header>
              <div className="crm-form-grid crm-form-grid-wide">
                <label><span>القسم</span><select value={mappingForm.departmentCode} onChange={(event) => setMappingForm((current) => ({ ...current, departmentCode: event.target.value, statusValue: "", statusLabel: "" }))}><option value="cash_sales">مبيعات الكاش</option><option value="finance_sales">مبيعات التمويل</option><option value="customer_service">خدمة العملاء</option></select></label>
                <label><span>الحالة</span><select value={mappingForm.statusValue} onChange={(event) => { const status = departmentStatuses(mappingForm.departmentCode).find((item: any) => item.value === event.target.value); setMappingForm((current) => ({ ...current, statusValue: event.target.value, statusLabel: status?.label || event.target.value })); }}><option value="">اختار الحالة</option>{departmentStatuses(mappingForm.departmentCode).map((status: any) => <option key={status.id} value={status.value}>{status.label}</option>)}</select></label>
                <label><span>نوع الرسالة</span><select value={mappingForm.messageType} onChange={(event) => setMappingForm((current) => ({ ...current, messageType: event.target.value }))}><option value="template">قالب</option><option value="quick_message">رسالة سريعة</option></select></label>
                <label><span>القالب أو الرسالة</span><select value={mappingForm.templateId} onChange={(event) => setMappingForm((current) => ({ ...current, templateId: event.target.value }))}><option value="">اختار القالب</option>{data.templates.filter((template: any) => template.is_active).map((template: any) => <option key={template.id} value={template.id}>{template.display_name}</option>)}</select></label>
                <label className="crm-switch-row"><input type="checkbox" checked={mappingForm.isActive} onChange={(event) => setMappingForm((current) => ({ ...current, isActive: event.target.checked }))} /><span>الربط نشط</span></label>
              </div>
              <div className="crm-form-actions"><button className="crm-secondary-button" onClick={() => setMappingForm(blankMapping)}>جديد</button><button className="crm-primary-button" onClick={async () => { if (await save("mapping", mappingForm)) setMappingForm(blankMapping); }}><LinkSimple size={18} />حفظ الربط</button></div>
            </section>
          )}
          list={(
            <section className="crm-panel crm-list-panel crm-settings-full-table">
              <header><h2>الروابط المسجلة</h2><span>{data.mappings.length}</span></header>
              <div className="crm-table-shell"><table className="crm-table"><thead><tr><th>القسم</th><th>الحالة</th><th>القالب</th><th>النوع</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>{data.mappings.map((row: any) => <tr key={row.id}><td>{departmentLabel(row.department_code)}</td><td>{row.status_label}</td><td>{row.template_label}</td><td>{row.message_type === "template" ? "قالب" : "رسالة سريعة"}</td><td>{row.is_active ? "نشط" : "موقوف"}</td><td><div className="crm-row-actions"><button onClick={() => setMappingForm({ id: row.id, departmentCode: row.department_code, statusValue: row.status_value, statusLabel: row.status_label, templateId: row.template_id, messageType: row.message_type, isActive: row.is_active })}><PencilSimple size={16} /></button><button onClick={() => void remove("mapping", row.id)}><Trash size={16} /></button></div></td></tr>)}</tbody></table></div>
            </section>
          )}
        />
      ) : null}

      {tab === "quality" ? (
        <div className="crm-quality-settings"><section className="crm-panel"><h2>إعدادات مؤشرات التقارير</h2><p>المعادلات تتحكم بها الحالات المختارة هنا، بدون تعديل السورس.</p></section>{["marketing", "sales"].map((type) => { const marketing = type === "marketing"; const numKey = marketing ? "marketingNumeratorStatuses" : "salesNumeratorStatuses"; const denKey = marketing ? "marketingDenominatorStatuses" : "salesDenominatorStatuses"; const modeKey = marketing ? "marketingDenominatorMode" : "salesDenominatorMode"; return <section className="crm-panel quality-card" key={type}><h2>{marketing ? "جودة التسويق" : "جودة المبيعات"}</h2><strong>حالات البسط</strong><div className="crm-check-grid">{allStatusValues.map((status) => <label key={status}><input type="checkbox" checked={(quality as any)[numKey].includes(status)} onChange={() => toggleQuality(numKey as keyof typeof quality, status)} />{status}</label>)}</div><label className="crm-form-label"><span>المقام</span><select value={(quality as any)[modeKey]} onChange={(event) => setQuality((current) => ({ ...current, [modeKey]: event.target.value }))}><option value="all">إجمالي العملاء بعد الفلاتر</option><option value="statuses">حالات محددة</option></select></label>{(quality as any)[modeKey] === "statuses" ? <><strong>حالات المقام</strong><div className="crm-check-grid">{allStatusValues.map((status) => <label key={status}><input type="checkbox" checked={(quality as any)[denKey].includes(status)} onChange={() => toggleQuality(denKey as keyof typeof quality, status)} />{status}</label>)}</div></> : null}</section>; })}<button className="crm-primary-button" onClick={() => void save("quality", quality)}><FloppyDisk size={18} />حفظ إعدادات المؤشرات</button></div>
      ) : null}

      {tab === "endpoints" ? (
        <div className="crm-admin-split">
          <section className="crm-panel crm-form-panel">
            <header><h2>إعدادات ربط المنصات والـ Workers</h2><p>اختار المنصة ثم أضف مساراتها. واتساب/مرسال يستخدم عقدًا واحدًا صريحًا ومسار إرسال واحدًا للنص والقوالب والوسائط.</p></header>
            <div className="crm-form-grid">
              <label><span>المصدر</span><select value={endpointForm.sourceCode} onChange={(event) => {
                const row = data.endpoints.find((item: any) => item.source_code === event.target.value);
                setEndpointForm(row ? {
                  sourceCode: row.source_code, displayName: row.display_name,
                  sendUrl: row.send_url || "",
                  templatesSyncUrl: row.templates_sync_url || "",
                  inboundWebhookUrl: row.inbound_webhook_url || "",
                  healthUrl: row.health_url || "", secretName: row.secret_name || "", isActive: row.is_active,
                } : { ...blankEndpoint, sourceCode: event.target.value, displayName: data.sources.find((item: any) => item.code === event.target.value)?.name || "" });
              }}><option value="">اختار المصدر</option>{endpointSources.map((row) => <option key={row.code} value={row.code}>{row.name}</option>)}</select></label>
              <label><span>الاسم الظاهر</span><input value={endpointForm.displayName} onChange={(event) => setEndpointForm((current) => ({ ...current, displayName: event.target.value }))} /></label>
              <label className="crm-field-wide"><span>مسار الإرسال الموحد</span><input placeholder="https://worker.example.com/send/mersal" value={endpointForm.sendUrl} onChange={(event) => setEndpointForm((current) => ({ ...current, sendUrl: event.target.value }))} /></label>
              <div className="crm-field-wide crm-system-field-note">النص الحر والقوالب والصور والصوت والفيديو والملفات تستخدم مسار واتساب الواحد <b>/send/mersal</b>.</div>
              <label className="crm-field-wide"><span>مسار مزامنة القوالب</span><input placeholder="https://worker.example.com/templates/mersal" value={endpointForm.templatesSyncUrl} onChange={(event) => setEndpointForm((current) => ({ ...current, templatesSyncUrl: event.target.value }))} /></label>
              <label className="crm-field-wide"><span>مسار استقبال الـ Webhook</span><input placeholder="https://worker.example.com/webhook/mersal" value={endpointForm.inboundWebhookUrl} onChange={(event) => setEndpointForm((current) => ({ ...current, inboundWebhookUrl: event.target.value }))} /></label>
              <label className="crm-field-wide"><span>Health URL</span><input value={endpointForm.healthUrl} onChange={(event) => setEndpointForm((current) => ({ ...current, healthUrl: event.target.value }))} /></label>
              <label className="crm-field-wide"><span>اسم متغير السر في Vercel</span><input placeholder="MZJ_GATEWAY_SECRET" value={endpointForm.secretName} onChange={(event) => setEndpointForm((current) => ({ ...current, secretName: event.target.value }))} /></label>
              <label className="crm-switch-row"><input type="checkbox" checked={endpointForm.isActive} onChange={(event) => setEndpointForm((current) => ({ ...current, isActive: event.target.checked }))} /><span>المسارات نشطة</span></label>
            </div>
            <button className="crm-primary-button" onClick={() => void save("endpoint", endpointForm)}><FloppyDisk size={18} />حفظ إعدادات المنصة</button>
          </section>
          <section className="crm-panel crm-list-panel">
            <header><h2>المنصات المسجلة</h2><span>{data.endpoints.length}</span></header>
            <div className="crm-endpoint-list">{data.endpoints.map((row: any) => <button key={row.source_code} onClick={() => setEndpointForm({
              sourceCode: row.source_code, displayName: row.display_name,
              sendUrl: row.send_url || "",
              templatesSyncUrl: row.templates_sync_url || "", inboundWebhookUrl: row.inbound_webhook_url || "",
              healthUrl: row.health_url || "", secretName: row.secret_name || "", isActive: row.is_active,
            })}><strong>{sourceLabel(row.source_code, row.display_name)}</strong><span>{row.send_url || "لم يتم إضافة مسار إرسال"}</span></button>)}</div>
          </section>
        </div>
      ) : null}

      {tab === "branches" ? (
        <div className="crm-admin-split"><section className="crm-panel crm-form-panel"><header><h2>{branchForm.code ? "تعديل فرع" : "إضافة فرع"}</h2></header><div className="crm-form-grid"><label><span>كود الفرع</span><input value={branchForm.code} onChange={(event) => setBranchForm((current) => ({ ...current, code: event.target.value }))} /></label><label><span>اسم الفرع</span><input value={branchForm.name} onChange={(event) => setBranchForm((current) => ({ ...current, name: event.target.value }))} /></label><label><span>الترتيب</span><input type="number" value={branchForm.sortOrder} onChange={(event) => setBranchForm((current) => ({ ...current, sortOrder: Number(event.target.value) }))} /></label><label className="crm-switch-row"><input type="checkbox" checked={branchForm.isActive} onChange={(event) => setBranchForm((current) => ({ ...current, isActive: event.target.checked }))} /><span>نشط</span></label></div><div className="crm-form-actions"><button className="crm-secondary-button" onClick={() => setBranchForm(blankBranch)}>جديد</button><button className="crm-primary-button" onClick={async () => { if (await save("branch", branchForm)) setBranchForm(blankBranch); }}><FloppyDisk size={18} />حفظ الفرع</button></div></section><section className="crm-panel crm-list-panel"><header><h2>الفروع المسجلة</h2></header><div className="crm-table-shell compact"><table className="crm-table"><thead><tr><th>اسم الفرع</th><th>الكود</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>{data.branches.map((row: any) => <tr key={row.code}><td>{row.name}</td><td>{row.code}</td><td>{row.is_active ? "نشط" : "غير نشط"}</td><td><div className="crm-row-actions"><button onClick={() => setBranchForm({ code: row.code, name: row.name, sortOrder: row.sort_order, isActive: row.is_active })}><PencilSimple size={16} /></button><button onClick={() => void remove("branch", "", { code: row.code })}><Trash size={16} /></button></div></td></tr>)}</tbody></table></div></section></div>
      ) : null}

      {tab === "distribution" ? (
        <div className="crm-distribution-settings crm-distribution-professional">
          <section className="crm-distribution-summary">
            <article><Shuffle size={24} weight="duotone" /><span>القواعد النشطة</span><strong>{distributionSummary.activeRules}</strong></article>
            <article><UsersThree size={24} weight="duotone" /><span>الموظفون المتاحون</span><strong>{distributionSummary.eligibleUsers}</strong></article>
            <article><CheckCircle size={24} weight="duotone" /><span>آخر عمليات مسجلة</span><strong>{distributionSummary.loggedAssignments}</strong></article>
          </section>

          <section className="crm-panel crm-form-panel crm-distribution-editor">
            <header><div><h2>{ruleForm.id ? "تعديل قاعدة توزيع" : "إنشاء قاعدة توزيع"}</h2><p>حدد نطاق القاعدة ثم اختر الموظفين ورتبهم حسب أولوية الدور في التوزيع.</p></div></header>

            <div className="crm-distribution-section">
              <div className="crm-distribution-section-title"><span>1</span><div><strong>بيانات القاعدة</strong><small>القسم والفرع والمصدر وطريقة التشغيل.</small></div></div>
              <div className="crm-form-grid crm-form-grid-wide">
                <label><span>اسم القاعدة</span><input placeholder="مثال: تمويل الأونلاين" value={ruleForm.name} onChange={(event) => setRuleForm((current) => ({ ...current, name: event.target.value }))} /></label>
                <label><span>القسم</span><select value={ruleForm.departmentCode} onChange={(event) => setRuleForm((current) => ({ ...current, departmentCode: event.target.value, memberIds: [] }))}><option value="cash_sales">مبيعات الكاش</option><option value="finance_sales">مبيعات التمويل</option><option value="customer_service">خدمة العملاء</option><option value="call_center">الكول سنتر</option></select></label>
                <label><span>الفرع</span><select value={ruleForm.branchCode} onChange={(event) => setRuleForm((current) => ({ ...current, branchCode: event.target.value, memberIds: [] }))}><option value="">كل الفروع</option>{data.branches.filter((row: any) => row.is_active).map((row: any) => <option key={row.code} value={row.code}>{row.name}</option>)}</select></label>
                <label><span>ترتيب القاعدة</span><input type="number" value={ruleForm.sortOrder} onChange={(event) => setRuleForm((current) => ({ ...current, sortOrder: Number(event.target.value) }))} /></label>
                <label className="crm-switch-row"><input type="checkbox" checked={ruleForm.preventConsecutive} onChange={(event) => setRuleForm((current) => ({ ...current, preventConsecutive: event.target.checked }))} /><span>منع تكرار نفس المندوب</span></label>
                <label className="crm-switch-row"><input type="checkbox" checked={ruleForm.isActive} onChange={(event) => setRuleForm((current) => ({ ...current, isActive: event.target.checked }))} /><span>القاعدة نشطة</span></label>
              </div>
            </div>

            <div className="crm-distribution-section">
              <div className="crm-distribution-section-title"><span>2</span><div><strong>المصادر المشمولة</strong><small>عدم اختيار مصدر يعني تطبيق القاعدة على كل المصادر.</small></div></div>
              <div className="crm-check-grid crm-distribution-source-grid">{data.sources.filter((row: any) => row.is_active).map((row: any) => <label key={row.code}><input type="checkbox" checked={ruleForm.sourceCodes.includes(row.code)} onChange={() => setRuleForm((current) => ({ ...current, sourceCodes: toggleList(current.sourceCodes, row.code) }))} />{row.name}</label>)}</div>
            </div>

            <div className="crm-distribution-section">
              <div className="crm-distribution-section-title"><span>3</span><div><strong>الموظفون وترتيب الدور</strong><small>يظهر فقط الموظفون النشطون والمسموح لهم باستقبال العملاء والمربوطون بالقسم والفرع.</small></div></div>
              <div className="crm-distribution-members-layout">
                <div className="crm-distribution-available">
                  <header><strong>الموظفون المؤهلون</strong><span>{eligibleRuleUsers.length}</span></header>
                  <div className="crm-member-picker">{eligibleRuleUsers.map((row: any) => <label key={row.id} className={ruleForm.memberIds.includes(row.id) ? "selected" : ""}><input type="checkbox" checked={ruleForm.memberIds.includes(row.id)} onChange={() => setRuleForm((current) => ({ ...current, memberIds: toggleList(current.memberIds, row.id) }))} /><span><strong>{row.full_name}</strong><small>{(row.branches || []).join("، ") || "كل الفروع"}</small></span></label>)}</div>
                  {!eligibleRuleUsers.length ? <div className="crm-empty-state">لا يوجد موظفون مؤهلون لهذه القاعدة. فعّل استقبال العملاء واربط المستخدم بالقسم والفرع.</div> : null}
                </div>
                <div className="crm-distribution-order">
                  <header><strong>ترتيب التوزيع</strong><span>{selectedRuleUsers.length}</span></header>
                  <div className="crm-distribution-order-list">{selectedRuleUsers.map((row: any, index: number) => <article key={row.id}><b>{index + 1}</b><div><strong>{row.full_name}</strong><small>{(row.branches || []).join("، ") || "كل الفروع"}</small></div><nav><button type="button" disabled={index === 0} onClick={() => setRuleForm((current) => ({ ...current, memberIds: moveListItem(current.memberIds, row.id, -1) }))}><CaretUp size={15} /></button><button type="button" disabled={index === selectedRuleUsers.length - 1} onClick={() => setRuleForm((current) => ({ ...current, memberIds: moveListItem(current.memberIds, row.id, 1) }))}><CaretDown size={15} /></button><button type="button" onClick={() => setRuleForm((current) => ({ ...current, memberIds: current.memberIds.filter((id) => id !== row.id) }))}><Trash size={15} /></button></nav></article>)}</div>
                  {!selectedRuleUsers.length ? <div className="crm-empty-state">اختر الموظفين من القائمة ليظهر ترتيب التوزيع هنا.</div> : null}
                </div>
              </div>
            </div>

            <div className="crm-distribution-preview">
              <span><small>القسم</small><strong>{departmentLabel(ruleForm.departmentCode)}</strong></span>
              <span><small>الفرع</small><strong>{data.branches.find((row: any) => row.code === ruleForm.branchCode)?.name || "كل الفروع"}</strong></span>
              <span><small>المصادر</small><strong>{ruleForm.sourceCodes.length || "الكل"}</strong></span>
              <span><small>الموظفون</small><strong>{ruleForm.memberIds.length}</strong></span>
              <span><small>أول دور</small><strong>{selectedRuleUsers[0]?.full_name || "—"}</strong></span>
            </div>

            <div className="crm-form-actions"><button className="crm-secondary-button" onClick={() => setRuleForm(blankRule)}><Plus size={18} />قاعدة جديدة</button><button className="crm-primary-button" onClick={async () => { if (await save("assignment_rule", ruleForm)) setRuleForm(blankRule); }}><FloppyDisk size={18} />حفظ قاعدة التوزيع</button></div>
          </section>

          <section className="crm-panel crm-list-panel crm-distribution-rules-panel">
            <header><h2>قواعد التوزيع</h2><span>{data.assignmentRules.length}</span></header>
            <div className="crm-rule-list">{data.assignmentRules.map((row: any) => <article key={row.id} className={!row.is_active ? "inactive" : ""}><header><div><strong>{row.name}</strong><span>{departmentLabel(row.department_code)} · {row.branch_name || "كل الفروع"}</span></div><b>{row.is_active ? "نشطة" : "موقوفة"}</b></header><div className="crm-rule-stats"><span><small>الموظفون</small><strong>{(row.members || []).filter((member: any) => member.is_active).length}</strong></span><span><small>آخر توزيع</small><strong>{row.last_user_name || "لا يوجد"}</strong></span><span><small>التالي</small><strong>{row.next_user_name || "لا يوجد"}</strong></span></div><p>المصادر: {(row.source_codes || []).length ? row.source_codes.map((code: string) => data.sources.find((source: any) => source.code === code)?.name || code).join("، ") : "كل المصادر"}</p><div className="crm-rule-members">{(row.members || []).map((member: any, index: number) => <span key={member.user_id}><i>{index + 1}</i>{member.full_name}<b>{member.assignment_count || 0}</b></span>)}</div><footer><button onClick={() => editRule(row)}><PencilSimple size={16} />تعديل</button><button onClick={() => void remove("assignment_rule", row.id)}><Trash size={16} />إيقاف</button></footer></article>)}</div>
          </section>

          <section className="crm-panel crm-list-panel crm-assignment-log-panel"><header><h2>سجل التوزيع</h2><span>آخر 100 عملية</span></header><div className="crm-table-shell"><table className="crm-table"><thead><tr><th>التاريخ</th><th>القاعدة</th><th>القسم</th><th>الفرع</th><th>المصدر</th><th>المندوب</th><th>العملية</th></tr></thead><tbody>{data.assignmentLogs.map((row: any) => <tr key={row.id}><td>{formatDate(row.created_at)}</td><td>{row.rule_name || "التوزيع الافتراضي"}</td><td>{departmentLabel(row.department_code)}</td><td>{data.branches.find((branch: any) => branch.code === row.branch_code)?.name || row.branch_code || "—"}</td><td>{data.sources.find((source: any) => source.code === row.source_code)?.name || sourceLabel(row.source_code)}</td><td>{row.assigned_name || "غير موزع"}</td><td>{row.action === "automatic_assignment" ? "توزيع تلقائي" : row.action}</td></tr>)}</tbody></table></div></section>
        </div>
      ) : null}
    </div>
  );
}
