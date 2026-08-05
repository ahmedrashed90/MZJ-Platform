import { useEffect, useMemo, useState } from "react";
import { ArrowSquareOut, CheckCircle, Funnel, MagnifyingGlass, PaperPlaneTilt, PencilSimple, SlidersHorizontal, SpinnerGap, UploadSimple, WarningCircle, X, XCircle, YoutubeLogo } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { downloadMarketingFile, marketingDate, marketingFetch, marketingQuery, readMarketingMediaMetadataList, uploadMarketingFinalFiles, type MarketingMediaMetadata } from "../api";
import { MarketingAlert, MarketingPage, ProgressBar } from "../components/MarketingPage";
import type { MarketingMeta, PlatformAssignment } from "../types";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../systemAccess";
import {
  YOUTUBE_CATEGORY_FALLBACKS,
  YOUTUBE_PUBLISH_DEFAULTS,
  normalizeYouTubePublishOptions,
  normalizeYouTubePublishSettings,
  type YouTubeOptionItem,
  type YouTubePublishOptions,
  type YouTubePublishSettings,
} from "../../../shared/youtube-publishing";
import { normalizeMarketingPublishFormat, resolveMarketingPublishFormat, validateMarketingPublishMedia, type MarketingMediaDescriptor, type MarketingPublishMediaTarget } from "../../../shared/marketing-publishing";

type PublishPrepView = "tasks" | "manual";
type ManualPublishDraft = {
  sourceType: "campaign" | "agenda";
  sourceName: string;
  creativeName: string;
  files: File[];
  fileMetadata: MarketingMediaMetadata[];
  platforms: PlatformAssignment[];
  publishDate: string;
  caption: string;
  hashtags: string;
  youtubeOptions: YouTubePublishOptions;
};

function rowPlatforms(row: any): PlatformAssignment[] {
  return Array.isArray(row?.platforms) ? row.platforms : [];
}

