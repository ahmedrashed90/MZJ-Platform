import { useEffect, useMemo, useState } from "react";
import { CalendarBlank, CheckCircle, Funnel, MagnifyingGlass, PaperPlaneTilt, PencilSimple, SlidersHorizontal, UploadSimple, WarningCircle } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { marketingDate, marketingFetch, marketingQuery } from "../api";
import { MarketingAlert, MarketingPage, ProgressBar } from "../components/MarketingPage";
import type { MarketingMeta } from "../types";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../systemAccess";

function rowPlatforms(row: any) {
  return Array.isArray(row?.platforms) ? row.platforms : [];
}

function statusClass(value: string) {
  if (value === "جاهز للنشر") return "ready";
  if (value === "تم النشر") return "published";
  if (value === "ناقص") return "missing";
  return "waiting";
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
        body: JSON.stringify({ action: "save_publish_prep", id: editing.id, platforms: editing.platforms || [], publishDate: String(editing.publish_date || "").slice(0, 10), caption: editing.caption, hashtags: editing.hashtags }),
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
      const result = await marketingFetch<any>("/api/marketing", { method: "POST", body: JSON.stringify({ action: "publish_now", ids: scheduleIds }) });
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

  function startEdit(row: any) {
    setEditing({ ...row, publish_date: String(row.publish_date || "").slice(0, 10), platforms: rowPlatforms(row).map((platform: any) => ({ platformId: platform.platformId, postTypeIds: [...(platform.postTypeIds || [])] })) });
  }

  return <MarketingPage title="تجهيز النشر" description="مراجعة جاهزية الملفات والمنصات والنصوص والتاريخ قبل النشر الفعلي.">
    {error ? <MarketingAlert>{error}</MarketingAlert> : null}
    {message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}

    <section className="marketing-publish-overview">
      <article><span><Funnel size={21} /></span><div><small>كل التاسكات</small><strong>{stats.all}</strong></div></article>
      <article className="ready"><span><CheckCircle size={21} /></span><div><small>جاهز للنشر</small><strong>{stats.ready}</strong></div></article>
      <article className="waiting"><span><CalendarBlank size={21} /></span><div><small>بانتظار التاريخ</small><strong>{stats.waiting}</strong></div></article>
      <article className="missing"><span><WarningCircle size={21} /></span><div><small>ناقص</small><strong>{stats.missing}</strong></div></article>
      <article><span><UploadSimple size={21} /></span><div><small>ملفات مرفوعة</small><strong>{stats.files}</strong></div></article>
    </section>

    <section className="panel marketing-publish-toolbar">
      <label className="marketing-publish-search"><MagnifyingGlass size={18} /><input placeholder="ابحث بالكرييتيف أو الحملة أو المسؤول" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></label>
      <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">كل الحالات</option><option>جاهز للنشر</option><option>بانتظار التاريخ</option><option>ناقص</option><option>تم النشر</option></select>
      <select value={filters.platform} onChange={(event) => setFilters({ ...filters, platform: event.target.value })}><option value="">كل المنصات</option>{meta?.platforms.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
      <select value={filters.department} onChange={(event) => setFilters({ ...filters, department: event.target.value })}><option value="">كل الأقسام</option>{meta?.departments.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
      <button type="button" className="secondary" onClick={() => setFilters({ search: "", status: "", platform: "", department: "" })}><SlidersHorizontal size={18} />مسح الفلاتر</button>
    </section>

    <section className="marketing-publish-board">
      {filtered.map((row) => {
        const absent = missing(row);
        const ready = readiness(row);
        const selected = selectedIds.includes(row.id);
        return <article key={row.id} className={`marketing-publish-card-v2 ${statusClass(ready)} ${selected ? "selected" : ""}`}>
          <header>
            <div className="marketing-publish-card-title"><span className={`marketing-publish-status ${statusClass(ready)}`}>{ready}</span><h3>{row.creative_name || "كرييتيف"}</h3><p>{row.source_name || "—"}</p></div>
            {canPublishNow ? <label className="marketing-select-task-v2"><input type="checkbox" checked={selected} disabled={ready !== "جاهز للنشر"} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))} /><span>تحديد للنشر</span></label> : null}
          </header>
          <div className="marketing-publish-card-grid">
            <div><small>القسم</small><strong>{row.department_name || "—"}</strong></div>
            <div><small>المسؤول</small><strong>{row.assigned_name || "—"}</strong></div>
            <div><small>تاريخ النشر</small><strong>{marketingDate(row.publish_date)}</strong></div>
            <div><small>الملف النهائي</small><strong>{row.final_file_name || "غير مرفوع"}</strong></div>
          </div>
          <div className="marketing-publish-platforms">{rowPlatforms(row).length ? rowPlatforms(row).map((platform: any) => {
            const platformName = meta?.platforms.find((item) => item.id === platform.platformId)?.name || platform.platformName || "منصة";
            const types = (platform.postTypeIds || []).map((id: string) => meta?.postTypes.find((item) => item.id === id)?.name).filter(Boolean);
            return <div key={platform.platformId}><strong>{platformName}</strong><span>{types.join("، ") || "لم يحدد نوع نشر"}</span></div>;
          }) : <span className="marketing-publish-no-platform">لم يتم تحديد منصات</span>}</div>
          <ProgressBar value={Number(row.progress || 0)} />
          {absent.length ? <div className="marketing-publish-missing-list"><WarningCircle size={18} /><div>{absent.map((item) => <span key={item}>{item}</span>)}</div></div> : <div className="marketing-publish-complete"><CheckCircle size={18} />بيانات تجهيز النشر مكتملة</div>}
          <footer>{canManagePrep ? <button type="button" className="primary" onClick={() => startEdit(row)}><PencilSimple size={18} />تعديل تجهيز النشر</button> : null}</footer>
        </article>;
      })}
      {!loading && !filtered.length ? <div className="marketing-empty"><PaperPlaneTilt size={38} />لا توجد تاسكات تجهيز نشر مطابقة.</div> : null}
    </section>

    {canPublishNow && selectedIds.length ? <div className="marketing-bulk-bar"><span>تم تحديد <strong>{selectedIds.length.toLocaleString("ar-SA")}</strong> تاسك</span><button type="button" className="primary" onClick={() => void publish()} disabled={loading}><PaperPlaneTilt size={18} />نشر المحدد الآن</button></div> : null}

    <Modal open={Boolean(editing)} title="تعديل تجهيز النشر" subtitle={editing ? `${editing.source_name || ""} — ${editing.creative_name || ""}` : undefined} onClose={() => setEditing(null)} className="marketing-publish-edit-modal" footer={<><button type="button" className="secondary" onClick={() => setEditing(null)}>إلغاء</button><button type="button" className="primary" onClick={() => void save()} disabled={loading}><CheckCircle size={18} />حفظ تجهيز النشر</button></>}>
      {editing ? <div className="marketing-publish-edit-workspace">
        <section className="marketing-publish-edit-summary"><div><small>الحملة / الأجندة</small><strong>{editing.source_name || "—"}</strong></div><div><small>الكرييتيف</small><strong>{editing.creative_name || "—"}</strong></div><div><small>المسؤول</small><strong>{editing.assigned_name || "—"}</strong></div><div><small>القسم</small><strong>{editing.department_name || "—"}</strong></div></section>
        <section className="marketing-publish-edit-section"><header><div><h3>المنصات وأنواع النشر</h3><p>اختر المنصات المطلوبة ثم حدد أنواع النشر داخل كل منصة.</p></div></header><div className="marketing-publish-platform-editor">{meta?.platforms.map((platform) => {
          const selected = editing.platforms?.find((item: any) => item.platformId === platform.id);
          return <article key={platform.id} className={selected ? "selected" : ""}>
            <label className="marketing-publish-platform-toggle"><input type="checkbox" checked={Boolean(selected)} onChange={(event) => setEditing({ ...editing, platforms: event.target.checked ? [...(editing.platforms || []), { platformId: platform.id, postTypeIds: [] }] : (editing.platforms || []).filter((item: any) => item.platformId !== platform.id) })} /><span>{platform.name}</span></label>
            {selected ? <div className="marketing-publish-post-types">{meta.postTypes.filter((item) => item.platform_id === platform.id).map((postType) => <label key={postType.id} className={selected.postTypeIds.includes(postType.id) ? "selected" : ""}><input type="checkbox" checked={selected.postTypeIds.includes(postType.id)} onChange={(event) => setEditing({ ...editing, platforms: (editing.platforms || []).map((item: any) => item.platformId === platform.id ? { ...item, postTypeIds: event.target.checked ? [...item.postTypeIds, postType.id] : item.postTypeIds.filter((id: string) => id !== postType.id) } : item) })} /><span>{postType.name}</span></label>)}</div> : <p>فعّل المنصة لإظهار أنواع النشر.</p>}
          </article>;
        })}</div></section>
        <section className="marketing-publish-edit-section"><header><div><h3>تاريخ ومحتوى النشر</h3><p>راجع التاريخ والكابشن والهاشتاج قبل الحفظ.</p></div></header><div className="marketing-form-grid marketing-publish-content-grid"><label><span>تاريخ النشر</span><input type="date" value={editing.publish_date || ""} onChange={(event) => setEditing({ ...editing, publish_date: event.target.value })} /></label><label className="full"><span>Caption</span><textarea rows={7} value={editing.caption || ""} onChange={(event) => setEditing({ ...editing, caption: event.target.value })} /></label><label className="full"><span>Hashtag</span><textarea rows={5} value={editing.hashtags || ""} onChange={(event) => setEditing({ ...editing, hashtags: event.target.value })} /></label></div></section>
      </div> : null}
    </Modal>
  </MarketingPage>;
}
