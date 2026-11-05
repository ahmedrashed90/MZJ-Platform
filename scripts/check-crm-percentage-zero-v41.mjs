import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const admin = read("src/crm/pages/CrmAdminPage.tsx");
const settings = read("server/crm/settings.ts");
const utils = read("server/_crm-utils.ts");

function simulateWeighted(weights, total) {
  const members = weights.map((weight, index) => ({ weight, count: 0, priority: index }));
  for (let i = 0; i < total; i += 1) {
    const positive = members.filter((member) => member.weight > 0);
    const totalWeight = positive.reduce((sum, member) => sum + member.weight, 0);
    const totalAssigned = positive.reduce((sum, member) => sum + member.count, 0);
    const selected = positive.slice().sort((left, right) => {
      const leftDeficit = ((totalAssigned + 1) * left.weight / totalWeight) - left.count;
      const rightDeficit = ((totalAssigned + 1) * right.weight / totalWeight) - right.count;
      return rightDeficit - leftDeficit || left.priority - right.priority;
    })[0];
    selected.count += 1;
  }
  return members.map((member) => member.count);
}

const checks = [
  [admin.includes('min="0" max="100" step="0.01"'), "واجهة النسبة تسمح بالقيمة 0"],
  [admin.includes("نسبة 0% تبقي المندوب داخل القاعدة بدون استقبال عملاء"), "شرح 0% ظاهر في إعدادات القاعدة"],
  [settings.includes("value < 0 || value > 100"), "الخادم يقبل النسب من 0 إلى 100"],
  [settings.includes("اكتب نسبة صحيحة من 0 إلى 100 للمندوب"), "رسالة التحقق محدثة لنطاق 0-100"],
  [settings.includes("Math.abs(totalPercentage - 100) > 0.01"), "إجمالي نسب الفرع ما زال مطلوبًا 100%"],
  [utils.includes("const percentageMode = candidates.every"), "اختيار النسب يعتمد على وضع القاعدة لا على كون كل مندوب أكبر من صفر"],
  [utils.includes("candidates.filter((candidate) => Number(candidate.allocation_percentage || 0) > 0)"), "مندوب 0% مستبعد من مرشحي التوزيع"],
  [utils.includes("if (!percentageCandidates.length) return null;"), "لا يوجد fallback للدور الحالي داخل قاعدة نسب بلا أوزان موجبة"],
  [JSON.stringify(simulateWeighted([50, 30, 20, 0], 100)) === JSON.stringify([50, 30, 20, 0]), "محاكاة 50/30/20/0 لا توزع أي عميل على 0%"],
  [JSON.stringify(simulateWeighted([100, 0, 0], 25)) === JSON.stringify([25, 0, 0]), "محاكاة 100/0/0 توزع كل العملاء على مندوب 100%"],
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
console.log(`CRM percentage zero v41 checks: ${passed}/${checks.length} passed`);
