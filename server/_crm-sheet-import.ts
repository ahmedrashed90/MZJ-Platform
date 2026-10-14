import type { SessionUser } from "./_auth.js";
import { withDatabaseAdvisoryLock, getSql } from "./_db.js";
import { audit, chooseSheetImportAssignment, clean } from "./_crm-utils.js";
import { checkSheetLeadPhone } from "../shared/crm-sheet-phone.js";
import { calculateLeadCompletion, getCustomerFieldDefinitions } from "./_crm-customer-fields.js";
import { attachLeadToContactAndOpenRequest } from "./_crm-lifecycle.js";
import { emitCrmLeadNotification } from "./_notifications.js";
import { DEFAULT_SHEET_LEAD_SOURCE, resolveSheetLeadSource, type SheetLeadSource } from "../shared/crm-sheet-sources.js";

export const CRM_SHEET_SOURCE = "sheet_lead";
export type SheetLeadInput = { rowNumber: number; customerName: string; phone: string; source: string };
export type SheetLeadStatus = "created" | "existing" | "duplicate_in_file" | "invalid" | "failed";
export type SheetLeadResult = SheetLeadInput & {
  status: SheetLeadStatus;
  assignedName?: string;
  branchCode?: string;
  leadId?: string;
  storedSource?: string;
  reason?: string;
};

export function normalizeSheetLeadRow(value: unknown, index: number): SheetLeadInput {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    rowNumber: Number.isInteger(Number(data.rowNumber)) ? Math.max(1, Math.min(100000, Number(data.rowNumber))) : index + 2,
    customerName: clean(data.customerName).slice(0, 250),
    phone: clean(data.phone).slice(0, 70),
    source: clean(data.source).slice(0, 120),
  };
}

export function sheetLeadValidation(row: SheetLeadInput) {
  const phoneCheck = checkSheetLeadPhone(row.phone);
  const phoneNormalized = phoneCheck.normalized;
  if (!row.customerName) return { phoneNormalized, reason: "اسم العميل غير موجود" };
  if (!phoneNormalized) return { phoneNormalized, reason: phoneCheck.reason };
  if (!resolveSheetLeadSource(row.source)) return { phoneNormalized, reason: "\u0627\u0644\u0645\u0635\u062f\u0631 \u063a\u064a\u0631 \u0645\u0639\u0631\u0648\u0641: \u0627\u062e\u062a\u0631 \u0645\u0635\u062f\u0631\u064b\u0627 \u0645\u0646 \u0627\u0644\u0642\u0627\u0626\u0645\u0629" };
  return { phoneNormalized, reason: "" };
}

export function summarizeSheetResults(rows: SheetLeadResult[]) {
  return {
    total: rows.length,
    created: rows.filter((row) => row.status === "created").length,
    existing: rows.filter((row) => row.status === "existing").length,
    duplicateInFile: rows.filter((row) => row.status === "duplicate_in_file").length,
    invalid: rows.filter((row) => row.status === "invalid").length,
    failed: rows.filter((row) => row.status === "failed").length,
  };
}

async function ensureSheetSource(source: SheetLeadSource = DEFAULT_SHEET_LEAD_SOURCE) {
  const sql = getSql();
  await sql`
    insert into core.sources(code,name,sort_order,is_active,system_codes,delivery_route,allow_free_text,report_group)
    values (${source.code},${source.name},68,true,array['crm'],'whatsapp',false,${source.reportGroup})
    on conflict(code) do nothing
  `;
  await sql`
    insert into crm.sources(code,name,sort_order,is_active)
    values (${source.code},${source.name},68,true)
    on conflict(code) do nothing
  `;
}

async function findExistingPhone(phone: string) {
  const sql = getSql();
  // Saudi mobile numbers already stored in legacy 05/5/9665 notation count as the same customer.
  const saMobile = /^9665\d{8}$/.test(phone);
  const [row] = await sql<any[]>`
    select l.id::text,l.customer_name,l.assigned_to::text,l.branch_code,l.source_code,l.source_name,u.full_name as assigned_name
    from crm.leads l left join core.users u on u.id=l.assigned_to
    where l.phone_normalized=${phone}
      or (${saMobile}::boolean and right(regexp_replace(translate(coalesce(nullif(l.phone_normalized,''),l.phone,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g'),9)=right(${phone},9))
    order by l.is_deleted asc,l.created_at asc limit 1
  `;
  return row || null;
}

