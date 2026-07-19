import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArrowsClockwise, CaretLeft, CaretRight, CheckCircle, Eye, MagnifyingGlass, WarningCircle } from "@phosphor-icons/react";
import { useSearchParams } from "react-router-dom";
import { formatOperationsDate, operationsFetch, operationsQuery } from "../api";
import { OperationsModal } from "../components/OperationsModal";
import type { OperationsVehicle } from "../types";
import { useOperationsMeta } from "../useOperationsMeta";

function value(value: unknown) { return value === null || value === undefined || value === "" ? "—" : String(value); }
function approvalBadge(done?: boolean) { return <span className={`operations-badge ${done ? "success" : "pending"}`}>{done ? "تم" : "لم يتم"}</span>; }
function trackingBadge(vehicle: OperationsVehicle) {
  if (!vehicle.tracking_request_id || vehicle.tracking_deleted) return <span className="operations-badge neutral">لا يوجد طلب</span>;
  if (vehicle.tracking_status === "completed" && Number(vehicle.tracking_progress) === 100) return <span className="operations-badge success">مكتمل — 100%</span>;
  if (vehicle.tracking_archived) return <span className="operations-badge archive">مؤرشف — {vehicle.tracking_progress || 0}%</span>;
  return <span className="operations-badge info">{vehicle.tracking_status === "in_progress" ? "قيد التنفيذ" : "لم يبدأ"} — {vehicle.tracking_progress || 0}%</span>;
}

