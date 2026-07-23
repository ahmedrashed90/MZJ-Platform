# نشر إعادة بناء نظام التسويق

## الترتيب الإلزامي

1. خذ Backup كامل من PostgreSQL.
2. اختبر على Preview/Staging أولًا.
3. إذا كانت محاولة SQL سابقة ظاهرة بحالة Error، اضغط `ROLLBACK` أولًا ولا تكمل داخل Transaction فاشلة.
4. شغّل ملف SQL التالي مرة واحدة من SQL Editor قبل Deploy السورس:

```text
database/migrations/20260723_marketing_full_native_rebuild.sql
```

5. تأكد أن الـMigration انتهت بـSuccess وظهرت نتيجة `COMMIT`.
6. أضف Environment Variables المطلوبة.
7. نفّذ Deploy للسورس الكامل.
8. نفّذ Smoke Test للحملات والمهام ورفع الملفات وطلبات التصوير قبل فتح النظام للمستخدمين.

## Environment Variables

```text
DATABASE_URL
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
MARKETING_TOKEN_ENCRYPTION_KEY
MARKETING_PUBLISHER_SECRET
META_APP_ID
META_APP_SECRET
META_GRAPH_VERSION
META_REDIRECT_URI
META_SCOPES
YOUTUBE_CLIENT_ID
YOUTUBE_CLIENT_SECRET
YOUTUBE_REDIRECT_URI
YOUTUBE_SCOPES
MERSAL_API_ENDPOINT
MERSAL_TOKEN
```

## ملاحظات المنصات

- TikTok يظل `sandbox_under_review` ولا يُعرض كنشر ناجح حتى الموافقة الفعلية.
- Snapchat يظل `waiting_allowlist` حتى موافقة Public Profile API Allowlist.
- WhatsApp Video لا يُعتبر مدعومًا إلا بعد اختبار Template/Endpoint الحقيقي.

## ملفات R2 وCORS

يجب السماح لدومين المنصة بعمليات `PUT` و`GET` على R2 حتى تعمل Presigned Uploads. لا تحفظ أي Secret في الواجهة.

## طبيعة الـMigration

- هذه Migration إعادة بناء Canonical لمخطط `marketing` فقط؛ تم اعتمادها لإزالة الجداول المتعارضة الناتجة عن محاولات الدمج القديمة، ومنها شكل `marketing.publish_jobs` الخاص بالنشر المحلي الملغي.
- قبل إعادة البناء يوجد Guard يوقف التنفيذ إذا وجد بيانات أعمال فعلية داخل الحملات أو المهام أو طلبات التصوير، حتى لا تُحذف بيانات حقيقية بصمت.
- لا تعدّل أو تحذف مخططات CRM أو Tracking أو Operations. التغيير الوحيد خارج `marketing` هو أعمدة طلبات التصوير والـForeign Key الموثق داخل `operations.transfer_requests`.

## Rollback

- عند ظهور Error داخل SQL Editor اضغط `ROLLBACK` قبل أي محاولة جديدة.
- Rollback السورس يتم بإعادة Deploy لآخر Source معتمد قبل التسويق.
- لا تحذف جداول أو أعمدة يدويًا من الإنتاج.