function rowFinalFiles(row: any) {
  const files = Array.isArray(row?.final_files) ? row.final_files.filter((file: any) => file?.id) : [];
  if (files.length) return files;
  return row?.final_file_id ? [{ id: row.final_file_id, name: row.final_file_name || "فتح الملف النهائي", mimeType: row.final_file_mime_type || "", width: row.final_file_width || null, height: row.final_file_height || null, durationSeconds: row.final_file_duration_seconds || null, orderIndex: 0 }] : [];
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

function createManualDraft(defaults: YouTubePublishSettings): ManualPublishDraft {
  return {
    sourceType: "campaign",
    sourceName: "",
    creativeName: "",
    files: [],
    fileMetadata: [],
    platforms: [],
    publishDate: "",
    caption: "",
    hashtags: "",
    youtubeOptions: normalizeYouTubePublishOptions({}, defaults),
  };
}

function copyPlatforms(value: unknown): PlatformAssignment[] {
  return (Array.isArray(value) ? value : []).map((platform: any) => ({
    platformId: String(platform?.platformId || ""),
    postTypeIds: Array.isArray(platform?.postTypeIds) ? [...platform.postTypeIds] : [],
  })).filter((platform) => platform.platformId);
}

function selectedMediaTargets(meta: MarketingMeta | null, platforms: PlatformAssignment[]): MarketingPublishMediaTarget[] {
  if (!meta) return [];
  const platformById = new Map(meta.platforms.map((platform) => [platform.id, platform]));
  const postTypeById = new Map(meta.postTypes.map((postType) => [postType.id, postType]));
  return platforms.flatMap((selection) => selection.postTypeIds.flatMap((postTypeId) => {
    const platform = platformById.get(selection.platformId);
    const postType = postTypeById.get(postTypeId);
    if (!platform || !postType || postType.platform_id !== platform.id) return [];
    return [{
      platformCode: String(platform.code || "").toLowerCase(),
      postTypeName: postType.name,
      format: normalizeMarketingPublishFormat(postType.publish_format || resolveMarketingPublishFormat(platform.code, postType.name)),
      width: postType.width || null,
      height: postType.height || null,
    }];
  }));
}

function browserMediaDescriptors(files: File[], metadata: MarketingMediaMetadata[]): MarketingMediaDescriptor[] {
  return files.map((file, index) => ({
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    width: metadata[index]?.width || null,
    height: metadata[index]?.height || null,
    durationSeconds: metadata[index]?.durationSeconds || null,
  }));
}

function mediaValidationErrors(meta: MarketingMeta | null, platforms: PlatformAssignment[], files: MarketingMediaDescriptor[]) {
  if (!files.length) return [];
  return [...new Set(selectedMediaTargets(meta, platforms).flatMap((target) => validateMarketingPublishMedia(target, files)))];
}

function PlatformEditor({
  meta,
  value,
  onChange,
  onYouTubeSelected,
}: {
  meta: MarketingMeta | null;
  value: PlatformAssignment[];
  onChange: (value: PlatformAssignment[]) => void;
  onYouTubeSelected: () => void;
}) {
  return <div className="marketing-publish-platform-editor">{meta?.platforms.map((platform) => {
    const selected = value.find((item) => item.platformId === platform.id);
    const isYouTube = String(platform.code || "").toLowerCase() === "youtube";
    return <article key={platform.id} className={selected ? "selected" : ""}>
      <label className="marketing-publish-platform-toggle">
        <input
          type="checkbox"
          checked={Boolean(selected)}
          onChange={(event) => {
            if (event.target.checked) {
              onChange([...value, { platformId: platform.id, postTypeIds: [] }]);
              if (isYouTube) onYouTubeSelected();
            } else {
              onChange(value.filter((item) => item.platformId !== platform.id));
            }
          }}
        />
        <span>{platform.name}</span>
      </label>
      {selected ? <div className="marketing-publish-post-types">{meta.postTypes.filter((item) => item.platform_id === platform.id).map((postType) => {
        const checked = selected.postTypeIds.includes(postType.id);
        return <label key={postType.id} className={checked ? "selected" : ""}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => onChange(value.map((item) => item.platformId === platform.id ? {
              ...item,
              postTypeIds: event.target.checked
                ? [...new Set([...item.postTypeIds, postType.id])]
                : item.postTypeIds.filter((id) => id !== postType.id),
            } : item))}
          />
          <span>{postType.name}{postType.width && postType.height ? ` · ${postType.width}×${postType.height}` : ""}</span>
        </label>;
      })}</div> : <p>فعّل المنصة لإظهار أنواع النشر.</p>}
    </article>;
  })}</div>;
}

