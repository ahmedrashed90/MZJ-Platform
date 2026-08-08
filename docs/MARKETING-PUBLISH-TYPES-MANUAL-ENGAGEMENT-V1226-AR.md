# تقرير تنفيذ أنواع النشر والنشر اليدوي والتفاعل — V1.22.6

## نطاق التنفيذ

تم تنفيذ التعديل داخل سيستم التسويق فقط، ويشمل:

1. حفظ نوع النشر المختار لكل منصة داخل عنصر جدول النشر نفسه.
2. تنفيذ مسار النشر المطابق للنوع المختار بدل الاستدلال من الملف:
   - Facebook: منشور صور، فيديو، Reel، Story.
   - Instagram: بوست صور، Carousel، Reel، Story.
   - YouTube: فيديو وShorts مع الاحتفاظ بنوع النشر داخل نتيجة النشر.
3. تسجيل المنشورات الناجحة في مصدر بيانات «تفاعل النشر» لكل المنصات المدعومة، وإضافة قراءة إحصاءات YouTube.
4. إظهار YouTube داخل تفاعل النشر ونتائج الحملات ونتائج الأجندات.
5. إضافة تبويب داخلي «النشر اليدوي» في «تجهيز النشر» لاختيار الحملة أو الأجندة، والكرييتيف، والمنصات وأنواع النشر، والموعد، والكابشن، والهاشتاج.

## ضوابط التنفيذ

- النشر اليدوي يعيد استخدام نفس جدول النشر ونفس الصلاحيات ونفس مسار التنفيذ الحالي، ولا ينشئ نظام نشر موازٍ.
- نوع النشر يتم التحقق من تبعيته للمنصة في الخادم قبل الحفظ.
- لا يتم تحويل فيديو Instagram المحدد كـ«بوست» إلى Reel تلقائيًا؛ تظهر رسالة تطلب اختيار Reel.
- Story يقبل ملفًا واحدًا، وReel/Video/Shorts يقبل ملف فيديو واحدًا، وCarousel يتطلب صورتين على الأقل.
- لا توجد تعديلات على CRM أو العمليات أو التراكنج أو تصميم الصفحات الأخرى.

## ملاحظة YouTube Shorts

YouTube Data API يرفع الفيديو وبياناته ولا يوفر حقلًا مستقلًا يجبر المنصة على تصنيفه Shorts. النظام يحتفظ باختيار Shorts ويضيف علامة `#Shorts` للوصف؛ ويجب أن يكون الملف نفسه مربعًا أو رأسيًا وضمن مدة Shorts حتى يصنفه YouTube كـShort.

## الملفات المعدلة

- `server/marketing/index.ts`
- `server/_marketing-engagement.ts`
- `shared/marketing-publishing.ts` (جديد)
- `src/marketing/pages/PublishPrepPage.tsx`
- `src/marketing/pages/EngagementPage.tsx`
- `src/marketing/components/EngagementResultDetail.tsx`
- `src/marketing/marketing.css`
- `scripts/check-marketing-publish-types-manual-engagement-v1226.mjs` (جديد)
- `docs/MARKETING-PUBLISH-TYPES-MANUAL-ENGAGEMENT-V1226-AR.md` (جديد)
