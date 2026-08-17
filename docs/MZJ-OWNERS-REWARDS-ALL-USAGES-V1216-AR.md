# MZJ Owners Community v1.21.6 — كل مكافآت العميل الجديد وسجل الاستخدامات

هذا الإصدار مبني مباشرة على `MZJ-Platform-v1.21.5-CASH-QR-SOURCE-FULL-CRM-SOLD-TIME-FIX` ويقتصر التغيير على MZJ Owners Community والمكافآت وCommerce API.

## Commerce API

- `commerce_rewards` يعيد كل المكافآت المفعلة والمعلّمة **مكافأة عميل جديد** في `newCustomerRewards`.
- يعيد كذلك `newCustomerRewardIds` و`existingCustomerRewards` مع الحفاظ على `rewards` و`primaryNewRewardId` للتوافق مع الربط السابق.
- `commerce_confirm_bundle` يقبل المكافأة التي اختارها العميل من أي عنصر صالح في `newCustomerRewards` بدل إجبار أول مكافأة فقط.
- قواعد التفعيل، التواريخ، الكمية، والتحقق Server-side لم تتغير.

## استخدامات المكافأة

داخل كتالوج المكافآت يظهر **استخدامات المكافأة**، ويمكن فتح **عرض من استخدم المكافأة** لمعرفة:

- اسم العميل ورقم الجوال.
- هل الاستخدام من طلب شراء بالموقع أو استبدال نقاط.
- نوع العميل: جديد / قديم / عضو.
- كود الدعوة وصاحب الكود عند وجودهما.
- رقم طلب الموقع.
- رقم Sales Order في Next ERP.
- تاريخ الاستخدام.

السجل يعتمد على `owners.referral_purchase_benefits` و`owners.redemptions` الموجودين أصلًا؛ لا توجد Migration جديدة أو جدول موازي.
