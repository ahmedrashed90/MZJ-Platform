import fs from "node:fs";

const server = fs.readFileSync("server/marketing/index.ts", "utf8");
const page = fs.readFileSync("src/marketing/pages/MarketingDatabasePage.tsx", "utf8");
const modal = fs.readFileSync("src/marketing/components/FreshMarketingImportModal.tsx", "utf8");
const resolver = fs.readFileSync("src/marketing/freshImport.ts", "utf8");
const css = fs.readFileSync("src/marketing/marketing.css", "utf8");
const bundle = JSON.parse(fs.readFileSync("migration-packages/mzj-marketing-fresh-import-2026-08.json", "utf8"));

const forbiddenKeys = new Set([
  "taskTemplate",
  "approvedContentTemplate",
  "taskTemplateStatus",
  "templateReviewStatus",
  "adminNotifications",
  "receivedAt",
  "approvedAt",
  "rejectedAt",
  "finalFile",
  "uploadedFile",
  "userCompleted",
  "waitingForApproval",
  "waitingForTaskTemplate",
]);

function findForbidden(value, path = "bundle", found = []) {
  if (Array.isArray(value)) value.forEach((item, index) => findForbidden(item, `${path}[${index}]`, found));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) found.push(`${path}.${key}`);
      findForbidden(item, `${path}.${key}`, found);
    }
  }
  return found;
}

const campaign = bundle.campaigns?.[0];
const agenda = bundle.agendas?.[0];
const agendaCreatives = (agenda?.days || []).flatMap((day) => day.creatives || []);
const allCreatives = [...(campaign?.creatives || []), ...agendaCreatives];
const allContentLinked = allCreatives.every((creative) => {
  const content = new Set((creative.contentUsers || []).map((user) => user.email || user.name).filter(Boolean));
  const linked = new Set([
    ...(creative.primaryUsers || []),
    ...(creative.optionalDepartments || []).flatMap((group) => group.users || []),
  ].flatMap((user) => [...(user.contentUserEmails || []), ...(user.contentUserNames || [])]).filter(Boolean));
  return [...content].every((value) => linked.has(value));
});

const checks = [
  ["import action reuses canonical campaign creator", server.includes("createCampaignInTransaction") && server.includes("createCampaign(sql")],
  ["import action reuses canonical agenda creator", server.includes("createAgendaInTransaction") && server.includes("createAgenda(sql")],
  ["one transaction and idempotent migration key", server.includes("importFreshMarketingBundle") && server.includes("marketing.data_migrations") && server.includes("for update")],
  ["old campaign code is preserved only for import", server.includes("preserveRequestedCode") && server.includes("كود الحملة موجود بالفعل")],
  ["database page exposes fresh import", page.includes("FreshMarketingImportModal") && page.includes("نقل حملة وأجندة")],
  ["modal explicitly starts tasks from zero", modal.includes("كل التاسكات ستبدأ من الصفر") && modal.includes("import_fresh_marketing_bundle")],
  ["resolver maps current-system references", resolver.includes("resolveFreshMarketingImport") && resolver.includes("resolveUser") && resolver.includes("resolveCar") && resolver.includes("resolvePostType")],
  ["legacy emails are replaced through explicit user mappings", resolver.includes("FreshImportUserMapping") && resolver.includes("targetEmail") && resolver.includes("legacyEmail") && !resolver.includes("if (email) user =")],
  ["resolver blocks unresolved task links", resolver.includes("يوجد Task Template غير مربوط بتاسك تنفيذي")],
  ["fresh import styling exists", css.includes(".marketing-fresh-import-modal") && css.includes(".marketing-fresh-import-summary")],
  ["bundle format and version are correct", bundle.format === "mzj-marketing-fresh-import" && bundle.version === 1 && Boolean(bundle.migrationKey)],
  ["bundle has expected entities", bundle.campaigns?.length === 1 && bundle.agendas?.length === 1 && campaign?.creatives?.length === 7 && agendaCreatives.length === 13],
  ["bundle includes the four confirmed new-system user mappings", bundle.userMappings?.length === 4 && ["abdullah.kh@mzj-platform.com", "mahmoud@mzj-platform.com", "belal@mzj-platform.com", "nagy@mzj-platform.com"].every((email) => bundle.userMappings.some((item) => item.targetEmail === email))],
  ["bundle carries setup only", findForbidden(bundle).length === 0],
  ["every Task Template has an execution link", allContentLinked],
];

let passed = 0;
for (const [label, ok] of checks) {
  if (ok) {
    passed += 1;
    console.log(`PASS: ${label}`);
  } else {
    console.error(`FAIL: ${label}`);
  }
}

console.log(`Marketing fresh import v1.19.5 checks: ${passed}/${checks.length} passed`);
if (passed !== checks.length) {
  const forbidden = findForbidden(bundle);
  if (forbidden.length) console.error("Forbidden bundle fields:", forbidden.join(", "));
  process.exit(1);
}
