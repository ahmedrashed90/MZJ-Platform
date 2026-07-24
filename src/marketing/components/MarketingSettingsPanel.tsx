import { useEffect, useState } from "react";
import { FloppyDisk, Palette, UsersThree, WarningCircle } from "@phosphor-icons/react";
import { useSearchParams } from "react-router-dom";
import { marketingFetch } from "../api";
import { DepartmentsPage } from "../pages/DepartmentsPage";
import "../marketing.css";

type MarketingSettingsTab = "departments" | "colors";
type UserColorRow = { id: string; full_name: string; email?: string | null; color: string };

export function MarketingSettingsPanel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [tab, setTab] = useState<MarketingSettingsTab>(requestedTab === "colors" ? "colors" : "departments");
  const [rows, setRows] = useState<UserColorRow[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTab(requestedTab === "colors" ? "colors" : "departments");
  }, [requestedTab]);

  async function loadColors() {
    setError("");
    try {
      const payload = await marketingFetch<{ rows: UserColorRow[] }>("/api/marketing?resource=user_colors");
      setRows(payload.rows);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل إعدادات التسويق");
    }
  }

  useEffect(() => {
    if (tab === "colors") void loadColors();
  }, [tab]);

  function chooseTab(next: MarketingSettingsTab) {
    setTab(next);
    setMessage("");
    setError("");
    setSearchParams({ section: "marketing", tab: next }, { replace: true });
  }

  async function saveColors() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "save_user_colors", colors: rows.map((row) => ({ userId: row.id, color: row.color })) }),
      });
      setMessage(result.message);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر حفظ الألوان");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="marketing-settings-root">
      <section className="panel marketing-settings-panel marketing-settings-header">
        <div className="settings-card-title"><div><h2>إعدادات سيستم التسويق</h2></div></div>
        <nav className="marketing-settings-tabs" aria-label="إعدادات سيستم التسويق">
          <button type="button" className={tab === "departments" ? "active" : ""} onClick={() => chooseTab("departments")}><UsersThree size={18} weight="duotone" />الأقسام</button>
          <button type="button" className={tab === "colors" ? "active" : ""} onClick={() => chooseTab("colors")}><Palette size={18} weight="duotone" />تعيين لون لكل مسؤول</button>
        </nav>
      </section>

      {tab === "departments" ? <DepartmentsPage embedded /> : null}

      {tab === "colors" ? (
        <section className="panel marketing-settings-panel">
          {error ? <div className="connection-banner"><WarningCircle size={18} />{error}</div> : null}
          {message ? <div className="success-banner">{message}</div> : null}
          <h3>تعيين لون لكل مسؤول</h3>
          <div className="marketing-color-list">
            {rows.map((row) => (
              <label key={row.id}>
                <span className="marketing-user-color" style={{ backgroundColor: row.color }} />
                <div><strong>{row.full_name}</strong><small>{row.email || "—"}</small></div>
                <input type="color" value={row.color} onChange={(event) => setRows((current) => current.map((item) => item.id === row.id ? { ...item, color: event.target.value } : item))} />
              </label>
            ))}
          </div>
          <button className="save-user-button" disabled={busy} onClick={() => void saveColors()}><FloppyDisk size={18} />حفظ ألوان المسؤولين</button>
        </section>
      ) : null}
    </div>
  );
}
