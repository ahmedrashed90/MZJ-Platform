import fs from "node:fs";
import ts from "/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js";

const files = [
  "server/_attendance.ts",
  "server/attendance.ts",
  "server/auth/logout.ts",
  "src/auth/AuthContext.tsx",
  "src/pages/LoginPage.tsx",
  "src/components/Sidebar.tsx",
  "src/attendance/AttendancePage.tsx",
  "src/attendance/api.ts",
  "src/attendance/location.ts",
];

let failed = 0;
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: file,
    reportDiagnostics: true,
  });
  const diagnostics = result.diagnostics || [];
  const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) {
    failed += 1;
    console.error(`FAIL ${file}`);
    for (const d of errors) console.error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  } else {
    console.log(`PASS ${file}`);
  }
}
if (failed) process.exit(1);
