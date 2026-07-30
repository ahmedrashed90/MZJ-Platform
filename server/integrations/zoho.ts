import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { requireUser } from "../_auth.js";
import { ensureAccessControlSchema } from "../_access-control-schema.js";
import { ensureMarketingSchema } from "../_marketing-schema.js";
import { hasPermission } from "../../shared/system-access.js";
import {
  completeZohoAuthorization,
  createZohoAuthorizationUrl,
  getZohoConnectionStatus,
  getZohoFileDownload,
  getZohoRuntime,
  parseZohoUploadResult,
  ticketHash,
  zohoGatewayAuthorized,
} from "../_zoho-workdrive.js";

function clean(value: unknown) { return String(value ?? "").trim(); }
function bodyObject(request: VercelRequest) {
  if (request.body && typeof request.body === "object") return request.body as Record<string, any>;
  if (typeof request.body === "string") { try { return JSON.parse(request.body || "{}"); } catch { return {}; } }
  return {};
}
function actionName(request: VercelRequest) { return clean(request.query.zohoAction || request.query.action); }
function escapeHtml(value: unknown) { return clean(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character)); }
function html(response: VercelResponse, status: number, title: string, message: string, success = false) {
  const safeTitle=escapeHtml(title),safeMessage=escapeHtml(message),payload=JSON.stringify({type:"mzj-zoho-connection",status:success?"success":"error",message:clean(message)}).replace(/</g,"\u003c");
  response.status(status).setHeader("content-type", "text/html; charset=utf-8");
  return response.send(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>body{font-family:Arial,sans-serif;background:#f7f4f2;margin:0;display:grid;place-items:center;min-height:100vh;color:#2d1712}.card{width:min(560px,calc(100% - 32px));background:#fff;border:1px solid #eadbd6;border-radius:18px;padding:32px;box-shadow:0 18px 50px #6c33291c}.badge{display:inline-block;padding:7px 12px;border-radius:999px;background:${success ? "#e8f7ed" : "#fff0ed"};color:${success ? "#17703c" : "#9d2c20"};font-weight:700}h1{margin:18px 0 10px;font-size:25px}p{line-height:1.8;color:#6b5650}a{display:inline-block;margin-top:12px;background:#6c3329;color:#fff;text-decoration:none;padding:11px 18px;border-radius:10px}</style></head><body><main class="card"><span class="badge">${success ? "تم الربط" : "تعذر الربط"}</span><h1>${safeTitle}</h1><p>${safeMessage}</p><a href="/marketing/platforms">العودة إلى المنصة</a></main><script>try{if(window.opener){window.opener.postMessage(${payload},window.location.origin);setTimeout(()=>window.close(),1200)}}catch(e){}</script></body></html>`);
}

async function handleStart(request: VercelRequest, response: VercelResponse) {
  const user = await requireUser(request, response); if (!user) return;
  if (!hasPermission(user, "marketing.connections.manage")) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لإدارة ربط Zoho" });
  const url = await createZohoAuthorizationUrl(getSql(), user, request);
  return response.redirect(302, url);
}

async function handleCallback(request: VercelRequest, response: VercelResponse) {
  const error = clean(request.query.error);
  if (error) return html(response, 400, "لم يكتمل ربط Zoho", clean(request.query.error_description) || error, false);
  try {
    const result = await completeZohoAuthorization(getSql(), { code: clean(request.query.code), state: clean(request.query.state) });
    return html(response, 200, "تم ربط Zoho WorkDrive بنجاح", `تم اعتماد حساب ${result.accountEmail} وربط فولدر النشر بالمنصة. يمكنك إغلاق هذه الصفحة والعودة إلى السيستم.`, true);
  } catch (failure) {
    return html(response, 400, "تعذر ربط Zoho WorkDrive", failure instanceof Error ? failure.message : "حدث خطأ أثناء الربط", false);
  }
}

async function handleStatus(request: VercelRequest, response: VercelResponse) {
  const user = await requireUser(request, response); if (!user) return;
  if (!hasPermission(user, "marketing.connections.manage")) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لإدارة ربط Zoho" });
  return response.status(200).json({ ok: true, ...(await getZohoConnectionStatus(getSql())) });
}

async function handleUploadTicket(request: VercelRequest, response: VercelResponse) {
  if (!zohoGatewayAuthorized(request)) return response.status(401).json({ ok: false, error: "Unauthorized Zoho gateway" });
  const ticket = clean(request.query.ticket);
  if (!ticket) return response.status(400).json({ ok: false, error: "Upload ticket is required" });
  const sql = getSql();
  const [row] = await sql<any[]>`
    select z.*,z.file_id::text,z.final_media_group_id::text,z.task_id::text,f.status as file_status
    from marketing.zoho_upload_tickets z
    join marketing.files f on f.id=z.file_id
    where z.ticket_hash=${ticketHash(ticket)} and z.expires_at>now() and z.status in ('prepared','uploading')
  `;
  if (!row) return response.status(404).json({ ok: false, error: "Upload ticket is invalid or expired" });
  const runtime = await getZohoRuntime(sql);
  await sql`update marketing.zoho_upload_tickets set status='uploading' where ticket_hash=${ticketHash(ticket)}`;
  return response.status(200).json({
    ok: true,
    fileId: row.file_id,
    groupId: row.final_media_group_id,
    taskId: row.task_id,
    fileName: row.file_name,
    mimeType: row.mime_type || "application/octet-stream",
    fileSize: Number(row.file_size || 0),
    parentFolderId: row.parent_folder_id || runtime.rootFolderId,
    uploadId: row.upload_id,
    uploadUrl: `${runtime.uploadDomain}/workdrive-api/v1/stream/upload`,
    accessToken: runtime.accessToken,
  });
}

async function handleUploadComplete(request: VercelRequest, response: VercelResponse) {
  if (!zohoGatewayAuthorized(request)) return response.status(401).json({ ok: false, error: "Unauthorized Zoho gateway" });
  const body = bodyObject(request), ticket = clean(body.ticket);
  if (!ticket) return response.status(400).json({ ok: false, error: "Upload ticket is required" });
  const sql = getSql();
  const [row] = await sql<any[]>`
    select z.*,z.file_id::text,z.final_media_group_id::text,z.task_id::text
    from marketing.zoho_upload_tickets z
    where z.ticket_hash=${ticketHash(ticket)} and z.expires_at>now() and z.status in ('prepared','uploading')
  `;
  if (!row) return response.status(404).json({ ok: false, error: "Upload ticket is invalid or expired" });
  const failure = clean(body.error);
  const parsed = parseZohoUploadResult(body.result);
  if (failure || !parsed.resourceId) {
    const message = failure || "Zoho did not return a resource ID";
    await sql.begin(async tx => {
      await tx`update marketing.zoho_upload_tickets set status='failed',completed_at=now() where ticket_hash=${ticketHash(ticket)}`;
      await tx`update marketing.files set status='failed',upload_error=${message},updated_at=now() where id=${row.file_id}::uuid`;
      await tx`update marketing.final_media_groups set status='failed',updated_at=now() where id=${row.final_media_group_id}::uuid`;
    });
    return response.status(502).json({ ok: false, error: message });
  }
  const externalUrl = parsed.permalink || null;
  await sql.begin(async tx => {
    await tx`
      update marketing.files
      set status='ready',storage_provider='zoho',external_id=${parsed.resourceId},external_parent_id=${parsed.parentId || row.parent_folder_id},external_url=${externalUrl},upload_error=null,updated_at=now()
      where id=${row.file_id}::uuid
    `;
    await tx`update marketing.zoho_upload_tickets set status='completed',completed_at=now() where ticket_hash=${ticketHash(ticket)}`;
    const [counts] = await tx<any[]>`
      select count(*)::int as total,count(*) filter(where status='ready')::int as ready
      from marketing.files where final_media_group_id=${row.final_media_group_id}::uuid
    `;
    if (Number(counts?.total || 0) > 0 && Number(counts?.total || 0) === Number(counts?.ready || 0)) {
      await tx`update marketing.final_media_groups set status='ready',updated_at=now() where id=${row.final_media_group_id}::uuid`;
    }
  });
  return response.status(200).json({ ok: true, fileId: row.file_id, groupId: row.final_media_group_id, resourceId: parsed.resourceId, fileName: parsed.fileName || row.file_name });
}

async function handleMediaTicket(request: VercelRequest, response: VercelResponse) {
  if (!zohoGatewayAuthorized(request)) return response.status(401).json({ ok: false, error: "Unauthorized Zoho gateway" });
  const ticket = clean(request.query.ticket), fileId = clean(request.query.fileId);
  if (!ticket || !fileId) return response.status(400).json({ ok: false, error: "Media ticket and file ID are required" });
  const sql = getSql();
  const [row] = await sql<any[]>`
    select f.id::text,f.external_id,f.original_name,f.mime_type
    from marketing.zoho_media_tickets t
    join marketing.files f on f.id=t.file_id
    where t.ticket_hash=${ticketHash(ticket)} and t.file_id=${fileId}::uuid and t.expires_at>now()
      and f.status='ready' and f.storage_provider='zoho'
  `;
  if (!row?.external_id) return response.status(404).json({ ok: false, error: "Media ticket is invalid or file is unavailable" });
  const download = await getZohoFileDownload(sql, clean(row.external_id));
  return response.status(200).json({ ok: true, accessToken: download.accessToken, downloadUrl: download.downloadUrl, fileName: download.fileName || row.original_name, mimeType: download.mimeType || row.mime_type });
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("cache-control", "no-store");
  try {
    await ensureAccessControlSchema();
    await ensureMarketingSchema();
    const action = actionName(request);
    if (action === "start" && request.method === "GET") return handleStart(request, response);
    if (action === "callback" && request.method === "GET") return handleCallback(request, response);
    if (action === "status" && request.method === "GET") return handleStatus(request, response);
    if (action === "upload-ticket" && request.method === "GET") return handleUploadTicket(request, response);
    if (action === "upload-complete" && request.method === "POST") return handleUploadComplete(request, response);
    if (action === "media-ticket" && request.method === "GET") return handleMediaTicket(request, response);
    return response.status(405).json({ ok: false, error: "Zoho route or method is not supported" });
  } catch (failure) {
    console.error("Zoho integration failed", failure);
    const message = failure instanceof Error ? failure.message : "تعذر تنفيذ ربط Zoho";
    return response.status(400).json({ ok: false, error: message });
  }
}
