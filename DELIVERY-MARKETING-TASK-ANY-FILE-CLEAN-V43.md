# MZJ Platform — Marketing Task Any File CLEAN v43

- Full clean build based on v42 source.
- Marketing task **الملف الأول** accepts any file type/extension, up to the existing 30-file limit.
- Marketing task **الملف النهائي** accepts any file type/extension, up to the existing 30-file limit, while preserving the existing Zoho WorkDrive upload flow.
- Manual social publishing remains restricted to image/video media because publishing platforms require media files.
- Generic final-file groups use `media_kind = file`; the database constraint is expanded for existing and fresh deployments.
- No patch/diff files are included.

## Verification
- Focused any-file regression: 13/13 passed.
- Owners baseline: 83/83 passed.
- CRM v39: 16/16 passed.
- CRM v41: 10/10 passed.
- CRM v42: 11/11 passed.
- Marketing creative sequence v38: 12/12 passed.
- Merge conflict check passed.
