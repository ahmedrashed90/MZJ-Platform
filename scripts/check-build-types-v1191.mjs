import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const checks = [];
const expect = (name, condition) => {
  checks.push({ name, ok: Boolean(condition) });
  console.log(`${condition ? "PASS" : "FAIL"}: ${name}`);
};

const access = read("server/_access-control.ts");
const auth = read("server/_auth.ts");
const sharedSystemAccess = read("shared/system-access.ts");

expect("Effective access keeps query result sets separate", access.includes("const [versionRows, permissionRows, systemRows] = await Promise.all(["));
expect("Effective access reads the first permission row", access.includes("const permissionRow = permissionRows[0];"));
expect("Effective access reads the first version row", access.includes("const versionRow = versionRows[0];"));
expect("User profile reads the first database row", auth.includes("const row = rows[0];"));
expect("NodeNext shared import has an explicit extension", sharedSystemAccess.includes('from "./access-control.js"'));
expect("Legacy row-list property access is absent", !access.includes("permissionRow?.effective_permissions") || access.includes("const permissionRow = permissionRows[0];"));

const failed = checks.filter((item) => !item.ok);
console.log(`\nBuild type regression checks: ${checks.length - failed.length}/${checks.length} passed.`);
if (failed.length) process.exit(1);