function YouTubeOptionsFields({
  value,
  onChange,
  categories,
  playlists,
  loading,
}: {
  value: YouTubePublishOptions;
  onChange: (value: YouTubePublishOptions) => void;
  categories: YouTubeOptionItem[];
  playlists: Array<YouTubeOptionItem & { privacyStatus?: string }>;
  loading: boolean;
}) {
  return <section className="marketing-publish-edit-section marketing-youtube-publish-section">
    <header><span><YoutubeLogo size={24} weight="fill" /></span><div><h3>إعدادات فيديو YouTube</h3><p>تم تحميل الإعدادات الافتراضية للقناة، ويمكن تخصيص هذا الفيديو فقط قبل النشر.</p></div>{loading ? <SpinnerGap className="marketing-spin" size={19} /> : null}</header>
    <div className="marketing-form-grid">
      <label className="full"><span>عنوان الفيديو</span><input maxLength={100} value={value.title || ""} onChange={(event) => onChange({ ...value, title: event.target.value })} placeholder="عنوان واضح للفيديو" /><small>{String(value.title || "").length}/100</small></label>
      <label className="full"><span>وصف الفيديو</span><textarea rows={6} value={value.description || ""} onChange={(event) => onChange({ ...value, description: event.target.value })} /></label>
      <label className="full"><span>الكلمات المفتاحية</span><textarea rows={3} value={(value.tags || []).join("، ")} onChange={(event) => onChange({ ...value, tags: event.target.value.split(/[،,\n]+/).map((item) => item.trim()).filter(Boolean) })} placeholder="سيارات، MZJ، عروض" /></label>
      <label><span>حالة الظهور</span><select value={value.privacyStatus || "unlisted"} onChange={(event) => onChange({ ...value, privacyStatus: event.target.value as YouTubePublishOptions["privacyStatus"] })}><option value="unlisted">غير مدرج — بالرابط فقط</option><option value="private">خاص</option><option value="public">عام</option></select></label>
      <label><span>تصنيف الفيديو</span><select value={value.categoryId || "2"} onChange={(event) => onChange({ ...value, categoryId: event.target.value })}>{categories.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label><span>قائمة التشغيل</span><select value={value.playlistId || ""} onChange={(event) => onChange({ ...value, playlistId: event.target.value })}><option value="">بدون قائمة تشغيل</option>{playlists.map((item) => <option key={item.id} value={item.id}>{item.title}{item.privacyStatus ? ` — ${item.privacyStatus}` : ""}</option>)}</select></label>
      <label><span>لغة الفيديو</span><input dir="ltr" value={value.defaultLanguage || "ar"} onChange={(event) => onChange({ ...value, defaultLanguage: event.target.value })} /></label>
      <label><span>الترخيص</span><select value={value.license || "youtube"} onChange={(event) => onChange({ ...value, license: event.target.value as YouTubePublishOptions["license"] })}><option value="youtube">ترخيص YouTube القياسي</option><option value="creativeCommon">Creative Commons</option></select></label>
      <label><span>مخصص للأطفال</span><select value={value.madeForKids ? "true" : "false"} onChange={(event) => onChange({ ...value, madeForKids: event.target.value === "true" })}><option value="false">لا</option><option value="true">نعم</option></select></label>
      <div className="marketing-youtube-task-toggles">
        <label><input type="checkbox" checked={Boolean(value.notifySubscribers)} onChange={(event) => onChange({ ...value, notifySubscribers: event.target.checked })} /><span>إشعار المشتركين</span></label>
        <label><input type="checkbox" checked={Boolean(value.embeddable)} onChange={(event) => onChange({ ...value, embeddable: event.target.checked })} /><span>السماح بالتضمين</span></label>
        <label><input type="checkbox" checked={Boolean(value.publicStatsViewable)} onChange={(event) => onChange({ ...value, publicStatsViewable: event.target.checked })} /><span>إظهار الإحصاءات العامة</span></label>
      </div>
    </div>
  </section>;
}

export function PublishPrepPage() {
  const { user } = useAuth();
  const canManagePrep = hasPermission(user, "marketing.publish_prep.manage");
  const canPublishNow = hasPermission(user, "marketing.publish.now");
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<MarketingMeta | null>(null);
  const [view, setView] = useState<PublishPrepView>("tasks");
  const [manual, setManual] = useState<ManualPublishDraft>(() => createManualDraft(YOUTUBE_PUBLISH_DEFAULTS));
  const [manualFileInputKey, setManualFileInputKey] = useState(0);
  const [manualUploadStatus, setManualUploadStatus] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<any>(null);
  const [filters, setFilters] = useState({ search: "", status: "", platform: "", department: "" });
  const [publishResults, setPublishResults] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [youtubeDefaults, setYoutubeDefaults] = useState<YouTubePublishSettings>(YOUTUBE_PUBLISH_DEFAULTS);
  const [youtubeCategories, setYoutubeCategories] = useState<YouTubeOptionItem[]>(YOUTUBE_CATEGORY_FALLBACKS);
  const [youtubePlaylists, setYoutubePlaylists] = useState<Array<YouTubeOptionItem & { privacyStatus?: string }>>([]);
  const [youtubeOptionsLoading, setYoutubeOptionsLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [tasks, info] = await Promise.all([
        marketingFetch<{ rows: any[]; youtubeDefaults?: YouTubePublishSettings }>(`/api/marketing${marketingQuery({ resource: "publish_prep" })}`),
        marketingFetch<MarketingMeta>(`/api/marketing${marketingQuery({ resource: "meta" })}`),
      ]);
      const defaults = normalizeYouTubePublishSettings(tasks.youtubeDefaults);
      setRows(tasks.rows);
      setYoutubeDefaults(defaults);
      setManual((current) => ({ ...current, youtubeOptions: normalizeYouTubePublishOptions(current.youtubeOptions, defaults) }));
      setMeta(info);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل تجهيز النشر");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function youtubePlatformId() {
    return meta?.platforms.find((platform) => String(platform.code || "").toLowerCase() === "youtube")?.id || "";
  }

  function selectionsIncludeYouTube(platforms: PlatformAssignment[]) {
    const platformId = youtubePlatformId();
    return Boolean(platformId && platforms.some((platform) => platform.platformId === platformId));
  }

  function includesYouTube(row: any) {
    return selectionsIncludeYouTube(rowPlatforms(row));
  }

  async function loadYouTubeOptions() {
    if (youtubeOptionsLoading) return;
    setYoutubeOptionsLoading(true);
    try {
      const result = await marketingFetch<{ settings: YouTubePublishSettings; categories: YouTubeOptionItem[]; playlists: Array<YouTubeOptionItem & { privacyStatus?: string }> }>(`/api/marketing${marketingQuery({ resource: "youtube_publish_options" })}`);
      const defaults = normalizeYouTubePublishSettings(result.settings);
      setYoutubeDefaults(defaults);
      setYoutubeCategories(result.categories?.length ? result.categories : YOUTUBE_CATEGORY_FALLBACKS);
      setYoutubePlaylists(result.playlists || []);
      setEditing((current: any) => current ? {
        ...current,
        youtubeOptions: normalizeYouTubePublishOptions(current.youtubeOptions, defaults, {
          title: current.youtube_title_seed || current.creative_name,
          description: [current.caption, current.hashtags].filter(Boolean).join("\n\n"),
        }),
      } : current);
      setManual((current) => ({
        ...current,
        youtubeOptions: normalizeYouTubePublishOptions(current.youtubeOptions, defaults, {
          title: current.creativeName,
          description: [current.caption, current.hashtags].filter(Boolean).join("\n\n"),
        }),
      }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل خيارات YouTube");
    } finally {
      setYoutubeOptionsLoading(false);
    }
  }

  function missing(row: any) {
    const values: string[] = [];
    const platforms = rowPlatforms(row);
    if (!row.final_file_id && !Number(row.final_file_count || 0)) values.push("الملف النهائي");
    if (!String(row.caption || "").trim()) values.push("الكابشن");
    if (!String(row.hashtags || "").trim()) values.push("الهاشتاج");
    if (!row.publish_date) values.push("تاريخ النشر");
    if (!platforms.length) values.push("المنصة");
    else if (platforms.some((platform) => !Array.isArray(platform.postTypeIds) || !platform.postTypeIds.length)) values.push("نوع النشر لكل منصة");
    if (includesYouTube(row) && !String(row.youtube_options?.title || "").trim()) values.push("عنوان YouTube");
    values.push(...mediaValidationErrors(meta, platforms, rowFinalFiles(row)));
    return [...new Set(values)];
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
      && (!filters.platform || rowPlatforms(row).some((platform) => platform.platformId === filters.platform))
      && (!filters.department || String(row.department_id || "") === filters.department);
  }), [rows, filters, meta]);

  const stats = useMemo(() => ({
    all: rows.length,
    ready: rows.filter((row) => readiness(row) === "جاهز للنشر").length,
    failed: rows.filter((row) => readiness(row) === "فشل النشر").length,
    missing: rows.filter((row) => readiness(row) === "ناقص").length,
    files: rows.filter((row) => row.final_file_id || Number(row.final_file_count || 0) > 0).length,
  }), [rows, meta]);

  const manualMissing = useMemo(() => {
    const values: string[] = [];
    if (!manual.sourceName.trim()) values.push(manual.sourceType === "agenda" ? "اسم الأجندة الجديدة" : "اسم الحملة الجديدة");
    if (!manual.creativeName.trim()) values.push("اسم الكرييتيف الجديد");
    if (!manual.files.length) values.push("ملف النشر");
    else if (manual.fileMetadata.length !== manual.files.length) values.push("قراءة أبعاد الملفات");
    if (!manual.publishDate) values.push("موعد النشر");
    if (!manual.caption.trim()) values.push("الكابشن");
    if (!manual.hashtags.trim()) values.push("الهاشتاج");
    if (!manual.platforms.length) values.push("المنصة");
    else if (manual.platforms.some((platform) => !platform.postTypeIds.length)) values.push("نوع النشر لكل منصة");
    if (selectionsIncludeYouTube(manual.platforms) && !manual.youtubeOptions.title.trim()) values.push("عنوان YouTube");
    values.push(...mediaValidationErrors(meta, manual.platforms, browserMediaDescriptors(manual.files, manual.fileMetadata)));
    return [...new Set(values)];
  }, [manual, meta]);

  async function save() {
    if (!editing) return;
    setLoading(true);
    setError("");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "save_publish_prep", id: editing.id, taskId: editing.task_id || "", platforms: editing.platforms || [], publishDate: String(editing.publish_date || "").slice(0, 10), caption: editing.caption, hashtags: editing.hashtags, youtubeOptions: editing.youtubeOptions }),
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

  async function saveManual() {
    if (!canManagePrep) {
      setError("لا توجد صلاحية لإدارة تجهيز النشر");
      return;
    }
    if (manualMissing.length) {
      setError(`أكمل بيانات النشر اليدوي: ${manualMissing.join("، ")}`);
      return;
    }
    setLoading(true);
    setError("");
    setMessage("");
    setManualUploadStatus("جاري إنشاء السجل داخل السيستم");
    try {
      const created = await marketingFetch<{ sourceType: "campaign" | "agenda"; sourceId: string; taskId: string; message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({
          action: "create_manual_publish_entry",
          sourceType: manual.sourceType,
          sourceName: manual.sourceName,
          creativeName: manual.creativeName,
          platforms: manual.platforms,
          publishDate: manual.publishDate,
          caption: manual.caption,
          hashtags: manual.hashtags,
          files: browserMediaDescriptors(manual.files, manual.fileMetadata),
        }),
      });
      setManualUploadStatus("جاري رفع ملف النشر");
      await uploadMarketingFinalFiles({
        files: manual.files,
        metadata: manual.fileMetadata,
        sourceType: created.sourceType,
        sourceId: created.sourceId,
        taskId: created.taskId,
        onProgress: (progress) => setManualUploadStatus(`${progress.detail || "جاري رفع الملف"} — ${progress.fileName} ${progress.percent}%`),
      });
      setManualUploadStatus("جاري حفظ المنصات وأنواع النشر");
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({
          action: "save_publish_prep",
          taskId: created.taskId,
          platforms: manual.platforms,
          publishDate: manual.publishDate,
          caption: manual.caption,
          hashtags: manual.hashtags,
          youtubeOptions: manual.youtubeOptions,
        }),
      });
      setMessage(`${created.message}. ${result.message || "تم حفظ تجهيز النشر"}`);
      setManual(createManualDraft(youtubeDefaults));
      setManualFileInputKey((current) => current + 1);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر حفظ النشر اليدوي");
    } finally {
      setManualUploadStatus("");
      setLoading(false);
    }
  }

  async function selectManualFiles(files: File[]) {
    setError("");
    setManualUploadStatus(files.length ? "جاري قراءة أبعاد الملفات" : "");
    setManual((current) => ({ ...current, files, fileMetadata: [] }));
    if (!files.length) return;
    try {
      const fileMetadata = await readMarketingMediaMetadataList(files);
      setManual((current) => ({ ...current, files, fileMetadata }));
    } catch (failure) {
      setManual((current) => ({ ...current, files: [], fileMetadata: [] }));
      setManualFileInputKey((current) => current + 1);
      setError(failure instanceof Error ? failure.message : "تعذر قراءة أبعاد ملفات النشر");
    } finally {
      setManualUploadStatus("");
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
      const failed = results.filter((item) => !item.ok);
      setSelectedIds([]);
      await load();
      setPublishResults(results);
      if (failed.length) setError(`تعذر نشر ${failed.length.toLocaleString("ar-SA-u-nu-latn")} عنصر. سبب كل خطأ ظاهر بالتفصيل أدناه.`);
      else setMessage("تم النشر بنجاح على كل المنصات المحددة");
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
    setEditing({
      ...row,
      publish_date: String(row.publish_date || "").slice(0, 10),
      platforms: copyPlatforms(rowPlatforms(row)),
      youtubeOptions: normalizeYouTubePublishOptions(row.youtube_options, youtubeDefaults, {
        title: row.youtube_title_seed || row.creative_name,
        description: [row.caption, row.hashtags].filter(Boolean).join("\n\n"),
      }),
    });
    if (includesYouTube(row)) void loadYouTubeOptions();
  }

  return <MarketingPage title="تجهيز النشر" description="التاسكات التنفيذية فقط: راجع التجهيز الحالي أو أنشئ نشرًا يدويًا للحملات والأجندات مع تحديد المنصة ونوع النشر والموعد والمحتوى.">
    {error ? <MarketingAlert>{error}</MarketingAlert> : null}
    {message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}

    <div className="marketing-publish-view-tabs" role="tablist" aria-label="أقسام تجهيز النشر">
      <button type="button" className={view === "tasks" ? "active" : ""} onClick={() => setView("tasks")}>تجهيز التاسكات</button>
      <button type="button" className={view === "manual" ? "active" : ""} onClick={() => setView("manual")} disabled={!canManagePrep}>النشر اليدوي</button>
    </div>

    {publishResults.length ? <section className="panel marketing-publish-results">
      <header><div><h3>نتيجة تنفيذ النشر</h3><p>كل منصة ونوع نشر لهما نتيجة مستقلة.</p></div><button type="button" className="icon-button" onClick={() => setPublishResults([])} aria-label="إغلاق النتائج"><X size={18} /></button></header>
      <div>{publishResults.map((item: any, index: number) => <article key={`${item.id || index}-${index}`} className={item.ok ? "success" : "failed"}>
        <span>{item.ok ? <CheckCircle size={21} weight="fill" /> : <XCircle size={21} weight="fill" />}</span>
        <div><strong>{item.platformName || item.platform || "منصة"}{item.postTypeName ? ` — ${item.postTypeName}` : ""}</strong><p>{item.ok ? "تم النشر بنجاح" : item.error || "تعذر النشر بدون تفاصيل إضافية"}</p></div>
      </article>)}</div>
    </section> : null}

    {view === "tasks" ? <>
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

            <div className="marketing-publish-platforms">{rowPlatforms(row).length ? rowPlatforms(row).map((platform) => {
              const platformName = meta?.platforms.find((item) => item.id === platform.platformId)?.name || "منصة";
              const types = platform.postTypeIds.map((id) => meta?.postTypes.find((item) => item.id === id)?.name).filter(Boolean);
              const isYoutube = meta?.platforms.find((item) => item.id === platform.platformId)?.code?.toLowerCase() === "youtube";
              const privacyLabel = row.youtube_options?.privacyStatus === "public" ? "عام" : row.youtube_options?.privacyStatus === "private" ? "خاص" : "غير مدرج";
              return <div key={platform.platformId}><strong>{platformName}</strong><span className={isYoutube ? "marketing-youtube-platform-summary" : undefined}>{types.join("، ") || "لم يحدد نوع نشر"}{isYoutube ? ` • ${privacyLabel}` : ""}</span></div>;
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

      {canPublishNow && selectedIds.length ? <div className="marketing-bulk-bar"><span>تم تحديد <strong>{selectedIds.length.toLocaleString("ar-SA-u-nu-latn")}</strong> تاسك</span><button type="button" className="primary" onClick={() => void publish()} disabled={loading}><PaperPlaneTilt size={18} />نشر المحدد الآن</button></div> : null}
    </> : <section className="panel marketing-manual-publish-panel">
      <header><div><h3>تجهيز نشر يدوي</h3><p>أنشئ حملة أو أجندة جديدة لمحتوى غير موجود في السيستم، وارفع الكرييتيف ثم حدد المنصات وأنواع النشر.</p></div><span><PaperPlaneTilt size={22} /></span></header>
      <div className="marketing-manual-publish-selectors">
        <label><span>تسجيل المحتوى داخل</span><select value={manual.sourceType} onChange={(event) => setManual((current) => ({ ...current, sourceType: event.target.value as "campaign" | "agenda" }))}><option value="campaign">حملة جديدة</option><option value="agenda">أجندة جديدة</option></select></label>
        <label><span>{manual.sourceType === "agenda" ? "اسم الأجندة الجديدة" : "اسم الحملة الجديدة"}</span><input value={manual.sourceName} onChange={(event) => setManual((current) => ({ ...current, sourceName: event.target.value }))} placeholder={manual.sourceType === "agenda" ? "اكتب اسم الأجندة" : "اكتب اسم الحملة"} /></label>
        <label><span>اسم الكرييتيف الجديد</span><input value={manual.creativeName} onChange={(event) => setManual((current) => ({ ...current, creativeName: event.target.value }))} placeholder="اكتب اسم الكرييتيف" /></label>
        <label><span>ملف النشر</span><input key={manualFileInputKey} type="file" accept="image/*,video/*" multiple onChange={(event) => void selectManualFiles(Array.from(event.target.files || []))} /><small>{manual.files.length ? `${manual.files.length} ملف محدد` : "ارفع الصور أو الفيديو الجديد"}</small></label>
      </div>

      <div className="marketing-manual-publish-workspace">
        <section className="marketing-publish-edit-summary">
          <div><small>نوع السجل</small><strong>{manual.sourceType === "agenda" ? "أجندة جديدة" : "حملة جديدة"}</strong></div>
          <div><small>الاسم</small><strong>{manual.sourceName || "—"}</strong></div>
          <div><small>الكرييتيف</small><strong>{manual.creativeName || "—"}</strong></div>
          <div><small>الملفات والأبعاد</small><strong>{manual.files.length ? manual.files.map((file, index) => { const metadata = manual.fileMetadata[index]; return `${file.name}${metadata ? ` (${metadata.width}×${metadata.height}${metadata.durationSeconds ? ` · ${Math.round(metadata.durationSeconds)}ث` : ""})` : ""}`; }).join("، ") : "غير مرفوع"}</strong></div>
        </section>

        <section className="marketing-publish-edit-section"><header><div><h3>المنصات وأنواع النشر</h3><p>كل نوع نشر يعرض أبعاده المعتمدة، ولن يُحفظ الملف إذا لم يطابق النوع المختار.</p></div></header><PlatformEditor meta={meta} value={manual.platforms} onChange={(platforms) => setManual((current) => ({ ...current, platforms }))} onYouTubeSelected={() => void loadYouTubeOptions()} /></section>

        <section className="marketing-publish-edit-section"><header><div><h3>موعد ومحتوى النشر</h3><p>حدد موعد النشر، ثم اكتب الكابشن والهاشتاج الخاصين بالمحتوى الجديد.</p></div></header><div className="marketing-form-grid marketing-publish-content-grid"><label><span>موعد النشر</span><input type="date" value={manual.publishDate} onChange={(event) => setManual((current) => ({ ...current, publishDate: event.target.value }))} /></label><label className="full"><span>Caption</span><textarea rows={7} value={manual.caption} onChange={(event) => setManual((current) => ({ ...current, caption: event.target.value }))} /></label><label className="full"><span>Hashtag</span><textarea rows={5} value={manual.hashtags} onChange={(event) => setManual((current) => ({ ...current, hashtags: event.target.value }))} /></label></div></section>

        {selectionsIncludeYouTube(manual.platforms) ? <YouTubeOptionsFields value={manual.youtubeOptions} onChange={(youtubeOptions) => setManual((current) => ({ ...current, youtubeOptions }))} categories={youtubeCategories} playlists={youtubePlaylists} loading={youtubeOptionsLoading} /> : null}

        <footer className="marketing-manual-publish-footer">
          <div>{manualUploadStatus ? <><SpinnerGap className="marketing-spin" size={18} /><span>{manualUploadStatus}</span></> : manualMissing.length ? <><WarningCircle size={18} /><span>ناقص: {manualMissing.join("، ")}</span></> : <><CheckCircle size={18} /><span>بيانات النشر اليدوي مكتملة</span></>}</div>
          <button type="button" className="primary" disabled={loading || Boolean(manualMissing.length)} onClick={() => void saveManual()}><CheckCircle size={18} />إنشاء وحفظ تجهيز النشر</button>
        </footer>
      </div>
    </section>}

    <Modal open={Boolean(editing)} title="تعديل تجهيز النشر" subtitle={editing ? `${editing.source_name || ""} — ${editing.creative_name || ""}` : undefined} onClose={() => setEditing(null)} className="marketing-publish-edit-modal" footer={<><button type="button" className="secondary" onClick={() => setEditing(null)}>إلغاء</button><button type="button" className="primary" onClick={() => void save()} disabled={loading}><CheckCircle size={18} />حفظ تجهيز النشر</button></>}>
      {editing ? <div className="marketing-publish-edit-workspace">
        <section className="marketing-publish-edit-summary"><div><small>الحملة / الأجندة</small><strong>{editing.source_name || "—"}</strong></div><div><small>الكرييتيف</small><strong>{editing.creative_name || "—"}</strong></div><div><small>المسؤول</small><strong>{editing.assigned_name || "—"}</strong></div><div><small>القسم</small><strong>{editing.department_name || "—"}</strong></div></section>
        <section className="marketing-publish-edit-section"><header><div><h3>المنصات وأنواع النشر</h3><p>اختر المنصات المطلوبة ثم حدد أنواع النشر داخل كل منصة.</p></div></header><PlatformEditor meta={meta} value={editing.platforms || []} onChange={(platforms) => setEditing({ ...editing, platforms })} onYouTubeSelected={() => void loadYouTubeOptions()} /></section>
        <section className="marketing-publish-edit-section"><header><div><h3>تاريخ ومحتوى النشر</h3><p>تاريخ النشر مرجع للجدول كموعد مخطط، لكن زر نشر الآن يعمل في أي وقت بعد اكتمال البيانات.</p></div></header><div className="marketing-form-grid marketing-publish-content-grid"><label><span>تاريخ النشر</span><input type="date" value={editing.publish_date || ""} onChange={(event) => setEditing({ ...editing, publish_date: event.target.value })} /></label><label className="full"><span>Caption</span><textarea rows={7} value={editing.caption || ""} onChange={(event) => setEditing({ ...editing, caption: event.target.value })} /></label><label className="full"><span>Hashtag</span><textarea rows={5} value={editing.hashtags || ""} onChange={(event) => setEditing({ ...editing, hashtags: event.target.value })} /></label></div></section>
        {selectionsIncludeYouTube(editing.platforms || []) ? <YouTubeOptionsFields value={editing.youtubeOptions} onChange={(youtubeOptions) => setEditing({ ...editing, youtubeOptions })} categories={youtubeCategories} playlists={youtubePlaylists} loading={youtubeOptionsLoading} /> : null}
      </div> : null}
    </Modal>
  </MarketingPage>;
}
