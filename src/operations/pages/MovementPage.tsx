import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Car, MagnifyingGlass, Plus, Trash, WarningCircle } from "@phosphor-icons/react";
import { operationsFetch, queryString } from "../api";
import type { VehicleRow } from "../types";
import { useOperations } from "../useOperations";

type SelectedVehicle = VehicleRow & { note: string; stateNote: string; shortageNote: string; checks: Record<string, { status: string; note: string }> };

export function MovementPage() {
  const { meta } = useOperations();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<VehicleRow[]>([]);
  const [selected, setSelected] = useState<SelectedVehicle[]>([]);
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [newStatus, setNewStatus] = useState("available_for_sale");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      if (search.trim().length < 2) { setResults([]); return; }
      try { const payload = await operationsFetch<{ rows: VehicleRow[] }>(`/api/operations${queryString({ resource: "vehicles", search, pageSize: 20 })}`); setResults(payload.rows.filter((row) => !selected.some((item) => item.id === row.id))); }
      catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر البحث عن السيارات"); }
    }, 280);
    return () => window.clearTimeout(timer);
  }, [search, selected]);

  function add(row: VehicleRow) {
    setSelected((current) => [...current, { ...row, note: "", stateNote: "", shortageNote: "", checks: Object.fromEntries(meta.checkItems.map((item) => [item.code, { status: "unknown", note: "" }])) }]);
    setSearch(""); setResults([]);
  }
  function patch(id: string, values: Partial<SelectedVehicle>) { setSelected((current) => current.map((item) => item.id === id ? { ...item, ...values } : item)); }

  const destination = useMemo(() => meta.locations.find((item) => item.id === destinationLocationId), [meta.locations, destinationLocationId]);
  async function submit() {
    setSaving(true); setMessage(""); setError("");
    try {
      const payload = await operationsFetch<{ message: string }>("/api/operations", { method: "POST", body: JSON.stringify({ action: "move_vehicles", destinationLocationId, newStatus, note, items: selected.map((item) => ({ vehicleId: item.id, note: item.note, stateNote: item.stateNote, shortageNote: item.shortageNote, checks: Object.entries(item.checks).map(([itemCode, value]) => ({ itemCode, status: value.status, note: value.note })) })) }) });
      setMessage(payload.message); setSelected([]); setDestinationLocationId(""); setNote("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تنفيذ الحركة"); }
    finally { setSaving(false); }
  }

  return (
    <div className="module-page operations-page">
      <header className="module-page-head"><div><h1>الحركة</h1><p>تنفيذ حركة لسيارة واحدة أو عدة سيارات داخل Transaction واحدة، مع State مستقل لكل سيارة.</p></div></header>
      {error ? <div className="operations-alert error"><WarningCircle size={18} />{error}</div> : null}{message ? <div className="operations-alert success">{message}</div> : null}
      <section className="panel operations-movement-panel">
        <div className="operations-movement-toolbar">
          <div className="operations-vehicle-search"><label className="operations-search"><MagnifyingGlass size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث جزئي في VIN أو السيارة" /></label>{results.length ? <div className="operations-search-results floating">{results.map((row) => <button key={row.id} type="button" onClick={() => add(row)}><Plus size={16} /><b>{row.vin}</b><span>{row.car_name || "—"} · {row.location_name} · {row.status_name}</span></button>)}</div> : null}</div>
          <select value={destinationLocationId} onChange={(e) => setDestinationLocationId(e.target.value)}><option value="">المكان الجديد</option>{meta.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>{meta.statuses.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
        </div>
        <label className="operations-field"><span>ملاحظات عامة للحركة</span><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></label>

        <div className="operations-selected-cars">
          {!selected.length ? <div className="operations-empty-state"><Car size={42} weight="duotone" /><strong>لم يتم اختيار سيارات</strong><span>ابحث برقم الهيكل وأضف سيارة أو أكثر.</span></div> : selected.map((item) => (
            <article key={item.id} className="operations-selected-car-card">
              <header><div><b>{item.vin}</b><span>{item.car_name || "—"} · {item.statement || "—"}</span></div><button type="button" onClick={() => setSelected((current) => current.filter((row) => row.id !== item.id))}><Trash size={17} /></button></header>
              <div className="operations-route-preview"><span>{item.location_name || "—"}<small>{item.status_name}</small></span><ArrowRight size={22} /><span>{destination?.name || "اختر المكان"}<small>{meta.statuses.find((status) => status.code === newStatus)?.name}</small></span></div>
              <div className="operations-card-fields"><label><span>ملاحظة السيارة</span><input value={item.note} onChange={(e) => patch(item.id, { note: e.target.value })} /></label><label><span>حجز - نواقص - تحديد مكان</span><input value={item.shortageNote} onChange={(e) => patch(item.id, { shortageNote: e.target.value })} /></label>{newStatus === "has_notes" ? <label className="wide"><span>ملاحظات الحالة — مطلوبة</span><textarea value={item.stateNote} onChange={(e) => patch(item.id, { stateNote: e.target.value })} /></label> : null}</div>
              {item.location_code === "agency" ? <div className="operations-check-editor"><h4>تشيك الوكالة لهذه السيارة</h4>{meta.checkItems.map((check) => <label key={check.code}><span>{check.name}</span><select value={item.checks[check.code]?.status || "unknown"} onChange={(e) => patch(item.id, { checks: { ...item.checks, [check.code]: { ...item.checks[check.code], status: e.target.value } } })}><option value="unknown">غير محدد</option><option value="ok">موجود</option><option value="missing">ناقص</option></select><input placeholder="ملاحظة" value={item.checks[check.code]?.note || ""} onChange={(e) => patch(item.id, { checks: { ...item.checks, [check.code]: { ...item.checks[check.code], note: e.target.value } } })} /></label>)}</div> : null}
            </article>
          ))}
        </div>
        <button className="operations-primary-button operations-submit-movement" type="button" disabled={saving || !selected.length || !destinationLocationId || !meta.permissions.canMove || (newStatus === "has_notes" && selected.some((item) => !item.stateNote.trim()))} onClick={() => void submit()}>{saving ? "جاري تنفيذ الحركة..." : `تنفيذ الحركة على ${selected.length} سيارة`}</button>
      </section>
    </div>
  );
}
