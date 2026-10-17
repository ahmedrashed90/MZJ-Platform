# MZJ Owners Community — Prestige Rewards Commerce API v1.21.1

هذا الإصدار مبني على v1.21.0 الكامل، والتعديل محصور في Owners Community Commerce API المستخدم بواسطة طلب شراء السيارة.

## القواعد

- عميل MZJ السابق الحقيقي يستطيع استخدام **كود الدعوة الخاص به** مرة واحدة فقط للحصول على مكافأة عميل قديم.
- الاستخدام الشخصي لا ينشئ Referral أو CRM Lead جديدًا.
- بعد أول استخدام شخصي ناجح، يرفض API أي محاولة لاحقة بنفس الكود ونفس صاحب العضوية.
- العميل الجديد يحصل على **مكافأة عميل جديد أساسية** تلقائيًا.
- العميل الجديد يستطيع اختيار **مكافأة عميل قديم إضافية واحدة** إن وجدت.
- فلو الإحالة للعميل الجديد يظل نفس الفلو المعتمد: `registered -> qualified -> sold`.
- المخزون وعدادات استخدام المكافآت يتم تحديثها لكل مكافأة فعلية.

## API

### `commerce_rewards`
يعيد:
- `customerKind`: `new` أو `existing`
- `selfUse`
- `primaryNewRewardId` للعميل الجديد
- قائمة المكافآت المتاحة

### `commerce_confirm_bundle`
- عميل جديد: `primaryRewardId` أساسي + `bonusRewardId` اختياري.
- عميل قديم: `primaryRewardId` واحد فقط.
- يتم إنشاء Benefit مستقل لكل مكافأة باستخدام مفاتيح idempotency داخل نفس طلب الموقع:
  - `<websiteOrderId>:primary`
  - `<websiteOrderId>:bonus`

### `commerce_link_order`
يربط كل Benefits الخاصة بطلب الموقع برقم Sales Order النهائي في Next ERP.

## النطاق
لم يتم تعديل CRM أو Tracking أو Operations أو Marketing أو Next ERP أو أي نظام آخر.
