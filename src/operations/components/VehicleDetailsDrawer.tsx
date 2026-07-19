import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowClockwise,
  CheckCircle,
  ClockCounterClockwise,
  NotePencil,
  PencilSimple,
  ShieldCheck,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { useOperations } from "../OperationsContext";
import { formatOperationsDate, operationsFetch, requestStatusLabel } from "../api";
import type { OperationsVehicle } from "../types";
import { OperationsDrawer } from "./OperationsOverlay";

export function VehicleDetailsDrawer({
  vehicleId,
  open,
  onClose,
  onEdit,
  onChanged,
}: {
  vehicleId: string | null;
  open: boolean;
  onClose: () => void;
  onEdit: (vehicle: OperationsVehicle) => void;
  onChanged: (vehicle: OperationsVehicle) => void;
}) {
  const { meta, can } = useOperations();
  const [vehicle, setVehicle] = useState<OperationsVehicle | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [financialNote, setFinancialNote] = useState("");
  const [administrativeNote, setAdministrativeNote] = useState("");
  const [archiveNote, setArchiveNote] = useState("");

  const load = useCallback(async () => {
    if (!vehicleId || !open) return;
    setLoading(true);
    setError("");
    try {
      const payload = await operationsFetch<{ ok: boolean; vehicle: OperationsVehicle }>(`/api/operations/vehicles?id=${encodeURIComponent(vehicleId)}`);
      setVehicle(payload.vehicle);
      setFinancialNote(payload.vehicle.financial_note || "");
      setAdministrativeNote(payload.vehicle.administrative_note || "");
      setArchiveNote(payload.vehicle.archive_note || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل بيانات السيارة");
    } finally {
      setLoading(false);
    }
  }, [open, vehicleId]);

  useEffect(() => { void load(); }, [load]);

  const status = useMemo(() => meta?.statuses.find((item) => item.code === vehicle?.status_code), [meta?.statuses, vehicle?.status_code]);
  const archiveChecks = useMemo(() => [
    { label: "الحالة مباع تم التسليم", ok: vehicle?.status_code === "delivered" },
    { label: "الاعتماد المالي مكتمل", ok: Boolean(vehicle?.financial_approved) },
    { label: "الاعتماد الإداري مكتمل", ok: Boolean(vehicle?.administrative_approved) },
    { label: "يوجد سجل حركة", ok: Number(vehicle?.movements_count || 0) > 0 },
    { label: "التراكينج مكتمل", ok: Boolean(vehicle?.tracking_completed) },
  ], [vehicle]);
  const canArchiveNow = archiveChecks.every((item) => item.ok);

  async function approval(kind: "financial" | "administrative", approved: boolean) {
    if (!vehicle) return;
    setWorking(`${kind}-${approved}`);
    setError("");
    setMessage("");
    try {
      const payload = await operationsFetch<{ ok: boolean; vehicle: OperationsVehicle; message: string }>("/api/operations/vehicles", {
        method: "POST",
        body: JSON.stringify({
          action: "approval",
          vehicleId: vehicle.id,
          kind,
          approved,
          note: kind === "financial" ? financialNote : administrativeNote,
        }),
      });
      setVehicle(payload.vehicle);
      setMessage(payload.message);
      onChanged(payload.vehicle);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "تعذر تنفيذ الاعتماد");
    } finally {
      setWorking("");
    }
  }

  async function archiveVehicle() {
    if (!vehicle) return;
    setWorking("archive");
    setError("");
    setMessage("");
    try {
      const payload = await operationsFetch<{ ok: boolean; vehicle: OperationsVehicle; message: string }>("/api/operations/vehicles", {
        method: "POST",
        body: JSON.stringify({ action: "archive", vehicleId: vehicle.id, note: archiveNote }),
      });
      setVehicle(payload.vehicle);
      setMessage(payload.message);
      onChanged(payload.vehicle);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "تعذر أرشفة السيارة");
    } finally {
      setWorking("");
    }
  }

  return (
    <OperationsDrawer open={open} title={vehicle ? `السيارة ${vehicle.vin}` : "بيانات السيارة"} description={vehicle?.car_name || undefined} onClose={onClose}>
      {loading ? <div className="ops-loading">جاري تحميل بيانات السيارة...</div> : null}
      {error ? <div className="ops-error"><WarningCircle size={19} weight="fill" /><span>{error}</span></div> : null}
      {message ? <div className="ops-success"><CheckCircle size={19} weight="fill" /><span>{message}</span></div> : null}
      {!loading && vehicle ? (
        <div className="ops-vehicle-detail">
          <div className="ops-detail-actions">
            {can("operations.vehicles.update") && !vehicle.is_archived ? <button type="button" className="ops-button secondary" onClick={() => onEdit(vehicle)}><PencilSimple size={17} />تعديل البيانات</button> : null}
            <button type="button" className="ops-button ghost" onClick={() => void load()}><ArrowClockwise size={17} />تحديث</button>
          </div>

          <section className="ops-detail-section">
            <div className="ops-section-title"><NotePencil size={20} weight="duotone" /><h3>البيانات الأساسية</h3></div>
            <div className="ops-info-grid">
              <Info label="رقم الهيكل" value={vehicle.vin} />
              <Info label="السيارة" value={vehicle.car_name} />
              <Info label="البيان / الفئة" value={vehicle.statement} />
              <Info label="الوكيل" value={vehicle.agent_name} />
              <Info label="الموديل" value={vehicle.model_year} />
              <Info label="اللوحة" value={vehicle.plate_no} />
              <Info label="اللون الخارجي" value={vehicle.exterior_color} />
              <Info label="اللون الداخلي" value={vehicle.interior_color} />
              <Info label="الدفعة" value={vehicle.batch_no} />
              <Info label="الموقع" value={vehicle.location_name} />
              <Info label="الحالة" value={vehicle.status_name || status?.name || vehicle.status_code} />
              <Info label="آخر تحديث" value={formatOperationsDate(vehicle.updated_at)} />
            </div>
          </section>

          <section className="ops-detail-section">
            <div className="ops-section-title"><NotePencil size={20} weight="duotone" /><h3>الملاحظات</h3></div>
            <div className="ops-notes-grid">
              <Note label="ملاحظات الموقع" value={vehicle.location_note} />
              <Note label="حجز - نواقص - تحديد مكان" value={vehicle.shortage_note} />
              <Note label="ملاحظات السيارة" value={vehicle.notes} />
            </div>
          </section>

          <section className="ops-detail-section">
            <div className="ops-section-title"><ShieldCheck size={20} weight="duotone" /><h3>محتويات السيارة</h3></div>
            <div className="ops-content-status-grid">
              {meta?.contents.map((item) => {
                const checked = Boolean(vehicle.contents?.[item.key]);
                return <div key={item.key} className={checked ? "ok" : "missing"}>{checked ? <CheckCircle size={18} weight="fill" /> : <XCircle size={18} weight="fill" />}<span>{item.label}</span></div>;
              })}
            </div>
          </section>

          {["under_delivery", "delivered"].includes(vehicle.status_code) ? (
            <section className="ops-detail-section">
              <div className="ops-section-title"><ShieldCheck size={20} weight="duotone" /><h3>الاعتمادات</h3></div>
              <div className="ops-approval-grid">
                <ApprovalCard
                  title="الاعتماد المالي"
                  approved={vehicle.financial_approved}
                  actor={vehicle.financial_approved_by_name}
                  date={vehicle.financial_approved_at}
                  note={financialNote}
                  onNote={setFinancialNote}
                  canAct={can("operations.approvals.financial") && vehicle.status_code === "under_delivery"}
                  working={working.startsWith("financial")}
                  onApprove={() => void approval("financial", true)}
                  onRevert={() => void approval("financial", false)}
                />
                <ApprovalCard
                  title="الاعتماد الإداري"
                  approved={vehicle.administrative_approved}
                  actor={vehicle.administrative_approved_by_name}
                  date={vehicle.administrative_approved_at}
                  note={administrativeNote}
                  onNote={setAdministrativeNote}
                  canAct={can("operations.approvals.administrative") && vehicle.status_code === "under_delivery"}
                  working={working.startsWith("administrative")}
                  onApprove={() => void approval("administrative", true)}
                  onRevert={() => void approval("administrative", false)}
                />
              </div>
            </section>
          ) : null}

          <section className="ops-detail-section">
            <div className="ops-section-title"><ClockCounterClockwise size={20} weight="duotone" /><h3>آخر الحركات</h3></div>
            <div className="ops-timeline-list">
              {vehicle.movements?.length ? vehicle.movements.slice(0, 15).map((movement) => (
                <article key={movement.id}>
                  <div className="ops-timeline-dot" />
                  <div>
                    <strong>{movement.from_location_name || "غير محدد"} ← {movement.to_location_name || "غير محدد"}</strong>
                    <span>{movement.performed_by_name || "مستخدم"} • {formatOperationsDate(movement.created_at)}</span>
                    {movement.note ? <p>{movement.note}</p> : null}
                  </div>
                </article>
              )) : <div className="ops-empty-inline">لا توجد حركات مسجلة.</div>}
            </div>
          </section>

          {vehicle.requests?.length ? (
            <section className="ops-detail-section">
              <div className="ops-section-title"><ClockCounterClockwise size={20} weight="duotone" /><h3>الطلبات المرتبطة</h3></div>
              <div className="ops-linked-list">
                {vehicle.requests.map((request) => <article key={request.id}><strong>{request.request_no}</strong><span>{request.transfer_type === "photo" ? "تصوير" : "نقل"} • {requestStatusLabel(request.status)} • {request.destination_name || "—"}</span></article>)}
              </div>
            </section>
          ) : null}

          {can("operations.vehicles.archive") && !vehicle.is_archived ? (
            <section className="ops-detail-section ops-archive-section">
              <div className="ops-section-title"><Archive size={20} weight="duotone" /><h3>أرشفة السيارة</h3></div>
              <div className="ops-archive-checks">
                {archiveChecks.map((item) => <div key={item.label} className={item.ok ? "ok" : "missing"}>{item.ok ? <CheckCircle size={17} weight="fill" /> : <XCircle size={17} weight="fill" />}<span>{item.label}</span></div>)}
              </div>
              <label className="ops-field"><span>ملاحظة الأرشفة</span><textarea rows={2} value={archiveNote} onChange={(event) => setArchiveNote(event.target.value)} /></label>
              <button type="button" className="ops-button danger" disabled={!canArchiveNow || working === "archive"} onClick={() => void archiveVehicle()}><Archive size={18} />{working === "archive" ? "جاري الأرشفة..." : "نقل السيارة إلى الأرشيف"}</button>
            </section>
          ) : null}

          {vehicle.is_archived ? <div className="ops-archived-banner"><Archive size={21} weight="fill" /><div><strong>السيارة مؤرشفة</strong><span>{formatOperationsDate(vehicle.archived_at)} • {vehicle.archived_by_name || "—"}</span></div></div> : null}
        </div>
      ) : null}
    </OperationsDrawer>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return <div><span>{label}</span><strong>{value || "—"}</strong></div>;
}

