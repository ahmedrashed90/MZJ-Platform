import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  CheckCircle,
  ClockCounterClockwise,
  Copy,
  FacebookLogo,
  InstagramLogo,
  LinkBreak,
  LinkSimple,
  ShieldCheck,
  SpinnerGap,
  TiktokLogo,
  UploadSimple,
  WarningCircle,
  YoutubeLogo,
} from "@phosphor-icons/react";
import { marketingDate, marketingFetch } from "../api";
import { MarketingAlert, MarketingPage } from "../components/MarketingPage";

type ProviderCode = "meta" | "tiktok" | "youtube";
type ConnectionAsset = {
  connected: boolean;
  accountName: string;
  accountId: string;
  pageName: string;
  pageId: string;
  username: string;
  igUserId: string;
  avatarUrl: string;
  lastError: string;
};
type ProviderConnection = {
  provider: ProviderCode;
  title: string;
  configured: boolean;
  missingConfiguration: string[];
  redirectUri: string;
  connected: boolean;
  status: string;
  state: string;
  accountName: string;
  accountId: string;
  secondaryName: string;
  secondaryId: string;
  avatarUrl: string;
  tokenStored: boolean;
  scopes: string[];
  tokenExpiresAtIso?: string | null;
  refreshTokenExpiresAtIso?: string | null;
  lastVerifiedAtIso?: string | null;
  connectedAtIso?: string | null;
  updatedAtIso?: string | null;
  lastError: string;
  requiresSelection: boolean;
  selectionDraftId?: string;
  availablePages: Array<{
    id: string;
    name: string;
    pictureUrl?: string;
    tasks?: string[];
    instagram?: { id?: string; username?: string; name?: string; profilePictureUrl?: string } | null;
  }>;
  assets: Record<string, ConnectionAsset | null>;
};
type ConnectionEvent = {
  id: string;
  provider: ProviderCode;
  action: string;
  status: string;
  accountName: string;
  userName: string;
  createdAtIso: string | null;
  details: Record<string, unknown>;
};
type ConnectionsPayload = { ok: true; canManage: boolean; providers: ProviderConnection[]; events: ConnectionEvent[] };
type ZohoConnectionStatus = {
  configured: boolean;
  connected: boolean;
  status: string;
  accountEmail: string;
  rootFolderId: string;
  apiDomain: string;
  uploadDomain: string;
  lastVerifiedAt?: string | null;
  lastError: string;
};

const providerLabels: Record<ProviderCode, string> = { meta: "Meta", tiktok: "TikTok", youtube: "YouTube" };
const actionLabels: Record<string, string> = {
  oauth_started: "بدء الربط",
  oauth_callback: "استجابة الربط",
  connected: "إتمام الربط",
  page_selection_required: "انتظار اختيار الصفحة",
  page_selected: "اختيار صفحة Meta",
  validated: "فحص الاتصال",
  disconnected: "فصل الربط",
  oauth_cancelled: "إلغاء الربط المعلق",
};

function statusText(provider: ProviderConnection) {
  if (!provider.configured) return "الإعداد غير مكتمل";
  if (provider.status === "action_required") return "مطلوب اختيار الصفحة";
  if (provider.status === "partial") return "Facebook متصل فقط";
  if (provider.status === "warning") return "يحتاج مراجعة";
  if (provider.status === "reauthorization_required") return "يلزم إعادة الربط";
  return provider.connected ? "متصل" : "غير متصل";
}
function statusClass(provider: ProviderConnection) {
  if (!provider.configured || provider.status === "warning" || provider.status === "reauthorization_required") return "warning";
  if (provider.status === "action_required") return "action";
  return provider.connected ? "connected" : "disconnected";
}
function formatDate(value?: string | null) { return value ? marketingDate(value, true) : "—"; }
function providerIcon(provider: ProviderCode, size = 28) {
  if (provider === "tiktok") return <TiktokLogo size={size} weight="fill" />;
  if (provider === "youtube") return <YoutubeLogo size={size} weight="fill" />;
  return <span className="marketing-meta-icons"><FacebookLogo size={size} weight="fill" /><InstagramLogo size={size} weight="fill" /></span>;
}

