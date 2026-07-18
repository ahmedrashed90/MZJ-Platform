import { useEffect, useState } from "react";
import { CheckCircle, FloppyDisk, Path, WarningCircle } from "@phosphor-icons/react";
import { trackingFetch } from "../api";

type StageSetting = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  owner_type: string;
  sort_order: number;
  sms_enabled: boolean;
  is_active: boolean;
};

export function TrackingSettingsPanel() {
  const [stages, setStages] = useState<StageSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const payload = await trackingFetch<{ ok: boolean; stages: StageSetting[] }>("/api/tracking/settings");
      setStages(payload.stages || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل إعدادات التتبع");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function update(id: string, patch: Partial<StageSetting>) {
    setStages((current) => current.map((stage) => stage.id === id ? { ...stage, ...patch } : stage));
  }

  async function save(stage: StageSetting) {
    setSaving(stage.id);
    setMessage("");
    setError("");
    try {
      const payload = await trackingFetch<{ ok: boolean; message: string }>("/api/tracking/settings", {
        method: "POST",
        body: JSON.stringify({ id: stage.id, name: stage.name, description: stage.description, smsEnabled: stage.sms_enabled, isActive: stage.is_active }),
      });
      setMessage(payload.message || "تم حفظ إعدادات المرحلة");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "تعذر حفظ المرحلة");
    } finally {
      setSaving("");
    }
  }

  return (
    <section className="panel tracking-settings-panel">
      <div className="tracking-settings-head"><div><Path size={28} weight="duotone" /><span><h2>إعدادات مراحل التتبع</h2><p>تعديل اسم ووصف المرحلة وتفعيل زر SMS+ من مكان واحد.</p></span></div></div>
      {error ? <div className="connection-banner"><WarningCircle size={20} weight="fill" /><span>{error}</span></div> : null}
      {message ? <div className="success-banner tracking-success-banner"><CheckCircle size={20} weight="fill" /><span>{message}</span></div> : null}
      {loading ? <div className="tracking-loading">جاري تحميل المراحل...</div> : (
        <div className="tracking-settings-list">
          {stages.map((stage) => (
            <article key={stage.id}>
              <div className="tracking-settings-number">{stage.sort_order}</div>
              <div className="tracking-settings-fields">
                <label><span>اسم المرحلة</span><input value={stage.name} onChange={(event) => update(stage.id, { name: event.target.value })} /></label>
                <label><span>وصف المرحلة للعميل</span><textarea rows={2} value={stage.description || ""} onChange={(event) => update(stage.id, { description: event.target.value })} /></label>
                <div className="tracking-settings-checks"><label><input type="checkbox" checked={stage.sms_enabled} onChange={(event) => update(stage.id, { sms_enabled: event.target.checked })} /><span>إظهار زر SMS+</span></label><label><input type="checkbox" checked={stage.is_active} onChange={(event) => update(stage.id, { is_active: event.target.checked })} /><span>المرحلة مفعلة</span></label></div>
              </div>
              <button type="button" className="tracking-stage-save" onClick={() => void save(stage)} disabled={Boolean(saving)}><FloppyDisk size={17} />{saving === stage.id ? "جاري..." : "حفظ"}</button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
