import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, Check, MagnifyingGlass, PencilSimple, PlusCircle, Trash, UsersThree, X } from "@phosphor-icons/react";
import { crmFetch, formatDate, queryString } from "../api";
import { sourceLabel } from "../sourceCatalog";
import type { CrmMeta } from "../types";

const initialForm = {
  customerName: "",
  phone: "",
  sourceCode: "branch",
  paymentType: "كاش",
  serviceKey: "cash",
  carName: "",
  location: "",
  branchCode: "",
  assignedTo: "",
  callCenterAssignedTo: "",
  notes: "",
};

export function CrmManualLeadsPage() {
  const [tab, setTab] = useState<"add" | "list">("add");
  const [meta, setMeta] = useState<CrmMeta | null>(null);
  const [form, setForm] = useState(initialForm);
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [approval, setApproval] = useState<any | null>(null);
  const [approvalAgent, setApprovalAgent] = useState("");

  useEffect(() => { void loadMeta(); }, []);
  useEffect(() => {
    if (tab !== "list") return;
    const timer = window.setTimeout(() => void loadRows(), 180);
    return () => window.clearTimeout(timer);
  }, [q, status, tab]);

  async function loadMeta() {
    try { setMeta(await crmFetch<CrmMeta>("/api/crm/meta")); }
    catch (error) { setNotice(error instanceof Error ? error.message : "تعذر تحميل البيانات"); }
  }

  async function loadRows() {
    try {
      const result = await crmFetch<{ ok: boolean; rows: any[] }>(`/api/crm/manual-leads${queryString({ q, status })}`);
      setRows(result.rows || []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل العملاء المسجلة");
    }
  }

  const targetDepartment = form.serviceKey === "finance" ? "finance_sales" : form.serviceKey === "service" ? "customer_service" : "cash_sales";
  const agents = useMemo(() => (meta?.users || []).filter((user) => user.department_codes.includes(targetDepartment)), [meta, targetDepartment]);
  const callCenters = useMemo(() => (meta?.users || []).filter((user) => user.department_codes.includes("call_center")), [meta]);
  const approvalAgents = useMemo(() => (meta?.users || []).filter((user) => user.department_codes.some((code) => ["cash_sales", "finance_sales", "customer_service"].includes(code))), [meta]);

  function set(key: string, next: string) {
    setForm((current) => ({ ...current, [key]: next }));
  }

  async function save() {
    setSaving(true);
    setNotice("");
    try {
      const result = await crmFetch<{ ok: boolean; duplicate?: any; approvalStatus: string }>("/api/crm/manual-leads", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setNotice(result.duplicate ? "رقم الجوال مسجل بالفعل وتم إرسال الطلب لموافقة الإدارة." : "تم حفظ العميل بنجاح.");
      setForm(initialForm);
      setTab("list");
      await loadRows();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "حدث خطأ أثناء حفظ العميل");
    } finally {
      setSaving(false);
    }
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
        <button className="crm-secondary-button" type="button" onClick={() => tab === "list" ? void loadRows() : setForm(initialForm)}>
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
          <header><h2>بيانات العميل</h2><span>العميل اليدوي يتم التواصل معه عن طريق واتساب بالقوالب فقط.</span></header>
          <div className="crm-form-grid crm-manual-form-grid">
            <label><span>اسم العميل</span><input value={form.customerName} onChange={(event) => set("customerName", event.target.value)} /></label>
            <label><span>رقم الجوال</span><input value={form.phone} onChange={(event) => set("phone", event.target.value)} placeholder="05xxxxxxxx" /></label>
            <label><span>المصدر</span><select value={form.sourceCode} onChange={(event) => set("sourceCode", event.target.value)}>{(meta?.sources || []).map((source) => <option key={source.code} value={source.code}>{sourceLabel(source.code, source.name)}</option>)}</select></label>
            <label><span>الدفع</span><select value={form.paymentType} onChange={(event) => { const payment = event.target.value; set("paymentType", payment); const serviceKey = payment === "تمويل" ? "finance" : payment === "خدمة عملاء" ? "service" : "cash"; set("serviceKey", serviceKey); set("branchCode", serviceKey === "finance" ? "online" : serviceKey === "service" ? "customer_service" : ""); }}><option>كاش</option><option>تمويل</option><option>خدمة عملاء</option></select></label>
            <label><span>السيارة</span><input value={form.carName} onChange={(event) => set("carName", event.target.value)} placeholder="اختياري" /></label>
            <label><span>المكان</span><input value={form.location} onChange={(event) => set("location", event.target.value)} /></label>
            <label><span>الفرع</span><select value={form.branchCode} onChange={(event) => set("branchCode", event.target.value)}><option value="">اختر الفرع</option>{(meta?.branches || []).map((branch) => <option key={branch.code} value={branch.code}>{branch.name}</option>)}</select></label>
            <label><span>المندوب المسؤول</span><select value={form.assignedTo} onChange={(event) => set("assignedTo", event.target.value)}><option value="">توزيع تلقائي</option>{agents.map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}</select></label>
            {form.serviceKey === "finance" ? <label><span>الكول سنتر</span><select value={form.callCenterAssignedTo} onChange={(event) => set("callCenterAssignedTo", event.target.value)}><option value="">توزيع تلقائي</option>{callCenters.map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}</select></label> : null}
            <label className="crm-field-wide"><span>ملاحظات</span><textarea rows={5} value={form.notes} onChange={(event) => set("notes", event.target.value)} /></label>
          </div>
          <div className="crm-form-actions">
            <button className="crm-secondary-button" onClick={() => setForm(initialForm)}>جديد</button>
            <button className="crm-primary-button" disabled={saving || !form.customerName || !form.phone} onClick={() => void save()}>{saving ? "جاري الحفظ..." : "حفظ العميل"}</button>
          </div>
        </section>
      ) : null}

      {tab === "list" ? (
        <section className="crm-panel crm-list-panel crm-manual-list-panel">
          <header><h2>العملاء المسجلة</h2><span>{rows.length.toLocaleString("ar-SA")} سجل</span></header>
          <div className="crm-toolbar compact">
            <label className="crm-search-box"><MagnifyingGlass size={17} /><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="بحث بالاسم أو الرقم" /></label>
            <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">كل الحالات</option><option value="pending">بانتظار موافقة الإدارة</option><option value="approved">تمت الموافقة</option><option value="rejected">مرفوض</option></select>
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
                    <td>{row.requested_assigned_name || "توزيع تلقائي"}</td>
                    <td>{row.requested_call_center_name || "—"}</td>
                    <td>{formatDate(row.updated_at)}</td>
                    <td><span className={`crm-status-pill ${row.approval_status}`}>{row.approval_status === "pending" ? "بانتظار موافقة الإدارة" : row.approval_status === "approved" ? "تمت الموافقة" : "مرفوض"}</span></td>
                    <td><div className="crm-row-actions">{row.approval_status === "pending" ? <button title="موافقة" onClick={() => { setApproval(row); setApprovalAgent(row.requested_assigned_to || ""); }}><Check size={16} /></button> : null}<button title="تعديل"><PencilSimple size={16} /></button><button title="مسح" onClick={() => void remove(row.id)}><Trash size={16} /></button></div></td>
                  </tr>
                ))}
                {!rows.length ? <tr><td colSpan={9}><div className="crm-empty-state">لا توجد سجلات</div></td></tr> : null}
              </tbody>
            </table>
          </div>
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
