# MZJ Marketing Publisher Agent

عميل محلي أولي وآمن لمسح مجلد الأجندة وإرسال **Metadata وخطة النشر فقط** إلى API المنصة عبر HTTPS. لا يتصل بـPostgreSQL أو Firebase، ولا يقرأ توكنات المنصات.

## الاستخدام

```bash
MZJ_AGENDA_FOLDER="D:\\Agenda" npm run scan
MZJ_MARKETING_API_BASE="https://mzj-platform.vercel.app" \
MZJ_MARKETING_DEVICE_TOKEN="paired-device-token" \
MZJ_AGENDA_FOLDER="D:\\Agenda" npm start
```

النسخة الحالية هي Foundation للـAgent. رفع الملفات الكبيرة، Job lease، وتجهيز Electron UI يجب تفعيلها بعد توصيل endpoints الإنتاجية وPresigned Uploads.
