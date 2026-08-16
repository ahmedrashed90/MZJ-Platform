import fs from "node:fs";

const server = fs.readFileSync("server/marketing/index.ts", "utf8");
const database = fs.readFileSync("src/marketing/pages/MarketingDatabasePage.tsx", "utf8");
const manager = fs.readFileSync("src/marketing/components/EntityCreativeManager.tsx", "utf8");
const editor = fs.readFileSync("src/marketing/components/CreativeEditor.tsx", "utf8");
const css = fs.readFileSync("src/marketing/marketing.css", "utf8");

const checks = [
  ["backend action exists", server.includes("action==='save_entity_creative'")],
  ["campaign edit permission", server.includes("marketing.campaign.edit")],
  ["agenda edit permission", server.includes("marketing.agenda.edit")],
  ["entity scope validation", server.includes("assertMarketingEntityAccess(sql, user, sourceType, sourceId)")],
  ["creative insert", server.includes("insert into marketing.creatives(campaign_id,agenda_id")],
  ["creative update", server.includes("update marketing.creatives set")],
  ["task flow creation", server.includes("await createTasksForCreative(tx")],
  ["old active tasks preserved as revisions", server.includes("update marketing.tasks set is_deleted=true")],
  ["latest template revision selected per writer", server.includes("select distinct on (content_user_id)")],
  ["approved template returns under review", server.includes("تم تعديل بيانات الكرييتيف ويحتاج إعادة اعتماد")],
  ["execution data waits for approval", server.includes("promoteCreativeRevisionForReview")],
  ["campaign budget replacement", server.includes("replaceCreativeBudgets")],
  ["campaign budget required server-side", server.includes('throw new Error("أضف ميزانية للكرييتيف")')],
  ["budget platform required server-side", server.includes('throw new Error("حدد منصة واحدة على الأقل لكل بند ميزانية")')],
  ["schedule replacement", server.includes("replaceCreativeSchedule")],
  ["schedule required server-side", server.includes('throw new Error("أضف موعد نشر واحدًا على الأقل للكرييتيف")')],
  ["schedule details required server-side", server.includes('throw new Error("أكمل تاريخ ومنصة ونوع النشر لكل موعد")')],
  ["published creative protected", server.includes("لا يمكن تعديل كرييتيف تم نشره")],
  ["started execution protected", server.includes("بدأ تنفيذ هذا الكرييتيف")],
  ["database add creative button", database.includes("إضافة كرييتيف")],
  ["database edit creative button", database.includes("setCreativeManager({ open: true, row: creative })")],
  ["manager campaign flow", manager.includes('sourceType === "campaign"') && manager.includes("ميزانية الكرييتيف") && manager.includes("جدول نشر الكرييتيف")],
  ["manager agenda flow", manager.includes("اليوم وجدول النشر") && manager.includes('sourceType === "agenda"')],
  ["budget required for campaign", manager.includes("أكمل ميزانية الكرييتيف قبل الحفظ")],
  ["schedule required", manager.includes("أكمل جدول النشر قبل الحفظ")],
  ["revision notice", manager.includes("يظل التاسك التنفيذي متوقفًا حتى إعادة الاعتماد")],
  ["car selector modal stays above creative editor", manager.includes("carsModalLevel={3}") && editor.includes("level={carsModalLevel}")],
  ["responsive modal styling", css.includes("marketing-entity-creative-modal")],
  ["creative table styling", css.includes("marketing-entity-creatives-table") && database.includes("marketing-entity-creatives-table")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} - ${name}`);
  if (!ok) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
if (failed) process.exit(1);
