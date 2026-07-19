import { useCallback, useEffect, useState } from "react";
import { CheckCircle, Eye, FloppyDisk, WarningCircle, XCircle } from "@phosphor-icons/react";
import { formatOperationsDate, operationsFetch } from "../api";
import { OperationsModal } from "../components/OperationsModal";

type ApprovalVehicle = {
  id: string; vin: string; car_name: string | null; statement: string | null; location_name: string | null; status_name: string | null;
  financial_approved: boolean; administrative_approved: boolean; financial_note: string | null; administrative_note: string | null;
};
type Approval = {
  id: string; financial_approved: boolean; administrative_approved: boolean; financial_note: string | null; administrative_note: string | null;
  financial_approved_at: string | null; administrative_approved_at: string | null; financial_approved_by_name: string | null; administrative_approved_by_name: string | null; created_at: string;
};
type EventRow = { id: string; approval_type: string; action: string; actor_name: string; reason: string | null; created_at: string };

export function OperationsApprovalsPage() {
  const [vehicles, setVehicles] = useState<ApprovalVehicle[]>([]);
  const [selected, setSelected] = useState<ApprovalVehicle | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [financialNote, setFinancialNote] = useState("");
  const [administrativeNote, setAdministrativeNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const payload = await operationsFetch<{ ok: true; vehicles: ApprovalVehicle[] }>("/api/operations/approvals");
      setVehicles(payload.vehicles);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر تحميل الموافقات"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function open(id: string) {
    try {
      const payload = await operationsFetch<{ ok: true; vehicle: ApprovalVehicle; approvals: Approval[]; events: EventRow[] }>(`/api/operations/approvals?vehicleId=${id}`);
      setSelected(payload.vehicle); setApproval(payload.approvals[0] || null); setEvents(payload.events);
      setFinancialNote(payload.approvals[0]?.financial_note || ""); setAdministrativeNote(payload.approvals[0]?.administrative_note || "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر فتح الموافقات"); }
  }

  async function act(action: "approve" | "revert" | "note" | "clear", type: "financial" | "administrative" | "both", note = "", reason = "") {
    if (!selected) return;
    setSaving(true); setError("");
    try {
      const payload = await operationsFetch<{ ok: true; message: string }>("/api/operations/approvals", {
        method: "POST", body: JSON.stringify({ vehicleId: selected.id, action, type, note, reason }),
      });
      setMessage(payload.message); await open(selected.id); await load();
    } catch (value) { setError(value instanceof Error ? value.message : "تعذر تحديث الموافقة"); }
    finally { setSaving(false); }
  }

  return (
    <div className="module-page operations-page">
      <header className="module-page-head"><div><h1>الموافقة المالية والإدارية</h1><p>السيارات بحالة مباع تحت التسليم فقط، مع استقلال الموافقتين وحفظ سجل التراجع والملاحظات.</p></div></header>
      {error ? <div className="connection-banner"><WarningCircle size={20} weight="fill" /><span>{error}</span></div> : null}
      {message ? <div className="success-banner"><CheckCircle size={19} weight="fill" /><span>{message}</span></div> : null}
      <section className="operations-approval-grid">
        {vehicles.length === 0 ? <div className="panel operations-empty">لا توجد سيارات منتظرة للموافقات.</div> : vehicles.map((vehicle) => <article key={vehicle.id} className="panel operations-approval-card">
          <header><div><strong>{vehicle.vin}</strong><span>{vehicle.car_name || "—"} · {vehicle.statement || "—"}</span></div><button type="button" className="operations-icon-action" onClick={() => void open(vehicle.id)}><Eye size={17} />فتح</button></header>
          <p>{vehicle.location_name || "—"}</p>
          <div><span className={`operations-badge ${vehicle.financial_approved ? "success" : "pending"}`}>المالية: {vehicle.financial_approved ? "تم" : "لم يتم"}</span><span className={`operations-badge ${vehicle.administrative_approved ? "success" : "pending"}`}>الإدارية: {vehicle.administrative_approved ? "تم" : "لم يتم"}</span></div>
        </article>)}
      </section>

      <OperationsModal open={Boolean(selected)} title={selected ? `موافقات السيارة ${selected.vin}` : ""} onClose={() => setSelected(null)} wide>
        {selected ? <div className="operations-approval-detail">
          <div className="operations-approval-panels">
            <section>
              <h3>الموافقة المالية</h3><span className={`operations-badge ${approval?.financial_approved ? "success" : "pending"}`}>{approval?.financial_approved ? "تم" : "لم يتم"}</span>
              <textarea rows={4} value={financialNote} onChange={(event) => setFinancialNote(event.target.value)} placeholder="الملاحظة المالية" />
              <div><button type="button" className="operations-secondary" disabled={saving} onClick={() => void act("note", "financial", financialNote)}><FloppyDisk size={17} />حفظ الملاحظة</button>{approval?.financial_approved ? <button type="button" className="operations-danger" disabled={saving} onClick={() => { const reason = window.prompt("سبب التراجع عن الموافقة المالية"); if (reason) void act("revert", "financial", "", reason); }}><XCircle size={17} />تراجع</button> : <button type="button" className="operations-primary" disabled={saving} onClick={() => void act("approve", "financial", financialNote)}>موافقة مالية</button>}</div>
              {approval?.financial_approved_at ? <small>{approval.financial_approved_by_name || "—"} · {formatOperationsDate(approval.financial_approved_at)}</small> : null}
            </section>
            <section>
              <h3>الموافقة الإدارية</h3><span className={`operations-badge ${approval?.administrative_approved ? "success" : "pending"}`}>{approval?.administrative_approved ? "تم" : "لم يتم"}</span>
              <textarea rows={4} value={administrativeNote} onChange={(event) => setAdministrativeNote(event.target.value)} placeholder="الملاحظة الإدارية" />
              <div><button type="button" className="operations-secondary" disabled={saving} onClick={() => void act("note", "administrative", administrativeNote)}><FloppyDisk size={17} />حفظ الملاحظة</button>{approval?.administrative_approved ? <button type="button" className="operations-danger" disabled={saving} onClick={() => { const reason = window.prompt("سبب التراجع عن الموافقة الإدارية"); if (reason) void act("revert", "administrative", "", reason); }}><XCircle size={17} />تراجع</button> : <button type="button" className="operations-primary" disabled={saving} onClick={() => void act("approve", "administrative", administrativeNote)}>موافقة إدارية</button>}</div>
              {approval?.administrative_approved_at ? <small>{approval.administrative_approved_by_name || "—"} · {formatOperationsDate(approval.administrative_approved_at)}</small> : null}
            </section>
          </div>
          <div className="operations-form-actions"><button type="button" className="operations-danger" disabled={saving} onClick={() => { const reason = window.prompt("سبب إلغاء الطلب ومسح الموافقات"); if (reason) void act("clear", "both", "", reason); }}>إلغاء الطلب (مسح الموافقات)</button></div>
          <h3>سجل الموافقات والتراجع</h3><div className="operations-timeline">{events.map((event) => <article key={event.id}><span></span><div><strong>{event.approval_type} — {event.action}</strong><small>{event.actor_name} · {formatOperationsDate(event.created_at)}</small>{event.reason ? <p>{event.reason}</p> : null}</div></article>)}</div>
        </div> : null}
      </OperationsModal>
    </div>
  );
}
