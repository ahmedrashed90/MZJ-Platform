import { useEffect, useState } from "react";
import { FloppyDisk, MapPin, WarningCircle } from "@phosphor-icons/react";
import { operationsFetch } from "../api";
import type { OperationsMeta } from "../types";

const blankLocation = { id: "", code: "", name: "", branchCode: "", isAgency: false, isActive: true, sortOrder: 0 };
const blankStatus = { code: "", name: "", sortOrder: 0, isActualStock: true, isDeliveryStatus: false, isTerminal: false, isActive: true };

export function OperationsSettingsPanel() {
  const [meta, setMeta] = useState<OperationsMeta | null>(null);
  const [location, setLocation] = useState(blankLocation);
  const [status, setStatus] = useState(blankStatus);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try { setMeta(await operationsFetch<OperationsMeta>("/api/operations?resource=meta")); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل إعدادات العمليات"); }
  }
  useEffect(() => { void load(); }, []);

  async function save(kind: "location" | "status") {
    setSaving(true); setMessage(""); setError("");
    try {
      const body = kind === "location" ? location : status;
      const payload = await operationsFetch<{ message: string }>("/api/operations", { method: "POST", body: JSON.stringify({ action: "save_setting", kind, ...body }) });
      setMessage(payload.message); setLocation(blankLocation); setStatus(blankStatus); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر حفظ الإعداد"); }
    finally { setSaving(false); }
  }

  if (!meta) return <section className="panel operations-settings-panel">{error ? <div className="connection-banner"><WarningCircle size={20} />{error}</div> : "جاري تحميل إعدادات العمليات..."}</section>;
  return <div className="operations-settings-grid">
    {error ? <div className="connection-banner"><WarningCircle size={20} />{error}</div> : null}{message ? <div className="success-banner">{message}</div> : null}
    <section className="panel operations-settings-panel"><div className="settings-card-title"><div><MapPin size={22} weight="duotone" /><h2>المواقع والفروع التشغيلية</h2></div><span>{meta.locations.length}</span></div>
      <div className="operations-settings-list">{meta.locations.map((item) => <button key={item.id} type="button" onClick={() => setLocation({ id: item.id, code: item.code, name: item.name, branchCode: item.branch_code || "", isAgency: Boolean(item.is_agency), isActive: true, sortOrder: Number(item.sort_order || 0) })}><strong>{item.name}</strong><small>{item.code} · {item.branch_code || "بدون فرع"}</small></button>)}</div>
      {meta.permissions.canManageSettings ? <div className="operations-form-grid"><label className="operations-field"><span>الكود</span><input value={location.code} onChange={(e) => setLocation({ ...location, code: e.target.value })} /></label><label className="operations-field"><span>الاسم</span><input value={location.name} onChange={(e) => setLocation({ ...location, name: e.target.value })} /></label><label className="operations-field"><span>كود الفرع</span><input value={location.branchCode} onChange={(e) => setLocation({ ...location, branchCode: e.target.value })} /></label><label className="operations-field"><span>الترتيب</span><input type="number" value={location.sortOrder} onChange={(e) => setLocation({ ...location, sortOrder: Number(e.target.value) })} /></label><label><input type="checkbox" checked={location.isAgency} onChange={(e) => setLocation({ ...location, isAgency: e.target.checked })} /> موقع وكالة</label><button className="operations-primary-button" type="button" disabled={saving || !location.code || !location.name} onClick={() => void save("location")}><FloppyDisk size={18} />حفظ المكان</button></div> : null}
    </section>
    <section className="panel operations-settings-panel"><div className="settings-card-title"><div><MapPin size={22} weight="duotone" /><h2>حالات السيارات</h2></div><span>{meta.statuses.length}</span></div>
      <div className="operations-settings-list">{meta.statuses.map((item) => <button key={item.code} type="button" onClick={() => setStatus({ code: item.code, name: item.name, sortOrder: Number(item.sort_order || 0), isActualStock: Boolean(item.is_actual_stock), isDeliveryStatus: Boolean(item.is_delivery_status), isTerminal: Boolean(item.is_terminal), isActive: true })}><strong>{item.name}</strong><small>{item.code}</small></button>)}</div>
      {meta.permissions.canManageSettings ? <div className="operations-form-grid"><label className="operations-field"><span>الكود</span><input value={status.code} disabled={meta.statuses.some((item) => item.code === status.code)} onChange={(e) => setStatus({ ...status, code: e.target.value })} /></label><label className="operations-field"><span>الاسم</span><input value={status.name} onChange={(e) => setStatus({ ...status, name: e.target.value })} /></label><label className="operations-field"><span>الترتيب</span><input type="number" value={status.sortOrder} onChange={(e) => setStatus({ ...status, sortOrder: Number(e.target.value) })} /></label><div className="operations-setting-checks"><label><input type="checkbox" checked={status.isActualStock} onChange={(e) => setStatus({ ...status, isActualStock: e.target.checked })} /> يدخل في الإجمالي الفعلي</label><label><input type="checkbox" checked={status.isDeliveryStatus} onChange={(e) => setStatus({ ...status, isDeliveryStatus: e.target.checked })} /> حالة تسليم</label><label><input type="checkbox" checked={status.isTerminal} onChange={(e) => setStatus({ ...status, isTerminal: e.target.checked })} /> حالة نهائية</label></div><button className="operations-primary-button" type="button" disabled={saving || !status.code || !status.name} onClick={() => void save("status")}><FloppyDisk size={18} />حفظ الحالة</button></div> : null}
    </section>
  </div>;
}
