import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, ArrowSquareOut, LinkSimple, Plugs, WarningCircle } from "@phosphor-icons/react";
import { useSearchParams } from "react-router-dom";
import { marketingFetch, marketingPost } from "../api";
import {
  MarketingAlert,
  MarketingEmpty,
  MarketingLoading,
  MarketingModal,
  MarketingPageHeader,
  StatusBadge,
  formatDate,
} from "../components/Ui";

type PlatformRow = {
  id: string;
  code: string;
  name: string;
  icon?: string;
  capability_state?: string;
  status: string;
  mode: string;
  account_name?: string;
  profile_id?: string;
  scopes?: string[];
  expires_at?: string;
  last_refreshed_at?: string;
  last_error?: string;
  has_published_jobs?: boolean;
};

type PublishJobRow = {
  id: string;
  status: string;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  published_url?: string | null;
  error_message?: string | null;
  platform_code: string;
  platform_name: string;
  post_type_name?: string | null;
  campaign_code: string;
  campaign_name: string;
  creative_name: string;
  requested_by_name?: string | null;
};

type PublishJobStats = {
  total: number;
  published: number;
  failed: number;
  blocked: number;
  publishing: number;
};

type AccountOption = {
  id: string;
  name: string;
  category?: string | null;
  instagram?: { id: string; username?: string | null; name?: string | null } | null;
};

type PlatformsPayload = {
  rows: PlatformRow[];
  recentJobs: PublishJobRow[];
  jobStats: PublishJobStats;
  canManage: boolean;
};

const emptyJobStats: PublishJobStats = { total: 0, published: 0, failed: 0, blocked: 0, publishing: 0 };

