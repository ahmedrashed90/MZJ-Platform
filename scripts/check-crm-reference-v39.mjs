import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const requireText = (file, text, message) => {
  if (!read(file).includes(text)) throw new Error(`${message} (${file})`);
};

requireText("database/migrations/20260720_crm_reference_v39.sql", "report_group", "Migration must classify report sources");
requireText("database/migrations/20260720_crm_reference_v39.sql", "migration was already applied", "Migration must refuse duplicate execution");
requireText("database/migrations/20260720_crm_reference_v39.sql", "crm_reference_v39_cash_status_migrated", "Status migration must write an audit summary");
requireText("database/migrations/20260720_crm_reference_v39.sql", "'cash-potential'", "Migration must update the cash no-answer status");
requireText("server/crm/reports.ts", "at time zone 'Asia/Riyadh'", "Reports must use Saudi date boundaries");
requireText("server/crm/reports.ts", "not_contacted_statuses", "Reports must read the configured not-contacted statuses");
requireText("server/crm/reports.ts", "source_report_group", "Reports must use database source classification");
requireText("server/crm/reports.ts", "detailPageSize", "Report customer details must use server-side pagination");
requireText("src/crm/pages/CrmReportsPage.tsx", "popupPageSize", "Report customer modal must paginate on the server");
requireText("server/_dashboard-data.ts", "status_label='لم يتم الرد'", "Unified dashboard must count the new no-answer status");
requireText("server/_dashboard-data.ts", "coalesce(registered_at,created_at) at time zone 'Asia/Riyadh'", "Unified dashboard dates must use registration date in Saudi timezone");
requireText("src/pages/DashboardPage.tsx", 'title="لم يتم الرد"', "Unified dashboard CRM card must use the new label");
requireText("src/crm/pages/CrmReportsPage.tsx", "downloadXlsx", "Reports must export a real XLSX workbook");
requireText("src/crm/pages/CrmDatabasePage.tsx", "downloadXlsx", "CRM database must export a real XLSX workbook");
requireText("src/crm/pages/CrmDatabasePage.tsx", "loadAllMatchingRows", "CRM database export must fetch all filtered pages");
requireText("src/crm/pages/CrmDatabasePage.tsx", "offset: page * pageSize", "CRM database must use server-side pagination");
requireText("server/crm/history.ts", "limit ${limit} offset ${offset}", "Finance history must use server-side pagination");
requireText("server/crm/inbox-agent.ts", "limit ${limit} offset ${offset}", "Inbox-agent logs must use server-side pagination");
requireText("src/crm/pages/CrmReportsPage.tsx", "مصادر التسويق الرقمي", "Digital source report must be present");
requireText("src/crm/pages/CrmReportsPage.tsx", "مصادر التسويق المباشر", "Direct source report must be present");
requireText("server/crm/manual-leads.ts", 'action === "edit"', "Manual lead edit API must be implemented");
requireText("server/crm/manual-leads.ts", "is_deleted=true", "Manual request deletion must be soft delete");
requireText("server/crm/manual-leads.ts", "assignedChanged", "Manual edit must preserve ownership unless the assignee was changed");
requireText("src/crm/pages/CrmManualLeadsPage.tsx", "editRow(row)", "Manual lead edit button must be wired");
requireText("server/crm/data-review.ts", 'action === "preview"', "Data-review preview must be implemented");
requireText("server/crm/data-review.ts", 'action !== "execute"', "Data-review transaction execution must be implemented");
requireText("src/crm/pages/CrmAdminPage.tsx", "رفع شيت التصحيح", "Admin must expose correction-sheet upload");
requireText("src/crm/xlsx.ts", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "XLSX MIME type must be correct");
requireText("src/crm/xlsx.ts", "/^[=+\\-@]/", "Excel formula injection protection must be enabled");

for (const file of ["server/crm/reports.ts", "server/crm/manual-leads.ts", "server/crm/data-review.ts", "src/crm/pages/CrmReportsPage.tsx", "src/crm/pages/CrmDatabasePage.tsx"]) {
  if (/firebase|firestore/i.test(read(file))) throw new Error(`Firebase/Firestore is not allowed in ${file}`);
}

if (/delete\s+from\s+crm\.manual_lead_requests/i.test(read("server/crm/manual-leads.ts"))) throw new Error("Manual request history must not be hard-deleted");

for (const file of ["server/crm/history.ts", "server/crm/inbox-agent.ts"]) {
  if (/limit\s+500/i.test(read(file))) throw new Error(`Fixed 500-row limit is not allowed in ${file}`);
}

console.log("CRM reference v39 migration, reports, pagination, manual edit, XLSX export, and data-review checks passed.");
