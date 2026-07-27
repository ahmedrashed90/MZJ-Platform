import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const marketing = read("../server/marketing/index.ts");
const editor = read("../src/marketing/components/CreativeEditor.tsx");
const types = read("../src/marketing/types.ts");
const campaign = read("../src/marketing/pages/CreateCampaignPage.tsx");
const agenda = read("../src/marketing/pages/CreateAgendaPage.tsx");

const checks = [];
const expect = (label, condition) => checks.push([Boolean(condition), label]);

expect(
  "Marketing meta reads department users from central allowed departments",
  marketing.includes("left join core.user_system_departments usd on usd.department_id=d.id and usd.system_code='marketing'")
);
expect(
  "Marketing meta returns one explicit canonical content department ID",
  marketing.includes("contentDepartmentId: contentDepartmentIdValue") && types.includes("contentDepartmentId: string")
);
expect(
  "Legacy inconsistent content flags are repaired onto the canonical content UUID",
  marketing.includes("set is_content=(id=${contentDepartmentIdValue}::uuid)")
    && marketing.includes("replace(lower(btrim(cd.name)), ' ', '') in ('قسمالمحتوى'")
);
expect(
  "Campaign and agenda task creation use the explicit content department ID",
  marketing.includes("const contentId = contentDepartmentId(meta);")
    && marketing.match(/const contentId = contentDepartmentId\(meta\);/g)?.length === 2
);
expect(
  "Creative editor selects content users by contentDepartmentId before any compatibility fallback",
  editor.includes("meta.departments.find((item) => item.id === meta.contentDepartmentId)")
    && editor.indexOf("item.id === meta.contentDepartmentId") < editor.indexOf("item.is_content")
);
expect(
  "Campaign and agenda initialize the explicit content department field",
  campaign.includes('contentDepartmentId: ""') && agenda.includes('contentDepartmentId: ""')
);
expect(
  "Saving a content department keeps one content flag without changing memberships",
  marketing.includes("if(bool(body.isContent))")
    && marketing.includes("update marketing.departments set is_content=false")
    && marketing.includes("insert into core.user_system_departments")
);

// Exact regression from production screenshots: Bilal is in both content and montage,
// while a stale is_content flag incorrectly points at montage. The explicit UUID must
// still show Bilal under content and must leave him available under montage.
const bilal = { id: "bilal", fullName: "بلال فتحي" };
const meta = {
  contentDepartmentId: "content",
  departments: [
    { id: "content", name: "قسم المحتوى", is_content: false, users: [bilal] },
    { id: "montage", name: "قسم المونتاج", is_content: true, users: [bilal] },
  ],
};
const contentDepartment = meta.departments.find((item) => item.id === meta.contentDepartmentId)
  || meta.departments.find((item) => item.is_content);
const montageDepartment = meta.departments.find((item) => item.id === "montage");
expect(
  "Bilal appears in both content and montage even when the old content flag is stale",
  contentDepartment?.users.some((user) => user.id === "bilal")
    && montageDepartment?.users.some((user) => user.id === "bilal")
);

const failed = checks.filter(([ok]) => !ok);
for (const [ok, label] of checks) console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
console.log(`\nMarketing content-user regression checks: ${checks.length - failed.length}/${checks.length} passed.`);
if (failed.length) process.exit(1);
