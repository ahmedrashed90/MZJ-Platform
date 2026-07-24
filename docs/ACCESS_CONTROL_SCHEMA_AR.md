# مخطط قاعدة بيانات الصلاحيات المركزية

## الجداول المطورة أو المستخدمة

- `core.users`: حالة المستخدم، إصدار الصلاحيات، بيانات التعطيل.
- `core.roles`: قوالب الأدوار المركزية.
- `core.permissions`: كتالوج الصلاحيات مع النظام والصفحة والإجراء والتصنيف والحساسية والترتيب.
- `core.role_permissions`: صلاحيات قالب الدور.
- `core.user_roles`: الأدوار العامة للمستخدم.
- `core.branches` و`core.departments`: الهيكل التنظيمي المركزي.
- `core.user_branches` و`core.user_departments`: توافق مع الاستعلامات الحالية.
- `core.systems`: الأنظمة المسجلة.
- `core.system_pages`: صفحات كل نظام.
- `core.user_systems`: تفعيل النظام والدور والنطاق الخاص به للمستخدم.
- `core.user_system_branches`: الفروع المسموحة داخل نظام محدد.
- `core.user_system_departments`: الأقسام المسموحة داخل نظام محدد.
- `core.user_permission_overrides`: السماح أو المنع الفردي.
- `core.permission_change_log`: سجل تغييرات المستخدمين والأدوار والصلاحيات.
- `core.sessions`: نسخة صلاحيات الجلسة.
- `audit.activity_log`: سجل النشاط الأمني والتشغيلي.

## العلاقات الأساسية

```text
core.users
 ├─< core.user_roles >─ core.roles ─< core.role_permissions >─ core.permissions
 ├─< core.user_systems >─ core.systems
 │    ├─< core.user_system_branches >─ core.branches
 │    └─< core.user_system_departments >─ core.departments
 ├─< core.user_permission_overrides >─ core.permissions
 ├─< core.permission_change_log
 └─< core.sessions

core.systems ─< core.system_pages
```

## نطاق البيانات

`core.user_systems.data_scope` يقبل 12 قيمة فقط: `self`، `assigned`، `created_by_me`، `branch`، `branches`، `department`، `departments`، `branch_and_department`، `source_branch`، `destination_branch`، `workflow_assigned`، `all`.

## الحفاظ على البيانات

الـMigration تستخدم `ALTER ... IF NOT EXISTS` و`CREATE ... IF NOT EXISTS` و`ON CONFLICT`، وتُرحّل الارتباطات الحالية دون تغيير User IDs أو كلمات المرور أو السجلات التشغيلية.
