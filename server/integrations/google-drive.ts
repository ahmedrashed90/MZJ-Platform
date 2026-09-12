import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { requireUser } from "../_auth.js";
import { ensureAccessControlSchema } from "../_access-control-schema.js";
import { ensureMarketingSchema } from "../_marketing-schema.js";
import { hasPermission } from "../../shared/system-access.js";
import {
  completeGoogleDriveAuthorization,
  createGoogleDriveAuthorizationUrl,
  getGoogleDriveConnectionStatus,
} from "../_google-drive-storage.js";

function clean(value: unknown) { return String(value ?? "").trim(); }
function actionName(request: VercelRequest) { return clean(request.query.googleDriveAction || request.query.action); }
function escapeHtml(value: unknown) { return clean(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character)); }
function html(response: VercelResponse, status: number, title: string, message: string, success = false) {
  const safeTitle = escapeHtml(title), safeMessage = escapeHtml(message);
  response.status(status).setHeader("content-type", "text/html; charset=utf-8");
  return response.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>body{font-family:Arial,sans-serif;background:#f7f4f2;margin:0;display:grid;place-items:center;min-height:100vh;color:#2d1712}.card{width:min(560px,calc(100% - 32px));background:#fff;border:1px solid #eadbd6;border-radius:18px;padding:32px;box-shadow:0 18px 50px #6c33291c}.badge{display:inline-block;padding:7px 12px;border-radius:999px;background:${success ? "#e8f7ed" : "#fff0ed"};color:${success ? "#17703c" : "#9d2c20"};font-weight:700}h1{margin:18px 0 10px;font-size:25px}p{line-height:1.8;color:#6b5650}a{display:inline-block;margin-top:12px;background:#6c3329;color:#fff;text-decoration:none;padding:11px 18px;border-radius:10px}</style></head><body><main class="card"><span class="badge">${success ? "Connected" : "Connection failed"}</span><h1>${safeTitle}</h1><p>${safeMessage}</p><a href="/marketing">Return to MZJ Platform</a></main></body></html>`);
}

async function handleStart(request: VercelRequest, response: VercelResponse) {
  const user = await requireUser(request, response); if (!user) return;
  if (!hasPermission(user, "marketing.connections.manage")) return response.status(403).json({ ok: false, error: "No permission to manage Google Drive storage" });
  const url = await createGoogleDriveAuthorizationUrl(getSql(), user, request);
  return response.redirect(302, url);
}

async function handleCallback(request: VercelRequest, response: VercelResponse) {
  const error = clean(request.query.error);
  if (error) return html(response, 400, "Google Drive was not connected", clean(request.query.error_description) || error, false);
  try {
    const result = await completeGoogleDriveAuthorization(getSql(), { code: clean(request.query.code), state: clean(request.query.state) });
    return html(response, 200, "Google Drive connected successfully", `Storage folder ready: ${result.rootFolderName}`, true);
  } catch (failure) {
    return html(response, 400, "Unable to connect Google Drive", failure instanceof Error ? failure.message : "OAuth callback failed", false);
  }
}

async function handleStatus(request: VercelRequest, response: VercelResponse) {
  const user = await requireUser(request, response); if (!user) return;
  if (!hasPermission(user, "marketing.connections.manage")) return response.status(403).json({ ok: false, error: "No permission to manage Google Drive storage" });
  return response.status(200).json({ ok: true, ...(await getGoogleDriveConnectionStatus(getSql())) });
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("cache-control", "no-store");
  try {
    await ensureAccessControlSchema();
    await ensureMarketingSchema();
    const action = actionName(request);
    if (action === "connect" && request.method === "GET") return handleStart(request, response);
    if (action === "callback" && request.method === "GET") return handleCallback(request, response);
    if (action === "status" && request.method === "GET") return handleStatus(request, response);
    return response.status(404).json({ ok: false, error: "Google Drive route not found" });
  } catch (failure) {
    return response.status(400).json({ ok: false, error: failure instanceof Error ? failure.message : "Google Drive request failed" });
  }
}
