import type { VercelRequest,VercelResponse } from "@vercel/node";
import { getSql } from "./_db.js";
import { clean } from "./_crm-utils.js";
import { deliverDirectWhatsapp } from "./_crm-messaging.js";
import { ensureOwnerMemberForLead } from "./_owners.js";
import { ensureOwnersSchema } from "./_owners-schema.js";

function body(request:VercelRequest){if(request.body&&typeof request.body==='object')return request.body as Record<string,any>;if(typeof request.body==='string'){try{return JSON.parse(request.body||'{}')}catch{return {}}}return {}}
function base(request:VercelRequest){const proto=String(request.headers['x-forwarded-proto']||'https').split(',')[0];const host=String(request.headers['x-forwarded-host']||request.headers.host||'mzj-platform.vercel.app').split(',')[0];return `${proto}://${host}`;}
function renderNumbered(content:string,values:string[]){return String(content||'').replace(/{{\s*(\d+)\s*}}/g,(_m,n)=>values[Number(n)-1]||'');}
async function syncMembers(){
  const sql=getSql(); const rows=await sql<any[]>`select distinct on(l.phone_normalized) l.id::text,st.id::text sale_id from crm.sales_transactions st join crm.leads l on l.id=st.lead_id and l.is_deleted=false where coalesce(st.is_cancelled,false)=false and nullif(l.phone_normalized,'') is not null order by l.phone_normalized,st.sale_at desc`;
  let synced=0; for(const r of rows){if(await ensureOwnerMemberForLead(r.id,r.sale_id))synced+=1;} return synced;
}
async function syncReferralSales(){
  const sql=getSql(); const [s]=await sql<any[]>`select * from owners.settings where id='default'`; const rows=await sql<any[]>`select r.id::text,r.referrer_member_id::text,r.crm_lead_id::text,l.status_label,st.id::text sale_id,st.sale_at from owners.referrals r left join crm.leads l on l.id=r.crm_lead_id and l.is_deleted=false left join lateral(select id,sale_at from crm.sales_transactions where lead_id=r.crm_lead_id and coalesce(is_cancelled,false)=false order by sale_at desc limit 1) st on true where r.status<>'sold'`;
  const { awardOwnerPoints }=await import('./_owners.js'); let changed=0;
  for(const r of rows){const status=clean(r.status_label);const qualified=Boolean(status&&!['عميل جديد','لم يتم الرد','غير مؤهل'].includes(status));if(qualified){await sql`update owners.referrals set status='qualified',qualified_at=coalesce(qualified_at,now()),updated_at=now() where id=${r.id}::uuid and status in('clicked','registered')`;await awardOwnerPoints({memberId:r.referrer_member_id,points:Number(s?.points_qualified||0),eventType:'qualified',eventKey:`qualified:${r.id}`,referralId:r.id,description:'تحول الصديق إلى عميل مؤهل'});changed+=1;}if(r.sale_id){await sql`update owners.referrals set status='sold',sale_transaction_id=${r.sale_id}::uuid,sold_at=${r.sale_at}::timestamptz,qualified_at=coalesce(qualified_at,now()),updated_at=now() where id=${r.id}::uuid`;await awardOwnerPoints({memberId:r.referrer_member_id,points:Number(s?.points_sale||0),eventType:'sale',eventKey:`sale:${r.sale_id}`,referralId:r.id,description:'أتم الصديق عملية شراء'});if(r.crm_lead_id)await ensureOwnerMemberForLead(r.crm_lead_id,r.sale_id);changed+=1;}}
  return changed;
}

