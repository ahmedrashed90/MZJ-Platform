import { useEffect, useMemo, useState } from "react";
import { FloppyDisk, WarningCircle } from "@phosphor-icons/react";
import { useOperations } from "../OperationsContext";
import { operationsFetch } from "../api";
import type { OperationsVehicle, VehicleContents } from "../types";
import { OperationsModal } from "./OperationsOverlay";

type VehicleForm = {
  vin: string;
  carName: string;
  statement: string;
  agentName: string;
  exteriorColor: string;
  interiorColor: string;
  modelYear: string;
  plateNo: string;
  batchNo: string;
  locationId: string;
  statusCode: string;
  sourceType: string;
  locationNote: string;
  shortageNote: string;
  notes: string;
  contents: VehicleContents;
};

const emptyContents: VehicleContents = {
  farshat: false,
  tafaia: false,
  shanta: false,
  spare: false,
  remote: false,
  screen: false,
  recorder: false,
  ac: false,
  camera: false,
  sensors: false,
};

function vehicleToForm(vehicle?: OperationsVehicle | null): VehicleForm {
  return {
    vin: vehicle?.vin || "",
    carName: vehicle?.car_name || "",
    statement: vehicle?.statement || "",
    agentName: vehicle?.agent_name || "",
    exteriorColor: vehicle?.exterior_color || "",
    interiorColor: vehicle?.interior_color || "",
    modelYear: vehicle?.model_year || "",
    plateNo: vehicle?.plate_no || "",
    batchNo: vehicle?.batch_no || "",
    locationId: vehicle?.location_id || "",
    statusCode: vehicle?.status_code || "available_for_sale",
    sourceType: vehicle?.source_type || "",
    locationNote: vehicle?.location_note || "",
    shortageNote: vehicle?.shortage_note || "",
    notes: vehicle?.notes || "",
    contents: { ...emptyContents, ...(vehicle?.contents || {}) },
  };
}

export function VehicleFormModal({
  open,
  vehicle,
  onClose,
  onSaved,
}: {
  open: boolean;
  vehicle?: OperationsVehicle | null;
  onClose: () => void;
  onSaved: (vehicle: OperationsVehicle) => void;
}) {
  const { meta } = useOperations();
  const [form, setForm] = useState<VehicleForm>(() => vehicleToForm(vehicle));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setForm(vehicleToForm(vehicle));
      setError("");
    }
  }, [open, vehicle]);

  const currentStatus = useMemo(() => meta?.statuses.find((item) => item.code === form.statusCode), [form.statusCode, meta?.statuses]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = await operationsFetch<{ ok: boolean; vehicle: OperationsVehicle }>("/api/operations/vehicles", {
        method: "POST",
        body: JSON.stringify({ action: "save", id: vehicle?.id, ...form }),
      });
      onSaved(payload.vehicle);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "تعذر حفظ السيارة");
    } finally {
      setSaving(false);
    }
  }

  return (
    <OperationsModal
      open={open}
      title={vehicle ? `تعديل السيارة ${vehicle.vin}` : "إضافة سيارة جديدة"}
      description="يتم الحفظ مباشرة داخل قاعدة PostgreSQL وسجل النشاط الموحد."
      onClose={onClose}
      wide
    >
      <form className="ops-vehicle-form" onSubmit={submit}>
        {error ? <div className="ops-error"><WarningCircle size={19} weight="fill" /><span>{error}</span></div> : null}
        <div className="ops-form-grid three">
          <label><span>رقم الهيكل (VIN) *</span><input required value={form.vin} onChange={(event) => setForm({ ...form, vin: event.target.value.toUpperCase() })} /></label>
          <label><span>السيارة</span><input value={form.carName} onChange={(event) => setForm({ ...form, carName: event.target.value })} /></label>
          <label><span>البيان / الفئة</span><input value={form.statement} onChange={(event) => setForm({ ...form, statement: event.target.value })} /></label>
          <label><span>الوكيل</span><input value={form.agentName} onChange={(event) => setForm({ ...form, agentName: event.target.value })} /></label>
          <label><span>الموديل</span><input value={form.modelYear} onChange={(event) => setForm({ ...form, modelYear: event.target.value })} /></label>
          <label><span>اللوحة</span><input value={form.plateNo} onChange={(event) => setForm({ ...form, plateNo: event.target.value })} /></label>
          <label><span>اللون الخارجي</span><input value={form.exteriorColor} onChange={(event) => setForm({ ...form, exteriorColor: event.target.value })} /></label>
          <label><span>اللون الداخلي</span><input value={form.interiorColor} onChange={(event) => setForm({ ...form, interiorColor: event.target.value })} /></label>
          <label><span>اسم الدفعة بالتاريخ</span><input value={form.batchNo} onChange={(event) => setForm({ ...form, batchNo: event.target.value })} /></label>
          <label><span>الموقع *</span><select required value={form.locationId} onChange={(event) => setForm({ ...form, locationId: event.target.value })}><option value="">اختر الموقع</option>{meta?.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>الحالة *</span><select required value={form.statusCode} onChange={(event) => setForm({ ...form, statusCode: event.target.value })}>{meta?.statuses.filter((item) => item.code !== "archived").map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
          <label><span>مصدر السيارة</span><select value={form.sourceType} onChange={(event) => setForm({ ...form, sourceType: event.target.value })}><option value="">غير محدد</option><option value="agency">الوكالة</option><option value="stock">المخزون</option><option value="transfer">نقل داخلي</option></select></label>
        </div>

        {currentStatus?.requires_approvals ? <div className="ops-info-note">هذه الحالة تُنشئ سجل الاعتماد المالي والإداري تلقائيًا، ويتم تنفيذ الاعتماد من تفاصيل السيارة.</div> : null}

        <div className="ops-form-grid three">
          <label><span>ملاحظات الموقع</span><textarea rows={3} value={form.locationNote} onChange={(event) => setForm({ ...form, locationNote: event.target.value })} /></label>
          <label><span>حجز - نواقص - تحديد مكان</span><textarea rows={3} value={form.shortageNote} onChange={(event) => setForm({ ...form, shortageNote: event.target.value })} /></label>
          <label><span>ملاحظات السيارة</span><textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
        </div>

        <fieldset className="ops-checklist-fieldset">
          <legend>محتويات السيارة</legend>
          <div className="ops-checklist-grid">
            {meta?.contents.map((item) => (
              <label key={item.key} className={form.contents[item.key] ? "checked" : ""}>
                <input type="checkbox" checked={Boolean(form.contents[item.key])} onChange={(event) => setForm({ ...form, contents: { ...form.contents, [item.key]: event.target.checked } })} />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="ops-form-actions">
          <button type="button" className="ops-button secondary" onClick={onClose}>إلغاء</button>
          <button type="submit" className="ops-button primary" disabled={saving}><FloppyDisk size={19} />{saving ? "جاري الحفظ..." : "حفظ السيارة"}</button>
        </div>
      </form>
    </OperationsModal>
  );
}
