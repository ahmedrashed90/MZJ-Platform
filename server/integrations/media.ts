import type { VercelRequest,VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { safeSecretEquals } from "../_auth.js";
import { ensureCrmSchema } from "../_crm-schema.js";
import { buildInboundMediaStorageKey,createUploadUrl,mediaStorageConfigured,putMediaObject } from "../_media-storage.js";
import { getSql } from "../_db.js";

function bodyObject(request:VercelRequest){if(request.body&&typeof request.body==="object"&&!Buffer.isBuffer(request.body))return request.body as any;if(typeof request.body==="string"){try{return JSON.parse(request.body)}catch{return {}}}return{}}
function clean(v:unknown){return String(v??"").trim()}
function normalizedMediaType(v:unknown){const raw=clean(v).toLowerCase();if(raw==="file")return"document";if(raw==="voice"||raw==="ptt")return"audio";return ["image","audio","video","document","sticker"].includes(raw)?raw:"document"}
function header(request:VercelRequest,name:string){const value=request.headers[name.toLowerCase()];return clean(Array.isArray(value)?value[0]:value)}
function decodedHeader(request:VercelRequest,name:string){const value=header(request,name);if(!value)return"";try{return decodeURIComponent(value)}catch{return value}}
function publicBaseUrl(){return clean(process.env.MZJ_PUBLIC_BASE_URL).replace(/\/+$/,"")}
async function rawBytes(request:VercelRequest){
  if(Buffer.isBuffer(request.body))return new Uint8Array(request.body);
  if(request.body instanceof Uint8Array)return new Uint8Array(request.body);
  if(request.body instanceof ArrayBuffer)return new Uint8Array(request.body);
  if(typeof request.body==="string")return new Uint8Array(Buffer.from(request.body,"binary"));
  const chunks:Buffer[]=[];for await(const chunk of request)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));return new Uint8Array(Buffer.concat(chunks));
}

export default async function handler(request:VercelRequest,response:VercelResponse){
  if(request.method!=="POST")return response.status(405).json({ok:false,error:"Method not allowed"});
  const configured=clean(process.env.MZJ_GATEWAY_SECRET),provided=header(request,"x-mzj-gateway-secret");
  if(!configured)return response.status(503).json({ok:false,error:"MZJ_GATEWAY_SECRET is not configured"});
  if(!safeSecretEquals(provided,configured))return response.status(401).json({ok:false,error:"Unauthorized gateway"});
  if(!mediaStorageConfigured())return response.status(503).json({ok:false,error:"R2 media storage is not configured"});
  await ensureCrmSchema();
  const contentType=header(request,"content-type").toLowerCase();
  const isBinary=header(request,"x-mzj-upload-mode")==="binary"||contentType.includes("application/octet-stream");
  const sql=getSql();

  if(isBinary){
    const bytes=await rawBytes(request);
    const max=50*1024*1024;if(!bytes.byteLength)return response.status(400).json({ok:false,error:"Empty media body"});if(bytes.byteLength>max)return response.status(413).json({ok:false,error:"Media file is larger than 50MB"});
    const source=header(request,"x-mzj-source")||"whatsapp";
    const eventKey=header(request,"x-mzj-provider-message-id")||header(request,"x-event-id")||crypto.randomUUID();
    const conversationExternalId=header(request,"x-mzj-conversation-id")||"pending";
    const fileName=decodedHeader(request,"x-mzj-file-name")||"media.bin";
    const mimeType=decodedHeader(request,"x-mzj-mime-type")||contentType.split(";")[0]||"application/octet-stream";
    const type=normalizedMediaType(header(request,"x-mzj-media-type")||mimeType);
    const mediaId=header(request,"x-mzj-media-id");
    const storageKey=buildInboundMediaStorageKey({channelCode:source,conversationExternalId,providerMessageId:eventKey,fileName,mediaType:type});
    const uploaded=await putMediaObject(storageKey,bytes,mimeType);
    const [asset]=await sql<any[]>`
      insert into crm.media_assets(storage_key,original_name,media_type,mime_type,file_size,is_sensitive,status,metadata)
      values(${storageKey},${fileName},${type},${mimeType},${uploaded.fileSize},true,'ready',${sql.json({source,eventKey,inbound:true,mediaId:mediaId||null,etag:uploaded.etag||null})})
      on conflict(storage_key) do update set original_name=excluded.original_name,media_type=excluded.media_type,mime_type=excluded.mime_type,file_size=excluded.file_size,status='ready',metadata=coalesce(crm.media_assets.metadata,'{}'::jsonb)||excluded.metadata,updated_at=now()
      returning *,id::text
    `;
    const base=publicBaseUrl();
    const attachmentUrl=base?`${base}/api/crm/media?assetId=${encodeURIComponent(asset.id)}&redirect=1`:"";
    return response.status(201).json({ok:true,assetId:asset.id,storageKey,fileName,mediaType:type,mimeType,fileSize:uploaded.fileSize,attachmentUrl,mediaUrl:attachmentUrl,fileUrl:attachmentUrl});
  }

  const body=bodyObject(request);if(clean(body.action)!=="prepare_upload")return response.status(400).json({ok:false,error:"Unsupported action"});
  const source=clean(body.source)||"unknown",eventKey=clean(body.eventKey)||crypto.randomUUID(),fileName=clean(body.fileName)||"media.bin",mimeType=clean(body.mimeType)||"application/octet-stream";
  const storageKey=buildInboundMediaStorageKey({channelCode:source,conversationExternalId:clean(body.conversationId||body.externalId||"pending"),providerMessageId:eventKey,fileName,mediaType:normalizedMediaType(body.mediaType||mimeType)});
  const [asset]=await sql<any[]>`
    insert into crm.media_assets(storage_key,original_name,media_type,mime_type,file_size,is_sensitive,status,metadata)
    values(${storageKey},${fileName},${normalizedMediaType(body.mediaType||mimeType)},${mimeType},${Number(body.fileSize||0)||null},${body.isSensitive===true},'uploading',${sql.json({source,eventKey,inbound:true})})
    on conflict(storage_key) do update set updated_at=now() returning *,id::text
  `;
  return response.status(200).json({ok:true,assetId:asset.id,storageKey,uploadUrl:createUploadUrl(storageKey,900),expiresIn:900});
}
