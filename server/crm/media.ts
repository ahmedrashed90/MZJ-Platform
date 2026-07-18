import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clean, parseBody, requireCrmUser, userScope } from "../_crm-utils.js";
import { getSql } from "../_db.js";
import {
  buildMediaStorageKey,
  createUploadUrl,
  getMediaObject,
  mediaStorageConfigured,
  putMediaObject,
} from "../_media-storage.js";

function allowedType(value: unknown) {
  const raw = clean(value).toLowerCase();
  const type = raw === "file" ? "document" : raw === "voice" || raw === "ptt" ? "audio" : raw;
  return ["image", "audio", "video", "document"].includes(type) ? type : "";
}

function header(request: VercelRequest, name: string) {
  const value = request.headers[name.toLowerCase()];
  return clean(Array.isArray(value) ? value[0] : value);
}

function decodedHeader(request: VercelRequest, name: string) {
  const value = header(request, name);
  if (!value) return "";
  try { return decodeURIComponent(value); } catch { return value; }
}

async function rawBytes(request: VercelRequest) {
  if (Buffer.isBuffer(request.body)) return new Uint8Array(request.body);
  if (request.body instanceof Uint8Array) return new Uint8Array(request.body);
  if (request.body instanceof ArrayBuffer) return new Uint8Array(request.body);
  if (typeof request.body === "string") return new Uint8Array(Buffer.from(request.body, "binary"));
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return new Uint8Array(Buffer.concat(chunks));
}

