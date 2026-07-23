import type { VercelRequest } from "@vercel/node";
import type { SessionUser } from "../_auth.js";
import { getSql } from "../_db.js";
import { encryptPlatformSecret, secretConfigured } from "./platforms/security.js";
import { normalizeSaudiPhone } from "./platforms/shared.js";
import {
  MarketingError,
  arrayValue,
  boolValue,
  clean,
  hasPermission,
  isAdmin,
  normalizeDepartment,
  numberValue,
  safeJson,
} from "./common.js";

function requireSettings(user: SessionUser) {
  if (!isAdmin(user) && !hasPermission(user, "marketing.settings.manage")) {
    throw new MarketingError(403, "إعدادات التسويق متاحة للإدارة فقط", "FORBIDDEN");
  }
}

export async function marketingMeta(user: SessionUser) {
  const sql = getSql();
  const canManageCampaigns = isAdmin(user) || hasPermission(user, "marketing.campaigns.manage");
  const canReviewTasks = isAdmin(user) || hasPermission(user, "marketing.tasks.review");
  const canManagePlatforms = isAdmin(user) || hasPermission(user, "marketing.platforms.manage");
  const canManageSettings = isAdmin(user) || hasPermission(user, "marketing.settings.manage");
  const canSeePeopleCatalog = canManageCampaigns || canReviewTasks || canManageSettings;
  const [
    users,
    campaignTypes,
    creativeCatalog,
    funnels,
    platforms,
    postTypes,
    departments,
    members,
    workflowActions,
    contentSections,
    orderStatuses,
  ] = await Promise.all([
    sql<any[]>`
      select u.id::text,u.full_name,u.email,u.mobile,
        coalesce(array_agg(distinct d.code) filter(where d.id is not null),'{}') as department_codes,
        coalesce(array_agg(distinct d.name) filter(where d.id is not null),'{}') as departments
      from core.users u
      left join core.user_departments ud on ud.user_id=u.id
      left join core.departments d on d.id=ud.department_id
      where u.is_active=true and (${canSeePeopleCatalog}=true or u.id=${user.id}::uuid)
      group by u.id order by u.full_name
    `,
    sql<any[]>`select id::text,name,prefix,sort_order,is_active from marketing.campaign_types where is_active=true order by sort_order,name`,
    sql<any[]>`
      select c.id::text,c.name,c.short_code,c.primary_department_code,c.content_section_id::text,c.sort_order,c.is_active,
        s.name as content_section_name
      from marketing.creative_catalog c left join marketing.content_sections s on s.id=c.content_section_id
      where c.is_active=true order by c.sort_order,c.name
    `,
    sql<any[]>`select id::text,name,sort_order,is_active from marketing.funnels where is_active=true order by sort_order,name`,
    sql<any[]>`
      select p.id::text,p.code,p.name,p.icon,p.status,p.capability_state,p.sort_order,p.is_active,
        c.id::text as connection_id,c.status as connection_status,c.mode,c.account_id,c.account_name,c.profile_id,c.scopes,
        c.expires_at,c.last_refreshed_at,c.last_error,c.updated_at as connection_updated_at
      from marketing.platform_catalog p left join marketing.platform_connections c on c.platform_id=p.id
      where p.is_active=true order by p.sort_order,p.name
    `,
    sql<any[]>`
      select t.id::text,t.platform_id::text,t.code,t.name,t.dimensions,t.sort_order,t.is_active,p.code as platform_code,p.name as platform_name
      from marketing.platform_post_types t join marketing.platform_catalog p on p.id=t.platform_id
      where t.is_active=true order by p.sort_order,t.sort_order,t.name
    `,
    sql<any[]>`select department_code,display_name,short_code,sort_order,is_active from marketing.department_mappings where is_active=true order by sort_order,display_name`,
    sql<any[]>`
      select m.department_code,m.user_id::text,u.full_name,u.email,m.sort_order
      from marketing.department_members m join core.users u on u.id=m.user_id and u.is_active=true
      order by m.department_code,m.sort_order,u.full_name
    `,
    sql<any[]>`
      select id::text,department_code,name,sort_order,weight,is_admin_only,is_required,is_active
      from marketing.workflow_actions where is_active=true order by department_code,sort_order,id
    `,
    sql<any[]>`select id::text,code,name,sort_order,is_active from marketing.content_sections where is_active=true order by sort_order,name`,
    sql<any[]>`select id::text,code,name,sort_order,is_active from marketing.order_statuses where is_active=true order by sort_order,name`,
  ]);

  const canUseAttendance = isAdmin(user) || hasPermission(user, "marketing.attendance.self");
  const [attendanceSettings] = canUseAttendance
    ? await sql<any[]>`select work_start,work_end,grace_minutes,timezone from marketing.attendance_settings where id=true`
    : [null];
  const [ownerColorSetting] = await sql<any[]>`select value from marketing.settings where key='ownerColors'`;
  const ownerColors = ownerColorSetting?.value && typeof ownerColorSetting.value === "object" ? ownerColorSetting.value : {};
  const attendanceTimezone = attendanceSettings?.timezone || "Asia/Riyadh";
  const [todayAttendance] = canUseAttendance
    ? await sql<any[]>`
        select checked_in_at,checked_out_at
        from marketing.attendance_sessions
        where user_id=${user.id}::uuid and work_date=(now() at time zone ${attendanceTimezone})::date
      `
    : [null];

  return {
    ok: true,
    users,
    campaignTypes,
    creativeCatalog,
    funnels,
    platforms: platforms.map((platform: any) => canManagePlatforms ? platform : {
      id: platform.id, code: platform.code, name: platform.name, icon: platform.icon,
      status: platform.status, capability_state: platform.capability_state, sort_order: platform.sort_order, is_active: platform.is_active,
    }),
    postTypes,
    departments,
    departmentMembers: canSeePeopleCatalog ? members : [],
    workflowActions,
    contentSections,
    orderStatuses,
    ownerColors,
    attendanceReminder: {
      required: Boolean(canUseAttendance && !isAdmin(user) && !todayAttendance?.checked_in_at),
      checkedInAt: todayAttendance?.checked_in_at || null,
      checkedOutAt: todayAttendance?.checked_out_at || null,
      workStart: attendanceSettings?.work_start || "16:00",
      workEnd: attendanceSettings?.work_end || "21:00",
      timezone: attendanceTimezone,
    },
    access: {
      dashboard: hasPermission(user, "marketing.dashboard.view"),
      campaignsView: hasPermission(user, "marketing.campaigns.view"),
      campaignsManage: canManageCampaigns,
      tasksView: hasPermission(user, "marketing.tasks.view"),
      publishPrepView: hasPermission(user, "marketing.publish_prep.view"),
      publishPrepManage: isAdmin(user) || hasPermission(user, "marketing.publish_prep.manage"),
      platformsManage: canManagePlatforms,
      packagesManage: isAdmin(user) || hasPermission(user, "marketing.packages.manage"),
      stockView: hasPermission(user, "marketing.stock.view"),
      reportsView: hasPermission(user, "marketing.reports.view"),
      attendanceSelf: hasPermission(user, "marketing.attendance.self"),
      attendanceManage: isAdmin(user) || hasPermission(user, "marketing.attendance.manage"),
      settingsManage: canManageSettings,
    },
  };
}

