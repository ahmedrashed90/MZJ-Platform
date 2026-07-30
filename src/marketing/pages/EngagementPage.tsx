import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, ChatCircleDots, FacebookLogo, InstagramLogo, LinkSimple, ThumbsUp, UsersThree } from "@phosphor-icons/react";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../systemAccess";
import { marketingDate, marketingFetch, marketingQuery } from "../api";
import { MarketingAlert, MarketingPage } from "../components/MarketingPage";

type Payload = {
  rows: any[];
  comments: any[];
  summary: { posts: number; likes: number; comments: number; shares: number; saves: number; views: number; reach: number; crmLeads: number };
  webhook: { callbackUrl: string; verifyTokenConfigured: boolean };
};

function count(value: unknown) { return Number(value || 0).toLocaleString("ar-SA"); }
function platformLabel(platform: string) { return platform === "facebook" ? "Facebook" : "Instagram"; }

export function EngagementPage() {
  const { user } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [platform, setPlatform] = useState("");
  const [search, setSearch] = useState("");
  const canRefresh = hasPermission(user, "marketing.publish.now");
  const canManageWebhook = hasPermission(user, "marketing.connections.manage");

  async function load() {
    setLoading(true); setError("");
    try { setData(await marketingFetch<Payload>(`/api/marketing${marketingQuery({ resource: "engagement" })}`)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل تفاعل النشر"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const rows = useMemo(() => (data?.rows || []).filter((row) => {
    const haystack = `${row.source_name || ""} ${row.creative_name || ""} ${row.task_name || ""} ${row.assigned_name || ""}`.toLowerCase();
    return (!platform || row.platform === platform) && (!search || haystack.includes(search.toLowerCase()));
  }), [data, platform, search]);

  async function refresh() {
    setLoading(true); setError(""); setMessage("");
    try {
      const result = await marketingFetch<{ updated: number; failed: number }>("/api/marketing", { method: "POST", body: JSON.stringify({ action: "refresh_engagement" }) });
      setMessage(`تم تحديث ${count(result.updated)} منشور${result.failed ? `، وتعذر تحديث ${count(result.failed)} منشور` : ""}`);
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحديث التفاعل"); }
    finally { setLoading(false); }
  }

  async function subscribe() {
    setLoading(true); setError(""); setMessage("");
    try {
      const result = await marketingFetch<{ message: string; results: any[] }>("/api/marketing", { method: "POST", body: JSON.stringify({ action: "subscribe_engagement_webhooks" }) });
      const failed = (result.results || []).filter((item) => !item.ok);
      setMessage(failed.length ? `${result.message}: ${failed.map((item) => `${platformLabel(item.platform)} — ${item.error}`).join(" | ")}` : result.message);
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تفعيل استقبال التعليقات"); }
    finally { setLoading(false); }
  }

  const summary = data?.summary || { posts: 0, likes: 0, comments: 0, shares: 0, saves: 0, views: 0, reach: 0, crmLeads: 0 };
  const callbackUrl = data ? new URL(data.webhook.callbackUrl, window.location.origin).toString() : "";
  return <MarketingPage title="تفاعل النشر" description="متابعة منشورات Facebook وInstagram وتحويل أي تعليق خارجي تلقائيًا إلى عميل جديد داخل مبيعات الكاش."
    actions={<div className="marketing-engagement-actions">
      {canManageWebhook ? <button type="button" className="secondary-button" disabled={loading} onClick={subscribe}><ChatCircleDots size={18} /> تفعيل استقبال التعليقات</button> : null}
      {canRefresh ? <button type="button" className="primary-button" disabled={loading} onClick={refresh}><ArrowClockwise size={18} className={loading ? "spin" : ""} /> تحديث التفاعل الآن</button> : null}
    </div>}>
    {error ? <MarketingAlert>{error}</MarketingAlert> : null}
    {message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}
    {data && !data.webhook.verifyTokenConfigured ? <MarketingAlert type="info">أضف META_WEBHOOK_VERIFY_TOKEN في Vercel قبل ربط Callback التعليقات.</MarketingAlert> : null}

    <section className="marketing-engagement-stats">
      <article><LinkSimple size={24} /><span>المنشورات</span><strong>{count(summary.posts)}</strong></article>
      <article><ThumbsUp size={24} /><span>الإعجابات</span><strong>{count(summary.likes)}</strong></article>
      <article><ChatCircleDots size={24} /><span>التعليقات</span><strong>{count(summary.comments)}</strong></article>
      <article><UsersThree size={24} /><span>عملاء CRM من التعليقات</span><strong>{count(summary.crmLeads)}</strong></article>
    </section>

    <section className="panel marketing-engagement-panel">
      <header><div><h3>المنشورات المنشورة من السيستم</h3><p>آخر مزامنة وأرقام التفاعل لكل منشور.</p></div>
        <div className="marketing-engagement-filters"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث بالحملة أو الكرييتيف" /><select value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="">كل المنصات</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option></select></div>
      </header>
      <div className="marketing-engagement-table-wrap"><table className="marketing-engagement-table"><thead><tr><th>المنصة</th><th>الحملة / الأجندة</th><th>الكرييتيف</th><th>تاريخ النشر</th><th>لايك</th><th>كومنت</th><th>مشاركة</th><th>الوصول</th><th>الحالة</th><th>المنشور</th></tr></thead><tbody>
        {rows.map((row) => <tr key={row.id}><td><span className={`marketing-platform-chip ${row.platform}`}>{row.platform === "facebook" ? <FacebookLogo size={17} weight="fill" /> : <InstagramLogo size={17} weight="fill" />}{platformLabel(row.platform)}</span></td><td><b>{row.source_name}</b><small>{row.task_name}</small></td><td>{row.creative_name}</td><td>{marketingDate(row.published_at, true)}</td><td>{count(row.likes_count)}</td><td>{count(row.comments_count)}</td><td>{count(row.shares_count)}</td><td>{count(row.reach_count)}</td><td><span className={`marketing-sync-status ${row.sync_status}`}>{row.sync_status === "synced" ? "محدث" : row.sync_status === "failed" ? "فشل" : "بانتظار التحديث"}</span>{row.sync_error ? <small className="marketing-sync-error">{row.sync_error}</small> : null}</td><td>{row.permalink ? <a className="secondary-button small" href={row.permalink} target="_blank" rel="noreferrer"><LinkSimple size={15} /> فتح</a> : "—"}</td></tr>)}
        {!rows.length ? <tr><td colSpan={10} className="empty-cell">{loading ? "جاري التحميل..." : "لا توجد منشورات منشورة مسجلة بعد"}</td></tr> : null}
      </tbody></table></div>
    </section>

    <section className="panel marketing-engagement-panel">
      <header><div><h3>التعليقات والعملاء</h3><p>كل تعليق خارجي، ونتيجة تحويله إلى CRM.</p></div></header>
      <div className="marketing-comments-list">{(data?.comments || []).map((comment) => <article key={comment.id}>
        <div className="marketing-comment-avatar">{comment.platform === "facebook" ? <FacebookLogo size={22} weight="fill" /> : <InstagramLogo size={22} weight="fill" />}</div>
        <div className="marketing-comment-main"><header><b>{comment.commenter_name || "حساب غير معروف"}</b><span>{marketingDate(comment.commented_at || comment.created_at, true)}</span></header><p>{comment.comment_text || "تعليق بدون نص"}</p><small>{comment.campaign_name} — {comment.creative_name}</small></div>
        <div className="marketing-comment-crm"><span className={`marketing-sync-status ${comment.processing_status === "failed" ? "failed" : "synced"}`}>{comment.processing_status === "created" ? "عميل جديد" : comment.processing_status === "reused" ? "عميل موجود" : comment.processing_status === "failed" ? "فشل التحويل" : comment.processing_status}</span>{comment.crm_lead_id ? <><b>{comment.customer_name}</b><small>{comment.crm_source_name || (comment.platform === "facebook" ? "بوست فيس بوك" : "بوست انستجرام")} — {comment.branch_code || "جارٍ التوزيع"} — {comment.assigned_name || "غير موزع"}</small></> : null}{comment.processing_error ? <small className="marketing-sync-error">{comment.processing_error}</small> : null}</div>
      </article>)}{!(data?.comments || []).length ? <div className="empty-cell">لم تصل تعليقات بعد</div> : null}</div>
    </section>

    {data ? <section className="panel marketing-webhook-card"><h3>رابط Webhook</h3><code>{callbackUrl}</code><p>ضع هذا الرابط في Meta App للاشتراك في تعليقات Facebook وInstagram، واستخدم نفس قيمة META_WEBHOOK_VERIFY_TOKEN.</p></section> : null}
  </MarketingPage>;
}
