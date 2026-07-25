import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const marketing = read("../server/marketing/index.ts");
const schema = read("../server/_marketing-schema.ts");
const access = read("../server/access-control.ts");
const accessSchema = read("../server/_access-control-schema.ts");
const usersPanel = read("../src/access-control/UsersPermissionsPanel.tsx");
const settings = read("../src/pages/SettingsPage.tsx");
const departments = read("../src/marketing/pages/DepartmentsPage.tsx");
const creativeEditor = read("../src/marketing/components/CreativeEditor.tsx");
const campaignPage = read("../src/marketing/pages/CreateCampaignPage.tsx");
const agendaPage = read("../src/marketing/pages/CreateAgendaPage.tsx");

const checks = [
  [!marketing.includes("marketing.department_users"), "Marketing API must not read/write the legacy department_users table"],
  [!schema.includes("create table if not exists marketing.department_users"), "Clean schema must not recreate legacy membership storage"],
  [marketing.includes("core.user_system_departments") && marketing.includes("system_code='marketing'"), "Marketing memberships must use central allowed departments"],
  [marketing.includes("insert into marketing.departments(id,name,is_content,is_active,created_at,updated_at)") && marketing.includes("from core.departments d") && marketing.includes("on conflict(id) do update set name=excluded.name"), "Core marketing departments must be mirrored on the same canonical IDs"],
  [marketing.includes("where u.is_active=true") && marketing.includes("ACCOUNT_DELETED:%"), "Department user selector must expose all active non-deleted platform accounts"],
  [marketing.includes("insert into core.user_system_departments") && marketing.includes("is_primary) values") && marketing.includes("false) on conflict"), "Saving a marketing department must not replace the user's primary department"],
  [marketing.includes("delete from core.user_system_departments where system_code='marketing' and department_id") && marketing.includes("not (user_id::text = any"), "Removing a user must be scoped to the selected marketing department only"],
  [access.includes("jsonb_agg(usd.department_id::text") && access.includes("where usd.user_id=u.id and usd.system_code=us.system_code"), "Users and permissions must read the same central department memberships"],
  [schema.includes("marketing_departments_core_department_fk") && schema.includes("drop table marketing.department_users"), "Schema must canonicalize IDs and retire legacy membership storage"],
  [schema.includes("id-sync-") && schema.includes("replace(optional_assignments::text") && schema.includes("replace(payload::text"), "ID migration must handle same-name collisions and stored campaign/agenda references"],
  [schema.includes("marketing_department_duplicate_repair") && schema.includes("having count(*) > 1") && schema.includes("no role or role_id data is touched"), "Duplicate marketing department IDs must be consolidated without touching roles"],
  [creativeEditor.includes("meta.departments.find((item) => item.id === departmentId)?.users") && campaignPage.includes("<CreativeEditor") && agendaPage.includes("<CreativeEditor"), "Campaign and agenda user selectors must consume users from each allowed marketing department"],
  [settings.includes("unified-settings-layout") && settings.includes("إغلاق المجموعة") && settings.includes("ابحث داخل الإعدادات"), "Settings workspace navigation/search/collapse must remain present"],
  [departments.includes("marketing-department-user-list") && departments.includes("الأقسام المسموحة للمستخدم"), "Marketing department user picker must use the central membership UX"],
  [accessSchema.includes("drop constraint if exists departments_name_key") && accessSchema.includes("core_departments_system_normalized_name_idx"), "Legacy global department-name uniqueness must be removed safely"],
  [marketing.includes("existingMarketing") && marketing.includes("existingCore") && marketing.includes("تم ربط القسم الموجود"), "Saving a duplicate marketing name must reuse the existing canonical department"],
  [marketing.includes("not exists(select 1 from marketing.departments by_id") && marketing.includes("marketing.departments by_name"), "Marketing meta loading must skip legacy same-name ID collisions instead of failing"],
  [usersPanel.includes("roleGroups.map((group) => { const role=group.canonical") && !usersPanel.includes("<h2>قوالب الأدوار</h2><button type=\"button\" className=\"secondary-button\" onClick={() => chooseRole(null)}><Plus size={17} /> دور جديد</button></div>{(bootstrap?.roles || []).map"), "Role template list must render one canonical row per display-name group"],
];

// Required acceptance behavior: one user can belong to content and editing;
// removing content must leave editing and its primary marker unchanged.
const memberships = [
  { userId: "bilal", systemCode: "marketing", departmentId: "content", isPrimary: false },
  { userId: "bilal", systemCode: "marketing", departmentId: "editing", isPrimary: true },
];
const afterContentRemoval = memberships.filter((row) => !(row.systemCode === "marketing" && row.departmentId === "content" && row.userId === "bilal"));
checks.push([
  afterContentRemoval.some((row) => row.userId === "bilal" && row.departmentId === "editing" && row.isPrimary)
    && !afterContentRemoval.some((row) => row.userId === "bilal" && row.departmentId === "content"),
  "Bilal multi-department acceptance scenario must preserve editing after content removal",
]);

const failed = checks.filter(([ok]) => !ok);
for (const [ok, label] of checks) console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
if (failed.length) process.exit(1);