export async function importCrmSheetBatch(actor: SessionUser, rawRows: unknown[], serviceKey: "cash" | "finance", campaignName: string) {
  if (!Array.isArray(rawRows) || rawRows.length < 1 || rawRows.length > 25) throw new Error("كل دفعة يجب أن تحتوي من عميل واحد إلى 25 عميلًا");
  if (!(["cash", "finance"] as string[]).includes(serviceKey)) throw new Error("حدد قسم التوزيع: الكاش أو التمويل");
  const sql = getSql();
  const rows = rawRows.map(normalizeSheetLeadRow);
  // Serialize all sheet imports before duplicate lookup AND the real CRM routing counters.
  // A repeat import never calls a routing function for an existing phone.
  return withDatabaseAdvisoryLock("crm:sheet-lead-bulk-import", async () => {
    await ensureSheetSource();
    const definitions = await getCustomerFieldDefinitions();
    const seenPhones = new Set<string>();
    const registeredSources = new Set<string>([CRM_SHEET_SOURCE]);
    const results: SheetLeadResult[] = [];
    for (const row of rows) {
      const check = sheetLeadValidation(row);
      if (!check.phoneNormalized) { results.push({ ...row, status: "invalid", reason: check.reason }); continue; }
      if (seenPhones.has(check.phoneNormalized)) {
        results.push({ ...row, status: "duplicate_in_file", reason: "نفس رقم الجوال تكرر داخل الدفعة" });
        continue;
      }
      seenPhones.add(check.phoneNormalized);
      try {
        const existing = await findExistingPhone(check.phoneNormalized);
        if (existing) {
          results.push({ ...row, phone: check.phoneNormalized, status: "existing", leadId: existing.id, assignedName: existing.assigned_name || "", branchCode: existing.branch_code || "", storedSource: existing.source_name || existing.source_code || "", reason: "موجود بالفعل؛ لم يتم تغيير المندوب أو الفرع أو البيانات" });
          continue;
        }
        if (check.reason) { results.push({ ...row, status: "invalid", reason: check.reason }); continue; }
        const leadSource = resolveSheetLeadSource(row.source) || DEFAULT_SHEET_LEAD_SOURCE;
        if (!registeredSources.has(leadSource.code)) {
          await ensureSheetSource(leadSource);
          registeredSources.add(leadSource.code);
        }
        const assignment = await chooseSheetImportAssignment(serviceKey);
        if (!assignment.assignedTo || !assignment.branchCode) {
          results.push({ ...row, status: "failed", reason: "لا يوجد مندوب مؤهل بفرع فعلي في قسم التوزيع المحدد" });
          continue;
        }
        const departmentCode = serviceKey === "finance" ? "finance_sales" : "cash_sales";
        const paymentType = serviceKey === "finance" ? "تمويل" : "كاش";
        const completion = calculateLeadCompletion({
          customerName: row.customerName, phone: check.phoneNormalized, sourceCode: leadSource.code,
          statusLabel: "عميل جديد", serviceKey,
        }, definitions);
        const [created] = await sql.begin(async (tx) => {
          const [lead] = await tx<any[]>`
            insert into crm.leads(customer_name,phone,phone_normalized,source_code,source_name,service_key,
              department_code,branch_code,status_label,payment_type,campaign_name,assigned_to,created_by,updated_by,
              registered_at,completion_percent,responsible_name_snapshot)
            values(${row.customerName},${check.phoneNormalized},${check.phoneNormalized},${leadSource.code},${leadSource.name},${serviceKey},
              ${departmentCode},${assignment.branchCode},'عميل جديد',${paymentType},${campaignName || null},${assignment.assignedTo}::uuid,
              ${actor.id}::uuid,${actor.id}::uuid,now(),${completion},${assignment.assignedName || null})
            returning *,id::text,assigned_to::text
          `;
          await tx`
            insert into crm.lead_events(lead_id,event_type,new_status,new_department,new_branch,actor_id,actor_name,note)
            values(${lead.id}::uuid,'sheet_lead_imported','عميل جديد',${departmentCode},${assignment.branchCode},
              ${actor.id}::uuid,${actor.fullName},'إضافة ليد من شيت موحد - توزيع تلقائي')
          `;
          return [lead];
        });
        // Link to CRM contact/request using the same existing manual creation flow.
        // A link failure must not undo an already-created and assigned lead.
        let linkageError = "";
        try { await attachLeadToContactAndOpenRequest({ leadId: created.id, actor, classificationMethod: "sheet_import" }); }
        catch (error) { linkageError = error instanceof Error ? error.message : "تعذر ربط طلب خدمة العميل"; }
        await audit(actor, "sheet_lead_imported", "lead", created.id, { phoneNormalized: check.phoneNormalized, sheetImport: true, sourceCode: leadSource.code, assignedTo: assignment.assignedTo, branchCode: assignment.branchCode });
        await emitCrmLeadNotification(actor, "created", created).catch((error) => console.error("CRM sheet lead notification failed", error));
        results.push({ ...row, phone: check.phoneNormalized, status: "created", leadId: created.id, assignedName: assignment.assignedName, branchCode: assignment.branchCode, reason: linkageError ? `تم حفظ العميل وتوزيعه، لكن تعذر ربط الطلب: ${linkageError}` : "" });
      } catch (error) {
        results.push({ ...row, status: "failed", reason: error instanceof Error ? error.message : "تعذر إنشاء العميل" });
      }
    }
    return { rows: results, summary: summarizeSheetResults(results) };
  });
}


