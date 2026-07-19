import { useEffect, useMemo, useState } from "react";
import { CheckCircle, FloppyDisk, Stack, WarningCircle } from "@phosphor-icons/react";
import { operationsFetch } from "../api";
import { VehiclePicker } from "../components/VehiclePicker";
import type { OperationsVehicle } from "../types";
import { useOperationsMeta } from "../useOperationsMeta";

type ItemState = { note: string; statusNote: string; reservationShortageLocationNote: string; checks: Array<{ code: string; status: string; note: string }> };
const emptyItem: ItemState = { note: "", statusNote: "", reservationShortageLocationNote: "", checks: [] };

export function OperationsBatchMovementPage() {
  const { meta, error: metaError } = useOperationsMeta();
  const [selected, setSelected] = useState<OperationsVehicle[]>([]);
  const [items, setItems] = useState<Record<string, ItemState>>({});
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [newStatus, setNewStatus] = useState("");
  const [generalNote, setGeneralNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const status = useMemo(() => meta?.statuses.find((item) => item.code === newStatus), [meta, newStatus]);

  useEffect(() => {
    selected.forEach((vehicle) => {
      if (items[vehicle.id]) return;
      operationsFetch<{ ok: true; vehicle: OperationsVehicle }>(`/api/operations/vehicles?id=${vehicle.id}`)
        .then((payload) => setItems((current) => ({
          ...current,
          [vehicle.id]: {
            ...emptyItem,
            checks: (payload.vehicle.checks || []).map((entry: any) => ({ code: entry.item_code || entry.code, status: entry.status || "unknown", note: entry.note || "" })),
          },
        })))
        .catch((reason) => setError(reason instanceof Error ? reason.message : "تعذر تحميل إحدى السيارات"));
    });
    setItems((current) => Object.fromEntries(Object.entries(current).filter(([id]) => selected.some((vehicle) => vehicle.id === id))));
  }, [selected]);

  function patchItem(id: string, patch: Partial<ItemState>) {
    setItems((current) => ({ ...current, [id]: { ...(current[id] || emptyItem), ...patch } }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError(""); setMessage("");
    try {
      const payload = await operationsFetch<{ ok: true; message: string }>("/api/operations/movements", {
        method: "POST",
        body: JSON.stringify({
          action: "batch", destinationLocationId, newStatus, generalNote,
          vehicles: selected.map((vehicle) => ({ vehicleId: vehicle.id, ...(items[vehicle.id] || emptyItem), checks: vehicle.location_code === "agency" ? (items[vehicle.id]?.checks || []) : [] })),
        }),
      });
      setMessage(payload.message || "تم تنفيذ الحركة الجماعية");
      setSelected([]); setItems({}); setDestinationLocationId(""); setNewStatus(""); setGeneralNote("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر تنفيذ الحركة الجماعية");
    } finally { setSaving(false); }
  }

  return (
    <div className="module-page operations-page">
      <header className="module-page-head"><div><h1>إنشاء حركة لأكثر من سيارة إلى مكان واحد</h1><p>كل سيارة لها ملاحظاتها وتشيكها المستقل، وتُنفذ العملية بالكامل داخل Transaction واحدة.</p></div></header>
      {metaError || error ? <div className="connection-banner"><WarningCircle size={20} weight="fill" /><span>{metaError || error}</span></div> : null}
      {message ? <div className="success-banner"><CheckCircle size={19} weight="fill" /><span>{message}</span></div> : null}
      <form className="panel operations-form-card" onSubmit={submit}>
        <div className="operations-section-title"><Stack size={22} weight="duotone" /><div><h2>السيارات المختارة</h2><p>يمكن اختيار حتى 200 سيارة، ولا يسمح بإضافة السيارة نفسها مرتين.</p></div></div>
        <VehiclePicker selected={selected} onChange={setSelected} multiple />
        <div className="operations-form-grid">
          <label><span>المكان الجديد لكل السيارات</span><select required value={destinationLocationId} onChange={(event) => setDestinationLocationId(event.target.value)}><option value="">اختر المكان</option>{meta?.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>الحالة الجديدة</span><select required value={newStatus} onChange={(event) => setNewStatus(event.target.value)}><option value="">اختر الحالة</option>{meta?.statuses.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
          <label className="full"><span>ملاحظات عامة للحركة</span><textarea rows={3} value={generalNote} onChange={(event) => setGeneralNote(event.target.value)} /></label>
        </div>
        <div className="operations-batch-cards">{selected.map((vehicle) => {
          const state = items[vehicle.id] || emptyItem;
          return <article key={vehicle.id} className="operations-batch-card">
            <header><div><strong>{vehicle.vin}</strong><span>{vehicle.car_name || "—"} · {vehicle.statement || "—"}</span></div><span>{vehicle.location_name || "—"}</span></header>
            <div className="operations-form-grid">
              <label className="full"><span>ملاحظات هذه السيارة</span><textarea rows={2} value={state.note} onChange={(event) => patchItem(vehicle.id, { note: event.target.value })} /></label>
              {status?.requires_status_note ? <label className="full"><span>ملاحظات الحالة *</span><textarea required rows={2} value={state.statusNote} onChange={(event) => patchItem(vehicle.id, { statusNote: event.target.value })} /></label> : null}
              <label className="full"><span>حجز - نواقص - تحديد مكان</span><textarea rows={2} value={state.reservationShortageLocationNote} onChange={(event) => patchItem(vehicle.id, { reservationShortageLocationNote: event.target.value })} /></label>
            </div>
            {vehicle.location_code === "agency" ? <div className="operations-check-grid compact">{meta?.checkItems.map((item) => {
              const current = state.checks.find((entry) => entry.code === item.code) || { code: item.code, status: "unknown", note: "" };
              return <article key={item.code}><strong>{item.name}</strong><select value={current.status} onChange={(event) => patchItem(vehicle.id, { checks: [...state.checks.filter((entry) => entry.code !== item.code), { ...current, status: event.target.value }] })}><option value="unknown">غير محدد</option><option value="available">موجود</option><option value="missing">ناقص</option><option value="damaged">به تلف</option></select></article>;
            })}</div> : <div className="operations-hint small">هذه السيارة ليست في الوكالة، لذلك لا يظهر التشيك داخل الحركة.</div>}
          </article>;
        })}</div>
        <div className="operations-form-actions"><button type="submit" className="operations-primary" disabled={saving || !selected.length || !destinationLocationId || !newStatus}><FloppyDisk size={18} />{saving ? "جاري تنفيذ الحركة الجماعية..." : `تنفيذ الحركة لـ ${selected.length} سيارة`}</button></div>
      </form>
    </div>
  );
}
