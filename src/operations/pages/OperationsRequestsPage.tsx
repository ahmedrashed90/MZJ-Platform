import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Camera,
  CheckCircle,
  ClipboardText,
  MagnifyingGlass,
  Plus,
  Truck,
  WarningCircle,
} from "@phosphor-icons/react";
import { useOperations } from "../OperationsContext";
import { formatOperationsDate, operationsFetch, operationsQuery, requestStageLabels, requestStatusLabel } from "../api";
import type { OperationsRequest, OperationsVehicle, RequestCounts } from "../types";
import { RequestDetailsDrawer } from "../components/RequestDetailsDrawer";
import { RequestFormModal } from "../components/RequestFormModal";

const emptyCounts: RequestCounts = { active: 0, not_started: 0, request_received: 0, vehicle_sent: 0, vehicle_received: 0, completed: 0 };

export function OperationsRequestsPage() {
  const { can } = useOperations();
  const [requests, setRequests] = useState<OperationsRequest[]>([]);
  const [vehicles, setVehicles] = useState<OperationsVehicle[]>([]);
  const [counts, setCounts] = useState<RequestCounts>(emptyCounts);
  const [completed, setCompleted] = useState(false);
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [requestPayload, vehiclePayload] = await Promise.all([
        operationsFetch<{ ok: boolean; requests: OperationsRequest[]; counts: RequestCounts }>(`/api/operations/requests${operationsQuery({ search, type, completed, limit: 1000 })}`),
        operationsFetch<{ ok: boolean; vehicles: OperationsVehicle[] }>("/api/operations/vehicles?archived=false&limit=2000"),
      ]);
      setRequests(requestPayload.requests || []);
      setCounts(requestPayload.counts || emptyCounts);
      setVehicles(vehiclePayload.vehicles || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل الطلبات");
    } finally {
      setLoading(false);
    }
  }, [completed, search, type]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  const summary = useMemo(() => [
    { label: "طلبات نشطة", value: counts.active, stage: -1 },
    { label: "لم تبدأ", value: counts.not_started, stage: 0 },
    { label: "تم استلام الطلب", value: counts.request_received, stage: 1 },
    { label: "تم إرسال السيارة", value: counts.vehicle_sent, stage: 2 },
    { label: "تم استلام السيارة", value: counts.vehicle_received, stage: 3 },
    { label: "طلبات مكتملة", value: counts.completed, stage: 4 },
  ], [counts]);

  function requestChanged(changed: OperationsRequest) {
    setRequests((current) => current.map((item) => item.id === changed.id ? { ...item, ...changed } : item));
    setMessage(changed.status === "completed" ? "تم إنهاء الطلب ونقله إلى الطلبات المكتملة" : "تم تحديث الطلب");
    void load();
  }

  return (
    <div className="module-page ops-page">
      <header className="module-page-head ops-page-head">
        <div><h1>طلبات النقل والتصوير</h1><p>إنشاء ومتابعة الطلبات عبر أربع مراحل مع سجل منفذ وتوقيت لكل مرحلة.</p></div>
        {can("operations.requests.create") ? <button type="button" className="ops-button primary" onClick={() => setFormOpen(true)}><Plus size={18} />إنشاء طلب</button> : null}
      </header>
      {error ? <div className="ops-error"><WarningCircle size={19} weight="fill" /><span>{error}</span></div> : null}
      {message ? <div className="ops-success"><CheckCircle size={19} weight="fill" /><span>{message}</span></div> : null}

      <section className="ops-request-summary">
        {summary.map((item) => <div key={item.label} className={item.stage === 4 ? "completed" : ""}><span>{item.label}</span><strong>{item.value.toLocaleString("ar-SA")}</strong></div>)}
      </section>

      <section className="panel ops-list-panel">
        <div className="ops-tabs-row">
          <button type="button" className={!completed ? "active" : ""} onClick={() => setCompleted(false)}><ClipboardText size={18} />الطلبات تحت الإجراء</button>
          <button type="button" className={completed ? "active" : ""} onClick={() => setCompleted(true)}><CheckCircle size={18} />الطلبات المكتملة</button>
        </div>
        <div className="ops-toolbar compact">
          <label className="ops-search"><MagnifyingGlass size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث برقم الطلب أو الهيكل أو منشئ الطلب..." /></label>
          <select value={type} onChange={(event) => setType(event.target.value)}><option value="">كل الأنواع</option><option value="transfer">نقل</option><option value="photo">تصوير</option></select>
        </div>
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead><tr><th>رقم الطلب</th><th>النوع</th><th>السيارات</th><th>الموقع المطلوب</th><th>المرحلة الحالية</th><th>منشئ الطلب</th><th>آخر تحديث</th></tr></thead>
            <tbody>
              {!loading && requests.length === 0 ? <tr><td colSpan={7} className="ops-table-empty">لا توجد طلبات مطابقة.</td></tr> : null}
              {requests.map((request) => (
                <tr key={request.id} className="ops-clickable-row" onClick={() => setSelectedId(request.id)}>
                  <td><strong>{request.request_no}</strong><small>{request.vins || "—"}</small></td>
                  <td><span className={`ops-request-type ${request.transfer_type}`}>{request.transfer_type === "photo" ? <Camera size={16} /> : <Truck size={16} />}{request.transfer_type === "photo" ? "تصوير" : "نقل"}</span></td>
                  <td>{Number(request.vehicles_count || 0).toLocaleString("ar-SA")}</td>
                  <td>{request.destination_location_name || "—"}</td>
                  <td><span className={`ops-request-status stage-${request.current_stage}`}>{requestStageLabels[request.current_stage] || requestStatusLabel(request.status)}</span></td>
                  <td>{request.requested_by_name || "—"}</td>
                  <td>{formatOperationsDate(request.updated_at || request.requested_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading ? <div className="ops-loading-row">جاري تحميل الطلبات...</div> : <div className="ops-list-footer">النتائج الظاهرة: {requests.length.toLocaleString("ar-SA")}</div>}
      </section>

      <RequestFormModal open={formOpen} vehicles={vehicles} onClose={() => setFormOpen(false)} onCreated={(request) => { setMessage("تم إنشاء الطلب"); setRequests((current) => [request, ...current]); setSelectedId(request.id); void load(); }} />
      <RequestDetailsDrawer requestId={selectedId} open={Boolean(selectedId)} onClose={() => setSelectedId(null)} onChanged={requestChanged} onDeleted={(id) => { setRequests((current) => current.filter((item) => item.id !== id)); setMessage("تم حذف الطلب"); void load(); }} />
    </div>
  );
}
