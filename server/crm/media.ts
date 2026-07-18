import type { VercelRequest,VercelResponse } from "@vercel/node";
import { clean,parseBody,requireCrmUser,userScope } from "../_crm-utils.js";
import { getSql } from "../_db.js";
import { buildMediaStorageKey,createDownloadUrl,createUploadUrl,mediaStorageConfigured } from "../_media-storage.js";

function allowedType(value:unknown){const raw=clean(value).toLowerCase();const type=raw==="file"?"document":raw==="voice"?"audio":raw;return ["image","audio","video","document"].includes(type)?type:"";}
async function canAccessConversation(user:any,conversationId:string){
  const sql=getSql();const scope=userScope(user);const [row]=await sql<any[]>`select c.id::text,c.assigned_to::text,c.call_center_assigned_to::text,c.department_code,c.branch_code from crm.conversations c where c.id=${conversationId}::uuid`;
  if(!row)return false;if(scope.all)return true;return row.assigned_to===user.id||row.call_center_assigned_to===user.id||(scope.departmentCodes.includes(row.department_code)&&(!scope.branchCodes.length||scope.branchCodes.includes(row.branch_code)));
}
export default async function handler(request:VercelRequest,response:VercelResponse){
  const user=await requireCrmUser(request,response);if(!user)return;
  if(!mediaStorageConfigured())return response.status(503).json({ok:false,error:"تخزين الوسائط R2 غير مضبوط"});
  const sql=getSql();
  if(request.method==="POST"){
    const body=parseBody(request),action=clean(body.action);
    if(action==="prepare_upload"){
      const conversationId=clean(body.conversationId);if(!conversationId||!(await canAccessConversation(user,conversationId)))return response.status(403).json({ok:false,error:"لا توجد صلاحية للمحادثة"});
      const type=allowedType(body.mediaType);if(!type)return response.status(400).json({ok:false,error:"نوع الملف غير مسموح"});
      const fileName=clean(body.fileName)||`${type}.bin`,mimeType=clean(body.mimeType)||"application/octet-stream",fileSize=Number(body.fileSize||0)||null;
      const max=50*1024*1024;if(fileSize&&fileSize>max)return response.status(400).json({ok:false,error:"حجم الملف أكبر من 50MB"});
      const storageKey=buildMediaStorageKey({conversationId,fileName,mediaType:type});
      const [asset]=await sql<any[]>`insert into crm.media_assets(conversation_id,storage_key,original_name,media_type,mime_type,file_size,is_sensitive,status,created_by,metadata) values(${conversationId}::uuid,${storageKey},${fileName},${type},${mimeType},${fileSize},${body.isSensitive===true},'uploading',${user.id}::uuid,${sql.json({outbound:true})}) returning *,id::text,conversation_id::text`;
      return response.status(200).json({ok:true,assetId:asset.id,storageKey,uploadUrl:createUploadUrl(storageKey,900),expiresIn:900});
    }
    if(action==="mark_ready"){
      const assetId=clean(body.assetId);const [asset]=await sql<any[]>`select *,id::text,conversation_id::text from crm.media_assets where id=${assetId}::uuid`;
      if(!asset||!(await canAccessConversation(user,asset.conversation_id)))return response.status(404).json({ok:false,error:"الملف غير موجود"});
      await sql`update crm.media_assets set status='ready',updated_at=now() where id=${assetId}::uuid`;
      return response.status(200).json({ok:true});
    }
    return response.status(400).json({ok:false,error:"إجراء غير مدعوم"});
  }
  if(request.method==="GET"){
    const assetId=clean(request.query.assetId);if(!assetId)return response.status(400).json({ok:false,error:"assetId مطلوب"});
    const [asset]=await sql<any[]>`select *,id::text,conversation_id::text from crm.media_assets where id=${assetId}::uuid`;
    if(!asset||!asset.conversation_id||!(await canAccessConversation(user,asset.conversation_id)))return response.status(404).json({ok:false,error:"الملف غير موجود أو غير مسموح"});
    await sql`insert into crm.media_access_logs(asset_id,user_id,action,ip_address,user_agent) values(${assetId}::uuid,${user.id}::uuid,'download',${clean(request.headers['x-forwarded-for'])||null},${clean(request.headers['user-agent'])||null})`;
    const url=createDownloadUrl(asset.storage_key,300);
    if(["1","true","yes"].includes(clean(request.query.redirect).toLowerCase()))return response.redirect(302,url);
    return response.status(200).json({ok:true,url,asset:{id:asset.id,fileName:asset.original_name,mediaType:asset.media_type,mimeType:asset.mime_type,fileSize:asset.file_size,isSensitive:asset.is_sensitive}});
  }
  return response.status(405).json({ok:false,error:"Method not allowed"});
}
