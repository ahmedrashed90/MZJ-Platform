import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const must = (name, condition) => {
  if (!condition) {
    console.error(`FAIL: ${name}`);
    process.exit(1);
  }
};

const schema = read("server/_owners-schema.ts");
const settings = read("src/owners/OwnersSettingsPanel.tsx");
const calculator = read("src/owners/OwnersDiscountCalculator.tsx");
const publicApi = read("server/owners-public.ts");
const adminApi = read("server/owners.ts");
const configBridge = read("server/_owners-discount-config.ts");
const portal = read("src/owners/OwnersPortalPage.tsx");
const preview = read("src/owners/OwnersMemberPreviewPage.tsx");
const styles = read("src/styles.css");

must("portal_design schema", schema.includes("portal_design text not null default 'design_1'") && schema.includes("'design_2'") && schema.includes("'design_3'"));
must("three selectable designs", ["design_1", "design_2", "design_3"].every((id) => settings.includes(id)) && settings.includes("اختيار التصميم"));
must("preview thumbnails", [1, 2, 3].every((n) => fs.existsSync(path.join(root, `public/owners-designs/design-${n}.webp`))));
must("settings persisted", adminApi.includes("portal_design=${portalDesign}") && portal.includes("me?.portalDesign") && preview.includes("data?.portalDesign"));
must("plugin config consumed server-side", configBridge.includes("/wp-json/mzj-vso/v1/club-discounts") && publicApi.includes("getOwnersDiscountConfig") && adminApi.includes("getOwnersDiscountConfig"));
must("calculator has no hard-coded one-percent multiplier", !calculator.includes("* 0.01"));
must("calculator renamed", calculator.includes("اعرف خصمك"));
must("personal discount is SAR amount", calculator.includes("الخصم الشخصي") && calculator.includes("personalDiscount.toLocaleString") && calculator.includes("ر.س"));
must("friend gift is SAR amount", calculator.includes("خصم إهداء لصديق") && calculator.includes("friendGiftDiscount.toLocaleString") && !calculator.includes(">1%</"));
must("classification drives first/repeat rate", calculator.includes('profileKind === "member"') && calculator.includes("repeatPurchasePercent") && calculator.includes("firstPurchasePercent"));
must("friend gift rate independent", calculator.includes("friendGiftPercent"));
must("three-column calculator desktop", styles.includes("grid-template-columns:repeat(3,minmax(0,1fr))"));
must("three design theme selectors", ["design_1", "design_2", "design_3"].every((id) => styles.includes(`.owners-club-design.${id}`)));
must("public portal receives profile kind", publicApi.includes('profileKind: "legacy"') && publicApi.includes('profileKind: "member"'));

console.log("PASS: MZJ Club Community design switch + plugin-synced discount calculator v92");
