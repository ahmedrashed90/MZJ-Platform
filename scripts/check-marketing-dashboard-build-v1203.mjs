import fs from "node:fs";

const source = fs.readFileSync("src/marketing/pages/MarketingDashboardPage.tsx", "utf8");
const checks = [
  [
    "required-task department accumulator has an explicit mutable task-array type",
    /const current:\s*\{\s*name:\s*string;\s*tasks:\s*any\[\]\s*\}\s*=\s*map\.get\(key\)/,
  ],
  [
    "readiness department accumulator has an explicit mutable task-array type",
    /const current:\s*\{\s*name:\s*string;\s*tasks:\s*any\[\]\s*\}\s*=\s*departments\.get\(departmentKey\)/,
  ],
];

let passed = 0;
for (const [name, pattern] of checks) {
  if (!pattern.test(source)) {
    console.error(`FAIL: ${name}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${name}`);
    passed += 1;
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`Marketing dashboard build regression v1.20.3: ${passed}/${checks.length} passed.`);
