import { useState } from "react";
import { ArrowCircleLeft, CheckCircle, MagnifyingGlass, SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import { operationsFetch, operationsQuery } from "../api";
import { useOperations } from "../components/OperationsState";
import type { Vehicle } from "../types";

function parseVins(value: string) {
  return Array.from(new Set(value.split(/[\n,،\s]+/).map((item) => item.trim().toUpperCase()).filter(Boolean)));
}

export function OperationsMovementPage() {
  const { meta, loading, error: metaError } = useOperations();
  const [vinText, setVinText] = useState("");
  const [destination, setDestination] = useState("");
  const [status, setStatus] = useState("available_for_sale");
  const [note, setNote] = useState("");
  const [locationNote, setLocationNote] = useState("");
  const [shortageNote, setShortageNote] = useState("");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [agencyData, setAgencyData] = useState<Record<string, { interiorColor: string; checklist: Record<string, boolean> }>>({});
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  async function validate() {
    const vins = parseVins(vinText);
    if (!vins.length) { setMessage({ type: "error", text: "أضف رقم هيكل واحدًا على الأقل" }); return; }
    setChecking(true); setMessage(null); setVehicles([]);
    try {
      const results = await Promise.all(vins.map(async (vin) => {
        try {
          const response = await operationsFetch<{ ok: true; vehicle: Vehicle }>(`/api/operations${operationsQuery({ resource: "vehicle", vin })}`);
          return response.vehicle;
        } catch { return null; }
      }));
      const found = results.filter(Boolean) as Vehicle[];
      const foundVins = new Set(found.map((item) => item.vin.toUpperCase()));
      const missing = vins.filter((vin) => !foundVins.has(vin));
      if (missing.length) {
        setVehicles([]);
        setAgencyData({});
        setMessage({ type: "error", text: `أرقام هياكل غير موجودة: ${missing.join("، ")}. لم يتم اعتماد أي سيارة للتنفيذ.` });
      } else {
        const initial: Record<string, { interiorColor: string; checklist: Record<string, boolean> }> = {};
        found.forEach((vehicle) => { initial[vehicle.vin] = { interiorColor: vehicle.interior_color || "", checklist: vehicle.checklist || {} }; });
        setVehicles(found);
        setAgencyData(initial);
        setMessage({ type: "success", text: `تم التحقق من ${found.length} سيارة وجاهزة لتنفيذ الحركة.` });
      }
    } finally { setChecking(false); }
  }

  async function execute() {
    if (!vehicles.length) { setMessage({ type: "error", text: "تحقق من السيارات قبل تنفيذ الحركة" }); return; }
    if (!destination || !status) { setMessage({ type: "error", text: "حدد المكان والحالة الجديدة" }); return; }
    setSubmitting(true); setMessage(null);
    try {
      await operationsFetch("/api/operations", {
        method: "POST",
        body: JSON.stringify({ action: "executeMovement", vins: vehicles.map((vehicle) => vehicle.vin), destinationLocationCode: destination, statusCode: status, note, locationNote, shortageNote, agencyData }),
      });
      setMessage({ type: "success", text: `تم تنفيذ الحركة بنجاح على ${vehicles.length} سيارة وتسجيل كل الحركات.` });
      setVinText(""); setVehicles([]); setAgencyData({}); setNote(""); setLocationNote(""); setShortageNote("");
    } catch (executeError) {
      setMessage({ type: "error", text: executeError instanceof Error ? executeError.message : "تعذر تنفيذ الحركة" });
    } finally { setSubmitting(false); }
  }

  if (loading) return <div className="operations-loading-page">جاري تحميل الصفحة...</div>;
  if (metaError || !meta) return <div className="operations-alert error">{metaError || "تعذر تحميل الصفحة"}</div>;

  return (
    <div className="operations-page">
      <header className="operations-page-head"><div><span className="operations-kicker">حركة مباشرة</span><h1>نقل وتغيير حالة السيارات</h1><p>كل السيارات تُحدّث داخل Transaction واحدة؛ عند فشل أي سيارة لا تُنفذ الحركة على الباقي.</p></div></header>
      {message ? <div className={`operations-alert ${message.type}`}>{message.type === "error" ? <WarningCircle size={19} /> : <CheckCircle size={19} />}<span>{message.text}</span></div> : null}
      <section className="operations-movement-layout">
        <div className="operations-form-card">
          <div className="operations-section-title"><h2>1. أرقام الهياكل</h2><span>سطر لكل VIN أو افصل بفاصلة</span></div>
          <textarea className="operations-vin-textarea" value={vinText} onChange={(event) => { setVinText(event.target.value.toUpperCase()); setVehicles([]); }} placeholder={"VIN001\nVIN002\nVIN003"} />
          <button type="button" className="operations-secondary-button full" disabled={checking} onClick={() => void validate()}>{checking ? <SpinnerGap className="spin" size={18} /> : <MagnifyingGlass size={18} />}{checking ? "جاري التحقق..." : "التحقق من السيارات"}</button>
        </div>
        <div className="operations-form-card">
          <div className="operations-section-title"><h2>2. الحركة الجديدة</h2><span>المكان والحالة والملاحظات</span></div>
          <div className="operations-form-grid one">
            <label><span>المكان المستهدف *</span><select value={destination} onChange={(event) => setDestination(event.target.value)}><option value="">اختر المكان</option>{meta.locations.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select></label>
            <label><span>الحالة الجديدة *</span><select value={status} onChange={(event) => setStatus(event.target.value)}>{meta.statuses.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
            <label><span>ملاحظة الحركة</span><textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>
            <label><span>ملاحظة تحديد المكان</span><textarea value={locationNote} onChange={(event) => setLocationNote(event.target.value)} /></label>
            <label><span>ملاحظات النواقص</span><textarea value={shortageNote} onChange={(event) => setShortageNote(event.target.value)} /></label>
          </div>
        </div>
      </section>

      {vehicles.length ? <section className="operations-verified-list">
        <div className="operations-section-title"><h2>3. السيارات التي سيتم تحريكها</h2><span>{vehicles.length} سيارة</span></div>
        <div className="operations-verified-grid">{vehicles.map((vehicle) => {
          const fromAgency = vehicle.location_code === "agency";
          const data = agencyData[vehicle.vin] || { interiorColor: vehicle.interior_color || "", checklist: vehicle.checklist || {} };
          return <article key={vehicle.id}>
            <header><div><strong>{vehicle.vin}</strong><span>{vehicle.car_name || "سيارة بدون اسم"} · {vehicle.model_year || "—"}</span></div><span className="operations-location-badge">{vehicle.location_name || "غير محدد"}</span></header>
            <div className="operations-car-transition"><span>{vehicle.location_name || "—"}</span><ArrowCircleLeft size={22} /><span>{meta.locations.find((item) => item.code === destination)?.name || "المكان الجديد"}</span></div>
            {fromAgency ? <div className="operations-agency-check"><label><span>اللون الداخلي عند الخروج</span><input value={data.interiorColor} onChange={(event) => setAgencyData((current) => ({ ...current, [vehicle.vin]: { ...data, interiorColor: event.target.value } }))} /></label><div>{meta.checklistItems.map((item) => <label key={item.key} className={data.checklist[item.key] ? "checked" : ""}><input type="checkbox" checked={Boolean(data.checklist[item.key])} onChange={(event) => setAgencyData((current) => ({ ...current, [vehicle.vin]: { ...data, checklist: { ...data.checklist, [item.key]: event.target.checked } } }))} /><span>{item.label}</span></label>)}</div></div> : null}
          </article>;
        })}</div>
        <div className="operations-submit-bar"><span>سيتم تسجيل حركة مستقلة لكل سيارة باسم المستخدم الحالي.</span><button type="button" className="operations-primary-button" disabled={submitting || !meta.permissions.canExecuteMovements} onClick={() => void execute()}>{submitting ? <SpinnerGap className="spin" size={18} /> : <ArrowCircleLeft size={18} />}{submitting ? "جاري التنفيذ..." : "تنفيذ الحركة"}</button></div>
      </section> : null}
    </div>
  );
}
