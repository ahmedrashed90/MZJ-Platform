# MZJ Platform — MZJ Club Portal UX CLEAN v96

تم البناء مباشرة على السورس الكامل v95 وتعديل الملفات الأصلية نفسها بدون Patch أو Hotfix أو Override منفصل.

## التعديلات

1. **اعرف خصمك — اختيار السيارة**
   - الضغط على حقل السيارة بعد وجود اختيار يفتح قائمة السيارات مباشرة بدون الحاجة لمسح اسم السيارة يدويًا.
   - الكتابة تبدأ بحثًا جديدًا، والاختيار الحالي يظل هو المعتمد للحساب حتى يتم اختيار سيارة أخرى.
   - زر × لمسح الاختيار بضغطة واحدة.
   - زر سهم لفتح/إغلاق قائمة السيارات.
   - اختيار السيارة الجديدة يعيد حساب الخصم الشخصي وخصم إهداء لصديق بنفس منطق الحساب الحالي بدون تغييره.

2. **بلوك العضوية والترحيب**
   - تصغير عنوان «أهلًا <اسم العميل>» بدرجة مناسبة على Desktop وMobile.
   - تصغير عبارة «كل رحلة أجمل مع مجتمعنا، ونقاطك ومزاياك في مكان واحد.».
   - لا تغيير في بيانات العضوية أو الكارت أو النقاط.

3. **التنقل الرئيسي داخل صفحة العضوية**
   - توسيط بلوك «الرئيسية / الباقات» على Desktop في التصميمات الثلاثة.
   - الحفاظ على سلوك Mobile الحالي المناسب للمساحة.

## الملفات الأساسية المعدلة
- `src/owners/OwnersDiscountCalculator.tsx`
- `src/styles.css`

## التحقق
- `check-mzj-club-portal-ux-v96.mjs`: 11/11 PASS
- `check-mzj-club-design-render-v95.mjs`: 11/11 PASS
- `check-mzj-club-design-switch-v92.mjs`: PASS
- `check-mzj-club-portal-design-migration-v93.mjs`: 6/6 PASS
- `check-owners-community-v1200.mjs`: 83/83 PASS
- `check-owners-production-points-reset-v37.mjs`: 12/12 PASS
- `check-global-attendance-v91.mjs`: 34/34 PASS
- `check-no-merge-conflicts.mjs`: PASS

لا يوجد تغيير في Schema أو Business Logic أو النقاط أو الدعوات أو المكافآت أو الحضور أو CRM أو التسويق.