export function OperationsInventoryPage() {
  const { meta, error: metaError } = useOperationsMeta();
  const [searchParams, setSearchParams] = useSearchParams();
  const [vehicles, setVehicles] = useState<OperationsVehicle[]>([]);
  const [selected, setSelected] = useState<OperationsVehicle | null>(null);
  const [checks, setChecks] = useState<Array<any>>([]);
  const [filters, setFilters] = useState({ search: "", locationId: "", statusCode: "", modelYear: "", agentName: "", includeArchived: false });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const payload = await operationsFetch<{ ok: true; vehicles: OperationsVehicle[]; total: number }>(`/api/operations/vehicles${operationsQuery({ ...filters, page, limit: 30 })}`);
      setVehicles(payload.vehicles); setTotal(payload.total);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر تحميل السيارات"); }
    finally { setLoading(false); }
  }, [filters, page]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer); }, [load]);

  const openVehicle = useCallback(async (id: string) => {
    setError("");
    try {
      const payload = await operationsFetch<{ ok: true; vehicle: OperationsVehicle }>(`/api/operations/vehicles?id=${encodeURIComponent(id)}`);
      setSelected(payload.vehicle); setChecks(payload.vehicle.checks || []); setSearchParams((current) => { current.set("vehicle", id); return current; }, { replace: true });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر فتح بيانات السيارة"); }
  }, [setSearchParams]);

  useEffect(() => { const id = searchParams.get("vehicle"); if (id && selected?.id !== id) void openVehicle(id); }, [searchParams, selected?.id, openVehicle]);

  function closeVehicle() { setSelected(null); setSearchParams((current) => { current.delete("vehicle"); return current; }, { replace: true }); }

  async function saveChecks() {
    if (!selected) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const payload = await operationsFetch<{ ok: true; vehicle: OperationsVehicle; message: string }>("/api/operations/vehicles", { method: "POST", body: JSON.stringify({ action: "save_checks", id: selected.id, checks }) });
      setSelected(payload.vehicle); setChecks(payload.vehicle.checks || []); setMessage(payload.message);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر حفظ التشيك"); }
    finally { setSaving(false); }
  }

  async function archiveSelected() {
    if (!selected) return;
    const reason = window.prompt("اكتب سبب الأرشفة");
    if (!reason?.trim()) return;
    setSaving(true); setError("");
    try {
      const payload = await operationsFetch<{ ok: true; message: string }>("/api/operations/archive", { method: "POST", body: JSON.stringify({ vehicleId: selected.id, reason }) });
      setMessage(payload.message); closeVehicle(); await load();
    } catch (reasonValue) { setError(reasonValue instanceof Error ? reasonValue.message : "تعذر أرشفة السيارة"); }
    finally { setSaving(false); }
  }

  const pages = Math.max(1, Math.ceil(total / 30));
  const modelOptions = useMemo(() => Array.from(new Set(vehicles.map((item) => item.model_year).filter(Boolean))).sort().reverse(), [vehicles]);
  const agentOptions = useMemo(() => Array.from(new Set(vehicles.map((item) => item.agent_name).filter(Boolean))).sort(), [vehicles]);

  return (
    <div className="module-page operations-page">
      <header className="module-page-head"><div><h1>مخزون السيارات</h1><p>عرض المخزون والحالات والتشيك والموافقات وطلبات النقل والتراكينج من مصدر واحد.</p></div><button type="button" className="operations-refresh" onClick={() => void load()} disabled={loading}><ArrowsClockwise size={18} />تحديث</button></header>
      {metaError || error ? <div className="connection-banner"><WarningCircle size={20} weight="fill" /><span>{metaError || error}</span></div> : null}
      {message ? <div className="success-banner"><CheckCircle size={19} weight="fill" /><span>{message}</span></div> : null}

      <section className="panel operations-filter-panel">
        <label className="operations-search"><MagnifyingGlass size={19} /><input value={filters.search} onChange={(event) => { setFilters({ ...filters, search: event.target.value }); setPage(1); }} placeholder="بحث جزئي برقم الهيكل أو اسم السيارة أو اللوحة" /></label>
        <select value={filters.locationId} onChange={(event) => { setFilters({ ...filters, locationId: event.target.value }); setPage(1); }}><option value="">كل الأماكن</option>{meta?.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select value={filters.statusCode} onChange={(event) => { setFilters({ ...filters, statusCode: event.target.value }); setPage(1); }}><option value="">كل الحالات</option>{meta?.statuses.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
        <select value={filters.modelYear} onChange={(event) => { setFilters({ ...filters, modelYear: event.target.value }); setPage(1); }}><option value="">كل الموديلات</option>{modelOptions.map((item) => <option key={item!} value={item!}>{item}</option>)}</select>
        <select value={filters.agentName} onChange={(event) => { setFilters({ ...filters, agentName: event.target.value }); setPage(1); }}><option value="">كل الوكلاء</option>{agentOptions.map((item) => <option key={item!} value={item!}>{item}</option>)}</select>
        <label className="operations-inline-check"><input type="checkbox" checked={filters.includeArchived} onChange={(event) => setFilters({ ...filters, includeArchived: event.target.checked })} /><span>إظهار المؤرشف</span></label>
      </section>

      <section className="panel operations-table-panel">
        <div className="operations-table-summary"><strong>{loading ? "جاري التحميل..." : `${total.toLocaleString("ar-SA")} سيارة`}</strong><span>الصفحة {page} من {pages}</span></div>
        <div className="operations-table-wrap"><table className="operations-table inventory-table"><thead><tr>
          <th>الهيكل VIN</th><th>السيارة</th><th>البيان</th><th>الوكيل</th><th>اللون الداخلي</th><th>اللون الخارجي</th><th>الموديل</th><th>اللوحة</th><th>اسم الدفعة بالتاريخ</th><th>المكان</th><th>ملاحظات في السيارة</th><th>حجز - نواقص - تحديد مكان</th><th>الحالة</th><th>Tracking</th><th>الموافقات</th><th>التشيك</th><th>طلبات النقل</th><th>الأرشيف</th>
        </tr></thead><tbody>
          {!loading && vehicles.length === 0 ? <tr><td colSpan={18} className="table-empty">لا توجد سيارات مطابقة للفلاتر</td></tr> : vehicles.map((vehicle) => <tr key={vehicle.id} className={vehicle.is_archived ? "archived-row" : ""}>
            <td><button type="button" className="operations-link-button" onClick={() => void openVehicle(vehicle.id)}>{vehicle.vin}</button></td>
            <td>{value(vehicle.car_name)}</td><td>{value(vehicle.statement)}</td><td>{value(vehicle.agent_name)}</td><td>{value(vehicle.interior_color)}</td><td>{value(vehicle.exterior_color)}</td><td>{value(vehicle.model_year)}</td><td>{value(vehicle.plate_no)}</td><td>{value(vehicle.batch_no)}</td><td>{value(vehicle.location_name)}</td>
            <td className="operations-note-cell">{value(vehicle.notes)}</td><td className="operations-note-cell">{value(vehicle.reservation_shortage_location_note)}</td><td><span className={`operations-status status-${vehicle.status_code}`}>{vehicle.status_name || vehicle.status_code}</span></td>
            <td>{trackingBadge(vehicle)}</td><td><div className="operations-approval-pair">{approvalBadge(vehicle.financial_approved)}{approvalBadge(vehicle.administrative_approved)}</div></td>
            <td><button type="button" className="operations-icon-action" onClick={() => void openVehicle(vehicle.id)}><Eye size={17} />عرض</button></td><td>{Number(vehicle.active_requests || 0) ? <span className="operations-badge pending">{vehicle.active_requests} جارٍ</span> : <span className="operations-badge neutral">لا يوجد</span>}</td><td>{vehicle.is_archived ? <span className="operations-badge archive">مؤرشف</span> : <span className="operations-badge neutral">نشط</span>}</td>
          </tr>)}
        </tbody></table></div>
        <div className="operations-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}><CaretRight size={18} />السابق</button><span>{page} / {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>التالي<CaretLeft size={18} /></button></div>
      </section>

      <OperationsModal open={Boolean(selected)} title={selected ? `تفاصيل السيارة — ${selected.vin}` : "تفاصيل السيارة"} onClose={closeVehicle} wide>
        {selected ? <div className="operations-detail-stack">
          <section className="operations-detail-grid">
            {[['VIN',selected.vin],['السيارة',selected.car_name],['البيان',selected.statement],['الوكيل',selected.agent_name],['اللون الداخلي',selected.interior_color],['اللون الخارجي',selected.exterior_color],['الموديل',selected.model_year],['اللوحة',selected.plate_no],['الدفعة',selected.batch_no],['المكان الحالي',selected.location_name],['الحالة الحالية',selected.status_name],['ملاحظات السيارة',selected.notes],['ملاحظات الحالة',selected.status_note],['حجز - نواقص - تحديد مكان',selected.reservation_shortage_location_note],['تاريخ الإنشاء',formatOperationsDate(selected.created_at)],['آخر تعديل',formatOperationsDate(selected.updated_at)]].map(([label,text]) => <div key={String(label)}><span>{label}</span><strong>{value(text)}</strong></div>)}
          </section>
          <section className="operations-detail-section"><div className="operations-section-head"><h3>التشيك</h3><button type="button" onClick={() => void saveChecks()} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ التشيك"}</button></div><div className="operations-check-grid">{checks.map((item, index) => <article key={item.code}><strong>{item.name}</strong><select value={item.status} onChange={(event) => setChecks((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, status: event.target.value } : entry))}><option value="unknown">غير محدد</option><option value="available">موجود</option><option value="missing">ناقص</option><option value="damaged">تالف</option></select><input value={item.note || ""} onChange={(event) => setChecks((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, note: event.target.value } : entry))} placeholder="ملاحظة العنصر" /></article>)}</div></section>
          <section className="operations-detail-section"><h3>الموافقات</h3><div className="operations-approval-cards">{(selected.approvals || []).slice(0,1).map((approval) => <article key={approval.id}><p>الموافقة المالية: {approval.financial_approved ? "تمت" : "لم تتم"}</p><p>الموافقة الإدارية: {approval.administrative_approved ? "تمت" : "لم تتم"}</p><small>{formatOperationsDate(approval.updated_at)}</small></article>)}{!selected.approvals?.length ? <p className="tracking-empty-note">لا توجد دورة موافقات لهذه السيارة.</p> : null}</div></section>
          <section className="operations-detail-section"><h3>طلبات التراكينج</h3><div className="operations-history-list">{(selected.tracking || []).map((item) => <article key={item.tracking_vehicle_id}><strong>{item.request_no}</strong><span>{item.is_deleted ? "محذوف" : item.status} — {item.progress}%</span><small>{formatOperationsDate(item.updated_at)}</small>{!item.is_deleted && (meta?.isSystemAdmin || meta?.permissions.includes("operations.tracking.open")) ? <button type="button" className="operations-inline-action" onClick={() => window.open(`/tracking?request=${encodeURIComponent(item.tracking_request_id)}`, "_blank", "noopener,noreferrer")}>فتح طلب التراكينج</button> : null}</article>)}{!selected.tracking?.length ? <p className="tracking-empty-note">لا يوجد طلب تراكينج مرتبط.</p> : null}</div></section>
          <section className="operations-detail-section"><h3>سجل الحركات</h3><div className="operations-history-list">{(selected.movements || []).map((item) => <article key={item.id}><strong>{item.from_location || "—"} ← {item.to_location || "—"}</strong><span>{item.old_status || "—"} ← {item.new_status || "—"}</span><small>{item.performed_by_name || "—"} — {formatOperationsDate(item.created_at)}</small></article>)}{!selected.movements?.length ? <p className="tracking-empty-note">لا توجد حركات مسجلة.</p> : null}</div></section>
          <div className="operations-modal-footer"><button type="button" className="secondary" onClick={closeVehicle}>إغلاق</button>{!selected.is_archived ? <button type="button" className="danger" onClick={() => void archiveSelected()} disabled={saving}><Archive size={18} />أرشفة السيارة</button> : null}</div>
        </div> : null}
      </OperationsModal>
    </div>
  );
}
