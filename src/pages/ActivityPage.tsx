import { useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  ClockCounterClockwise,
  Eye,
  Funnel,
  MagnifyingGlass,
  Pulse,
  ShieldWarning,
  Trash,
  UserCircle,
  UsersThree,
} from "@phosphor-icons/react";
import { Modal } from "../components/Modal";

type ActivityRow = {
  id: string;
  user_id: string | null;
  user_name: string;
  user_email: string | null;
  user_role: string | null;
  system_code: string;
  page_code: string | null;
  permission_code: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  result: string | null;
  rejection_reason: string | null;
  request_id: string | null;
  created_at: string;
  activity_title: string;
  activity_description: string;
  activity_details: Array<{ label: string; value: string }>;
};

type ActivityResponse = {
  ok: boolean;
  rows: ActivityRow[];
  total: number;
  page: number;
  pageSize: number;
  stats: { today: number; failed: number; activeUsers: number; pageViews: number };
  filters: { systems: string[]; actions: string[] };
  canDelete: boolean;
  error?: string;
};

const systemLabels: Record<string, string> = {
  core: "المنصة",
  crm: "CRM",
  marketing: "التسويق",
  operations: "العمليات",
  tracking: "التراكينج",
  integrations: "التكاملات",
};

const actionLabels: Record<string, string> = {
  page_view: "فتح صفحة",
  login: "تسجيل دخول",
  logout: "تسجيل خروج",
  login_failed: "محاولة دخول غير ناجحة",
  user_created: "إنشاء مستخدم",
  user_updated: "تعديل مستخدم",
  user_deleted: "حذف مستخدم",
  role_created: "إنشاء دور",
  role_updated: "تعديل دور",
  branch_created: "إنشاء فرع",
  branch_updated: "تعديل فرع",
  department_created: "إنشاء قسم",
  department_updated: "تعديل قسم",
  vehicle_created: "إضافة سيارة",
  vehicle_updated: "تعديل سيارة",
  vehicle_deleted: "حذف سيارة",
  operation_location_saved: "حفظ مكان سيارة",
  operation_status_saved: "حفظ إعداد حالة سيارة",
  create_campaign: "إنشاء حملة",
  create_agenda: "إنشاء أجندة",
  receive_task: "استلام تاسك",
  upload_template: "رفع Task Template",
  review_template: "مراجعة Task Template",
  save_publish_prep: "حفظ تجهيز النشر",
  archive_entity: "أرشفة سجل",
  delete_entity: "حذف سجل",
  permission_denied: "رفض صلاحية",
  erpnext_vehicle_status_synced: "مزامنة حالة سيارة من NEXT ERP",
  activity_log_deleted: "مسح سجل النشاط",
};

function labelAction(value: string) {
  return actionLabels[value] || value.replace(/_/g, " ");
}

function resultLabel(value: string | null) {
  const labels: Record<string, string> = { success: "ناجح", allowed: "مسموح", failure: "فشل", denied: "مرفوض" };
  return labels[value || ""] || value || "مسجل";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" });
}

function queryString(values: Record<string, string | number>) {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (String(value).trim()) query.set(key, String(value));
  });
  return query.toString() ? `?${query.toString()}` : "";
}


