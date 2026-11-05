import fs from "node:fs";

const drawer = fs.readFileSync("src/crm/components/LeadDrawer.tsx", "utf8");
const api = fs.readFileSync("server/crm/leads.ts", "utf8");

const checks = [
  [drawer.includes('if (!showConversation) payload.databaseEdit = true;') || drawer.includes('databaseEdit: !showConversation'), "database edit mode is sent only by the database edit drawer"],
  [drawer.includes('method: "PATCH"'), "customer edit uses PATCH instead of creating a new customer"],
  [drawer.includes('>القسم</span><select') && drawer.includes('>الفرع</span><select'), "department and branch controls exist"],
  [drawer.includes('>الدفع</span><select') && drawer.includes('>الحالة</span><select'), "payment and status controls exist"],
  [drawer.includes('>المسؤول</span><select') && drawer.includes('>الكول سنتر</span><select'), "responsible and call-center controls exist"],
  [api.includes('if (departmentChanged && !databaseEdit)'), "normal transfer behavior is preserved outside database editing"],
  [api.includes('databaseEdit && assignedFieldProvided') && api.includes('databaseEdit && callCenterFieldProvided'), "manual owner fields are persisted in database edit mode"],
  [api.includes('assigned_to=${assignedTo}::uuid') && api.includes('call_center_assigned_to=${callCenterAssignedTo}::uuid'), "the existing lead row receives the new assignments"],
  [api.includes('where id=${id}::uuid') && api.includes('update crm.leads set'), "the existing customer id is updated"],
  [api.includes('assignedChanged || callCenterChanged'), "assignment-only changes are logged and synchronized"],
];

for (const [ok, label] of checks) {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`PASS: ${label}`);
}
console.log(`CRM database customer edit checks passed: ${checks.length}/${checks.length}`);