function filenameHeader(value: unknown) {
  const name = clean(value) || "attachment.bin";
  const fallback = name.replace(/[\r\n"\\]/g, "_").replace(/[^\x20-\x7E]/g, "_") || "attachment.bin";
  return `filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

async function canAccessConversation(user: any, conversationId: string) {
  const sql = getSql();
  const scope = userScope(user);
  const [row] = await sql<any[]>`
    select c.id::text,c.assigned_to::text,c.call_center_assigned_to::text,c.department_code,c.branch_code
    from crm.conversations c where c.id=${conversationId}::uuid
  `;
  if (!row) return false;
  if (scope.all) return true;
  return row.assigned_to === user.id
    || row.call_center_assigned_to === user.id
    || (scope.departmentCodes.includes(row.department_code) && (!scope.branchCodes.length || scope.branchCodes.includes(row.branch_code)));
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  if (!mediaStorageConfigured()) return response.status(503).json({ ok: false, error: "تخزين الوسائط R2 غير مضبوط" });
  const sql = getSql();

  if (request.method === "POST") {
    const actionFromQuery = clean(request.query.action);
    const uploadMode = header(request, "x-mzj-upload-mode").toLowerCase();
    const contentType = header(request, "content-type").split(";")[0].toLowerCase();
    const isBinaryUpload = actionFromQuery === "upload_binary" || uploadMode === "binary" || contentType === "application/octet-stream";

    if (isBinaryUpload) {
      const conversationId = header(request, "x-mzj-conversation-id") || clean(request.query.conversationId);
      if (!conversationId || !(await canAccessConversation(user, conversationId))) {
        return response.status(403).json({ ok: false, error: "لا توجد صلاحية للمحادثة" });
      }
      const type = allowedType(header(request, "x-mzj-media-type"));
      if (!type) return response.status(400).json({ ok: false, error: "نوع الملف غير مسموح" });
      const fileName = decodedHeader(request, "x-mzj-file-name") || `${type}.bin`;
      const mimeType = decodedHeader(request, "x-mzj-mime-type") || contentType || "application/octet-stream";
      const declaredSize = Number(header(request, "x-mzj-file-size") || 0) || 0;
      const max = 50 * 1024 * 1024;
      if (declaredSize > max) return response.status(413).json({ ok: false, error: "حجم الملف أكبر من 50MB" });
      const bytes = await rawBytes(request);
      if (!bytes.byteLength) return response.status(400).json({ ok: false, error: "الملف فارغ" });
      if (bytes.byteLength > max) return response.status(413).json({ ok: false, error: "حجم الملف أكبر من 50MB" });

      const storageKey = buildMediaStorageKey({ conversationId, fileName, mediaType: type });
      const uploaded = await putMediaObject(storageKey, bytes, mimeType);
      const [asset] = await sql<any[]>`
        insert into crm.media_assets(
          conversation_id,storage_key,original_name,media_type,mime_type,file_size,is_sensitive,status,created_by,metadata
        ) values(
          ${conversationId}::uuid,${storageKey},${fileName},${type},${mimeType},${uploaded.fileSize},true,'ready',${user.id}::uuid,
          ${sql.json({ outbound: true, uploadMode: "platform_binary", etag: uploaded.etag || null })}
        )
        returning *,id::text,conversation_id::text
      `;
      return response.status(201).json({
        ok: true,
        assetId: asset.id,
        storageKey,
        fileName,
        mediaType: type,
        mimeType,
        fileSize: uploaded.fileSize,
      });
    }

    const body = parseBody(request);
    const action = clean(body.action);
    if (action === "prepare_upload") {
      const conversationId = clean(body.conversationId);
      if (!conversationId || !(await canAccessConversation(user, conversationId))) return response.status(403).json({ ok: false, error: "لا توجد صلاحية للمحادثة" });
      const type = allowedType(body.mediaType);
      if (!type) return response.status(400).json({ ok: false, error: "نوع الملف غير مسموح" });
      const fileName = clean(body.fileName) || `${type}.bin`;
      const mimeType = clean(body.mimeType) || "application/octet-stream";
      const fileSize = Number(body.fileSize || 0) || null;
      const max = 50 * 1024 * 1024;
      if (fileSize && fileSize > max) return response.status(400).json({ ok: false, error: "حجم الملف أكبر من 50MB" });
      const storageKey = buildMediaStorageKey({ conversationId, fileName, mediaType: type });
      const [asset] = await sql<any[]>`
        insert into crm.media_assets(conversation_id,storage_key,original_name,media_type,mime_type,file_size,is_sensitive,status,created_by,metadata)
        values(${conversationId}::uuid,${storageKey},${fileName},${type},${mimeType},${fileSize},${body.isSensitive === true},'uploading',${user.id}::uuid,${sql.json({ outbound: true })})
        returning *,id::text,conversation_id::text
      `;
      return response.status(200).json({ ok: true, assetId: asset.id, storageKey, uploadUrl: createUploadUrl(storageKey, 900), expiresIn: 900 });
    }
    if (action === "mark_ready") {
      const assetId = clean(body.assetId);
      const [asset] = await sql<any[]>`select *,id::text,conversation_id::text from crm.media_assets where id=${assetId}::uuid`;
      if (!asset || !(await canAccessConversation(user, asset.conversation_id))) return response.status(404).json({ ok: false, error: "الملف غير موجود" });
      await sql`update crm.media_assets set status='ready',updated_at=now() where id=${assetId}::uuid`;
      return response.status(200).json({ ok: true });
    }
    return response.status(400).json({ ok: false, error: "إجراء غير مدعوم" });
  }

  if (request.method === "GET") {
    const assetId = clean(request.query.assetId);
    if (!assetId) return response.status(400).json({ ok: false, error: "assetId مطلوب" });
    const [asset] = await sql<any[]>`select *,id::text,conversation_id::text from crm.media_assets where id=${assetId}::uuid`;
    if (!asset || !asset.conversation_id || !(await canAccessConversation(user, asset.conversation_id))) {
      return response.status(404).json({ ok: false, error: "الملف غير موجود أو غير مسموح" });
    }

    const stream = ["1", "true", "yes"].includes(clean(request.query.stream).toLowerCase());
    const download = ["1", "true", "yes"].includes(clean(request.query.download).toLowerCase());
    const legacyRedirect = ["1", "true", "yes"].includes(clean(request.query.redirect).toLowerCase());
    await sql`
      insert into crm.media_access_logs(asset_id,user_id,action,ip_address,user_agent)
      values(${assetId}::uuid,${user.id}::uuid,${download ? "download" : "view"},${clean(request.headers["x-forwarded-for"]) || null},${clean(request.headers["user-agent"]) || null})
    `;

    if (stream || download || legacyRedirect) {
      const upstream = await getMediaObject(asset.storage_key, header(request, "range"));
      const bytes = Buffer.from(await upstream.arrayBuffer());
      response.status(upstream.status);
      response.setHeader("Content-Type", clean(asset.mime_type) || clean(upstream.headers.get("content-type")) || "application/octet-stream");
      response.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; ${filenameHeader(asset.original_name)}`);
      response.setHeader("Cache-Control", "private, max-age=60, no-transform");
      for (const name of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
        const value = upstream.headers.get(name);
        if (value) response.setHeader(name, value);
      }
      return response.send(bytes);
    }

    const url = `/api/crm/media?assetId=${encodeURIComponent(assetId)}&stream=1`;
    return response.status(200).json({
      ok: true,
      url,
      downloadUrl: `/api/crm/media?assetId=${encodeURIComponent(assetId)}&download=1`,
      asset: {
        id: asset.id,
        fileName: asset.original_name,
        mediaType: asset.media_type,
        mimeType: asset.mime_type,
        fileSize: asset.file_size,
        isSensitive: asset.is_sensitive,
      },
    });
  }

  return response.status(405).json({ ok: false, error: "Method not allowed" });
}
