import { useEffect, useMemo, useState } from "react";
import { Archive, Car, CheckCircle, MagnifyingGlass, MapPin, WarningCircle } from "@phosphor-icons/react";
import { formatTrackingDate, formatTrackingMoney, trackingFetch } from "../api";
import type { PublicTrackingOrder, TrackingVehicle } from "../types";

function visibleVin(vehicle: TrackingVehicle) {
  return vehicle.vin?.startsWith("PENDING-") ? "لم يُحدد بعد" : vehicle.vin || "—";
}

export function PublicTrackingPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialKey = params.get("vin") || params.get("order") || params.get("orderNo") || params.get("o") || "";
  const [key, setKey] = useState(initialKey);
  const [order, setOrder] = useState<PublicTrackingOrder | null>(null);
  const [activeVehicleId, setActiveVehicleId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function search(value = key) {
    const normalized = value.trim();
    if (!normalized) {
      setError("من فضلك أدخل رقم الطلب أو رقم الهيكل أولًا.");
      setOrder(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const payload = await trackingFetch<{ ok: boolean; order: PublicTrackingOrder }>(`/api/tracking/public?key=${encodeURIComponent(normalized)}`);
      setOrder(payload.order);
      setActiveVehicleId(payload.order.vehicles[0]?.id || "");
    } catch (searchError) {
      setOrder(null);
      setError(searchError instanceof Error ? searchError.message : "حدث خطأ أثناء جلب بيانات الطلب");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (initialKey) void search(initialKey); }, []);

  const activeVehicle = useMemo(
    () => order?.vehicles.find((vehicle) => vehicle.id === activeVehicleId) || order?.vehicles[0] || null,
    [order, activeVehicleId],
  );
  const completed = activeVehicle?.stages.filter((stage) => stage.status === "completed").length || 0;
  const totalStages = activeVehicle?.stages.length || 0;
  const percent = totalStages ? Math.round((completed / totalStages) * 100) : 0;

  return (
    <main className="public-tracking-page" dir="rtl">
      <div className="public-tracking-shell">
        <header className="public-tracking-brand">
          <img src="/logo.png" alt="مجموعة محمد بن ذعار العجمي" />
          <div><h1>تتبع طلبك</h1><p>مع مجموعة محمد بن ذعار العجمي للسيارات… أنت نجم الطريق ⭐</p></div>
        </header>

        <section className="public-tracking-search">
          <label htmlFor="tracking-key">اكتب رقم الطلب أو رقم الهيكل</label>
          <div><input id="tracking-key" value={key} onChange={(event) => setKey(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search(); }} placeholder="مثال: SAL-ORD-2026-00001 أو رقم الهيكل" /><button type="button" onClick={() => void search()} disabled={loading}><MagnifyingGlass size={20} />{loading ? "جاري البحث..." : "تتبع"}</button></div>
        </section>

        {error ? <div className="public-tracking-error"><WarningCircle size={22} weight="fill" /><span>{error}</span></div> : null}

        {!order && !loading && !error ? <div className="public-tracking-empty"><Car size={54} weight="duotone" /><h2>تابع طلب سيارتك خطوة بخطوة</h2><p>أدخل رقم الطلب أو رقم الهيكل لعرض بيانات الطلب والسيارات ومراحل التنفيذ.</p></div> : null}

        {order ? (
          <div className="public-tracking-result">
            <section className="public-order-card">
              <div className="public-section-title"><span /><h2>بيانات الطلب</h2></div>
              <div className="public-info-grid">
                <div><small>رقم الطلب</small><strong>{order.sales_order_no}</strong></div>
                <div><small>اسم العميل</small><strong>{order.customer_name || "—"}</strong></div>
                <div><small>الفرع</small><strong>{order.branch || "—"}</strong></div>
                <div><small>تاريخ الطلب</small><strong>{formatTrackingDate(order.order_date, false)}</strong></div>
                <div><small>عدد السيارات</small><strong>{order.vehicles.length}</strong></div>
                <div><small>الإجمالي شامل الضريبة</small><strong>{formatTrackingMoney(order.total_incl_vat)}</strong></div>
              </div>
            </section>

            <section className="public-cars-card">
              <div className="public-section-title"><span /><h2>السيارات في هذا الطلب</h2></div>
              <div className="public-car-tabs">
                {order.vehicles.map((vehicle, index) => (
                  <button key={vehicle.id} type="button" className={activeVehicle?.id === vehicle.id ? "active" : ""} onClick={() => setActiveVehicleId(vehicle.id)}>
                    <Car size={18} /><span>سيارة {index + 1}<small>{vehicle.car_name || visibleVin(vehicle)}</small></span>
                  </button>
                ))}
              </div>

              {activeVehicle ? (
                <div className="public-car-body">
                  <div className="public-car-details">
                    <div><small>السيارة</small><strong>{activeVehicle.car_name || [activeVehicle.item_type, activeVehicle.item_category, activeVehicle.item_model].filter(Boolean).join(" ") || "—"}</strong></div>
                    <div><small>رقم الهيكل</small><strong>{visibleVin(activeVehicle)}</strong></div>
                    <div><small>اللون الخارجي</small><strong>{activeVehicle.exterior_color || "—"}</strong></div>
                    <div><small>اللون الداخلي</small><strong>{activeVehicle.interior_color || "—"}</strong></div>
                    <div><small>الوكيل</small><strong>{activeVehicle.dealer || "—"}</strong></div>
                    <div><small>إجمالي السيارة</small><strong>{formatTrackingMoney(Number(activeVehicle.total_incl_vat || 0) + Number(activeVehicle.registration_fee || 0))}</strong></div>
                  </div>

                  {order.is_archived ? (
                    <div className="public-archived-notice">
                      <Archive size={34} weight="duotone" />
                      <div><strong>الطلب منتهي</strong><span>تم الانتهاء من هذا الطلب وأرشفته بنجاح.</span></div>
                    </div>
                  ) : (
                    <>
                      <div className="public-progress-summary">
                        <div><span>حالة الطلب الحالية</span><strong>{completed === 0 ? "لم يبدأ بعد" : completed >= totalStages ? "تم إتمام جميع المراحل" : `تم تنفيذ ${completed} من ${totalStages} مراحل`}</strong></div>
                        <div><span>آخر تحديث</span><strong>{formatTrackingDate(order.updated_at)}</strong></div>
                      </div>
                      <div className="public-progress-row"><div><span>نسبة اكتمال الطلب</span><strong>{percent}%</strong></div><div className="public-progress-bar"><span style={{ width: `${percent}%` }} /></div></div>

                      <div className="public-timeline-title">خطوات طلبك من أول الحجز حتى استلام السيارة</div>
                      <ol className="public-timeline">
                        {activeVehicle.stages.map((stage) => {
                          const done = stage.status === "completed";
                          return (
                            <li key={stage.stage_id || stage.code} className={done ? "done" : ""}>
                              <div className="public-step-icon">{done ? <CheckCircle size={25} weight="fill" /> : stage.sort_order}</div>
                              <div><h3>{stage.name}</h3><p>{stage.description || ""}</p>{done ? <small>تم في: {formatTrackingDate(stage.completed_at)}</small> : null}</div>
                            </li>
                          );
                        })}
                      </ol>
                    </>
                  )}
                </div>
              ) : null}
            </section>
          </div>
        ) : null}

        <footer className="public-tracking-footer"><MapPin size={18} /><span>مجموعة محمد بن ذعار العجمي للسيارات • 920014635</span></footer>
      </div>
    </main>
  );
}
