import { useEffect, useMemo, useState } from "react";
import { ArrowSquareOut, DownloadSimple, MagnifyingGlass, PencilSimple, Plus, RocketLaunch, Trash } from "@phosphor-icons/react";
import { marketingFetch, marketingPost, queryString } from "../api";
import { useMarketingMeta } from "../MarketingLayout";
import { MarketingAlert, MarketingEmpty, MarketingLoading, MarketingModal, MarketingPageHeader, Pagination, StatusBadge, formatDate } from "../components/Ui";

type TargetRow = {
  id: string;
  platform_id: string;
  platform_code: string;
  platform_name: string;
  post_type_id?: string | null;
  post_type_code?: string | null;
  post_type_name?: string | null;
  scheduled_at?: string | null;
  status: string;
  published_url?: string | null;
  external_id?: string | null;
  error_message?: string | null;
};

type ScheduleRow = { platform_id: string; post_type_id: string; publish_date: string; publish_time?: string | null };
type PublishRow = {
  id: string;
  status: string;
  caption?: string | null;
  hashtags?: string | null;
  recipients?: string[];
  use_saved_contacts?: boolean;
  campaign_code: string;
  campaign_name: string;
  creative_name: string;
  instance_code: string;
  source_task_id: string;
  assigned_to_name?: string | null;
  department_code?: string | null;
  department_name?: string | null;
  final_file_id?: string | null;
  final_file_name?: string | null;
  final_file_mime?: string | null;
  final_file_size?: number | null;
  template_data?: Record<string, unknown>;
  targets: TargetRow[];
  original_schedule?: ScheduleRow[];
};
type PublishStats = { all_tasks: number; ready: number; waiting_date: number; missing: number; files_uploaded: number };
type DepartmentFilter = { department_code: string; department_name: string };
type Payload = { rows: PublishRow[]; total: number; whatsappContactsCount: number; stats: PublishStats; departments: DepartmentFilter[] };
type TargetDraft = { id?: string; platformId: string; postTypeId: string; scheduledAt: string };

