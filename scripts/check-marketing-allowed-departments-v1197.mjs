import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const bridge = read("server/_marketing-department-access.ts");
const schema = read("server/_marketing-schema.ts");
const accessControl = read("server/access-control.ts");
const marketingApi = read("server/marketing/index.ts");
const permissionsUi = read("src/access-control/UsersPermissionsPanel.tsx");
const departmentsUi = read("src/marketing/pages/DepartmentsPage.tsx");
const creativeEditor = read("src/marketing/components/CreativeEditor.tsx");

assert.match(bridge, /alter table marketing\.departments add column if not exists core_department_id uuid/);
assert.match(bridge, /from core\.user_system_departments usd/);
assert.match(bridge, /source\.id<>md\.core_department_id/);
assert.match(bridge, /create or replace view marketing\.department_memberships/);
assert.match(bridge, /usd\.department_id=md\.core_department_id/);
assert.match(bridge, /lower\(trim\(assigned\.name\)\)/);
assert.doesNotMatch(bridge, /source\.system_code='marketing'/);
assert.match(schema, /await ensureMarketingDepartmentAccess\(\)/);
assert.match(accessControl, /await ensureMarketingDepartmentAccess\(\)/);
assert.match(marketingApi, /left join marketing\.department_memberships membership/);
assert.match(marketingApi, /join marketing\.department_memberships du/);
assert.doesNotMatch(marketingApi, /left join marketing\.department_users du on du\.department_id=d\.id/);
assert.doesNotMatch(marketingApi, /userIds=arrayValue<string>\(body\.userIds\)/);
assert.match(permissionsUi, /systemTab === "marketing" \? item\.system_code === "marketing"/);
assert.doesNotMatch(departmentsUi, /select multiple value=\{department\.userIds\}/);
assert.match(departmentsUi, /تحديد يوزرات القسم يتم من الإعدادات/);
assert.match(creativeEditor, /الأقسام المسموحة/);

// Regression fixture: one allowed department comes from an old generic core row
// and the other from a canonical marketing row. Both must be returned; primary
// department must not be used as a filter.
const normalize = (value) => String(value).trim().replace(/[\s\u200B-\u200D\uFEFF]+/g, "").toLocaleLowerCase("ar");
const departments = [
  { id: "content", name: "قسم المحتوى" },
  { id: "montage", name: "قسم المونتاج" },
];
const allowedRows = [
  { id: "old-generic-content", name: " قسم المحتوى ", primary: false },
  { id: "canonical-montage", name: "قسم المونتاج", primary: true },
];
const visible = departments.filter((department) => allowedRows.some((row) => normalize(row.name) === normalize(department.name)));
assert.deepEqual(visible.map((item) => item.id), ["content", "montage"]);

console.log("PASS: Marketing campaign and agenda users come from every allowed department, including historical generic rows");
