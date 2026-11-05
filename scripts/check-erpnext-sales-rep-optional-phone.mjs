import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

const submitted = read("integration-assets/MZJ-ERPNext-Sales-Order-Webhook-JSON.txt");
const cancelled = read("integration-assets/MZJ-ERPNext-Sales-Order-Cancel-Webhook-JSON.txt");
const normalizer = read("server/_erpnext-sales-order-normalizer.ts");
const sync = read("server/_erpnext-sales-order-sync.ts");
const operations = read("server/operations/index.ts");

for (const [label, source, event] of [
  ["submitted", submitted, '"event": "sales_order.submitted"'],
  ["cancelled", cancelled, '"event": "sales_order.cancelled"'],
]) {
  assert.ok(source.includes(event), `${label} webhook event must be correct`);
  assert.ok(source.includes("doc.get('sales_team')"), `${label} webhook must read Sales Team`);
  assert.ok(source.includes("frappe.db.get_value('Sales Person'"), `${label} webhook must resolve Sales Person.employee`);
  assert.ok(source.includes("frappe.db.get_value('Employee'"), `${label} webhook must resolve Employee.user_id`);
  assert.ok(source.includes('"sales_rep_email"'), `${label} webhook must send sales rep email`);
  assert.ok(source.includes('"operations_admin_email"'), `${label} webhook must send operations admin email separately`);
  assert.ok(source.includes('"operations_admin_name"'), `${label} webhook must send operations admin name separately`);
  assert.ok(source.includes('"customer_id"'), `${label} webhook must send stable ERP customer identity`);
}

assert.ok(normalizer.includes("must never become the CRM owner"), "normalizer must document strict identity separation");
assert.ok(normalizer.includes('"operations_admin_email"'), "normalizer must capture operations admin independently");
assert.equal(normalizer.includes('"custom_sales_person_email",\n    "custom_sales_user_email", "owner"'), false, "owner must not be a sales rep fallback");
assert.equal(normalizer.includes('CUSTOMER_PHONE_MISSING'), false, "phone must be optional in normalization");

assert.ok(sync.includes("function erpCustomerIdentity"), "CRM must have stable ERP customer identity");
assert.ok(sync.includes("crm.contact_identities"), "CRM must persist ERP customer identity");
assert.ok(sync.includes("primary_phone,primary_phone_normalized"), "CRM contact creation must support nullable phone fields");
assert.ok(sync.includes('"تم إنشاء عميل CRM بدون رقم جوال بحالة تم البيع"'), "phone-less CRM creation must be explicit");
assert.equal(sync.includes('status: "missing_phone"'), false, "phone-less order must not be skipped");
assert.equal(sync.includes("CRM_CUSTOMER_PHONE_MISSING"), false, "phone-less order must not produce blocking warning");
assert.ok(sync.includes("erpSubmitterName: normalized.erpSubmittedByName"), "movement must retain operations admin name");
assert.ok(operations.includes("operations_admin_email"), "movement history must resolve explicit operations admin email");
assert.ok(operations.includes("operations_admin_name"), "movement history must resolve explicit operations admin name");

console.log("PASS: NEXT ERP sales representative, operations admin, and optional-phone source checks");
