import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([".git", "node_modules", "dist", ".vercel"]);
const textExtensions = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".json", ".css", ".html", ".sql", ".md", ".txt", ".yml", ".yaml"
]);
const conflictPattern = /^(<<<<<<<|>>>>>>>)(?:\s|$)/m;
const conflicts = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!entry.isFile() || !textExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    const source = fs.readFileSync(fullPath, "utf8");
    if (conflictPattern.test(source)) conflicts.push(path.relative(root, fullPath));
  }
}

walk(root);
if (conflicts.length) {
  console.error("Unresolved merge-conflict markers found:");
  for (const file of conflicts) console.error(`- ${file}`);
  process.exit(1);
}
console.log("PASS: no unresolved merge-conflict markers found");
