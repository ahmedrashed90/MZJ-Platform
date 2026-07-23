# Marketing Integration Regression Report

## Baseline

تمت المقارنة مع `MZJ-Platform-main (7)(1).zip` بعد فك نسخة أصلية مستقلة.

## الملفات القائمة التي تغيرت فقط

- `.env.example`: متغيرات التسويق الجديدة فقط.
- `api/index.ts`: إضافة Marketing handler إلى Dispatcher.
- `database/schema.sql`: إضافة SQL التسويق Additive.
- `package.json`: إضافة `check:marketing` إلى الفحوصات.
- `server/_schema.ts`: إضافة DDL/Seeds التسويق إلى إعداد قاعدة البيانات الجديدة.
- `src/App.tsx`: استبدال Placeholder التسويق بالـRoutes وإضافة صفحات MZJ Publish العامة.
- `src/components/Sidebar.tsx`: شرط ظهور التسويق فقط.
- `src/pages/SettingsPage.tsx`: استبدال Placeholder إعدادات التسويق باللوحة الجديدة.

## المناطق المحمية

لم يتغير أي ملف داخل:

- `src/crm/**` أو `server/crm/**`
- `src/operations/**` أو `server/operations/**`
- `src/tracking/**` أو `server/tracking/**`
- Workers القائمة
- `server/_dashboard-data.ts`
- `src/styles.css`

## نتائج الفحوصات

كل Static Checks الحالية للـCRM والعمليات والتراكينج والـWorkers نجحت بعد الدمج. راجع `MARKETING-INTEGRATION-STATIC-CHECKS.log`.

## قيد التحقق

تعذر تشغيل Build كامل بسبب عدم توفر اتصال npm في بيئة التنفيذ. لذلك يلزم تشغيل `pnpm install --frozen-lockfile && pnpm run build` في بيئة CI أو جهاز متصل قبل النشر.
