import { useEffect, useState } from "react";
import { FloppyDisk, MapPin, Palette, Tag } from "@phosphor-icons/react";
import { operationsFetch } from "../api";
import type { OperationsMeta } from "../types";

export function OperationsSettingsPanel() {
  const [meta, setMeta] = useState<OperationsMeta | null>(null);
  const [location, setLocation] = useState({ code: "", name: "", sortOrder: 0 });
  const [status, setStatus] = useState({ code: "", label: "", sortOrder: 0 });
  const [color, setColor] = useState({ name: "", sortOrder: 0 });
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const response = await operationsFetch<{ ok: true } & OperationsMeta>("/api/operations?resource=meta");
      setMeta(response);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "تعذر تحميل إعدادات العمليات"); }
  }
  useEffect(() => { void load(); }, []);

  async function save(kind: "location" | "status" | "color", payload: Record<string, unknown>) {
    setSaving(kind); setError(""); setMessage("");
    try {
      await operationsFetch("/api/operations", { method: "POST", body: JSON.stringify({ action: "updateSettings", kind, ...payload }) });
      setMessage("تم حفظ إعداد العمليات بنجاح");
      if (kind === "location") setLocation({ code: "", name: "", sortOrder: 0 });
      if (kind === "status") setStatus({ code: "", label: "", sortOrder: 0 });
      if (kind === "color") setColor({ name: "", sortOrder: 0 });
      await load();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "تعذر حفظ الإعداد"); }
    finally { setSaving(""); }
  }

  if (!meta && !error) return <div className="operations-loading-page">جاري تحميل إعدادات العمليات...</div>;
  if (error && !meta) return <div className="operations-alert error">{error}</div>;
  if (!meta?.permissions.canManageSettings) return <div className="operations-alert error">ليست لديك صلاحية إدارة إعدادات العمليات.</div>;

  return <div className="operations-settings-panel">{error ? <div className="operations-alert error">{error}</div> : null}{message ? <div className="operations-alert success">{message}</div> : null}<section className="panel operations-settings-card"><header><MapPin size={24} weight="duotone" /><div><h2>أماكن السيارات</h2><p>الأماكن المستخدمة في المخزون والحركة وطلبات النقل.</p></div></header><div className="operations-settings-list">{meta.locations.map((item) => <button type="button" key={item.id} onClick={() => setLocation({ code: item.code, name: item.name, sortOrder: item.sort_order })}><strong>{item.name}</strong><small>{item.code}</small></button>)}</div><div className="operations-settings-form"><label><span>الكود الإنجليزي</span><input value={location.code} onChange={(event) => setLocation({ ...location, code: event.target.value })} /></label><label><span>الاسم</span><input value={location.name} onChange={(event) => setLocation({ ...location, name: event.target.value })} /></label><label><span>الترتيب</span><input type="number" value={location.sortOrder} onChange={(event) => setLocation({ ...location, sortOrder: Number(event.target.value) })} /></label><button type="button" disabled={saving === "location"} onClick={() => void save("location", location)}><FloppyDisk size={17} />حفظ المكان</button></div></section><section className="panel operations-settings-card"><header><Tag size={24} weight="duotone" /><div><h2>حالات السيارات</h2><p>الحالات التي تظهر في قاعدة البيانات والحركة والطلبات.</p></div></header><div className="operations-settings-list">{meta.statuses.map((item) => <button type="button" key={item.code} onClick={() => setStatus({ code: item.code, label: item.label, sortOrder: item.sort_order })}><strong>{item.label}</strong><small>{item.code}</small></button>)}</div><div className="operations-settings-form"><label><span>الكود الإنجليزي</span><input value={status.code} onChange={(event) => setStatus({ ...status, code: event.target.value })} /></label><label><span>اسم الحالة</span><input value={status.label} onChange={(event) => setStatus({ ...status, label: event.target.value })} /></label><label><span>الترتيب</span><input type="number" value={status.sortOrder} onChange={(event) => setStatus({ ...status, sortOrder: Number(event.target.value) })} /></label><button type="button" disabled={saving === "status"} onClick={() => void save("status", status)}><FloppyDisk size={17} />حفظ الحالة</button></div></section><section className="panel operations-settings-card"><header><Palette size={24} weight="duotone" /><div><h2>الألوان الداخلية</h2><p>قائمة مساعدة عند إضافة السيارة أو تشييكها.</p></div></header><div className="operations-settings-list colors">{meta.interiorColors.map((item) => <button type="button" key={item.id} onClick={() => setColor({ name: item.name, sortOrder: item.sort_order })}><strong>{item.name}</strong></button>)}</div><div className="operations-settings-form color-form"><label><span>اسم اللون</span><input value={color.name} onChange={(event) => setColor({ ...color, name: event.target.value })} /></label><label><span>الترتيب</span><input type="number" value={color.sortOrder} onChange={(event) => setColor({ ...color, sortOrder: Number(event.target.value) })} /></label><button type="button" disabled={saving === "color"} onClick={() => void save("color", color)}><FloppyDisk size={17} />حفظ اللون</button></div></section></div>;
}
