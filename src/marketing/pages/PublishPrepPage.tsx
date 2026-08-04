import { useEffect, useMemo, useState } from "react";
import { ArrowSquareOut, CheckCircle, Funnel, MagnifyingGlass, PaperPlaneTilt, PencilSimple, SlidersHorizontal, UploadSimple, WarningCircle, X, XCircle } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { downloadMarketingFile, marketingDate, marketingFetch, marketingQuery } from "../api";
import { MarketingAlert, MarketingPage, ProgressBar } from "../components/MarketingPage";
import type { MarketingMeta } from "../types";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../systemAccess";

function rowPlatforms(row: any) {
  return Array.isArray(row?.platforms) ? row.platforms : [];
}

function rowFinalFiles(row: any) {
  const files = Array.isArray(row?.final_files) ? row.final_files.filter((file: any) => file?.id) : [];
  if (files.length) return files;
  return row?.final_file_id ? [{ id: row.final_file_id, name: row.final_file_name || "فتح الملف النهائي", orderIndex: 0 }] : [];
}

function rowPublishErrors(row: any) {
  return Array.isArray(row?.publish_errors) ? row.publish_errors.filter((item: any) => String(item?.error || "").trim()) : [];
}

function statusClass(value: string) {
  if (value === "جاهز للنشر") return "ready";
  if (value === "تم النشر") return "published";
  if (value === "ناقص") return "missing";
  if (value === "فشل النشر") return "failed";
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
  const [publishResults, setPublishResults] = useState<any[]>([]);
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
    if (!row.final_file_id && !Number(row.final_file_count || 0)) values.push("الملف النهائي");
    if (!String(row.caption || "").trim()) values.push("الكابشن");
    if (!String(row.hashtags || "").trim()) values.push("الهاشتاج");
    if (!row.publish_date) values.push("تاريخ النشر");
    if (!platforms.length) values.push("المنصة");
    else if (platforms.some((platform: any) => !Array.isArray(platform.postTypeIds) || !platform.postTypeIds.length)) values.push("نوع النشر لكل منصة");
    return values;
  }

  function readiness(row: any) {
    const absent = missing(row);
    if (row.status === "published") return "تم النشر";
    if (absent.length) return "ناقص";
    if (row.status === "failed" || rowPublishErrors(row).length) return "فشل النشر";
    return "جاهز للنشر";
  }

  function canPublish(row: any) {
    return missing(row).length === 0 && row.status !== "published";
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
    failed: rows.filter((row) => readiness(row) === "فشل النشر").length,
    missing: rows.filter((row) => readiness(row) === "ناقص").length,
    files: rows.filter((row) => row.final_file_id || Number(row.final_file_count || 0) > 0).length,
  }), [rows]);

  async function save() {
    if (!editing) return;
    setLoading(true);
    setError("");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "save_publish_prep", id: editing.id, taskId: editing.task_id || "", platforms: editing.platforms || [], publishDate: String(editing.publish_date || "").slice(0, 10), caption: editing.caption, hashtags: editing.hashtags }),
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

  async function publish(targetIds = selectedIds) {
    const selectedRows = rows.filter((row) => targetIds.includes(row.id));
    if (!selectedRows.length) {
      setError("حدد تاسكًا واحدًا على الأقل للنشر");
      return;
    }
    if (selectedRows.some((row) => !canPublish(row))) {
      setError("كل التاسكات المحددة يجب أن تكون مكتملة البيانات وغير منشورة");
      return;
    }
    const scheduleIds = [...new Set(selectedRows.flatMap((row) => Array.isArray(row.schedule_ids) ? row.schedule_ids : []))];
    if (!scheduleIds.length) {
      setError("لا توجد عناصر نشر داخل التاسكات المحددة");
      return;
    }
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const result = await marketingFetch<{ results: any[] }>("/api/marketing", { method: "POST", body: JSON.stringify({ action: "publish_now", ids: scheduleIds }) });
      const results = Array.isArray(result.results) ? result.results : [];
      const failed = results.filter((item: any) => !item.ok);
      setSelectedIds([]);
      await load();
      setPublishResults(results);
      if (failed.length) {
        setError(`تعذر نشر ${failed.length.toLocaleString("ar-SA")} عنصر. سبب كل خطأ ظاهر بالتفصيل أدناه.`);
      } else {
        setMessage("تم النشر بنجاح على كل المنصات المحددة");
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر النشر");
    } finally {
      setLoading(false);
    }
  }

  async function openFinalFile(fileId: string) {
    setError("");
    try {
      await downloadMarketingFile(fileId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر فتح الملف النهائي");
    }
  }

  function startEdit(row: any) {
    setEditing({ ...row, publish_date: String(row.publish_date || "").slice(0, 10), platforms: rowPlatforms(row).map((platform: any) => ({ platformId: platform.platformId, postTypeIds: [...(platform.postTypeIds || [])] })) });
  }

  return <MarketingPage title="تجهيز النشر" description="التاسكات التنفيذية فقط: راجع الملف والمنصات والنصوص. تاريخ النشر مرجع للجدول ولا يمنع استخدام نشر الآن في أي وقت.">
    {error ? <MarketingAlert>{error}</MarketingAlert> : null}
    {message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}

    {publishResults.length ? <section className="panel marketing-publish-results">
      <header><div><h3>نتيجة تنفيذ النشر</h3><p>كل منصة ونوع نشر لهما نتيجة مستقلة.</p></div><button type="button" className="icon-button" onClick={() => setPublishResults([])} aria-label="إغلاق النتائج"><X size={18} /></button></header>
      <div>{publishResults.map((item: any, index: number) => <article key={`${item.id || index}-${index}`} className={item.ok ? "success" : "failed"}>
        <span>{item.ok ? <CheckCircle size={21} weight="fill" /> : <XCircle size={21} weight="fill" />}</span>
        <div><strong>{item.platformName || item.platform || "منصة"}{item.postTypeName ? ` — ${item.postTypeName}` : ""}</strong><p>{item.ok ? "تم النشر بنجاح" : item.error || "تعذر النشر بدون تفاصيل إضافية"}</p></div>
      </article>)}</div>
    </section> : null}

    <section className="marketing-publish-overview">
      <article><span><Funnel size={21} /></span><div><small>كل التاسكات</small><strong>{stats.all}</strong></div></article>
      <article className="ready"><span><CheckCircle size={21} /></span><div><small>جاهز للنشر</small><strong>{stats.ready}</strong></div></article>
      <article className="failed"><span><XCircle size={21} /></span><div><small>فشل النشر</small><strong>{stats.failed}</strong></div></article>
      <article className="missing"><span><WarningCircle size={21} /></span><div><small>ناقص</small><strong>{stats.missing}</strong></div></article>
      <article><span><UploadSimple size={21} /></span><div><small>ملفات مرفوعة</small><strong>{stats.files}</strong></div></article>
    </section>

    <section className="panel marketing-publish-toolbar">
      <label className="marketing-publish-search"><MagnifyingGlass size={18} /><input placeholder="ابحث بالكرييتيف أو الحملة أو المسؤول" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></label>
      <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">كل الحالات</option><option>جاهز للنشر</option><option>فشل النشر</option><option>ناقص</option><option>تم النشر</option></select>
      <select value={filters.platform} onChange={(event) => setFilters({ ...filters, platform: event.target.value })}><option value="">كل المنصات</option>{meta?.platforms.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
      <select value={filters.department} onChange={(event) => setFilters({ ...filters, department: event.target.value })}><option value="">كل الأقسام</option>{meta?.departments.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
      <button type="button" className="secondary" onClick={() => setFilters({ search: "", status: "", platform: "", department: "" })}><SlidersHorizontal size={18} />مسح الفلاتر</button>
    </section>

    <section className="marketing-publish-list">
      {filtered.map((row) => {
        const absent = missing(row);
        const ready = readiness(row);
        const selected = selectedIds.includes(row.id);
        const finalFiles = rowFinalFiles(row);
        const publishErrors = rowPublishErrors(row);
        return <article key={row.id} className={`marketing-publish-list-row ${statusClass(ready)} ${selected ? "selected" : ""}`}>
          <div className="marketing-publish-list-heading">
            <div className="marketing-publish-card-statuses"><span className="marketing-publish-task-kind">تاسك تنفيذي</span><span className={`marketing-publish-status ${statusClass(ready)}`}>{ready}</span></div>
            <h3>{row.creative_name || "كرييتيف"}</h3>
            <p>{row.source_name || "—"}</p>
          </div>

          <div className="marketing-publish-list-meta">
            <div><small>القسم</small><strong>{row.department_name || "—"}</strong></div>
            <div><small>المسؤول</small><strong>{row.assigned_name || "—"}</strong></div>
            <div><small>تاريخ النشر</small><strong>{marketingDate(row.publish_date)}</strong></div>
          </div>

          <div className="marketing-publish-file-cell">
            <small>الملف النهائي</small>
            {finalFiles.length ? <div className="marketing-publish-file-links">{finalFiles.map((file: any, index: number) => <button key={file.id || index} type="button" onClick={() => void openFinalFile(String(file.id))}><ArrowSquareOut size={16} />{finalFiles.length > 1 ? `${index + 1}. ${file.name || "ملف"}` : file.name || "فتح الملف النهائي"}</button>)}</div> : <strong>غير مرفوع</strong>}
          </div>

          <div className="marketing-publish-platforms">{rowPlatforms(row).length ? rowPlatforms(row).map((platform: any) => {
            const platformName = meta?.platforms.find((item) => item.id === platform.platformId)?.name || platform.platformName || "منصة";
            const types = (platform.postTypeIds || []).map((id: string) => meta?.postTypes.find((item) => item.id === id)?.name).filter(Boolean);
            return <div key={platform.platformId}><strong>{platformName}</strong><span>{types.join("، ") || "لم يحدد نوع نشر"}</span></div>;
          }) : <span className="marketing-publish-no-platform">لم يتم تحديد منصات</span>}</div>

          <div className="marketing-publish-list-readiness">
            <ProgressBar value={Number(row.progress || 0)} />
            {absent.length ? <div className="marketing-publish-missing-list"><WarningCircle size={18} /><div>{absent.map((item) => <span key={item}>{item}</span>)}</div></div> : <div className="marketing-publish-complete"><CheckCircle size={18} />بيانات تجهيز النشر مكتملة</div>}
            {publishErrors.length ? <div className="marketing-publish-row-errors">{publishErrors.map((item: any, index: number) => <p key={`${item.scheduleId || index}-${index}`}><strong>{item.platformName || "منصة"}{item.postTypeName ? ` — ${item.postTypeName}` : ""}:</strong> {item.error}</p>)}</div> : null}
          </div>

          <div className="marketing-publish-list-actions">
            {canManagePrep ? <button type="button" className="secondary" onClick={() => startEdit(row)}><PencilSimple size={18} />تعديل</button> : null}
            {canPublishNow ? <button type="button" className="primary" disabled={!canPublish(row) || loading} onClick={() => void publish([row.id])}><PaperPlaneTilt size={18} />نشر الآن</button> : null}
            {canPublishNow ? <label className="marketing-select-task-v2"><input type="checkbox" checked={selected} disabled={!canPublish(row)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, row.id])] : current.filter((id) => id !== row.id))} /><span>تحديد</span></label> : null}
          </div>
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
        <section className="marketing-publish-edit-section"><header><div><h3>تاريخ ومحتوى النشر</h3><p>التاريخ يظهر في الجدول كموعد مخطط، لكن زر نشر الآن يعمل في أي وقت بعد اكتمال البيانات.</p></div></header><div className="marketing-form-grid marketing-publish-content-grid"><label><span>تاريخ النشر</span><input type="date" value={editing.publish_date || ""} onChange={(event) => setEditing({ ...editing, publish_date: event.target.value })} /></label><label className="full"><span>Caption</span><textarea rows={7} value={editing.caption || ""} onChange={(event) => setEditing({ ...editing, caption: event.target.value })} /></label><label className="full"><span>Hashtag</span><textarea rows={5} value={editing.hashtags || ""} onChange={(event) => setEditing({ ...editing, hashtags: event.target.value })} /></label></div></section>
      </div> : null}
    </Modal>
  </MarketingPage>;
}
