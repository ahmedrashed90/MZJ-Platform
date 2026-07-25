import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const bridge = read("server/_marketing-access-bridge.ts");
const schema = read("server/_marketing-schema.ts");
const accessControl = read("server/access-control.ts");
const marketingApi = read("server/marketing/index.ts");
const departmentsPage = read("src/marketing/pages/DepartmentsPage.tsx");
const creativeEditor = read("src/marketing/components/CreativeEditor.tsx");
const migration = read("database/migrations/20260724_marketing_native_clean_rebuild.sql");

assert.match(bridge, /alter table marketing\.departments add column if not exists core_department_id uuid/);
assert.match(bridge, /foreign key\(core_department_id\) references core\.departments/);
assert.match(bridge, /withDatabaseAdvisoryLock\("mzj:marketing-access-bridge:v1"/);
assert.match(bridge, /insert into core\.user_system_departments/);
assert.match(bridge, /insert into marketing\.department_users\(department_id,user_id\)/);
assert.match(schema, /await ensureMarketingAccessBridge\(\)/);
assert.match(migration, /alter table marketing\.departments add column if not exists core_department_id uuid/);
assert.match(migration, /marketing_departments_core_department_fk/);

assert.match(accessControl, /await ensureMarketingAccessBridge\(\)/);
assert.match(accessControl, /await syncMarketingDepartmentUsersForUsers\(tx, \[id\]\)/);
assert.match(marketingApi, /left join core\.user_system_departments usd/);
assert.match(marketingApi, /usd\.department_id=d\.core_department_id/);
assert.match(marketingApi, /async function saveDepartment/);
assert.match(marketingApi, /insert into core\.user_system_departments\(user_id,system_code,department_id,is_primary\)/);
assert.match(marketingApi, /تم حفظ القسم وربطه بالمستخدمين والصلاحيات/);
assert.match(departmentsPage, /متزامنة مع المستخدمون والصلاحيات/);
assert.match(creativeEditor, /المستخدمون والصلاحيات ← الأقسام المسموحة/);

console.log("PASS: Marketing departments are linked to central users and permissions (v1.19.7)");
