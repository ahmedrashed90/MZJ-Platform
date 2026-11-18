import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const reports = read("server/crm/reports.ts");
const reportsUi = read("src/crm/pages/CrmReportsPage.tsx");
const pkg = JSON.parse(read("package.json"));

const typecheck = String(pkg.scripts?.typecheck || "");
const ownersIndex = typecheck.indexOf("check-owners-community-v1200.mjs");
const v42Index = typecheck.indexOf("check-crm-zero-dimensions-v42.mjs");

const checks = [
  [reports.includes('if (code === "website") return "الموقع الإلكتروني";'), "اسم فرع الموقع الإلكتروني يظهر بدون بادئة فرع"],
  [reports.includes('const websiteDepartmentDetail = "cash_sales|website";'), "بعد مبيعات الكاش/الموقع الإلكتروني مثبت في التقرير"],
  [reports.includes('...makeMetrics([], [])') && reports.includes('detailValue: websiteDepartmentDetail'), "صف الموقع الإلكتروني الصفري يستخدم مقاييس صفرية حقيقية"],
  [reports.includes('eligibleAgentRows = await sql<any[]>'), "التقرير يجلب مناديب CRM من الإعدادات وليس من العملاء فقط"],
  [reports.includes("effective_department.code in ('cash_sales','finance_sales','wholesale','wholesale_sales')"), "المناديب المؤهلون مقيدون بأقسام المبيعات"],
  [reports.includes("r.code='sales_user'") && reports.includes('u.can_receive_leads=true'), "تعريف المندوب يعتمد على أهلية الاستقبال أو دور sales_user"],
  [reports.includes('...eligibleAgentRows.map((row) => String(row.user_id || "").trim())'), "مناديب الصفر يدخلون في هوية التقرير"],
  [reports.includes('const agentsById = new Map') && reports.includes('if (agentsById.has(key)) continue;'), "المناديب الصفريون يدمجون بدون تكرار"],
  [reports.includes('name: String(item.full_name || "مندوب")') && reports.includes('detailKind: "agent"'), "صف المندوب الصفري قابل لفتح تقرير عملائه"],
  [reportsUi.includes('{ title: "تقرير الأقسام والفروع"') && reportsUi.includes('{ title: "تقارير المناديب"'), "واجهة التقارير تستخدم بيانات الأقسام والمناديب الديناميكية"],
  [ownersIndex >= 0 && v42Index > ownersIndex, "فحص Owners ما زال يسبق فحص v42 في البناء"],
];

let passed = 0;
for (const [ok, label] of checks) {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    process.exitCode = 1;
  } else {
    passed += 1;
    console.log(`PASS: ${label}`);
  }
}
console.log(`CRM zero dimensions v42 checks: ${passed}/${checks.length} passed`);
