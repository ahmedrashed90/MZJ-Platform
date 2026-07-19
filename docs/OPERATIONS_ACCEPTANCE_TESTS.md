# اختبارات قبول نظام العمليات

## اختبارات تم تشغيلها ونجحت

ملف النتائج: `delivery/static-checks-final.log`

- سلامة Imports ومسارات API.
- اختبارات عدم كسر CRM والتوزيع والإعدادات ومرسال.
- اختبارات وحدة Tracking الحالية.
- فحص بنية وحدة العمليات، Routes، الصلاحيات، State Machine، مصدر الداش بورد، الربط مع Tracking، والـMigration.
- فحص التصحيحات النهائية الإلزامية.
- اختبار معادلة النواقص: المستودع فقط +3، الفروع، استبعاد الوكالة والحالات والإكسسوارات، Deduplication، وتركيبات الألوان.
- فحص Syntax وIsolated Transpilation لجميع ملفات TypeScript وTSX: 109 ملفات.

## اختبارات لم يمكن تشغيلها في البيئة الحالية

### Full TypeScript Check

تم تشغيل `tsc -b` وفشل لأن مجلد `node_modules` غير موجود، وبالتالي لم تتوفر تعريفات React وReact Router وNode وبقية الحزم. ملخص التشخيص موجود في:

- `delivery/typescript-check-status.txt`
- `delivery/typescript-check-summary.txt`
- `delivery/typescript-check-final.log`

بعد استبعاد أخطاء الحزم وJSX المفقودة لم يظهر Diagnostic خاص بكود العمليات في الملخص، لكن هذا لا يُعد بديلًا عن تشغيل `tsc -b` بعد تثبيت الحزم.

### Production Build

تم تشغيل أمر البناء عبر Corepack، لكنه لم يستطع تنزيل pnpm بسبب عدم توفر DNS/الإنترنت إلى `registry.npmjs.org` (`EAI_AGAIN`). التفاصيل في:

- `delivery/production-build-status.txt`
- `delivery/production-build-summary.txt`
- `delivery/production-build.log`

### اختبارات PostgreSQL والواجهة الحية

لم تتوفر قاعدة PostgreSQL أو Docker أو Deployment حي في البيئة، لذلك لم يتم تنفيذ:

- تطبيق الـMigration على قاعدة حقيقية.
- اختبارات Transactions وLocks المتزامنة ضد PostgreSQL.
- اختبار UI يدوي في المتصفح لكل دور وفرع.
- اختبار التكامل الحي مع بيانات Tracking الإنتاجية.

## المطلوب قبل النشر

1. `corepack enable && pnpm install --frozen-lockfile`
2. `pnpm run typecheck`
3. تطبيق Migration على Staging.
4. `pnpm run build`
5. تشغيل سيناريوهات القبول الحية الموجودة في البرومت، خصوصًا الحركة الجماعية، مراحل الطلب، الموافقات، Tracking، والأرشيف.
6. مقارنة أرقام الداش بورد والتبويبات على نفس المستخدم وفي نفس اللحظة.
