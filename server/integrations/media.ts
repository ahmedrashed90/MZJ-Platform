import type { VercelRequest,VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { safeSecretEquals } from "../_auth.js";
import { ensureCrmSchema } from "../_crm-schema.js";
import { buildInboundMediaStorageKey,createUploadUrl,mediaStorageConfigured } from "../_media-storage.js";
import { getSql } from "../_db.js";

function bodyObject(request:VercelRequest){if(request.body&&typeof request.body==="object")return request.body as any;if(typeof request.body==="string"){try{return JSON.parse(request.body)}catch{return {}}}return{}}
function clean(v:unknown){return String(v??"").trim()}
function mediaType(v:unknown){const raw=clean(v).toLowerCase();if(raw==="file")return"document";if(raw==="voice"||raw==="ptt")return"audio";return ["image","audio","video","document","sticker"].includes(raw)?raw:"document"}
function publicBaseUrl(request:VercelRequest){
  const configured=clean(process.env.MZJ_PUBLIC_BASE_URL);
  if(configured)return configured.replace(/\/+$/g,"");
  const production=clean(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if(production)return `https://${production.replace(/^https?:\/\//i,"").replace(/\/+$/g,"")}`;
  const host=clean(request.headers["x-forwarded-host"]||request.headers.host);
  const proto=clean(request.headers["x-forwarded-proto"])||"https";
  return host?`${proto}://${host}`:"";
}

export default async function handler(request:VercelRequest,response:VercelResponse){
  if(request.method!=="POST")return response.status(405).json({ok:false,error:"Method not allowed"});
  const configured=clean(process.env.MZJ_GATEWAY_SECRET),provided=clean(request.headers["x-mzj-gateway-secret"]);
  if(!configured)return response.status(503).json({ok:false,error:"MZJ_GATEWAY_SECRET is not configured"});
  if(!safeSecretEquals(provided,configured))return response.status(401).json({ok:false,error:"Unauthorized gateway"});
  if(!mediaStorageConfigured())return response.status(503).json({ok:false,error:"R2 media storage is not configured"});
  await ensureCrmSchema();
  const body=bodyObject(request);if(clean(body.action)!=="prepare_upload")return response.status(400).json({ok:false,error:"Unsupported action"});
  const source=clean(body.source)||"unknown",eventKey=clean(body.eventKey)||crypto.randomUUID(),providerMessageId=clean(body.providerMessageId||body.provider_message_id||eventKey),mediaId=clean(body.mediaId||body.media_id),fileName=clean(body.fileName)||"media.bin",mimeType=clean(body.mimeType)||"application/octet-stream";
  const normalizedType=mediaType(body.mediaType||mimeType);
  const storageKey=buildInboundMediaStorageKey({channelCode:source,conversationExternalId:clean(body.conversationId||body.externalId||"pending"),providerMessageId,fileName,mediaType:normalizedType});
  const sql=getSql();
  const [asset]=await sql<any[]>`
    insert into crm.media_assets(storage_key,original_name,media_type,mime_type,file_size,is_sensitive,status,metadata)
    values(${storageKey},${fileName},${normalizedType},${mimeType},${Number(body.fileSize||0)||null},${body.isSensitive===true},'uploading',${sql.json({source,eventKey,providerMessageId,mediaId,inbound:true})})
    on conflict(storage_key) do update set original_name=excluded.original_name,media_type=excluded.media_type,mime_type=excluded.mime_type,file_size=coalesce(excluded.file_size,crm.media_assets.file_size),status='uploading',metadata=crm.media_assets.metadata||excluded.metadata,updated_at=now() returning *,id::text
  `;
  const base=publicBaseUrl(request);
  const permanentUrl=base?`${base}/api/crm/media?assetId=${encodeURIComponent(asset.id)}&download=1`:"";
  return response.status(200).json({ok:true,assetId:asset.id,storageKey,uploadUrl:createUploadUrl(storageKey,900),permanentUrl,expiresIn:900});
}
