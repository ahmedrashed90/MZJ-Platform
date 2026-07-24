import { useEffect, useState } from "react";
import { CheckCircle, ShieldWarning, Trash, WarningCircle } from "@phosphor-icons/react";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../systemAccess";
import { formatTrackingDate, trackingFetch } from "../api";

type DeletedRow = {
  id: string;
  order_internal_id?: string | null;
  sales_order_no: string;
  customer_name?: string | null;
  customer_mobile?: string | null;
  reason: string;
  deleted_by_name?: string | null;
  deleted_at: string;
  source_identity?: string | null;
  source_fingerprint?: string | null;
  request_id?: string | null;
};

export function TrackingDeletePage() {
  const { user } = useAuth();
  const canViewDeleteLog = hasPermission(user, "tracking.delete.view");
  const canRemoveDeletedRecord = hasPermission(user, "tracking.order.deleted.restore");
  const [deleted, setDeleted] = useState<DeletedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");

  async function loadDeleted() {
    if (!canViewDeleteLog) return;
    setLoading(true); setError("");
    try {
      const payload = await trackingFetch<{ ok: boolean; deleted: DeletedRow[] }>("/api/tracking/delete");
      setDeleted(payload.deleted || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل سجل الحذف");
    } finally { setLoading(false); }
  }

  useEffect(() => { void loadDeleted(); }, [canViewDeleteLog]);

  async function deleteDeletedRecord(row: DeletedRow) {
    const confirmed = window.confirm(`سيتم حذف سجل الطلب ${row.sales_order_no} من الطلبات المحذوفة، وبعدها يمكن استقبال نفس الطلب من NEXT ERP مرة أخرى. هل تريد المتابعة؟`);
    if (!confirmed) return;
    setDeletingId(row.id);
    setError("");
    try {
      await trackingFetch<{ ok: boolean; message: string }>("/api/tracking/delete", {
        method: "POST",
        body: JSON.stringify({ action: "delete_deleted_record", deletedId: row.id }),
      });
      setDeleted((current) => current.filter((item) => item.id !== row.id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "تعذر حذف سجل الطلب المحذوف");
    } finally {
      setDeletingId("");
    }
  }

  if (!canViewDeleteLog) {
    return <div className="module-page"><div className="panel tracking-access-denied"><ShieldWarning size={54} weight="duotone" /><h1>صلاحية حذف طلبات التراكينج مطلوبة</h1><p>هذه الصفحة متاحة فقط لمن لديه صلاحية مشاهدة سجل حذف طلبات التراكينج.</p></div></div>;
  }

  return (
    <div className="module-page tracking-delete-page">
      <header className="module-page-head"><div><h1>حذف طلبات التتبع — سجل الحذف</h1><p>تنفيذ حذف طلب التتبع يتم من داخل تفاصيل الطلب، ويمكن حذف سجله من هنا للسماح باستقباله مرة أخرى من NEXT ERP.</p></div><button type="button" className="tracking-refresh-button" onClick={() => void loadDeleted()} disabled={loading || Boolean(deletingId)}>تحديث</button></header>
      {error ? <div className="connection-banner"><WarningCircle size={20} weight="fill" /><span>{error}</span></div> : null}
      {!error && !loading ? <div className="success-banner tracking-success-banner"><CheckCircle size={20} weight="fill" /><span>حذف سجل الطلب من الطلبات المحذوفة يسمح باستقبال نفس الطلب من NEXT ERP مرة أخرى.</span></div> : null}
      <section className="panel tracking-deleted-log-panel">
        <div className="tracking-section-heading"><div><Trash size={20} /><h3>الطلبات المحذوفة</h3></div><span>{deleted.length}</span></div>
        <div className="tracking-table-wrap"><table className="tracking-table"><thead><tr><th>رقم الطلب</th><th>العميل</th><th>سبب الحذف</th><th>المنفذ</th><th>التاريخ</th><th>رقم المرجع</th><th>هوية المصدر</th><th>الإجراء</th></tr></thead><tbody>
          {!loading && deleted.length === 0 ? <tr><td colSpan={8} className="table-empty">لا توجد طلبات محذوفة</td></tr> : deleted.map((row) => <tr key={row.id}><td><strong>{row.sales_order_no}</strong></td><td>{row.customer_name || "—"}<small>{row.customer_mobile || ""}</small></td><td>{row.reason}</td><td>{row.deleted_by_name || "—"}</td><td>{formatTrackingDate(row.deleted_at)}</td><td>{row.request_id || "—"}</td><td title={row.source_identity || row.source_fingerprint || ""}>{row.source_identity || row.source_fingerprint || "—"}</td><td>{canRemoveDeletedRecord ? <button type="button" className="tracking-refresh-button tracking-delete-order-button" onClick={() => void deleteDeletedRecord(row)} disabled={Boolean(deletingId)}><Trash size={16} />{deletingId === row.id ? "جارٍ الحذف" : "حذف"}</button> : "—"}</td></tr>)}
        </tbody></table></div>
      </section>
    </div>
  );
}
