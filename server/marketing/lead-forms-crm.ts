/**
 * Marketing-form -> CRM bridge. Reuses the existing inbound lead-import workflow,
 * including its deduplication, ownership and notification rules. This module does
 * not change CRM routing, CRM schema or any advertising-platform integration.
 */
import { getSql, withDatabaseAdvisoryLock } from '../_db.js';
import { ensureCrmSchema } from '../_crm-schema.js';
import { normalizePhone } from '../_phone-utils.js';
import { processLeadImportEvent } from '../_crm-lead-import.js';
import { createNotification, notificationDedupe } from '../_notifications.js';

const trim = (value: unknown, limit = 200) => String(value ?? '').trim().slice(0, limit);

type FormLeadToSync = {
  id: string; form_id: string; name: string; phone: string;
  source: string; campaign: string; medium: string; ad_id: string;
  answers: Record<string, string>; answer_labels: Record<string, string>;
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

function findAnswer(row: FormLeadToSync, labels: string[], ids: string[]) {
  const answers = row.answers && typeof row.answers === 'object' ? row.answers : {};
  for (const id of ids) {
    if (trim(answers[id])) return trim(answers[id], 160);
  }
  for (const [id, label] of Object.entries(row.answer_labels || {})) {
    if (labels.some(phrase => String(label).includes(phrase)) && trim(answers[id])) return trim(answers[id], 160);
  }
  return '';
}

/**
 * Idempotent per submitted form lead and customer phone. Existing CRM customers
 * are linked, never re-created, reallocated, or reset to "عميل جديد".
 */
export async function syncMarketingFormLeadToCrm(formLeadId: string) {
  const sql = getSql();
  await ensureCrmSchema();
  const [initial] = await sql<FormLeadToSync[]>`
    select id::text,form_id::text,name,phone,source,campaign,medium,ad_id,
      answers,answer_labels,crm_status,crm_lead_id::text,created_at
    from marketing.form_leads where id=${formLeadId}::uuid limit 1
  `;
  if (!initial) throw new Error('ليد الفورم غير موجود');
  const phone = normalizePhone(initial.phone);
  if (!phone) throw new Error('رقم الجوال غير صالح للمزامنة');

  return withDatabaseAdvisoryLock(`mzj:marketing-form-crm:${phone}`, async () => {
    const [row] = await sql<FormLeadToSync[]>`
      select id::text,form_id::text,name,phone,source,campaign,medium,ad_id,
        answers,answer_labels,crm_status,crm_lead_id::text,created_at
      from marketing.form_leads where id=${formLeadId}::uuid limit 1
    `;
    if (!row) throw new Error('ليد الفورم غير موجود');
    if (row.crm_status === 'linked' || row.crm_status === 'existing') {
      return { status: row.crm_status, leadId: row.crm_lead_id };
    }

    try {
      // Never change the status, source, department or representative of a previous lead.
      const [prior] = await sql<{ id: string }[]>`
        select id::text from crm.leads where is_deleted=false and
          (phone_normalized=${phone} or right(regexp_replace(coalesce(phone_normalized,phone,''),'\\D','','g'),9)=right(${phone},9))
        order by updated_at desc limit 1
      `;
      if (prior) {
        await sql`update marketing.form_leads set crm_status='existing',crm_lead_id=${prior.id}::uuid,
          crm_error=null,crm_synced_at=now() where id=${row.id}::uuid`;
        return { status: 'existing', leadId: prior.id };
      }

      const sourceCode = crmSourceForForm(row.source);
      const carName = findAnswer(row, ['السيارة', 'السياره', 'الماركة', 'ماركة'], ['vehicle', 'car']);
      const eventId = `marketing-form:${row.id}`;
      const raw = {
        formLeadId: row.id, formId: row.form_id, formSource: row.source,
        campaignName: row.campaign, medium: row.medium, adId: row.ad_id,
        answers: row.answers, answerLabels: row.answer_labels,
      };
      const payload = {
        type: 'lead_import', importOnly: true, provider: 'marketing_lead_form',
        sourceCode, customerName: row.name, phone: row.phone,
        campaignName: row.campaign, carName,
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
      await sql`update marketing.form_leads set crm_status='linked',crm_lead_id=${crmLeadId}::uuid,
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
      return { status: 'linked', leadId: crmLeadId };
    } catch (error) {
      // The published form submission must remain stored even if CRM is temporarily unavailable.
      await sql`update marketing.form_leads set crm_status='failed',
        crm_error='تعذر إرسال الليد إلى CRM، يرجى إعادة المحاولة' where id=${row.id}::uuid`
        .catch(() => undefined);
      throw error;
    }
  });
}
