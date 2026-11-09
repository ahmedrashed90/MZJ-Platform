import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const sourcePath = "server/_erpnext-branch-routing.ts";
let source = fs.readFileSync(sourcePath, "utf8");
source = source.replace(
  'import { clean } from "./_tracking-utils.js";',
  'function clean(value) { return String(value ?? "").trim(); }',
);
const transpiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true },
  fileName: sourcePath,
}).outputText;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mzj-erpnext-branch-"));
const tempModule = path.join(tempDir, "routing.mjs");
fs.writeFileSync(tempModule, transpiled, "utf8");
const { resolveErpNextTrackingBranchCode } = await import(`${pathToFileURL(tempModule).href}?v=${Date.now()}`);

assert.equal(resolveErpNextTrackingBranchCode({
  erpBranch: "فرع القادسية",
  erpUserId: "sales@example.com",
  platformUser: { branch_code: "hall" },
}), "qadisiyah", "فرع القادسية يجب أن يعتمد كفرع القادسية دائمًا");

assert.equal(resolveErpNextTrackingBranchCode({
  erpBranch: "الفرع الرئيسي - الشفا",
  erpUserId: "hall@example.com",
  platformUser: { branch_code: "hall", branch_name: "فرع الصالة" },
}), "hall", "الفرع الرئيسي يجب أن يتبع فرع مستخدم NEXT ERP في الصالة");

assert.equal(resolveErpNextTrackingBranchCode({
  erpBranch: "الفرع الرئيسي - الشفا",
  erpUserId: "multaqa@example.com",
  platformUser: { branch_code: "multaqa", branch_name: "فرع الملتقى" },
}), "multaqa", "الفرع الرئيسي يجب أن يتبع فرع مستخدم NEXT ERP في الملتقى");

assert.equal(resolveErpNextTrackingBranchCode({
  erpBranch: "الفرع الرئيسي - الشفا",
  erpUserId: "ahmedayob506@gmail.com",
  platformUser: { email: "ahmedayob506@gmail.com", next_erp_user_id: "ahmedayob506@gmail.com", branch_code: "online" },
}), "hall", "أحمد أيوب يتبع الصالة في التراكينج حتى لو كان فرعه المسجل أونلاين");

assert.equal(resolveErpNextTrackingBranchCode({
  erpBranch: "فرع الملتقى",
  erpUserId: "sales@example.com",
  platformUser: null,
}), "multaqa", "أسماء الفروع المعروفة يجب تحويلها إلى أكواد النظام");

assert.equal(resolveErpNextTrackingBranchCode({
  erpBranch: "فرع غير معروف",
  erpUserId: "sales@example.com",
  platformUser: null,
}), "فرع غير معروف", "الفرع غير المعروف لا يجوز تغييره تخمينيًا");

const handler = fs.readFileSync("server/integrations/erpnext-sales-order.ts", "utf8");
const resolveIndex = handler.indexOf("resolveErpNextPlatformUser(normalized.erpUserId)");
const ingestIndex = handler.indexOf("ingestTrackingOrder({ ...payload, branch: trackingBranchCode || payload.branch })");
const syncIndex = handler.indexOf("syncErpNextSalesOrder({ normalized, trackingResults: results, userResolution })");
assert.ok(resolveIndex >= 0 && ingestIndex > resolveIndex && syncIndex > ingestIndex, "يجب حل فرع المستخدم قبل إدخال طلب التراكينج وإعادة استخدام نفس الربط في مزامنة CRM والعمليات");

const dataManagement = fs.readFileSync("server/data-management.ts", "utf8");
assert.ok(dataManagement.includes("type ImportCell = string | number | boolean | null;"), "صف الاستيراد يجب أن يكون JSON-compatible حتى ينجح TypeScript build");
assert.equal(dataManagement.includes("type ImportRow = Record<string, unknown>"), false, "نوع unknown القديم يعيد خطأ TS2345 في sql.json");

const jsonProbe = path.join(tempDir, "json-probe.ts");
fs.writeFileSync(jsonProbe, `
  type JSONValue = string | number | boolean | null | { [key: string]: JSONValue } | JSONValue[];
  declare function json(value: JSONValue): void;
  type ImportCell = string | number | boolean | null;
  type ImportRow = Record<string, ImportCell>;
  declare const sourceRow: ImportRow;
  json({ importedFrom: "legacy_excel", importedAt: new Date().toISOString(), originalRow: sourceRow });
`, "utf8");
const probeProgram = ts.createProgram([jsonProbe], {
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
});
const probeErrors = ts.getPreEmitDiagnostics(probeProgram).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
assert.deepEqual(probeErrors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")), [], "نوع صف الاستيراد يجب أن يقبل sql.json بدون TS2345");

console.log("PASS: NEXT ERP tracking branch routing and data-management build fix");
