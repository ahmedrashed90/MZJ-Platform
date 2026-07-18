# مخطط قاعدة بيانات الصلاحيات

```mermaid
erDiagram
  USERS ||--o{ USER_ROLES : has
  ROLES ||--o{ USER_ROLES : assigned
  ROLES ||--o{ ROLE_PERMISSIONS : grants
  PERMISSIONS ||--o{ ROLE_PERMISSIONS : included
  USERS ||--o{ USER_SYSTEMS : enabled_for
  SYSTEMS ||--o{ USER_SYSTEMS : controls
  SYSTEMS ||--o{ SYSTEM_PAGES : contains
  USERS ||--o{ USER_PERMISSION_OVERRIDES : overrides
  PERMISSIONS ||--o{ USER_PERMISSION_OVERRIDES : targeted
  USERS ||--o{ USER_SCOPE_RULES : scoped_by
  SYSTEMS ||--o{ USER_SCOPE_RULES : per_system
  USERS ||--o{ PERMISSION_CHANGE_LOG : target_or_actor

  USERS {
    uuid id PK
    boolean is_active
    bigint permission_version
  }
  SYSTEMS {
    text code PK
    text name_ar
    boolean is_active
  }
  SYSTEM_PAGES {
    uuid id PK
    text system_code FK
    text code
    text route
  }
  PERMISSIONS {
    uuid id PK
    text code UK
    text system_code
    text page_code
    text action_code
    text category
    boolean is_sensitive
  }
  USER_SYSTEMS {
    uuid user_id FK
    text system_code FK
    boolean is_enabled
    uuid role_id FK
    text data_scope
  }
  USER_PERMISSION_OVERRIDES {
    uuid user_id FK
    uuid permission_id FK
    text effect
    text reason
  }
  USER_SCOPE_RULES {
    uuid user_id FK
    text system_code FK
    text scope_code
    uuid_array branch_ids
    uuid_array department_ids
  }
```

الجداول القديمة `core.user_roles`, `core.user_branches`, و`core.user_departments` محفوظة وتستمر في دعم الهوية والتنظيم، بينما القواعد الجديدة تضيف التفعيل والنطاق والاستثناءات لكل نظام.
