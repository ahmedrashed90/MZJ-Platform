# MZJ Owners Community — Reward Source Mapping v1.21.15

## النطاق

التعديل محصور في `server/owners-public.ts` داخل Commerce Rewards API فقط. لا يوجد Migration أو Patch ولا تغيير في CRM أو Tracking أو Operations أو Marketing أو Next ERP.

## الربط النهائي

- `referrerKind=legacy` — الأكواد الظاهرة في **العملاء الجديدة** — تقبل فقط المكافآت التي عليها `available_for_referral_purchase=true`، وهي جمهور **العميل الجديد** في كتالوج المكافآت.
- `referrerKind=member` — الأكواد الظاهرة في **عملاء تم البيع** — تقبل فقط المكافآت التي عليها `available_for_existing_customer_purchase=true`، وهي جمهور **العميل القديم** في كتالوج المكافآت.

## ما بقي كما هو

تصنيف `customerKind`، التحقق من الجوال، منع تعارض الإحالة، self-use، إنشاء/ربط referral، idempotency، المخزون، عداد الاستهلاك، ربط رقم Sales Order في Next ERP، وترتيب حفظ benefits بقيت كما هي.

تم تطبيق نفس قاعدة المصدر في `commerce_rewards` و`commerce_confirm` و`commerce_confirm_bundle` وكذلك إعادة التحقق بعد قفل سجل المكافأة داخل transaction.
