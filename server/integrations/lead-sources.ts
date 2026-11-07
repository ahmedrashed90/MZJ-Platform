import type { VercelRequest, VercelResponse } from "@vercel/node";
import { safeSecretEquals } from "../_auth.js";
import { ensureCrmSchema } from "../_crm-schema.js";
import { getSql } from "../_db.js";

const CODE = /^[a-z][a-z0-9_]{2,47}$/;
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ok:false,error:"Method not allowed"});
  const secret = String(process.env.MZJ_GATEWAY_SECRET || "").trim();
  if (!secret) return res.status(503).json({ok:false,error:"Gateway secret not configured"});
  if (!safeSecretEquals(String(req.headers["x-mzj-gateway-secret"] || "").trim(), secret)) return res.status(401).json({ok:false,error:"Unauthorized"});
  try {
    await ensureCrmSchema();
    const sql = getSql();
    if (req.method === "GET") {
      const code = String(req.query.code || "").trim().toLowerCase();
      if (!CODE.test(code)) return res.status(400).json({ok:false,error:"Invalid source code"});
      const [row] = await sql<{code:string,name:string,is_active:boolean}[]>`select code,name,is_active from core.sources where code=${code} limit 1`;
      return res.status(200).json({ok:true,registered:!!row?.is_active,source:row || null});
    }
    const input = req.body && typeof req.body === "object" ? req.body : JSON.parse(String(req.body || "{}"));
    const code = String(input.code || "").trim().toLowerCase();
    const name = String(input.name || "").trim();
    if (!CODE.test(code) || name.length < 2 || name.length > 90 || /[\u0000-\u001f]/.test(name)) return res.status(400).json({ok:false,error:"Invalid source code or name"});
    // Never overwrite the existing catalog or its routing metadata; sources are created once.
    const [already] = await sql<{code:string,name:string,is_active:boolean}[]>`select code,name,is_active from core.sources where code=${code} limit 1`;
    if (already) {
      if (already.name !== name || !already.is_active) return res.status(409).json({ok:false,error:"Source code already exists with different name or inactive status",source:already});
      return res.status(200).json({ok:true,registered:true,source:already,created:false});
    }
    const [existingName] = await sql<{code:string}[]>`select code from core.sources where name=${name} limit 1`;
    if (existingName) return res.status(409).json({ok:false,error:"Source name already registered under another code"});
    const [row] = await sql<{code:string,name:string,is_active:boolean}[]>`
      insert into core.sources(code,name,sort_order,is_active,system_codes,delivery_route,allow_free_text,report_group)
      values(${code},${name},110,true,array['crm'],'whatsapp',false,'digital')
      on conflict(code) do nothing returning code,name,is_active
    `;
    const [crm] = await sql<{code:string}[]>`
      insert into crm.sources(code,name,sort_order,is_active) values(${code},${name},110,true)
      on conflict(code) do nothing returning code
    `;
    if (!row) {
      const [current] = await sql<{code:string,name:string,is_active:boolean}[]>`select code,name,is_active from core.sources where code=${code}`;
      if (current?.name !== name || !current?.is_active) return res.status(409).json({ok:false,error:"Concurrent conflicting source creation"});
    }
    return res.status(200).json({ok:true,registered:true,source:row || {code,name,is_active:true},created:!!row,crmCatalogAdded:!!crm});
  } catch (error) { console.error("CRM source registry failed",error); return res.status(503).json({ok:false,error:"CRM source registry unavailable"}); }
}
