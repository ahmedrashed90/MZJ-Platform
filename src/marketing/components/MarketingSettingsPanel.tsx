import { useEffect, useState } from "react";
import { FloppyDisk, WarningCircle } from "@phosphor-icons/react";
import { marketingFetch } from "../api";
import "../marketing.css";

export function MarketingSettingsPanel() {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function load() {
    setError("");
    try { const payload = await marketingFetch<{ rows: any[] }>("/api/marketing?resource=user_colors"); setRows(payload.rows); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل إعدادات التسويق"); }
  }
  useEffect(() => { void load(); }, []);
  async function save() {
    setBusy(true); setError(""); setMessage("");
    try { const result = await marketingFetch<{ message: string }>("/api/marketing", { method: "POST", body: JSON.stringify({ action: "save_user_colors", colors: rows.map((row) => ({ userId: row.id, color: row.color })) }) }); setMessage(result.message); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر حفظ الألوان"); }
    finally { setBusy(false); }
  }
  return <section className="panel marketing-settings-panel"><div className="settings-card-title"><div><h2>إعدادات سيستم التسويق</h2></div></div>{error ? <div className="connection-banner"><WarningCircle size={18} />{error}</div> : null}{message ? <div className="success-banner">{message}</div> : null}<h3>تعيين لون لكل مسؤول</h3><div className="marketing-color-list">{rows.map((row) => <label key={row.id}><span className="marketing-user-color" style={{ backgroundColor: row.color }} /><div><strong>{row.full_name}</strong><small>{row.email || "—"}</small></div><input type="color" value={row.color} onChange={(e) => setRows((current) => current.map((item) => item.id === row.id ? { ...item, color: e.target.value } : item))} /></label>)}</div><button className="save-user-button" disabled={busy} onClick={() => void save()}><FloppyDisk size={18} />حفظ ألوان المسؤولين</button></section>;
}
