import { useEffect, useMemo, useState } from "react";
import { Archive, CheckCircle, FloppyDisk, X } from "@phosphor-icons/react";
import { useEscapeToClose } from "../../components/useEscapeToClose";
import { formatOperationsDate, operationsFetch, operationsQuery } from "../api";
import { useOperations } from "./OperationsState";
import type { Vehicle } from "../types";

type FormState = {
  vin: string;
  carName: string;
  statement: string;
  agentName: string;
  exteriorColor: string;
  interiorColor: string;
  modelYear: string;
  plateNo: string;
  batchNo: string;
  locationCode: string;
  statusCode: string;
  sourceType: string;
  locationNote: string;
  shortageNote: string;
  carNote: string;
  trackingUrl: string;
  checklist: Record<string, boolean>;
  financialApproved: boolean;
  administrativeApproved: boolean;
  financialNote: string;
  administrativeNote: string;
};

const emptyForm: FormState = {
  vin: "", carName: "", statement: "", agentName: "", exteriorColor: "", interiorColor: "", modelYear: "", plateNo: "", batchNo: "",
  locationCode: "", statusCode: "available_for_sale", sourceType: "", locationNote: "", shortageNote: "", carNote: "", trackingUrl: "", checklist: {},
  financialApproved: false, administrativeApproved: false, financialNote: "", administrativeNote: "",
};

function fromVehicle(vehicle: Vehicle): FormState {
  return {
    vin: vehicle.vin || "",
    carName: vehicle.car_name || "",
    statement: vehicle.statement || "",
    agentName: vehicle.agent_name || "",
    exteriorColor: vehicle.exterior_color || "",
    interiorColor: vehicle.interior_color || "",
    modelYear: vehicle.model_year || "",
    plateNo: vehicle.plate_no || "",
    batchNo: vehicle.batch_no || "",
    locationCode: vehicle.location_code || "",
    statusCode: vehicle.status_code || "available_for_sale",
    sourceType: vehicle.source_type || "",
    locationNote: vehicle.location_note || "",
    shortageNote: vehicle.shortage_note || "",
    carNote: vehicle.car_note || vehicle.notes || "",
    trackingUrl: vehicle.tracking_url || "",
    checklist: vehicle.checklist || {},
    financialApproved: Boolean(vehicle.financial_approved),
    administrativeApproved: Boolean(vehicle.administrative_approved),
    financialNote: vehicle.financial_note || "",
    administrativeNote: vehicle.administrative_note || "",
  };
}

