import type { VercelRequest,VercelResponse } from "@vercel/node";
import type { SessionUser } from "../_auth.js";
import { hasPermission,isSystemAdmin } from "../_auth.js";
import { bodyOf,clean,permittedLocationIds } from "../_operations-auth.js";
import { getSql } from "../_db.js";
import { audit,bool,OperationsError,stringOrNull } from "./common.js";
import { reconcileTrackingLinks } from "./vehicles.js";

export async function readMeta(response:VercelResponse,user:SessionUser) {
  await reconcileTrackingLinks();
  const sql=getSql(); const allowed=await permittedLocationIds(user); const all=isSystemAdmin(user);
  const [locations,statuses,checkItems,branches]=await Promise.all([
    sql<any[]>`select l.id::text,l.code,l.name,l.notes,l.sort_order,l.branch_id::text,b.name as branch_name,b.code as branch_code
      from operations.locations l left join core.branches b on b.id=l.branch_id
      where l.is_active=true and (${all} or l.id=any(${allowed}::uuid[])) order by l.sort_order,l.name`,
    sql<any[]>`select code,name,counts_in_inventory,is_final,requires_approvals,is_active,sort_order from operations.vehicle_statuses where is_active=true order by sort_order,name`,
    sql<any[]>`select code,name,sort_order from operations.check_item_definitions where is_active=true order by sort_order`,
    sql<any[]>`select id::text,code,name from core.branches where is_active=true and (${all} or code=any(${user.branchCodes}::text[])) order by sort_order,name`,
  ]);
  return response.status(200).json({ok:true,locations,statuses,checkItems,branches,permissionCodes:all?["*"]:user.permissionCodes,isSystemAdmin:all});
}

export async function saveSetting(request:VercelRequest,response:VercelResponse,user:SessionUser) {
  if (!hasPermission(user,"operations.settings.manage")) return response.status(403).json({ok:false,error:"ليس لديك صلاحية إدارة إعدادات العمليات"});
  const body=bodyOf(request); const entity=clean(body.entity); const sql=getSql();
  try {
    const item=await sql.begin(async(tx)=>{
      if (entity==="location") {
        const id=clean(body.id); const code=clean(body.code).toLowerCase().replace(/\s+/g,"_"); const name=clean(body.name); const branchId=clean(body.branchId)||null;
        if (!code || !name) throw new OperationsError(400,"FIELDS","كود واسم المكان مطلوبان");
        if (!isSystemAdmin(user) && branchId && !user.branchCodes.length) throw new OperationsError(403,"SCOPE","لا يمكن ربط مكان بفرع خارج صلاحيتك");
        let before:any=null,row:any;
        if (id) {
          [before]=await tx<any[]>`select *,id::text from operations.locations where id=${id}::uuid for update`;
          [row]=await tx<any[]>`update operations.locations set code=${code},name=${name},branch_id=${branchId}::uuid,notes=${stringOrNull(body.notes)},sort_order=${Number(body.sortOrder||0)},updated_by=${user.id}::uuid,updated_at=now() where id=${id}::uuid returning *,id::text`;
        } else {
          [row]=await tx<any[]>`insert into operations.locations(code,name,branch_id,notes,sort_order,created_by,updated_by) values (${code},${name},${branchId}::uuid,${stringOrNull(body.notes)},${Number(body.sortOrder||0)},${user.id}::uuid,${user.id}::uuid) returning *,id::text`;
        }
        await audit(tx,request,user,{pageCode:"settings.operations",action:id?"operations.location.updated":"operations.location.created",entityType:"operations_location",entityId:row.id,beforeData:before,afterData:row});
        return row;
      }
      if (entity==="status") {
        const code=clean(body.code).toLowerCase().replace(/\s+/g,"_"); const name=clean(body.name);
        if (!code || !name) throw new OperationsError(400,"FIELDS","كود واسم الحالة مطلوبان");
        const [before]=await tx<any[]>`select * from operations.vehicle_statuses where code=${code} for update`;
        const [row]=await tx<any[]>`insert into operations.vehicle_statuses(code,name,counts_in_inventory,is_final,requires_approvals,sort_order,is_active,created_by,updated_by,updated_at)
          values (${code},${name},${bool(body.countsInInventory)},${bool(body.isFinal)},${bool(body.requiresApprovals)},${Number(body.sortOrder||0)},true,${user.id}::uuid,${user.id}::uuid,now())
          on conflict(code) do update set name=excluded.name,counts_in_inventory=excluded.counts_in_inventory,is_final=excluded.is_final,
            requires_approvals=excluded.requires_approvals,sort_order=excluded.sort_order,is_active=true,updated_by=${user.id}::uuid,updated_at=now() returning *`;
        await audit(tx,request,user,{pageCode:"settings.operations",action:before?"operations.status.updated":"operations.status.created",entityType:"operations_status",entityId:code,beforeData:before,afterData:row});
        return row;
      }
      throw new OperationsError(400,"ENTITY","نوع الإعداد غير مدعوم");
    });
    return response.status(200).json({ok:true,item,message:"تم حفظ إعدادات العمليات"});
  } catch(error:any) {
    if (error instanceof OperationsError) return response.status(error.status).json({ok:false,error:error.message,code:error.code});
    if (error?.code==="23505") return response.status(409).json({ok:false,error:"الكود أو الاسم مستخدم بالفعل"});
    console.error("Save operations setting failed",error); return response.status(500).json({ok:false,error:"تعذر حفظ الإعداد"});
  }
}
