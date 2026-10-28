import { useEffect, useMemo, useState } from "react";
import {
  ChatCircleDots,
  CheckCircle,
  Eye,
  Heart,
  LinkSimple,
  ShareNetwork,
  Trophy,
  UsersThree,
} from "@phosphor-icons/react";
import { marketingDate } from "../api";
import {
  marketingResultCount,
  marketingResultPercent,
  marketingResultPlatformLabel,
  type EngagementPlatformResult,
  type EngagementPostResult,
  type EngagementResultGroup,
  type MarketingResultPlatform,
} from "../engagementResults";

type ResultTab = "overview" | MarketingResultPlatform | "crm";

type Props = {
  result: EngagementResultGroup | null | undefined;
  initialTab?: ResultTab;
  platforms?: readonly MarketingResultPlatform[];
};

const DEFAULT_RESULT_PLATFORMS: readonly MarketingResultPlatform[] = ["facebook", "instagram", "youtube", "tiktok", "snapchat"];

function syncLabel(status: string) {
  if (status === "synced") return "محدث";
  if (status === "failed") return "فشل التحديث";
  if (status === "pending") return "بانتظار التحديث";
  return "لا توجد مزامنة";
}

function platformEmptyMessage(platform: MarketingResultPlatform) {
  if (platform === "tiktok") return "نتائج TikTok مجهزة داخل التقرير، وهي الآن في انتظار ربط نتائج TikTok وستظهر هنا تلقائيًا بعد اكتمال الربط.";
  if (platform === "snapchat") return "نتائج Snapchat مجهزة داخل التقرير، وهي الآن في انتظار ربط نتائج Snapchat وستظهر هنا تلقائيًا بعد اكتمال الربط.";
  if (platform === "youtube") return "نتائج YouTube مجهزة داخل التقرير، وستظهر هنا تلقائيًا عند توفر فيديوهات منشورة وبيانات التفاعل.";
  return `لا توجد منشورات منشورة من السيستم على ${marketingResultPlatformLabel(platform)} لهذه الحملة أو الأجندة.`;
}

function ResultKpis({ metrics }: { metrics: EngagementResultGroup["summary"] | EngagementPlatformResult }) {
  return <div className="marketing-result-kpis">
    <article><LinkSimple size={21} /><span>المنشورات</span><strong>{marketingResultCount(metrics.posts)}</strong></article>
    <article><Eye size={21} /><span>المشاهدات</span><strong>{marketingResultCount(metrics.views)}</strong></article>
    <article><Heart size={21} /><span>الإعجابات</span><strong>{marketingResultCount(metrics.likes)}</strong></article>
    <article><ChatCircleDots size={21} /><span>التعليقات</span><strong>{marketingResultCount(metrics.comments)}</strong></article>
    <article><ShareNetwork size={21} /><span>المشاركات</span><strong>{marketingResultCount(metrics.shares)}</strong></article>
    <article><UsersThree size={21} /><span>عملاء CRM</span><strong>{marketingResultCount(metrics.crmLeads)}</strong></article>
    <article><CheckCircle size={21} /><span>تم البيع</span><strong>{marketingResultCount(metrics.soldLeads)}</strong><small>{marketingResultCount(metrics.soldQuantity)} سيارة</small></article>
  </div>;
}

function PostsTable({ posts }: { posts: EngagementPostResult[] }) {
  return <div className="marketing-result-table-wrap">
    <table className="marketing-result-posts-table">
      <thead><tr><th>المنصة</th><th>الكرييتيف</th><th>تاريخ النشر</th><th>المشاهدات</th><th>الإعجابات</th><th>التعليقات</th><th>المشاركات</th><th>عملاء CRM</th><th>تم البيع</th><th>المزامنة</th><th>المنشور</th></tr></thead>
      <tbody>
        {posts.map((post) => <tr key={post.id}>
          <td><span className={`marketing-result-platform-chip ${post.platform}`}>{marketingResultPlatformLabel(post.platform)}</span></td>
          <td><b>{post.creativeName || "—"}</b><small>{post.postTypeName || "—"}</small></td>
          <td>{marketingDate(post.publishedAt, true)}</td>
          <td>{marketingResultCount(post.views)}</td>
          <td>{marketingResultCount(post.likes)}</td>
          <td>{marketingResultCount(post.comments)}</td>
          <td>{marketingResultCount(post.shares)}</td>
          <td>{marketingResultCount(post.crmLeads)}</td>
          <td>{marketingResultCount(post.soldLeads)}</td>
          <td><span className={`marketing-sync-status ${post.syncStatus}`}>{syncLabel(post.syncStatus)}</span></td>
          <td>{post.permalink ? <a className="secondary-button small" href={post.permalink} target="_blank" rel="noreferrer"><LinkSimple size={15} />فتح</a> : "—"}</td>
        </tr>)}
        {!posts.length ? <tr><td colSpan={11}><div className="marketing-database-empty compact">لا توجد منشورات لعرضها.</div></td></tr> : null}
      </tbody>
    </table>
  </div>;
}

