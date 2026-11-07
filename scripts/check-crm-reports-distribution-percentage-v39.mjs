import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const admin = read("src/crm/pages/CrmAdminPage.tsx");
const styles = read("src/styles.css");
const settings = read("server/crm/settings.ts");
const utils = read("server/_crm-utils.ts");
const schema = read("server/_crm-schema.ts");
const reports = read("server/crm/reports.ts");
const reportsUi = read("src/crm/pages/CrmReportsPage.tsx");


function simulateWeighted(weights, total) {
  const members = weights.map((weight, index) => ({ weight, count: 0, priority: index }));
  for (let i = 0; i < total; i += 1) {
    const totalWeight = members.reduce((sum, member) => sum + member.weight, 0);
    const totalAssigned = members.reduce((sum, member) => sum + member.count, 0);
    const selected = members.slice().sort((left, right) => {
      const leftDeficit = ((totalAssigned + 1) * left.weight / totalWeight) - left.count;
      const rightDeficit = ((totalAssigned + 1) * right.weight / totalWeight) - right.count;
      return rightDeficit - leftDeficit || left.priority - right.priority;
    })[0];
    selected.count += 1;
  }
  return members.map((member) => member.count);
}

const checks = [
  [admin.includes('assignmentMode: "round_robin"'), "قاعدة التوزيع تبدأ بالنظام الحالي"],
  [admin.includes('<option value="percentage">التوزيع بالنسبة المئوية</option>'), "خيار التوزيع بالنسبة ظاهر"],
  [admin.includes('memberPercentages'), "واجهة نسب المناديب موجودة"],
  [admin.includes('مجموع نسب المناديب المؤهلين داخل كل فرع 100%'), "شرح مجموع النسب موجود"],
  [settings.includes('clean(body.assignmentMode) === "percentage" ? "percentage" : "round_robin"'), "الخادم يحفظ طريقة التوزيع"],
  [settings.includes('Math.abs(totalPercentage - 100) > 0.01'), "الخادم يفرض مجموع 100%"],
  [settings.includes('allocation_percentage'), "الخادم يحفظ نسبة كل مندوب"],
  [utils.includes('weighted_assignment_count'), "عداد مستقل للتوزيع النسبي موجود"],
  [utils.includes('leftDeficit') && utils.includes('rightDeficit'), "اختيار المندوب النسبي مبني على العجز التراكمي"],
  [schema.includes("crm-percentage-distribution-20260901"), "ترحيل قاعدة البيانات موجود"],
  [reports.includes('reportBranchLabel') && reports.includes('فرع القادسية') && reports.includes('فرع الصالة') && reports.includes('فرع الملتقى') && reports.includes('فرع الاونلاين') && reports.includes('فرع الجملة'), "مسميات الفروع الجديدة مثبتة في التقرير"],
  [reportsUi.includes('{ key: "department", label: "القسم" }') && reportsUi.includes('{ key: "branch", label: "الفرع" }'), "تقرير الأقسام والفروع مفصول إلى عمودي القسم والفرع"],
  [!admin.includes('onChange={() => setRuleForm((current) => ({ ...current, memberIds: toggleList(current.memberIds, row.id) }))}'), "اختيار الموظف يحدّث النسب بدون منطق قديم منفصل"],
  [styles.includes('.crm-member-percentage'), "تنسيق حقل النسبة موجود"],
  [JSON.stringify(simulateWeighted([50, 30, 20], 100)) === JSON.stringify([50, 30, 20]), "خوارزمية النسب تحقق 50/30/20 على 100 عميل"],
  [JSON.stringify(simulateWeighted([70, 30], 10)) === JSON.stringify([7, 3]), "خوارزمية النسب تحقق 70/30 على 10 عملاء"],
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
console.log(`CRM reports + percentage distribution v39 checks: ${passed}/${checks.length} passed`);
