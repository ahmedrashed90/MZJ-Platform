import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../server/_crm-finance-details.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    strict: true,
  },
  reportDiagnostics: true,
  fileName: "_crm-finance-details.ts",
});
const errors = (transpiled.diagnostics || []).filter((item) => item.category === ts.DiagnosticCategory.Error);
if (errors.length) {
  throw new Error(errors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n")).join("\n"));
}
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`;
const { parseFinanceCombinedDetails, financeMissingPrompt, FINANCE_COMBINED_PROMPT } = await import(moduleUrl);

function assertDetails(label, input, expected, existing = {}) {
  const result = parseFinanceCombinedDetails(input, existing);
  for (const [key, value] of Object.entries(expected)) {
    if (result.values[key] !== value) throw new Error(`${label}: expected ${key}=${value}, received ${result.values[key]}`);
  }
  if (result.missing.length) throw new Error(`${label}: fields still missing: ${result.missing.join(",")}`);
}

assertDetails("multiline", "أحمد محمد\nسوناتا\n0541421013", {
  customerName: "أحمد محمد",
  carName: "سوناتا",
  phone: "966541421013",
});
assertDetails("commas", "أحمد محمد، سوناتا، 0541421013", {
  customerName: "أحمد محمد",
  carName: "سوناتا",
  phone: "966541421013",
});
assertDetails("labels any order", "رقم الجوال: 0541421013 السيارة: تويوتا كامري الاسم: أحمد محمد", {
  customerName: "أحمد محمد",
  carName: "تويوتا كامري",
  phone: "966541421013",
});
assertDetails("compact common model", "أحمد محمد تويوتا كامري 0541421013", {
  customerName: "أحمد محمد",
  carName: "تويوتا كامري",
  phone: "966541421013",
});
assertDetails("accumulated", "0541421013", {
  customerName: "أحمد",
  carName: "سوناتا",
  phone: "966541421013",
}, { customerName: "أحمد", carName: "سوناتا" });

const first = parseFinanceCombinedDetails("أحمد");
if (first.values.customerName !== "أحمد" || first.missing.join(",") !== "carName,phone") throw new Error("partial name capture failed");
const second = parseFinanceCombinedDetails("سوناتا", first.values);
if (second.values.carName !== "سوناتا" || second.missing.join(",") !== "phone") throw new Error("partial car capture failed");
if (!FINANCE_COMBINED_PROMPT.includes("الاسم\nالسيارة\nرقم الجوال")) throw new Error("combined finance prompt is incomplete");
if (financeMissingPrompt(["carName", "phone"]) !== "برجاء استكمال بيانات التمويل التالية 👇\nالسيارة\nرقم الجوال") throw new Error("missing fields prompt mismatch");

console.log("CRM finance combined details parser v1.18.0: PASS");
