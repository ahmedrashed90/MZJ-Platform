import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const apiDir = path.resolve('api');
const invalid = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;

    const source = await readFile(fullPath, 'utf8');
    const importPattern = /(?:from\s+|import\s*)["'](\.\.?\/[^"']+)["']/g;
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (!/\.(?:js|json|node)$/.test(specifier)) {
        invalid.push(`${path.relative(process.cwd(), fullPath)}: ${specifier}`);
      }
    }
  }
}

await walk(apiDir);

if (invalid.length) {
  console.error('Vercel API imports must use explicit .js extensions:');
  for (const item of invalid) console.error(`- ${item}`);
  process.exit(1);
}

console.log('API import extension check passed.');
