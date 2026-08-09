import crypto from "node:crypto";
import type { VercelRequest,VercelResponse } from "@vercel/node";
import { getSql } from "./_db.js";
import { normalizePhone } from "./_phone-utils.js";
import { chooseAssignment, clean } from "./_crm-utils.js";
import { attachLeadToContactAndOpenRequest } from "./_crm-lifecycle.js";
import { deliverDirectWhatsapp } from "./_crm-messaging.js";
import { awardOwnerPoints, clearOwnerSession, createOwnerSession, ensureOwnerMemberByPhone, getOwnerSession, ownerHash } from "./_owners.js";
import { ensureOwnersSchema } from "./_owners-schema.js";

function body(request:VercelRequest){if(request.body&&typeof request.body==='object')return request.body as Record<string,any>;if(typeof request.body==='string'){try{return JSON.parse(request.body||'{}')}catch{return {}}}return {}}
function randomOtp(){return String(crypto.randomInt(100000,1000000));}
function renderNumbered(content:string,values:string[]){return String(content||'').replace(/{{\s*(\d+)\s*}}/g,(_m,n)=>values[Number(n)-1]||'');}
function publicBase(request:VercelRequest){const proto=String(request.headers['x-forwarded-proto']||'https').split(',')[0];const host=String(request.headers['x-forwarded-host']||request.headers.host||'mzj-platform.vercel.app').split(',')[0];return `${proto}://${host}`;}
async function settings(){const [row]=await getSql()<any[]>`select * from owners.settings where id='default'`;return row;}
async function syncReferralProgress(memberId?:string){
  await ensureOwnersSchema(); const sql=getSql(); const s=await settings();
  const rows=await sql<any[]>`
    select r.*,r.id::text,r.referrer_member_id::text,r.crm_lead_id::text,l.status_label,
      st.id::text as sale_id,st.sale_at
    from owners.referrals r
    left join crm.leads l on l.id=r.crm_lead_id and l.is_deleted=false
    left join lateral(select id,sale_at from crm.sales_transactions where lead_id=r.crm_lead_id and coalesce(is_cancelled,false)=false order by sale_at desc limit 1) st on true
    where (${memberId||null}::uuid is null or r.referrer_member_id=${memberId||null}::uuid)
      and r.status in ('registered','qualified','clicked')
  `;
  for(const r of rows){
    const status=clean(r.status_label);
    const qualified=Boolean(status && !['عميل جديد','لم يتم الرد','غير مؤهل'].includes(status));
    if(qualified && !r.qualified_at){
      await sql`update owners.referrals set status='qualified',qualified_at=now(),updated_at=now() where id=${r.id}::uuid`;
      await awardOwnerPoints({memberId:r.referrer_member_id,points:Number(s?.points_qualified||0),eventType:'qualified',eventKey:`qualified:${r.id}`,referralId:r.id,description:'تحول الصديق إلى عميل مؤهل'});
    }
    if(r.sale_id){
      await sql`update owners.referrals set status='sold',sale_transaction_id=${r.sale_id}::uuid,sold_at=${r.sale_at}::timestamptz,qualified_at=coalesce(qualified_at,now()),updated_at=now() where id=${r.id}::uuid`;
      await awardOwnerPoints({memberId:r.referrer_member_id,points:Number(s?.points_sale||0),eventType:'sale',eventKey:`sale:${r.sale_id}`,referralId:r.id,description:'أتم الصديق عملية شراء'});
      if(r.crm_lead_id) await (await import('./_owners.js')).ensureOwnerMemberForLead(r.crm_lead_id,r.sale_id).catch(()=>null);
    }
  }
}

