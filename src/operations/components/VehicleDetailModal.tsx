import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Car, CheckCircle, ClockCounterClockwise, LinkSimple, ShieldCheck, Trash, Truck, WarningCircle } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { formatOperationsDate, operationsFetch } from "../api";
import type { OperationsMeta, VehicleDetail } from "../types";

const tabs = [
  ["details", "البيانات"], ["checks", "التشيك"], ["approvals", "الموافقات"], ["movements", "الحركات"],
  ["transfers", "طلبات النقل"], ["tracking", "التراكينج"], ["audit", "السجل"],
] as const;

type TabKey = typeof tabs[number][0];

function trackingProgressTone(value?: number | null) {
  const progress = Math.max(0, Math.min(100, Number(value || 0)));
  if (progress >= 75) return "high";
  if (progress >= 40) return "medium";
  return "low";
}

export function VehicleDetailModal({ id, meta, onClose, onChanged }: { id: string | null; meta: OperationsMeta; onClose: () => void; onChanged?: () => void }) {
  const [vehicle, setVehicle] = useState<VehicleDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("details");
  const [confirmAction, setConfirmAction] = useState<"delete" | "archive" | null>(null);
  const [reason, setReason] = useState("");
  const [confirmVin, setConfirmVin] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  async function load() {
    if (!id) return;
    setLoading(true); setError("");
    try {
      const payload = await operationsFetch<{ ok: boolean; vehicle: VehicleDetail }>(`/api/operations?resource=vehicle&id=${encodeURIComponent(id)}`);
      setVehicle(payload.vehicle);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر فتح بيانات السيارة"); }
    finally { setLoading(false); }
  }
  useEffect(() => { setVehicle(null); setTab("details"); if (id) void load(); }, [id]);

  const currentApproval = useMemo(() => vehicle?.approvals.find((item) => item.is_active) || vehicle?.approvals[0], [vehicle]);

  async function runAction() {
    if (!vehicle || !confirmAction || !reason.trim() || (confirmAction === "delete" && confirmVin.trim() !== vehicle.vin)) return;
    setActionLoading(true); setError("");
    try {
      await operationsFetch("/api/operations", { method: "POST", body: JSON.stringify({ action: confirmAction === "delete" ? "delete_vehicle" : "archive_vehicle", id: vehicle.id, reason, confirmVin: confirmAction === "delete" ? confirmVin.trim() : undefined }) });
      setConfirmAction(null); setReason(""); setConfirmVin(""); onChanged?.(); onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تنفيذ الإجراء"); }
    finally { setActionLoading(false); }
  }

  return (
    <>
      <Modal open={Boolean(id)} title={vehicle ? `${vehicle.vin} — ${vehicle.car_name || "سيارة"}` : "تفاصيل السيارة"} subtitle={vehicle ? `${vehicle.location_name || "—"} · ${vehicle.status_name || "—"}` : undefined} onClose={onClose} className="operations-detail-modal">
        {error ? <div className="operations-alert error"><WarningCircle size={18} />{error}</div> : null}
        {loading || !vehicle ? <div className="operations-loading">جاري تحميل ملف السيارة...</div> : (
          <>
            <div className="operations-detail-tabs">{tabs.map(([key, label]) => <button key={key} type="button" className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</div>
            {tab === "details" ? (
              <div className="operations-detail-grid">
                {[
                  ["رقم الهيكل", vehicle.vin], ["السيارة", vehicle.car_name], ["البيان", vehicle.statement], ["الوكيل", vehicle.agent_name],
                  ["اللون الداخلي", vehicle.interior_color], ["اللون الخارجي", vehicle.exterior_color], ["الموديل", vehicle.model_year], ["اللوحة", vehicle.plate_no],
                  ["اسم الدفعة", vehicle.batch_no], ["المكان الحالي", vehicle.location_name], ["الحالة الحالية", vehicle.status_name], ["ملاحظات السيارة", vehicle.notes],
                  ["ملاحظات الحالة", vehicle.state_note], ["حجز - نواقص - تحديد مكان", vehicle.shortage_note], ["المنشئ", vehicle.created_by_name], ["آخر تعديل", formatOperationsDate(vehicle.updated_at)],
                ].map(([label, value]) => <div key={label}><small>{label}</small><strong>{value || "—"}</strong></div>)}
              </div>
            ) : null}
            {tab === "checks" ? (
              <div className="operations-check-grid">
                {vehicle.checks.map((item) => (
                  <article key={item.code} className={`operations-check-card status-${item.status || "unknown"}`}>
                    <header><strong>{item.name}</strong><span data-status={item.status}>{item.status === "ok" ? "موجود" : item.status === "missing" ? "ناقص" : "غير محدد"}</span></header>
                    <div><small>الملاحظة</small><p>{item.note || "لا توجد ملاحظة"}</p></div>
                    <footer>{item.updated_by_name ? `آخر تحديث: ${item.updated_by_name}` : "لم يتم تحديث العنصر"}{item.updated_at ? ` · ${formatOperationsDate(item.updated_at)}` : ""}</footer>
                  </article>
                ))}
              </div>
            ) : null}
            {tab === "approvals" ? <div className="operations-approval-summary"><div><ShieldCheck size={28} /><span>الموافقة المالية</span><b className={currentApproval?.financial_approved ? "ok" : "pending"}>{currentApproval?.financial_approved ? "تمت" : "لم تتم"}</b><small>{currentApproval?.financial_note || "بدون ملاحظة"}</small></div><div><CheckCircle size={28} /><span>الموافقة الإدارية</span><b className={currentApproval?.administrative_approved ? "ok" : "pending"}>{currentApproval?.administrative_approved ? "تمت" : "لم تتم"}</b><small>{currentApproval?.administrative_note || "بدون ملاحظة"}</small></div></div> : null}
            {tab === "movements" ? <div className="operations-timeline">{vehicle.movements.length ? vehicle.movements.map((row) => <article key={row.id}><ClockCounterClockwise size={18} /><div><strong>{row.from_location_name || "—"} ← {row.to_location_name || "—"}</strong><span>{row.old_status || "—"} ← {row.new_status || "—"}</span><small>{row.performed_by_name || "—"} · {formatOperationsDate(row.created_at)}</small></div></article>) : <p>لا توجد حركات مسجلة.</p>}</div> : null}
            {tab === "transfers" ? <div className="operations-timeline">{vehicle.transfers.length ? vehicle.transfers.map((row) => <article key={row.id}><Truck size={18} /><div><strong>{row.request_no}</strong><span>{row.source_location_name || "—"} ← {row.destination_location_name || "—"}</span><small>{row.requested_by_name || "—"} · {formatOperationsDate(row.requested_at)}</small></div></article>) : <p>لا توجد طلبات نقل.</p>}</div> : null}
            {tab === "tracking" ? <div className="operations-timeline operations-detail-tracking-list">{vehicle.tracking.length ? vehicle.tracking.map((row) => { const progress = Math.max(0, Math.min(100, Number(row.progress || 0))); return <button type="button" key={row.id} className={`operations-tracking-detail-button ${trackingProgressTone(progress)}`} onClick={() => window.location.assign(`/tracking?order=${encodeURIComponent(row.id || "")}`)}><LinkSimple size={20} /><div><strong>{row.sales_order_no}</strong><span>{row.status} — {progress}%</span><i><span style={{ width: `${progress}%` }} /></i><small>{formatOperationsDate(row.updated_at)}</small></div></button>; }) : <p>لا يوجد طلب تراكينج مرتبط.</p>}</div> : null}
            {tab === "audit" ? <div className="operations-timeline">{[...vehicle.approvalEvents, ...vehicle.statusNotes, ...vehicle.archiveEvents].sort((a,b) => Date.parse(b.created_at)-Date.parse(a.created_at)).map((row, index) => <article key={`${row.id || index}`}><Car size={18} /><div><strong>{row.action || row.status_code || "تحديث"}</strong><span>{row.note || row.reason || ""}</span><small>{row.actor_name || row.created_by_name || "—"} · {formatOperationsDate(row.created_at)}</small></div></article>)}</div> : null}
            <div className="operations-detail-actions">
              {meta.permissions.canArchiveVehicle && !vehicle.archived_at ? <button type="button" onClick={() => setConfirmAction("archive")}><Archive size={17} />أرشفة السيارة</button> : null}
              {meta.permissions.canDeleteVehicle ? <button type="button" className="danger" onClick={() => setConfirmAction("delete")}><Trash size={17} />مسح السيارة</button> : null}
            </div>
          </>
        )}
      </Modal>
      <Modal open={Boolean(confirmAction)} title={confirmAction === "delete" ? "تأكيد مسح السيارة" : "تأكيد أرشفة السيارة"} subtitle={vehicle ? `${vehicle.vin} — ${vehicle.car_name || "سيارة"}` : undefined} onClose={() => { if (!actionLoading) { setConfirmAction(null); setReason(""); setConfirmVin(""); } }} className="operations-confirm-modal" level={1} initialFocusRef={reasonRef} footer={<><button type="button" className="secondary" onClick={() => { setConfirmAction(null); setReason(""); setConfirmVin(""); }} disabled={actionLoading}>إلغاء</button><button type="button" className={confirmAction === "delete" ? "danger" : "primary"} onClick={() => void runAction()} disabled={actionLoading || !reason.trim() || (confirmAction === "delete" && confirmVin.trim() !== (vehicle?.vin || ""))}>{actionLoading ? "جاري التنفيذ..." : "تأكيد نهائي"}</button></>}>
        <div className={`operations-confirm-warning ${confirmAction === "delete" ? "danger" : ""}`}><WarningCircle size={24} /><p>{confirmAction === "delete" ? "سيتم مسح السيارة نهائيًا مع التشييك والموافقات والحركات وطلبات النقل وروابط التراكينج والبيانات المرتبطة. لا يمكن التراجع عن العملية." : "ستخرج السيارة من المخزون النشط مع الحفاظ على كل تاريخها."}</p></div>
        <label className="operations-field"><span>سبب الإجراء</span><textarea ref={reasonRef} value={reason} onChange={(event) => setReason(event.target.value)} rows={4} /></label>
        {confirmAction === "delete" ? <label className="operations-field"><span>اكتب رقم الهيكل للتأكيد: <b dir="ltr">{vehicle?.vin}</b></span><input dir="ltr" value={confirmVin} onChange={(event) => setConfirmVin(event.target.value)} placeholder="رقم الهيكل كاملًا" /></label> : null}
      </Modal>
    </>
  );
}
