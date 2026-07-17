# Release Checklist — MZJ Platform v1.12.0

- [ ] ضبط `DATABASE_URL` وR2 في Vercel.
- [ ] ضبط `MZJ_GATEWAY_SECRET` في Vercel.
- [ ] ضبط أسرار `GATEWAY_SECRET` و`MERSAL_TOKEN` و`MERSAL_API_TOKEN` في Cloudflare.
- [ ] ضبط `MERSAL_TEMPLATES_URL` الصحيح في Cloudflare.
- [ ] نشر `gateway-worker` ثم تسجيل المسارات الثلاثة في إعدادات CRM.
- [ ] تجربة نص حر والتأكد أن `template_name` فارغ.
- [ ] تجربة قالب معتمد والتأكد من اسم القالب واللغة والـComponents.
- [ ] تجربة صورة وصوت وفيديو وPDF في الاتجاهين.
- [ ] إعادة إرسال نفس Webhook والتأكد أنه لا يزيد الرسائل أو الـUnread.
- [ ] تشغيل `pnpm run typecheck` ثم `pnpm run build` قبل النشر.
