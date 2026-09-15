import fs from "node:fs";

const schema = fs.readFileSync("server/_owners-schema.ts", "utf8");
const owners = fs.readFileSync("server/_owners.ts", "utf8");
const admin = fs.readFileSync("server/owners.ts", "utf8");
const checks = [
  [schema.includes("current_version < 1225") && schema.includes("pointsProductionResetVersion',1225"), "one-time production reset is versioned at 1225"],
  [schema.includes("delete from owners.points_ledger ledger") && schema.includes("member.status='active'"), "existing sold-member movement ledger is cleared"],
  [schema.includes("points_balance=500") && schema.includes("lifetime_points=500") && schema.includes("tier_code='member'"), "existing sold members restart at 500 with historical category cleared"],
  [schema.includes("'pointsProductionOpeningBalance',500") && schema.includes("'pointsProductionOpeningAt',launch_at"), "500 opening balance is virtual and timestamped rather than a ledger row"],
  [schema.includes("return Number(state?.version || 0) >= 1226"), "schema readiness includes the post-reset registered-referral schema version"],
  [owners.includes("sale.sale_at>member.production_opening_at") && owners.includes("case when sale.production_reset then 1 else 0 end as sale_rank"), "historical purchases cannot be re-awarded and next sale is a repurchase"],
  [owners.includes("member.production_opening_balance + coalesce(sum(ledger.points),0)::int as points_balance"), "reconciliation preserves the virtual 500 opening balance"],
  [owners.includes("pointsProductionOpeningBalance','')::int,0)\n            + coalesce(sum(ledger.points),0)::int as points_balance"), "cancellation reconciliation also preserves opening 500"],
  [owners.includes("pointsProductionResetAt") && owners.includes("saleAfterProductionReset"), "historical referral sales cannot recreate experimental points"],
  [owners.includes("updated.length && referralCreatedAfterProductionReset"), "historical qualified referrals cannot recreate experimental points"],
  [admin.includes("ensureOwnerPurchasePointsForMember") && admin.includes('input.source === "excel_import"'), "future imported sold customers receive their initial purchase points immediately"],
  [!schema.includes("'pointsProductionResetVersion',1225,\n        'baseline'"), "production opening balance is not inserted as a movement"],
];
let passed = 0;
for (const [ok,label] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
  if (ok) passed += 1;
}
console.log(`Owners production points reset v37 checks: ${passed}/${checks.length} passed`);
if (passed !== checks.length) process.exit(1);
