# MZJ Platform Global Attendance - CLEAN V75

## المصدر
- مبني مباشرة على `MZJ-Platform-GLOBAL-ATTENDANCE-CLEAN-v74` كنسخة كاملة جديدة، بدون ملفات Patch أو منطق جانبي.

## يوم العطلة الأسبوعية
- إضافة `يوم العطلة` داخل نفس شاشة تحديد مواعيد العمل لليوزرات.
- يوم العطلة يحدد لكل User داخل تعيين جدول العمل نفسه، مع إمكانية اختيار يوم مختلف لمجموعات مختلفة من اليوزرات.
- القيمة اختيارية؛ `بدون عطلة أسبوعية` يبقي الجدول يعمل كل أيام الأسبوع.
- يوم العطلة لا ينشئ فترة حضور لذلك اليوم ولا يطلب تسجيل حضور.
- الفترات الليلية التي بدأت في يوم عمل قبل منتصف الليل تظل مرتبطة بـ `work_date` الصحيح وتكمل حتى نهايتها حتى لو دخلت الساعة 1 صباحًا في يوم العطلة التالي.
- تقرير الحضور يعرض `عطلة` في نتيجة الفترات بدل `غائب` أو `لم يسجل` في يوم العطلة.
- إعدادات يوم العطلة محفوظة تاريخيًا داخل `core.attendance_user_schedules` مع نفس effective dates المستخدمة لجدول العمل والمكان المطلوب.

## إصلاح خطأ النشر الظاهر في Vercel
- إصلاح خطأ TypeScript `TS2345` في `AttendancePage.tsx` عند تمرير `self?.currentRecord` إلى `statusLabel`.
- الدالة تقبل الآن `undefined` الناتج طبيعيًا من optional chaining، بدون cast أو تعطيل TypeScript.

## قاعدة البيانات
- إضافة العمود `weekly_off_day smallint` إلى `core.attendance_user_schedules` بقيم PostgreSQL DOW: الأحد 0 ... السبت 6.
- الترقية Idempotent: النسخ التي تحتوي جداول V74 تضيف العمود والـconstraint تلقائيًا من `ensureAttendanceSchema`.
- لا يلزم حذف أو إعادة إنشاء بيانات الحضور القديمة.

## التحقق
- `scripts/check-global-attendance-v75.mjs`: 26/26 PASS.
- `scripts/check-no-merge-conflicts.mjs`: PASS.
- فحص Syntax/Transpile لجميع ملفات TS/TSX غير declaration: 273/273 PASS.
- فحص TypeScript مركز لملفي `AttendancePage.tsx` و`AttendanceSettingsPanel.tsx` باستخدام stubs للDependencies: PASS.
- فحص TypeScript مصغر لنفس حالة `currentRecord | undefined` التي سببت فشل Vercel: PASS.
- Build كامل غير منفذ داخل بيئة التجهيز لأن Dependencies غير موجودة وتعذر تنزيلها من npm خلال المهلة.