export function ActivityPage() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ActivityRow | null>(null);
  const [canDelete, setCanDelete] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteRange, setDeleteRange] = useState({ dateFrom: "", dateTo: "" });
  const [stats, setStats] = useState({ today: 0, failed: 0, activeUsers: 0, pageViews: 0 });
  const [available, setAvailable] = useState({ systems: [] as string[], actions: [] as string[] });
  const [filters, setFilters] = useState({ search: "", system: "", action: "", result: "", actor: "", dateFrom: "", dateTo: "" });
  const [applied, setApplied] = useState(filters);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const params = useMemo(() => ({ ...applied, page, pageSize }), [applied, page, pageSize]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/activity${queryString(params)}`, { credentials: "include", cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as ActivityResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "تعذر تحميل سجل النشاط");
      setRows(payload.rows || []);
      setTotal(Number(payload.total || 0));
      setStats(payload.stats || { today: 0, failed: 0, activeUsers: 0, pageViews: 0 });
      setAvailable(payload.filters || { systems: [], actions: [] });
      setCanDelete(Boolean(payload.canDelete));
    } catch (failure) {
      setRows([]);
      setTotal(0);
      setError(failure instanceof Error ? failure.message : "تعذر تحميل سجل النشاط");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [params]);

  function applyFilters() {
    setPage(1);
    setApplied({ ...filters });
  }

  function clearFilters() {
    const empty = { search: "", system: "", action: "", result: "", actor: "", dateFrom: "", dateTo: "" };
    setFilters(empty);
    setApplied(empty);
    setPage(1);
  }

  async function deleteActivityRange() {
    if (!deleteRange.dateFrom && !deleteRange.dateTo) {
      setError("حدد تاريخ البداية أو تاريخ النهاية لمسح سجل النشاط");
      return;
    }
    const rangeLabel = deleteRange.dateFrom && deleteRange.dateTo
      ? `من ${deleteRange.dateFrom} إلى ${deleteRange.dateTo}`
      : deleteRange.dateFrom ? `من ${deleteRange.dateFrom}` : `حتى ${deleteRange.dateTo}`;
    if (!window.confirm(`سيتم مسح سجل النشاط ${rangeLabel}. هل تريد المتابعة؟`)) return;
    setDeleting(true);
    setError("");
    try {
      const response = await fetch("/api/activity", {
        method: "DELETE",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(deleteRange),
      });
      const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; deletedCount?: number };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "تعذر مسح سجل النشاط");
      setDeleteOpen(false);
      setDeleteRange({ dateFrom: "", dateTo: "" });
      setPage(1);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر مسح سجل النشاط");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="module-page activity-page">
      <header className="module-page-head activity-page-head">
        <div><h1>سجل النشاط</h1><p>سجل مركزي لحركة المستخدمين والإجراءات والتغييرات داخل جميع أنظمة المنصة.</p></div>
        <div className="activity-head-actions">
          {canDelete ? <button type="button" className="activity-delete" onClick={() => { setDeleteRange({ dateFrom: applied.dateFrom, dateTo: applied.dateTo }); setDeleteOpen(true); }}><Trash size={18} />مسح سجل النشاط</button> : null}
          <button type="button" className="activity-refresh" onClick={() => void load()} disabled={loading}><ArrowClockwise size={18} />تحديث السجل</button>
        </div>
      </header>

      <section className="activity-stats">
        <article><span><Pulse size={22} /></span><div><small>نشاطات اليوم</small><strong>{stats.today.toLocaleString("ar-SA")}</strong><p>كل الإجراءات المسجلة منذ بداية اليوم</p></div></article>
        <article><span><UsersThree size={22} /></span><div><small>المستخدمون النشطون</small><strong>{stats.activeUsers.toLocaleString("ar-SA")}</strong><p>خلال آخر 24 ساعة</p></div></article>
        <article><span><Eye size={22} /></span><div><small>مرات فتح الصفحات</small><strong>{stats.pageViews.toLocaleString("ar-SA")}</strong><p>خلال آخر 24 ساعة</p></div></article>
        <article className={stats.failed ? "warning" : ""}><span><ShieldWarning size={22} /></span><div><small>العمليات المرفوضة أو الفاشلة</small><strong>{stats.failed.toLocaleString("ar-SA")}</strong><p>ضمن نتائج البحث الحالية</p></div></article>
      </section>

      <section className="panel activity-panel">
        <div className="activity-filters">
          <label className="activity-search"><MagnifyingGlass size={18} /><input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="بحث في المستخدم أو الإجراء أو السجل" onKeyDown={(event) => { if (event.key === "Enter") applyFilters(); }} /></label>
          <input value={filters.actor} onChange={(event) => setFilters({ ...filters, actor: event.target.value })} placeholder="اسم المستخدم أو البريد" />
          <select value={filters.system} onChange={(event) => setFilters({ ...filters, system: event.target.value })}><option value="">كل الأنظمة</option>{available.systems.map((item) => <option key={item} value={item}>{systemLabels[item] || item}</option>)}</select>
          <select value={filters.action} onChange={(event) => setFilters({ ...filters, action: event.target.value })}><option value="">كل الإجراءات</option>{available.actions.map((item) => <option key={item} value={item}>{labelAction(item)}</option>)}</select>
          <select value={filters.result} onChange={(event) => setFilters({ ...filters, result: event.target.value })}><option value="">كل النتائج</option><option value="success">ناجح</option><option value="allowed">مسموح</option><option value="failure">فشل</option><option value="denied">مرفوض</option></select>
          <label><span>من تاريخ</span><input type="date" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} /></label>
          <label><span>إلى تاريخ</span><input type="date" value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} /></label>
          <button type="button" className="primary" onClick={applyFilters}><Funnel size={17} />تطبيق</button>
          <button type="button" className="secondary" onClick={clearFilters}>مسح الفلاتر</button>
        </div>

        {error ? <div className="unified-data-alert"><ShieldWarning size={18} />{error}</div> : null}

        <div className="activity-table-wrap">
          <table>
            <thead><tr><th>التاريخ والوقت</th><th>المستخدم</th><th>النظام</th><th>الإجراء</th><th>السجل</th><th>النتيجة</th><th>التفاصيل</th></tr></thead>
            <tbody>
              {loading && !rows.length ? <tr><td colSpan={7} className="activity-empty">جاري تحميل سجل النشاط...</td></tr> : null}
              {!loading && !rows.length ? <tr><td colSpan={7} className="activity-empty">لا توجد نشاطات مطابقة للفلاتر الحالية.</td></tr> : null}
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><time>{formatDate(row.created_at)}</time></td>
                  <td><div className="activity-user"><span><UserCircle size={18} /></span><div><strong>{row.user_name}</strong><small>{row.user_email || row.user_role || "—"}</small></div></div></td>
                  <td><span className={`activity-system system-${row.system_code}`}>{systemLabels[row.system_code] || row.system_code}</span></td>
                  <td><strong>{labelAction(row.action)}</strong>{row.page_code ? <small className="activity-subtext">{row.page_code}</small> : null}</td>
                  <td><span>{row.entity_type || "—"}</span>{row.entity_id ? <small className="activity-subtext" title={row.entity_id}>{row.entity_id}</small> : null}</td>
                  <td><span className={`activity-result result-${row.result || "logged"}`}>{resultLabel(row.result)}</span></td>
                  <td><button type="button" className="activity-detail-button" onClick={() => setSelected(row)}>عرض</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="activity-pagination"><span>إجمالي {total.toLocaleString("ar-SA")} نشاط</span><div><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>السابق</button><b>صفحة {page.toLocaleString("ar-SA")} من {totalPages.toLocaleString("ar-SA")}</b><button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>التالي</button></div></footer>
      </section>

      <Modal open={Boolean(selected)} title="تفاصيل النشاط" subtitle={selected ? `${labelAction(selected.action)} · ${formatDate(selected.created_at)}` : undefined} onClose={() => setSelected(null)} className="activity-detail-modal">
        {selected ? (
          <div className="activity-detail-content">
            <div className="activity-detail-grid">
              <article><small>المستخدم</small><strong>{selected.user_name}</strong><span>{selected.user_email || "—"}</span></article>
              <article><small>النظام</small><strong>{systemLabels[selected.system_code] || selected.system_code}</strong><span>{selected.page_code || "—"}</span></article>
              <article><small>الإجراء</small><strong>{labelAction(selected.action)}</strong><span>{selected.permission_code || "—"}</span></article>
              <article><small>النتيجة</small><strong>{resultLabel(selected.result)}</strong><span>{selected.rejection_reason || "بدون ملاحظة"}</span></article>
              <article><small>السجل</small><strong>{selected.entity_type || "—"}</strong><span>{selected.entity_id || "—"}</span></article>
              <article><small>عنوان IP</small><strong dir="ltr">{selected.ip_address || "—"}</strong><span>{selected.request_id || "—"}</span></article>
            </div>
            <section className="activity-summary-card">
              <span>النشاط الذي تم داخل السيستم</span>
              <h3>{selected.activity_title || labelAction(selected.action)}</h3>
              <p>{selected.activity_description || "تم تسجيل الإجراء داخل المنصة."}</p>
            </section>
            {selected.activity_details?.length ? <section className="activity-action-details">
              <h3>تفاصيل النشاط</h3>
              <div>{selected.activity_details.map((item) => <article key={`${item.label}-${item.value}`}><small>{item.label}</small><strong>{item.value}</strong></article>)}</div>
            </section> : null}
            {selected.user_agent ? <section className="activity-user-agent"><ClockCounterClockwise size={18} /><div><strong>الجهاز والمتصفح</strong><span dir="ltr">{selected.user_agent}</span></div></section> : null}
          </div>
        ) : null}
      </Modal>

      <Modal open={deleteOpen} title="مسح سجل النشاط" subtitle="سيتم حذف السجلات الموجودة داخل المدة المحددة فقط" onClose={() => { if (!deleting) setDeleteOpen(false); }} className="activity-delete-modal">
        <div className="activity-delete-content">
          <div className="activity-delete-range">
            <label><span>من تاريخ</span><input type="date" value={deleteRange.dateFrom} onChange={(event) => setDeleteRange((current) => ({ ...current, dateFrom: event.target.value }))} /></label>
            <label><span>إلى تاريخ</span><input type="date" value={deleteRange.dateTo} onChange={(event) => setDeleteRange((current) => ({ ...current, dateTo: event.target.value }))} /></label>
          </div>
          <p>لن يتم حذف أي سجل خارج الفترة المحددة، وسيتم تسجيل عملية المسح نفسها داخل سجل النشاط.</p>
          <div className="activity-delete-actions"><button type="button" className="secondary" disabled={deleting} onClick={() => setDeleteOpen(false)}>إلغاء</button><button type="button" className="danger" disabled={deleting || (!deleteRange.dateFrom && !deleteRange.dateTo)} onClick={() => void deleteActivityRange()}><Trash size={17} />{deleting ? "جاري المسح..." : "مسح السجلات المحددة"}</button></div>
        </div>
      </Modal>
    </div>
  );
}
