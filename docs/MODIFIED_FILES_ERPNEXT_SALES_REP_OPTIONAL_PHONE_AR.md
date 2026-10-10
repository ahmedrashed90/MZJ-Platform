# الملفات المعدلة — NEXT ERP مندوب البيع والعميل بدون جوال

1. `server/_erpnext-sales-order-normalizer.ts`
   - فصل إيميل مندوب البيع عن منفذ Submit.
   - إضافة هوية عميل ERP واسم/إيميل إداري العمليات.
   - جعل رقم الجوال اختياريًا.

2. `server/_erpnext-sales-order-sync.ts`
   - إنشاء وتحديث عميل CRM بدون جوال.
   - منع التكرار بواسطة هوية عميل ERP.
   - حفظ بيانات إداري العمليات ضمن بيانات الحركة.

3. `server/operations/index.ts`
   - حل اسم إداري العمليات من الحقول الصريحة في Webhook مع دعم السجلات القديمة.

4. `integration-assets/MZJ-ERPNext-Sales-Order-Webhook-JSON.txt`
   - استخراج مندوب البيع من Sales Team وربطه بالموظف.
   - إرسال إداري العمليات وهوية العميل منفصلين.

5. `integration-assets/MZJ-ERPNext-Sales-Order-Cancel-Webhook-JSON.txt`
   - نفس بنية فصل المندوب والإداري في الإلغاء.

6. `scripts/check-erpnext-clean-integration-v1197.mjs`
7. `scripts/check-erpnext-sales-rep-optional-phone.mjs`
8. `scripts/check-erpnext-cancel-tracking-sync-v1194.mjs`
9. `scripts/check-operations-movement-sales-count.mjs`
10. `package.json`
11. `DELIVERY_MANIFEST_AR.md`
12. `docs/ERPNEXT-SALES-REP-OPTIONAL-PHONE-CLEAN-FLOW-AR.md`
13. `test-results/ERPNEXT-SALES-REP-OPTIONAL-PHONE-TEST-RESULTS.txt`

لا توجد ملفات SQL أو Migration جديدة.
