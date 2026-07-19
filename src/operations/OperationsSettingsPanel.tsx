import { useCallback, useEffect, useState } from "react";
import { CheckCircle, FloppyDisk, MapPin, Plus, WarningCircle } from "@phosphor-icons/react";
import { operationsFetch } from "./api";
import { invalidateOperationsMeta } from "./useOperationsMeta";

type LocationRow = { id: string; code: string; name: string; branch_code: string | null; location_type: string; sort_order: number; is_active: boolean };
type StatusRow = { code: string; name: string; sort_order: number; is_inventory: boolean; requires_status_note: boolean; starts_delivery_cycle: boolean; is_final_delivery: boolean; is_active: boolean };
type Payload = { ok: true; locations: LocationRow[]; statuses: StatusRow[]; checkItems: Array<{ code: string; name: string; sort_order: number; is_active: boolean }> };

const newLocation: LocationRow = { id: "", code: "", name: "", branch_code: "", location_type: "branch", sort_order: 0, is_active: true };
const newStatus: StatusRow = { code: "", name: "", sort_order: 0, is_inventory: true, requires_status_note: false, starts_delivery_cycle: false, is_final_delivery: false, is_active: true };

export function OperationsSettingsPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [locationForm, setLocationForm] = useState<LocationRow>(newLocation);
  const [statusForm, setStatusForm] = useState<StatusRow>(newStatus);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setData(await operationsFetch<Payload>("/api/operations/settings")); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر تحميل إعدادات العمليات"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function saveLocation(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const payload = await operationsFetch<{ ok: true; message: string }>("/api/operations/settings", { method: "POST", body: JSON.stringify({ action: "save_location", id: locationForm.id, code: locationForm.code, name: locationForm.name, branchCode: locationForm.branch_code, locationType: locationForm.location_type, sortOrder: locationForm.sort_order, isActive: locationForm.is_active }) });
      setMessage(payload.message); setLocationForm(newLocation); invalidateOperationsMeta(); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر حفظ المكان"); }
    finally { setSaving(false); }
  }

  async function saveStatus(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const payload = await operationsFetch<{ ok: true; message: string }>("/api/operations/settings", { method: "POST", body: JSON.stringify({ action: "save_status", code: statusForm.code, name: statusForm.name, sortOrder: statusForm.sort_order, isInventory: statusForm.is_inventory, requiresStatusNote: statusForm.requires_status_note, startsDeliveryCycle: statusForm.starts_delivery_cycle, isFinalDelivery: statusForm.is_final_delivery, isActive: statusForm.is_active }) });
      setMessage(payload.message); setStatusForm(newStatus); invalidateOperationsMeta(); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر حفظ الحالة"); }
    finally { setSaving(false); }
  }

  return (
    <div className="operations-settings">
      {error ? <div className="connection-banner"><WarningCircle size={20} weight="fill" /><span>{error}</span></div> : null}
      {message ? <div className="success-banner"><CheckCircle size={19} weight="fill" /><span>{message}</span></div> : null}
      <div className="operations-settings-grid">
        <section className="panel operations-settings-card">
          <div className="operations-section-title"><MapPin size={23} weight="duotone" /><div><h2>المواقع والفروع</h2><p>إدارة أماكن السيارات وربط كل مكان بكود الفرع.</p></div></div>
          <form className="operations-form-grid" onSubmit={saveLocation}>
            <label><span>كود المكان</span><input required value={locationForm.code} onChange={(event) => setLocationForm({ ...locationForm, code: event.target.value })} /></label>
            <label><span>اسم المكان</span><input required value={locationForm.name} onChange={(event) => setLocationForm({ ...locationForm, name: event.target.value })} /></label>
            <label><span>كود الفرع</span><input value={locationForm.branch_code || ""} onChange={(event) => setLocationForm({ ...locationForm, branch_code: event.target.value })} /></label>
            <label><span>نوع المكان</span><select value={locationForm.location_type} onChange={(event) => setLocationForm({ ...locationForm, location_type: event.target.value })}><option value="branch">فرع</option><option value="agency">وكالة</option><option value="warehouse">مستودع</option><option value="external">خارجي</option></select></label>
            <label><span>الترتيب</span><input type="number" min={0} value={locationForm.sort_order} onChange={(event) => setLocationForm({ ...locationForm, sort_order: Number(event.target.value || 0) })} /></label>
            <label className="operations-inline-check"><input type="checkbox" checked={locationForm.is_active} onChange={(event) => setLocationForm({ ...locationForm, is_active: event.target.checked })} /><span>المكان فعال</span></label>
            <div className="operations-form-actions full"><button type="submit" className="operations-primary" disabled={saving}><FloppyDisk size={17} />حفظ المكان</button><button type="button" className="operations-secondary" onClick={() => setLocationForm(newLocation)}><Plus size={17} />جديد</button></div>
          </form>
          <div className="operations-settings-list">{data?.locations.map((item) => <button type="button" key={item.id} onClick={() => setLocationForm(item)}><strong>{item.name}</strong><span>{item.code} · {item.branch_code || "بدون فرع"} · {item.is_active ? "فعال" : "موقوف"}</span></button>)}</div>
        </section>

        <section className="panel operations-settings-card">
          <div className="operations-section-title"><div><h2>حالات السيارات</h2><p>الحالات Codes ثابتة وأسماؤها العربية تظهر في الواجهة.</p></div></div>
          <form className="operations-form-grid" onSubmit={saveStatus}>
            <label><span>كود الحالة</span><input required value={statusForm.code} onChange={(event) => setStatusForm({ ...statusForm, code: event.target.value })} disabled={Boolean(data?.statuses.some((item) => item.code === statusForm.code))} /></label>
            <label><span>اسم الحالة</span><input required value={statusForm.name} onChange={(event) => setStatusForm({ ...statusForm, name: event.target.value })} /></label>
            <label><span>الترتيب</span><input type="number" min={0} value={statusForm.sort_order} onChange={(event) => setStatusForm({ ...statusForm, sort_order: Number(event.target.value || 0) })} /></label>
            <div className="operations-setting-checks full">
              <label><input type="checkbox" checked={statusForm.is_inventory} onChange={(event) => setStatusForm({ ...statusForm, is_inventory: event.target.checked })} /><span>تدخل في المخزون الفعلي</span></label>
              <label><input type="checkbox" checked={statusForm.requires_status_note} onChange={(event) => setStatusForm({ ...statusForm, requires_status_note: event.target.checked })} /><span>تتطلب ملاحظات حالة</span></label>
              <label><input type="checkbox" checked={statusForm.starts_delivery_cycle} onChange={(event) => setStatusForm({ ...statusForm, starts_delivery_cycle: event.target.checked })} /><span>تبدأ دورة الموافقات</span></label>
              <label><input type="checkbox" checked={statusForm.is_final_delivery} onChange={(event) => setStatusForm({ ...statusForm, is_final_delivery: event.target.checked })} /><span>حالة التسليم النهائي</span></label>
              <label><input type="checkbox" checked={statusForm.is_active} onChange={(event) => setStatusForm({ ...statusForm, is_active: event.target.checked })} /><span>الحالة فعالة</span></label>
            </div>
            <div className="operations-form-actions full"><button type="submit" className="operations-primary" disabled={saving}><FloppyDisk size={17} />حفظ الحالة</button><button type="button" className="operations-secondary" onClick={() => setStatusForm(newStatus)}><Plus size={17} />جديدة</button></div>
          </form>
          <div className="operations-settings-list">{data?.statuses.map((item) => <button type="button" key={item.code} onClick={() => setStatusForm(item)}><strong>{item.name}</strong><span>{item.code} · {item.is_active ? "فعالة" : "موقوفة"}</span></button>)}</div>
        </section>
      </div>
      <section className="panel operations-check-items"><h2>عناصر التشيك المعتمدة</h2><div>{data?.checkItems.map((item) => <span key={item.code}>{item.name}</span>)}</div></section>
    </div>
  );
}