function PlatformSection({ platform, posts }: { platform: EngagementPlatformResult; posts: EngagementPostResult[] }) {
  if (!posts.length) return <div className="marketing-result-platform-empty">
    <span className={`marketing-result-platform-mark ${platform.platform}`}>{marketingResultPlatformLabel(platform.platform).slice(0, 2)}</span>
    <div><h4>{marketingResultPlatformLabel(platform.platform)}</h4><p>{platformEmptyMessage(platform.platform)}</p></div>
  </div>;
  return <div className="marketing-result-platform-section">
    <div className="marketing-result-platform-heading">
      <div><span className={`marketing-result-platform-mark ${platform.platform}`}>{marketingResultPlatformLabel(platform.platform).slice(0, 2)}</span><div><h4>نتائج {marketingResultPlatformLabel(platform.platform)}</h4><p>{marketingResultCount(posts.length)} منشور داخل الحملة أو الأجندة.</p></div></div>
      <span className={`marketing-sync-status ${platform.syncStatus}`}>{syncLabel(platform.syncStatus)}</span>
    </div>
    <ResultKpis metrics={platform} />
    <PostsTable posts={posts} />
  </div>;
}

export function EngagementResultDetail({ result, initialTab = "overview", platforms = DEFAULT_RESULT_PLATFORMS }: Props) {
  const [tab, setTab] = useState<ResultTab>(initialTab);
  useEffect(() => { setTab(initialTab); }, [initialTab, result?.sourceId]);

  const displayedPlatforms = useMemo(
    () => platforms.map((platform) => result?.platforms.find((item) => item.platform === platform) || ({
      platform,
      connected: false,
      connectionStatus: "",
      dataStatus: "pending_integration",
      syncStatus: "waiting",
      posts: 0, likes: 0, comments: 0, shares: 0, saves: 0, views: 0, reach: 0, engagements: 0,
      identifiedEngagements: 0, commentEvents: 0, likeEvents: 0, shareEvents: 0, identifiedAccounts: 0,
      crmLeads: 0, soldLeads: 0, soldQuantity: 0, crmConversionRate: 0, salesConversionRate: 0, lastSyncedAt: null,
    } as EngagementPlatformResult)),
    [platforms, result],
  );
  const selectedPlatform = useMemo(
    () => displayedPlatforms.find((item) => item.platform === tab),
    [displayedPlatforms, tab],
  );
  const selectedPosts = useMemo(
    () => result?.posts.filter((item) => item.platform === tab) || [],
    [result, tab],
  );

  if (!result) return <div className="marketing-database-empty">لا توجد بيانات نتائج لهذه الحملة أو الأجندة.</div>;

  return <div className="marketing-result-detail">
    <div className="marketing-result-heading">
      <div><span>{result.sourceType === "agenda" ? "نتائج الأجندة" : "نتائج الحملة"}</span><h3>{result.name}</h3><p>{result.code || "بدون كود"} • {marketingDate(result.publishStart)} — {marketingDate(result.publishEnd)}</p></div>
      <div><small>آخر مزامنة</small><strong>{marketingDate(result.summary.lastSyncedAt, true)}</strong></div>
    </div>

    <div className="marketing-result-tabs" role="tablist" aria-label="أقسام نتائج النشر والتفاعل">
      <button type="button" className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>نظرة عامة</button>
      {platforms.map((platform) => <button type="button" key={platform} className={tab === platform ? `active ${platform}` : platform} onClick={() => setTab(platform)}>{marketingResultPlatformLabel(platform)}</button>)}
      <button type="button" className={tab === "crm" ? "active" : ""} onClick={() => setTab("crm")}>عملاء CRM والمبيعات</button>
    </div>

    {tab === "overview" ? <div className="marketing-result-overview">
      <ResultKpis metrics={result.summary} />
      <div className="marketing-result-platform-grid">
        {displayedPlatforms.map((platform) => <button type="button" key={platform.platform} className={`marketing-result-platform-card ${platform.platform}`} onClick={() => setTab(platform.platform)}>
          <header><span className={`marketing-result-platform-mark ${platform.platform}`}>{marketingResultPlatformLabel(platform.platform).slice(0, 2)}</span><div><strong>{marketingResultPlatformLabel(platform.platform)}</strong><small>{platform.posts ? `${marketingResultCount(platform.posts)} منشور` : platform.dataStatus === "pending_integration" ? "في انتظار ربط النتائج" : "لا توجد منشورات"}</small></div></header>
          <div><span>التفاعلات <b>{marketingResultCount(platform.engagements)}</b></span><span>عملاء CRM <b>{marketingResultCount(platform.crmLeads)}</b></span><span>تم البيع <b>{marketingResultCount(platform.soldLeads)}</b></span></div>
        </button>)}
      </div>
      <div className="marketing-result-best-grid">
        <article><Trophy size={24} /><div><small>أفضل منشور</small><strong>{result.bestPost ? `${marketingResultPlatformLabel(result.bestPost.platform)} — ${result.bestPost.creativeName}` : "لا توجد بيانات كافية"}</strong><span>{result.bestPost ? `${marketingResultCount(result.bestPost.engagements)} تفاعل` : "—"}</span></div></article>
        <article><Trophy size={24} /><div><small>أفضل كرييتيف</small><strong>{result.bestCreative?.name || "لا توجد بيانات كافية"}</strong><span>{result.bestCreative ? `${marketingResultCount(result.bestCreative.engagements)} تفاعل من ${marketingResultCount(result.bestCreative.posts)} منشور` : "—"}</span></div></article>
      </div>
      <section className="marketing-result-section"><div className="marketing-result-section-title"><div><h4>كل المنشورات ونتائجها</h4><p>الأرقام موحدة من نفس مصدر البيانات المستخدم في صفحة تفاعل النشر.</p></div><strong>{marketingResultCount(result.posts.length)} منشور</strong></div><PostsTable posts={result.posts} /></section>
    </div> : null}

    {selectedPlatform ? <PlatformSection platform={selectedPlatform} posts={selectedPosts} /> : null}

    {tab === "crm" ? <div className="marketing-result-crm-section">
      <div className="marketing-result-crm-kpis">
        <article><span>أصحاب التعليقات الذين تم التعرف عليهم</span><strong>{marketingResultCount(result.summary.identifiedAccounts)}</strong></article>
        <article><span>عملاء CRM المختلفون</span><strong>{marketingResultCount(result.summary.crmLeads)}</strong></article>
        <article><span>نسبة التحويل إلى CRM</span><strong>{marketingResultPercent(result.summary.crmConversionRate)}</strong></article>
        <article><span>العملاء الذين وصلوا تم البيع</span><strong>{marketingResultCount(result.summary.soldLeads)}</strong></article>
        <article><span>إجمالي عدد المباع</span><strong>{marketingResultCount(result.summary.soldQuantity)}</strong></article>
        <article><span>نسبة التحويل إلى بيع</span><strong>{marketingResultPercent(result.summary.salesConversionRate)}</strong></article>
      </div>
      <div className="marketing-result-note"><strong>طريقة الحساب</strong><p>العميل يُحسب مرة واحدة داخل الحملة أو الأجندة حتى لو كتب أكثر من تعليق. الإعجابات والمشاركات أرقام مجمعة فقط ولا تنشئ عميل CRM، وحالة البيع تُقرأ مباشرة من حالة العميل الحالية داخل CRM.</p></div>
      <section className="marketing-result-section"><div className="marketing-result-section-title"><div><h4>نتيجة كل منشور داخل CRM</h4><p>يوضح عدد العملاء والمبيعات الناتجة عن كل منشور.</p></div></div><PostsTable posts={result.posts.filter((post) => post.crmLeads > 0 || post.soldLeads > 0)} /></section>
    </div> : null}
  </div>;
}