function Note({ label, value }: { label: string; value?: string | null }) {
  return <div><strong>{label}</strong><p>{value || "لا توجد ملاحظات"}</p></div>;
}

function ApprovalCard({
  title,
  approved,
  actor,
  date,
  note,
  onNote,
  canAct,
  working,
  onApprove,
  onRevert,
}: {
  title: string;
  approved: boolean;
  actor?: string | null;
  date?: string | null;
  note: string;
  onNote: (value: string) => void;
  canAct: boolean;
  working: boolean;
  onApprove: () => void;
  onRevert: () => void;
}) {
  return (
    <article className={`ops-approval-card ${approved ? "approved" : "pending"}`}>
      <header>{approved ? <CheckCircle size={22} weight="fill" /> : <WarningCircle size={22} weight="fill" />}<div><strong>{title}</strong><span>{approved ? "مكتمل" : "بانتظار الاعتماد"}</span></div></header>
      <div className="ops-approval-meta"><span>المنفذ: {actor || "—"}</span><span>التاريخ: {formatOperationsDate(date)}</span></div>
      <label><span>ملاحظة الاعتماد</span><textarea rows={2} value={note} onChange={(event) => onNote(event.target.value)} disabled={!canAct} /></label>
      {canAct ? <div className="ops-approval-actions"><button type="button" className="ops-button success" disabled={working || approved} onClick={onApprove}>اعتماد</button><button type="button" className="ops-button secondary" disabled={working || !approved} onClick={onRevert}>تراجع</button></div> : null}
    </article>
  );
}
