import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { getSessionUser, requireUser } from "../_auth.js";
import { hasPermission } from "../../shared/system-access.js";
import { ensureAccessControlSchema } from "../_access-control-schema.js";
import { ensureMarketingSchema } from "../_marketing-schema.js";
import {
  cancelPlatformConnectionDraft,
  completePlatformOAuth,
  disconnectPlatformConnection,
  listPlatformConnections,
  loadYouTubePublishOptions,
  saveYouTubePublishSettings,
  selectMetaPage,
  startPlatformOAuth,
  validatePlatformConnection,
  type PlatformProvider,
} from "../_platform-connections.js";

function clean(value: unknown) { return String(value ?? "").trim(); }
function bodyObject(request: VercelRequest) {
  if (request.body && typeof request.body === "object") return request.body as Record<string, any>;
  if (typeof request.body === "string") { try { return JSON.parse(request.body || "{}"); } catch { return {}; } }
  return {};
}
function popupHtml(result: { provider: PlatformProvider; returnOrigin: string; returnPath: string; status: string; message: string; accountName?: string }) {
  const payload = JSON.stringify({
    type: "mzj-platform-connection",
    provider: result.provider,
    status: result.status,
    message: result.message,
    accountName: result.accountName || "",
  }).replaceAll("<", "\\u003c");
  const targetOrigin = JSON.stringify(result.returnOrigin).replaceAll("<", "\\u003c");
  const returnUrl = `${result.returnOrigin}${result.returnPath}`;
  const title = result.status === "error" ? "تعذر إكمال الربط" : result.status === "selection_required" ? "مطلوب اختيار الصفحة" : "تم الربط بنجاح";
  const safeTitle = title.replace(/[<>&"]/g, "");
  const safeMessage = result.message.replace(/[<>&]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[character] || character));
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>body{margin:0;font-family:Tajawal,Arial,sans-serif;background:#fff8f4;color:#3b2721;display:grid;place-items:center;min-height:100vh}.card{width:min(440px,calc(100% - 32px));background:#fff;border:1px solid #eadbd4;border-radius:18px;padding:28px;box-shadow:0 18px 55px rgba(74,43,34,.12);text-align:center}.dot{width:64px;height:64px;border-radius:50%;margin:0 auto 16px;display:grid;place-items:center;background:${result.status === "error" ? "#fdeaea" : "#eaf7ee"};font-size:30px}h1{font-size:22px;margin:0 0 10px}p{line-height:1.8;color:#70564e}a{display:inline-flex;margin-top:14px;padding:11px 18px;border-radius:10px;background:#6c3329;color:white;text-decoration:none;font-weight:700}</style></head><body><main class="card"><div class="dot">${result.status === "error" ? "!" : "✓"}</div><h1>${safeTitle}</h1><p>${safeMessage}</p><a href="${returnUrl}">العودة إلى ربط المنصات</a></main><script>try{if(window.opener&&!window.opener.closed){window.opener.postMessage(${payload},${targetOrigin});window.close();}}catch(e){}</script></body></html>`;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  try {
    await ensureAccessControlSchema();
    await ensureMarketingSchema();
    const providerFromRoute = clean(request.query.provider);
    const user = providerFromRoute ? await getSessionUser(request) : await requireUser(request, response);
    if (!user) {
      if (providerFromRoute) throw new Error("انتهت جلسة الدخول. ارجع إلى المنصة وابدأ الربط من جديد.");
      return;
    }
    const sql = getSql();

    if (providerFromRoute) {
      if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
      if (!hasPermission(user, "marketing.connections.manage")) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لإدارة ربط المنصات" });
      const result = await completePlatformOAuth(sql, user, request, providerFromRoute);
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      return response.status(result.status === "error" ? 400 : 200).send(popupHtml(result));
    }

    if (request.method === "GET") {
      if (!hasPermission(user, "marketing.platforms.view")) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لمشاهدة ربط المنصات" });
      return response.status(200).json(await listPlatformConnections(sql, user, request));
    }
    if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
    if (!hasPermission(user, "marketing.connections.manage")) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لإدارة ربط المنصات" });

    const body = bodyObject(request);
    const action = clean(body.action);
    if (action === "start_oauth") return response.status(200).json(await startPlatformOAuth(sql, user, request, body.provider));
    if (action === "select_meta_page") return response.status(200).json(await selectMetaPage(sql, user, body.pageId));
    if (action === "cancel_oauth_draft") return response.status(200).json(await cancelPlatformConnectionDraft(sql, user, body.provider));
    if (action === "validate") return response.status(200).json(await validatePlatformConnection(sql, user, request, body.provider));
    if (action === "disconnect") return response.status(200).json(await disconnectPlatformConnection(sql, user, body.provider));
    if (action === "youtube_publish_options") return response.status(200).json(await loadYouTubePublishOptions(sql));
    if (action === "save_youtube_publish_settings") return response.status(200).json(await saveYouTubePublishSettings(sql, user, body.settings));
    return response.status(400).json({ ok: false, error: "الإجراء غير مدعوم" });
  } catch (error: any) {
    console.error("Platform connections API failed", error);
    const message = clean(error?.message) || "تعذر تنفيذ عملية ربط المنصة";
    if (clean(request.query.provider)) {
      const origin = (() => {
        try {
          const protocol = clean(request.headers["x-forwarded-proto"]) || (process.env.VERCEL ? "https" : "http");
          const host = clean(request.headers["x-forwarded-host"] || request.headers.host);
          return host ? `${protocol.split(",")[0]}://${host.split(",")[0]}` : "";
        } catch { return ""; }
      })();
      if (origin) {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        return response.status(400).send(popupHtml({ provider: clean(request.query.provider) as PlatformProvider, returnOrigin: origin, returnPath: "/marketing/platforms", status: "error", message }));
      }
    }
    return response.status(/صلاحية/.test(message) ? 403 : 400).json({ ok: false, error: message });
  }
}
