# MZJ Platform — Device Agent + Attendance Report CLEAN v90

## الأساس
- مبني مباشرة على `MZJ-Platform-ATTENDANCE-NO-LOCATION-CLEAN-v89`.
- لا يوجد GPS أو Public IP أو Geofence في الحضور أو تسجيل الدخول.
- لا توجد ملفات Patch أو Hotfix منفصلة؛ التعديل مدمج في السورس الأساسي.

## MZJ Device Agent — Windows
- ملف التثبيت الجاهز: `public/downloads/MZJ-Device-Agent-Setup.exe`.
- نفس ملف EXE يثبت الـAgent مرة واحدة تحت `%LOCALAPPDATA%\\MZJ\\DeviceAgent` ويسجل بروتوكول `mzjagent://` للمستخدم الحالي في Windows.
- يولد لكل تثبيت زوج مفاتيح ECDSA P-256 فريدًا.
- المفتاح الخاص لا يخرج من الجهاز ويحفظ محميًا بـ Windows DPAPI.
- المنصة تخزن Device ID + Public Key + Hardware Fingerprint Hash + حالة الاعتماد فقط.
- في كل Login لمستخدم مطلوب منه التحقق، السيرفر ينشئ Challenge قصير العمر ومرة واحدة، والـAgent يوقعه ثم يتحقق السيرفر من التوقيع.
- الجهاز الجديد يدخل حالة `pending` ولا يسمح بالدخول حتى يعتمد مدير النظام الجهاز.
- كل مستخدم مطلوب منه التحقق لديه جهاز معتمد نشط واحد في الوقت نفسه؛ اعتماد جهاز بديل يلغي الجهاز المعتمد السابق ويغلق Sessions القديمة.
- المستخدم `مستثنى` يدخل بالطريقة العادية ولا يحتاج Device Agent. هذا هو الإعداد المناسب حاليًا لمستخدمي Android وiPhone.
- التحقق مرتبط بالجهاز/هوية Windows وليس بمتصفح واحد؛ Chrome وEdge وFirefox على نفس Windows User يستخدمون نفس الـAgent.

## إعدادات الحضور والانصراف
داخل `تحديد مواعيد العمل لليوزرات` تمت إضافة:
- `التحقق من الجهاز`: مطلوب / مستثنى.
- `أجهزة العمل`: عرض الأجهزة المسجلة للمستخدم.
- اعتماد جهاز Pending.
- إلغاء اعتماد جهاز Approved.
- عرض Device ID واسم الجهاز وآخر تحقق.

## Login Flow
1. المستخدم يدخل بيانات الدخول.
2. إذا كان مستثنى: يكمل الدخول والحضور بدون Device Agent.
3. إذا كان مطلوبًا: السيرفر ينشئ Challenge.
4. المتصفح يفتح `mzjagent://verify`.
5. الـAgent يوقع Challenge بمفتاح الجهاز الخاص.
6. الجهاز الجديد يسجل Pending ويحتاج اعتماد المدير.
7. الجهاز المعتمد يكمل Login ويخزن `verified_device_id` داخل Session.

## قاعدة البيانات
Migration الجديدة:
`database/migrations/20260919_device_agent_v1.sql`

تنشئ:
- `core.user_device_policies`
- `core.user_devices`
- `core.device_login_challenges`
- `core.sessions.verified_device_id`

إذا كان مستخدم PostgreSQL في Production لا يملك صلاحيات DDL (`CREATE/ALTER/INDEX`)، يجب تشغيل ملف الـMigration مرة واحدة بحساب مالك/مستخدم قاعدة بيانات يملك الصلاحيات قبل تفعيل `مطلوب` لأي مستخدم. المستخدمون الحاليون يظلون مستثنين افتراضيًا إذا لم تكن جداول Device Agent موجودة.

## تقرير الحضور والانصراف
- أُلغي التحديث التلقائي الدوري بالكامل؛ التقرير لا يعمل Refresh كل 10 ثوانٍ.
- التحديث يتم عند فتح الصفحة أول مرة أو الضغط على `عرض`.
- الفترة `من تاريخ / إلى تاريخ` تعرض كل تاريخ داخل Block مستقل.
- عنوان الـBlock هو اليوم + التاريخ فقط، مثل: `السبت 19/09/2026`.
- لا يظهر عدد موظفين أو Notes داخل عنوان اليوم.
- أعمدة التاريخ واليوم لا تتكرر داخل كل صف.
- `النتيجة` تعرض عدد دقائق التأخير.
- التأخير الفعلي أكبر من صفر باللون الأحمر.
- صفر دقيقة/في الموعد باللون الأخضر.
- إجازة/غائب/لم يسجل تظهر كحالة محايدة.
- Excel Export يعمل على التقرير المجمع بحسب الأيام.
- لم تتم إعادة أي بيانات Location للتقرير أو الحضور.

## Windows Agent Build
Source:
`device-agent/windows/main.go`

Build target:
- Windows x86-64 GUI executable.
- Agent version `1.0.0`.

SHA-256 الخاص بالنسخة المرفقة موجود في:
`public/downloads/MZJ-Device-Agent-Setup.exe.sha256`

## التحقق المنفذ
- Global Attendance + Device Agent v90: `30/30 PASS`.
- API import extension check: PASS.
- Merge-conflict check: PASS.
- Marketing Packages + MZJ Club baseline: `16/16 PASS`.
- TypeScript/TSX syntax transpile: `270/270 PASS`.
- CSS braces: balanced.
- Go vet للـWindows Agent: PASS.
- Windows Agent build: PASS (`PE32+ x86-64 GUI`).

لم يتم تشغيل Production `vite build / tsc -b` الكامل لأن Dependencies المشروع غير موجودة محليًا ومحاولة تنزيلها غير متاحة في بيئة التنفيذ الحالية. فحوصات السورس والترجمة الجزئية المذكورة أعلاه نجحت.

## ملاحظة نشر الـAgent
ملف EXE الحالي مبني وجاهز وظيفيًا لكنه غير موقع بشهادة Code Signing. قبل التوزيع الواسع على أجهزة الشركة يفضل توقيعه بشهادة Windows Code Signing لتقليل تحذيرات SmartScreen والتحقق من الناشر.
