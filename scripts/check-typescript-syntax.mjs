import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const roots = ["src", "server", "api", "vite.config.ts"];
const files = [];

function walk(target) {
  if (!fs.existsSync(target)) return;
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target)) walk(path.join(target, entry));
    return;
  }
  if (/\.(?:ts|tsx)$/.test(target)) files.push(target);
}

for (const root of roots) walk(root);

const diagnostics = [];
const sourceFiles = new Map();

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, kind);
  sourceFiles.set(file, sourceFile);

  for (const diagnostic of sourceFile.parseDiagnostics) {
    diagnostics.push({ file, diagnostic });
  }

  // Declaration files do not emit JavaScript and can make transpileModule throw.
  if (file.endsWith(".d.ts")) continue;

  try {
    const transpiled = ts.transpileModule(source, {
      fileName: file,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        isolatedModules: true,
      },
    });
    for (const diagnostic of transpiled.diagnostics || []) {
      if (diagnostic.category === ts.DiagnosticCategory.Error) {
        diagnostics.push({ file, diagnostic });
      }
    }
  } catch (error) {
    diagnostics.push({
      file,
      diagnostic: {
        category: ts.DiagnosticCategory.Error,
        code: 0,
        file: sourceFile,
        start: 0,
        length: 0,
        messageText: `TypeScript transpilation failed: ${error instanceof Error ? error.message : String(error)}`,
      },
    });
  }
}

if (diagnostics.length) {
  for (const { file, diagnostic } of diagnostics) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    const sourceFile = sourceFiles.get(file);
    const line = diagnostic.start == null || !sourceFile
      ? 0
      : ts.getLineAndCharacterOfPosition(sourceFile, diagnostic.start).line + 1;
    console.error(`${file}:${line}: ${message}`);
  }
  process.exit(1);
}

console.log(`TypeScript/TSX syntax and isolated transpilation checks passed for ${files.length} files.`);
