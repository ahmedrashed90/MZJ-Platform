/**
 * Marketing-form -> CRM bridge. Reuses the existing inbound lead-import workflow,
 * including its deduplication, ownership and notification rules. This module does
 * not change CRM routing, CRM schema or any advertising-platform integration.
 */
import { getSql, withDatabaseAdvisoryLock } from '../_db.js';
import { ensureCrmSchema } from '../_crm-schema.js';
import { normalizePhone } from '../_phone-utils.js';
import { processLeadImportEvent } from '../_crm-lead-import.js';
import { isRecoverableMarketingFormLead } from '../_crm-lifecycle.js';
import { createNotification, notificationDedupe } from '../_notifications.js';
import { formPurchasePreference } from './form-lead-routing.js';
import { formCrmAnswers, sanitizeFormCrmFields } from '../../shared/lead-form-crm-fields.js';
import { saveMarketingFormProfile } from './form-crm-profile.js';

const trim = (value: unknown, limit = 200) => String(value ?? '').trim().slice(0, limit);

type FormLeadToSync = {
  id: string; form_id: string; name: string; phone: string;
  source: string; campaign: string; medium: string; ad_id: string;
  answers: Record<string, string>; answer_labels: Record<string, string>; answer_crm_fields?: Record<string,unknown>;
  crm_status: string; crm_lead_id: string | null; created_at: string;
};

/** Only known advertising UTM sources may claim an advertising CRM source. */
export function crmSourceForForm(utmSource: unknown) {
  const source = trim(utmSource, 80).toLowerCase();
  if (['facebook', 'fb', 'facebook_lead'].includes(source)) return 'facebook_lead';
  if (['instagram', 'ig', 'instagram_lead'].includes(source)) return 'instagram_lead';
  if (['meta', 'meta_lead'].includes(source)) return 'meta_lead';
  if (['snapchat', 'snap', 'snapchat_lead'].includes(source)) return 'snapchat_lead';
  if (['tiktok', 'tt', 'tiktok_lead'].includes(source)) return 'tiktok_lead';
  return 'website';
}

/**
 * Idempotent per submitted form lead and customer phone. Existing CRM customers
 * are linked, never re-created, reallocated, or reset to "عميل جديد".
 */
