import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle, MagnifyingGlass, Plus, Trash, Truck, WarningCircle } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { formatOperationsDate, operationsFetch, queryString } from "../api";
import type { TransferRow, VehicleRow } from "../types";
import { useOperations } from "../useOperations";

const stageLabels: Record<string, string> = { request_received: "تم استلام الطلب", vehicle_sent: "تم إرسال السيارة", vehicle_received: "تم استلام السيارة", completed: "تم الانتهاء" };
const nextStage: Record<string, string> = { request_received: "vehicle_sent", vehicle_sent: "vehicle_received", vehicle_received: "completed" };

export function TransferRequestsPage() {
  const { meta } = useOperations();
  const [tab, setTab] = useState<"create" | "active" | "completed">("create");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<VehicleRow[]>([]);
  const [selectedCars, setSelectedCars] = useState<VehicleRow[]>([]);
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [selected, setSelected] = useState<TransferRow | null>(null);
  const [confirmAction, setConfirmAction] = useState<"cancel" | "delete" | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      if (search.trim().length < 2) { setResults([]); return; }
      try { const payload = await operationsFetch<{ rows: VehicleRow[] }>(`/api/operations${queryString({ resource: "vehicles", search, pageSize: 20 })}`); setResults(payload.rows.filter((row) => !selectedCars.some((item) => item.id === row.id) && !row.active_transfer_requests)); }
      catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر البحث"); }
    }, 280);
    return () => window.clearTimeout(timer);
  }, [search, selectedCars]);

  async function loadRows() {
    setLoading(true); setError("");
    try { const payload = await operationsFetch<{ rows: TransferRow[] }>(`/api/operations${queryString({ resource: "transfers", kind: "transfer", completed: tab === "completed", pageSize: 200 })}`); setRows(payload.rows); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل طلبات النقل"); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (tab !== "create") void loadRows(); }, [tab]);

  async function create() {
    setLoading(true); setError(""); setMessage("");
    try {
      const payload = await operationsFetch<{ message: string }>("/api/operations", { method: "POST", body: JSON.stringify({ action: "create_transfer", vehicleIds: selectedCars.map((item) => item.id), destinationLocationId, note }) });
      setMessage(payload.message); setSelectedCars([]); setDestinationLocationId(""); setNote(""); setTab("active");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر إنشاء الطلب"); }
    finally { setLoading(false); }
  }

  async function stageAction(row: TransferRow, target = nextStage[row.status]) {
    if (!target) return;
    setLoading(true); setError(""); setMessage("");
    try { const payload = await operationsFetch<{ message: string }>("/api/operations", { method: "POST", body: JSON.stringify({ action: "transfer_action", id: row.id, transferAction: "advance", nextStatus: target }) }); setMessage(payload.message); setSelected(null); await loadRows(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحديث الطلب"); }
    finally { setLoading(false); }
  }

  async function destructiveAction() {
    if (!selected || !confirmAction) return;
    setLoading(true); setError("");
    try { const payload = await operationsFetch<{ message: string }>("/api/operations", { method: "POST", body: JSON.stringify({ action: "transfer_action", id: selected.id, transferAction: confirmAction, reason }) }); setMessage(payload.message); setConfirmAction(null); setSelected(null); setReason(""); await loadRows(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تنفيذ الإجراء"); }
    finally { setLoading(false); }
  }

  return (
    <div className="module-page operations-page">
      <header className="module-page-head"><div><h1>طلبات النقل</h1><p>إنشاء الطلب ومتابعة المراحل الأربع مع صلاحيات الفرع المصدر والمستهدف.</p></div></header>
      {error ? <div className="operations-alert error"><WarningCircle size={18} />{error}</div> : null}{message ? <div className="operations-alert success">{message}</div> : null}
      <div className="operations-subtabs"><button className={tab === "create" ? "active" : ""} onClick={() => setTab("create")}>إنشاء طلب</button><button className={tab === "active" ? "active" : ""} onClick={() => setTab("active")}>متابعة الطلبات</button><button className={tab === "completed" ? "active" : ""} onClick={() => setTab("completed")}>الطلبات المكتملة</button></div>

      {tab === "create" ? <section className="panel operations-transfer-create">
        <div className="operations-movement-toolbar"><div className="operations-vehicle-search"><label className="operations-search"><MagnifyingGlass size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث جزئي في VIN" /></label>{results.length ? <div className="operations-search-results floating">{results.map((row) => <button key={row.id} type="button" onClick={() => { setSelectedCars((current) => [...current, row]); setSearch(""); }}><Plus size={16} /><b>{row.vin}</b><span>{row.car_name || "—"} · {row.location_name}</span></button>)}</div> : null}</div><select value={destinationLocationId} onChange={(e) => setDestinationLocationId(e.target.value)}><option value="">المكان المستهدف</option>{meta.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="operations-transfer-cars">{selectedCars.length ? selectedCars.map((row) => <article key={row.id}><Truck size={20} /><div><b>{row.vin}</b><span>{row.car_name || "—"} · {row.statement || "—"}</span><small>{row.location_name} · {row.status_name}</small></div><button type="button" onClick={() => setSelectedCars((current) => current.filter((item) => item.id !== row.id))}><Trash size={17} /></button></article>) : <div className="operations-empty-state"><Truck size={42} weight="duotone" /><strong>اختر سيارة أو عدة سيارات</strong><span>لن تظهر السيارات المرتبطة بطلب نقل نشط.</span></div>}</div>
        <label className="operations-field"><span>ملاحظات الطلب</span><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <button className="operations-primary-button" type="button" disabled={loading || !selectedCars.length || !destinationLocationId || !meta.permissions.canCreateTransfer} onClick={() => void create()}>{loading ? "جاري الإنشاء..." : "إنشاء طلب النقل"}</button>
      </section> : (
        <section className="panel operations-requests-panel">
          <div className="operations-requests-list">{!loading && !rows.length ? <div className="operations-empty-state"><Truck size={42} /><strong>لا توجد طلبات</strong></div> : rows.map((row) => <article key={row.id} onClick={() => setSelected(row)}><div className="operations-request-icon"><Truck size={23} /></div><div className="operations-request-copy"><b>{row.request_no}</b><span>{row.source_location_name || "—"} <ArrowRight size={14} /> {row.destination_location_name || "—"}</span><small>{row.requested_by_name || "—"} · {formatOperationsDate(row.requested_at)}</small></div><span className={`operations-status status-${row.status}`}>{row.cancelled_at ? "ملغي" : stageLabels[row.status] || row.status}</span><strong>{row.vehicles_count}</strong></article>)}</div>
        </section>
      )}

      <Modal open={Boolean(selected)} title={selected?.request_no || "تفاصيل طلب النقل"} subtitle={selected ? `${selected.requested_by_name || "—"} · ${formatOperationsDate(selected.requested_at)}` : undefined} onClose={() => setSelected(null)} className="operations-request-detail-modal">
        {selected ? <><div className="operations-request-route"><span>{selected.source_location_name || "—"}</span><ArrowRight size={24} /><span>{selected.destination_location_name || "—"}</span></div><div className="operations-stage-strip">{Object.entries(stageLabels).map(([key,label]) => <span key={key} className={Object.keys(stageLabels).indexOf(key) <= Object.keys(stageLabels).indexOf(selected.status) ? "done" : ""}>{label}</span>)}</div><div className="operations-request-vehicle-list">{selected.vehicles.map((vehicle) => <div key={vehicle.vehicle_id}><b>{vehicle.vin}</b><span>{vehicle.car_name || "—"}</span><small>{vehicle.statement || "—"}</small></div>)}</div><div className="operations-detail-actions">{!selected.cancelled_at && nextStage[selected.status] ? <button type="button" className="primary" onClick={() => void stageAction(selected)} disabled={loading}><CheckCircle size={17} />{stageLabels[nextStage[selected.status]]}</button> : null}{!selected.cancelled_at && selected.status === "request_received" ? <button type="button" className="danger" onClick={() => setConfirmAction("delete")}><Trash size={17} />حذف قبل التنفيذ</button> : null}{!selected.cancelled_at && selected.status !== "completed" ? <button type="button" onClick={() => setConfirmAction("cancel")}>إلغاء الطلب</button> : null}</div></> : null}
      </Modal>
      <Modal open={Boolean(confirmAction)} title={confirmAction === "delete" ? "حذف طلب النقل" : "إلغاء طلب النقل"} onClose={() => setConfirmAction(null)} level={1} className="operations-confirm-modal" footer={<><button type="button" className="secondary" onClick={() => setConfirmAction(null)}>رجوع</button><button type="button" className="danger" disabled={loading || (confirmAction === "cancel" && !reason.trim())} onClick={() => void destructiveAction()}>{loading ? "جاري التنفيذ..." : "تأكيد"}</button></>}><div className="operations-confirm-warning danger"><WarningCircle size={24} /><p>{confirmAction === "delete" ? "يتم الحذف فقط قبل تنفيذ أي مرحلة، مع بقاء الحدث في سجل التدقيق." : "سيتم إيقاف المراحل الجديدة مع الحفاظ على كل الإجراءات السابقة."}</p></div><label className="operations-field"><span>السبب {confirmAction === "cancel" ? "— مطلوب" : ""}</span><textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} /></label></Modal>
    </div>
  );
}
