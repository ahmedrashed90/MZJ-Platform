import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const canonicalPath = path.join(root, "database/marketing_native_schema.sql");
const runtimePath = path.join(root, "server/_marketing-schema.ts");
const migrationPath = path.join(root, "database/migrations/20260723_marketing_native_clean_rebuild.sql");

const canonical = fs.readFileSync(canonicalPath, "utf8").trimEnd();
let runtime = fs.readFileSync(runtimePath, "utf8");
const pattern = /(export const MARKETING_SCHEMA_SQL = String\.raw`)[\s\S]*?(`;)/;
if (!pattern.test(runtime)) throw new Error("MARKETING_SCHEMA_SQL block was not found");
runtime = runtime.replace(pattern, (_match, prefix, suffix) => `${prefix}${canonical}${suffix}`);
fs.writeFileSync(runtimePath, runtime);
fs.writeFileSync(migrationPath, `${canonical}\n`);
console.log("Marketing canonical schema synchronized to runtime and deployment migration.");
