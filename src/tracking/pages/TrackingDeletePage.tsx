import { useEffect, useState } from "react";
import { CheckCircle, ShieldWarning, Trash, WarningCircle } from "@phosphor-icons/react";
import { useAuth } from "../../auth/AuthContext";
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
  const canDelete = Boolean(user?.roleCodes.some((code) => ["admin", "system_admin"].includes(code)) || user?.permissions.includes("tracking.orders.delete"));
  const [deleted, setDeleted] = useState<DeletedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadDeleted() {
    if (!canDelete) return;
    setLoading(true); setError("");
    try {
      const payload = await trackingFetch<{ ok: boolean; deleted: DeletedRow[] }>("/api/tracking/delete");
      setDeleted(payload.deleted || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل سجل الحذف");
    } finally { setLoading(false); }
  }

  useEffect(() => { void loadDeleted(); }, [canDelete]);

  if (!canDelete) {
    return <div className="module-page"><div className="panel tracking-access-denied"><ShieldWarning size={54} weight="duotone" /><h1>صلاحية حذف طلبات التراكينج مطلوبة</h1><p>هذه الصفحة متاحة لمدير النظام أو لمن لديه صلاحية tracking.orders.delete.</p></div></div>;
  }

  return (
    <div className="module-page tracking-delete-page">
      <header className="module-page-head"><div><h1>حذف طلبات التتبع — سجل المسح</h1><p>سجل تدقيق دائم. تنفيذ المسح يتم من داخل تفاصيل الطلب لضمان ظهور نافذة التأكيد فوق نافذة التفاصيل.</p></div><button type="button" className="tracking-refresh-button" onClick={() => void loadDeleted()} disabled={loading}>تحديث</button></header>
      {error ? <div className="connection-banner"><WarningCircle size={20} weight="fill" /><span>{error}</span></div> : null}
      {!error && !loading ? <div className="success-banner tracking-success-banner"><CheckCircle size={20} weight="fill" /><span>رقم الطلب ليس حظرًا دائمًا؛ نفس الرقم يُقبل مستقبلًا عند وصوله بهوية مصدر جديدة.</span></div> : null}
      <section className="panel tracking-deleted-log-panel">
        <div className="tracking-section-heading"><div><Trash size={20} /><h3>الطلبات الممسوحة</h3></div><span>{deleted.length}</span></div>
        <div className="tracking-table-wrap"><table className="tracking-table"><thead><tr><th>رقم الطلب</th><th>العميل</th><th>سبب المسح</th><th>المنفذ</th><th>التاريخ</th><th>رقم المرجع</th><th>هوية المصدر</th></tr></thead><tbody>
          {!loading && deleted.length === 0 ? <tr><td colSpan={7} className="table-empty">لا توجد طلبات ممسوحة</td></tr> : deleted.map((row) => <tr key={row.id}><td><strong>{row.sales_order_no}</strong></td><td>{row.customer_name || "—"}<small>{row.customer_mobile || ""}</small></td><td>{row.reason}</td><td>{row.deleted_by_name || "—"}</td><td>{formatTrackingDate(row.deleted_at)}</td><td>{row.request_id || "—"}</td><td title={row.source_identity || row.source_fingerprint || ""}>{row.source_identity || row.source_fingerprint || "—"}</td></tr>)}
        </tbody></table></div>
      </section>
    </div>
  );
}
