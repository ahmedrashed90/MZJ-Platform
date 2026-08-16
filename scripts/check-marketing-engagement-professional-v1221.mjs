import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const checks = [];
const check = (name, value) => checks.push({ name, ok: Boolean(value) });

const schema = read("server/_marketing-schema.ts");
const backend = read("server/_marketing-engagement.ts");
const marketing = read("server/marketing/index.ts");
const permissions = read("server/_api-permissions.ts");
const page = read("src/marketing/pages/EngagementPage.tsx");
const css = read("src/marketing/marketing.css");

check("published posts support archive and soft delete", schema.includes("alter table marketing.published_posts add column if not exists archived_at") && schema.includes("alter table marketing.published_posts add column if not exists is_deleted"));
check("engagement rows support archive and soft delete", schema.includes("create table if not exists marketing.post_engagements") && schema.includes("archived_at timestamptz") && schema.includes("is_deleted boolean not null default false"));
check("Test experiment cleanup runs once after backfill", schema.includes("create table if not exists marketing.data_migrations") && backend.includes("cleanupLegacyTestEngagementRows") && backend.includes("20260730_remove_test_engagement_rows") && backend.includes("lower(btrim(c.name))='test'") && backend.includes("lower(btrim(a.name))='test'"));
check("existing CRM source is repaired only for customers created by engagement", backend.includes("repairStoredEngagementSources") && backend.includes("20260730_repair_engagement_crm_sources") && backend.includes("pe.processing_status='created'") && backend.includes("then 'بوست انستجرام' else 'بوست فيس بوك'"));
check("engagement API excludes deleted rows", backend.includes("where pp.is_deleted=false") && backend.includes("where pe.is_deleted=false and pe.engagement_type='comment' and pp.is_deleted=false"));
check("post and engagement actions implemented", backend.includes("export async function manageEngagementItem") && backend.includes("entity === 'post'") && backend.includes("operation === 'delete_customer'"));
check("reused CRM customers cannot be removed", backend.includes("هذا العميل كان موجودًا مسبقًا في CRM"));
check("management action wired into marketing API", marketing.includes("action==='manage_engagement_item'") && marketing.includes("manageEngagementItem(sql,body,user)"));
check("customer deletion has CRM permission guard", marketing.includes("hasPermission(user,'crm.customer.delete')"));
check("central permission map includes management action", permissions.includes('manage_engagement_item: "marketing.publish.now"'));
check("page has professional shared filters", page.includes("marketing-engagement-control-panel") && page.includes("postStatus") && page.includes("engagementStatus"));
check("published posts expose archive restore and delete", page.includes('manage("post", "archive"') && page.includes('manage("post", "restore"') && page.includes('manage("post", "delete"'));
check("comment rows expose archive restore delete and customer delete", page.includes('manage("engagement", "archive"') && page.includes('manage("engagement", "delete_customer"'));
check("long sync errors are collapsed", page.includes("marketing-error-compact") && page.includes("عرض سبب الفشل"));
check("exact source labels shown in UI", page.includes('بوست فيس بوك') && page.includes('بوست انستجرام'));
check("professional responsive styling exists", css.includes("/* Publishing engagement report V1221 */") && css.includes(".marketing-action-menu") && css.includes(".marketing-engagement-feed"));

const failed = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exit(1);
