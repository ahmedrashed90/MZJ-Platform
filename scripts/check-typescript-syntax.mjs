import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const roots = ["src", "server", "api"];
const files = [];

function collect(entry) {
  if (!fs.existsSync(entry)) return;
  const stat = fs.statSync(entry);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(entry)) collect(path.join(entry, name));
    return;
  }
  if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) files.push(entry);
}

for (const root of roots) collect(root);

const failures = [];
for (const fileName of files) {
  const source = fs.readFileSync(fileName, "utf8");
  const result = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      isolatedModules: true,
    },
  });
  for (const diagnostic of result.diagnostics || []) {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
    const position = diagnostic.file && diagnostic.start != null
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      : null;
    failures.push(`${fileName}${position ? `:${position.line + 1}:${position.character + 1}` : ""} TS${diagnostic.code}: ${message}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`TypeScript/TSX syntax transpile check passed (${files.length} files).`);
