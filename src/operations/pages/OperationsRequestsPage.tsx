import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Camera, CaretLeft, CheckCircle, Clock, Plus, Trash, Truck, X } from "@phosphor-icons/react";
import { useEscapeToClose } from "../../components/useEscapeToClose";
import { formatOperationsDate, operationsFetch, operationsQuery } from "../api";
import { useOperations } from "../components/OperationsState";
import type { TransferRequest } from "../types";

const stageOrder = ["request_received", "vehicle_sent", "vehicle_received", "completed"];
const stageLabels: Record<string, string> = { request_received: "تم استلام الطلب", vehicle_sent: "تم إرسال السيارة", vehicle_received: "تم استلام السيارة", completed: "تم الانتهاء" };

function RequestCreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { meta } = useOperations();
  const [type, setType] = useState<"transfer" | "photo">("transfer");
  const [department, setDepartment] = useState("");
  const [destination, setDestination] = useState("");
  const [targetStatus, setTargetStatus] = useState("");
  const [photoDate, setPhotoDate] = useState("");
  const [notes, setNotes] = useState("");
  const [vehicleText, setVehicleText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEscapeToClose(true, onClose);

  async function create() {
    const vehicles = vehicleText.split(/\r?\n/).map((line) => {
      const [vin, ...noteParts] = line.split(/[|｜]/);
      return { vin: vin.trim().toUpperCase(), note: noteParts.join("|").trim() };
    }).filter((item) => item.vin);
    setSaving(true); setError("");
    try {
      await operationsFetch("/api/operations", { method: "POST", body: JSON.stringify({ action: "createRequest", transferType: type, departmentCode: department, destinationLocationCode: destination, targetStatusCode: targetStatus, photoDate: type === "photo" ? photoDate : null, notes, vehicles }) });
      onCreated(); onClose();
    } catch (createError) { setError(createError instanceof Error ? createError.message : "تعذر إنشاء الطلب"); }
    finally { setSaving(false); }
  }

  return <div className="crm-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="crm-modal-card operations-request-modal" role="dialog" aria-modal="true"><header><div><span className="operations-kicker">طلب جديد</span><h2>إنشاء طلب نقل أو تصوير</h2><p>اكتب كل سيارة في سطر، ويمكن إضافة ملاحظة بعد علامة |.</p></div><button type="button" className="operations-icon-button" onClick={onClose}><X size={20} /></button></header>{error ? <div className="operations-alert error">{error}</div> : null}<div className="operations-form-grid two"><label><span>نوع الطلب</span><select value={type} onChange={(event) => setType(event.target.value as "transfer" | "photo")}><option value="transfer">نقل</option><option value="photo">تصوير</option></select></label><label><span>القسم</span><input value={department} onChange={(event) => setDepartment(event.target.value)} placeholder="مثال: العمليات" /></label><label><span>المكان المستهدف *</span><select value={destination} onChange={(event) => setDestination(event.target.value)}><option value="">اختر المكان</option>{meta?.locations.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select></label><label><span>الحالة بعد الاستلام - اختياري</span><select value={targetStatus} onChange={(event) => setTargetStatus(event.target.value)}><option value="">بدون تغيير الحالة</option>{meta?.statuses.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>{type === "photo" ? <label><span>تاريخ التصوير</span><input type="date" value={photoDate} onChange={(event) => setPhotoDate(event.target.value)} /></label> : null}<label className="full"><span>ملاحظة الطلب</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label><label className="full"><span>السيارات *</span><textarea className="operations-vin-textarea" value={vehicleText} onChange={(event) => setVehicleText(event.target.value.toUpperCase())} placeholder={"VIN001 | ملاحظة السيارة الأولى\nVIN002 | ملاحظة السيارة الثانية"} /></label></div><footer className="operations-modal-footer"><div /><div><button type="button" className="operations-secondary-button" onClick={onClose}>إلغاء</button><button type="button" className="operations-primary-button" disabled={saving} onClick={() => void create()}><Plus size={17} />{saving ? "جاري الإنشاء..." : "إنشاء الطلب"}</button></div></footer></div></div>;
}

