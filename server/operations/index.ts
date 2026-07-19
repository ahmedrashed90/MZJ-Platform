import type { VercelRequest,VercelResponse } from "@vercel/node";
import { bodyOf,clean,ensureOperationsSchema,requireOperationsPermission } from "../_operations-auth.js";
import { archiveVehicle,getApproval,listApprovals,updateApproval } from "./approvals.js";
import { importVehicles } from "./import.js";
import { readMeta,saveSetting } from "./meta.js";
import { executeMovement,listMovements } from "./movements.js";
import { advanceRequest,cancelRequest,createRequest,deleteRequest,listRequests,overrideRequest } from "./requests.js";
import { allVehiclesReport,auditReport,trackingDetails } from "./reports.js";
import { getVehicle,listVehicles,saveVehicle } from "./vehicles.js";

function resourceOf(request:VercelRequest) { return clean(request.query.resource) || "meta"; }

export default async function handler(request:VercelRequest,response:VercelResponse) {
  response.setHeader("Cache-Control","no-store");
  try {
    await ensureOperationsSchema();
    const resource=resourceOf(request);
    const basePermission:Record<string,string>={
      meta:"operations.view",vehicles:"operations.vehicles.view",import:"operations.vehicles.import",
      movements:request.method==="GET"?"operations.movements.view":"operations.view",
      requests:"operations.view",approvals:"operations.approvals.view",archive:request.method==="GET"?"operations.archive.view":"operations.view",
      reports:"operations.vehicles.view",settings:"operations.settings.manage",audit:"operations.audit.view",tracking:"operations.tracking.view",
    };
    const user=await requireOperationsPermission(request,response,basePermission[resource] || "operations.view");
    if (!user) return;

    if (request.method==="GET") {
      if (resource==="meta") return readMeta(response,user);
      if (resource==="vehicles") return clean(request.query.id)?getVehicle(request,response,user):listVehicles(request,response,user);
      if (resource==="movements") return listMovements(request,response,user);
      if (resource==="requests") return listRequests(request,response,user);
      if (resource==="approvals") return clean(request.query.id)?getApproval(request,response,user):listApprovals(request,response,user);
      if (resource==="archive") { request.query.archived="only"; return listVehicles(request,response,user); }
      if (resource==="reports") return allVehiclesReport(request,response,user);
      if (resource==="audit") return auditReport(request,response,user);
      if (resource==="tracking") return trackingDetails(request,response,user);
      return response.status(404).json({ok:false,error:"مصدر بيانات العمليات غير موجود"});
    }

    if (request.method==="POST") {
      if (resource==="vehicles") return saveVehicle(request,response,user);
      if (resource==="import") return importVehicles(request,response,user);
      if (resource==="movements") return executeMovement(request,response,user);
      if (resource==="approvals") return updateApproval(request,response,user);
      if (resource==="archive") return archiveVehicle(request,response,user);
      if (resource==="settings") return saveSetting(request,response,user);
      if (resource==="requests") {
        const action=clean(bodyOf(request).action);
        if (action==="advance") return advanceRequest(request,response,user);
        if (action==="cancel") return cancelRequest(request,response,user);
        if (action==="override") return overrideRequest(request,response,user);
        return createRequest(request,response,user);
      }
      return response.status(404).json({ok:false,error:"إجراء العمليات غير موجود"});
    }

    if (request.method==="DELETE" && resource==="requests") return deleteRequest(request,response,user);
    return response.status(405).json({ok:false,error:"طريقة الطلب غير مدعومة"});
  } catch(error:any) {
    console.error("Operations API failed",error);
    if (error?.code==="23505") return response.status(409).json({ok:false,error:"القيمة مسجلة بالفعل أو حدث تنفيذ متزامن"});
    if (error?.code==="23503") return response.status(400).json({ok:false,error:"أحد المراجع المختارة غير صحيح"});
    if (error?.code==="DATABASE_NOT_CONFIGURED") return response.status(503).json({ok:false,error:"قاعدة PostgreSQL غير مرتبطة"});
    if (!response.headersSent) return response.status(500).json({ok:false,error:"حدث خطأ داخل نظام العمليات ولم يتم حفظ بيانات جزئية"});
  }
}
