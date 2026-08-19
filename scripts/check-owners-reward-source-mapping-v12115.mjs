import fs from "node:fs";
const text = fs.readFileSync(new URL("../server/owners-public.ts", import.meta.url), "utf8");
function need(condition, message) { if (!condition) throw new Error(message); }
need(text.includes('const customerKind = referrerKind === "legacy"\n    ? "existing" as const'), "customerKind eligibility logic changed unexpectedly");
need(text.includes("(${referrerKind}='legacy' and available_for_referral_purchase=true)"), "legacy must map to new-customer reward audience");
need(text.includes("(${referrerKind}='member' and available_for_existing_customer_purchase=true)"), "member must map to existing-customer reward audience");
need(text.includes('return referrerKind === "legacy"\n    ? reward?.available_for_referral_purchase === true\n    : reward?.available_for_existing_customer_purchase === true;'), "reward source helper mismatch");
need((text.match(/getCommerceRewards\(eligibility\.referrerKind/g) || []).length === 3, "all commerce reward endpoints must query by referrerKind");
need((text.match(/rewardAvailableForReferrerKind\(lockedReward, eligibility\.referrerKind\)/g) || []).length === 2, "single and bundle transaction locks must revalidate by referrerKind");
need(text.includes('eligibility.customerKind === "new" && eligibility.referrerKind === "member"'), "new member referral creation rule must stay unchanged");
console.log("owners reward source mapping check: 7/7 passed");
