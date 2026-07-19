import { useEffect, useMemo, useState } from "react";
import {
  ArchiveBox,
  ArrowClockwise,
  ArrowCounterClockwise,
  CalendarBlank,
  Car,
  ChatText,
  CheckCircle,
  Clock,
  Copy,
  CurrencyCircleDollar,
  LinkSimple,
  MagnifyingGlass,
  MapPin,
  Phone,
  User,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useEscapeToClose } from "../../components/useEscapeToClose";
import { trackingFetch, trackingQuery, formatTrackingDate, formatTrackingMoney, trackingStatusLabel } from "../api";
import type { TrackingCounts, TrackingOrderDetail, TrackingOrderRow, TrackingStage, TrackingVehicle } from "../types";

type ListResponse = { ok: boolean; orders: TrackingOrderRow[]; counts: TrackingCounts };
type DetailResponse = { ok: boolean; order: TrackingOrderDetail; message?: string };

function progress(order: Pick<TrackingOrderRow, "completed_stages" | "total_stages">) {
  const total = Number(order.total_stages || 0);
  return total > 0 ? Math.round((Number(order.completed_stages || 0) / total) * 100) : 0;
}

function visibleVin(vehicle: TrackingVehicle) {
  return vehicle.vin?.startsWith("PENDING-") ? "لم يُحدد بعد" : vehicle.vin || "—";
}

