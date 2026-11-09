import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const roots = [path.resolve("api"), path.resolve("server")];
const invalid = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;

    const source = await readFile(fullPath, "utf8");
    const importPattern = /(?:from\s+|import\s*)["'](\.\.?\/[^"']+)["']/g;
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (!/\.(?:js|json|node)$/.test(specifier)) {
        invalid.push(`${path.relative(process.cwd(), fullPath)}: ${specifier}`);
      }
    }
  }
}

for (const root of roots) await walk(root);

if (invalid.length) {
  console.error("NodeNext imports must use explicit .js extensions:");
  for (const item of invalid) console.error(`- ${item}`);
  process.exit(1);
}

console.log("API and server import extension check passed.");
