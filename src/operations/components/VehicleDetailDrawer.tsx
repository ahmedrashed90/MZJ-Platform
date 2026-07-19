import { useEffect, useMemo, useState } from "react";
import { Archive, CheckCircle, ClockCounterClockwise, ShieldCheck, Trash, Truck, X } from "@phosphor-icons/react";
import { useAuth } from "../../auth/AuthContext";
import { formatOperationsError, operationsFetch } from "../api";
import type { VehicleRow } from "../types";

function value(input: unknown) { return String(input ?? "").trim() || "—"; }
function statusLabel(code: string) {
  return ({ available_for_sale: "متاح للبيع", reserved: "حجز", has_notes: "بها ملاحظات", under_delivery: "مباع تحت التسليم", delivered: "مباع تم التسليم" } as Record<string, string>)[code] || code || "—";
}

export function VehicleDetailDrawer({ vehicle, onClose, onChanged }: { vehicle: VehicleRow; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"delete" | "archive" | null>(null);
  const [busy, setBusy] = useState(false);
  const isAdmin = Boolean(user?.roleCodes.some(code => code === "admin" || code === "system_admin"));
  const canDelete = isAdmin || Boolean(user?.permissions?.includes("operations.vehicle.delete"));
  const canArchive = isAdmin || Boolean(user?.permissions?.includes("operations.vehicle.archive"));

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      if (mode) { setMode(null); setReason(""); } else onClose();
    };
    window.addEventListener("keydown", close);
    setData(null);
    setError("");
    operationsFetch<any>("vehicle", { query: { id: vehicle.id } }).then(setData).catch(caught => setError(formatOperationsError(caught)));
    return () => window.removeEventListener("keydown", close);
  }, [vehicle.id, onClose, mode, busy]);

  const activeApproval = useMemo(() => data?.approvals?.find((cycle: any) => cycle.is_active) || data?.approvals?.[0], [data]);

  async function act() {
    if (!mode || !reason.trim()) return;
    setBusy(true);
    setError("");
    try {
      await operationsFetch(mode === "delete" ? "deleteVehicle" : "archive", { method: "POST", body: { vehicleId: vehicle.id, reason } });
      onChanged();
      onClose();
    } catch (caught) {
      setError(formatOperationsError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="operations-drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <aside className="operations-drawer operations-vehicle-drawer">
        <header><div><h3>ملف السيارة</h3><span>{vehicle.vin}</span></div><button type="button" onClick={onClose}><X size={20} /></button></header>
        {error ? <div className="operations-error">{error}</div> : null}
        {!data ? <div className="operations-loading">جاري تحميل الملف الكامل...</div> : (
          <div className="operations-drawer-content">
            <section className="vehicle-summary-grid">
              {[
                ["رقم الهيكل", data.vehicle.vin], ["السيارة", data.vehicle.car_name], ["البيان", data.vehicle.statement], ["الوكيل", data.vehicle.agent_name],
                ["الموديل", data.vehicle.model_year], ["اللوحة", data.vehicle.plate_no], ["اسم الدفعة", data.vehicle.batch_no], ["المكان", data.vehicle.location_name],
                ["الحالة", data.vehicle.status_name], ["اللون الداخلي", data.vehicle.interior_color], ["اللون الخارجي", data.vehicle.exterior_color],
                ["ملاحظات السيارة", data.vehicle.notes], ["ملاحظات الحالة", data.vehicle.status_note], ["حجز - نواقص - تحديد مكان", data.vehicle.shortage_location_note],
                ["تاريخ الإنشاء", data.vehicle.created_at ? new Date(data.vehicle.created_at).toLocaleString("ar-SA") : ""],
                ["آخر تحديث", data.vehicle.updated_at ? new Date(data.vehicle.updated_at).toLocaleString("ar-SA") : ""],
              ].map(([label, item]) => <div key={label}><span>{label}</span><strong>{value(item)}</strong></div>)}
            </section>

            <section className="vehicle-detail-section">
              <h4><CheckCircle /> التشيك</h4>
              {data.checks?.length ? <div className="vehicle-check-grid">{data.checks.map((item: any) => <div key={item.item_code}><strong>{item.item_name}</strong><span>{value(item.status)}</span><small>{value(item.note)}</small><small>{item.updated_by_name ? `${item.updated_by_name} — ${new Date(item.updated_at).toLocaleString("ar-SA")}` : "—"}</small></div>)}</div> : <p>لم يتم تسجيل تشيك لهذه السيارة.</p>}
            </section>

            <section className="vehicle-detail-section">
              <h4><ShieldCheck /> الموافقات</h4>
              {activeApproval ? <div className="vehicle-approval-summary"><div><span>الموافقة المالية</span><strong>{activeApproval.financial_approved ? "تمت" : "لم تتم"}</strong><small>{value(activeApproval.financial_approved_by_name)}</small><p>{value(activeApproval.financial_note)}</p></div><div><span>الموافقة الإدارية</span><strong>{activeApproval.administrative_approved ? "تمت" : "لم تتم"}</strong><small>{value(activeApproval.administrative_approved_by_name)}</small><p>{value(activeApproval.administrative_note)}</p></div></div> : <p>لا توجد دورة موافقات مسجلة.</p>}
            </section>

            <section className="vehicle-detail-section">
              <h4><ClockCounterClockwise /> سجل الحركات</h4>
              {data.movements?.length ? <div className="vehicle-history-list">{data.movements.map((movement: any) => <article key={movement.id}><strong>{statusLabel(movement.old_status)} ← {statusLabel(movement.new_status)}</strong><span>{value(movement.from_location)} ← {value(movement.to_location)}</span><small>{new Date(movement.created_at).toLocaleString("ar-SA")} — {value(movement.performed_by_name)}</small>{movement.note ? <p>{movement.note}</p> : null}</article>)}</div> : <p>لا توجد حركات.</p>}
            </section>

            <section className="vehicle-detail-section">
              <h4><Truck /> طلبات النقل</h4>
              {data.transfers?.length ? <div className="vehicle-history-list">{data.transfers.map((request: any) => <article key={request.id}><strong>{request.request_no}</strong><span>{value(request.destination_location)} — {value(request.status)}</span><small>{new Date(request.requested_at).toLocaleString("ar-SA")} — {value(request.requested_by_name)}</small></article>)}</div> : <p>لا توجد طلبات نقل.</p>}
            </section>

            <section className="vehicle-detail-section">
              <h4>Tracking</h4>
              {data.tracking?.length ? <div className="vehicle-history-list">{data.tracking.map((order: any) => <article key={order.id}><strong>{order.sales_order_no}</strong><span>{value(order.status)}</span><small>{new Date(order.updated_at || order.created_at).toLocaleString("ar-SA")}</small></article>)}</div> : <p>لا يوجد طلب تراكينج.</p>}
            </section>

            {data.vehicle.archived_at ? <section className="vehicle-archive-note"><strong>السيارة مؤرشفة</strong><span>{new Date(data.vehicle.archived_at).toLocaleString("ar-SA")}</span><p>{value(data.vehicle.archive_reason)}</p></section> : null}

            {!data.vehicle.archived_at && (canArchive || canDelete) ? <div className="vehicle-danger-actions">{canArchive ? <button type="button" onClick={() => { setMode("archive"); setReason(""); }}><Archive />أرشفة</button> : null}{canDelete ? <button type="button" className="danger" onClick={() => { setMode("delete"); setReason(""); }}><Trash />مسح السيارة</button> : null}</div> : null}

            {mode ? <div className="inline-confirm"><strong>{mode === "delete" ? "مسح نهائي للسيارة" : "أرشفة السيارة"}</strong><p>{mode === "delete" ? "لن يُسمح بالمسح إذا كان للسيارة أي تاريخ تشغيلي." : "تظل كل الحركات والموافقات والطلبات محفوظة بعد الأرشفة."}</p><textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="سبب الإجراء — إجباري" /><div><button type="button" onClick={() => { setMode(null); setReason(""); }}>إلغاء</button><button type="button" disabled={busy || !reason.trim()} onClick={() => void act()}>{busy ? "جاري التنفيذ..." : "تأكيد"}</button></div></div> : null}
          </div>
        )}
      </aside>
    </div>
  );
}