export function TrackingOrdersPage({ archivedOnly = false }: { archivedOnly?: boolean }) {
  const [orders, setOrders] = useState<TrackingOrderRow[]>([]);
  const [counts, setCounts] = useState<TrackingCounts>({ total: 0, not_started: 0, in_progress: 0, completed: 0, archived: 0 });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<TrackingOrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeVehicleId, setActiveVehicleId] = useState("");
  const [actionKey, setActionKey] = useState("");

  useEscapeToClose(Boolean(selected), () => setSelected(null));

  async function loadOrders(nextSearch = search, nextStatus = status) {
    setLoading(true);
    setError("");
    try {
      const payload = await trackingFetch<ListResponse>(`/api/tracking/orders${trackingQuery({ search: nextSearch, status: nextStatus, archived: archivedOnly ? "true" : "false" })}`);
      setOrders(payload.orders || []);
      setCounts(payload.counts || { total: 0, not_started: 0, in_progress: 0, completed: 0, archived: 0 });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل طلبات التتبع");
    } finally {
      setLoading(false);
    }
  }

  async function openOrder(id: string) {
    setDetailLoading(true);
    setError("");
    try {
      const payload = await trackingFetch<DetailResponse>(`/api/tracking/orders?id=${encodeURIComponent(id)}`);
      setSelected(payload.order);
      setActiveVehicleId(payload.order.vehicles[0]?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر فتح طلب التتبع");
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => { setStatus(""); void loadOrders("", ""); }, [archivedOnly]);

  const activeVehicle = useMemo(
    () => selected?.vehicles.find((vehicle) => vehicle.id === activeVehicleId) || selected?.vehicles[0] || null,
    [selected, activeVehicleId],
  );

  async function stageAction(action: "complete_stage" | "revert_stage", vehicle: TrackingVehicle, stage: TrackingStage) {
    if (!selected) return;
    const key = `${action}:${vehicle.id}:${stage.stage_id}`;
    setActionKey(key);
    setMessage("");
    setError("");
    try {
      const payload = await trackingFetch<DetailResponse>("/api/tracking/orders", {
        method: "POST",
        body: JSON.stringify({ action, vehicleId: vehicle.id, stageId: stage.stage_id }),
      });
      setSelected(payload.order);
      setMessage(payload.message || "تم تحديث المرحلة");
      await loadOrders();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "تعذر تحديث المرحلة");
    } finally {
      setActionKey("");
    }
  }

  async function sendSms(vehicle: TrackingVehicle, stage: TrackingStage) {
    if (!selected) return;
    const key = `sms:${vehicle.id}:${stage.stage_id}`;
    setActionKey(key);
    setMessage("");
    setError("");
    try {
      const payload = await trackingFetch<{ ok: boolean; message: string }>("/api/tracking/sms", {
        method: "POST",
        body: JSON.stringify({ orderId: selected.id, vehicleId: vehicle.id, stageId: stage.stage_id }),
      });
      setMessage(payload.message || "تم إرسال الرسالة إلى SMS+");
      await openOrder(selected.id);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "تعذر إرسال SMS+");
    } finally {
      setActionKey("");
    }
  }

  async function archiveOrder() {
    if (!selected || selected.is_archived) return;
    const confirmed = window.confirm(`نقل الطلب ${selected.sales_order_no} إلى الأرشيف؟`);
    if (!confirmed) return;
    setActionKey(`archive:${selected.id}`);
    setMessage("");
    setError("");
    try {
      const payload = await trackingFetch<DetailResponse>("/api/tracking/orders", {
        method: "POST",
        body: JSON.stringify({ action: "archive_order", orderId: selected.id }),
      });
      setSelected(null);
      setMessage(payload.message || "تم نقل الطلب إلى الأرشيف");
      await loadOrders();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "تعذر أرشفة الطلب");
    } finally {
      setActionKey("");
    }
  }

  function trackingUrl(vehicle?: TrackingVehicle | null) {
    if (!selected) return "";
    const key = vehicle && !vehicle.vin.startsWith("PENDING-")
      ? `vin=${encodeURIComponent(vehicle.vin)}`
      : `order=${encodeURIComponent(selected.sales_order_no)}`;
    return `${window.location.origin}/track?${key}`;
  }

  async function copyLink(vehicle?: TrackingVehicle | null) {
    const url = trackingUrl(vehicle);
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setMessage("تم نسخ رابط تتبع العميل");
  }

  return (
    <div className="module-page tracking-orders-page">
      <header className="module-page-head tracking-page-head">
        <div>
          <h1>{archivedOnly ? "أرشيف طلبات التتبع" : "طلبات التتبع"}</h1>
          <p>{archivedOnly ? "الطلبات المنتهية التي تم نقلها إلى الأرشيف." : "طلبات البيع والسيارات ومراحل التنفيذ وروابط تتبع العميل من داخل المنصة."}</p>
        </div>
        <button type="button" className="tracking-refresh-button" onClick={() => void loadOrders()} disabled={loading}>
          <ArrowClockwise size={18} className={loading ? "spin" : ""} />
          تحديث
        </button>
      </header>

      {error ? <div className="connection-banner"><WarningCircle size={20} weight="fill" /><span>{error}</span></div> : null}
      {message ? <div className="success-banner tracking-success-banner"><CheckCircle size={20} weight="fill" /><span>{message}</span></div> : null}

      <section className={`tracking-summary-grid ${archivedOnly ? "archive-only" : ""}`}>
        {(archivedOnly ? [
          { key: "", label: "إجمالي الطلبات المؤرشفة", value: counts.archived, icon: ArchiveBox },
        ] : [
          { key: "", label: "إجمالي الطلبات", value: counts.total, icon: Car },
          { key: "not_started", label: "لم تبدأ", value: counts.not_started, icon: Clock },
          { key: "in_progress", label: "تحت الإجراء", value: counts.in_progress, icon: ArrowClockwise },
          { key: "completed", label: "مكتملة", value: counts.completed, icon: CheckCircle },
        ]).map(({ key, label, value, icon: Icon }) => (
          <button key={label} type="button" className={`tracking-summary-card ${status === key ? "active" : ""}`} onClick={() => { setStatus(key); void loadOrders(search, key); }}>
            <span className="tracking-summary-icon"><Icon size={23} weight="duotone" /></span>
            <span><small>{label}</small><strong>{value}</strong></span>
          </button>
        ))}
      </section>

      <section className="panel tracking-list-panel">
        <div className="tracking-list-toolbar">
          <div className="tracking-search-box">
            <MagnifyingGlass size={19} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void loadOrders(); }}
              placeholder="ابحث برقم الطلب أو الهيكل أو اسم العميل أو الجوال"
            />
            {search ? <button type="button" onClick={() => { setSearch(""); void loadOrders("", status); }}><X size={16} /></button> : null}
          </div>
          <button type="button" className="tracking-search-button" onClick={() => void loadOrders()}><MagnifyingGlass size={17} />بحث</button>
        </div>

        <div className="tracking-table-wrap">
          <table className="tracking-table">
            <thead><tr><th>رقم الطلب</th><th>العميل</th><th>الفرع</th><th>السيارات</th><th>التقدم</th><th>الحالة</th><th>آخر تحديث</th></tr></thead>
            <tbody>
              {!loading && orders.length === 0 ? <tr><td colSpan={7} className="table-empty">لا توجد طلبات مطابقة</td></tr> : null}
              {orders.map((order) => {
                const percent = progress(order);
                return (
                  <tr key={order.id} onClick={() => void openOrder(order.id)}>
                    <td><button type="button" className="tracking-order-link">{order.sales_order_no}</button><small>{order.vins || "لا يوجد رقم هيكل"}</small></td>
                    <td><strong>{order.customer_name || "—"}</strong><small>{order.customer_mobile || "—"}</small></td>
                    <td>{order.branch || "—"}</td>
                    <td>{order.vehicles_count}</td>
                    <td><div className="tracking-mini-progress"><span style={{ width: `${percent}%` }} /></div><small>{percent}%</small></td>
                    <td><span className={`tracking-status ${order.is_archived ? "archived" : order.status}`}>{trackingStatusLabel(order.status, order.is_archived)}</span></td>
                    <td>{formatTrackingDate(order.updated_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {loading ? <div className="tracking-loading">جاري تحميل طلبات التتبع...</div> : null}
      </section>

      {detailLoading && !selected ? <div className="tracking-loading-overlay">جاري فتح الطلب...</div> : null}

      {selected ? (
        <div className="crm-drawer-backdrop tracking-detail-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelected(null); }}>
          <aside className="tracking-detail-drawer" aria-label="تفاصيل طلب التتبع">
            <header className="tracking-detail-header">
              <div>
                <span>طلب التتبع</span>
                <h2>{selected.sales_order_no}</h2>
                <p>{selected.customer_name || "—"}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="إغلاق"><X size={22} /></button>
            </header>

            <div className="tracking-detail-actions">
              <button type="button" onClick={() => void copyLink(activeVehicle)}><Copy size={17} />نسخ رابط العميل</button>
              <button type="button" onClick={() => window.open(trackingUrl(activeVehicle), "_blank")}><LinkSimple size={17} />فتح صفحة العميل</button>
              {!selected.is_archived && Number(selected.total_stages || 0) > 0 && Number(selected.completed_stages || 0) >= Number(selected.total_stages || 0) ? (
                <button type="button" className="tracking-archive-button" onClick={() => void archiveOrder()} disabled={Boolean(actionKey)}>
                  <ArchiveBox size={17} />{actionKey === `archive:${selected.id}` ? "جاري الأرشفة..." : "أرشفة الطلب"}
                </button>
              ) : null}
            </div>

            <div className="tracking-detail-body">
              <section className="tracking-order-info-grid">
                <div><User size={18} /><span><small>اسم العميل</small><strong>{selected.customer_name || "—"}</strong></span></div>
                <div><Phone size={18} /><span><small>رقم الجوال</small><strong>{selected.customer_mobile || "—"}</strong></span></div>
                <div><MapPin size={18} /><span><small>الفرع</small><strong>{selected.branch || "—"}</strong></span></div>
                <div><CalendarBlank size={18} /><span><small>تاريخ الطلب</small><strong>{formatTrackingDate(selected.order_date, false)}</strong></span></div>
                <div><CalendarBlank size={18} /><span><small>تاريخ التسليم</small><strong>{formatTrackingDate(selected.delivery_date, false)}</strong></span></div>
                <div><CurrencyCircleDollar size={18} /><span><small>الإجمالي شامل الضريبة</small><strong>{formatTrackingMoney(selected.total_incl_vat)}</strong></span></div>
              </section>

              {selected.is_archived ? (
                <div className="tracking-archived-notice">
                  <ArchiveBox size={24} weight="duotone" />
                  <div><strong>الطلب موجود في الأرشيف</strong><span>{selected.archived_at ? `تمت الأرشفة في ${formatTrackingDate(selected.archived_at)}` : "طلب منتهي ومؤرشف"}{selected.archived_by_name ? ` بواسطة ${selected.archived_by_name}` : ""}</span></div>
                </div>
              ) : null}

              <section className="tracking-vehicle-section">
                <div className="tracking-section-heading"><div><Car size={20} /><h3>السيارات في الطلب</h3></div><span>{selected.vehicles.length}</span></div>
                <div className="tracking-vehicle-tabs">
                  {selected.vehicles.map((vehicle, index) => (
                    <button key={vehicle.id} type="button" className={activeVehicle?.id === vehicle.id ? "active" : ""} onClick={() => setActiveVehicleId(vehicle.id)}>
                      سيارة {index + 1}<small>{visibleVin(vehicle)}</small>
                    </button>
                  ))}
                </div>

                {activeVehicle ? (
                  <>
                    <div className="tracking-car-details">
                      <div><small>السيارة</small><strong>{activeVehicle.car_name || [activeVehicle.item_type, activeVehicle.item_category, activeVehicle.item_model].filter(Boolean).join(" ") || "—"}</strong></div>
                      <div><small>رقم الهيكل</small><strong>{visibleVin(activeVehicle)}</strong></div>
                      <div><small>اللون الخارجي</small><strong>{activeVehicle.exterior_color || "—"}</strong></div>
                      <div><small>اللون الداخلي</small><strong>{activeVehicle.interior_color || "—"}</strong></div>
                      <div><small>الوكيل</small><strong>{activeVehicle.dealer || "—"}</strong></div>
                      <div><small>إجمالي السيارة</small><strong>{formatTrackingMoney(Number(activeVehicle.total_incl_vat || 0) + Number(activeVehicle.registration_fee || 0))}</strong></div>
                    </div>

                    <div className="tracking-section-heading tracking-stages-heading"><div><CheckCircle size={20} /><h3>مراحل التتبع</h3></div><span>{activeVehicle.stages.filter((stage) => stage.status === "completed").length}/{activeVehicle.stages.length}</span></div>
                    <div className="tracking-stage-list">
                      {activeVehicle.stages.map((stage) => {
                        const done = stage.status === "completed";
                        const completeKey = `complete_stage:${activeVehicle.id}:${stage.stage_id}`;
                        const revertKey = `revert_stage:${activeVehicle.id}:${stage.stage_id}`;
                        const smsKey = `sms:${activeVehicle.id}:${stage.stage_id}`;
                        return (
                          <article key={stage.stage_id} className={`tracking-stage-card ${done ? "done" : ""}`}>
                            <div className="tracking-stage-number">{done ? <CheckCircle size={22} weight="fill" /> : stage.sort_order}</div>
                            <div className="tracking-stage-copy">
                              <h4>{stage.name}</h4>
                              <p>{stage.description || ""}</p>
                              <small>{done ? `تم في ${formatTrackingDate(stage.completed_at)}${stage.completed_by_name ? ` بواسطة ${stage.completed_by_name}` : ""}` : "لم تُنفذ بعد"}</small>
                            </div>
                            <div className="tracking-stage-actions">
                              {!selected.is_archived && !done ? <button type="button" onClick={() => void stageAction("complete_stage", activeVehicle, stage)} disabled={Boolean(actionKey)}>{actionKey === completeKey ? "جاري..." : "تم الانتهاء"}</button> : null}
                              {!selected.is_archived && done ? <button type="button" className="secondary" onClick={() => void stageAction("revert_stage", activeVehicle, stage)} disabled={Boolean(actionKey)}><ArrowCounterClockwise size={15} />{actionKey === revertKey ? "جاري..." : "تراجع"}</button> : null}
                              {!selected.is_archived && stage.sms_enabled ? <button type="button" className="sms" onClick={() => void sendSms(activeVehicle, stage)} disabled={Boolean(actionKey)}><ChatText size={16} />{actionKey === smsKey ? "جاري..." : "SMS+"}</button> : null}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </>
                ) : null}
              </section>

              <section className="tracking-history-section">
                <div className="tracking-section-heading"><div><Clock size={20} /><h3>سجل الإجراءات</h3></div><span>{selected.events.length}</span></div>
                <div className="tracking-history-list">
                  {selected.events.length === 0 ? <p className="tracking-empty-note">لم يتم تنفيذ أي إجراء حتى الآن.</p> : selected.events.map((event) => (
                    <div key={event.id}>
                      <span className={event.action}>{event.action === "completed" ? "إنهاء" : "تراجع"}</span>
                      <p><strong>{event.stage_name}</strong> — {event.vin?.startsWith("PENDING-") ? `السيارة رقم ${event.item_no || "—"}` : event.vin}</p>
                      <small>{event.actor_name || "مستخدم المنصة"} • {formatTrackingDate(event.created_at)}</small>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
