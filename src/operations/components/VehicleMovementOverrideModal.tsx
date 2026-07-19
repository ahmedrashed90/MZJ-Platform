import { useEffect, useState } from "react";
import { useOperations } from "../OperationsContext";
import type { OperationsVehicle, VehicleContents } from "../types";
import { OperationsModal } from "./OperationsOverlay";

type Override = {
  interiorColor?: string;
  locationNote?: string;
  shortageNote?: string;
  contents?: VehicleContents;
};

export function VehicleMovementOverrideModal({
  open,
  vehicle,
  value,
  onClose,
  onSave,
}: {
  open: boolean;
  vehicle: OperationsVehicle | null;
  value?: Override;
  onClose: () => void;
  onSave: (value: Override) => void;
}) {
  const { meta } = useOperations();
  const [form, setForm] = useState<Override>({});

  useEffect(() => {
    if (!open || !vehicle) return;
    setForm({
      interiorColor: value?.interiorColor ?? vehicle.interior_color ?? "",
      locationNote: value?.locationNote ?? vehicle.location_note ?? "",
      shortageNote: value?.shortageNote ?? vehicle.shortage_note ?? "",
      contents: { ...(vehicle.contents || {}), ...(value?.contents || {}) },
    });
  }, [open, value, vehicle]);

  return (
    <OperationsModal open={open} title={vehicle ? `بيانات حركة ${vehicle.vin}` : "بيانات الحركة"} description="تُستخدم هذه البيانات عند خروج السيارة من الوكالة أو عند تحديث محتوياتها أثناء الحركة." onClose={onClose}>
      {vehicle ? <div className="ops-override-form">
        <label className="ops-field"><span>اللون الداخلي</span><input value={form.interiorColor || ""} onChange={(event) => setForm({ ...form, interiorColor: event.target.value })} /></label>
        <div className="ops-form-grid two">
          <label><span>ملاحظات الموقع</span><textarea rows={3} value={form.locationNote || ""} onChange={(event) => setForm({ ...form, locationNote: event.target.value })} /></label>
          <label><span>حجز - نواقص - تحديد مكان</span><textarea rows={3} value={form.shortageNote || ""} onChange={(event) => setForm({ ...form, shortageNote: event.target.value })} /></label>
        </div>
        <fieldset className="ops-checklist-fieldset">
          <legend>محتويات السيارة</legend>
          <div className="ops-checklist-grid">
            {meta?.contents.map((item) => {
              const checked = Boolean(form.contents?.[item.key]);
              return <label key={item.key} className={checked ? "checked" : ""}><input type="checkbox" checked={checked} onChange={(event) => setForm({ ...form, contents: { ...(form.contents || {}), [item.key]: event.target.checked } })} /><span>{item.label}</span></label>;
            })}
          </div>
        </fieldset>
        <div className="ops-form-actions"><button type="button" className="ops-button secondary" onClick={onClose}>إلغاء</button><button type="button" className="ops-button primary" onClick={() => { onSave(form); onClose(); }}>حفظ بيانات السيارة</button></div>
      </div> : null}
    </OperationsModal>
  );
}
