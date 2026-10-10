import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
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
  ChartLineUp,
  TiktokLogo,
  Trash,
  UsersThree,
  YoutubeLogo,
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

type MetaAccount = {
  platform: 'facebook' | 'instagram';
  accountId: string;
  accountName: string;
  connected: boolean;
  followers: number | null;
  discoveredCount: number;
  fans: number | null;
  mediaCount: number | null;
  dailyChange: number | null;
  monthlyChange: number | null;
  snapshots: Array<{ date: string; followers: number }>;
  state: {
    backfill_complete: boolean;
    last_recent_at: string | null;
    last_backfill_at: string | null;
    last_success_at: string | null;
    last_error: string | null;
  } | null;
};

type Payload = {
  rows: any[];
  accounts: MetaAccount[];
  engagements: any[];
  comments: any[];
  summary: EngagementSummary;
  results: EngagementResultsPayload;
  webhook: { callbackUrl: string; verifyTokenConfigured: boolean; subscriptionResults?: SubscriptionResult[] };
};

type RecordStatus = "active" | "archived" | "all";
type ManageEntity = "post" | "engagement";
type ManageOperation = "archive" | "restore" | "delete" | "delete_customer";
type PageView = "engagement" | "accounts" | "campaigns" | "agendas";
type PostOrigin = "all" | "system" | "meta";

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
function optionalCount(value: unknown) { return value === null || value === undefined ? "—" : count(value); }
function followerChange(value: number | null) { return value === null ? "لا توجد مقارنة بعد" : `${value > 0 ? "+" : ""}${count(value)}`; }
function platformLabel(platform: string) { return marketingResultPlatformLabel(platform); }
function sourceLabel(platform: string) {
  if (platform === "facebook") return "بوست فيس بوك";
  if (platform === "instagram") return "بوست انستجرام";
  if (platform === "youtube") return "فيديو YouTube";
  if (platform === "tiktok") return "منشور TikTok";
  if (platform === "snapchat") return "منشور Snapchat";
  return marketingResultSourceLabel(platform);
}
function platformIcon(platform: string, size: number) {
  if (platform === "facebook") return <FacebookLogo size={size} weight="fill" />;
  if (platform === "instagram") return <InstagramLogo size={size} weight="fill" />;
  if (platform === "youtube") return <YoutubeLogo size={size} weight="fill" />;
  if (platform === "tiktok") return <TiktokLogo size={size} weight="fill" />;
  return null;
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
  return value === "campaigns" || value === "agendas" || value === "accounts" ? value : "engagement";
}
function bestPlatform(result: EngagementResultGroup) {
  return [...result.platforms].sort((a, b) => b.engagements - a.engagements || b.posts - a.posts)[0];
}

