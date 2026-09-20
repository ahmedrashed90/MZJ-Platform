# MZJ Club Community Design Switch CLEAN v95

## سبب الإصلاح
في v94 كان `portal_design` يُحفظ ويصل لصفحة العضوية، لكن الثلاث اختيارات كانت تشترك في نفس تركيب الصفحة تقريبًا، والاختلاف الفعلي كان Theme/CSS محدودًا؛ لذلك تبدو الصفحة كأنها نفس التصميم القديم. كذلك الصفحة المفتوحة بالفعل لم تكن تعيد تحميل إعداد التصميم بعد الحفظ من تبويب آخر.

## التنفيذ في v95
- الإبقاء على `owners.settings.portal_design` كمصدر الحقيقة الوحيد بدون أي Schema جديد.
- تطبيق التصميم المختار مباشرة على جذر صفحة العضوية ومعاينة الإدارة عبر `data-portal-design` وClass التصميم.
- تحويل الصفحة إلى Hero تصميمي حقيقي مع ثلاث تركيبات بصرية واضحة ومختلفة:
  - `design_1`: Cinematic Showroom / Copper.
  - `design_2`: Ivory Gold Member Dashboard / Wide membership banner.
  - `design_3`: Soft Journey / Glass rounded layout.
- الحفاظ على ترتيب البلوكات الرئيسية كاملة العرض:
  1. قائمة النقاط
  2. إرسال الدعوة لصديق
  3. اعرف خصمك
  4. المكافآت المتاحة
  5. سجل الحركة
- صفحة العضوية العامة ومعاينة العضو تعيدان قراءة التصميم عند العودة للتبويب/النافذة.
- بعد حفظ إعدادات MZJ Club Community يتم إرسال Revision event محلي فقط لإجبار الصفحات المفتوحة على إعادة جلب الإعداد من الخادم؛ لا يتم استخدام Local Storage كمصدر للتصميم.
- لا تغيير في منطق النقاط أو الدعوات أو الخصومات أو المكافآت أو الباقات أو الحضور.

## التحقق
- `check-mzj-club-design-render-v95.mjs`: 11/11 PASS.
- `check-mzj-club-design-switch-v92.mjs`: PASS.
- `check-mzj-club-portal-design-migration-v93.mjs`: 6/6 PASS.
- `check-owners-community-v1200.mjs`: 83/83 PASS.
- `check-owners-production-points-reset-v37.mjs`: 12/12 PASS.
- `check-global-attendance-v91.mjs`: 34/34 PASS.
- `check-no-merge-conflicts.mjs`: PASS.
- Modified TSX files pass TypeScript parser/transpile syntax checks.
- Full `tsc -b` could not be completed in the delivery container because project dependencies are not installed and registry access is unavailable; this is an environment limitation, not a source check failure.
