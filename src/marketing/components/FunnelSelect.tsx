import { useState } from "react";
import { Check, Plus, X } from "@phosphor-icons/react";
import { marketingFetch } from "../api";
import type { Funnel } from "../types";

type FunnelSelectProps = {
  value: string;
  funnels: Funnel[];
  onChange: (funnelId: string) => void;
  onCreated: (funnel: Funnel) => void;
  disabled?: boolean;
};

export function FunnelSelect({ value, funnels, onChange, onCreated, disabled = false }: FunnelSelectProps) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function createFunnel() {
    const funnelName = name.trim();
    if (!funnelName) {
      setError("اكتب اسم Funnel الجديد");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await marketingFetch<{ funnel: Funnel; message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "create_funnel", name: funnelName }),
      });
      onCreated(result.funnel);
      onChange(result.funnel.id);
      setName("");
      setAdding(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر إضافة Funnel جديد");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="marketing-funnel-field">
      <span>Funnel</span>
      <select value={value} disabled={disabled || busy} onChange={(event) => onChange(event.target.value)}>
        <option value="">اختر Funnel</option>
        {funnels.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select>
      {!adding ? (
        <button type="button" className="marketing-funnel-add-trigger" disabled={disabled} onClick={() => { setAdding(true); setError(""); }}>
          <Plus size={15} />إضافة Funnel جديد
        </button>
      ) : (
        <div className="marketing-funnel-create-row">
          <input
            value={name}
            maxLength={100}
            autoFocus
            placeholder="اسم Funnel الجديد"
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); void createFunnel(); }
              if (event.key === "Escape") { setAdding(false); setName(""); setError(""); }
            }}
          />
          <button type="button" className="save" aria-label="حفظ Funnel" disabled={busy} onClick={() => void createFunnel()}><Check size={16} /></button>
          <button type="button" className="cancel" aria-label="إلغاء إضافة Funnel" disabled={busy} onClick={() => { setAdding(false); setName(""); setError(""); }}><X size={16} /></button>
        </div>
      )}
      {error ? <small className="marketing-funnel-error">{error}</small> : null}
    </div>
  );
}