/** Correct only presentation formats of previously imported sheet leads.
 * This never guesses missing digits, touches assignment, or changes the stored identity.
 * Explicit superadmin authorization is enforced by the API endpoint.
 */
export async function normalizePreviouslyImportedSheetPhones(actor: SessionUser) {
  return withDatabaseAdvisoryLock("crm:sheet-lead-bulk-import", async () => {
    const sql = getSql();
    const rows = await sql<any[]>`
      select l.id::text,l.contact_id::text,l.phone,l.phone_normalized,c.primary_phone,c.primary_phone_normalized
      from crm.leads l
      left join crm.contacts c on c.id=l.contact_id
      where l.is_deleted=false and l.phone is distinct from l.phone_normalized
        and exists (select 1 from crm.lead_events e where e.lead_id=l.id and e.event_type='sheet_lead_imported')
      order by l.created_at asc limit 5000
    `;
    let corrected = 0;
    let contactPhonesCorrected = 0;
    let requiresReview = 0;
    for (const row of rows) {
      const check = checkSheetLeadPhone(row.phone);
      // The already stored normalized phone is immutable here: only fix the displayed formatting.
      if (!check.normalized || check.normalized !== String(row.phone_normalized || '')) {
        requiresReview += 1;
        continue;
      }
      const updated = await sql.begin(async (tx) => {
        const [changed] = await tx<any[]>`
          update crm.leads set phone=${check.normalized},updated_at=now()
          where id=${row.id}::uuid and phone=${row.phone} and phone_normalized=${check.normalized}
          returning id::text
        `;
        if (!changed) return { changed: false, contactChanged: false };
        let contactChanged = false;
        if (row.contact_id && row.primary_phone === row.phone && row.primary_phone_normalized === check.normalized) {
          const [contact] = await tx<any[]>`
            update crm.contacts set primary_phone=${check.normalized},updated_at=now()
            where id=${row.contact_id}::uuid and primary_phone=${row.phone} and primary_phone_normalized=${check.normalized}
            returning id::text
          `;
          contactChanged = Boolean(contact);
        }
        return { changed: true, contactChanged };
      });
      if (updated.changed) corrected += 1;
      if (updated.contactChanged) contactPhonesCorrected += 1;
    }
    const [suspicious] = await sql<{ count: number }[]>`
      select count(*)::int as count from crm.leads l
      where l.is_deleted=false and l.phone_normalized ~ '0{5,}$'
        and exists (select 1 from crm.lead_events e where e.lead_id=l.id and e.event_type='sheet_lead_imported')
    `;
    await audit(actor, "sheet_lead_phone_format_repaired", "sheet_leads", null, {
      corrected, contactPhonesCorrected, requiresReview, suspiciousPhones: Number(suspicious?.count || 0),
    });
    return {
      corrected, contactPhonesCorrected, requiresReview,
      suspiciousPhones: Number(suspicious?.count || 0),
      note: "تم تعديل صيغة عرض الأرقام القابلة للتحقق فقط. الأرقام الناقصة أو المنتهية بأصفار كثيرة لم يتم تخمينها أو تعديل توزيعها.",
    };
  });
}

/** Read-only review of sheet-import phones. Never infer missing digits from a name. */
export async function listPreviouslyImportedSheetPhoneIssues() {
  const sql = getSql();
  const leads = await sql<any[]>`
    select l.id::text,l.customer_name,l.phone,l.phone_normalized,l.branch_code,
      l.source_name,u.full_name as assigned_name
    from crm.leads l left join core.users u on u.id=l.assigned_to
    where l.is_deleted=false
      and exists (select 1 from crm.lead_events e where e.lead_id=l.id and e.event_type='sheet_lead_imported')
    order by l.created_at desc limit 5000
  `;
  const rows = leads.flatMap((lead) => {
    const original = String(lead.phone || '');
    const storedKey = String(lead.phone_normalized || '');
    const result = checkSheetLeadPhone(original);
    if (!result.reason && result.normalized === storedKey && original === storedKey) return [];
    return [{
      leadId: String(lead.id), customerName: String(lead.customer_name || ''),
      phone: original, normalizedKey: storedKey, branchCode: String(lead.branch_code || ''),
      sourceName: String(lead.source_name || ''), assignedName: String(lead.assigned_name || ''),
      reviewReason: result.reason || (result.normalized !== storedKey
        ? 'رقم البحث لا يطابق الرقم الأصلي؛ يلزم التحقق يدويًا'
        : 'الصيغة قابلة للتصحيح من زر تنسيق الأرقام القديمة'),
    }];
  });
  return { total: rows.length, rows, limitedTo: 5000 };
}
