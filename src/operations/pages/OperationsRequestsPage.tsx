import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle, Eye, Plus, Trash, WarningCircle, XCircle } from "@phosphor-icons/react";
import { formatOperationsDate, operationsFetch, operationsQuery } from "../api";
import { OperationsModal } from "../components/OperationsModal";
import { VehiclePicker } from "../components/VehiclePicker";
import type { OperationsVehicle } from "../types";
import { useOperationsMeta } from "../useOperationsMeta";

type RequestRow = {
  id: string; request_no: string; request_type: string; source_branch_code: string | null; destination_branch_code: string | null;
  source_location: string | null; destination_location: string | null; status: string; photography_date: string | null; notes: string | null;
  requested_by_name: string | null; requested_at: string; updated_at: string; vehicles_count: number; vins: string | null;
};
type RequestDetail = RequestRow & {
  requested_by: string; version: number;
  vehicles: Array<{ id: string; vin: string; car_name: string | null; statement: string | null; current_location: string | null; status_name: string | null }>;
  events: Array<{ id: string; stage_code: string; action: string; actor_name: string; actor_branch: string | null; note: string | null; is_override: boolean; override_reason: string | null; created_at: string }>;
};

const stageLabels: Record<string, string> = {
  created: "تم إنشاء الطلب", request_received: "تم استلام الطلب", vehicle_sent: "تم إرسال السيارة",
  vehicle_received: "تم استلام السيارة", completed: "تم الانتهاء", cancelled: "ملغي",
};
const nextStage: Record<string, string | undefined> = {
  created: "request_received", request_received: "vehicle_sent", vehicle_sent: "vehicle_received", vehicle_received: "completed",
};
const tabs = [
  ["active", "الجارية"], ["outgoing", "الصادرة من فرعي"], ["incoming", "الواردة إلى فرعي"],
  ["completed", "المكتملة"], ["cancelled", "الملغاة"], ["all", "جميع الطلبات"],
] as const;

