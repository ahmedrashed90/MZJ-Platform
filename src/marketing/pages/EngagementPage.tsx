import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Archive,
  ArrowClockwise,
  ArrowCounterClockwise,
  ChatCircleDots,
  CheckCircle,
  DotsThreeVertical,
  FacebookLogo,
  Heart,
  InstagramLogo,
  LinkSimple,
  MagnifyingGlass,
  ShareNetwork,
  Trash,
  UsersThree,
  XCircle,
} from "@phosphor-icons/react";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../systemAccess";
import { Modal } from "../../components/Modal";
import { marketingDate, marketingFetch, marketingQuery } from "../api";
import { EngagementResultDetail } from "../components/EngagementResultDetail";
import {
  marketingResultCount,
  marketingResultPlatformLabel,
  marketingResultSourceLabel,
  type EngagementResultGroup,
  type EngagementResultsPayload,
} from "../engagementResults";
import { MarketingAlert, MarketingPage } from "../components/MarketingPage";

type SubscriptionResult = {
  platform: "facebook" | "instagram";
  field?: string;
  ok: boolean;
  accountId?: string;
  accountName?: string;
  host?: string;
  endpoint?: string;
  linkedPageId?: string;
  activationMode?: string;
  note?: string;
  subscribedFields?: string[];
  grantedScopes?: string[];
  requiredScopes?: string[];
  missingScopes?: string[];
  error?: string;
  errorDetails?: { status?: number | null; type?: string; code?: number | null; subcode?: number | null; traceId?: string; host?: string; path?: string };
};

type EngagementSummary = {
  posts: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  views: number;
  reach: number;
  crmLeads: number;
  engagements: number;
  commentEvents: number;
  likeEvents: number;
  shareEvents: number;
};

type Payload = {
  rows: any[];
  engagements: any[];
  comments: any[];
  summary: EngagementSummary;
  results: EngagementResultsPayload;
  webhook: { callbackUrl: string; verifyTokenConfigured: boolean; subscriptionResults?: SubscriptionResult[] };
};

type RecordStatus = "active" | "archived" | "all";
type EngagementKind = "" | "comment" | "like" | "share";
type ManageEntity = "post" | "engagement";
type ManageOperation = "archive" | "restore" | "delete" | "delete_customer";
type PageView = "engagement" | "campaigns" | "agendas";

const EMPTY_SUMMARY: EngagementSummary = {
  posts: 0,
  likes: 0,
  comments: 0,
  shares: 0,
  saves: 0,
  views: 0,
  reach: 0,
  crmLeads: 0,
  engagements: 0,
  commentEvents: 0,
  likeEvents: 0,
  shareEvents: 0,
};

function count(value: unknown) { return Number(value || 0).toLocaleString("ar-SA-u-nu-latn"); }
function platformLabel(platform: string) { return marketingResultPlatformLabel(platform); }
function sourceLabel(platform: string) {
  if (platform === "facebook") return "بوست فيس بوك";
  if (platform === "instagram") return "بوست انستجرام";
  return marketingResultSourceLabel(platform);
}
function platformIcon(platform: string, size: number) {
  if (platform === "facebook") return <FacebookLogo size={size} weight="fill" />;
  if (platform === "instagram") return <InstagramLogo size={size} weight="fill" />;
  return null;
}
function engagementLabel(kind: string) {
  if (kind === "like") return "إعجاب";
  if (kind === "share") return "مشاركة";
  return "تعليق";
}
function recordMatchesStatus(row: any, status: RecordStatus) {
  if (status === "all") return true;
  return status === "archived" ? Boolean(row.archived_at) : !row.archived_at;
}
function processingLabel(status: string) {
  if (status === "created") return "عميل جديد";
  if (status === "reused") return "عميل موجود";
  if (status === "failed") return "فشل التحويل";
  if (status === "ignored") return "تم التجاهل";
  return "قيد المعالجة";
}
function pageView(value: string | null): PageView {
  return value === "campaigns" || value === "agendas" ? value : "engagement";
}
function bestPlatform(result: EngagementResultGroup) {
  return [...result.platforms].sort((a, b) => b.engagements - a.engagements || b.posts - a.posts)[0];
}

