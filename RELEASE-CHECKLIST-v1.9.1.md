# MZJ Platform v1.9.1 - Queue Automation

- لا يوجد أي `crons` داخل `vercel.json`.
- أضف في Vercel: `DATABASE_URL`, `MZJ_SETUP_KEY`, `MZJ_GATEWAY_SECRET`, `AUTOMATION_SCHEDULER_URL`, `AUTOMATION_SCHEDULER_SECRET`.
- انشر Worker: `MZJ-Automation-Scheduler-Worker-v1.0.0-FULL.txt`.
- اربط Queue باسم `AUTOMATION_QUEUE` كـ Producer وConsumer لنفس Worker.
- أضف `PLATFORM_AUTOMATION_CALLBACK_URL=https://YOUR-DOMAIN/api/internal/automation-job`.
- أضف Secret مطابقًا باسم `AUTOMATION_SCHEDULER_SECRET`.
- اختبر `/health` و`/env-check` و`/schedule` قبل تفعيل وكيل صندوق الوارد.
- لا تغيّر Webhook مرسال أثناء اختبار المجدول.
