import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
  if (!condition) {
    console.error(`CRM export re-import check failed: ${message}`);
    process.exit(1);
  }
};

const backend = read("server/data-management.ts");
const panel = read("src/settings/DataManagementPanel.tsx");

const helperStart = backend.indexOf("async function updateExistingSoldCustomers");
const helperEnd = backend.indexOf("async function importCustomers", helperStart);
const helper = backend.slice(helperStart, helperEnd);
const soldDateAliasMatch = helper.match(/const explicitSoldAt\s*=\s*rowValue\(sourceRow,\s*\[([\s\S]*?)\]\);/);
const soldDateAliases = soldDateAliasMatch?.[1] || "";

assert(helperStart >= 0 && helperEnd > helperStart, "cash/finance update-only helper is missing");
assert(helper.includes('normalizedText("تم البيع")'), "update-only import is not restricted to sold rows");
assert(Boolean(soldDateAliasMatch), "explicit sold-date column lookup is missing");
assert(soldDateAliases.includes('"تاريخ تم البيع"') && soldDateAliases.includes('"تاريخ البيع"'), "sold-date aliases are incomplete");
assert(!soldDateAliases.includes('"آخر تحديث"'), "last-update column must never be used as a sales date");
assert(helper.includes("parseImportedDate(explicitSoldAt)"), "explicit sold date is not parsed");
assert(backend.includes("function latinDigits") && backend.includes("function parseImportedDate"), "Arabic digit date normalization is missing");
assert(helper.includes("sold_at=(${soldDate}::date::timestamp at time zone 'Asia/Riyadh')"), "lead latest sold date is not persisted using Riyadh-local calendar date");
assert(helper.includes("updateLatestManualSale(tx"), "latest manual sales transaction is not corrected with the lead snapshot");
assert(helper.includes('sourceType: "import_backfill"'), "import correction source is not identified");
assert(helper.includes('rowValue(sourceRow, ["رقم داخلي"'), "exported internal ID is not used for matching");
assert(helper.includes("phone_normalized=${phoneNormalized}"), "phone fallback matching is missing");
assert(helper.includes("has_erp_sale") && helper.includes("طلب بيع في Next ERP"), "ERP sales are not protected from customer-sheet date rewrites");
assert(!helper.includes("insert into crm.leads"), "cash/finance re-import must never add customers");
assert(backend.includes('if (department === "cash" || department === "finance")') && backend.includes("return updateExistingSoldCustomers"), "cash/finance imports do not exit into update-only mode before legacy insert logic");
assert(panel.includes('"تاريخ تم البيع"') && panel.includes('"آخر تحديث"'), "customer export columns do not expose both dates clearly");
assert(panel.includes("عمود آخر تحديث لا يغيّر أي تاريخ مبيعات"), "UI does not explain the protected sales-date rule");
assert(panel.includes("ولم تتم إضافة أي عميل جديد"), "UI does not clearly confirm that no customers were added");

console.log("CRM cash/finance export re-import sales-date protection checks passed.");
