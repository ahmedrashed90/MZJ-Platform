import { useEffect, useMemo, useState } from "react";
import { Archive, CalendarBlank, Car, CheckCircle, Clock, CurrencyCircleDollar, MapPin, Phone, User, WarningCircle } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { formatTrackingDate, formatTrackingMoney, trackingStatusLabel, trackingBranchLabel } from "../api";
import type { TrackingOrderDetail, TrackingOrderRow, TrackingVehicle } from "../types";

function visibleVin(vehicle: TrackingVehicle) {
  return vehicle.vin?.startsWith("PENDING-") ? "لم يُحدد بعد" : vehicle.vin || "—";
}

export function DashboardTrackingOrderModal({
  target,
  order,
  loading,
  error,
  onClose,
}: {
  target: TrackingOrderRow | null;
  order: TrackingOrderDetail | null;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  const [activeVehicleId, setActiveVehicleId] = useState("");

  useEffect(() => {
    setActiveVehicleId(order?.vehicles[0]?.id || "");
  }, [order?.id]);

  const activeVehicle = useMemo(
    () => order?.vehicles.find((vehicle) => vehicle.id === activeVehicleId) || order?.vehicles[0] || null,
    [order, activeVehicleId],
  );

  const display = order || target;

  return (
    <Modal
      open={Boolean(target)}
      title={display ? `طلب التتبع ${display.sales_order_no}` : "تفاصيل طلب التتبع"}
      subtitle={display ? `${display.customer_name || "—"} · ${trackingStatusLabel(display.status, Boolean(display.is_archived), Boolean(display.is_cancelled))}` : undefined}
      onClose={onClose}
      className="wide dashboard-tracking-order-modal"
      level={2}
    >
      {loading ? <div className="dashboard-tracking-detail-state">جاري تحميل تفاصيل طلب التتبع...</div> : null}
      {!loading && error ? <div className="operations-alert error dashboard-tracking-detail-state">{error}</div> : null}
      {!loading && !error && order ? (
        <div className="dashboard-tracking-order-content">
          {order.is_cancelled ? <div className="connection-banner warning"><WarningCircle size={20} weight="fill" /><span>هذا الطلب ملغي من NEXT ERP، وتم إيقاف مراحله مع الاحتفاظ بسجل التنفيذ.</span></div> : null}
          {order.is_archived ? (
            <div className="tracking-archived-notice">
              <Archive size={24} weight="duotone" />
              <div>
                <strong>الطلب موجود في الأرشيف</strong>
                <span>{order.archived_at ? `تمت الأرشفة في ${formatTrackingDate(order.archived_at)}` : "طلب مؤرشف"}{order.archived_by_name ? ` بواسطة ${order.archived_by_name}` : ""}</span>
                {order.archive_reason ? <small>{order.archive_reason}</small> : null}
              </div>
            </div>
          ) : null}

          <section className="tracking-order-info-grid dashboard-tracking-info-grid">
            <div><User size={18} /><span><small>اسم العميل</small><strong>{order.customer_name || "—"}</strong></span></div>
            <div><Phone size={18} /><span><small>رقم الجوال</small><strong>{order.customer_mobile || "—"}</strong></span></div>
            <div><MapPin size={18} /><span><small>الفرع</small><strong>{trackingBranchLabel(order.branch)}</strong></span></div>
            <div><CalendarBlank size={18} /><span><small>تاريخ الطلب</small><strong>{formatTrackingDate(order.order_date, false)}</strong></span></div>
            <div><CalendarBlank size={18} /><span><small>تاريخ التسليم</small><strong>{formatTrackingDate(order.delivery_date, false)}</strong></span></div>
            <div><CurrencyCircleDollar size={18} /><span><small>الإجمالي شامل الضريبة</small><strong>{formatTrackingMoney(order.total_incl_vat)}</strong></span></div>
            <div><CurrencyCircleDollar size={18} /><span><small>الدفعة المقدمة</small><strong>{formatTrackingMoney(order.advance_paid)}</strong></span></div>
            <div><CurrencyCircleDollar size={18} /><span><small>المتبقي</small><strong>{formatTrackingMoney(Math.max(0, Number(order.total_incl_vat || 0) - Number(order.advance_paid || 0)))}</strong></span></div>
          </section>

          <section className="tracking-vehicle-section dashboard-tracking-vehicle-section">
            <div className="tracking-section-heading"><div><Car size={20} /><h3>السيارات ومراحل التتبع</h3></div><span>{order.vehicles.length}</span></div>
            <div className="tracking-vehicle-tabs">
              {order.vehicles.map((vehicle, index) => (
                <button key={vehicle.id} type="button" className={activeVehicle?.id === vehicle.id ? "active" : ""} onClick={() => setActiveVehicleId(vehicle.id)}>
                  سيارة {index + 1}<small>{visibleVin(vehicle)}</small>
                </button>
              ))}
            </div>

            {activeVehicle ? (
              <>
                <div className="tracking-car-details dashboard-tracking-car-details">
                  <div><small>السيارة</small><strong>{activeVehicle.car_name || [activeVehicle.item_type, activeVehicle.item_category, activeVehicle.item_model].filter(Boolean).join(" ") || "—"}</strong></div>
                  <div><small>رقم الهيكل</small><strong dir="ltr">{visibleVin(activeVehicle)}</strong></div>
                  <div><small>اللون الخارجي</small><strong>{activeVehicle.exterior_color || "—"}</strong></div>
                  <div><small>اللون الداخلي</small><strong>{activeVehicle.interior_color || "—"}</strong></div>
                  <div><small>الوكيل</small><strong>{activeVehicle.dealer || "—"}</strong></div>
                  <div><small>إجمالي السيارة</small><strong>{formatTrackingMoney(Number(activeVehicle.total_incl_vat || 0) + Number(activeVehicle.registration_fee || 0))}</strong></div>
                </div>
                <div className="tracking-stage-list dashboard-tracking-stage-list">
                  {activeVehicle.stages.map((stage) => {
                    const done = stage.status === "completed";
                    return (
                      <article key={stage.stage_id} className={`tracking-stage-card ${done ? "done" : ""}`}>
                        <div className="tracking-stage-number">{done ? <CheckCircle size={22} weight="fill" /> : stage.sort_order}</div>
                        <div className="tracking-stage-copy">
                          <h4>{stage.name}</h4>
                          <p>{stage.description || ""}</p>
                          <small>{done ? `تم في ${formatTrackingDate(stage.completed_at)}${stage.completed_by_name ? ` بواسطة ${stage.completed_by_name}` : ""}` : "لم تُنفذ بعد"}</small>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            ) : <div className="dashboard-tracking-detail-state">لا توجد سيارات داخل الطلب.</div>}
          </section>

          <section className="tracking-history-section dashboard-tracking-history-section">
            <div className="tracking-section-heading"><div><Clock size={20} /><h3>سجل الإجراءات</h3></div><span>{order.events.length}</span></div>
            <div className="tracking-history-list">
              {!order.events.length ? <p className="tracking-empty-note">لم يتم تنفيذ أي إجراء حتى الآن.</p> : order.events.map((event) => (
                <div key={event.id}>
                  <span className={event.action}>{event.action === "completed" ? "إنهاء" : "تراجع"}</span>
                  <p><strong>{event.stage_name}</strong> — {event.vin?.startsWith("PENDING-") ? `السيارة رقم ${event.item_no || "—"}` : event.vin || "—"}</p>
                  <small>{event.actor_name || "مستخدم المنصة"} • {formatTrackingDate(event.created_at)}</small>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </Modal>
  );
}
