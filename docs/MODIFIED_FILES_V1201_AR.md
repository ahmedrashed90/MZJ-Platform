# الملفات المعدلة — v1.20.1

- `server/_api-permissions.ts`
  - توجيه رفع Task Template إلى الفحص السياقي بدل صلاحية الملفات العامة.
- `server/marketing/index.ts`
  - فحص صلاحية الرفع وإعادة الرفع حسب التاسك والملف.
  - التحقق من فئة الملف وارتباطه بالتكليف وهوية رافعه.
- `src/marketing/api.ts`
  - تمرير سياق الفئة والمصدر والتاسك عند تثبيت حالة الملف.
- `src/marketing/components/TaskDetailModal.tsx`
  - واجهة Full Screen، تنظيم التفاصيل، تكبير السكريبت، وتحويل إجراءات التكليف إلى أزرار.
- `src/marketing/marketing.css`
  - تنسيق مساحة العمل الجديدة والاستجابة لأحجام الشاشات.
- `src/marketing/templateExcel.ts`
  - إنشاء وقراءة XLSX حقيقي بالتنسيق المرجعي.
- `scripts/check-marketing-task-template-v1201.mjs`
  - فحص رجوع مخصص.
- `package.json`
  - إضافة فحص v1.20.1 إلى سلسلة `typecheck` مع الحفاظ على رقم الحزمة الداخلي المعتمد.
- `README.md`, `DELIVERY_MANIFEST_AR.md`, `docs/TEST_RESULTS_AR.md`
  - توثيق التنفيذ والقيود والاختبارات.

لا توجد ملفات Migration أو Seed جديدة.