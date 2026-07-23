import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let ts;
try { ts = require("typescript"); }
catch { ts = require("/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js"); }

const root = process.cwd();
const requiredFiles = [
  "src/marketing/MarketingLayout.tsx",
  "src/marketing/pages/MarketingDashboardPage.tsx",
  "src/marketing/pages/CampaignWizardPage.tsx",
  "src/marketing/pages/TasksPage.tsx",
  "src/marketing/pages/PublishPrepPage.tsx",
  "src/marketing/settings/MarketingSettingsPanel.tsx",
  "server/marketing/index.ts",
  "server/marketing/auth.ts",
  "database/migrations/20260723_marketing_native_phase1.sql",
  "database/migrations/20260723_marketing_publisher_runtime.sql",
  "database/migrations/20260723_marketing_publish_reconciliation.sql",
  "marketing-publisher-agent/src/index.mjs",
  "marketing-publisher-agent/src/scanner.mjs",
  "marketing-publisher-agent/src/api-client.mjs",
];
for (const file of requiredFiles) assert.ok(fs.existsSync(path.join(root, file)), `Missing ${file}`);

function walk(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target).flatMap((name) => walk(path.join(target, name)));
}

for (const file of [...walk(path.join(root, "src/marketing")), ...walk(path.join(root, "server/marketing"))].filter((name) => /\.tsx?$/.test(name))) {
  const source = fs.readFileSync(file, "utf8");
  const result = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, isolatedModules: true },
  });
  const errors = (result.diagnostics || []).filter((item) => item.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `${file}: ${errors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, " ")).join(" | ")}`);
}

function loadTsModule(relativePath) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", "__filename", "__dirname", output)(require, module, module.exports, filename, path.dirname(filename));
  return module.exports;
}

const progress = loadTsModule("server/marketing/services/progress.ts");
assert.equal(progress.calculateTaskProgress({ task_type: "content_template", status: "pending_template" }), 0);
assert.equal(progress.calculateTaskProgress({ task_type: "content_template", status: "template_submitted" }), 70);
assert.equal(progress.calculateTaskProgress({ task_type: "execution", status: "completed", requires_final_file: true, active_final_files: 0 }), 95);
assert.equal(progress.calculateTaskProgress({ task_type: "execution", status: "completed", requires_final_file: true, active_final_files: 1 }), 100);
assert.equal(progress.average([100, 50, 0]), 50);

const pair = loadTsModule("server/marketing/services/pair.ts");
const firstPair = pair.createPairKey("creative-a", "design", "user-a", "writer-a");
assert.equal(firstPair, pair.createPairKey("creative-a", "design", "user-a", "writer-a"));
assert.notEqual(firstPair, pair.createPairKey("creative-a", "design", "user-a", "writer-b"));
assert.equal(firstPair.length, 32);

const forbidden = ["firebase/app", "firebase/firestore", "merged-patches.js", "MutationObserver", "window.localStorage"];
for (const file of [...walk(path.join(root, "src/marketing")), ...walk(path.join(root, "server/marketing"))].filter((name) => /\.(ts|tsx|js|mjs)$/.test(name))) {
  const source = fs.readFileSync(file, "utf8");
  for (const token of forbidden) assert.ok(!source.includes(token), `${path.relative(root, file)} contains forbidden token ${token}`);
}

const app = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");
for (const route of ["campaigns/new", "agendas/new", "publish-prep", "receipt-calendar", "local-publisher", "departments"]) assert.ok(app.includes(route), `Missing marketing route ${route}`);
const dispatcher = fs.readFileSync(path.join(root, "api/index.ts"), "utf8");
assert.ok(dispatcher.includes('["marketing", marketingHandler]'), "Marketing API dispatcher is not registered");

const migration = fs.readFileSync(path.join(root, "database/migrations/20260723_marketing_native_phase1.sql"), "utf8");
for (const table of ["marketing.assignment_writer_links", "marketing.task_template_versions", "marketing.publish_prep_items", "marketing.attendance_records", "marketing.publisher_devices"]) assert.ok(migration.includes(table), `Migration missing ${table}`);
assert.ok(!/alter table\s+(crm|operations|tracking)\./i.test(migration), "Marketing migration alters a protected schema");

const publisherMigration = fs.readFileSync(path.join(root, "database/migrations/20260723_marketing_publisher_runtime.sql"), "utf8");
for (const table of ["marketing.publisher_import_plans", "marketing.publish_jobs"]) assert.ok(publisherMigration.includes(table), `Publisher migration missing ${table}`);
assert.ok(!/alter table\s+(crm|operations|tracking)\./i.test(publisherMigration), "Publisher migration alters a protected schema");
const reconciliationMigration = fs.readFileSync(path.join(root, "database/migrations/20260723_marketing_publish_reconciliation.sql"), "utf8");
assert.ok(reconciliationMigration.includes("schedule_target_id"), "Publish reconciliation migration is incomplete");

const marketingServer = fs.readFileSync(path.join(root, "server/marketing/index.ts"), "utf8");
assert.ok(!/(update|insert into|delete from)\s+operations\./i.test(marketingServer), "Marketing server writes to operations schema");
assert.ok(marketingServer.includes("agent-runtime"), "Publisher runtime endpoint is missing");
for (const marker of ["task-file-prepare", "task-file-download", "task-template-version-download", "createUploadUrl", "createDownloadUrl"]) assert.ok(marketingServer.includes(marker), `Secure task file flow missing ${marker}`);
assert.ok(!marketingServer.includes("pending-upload/"), "Marketing server contains placeholder upload paths");
const tasksPage = fs.readFileSync(path.join(root, "src/marketing/pages/TasksPage.tsx"), "utf8");
assert.ok(tasksPage.includes("uploadMarketingTaskFile"), "Tasks page does not upload task files to storage");
assert.ok(!tasksPage.includes("pending-upload/"), "Tasks page contains placeholder upload paths");

for (const file of walk(path.join(root, "marketing-publisher-agent")).filter((name) => /\.mjs$/.test(name))) {
  const source = fs.readFileSync(file, "utf8");
  assert.ok(!/firebase|postgres|access[_-]?token|refresh[_-]?token/i.test(source), `${path.relative(root, file)} contains forbidden direct integration code`);
}

console.log("Marketing native checks passed");