export function EngagementPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [subscriptionResults, setSubscriptionResults] = useState<SubscriptionResult[]>([]);
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [webhookOpen, setWebhookOpen] = useState(false);
  const [selectedResult, setSelectedResult] = useState<EngagementResultGroup | null>(null);
  const [view, setView] = useState<PageView>(() => pageView(searchParams.get("view")));
  const [platform, setPlatform] = useState("");
  const [search, setSearch] = useState("");
  const [postStatus, setPostStatus] = useState<RecordStatus>("active");
  const [engagementStatus, setEngagementStatus] = useState<RecordStatus>("active");
  const [engagementKind, setEngagementKind] = useState<EngagementKind>("");
  const canRefresh = hasPermission(user, "marketing.publish.now");
  const canManage = hasPermission(user, "marketing.publish.now");
  const canManageWebhook = hasPermission(user, "marketing.connections.manage");
  const canDeleteCustomer = hasPermission(user, "crm.customer.delete");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const payload = await marketingFetch<Payload>(`/api/marketing${marketingQuery({ resource: "engagement" })}`);
      setData(payload);
      if (!subscriptionResults.length && payload.webhook.subscriptionResults?.length) setSubscriptionResults(payload.webhook.subscriptionResults);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل تفاعل النشر");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const nextView = pageView(searchParams.get("view"));
    if (nextView !== view) setView(nextView);
  }, [searchParams, view]);
  useEffect(() => {
    const sourceId = String(searchParams.get("sourceId") || "").trim();
    const sourceType = String(searchParams.get("sourceType") || "").trim();
    if (!sourceId || !data || selectedResult) return;
    const collection = sourceType === "agenda" ? data.results.agendas : data.results.campaigns;
    const found = collection.find((item) => item.sourceId === sourceId);
    if (found) setSelectedResult(found);
  }, [data, searchParams, selectedResult]);

  const rows = useMemo(() => (data?.rows || []).filter((row: any) => {
    const haystack = `${row.source_name || ""} ${row.creative_name || ""} ${row.task_name || ""} ${row.assigned_name || ""}`.toLowerCase();
    return (!platform || row.platform === platform)
      && recordMatchesStatus(row, postStatus)
      && (!search || haystack.includes(search.toLowerCase()));
  }), [data, platform, postStatus, search]);

  const engagements = useMemo(() => (data?.engagements || []).filter((row: any) => {
    const haystack = `${row.actor_name || ""} ${row.customer_name || ""} ${row.event_text || ""} ${row.campaign_name || ""} ${row.creative_name || ""} ${row.crm_source_name || ""}`.toLowerCase();
    return (!platform || row.platform === platform)
      && (!engagementKind || row.engagement_type === engagementKind)
      && recordMatchesStatus(row, engagementStatus)
      && (!search || haystack.includes(search.toLowerCase()));
  }), [data, engagementKind, engagementStatus, platform, search]);

  const resultRows = useMemo(() => {
    const collection = view === "campaigns" ? data?.results.campaigns || [] : view === "agendas" ? data?.results.agendas || [] : [];
    const needle = search.trim().toLowerCase();
    return collection.filter((result) => {
      const matchesSearch = !needle || `${result.name} ${result.code} ${result.bestCreative?.name || ""}`.toLowerCase().includes(needle);
      const matchesPlatform = !platform || result.platforms.some((item) => item.platform === platform && item.posts > 0);
      return matchesSearch && matchesPlatform;
    });
  }, [data, platform, search, view]);

  const resultSummary = useMemo(() => resultRows.reduce((total, result) => ({
    sources: total.sources + 1,
    posts: total.posts + result.summary.posts,
    engagements: total.engagements + result.summary.engagements,
    crmLeads: total.crmLeads + result.summary.crmLeads,
    soldLeads: total.soldLeads + result.summary.soldLeads,
  }), { sources: 0, posts: 0, engagements: 0, crmLeads: 0, soldLeads: 0 }), [resultRows]);

  function changeView(next: PageView) {
    setView(next);
    setSelectedResult(null);
    const params = new URLSearchParams();
    if (next !== "engagement") params.set("view", next);
    setSearchParams(params, { replace: true });
  }

  function closeResult() {
    setSelectedResult(null);
    const params = new URLSearchParams();
    if (view !== "engagement") params.set("view", view);
    setSearchParams(params, { replace: true });
  }

  async function refresh() {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const result = await marketingFetch<{ updated: number; failed: number }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "refresh_engagement" }),
      });
      setMessage(`تم تحديث ${count(result.updated)} منشور${result.failed ? `، وتعذر تحديث ${count(result.failed)} منشور` : ""}`);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحديث التفاعل");
    } finally {
      setLoading(false);
    }
  }

  async function subscribe() {
    setLoading(true);
    setError("");
    setMessage("");
    setSubscriptionResults([]);
    try {
      const result = await marketingFetch<{ message: string; subscriptionOk: boolean; results: SubscriptionResult[] }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "subscribe_engagement_webhooks" }),
      });
      setSubscriptionResults(Array.isArray(result.results) ? result.results : []);
      setSubscriptionOpen(true);
      if (result.subscriptionOk) setMessage(result.message); else setError(result.message);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تفعيل استقبال التفاعلات");
    } finally {
      setLoading(false);
    }
  }

  async function manage(entity: ManageEntity, operation: ManageOperation, row: any) {
    const labels: Record<ManageOperation, string> = {
      archive: "أرشفة",
      restore: "استعادة",
      delete: "مسح",
      delete_customer: "مسح العميل من CRM",
    };
    const target = entity === "post" ? "المنشور" : operation === "delete_customer" ? "العميل وسجل تفاعلاته" : "التفاعل";
    if ((operation === "delete" || operation === "delete_customer") && !window.confirm(`تأكيد ${labels[operation]} ${target}؟`)) return;
    const key = `${entity}:${row.id}:${operation}`;
    setBusyKey(key);
    setError("");
    setMessage("");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "manage_engagement_item", entity, operation, id: row.id }),
      });
      setMessage(result.message || `تم ${labels[operation]} ${target}`);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : `تعذر ${labels[operation]} ${target}`);
    } finally {
      setBusyKey("");
    }
  }

  const summary = data?.summary || EMPTY_SUMMARY;
  const callbackUrl = data ? new URL(data.webhook.callbackUrl, window.location.origin).toString() : "";

  return <MarketingPage
    title="تفاعل النشر"
    description="متابعة المنشورات والتفاعلات ونتائج الحملات والأجندات وتحويل الحسابات المتاحة تلقائيًا إلى عملاء CRM."
    actions={<div className="marketing-engagement-actions">
      {canManageWebhook ? <button type="button" className="secondary-button" disabled={loading} onClick={subscribe}><ChatCircleDots size={18} /> تفعيل استقبال التفاعلات</button> : null}
      {data ? <button type="button" className="secondary-button" onClick={() => setSubscriptionOpen(true)}><CheckCircle size={18} /> حالة استقبال التفاعلات</button> : null}
      {data ? <button type="button" className="secondary-button" onClick={() => setWebhookOpen(true)}><LinkSimple size={18} /> رابط Webhook</button> : null}
      {canRefresh ? <button type="button" className="primary-button" disabled={loading} onClick={refresh}><ArrowClockwise size={18} className={loading ? "spin" : ""} /> تحديث الأرقام الآن</button> : null}
    </div>}
  >
    <div className="marketing-engagement-shell">
      {error ? <MarketingAlert>{error}</MarketingAlert> : null}
      {message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}

      <div className="marketing-engagement-view-tabs" role="tablist" aria-label="أقسام تفاعل النشر">
        <button type="button" className={view === "engagement" ? "active" : ""} onClick={() => changeView("engagement")}>تفاعل النشر</button>
        <button type="button" className={view === "campaigns" ? "active" : ""} onClick={() => changeView("campaigns")}>نتائج الحملات</button>
        <button type="button" className={view === "agendas" ? "active" : ""} onClick={() => changeView("agendas")}>نتائج الأجندات</button>
      </div>

      {view === "engagement" ? <>
        <section className="marketing-engagement-stats">
          <article><LinkSimple size={24} /><span>المنشورات النشطة</span><strong>{count(summary.posts)}</strong><small>منشورات السيستم فقط</small></article>
          <article><Heart size={24} /><span>إجمالي الإعجابات</span><strong>{count(summary.likes)}</strong><small>{count(summary.likeEvents)} تفاعل بهوية متاحة</small></article>
          <article><ChatCircleDots size={24} /><span>إجمالي التعليقات</span><strong>{count(summary.comments)}</strong><small>{count(summary.commentEvents)} تعليق وصل للسيستم</small></article>
          <article><ShareNetwork size={24} /><span>إجمالي المشاركات</span><strong>{count(summary.shares)}</strong><small>{count(summary.shareEvents)} مشاركة بهوية متاحة</small></article>
          <article><UsersThree size={24} /><span>عملاء CRM</span><strong>{count(summary.crmLeads)}</strong><small>من {count(summary.engagements)} تفاعل مسجل</small></article>
        </section>

        <section className="panel marketing-engagement-panel marketing-posts-panel">
          <header>
            <div><h3>المنشورات المنشورة من السيستم</h3><p>آخر مزامنة وأرقام التفاعل لكل منشور مع إجراءات الأرشفة والمسح.</p></div>
            <div className="marketing-segmented" aria-label="فلتر حالة المنشورات">
              <button type="button" className={postStatus === "active" ? "active" : ""} onClick={() => setPostStatus("active")}>النشطة</button>
              <button type="button" className={postStatus === "archived" ? "active" : ""} onClick={() => setPostStatus("archived")}>الأرشيف</button>
              <button type="button" className={postStatus === "all" ? "active" : ""} onClick={() => setPostStatus("all")}>الكل</button>
            </div>
          </header>
          <div className="marketing-engagement-control-panel">
            <div className="marketing-engagement-search"><MagnifyingGlass size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث بالحملة، الكرييتيف، العميل أو نص التعليق" /></div>
            <label><span>المنصة</span><select value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="">كل المنصات</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="snapchat">Snapchat</option></select></label>
            <div className="marketing-engagement-filter-note"><strong>مصدر نتائج موحد</strong><small>البحث والمنصة والحالة ونوع التفاعل تعمل على نفس بيانات الحملات والأجندات.</small></div>
          </div>
          <div className="marketing-engagement-table-wrap"><table className="marketing-engagement-table"><thead><tr><th>المنصة</th><th>الحملة / الأجندة</th><th>الكرييتيف</th><th>تاريخ النشر</th><th>لايك</th><th>كومنت</th><th>مشاركة</th><th>الوصول</th><th>المزامنة</th><th>المنشور</th><th>إجراء</th></tr></thead><tbody>
            {rows.map((row: any) => <tr key={row.id} className={row.archived_at ? "is-archived" : ""}>
              <td><span className={`marketing-platform-chip ${row.platform}`}>{platformIcon(row.platform, 17)}{platformLabel(row.platform)}</span></td>
              <td><b>{row.source_name}</b><small>{row.task_name}</small></td>
              <td>{row.creative_name}</td>
              <td>{marketingDate(row.published_at, true)}</td>
              <td>{count(row.likes_count)}</td><td>{count(row.comments_count)}</td><td>{count(row.shares_count)}</td><td>{count(row.reach_count)}</td>
              <td><span className={`marketing-sync-status ${row.sync_status}`}>{row.sync_status === "synced" ? "محدث" : row.sync_status === "failed" ? "فشل" : "بانتظار التحديث"}</span>{row.sync_error ? <details className="marketing-error-compact"><summary>عرض سبب الفشل</summary><p>{row.sync_error}</p></details> : null}</td>
              <td>{row.permalink ? <a className="secondary-button small" href={row.permalink} target="_blank" rel="noreferrer"><LinkSimple size={15} /> فتح</a> : "—"}</td>
              <td>{canManage ? <details className="marketing-action-menu"><summary aria-label="إجراءات المنشور"><DotsThreeVertical size={20} weight="bold" /></summary><div>
                {row.archived_at
                  ? <button type="button" disabled={Boolean(busyKey)} onClick={() => void manage("post", "restore", row)}><ArrowCounterClockwise size={16} /> استعادة</button>
                  : <button type="button" disabled={Boolean(busyKey)} onClick={() => void manage("post", "archive", row)}><Archive size={16} /> أرشفة</button>}
                <button type="button" className="danger" disabled={Boolean(busyKey)} onClick={() => void manage("post", "delete", row)}><Trash size={16} /> مسح</button>
              </div></details> : "—"}</td>
            </tr>)}
            {!rows.length ? <tr><td colSpan={11} className="empty-cell">{loading ? "جاري التحميل..." : postStatus === "archived" ? "لا توجد منشورات في الأرشيف" : "لا توجد منشورات مطابقة"}</td></tr> : null}
          </tbody></table></div>
        </section>

        <section className="panel marketing-engagement-panel marketing-interactions-panel">
          <header>
            <div><h3>التفاعلات والعملاء</h3><p>سجل موحد للتعليقات والإعجابات والمشاركات ونتيجة تحويل كل حساب إلى CRM.</p></div>
            <div className="marketing-engagement-section-filters">
              <select value={engagementKind} onChange={(event) => setEngagementKind(event.target.value as EngagementKind)}><option value="">كل التفاعلات</option><option value="comment">التعليقات</option><option value="like">الإعجابات</option><option value="share">المشاركات</option></select>
              <div className="marketing-segmented" aria-label="فلتر حالة التفاعلات"><button type="button" className={engagementStatus === "active" ? "active" : ""} onClick={() => setEngagementStatus("active")}>النشطة</button><button type="button" className={engagementStatus === "archived" ? "active" : ""} onClick={() => setEngagementStatus("archived")}>الأرشيف</button><button type="button" className={engagementStatus === "all" ? "active" : ""} onClick={() => setEngagementStatus("all")}>الكل</button></div>
            </div>
          </header>
          <div className="marketing-engagement-feed">
            {engagements.map((item: any) => <article key={item.id} className={item.archived_at ? "is-archived" : ""}>
              <div className={`marketing-engagement-event-icon ${item.platform} ${item.engagement_type}`}>
                {item.engagement_type === "comment" ? <ChatCircleDots size={22} weight="fill" /> : item.engagement_type === "like" ? <Heart size={22} weight="fill" /> : <ShareNetwork size={22} weight="fill" />}
              </div>
              <div className="marketing-engagement-event-main">
                <header><div><b>{item.actor_name || item.customer_name || "حساب غير معروف"}</b><span className={`marketing-engagement-type ${item.engagement_type}`}>{engagementLabel(item.engagement_type)}</span><span className={`marketing-platform-mini ${item.platform}`}>{platformIcon(item.platform, 13)}{platformLabel(item.platform)}</span></div><time>{marketingDate(item.engaged_at || item.created_at, true)}</time></header>
                <p>{item.event_text || (item.engagement_type === "like" ? "سجل إعجابًا بالمنشور" : item.engagement_type === "share" ? "شارك المنشور" : "تعليق بدون نص")}</p>
                <footer><span>{item.campaign_name} — {item.creative_name}</span><strong>{sourceLabel(item.platform)}</strong></footer>
              </div>
              <div className="marketing-engagement-crm-card">
                <span className={`marketing-sync-status ${item.processing_status === "failed" ? "failed" : item.processing_status === "pending" ? "pending" : "synced"}`}>{processingLabel(item.processing_status)}</span>
                {item.crm_lead_id ? <><b>{item.customer_name || item.actor_name}</b><small>{item.crm_source_name || sourceLabel(item.platform)}</small><small>{item.branch_code || "جارٍ التوزيع"} — {item.assigned_name || "غير موزع"}</small></> : null}
                {item.processing_error ? <details className="marketing-error-compact"><summary>سبب فشل التحويل</summary><p>{item.processing_error}</p></details> : null}
              </div>
              <div className="marketing-engagement-row-action">{canManage ? <details className="marketing-action-menu"><summary aria-label="إجراءات التفاعل"><DotsThreeVertical size={20} weight="bold" /></summary><div>
                {item.archived_at
                  ? <button type="button" disabled={Boolean(busyKey)} onClick={() => void manage("engagement", "restore", item)}><ArrowCounterClockwise size={16} /> استعادة</button>
                  : <button type="button" disabled={Boolean(busyKey)} onClick={() => void manage("engagement", "archive", item)}><Archive size={16} /> أرشفة</button>}
                <button type="button" className="danger" disabled={Boolean(busyKey)} onClick={() => void manage("engagement", "delete", item)}><Trash size={16} /> مسح التفاعل</button>
                {canDeleteCustomer && item.crm_lead_id && item.processing_status === "created" && !item.crm_is_deleted ? <button type="button" className="danger" disabled={Boolean(busyKey)} onClick={() => void manage("engagement", "delete_customer", item)}><Trash size={16} /> مسح العميل من CRM</button> : null}
              </div></details> : null}</div>
            </article>)}
            {!engagements.length ? <div className="empty-cell">{loading ? "جاري التحميل..." : engagementStatus === "archived" ? "لا توجد تفاعلات في الأرشيف" : "لم تصل تفاعلات مطابقة بعد"}</div> : null}
          </div>
        </section>
      </> : <>
        <section className="marketing-engagement-stats marketing-result-summary-stats">
          <article><LinkSimple size={24} /><span>{view === "campaigns" ? "الحملات" : "الأجندات"}</span><strong>{marketingResultCount(resultSummary.sources)}</strong><small>بها منشورات أو نتائج محفوظة</small></article>
          <article><LinkSimple size={24} /><span>إجمالي المنشورات</span><strong>{marketingResultCount(resultSummary.posts)}</strong><small>كل المنصات</small></article>
          <article><Heart size={24} /><span>إجمالي التفاعلات</span><strong>{marketingResultCount(resultSummary.engagements)}</strong><small>إعجابات + تعليقات + مشاركات</small></article>
          <article><UsersThree size={24} /><span>عملاء CRM</span><strong>{marketingResultCount(resultSummary.crmLeads)}</strong><small>عملاء مختلفون</small></article>
          <article><CheckCircle size={24} /><span>تم البيع</span><strong>{marketingResultCount(resultSummary.soldLeads)}</strong><small>حسب الحالة الحالية في CRM</small></article>
        </section>

        <section className="panel marketing-engagement-panel marketing-results-panel">
          <header><div><h3>{view === "campaigns" ? "نتائج الحملات" : "نتائج الأجندات"}</h3><p>تجميع موحد لنتائج Facebook وInstagram وتجهيز TikTok وSnapchat من نفس مصدر البيانات.</p></div></header>
          <div className="marketing-engagement-control-panel marketing-results-control-panel">
            <div className="marketing-engagement-search"><MagnifyingGlass size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`بحث باسم ${view === "campaigns" ? "الحملة" : "الأجندة"} أو الكود أو الكرييتيف`} /></div>
            <label><span>المنصة</span><select value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="">كل المنصات</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="snapchat">Snapchat</option></select></label>
            <div className="marketing-engagement-filter-note"><strong>أرقام موحدة</strong><small>نفس النتائج تظهر داخل قاعدة البيانات بدون حسابات منفصلة أو تكرار.</small></div>
          </div>
          <div className="marketing-result-list-wrap"><table className="marketing-result-list-table"><thead><tr><th>{view === "campaigns" ? "الحملة" : "الأجندة"}</th><th>الفترة</th><th>المنشورات</th><th>المشاهدات</th><th>التفاعلات</th><th>عملاء CRM</th><th>تم البيع</th><th>أفضل منصة</th><th>أفضل كرييتيف</th><th>التفاصيل</th></tr></thead><tbody>
            {resultRows.map((result) => {
              const topPlatform = bestPlatform(result);
              return <tr key={`${result.sourceType}-${result.sourceId}`}>
                <td><b>{result.name}</b><small>{result.code || (result.sourceType === "agenda" ? "أجندة" : "حملة")}</small></td>
                <td>{marketingDate(result.publishStart)} — {marketingDate(result.publishEnd)}</td>
                <td>{marketingResultCount(result.summary.posts)}</td>
                <td>{marketingResultCount(result.summary.views)}</td>
                <td>{marketingResultCount(result.summary.engagements)}</td>
                <td>{marketingResultCount(result.summary.crmLeads)}</td>
                <td>{marketingResultCount(result.summary.soldLeads)}</td>
                <td>{topPlatform?.posts ? <span className={`marketing-result-platform-chip ${topPlatform.platform}`}>{marketingResultPlatformLabel(topPlatform.platform)}</span> : "—"}</td>
                <td>{result.bestCreative?.name || "—"}</td>
                <td><button type="button" className="table-action" onClick={() => setSelectedResult(result)}>عرض النتائج</button></td>
              </tr>;
            })}
            {!resultRows.length ? <tr><td colSpan={10}><div className="marketing-database-empty">{loading ? "جاري تحميل النتائج..." : "لا توجد نتائج مطابقة."}</div></td></tr> : null}
          </tbody></table></div>
        </section>
      </>}
    </div>

    <Modal
      open={Boolean(selectedResult)}
      title={selectedResult ? `${selectedResult.sourceType === "agenda" ? "نتائج الأجندة" : "نتائج الحملة"} — ${selectedResult.name}` : "نتائج النشر والتفاعل"}
      subtitle={selectedResult?.code || undefined}
      onClose={closeResult}
      className="marketing-result-modal"
    >
      <EngagementResultDetail result={selectedResult} />
    </Modal>

    <Modal
      open={subscriptionOpen}
      title="حالة استقبال التفاعلات من Meta"
      subtitle="نتيجة مستقلة لكل منصة مع بيانات التحقق دون تغيير مسار Facebook العامل."
      onClose={() => setSubscriptionOpen(false)}
      className="marketing-engagement-status-modal"
    >
      <section className="marketing-subscription-results marketing-subscription-results-modal">
        {subscriptionResults.length ? <div>{subscriptionResults.map((item: SubscriptionResult) => <article key={item.platform} className={item.ok ? "success" : "failed"}>
          <span>{item.ok ? <CheckCircle size={24} weight="fill" /> : <XCircle size={24} weight="fill" />}</span>
          <div>
            <header><strong>{platformLabel(item.platform)} — {item.field || (item.platform === "facebook" ? "feed" : "comments")}</strong><b>{item.ok ? "جاهز" : "يحتاج مراجعة"}</b></header>
            <p>{item.ok ? item.note || `تم التحقق من الاشتراك${item.accountName ? ` للحساب ${item.accountName}` : ""}.` : item.error || "لم ترجع Meta سببًا واضحًا"}</p>
            <dl>
              {item.accountId ? <><dt>معرف الحساب</dt><dd>{item.accountId}</dd></> : null}
              {item.linkedPageId ? <><dt>الصفحة المرتبطة</dt><dd>{item.linkedPageId}</dd></> : null}
              {item.host ? <><dt>مسار التحقق</dt><dd>{item.host === "instagram" ? "graph.instagram.com" : "graph.facebook.com"}{item.endpoint || ""}</dd></> : null}
              {item.subscribedFields?.length ? <><dt>الحقول المفعلة</dt><dd>{item.subscribedFields.join(", ")}</dd></> : null}
              {item.missingScopes?.length ? <><dt>صلاحيات ناقصة</dt><dd>{item.missingScopes.join(", ")}</dd></> : null}
              {item.errorDetails?.code ? <><dt>Meta Error Code</dt><dd>{item.errorDetails.code}{item.errorDetails.subcode ? ` / ${item.errorDetails.subcode}` : ""}</dd></> : null}
              {item.errorDetails?.type ? <><dt>نوع الخطأ</dt><dd>{item.errorDetails.type}</dd></> : null}
              {item.errorDetails?.traceId ? <><dt>Trace ID</dt><dd>{item.errorDetails.traceId}</dd></> : null}
            </dl>
          </div>
        </article>)}</div> : <div className="empty-cell">لم يتم تشغيل التحقق من اشتراكات Meta بعد.</div>}
      </section>
    </Modal>

    <Modal
      open={webhookOpen}
      title="رابط Webhook"
      subtitle="بيانات ربط استقبال التفاعلات من Meta."
      onClose={() => setWebhookOpen(false)}
      className="marketing-webhook-modal"
    >
      <div className="marketing-webhook-card marketing-webhook-modal-content">
        {data && !data.webhook.verifyTokenConfigured ? <MarketingAlert type="info">أضف META_WEBHOOK_VERIFY_TOKEN في Vercel قبل ربط Callback التفاعلات.</MarketingAlert> : null}
        <code>{callbackUrl}</code>
        <p>ضع الرابط في Meta App، واستخدم نفس قيمة META_WEBHOOK_VERIFY_TOKEN. استقبال Instagram يتطلب تفعيل حقل comments داخل Webhooks الخاص بـInstagram.</p>
      </div>
    </Modal>
  </MarketingPage>;
}
