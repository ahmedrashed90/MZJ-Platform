# MZJ Platform v1.21.15 - Owners Reward Source Mapping

هذه نسخة مصدر كاملة مبنية من `MZJ-Platform-v1.21.14-OWNERS-SMS-LOAD-FIX(4).zip` وليست Patch.

التعديل الإنتاجي الوحيد على السورس القائم هو:

- `server/owners-public.ts`

الربط النهائي:

- `legacy` / تبويب **العملاء الجديدة** -> `available_for_referral_purchase=true` (مكافآت العميل الجديد).
- `member` / تبويب **عملاء تم البيع** -> `available_for_existing_customer_purchase=true` (مكافآت العميل القديم).

نفس الربط يطبق في جلب المكافآت والتأكيد الفردي والتأكيد المجمع وإعادة فحص المكافأة داخل transaction بعد القفل.

لم يتغير تصنيف `customerKind` أو التحقق من الجوال أو self-use أو إنشاء referral أو idempotency أو المخزون أو Next ERP linking أو أي نظام آخر.

ملفات التحقق المضافة:

- `scripts/check-owners-reward-source-mapping-v12115.mjs`
- `test-results/OWNERS-REWARD-SOURCE-MAPPING-V12115.txt`
- `test-results/OWNERS-PUBLIC-TS-SYNTAX.txt`
- `test-results/OWNERS-REWARD-SOURCE-MAPPING-DIFF-SCOPE.txt`