function RequestDetailsModal({ request, onClose, onChanged }: { request: TransferRequest; onClose: () => void; onChanged: () => void }) {
  const { meta } = useOperations();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEscapeToClose(true, onClose);
  const currentIndex = stageOrder.indexOf(request.status);
  const nextStage = currentIndex >= 0 && currentIndex < stageOrder.length - 1 ? stageOrder[currentIndex + 1] : null;

  async function advance() {
    if (!nextStage) return;
    setBusy(true); setError("");
    try { await operationsFetch("/api/operations", { method: "POST", body: JSON.stringify({ action: "advanceRequest", requestId: request.id, note }) }); onChanged(); onClose(); }
    catch (advanceError) { setError(advanceError instanceof Error ? advanceError.message : "تعذر تنفيذ المرحلة"); }
    finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true); setError("");
    try { await operationsFetch("/api/operations", { method: "POST", body: JSON.stringify({ action: "deleteRequest", requestId: request.id }) }); onChanged(); onClose(); }
    catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "تعذر حذف الطلب"); }
    finally { setBusy(false); }
  }

  return <div className="crm-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="crm-modal-card operations-request-details" role="dialog" aria-modal="true"><header><div><span className="operations-kicker">{request.request_no}</span><h2>{request.transfer_type === "transfer" ? "طلب نقل سيارات" : "طلب تصوير سيارات"}</h2><p>{request.requested_by_name || "مستخدم"} · {formatOperationsDate(request.requested_at)}</p></div><button type="button" className="operations-icon-button" onClick={onClose}><X size={20} /></button></header>{error ? <div className="operations-alert error">{error}</div> : null}<div className="operations-request-summary"><article><span>من</span><strong>{request.source_location_name || "أماكن متعددة"}</strong></article><article><span>إلى</span><strong>{request.destination_location_name || "—"}</strong></article><article><span>عدد السيارات</span><strong>{request.vehicles.length}</strong></article><article><span>الحالة الحالية</span><strong>{stageLabels[request.status]}</strong></article></div><div className="operations-stage-track">{stageOrder.map((stage, index) => <div key={stage} className={index <= currentIndex ? "done" : ""}><span>{index < currentIndex ? <CheckCircle size={18} weight="fill" /> : index + 1}</span><b>{stageLabels[stage]}</b></div>)}</div><section className="operations-request-columns"><div><div className="operations-section-title"><h3>السيارات</h3><span>{request.vehicles.length}</span></div><div className="operations-request-vehicles">{request.vehicles.map((vehicle) => <article key={vehicle.vehicleId}><strong>{vehicle.vin}</strong><span>{vehicle.carName || "—"}</span>{vehicle.note ? <small>{vehicle.note}</small> : null}</article>)}</div></div><div><div className="operations-section-title"><h3>سجل المراحل</h3><span>{request.events.length}</span></div><div className="operations-mini-timeline">{request.events.map((event) => <article key={`${event.stageCode}-${event.createdAt}`}><b>{event.stageLabel}</b><span>{event.performedBy || "مستخدم"} · {formatOperationsDate(event.createdAt)}</span><small>{event.note || "بدون ملاحظة"}</small></article>)}</div></div></section>{nextStage && meta?.permissions.canAdvanceRequests ? <div className="operations-next-stage"><label><span>ملاحظة تنفيذ المرحلة</span><textarea value={note} onChange={(event) => setNote(event.target.value)} /></label><button type="button" className="operations-primary-button" disabled={busy} onClick={() => void advance()}><CaretLeft size={18} />{busy ? "جاري التنفيذ..." : `تنفيذ: ${stageLabels[nextStage]}`}</button></div> : null}<footer className="operations-modal-footer"><div>{request.status === "request_received" && meta?.permissions.canDeleteRequests ? <button type="button" className="operations-danger-button" disabled={busy} onClick={() => void remove()}><Trash size={17} />حذف الطلب</button> : null}</div><div><button type="button" className="operations-secondary-button" onClick={onClose}>إغلاق</button></div></footer></div></div>;
}

