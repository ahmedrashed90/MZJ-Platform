import { useCallback, useEffect, useState } from "react";
import { CheckCircle, FloppyDisk, MapPin, Plus, WarningCircle, Wrench } from "@phosphor-icons/react";
import { operationsFetch } from "../api";

type Branch = { id: string; code: string; name: string };
type LocationRow = {
  id: string;
  code: string;
  name: string;
  location_type: string;
  branch_id: string | null;
  branch_name: string | null;
  sort_order: number;
  is_active: boolean;
};
type StatusRow = {
  code: string;
  name: string;
  sort_order: number;
  counts_in_actual_inventory: boolean;
  requires_approvals: boolean;
  allows_archive: boolean;
  is_active: boolean;
};

type SettingsResponse = { ok: boolean; locations: LocationRow[]; statuses: StatusRow[]; branches: Branch[] };

const newLocation: LocationRow = { id: "", code: "", name: "", location_type: "branch", branch_id: null, branch_name: null, sort_order: 0, is_active: true };
const newStatus: StatusRow = { code: "", name: "", sort_order: 0, counts_in_actual_inventory: true, requires_approvals: false, allows_archive: false, is_active: true };

export function OperationsSettingsPanel() {
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [statuses, setStatuses] = useState<StatusRow[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [locationForm, setLocationForm] = useState<LocationRow>(newLocation);
  const [statusForm, setStatusForm] = useState<StatusRow>(newStatus);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await operationsFetch<SettingsResponse>("/api/operations/settings");
      setLocations(payload.locations || []);
      setStatuses(payload.statuses || []);
      setBranches(payload.branches || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل إعدادات العمليات");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function saveLocation(event: React.FormEvent) {
    event.preventDefault();
    setSaving("location");
    setError("");
    setMessage("");
    try {
      const payload = await operationsFetch<{ ok: boolean; message: string }>("/api/operations/settings", {
        method: "POST",
        body: JSON.stringify({
          action: "save_location",
          id: locationForm.id,
          code: locationForm.code,
          name: locationForm.name,
          locationType: locationForm.location_type,
          branchId: locationForm.branch_id,
          sortOrder: locationForm.sort_order,
          isActive: locationForm.is_active,
        }),
      });
      setMessage(payload.message);
      setLocationForm(newLocation);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "تعذر حفظ الموقع");
    } finally {
      setSaving("");
    }
  }

  async function saveStatus(event: React.FormEvent) {
    event.preventDefault();
    setSaving("status");
    setError("");
    setMessage("");
    try {
      const payload = await operationsFetch<{ ok: boolean; message: string }>("/api/operations/settings", {
        method: "POST",
        body: JSON.stringify({
          action: "save_status",
          code: statusForm.code,
          name: statusForm.name,
          sortOrder: statusForm.sort_order,
          countsInActualInventory: statusForm.counts_in_actual_inventory,
          requiresApprovals: statusForm.requires_approvals,
          allowsArchive: statusForm.allows_archive,
          isActive: statusForm.is_active,
        }),
      });
      setMessage(payload.message);
      setStatusForm(newStatus);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "تعذر حفظ الحالة");
    } finally {
      setSaving("");
    }
  }

  return (
    <div className="ops-settings-panel">
      {error ? <div className="ops-error"><WarningCircle size={19} weight="fill" /><span>{error}</span></div> : null}
      {message ? <div className="ops-success"><CheckCircle size={19} weight="fill" /><span>{message}</span></div> : null}
      <div className="ops-settings-grid">
        <section className="panel ops-settings-card">
          <div className="ops-section-heading"><MapPin size={23} weight="duotone" /><div><h2>المواقع التشغيلية</h2><p>المستودع والوكالة والفروع المستخدمة في المخزون والحركات.</p></div></div>
          <div className="ops-settings-list">
            {locations.map((item) => <button type="button" key={item.id} onClick={() => setLocationForm(item)} className={locationForm.id === item.id ? "active" : ""}><div><strong>{item.name}</strong><span>{item.code} • {item.location_type} • {item.branch_name || "غير مرتبط بفرع"}</span></div><small>{item.is_active ? "فعال" : "موقوف"}</small></button>)}
          </div>
          <form className="ops-settings-form" onSubmit={saveLocation}>
            <div className="ops-settings-form-head"><strong>{locationForm.id ? "تعديل الموقع" : "إضافة موقع"}</strong>{locationForm.id ? <button type="button" className="ops-text-button" onClick={() => setLocationForm(newLocation)}><Plus size={15} />موقع جديد</button> : null}</div>
            <div className="ops-form-grid two"><label><span>الكود</span><input required value={locationForm.code} onChange={(event) => setLocationForm({ ...locationForm, code: event.target.value })} disabled={Boolean(locationForm.id)} /></label><label><span>الاسم</span><input required value={locationForm.name} onChange={(event) => setLocationForm({ ...locationForm, name: event.target.value })} /></label></div>
            <div className="ops-form-grid three"><label><span>نوع الموقع</span><select value={locationForm.location_type} onChange={(event) => setLocationForm({ ...locationForm, location_type: event.target.value })}><option value="branch">فرع</option><option value="warehouse">مستودع</option><option value="agency">وكالة</option><option value="other">أخرى</option></select></label><label><span>الفرع المرتبط</span><select value={locationForm.branch_id || ""} onChange={(event) => setLocationForm({ ...locationForm, branch_id: event.target.value || null })}><option value="">بدون ربط</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label><span>الترتيب</span><input type="number" value={locationForm.sort_order} onChange={(event) => setLocationForm({ ...locationForm, sort_order: Number(event.target.value) })} /></label></div>
            <label className="ops-checkbox-line"><input type="checkbox" checked={locationForm.is_active} onChange={(event) => setLocationForm({ ...locationForm, is_active: event.target.checked })} /><span>الموقع فعال</span></label>
            <button type="submit" className="ops-button primary" disabled={saving === "location"}><FloppyDisk size={18} />{saving === "location" ? "جاري الحفظ..." : "حفظ الموقع"}</button>
          </form>
        </section>

        <section className="panel ops-settings-card">
          <div className="ops-section-heading"><Wrench size={23} weight="duotone" /><div><h2>حالات السيارات</h2><p>تعريف الحالات التي تدخل في المخزون الفعلي والاعتمادات والأرشفة.</p></div></div>
          <div className="ops-settings-list">
            {statuses.map((item) => <button type="button" key={item.code} onClick={() => setStatusForm(item)} className={statusForm.code === item.code ? "active" : ""}><div><strong>{item.name}</strong><span>{item.code} • {item.counts_in_actual_inventory ? "داخل المخزون" : "خارج المخزون"}</span></div><small>{item.is_active ? "فعال" : "موقوف"}</small></button>)}
          </div>
          <form className="ops-settings-form" onSubmit={saveStatus}>
            <div className="ops-settings-form-head"><strong>{statuses.some((item) => item.code === statusForm.code) ? "تعديل الحالة" : "إضافة حالة"}</strong>{statusForm.code ? <button type="button" className="ops-text-button" onClick={() => setStatusForm(newStatus)}><Plus size={15} />حالة جديدة</button> : null}</div>
            <div className="ops-form-grid three"><label><span>الكود</span><input required value={statusForm.code} onChange={(event) => setStatusForm({ ...statusForm, code: event.target.value })} disabled={statuses.some((item) => item.code === statusForm.code)} /></label><label><span>الاسم</span><input required value={statusForm.name} onChange={(event) => setStatusForm({ ...statusForm, name: event.target.value })} /></label><label><span>الترتيب</span><input type="number" value={statusForm.sort_order} onChange={(event) => setStatusForm({ ...statusForm, sort_order: Number(event.target.value) })} /></label></div>
            <div className="ops-settings-checks"><label><input type="checkbox" checked={statusForm.counts_in_actual_inventory} onChange={(event) => setStatusForm({ ...statusForm, counts_in_actual_inventory: event.target.checked })} /><span>تدخل في المخزون الفعلي</span></label><label><input type="checkbox" checked={statusForm.requires_approvals} onChange={(event) => setStatusForm({ ...statusForm, requires_approvals: event.target.checked })} /><span>تتطلب اعتمادًا</span></label><label><input type="checkbox" checked={statusForm.allows_archive} onChange={(event) => setStatusForm({ ...statusForm, allows_archive: event.target.checked })} /><span>تسمح بالأرشفة</span></label><label><input type="checkbox" checked={statusForm.is_active} onChange={(event) => setStatusForm({ ...statusForm, is_active: event.target.checked })} /><span>الحالة فعالة</span></label></div>
            <button type="submit" className="ops-button primary" disabled={saving === "status"}><FloppyDisk size={18} />{saving === "status" ? "جاري الحفظ..." : "حفظ الحالة"}</button>
          </form>
        </section>
      </div>
      {loading ? <div className="ops-loading-row">جاري تحميل إعدادات العمليات...</div> : null}
    </div>
  );
}