export async function marketingSettingsData(request: VercelRequest, user: SessionUser) {
  requireSettings(user);
  const sql = getSql();
  const meta = await marketingMeta(user);
  const [settingsRows, attendanceSettings, whatsappContactsCount] = await Promise.all([
    sql<any[]>`select key,value,updated_at from marketing.settings order by key`,
    sql<any[]>`select * from marketing.attendance_settings where id=true`,
    sql<any[]>`select count(*)::int as total from marketing.whatsapp_contacts where is_active=true`,
  ]);
  const settings = Object.fromEntries(settingsRows.map((row) => [row.key, row.value]));
  const rawMersal = settings.mersal && typeof settings.mersal === "object" ? settings.mersal : {};
  settings.mersal = {
    apiEndpoint: clean(rawMersal.apiEndpoint || rawMersal.endpoint),
    imageTemplate: clean(rawMersal.imageTemplate) || "mzj_image_caption_v4",
    videoTemplate: clean(rawMersal.videoTemplate) || "mzj_video_campaign",
    templateLanguage: clean(rawMersal.templateLanguage || rawMersal.language) || "ar",
    token: "",
    tokenConfigured: secretConfigured(rawMersal.tokenEncrypted) || Boolean(clean(process.env.MERSAL_TOKEN)),
  };
  return { ...meta, settings, attendanceSettings: attendanceSettings[0] || null, whatsappContactsCount: Number(whatsappContactsCount[0]?.total || 0) };
}

