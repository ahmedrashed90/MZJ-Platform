import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import ts from "typescript";

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

assert(helperStart >= 0 && helperEnd > helperStart, "cash/finance update-only helper is missing");
assert(helper.includes('normalizedText("تم البيع")'), "update-only import is not restricted to sold rows");
assert(helper.includes('"آخر تحديث"') && helper.includes("parseImportedDate(lastUpdate)"), "sold date is not read from the last-update column");
assert(helper.includes("latinDigits") === false && backend.includes("function latinDigits"), "Arabic digit date normalization is missing");
assert(helper.includes("set sold_at=(") && helper.includes("time zone 'Asia/Riyadh'"), "sold date is not persisted using Riyadh-local calendar date");
assert(helper.includes('rowValue(sourceRow, ["رقم داخلي"'), "exported internal ID is not used for matching");
assert(helper.includes("phone_normalized=${phoneNormalized}"), "phone fallback matching is missing");
assert(!helper.includes("insert into crm.leads"), "cash/finance re-import must never add customers");
assert(backend.includes('if (department === "cash" || department === "finance")') && backend.includes("return updateExistingSoldCustomers"), "cash/finance imports do not exit into update-only mode before legacy insert logic");
assert(panel.includes('"تم التحديث"') && panel.includes('"بدون تغيير"'), "update-only result labels are missing");
assert(panel.includes("ولم تتم إضافة أي عميل جديد"), "UI does not clearly confirm that no customers were added");

const parserStart = backend.indexOf("function latinDigits");
const parserEnd = backend.indexOf("function departmentWhere", parserStart);
assert(parserStart >= 0 && parserEnd > parserStart, "imported date parser block is missing");
const parserSource = `function clean(value) { return String(value ?? '').trim(); }\n${backend.slice(parserStart, parserEnd)}\nmodule.exports = { parseImportedDate };`;
const parserJs = ts.transpileModule(parserSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const parserModule = { exports: {} };
vm.runInNewContext(parserJs, { module: parserModule, exports: parserModule.exports, Date, String, Number });
assert(parserModule.exports.parseImportedDate("١٩‏/٥‏/٢٠٢٦، ٥:٥٢:٤٨ م") === "2026-05-19", "Arabic last-update timestamp does not resolve to 2026-05-19");

console.log("CRM cash/finance export re-import sold-date update checks passed.");
