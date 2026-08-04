import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, Check, MagnifyingGlass, PencilSimple, PlusCircle, Trash, UsersThree, X } from "@phosphor-icons/react";
import { useAuth } from "../../auth/AuthContext";
import { useEscapeToClose } from "../../components/useEscapeToClose";
import { crmFetch, formatDate, queryString } from "../api";
import { sourceLabel } from "../sourceCatalog";
import type { CrmMeta } from "../types";

const initialForm = {
  customerName: "",
  phone: "",
  sourceCode: "branch",
  serviceKey: "",
  carName: "",
  carCategory: "",
  carModel: "",
  color: "",
  financeType: "",
  location: "",
  notes: "",
};

export function CrmManualLeadsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"add" | "list">("add");
  const [meta, setMeta] = useState<CrmMeta | null>(null);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 100;
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [approval, setApproval] = useState<any | null>(null);
  const [approvalAgent, setApprovalAgent] = useState("");

  useEscapeToClose(Boolean(approval), () => setApproval(null));

  useEffect(() => { void loadMeta(); }, []);
  useEffect(() => {
    if (tab !== "list") return;
    const timer = window.setTimeout(() => void loadRows(), 180);
    return () => window.clearTimeout(timer);
  }, [q, status, tab, page]);

  async function loadMeta() {
    try { setMeta(await crmFetch<CrmMeta>("/api/crm/meta")); }
    catch (error) { setNotice(error instanceof Error ? error.message : "تعذر تحميل البيانات"); }
  }

  async function loadRows() {
    try {
      const result = await crmFetch<{ ok: boolean; rows: any[]; total: number }>(`/api/crm/manual-leads${queryString({ q, status, page, pageSize })}`);
      setRows(result.rows || []);
      setTotal(Number(result.total || 0));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل العملاء المسجلة");
    }
  }

  const currentUserService = user?.departmentCodes.includes("finance_sales") ? "finance" : user?.departmentCodes.includes("customer_service") ? "service" : user?.departmentCodes.includes("cash_sales") ? "cash" : "";
  const activeServiceKey = editingId ? form.serviceKey : currentUserService;
  const approvalAgents = useMemo(() => (meta?.users || []).filter((user) => user.department_codes.some((code) => ["cash_sales", "finance_sales", "customer_service"].includes(code))), [meta]);

  function set(key: string, next: string) {
    setForm((current) => ({ ...current, [key]: next }));
  }

  async function save() {
    setSaving(true);
    setNotice("");
    try {
      const result = await crmFetch<{ ok: boolean; duplicate?: any; approvalStatus: string }>("/api/crm/manual-leads", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(editingId ? { ...form, id: editingId, action: "edit" } : form),
      });
      setNotice(editingId ? "تم تعديل بيانات العميل وتسجيل التغييرات." : result.duplicate ? "رقم الجوال مسجل بالفعل وتم إرسال الطلب لموافقة الإدارة." : "تم حفظ العميل بنجاح.");
      setForm(initialForm);
      setEditingId("");
      setTab("list");
      await loadRows();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "حدث خطأ أثناء حفظ العميل");
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setForm(initialForm);
    setEditingId("");
  }

  function editRow(row: any) {
    setEditingId(row.id);
    setForm({
      customerName: row.customer_name || "",
      phone: row.phone || "",
      sourceCode: row.source_code || "branch",
      serviceKey: row.service_key || (row.payment_type === "تمويل" ? "finance" : row.payment_type === "خدمة عملاء" ? "service" : "cash"),
      carName: row.car_name || "",
      carCategory: row.car_category || "",
      carModel: row.car_model || "",
      color: row.color || "",
      financeType: row.finance_type || "",
      location: row.location || "",
      notes: row.notes || "",
    });
    setTab("add");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function review(action: "approve" | "reject") {
    if (!approval) return;
    try {
      await crmFetch("/api/crm/manual-leads", {
        method: "PATCH",
        body: JSON.stringify({ id: approval.id, action, assignedTo: approvalAgent || undefined }),
      });
      setNotice(action === "approve" ? "تمت الموافقة وتحديث العميل الأصلي بدون تكرار." : "تم رفض الطلب.");
      setApproval(null);
      setApprovalAgent("");
      await loadRows();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "فشل اعتماد الطلب");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("متأكد من مسح هذا السجل؟")) return;
    try {
      await crmFetch("/api/crm/manual-leads", { method: "DELETE", body: JSON.stringify({ id }) });
      setRows((current) => current.filter((row) => row.id !== id));
      setNotice("تم مسح السجل.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر مسح السجل");
    }
  }

  return (
    <div className="crm-page crm-manual-leads-page">
      <header className="crm-page-head">
        <div><h1>إضافة العملاء</h1><p>تسجيل العميل يدويًا ومنع تكرار رقم الجوال، مع عرض الطلبات المسجلة داخل نفس الصفحة.</p></div>
        <button className="crm-secondary-button" type="button" onClick={() => tab === "list" ? void loadRows() : resetForm()}>
          <ArrowClockwise size={18} />{tab === "list" ? "تحديث" : "تفريغ الحقول"}
        </button>
      </header>

      <div className="crm-department-tabs crm-inner-page-tabs">
        <button className={tab === "add" ? "active" : ""} onClick={() => setTab("add")}><PlusCircle size={18} />إضافة عميل</button>
        <button className={tab === "list" ? "active" : ""} onClick={() => { setTab("list"); void loadRows(); }}><UsersThree size={18} />عرض العملاء المسجلة</button>
      </div>

      {notice ? <div className="crm-inline-notice">{notice}</div> : null}

      {tab === "add" ? (
        <section className="crm-panel crm-form-panel crm-manual-form-panel">
          <header><h2>{editingId ? "تعديل بيانات العميل" : "بيانات العميل"}</h2></header>
          <div className="crm-form-grid crm-manual-form-grid">
            <label><span>اسم العميل</span><input value={form.customerName} onChange={(event) => set("customerName", event.target.value)} /></label>
            <label><span>رقم الجوال</span><input value={form.phone} onChange={(event) => set("phone", event.target.value)} placeholder="05xxxxxxxx" /></label>
            <label><span>المصدر</span><select value={form.sourceCode} onChange={(event) => set("sourceCode", event.target.value)}>{(meta?.sources || []).map((source) => <option key={source.code} value={source.code}>{sourceLabel(source.code, source.name)}</option>)}</select></label>
            <label><span>السيارة</span><input value={form.carName} onChange={(event) => set("carName", event.target.value)} placeholder="اختياري" /></label>
            <label><span>الفئة</span><input value={form.carCategory} onChange={(event) => set("carCategory", event.target.value)} placeholder="اختياري" /></label>
            <label><span>الموديل</span><input value={form.carModel} onChange={(event) => set("carModel", event.target.value)} placeholder="اختياري" /></label>
            <label><span>اللون</span><input value={form.color} onChange={(event) => set("color", event.target.value)} placeholder="اختياري" /></label>
            {activeServiceKey === "finance" ? <label><span>نوع التمويل</span><input value={form.financeType} onChange={(event) => set("financeType", event.target.value)} placeholder="اختياري" /></label> : null}
            <label><span>المكان</span><input value={form.location} onChange={(event) => set("location", event.target.value)} /></label>
            <label className="crm-field-wide"><span>ملاحظات</span><textarea rows={5} value={form.notes} onChange={(event) => set("notes", event.target.value)} /></label>
          </div>
          <div className="crm-form-actions">
            <button className="crm-secondary-button" onClick={resetForm}>جديد</button>
            <button className="crm-primary-button" disabled={saving || !form.customerName || !form.phone} onClick={() => void save()}>{saving ? "جاري الحفظ..." : editingId ? "حفظ التعديلات" : "حفظ العميل"}</button>
          </div>
        </section>
      ) : null}

      {tab === "list" ? (
        <section className="crm-panel crm-list-panel crm-manual-list-panel">
          <header><h2>العملاء المسجلة</h2><span>{total.toLocaleString("ar-SA")} سجل</span></header>
          <div className="crm-toolbar compact">
            <label className="crm-search-box"><MagnifyingGlass size={17} /><input value={q} onChange={(event) => { setQ(event.target.value); setPage(1); }} placeholder="بحث بالاسم أو الرقم" /></label>
            <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">كل الحالات</option><option value="pending">بانتظار موافقة الإدارة</option><option value="approved">تمت الموافقة</option><option value="rejected">مرفوض</option></select>
          </div>
          <div className="crm-table-shell compact">
            <table className="crm-table">
              <thead><tr><th>العميل</th><th>الجوال</th><th>المصدر</th><th>الدفع</th><th>المندوب المسؤول</th><th>الكول سنتر</th><th>آخر تحديث</th><th>حالة الموافقة</th><th>إجراءات</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.customer_name}</td>
                    <td>{row.phone}</td>
                    <td>{sourceLabel(row.source_code, row.source_name)}</td>
                    <td>{row.payment_type || "—"}</td>
                    <td>{row.requested_assigned_name || row.requested_by_name || "—"}</td>
                    <td>{row.requested_call_center_name || "—"}</td>
                    <td>{formatDate(row.updated_at)}</td>
                    <td><span className={`crm-status-pill ${row.approval_status}`}>{row.approval_status === "pending" ? "بانتظار موافقة الإدارة" : row.approval_status === "approved" ? "تمت الموافقة" : "مرفوض"}</span></td>
                    <td><div className="crm-row-actions">{row.approval_status === "pending" ? <button title="موافقة" onClick={() => { setApproval(row); setApprovalAgent(row.requested_assigned_to || ""); }}><Check size={16} /></button> : null}<button title="تعديل" onClick={() => editRow(row)}><PencilSimple size={16} /></button><button title="مسح" onClick={() => void remove(row.id)}><Trash size={16} /></button></div></td>
                  </tr>
                ))}
                {!rows.length ? <tr><td colSpan={9}><div className="crm-empty-state">لا توجد سجلات</div></td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="crm-form-actions"><button className="crm-secondary-button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>السابق</button><span>صفحة {page} من {Math.max(1, Math.ceil(total / pageSize))}</span><button className="crm-secondary-button" disabled={page * pageSize >= total} onClick={() => setPage((current) => current + 1)}>التالي</button></div>
        </section>
      ) : null}

      {approval ? (
        <div className="crm-modal-backdrop" onMouseDown={() => setApproval(null)}>
          <div className="crm-modal-card small" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><h2>موافقة طلب العميل</h2><p>العميل الموجود: {approval.duplicate_customer_name || "غير محدد"}</p></div><button className="crm-icon-button" onClick={() => setApproval(null)}><X size={18} /></button></header>
            <label className="crm-form-label"><span>اختر المندوب الجديد</span><select value={approvalAgent} onChange={(event) => setApprovalAgent(event.target.value)}><option value="">بدون تغيير</option>{approvalAgents.map((user) => <option key={user.id} value={user.id}>{user.full_name} - {user.branches.join("، ") || "بدون فرع"}</option>)}</select></label>
            <div className="crm-modal-actions"><button className="crm-danger-button" onClick={() => void review("reject")}>رفض</button><button className="crm-primary-button" onClick={() => void review("approve")}>موافقة</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