async function saveCatalogItem(user: SessionUser, body: Record<string, any>) {
  const sql = getSql();
  const catalog = clean(body.catalog);
  const id = clean(body.id);
  const name = clean(body.name);
  if (!name) throw new MarketingError(400, "الاسم مطلوب", "VALIDATION_ERROR");

  if (catalog === "campaign_type") {
    const prefix = clean(body.prefix).toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 12);
    if (!prefix) throw new MarketingError(400, "اختصار نوع الحملة مطلوب", "VALIDATION_ERROR");
    const [row] = id ? await sql<any[]>`
      update marketing.campaign_types set name=${name},prefix=${prefix},sort_order=${numberValue(body.sortOrder)},is_active=${boolValue(body.isActive ?? true)},updated_at=now()
      where id=${id}::uuid returning *,id::text
    ` : await sql<any[]>`
      insert into marketing.campaign_types(name,prefix,sort_order,is_active) values (${name},${prefix},${numberValue(body.sortOrder)},${boolValue(body.isActive ?? true)}) returning *,id::text
    `;
    return row;
  }

  if (catalog === "content_section") {
    const code = clean(body.code).toLowerCase().replace(/[^a-z0-9_-]/g, "_") || `section_${Date.now()}`;
    const [row] = id ? await sql<any[]>`
      update marketing.content_sections set code=${code},name=${name},sort_order=${numberValue(body.sortOrder)},is_active=${boolValue(body.isActive ?? true)} where id=${id}::uuid returning *,id::text
    ` : await sql<any[]>`
      insert into marketing.content_sections(code,name,sort_order,is_active) values (${code},${name},${numberValue(body.sortOrder)},${boolValue(body.isActive ?? true)}) returning *,id::text
    `;
    return row;
  }

  if (catalog === "creative") {
    const departmentCode = normalizeDepartment(body.primaryDepartmentCode);
    const shortCode = clean(body.shortCode).toUpperCase().replace(/[^A-Z0-9_-]/g, "-").slice(0, 24);
    if (!departmentCode || !shortCode) throw new MarketingError(400, "القسم والاختصار مطلوبان", "VALIDATION_ERROR");
    const sectionId = clean(body.contentSectionId);
    const [row] = id ? await sql<any[]>`
      update marketing.creative_catalog set name=${name},short_code=${shortCode},primary_department_code=${departmentCode},content_section_id=${sectionId || null},sort_order=${numberValue(body.sortOrder)},is_active=${boolValue(body.isActive ?? true)},updated_at=now()
      where id=${id}::uuid returning *,id::text
    ` : await sql<any[]>`
      insert into marketing.creative_catalog(name,short_code,primary_department_code,content_section_id,sort_order,is_active)
      values (${name},${shortCode},${departmentCode},${sectionId || null},${numberValue(body.sortOrder)},${boolValue(body.isActive ?? true)}) returning *,id::text
    `;
    return row;
  }

  if (catalog === "funnel") {
    const [row] = id ? await sql<any[]>`
      update marketing.funnels set name=${name},sort_order=${numberValue(body.sortOrder)},is_active=${boolValue(body.isActive ?? true)} where id=${id}::uuid returning *,id::text
    ` : await sql<any[]>`
      insert into marketing.funnels(name,sort_order,is_active) values (${name},${numberValue(body.sortOrder)},${boolValue(body.isActive ?? true)}) returning *,id::text
    `;
    return row;
  }

  if (catalog === "order_status") {
    const code = clean(body.code).toLowerCase().replace(/[^a-z0-9_-]/g, "_") || `status_${Date.now()}`;
    const [row] = id ? await sql<any[]>`
      update marketing.order_statuses set code=${code},name=${name},sort_order=${numberValue(body.sortOrder)},is_active=${boolValue(body.isActive ?? true)} where id=${id}::uuid returning *,id::text
    ` : await sql<any[]>`
      insert into marketing.order_statuses(code,name,sort_order,is_active) values (${code},${name},${numberValue(body.sortOrder)},${boolValue(body.isActive ?? true)}) returning *,id::text
    `;
    return row;
  }

  throw new MarketingError(400, "نوع الكتالوج غير مدعوم", "INVALID_CATALOG");
}

