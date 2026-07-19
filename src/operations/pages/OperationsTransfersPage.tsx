import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MagnifyingGlass, Trash, WarningCircle, X } from "@phosphor-icons/react";
import { useAuth } from "../../auth/AuthContext";
import { formatOperationsError, operationsFetch } from "../api";
import type { TransferRow, VehicleRow } from "../types";
import { useOperationsMeta } from "../useOperationsMeta";

const labels: Record<string, string> = {
  request_received: "تم استلام الطلب",
  vehicle_sent: "تم إرسال السيارة",
  vehicle_received: "تم استلام السيارة",
  completed: "تم الانتهاء",
  cancelled: "ملغي",
};
const nextLabels: Record<string, string> = {
  request_received: "تنفيذ: تم إرسال السيارة",
  vehicle_sent: "تنفيذ: تم استلام السيارة",
  vehicle_received: "تنفيذ: تم الانتهاء",
};

type ConfirmAction = { request: TransferRow; type: "delete" | "cancel" } | null;

export function OperationsTransfersPage() {
  const { user } = useAuth();
  const { locations, error: metaError } = useOperationsMeta();
  const [tab, setTab] = useState<"create" | "active" | "completed">("create");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<VehicleRow[]>([]);
  const [selected, setSelected] = useState<VehicleRow[]>([]);
  const [destination, setDestination] = useState("");
  const [note, setNote] = useState("");
  const [requests, setRequests] = useState<TransferRow[]>([]);
  const [detail, setDetail] = useState<TransferRow | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [confirmReason, setConfirmReason] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const isAdmin = Boolean(user?.roleCodes.some(code => code === "admin" || code === "system_admin"));
  const canCancel = isAdmin || Boolean(user?.permissions?.includes("operations.transfer.cancel"));

  async function load() {
    setError("");
    try {
      const response = await operationsFetch<{ requests: TransferRow[] }>("transfers", { query: { tab: tab === "completed" ? "completed" : "active", type: "transfer" } });
      setRequests(response.requests || []);
    } catch (caught) {
      setError(formatOperationsError(caught));
      setRequests([]);
    }
  }

  useEffect(() => { if (tab !== "create") void load(); }, [tab]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (q.trim().length < 2) { setResults([]); return; }
      operationsFetch<{ rows: VehicleRow[] }>("vehicles", { query: { q, page: 1, limit: 20 } }).then(response => setResults(response.rows || [])).catch(caught => setError(formatOperationsError(caught)));
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      if (confirmAction) { setConfirmAction(null); setConfirmReason(""); }
      else if (detail) setDetail(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmAction, detail, busy]);

  function add(vehicle: VehicleRow) {
    if (!selected.some(item => item.id === vehicle.id)) setSelected(current => [...current, vehicle]);
    setQ("");
    setResults([]);
  }

  async function create() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await operationsFetch<{ request: { id: string; requestNo: string } }>("createTransfer", { method: "POST", body: { vehicleIds: selected.map(item => item.id), destinationLocationId: destination, note, transferType: "transfer" } });
      setMessage(`تم إنشاء الطلب ${response.request.requestNo}`);
      setSelected([]); setDestination(""); setNote(""); setTab("active");
    } catch (caught) { setError(formatOperationsError(caught)); }
    finally { setBusy(false); }
  }

  async function advance(request: TransferRow) {
    setBusy(true); setError(""); setMessage("");
    try {
      await operationsFetch("advanceTransfer", { method: "POST", body: { id: request.id } });
      setMessage(`تم تنفيذ المرحلة التالية للطلب ${request.request_no}`);
      await load();
    } catch (caught) { setError(formatOperationsError(caught)); }
    finally { setBusy(false); }
  }

  async function confirmRequestAction() {
    if (!confirmAction || !confirmReason.trim()) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await operationsFetch(confirmAction.type === "delete" ? "deleteTransfer" : "cancelTransfer", { method: "POST", body: { id: confirmAction.request.id, reason: confirmReason } });
      setMessage(confirmAction.type === "delete" ? `تم مسح الطلب ${confirmAction.request.request_no}` : `تم إلغاء الطلب ${confirmAction.request.request_no}`);
      setConfirmAction(null); setConfirmReason(""); setDetail(null);
      await load();
    } catch (caught) { setError(formatOperationsError(caught)); }
    finally { setBusy(false); }
  }

  return (
    <div className="operations-page">
      <header className="operations-page-head"><div><h1>طلبات النقل</h1><p>إنشاء طلب ومتابعة المراحل الأربع والطلبات المكتملة فقط.</p></div></header>
      {error || metaError ? <div className="operations-error">{error || metaError}</div> : null}
      {message ? <div className="operations-success">{message}</div> : null}
      <div className="operations-subtabs"><button className={tab === "create" ? "active" : ""} onClick={() => setTab("create")}>إنشاء طلب</button><button className={tab === "active" ? "active" : ""} onClick={() => setTab("active")}>متابعة الطلبات</button><button className={tab === "completed" ? "active" : ""} onClick={() => setTab("completed")}>الطلبات المكتملة</button></div>

      {tab === "create" ? (
        <section className="operations-card">
          <label className="search-field"><span>اختيار السيارات بالبحث الجزئي في VIN</span><div><MagnifyingGlass /><input value={q} onChange={event => setQ(event.target.value)} /></div>{results.length ? <div className="operations-suggestions">{results.map(vehicle => <button key={vehicle.id} type="button" onClick={() => add(vehicle)}><strong>{vehicle.vin}</strong><span>{vehicle.car_name || "—"} — {vehicle.statement || "—"} — {vehicle.location_name || "—"}</span></button>)}</div> : null}</label>
          <div className="transfer-selected">{selected.map(vehicle => <span key={vehicle.id}>{vehicle.vin}<button type="button" onClick={() => setSelected(current => current.filter(item => item.id !== vehicle.id))}><X /></button></span>)}</div>
          <label><span>المكان المستهدف</span><select value={destination} onChange={event => setDestination(event.target.value)}><option value="">اختر المكان</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
          <label><span>ملاحظات الطلب</span><textarea value={note} onChange={event => setNote(event.target.value)} /></label>
          <button className="operations-main-button" disabled={busy || !selected.length || !destination} onClick={() => void create()}>{busy ? "جاري الإنشاء..." : "إنشاء طلب النقل"}</button>
        </section>
      ) : (
        <section className="operations-card"><div className="request-list">{requests.length ? requests.map(request => {
          const owner = request.requested_by === user?.id;
          return <article key={request.id}><div><strong>{request.request_no}</strong><span>{request.source_location || "—"} ← {request.destination_location || "—"}</span><small>{request.requested_by_name || "—"} — {new Date(request.requested_at).toLocaleString("ar-SA")} — {labels[request.status] || request.status}</small></div><div><button onClick={() => setDetail(request)}>تفاصيل</button>{tab === "active" && nextLabels[request.status] ? <button className="primary" disabled={busy} onClick={() => void advance(request)}>{nextLabels[request.status]}</button> : null}{tab === "active" && request.status === "request_received" && (owner || canCancel) ? <button className="danger" disabled={busy} onClick={() => { setConfirmAction({ request, type: "delete" }); setConfirmReason(""); }}>مسح الطلب</button> : null}{tab === "active" && request.status !== "request_received" && canCancel ? <button className="danger" disabled={busy} onClick={() => { setConfirmAction({ request, type: "cancel" }); setConfirmReason(""); }}>إلغاء الطلب</button> : null}</div></article>;
        }) : <div className="operations-empty">لا توجد طلبات</div>}</div></section>
      )}

      {detail ? <div className="operations-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDetail(null); }}><div className="operations-modal"><header><div><h3>{detail.request_no}</h3><span>{labels[detail.status] || detail.status} — {detail.requested_by_name || "—"} — {new Date(detail.requested_at).toLocaleString("ar-SA")}</span></div><button onClick={() => setDetail(null)}><X /></button></header><div className="transfer-detail-summary"><div><span>من</span><strong>{detail.source_location || "—"}</strong></div><div><span>إلى</span><strong>{detail.destination_location || "—"}</strong></div><div><span>عدد السيارات</span><strong>{detail.vehicle_count}</strong></div></div><table className="operations-table"><thead><tr><th>رقم الهيكل</th><th>السيارة</th><th>البيان</th></tr></thead><tbody>{detail.vehicles.map(vehicle => <tr key={vehicle.id}><td>{vehicle.vin}</td><td>{vehicle.carName || "—"}</td><td>{vehicle.statement || "—"}</td></tr>)}</tbody></table>{detail.note ? <div className="transfer-detail-note"><strong>ملاحظات الطلب</strong><p>{detail.note}</p></div> : null}</div></div> : null}

      {confirmAction ? createPortal(<div className="operations-confirm-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) { setConfirmAction(null); setConfirmReason(""); } }}><section className="operations-confirm-modal"><header><div><WarningCircle size={26} /><span><strong>{confirmAction.type === "delete" ? "مسح طلب النقل" : "إلغاء طلب النقل"}</strong><small>{confirmAction.request.request_no}</small></span></div><button disabled={busy} onClick={() => { setConfirmAction(null); setConfirmReason(""); }}><X /></button></header><p>{confirmAction.type === "delete" ? "يُسمح بالمسح فقط قبل تنفيذ أي إجراء فعلي على الطلب، ويظل سجل التدقيق محفوظًا." : "سيتم إيقاف الطلب ومنع تنفيذ مراحل جديدة مع الحفاظ على جميع الإجراءات السابقة."}</p><label><span>سبب الإجراء — إجباري</span><textarea rows={4} value={confirmReason} onChange={event => setConfirmReason(event.target.value)} /></label><footer><button disabled={busy} onClick={() => { setConfirmAction(null); setConfirmReason(""); }}>إلغاء</button><button className="danger" disabled={busy || !confirmReason.trim()} onClick={() => void confirmRequestAction()}><Trash />{busy ? "جاري التنفيذ..." : "تأكيد الإجراء"}</button></footer></section></div>, document.body) : null}
    </div>
  );
}
