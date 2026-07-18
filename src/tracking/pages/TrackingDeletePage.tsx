import { useEffect, useMemo, useState } from "react";
import { CheckCircle, MagnifyingGlass, ShieldWarning, Trash, WarningCircle, X } from "@phosphor-icons/react";
import { useAuth } from "../../auth/AuthContext";
import { useEscapeToClose } from "../../components/useEscapeToClose";
import { formatTrackingDate, trackingFetch, trackingQuery } from "../api";
import type { TrackingOrderRow } from "../types";

type DeletedRow = {
  id: string;
  sales_order_no: string;
  customer_name?: string | null;
  customer_mobile?: string | null;
  reason: string;
  deleted_by_name?: string | null;
  deleted_at: string;
  is_blocked: boolean;
  released_at?: string | null;
};

export function TrackingDeletePage() {
  const { user } = useAuth();
  const isAdmin = user?.roleCodes.includes("admin") ?? false;
  const [search, setSearch] = useState("");
  const [orders, setOrders] = useState<TrackingOrderRow[]>([]);
  const [deleted, setDeleted] = useState<DeletedRow[]>([]);
  const [selected, setSelected] = useState<TrackingOrderRow | null>(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEscapeToClose(Boolean(selected), () => setSelected(null));

  async function loadDeleted() {
    if (!isAdmin) return;
    try {
      const payload = await trackingFetch<{ ok: boolean; deleted: DeletedRow[] }>("/api/tracking/delete");
      setDeleted(payload.deleted || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل سجل الحذف");
    }
  }

  async function findOrders() {
    if (!search.trim()) {
      setOrders([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const payload = await trackingFetch<{ ok: boolean; orders: TrackingOrderRow[] }>(`/api/tracking/orders${trackingQuery({ search, limit: 50 })}`);
      setOrders(payload.orders || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر البحث عن الطلبات");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadDeleted(); }, [isAdmin]);

  const canDelete = useMemo(
    () => Boolean(selected && reason.trim() && confirmation.trim() === selected.sales_order_no),
    [selected, reason, confirmation],
  );

  async function deleteOrder() {
    if (!selected || !canDelete) return;
    setActionLoading(selected.id);
    setError("");
    setMessage("");
    try {
      const payload = await trackingFetch<{ ok: boolean; message: string }>("/api/tracking/delete", {
        method: "POST",
        body: JSON.stringify({ action: "delete", orderId: selected.id, confirmation, reason }),
      });
      setMessage(payload.message);
      setSelected(null);
      setReason("");
      setConfirmation("");
      setOrders((current) => current.filter((order) => order.id !== selected.id));
      await loadDeleted();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "تعذر حذف الطلب");
    } finally {
      setActionLoading("");
    }
  }

  async function allowResync(orderNo: string) {
    setActionLoading(orderNo);
    setMessage("");
    setError("");
    try {
      const payload = await trackingFetch<{ ok: boolean; message: string }>("/api/tracking/delete", {
        method: "POST",
        body: JSON.stringify({ action: "allow_resync", orderNo }),
      });
      setMessage(payload.message);
      await loadDeleted();
    } catch (allowError) {
      setError(allowError instanceof Error ? allowError.message : "تعذر السماح بإعادة المزامنة");
    } finally {
      setActionLoading("");
    }
  }

  if (!isAdmin) {
    return <div className="module-page"><div className="panel tracking-access-denied"><ShieldWarning size={54} weight="duotone" /><h1>صلاحية الإدارة مطلوبة</h1><p>حذف طلبات التتبع متاح لمدير النظام فقط.</p></div></div>;
  }

  return (
    <div className="module-page tracking-delete-page">
      <header className="module-page-head">
        <div><h1>حذف طلبات التتبع</h1><p>حذف الطلب وكل السيارات والمراحل مع الاحتفاظ بسجل إداري ومنع عودته تلقائيًا.</p></div>
      </header>

      {error ? <div className="connection-banner"><WarningCircle size={20} weight="fill" /><span>{error}</span></div> : null}
      {message ? <div className="success-banner tracking-success-banner"><CheckCircle size={20} weight="fill" /><span>{message}</span></div> : null}

      <section className="panel tracking-delete-search-panel">
        <div className="tracking-delete-warning"><ShieldWarning size={28} weight="duotone" /><div><strong>الحذف نهائي داخل المنصة</strong><span>سيتم حذف السيارات والمراحل والسجلات، مع منع Google Sheet من إعادة إنشاء نفس الطلب تلقائيًا.</span></div></div>
        <div className="tracking-list-toolbar">
          <div className="tracking-search-box"><MagnifyingGlass size={19} /><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void findOrders(); }} placeholder="رقم الطلب أو الهيكل أو اسم العميل أو الجوال" />{search ? <button type="button" onClick={() => { setSearch(""); setOrders([]); }}><X size={16} /></button> : null}</div>
          <button type="button" className="tracking-search-button" onClick={() => void findOrders()} disabled={loading}><MagnifyingGlass size={17} />{loading ? "جاري البحث..." : "بحث"}</button>
        </div>
        <div className="tracking-delete-results">
          {orders.map((order) => (
            <button key={order.id} type="button" onClick={() => { setSelected(order); setReason(""); setConfirmation(""); }}>
              <span><strong>{order.sales_order_no}</strong><small>{order.customer_name || "—"} • {order.customer_mobile || "—"}</small></span>
              <span>{order.vehicles_count} سيارة</span>
            </button>
          ))}
          {!loading && search && orders.length === 0 ? <p>لا توجد طلبات مطابقة.</p> : null}
        </div>
      </section>

      <section className="panel tracking-deleted-log-panel">
        <div className="tracking-section-heading"><div><Trash size={20} /><h3>سجل الطلبات المحذوفة</h3></div><span>{deleted.length}</span></div>
        <div className="tracking-table-wrap">
          <table className="tracking-table">
            <thead><tr><th>رقم الطلب</th><th>العميل</th><th>سبب الحذف</th><th>نفذ بواسطة</th><th>تاريخ الحذف</th><th>إعادة الاستقبال</th></tr></thead>
            <tbody>
              {deleted.length === 0 ? <tr><td colSpan={6} className="table-empty">لا توجد طلبات محذوفة</td></tr> : deleted.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.sales_order_no}</strong></td>
                  <td>{row.customer_name || "—"}</td>
                  <td>{row.reason}</td>
                  <td>{row.deleted_by_name || "—"}</td>
                  <td>{formatTrackingDate(row.deleted_at)}</td>
                  <td>{row.is_blocked ? <button type="button" className="tracking-allow-button" disabled={Boolean(actionLoading)} onClick={() => void allowResync(row.sales_order_no)}>{actionLoading === row.sales_order_no ? "جاري..." : "السماح مرة أخرى"}</button> : <span className="tracking-resync-open">مسموح</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selected ? (
        <div className="modal-backdrop tracking-delete-modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelected(null); }}>
          <div className="tracking-delete-modal">
            <header><div><ShieldWarning size={26} weight="duotone" /><span><strong>تأكيد حذف طلب التتبع</strong><small>{selected.sales_order_no}</small></span></div><button type="button" onClick={() => setSelected(null)}><X size={20} /></button></header>
            <div className="tracking-delete-summary"><p><b>العميل:</b> {selected.customer_name || "—"}</p><p><b>الجوال:</b> {selected.customer_mobile || "—"}</p><p><b>عدد السيارات:</b> {selected.vehicles_count}</p></div>
            <label><span>سبب الحذف</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="اكتب سبب حذف الطلب" rows={4} /></label>
            <label><span>اكتب رقم الطلب للتأكيد</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={selected.sales_order_no} /></label>
            <div className="tracking-delete-modal-actions"><button type="button" className="secondary" onClick={() => setSelected(null)}>إلغاء</button><button type="button" className="danger" disabled={!canDelete || Boolean(actionLoading)} onClick={() => void deleteOrder()}><Trash size={17} />{actionLoading === selected.id ? "جاري الحذف..." : "حذف الطلب نهائيًا"}</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
