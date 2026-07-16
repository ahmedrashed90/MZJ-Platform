import fs from "node:fs";

const admin = fs.readFileSync(new URL("../src/crm/pages/CrmAdminPage.tsx", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../api/index.ts", import.meta.url), "utf8");
const mersal = fs.readFileSync(new URL("../server/crm/mersal-templates.ts", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

const requiredAdminTokens = [
  'tab === "statuses"',
  'tab === "customer_fields"',
  'tab === "sources"',
  'tab === "templates"',
  'tab === "mappings"',
  '<AdminStack',
  'مزامنة قوالب مرسال',
  'crm-distribution-professional',
  'crm-distribution-order-list',
];

for (const token of requiredAdminTokens) {
  if (!admin.includes(token)) throw new Error(`CRM settings v1.8 check failed: missing ${token}`);
}

if (!api.includes('["crm/mersal-templates", crmMersalTemplatesHandler]')) {
  throw new Error("CRM settings v1.8 check failed: Mersal route is not registered in the single API router");
}

for (const token of ["MERSAL_TOKEN", "/api/wpbox/getTemplates", "crm.message_templates", "provider='mersal'"]) {
  if (!mersal.includes(token)) throw new Error(`CRM settings v1.8 check failed: missing server sync token ${token}`);
}

for (const token of [".crm-admin-stack", ".crm-form-grid-wide", ".crm-distribution-professional", ".crm-templates-table"]) {
  if (!styles.includes(token)) throw new Error(`CRM settings v1.8 check failed: missing style ${token}`);
}

console.log("CRM settings v1.8 full-width layout, Mersal sync, and distribution checks passed.");
