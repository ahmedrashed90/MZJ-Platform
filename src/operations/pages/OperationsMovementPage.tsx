import { useEffect, useMemo, useState } from "react";
import { CheckSquare, MagnifyingGlass, Trash, X } from "@phosphor-icons/react";
import { formatOperationsError, operationsFetch } from "../api";
import type { VehicleRow } from "../types";
import { useOperationsMeta } from "../useOperationsMeta";

const checkItems = [
  ["mats", "فرشات"], ["extinguisher", "طفاية"], ["bag", "شنطة"], ["spare_tire", "اسبير"], ["remote", "ريموت"],
  ["screen", "شاشة"], ["recorder", "مسجل"], ["ac", "مكيف"], ["camera", "كاميرا"], ["sensor", "حساس"],
] as const;
type CheckValue = { status: "unknown" | "present" | "missing"; note: string };
type VehicleMovementData = { note: string; statusNote: string; shortageLocationNote: string; checks: Record<string, CheckValue> };

function emptyChecks() {
  return Object.fromEntries(checkItems.map(([code]) => [code, { status: "unknown", note: "" }])) as Record<string, CheckValue>;
}

export function OperationsMovementPage() {
  const { locations, statuses, error: metaError } = useOperationsMeta();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<VehicleRow[]>([]);
  const [selected, setSelected] = useState<VehicleRow[]>([]);
  const [vehicleData, setVehicleData] = useState<Record<string, VehicleMovementData>>({});
  const [destination, setDestination] = useState("");
  const [status, setStatus] = useState("");
  const [generalNote, setGeneralNote] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  const destinationName = useMemo(() => locations.find(item => item.id === destination)?.name || "—", [locations, destination]);
  const statusName = useMemo(() => statuses.find(item => item.code === status)?.name || "—", [statuses, status]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (q.trim().length < 2) { setResults([]); return; }
      operationsFetch<{ rows: VehicleRow[] }>("vehicles", { query: { q, page: 1, limit: 20 } }).then(response => setResults(response.rows || [])).catch(caught => setError(formatOperationsError(caught)));
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    if (!reviewOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) setReviewOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reviewOpen, busy]);

  async function add(vehicle: VehicleRow) {
    if (selected.some(item => item.id === vehicle.id)) { setQ(""); setResults([]); return; }
    setSelected(current => [...current, vehicle]);
    setVehicleData(current => ({ ...current, [vehicle.id]: { note: "", statusNote: "", shortageLocationNote: "", checks: emptyChecks() } }));
    setQ(""); setResults([]);
    if (vehicle.location_code === "agency") {
      try {
        const details = await operationsFetch<any>("vehicle", { query: { id: vehicle.id } });
        setVehicleData(current => {
          const next = current[vehicle.id] || { note: "", statusNote: "", shortageLocationNote: "", checks: emptyChecks() };
          const checks = { ...next.checks };
          for (const item of details.checks || []) if (checks[item.item_code]) checks[item.item_code] = { status: item.status || "unknown", note: item.note || "" };
          return { ...current, [vehicle.id]: { ...next, checks } };
        });
      } catch (caught) { setError(formatOperationsError(caught)); }
    }
  }

  function remove(id: string) {
    setSelected(current => current.filter(item => item.id !== id));
    setVehicleData(current => { const next = { ...current }; delete next[id]; return next; });
  }

  function setVehicleField(id: string, field: keyof Omit<VehicleMovementData, "checks">, value: string) {
    setVehicleData(current => ({ ...current, [id]: { ...(current[id] || { note: "", statusNote: "", shortageLocationNote: "", checks: emptyChecks() }), [field]: value } }));
  }

  function setCheck(id: string, code: string, patch: Partial<CheckValue>) {
    setVehicleData(current => {
      const entry = current[id] || { note: "", statusNote: "", shortageLocationNote: "", checks: emptyChecks() };
      return { ...current, [id]: { ...entry, checks: { ...entry.checks, [code]: { ...(entry.checks[code] || { status: "unknown", note: "" }), ...patch } } } };
    });
  }

  function validateReview() {
    setError("");
    if (!selected.length || !destination || !status) { setError("اختر السيارات والمكان والحالة الجديدة"); return; }
    const sameLocation = selected.find(item => item.location_id === destination);
    if (sameLocation) { setError(`المكان الجديد مطابق للمكان الحالي للسيارة ${sameLocation.vin}`); return; }
    if (status === "has_notes") {
      const missing = selected.find(item => !vehicleData[item.id]?.statusNote.trim());
      if (missing) { setError(`ملاحظات الحالة مطلوبة للسيارة ${missing.vin}`); return; }
    }
    setReviewOpen(true);
  }

  async function execute() {
    setBusy(true); setError(""); setMessage("");
    try {
      const payloadData = Object.fromEntries(selected.map(vehicle => {
        const item = vehicleData[vehicle.id] || { note: "", statusNote: "", shortageLocationNote: "", checks: emptyChecks() };
        return [vehicle.id, { ...item, checks: checkItems.map(([itemCode]) => ({ itemCode, ...item.checks[itemCode] })) }];
      }));
      const response = await operationsFetch<{ result: { count: number; batchNo: string } }>("movement", { method: "POST", body: { vehicleIds: selected.map(item => item.id), destinationLocationId: destination, newStatus: status, note: generalNote, vehicleData: payloadData } });
      setMessage(`تم تنفيذ الحركة لعدد ${response.result.count} سيارة — ${response.result.batchNo}`);
      setSelected([]); setVehicleData({}); setDestination(""); setStatus(""); setGeneralNote(""); setReviewOpen(false);
    } catch (caught) { setError(formatOperationsError(caught)); setReviewOpen(false); }
    finally { setBusy(false); }
  }

  return (
    <div className="operations-page">
      <header className="operations-page-head"><div><h1>الحركة</h1><p>فلو موحد لسيارة واحدة أو عدة سيارات داخل Transaction واحدة.</p></div></header>
      {error || metaError ? <div className="operations-error">{error || metaError}</div> : null}
      {message ? <div className="operations-success">{message}</div> : null}
      <section className="operations-card"><div className="movement-form-grid">
        <label className="search-field"><span>ابحث بجزء من VIN</span><div><MagnifyingGlass /><input value={q} onChange={event => setQ(event.target.value)} placeholder="مثال: 000 أو آخر أرقام الهيكل" /></div>{results.length ? <div className="operations-suggestions">{results.map(vehicle => <button type="button" key={vehicle.id} onClick={() => void add(vehicle)}><strong>{vehicle.vin}</strong><span>{vehicle.car_name || "—"} — {vehicle.statement || "—"} — {vehicle.location_name || "—"} — {vehicle.status_name || vehicle.status_code}</span></button>)}</div> : null}</label>
        <label><span>المكان الجديد</span><select value={destination} onChange={event => setDestination(event.target.value)}><option value="">اختر المكان</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        <label><span>الحالة الجديدة</span><select value={status} onChange={event => setStatus(event.target.value)}><option value="">اختر الحالة</option>{statuses.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
        <label className="span-2"><span>ملاحظات عامة للحركة</span><textarea value={generalNote} onChange={event => setGeneralNote(event.target.value)} /></label>
      </div></section>

      <section className="operations-card"><header><strong>السيارات المختارة ({selected.length})</strong></header>{selected.length ? <div className="movement-vehicle-list">{selected.map(vehicle => {
        const data = vehicleData[vehicle.id] || { note: "", statusNote: "", shortageLocationNote: "", checks: emptyChecks() };
        return <article className="movement-vehicle-card" key={vehicle.id}><header><div><strong>{vehicle.vin}</strong><span>{vehicle.car_name || "—"} — {vehicle.statement || "—"} — {vehicle.model_year || "—"}</span><small>{vehicle.location_name || "—"} — {vehicle.status_name || vehicle.status_code}</small></div><button type="button" onClick={() => remove(vehicle.id)}><Trash /></button></header><div className="movement-vehicle-fields"><label><span>ملاحظات هذه السيارة</span><textarea value={data.note} onChange={event => setVehicleField(vehicle.id, "note", event.target.value)} /></label>{status === "has_notes" ? <label><span>ملاحظات الحالة — إجباري</span><textarea value={data.statusNote} onChange={event => setVehicleField(vehicle.id, "statusNote", event.target.value)} /></label> : null}<label><span>حجز - نواقص - تحديد مكان</span><textarea value={data.shortageLocationNote} onChange={event => setVehicleField(vehicle.id, "shortageLocationNote", event.target.value)} /></label></div>{vehicle.location_code === "agency" ? <section className="movement-check-section"><h4><CheckSquare /> تشيك السيارة — يظهر لأن مكانها الحالي الوكالة</h4><div>{checkItems.map(([code, name]) => <label key={code}><strong>{name}</strong><select value={data.checks[code]?.status || "unknown"} onChange={event => setCheck(vehicle.id, code, { status: event.target.value as CheckValue["status"] })}><option value="unknown">غير محدد</option><option value="present">موجود</option><option value="missing">غير موجود</option></select><input value={data.checks[code]?.note || ""} onChange={event => setCheck(vehicle.id, code, { note: event.target.value })} placeholder="ملاحظة العنصر" /></label>)}</div></section> : null}</article>;
      })}</div> : <div className="operations-empty">ابحث عن سيارة وأضفها لبدء الحركة.</div>}<button className="operations-main-button" disabled={busy || !selected.length || !destination || !status} onClick={validateReview}>مراجعة وتنفيذ الحركة</button></section>

      {reviewOpen ? <div className="operations-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setReviewOpen(false); }}><section className="operations-modal movement-review-modal"><header><div><h3>مراجعة الحركة قبل التنفيذ</h3><span>ستُنفذ العملية بالكامل أو يتم التراجع عنها بالكامل عند فشل أي سيارة.</span></div><button disabled={busy} onClick={() => setReviewOpen(false)}><X /></button></header><div className="movement-review-summary"><div><span>عدد السيارات</span><strong>{selected.length}</strong></div><div><span>المكان الجديد</span><strong>{destinationName}</strong></div><div><span>الحالة الجديدة</span><strong>{statusName}</strong></div></div><div className="movement-review-cars">{selected.map(vehicle => <div key={vehicle.id}><strong>{vehicle.vin}</strong><span>{vehicle.car_name || "—"} — {vehicle.location_name || "—"}</span></div>)}</div><footer className="operations-import-actions"><button disabled={busy} onClick={() => setReviewOpen(false)}>رجوع</button><button className="operations-main-button" disabled={busy} onClick={() => void execute()}>{busy ? "جاري التنفيذ..." : "تأكيد وتنفيذ الحركة"}</button></footer></section></div> : null}
    </div>
  );
}