export function OperationsRequestsPage() {
  const { meta, loading, error: metaError } = useOperations();
  const [rows, setRows] = useState<TransferRequest[]>([]);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<TransferRequest | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!meta) return;
    let cancelled = false;
    setFetching(true); setError("");
    operationsFetch<{ ok: true; rows: TransferRequest[] }>(`/api/operations${operationsQuery({ resource: "requests", status, type, search })}`).then((response) => { if (!cancelled) setRows(response.rows); }).catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : "تعذر تحميل الطلبات"); }).finally(() => { if (!cancelled) setFetching(false); });
    return () => { cancelled = true; };
  }, [meta, status, type, search, version]);

  const counts = useMemo(() => Object.fromEntries(stageOrder.map((stage) => [stage, rows.filter((row) => row.status === stage).length])), [rows]);
  if (loading) return <div className="operations-loading-page">جاري تحميل الصفحة...</div>;
  if (metaError || !meta) return <div className="operations-alert error">{metaError || "تعذر تحميل الصفحة"}</div>;

  return <div className="operations-page"><header className="operations-page-head"><div><span className="operations-kicker">الفلو التشغيلي</span><h1>طلبات النقل والتصوير</h1><p>أربع مراحل موثقة باسم المستخدم والتاريخ، ويتم نقل السيارة فعليًا عند مرحلة استلام السيارة.</p></div>{meta.permissions.canCreateRequests ? <button type="button" className="operations-primary-button" onClick={() => setCreateOpen(true)}><Plus size={18} />طلب جديد</button> : null}</header><section className="operations-stage-cards">{stageOrder.map((stage, index) => <button type="button" key={stage} className={status === stage ? "active" : ""} onClick={() => setStatus(status === stage ? "" : stage)}><span>{index === 0 ? <Clock size={20} /> : index === 1 ? <Truck size={20} /> : index === 2 ? <ArrowLeft size={20} /> : <CheckCircle size={20} />}</span><div><small>{stageLabels[stage]}</small><strong>{counts[stage] || 0}</strong></div></button>)}</section><section className="operations-toolbar"><input className="operations-plain-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث برقم الطلب أو VIN أو المستخدم" /><select value={type} onChange={(event) => setType(event.target.value)}><option value="">كل الأنواع</option><option value="transfer">نقل</option><option value="photo">تصوير</option></select><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">كل المراحل</option>{stageOrder.map((stage) => <option key={stage} value={stage}>{stageLabels[stage]}</option>)}</select></section>{error ? <div className="operations-alert error">{error}</div> : null}<div className="operations-requests-grid">{fetching ? <div className="operations-loading">جاري تحميل الطلبات...</div> : null}{!fetching && !rows.length ? <div className="operations-empty">لا توجد طلبات مطابقة.</div> : null}{!fetching ? rows.map((request) => <button type="button" className="operations-request-card" key={request.id} onClick={() => setSelected(request)}><header><span className={request.transfer_type === "transfer" ? "transfer" : "photo"}>{request.transfer_type === "transfer" ? <Truck size={18} /> : <Camera size={18} />}{request.transfer_type === "transfer" ? "نقل" : "تصوير"}</span><b>{request.request_no}</b></header><div className="operations-request-route"><span>{request.source_location_name || "أماكن متعددة"}</span><ArrowLeft size={18} /><span>{request.destination_location_name || "—"}</span></div><footer><span>{request.vehicles.length} سيارة</span><span className={`operations-status-badge request-${request.status}`}>{stageLabels[request.status]}</span><small>{formatOperationsDate(request.requested_at)}</small></footer></button>) : null}</div>{createOpen ? <RequestCreateModal onClose={() => setCreateOpen(false)} onCreated={() => setVersion((value) => value + 1)} /> : null}{selected ? <RequestDetailsModal request={selected} onClose={() => setSelected(null)} onChanged={() => setVersion((value) => value + 1)} /> : null}</div>;
}
