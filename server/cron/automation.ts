import type { VercelRequest,VercelResponse } from "@vercel/node";
import { safeSecretEquals } from "../_auth.js";
import { ensureCrmSchema } from "../_crm-schema.js";
import { processDueAutomationJobs } from "../_crm-automation.js";
function clean(v:unknown){return String(v??"").trim()}
export default async function handler(request:VercelRequest,response:VercelResponse){
  if(!["GET","POST"].includes(request.method||""))return response.status(405).json({ok:false,error:"Method not allowed"});
  const secret=clean(process.env.CRON_SECRET);if(secret){const auth=clean(request.headers.authorization).replace(/^Bearer\s+/i,"");if(!safeSecretEquals(auth,secret))return response.status(401).json({ok:false,error:"Unauthorized cron"});}
  await ensureCrmSchema();const result=await processDueAutomationJobs(100);return response.status(200).json({ok:true,...result});
}