export function PublishPrepPage() {
  const { meta } = useMarketingMeta();
  const [rows, setRows] = useState<PublishRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [platformId, setPlatformId] = useState("");
  const [departmentCode, setDepartmentCode] = useState("");
  const [stats, setStats] = useState<PublishStats>({ all_tasks: 0, ready: 0, waiting_date: 0, missing: 0, files_uploaded: 0 });
  const [departments, setDepartments] = useState<DepartmentFilter[]>([]);
  const [selected, setSelected] = useState<PublishRow | null>(null);
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [recipientsText, setRecipientsText] = useState("");
  const [useSavedContacts, setUseSavedContacts] = useState(false);
  const [whatsappContactsCount, setWhatsappContactsCount] = useState(0);
  const [targets, setTargets] = useState<TargetDraft[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyTarget, setBusyTarget] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pageSize = 20;

  async function load() {
    setLoading(true); setError("");
    try {
      const payload = await marketingFetch<Payload>(`/api/marketing?${queryString({ resource: "publish_prep", page, pageSize, search, status, platformId, departmentCode })}`);
      setRows(payload.rows); setTotal(payload.total); setWhatsappContactsCount(payload.whatsappContactsCount || 0); setStats(payload.stats || { all_tasks: 0, ready: 0, waiting_date: 0, missing: 0, files_uploaded: 0 }); setDepartments(payload.departments || []);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل تجهيز النشر"); }
    finally { setLoading(false); }
  }

  useEffect(() => { const timer = window.setTimeout(() => void load(), 230); return () => window.clearTimeout(timer); }, [page, search, status, platformId, departmentCode]);

  function edit(row: PublishRow) {
    setSelected(row);
    setCaption(row.caption || String(row.template_data?.caption || ""));
    setHashtags(row.hashtags || String(row.template_data?.hashtags || ""));
    setRecipientsText((row.recipients || []).join("\n"));
    setUseSavedContacts(Boolean(row.use_saved_contacts));
    const current: TargetDraft[] = (row.targets || []).map((target) => ({ id: target.id, platformId: target.platform_id, postTypeId: target.post_type_id || "", scheduledAt: target.scheduled_at ? String(target.scheduled_at).slice(0, 16) : "" }));
    if (!current.length && row.original_schedule?.length) current.push(...row.original_schedule.map((target) => ({ platformId: target.platform_id, postTypeId: target.post_type_id, scheduledAt: `${String(target.publish_date).slice(0, 10)}T${String(target.publish_time || "12:00").slice(0, 5)}` })));
    setTargets(current);
  }

  async function save() {
    if (!selected) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const recipients = recipientsText.split(/[,،\n]+/).map((value) => value.trim()).filter(Boolean);
      const result = await marketingPost<{ message: string }>({ action: "save_publish_prep", id: selected.id, caption, hashtags, recipients, useSavedContacts, targets });
      setMessage(result.message); setSelected(null); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر حفظ تجهيز النشر"); }
    finally { setSaving(false); }
  }

  async function publish(target: TargetRow) {
    setBusyTarget(target.id); setError(""); setMessage("");
    try {
      const result = await marketingPost<{ ok: boolean; message: string; result?: { status: string; publishedUrl?: string; errorMessage?: string } }>({ action: "execute_publish_target", targetId: target.id });
      if (result.ok) setMessage(result.message || `تم نشر ${target.platform_name}`);
      else setError(result.result?.errorMessage || result.message || "تعذر النشر");
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تنفيذ النشر"); }
    finally { setBusyTarget(""); }
  }

  async function bulkPublish() {
    if (!meta.access.publishPrepManage || !selectedRows.length) return;
    const eligibleTargets = selectedRows.flatMap((row) => row.targets.filter((target) => !["published", "publishing"].includes(target.status)));
    if (!eligibleTargets.length) { setError("العناصر المحددة لا تحتوي على Targets قابلة للنشر"); return; }
    setBulkBusy(true); setError(""); setMessage("");
    const errors: string[] = []; let succeeded = 0;
    for (const target of eligibleTargets) {
      try {
        const result = await marketingPost<{ ok: boolean; message: string; result?: { errorMessage?: string } }>({ action: "execute_publish_target", targetId: target.id });
        if (result.ok) succeeded += 1; else errors.push(`${target.platform_name}: ${result.result?.errorMessage || result.message}`);
      } catch (failure) { errors.push(`${target.platform_name}: ${failure instanceof Error ? failure.message : "تعذر النشر"}`); }
    }
    setSelectedIds([]);
    if (succeeded) setMessage(`تم تنفيذ ${succeeded} Target فعليًا`);
    if (errors.length) setError(errors.slice(0, 5).join(" — "));
    await load(); setBulkBusy(false);
  }

  async function downloadFinal(row: PublishRow) {
    if (!row.final_file_id) return;
    setError("");
    try {
      const result = await marketingPost<{ downloadUrl: string; fileName: string }>({ action: "download_task_file", taskId: row.source_task_id, fileId: row.final_file_id });
      window.open(result.downloadUrl, "_blank", "noopener,noreferrer");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر فتح الملف النهائي"); }
  }

  const selectedRows = useMemo(() => rows.filter((row) => selectedIds.includes(row.id)), [rows, selectedIds]);

  return (
    <div className="marketing-page">
      <MarketingPageHeader title="تجهيز النشر" description="مصدر الصفحة هو مهام التنفيذ المكتملة بملف نهائي معتمد. النشر لا يُسجل ناجحًا إلا بعد استجابة Adapter المنصة الفعلية." />
      {error ? <MarketingAlert>{error}</MarketingAlert> : null}
      {message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}
      <section className="marketing-publish-prep-stats">
        <article><span>كل التاسكات</span><strong>{stats.all_tasks || 0}</strong><small>تاسكات تنفيذية</small></article>
        <article><span>جاهز للنشر</span><strong>{stats.ready || 0}</strong><small>مكتملة وجاهزة</small></article>
        <article><span>بانتظار التاريخ</span><strong>{stats.waiting_date || 0}</strong><small>مكتملة بدون تاريخ</small></article>
        <article><span>ناقص</span><strong>{stats.missing || 0}</strong><small>تحتاج استكمال</small></article>
        <article><span>ملفات مرفوعة</span><strong>{stats.files_uploaded || 0}</strong><small>الملفات النهائية</small></article>
      </section>
      <section className="marketing-panel">
        <div className="marketing-toolbar">
          <label className="marketing-field"><span>بحث</span><div style={{ position: "relative" }}><MagnifyingGlass style={{ position: "absolute", right: 10, top: 12 }} /><input style={{ paddingRight: 36 }} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="الحملة أو الكود أو الكرييتيف" /></div></label>
          <label className="marketing-field"><span>الحالة</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">كل الحالات</option>{["draft", "ready", "scheduled", "publishing", "published", "failed", "blocked", "waiting_user_completion"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="marketing-field"><span>المنصة</span><select value={platformId} onChange={(event) => { setPlatformId(event.target.value); setPage(1); }}><option value="">كل المنصات</option>{meta.platforms.map((platform) => <option key={platform.id} value={platform.id}>{platform.name}</option>)}</select></label>
          <label className="marketing-field"><span>القسم</span><select value={departmentCode} onChange={(event) => { setDepartmentCode(event.target.value); setPage(1); }}><option value="">كل الأقسام</option>{departments.map((department) => <option key={department.department_code} value={department.department_code}>{department.department_name}</option>)}</select></label>
          <button className="marketing-button secondary" type="button" onClick={() => { setSearch(""); setStatus(""); setPlatformId(""); setDepartmentCode(""); setPage(1); }}>تصفير الفلاتر</button>
          {meta.access.publishPrepManage ? <label className="marketing-check"><input type="checkbox" checked={rows.length > 0 && rows.every((row) => selectedIds.includes(row.id))} onChange={(event) => setSelectedIds(event.target.checked ? rows.map((row) => row.id) : [])} /><span>تحديد الكل في الصفحة</span></label> : null}
        </div>
      </section>
      {selectedRows.length ? <section className="marketing-publish-bulk-bar"><div><strong>{selectedRows.length}</strong><span>عنصر محدد — كل Target يُنفذ مستقلًا بـIdempotency Key</span></div><button className="marketing-button primary" disabled={bulkBusy} onClick={() => void bulkPublish()}><RocketLaunch />{bulkBusy ? "جاري النشر..." : "نشر المحدد الآن"}</button></section> : null}
      {loading ? <MarketingLoading /> : !rows.length ? <section className="marketing-panel"><MarketingEmpty title="لا توجد عناصر جاهزة للنشر" description="تظهر هنا بعد اعتماد الملف النهائي لمهمة التنفيذ." /></section> : (
        <div className="marketing-stack">
          {rows.map((row) => (
            <article className="marketing-publish-card" key={row.id}>
              <header>
                {meta.access.publishPrepManage ? <label className="marketing-check"><input type="checkbox" checked={selectedIds.includes(row.id)} onChange={() => setSelectedIds((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} /><span /></label> : null}
                <div style={{ flex: 1 }}><small>{row.campaign_code} · {row.instance_code}</small><h3>{row.campaign_name} — {row.creative_name}</h3><span>القسم: {row.department_name || row.department_code || "—"} · المسؤول: {row.assigned_to_name || "—"}</span></div>
                <StatusBadge status={row.status} type="publish" />
                {row.final_file_id ? <button className="marketing-button small" onClick={() => void downloadFinal(row)}><DownloadSimple />الملف النهائي</button> : null}
                {meta.access.publishPrepManage ? <button className="marketing-button primary small" onClick={() => edit(row)}><PencilSimple />تجهيز</button> : null}
              </header>
              <div className="marketing-grid-2" style={{ marginTop: 12 }}>
                <div className="marketing-panel"><strong>Caption</strong><p>{row.caption || String(row.template_data?.caption || "—")}</p><small>{row.final_file_name ? `الملف النهائي: ${row.final_file_name}` : "لا يوجد ملف"}</small></div>
                <div className="marketing-panel"><strong>Hashtags</strong><p>{row.hashtags || String(row.template_data?.hashtags || "—")}</p><small>{row.use_saved_contacts ? `قائمة العملاء المحفوظة (${whatsappContactsCount})${row.recipients?.length ? ` + ${row.recipients.length} رقم إضافي` : ""}` : row.recipients?.length ? `${row.recipients.length} رقم واتساب` : "لا توجد أرقام واتساب"}</small></div>
              </div>
              <div className="marketing-stack">
                {row.targets.map((target) => (
                  <div className="marketing-publish-target" key={target.id}>
                    <div><b>{target.platform_name}</b><small style={{ display: "block" }}>{target.post_type_name || "—"}</small></div>
                    <span>{formatDate(target.scheduled_at, true)}</span>
                    <StatusBadge status={target.status} type="publish" />
                    <div className="marketing-table-actions">
                      {meta.access.publishPrepManage && !["published", "publishing"].includes(target.status) ? <button className="marketing-button success small" disabled={busyTarget === target.id || !row.final_file_id && target.platform_code !== "facebook" && target.platform_code !== "whatsapp"} onClick={() => void publish(target)}><RocketLaunch />{busyTarget === target.id ? "جاري النشر..." : "نشر الآن"}</button> : null}
                      {target.published_url ? <a className="marketing-button small" href={target.published_url} target="_blank" rel="noreferrer"><ArrowSquareOut />فتح الرابط</a> : null}
                    </div>
                    {target.error_message ? <MarketingAlert>{target.error_message}</MarketingAlert> : null}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
      <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
      <MarketingModal open={Boolean(selected)} title={selected ? `تجهيز ${selected.creative_name}` : "تجهيز النشر"} subtitle={selected ? `${selected.campaign_code} · ${selected.campaign_name}` : undefined} onClose={() => setSelected(null)} wide footer={<><button className="marketing-button" onClick={() => setSelected(null)}>إلغاء</button><button className="marketing-button primary" disabled={saving} onClick={() => void save()}>{saving ? "جاري الحفظ..." : "حفظ تجهيز النشر"}</button></>}>
        <div className="marketing-stack">
          <div className="marketing-form-grid">
            <label className="marketing-field"><span>Caption</span><textarea value={caption} onChange={(event) => setCaption(event.target.value)} /></label>
            <label className="marketing-field"><span>Hashtags</span><textarea value={hashtags} onChange={(event) => setHashtags(event.target.value)} /></label>
            <label className="marketing-field wide"><span>أرقام واتساب إضافية — رقم في كل سطر</span><textarea value={recipientsText} onChange={(event) => setRecipientsText(event.target.value)} placeholder="9665xxxxxxxx" /></label>
            <label className="marketing-check wide"><input type="checkbox" checked={useSavedContacts} onChange={(event) => setUseSavedContacts(event.target.checked)} /><span>استخدام قائمة عملاء واتساب المحفوظة من إعدادات التسويق ({whatsappContactsCount} رقم)</span></label>
          </div>
          {useSavedContacts ? <MarketingAlert type="info">سيتم الجمع بين القائمة المحفوظة والأرقام الإضافية مع منع التكرار. لا يتم إرسال أي رسالة إلا عند تنفيذ Target واتساب فعليًا.</MarketingAlert> : null}
          <div className="marketing-panel-head"><div><h3>المنصات والمواعيد</h3><p>كل Target مستقل في الحالة والموعد ومحاولة النشر.</p></div><button className="marketing-button secondary small" onClick={() => setTargets((current) => [...current, { platformId: "", postTypeId: "", scheduledAt: "" }])}><Plus />منصة</button></div>
          {targets.map((target, index) => (
            <div className="marketing-target-row" key={target.id || index}>
              <label className="marketing-field"><span>المنصة</span><select value={target.platformId} onChange={(event) => setTargets((current) => current.map((item, i) => i === index ? { ...item, platformId: event.target.value, postTypeId: "" } : item))}><option value="">اختر</option>{meta.platforms.map((platform) => <option key={platform.id} value={platform.id}>{platform.name}</option>)}</select></label>
              <label className="marketing-field"><span>النوع</span><select value={target.postTypeId} onChange={(event) => setTargets((current) => current.map((item, i) => i === index ? { ...item, postTypeId: event.target.value } : item))}><option value="">اختر</option>{meta.postTypes.filter((type) => type.platform_id === target.platformId).map((type) => <option key={type.id} value={type.id}>{type.name} {type.dimensions ? `· ${type.dimensions}` : ""}</option>)}</select></label>
              <label className="marketing-field"><span>التاريخ والوقت</span><input type="datetime-local" value={target.scheduledAt} onChange={(event) => setTargets((current) => current.map((item, i) => i === index ? { ...item, scheduledAt: event.target.value } : item))} /></label>
              <button className="marketing-button danger" onClick={() => setTargets((current) => current.filter((_item, i) => i !== index))}><Trash /></button>
            </div>
          ))}
        </div>
      </MarketingModal>
    </div>
  );
}
