import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const roots = ["src", "server", "api", "shared"];
const files = [];
function walk(relative) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) walk(child);
    else if (/\.(?:ts|tsx|js|jsx|mjs)$/i.test(entry.name)) files.push(child);
  }
}
for (const directory of roots) walk(directory);

const failures = [];
function resolves(fromFile, specifier) {
  const base = path.resolve(root, path.dirname(fromFile), specifier);
  const candidates = [base];
  if (/\.js$/i.test(base)) candidates.push(base.replace(/\.js$/i, ".ts"), base.replace(/\.js$/i, ".tsx"));
  if (!path.extname(base)) {
    for (const extension of [".ts", ".tsx", ".js", ".jsx", ".mjs"]) candidates.push(`${base}${extension}`);
    for (const extension of [".ts", ".tsx", ".js", ".jsx", ".mjs"]) candidates.push(path.join(base, `index${extension}`));
  }
  return candidates.some((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["'](\.[^"']+)["']/g,
    /\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (!resolves(file, match[1])) failures.push(`${file} -> ${match[1]}`);
    }
  }
}

if (failures.length) throw new Error(`Local module graph check failed:\n- ${[...new Set(failures)].join("\n- ")}`);
console.log(`Local module graph check passed: ${files.length} source files`);