export async function syncMarketingFormLeadToCrm(formLeadId: string, reviewExisting = false) {
  const sql = getSql();
  await ensureCrmSchema();
  const [initial] = await sql<FormLeadToSync[]>`
    select id::text,form_id::text,name,phone,source,campaign,medium,ad_id,
      answers,answer_labels,answer_crm_fields,crm_status,crm_lead_id::text,created_at
    from marketing.form_leads where id=${formLeadId}::uuid limit 1
  `;
  if (!initial) throw new Error('ليد الفورم غير موجود');
  const phone = normalizePhone(initial.phone);
  if (!phone) throw new Error('رقم الجوال غير صالح للمزامنة');

  return withDatabaseAdvisoryLock(`mzj:marketing-form-crm:${phone}`, async () => {
    const [row] = await sql<FormLeadToSync[]>`
      select id::text,form_id::text,name,phone,source,campaign,medium,ad_id,
        answers,answer_labels,answer_crm_fields,crm_status,crm_lead_id::text,created_at
      from marketing.form_leads where id=${formLeadId}::uuid limit 1
    `;
    if (!row) throw new Error('ليد الفورم غير موجود');
    if (row.crm_status === 'linked' || row.crm_status === 'existing') {
      const repairable = reviewExisting && row.crm_status === 'existing' && row.crm_lead_id
        && await isRecoverableMarketingFormLead(sql, row.crm_lead_id, `marketing-form:${row.id}`, crmSourceForForm(row.source));
      if (!repairable) {
        // Explicit admin review can sync saved answers to a completed link,
        // without repeating CRM classification, distribution or notifications.
        if (reviewExisting && row.crm_lead_id) await saveMarketingFormProfile(row.crm_lead_id,row,false);
        return { status: row.crm_status, leadId: row.crm_lead_id };
      }
    }

    try {
      // Never change the status, source, department or representative of a previous lead.
      const [prior] = await sql<{ id: string }[]>`
        select id::text from crm.leads where is_deleted=false and
          (phone_normalized=${phone} or right(regexp_replace(coalesce(phone_normalized,phone,''),'\\D','','g'),9)=right(${phone},9))
        order by updated_at desc limit 1
      `;
      // Existing CRM customers still pass through the protected import handler
      // so their NEW platform appears in source_history and lead_events.
      // They bypass team eligibility and never enter the classification branch.
      const sourceCode = crmSourceForForm(row.source);
      const carName = formCrmAnswers(row.answers,row.answer_labels,row.answer_crm_fields)
        .find(answer => answer.field==='car_type' && typeof answer.profileValue==='string')?.profileValue || '';
      const purchasePreference = formPurchasePreference(row.answers, row.answer_labels);
      // All new marketing-form leads enter finance sales. The customer's
      // submitted preference is retained as metadata, not a routing decision.
      const serviceKey = 'finance' as const;
      if (!prior) {
        // Require an active finance representative in a physical branch. Never
        // fall back to cash sales or create an unassigned lead when unavailable.
        const eligibleTeams = await sql<{department_code: string}[]>`
          select distinct d.code as department_code
          from core.users u
          join core.user_system_departments usd on usd.user_id=u.id and usd.system_code='crm'
          join core.departments d on d.id=usd.department_id and d.system_code='crm' and d.is_active=true
          where u.is_active=true and coalesce(u.is_archived,false)=false
            and u.can_receive_leads=true and coalesce(u.employee_no,'')<>'SYSTEM-WEBSITE'
            and d.code='finance_sales'
            and exists (
              select 1 from core.user_system_branches usb
              join core.branches b on b.id=usb.branch_id and b.is_active=true
              where usb.user_id=u.id and usb.system_code='crm' and b.code not in ('online','website')
              union all
              select 1 from core.user_branches ub
              join core.branches b on b.id=ub.branch_id and b.is_active=true
              where ub.user_id=u.id and b.code not in ('online','website')
                and not exists (select 1 from core.user_system_branches x where x.user_id=u.id and x.system_code='crm')
            )
          union
          select distinct d.code as department_code
          from core.users u
          join core.user_departments ud on ud.user_id=u.id
          join core.departments d on d.id=ud.department_id and d.is_active=true
          where u.is_active=true and coalesce(u.is_archived,false)=false
            and u.can_receive_leads=true and coalesce(u.employee_no,'')<>'SYSTEM-WEBSITE'
            and d.code='finance_sales'
            and not exists (select 1 from core.user_system_departments x where x.user_id=u.id and x.system_code='crm')
            and exists (
              select 1 from core.user_branches ub
              join core.branches b on b.id=ub.branch_id and b.is_active=true
              where ub.user_id=u.id and b.code not in ('online','website')
            )
        `;
        if (!eligibleTeams.some(team => team.department_code === 'finance_sales')) {
          throw new Error('لا يوجد مندوب تمويل نشط مؤهل لاستقبال ليد الفورم');
        }
      }
      const eventId = `marketing-form:${row.id}`;
      const raw = {
        formLeadId: row.id, formId: row.form_id, formSource: row.source,
        campaignName: row.campaign, medium: row.medium, adId: row.ad_id,
        answers: row.answers, answerLabels: row.answer_labels, answerCrmFields: sanitizeFormCrmFields(row.answer_crm_fields),
        purchasePreference, intakeServiceKey: serviceKey,
      };
      const payload = {
        type: 'lead_import', importOnly: true, provider: 'marketing_lead_form',
        sourceCode, customerName: row.name, phone: row.phone,
        campaignName: row.campaign, carName, serviceKey,
        purchasePreference,
        createdAt: row.created_at, raw,
        preferredContactChannel: 'whatsapp',
      };
      // The established CRM import processor records its completion in this table.
      await sql`
        insert into integrations.inbound_events(source,event_key,event_type,payload)
        values('marketing-form',${eventId},'lead_import',${sql.json(payload)})
        on conflict(source,event_key) do nothing
      `;
      const result = await processLeadImportEvent('marketing-form', eventId, payload);
      const crmLeadId = trim(result.lead?.id, 60);
      if (!crmLeadId) throw new Error('لم يتم إنشاء ليد في CRM');
      await saveMarketingFormProfile(crmLeadId,row,!result.existedBefore);
      // Another integration can register this phone after our initial lookup.
      // The import processor resolves that race under its shared phone lock:
      // report an existing link rather than claiming a new CRM customer.
      const crmStatus = result.existedBefore ? 'existing' : 'linked';
      await sql`update marketing.form_leads set crm_status=${crmStatus},crm_lead_id=${crmLeadId}::uuid,
        crm_error=null,crm_synced_at=now() where id=${row.id}::uuid`;

      if (result.createLead) {
        await createNotification({
          systemCode: 'crm', eventType: 'lead_created_from_channel',
          title: 'دخل عميل جديد إلى النظام',
          body: `${row.name} من ${row.source || 'فورم المنصات'}`,
          entityType: 'lead', entityId: crmLeadId,
          actionUrl: `/crm?lead=${encodeURIComponent(crmLeadId)}`,
          severity: 'success', actorName: 'فورم المنصات',
          audienceUserIds: [result.lead?.assigned_to, result.lead?.call_center_assigned_to],
          branchCodes: [result.lead?.branch_code],
          departmentCodes: [result.lead?.department_code],
          metadata: { sourceName: row.source || 'فورم المنصات' },
          dedupeKey: notificationDedupe('crm-channel-lead', 'marketing-form', eventId),
        }).catch(err => console.error('Marketing form CRM notification failed', err));
      }
      return { status: crmStatus, leadId: crmLeadId };
    } catch (error) {
      // The published form submission must remain stored even if CRM is temporarily unavailable.
      await sql`update marketing.form_leads set crm_status='failed',
        crm_error='تعذر إرسال الليد إلى CRM، يرجى إعادة المحاولة' where id=${row.id}::uuid`
        .catch(() => undefined);
      throw error;
    }
  });
}
