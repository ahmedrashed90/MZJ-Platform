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
  sms_message_template?: string | null;
  sms_message_template_legacy?: string | null;
  sms_message_mode?: "legacy" | "new" | string | null;
  is_active: boolean;
};

const editableMessageStages = new Set([1, 9, 10]);

export function TrackingSettingsPanel({ readOnly = false }: { readOnly?: boolean }) {
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
        body: JSON.stringify({
          id: stage.id,
          name: stage.name,
          description: stage.description,
          smsEnabled: stage.sms_enabled,
          smsMessageTemplate: stage.sms_message_template,
          smsLegacyMessageTemplate: stage.sms_message_template_legacy,
          smsMessageMode: stage.sms_message_mode,
          isActive: stage.is_active,
        }),
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
      <div className="tracking-settings-head"><div><Path size={28} weight="duotone" /><span><h2>إعدادات مراحل التتبع</h2><p>تعديل اسم ووصف المرحلة وتفعيل زر SMS+، مع إدارة نص الرسائل 1 و9، والاختيار بين الرسالة القديمة والجديدة للمرحلة 10.</p></span></div></div>
      {readOnly ? <div className="connection-banner"><WarningCircle size={20} weight="fill" /><span>صلاحية مشاهدة فقط؛ تعديل مراحل التتبع يحتاج صلاحية إدارة إعدادات التتبع.</span></div> : null}
      {error ? <div className="connection-banner"><WarningCircle size={20} weight="fill" /><span>{error}</span></div> : null}
      {message ? <div className="success-banner tracking-success-banner"><CheckCircle size={20} weight="fill" /><span>{message}</span></div> : null}
      {loading ? <div className="tracking-loading">جاري تحميل المراحل...</div> : (
        <div className="tracking-settings-list">
          {stages.map((stage) => (
            <article key={stage.id}>
              <div className="tracking-settings-number">{stage.sort_order}</div>
              <div className="tracking-settings-fields">
                <label><span>اسم المرحلة</span><input disabled={readOnly} value={stage.name} onChange={(event) => update(stage.id, { name: event.target.value })} /></label>
                <label><span>وصف المرحلة للعميل</span><textarea disabled={readOnly} rows={2} value={stage.description || ""} onChange={(event) => update(stage.id, { description: event.target.value })} /></label>
                {editableMessageStages.has(Number(stage.sort_order)) ? (
                  stage.sort_order === 10 ? (
                    <div className="tracking-stage10-message-settings">
                      <div className="tracking-stage10-mode">
                        <span>الرسالة المستخدمة حاليًا في المرحلة 10</span>
                        <div role="radiogroup" aria-label="اختيار رسالة المرحلة 10">
                          <label className={stage.sms_message_mode === "legacy" ? "is-selected" : ""}>
                            <input disabled={readOnly} type="radio" name={`stage10-message-mode-${stage.id}`} checked={stage.sms_message_mode === "legacy"} onChange={() => update(stage.id, { sms_message_mode: "legacy" })} />
                            <span>الرسالة القديمة</span>
                          </label>
                          <label className={stage.sms_message_mode !== "legacy" ? "is-selected" : ""}>
                            <input disabled={readOnly} type="radio" name={`stage10-message-mode-${stage.id}`} checked={stage.sms_message_mode !== "legacy"} onChange={() => update(stage.id, { sms_message_mode: "new" })} />
                            <span>الرسالة الجديدة</span>
                          </label>
                        </div>
                        <small>التغيير يُحفظ مع إعدادات المرحلة، والنصان يظلان محفوظين ويمكن تعديل أي منهما في أي وقت.</small>
                      </div>
                      <label className="tracking-settings-message-template">
                        <span>نص الرسالة القديمة</span>
                        <textarea disabled={readOnly} rows={7} value={stage.sms_message_template_legacy || ""} onChange={(event) => update(stage.id, { sms_message_template_legacy: event.target.value })} />
                      </label>
                      <label className="tracking-settings-message-template">
                        <span>نص الرسالة الجديدة</span>
                        <textarea disabled={readOnly} rows={8} value={stage.sms_message_template || ""} onChange={(event) => update(stage.id, { sms_message_template: event.target.value })} />
                      </label>
                      <small className="tracking-stage10-variables">
                        المتغيرات المتاحة للرسالتين: {"{customer_name}"}، {"{tracking_link}"}، {"{order_no}"}، {"{stage_name}"}، {"{car_name}"}، {"{vin}"}، {"{personal_code}"}، {"{portal_url}"}
                      </small>
                    </div>
                  ) : (
                    <label className="tracking-settings-message-template">
                      <span>نص رسالة SMS+ للمرحلة رقم {stage.sort_order}</span>
                      <textarea disabled={readOnly} rows={stage.sort_order === 1 ? 12 : 8} value={stage.sms_message_template || ""} onChange={(event) => update(stage.id, { sms_message_template: event.target.value })} />
                      <small>
                        المتغيرات المتاحة: {"{customer_name}"}، {"{tracking_link}"}، {"{order_no}"}، {"{stage_name}"}، {"{car_name}"}، {"{vin}"}
                        {stage.sort_order === 1 ? <>، {"{vehicles_count}"}، {"{subtotal_before_tax}"}، {"{tax_value}"}، {"{total_incl_vat}"}</> : null}
                      </small>
                    </label>
                  )
                ) : null}
                <div className="tracking-settings-checks"><label><input disabled={readOnly} type="checkbox" checked={stage.sms_enabled} onChange={(event) => update(stage.id, { sms_enabled: event.target.checked })} /><span>إظهار زر SMS+</span></label><label><input disabled={readOnly} type="checkbox" checked={stage.is_active} onChange={(event) => update(stage.id, { is_active: event.target.checked })} /><span>المرحلة مفعلة</span></label></div>
              </div>
              <button type="button" className="tracking-stage-save" onClick={() => void save(stage)} disabled={readOnly || Boolean(saving)}><FloppyDisk size={17} />{saving === stage.id ? "جاري..." : "حفظ"}</button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
