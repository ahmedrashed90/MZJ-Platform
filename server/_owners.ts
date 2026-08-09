import crypto from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "./_db.js";
import { normalizePhone } from "./_phone-utils.js";
import { ensureOwnersSchema } from "./_owners-schema.js";

export const OWNER_SESSION_COOKIE = "mzj_owner_session";
const OWNER_SESSION_DAYS = 30;

function randomReferralCode() { return crypto.randomBytes(6).toString("base64url").toUpperCase(); }
function hash(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function parseCookies(header: string | undefined) {
  const out: Record<string,string> = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("="); if (i < 0) continue;
    out[part.slice(0,i).trim()] = decodeURIComponent(part.slice(i+1).trim());
  }
  return out;
}

export async function awardOwnerPoints(input: { memberId: string; points: number; eventType: string; eventKey: string; referralId?: string | null; description?: string; metadata?: Record<string,unknown> }) {
  const points = Math.trunc(Number(input.points || 0));
  if (!points) return false;
  await ensureOwnersSchema();
  const sql = getSql();
  const rows = await sql<any[]>`
    insert into owners.points_ledger(member_id,points,event_type,event_key,referral_id,description,metadata)
    values(${input.memberId}::uuid,${points},${input.eventType},${input.eventKey},${input.referralId||null}::uuid,${input.description||null},${sql.json(input.metadata||{})})
    on conflict(event_key) do nothing returning id::text
  `;
  if (!rows.length) return false;
  await sql`update owners.members set points_balance=greatest(0,points_balance+${points}),updated_at=now() where id=${input.memberId}::uuid`;
  return true;
}

export async function ensureOwnerMemberForLead(leadId: string, saleId?: string | null) {
  await ensureOwnersSchema();
  const sql = getSql();
  const [sale] = await sql<any[]>`
    select st.id::text as sale_id,st.sale_at,l.id::text as lead_id,l.customer_name,l.phone,l.phone_normalized
    from crm.leads l
    join crm.sales_transactions st on st.lead_id=l.id and coalesce(st.is_cancelled,false)=false
    where l.id=${leadId}::uuid and l.is_deleted=false
      and (${saleId||null}::uuid is null or st.id=${saleId||null}::uuid)
    order by st.sale_at desc,st.created_at desc limit 1
  `;
  const phone = normalizePhone(sale?.phone_normalized || sale?.phone);
  if (!sale || !phone) return null;
  for (let attempt=0; attempt<5; attempt+=1) {
    const code = randomReferralCode();
    try {
      const [member] = await sql<any[]>`
        insert into owners.members(phone_normalized,customer_name,crm_lead_id,source_sale_id,referral_code,first_sale_at,last_sale_at,metadata)
        values(${phone},${sale.customer_name||null},${sale.lead_id}::uuid,${sale.sale_id}::uuid,${code},${sale.sale_at}::timestamptz,${sale.sale_at}::timestamptz,${sql.json({ enrolledFrom: "canonical_sale" })})
        on conflict(phone_normalized) do update set
          customer_name=coalesce(excluded.customer_name,owners.members.customer_name),
          crm_lead_id=coalesce(excluded.crm_lead_id,owners.members.crm_lead_id),
          source_sale_id=coalesce(owners.members.source_sale_id,excluded.source_sale_id),
          first_sale_at=least(coalesce(owners.members.first_sale_at,excluded.first_sale_at),excluded.first_sale_at),
          last_sale_at=greatest(coalesce(owners.members.last_sale_at,excluded.last_sale_at),excluded.last_sale_at),
          status='active',updated_at=now()
        returning *,id::text,crm_lead_id::text,source_sale_id::text
      `;
      return member;
    } catch (error: any) {
      if (!String(error?.message||error).includes("owners_members_referral_code")) throw error;
    }
  }
  throw new Error("تعذر إنشاء كود دعوة فريد للعميل");
}

export async function ensureOwnerMemberByPhone(phoneValue: unknown) {
  await ensureOwnersSchema();
  const phone = normalizePhone(phoneValue);
  if (!phone) return null;
  const sql = getSql();
  const [existing] = await sql<any[]>`select *,id::text,crm_lead_id::text from owners.members where phone_normalized=${phone} and status='active' limit 1`;
  if (existing) return existing;
  const [lead] = await sql<any[]>`
    select l.id::text
    from crm.leads l join crm.sales_transactions st on st.lead_id=l.id and coalesce(st.is_cancelled,false)=false
    where l.is_deleted=false and l.phone_normalized=${phone}
    order by st.sale_at desc limit 1
  `;
  return lead ? ensureOwnerMemberForLead(lead.id) : null;
}

export async function createOwnerSession(request: VercelRequest, response: VercelResponse, memberId: string) {
  await ensureOwnersSchema();
  const sql=getSql(); const token=crypto.randomBytes(32).toString("hex");
  await sql`insert into owners.sessions(token_hash,member_id,expires_at) values(${hash(token)},${memberId}::uuid,now()+${OWNER_SESSION_DAYS}*interval '1 day')`;
  const secure=process.env.VERCEL?"; Secure":"";
  response.setHeader("Set-Cookie",`${OWNER_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${OWNER_SESSION_DAYS*86400}${secure}`);
}

export async function clearOwnerSession(request: VercelRequest,response: VercelResponse) {
  await ensureOwnersSchema();
  const token=parseCookies(request.headers.cookie)[OWNER_SESSION_COOKIE];
  if(token) await getSql()`delete from owners.sessions where token_hash=${hash(token)}`.catch(()=>undefined);
  const secure=process.env.VERCEL?"; Secure":"";
  response.setHeader("Set-Cookie",`${OWNER_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

export async function getOwnerSession(request: VercelRequest) {
  await ensureOwnersSchema();
  const token=parseCookies(request.headers.cookie)[OWNER_SESSION_COOKIE];
  if(!token) return null;
  const sql=getSql();
  const [member]=await sql<any[]>`
    select m.*,m.id::text,m.crm_lead_id::text
    from owners.sessions s join owners.members m on m.id=s.member_id and m.status='active'
    where s.token_hash=${hash(token)} and s.expires_at>now() limit 1
  `;
  if(member) {
    await sql`update owners.sessions set last_seen_at=now() where token_hash=${hash(token)} and last_seen_at<now()-interval '5 minutes'`.catch(()=>undefined);
    await sql`update owners.members set last_login_at=now(),updated_at=now() where id=${member.id}::uuid`.catch(()=>undefined);
  }
  return member||null;
}

export function ownerHash(value: string) { return hash(value); }