export function EngagementPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<Payload | null>(null);
  const loadingRequest = useRef(false);
  const [loading, setLoading] = useState(false);
  const openedAutoRefresh = useRef(false);
  const mountedPage = useRef(false);
  const [autoRefreshStatus, setAutoRefreshStatus] = useState<"idle" | "loading" | "updated" | "pending" | "failed">("idle");
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
  const [postOrigin, setPostOrigin] = useState<PostOrigin>("all");
  const [engagementStatus, setEngagementStatus] = useState<RecordStatus>("active");
  const canRefresh = hasPermission(user, "marketing.engagement.refresh");
  const canManage = hasPermission(user, "marketing.publish.now");
  const canSubscribeWebhook = hasPermission(user, "marketing.engagement.subscribe");
  const canViewWebhookStatus = hasPermission(user, "marketing.engagement.status.view");
  const canViewWebhookUrl = hasPermission(user, "marketing.engagement.webhook.view");
  const canDeleteCustomer = hasPermission(user, "crm.customer.delete");

  async function load(silent = false) {
    if (loadingRequest.current) return;
    loadingRequest.current = true;
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      // Read our stored snapshot only; polling never triggers requests to Meta.
      const payload = await marketingFetch<Payload>(`/api/marketing${marketingQuery({ resource: "engagement" })}`);
      setData(payload);
      if (!subscriptionResults.length && payload.webhook.subscriptionResults?.length) setSubscriptionResults(payload.webhook.subscriptionResults);
    } catch (failure) {
      if (!silent) setError(failure instanceof Error ? failure.message : "تعذر تحميل تفاعل النشر");
    } finally {
      loadingRequest.current = false;
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Updates appear while this page stays open, without clicking Refresh.
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    mountedPage.current = true;
    return () => { mountedPage.current = false; };
  }, []);
  const dataAvailable = data !== null;
  useEffect(() => {
    // Show stored counts immediately, then refresh recent Facebook/Instagram
    // figures once when the engagement page opens. Never wait for the archive
    // import or make requests to Meta on the one-minute cached-data poll.
    if (!dataAvailable || view !== "engagement" || !canRefresh || openedAutoRefresh.current) return;
    openedAutoRefresh.current = true;
    setAutoRefreshStatus("loading");
    void (async () => {
      try {
        const result = await marketingFetch<{ updated: number; failed: number; skipped?: boolean }>("/api/marketing", {
          method: "POST", body: JSON.stringify({ action: "refresh_meta_engagement_metrics", automatic: true }),
        });
        if (!mountedPage.current) return;
        setAutoRefreshStatus(result.skipped ? "pending" : result.failed && !result.updated ? "failed" : "updated");
        if (!result.skipped) await load(true);
      } catch {
        // Keep the saved counters available if Meta is slow or unavailable.
        if (mountedPage.current) setAutoRefreshStatus("failed");
      }
    })();
  }, [dataAvailable, view, canRefresh]);
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
    const haystack = `${row.source_name || ""} ${row.creative_name || ""} ${row.task_name || ""} ${row.assigned_name || ""} ${row.caption || ""} ${row.permalink || ""}`.toLowerCase();
    return (!platform || row.platform === platform)
      && (postOrigin === "all" || row.publication_origin === postOrigin)
      && recordMatchesStatus(row, postStatus)
      && (!search || haystack.includes(search.toLowerCase()));
  }), [data, platform, postOrigin, postStatus, search]);

  const engagements = useMemo(() => (data?.engagements || []).filter((row: any) => {
    const haystack = `${row.actor_name || ""} ${row.customer_name || ""} ${row.event_text || ""} ${row.campaign_name || ""} ${row.creative_name || ""} ${row.crm_source_name || ""}`.toLowerCase();
    return (!platform || row.platform === platform)
      && recordMatchesStatus(row, engagementStatus)
      && (!search || haystack.includes(search.toLowerCase()));
  }), [data, engagementStatus, platform, search]);

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
      // Refreshing published/system posts does not update posts imported from
      // Meta. Both requests use their own safe paths and existing permission.
      const [system, meta] = await Promise.allSettled([
        marketingFetch<{ updated: number; failed: number }>("/api/marketing", {
          method: "POST", body: JSON.stringify({ action: "refresh_engagement" }),
        }),
        marketingFetch<{ updated: number; failed: number; deferred?: boolean }>("/api/marketing", {
          method: "POST", body: JSON.stringify({ action: "refresh_meta_engagement_metrics" }),
        }),
      ]);
      if (system.status === "rejected" && meta.status === "rejected") {
        throw new Error("تعذر تحديث تفاعل النشر من السيستم وMeta");
      }
      const systemUpdated = system.status === "fulfilled" ? system.value.updated : 0;
      const metaUpdated = meta.status === "fulfilled" ? meta.value.updated : 0;
      setMessage(`تم تحديث ${count(systemUpdated)} منشور من السيستم و${count(metaUpdated)} منشور حديث من Meta`);
      if (system.status === "rejected" || meta.status === "rejected" ||
          (system.status === "fulfilled" && system.value.failed) ||
          (meta.status === "fulfilled" && meta.value.failed)) {
        setError("بعض المنشورات تعذر تحديثها؛ يمكنك تحديث أي منشور من Meta مباشرة من زر تحديث في صفه.");
      }
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحديث التفاعل");
    } finally {
      setLoading(false);
    }
  }

  async function refreshMetaPost(row: any) {
    const key = `meta-refresh:${row.id}`;
    setBusyKey(key);
    setError("");
    setMessage("");
    try {
      const response = await marketingFetch<{
        updated: number; failed: number; results: Array<{ id?: string; likes?: number | null; comments?: number | null; error?: string }>;
      }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "refresh_meta_engagement_metrics", ids: [row.id] }),
      });
      const result = response.results.find((item) => item.id === row.id);
      if (!response.updated || response.failed || result?.error) {
        throw new Error(result?.error || "تعذر قراءة أرقام التفاعل من Meta");
      }
      setMessage(`تمت قراءة تفاعل المنشور من Meta: ${optionalCount(result?.likes)} لايك، ${optionalCount(result?.comments)} تعليق`);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحديث المنشور من Meta");
    } finally {
      setBusyKey("");
    }
  }

  async function syncMeta() {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await marketingFetch<{
        imported: number;
        skipped?: boolean;
        deferred?: boolean;
        accounts: Array<{ platform: string; error?: string; followersError?: string; backfillComplete: boolean }>;
      }>("/api/marketing", { method: "POST", body: JSON.stringify({ action: "sync_meta_engagement" }) });
      if (response.skipped) {
        setMessage("المزامنة التلقائية تعمل بالفعل؛ ستظهر البيانات عند انتهاء الدفعة الجارية.");
        await load();
        return;
      }
      const failures = response.accounts.filter((account) => account.error || account.followersError);
      const unfinished = response.accounts.filter((account) => !account.backfillComplete);
      setMessage(`تمت معالجة ${count(response.imported)} منشور من Meta${response.deferred || unfinished.length ? "؛ جارٍ استكمال المنشورات التاريخية تلقائيًا" : "؛ اكتمل سحب الأرشيف المتاح"}`);
      if (!response.accounts.length && !response.deferred) setError("لا يوجد حساب Facebook أو Instagram متصل بالمنصة");
      else if (failures.length) setError(failures.map((account) => `${platformLabel(account.platform)}: ${account.error || account.followersError}`).join(" — "));
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذرت مزامنة حسابات Meta");
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
      setError(failure instanceof Error ? failure.message : "تعذر تفعيل استقبال التعليقات");
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
    const target = entity === "post" ? "المنشور" : operation === "delete_customer" ? "العميل وسجل تعليقاته" : "التعليق";
    if ((operation === "delete" || operation === "delete_customer") && !window.confirm(`تأكيد ${labels[operation]} ${target}؟`)) return;
    const key = `${entity}:${row.id}:${operation}`;
    setBusyKey(key);
    setError("");
    setMessage("");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "manage_engagement_item", entity, operation, id: row.id, publicationOrigin: row.publication_origin }),
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
    description="متابعة منشورات السيستم وMeta مباشرة، وتحليلات الحسابات والمتابعين. تحويل التعليقات إلى CRM يظل مرتبطًا بمنشورات السيستم فقط."
    actions={<div className="marketing-engagement-actions">
      {canSubscribeWebhook ? <button type="button" className="secondary-button" disabled={loading} onClick={subscribe}><ChatCircleDots size={18} /> تفعيل استقبال التعليقات</button> : null}
      {data && canViewWebhookStatus ? <button type="button" className="secondary-button" onClick={() => setSubscriptionOpen(true)}><CheckCircle size={18} /> حالة استقبال التعليقات</button> : null}
      {data && canViewWebhookUrl ? <button type="button" className="secondary-button" onClick={() => setWebhookOpen(true)}><LinkSimple size={18} /> رابط Webhook</button> : null}
      {canRefresh ? <button type="button" className="secondary-button" disabled={loading} onClick={syncMeta}><ArrowClockwise size={18} className={loading ? "spin" : ""} /> مزامنة Meta والأرشيف</button> : null}
      {canRefresh ? <button type="button" className="primary-button" disabled={loading} onClick={refresh}><ArrowClockwise size={18} className={loading ? "spin" : ""} /> تحديث الأرقام الآن</button> : null}
    </div>}
  >
    <div className="marketing-engagement-shell">
      {error ? <MarketingAlert>{error}</MarketingAlert> : null}
      {message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}

      <div className="marketing-engagement-view-tabs" role="tablist" aria-label="أقسام تفاعل النشر">
        <button type="button" className={view === "engagement" ? "active" : ""} onClick={() => changeView("engagement")}>تفاعل النشر</button>
        <button type="button" className={view === "accounts" ? "active" : ""} onClick={() => changeView("accounts")}>الحسابات والمتابعون</button>
        <button type="button" className={view === "campaigns" ? "active" : ""} onClick={() => changeView("campaigns")}>نتائج الحملات</button>
        <button type="button" className={view === "agendas" ? "active" : ""} onClick={() => changeView("agendas")}>نتائج الأجندات</button>
      </div>

      {view === "engagement" ? <>
        <section className="marketing-engagement-stats">
          <article><LinkSimple size={24} /><span>المنشورات النشطة</span><strong>{count(summary.posts)}</strong><small>من السيستم وMeta بدون تكرار</small></article>
          <article><Heart size={24} /><span>إجمالي الإعجابات</span><strong>{count(summary.likes)}</strong><small>{count(summary.likeEvents)} تفاعل Facebook محفوظ بهوية صاحبه ومربوط بالسيستم</small></article>
          <article><ChatCircleDots size={24} /><span>إجمالي التعليقات</span><strong>{count(summary.comments)}</strong><small>{count(summary.commentEvents)} تعليق محفوظ ومربوط بالسيستم</small></article>
          <article><ShareNetwork size={24} /><span>إجمالي المشاركات</span><strong>{count(summary.shares)}</strong><small>رقم مباشر من المنصة — لا ينشئ عميل CRM</small></article>
          <article><UsersThree size={24} /><span>عملاء CRM</span><strong>{count(summary.crmLeads)}</strong><small>من {count(summary.commentEvents + summary.likeEvents)} تفاعل محفوظ بهوية صاحبه</small></article>
        </section>

        <section className="panel marketing-engagement-panel marketing-posts-panel">
          <header>
            <div><h3>جميع المنشورات</h3><p>المنشورات التاريخية والجديدة من السيستم أو Meta، مع آخر مزامنة ومصدر النشر.</p>
              {canRefresh && autoRefreshStatus !== "idle" ? <small className={`marketing-meta-auto-status ${autoRefreshStatus}`} aria-live="polite">
                {autoRefreshStatus === "loading" ? <ArrowClockwise size={14} className="spin" /> : autoRefreshStatus === "updated" ? <CheckCircle size={14} /> : <ArrowClockwise size={14} />}
                {autoRefreshStatus === "loading" ? "جاري تحديث تفاعل أحدث منشورات Meta تلقائيًا..." : autoRefreshStatus === "updated" ? "تم تحديث أرقام أحدث منشورات Meta تلقائيًا" : autoRefreshStatus === "pending" ? "المزامنة المجدولة تعمل الآن؛ ستظهر الأرقام المحفوظة عند اكتمالها" : "تعذر التحديث التلقائي؛ الأرقام المحفوظة متاحة ويمكنك التحديث يدويًا"}
              </small> : null}
            </div>
            <div className="marketing-segmented" aria-label="فلتر حالة المنشورات">
              <button type="button" className={postStatus === "active" ? "active" : ""} onClick={() => setPostStatus("active")}>النشطة</button>
              <button type="button" className={postStatus === "archived" ? "active" : ""} onClick={() => setPostStatus("archived")}>الأرشيف</button>
              <button type="button" className={postStatus === "all" ? "active" : ""} onClick={() => setPostStatus("all")}>الكل</button>
            </div>
          </header>
          <div className="marketing-engagement-control-panel">
            <div className="marketing-engagement-search"><MagnifyingGlass size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث بالحملة، الكرييتيف أو محتوى المنشور" /></div>
            <label><span>المنصة</span><select value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="">كل المنصات</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="youtube">YouTube</option><option value="tiktok">TikTok</option><option value="snapchat">Snapchat</option></select></label>
            <label><span>مصدر النشر</span><select value={postOrigin} onChange={(event) => setPostOrigin(event.target.value as PostOrigin)}><option value="all">كل المنشورات</option><option value="system">نشر من السيستم</option><option value="meta">نشر من Meta</option></select></label>
            <div className="marketing-engagement-filter-note"><strong>مصدر نتائج موحد</strong><small>المحتوى الخارجي للعرض والتحليل فقط ولا ينشئ عملاء CRM، وتقارير الحملات والأجندات تظل مرتبطة بالنشر الداخلي.</small></div>
          </div>
          <div className="marketing-engagement-table-wrap"><table className="marketing-engagement-table"><thead><tr><th>المنصة</th><th>المصدر / الحملة</th><th>المحتوى / الكرييتيف</th><th>تاريخ النشر</th><th>لايك</th><th>كومنت</th><th>مشاركة</th><th>الوصول</th><th>المزامنة</th><th>المنشور</th><th>إجراء</th></tr></thead><tbody>
            {rows.map((row: any) => <tr key={row.id} className={row.archived_at ? "is-archived" : ""}>
              <td><span className={`marketing-platform-chip ${row.platform}`}>{platformIcon(row.platform, 17)}{platformLabel(row.platform)}</span></td>
              <td><b>{row.publication_origin === "meta" ? "Meta مباشرة" : row.source_name}</b><small>{row.publication_origin === "meta" ? "غير مرتبط بحملة أو أجندة" : row.task_name}</small></td>
              <td><b title={row.caption || row.creative_name} className="marketing-meta-post-caption">{row.publication_origin === "meta" ? (row.caption || "منشور بدون نص") : row.creative_name}</b><small>{row.post_type_name || "نوع النشر غير مسجل"}</small></td>
              <td>{marketingDate(row.published_at, true)}</td>
              <td>{optionalCount(row.likes_count)}</td><td>{optionalCount(row.comments_count)}</td><td>{optionalCount(row.shares_count)}</td><td>{optionalCount(row.reach_count)}</td>
              <td><span className={`marketing-sync-status ${row.sync_status}`}>{row.sync_status === "synced" ? "آخر قراءة محفوظة" : row.sync_status === "failed" ? "فشل" : "بانتظار التحديث"}</span><small className="marketing-sync-timestamp">{row.last_synced_at ? marketingDate(row.last_synced_at, true) : "لم تتم القراءة بعد"}</small>{row.sync_error ? <details className="marketing-error-compact"><summary>عرض سبب الفشل</summary><p>{row.sync_error}</p></details> : null}</td>
              <td>{row.permalink ? <a className="secondary-button small" href={row.permalink} target="_blank" rel="noreferrer"><LinkSimple size={15} /> فتح</a> : "—"}</td>
              <td><div className="marketing-post-row-actions">
                {canRefresh && row.publication_origin === "meta" ? <button type="button" className="secondary-button small" disabled={loading || Boolean(busyKey)} onClick={() => void refreshMetaPost(row)} aria-label="تحديث أرقام المنشور من Meta"><ArrowClockwise size={15} className={busyKey === `meta-refresh:${row.id}` ? "spin" : ""} /> تحديث</button> : null}
                {canManage ? <details className="marketing-action-menu"><summary aria-label="إجراءات المنشور"><DotsThreeVertical size={20} weight="bold" /></summary><div>
                  {row.archived_at
                    ? <button type="button" disabled={Boolean(busyKey)} onClick={() => void manage("post", "restore", row)}><ArrowCounterClockwise size={16} /> استعادة</button>
                    : <button type="button" disabled={Boolean(busyKey)} onClick={() => void manage("post", "archive", row)}><Archive size={16} /> أرشفة</button>}
                  <button type="button" className="danger" disabled={Boolean(busyKey)} onClick={() => void manage("post", "delete", row)}><Trash size={16} /> مسح</button>
                </div></details> : null}
                {!canManage && !(canRefresh && row.publication_origin === "meta") ? "—" : null}
              </div></td>
            </tr>)}
            {!rows.length ? <tr><td colSpan={11} className="empty-cell">{loading ? "جاري التحميل..." : postStatus === "archived" ? "لا توجد منشورات في الأرشيف" : "لا توجد منشورات مطابقة"}</td></tr> : null}
          </tbody></table></div>
        </section>

        <section className="panel marketing-engagement-panel marketing-interactions-panel">
          <header>
            <div><h3>التفاعلات والعملاء</h3><p>تعليقات Facebook وInstagram وتفاعلات Facebook التي ترسل Meta هوية صاحبها تدخل CRM وتُوزّع على مناديب مبيعات الكاش. إعجابات Instagram تبقى رقمًا مجمعًا لأن Meta لا ترسل هوية أصحابها عبر هذا الربط.</p></div>
            <div className="marketing-engagement-section-filters">
              <div className="marketing-segmented" aria-label="فلتر حالة التفاعلات"><button type="button" className={engagementStatus === "active" ? "active" : ""} onClick={() => setEngagementStatus("active")}>النشطة</button><button type="button" className={engagementStatus === "archived" ? "active" : ""} onClick={() => setEngagementStatus("archived")}>الأرشيف</button><button type="button" className={engagementStatus === "all" ? "active" : ""} onClick={() => setEngagementStatus("all")}>الكل</button></div>
            </div>
          </header>
          <div className="marketing-engagement-feed">
            {engagements.map((item: any) => {
              const isLike = item.engagement_type === "like";
              return <article key={item.id} className={item.archived_at ? "is-archived" : ""}>
              <div className={`marketing-engagement-event-icon ${item.platform} ${isLike ? "like" : "comment"}`}>
                {isLike ? <Heart size={22} weight="fill" /> : <ChatCircleDots size={22} weight="fill" />}
              </div>
              <div className="marketing-engagement-event-main">
                <header><div><b>{item.actor_name || item.customer_name || "حساب غير معروف"}</b><span className={`marketing-engagement-type ${isLike ? "like" : "comment"}`}>{isLike ? "إعجاب" : "تعليق"}</span><span className={`marketing-platform-mini ${item.platform}`}>{platformIcon(item.platform, 13)}{platformLabel(item.platform)}</span></div><time>{marketingDate(item.engaged_at || item.created_at, true)}</time></header>
                <p>{item.event_text || (isLike ? "إعجاب على المنشور" : "تعليق بدون نص")}</p>
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
            </article>;})}
            {!engagements.length ? <div className="empty-cell">{loading ? "جاري التحميل..." : engagementStatus === "archived" ? "لا توجد تفاعلات في الأرشيف" : "لم تصل تفاعلات مطابقة بعد"}</div> : null}
          </div>
        </section>
      </> : view === "accounts" ? <>
        <section className="marketing-meta-account-intro">
          <div><h3>متابعو حسابات Meta</h3><p>العدد الحالي من الحسابات المرتبطة وتاريخ النمو منذ أول مزامنة داخل السيستم؛ لا يتم اختلاق بيانات سابقة.</p></div>
          {canRefresh ? <button type="button" className="secondary-button" disabled={loading} onClick={syncMeta}><ArrowClockwise size={17} /> تحديث الحسابات والمنشورات</button> : null}
        </section>
        <div className="marketing-meta-accounts-grid">
          {(data?.accounts || []).map((account) => <article key={`${account.platform}-${account.accountId}`} className="panel marketing-meta-account-card">
            <header className="marketing-meta-account-heading">
              <span className={`marketing-platform-chip ${account.platform}`}>{platformIcon(account.platform, 20)}{platformLabel(account.platform)}</span>
              <span className={`marketing-sync-status ${account.connected ? "synced" : "pending"}`}>{account.connected ? "متصل" : "غير متصل"}</span>
            </header>
            <h4>{account.accountName || platformLabel(account.platform)}</h4>
            <div className="marketing-meta-follower-number"><strong>{optionalCount(account.followers)}</strong><small>متابع</small></div>
            <div className="marketing-meta-account-metrics">
              <div><span>من آخر قراءة محفوظة</span><strong>{followerChange(account.dailyChange)}</strong></div>
              <div><span>نمو الشهر المسجل</span><strong>{followerChange(account.monthlyChange)}</strong></div>
              <div><span>{account.platform === "facebook" ? "المعجبون بالصفحة" : "عدد المحتوى"}</span><strong>{optionalCount(account.platform === "facebook" ? account.fans : account.mediaCount)}</strong></div>
            </div>
            {account.snapshots.length > 1 ? <div className="marketing-meta-followers-chart" dir="ltr">
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={account.snapshots} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 4" vertical={false} stroke="#ebe5e0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={18} />
                  <Tooltip formatter={(value) => [count(value), "المتابعون"]} labelFormatter={(value) => `التاريخ: ${value}`} />
                  <Line type="monotone" dataKey="followers" name="المتابعون" stroke="var(--brand)" strokeWidth={2.5} dot={account.snapshots.length < 12} />
                </LineChart>
              </ResponsiveContainer>
            </div> : <div className="marketing-meta-chart-empty"><ChartLineUp size={18} /> يبدأ الرسم البياني بعد حفظ بيانات يومين مختلفين.</div>}
            <footer className="marketing-meta-account-footer">
              <span>تمت قراءة {count(account.discoveredCount)} منشور · آخر تحديث: {account.state?.last_success_at ? marketingDate(account.state.last_success_at, true) : "لم تبدأ المزامنة"}</span>
              <span>{account.state?.backfill_complete ? "اكتمل الأرشيف المتاح" : "استيراد الأرشيف جارٍ على دفعات"}</span>
            </footer>
            {account.state?.last_error ? <details className="marketing-error-compact"><summary>تنبيه المزامنة</summary><p>{account.state.last_error}</p></details> : null}
          </article>)}
          {!(data?.accounts || []).length ? <div className="panel marketing-meta-account-empty">لا توجد حسابات Meta مرتبطة حاليًا. اربط Facebook وInstagram من إعدادات منصات التسويق.</div> : null}
        </div>
        <p className="marketing-meta-account-disclaimer">تحديث المتابعين يسجل لقطة يومية للحساب، والتغيرات تُحسب من البيانات المسجلة منذ تفعيل المزامنة. قد تختلف المؤشرات المتاحة حسب نوع المنشور والمنصة.</p>
      </> : <>
        <section className="marketing-engagement-stats marketing-result-summary-stats">
          <article><LinkSimple size={24} /><span>{view === "campaigns" ? "الحملات" : "الأجندات"}</span><strong>{marketingResultCount(resultSummary.sources)}</strong><small>بها منشورات أو نتائج محفوظة</small></article>
          <article><LinkSimple size={24} /><span>إجمالي المنشورات</span><strong>{marketingResultCount(resultSummary.posts)}</strong><small>كل المنصات</small></article>
          <article><Heart size={24} /><span>إجمالي التفاعلات</span><strong>{marketingResultCount(resultSummary.engagements)}</strong><small>إعجابات + تعليقات + مشاركات</small></article>
          <article><UsersThree size={24} /><span>عملاء CRM</span><strong>{marketingResultCount(resultSummary.crmLeads)}</strong><small>عملاء مختلفون</small></article>
          <article><CheckCircle size={24} /><span>تم البيع</span><strong>{marketingResultCount(resultSummary.soldLeads)}</strong><small>حسب الحالة الحالية في CRM</small></article>
        </section>

        <section className="panel marketing-engagement-panel marketing-results-panel">
          <header><div><h3>{view === "campaigns" ? "نتائج الحملات" : "نتائج الأجندات"}</h3><p>تجميع موحد لنتائج Facebook وInstagram وYouTube وتجهيز TikTok وSnapchat من نفس مصدر البيانات.</p></div></header>
          <div className="marketing-engagement-control-panel marketing-results-control-panel">
            <div className="marketing-engagement-search"><MagnifyingGlass size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`بحث باسم ${view === "campaigns" ? "الحملة" : "الأجندة"} أو الكود أو الكرييتيف`} /></div>
            <label><span>المنصة</span><select value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="">كل المنصات</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="youtube">YouTube</option><option value="tiktok">TikTok</option><option value="snapchat">Snapchat</option></select></label>
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
      title="حالة استقبال التعليقات من Meta"
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
      subtitle="بيانات ربط استقبال التعليقات من Meta."
      onClose={() => setWebhookOpen(false)}
      className="marketing-webhook-modal"
    >
      <div className="marketing-webhook-card marketing-webhook-modal-content">
        {data && !data.webhook.verifyTokenConfigured ? <MarketingAlert type="info">أضف META_WEBHOOK_VERIFY_TOKEN في Vercel قبل ربط Callback التعليقات.</MarketingAlert> : null}
        <code>{callbackUrl}</code>
        <p>ضع الرابط في Meta App، واستخدم نفس قيمة META_WEBHOOK_VERIFY_TOKEN. استقبال Instagram يتطلب تفعيل حقل comments داخل Webhooks الخاص بـInstagram.</p>
      </div>
    </Modal>
  </MarketingPage>;
}