export function VehicleEditorModal({ vehicleId, onClose, onSaved }: { vehicleId?: string | null; onClose: () => void; onSaved: () => void }) {
  const { meta } = useOperations();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(Boolean(vehicleId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [details, setDetails] = useState<string[]>([]);
  useEscapeToClose(true, onClose);

  useEffect(() => {
    if (!vehicleId) {
      setForm({ ...emptyForm, locationCode: meta?.locations[0]?.code || "", statusCode: meta?.statuses[0]?.code || "available_for_sale" });
      return;
    }
    let cancelled = false;
    setLoading(true);
    operationsFetch<{ ok: true; vehicle: Vehicle }>(`/api/operations${operationsQuery({ resource: "vehicle", id: vehicleId })}`)
      .then((response) => {
        if (cancelled) return;
        setVehicle(response.vehicle);
        setForm(fromVehicle(response.vehicle));
      })
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : "تعذر تحميل السيارة"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [vehicleId, meta]);

  const canSave = vehicleId ? meta?.permissions.canUpdateVehicles : meta?.permissions.canCreateVehicles;
  const canArchive = Boolean(vehicleId && meta?.permissions.canArchiveVehicles && !vehicle?.is_archived);
  const title = vehicleId ? `تعديل السيارة ${vehicle?.vin || ""}` : "إضافة سيارة جديدة";
  const archiveChecks = useMemo(() => {
    if (!vehicle) return [];
    return [
      { label: "الحالة مباع تم التسليم", ok: form.statusCode === "delivered" },
      { label: "الموافقة المالية", ok: form.financialApproved },
      { label: "الموافقة الإدارية", ok: form.administrativeApproved },
      { label: "وجود حركة مسجلة", ok: Number(vehicle.movements_count || vehicle.movements?.length || 0) > 0 },
      { label: "مرتبط بالتتبع", ok: vehicle.has_tracking || Boolean(form.trackingUrl) },
    ];
  }, [vehicle, form]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (!canSave) return;
    setSaving(true); setError(""); setDetails([]);
    try {
      await operationsFetch("/api/operations", {
        method: "POST",
        body: JSON.stringify({
          action: "saveVehicle", id: vehicleId || undefined, ...form,
          approval: {
            financialApproved: form.financialApproved,
            administrativeApproved: form.administrativeApproved,
            financialNote: form.financialNote,
            administrativeNote: form.administrativeNote,
          },
        }),
      });
      onSaved();
      onClose();
    } catch (saveError) {
      const typed = saveError as Error & { details?: string[] };
      setError(typed.message);
      setDetails(typed.details || []);
    } finally { setSaving(false); }
  }

  async function archive() {
    if (!vehicleId || !canArchive) return;
    setSaving(true); setError(""); setDetails([]);
    try {
      await operationsFetch("/api/operations", { method: "POST", body: JSON.stringify({ action: "archiveVehicle", vehicleId }) });
      onSaved(); onClose();
    } catch (archiveError) {
      const typed = archiveError as Error & { details?: string[] };
      setError(typed.message); setDetails(typed.details || []);
    } finally { setSaving(false); }
  }

  return (
    <div className="crm-modal-backdrop operations-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="crm-modal-card operations-vehicle-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <div><span className="operations-kicker">إدارة المخزون</span><h2>{title}</h2><p>بيانات السيارة والتشييك والموافقات وسجل الحركة في ملف واحد.</p></div>
          <button type="button" className="operations-icon-button" onClick={onClose} aria-label="إغلاق"><X size={20} /></button>
        </header>
        {error ? <div className="operations-alert error"><strong>{error}</strong>{details.length ? <ul>{details.map((item) => <li key={item}>{item}</li>)}</ul> : null}</div> : null}
        {loading ? <div className="operations-loading">جاري تحميل بيانات السيارة...</div> : (
          <div className="operations-modal-scroll">
            <section className="operations-form-section">
              <div className="operations-section-title"><h3>البيانات الأساسية</h3><span>VIN هو المعرف الفريد للسيارة</span></div>
              <div className="operations-form-grid">
                <label><span>رقم الهيكل *</span><input value={form.vin} onChange={(e) => setField("vin", e.target.value.toUpperCase())} /></label>
                <label><span>السيارة</span><input value={form.carName} onChange={(e) => setField("carName", e.target.value)} /></label>
                <label><span>البيان</span><input value={form.statement} onChange={(e) => setField("statement", e.target.value)} /></label>
                <label><span>الوكيل</span><input value={form.agentName} onChange={(e) => setField("agentName", e.target.value)} /></label>
                <label><span>الموديل</span><input value={form.modelYear} onChange={(e) => setField("modelYear", e.target.value)} /></label>
                <label><span>اللون الخارجي</span><input value={form.exteriorColor} onChange={(e) => setField("exteriorColor", e.target.value)} /></label>
                <label><span>اللون الداخلي</span><input list="operations-interior-colors" value={form.interiorColor} onChange={(e) => setField("interiorColor", e.target.value)} /><datalist id="operations-interior-colors">{meta?.interiorColors.map((color) => <option key={color.id} value={color.name} />)}</datalist></label>
                <label><span>اللوحة</span><input value={form.plateNo} onChange={(e) => setField("plateNo", e.target.value)} /></label>
                <label><span>الدفعة</span><input value={form.batchNo} onChange={(e) => setField("batchNo", e.target.value)} /></label>
                <label><span>المكان *</span><select value={form.locationCode} onChange={(e) => setField("locationCode", e.target.value)}><option value="">اختر المكان</option>{meta?.locations.map((location) => <option key={location.id} value={location.code}>{location.name}</option>)}</select></label>
                <label><span>الحالة *</span><select value={form.statusCode} onChange={(e) => setField("statusCode", e.target.value)}>{meta?.statuses.map((status) => <option key={status.code} value={status.code}>{status.label}</option>)}</select></label>
                <label><span>نوع المصدر</span><input value={form.sourceType} onChange={(e) => setField("sourceType", e.target.value)} placeholder="مثال: وكالة" /></label>
              </div>
            </section>

            <section className="operations-form-section">
              <div className="operations-section-title"><h3>الملاحظات والربط</h3><span>كل نوع ملاحظة محفوظ بصورة مستقلة</span></div>
              <div className="operations-form-grid two">
                <label><span>ملاحظة تحديد المكان</span><textarea value={form.locationNote} onChange={(e) => setField("locationNote", e.target.value)} /></label>
                <label><span>ملاحظات النواقص</span><textarea value={form.shortageNote} onChange={(e) => setField("shortageNote", e.target.value)} /></label>
                <label><span>ملاحظات السيارة</span><textarea value={form.carNote} onChange={(e) => setField("carNote", e.target.value)} /></label>
                <label><span>رابط تتبع قديم - اختياري</span><textarea value={form.trackingUrl} onChange={(e) => setField("trackingUrl", e.target.value)} /></label>
              </div>
            </section>

            <section className="operations-form-section">
              <div className="operations-section-title"><h3>تشييك السيارة</h3><span>يُستخدم عند خروج السيارة من الوكالة</span></div>
              <div className="operations-checklist-grid">
                {meta?.checklistItems.map((item) => (
                  <label key={item.key} className={form.checklist[item.key] ? "checked" : ""}>
                    <input type="checkbox" checked={Boolean(form.checklist[item.key])} onChange={(e) => setField("checklist", { ...form.checklist, [item.key]: e.target.checked })} />
                    <span>{item.label}</span><CheckCircle size={18} weight={form.checklist[item.key] ? "fill" : "regular"} />
                  </label>
                ))}
              </div>
            </section>

            <section className="operations-form-section">
              <div className="operations-section-title"><h3>الموافقات</h3><span>التسليم النهائي يتطلب الموافقتين</span></div>
              <div className="operations-approval-grid">
                <article className={form.financialApproved ? "approved" : ""}>
                  <label className="operations-toggle"><input type="checkbox" disabled={!meta?.permissions.canManageApprovals} checked={form.financialApproved} onChange={(e) => setField("financialApproved", e.target.checked)} /><span>الموافقة المالية</span></label>
                  <textarea disabled={!meta?.permissions.canManageApprovals} value={form.financialNote} onChange={(e) => setField("financialNote", e.target.value)} placeholder="ملاحظة الموافقة المالية" />
                </article>
                <article className={form.administrativeApproved ? "approved" : ""}>
                  <label className="operations-toggle"><input type="checkbox" disabled={!meta?.permissions.canManageApprovals} checked={form.administrativeApproved} onChange={(e) => setField("administrativeApproved", e.target.checked)} /><span>الموافقة الإدارية</span></label>
                  <textarea disabled={!meta?.permissions.canManageApprovals} value={form.administrativeNote} onChange={(e) => setField("administrativeNote", e.target.value)} placeholder="ملاحظة الموافقة الإدارية" />
                </article>
              </div>
            </section>

            {vehicleId && vehicle ? (
              <section className="operations-form-section">
                <div className="operations-section-title"><h3>جاهزية الأرشفة</h3><span>الأرشفة Soft Archive ولا تحذف السجل</span></div>
                <div className="operations-archive-checks">{archiveChecks.map((check) => <span key={check.label} className={check.ok ? "ok" : "missing"}>{check.ok ? "✓" : "×"} {check.label}</span>)}</div>
              </section>
            ) : null}

            {vehicle?.movements?.length ? (
              <section className="operations-form-section">
                <div className="operations-section-title"><h3>آخر الحركات</h3><span>{vehicle.movements.length} حركة ظاهرة</span></div>
                <div className="operations-mini-timeline">{vehicle.movements.slice(0, 10).map((movement) => <article key={movement.id}><b>{movement.from_location_name || "—"} ← {movement.to_location_name || "—"}</b><span>{movement.performed_by_name || "مستخدم"} · {formatOperationsDate(movement.created_at)}</span><small>{movement.note || "بدون ملاحظة"}</small></article>)}</div>
              </section>
            ) : null}
          </div>
        )}
        <footer className="operations-modal-footer">
          <div>{canArchive ? <button type="button" className="operations-danger-button" disabled={saving} onClick={() => void archive()}><Archive size={18} />أرشفة السيارة</button> : null}</div>
          <div><button type="button" className="operations-secondary-button" onClick={onClose}>إلغاء</button><button type="button" className="operations-primary-button" disabled={saving || loading || !canSave} onClick={() => void save()}><FloppyDisk size={18} />{saving ? "جاري الحفظ..." : "حفظ البيانات"}</button></div>
        </footer>
      </div>
    </div>
  );
}