export async function marketingSettingsAction(user: SessionUser, body: Record<string, any>) {
  requireSettings(user);
  const sql = getSql();
  const action = clean(body.action);

  if (action === "save_marketing_setting") {
    const key = clean(body.key);
    if (!["publishing", "mersal", "ownerColors"].includes(key)) throw new MarketingError(400, "مفتاح الإعداد غير مدعوم", "INVALID_SETTING");
    const incoming = body.value && typeof body.value === "object" ? body.value as Record<string, unknown> : {};
    let value: Record<string, unknown>;
    if (key === "mersal") {
      const [current] = await sql<any[]>`select value from marketing.settings where key='mersal'`;
      const currentValue = current?.value && typeof current.value === "object" ? current.value : {};
      const newToken = clean(incoming.token);
      value = {
        apiEndpoint: clean(incoming.apiEndpoint || incoming.endpoint),
        imageTemplate: clean(incoming.imageTemplate) || "mzj_image_caption_v4",
        videoTemplate: clean(incoming.videoTemplate) || "mzj_video_campaign",
        templateLanguage: clean(incoming.templateLanguage || incoming.language) || "ar",
        tokenEncrypted: newToken ? encryptPlatformSecret(newToken) : clean(currentValue.tokenEncrypted) || null,
      };
    } else value = safeJson(incoming);
    const [row] = await sql<any[]>`
      insert into marketing.settings(key,value,updated_by,updated_at) values (${key},${sql.json(safeJson(value))},${user.id}::uuid,now())
      on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=now()
      returning key,updated_at
    `;
    return { ok: true, row, message: "تم حفظ إعدادات التسويق" };
  }

  if (action === "import_whatsapp_contacts") {
    const sourceFile = clean(body.sourceFile).slice(0, 250) || null;
    const rows = arrayValue<any>(body.contacts);
    if (!rows.length) throw new MarketingError(400, "لم يتم العثور على أرقام جوال في الملف", "CONTACTS_REQUIRED");
    if (rows.length > 10000) throw new MarketingError(400, "الحد الأقصى للاستيراد في المرة الواحدة 10000 صف", "CONTACTS_LIMIT");
    const contacts = new Map<string, { phoneDisplay: string; name: string | null }>();
    for (const item of rows) {
      const raw = typeof item === "object" && item !== null
        ? item.phone ?? item.mobile ?? item.phoneNumber ?? item["رقم الجوال"] ?? item["رقم الهاتف"] ?? item["الجوال"] ?? item["الهاتف"] ?? ""
        : item;
      const phone = normalizeSaudiPhone(raw);
      if (!phone) continue;
      const name = typeof item === "object" && item !== null ? clean(item.name ?? item.fullName ?? item["الاسم"]) || null : null;
      contacts.set(phone, { phoneDisplay: clean(raw) || phone, name });
    }
    if (!contacts.size) throw new MarketingError(400, "لم يتم العثور على أرقام جوال صحيحة في الملف", "NO_VALID_CONTACTS");
    let inserted = 0;
    let updated = 0;
    await sql.begin(async (tx) => {
      for (const [phone, item] of contacts.entries()) {
        const [existing] = await tx<any[]>`select id::text from marketing.whatsapp_contacts where phone_normalized=${phone}`;
        await tx`
          insert into marketing.whatsapp_contacts(phone_normalized,phone_display,name,source_file,is_active,created_by,updated_by,created_at,updated_at)
          values (${phone},${item.phoneDisplay},${item.name},${sourceFile},true,${user.id}::uuid,${user.id}::uuid,now(),now())
          on conflict(phone_normalized) do update set
            phone_display=excluded.phone_display,
            name=coalesce(excluded.name,marketing.whatsapp_contacts.name),
            source_file=coalesce(excluded.source_file,marketing.whatsapp_contacts.source_file),
            is_active=true,updated_by=excluded.updated_by,updated_at=now()
        `;
        if (existing) updated += 1; else inserted += 1;
      }
    });
    const [count] = await sql<any[]>`select count(*)::int total from marketing.whatsapp_contacts where is_active=true`;
    return { ok: true, inserted, updated, total: Number(count?.total || 0), message: `تم استيراد ${contacts.size} رقم وحفظها بدون تكرار` };
  }

  if (action === "clear_whatsapp_contacts") {
    if (!isAdmin(user)) throw new MarketingError(403, "مسح أرقام واتساب متاح للأدمن فقط", "FORBIDDEN");
    const confirmation = clean(body.confirmation);
    if (confirmation !== "CLEAR_WHATSAPP_CONTACTS") throw new MarketingError(400, "تأكيد مسح الأرقام غير صحيح", "CONFIRMATION_REQUIRED");
    const result = await sql`update marketing.whatsapp_contacts set is_active=false,updated_by=${user.id}::uuid,updated_at=now() where is_active=true`;
    return { ok: true, changed: result.count, message: "تم إيقاف أرقام واتساب المحفوظة" };
  }

  if (action === "save_attendance_settings") {
    const workStart = clean(body.workStart);
    const workEnd = clean(body.workEnd);
    if (!/^\d{2}:\d{2}$/.test(workStart) || !/^\d{2}:\d{2}$/.test(workEnd)) throw new MarketingError(400, "وقت بداية ونهاية الدوام غير صحيح", "INVALID_TIME");
    const [row] = await sql<any[]>`
      update marketing.attendance_settings set
        work_start=${workStart}::time,work_end=${workEnd}::time,grace_minutes=${Math.max(0, numberValue(body.graceMinutes, 15))},
        heartbeat_seconds=${Math.max(30, numberValue(body.heartbeatSeconds, 60))},offline_after_minutes=${Math.max(2, numberValue(body.offlineAfterMinutes, 10))},
        idle_after_minutes=${Math.max(1, numberValue(body.idleAfterMinutes, 5))},timezone=${clean(body.timezone) || "Asia/Riyadh"},updated_by=${user.id}::uuid,updated_at=now()
      where id=true returning *
    `;
    return { ok: true, row, message: "تم حفظ مواعيد الحضور والانصراف" };
  }

  if (action === "save_catalog_item") {
    const row = await saveCatalogItem(user, body);
    return { ok: true, row, message: "تم حفظ العنصر" };
  }

  if (action === "archive_catalog_item") {
    const catalog = clean(body.catalog);
    const id = clean(body.id);
    if (!id) throw new MarketingError(400, "معرّف العنصر مطلوب", "VALIDATION_ERROR");
    const tables: Record<string, string> = {
      campaign_type: "marketing.campaign_types",
      creative: "marketing.creative_catalog",
      funnel: "marketing.funnels",
      content_section: "marketing.content_sections",
      order_status: "marketing.order_statuses",
    };
    const table = tables[catalog];
    if (!table) throw new MarketingError(400, "نوع الكتالوج غير مدعوم", "INVALID_CATALOG");
    const result = await sql.unsafe(`update ${table} set is_active=false${table.includes("campaign_types") || table.includes("creative_catalog") ? ",updated_at=now()" : ""} where id=$1::uuid`, [id]);
    if (!result.count) throw new MarketingError(404, "العنصر غير موجود", "NOT_FOUND");
    return { ok: true, message: "تم إخفاء العنصر من الاستخدام" };
  }

  if (action === "save_department") {
    const departmentCode = normalizeDepartment(body.departmentCode);
    const displayName = clean(body.displayName);
    const shortCode = clean(body.shortCode).toUpperCase().replace(/[^A-Z0-9_-]/g, "_").slice(0, 20);
    if (!departmentCode || !displayName || !shortCode) throw new MarketingError(400, "أكمل بيانات القسم", "VALIDATION_ERROR");
    const memberIds = [...new Set(arrayValue(body.memberIds).map(clean).filter(Boolean))];
    const [row] = await sql.begin(async (tx) => {
      const [saved] = await tx<any[]>`
        insert into marketing.department_mappings(department_code,display_name,short_code,sort_order,is_active,updated_at)
        values (${departmentCode},${displayName},${shortCode},${numberValue(body.sortOrder)},${boolValue(body.isActive ?? true)},now())
        on conflict(department_code) do update set display_name=excluded.display_name,short_code=excluded.short_code,sort_order=excluded.sort_order,is_active=excluded.is_active,updated_at=now()
        returning *
      `;
      await tx`delete from marketing.department_members where department_code=${departmentCode}`;
      for (let index = 0; index < memberIds.length; index += 1) {
        await tx`insert into marketing.department_members(department_code,user_id,sort_order) values (${departmentCode},${memberIds[index]}::uuid,${index})`;
      }
      return [saved];
    });
    return { ok: true, row, message: "تم حفظ القسم وأعضائه" };
  }

  if (action === "save_workflow") {
    const departmentCode = normalizeDepartment(body.departmentCode);
    const actions = arrayValue<Record<string, any>>(body.actions);
    if (!departmentCode || !actions.length) throw new MarketingError(400, "القسم وإجراء واحد على الأقل مطلوبان", "VALIDATION_ERROR");
    const total = actions.reduce((sum, item) => sum + Math.max(0, numberValue(item.weight)), 0);
    if (Math.round(total * 100) / 100 !== 100) throw new MarketingError(400, "مجموع أوزان إجراءات القسم يجب أن يساوي 100%", "INVALID_WEIGHT_TOTAL");
    await sql.begin(async (tx) => {
      await tx`update marketing.workflow_actions set is_active=false,updated_at=now() where department_code=${departmentCode}`;
      for (let index = 0; index < actions.length; index += 1) {
        const item = actions[index];
        const name = clean(item.name);
        if (!name) throw new MarketingError(400, `اسم الإجراء رقم ${index + 1} مطلوب`, "VALIDATION_ERROR");
        await tx`
          insert into marketing.workflow_actions(department_code,name,sort_order,weight,is_admin_only,is_required,is_active,updated_at)
          values (${departmentCode},${name},${index + 1},${Math.max(0, numberValue(item.weight))},${boolValue(item.isAdminOnly)},${boolValue(item.isRequired ?? true)},true,now())
          on conflict(department_code,name) do update set sort_order=excluded.sort_order,weight=excluded.weight,is_admin_only=excluded.is_admin_only,is_required=excluded.is_required,is_active=true,updated_at=now()
        `;
      }
    });
    return { ok: true, message: "تم حفظ إجراءات القسم وأوزانها" };
  }

  if (action === "save_platform_catalog") {
    const platformId = clean(body.platformId);
    const postTypes = arrayValue<Record<string, any>>(body.postTypes);
    if (!platformId) throw new MarketingError(400, "المنصة مطلوبة", "VALIDATION_ERROR");
    await sql.begin(async (tx) => {
      await tx`update marketing.platform_post_types set is_active=false where platform_id=${platformId}::uuid`;
      for (let index = 0; index < postTypes.length; index += 1) {
        const item = postTypes[index];
        const code = clean(item.code).toLowerCase().replace(/[^a-z0-9_-]/g, "_");
        const name = clean(item.name);
        if (!code || !name) throw new MarketingError(400, "اسم وكود نوع النشر مطلوبان", "VALIDATION_ERROR");
        await tx`
          insert into marketing.platform_post_types(platform_id,code,name,dimensions,is_active,sort_order)
          values (${platformId}::uuid,${code},${name},${clean(item.dimensions) || null},true,${index + 1})
          on conflict(platform_id,code) do update set name=excluded.name,dimensions=excluded.dimensions,is_active=true,sort_order=excluded.sort_order
        `;
      }
    });
    return { ok: true, message: "تم حفظ أنواع النشر والأبعاد" };
  }

  throw new MarketingError(400, "إجراء إعدادات التسويق غير مدعوم", "INVALID_ACTION");
}
