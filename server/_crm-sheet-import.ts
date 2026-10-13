import type { SessionUser } from "./_auth.js";
import { withDatabaseAdvisoryLock, getSql } from "./_db.js";
import { audit, chooseSheetImportAssignment, clean, normalizePhone } from "./_crm-utils.js";
import { calculateLeadCompletion, getCustomerFieldDefinitions } from "./_crm-customer-fields.js";
import { attachLeadToContactAndOpenRequest } from "./_crm-lifecycle.js";
import { emitCrmLeadNotification } from "./_notifications.js";

export const CRM_SHEET_SOURCE = "sheet_lead";
export type SheetLeadInput = { rowNumber: number; customerName: string; phone: string };
export type SheetLeadStatus = "created" | "existing" | "duplicate_in_file" | "invalid" | "failed";
export type SheetLeadResult = SheetLeadInput & {
  status: SheetLeadStatus;
  assignedName?: string;
  branchCode?: string;
  leadId?: string;
  reason?: string;
};

export function normalizeSheetLeadRow(value: unknown, index: number): SheetLeadInput {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    rowNumber: Number.isInteger(Number(data.rowNumber)) ? Math.max(1, Math.min(100000, Number(data.rowNumber))) : index + 2,
    customerName: clean(data.customerName).slice(0, 250),
    phone: clean(data.phone).slice(0, 70),
  };
}

export function sheetLeadValidation(row: SheetLeadInput) {
  const phoneNormalized = normalizePhone(row.phone);
  if (!row.customerName) return { phoneNormalized, reason: "اسم العميل غير موجود" };
  if (!phoneNormalized) return { phoneNormalized, reason: "رقم الجوال غير صالح" };
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

async function ensureSheetSource() {
  const sql = getSql();
  await sql`
    insert into core.sources(code,name,sort_order,is_active,system_codes,delivery_route,allow_free_text,report_group)
    values (${CRM_SHEET_SOURCE},'ليد - استيراد شيت',68,true,array['crm'],'whatsapp',false,'digital')
    on conflict(code) do nothing
  `;
  await sql`
    insert into crm.sources(code,name,sort_order,is_active)
    values (${CRM_SHEET_SOURCE},'ليد - استيراد شيت',68,true)
    on conflict(code) do nothing
  `;
}

async function findExistingPhone(phone: string) {
  const sql = getSql();
  // Saudi mobile numbers already stored in legacy 05/5/9665 notation count as the same customer.
  const saMobile = /^9665\d{8}$/.test(phone);
  const [row] = await sql<any[]>`
    select l.id::text,l.customer_name,l.assigned_to::text,l.branch_code,u.full_name as assigned_name
    from crm.leads l left join core.users u on u.id=l.assigned_to
    where l.phone_normalized=${phone}
      or (${saMobile}::boolean and right(regexp_replace(coalesce(l.phone_normalized,l.phone,''),'[^0-9]','','g'),9)=right(${phone},9))
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
    const results: SheetLeadResult[] = [];
    for (const row of rows) {
      const check = sheetLeadValidation(row);
      if (check.reason) { results.push({ ...row, status: "invalid", reason: check.reason }); continue; }
      if (seenPhones.has(check.phoneNormalized)) {
        results.push({ ...row, status: "duplicate_in_file", reason: "نفس رقم الجوال تكرر داخل الدفعة" });
        continue;
      }
      seenPhones.add(check.phoneNormalized);
      try {
        const existing = await findExistingPhone(check.phoneNormalized);
        if (existing) {
          results.push({ ...row, status: "existing", leadId: existing.id, assignedName: existing.assigned_name || "", branchCode: existing.branch_code || "", reason: "موجود بالفعل؛ لم يتم تغيير المندوب أو الفرع أو البيانات" });
          continue;
        }
        const assignment = await chooseSheetImportAssignment(serviceKey);
        if (!assignment.assignedTo || !assignment.branchCode) {
          results.push({ ...row, status: "failed", reason: "لا يوجد مندوب مؤهل بفرع فعلي في قسم التوزيع المحدد" });
          continue;
        }
        const departmentCode = serviceKey === "finance" ? "finance_sales" : "cash_sales";
        const paymentType = serviceKey === "finance" ? "تمويل" : "كاش";
        const completion = calculateLeadCompletion({
          customerName: row.customerName, phone: check.phoneNormalized, sourceCode: CRM_SHEET_SOURCE,
          statusLabel: "عميل جديد", serviceKey,
        }, definitions);
        const [created] = await sql.begin(async (tx) => {
          const [lead] = await tx<any[]>`
            insert into crm.leads(customer_name,phone,phone_normalized,source_code,source_name,service_key,
              department_code,branch_code,status_label,payment_type,campaign_name,assigned_to,created_by,updated_by,
              registered_at,completion_percent,responsible_name_snapshot)
            values(${row.customerName},${row.phone},${check.phoneNormalized},${CRM_SHEET_SOURCE},'ليد - استيراد شيت',${serviceKey},
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
        await audit(actor, "sheet_lead_imported", "lead", created.id, { phoneNormalized: check.phoneNormalized, assignedTo: assignment.assignedTo, branchCode: assignment.branchCode });
        await emitCrmLeadNotification(actor, "created", created).catch((error) => console.error("CRM sheet lead notification failed", error));
        results.push({ ...row, status: "created", leadId: created.id, assignedName: assignment.assignedName, branchCode: assignment.branchCode, reason: linkageError ? `تم حفظ العميل وتوزيعه، لكن تعذر ربط الطلب: ${linkageError}` : "" });
      } catch (error) {
        results.push({ ...row, status: "failed", reason: error instanceof Error ? error.message : "تعذر إنشاء العميل" });
      }
    }
    return { rows: results, summary: summarizeSheetResults(results) };
  });
}
