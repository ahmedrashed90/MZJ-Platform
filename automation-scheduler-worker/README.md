# MZJ Automation Scheduler Worker

Worker مستقل لتوقيت المهام المؤجلة باستخدام Cloudflare Queue. لا يحتوي على تصنيف أو توزيع أو منطق CRM.

1. أنشئ Queue باسم `mzj-automation-jobs`.
2. انشر Worker من هذا المجلد.
3. أضف Secret باسم `AUTOMATION_SCHEDULER_SECRET`.
4. اضبط `PLATFORM_AUTOMATION_CALLBACK_URL` على `/api/internal/automation-job` في المنصة.
5. ضع رابط Worker في Vercel داخل `AUTOMATION_SCHEDULER_URL`، وضع نفس السر في `AUTOMATION_SCHEDULER_SECRET`.
