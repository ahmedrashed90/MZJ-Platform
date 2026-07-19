import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowsLeftRight,
  CheckCircle,
  GearSix,
  MagnifyingGlass,
  WarningCircle,
} from "@phosphor-icons/react";
import { useOperations } from "../OperationsContext";
import { formatOperationsDate, operationsFetch, operationsQuery } from "../api";
import type { OperationsMovement, OperationsVehicle, VehicleContents } from "../types";
import { VehicleMovementOverrideModal } from "../components/VehicleMovementOverrideModal";
import { VehiclePicker } from "../components/VehiclePicker";

type VehicleOverride = { interiorColor?: string; locationNote?: string; shortageNote?: string; contents?: VehicleContents };

export function OperationsMovementsPage() {
  const { meta, can } = useOperations();
  const [vehicles, setVehicles] = useState<OperationsVehicle[]>([]);
  const [movements, setMovements] = useState<OperationsMovement[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [targetStatusCode, setTargetStatusCode] = useState("available_for_sale");
  const [note, setNote] = useState("");
  const [overrides, setOverrides] = useState<Record<string, VehicleOverride>>({});
  const [overrideVehicle, setOverrideVehicle] = useState<OperationsVehicle | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [vehiclePayload, movementPayload] = await Promise.all([
        operationsFetch<{ ok: boolean; vehicles: OperationsVehicle[] }>("/api/operations/vehicles?archived=false&limit=2000"),
        operationsFetch<{ ok: boolean; movements: OperationsMovement[] }>(`/api/operations/movements${operationsQuery({ search, limit: 150 })}`),
      ]);
      setVehicles(vehiclePayload.vehicles || []);
      setMovements(movementPayload.movements || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل بيانات الحركة");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  const selectedVehicles = useMemo(() => vehicles.filter((vehicle) => selectedIds.includes(vehicle.id)), [selectedIds, vehicles]);
  const destination = meta?.locations.find((item) => item.id === destinationLocationId);
  const targetStatus = meta?.statuses.find((item) => item.code === targetStatusCode);

  async function executeMovement(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = await operationsFetch<{ ok: boolean; message: string }>("/api/operations/movements", {
        method: "POST",
        body: JSON.stringify({ vehicleIds: selectedIds, destinationLocationId, targetStatusCode, note, vehicleOverrides: overrides }),
      });
      setMessage(payload.message);
      setSelectedIds([]);
      setDestinationLocationId("");
      setNote("");
      setOverrides({});
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "تعذر تنفيذ الحركة");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="module-page ops-page">
      <header className="module-page-head ops-page-head">
        <div><h1>حركة السيارات</h1><p>تنفيذ حركة مباشرة لمجموعة سيارات مع تحديث الموقع والحالة وتسجيل سجل تدقيق مستقل لكل سيارة.</p></div>
      </header>
      {error ? <div className="ops-error"><WarningCircle size={19} weight="fill" /><span>{error}</span></div> : null}
      {message ? <div className="ops-success"><CheckCircle size={19} weight="fill" /><span>{message}</span></div> : null}

      <div className="ops-movement-layout">
        <section className="panel ops-movement-form-panel">
          <div className="ops-section-heading"><ArrowsLeftRight size={23} weight="duotone" /><div><h2>تنفيذ حركة جديدة</h2><p>اختر السيارات ثم الموقع والحالة بعد الحركة.</p></div></div>
          {can("operations.movements.create") ? (
            <form onSubmit={executeMovement}>
              <VehiclePicker vehicles={vehicles} selectedIds={selectedIds} onChange={setSelectedIds} />
              {selectedVehicles.length ? (
                <div className="ops-selected-vehicles">
                  <div className="ops-subtitle">السيارات المحددة وبيانات الوكالة</div>
                  {selectedVehicles.map((vehicle) => (
                    <article key={vehicle.id}>
                      <div><strong>{vehicle.vin}</strong><span>{vehicle.car_name || "—"} • {vehicle.location_name || "—"}</span></div>
                      <button type="button" className={`ops-button tiny ${overrides[vehicle.id] ? "success" : "secondary"}`} onClick={() => setOverrideVehicle(vehicle)}><GearSix size={15} />{overrides[vehicle.id] ? "تم ضبط البيانات" : "ضبط البيانات"}</button>
                    </article>
                  ))}
                </div>
              ) : null}
              <div className="ops-form-grid two">
                <label><span>الموقع الجديد *</span><select required value={destinationLocationId} onChange={(event) => setDestinationLocationId(event.target.value)}><option value="">اختر الموقع</option>{meta?.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label><span>الحالة الجديدة *</span><select required value={targetStatusCode} onChange={(event) => setTargetStatusCode(event.target.value)}>{meta?.statuses.filter((item) => item.code !== "archived").map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
              </div>
              <label className="ops-field"><span>ملاحظات الحركة</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
              <div className="ops-movement-preview">
                <span>{selectedIds.length.toLocaleString("ar-SA")} سيارة</span><ArrowLeft size={18} /><strong>{destination?.name || "اختر الموقع"}</strong><span className="ops-status-preview">{targetStatus?.name || "اختر الحالة"}</span>
              </div>
              <button type="submit" className="ops-button primary full" disabled={saving || !selectedIds.length || !destinationLocationId}><ArrowsLeftRight size={19} />{saving ? "جاري تنفيذ الحركة..." : "تنفيذ الحركة وتسجيل السجل"}</button>
            </form>
          ) : <div className="ops-permission-note">لديك صلاحية عرض الحركات فقط.</div>}
        </section>

        <section className="panel ops-recent-movements">
          <div className="ops-section-heading"><ArrowsLeftRight size={23} weight="duotone" /><div><h2>آخر الحركات</h2><p>آخر 150 حركة مسجلة في النظام.</p></div></div>
          <label className="ops-search"><MagnifyingGlass size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث بالهيكل أو رقم الحركة..." /></label>
          <div className="ops-movement-cards">
            {movements.map((movement) => (
              <article key={movement.id}>
                <header><strong>{movement.vin || "—"}</strong><span>{movement.batch_no || movement.request_no || "حركة"}</span></header>
                <div className="ops-route-line"><span>{movement.from_location_name || "غير محدد"}</span><ArrowLeft size={16} /><span>{movement.to_location_name || "غير محدد"}</span></div>
                <p>{movement.car_name || "—"} • {movement.new_status_name || movement.new_status || "—"}</p>
                <footer><span>{movement.performed_by_name || "—"}</span><time>{formatOperationsDate(movement.created_at)}</time></footer>
              </article>
            ))}
            {!loading && !movements.length ? <div className="ops-empty-inline">لا توجد حركات مسجلة.</div> : null}
          </div>
        </section>
      </div>

      <VehicleMovementOverrideModal
        open={Boolean(overrideVehicle)}
        vehicle={overrideVehicle}
        value={overrideVehicle ? overrides[overrideVehicle.id] : undefined}
        onClose={() => setOverrideVehicle(null)}
        onSave={(value) => { if (overrideVehicle) setOverrides((current) => ({ ...current, [overrideVehicle.id]: value })); }}
      />
    </div>
  );
}
