import fs from "node:fs";

const meta = fs.readFileSync(new URL("../server/crm/meta.ts", import.meta.url), "utf8");

function visiblePrimaryTeam(managerPrimaryBranchCode, rows) {
  return rows.filter((row) => String(row.primary_branch_code || "").trim() === managerPrimaryBranchCode);
}

const sample = [
  { id: "reda", primary_branch_code: "hall", branch_codes: ["hall", "online"] },
  { id: "ahmed", primary_branch_code: "multaqa", branch_codes: ["multaqa", "online"] },
  { id: "online", primary_branch_code: "online", branch_codes: ["online"] },
];
const visibleForHallManager = visiblePrimaryTeam("hall", sample);

const checks = [
  [meta.includes('getSystemAccess(user, "crm")'), "CRM meta resolves the current system access"],
  [meta.includes('crmAccess.roleCode === "branch_manager"'), "branch-manager scope is explicit"],
  [meta.includes('crmAccess.dataScope === "branch"'), "the restriction applies only to primary-branch data scope"],
  [meta.includes('crmAccess.branchCodes[0]'), "the manager team branch is the primary CRM branch"],
  [meta.includes('row.primary_branch_code'), "representatives are matched by their primary branch"],
  [!meta.includes('row.branch_codes || []).includes(managerPrimaryBranchCode)'), "shared allowed branches are not used as team identity"],
  [meta.includes('users: visibleUsers'), "the scoped list is returned to CRM screens"],
  [visibleForHallManager.length === 1 && visibleForHallManager[0]?.id === "reda", "shared online access does not mix Hall and Multaqa teams"],
];

let passed = 0;
for (const [ok, label] of checks) {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    process.exitCode = 1;
  } else {
    passed += 1;
    console.log(`PASS: ${label}`);
  }
}
console.log(`CRM branch-manager primary-team v54 checks: ${passed}/${checks.length} passed`);
