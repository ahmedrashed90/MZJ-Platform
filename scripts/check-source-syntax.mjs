import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const includeRoots = ["src", "server", "api", "shared"];
const extraFiles = ["vite.config.ts"];
const sourceFiles = [];

function walk(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return;
  const stat = fs.statSync(absolutePath);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(absolutePath)) walk(path.join(relativePath, name));
    return;
  }
  if (/\.(?:ts|tsx)$/i.test(relativePath)) sourceFiles.push(relativePath);
}

for (const directory of includeRoots) walk(directory);
for (const file of extraFiles) if (fs.existsSync(path.join(root, file))) sourceFiles.push(file);

const failures = [];
for (const relativePath of sourceFiles.sort()) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  const scriptKind = relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const parsed = ts.createSourceFile(relativePath, source, ts.ScriptTarget.ES2022, true, scriptKind);
  for (const diagnostic of parsed.parseDiagnostics) {
    const position = diagnostic.start == null ? null : parsed.getLineAndCharacterOfPosition(diagnostic.start);
    const location = position ? `${position.line + 1}:${position.character + 1}` : "unknown";
    failures.push(`${relativePath}:${location} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
  }
}

if (failures.length) throw new Error(`TypeScript syntax check failed:\n- ${failures.join("\n- ")}`);
console.log(`TypeScript syntax check passed: ${sourceFiles.length} files`);
