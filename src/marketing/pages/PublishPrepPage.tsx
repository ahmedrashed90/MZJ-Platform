import { useEffect, useMemo, useState } from "react";
import { CheckCircle, PencilSimple, PaperPlaneTilt, WarningCircle } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { marketingDate, marketingFetch, marketingQuery } from "../api";
import { MarketingAlert, MarketingPage, ProgressBar } from "../components/MarketingPage";
import type { MarketingMeta } from "../types";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../systemAccess";

function rowPlatforms(row: any) {
  return Array.isArray(row?.platforms) ? row.platforms : [];
}

export function PublishPrepPage() {
  const { user } = useAuth();
  const canManagePrep = hasPermission(user, "marketing.publish_prep.manage");
  const canPublishNow = hasPermission(user, "marketing.publish.now");
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<MarketingMeta | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<any>(null);
  const [filters, setFilters] = useState({ search: "", status: "", platform: "", department: "" });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [tasks, info] = await Promise.all([
        marketingFetch<{ rows: any[] }>(`/api/marketing${marketingQuery({ resource: "publish_prep" })}`),
        marketingFetch<MarketingMeta>(`/api/marketing${marketingQuery({ resource: "meta" })}`),
      ]);
      setRows(tasks.rows);
      setMeta(info);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل تجهيز النشر");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function missing(row: any) {
    const values: string[] = [];
    const platforms = rowPlatforms(row);
    if (!row.final_file_id) values.push("الملف النهائي");
    if (!String(row.caption || "").trim()) values.push("الكابشن");
    if (!String(row.hashtags || "").trim()) values.push("الهاشتاج");
    if (!row.publish_date) values.push("تاريخ النشر");
    if (!platforms.length) values.push("المنصة");
    if (!platforms.some((platform: any) => Array.isArray(platform.postTypeIds) && platform.postTypeIds.length)) values.push("نوع النشر");
    return values;
  }

  function readiness(row: any) {
    const absent = missing(row);
    if (row.status === "published") return "تم النشر";
    if (absent.length) return "ناقص";
    if (new Date(`${String(row.publish_date).slice(0, 10)}T23:59:59`).getTime() > Date.now()) return "بانتظار التاريخ";
    return "جاهز للنشر";
  }

  const filtered = useMemo(() => rows.filter((row) => {
    const searchText = `${row.creative_name || ""} ${row.source_name || ""} ${row.assigned_name || ""} ${row.department_name || ""}`.toLowerCase();
    return (!filters.search || searchText.includes(filters.search.toLowerCase()))
      && (!filters.status || readiness(row) === filters.status)
      && (!filters.platform || rowPlatforms(row).some((platform: any) => platform.platformId === filters.platform))
      && (!filters.department || String(row.department_id || "") === filters.department);
  }), [rows, filters]);

  const stats = useMemo(() => ({
    all: rows.length,
    ready: rows.filter((row) => readiness(row) === "جاهز للنشر").length,
    waiting: rows.filter((row) => readiness(row) === "بانتظار التاريخ").length,
    missing: rows.filter((row) => readiness(row) === "ناقص").length,
    files: rows.filter((row) => row.final_file_id).length,
  }), [rows]);

  async function save() {
    if (!editing) return;
    setLoading(true);
    setError("");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({
          action: "save_publish_prep",
          id: editing.id,
          platforms: editing.platforms || [],
          publishDate: String(editing.publish_date || "").slice(0, 10),
          caption: editing.caption,
          hashtags: editing.hashtags,
        }),
      });
      setMessage(result.message);
      setEditing(null);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر حفظ تجهيز النشر");
    } finally {
      setLoading(false);
    }
  }

  async function publish() {
    const selectedRows = rows.filter((row) => selectedIds.includes(row.id));
    if (selectedRows.some((row) => readiness(row) !== "جاهز للنشر")) {
      setError("كل التاسكات المحددة يجب أن تكون جاهزة للنشر");
      return;
    }
    const scheduleIds = [...new Set(selectedRows.flatMap((row) => Array.isArray(row.schedule_ids) ? row.schedule_ids : []))];
    if (!scheduleIds.length) {
      setError("لا توجد عناصر نشر داخل التاسكات المحددة");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await marketingFetch<any>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "publish_now", ids: scheduleIds }),
      });
      const failed = result.results.filter((item: any) => !item.ok);
      setMessage(failed.length ? `تم تنفيذ النشر مع ${failed.length} أخطاء` : "تم النشر بنجاح");
      setSelectedIds([]);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر النشر");
    } finally {
      setLoading(false);
    }
  }

  return <MarketingPage title="تجهيز النشر" description="تجهيز الملفات والكابشن والهاشتاج والتاريخ والمنصة قبل النشر الفعلي.">
    {error ? <MarketingAlert>{error}</MarketingAlert> : null}
    {message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}

    <div className="marketing-stats five">
      <article><small>كل التاسكات</small><strong>{stats.all}</strong></article>
      <article><small>جاهز للنشر</small><strong>{stats.ready}</strong></article>
      <article><small>بانتظار التاريخ</small><strong>{stats.waiting}</strong></article>
      <article><small>ناقص</small><strong>{stats.missing}</strong></article>
      <article><small>ملفات مرفوعة</small><strong>{stats.files}</strong></article>
    </div>

    <section className="panel marketing-filter-bar">
      <input placeholder="بحث" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
      <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
        <option value="">كل الحالات</option><option>جاهز للنشر</option><option>بانتظار التاريخ</option><option>ناقص</option><option>تم النشر</option>
      </select>
      <select value={filters.platform} onChange={(event) => setFilters({ ...filters, platform: event.target.value })}>
        <option value="">كل المنصات</option>{meta?.platforms.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select>
      <select value={filters.department} onChange={(event) => setFilters({ ...filters, department: event.target.value })}>
        <option value="">كل الأقسام</option>{meta?.departments.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select>
      <button type="button" className="secondary" onClick={() => setFilters({ search: "", status: "", platform: "", department: "" })}>إعادة تعيين</button>
    </section>

    <section className="marketing-publish-list">
      {filtered.map((row) => {
        const absent = missing(row);
        const ready = readiness(row);
        return <article key={row.id} className={`marketing-publish-card status-${ready === "ناقص" ? "missing" : ready === "جاهز للنشر" ? "ready" : "waiting"}`}>
          {canPublishNow ? <label className="marketing-select-task"><input type="checkbox" checked={selectedIds.includes(row.id)} disabled={ready !== "جاهز للنشر"} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))} /></label> : null}
          <div className="marketing-publish-main">
            <header><div><h3>{row.creative_name || "كرييتيف"}</h3><span>{row.source_name}</span></div><b>{ready}</b></header>
            <div className="marketing-publish-meta">
              <span>القسم: <strong>{row.department_name || "—"}</strong></span>
              <span>المسؤول: <strong>{row.assigned_name || "—"}</strong></span>
              <span>المنصة: <strong>{row.platform_name || "—"}</strong></span>
              <span>نوع النشر: <strong>{row.post_type_name || "—"}</strong></span>
              <span>تاريخ النشر: <strong>{marketingDate(row.publish_date)}</strong></span>
              <span>الملف النهائي: <strong>{row.final_file_name || "—"}</strong></span>
            </div>
            <ProgressBar value={Number(row.progress || 0)} />
            {absent.length ? <div className="marketing-missing"><WarningCircle size={17} />الناقص: {absent.join("، ")}</div> : null}
          </div>
          {canManagePrep ? <button type="button" className="secondary" onClick={() => setEditing({ ...row, publish_date: String(row.publish_date || "").slice(0, 10), platforms: rowPlatforms(row).map((platform: any) => ({ platformId: platform.platformId, postTypeIds: [...(platform.postTypeIds || [])] })) })}><PencilSimple size={17} />تعديل</button> : null}
        </article>;
      })}
      {!loading && !filtered.length ? <div className="marketing-empty">لا توجد تاسكات تجهيز نشر.</div> : null}
    </section>

    {canPublishNow && selectedIds.length ? <div className="marketing-bulk-bar"><span>تم تحديد {selectedIds.length}</span><button type="button" className="primary" onClick={() => void publish()} disabled={loading}><PaperPlaneTilt size={17} />نشر الآن</button></div> : null}

    <Modal open={Boolean(editing)} title="تعديل تجهيز النشر" onClose={() => setEditing(null)} footer={<><button type="button" className="secondary" onClick={() => setEditing(null)}>إلغاء</button><button type="button" className="primary" onClick={() => void save()} disabled={loading}><CheckCircle size={17} />حفظ</button></>}>
      {editing ? <div className="marketing-form-grid">
        <div className="full marketing-platform-select"><strong>المنصات وأنواع النشر</strong>{meta?.platforms.map((platform) => {
          const selected = editing.platforms?.find((item: any) => item.platformId === platform.id);
          return <section key={platform.id}>
            <label className="marketing-check"><input type="checkbox" checked={Boolean(selected)} onChange={(event) => setEditing({ ...editing, platforms: event.target.checked ? [...(editing.platforms || []), { platformId: platform.id, postTypeIds: [] }] : (editing.platforms || []).filter((item: any) => item.platformId !== platform.id) })} />{platform.name}</label>
            {selected ? <div className="marketing-check-grid">{meta.postTypes.filter((item) => item.platform_id === platform.id).map((postType) => <label className="marketing-check" key={postType.id}><input type="checkbox" checked={selected.postTypeIds.includes(postType.id)} onChange={(event) => setEditing({ ...editing, platforms: (editing.platforms || []).map((item: any) => item.platformId === platform.id ? { ...item, postTypeIds: event.target.checked ? [...item.postTypeIds, postType.id] : item.postTypeIds.filter((id: string) => id !== postType.id) } : item) })} />{postType.name}</label>)}</div> : null}
          </section>;
        })}</div>
        <label><span>تاريخ النشر</span><input type="date" value={editing.publish_date || ""} onChange={(event) => setEditing({ ...editing, publish_date: event.target.value })} /></label>
        <label className="full"><span>Caption</span><textarea rows={4} value={editing.caption || ""} onChange={(event) => setEditing({ ...editing, caption: event.target.value })} /></label>
        <label className="full"><span>Hashtag</span><textarea rows={3} value={editing.hashtags || ""} onChange={(event) => setEditing({ ...editing, hashtags: event.target.value })} /></label>
      </div> : null}
    </Modal>
  </MarketingPage>;
}
