import { useEffect, useState } from "react";
import { ClockCounterClockwise, ShieldWarning, WarningCircle } from "@phosphor-icons/react";
import { useAuth } from "../../auth/AuthContext";
import { formatTrackingDate, trackingFetch } from "../api";

type DeletedRow = {
  id: string;
  sales_order_no: string;
  customer_name?: string | null;
  customer_mobile?: string | null;
  reason: string;
  deleted_by_name?: string | null;
  deleted_at: string;
  source?: string | null;
  source_identity?: string | null;
  source_fingerprint?: string | null;
  request_id?: string | null;
};

export function TrackingDeletePage() {
  const { user } = useAuth();
  const canView = Boolean(
    user?.roleCodes.some((code) => code === "admin" || code === "system_admin")
      || user?.permissionCodes?.includes("tracking.orders.delete"),
  );
  const [deleted, setDeleted] = useState<DeletedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    setLoading(true);
    trackingFetch<{ ok: boolean; deleted: DeletedRow[] }>("/api/tracking/delete")
      .then((payload) => { if (!cancelled) setDeleted(payload.deleted || []); })
      .catch((failure) => { if (!cancelled) setError(failure instanceof Error ? failure.message : "تعذر تحميل سجل الحذف"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [canView]);

  if (!canView) {
    return <div className="module-page"><div className="panel tracking-access-denied"><ShieldWarning size={54} weight="duotone" /><h1>صلاحية الإدارة مطلوبة</h1><p>سجل حذف طلبات التراكينج متاح للمستخدم المخول فقط.</p></div></div>;
  }

  return (
    <div className="module-page tracking-delete-page">
      <header className="module-page-head">
        <div><h1>سجل حذف طلبات التراكينج</h1><p>يتم تنفيذ الحذف من داخل تفاصيل الطلب، ويحتفظ هذا السجل بنسخة التدقيق وهوية المصدر.</p></div>
      </header>
      {error ? <div className="connection-banner"><WarningCircle size={20} weight="fill" /><span>{error}</span></div> : null}
      <section className="panel tracking-deleted-log-panel">
        <div className="tracking-section-heading"><div><ClockCounterClockwise size={20} /><h3>الطلبات المحذوفة</h3></div><span>{deleted.length}</span></div>
        <div className="tracking-table-wrap">
          <table className="tracking-table">
            <thead><tr><th>رقم الطلب</th><th>العميل</th><th>الجوال</th><th>سبب الحذف</th><th>نفذ بواسطة</th><th>تاريخ الحذف</th><th>رقم المرجع</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={7} className="table-empty">جاري تحميل السجل...</td></tr> : deleted.length === 0 ? <tr><td colSpan={7} className="table-empty">لا توجد طلبات محذوفة</td></tr> : deleted.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.sales_order_no}</strong></td>
                  <td>{row.customer_name || "—"}</td>
                  <td>{row.customer_mobile || "—"}</td>
                  <td>{row.reason}</td>
                  <td>{row.deleted_by_name || "—"}</td>
                  <td>{formatTrackingDate(row.deleted_at)}</td>
                  <td><code>{row.request_id || "—"}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
