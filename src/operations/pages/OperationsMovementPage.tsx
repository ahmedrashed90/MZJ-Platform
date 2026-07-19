import { useEffect, useMemo, useState } from "react";
import { ArrowsLeftRight, CheckCircle, FloppyDisk, WarningCircle } from "@phosphor-icons/react";
import { operationsFetch } from "../api";
import { VehiclePicker } from "../components/VehiclePicker";
import type { OperationsVehicle } from "../types";
import { useOperationsMeta } from "../useOperationsMeta";

type CheckValue = { code: string; status: string; note: string };

export function OperationsMovementPage() {
  const { meta, error: metaError } = useOperationsMeta();
  const [selected, setSelected] = useState<OperationsVehicle[]>([]);
  const [vehicle, setVehicle] = useState<OperationsVehicle | null>(null);
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [newStatus, setNewStatus] = useState("");
  const [note, setNote] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [reservationNote, setReservationNote] = useState("");
  const [checks, setChecks] = useState<CheckValue[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const chosen = selected[0];
    if (!chosen) { setVehicle(null); setChecks([]); return; }
    operationsFetch<{ ok: true; vehicle: OperationsVehicle }>(`/api/operations/vehicles?id=${chosen.id}`)
      .then((payload) => {
        setVehicle(payload.vehicle);
        setChecks((payload.vehicle.checks || []).map((item: any) => ({ code: item.item_code || item.code, status: item.status || "unknown", note: item.note || "" })));
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "تعذر تحميل السيارة"));
  }, [selected]);

  const status = useMemo(() => meta?.statuses.find((item) => item.code === newStatus), [meta, newStatus]);
  const showChecks = vehicle?.location_code === "agency";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!vehicle) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const payload = await operationsFetch<{ ok: true; message: string }>("/api/operations/movements", {
        method: "POST",
        body: JSON.stringify({
          action: "single", vehicleId: vehicle.id, destinationLocationId, newStatus, note, statusNote,
          reservationShortageLocationNote: reservationNote, checks: showChecks ? checks : [],
        }),
      });
      setMessage(payload.message || "تم تنفيذ الحركة");
      setSelected([]); setVehicle(null); setDestinationLocationId(""); setNewStatus(""); setNote(""); setStatusNote(""); setReservationNote(""); setChecks([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر تنفيذ الحركة");
    } finally { setSaving(false); }
  }

  return (
    <div className="module-page operations-page">
      <header className="module-page-head"><div><h1>حركة السيارات</h1><p>تنفيذ حركة رسمية لسيارة واحدة مع تحديث المكان والحالة وتسجيل المستخدم والوقت داخل معاملة واحدة.</p></div></header>
      {metaError || error ? <div className="connection-banner"><WarningCircle size={20} weight="fill" /><span>{metaError || error}</span></div> : null}
      {message ? <div className="success-banner"><CheckCircle size={19} weight="fill" /><span>{message}</span></div> : null}
      <form className="panel operations-form-card" onSubmit={submit}>
        <div className="operations-section-title"><ArrowsLeftRight size={22} weight="duotone" /><div><h2>اختيار السيارة</h2><p>البحث يتم من السيرفر ويحافظ على الأصفار في بداية VIN.</p></div></div>
        <VehiclePicker selected={selected} onChange={setSelected} />
        {vehicle ? <>
          <div className="operations-form-grid">
            <label><span>المكان الحالي</span><input value={vehicle.location_name || "—"} disabled /></label>
            <label><span>الحالة الحالية</span><input value={vehicle.status_name || vehicle.status_code} disabled /></label>
            <label><span>المكان الجديد</span><select required value={destinationLocationId} onChange={(event) => setDestinationLocationId(event.target.value)}><option value="">اختر المكان</option>{meta?.locations.filter((item) => item.id !== vehicle.location_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label><span>الحالة الجديدة</span><select required value={newStatus} onChange={(event) => setNewStatus(event.target.value)}><option value="">اختر الحالة</option>{meta?.statuses.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
            <label className="full"><span>ملاحظات الحركة</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
            {status?.requires_status_note ? <label className="full"><span>ملاحظات الحالة *</span><textarea required rows={3} value={statusNote} onChange={(event) => setStatusNote(event.target.value)} /></label> : null}
            <label className="full"><span>حجز - نواقص - تحديد مكان</span><textarea rows={3} value={reservationNote} onChange={(event) => setReservationNote(event.target.value)} /></label>
          </div>
          {showChecks ? <section className="operations-check-card">
            <div><h3>تشيك السيارة في الوكالة</h3><p>كل عنصر مستقل، وتعديله لا يؤثر على العناصر الأخرى.</p></div>
            <div className="operations-check-grid">{meta?.checkItems.map((item) => {
              const current = checks.find((entry) => entry.code === item.code) || { code: item.code, status: "unknown", note: "" };
              return <article key={item.code}><strong>{item.name}</strong><select value={current.status} onChange={(event) => setChecks((old) => [...old.filter((entry) => entry.code !== item.code), { ...current, status: event.target.value }])}><option value="unknown">غير محدد</option><option value="available">موجود</option><option value="missing">ناقص</option><option value="damaged">به تلف</option></select><input placeholder="ملاحظة العنصر" value={current.note} onChange={(event) => setChecks((old) => [...old.filter((entry) => entry.code !== item.code), { ...current, note: event.target.value }])} /></article>;
            })}</div>
          </section> : <div className="operations-hint">قائمة التشيك تظهر فقط عندما يكون المكان الحالي للسيارة هو الوكالة.</div>}
          <div className="operations-form-actions"><button type="submit" className="operations-primary" disabled={saving || !destinationLocationId || !newStatus}><FloppyDisk size={18} />{saving ? "جاري تنفيذ الحركة..." : "تنفيذ الحركة"}</button></div>
        </> : null}
      </form>
    </div>
  );
}