export function PlatformsPage() {
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<PlatformRow[]>([]);
  const [recentJobs, setRecentJobs] = useState<PublishJobRow[]>([]);
  const [jobStats, setJobStats] = useState<PublishJobStats>(emptyJobStats);
  const [jobPlatform, setJobPlatform] = useState("");
  const [jobStatus, setJobStatus] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountModal, setAccountModal] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const payload = await marketingFetch<PlatformsPayload>("/api/marketing?resource=platforms");
      setRows(payload.rows);
      setRecentJobs(payload.recentJobs || []);
      setJobStats(payload.jobStats || emptyJobStats);
      setCanManage(payload.canManage);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل ربط المنصات");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const success = params.get("oauth_success");
    const oauthError = params.get("oauth_error");
    if (success) {
      setMessage(success === "meta" ? "تم ربط Meta. اختر صفحة Facebook إذا كان الحساب يدير أكثر من صفحة." : "تم ربط YouTube بنجاح.");
    }
    if (oauthError) setError(oauthError);
    if (success || oauthError) {
      const next = new URLSearchParams(params);
      next.delete("oauth_success");
      next.delete("oauth_error");
      next.delete("accounts");
      next.delete("account");
      setParams(next, { replace: true });
      void load();
    }
  }, [params, setParams]);

  async function action(platform: PlatformRow, actionName: string) {
    setBusy(platform.code);
    setError("");
    setMessage("");
    try {
      const result = await marketingPost<{ message: string; redirectUrl?: string }>({ action: actionName, platformCode: platform.code });
      if (result.redirectUrl) window.location.assign(result.redirectUrl);
      else {
        setMessage(result.message);
        await load();
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تنفيذ الإجراء");
    } finally {
      setBusy("");
    }
  }

  async function openAccounts() {
    setBusy("facebook");
    setError("");
    setAccounts([]);
    setSelectedAccount("");
    try {
      const result = await marketingPost<{ rows: AccountOption[] }>({ action: "list_platform_accounts", platformCode: "facebook" });
      setAccounts(result.rows);
      setSelectedAccount(result.rows[0]?.id || "");
      setAccountModal(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل صفحات Meta");
    } finally {
      setBusy("");
    }
  }

  async function saveAccount() {
    if (!selectedAccount) return;
    setBusy("facebook");
    setError("");
    try {
      const result = await marketingPost<{ message: string }>({ action: "select_platform_account", platformCode: "facebook", accountId: selectedAccount });
      setMessage(result.message);
      setAccountModal(false);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر حفظ صفحة Meta");
    } finally {
      setBusy("");
    }
  }

  const metaNeedsSelection = useMemo(
    () => rows.some((row) => ["facebook", "instagram"].includes(row.code) && row.status === "account_selection_required"),
    [rows],
  );

  const visibleJobs = useMemo(
    () => recentJobs.filter((job) => (!jobPlatform || job.platform_code === jobPlatform) && (!jobStatus || job.status === jobStatus)),
    [recentJobs, jobPlatform, jobStatus],
  );

  return (
    <div className="marketing-page">
      <MarketingPageHeader
        title="ربط المنصات"
        description="OAuth مركزي، حالة الحسابات والـCapabilities الفعلية، وسجل محاولات النشر بدون كشف أي توكن."
        actions={<button className="marketing-button" onClick={() => void load()}><ArrowClockwise />تحديث الحالة</button>}
      />

      {error ? <MarketingAlert>{error}</MarketingAlert> : null}
      {message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}
      {metaNeedsSelection && canManage ? (
        <MarketingAlert type="info">
          تمت مصادقة Meta، لكن يجب اختيار صفحة Facebook التي سيستخدمها النشر.
          <button className="marketing-button secondary small" onClick={() => void openAccounts()}>اختيار الصفحة</button>
        </MarketingAlert>
      ) : null}

      <section className="marketing-stats-grid">
        <article className="marketing-stat"><div><small>إجمالي محاولات النشر</small><strong>{jobStats.total}</strong></div></article>
        <article className="marketing-stat"><div><small>تم النشر</small><strong>{jobStats.published}</strong></div></article>
        <article className="marketing-stat"><div><small>فشل</small><strong>{jobStats.failed}</strong></div></article>
        <article className="marketing-stat"><div><small>محجوب / قيد التنفيذ</small><strong>{jobStats.blocked + jobStats.publishing}</strong></div></article>
      </section>

      {loading ? <MarketingLoading /> : !rows.length ? <MarketingEmpty title="لا توجد منصات مفعلة" /> : (
        <div className="marketing-grid-3">
          {rows.map((row) => {
            const externalBlocked = ["waiting_allowlist", "sandbox_under_review", "disabled"].includes(row.status)
              || ["waiting_allowlist", "sandbox_under_review", "disabled"].includes(row.capability_state || "");
            const connected = row.status === "connected";
            return (
              <article className="marketing-platform-card" key={row.id}>
                <div className="head">
                  <div><span style={{ fontSize: 24 }}>{row.icon || "●"}</span><h3>{row.name}</h3></div>
                  <StatusBadge status={row.status} type="publish" />
                </div>
                <div className="marketing-review-kv">
                  <div><small>الوضع</small><strong>{row.mode || "production"}</strong></div>
                  <div><small>الحساب</small><strong>{row.account_name || "غير محدد"}</strong></div>
                  <div><small>Profile/Channel</small><strong>{row.profile_id || "—"}</strong></div>
                  <div><small>انتهاء التوكن</small><strong>{formatDate(row.expires_at, true)}</strong></div>
                  <div><small>آخر Refresh</small><strong>{formatDate(row.last_refreshed_at, true)}</strong></div>
                  <div><small>نشر ناجح سابق</small><strong>{row.has_published_jobs ? "نعم" : "لا"}</strong></div>
                </div>
                <div className="capabilities">
                  {(row.scopes || []).map((scope) => <span key={scope}>{scope}</span>)}
                  {row.capability_state ? <span>{row.capability_state}</span> : null}
                </div>
                {row.last_error ? <MarketingAlert><WarningCircle />{row.last_error}</MarketingAlert> : null}
                {externalBlocked ? (
                  <MarketingAlert type="info">
                    {row.code === "snapchat"
                      ? "بانتظار موافقة Public Profile API Allowlist."
                      : row.code === "tiktok"
                        ? "TikTok في وضع Sandbox/Review؛ لا يوجد نشر مباشر أو Draft Upload معتمد حاليًا."
                        : "الميزة معطلة حسب الـCapability الحالية."}
                  </MarketingAlert>
                ) : null}
                <div className="marketing-table-actions">
                  {canManage && connected ? (
                    <button className="marketing-button danger" disabled={busy === row.code} onClick={() => void action(row, "disconnect_platform")}><Plugs />فصل</button>
                  ) : null}
                  {canManage && row.status === "account_selection_required" && row.code === "facebook" ? (
                    <button className="marketing-button secondary" disabled={busy === "facebook"} onClick={() => void openAccounts()}>اختيار الصفحة</button>
                  ) : null}
                  {canManage && !connected && row.status !== "account_selection_required" ? (
                    <button className="marketing-button primary" disabled={busy === row.code || externalBlocked} onClick={() => void action(row, "begin_platform_oauth")}>
                      <LinkSimple />{row.code === "whatsapp" ? "تحقق من مرسال" : "ربط الحساب"}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <section className="marketing-panel">
        <div className="marketing-panel-head">
          <div><h2>سجل النشر</h2><p>آخر محاولات النشر الفعلية لكل منصة، ونتيجة كل Job بدون إظهار الاستجابة الحساسة أو التوكنات.</p></div>
        </div>
        <div className="marketing-toolbar">
          <label className="marketing-field"><span>المنصة</span><select value={jobPlatform} onChange={(event) => setJobPlatform(event.target.value)}><option value="">كل المنصات</option>{rows.map((row) => <option key={row.id} value={row.code}>{row.name}</option>)}</select></label>
          <label className="marketing-field"><span>الحالة</span><select value={jobStatus} onChange={(event) => setJobStatus(event.target.value)}><option value="">كل الحالات</option>{["publishing", "published", "failed", "blocked", "waiting_user_completion"].map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
        </div>
        {!visibleJobs.length ? <MarketingEmpty title="لا توجد محاولات نشر مطابقة" /> : (
          <div className="marketing-table-wrap">
            <table className="marketing-table">
              <thead><tr><th>الوقت</th><th>المنصة</th><th>الحملة</th><th>الكرييتيف</th><th>نوع النشر</th><th>بواسطة</th><th>الحالة</th><th>النتيجة</th></tr></thead>
              <tbody>
                {visibleJobs.map((job) => (
                  <tr key={job.id}>
                    <td>{formatDate(job.created_at, true)}</td>
                    <td><b>{job.platform_name}</b></td>
                    <td>{job.campaign_code}<br /><small>{job.campaign_name}</small></td>
                    <td>{job.creative_name}</td>
                    <td>{job.post_type_name || "—"}</td>
                    <td>{job.requested_by_name || "النشر التلقائي"}</td>
                    <td><StatusBadge status={job.status} type="publish" /></td>
                    <td>{job.published_url ? <a className="marketing-button small" href={job.published_url} target="_blank" rel="noreferrer"><ArrowSquareOut />فتح</a> : job.error_message ? <span className="marketing-error-text">{job.error_message}</span> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <MarketingModal
        open={accountModal}
        title="اختيار صفحة Facebook"
        subtitle="سيتم استخدام Page Access Token للنشر، وسيتم ربط Instagram Business المرتبط بنفس الصفحة."
        onClose={() => setAccountModal(false)}
        footer={(
          <>
            <button className="marketing-button" onClick={() => setAccountModal(false)}>إلغاء</button>
            <button className="marketing-button primary" disabled={!selectedAccount || busy === "facebook"} onClick={() => void saveAccount()}>حفظ الحساب</button>
          </>
        )}
      >
        {!accounts.length ? (
          <MarketingEmpty title="لا توجد صفحات Facebook متاحة" description="تأكد أن الحساب يدير صفحة ومنح صلاحيات الصفحات المطلوبة." />
        ) : (
          <div className="marketing-stack">
            {accounts.map((account) => (
              <label className={`marketing-settings-item ${selectedAccount === account.id ? "selected" : ""}`} key={account.id}>
                <input type="radio" name="meta-page" value={account.id} checked={selectedAccount === account.id} onChange={() => setSelectedAccount(account.id)} />
                <span>
                  <strong>{account.name}</strong>
                  <small style={{ display: "block" }}>{account.category || "Facebook Page"}{account.instagram ? ` · Instagram: @${account.instagram.username || account.instagram.name || account.instagram.id}` : " · لا يوجد Instagram Business مرتبط"}</small>
                </span>
              </label>
            ))}
          </div>
        )}
      </MarketingModal>
    </div>
  );
}
