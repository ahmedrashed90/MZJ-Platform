import type { VercelRequest,VercelResponse } from "@vercel/node";
import { safeSecretEquals } from "../_auth.js";
import { ensureCrmSchema } from "../_crm-schema.js";
import { buildInboundMediaStorageKey,createUploadUrl,mediaStorageConfigured } from "../_media-storage.js";
import { getSql } from "../_db.js";

function bodyObject(request:VercelRequest){if(request.body&&typeof request.body==="object")return request.body as any;if(typeof request.body==="string"){try{return JSON.parse(request.body)}catch{return {}}}return{}}
function clean(v:unknown){return String(v??"").trim()}
function mediaType(v:unknown){const raw=clean(v).toLowerCase();if(raw==="file")return"document";if(raw==="voice"||raw==="ptt")return"audio";return ["image","audio","video","document","sticker"].includes(raw)?raw:"document"}

export default async function handler(request:VercelRequest,response:VercelResponse){
  if(request.method!=="POST")return response.status(405).json({ok:false,error:"Method not allowed"});
  const configured=clean(process.env.MZJ_GATEWAY_SECRET),provided=clean(request.headers["x-mzj-gateway-secret"]);
  if(!configured)return response.status(503).json({ok:false,error:"MZJ_GATEWAY_SECRET is not configured"});
  if(!safeSecretEquals(provided,configured))return response.status(401).json({ok:false,error:"Unauthorized gateway"});
  if(!mediaStorageConfigured())return response.status(503).json({ok:false,error:"R2 media storage is not configured"});
  await ensureCrmSchema();
  const body=bodyObject(request);if(clean(body.action)!=="prepare_upload")return response.status(400).json({ok:false,error:"Unsupported action"});
  const source=clean(body.source),eventKey=clean(body.eventKey),fileName=clean(body.fileName)||"media.bin",mimeType=clean(body.mimeType)||"application/octet-stream";
  if(!source||!eventKey)return response.status(400).json({ok:false,error:"source and eventKey are required"});
  const fileSize=Number(body.fileSize||0)||0;if(fileSize>50*1024*1024)return response.status(400).json({ok:false,error:"Inbound media exceeds 50MB"});
  const storageKey=buildInboundMediaStorageKey({channelCode:source,conversationExternalId:clean(body.conversationId||body.externalId||"pending"),providerMessageId:eventKey,fileName,mediaType:mediaType(body.mediaType||mimeType)});
  const sql=getSql();
  const [asset]=await sql<any[]>`
    insert into crm.media_assets(storage_key,original_name,media_type,mime_type,file_size,is_sensitive,status,metadata)
    values(${storageKey},${fileName},${mediaType(body.mediaType||mimeType)},${mimeType},${fileSize||null},${body.isSensitive===true},'uploading',${sql.json({source,eventKey,inbound:true})})
    on conflict(storage_key) do update set updated_at=now() returning *,id::text
  `;
  return response.status(200).json({ok:true,assetId:asset.id,storageKey,uploadUrl:createUploadUrl(storageKey,900),expiresIn:900});
}