export default async function handler(request:VercelRequest,response:VercelResponse){
  await ensureOwnersSchema(); response.setHeader('Cache-Control','no-store'); const sql=getSql(); const action=clean(request.query.action||body(request).action);
  if(request.method==='GET'&&action==='invite'){
    const code=clean(request.query.code); const visitor=clean(request.query.visitor); if(!code)return response.status(400).json({ok:false,error:'رابط الدعوة غير صحيح'});
    const [member]=await sql<any[]>`select id::text,customer_name,referral_code from owners.members where referral_code=${code} and status='active' limit 1`;
    if(!member)return response.status(404).json({ok:false,error:'رابط الدعوة غير صالح'});
    const s=await settings();
    if(visitor){
      const inserted=await sql<any[]>`insert into owners.referral_visits(referrer_member_id,visitor_hash,ip_hash,user_agent) values(${member.id}::uuid,${ownerHash(visitor)},${ownerHash(String(request.headers['x-forwarded-for']||request.socket?.remoteAddress||''))},${String(request.headers['user-agent']||'').slice(0,500)}) on conflict do nothing returning id::text`;
      if(inserted.length&&Number(s?.points_unique_open||0)>0){
        const [today]=await sql<any[]>`select coalesce(sum(points),0)::int total from owners.points_ledger where member_id=${member.id}::uuid and event_type='unique_open' and created_at>=(current_date::timestamp at time zone 'Asia/Riyadh')`;
        if(Number(today?.total||0)<Number(s?.daily_open_points_cap||0)) await awardOwnerPoints({memberId:member.id,points:Number(s.points_unique_open),eventType:'unique_open',eventKey:`open:${member.id}:${ownerHash(visitor)}`,description:'فتح صديق رابط الدعوة'});
      }
    }
    return response.status(200).json({ok:true,referrerName:member.customer_name||'عميل MZJ',benefitTitle:s?.friend_benefit_title,benefitText:s?.friend_benefit_text});
  }
  if(request.method==='POST'&&action==='register_referral'){
    const p=body(request); const code=clean(p.code); const name=clean(p.name); const phone=normalizePhone(p.phone); if(!code||!name||!phone)return response.status(400).json({ok:false,error:'الاسم ورقم الجوال مطلوبان'});
    const [referrer]=await sql<any[]>`select id::text,phone_normalized from owners.members where referral_code=${code} and status='active' limit 1`;
    if(!referrer)return response.status(404).json({ok:false,error:'رابط الدعوة غير صالح'}); if(referrer.phone_normalized===phone)return response.status(400).json({ok:false,error:'لا يمكن استخدام رابط دعوتك لنفسك'});
    const [existingOwner]=await sql<any[]>`select id::text from owners.members where phone_normalized=${phone} and status='active' limit 1`;
    if(existingOwner)return response.status(409).json({ok:false,error:'هذا الرقم عضو بالفعل في MZJ Owners Community'});
    const [linkedReferral]=await sql<any[]>`select id::text,referrer_member_id::text from owners.referrals where referred_phone_normalized=${phone} limit 1`;
    if(linkedReferral&&linkedReferral.referrer_member_id!==referrer.id)return response.status(409).json({ok:false,error:'هذا الرقم مرتبط بدعوة سابقة'});
    const s=await settings(); let [lead]=await sql<any[]>`select id::text from crm.leads where phone_normalized=${phone} and is_deleted=false limit 1`;
    if(lead){const [priorSale]=await sql<any[]>`select id::text from crm.sales_transactions where lead_id=${lead.id}::uuid and coalesce(is_cancelled,false)=false limit 1`;if(priorSale)return response.status(409).json({ok:false,error:'هذا الرقم سبق له الشراء ولا يمكن احتسابه كإحالة جديدة'});}
    if(!lead){
      const service=clean(s?.referral_default_service)||'cash'; const preferredBranch=clean(s?.referral_default_branch); const assignment=await chooseAssignment(service,preferredBranch,'owners_referral');
      const department=service==='finance'?'finance_sales':service==='service'?'customer_service':'cash_sales'; const payment=service==='finance'?'تمويل':service==='service'?'خدمة عملاء':'كاش';
      [lead]=await sql<any[]>`insert into crm.leads(customer_name,phone,phone_normalized,source_code,source_name,service_key,department_code,branch_code,status_label,payment_type,assigned_to,responsible_name_snapshot,registered_at,notes,extra_data) values(${name},${phone},${phone},'owners_referral','MZJ Owners Community',${service},${department},${assignment.branchCode||preferredBranch||null},'عميل جديد',${payment},${assignment.assignedTo||null}::uuid,${assignment.assignedName||null},now(),'تم التسجيل من رابط دعوة MZJ Owners Community',${sql.json({ownerReferralCode:code,referrerMemberId:referrer.id})}) returning id::text`;
      await attachLeadToContactAndOpenRequest({leadId:lead.id,actor:null as any,classificationMethod:'owners_referral'}).catch(()=>undefined);
    }
    const [referral]=await sql<any[]>`insert into owners.referrals(referrer_member_id,referred_name,referred_phone_normalized,crm_lead_id,status,registered_at,metadata) values(${referrer.id}::uuid,${name},${phone},${lead.id}::uuid,'registered',now(),${sql.json({source:'public_invite'})}) on conflict(referred_phone_normalized) where referred_phone_normalized is not null do update set referred_name=excluded.referred_name,crm_lead_id=coalesce(owners.referrals.crm_lead_id,excluded.crm_lead_id),registered_at=coalesce(owners.referrals.registered_at,excluded.registered_at),status=case when owners.referrals.status='clicked' then 'registered' else owners.referrals.status end,updated_at=now() returning id::text`;
    await awardOwnerPoints({memberId:referrer.id,points:Number(s?.points_registration||0),eventType:'registration',eventKey:`registration:${referral.id}`,referralId:referral.id,description:'سجل صديق جديد من رابط الدعوة'});
    return response.status(200).json({ok:true,message:'تم تسجيل بياناتك وسيقوم فريق MZJ بالتواصل معك'});
  }
  if(request.method==='POST'&&action==='request_otp'){
    const p=body(request); const phone=normalizePhone(p.phone); if(!phone)return response.status(400).json({ok:false,error:'اكتب رقم جوال صحيح'}); const s=await settings(); if(s?.is_enabled===false)return response.status(403).json({ok:false,error:'MZJ Owners Community غير متاح حاليًا'});
    const member=await ensureOwnerMemberByPhone(phone); if(!member)return response.status(404).json({ok:false,error:'رقم الجوال غير مرتبط بعملية شراء مكتملة من MZJ'});
    const [last]=await sql<any[]>`select created_at from owners.otp_challenges where phone_normalized=${phone} order by created_at desc limit 1`;
    if(last&&Date.now()-new Date(last.created_at).getTime()<Number(s?.otp_resend_seconds||60)*1000)return response.status(429).json({ok:false,error:'انتظر قليلًا قبل طلب رمز جديد'});
    if(!s?.otp_template_id)return response.status(503).json({ok:false,error:'لم يتم ضبط قالب OTP المعتمد من مرسال في إعدادات البرنامج'});
    const [template]=await sql<any[]>`select *,id::text from crm.message_templates where id=${s.otp_template_id}::uuid and is_active=true limit 1`; if(!template)return response.status(503).json({ok:false,error:'قالب OTP المحدد غير متاح'});
    const otp=randomOtp(); const [challenge]=await sql<any[]>`insert into owners.otp_challenges(phone_normalized,code_hash,max_attempts,expires_at) values(${phone},${ownerHash(otp)},${Number(s.otp_max_attempts||5)},now()+${Number(s.otp_expiry_minutes||5)}*interval '1 minute') returning id::text`;
    const text=renderNumbered(template.content,[otp]); try{await deliverDirectWhatsapp({phone,text,template,idempotencyKey:`owners-otp:${challenge.id}`,reason:'owners_otp'});}catch(error:any){await sql`delete from owners.otp_challenges where id=${challenge.id}::uuid`;return response.status(502).json({ok:false,error:error?.message||'تعذر إرسال رمز التحقق عبر واتساب'});}
    return response.status(200).json({ok:true,challengeId:challenge.id,expiresMinutes:Number(s.otp_expiry_minutes||5)});
  }
  if(request.method==='POST'&&action==='verify_otp'){
    const p=body(request); const phone=normalizePhone(p.phone); const code=clean(p.code); const id=clean(p.challengeId); if(!phone||!/^[0-9]{6}$/.test(code)||!id)return response.status(400).json({ok:false,error:'بيانات التحقق غير مكتملة'});
    const [ch]=await sql<any[]>`select * from owners.otp_challenges where id=${id}::uuid and phone_normalized=${phone} and consumed_at is null limit 1`; if(!ch||new Date(ch.expires_at).getTime()<Date.now())return response.status(400).json({ok:false,error:'رمز التحقق منتهي أو غير صالح'}); if(Number(ch.attempts)>=Number(ch.max_attempts))return response.status(429).json({ok:false,error:'تم تجاوز عدد المحاولات المسموح'});
    if(ownerHash(code)!==ch.code_hash){await sql`update owners.otp_challenges set attempts=attempts+1 where id=${id}::uuid`;return response.status(400).json({ok:false,error:'رمز التحقق غير صحيح'});}
    const member=await ensureOwnerMemberByPhone(phone); if(!member)return response.status(404).json({ok:false,error:'عضوية العميل غير موجودة'}); await sql`update owners.otp_challenges set consumed_at=now() where id=${id}::uuid`; await createOwnerSession(request,response,member.id); return response.status(200).json({ok:true});
  }
  if(request.method==='POST'&&action==='logout'){await clearOwnerSession(request,response);return response.status(200).json({ok:true});}
  const member=await getOwnerSession(request); if(!member)return response.status(401).json({ok:false,error:'يجب تسجيل الدخول'}); await syncReferralProgress(member.id);
  if(request.method==='GET'&&action==='me'){
    const referrals=await sql<any[]>`select id::text,referred_name,status,registered_at,qualified_at,sold_at,created_at from owners.referrals where referrer_member_id=${member.id}::uuid order by created_at desc limit 100`;
    const ledger=await sql<any[]>`select id::text,points,event_type,description,created_at from owners.points_ledger where member_id=${member.id}::uuid order by created_at desc limit 100`;
    const rewards=await sql<any[]>`select id::text,name,description,points_cost,stock_quantity,redeemed_quantity,starts_at,ends_at from owners.rewards where is_active=true and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>=now()) and (stock_quantity is null or redeemed_quantity<stock_quantity) order by points_cost,name`;
    const redemptions=await sql<any[]>`select rd.id::text,rd.status,rd.points_cost,rd.created_at,r.name reward_name from owners.redemptions rd join owners.rewards r on r.id=rd.reward_id where rd.member_id=${member.id}::uuid order by rd.created_at desc limit 50`;
    return response.status(200).json({ok:true,member:{id:member.id,name:member.customer_name,phone:member.phone_normalized,points:Number(member.points_balance||0),tier:member.tier_code,referralCode:member.referral_code,inviteUrl:`${publicBase(request)}/owners/invite/${member.referral_code}`},referrals,ledger,rewards,redemptions});
  }
  if(request.method==='POST'&&action==='redeem'){
    const rewardId=clean(body(request).rewardId); if(!rewardId)return response.status(400).json({ok:false,error:'المكافأة مطلوبة'});
    const result=await sql.begin(async(tx:any)=>{const [m]=await tx<any[]>`select points_balance from owners.members where id=${member.id}::uuid for update`;const [r]=await tx<any[]>`select * from owners.rewards where id=${rewardId}::uuid and is_active=true and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>=now()) for update`;if(!r)throw new Error('المكافأة غير متاحة');if(r.stock_quantity!=null&&Number(r.redeemed_quantity)>=Number(r.stock_quantity))throw new Error('نفدت كمية المكافأة');if(Number(m.points_balance)<Number(r.points_cost))throw new Error('رصيد النقاط غير كاف');const [rd]=await tx<any[]>`insert into owners.redemptions(member_id,reward_id,points_cost) values(${member.id}::uuid,${rewardId}::uuid,${Number(r.points_cost)}) returning id::text`;await tx`insert into owners.points_ledger(member_id,points,event_type,event_key,reward_id,description) values(${member.id}::uuid,${-Number(r.points_cost)},'redemption',${`redemption:${rd.id}`},${rewardId}::uuid,${`طلب استبدال: ${r.name}`})`;await tx`update owners.members set points_balance=points_balance-${Number(r.points_cost)},updated_at=now() where id=${member.id}::uuid`;await tx`update owners.rewards set redeemed_quantity=redeemed_quantity+1,updated_at=now() where id=${rewardId}::uuid`;return rd;}).catch((e:any)=>({error:e.message})); if((result as any).error)return response.status(400).json({ok:false,error:(result as any).error});return response.status(200).json({ok:true});
  }
  return response.status(405).json({ok:false,error:'Method not allowed'});
}