export function PlatformConnectionsPage() {
  const [payload, setPayload] = useState<ConnectionsPayload | null>(null);
  const [zoho, setZoho] = useState<ZohoConnectionStatus | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState<ProviderCode | "page" | "zoho" | "all" | "">("all");
  const [selectedPageId, setSelectedPageId] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await marketingFetch<ConnectionsPayload>("/api/marketing/platform-connections");
      setPayload(result);
      if (result.canManage) {
        try {
          const zohoStatus = await marketingFetch<{ ok: true } & ZohoConnectionStatus>("/api/integrations/zoho/status");
          setZoho(zohoStatus);
        } catch { setZoho(null); }
      } else setZoho(null);
      const meta = result.providers.find((item) => item.provider === "meta");
      setSelectedPageId((current) => current || (meta?.requiresSelection && meta.availablePages.length === 1 ? meta.availablePages[0].id : ""));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل ربط المنصات");
    } finally {
      setLoading("");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onOAuthMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !["mzj-platform-connection", "mzj-zoho-connection"].includes(String(event.data?.type || ""))) return;
      const status = String(event.data.status || "");
      const text = String(event.data.message || "تم تحديث الربط");
      if (status === "error") { setMessage(""); setError(text); } else { setError(""); setMessage(text); }
      setLoading("");
      void load();
    };
    window.addEventListener("message", onOAuthMessage);
    return () => window.removeEventListener("message", onOAuthMessage);
  }, [load]);

  const providers = payload?.providers || [];
  const meta = useMemo(() => providers.find((item) => item.provider === "meta"), [providers]);

  function connectZoho() {
    setError(""); setMessage(""); setLoading("zoho");
    const popup = window.open("/api/integrations/zoho/start", "mzj-oauth-zoho", "popup=yes,width=720,height=780,menubar=no,toolbar=no,location=yes,resizable=yes,scrollbars=yes");
    if (!popup) { setLoading(""); setError("المتصفح منع نافذة ربط Zoho. اسمح بالنوافذ المنبثقة ثم أعد المحاولة."); return; }
    const closeWatcher = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(closeWatcher);
      setLoading((current) => current === "zoho" ? "" : current);
      void load();
    }, 500);
  }

  async function connect(provider: ProviderCode) {
    setError(""); setMessage(""); setLoading(provider);
    const popup = window.open("about:blank", `mzj-oauth-${provider}`, "popup=yes,width=720,height=780,menubar=no,toolbar=no,location=yes,resizable=yes,scrollbars=yes");
    if (!popup) {
      setLoading("");
      setError("المتصفح منع نافذة الربط. اسمح بالنوافذ المنبثقة لهذه المنصة ثم أعد المحاولة.");
      return;
    }
    popup.document.write('<!doctype html><html lang="ar" dir="rtl"><body style="font-family:Arial;display:grid;place-items:center;min-height:90vh">جاري تجهيز الربط...</body></html>');
    popup.document.close();
    const closeWatcher = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(closeWatcher);
      setLoading((current) => current === provider ? "" : current);
    }, 500);
    try {
      const result = await marketingFetch<{ authorizationUrl: string }>("/api/marketing/platform-connections", {
        method: "POST",
        body: JSON.stringify({ action: "start_oauth", provider }),
      });
      popup.location.replace(result.authorizationUrl);
    } catch (failure) {
      window.clearInterval(closeWatcher);
      popup.close();
      setLoading("");
      setError(failure instanceof Error ? failure.message : "تعذر بدء الربط");
    }
  }

  async function validate(provider: ProviderCode) {
    setError(""); setMessage(""); setLoading(provider);
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing/platform-connections", {
        method: "POST",
        body: JSON.stringify({ action: "validate", provider }),
      });
      setMessage(result.message);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر التحقق من الربط");
      await load();
    } finally { setLoading(""); }
  }

  async function disconnect(provider: ProviderCode) {
    if (!window.confirm(`سيتم إلغاء تفويض ${providerLabels[provider]} وحذف التوكنات المشفرة من المنصة. هل تريد المتابعة؟`)) return;
    setError(""); setMessage(""); setLoading(provider);
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing/platform-connections", {
        method: "POST",
        body: JSON.stringify({ action: "disconnect", provider }),
      });
      setMessage(result.message);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر فصل الربط");
    } finally { setLoading(""); }
  }

  async function cancelPending(provider: ProviderCode) {
    setError(""); setMessage(""); setLoading("page");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing/platform-connections", {
        method: "POST",
        body: JSON.stringify({ action: "cancel_oauth_draft", provider }),
      });
      setSelectedPageId("");
      setMessage(result.message);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر إلغاء عملية الربط");
    } finally { setLoading(""); }
  }

  async function selectPage() {
    if (!selectedPageId) { setError("اختر صفحة Facebook أولًا"); return; }
    setError(""); setMessage(""); setLoading("page");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing/platform-connections", {
        method: "POST",
        body: JSON.stringify({ action: "select_meta_page", pageId: selectedPageId }),
      });
      setMessage(result.message);
      setSelectedPageId("");
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر حفظ صفحة Meta");
    } finally { setLoading(""); }
  }

  async function copyRedirect(value: string) {
    try { await navigator.clipboard.writeText(value); setMessage("تم نسخ رابط Callback"); }
    catch { setError("تعذر نسخ الرابط"); }
  }

  return (
    <MarketingPage
      title="ربط المنصات"
      description="ربط رسمي عبر OAuth. أسرار التطبيق وRefresh Token تُحفظ مشفرة داخل PostgreSQL، والمنصة هي التي ترفع الملفات إلى Zoho WorkDrive."
      actions={<button type="button" className="secondary" onClick={() => { setLoading("all"); void load(); }} disabled={loading === "all"}>{loading === "all" ? <SpinnerGap className="marketing-spin" size={17} /> : <ArrowClockwise size={17} />}تحديث الحالة</button>}
    >
      {error ? <MarketingAlert>{error}</MarketingAlert> : null}
      {message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}

      <section className="marketing-connections-summary" aria-label="ملخص حماية الربط">
        <div><ShieldCheck size={23} weight="duotone" /><span><strong>الأسرار خادمية</strong><small>Client Secret وRefresh Token لا يغادران الخادم</small></span></div>
        <div><CheckCircle size={23} weight="duotone" /><span><strong>رفع من المنصة</strong><small>الملف يرفع عبر API المنصة إلى Zoho WorkDrive دون Worker أو R2</small></span></div>
        <div><LinkBreak size={23} weight="duotone" /><span><strong>فصل حقيقي</strong><small>Revoke ثم حذف التوكنات من PostgreSQL</small></span></div>
      </section>

      {payload?.canManage ? <section className="marketing-connections-grid marketing-connections-grid-rebuilt">
        <article className={`marketing-connection-card rebuilt ${zoho?.connected ? "connected" : zoho?.configured ? "disconnected" : "warning"}`}>
          <header className="marketing-connection-card-head">
            <div className="marketing-provider-logo"><UploadSimple size={28} weight="duotone" /></div>
            <div className="marketing-provider-title"><h2>Zoho WorkDrive</h2><span className={`marketing-connection-status ${zoho?.connected ? "connected" : "disconnected"}`}>{zoho?.connected ? <CheckCircle size={15} weight="fill" /> : <WarningCircle size={15} weight="fill" />}{zoho?.connected ? "متصل" : zoho?.configured ? "غير متصل" : "الإعداد غير مكتمل"}</span></div>
          </header>
          {!zoho?.configured ? <div className="marketing-connection-config-warning"><WarningCircle size={20} /><div><strong>أكمل متغيرات Zoho</strong><p>ZOHO_CLIENT_ID • ZOHO_CLIENT_SECRET • ZOHO_PUBLISH_ROOT_FOLDER_ID</p></div></div> : null}
          <div className="marketing-connection-data rebuilt-data">
            <div><small>حساب النشر</small><strong>{zoho?.accountEmail || "marketing@mzjcars.com"}</strong></div>
            <div><small>مركز البيانات</small><strong>Zoho السعودية</strong></div>
            <div><small>آخر تحقق</small><strong>{formatDate(zoho?.lastVerifiedAt)}</strong></div>
            <div><small>فولدر النشر</small><strong dir="ltr">{zoho?.rootFolderId || "—"}</strong></div>
          </div>
          {zoho?.lastError ? <p className="marketing-connection-error"><WarningCircle size={16} />{zoho.lastError}</p> : null}
          <footer className="marketing-connection-actions"><button type="button" className="primary" onClick={connectZoho} disabled={loading === "zoho" || !zoho?.configured}>{loading === "zoho" ? <SpinnerGap className="marketing-spin" size={17} /> : <LinkSimple size={17} />}{zoho?.connected ? "إعادة ربط Zoho" : "ربط Zoho"}</button></footer>
          <div className="marketing-callback-row"><span>Callback URL</span><code dir="ltr">https://mzj-platform.vercel.app/api/integrations/zoho/callback</code><button type="button" className="secondary compact-button" onClick={() => void copyRedirect("https://mzj-platform.vercel.app/api/integrations/zoho/callback")} title="نسخ"><Copy size={15} /></button></div>
        </article>
      </section> : null}

      <div className="marketing-connections-grid marketing-connections-grid-rebuilt">
        {providers.map((provider) => {
          const busy = loading === provider.provider;
          const metaFacebook = provider.provider === "meta" ? provider.assets.facebook : null;
          const metaInstagram = provider.provider === "meta" ? provider.assets.instagram : null;
          return (
            <article key={provider.provider} className={`marketing-connection-card rebuilt ${statusClass(provider)}`}>
              <header className="marketing-connection-card-head">
                <div className={`marketing-provider-logo ${provider.provider}`}>{providerIcon(provider.provider)}</div>
                <div className="marketing-provider-title"><h2>{provider.title}</h2><span className={`marketing-connection-status ${statusClass(provider)}`}>{provider.connected ? <CheckCircle size={15} weight="fill" /> : <WarningCircle size={15} weight="fill" />}{statusText(provider)}</span></div>
              </header>

              {!provider.configured ? (
                <div className="marketing-connection-config-warning">
                  <WarningCircle size={20} />
                  <div><strong>أكمل متغيرات البيئة</strong><p>{provider.missingConfiguration.join(" • ")}</p></div>
                </div>
              ) : null}

              <div className="marketing-connection-data rebuilt-data">
                <div><small>{provider.provider === "meta" ? "حساب Meta" : provider.provider === "youtube" ? "اسم القناة" : "اسم الحساب"}</small><strong>{provider.accountName || "—"}</strong></div>
                <div><small>{provider.provider === "meta" ? "صفحة Facebook" : "معرّف الحساب"}</small><strong dir={provider.provider === "meta" ? undefined : "ltr"}>{provider.secondaryName || provider.accountId || "—"}</strong></div>
                <div><small>آخر تحقق</small><strong>{formatDate(provider.lastVerifiedAtIso)}</strong></div>
                <div><small>صلاحية التوكن</small><strong>{provider.tokenStored ? (provider.tokenExpiresAtIso ? `حتى ${formatDate(provider.tokenExpiresAtIso)}` : "محفوظ ومشفر") : "غير محفوظ"}</strong></div>
              </div>

              {provider.provider === "meta" && provider.connected ? (
                <div className="marketing-meta-assets">
                  <div className={metaFacebook?.connected ? "active" : ""}><FacebookLogo size={20} weight="fill" /><span><strong>Facebook</strong><small>{metaFacebook?.pageName || "غير مربوط"}</small></span></div>
                  <div className={metaInstagram?.connected ? "active" : "warning"}><InstagramLogo size={20} weight="fill" /><span><strong>Instagram</strong><small>{metaInstagram?.connected ? `@${metaInstagram.username || metaInstagram.accountName}` : metaInstagram?.lastError || "غير مرتبط بالصفحة"}</small></span></div>
                </div>
              ) : null}

              {provider.scopes.length ? <details className="marketing-connection-scopes"><summary>الصلاحيات الممنوحة ({provider.scopes.length})</summary><div>{provider.scopes.map((scope) => <code key={scope}>{scope}</code>)}</div></details> : null}
              {provider.lastError ? <p className="marketing-connection-error"><WarningCircle size={16} />{provider.lastError}</p> : null}

              <footer className="marketing-connection-actions">
                {payload?.canManage ? <button type="button" className="primary" onClick={() => void connect(provider.provider)} disabled={busy || !provider.configured}>{busy ? <SpinnerGap className="marketing-spin" size={17} /> : <LinkSimple size={17} />}{provider.requiresSelection ? "إعادة بدء الربط" : provider.connected || provider.status === "reauthorization_required" ? "إعادة الربط" : "ربط"}</button> : null}
                {payload?.canManage && provider.connected ? <button type="button" className="secondary" onClick={() => void validate(provider.provider)} disabled={busy}><ArrowClockwise size={17} />فحص الربط</button> : null}
                {payload?.canManage && (provider.connected || provider.tokenStored) ? <button type="button" className="danger" onClick={() => void disconnect(provider.provider)} disabled={busy}><LinkBreak size={17} />فصل الربط</button> : null}
              </footer>

              <div className="marketing-callback-row"><span>Callback URL</span><code dir="ltr">{provider.redirectUri || "غير متاح"}</code><button type="button" className="secondary compact-button" onClick={() => void copyRedirect(provider.redirectUri)} title="نسخ" disabled={!provider.redirectUri}><Copy size={15} /></button></div>
            </article>
          );
        })}
      </div>

      {meta?.requiresSelection ? (
        <section className="marketing-meta-page-selector">
          <header><div><h2>اختر صفحة Facebook لإكمال ربط Meta</h2><p>سيتم ربط حساب Instagram الاحترافي المرتبط بالصفحة المختارة تلقائيًا.</p></div><span>{meta.availablePages.length} صفحة متاحة</span></header>
          <div className="marketing-meta-page-grid">
            {meta.availablePages.map((page) => (
              <label key={page.id} className={selectedPageId === page.id ? "selected" : ""}>
                <input type="radio" name="meta-page" value={page.id} checked={selectedPageId === page.id} onChange={() => setSelectedPageId(page.id)} />
                {page.pictureUrl ? <img src={page.pictureUrl} alt="" /> : <FacebookLogo size={34} weight="duotone" />}
                <span><strong>{page.name}</strong><small dir="ltr">{page.id}</small><em>{page.instagram ? `Instagram: @${page.instagram.username || page.instagram.name || page.instagram.id}` : "لا يوجد Instagram احترافي مرتبط"}</em></span>
              </label>
            ))}
          </div>
          <footer><button type="button" className="primary" onClick={() => void selectPage()} disabled={!selectedPageId || loading === "page"}>{loading === "page" ? <SpinnerGap className="marketing-spin" size={17} /> : <ShieldCheck size={17} />}حفظ الصفحة وإكمال الربط</button><button type="button" className="danger" onClick={() => void cancelPending("meta")} disabled={loading === "page"}><LinkBreak size={17} />إلغاء عملية الربط</button></footer>
        </section>
      ) : null}

      <section className="marketing-connection-history">
        <header><div><ClockCounterClockwise size={22} /><span><h2>سجل ربط المنصات</h2><p>آخر عمليات الربط والفحص والفصل بدون تسجيل أي توكنات.</p></span></div></header>
        {payload?.events.length ? <div className="marketing-connection-events">{payload.events.map((event) => <article key={event.id}><div className={`marketing-event-icon ${event.status}`}>{event.status === "success" ? <CheckCircle size={18} weight="fill" /> : <WarningCircle size={18} weight="fill" />}</div><div><strong>{actionLabels[event.action] || event.action} — {providerLabels[event.provider]}</strong><span>{event.accountName || "بدون اسم حساب"} • بواسطة {event.userName}</span></div><time>{formatDate(event.createdAtIso)}</time></article>)}</div> : <p className="marketing-empty-state">لا توجد عمليات ربط مسجلة بعد.</p>}
      </section>
    </MarketingPage>
  );
}