export default async function handler(request:VercelRequest,response:VercelResponse){
  await ensureOwnersSchema(); response.setHeader('Cache-Control','no-store'); const sql=getSql(); const payload=body(request); const action=clean(payload.action||request.query.action);
  if(request.method==='GET'){
    const scope=clean(request.query.scope);
    if(scope==='settings'){
      const [settingsRows,templates]=await Promise.all([sql<any[]>`select * from owners.settings where id='default'`,sql<any[]>`select id::text,name,display_name,content,provider,template_type,language_code from crm.message_templates where is_active=true and status='active' and (external_id is not null or lower(coalesce(provider,'')) like '%mersal%' or lower(coalesce(template_type,'')) like '%whatsapp%') order by display_name,name`]);
      return response.status(200).json({ok:true,settings:settingsRows[0]||{},templates});
    }
    const [settings,templates,members,referrals,rewards,redemptions,stats]=await Promise.all([
      sql<any[]>`select * from owners.settings where id='default'`.then(r=>r[0]),
      sql<any[]>`select id::text,name,display_name,content,provider,template_type,language_code from crm.message_templates where is_active=true and status='active' and (external_id is not null or lower(coalesce(provider,'')) like '%mersal%' or lower(coalesce(template_type,'')) like '%whatsapp%') order by display_name,name`,
      sql<any[]>`select m.id::text,m.customer_name,m.phone_normalized,m.referral_code,m.points_balance,m.tier_code,m.first_sale_at,m.last_sale_at,m.last_login_at,m.welcome_sent_at,count(distinct r.id)::int referrals_count,count(distinct r.id) filter(where r.status='sold')::int sales_count from owners.members m left join owners.referrals r on r.referrer_member_id=m.id where m.status='active' group by m.id order by m.created_at desc limit 500`,
      sql<any[]>`select r.id::text,r.status,r.referred_name,r.referred_phone_normalized,r.registered_at,r.qualified_at,r.sold_at,m.customer_name referrer_name,m.referral_code from owners.referrals r join owners.members m on m.id=r.referrer_member_id order by r.created_at desc limit 500`,
      sql<any[]>`select *,id::text,created_by::text,updated_by::text from owners.rewards order by is_active desc,points_cost,name`,
      sql<any[]>`select rd.id::text,rd.status,rd.points_cost,rd.note,rd.created_at,rd.reviewed_at,m.customer_name,m.phone_normalized,r.name reward_name from owners.redemptions rd join owners.members m on m.id=rd.member_id join owners.rewards r on r.id=rd.reward_id order by rd.created_at desc limit 300`,
      sql<any[]>`select (select count(*) from owners.members where status='active')::int members,(select count(*) from owners.referrals)::int referrals,(select count(*) from owners.referrals where status='sold')::int referral_sales,(select coalesce(sum(points_balance),0) from owners.members where status='active')::int outstanding_points,(select count(*) from owners.redemptions where status='requested')::int pending_redemptions`
    ]);
    return response.status(200).json({ok:true,settings,templates,members,referrals,rewards,redemptions,stats:stats[0]||{}});
  }
  if(request.method!=='POST')return response.status(405).json({ok:false,error:'Method not allowed'});
  if(action==='save_settings'){
    const [row]=await sql<any[]>`update owners.settings set is_enabled=${payload.isEnabled!==false},otp_template_id=${clean(payload.otpTemplateId)||null}::uuid,welcome_template_id=${clean(payload.welcomeTemplateId)||null}::uuid,otp_expiry_minutes=${Number(payload.otpExpiryMinutes||5)},otp_resend_seconds=${Number(payload.otpResendSeconds||60)},otp_max_attempts=${Number(payload.otpMaxAttempts||5)},points_unique_open=${Number(payload.pointsUniqueOpen||0)},points_registration=${Number(payload.pointsRegistration||0)},points_qualified=${Number(payload.pointsQualified||0)},points_sale=${Number(payload.pointsSale||0)},daily_open_points_cap=${Number(payload.dailyOpenPointsCap||0)},referral_default_service=${clean(payload.referralDefaultService)||'cash'},referral_default_branch=${clean(payload.referralDefaultBranch)||'online'},friend_benefit_title=${clean(payload.friendBenefitTitle)||'ميزة خاصة من عميل MZJ'},friend_benefit_text=${clean(payload.friendBenefitText)||'سجل بياناتك وسيقوم فريق MZJ بالتواصل معك.'},welcome_message_enabled=${payload.welcomeMessageEnabled===true},updated_by=${clean(payload.actorId)||null}::uuid,updated_at=now() where id='default' returning *`;return response.status(200).json({ok:true,settings:row});
  }
  if(action==='sync_members'){const synced=await syncMembers();const referrals=await syncReferralSales();return response.status(200).json({ok:true,synced,referrals});}
  if(action==='save_reward'){
    const id=clean(payload.id); const fields={name:clean(payload.name),description:clean(payload.description),cost:Math.max(1,Number(payload.pointsCost||1)),stock:payload.stockQuantity===''||payload.stockQuantity==null?null:Math.max(0,Number(payload.stockQuantity)),starts:clean(payload.startsAt)||null,ends:clean(payload.endsAt)||null,active:payload.isActive!==false}; if(!fields.name)return response.status(400).json({ok:false,error:'اسم المكافأة مطلوب'});
    if(id)await sql`update owners.rewards set name=${fields.name},description=${fields.description||null},points_cost=${fields.cost},stock_quantity=${fields.stock},starts_at=${fields.starts}::timestamptz,ends_at=${fields.ends}::timestamptz,is_active=${fields.active},updated_at=now() where id=${id}::uuid`; else await sql`insert into owners.rewards(name,description,points_cost,stock_quantity,starts_at,ends_at,is_active) values(${fields.name},${fields.description||null},${fields.cost},${fields.stock},${fields.starts}::timestamptz,${fields.ends}::timestamptz,${fields.active})`;return response.status(200).json({ok:true});
  }
  if(action==='redemption'){
    const id=clean(payload.id),status=clean(payload.status); if(!['approved','delivered','rejected','cancelled'].includes(status))return response.status(400).json({ok:false,error:'حالة الطلب غير صحيحة'}); const [rd]=await sql<any[]>`select *,member_id::text,reward_id::text from owners.redemptions where id=${id}::uuid for update`;if(!rd)return response.status(404).json({ok:false,error:'طلب الاستبدال غير موجود'});
    await sql.begin(async(tx:any)=>{if(['rejected','cancelled'].includes(status)&&!['rejected','cancelled'].includes(rd.status)){await tx`insert into owners.points_ledger(member_id,points,event_type,event_key,reward_id,description) values(${rd.member_id}::uuid,${Number(rd.points_cost)},'redemption_refund',${`redemption-refund:${rd.id}`},${rd.reward_id}::uuid,'إرجاع نقاط طلب استبدال ملغي') on conflict(event_key) do nothing`;await tx`update owners.members set points_balance=points_balance+${Number(rd.points_cost)},updated_at=now() where id=${rd.member_id}::uuid`;await tx`update owners.rewards set redeemed_quantity=greatest(0,redeemed_quantity-1),updated_at=now() where id=${rd.reward_id}::uuid`;}await tx`update owners.redemptions set status=${status},note=${clean(payload.note)||null},reviewed_at=now(),updated_at=now() where id=${id}::uuid`;});return response.status(200).json({ok:true});
  }
  if(action==='send_welcome'){
    const memberId=clean(payload.memberId);const [s]=await sql<any[]>`select * from owners.settings where id='default'`;if(!s?.welcome_template_id)return response.status(400).json({ok:false,error:'حدد قالب الترحيب المعتمد من مرسال أولًا'});const [m]=await sql<any[]>`select *,id::text from owners.members where id=${memberId}::uuid and status='active'`;const [t]=await sql<any[]>`select *,id::text from crm.message_templates where id=${s.welcome_template_id}::uuid and is_active=true`;if(!m||!t)return response.status(404).json({ok:false,error:'العميل أو القالب غير موجود'});const portal=`${base(request)}/owners`;const invite=`${base(request)}/owners/invite/${m.referral_code}`;const text=renderNumbered(t.content,[m.customer_name||'عميل MZJ',portal,invite]);await deliverDirectWhatsapp({phone:m.phone_normalized,text,template:t,idempotencyKey:`owners-welcome:${m.id}`,reason:'owners_welcome'});await sql`update owners.members set welcome_sent_at=now(),updated_at=now() where id=${m.id}::uuid`;return response.status(200).json({ok:true});
  }
  return response.status(400).json({ok:false,error:'الإجراء غير معروف'});
}
