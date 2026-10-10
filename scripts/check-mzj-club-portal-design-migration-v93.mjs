import fs from 'node:fs';

const schema = fs.readFileSync('server/_owners-schema.ts', 'utf8');
const owners = fs.readFileSync('server/owners.ts', 'utf8');

const checks = [
  ['portal_design is part of base schema', schema.includes("portal_design text not null default 'design_1'")],
  ['portal_design migration is idempotent', schema.includes("alter table owners.settings add column if not exists portal_design text not null default 'design_1';")],
  ['schema readiness requires portal_design', schema.includes("column_name='portal_design'")],
  ['schema version advanced to 1227', schema.includes('version=greatest(version,1227)') && schema.includes('>= 1227')],
  ['allowed designs are constrained', schema.includes("check (portal_design in ('design_1','design_2','design_3'))")],
  ['settings save still writes selected design', owners.includes('portal_design=${portalDesign}')],
];

let passed = 0;
for (const [name, ok] of checks) {
  if (!ok) {
    console.error(`FAIL: ${name}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${name}`);
    passed += 1;
  }
}
if (!process.exitCode) console.log(`MZJ Club portal design migration v93 checks: ${passed}/${checks.length} passed.`);
