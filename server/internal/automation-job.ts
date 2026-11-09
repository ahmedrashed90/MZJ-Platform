import type { VercelRequest,VercelResponse } from "@vercel/node";
import { safeSecretEquals } from "../_auth.js";
import { processBackgroundJobById } from "../_crm-background-jobs.js";
import { ensureCrmSchema } from "../_crm-schema.js";

function clean(value:unknown){return String(value??"").trim();}
function bodyOf(request:VercelRequest){
  if(request.body&&typeof request.body==="object") return request.body as Record<string,unknown>;
  if(typeof request.body==="string"){try{return JSON.parse(request.body);}catch{return {};}}
  return {};
}

export default async function handler(request:VercelRequest,response:VercelResponse){
  if(request.method!=="POST")return response.status(405).json({ok:false,error:"Method not allowed"});
  const expected=clean(process.env.AUTOMATION_SCHEDULER_SECRET);
  const provided=clean(request.headers["x-mzj-automation-secret"]);
  if(!expected||!provided||!safeSecretEquals(provided,expected))return response.status(401).json({ok:false,error:"Unauthorized scheduler"});
  const body=bodyOf(request);
  const jobId=clean(body.jobId||body.job_id);
  if(!jobId)return response.status(400).json({ok:false,error:"jobId مطلوب"});
  await ensureCrmSchema();
  const result=await processBackgroundJobById(jobId);
  return response.status(200).json({ok:true,...result});
}
