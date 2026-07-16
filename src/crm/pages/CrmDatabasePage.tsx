import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, Car, FilePdf, FileXls, MagnifyingGlass, PencilSimple, Trash, UsersThree, X } from "@phosphor-icons/react";
import { crmFetch, departmentLabel, downloadCsv, formatDate, queryString } from "../api";
import { LeadDrawer } from "../components/LeadDrawer";
import type { CrmLead, CrmMeta } from "../types";

const emptyFilters = { from: "", to: "", source: "", car: "", payment: "", campaign: "", status: "", department: "", branch: "", agent: "", callCenter: "", q: "" };

export function CrmDatabasePage() {
  const [meta, setMeta] = useState<CrmMeta | null>(null);
  const [filters, setFilters] = useState(emptyFilters);
  const [rows, setRows] = useState<CrmLead[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(50);
  const [selected, setSelected] = useState<CrmLead | null>(null);
  const [vehicle, setVehicle] = useState<CrmLead | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [transferOpen, setTransferOpen] = useState(false);
  const [newAgentId, setNewAgentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  useEffect(() => { void loadMeta(); }, []);
  useEffect(() => { const timer = window.setTimeout(() => void loadRows(), 220); return () => window.clearTimeout(timer); }, [filters, limit]);

  async function loadMeta() {
    try { setMeta(await crmFetch<CrmMeta>("/api/crm/meta")); } catch (error) { setNotice(error instanceof Error ? error.message : "تعذر تحميل الفلاتر"); }
  }

  async function loadRows() {
    setLoading(true);
    setNotice("");
    try {
      const result = await crmFetch<{ ok: boolean; rows: CrmLead[]; total: number }>(`/api/crm/leads${queryString({ ...filters, limit })}`);
      setRows(result.rows || []);
      setTotal(result.total || 0);
      setChecked((current) => new Set([...current].filter((id) => result.rows.some((row) => row.id === id))));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل قاعدة البيانات");
    } finally { setLoading(false); }
  }

  const cars = useMemo(() => [...new Set(rows.map((row) => row.car_name).filter(Boolean))] as string[], [rows]);
  const campaigns = useMemo(() => [...new Set(rows.map((row) => row.campaign_name).filter(Boolean))] as string[], [rows]);
  const allStatuses = useMemo(() => [...new Set((meta?.statuses || []).map((status) => status.value))], [meta]);
  const salesUsers = useMemo(() => (meta?.users || []).filter((user) => user.department_codes.some((code) => ["cash_sales", "finance_sales", "customer_service"].includes(code))), [meta]);
  const callCenterUsers = useMemo(() => (meta?.users || []).filter((user) => user.department_codes.includes("call_center")), [meta]);

  function setFilter(key: keyof typeof emptyFilters, value: string) { setFilters((current) => ({ ...current, [key]: value })); }
  function toggle(id: string) { setChecked((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }

  async function remove(row: CrmLead) {
    if (!window.confirm(`متأكد من حذف العميل ${row.customer_name || ""}؟`)) return;
    try {
      await crmFetch("/api/crm/leads", { method: "DELETE", body: JSON.stringify({ id: row.id }) });
      setRows((current) => current.filter((item) => item.id !== row.id));
      setTotal((current) => Math.max(0, current - 1));
      setNotice("تم حذف العميل وتحديث العداد");
    } catch (error) { setNotice(error instanceof Error ? error.message : "تعذر حذف العميل"); }
  }

  async function transfer() {
    if (!checked.size || !newAgentId) { setNotice("حدد العملاء والمندوب الجديد"); return; }
    try {
      const result = await crmFetch<{ ok: boolean; count: number }>("/api/crm/transfer", { method: "POST", body: JSON.stringify({ leadIds: [...checked], newAgentId }) });
      setNotice(`تم نقل ${result.count} عميل`);
      setTransferOpen(false); setChecked(new Set()); setNewAgentId(""); await loadRows();
    } catch (error) { setNotice(error instanceof Error ? error.message : "فشل نقل العملاء"); }
  }

  function exportRows() {
    downloadCsv("قاعدة-بيانات-CRM.csv", rows.map((row) => ({
      "اسم العميل": row.customer_name, "الجوال": row.phone || row.phone_normalized, "المكان": row.location,
      "الفرع": row.branch_name || row.branch_code, "المصدر": row.source_name, "اسم السيارة": row.car_name,
      "الدفع": row.payment_type, "الحالة": row.status_label, "القسم": departmentLabel(row.department_code),
      "المسؤول": row.assigned_name, "الكول سنتر": row.call_center_name, "اسم الحملة": row.campaign_name,
      "تاريخ التسجيل": formatDate(row.registered_at || row.created_at), "آخر تحديث": formatDate(row.updated_at),
    })));
  }

  function printRows() {
    const popup = window.open("", "_blank", "width=1200,height=800");
    if (!popup) return;
    popup.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>قاعدة البيانات</title><style>body{font-family:Tajawal,Arial;padding:20px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #ddd;padding:6px;text-align:right}th{background:#f5e8df}</style></head><body><h1>قاعدة البيانات</h1><p>عدد السجلات: ${rows.length}</p><table><thead><tr><th>اسم العميل</th><th>الجوال</th><th>الفرع</th><th>المصدر</th><th>السيارة</th><th>الحالة</th><th>القسم</th><th>المسؤول</th><th>الكول سنتر</th><th>آخر تحديث</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${row.customer_name || ""}</td><td>${row.phone || row.phone_normalized || ""}</td><td>${row.branch_name || row.branch_code || ""}</td><td>${row.source_name || ""}</td><td>${row.car_name || ""}</td><td>${row.status_label || ""}</td><td>${departmentLabel(row.department_code)}</td><td>${row.assigned_name || ""}</td><td>${row.call_center_name || ""}</td><td>${formatDate(row.updated_at)}</td></tr>`).join("")}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`);
    popup.document.close();
  }

  return (
    <div className="crm-page crm-database-page">
      <header className="crm-page-head"><div><h1>قاعدة البيانات</h1><p>عرض وتصفية وتعديل ونقل وتصدير عملاء CRM.</p></div><div className="crm-head-actions"><button className="crm-secondary-button" onClick={exportRows}><FileXls size={18} />تصدير Excel</button><button className="crm-secondary-button" onClick={printRows}><FilePdf size={18} />تصدير PDF</button><button className="crm-primary-button" onClick={() => setTransferOpen(true)} disabled={!checked.size}><UsersThree size={18} />نقل العملاء ({checked.size})</button></div></header>

      <div className="crm-filter-panel">
        <input type="date" title="التاريخ من" value={filters.from} onChange={(event) => setFilter("from", event.target.value)} />
        <input type="date" title="التاريخ إلى" value={filters.to} onChange={(event) => setFilter("to", event.target.value)} />
        <select value={filters.source} onChange={(event) => setFilter("source", event.target.value)}><option value="">كل المصادر</option>{(meta?.sources || []).map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
        <select value={filters.car} onChange={(event) => setFilter("car", event.target.value)}><option value="">كل السيارات</option>{cars.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <select value={filters.payment} onChange={(event) => setFilter("payment", event.target.value)}><option value="">كل طرق الدفع</option><option>كاش</option><option>تمويل</option><option>خدمة عملاء</option></select>
        <select value={filters.campaign} onChange={(event) => setFilter("campaign", event.target.value)}><option value="">كل الحملات</option>{campaigns.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <select value={filters.status} onChange={(event) => setFilter("status", event.target.value)}><option value="">كل الحالات</option>{allStatuses.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <select value={filters.department} onChange={(event) => setFilter("department", event.target.value)}><option value="">كل الأقسام</option><option value="cash_sales">مبيعات الكاش</option><option value="finance_sales">مبيعات التمويل</option><option value="customer_service">خدمة العملاء</option><option value="call_center">كول سنتر</option></select>
        <select value={filters.branch} onChange={(event) => setFilter("branch", event.target.value)}><option value="">كل الفروع مع الأقسام</option>{(meta?.branches || []).map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
        <select value={filters.agent} onChange={(event) => setFilter("agent", event.target.value)}><option value="">كل المناديب</option>{salesUsers.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select>
        <select value={filters.callCenter} onChange={(event) => setFilter("callCenter", event.target.value)}><option value="">كل مناديب الكول سنتر</option>{callCenterUsers.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select>
        <label className="crm-search-box wide"><MagnifyingGlass size={18} /><input value={filters.q} onChange={(event) => setFilter("q", event.target.value)} placeholder="بحث باسم العميل أو رقم الجوال / السيارة / المصدر" /></label>
        <button className="crm-icon-button" type="button" title="تحديث" onClick={() => void loadRows()}><ArrowClockwise size={19} /></button>
      </div>

      <div className="crm-database-summary"><span>إجمالي العملاء: <b>{total}</b></span><span>نتيجة الفلتر: <b>{total}</b></span><span>المعروض: <b>{rows.length}</b></span></div>
      {notice ? <div className="crm-inline-notice">{notice}</div> : null}

      <div className="crm-table-shell">
        <table className="crm-table">
          <thead><tr><th><input type="checkbox" checked={rows.length > 0 && rows.every((row) => checked.has(row.id))} onChange={(event) => setChecked(event.target.checked ? new Set(rows.map((row) => row.id)) : new Set())} /></th><th>إجراءات</th><th>اسم العميل</th><th>الجوال</th><th>المكان</th><th>الفرع</th><th>المصدر</th><th>اسم السيارة</th><th>الدفع</th><th>الحالة</th><th>القسم</th><th>المسؤول</th><th>الكول سنتر</th><th>اسم الحملة</th><th>تاريخ التسجيل</th><th>آخر تحديث</th></tr></thead>
          <tbody>
            {rows.map((row) => <tr key={row.id}><td><input type="checkbox" checked={checked.has(row.id)} onChange={() => toggle(row.id)} /></td><td><div className="crm-row-actions"><button title="تعديل" onClick={() => setSelected(row)}><PencilSimple size={16} /></button><button title="عرض السيارة" onClick={() => setVehicle(row)}><Car size={16} /></button><button title="حذف" onClick={() => void remove(row)}><Trash size={16} /></button></div></td><td>{row.customer_name || "—"}</td><td>{row.phone || row.phone_normalized || "—"}</td><td>{row.location || "—"}</td><td>{row.branch_name || row.branch_code || "—"}</td><td>{row.source_name || "—"}</td><td>{row.car_name || "—"}</td><td>{row.payment_type || "—"}</td><td><span className={`crm-status-pill ${String(row.status_label).includes("غير مؤهل") ? "danger" : ""}`}>{row.status_label || "عميل جديد"}</span></td><td>{departmentLabel(row.department_code)}</td><td>{row.assigned_name || "غير موزع"}</td><td>{row.call_center_name || "—"}</td><td>{row.campaign_name || "—"}</td><td>{formatDate(row.registered_at || row.created_at)}</td><td>{formatDate(row.updated_at)}</td></tr>)}
            {!loading && !rows.length ? <tr><td colSpan={16}><div className="crm-empty-state">لا توجد نتائج مطابقة</div></td></tr> : null}
            {loading ? <tr><td colSpan={16}><div className="crm-empty-state">جاري تحميل البيانات...</div></td></tr> : null}
          </tbody>
        </table>
      </div>
      {rows.length < total ? <button className="crm-secondary-button crm-load-more" onClick={() => setLimit((current) => current + 50)}>تحميل 50 عميل بعدهم</button> : null}

      <LeadDrawer lead={selected} meta={meta} onClose={() => setSelected(null)} onSaved={(updated) => { setRows((current) => current.map((row) => row.id === updated.id ? { ...row, ...updated } : row)); setSelected(null); }} />

      {vehicle ? <div className="crm-modal-backdrop" onMouseDown={() => setVehicle(null)}><div className="crm-modal-card small" onMouseDown={(event) => event.stopPropagation()}><header><h2>بيانات السيارة</h2><button className="crm-icon-button" onClick={() => setVehicle(null)}><X size={18} /></button></header><div className="crm-detail-list"><span><b>اسم السيارة</b>{vehicle.car_name || "—"}</span><span><b>الموديل</b>{vehicle.car_model || "—"}</span><span><b>نوع السيارة</b>{vehicle.car_type || "—"}</span><span><b>اللون</b>{vehicle.color || "—"}</span><span><b>ملاحظات السيارة</b>{vehicle.notes || "—"}</span></div></div></div> : null}

      {transferOpen ? <div className="crm-modal-backdrop" onMouseDown={() => setTransferOpen(false)}><div className="crm-modal-card" onMouseDown={(event) => event.stopPropagation()}><header><div><h2>نقل العملاء</h2><p>نقل ذكي بين كل الفروع والأقسام. القسم والفرع يتغيران تلقائيًا حسب المندوب الجديد.</p></div><button className="crm-icon-button" onClick={() => setTransferOpen(false)}><X size={18} /></button></header><div className="crm-transfer-summary"><span>عدد العملاء المحددين</span><strong>{checked.size}</strong></div><label className="crm-form-label"><span>إلى المندوب الجديد</span><select value={newAgentId} onChange={(event) => setNewAgentId(event.target.value)}><option value="">اختر مندوب من أي فرع وأي قسم</option>{salesUsers.map((user) => <option key={user.id} value={user.id}>{user.full_name} - {user.branches.join("، ") || "بدون فرع"} - {user.departments.join("، ")}</option>)}</select></label><div className="crm-modal-actions"><button className="crm-secondary-button" onClick={() => setTransferOpen(false)}>إلغاء</button><button className="crm-primary-button" disabled={!newAgentId || !checked.size} onClick={() => void transfer()}>تأكيد نقل العملاء المحددين وتحديث الفرع والقسم</button></div></div></div> : null}
    </div>
  );
}
