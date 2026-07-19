import fs from "node:fs";
import vm from "node:vm";
const tsModule = await import("typescript").catch(() => import("/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js"));
const ts = tsModule.default ?? tsModule;

const sourcePath = new URL("../server/_crm-customer-fields.ts", import.meta.url);
const source = fs.readFileSync(sourcePath, "utf8")
  .replace('import { getSql } from "./_db.js";', 'const getSql = () => { throw new Error("Database access is disabled in this calculation check"); };');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports, console, Set, Math, String, Boolean, Number, Object, Array });
const { calculateLeadCompletion } = module.exports;
if (typeof calculateLeadCompletion !== "function") throw new Error("Customer completion calculator was not exported");

const field = (field_key, extra = {}) => ({
  field_key,
  is_active: true,
  include_in_completion: true,
  department_keys: [],
  ...extra,
});
const base = [field("customer_name"), field("phone"), field("notes", { include_in_completion: false })];
const lead = { customer_name: "عميل", phone: "", notes: "لا تدخل في النسبة", service_key: "cash" };
if (calculateLeadCompletion(lead, base) !== 50) throw new Error("Base completion must exclude notes");
const withBlankCustom = [...base, field("job_title")];
if (calculateLeadCompletion(lead, withBlankCustom) !== 33) throw new Error("Adding an included blank field must increase the denominator");
const filledCustom = { ...lead, extra_data: { job_title: "مدير" } };
if (calculateLeadCompletion(filledCustom, withBlankCustom) !== 67) throw new Error("Filling a custom field must increase the numerator");
const disabledCustom = [...base, field("job_title", { is_active: false })];
if (calculateLeadCompletion(filledCustom, disabledCustom) !== 50) throw new Error("Disabling a field must remove it from the calculation");
const financeOnly = [...base, field("finance_extra", { department_keys: ["finance"] })];
if (calculateLeadCompletion(lead, financeOnly) !== 50) throw new Error("A finance-only field must not affect a cash customer");
console.log("Dynamic customer completion calculation check passed.");