export function OperationsRequestsPage() {
  const { meta, error: metaError } = useOperationsMeta();
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [tab, setTab] = useState("active");
  const [search, setSearch] = useState("");
  const [requestType, setRequestType] = useState("");
  const [selected, setSelected] = useState<RequestDetail | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [vehicles, setVehicles] = useState<OperationsVehicle[]>([]);
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [createType, setCreateType] = useState<"transfer" | "photo">("transfer");
  const [photographyDate, setPhotographyDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const payload = await operationsFetch<{ ok: true; requests: RequestRow[] }>(`/api/operations/requests${operationsQuery({ tab, search, requestType })}`);
      setRows(payload.requests);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر تحميل الطلبات"); }
  }, [tab, search, requestType]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer); }, [load]);

  async function openDetail(id: string) {
    try {
      const payload = await operationsFetch<{ ok: true; request: RequestDetail }>(`/api/operations/requests?id=${id}`);
      setSelected(payload.request);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر فتح الطلب"); }
  }

  async function createRequest(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const payload = await operationsFetch<{ ok: true; request: RequestDetail; message: string }>("/api/operations/requests", {
        method: "POST",
        body: JSON.stringify({ action: "create", requestType: createType, vehicleIds: vehicles.map((vehicle) => vehicle.id), destinationLocationId, photographyDate, notes }),
      });
      setMessage(payload.message); setCreateOpen(false); setVehicles([]); setDestinationLocationId(""); setPhotographyDate(""); setNotes(""); setSelected(payload.request); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر إنشاء الطلب"); }
    finally { setSaving(false); }
  }

  async function requestAction(action: string, extra: Record<string, unknown> = {}) {
    if (!selected) return;
    setSaving(true); setError("");
    try {
      const payload = await operationsFetch<{ ok: true; request?: RequestDetail; message: string }>("/api/operations/requests", {
        method: "POST", body: JSON.stringify({ action, id: selected.id, ...extra }),
      });
      setMessage(payload.message);
      if (payload.request) setSelected(payload.request); else setSelected(null);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر تنفيذ الإجراء"); }
    finally { setSaving(false); }
  }

  async function advance() {
    if (!selected) return;
    const stage = selected.request_type === "photo" && selected.status === "request_received" ? "completed" : nextStage[selected.status];
    if (!stage) return;
    const note = window.prompt(`ملاحظة مرحلة: ${stageLabels[stage]}`) || "";
    await requestAction("advance", { stage, note });
  }

  const destinationOptions = useMemo(() => meta?.locations.filter((item) => !vehicles.length || item.id !== vehicles[0].location_id) || [], [meta, vehicles]);

  return (
    <div className="module-page operations-page">
      <header className="module-page-head"><div><h1>طلبات النقل والتصوير</h1><p>طلبات مستقلة بمراحل مرتبة وصلاحيات الفرع المصدر والفرع المستهدف.</p></div><button type="button" className="operations-primary" onClick={() => setCreateOpen(true)}><Plus size={18} />إنشاء طلب</button></header>
      {metaError || error ? <div className="connection-banner"><WarningCircle size={20} weight="fill" /><span>{metaError || error}</span></div> : null}
      {message ? <div className="success-banner"><CheckCircle size={19} weight="fill" /><span>{message}</span></div> : null}
      <section className="panel operations-filter-panel">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="رقم الطلب أو VIN أو منشئ الطلب" />
        <select value={requestType} onChange={(event) => setRequestType(event.target.value)}><option value="">كل الأنواع</option><option value="transfer">طلبات النقل</option><option value="photo">طلبات التصوير</option></select>
      </section>
      <nav className="operations-tabs">{tabs.map(([key, label]) => <button key={key} type="button" className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</nav>
      <section className="panel operations-table-panel">
        <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>رقم الطلب</th><th>النوع</th><th>من</th><th>إلى</th><th>السيارات</th><th>الحالة</th><th>منشئ الطلب</th><th>التاريخ</th><th></th></tr></thead><tbody>
          {rows.length === 0 ? <tr><td colSpan={9} className="table-empty">لا توجد طلبات مطابقة</td></tr> : rows.map((row) => <tr key={row.id}>
            <td><strong>{row.request_no}</strong></td><td>{row.request_type === "photo" ? "تصوير" : "نقل"}</td><td>{row.source_location || row.source_branch_code || "—"}</td><td>{row.destination_location || row.destination_branch_code || "—"}</td><td><span className="operations-badge neutral">{row.vehicles_count}</span><small className="operations-vins">{row.vins}</small></td><td><span className={`operations-badge ${row.status === "completed" ? "success" : row.status === "cancelled" ? "danger" : "pending"}`}>{stageLabels[row.status] || row.status}</span></td><td>{row.requested_by_name || "—"}</td><td>{formatOperationsDate(row.requested_at)}</td><td><button type="button" className="operations-icon-action" onClick={() => void openDetail(row.id)}><Eye size={17} />فتح</button></td>
          </tr>)}
        </tbody></table></div>
      </section>

      <OperationsModal open={createOpen} title="إنشاء طلب نقل أو تصوير" onClose={() => setCreateOpen(false)} wide>
        <form className="operations-form-card modal-form" onSubmit={createRequest}>
          <div className="operations-form-grid">
            <label><span>نوع الطلب</span><select value={createType} onChange={(event) => setCreateType(event.target.value as "transfer" | "photo")}><option value="transfer">طلب نقل</option><option value="photo">طلب تصوير</option></select></label>
            <label><span>المكان المستهدف</span><select required value={destinationLocationId} onChange={(event) => setDestinationLocationId(event.target.value)}><option value="">اختر المكان</option>{destinationOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            {createType === "photo" ? <label><span>تاريخ التصوير</span><input required type="date" value={photographyDate} onChange={(event) => setPhotographyDate(event.target.value)} /></label> : null}
            <label className="full"><span>ملاحظات الطلب</span><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          </div>
          <VehiclePicker selected={vehicles} onChange={setVehicles} multiple />
          <div className="operations-form-actions"><button type="submit" className="operations-primary" disabled={saving || !vehicles.length || !destinationLocationId}>{saving ? "جاري إنشاء الطلب..." : "إنشاء الطلب"}</button></div>
        </form>
      </OperationsModal>

      <OperationsModal open={Boolean(selected)} title={selected ? `الطلب ${selected.request_no}` : ""} onClose={() => setSelected(null)} wide>
        {selected ? <div className="operations-request-detail">
          <div className="operations-detail-grid">
            <div><small>النوع</small><strong>{selected.request_type === "photo" ? "طلب تصوير" : "طلب نقل"}</strong></div><div><small>الحالة</small><strong>{stageLabels[selected.status] || selected.status}</strong></div>
            <div><small>المصدر</small><strong>{selected.source_location || selected.source_branch_code || "—"}</strong></div><div><small>الوجهة</small><strong>{selected.destination_location || selected.destination_branch_code || "—"}</strong></div>
            <div><small>منشئ الطلب</small><strong>{selected.requested_by_name || "—"}</strong></div><div><small>تاريخ الطلب</small><strong>{formatOperationsDate(selected.requested_at)}</strong></div>
          </div>
          <h3>السيارات</h3><div className="operations-selected-vehicles">{selected.vehicles.map((vehicle) => <article key={vehicle.id}><div><strong>{vehicle.vin}</strong><span>{vehicle.car_name || "—"} · {vehicle.statement || "—"}</span></div><div><small>المكان</small><strong>{vehicle.current_location || "—"}</strong></div><div><small>الحالة</small><strong>{vehicle.status_name || "—"}</strong></div></article>)}</div>
          <h3>سجل المراحل</h3><div className="operations-timeline">{selected.events.map((event) => <article key={event.id}><span></span><div><strong>{stageLabels[event.stage_code] || event.stage_code}</strong><small>{event.actor_name} · {event.actor_branch || "—"} · {formatOperationsDate(event.created_at)}</small>{event.note ? <p>{event.note}</p> : null}{event.is_override ? <em>تجاوز إداري: {event.override_reason}</em> : null}</div></article>)}</div>
          <div className="operations-form-actions">
            {nextStage[selected.status] || (selected.request_type === "photo" && selected.status === "request_received") ? <button type="button" className="operations-primary" disabled={saving} onClick={() => void advance()}>{saving ? "جاري التنفيذ..." : `تنفيذ: ${stageLabels[selected.request_type === "photo" && selected.status === "request_received" ? "completed" : nextStage[selected.status] || ""]}`}</button> : null}
            {selected.status === "created" ? <button type="button" className="operations-danger" disabled={saving} onClick={() => { if (window.confirm("حذف الطلب قبل بدء التنفيذ؟")) void requestAction("delete"); }}><Trash size={17} />حذف الطلب</button> : null}
            {!["completed", "cancelled"].includes(selected.status) && selected.status !== "created" ? <button type="button" className="operations-danger" disabled={saving} onClick={() => { const reason = window.prompt("سبب إلغاء الطلب"); if (reason) void requestAction("cancel", { reason }); }}><XCircle size={17} />إلغاء الطلب</button> : null}
          </div>
        </div> : null}
      </OperationsModal>
    </div>
  );
}
