import type { VercelRequest, VercelResponse } from "@vercel/node";
import { gzipSync, gunzipSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import { requireAdmin, type SessionUser } from "./_auth.js";
import { getSql } from "./_db.js";
import { ensureCrmSchema } from "./_crm-schema.js";
import { attachLeadToContactAndOpenRequest } from "./_crm-lifecycle.js";
import { calculateLeadCompletion, getCustomerFieldDefinitions } from "./_crm-customer-fields.js";
import { branchForDepartment, calculateCreditLimit, chooseAssignment, clean, departmentCodeFromKey, sourceLabel } from "./_crm-utils.js";
import { normalizePhone } from "./_phone-utils.js";

const BACKUP_FORMAT = "mzj-platform-database-backup";
const BACKUP_VERSION = 1;
const BACKUP_SCHEMAS = ["core", "crm", "marketing", "operations", "tracking", "integrations", "audit"] as const;
const RESET_ROOT_TABLES = [
  "integrations.erpnext_sales_orders",
  "tracking.orders",
  "operations.transfer_requests",
  "operations.vehicles",
  "marketing.tasks",
  "marketing.campaigns",
  "marketing.agendas",
  "crm.contacts",
  "crm.service_requests",
  "crm.conversations",
  "crm.leads",
  "crm.kpi_evaluations",
] as const;

type DepartmentKey = "cash" | "finance" | "service";
type ImportCell = string | number | boolean | null;
type ImportRow = Record<string, ImportCell>;
type BackupColumn = { name: string; nullable: boolean; generated: boolean };
type BackupTable = { schema: string; name: string; columns: BackupColumn[]; primaryKey: string[]; rows: Record<string, unknown>[] };
type DatabaseBackup = { format: string; version: number; createdAt: string; applicationVersion: string; createdBy: { id: string; name: string }; tables: BackupTable[] };

function parseBody(request: VercelRequest) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) return request.body as Record<string, any>;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body); } catch { return {}; }
  }
  return {};
}

function safeIdentifier(value: string) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function qualified(schema: string, table: string) {
  return `${safeIdentifier(schema)}.${safeIdentifier(table)}`;
}

function normalizedText(value: unknown) {
  return clean(value)
    .replace(/_x000D_/gi, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[\s_\-\/\\]+/g, " ")
    .trim()
    .toLowerCase();
}

function rowValue(row: ImportRow, aliases: string[]) {
  const wanted = new Set(aliases.map(normalizedText));
  for (const [key, value] of Object.entries(row || {})) {
    if (wanted.has(normalizedText(key))) return clean(value).replace(/_x000D_/gi, " ").trim();
  }
  return "";
}

function parseImportedDate(value: string) {
  const text = clean(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function departmentWhere(department: DepartmentKey) {
  if (department === "finance") return ["finance_sales"];
  if (department === "service") return ["customer_service"];
  return ["cash_sales", "wholesale", "wholesale_sales"];
}

function departmentLabel(department: DepartmentKey) {
  return department === "finance" ? "مبيعات التمويل" : department === "service" ? "خدمة العملاء" : "مبيعات الكاش";
}

function toPositiveInteger(value: string) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.max(1, Math.floor(number)) : null;
}

async function auditDataAction(user: SessionUser, action: string, details: unknown) {
  const sql = getSql();
  await sql`
    insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data)
    values(${user.id}::uuid,'core',${action},'data_management',null,${sql.json(details as any)})
  `.catch(() => undefined);
}

async function exportCustomers(response: VercelResponse, department: DepartmentKey) {
  const sql = getSql();
  const codes = departmentWhere(department);
  const rows = await sql<any[]>`
    select
      l.id::text,l.customer_name,l.phone,l.phone_normalized,l.department_code,l.branch_code,
      coalesce(b.name,l.branch_code,'') as branch_name,l.source_code,l.source_name,l.car_name,l.car_category,
      l.status_label,l.payment_type,l.notes,l.status_note,l.sold_quantity,l.sold_at,l.responsible_name_snapshot,
      l.call_center_name_snapshot,l.registered_at,l.created_at,l.updated_at
    from crm.leads l
    left join core.branches b on b.code=l.branch_code
    where l.is_deleted=false and l.department_code = any(${codes}::text[])
    order by coalesce(l.registered_at,l.created_at),l.created_at,l.id
  `;
  return response.status(200).json({
    ok: true,
    department,
    label: departmentLabel(department),
    rows: rows.map((row) => ({
      "رقم داخلي": row.id,
      "اسم العميل": row.customer_name || "",
      "رقم الجوال": row.phone || row.phone_normalized || "",
      "القسم": departmentLabel(department),
      "الفرع": row.branch_name || row.branch_code || "",
      "المصدر": row.source_name || row.source_code || "",
      "اسم السيارة": row.car_name || "",
      "الفئة": row.car_category || "",
      "الحالة": row.status_label || "",
      "نوع البيع": row.payment_type || "",
      "المندوب": row.responsible_name_snapshot || "",
      "الكول سنتر": row.call_center_name_snapshot || "",
      "عدد المباع": row.sold_quantity || "",
      "تاريخ تم البيع": row.sold_at || "",
      "ملاحظات": row.notes || "",
      "ملاحظات الحالة": row.status_note || "",
      "تاريخ التسجيل": row.registered_at || row.created_at || "",
      "آخر تحديث": row.updated_at || "",
    })),
  });
}

async function importCustomers(request: VercelRequest, response: VercelResponse, user: SessionUser, department: DepartmentKey) {
  await ensureCrmSchema();
  const sql = getSql();
  const body = parseBody(request);
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 250) as ImportRow[] : [];
  if (!rows.length) return response.status(400).json({ ok: false, error: "لا توجد صفوف صالحة للاستيراد" });

  const [branches, sources, users, statuses, customerFields] = await Promise.all([
    sql<any[]>`select code,name from core.branches where is_active=true order by sort_order,name`,
    sql<any[]>`select code,name from core.sources where is_active=true order by sort_order,name`,
    sql<any[]>`
      select u.id::text,u.full_name,
        coalesce((
          select array_agg(distinct scoped.code order by scoped.code)
          from (
            select d.code from core.user_system_departments usd join core.departments d on d.id=usd.department_id
            where usd.user_id=u.id and usd.system_code='crm' and d.is_active=true
            union
            select d.code from core.user_departments ud join core.departments d on d.id=ud.department_id
            where ud.user_id=u.id and d.is_active=true
          ) scoped
        ),'{}'::text[]) as department_codes,
        coalesce((
          select array_agg(distinct scoped.code order by scoped.code)
          from (
            select b.code from core.user_system_branches usb join core.branches b on b.id=usb.branch_id
            where usb.user_id=u.id and usb.system_code='crm' and b.is_active=true
            union
            select b.code from core.user_branches ub join core.branches b on b.id=ub.branch_id
            where ub.user_id=u.id and b.is_active=true
          ) scoped
        ),'{}'::text[]) as branch_codes
      from core.users u where u.is_active=true order by u.full_name
    `,
    sql<any[]>`select department_code,label,value from crm.dashboard_statuses where is_active=true order by department_code,sort_order`,
    getCustomerFieldDefinitions(),
  ]);
  const branchMap = new Map<string, { code: string; name: string }>();
  branches.forEach((item) => { branchMap.set(normalizedText(item.code), item); branchMap.set(normalizedText(item.name), item); });
  const sourceMap = new Map<string, { code: string; name: string }>();
  sources.forEach((item) => { sourceMap.set(normalizedText(item.code), item); sourceMap.set(normalizedText(item.name), item); });
  const userMap = new Map<string, { id: string; full_name: string; department_codes: string[]; branch_codes: string[] }>();
  users.forEach((item) => userMap.set(normalizedText(item.full_name), item));
  const statusMap = new Map<string, string>();
  statuses.filter((item) => item.department_code === department).forEach((item) => {
    const value = clean(item.value || item.label);
    if (!value) return;
    statusMap.set(normalizedText(item.value), value);
    statusMap.set(normalizedText(item.label), value);
  });

  const serviceKey = department;
  const departmentCode = departmentCodeFromKey(serviceKey);
  const defaultBranch = branchForDepartment(serviceKey);
  const result = { received: rows.length, imported: 0, duplicates: 0, skipped: 0, errors: [] as Array<{ row: number; reason: string }> };

  for (let index = 0; index < rows.length; index += 1) {
    const sourceRow = rows[index];
    const rowNumber = Number(body.startRow || 2) + index;
    try {
      const customerName = rowValue(sourceRow, ["اسم العميل", "العميل", "customer name", "customer", "name", "full name"]);
      const phone = rowValue(sourceRow, ["رقم الجوال", "الجوال", "رقم الهاتف", "الهاتف", "mobile", "phone", "phone number"]);
      const phoneNormalized = normalizePhone(phone);
      if (!customerName || !phoneNormalized) {
        result.skipped += 1;
        result.errors.push({ row: rowNumber, reason: !customerName ? "اسم العميل غير موجود" : "رقم الجوال غير صالح" });
        continue;
      }

      const [duplicate] = await sql<any[]>`select id::text from crm.leads where phone_normalized=${phoneNormalized} and is_deleted=false limit 1`;
      if (duplicate) {
        result.duplicates += 1;
        continue;
      }

      const branchText = rowValue(sourceRow, ["الفرع", "اسم الفرع", "branch"]);
      const sourceText = rowValue(sourceRow, ["المصدر", "اسم المصدر", "source"]);
      const sourceInfo = sourceMap.get(normalizedText(sourceText));
      const sourceCode = sourceInfo?.code || "manual";
      const sourceName = sourceInfo?.name || sourceLabel(sourceText || sourceCode);
      const mappedBranch = branchMap.get(normalizedText(branchText));
      let branchCode = serviceKey === "service"
        ? "customer_service"
        : serviceKey === "finance"
          ? "online"
          : mappedBranch?.code || defaultBranch;

      const assignedText = rowValue(sourceRow, ["المندوب", "اسم المندوب", "المسؤول", "مندوب المبيعات", "sales person", "agent"]);
      const assignedUser = userMap.get(normalizedText(assignedText));
      const acceptedDepartments = serviceKey === "finance" ? ["finance_sales"] : serviceKey === "service" ? ["customer_service"] : ["cash_sales", "wholesale", "wholesale_sales"];
      const assignedUserAllowed = Boolean(assignedUser?.department_codes?.some((code) => acceptedDepartments.includes(code)));
      let assignment = assignedUser && assignedUserAllowed
        ? { assignedTo: assignedUser.id, assignedName: assignedUser.full_name, branchCode }
        : await chooseAssignment(serviceKey, branchCode, sourceCode);
      branchCode = assignment.branchCode || branchCode || defaultBranch;

      const callCenter = { assignedTo: null, assignedName: "" };

      const importedStatus = rowValue(sourceRow, ["الحالة", "حالة العميل", "status"]);
      const normalizedImportedStatus = serviceKey === "service" && normalizedText(importedStatus) === normalizedText("تم البيع") ? "تم الانتهاء" : importedStatus;
      const statusLabel = statusMap.get(normalizedText(normalizedImportedStatus)) || "عميل جديد";
      const soldQuantity = statusLabel === "تم البيع"
        ? toPositiveInteger(rowValue(sourceRow, ["عدد المباع", "الكمية المباعة", "sold quantity"])) || 1
        : null;
      const registeredAt = parseImportedDate(rowValue(sourceRow, ["تاريخ التسجيل", "تاريخ الاضافة", "created at", "registered at"]));
      const soldAt = statusLabel === "تم البيع" ? parseImportedDate(rowValue(sourceRow, ["تاريخ تم البيع", "تاريخ البيع", "sold at", "sale date"])) : null;
      const leadInput = {
        customerName,
        phone,
        phoneNormalized,
        sourceCode,
        sourceName,
        serviceKey,
        departmentCode,
        branchCode,
        statusLabel,
        paymentType: serviceKey === "finance" ? "تمويل" : serviceKey === "service" ? "خدمة عملاء" : "كاش",
        carName: rowValue(sourceRow, ["اسم السيارة", "السيارة", "نوع السيارة", "car", "car name"]),
        carCategory: rowValue(sourceRow, ["الفئة", "فئة السيارة", "category"]),
        location: rowValue(sourceRow, ["المكان", "المدينة", "location"]),
        notes: rowValue(sourceRow, ["ملاحظات", "الملاحظات", "notes"]),
        statusNote: rowValue(sourceRow, ["ملاحظات الحالة", "تحديثات", "status note"]),
        salary: Number(rowValue(sourceRow, ["الراتب", "salary"])) || null,
        obligation: Number(rowValue(sourceRow, ["الالتزام", "الالتزامات", "obligation"])) || null,
        financeType: rowValue(sourceRow, ["نوع التمويل", "finance type"]),
        soldQuantity,
      };
      const completionPercent = calculateLeadCompletion(leadInput, customerFields);
      const credit = calculateCreditLimit(leadInput.salary, leadInput.obligation, leadInput.financeType);

      const [lead] = await sql<any[]>`
        insert into crm.leads(
          customer_name,phone,phone_normalized,source_code,source_name,service_key,department_code,branch_code,
          status_label,payment_type,car_name,car_category,location,notes,status_note,assigned_to,call_center_assigned_to,
          created_by,updated_by,registered_at,responsible_name_snapshot,call_center_name_snapshot,sold_quantity,sold_at,
          completion_percent,credit_limit,credit_qualified,extra_data
        ) values(
          ${customerName},${phone},${phoneNormalized},${sourceCode},${sourceName},${serviceKey},${departmentCode},${branchCode || null},
          ${statusLabel},${leadInput.paymentType},${leadInput.carName || null},${leadInput.carCategory || null},${leadInput.location || null},${leadInput.notes || null},${leadInput.statusNote || null},
          ${assignment.assignedTo || null}::uuid,${callCenter.assignedTo || null}::uuid,${user.id}::uuid,${user.id}::uuid,coalesce(${registeredAt || null}::date,now()),
          ${assignment.assignedName || null},${callCenter.assignedName || null},${soldQuantity},${soldAt || null}::date,${completionPercent},${credit.amount},${credit.qualified},
          ${sql.json({ importedFrom: "legacy_excel", importedAt: new Date().toISOString(), originalRow: sourceRow })}
        ) returning *,id::text
      `;
      await sql`
        insert into crm.lead_events(lead_id,event_type,new_status,new_department,new_branch,actor_id,actor_name,actor_role,note,details)
        values(${lead.id}::uuid,'lead_imported',${statusLabel},${departmentCode},${branchCode || null},${user.id}::uuid,${user.fullName},${user.roles.join("، ") || null},'استيراد عميل من ملف Excel القديم',${sql.json({ row: rowNumber, department })})
      `;
      await attachLeadToContactAndOpenRequest({ leadId: lead.id, actor: user, classificationMethod: "legacy_import" });
      result.imported += 1;
    } catch (error) {
      result.skipped += 1;
      result.errors.push({ row: rowNumber, reason: error instanceof Error ? error.message : "تعذر استيراد الصف" });
    }
  }

  await auditDataAction(user, "customers_imported", { department, ...result, errors: result.errors.slice(0, 50) });
  return response.status(200).json({ ok: true, department, result });
}

async function resetTestData(response: VercelResponse, user: SessionUser, confirmation: string) {
  if (confirmation !== "مسح كل البيانات التجريبية") {
    return response.status(400).json({ ok: false, error: "اكتب عبارة التأكيد كاملة: مسح كل البيانات التجريبية" });
  }
  const sql = getSql();
  const available = await sql<{ table_name: string }[]>`
    select value as table_name from unnest(${[...RESET_ROOT_TABLES]}::text[]) value where to_regclass(value) is not null
  `;
  const tables = available.map((item) => item.table_name).filter((item) => RESET_ROOT_TABLES.includes(item as any));
  const before: Record<string, number> = {};
  for (const table of tables) {
    const [schema, name] = table.split(".");
    const [count] = await sql.unsafe<{ count: number }[]>(`select count(*)::int as count from ${qualified(schema, name)}`);
    before[table] = Number(count?.count || 0);
  }
  if (tables.length) await sql.unsafe(`truncate table ${tables.map((item) => { const [schema, name] = item.split("."); return qualified(schema, name); }).join(", ")} restart identity cascade`);
  await auditDataAction(user, "test_data_reset", { removed: before });
  return response.status(200).json({ ok: true, message: "تم مسح بيانات العملاء والسيارات وطلبات التتبع والحملات والأجندات وتقييمات KPI فقط.", removed: before });
}

async function currentTables(sql: ReturnType<typeof getSql>) {
  return sql<{ table_schema: string; table_name: string }[]>`
    select table_schema,table_name from information_schema.tables
    where table_type='BASE TABLE' and table_schema = any(${[...BACKUP_SCHEMAS]}::text[])
      and not (table_schema='core' and table_name in ('sessions','data_restore_uploads'))
    order by table_schema,table_name
  `;
}

async function tableMetadata(sql: ReturnType<typeof getSql>, schema: string, name: string) {
  const [columns, primary] = await Promise.all([
    sql<{ column_name: string; is_nullable: string; is_generated: string }[]>`
      select column_name,is_nullable,is_generated from information_schema.columns
      where table_schema=${schema} and table_name=${name} order by ordinal_position
    `,
    sql<{ column_name: string }[]>`
      select a.attname as column_name
      from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
      join unnest(i.indkey) with ordinality keys(attnum,ord) on true join pg_attribute a on a.attrelid=c.oid and a.attnum=keys.attnum
      where i.indisprimary and n.nspname=${schema} and c.relname=${name} order by keys.ord
    `,
  ]);
  return {
    columns: columns.map((column) => ({ name: column.column_name, nullable: column.is_nullable === "YES", generated: column.is_generated !== "NEVER" })),
    primaryKey: primary.map((column) => column.column_name),
  };
}

async function createBackup(response: VercelResponse, user: SessionUser) {
  const sql = getSql();
  const tables = await currentTables(sql);
  const backupTables: BackupTable[] = [];
  for (const table of tables) {
    const meta = await tableMetadata(sql, table.table_schema, table.table_name);
    const rows = await sql.unsafe<{ row: Record<string, unknown> }[]>(`select to_jsonb(t) as row from ${qualified(table.table_schema, table.table_name)} t`);
    backupTables.push({ schema: table.table_schema, name: table.table_name, columns: meta.columns, primaryKey: meta.primaryKey, rows: rows.map((item) => item.row) });
  }
  const payload: DatabaseBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    applicationVersion: "1.19.4",
    createdBy: { id: user.id, name: user.fullName },
    tables: backupTables,
  };
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 9 });
  const filename = `MZJ-Platform-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.mzjbackup.gz`;
  response.setHeader("Content-Type", "application/gzip");
  response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-MZJ-Backup-Tables", String(backupTables.length));
  await auditDataAction(user, "database_backup_created", { tables: backupTables.length, bytes: compressed.length });
  return response.status(200).send(compressed);
}

function backupBuffer(request: VercelRequest) {
  if (Buffer.isBuffer(request.body)) return request.body;
  if (request.body instanceof Uint8Array) return Buffer.from(request.body);
  const body = parseBody(request);
  if (body.backupBase64) return Buffer.from(String(body.backupBase64), "base64");
  if (typeof request.body === "string" && request.headers["content-type"] === "application/octet-stream") return Buffer.from(request.body, "binary");
  return Buffer.alloc(0);
}

type ForeignKey = { schema_name: string; table_name: string; column_name: string; parent_schema: string; parent_table: string; nullable: boolean };

function topologicalOrder(tables: BackupTable[], foreignKeys: ForeignKey[]) {
  const keys = new Set(tables.map((table) => `${table.schema}.${table.name}`));
  const dependencies = new Map<string, Set<string>>();
  for (const key of keys) dependencies.set(key, new Set());
  for (const fk of foreignKeys) {
    if (fk.nullable) continue;
    const child = `${fk.schema_name}.${fk.table_name}`;
    const parent = `${fk.parent_schema}.${fk.parent_table}`;
    if (keys.has(child) && keys.has(parent) && child !== parent) dependencies.get(child)?.add(parent);
  }
  const ordered: string[] = [];
  const remaining = new Set(keys);
  while (remaining.size) {
    const ready = [...remaining].filter((key) => [...(dependencies.get(key) || [])].every((dependency) => !remaining.has(dependency)));
    if (!ready.length) { ordered.push(...[...remaining].sort()); break; }
    ready.sort().forEach((key) => { ordered.push(key); remaining.delete(key); });
  }
  return ordered;
}

async function resetSequences(tx: any, table: BackupTable) {
  for (const column of table.columns.filter((item) => !item.generated)) {
    const rows = await tx.unsafe(`select pg_get_serial_sequence($1,$2) as sequence_name`, [`${table.schema}.${table.name}`, column.name]) as Array<{ sequence_name: string | null }>;
    const [row] = rows;
    if (!row?.sequence_name) continue;
    await tx.unsafe(`select setval($1::regclass, greatest(coalesce((select max(${safeIdentifier(column.name)})::bigint from ${qualified(table.schema, table.name)}),0),1), (select count(*)>0 from ${qualified(table.schema, table.name)}))`, [row.sequence_name]);
  }
}

async function restoreBackupBuffer(compressed: Buffer, response: VercelResponse, user: SessionUser) {
  if (!compressed.length) return response.status(400).json({ ok: false, error: "ملف النسخة الاحتياطية غير موجود" });
  if (compressed.length > 30 * 1024 * 1024) return response.status(413).json({ ok: false, error: "حجم النسخة الاحتياطية أكبر من الحد المسموح 30MB" });
  let backup: DatabaseBackup;
  try {
    backup = JSON.parse(gunzipSync(compressed).toString("utf8"));
  } catch {
    return response.status(400).json({ ok: false, error: "ملف النسخة الاحتياطية غير صالح أو تالف" });
  }
  if (backup?.format !== BACKUP_FORMAT || backup?.version !== BACKUP_VERSION || !Array.isArray(backup.tables)) {
    return response.status(400).json({ ok: false, error: "صيغة النسخة الاحتياطية غير مدعومة" });
  }

  const sql = getSql();
  const current = await currentTables(sql);
  const currentKeys = new Set(current.map((table) => `${table.table_schema}.${table.table_name}`));
  const allowedBackupTables = backup.tables.filter((table) => BACKUP_SCHEMAS.includes(table.schema as any) && currentKeys.has(`${table.schema}.${table.name}`) && !(table.schema === "core" && ["sessions", "data_restore_uploads"].includes(table.name)));
  const tables = await Promise.all(allowedBackupTables.map(async (table) => {
    const meta = await tableMetadata(sql, table.schema, table.name);
    return { ...table, columns: meta.columns, primaryKey: meta.primaryKey } satisfies BackupTable;
  }));
  const foreignKeys = await sql<ForeignKey[]>`
    select child_ns.nspname as schema_name,child.relname as table_name,child_col.attname as column_name,
      parent_ns.nspname as parent_schema,parent.relname as parent_table,not child_col.attnotnull as nullable
    from pg_constraint c
    join pg_class child on child.oid=c.conrelid join pg_namespace child_ns on child_ns.oid=child.relnamespace
    join pg_class parent on parent.oid=c.confrelid join pg_namespace parent_ns on parent_ns.oid=parent.relnamespace
    join unnest(c.conkey) with ordinality ck(attnum,ord) on true
    join unnest(c.confkey) with ordinality pk(attnum,ord) on pk.ord=ck.ord
    join pg_attribute child_col on child_col.attrelid=child.oid and child_col.attnum=ck.attnum
    where c.contype='f' and child_ns.nspname = any(${[...BACKUP_SCHEMAS]}::text[])
  `;
  const order = topologicalOrder(tables, foreignKeys);
  const byKey = new Map(tables.map((table) => [`${table.schema}.${table.name}`, table]));
  const nullableForeignColumns = new Map<string, Set<string>>();
  for (const fk of foreignKeys) {
    if (!fk.nullable) continue;
    const key = `${fk.schema_name}.${fk.table_name}`;
    if (!byKey.has(key)) continue;
    if (!nullableForeignColumns.has(key)) nullableForeignColumns.set(key, new Set());
    nullableForeignColumns.get(key)?.add(fk.column_name);
  }

  await sql.begin(async (tx) => {
    const nonCoreTables = tables.filter((table) => table.schema !== "core");
    if (nonCoreTables.length) {
      await tx.unsafe(`truncate table ${nonCoreTables.map((table) => qualified(table.schema, table.name)).join(", ")} restart identity`);
    }

    for (const key of order) {
      const table = byKey.get(key)!;
      if (!table.rows.length) continue;
      const deferred = nullableForeignColumns.get(key) || new Set<string>();
      const columns = table.columns.filter((column) => !column.generated && !deferred.has(column.name)).map((column) => column.name);
      if (!columns.length) continue;
      const columnSql = columns.map(safeIdentifier).join(",");
      const selectSql = columns.map((column) => `src.${safeIdentifier(column)}`).join(",");
      let conflict = "";
      if (table.schema === "core") {
        if (table.primaryKey.length) {
          const updateColumns = columns.filter((column) => !table.primaryKey.includes(column));
          conflict = updateColumns.length
            ? ` on conflict (${table.primaryKey.map(safeIdentifier).join(",")}) do update set ${updateColumns.map((column) => `${safeIdentifier(column)}=excluded.${safeIdentifier(column)}`).join(",")}`
            : ` on conflict (${table.primaryKey.map(safeIdentifier).join(",")}) do nothing`;
        } else conflict = " on conflict do nothing";
      }
      for (let start = 0; start < table.rows.length; start += 500) {
        const json = JSON.stringify(table.rows.slice(start, start + 500));
        await tx.unsafe(`insert into ${qualified(table.schema, table.name)} (${columnSql}) select ${selectSql} from json_populate_recordset(null::${qualified(table.schema, table.name)},$1::json) src${conflict}`, [json]);
      }
    }

    for (const key of order) {
      const table = byKey.get(key)!;
      const deferred = [...(nullableForeignColumns.get(key) || [])].filter((column) => table.columns.some((item) => item.name === column && !item.generated));
      if (!deferred.length || !table.primaryKey.length || !table.rows.length) continue;
      const assignments = deferred.map((column) => `${safeIdentifier(column)}=src.${safeIdentifier(column)}`).join(",");
      const match = table.primaryKey.map((column) => `target.${safeIdentifier(column)}=src.${safeIdentifier(column)}`).join(" and ");
      for (let start = 0; start < table.rows.length; start += 500) {
        const json = JSON.stringify(table.rows.slice(start, start + 500));
        await tx.unsafe(`update ${qualified(table.schema, table.name)} target set ${assignments} from json_populate_recordset(null::${qualified(table.schema, table.name)},$1::json) src where ${match}`, [json]);
      }
    }

    for (const table of tables) await resetSequences(tx, table);
  });

  await auditDataAction(user, "database_backup_restored", { backupCreatedAt: backup.createdAt, tables: tables.length });
  return response.status(200).json({ ok: true, message: "تم استيراد النسخة الاحتياطية واستعادة قاعدة البيانات بنجاح.", tables: tables.length, createdAt: backup.createdAt });
}


async function ensureRestoreUploadTable() {
  const sql = getSql();
  await sql`
    create table if not exists core.data_restore_uploads(
      upload_id uuid not null,
      chunk_index integer not null,
      total_chunks integer not null,
      data bytea not null,
      created_by uuid references core.users(id) on delete cascade,
      created_at timestamptz not null default now(),
      primary key(upload_id,chunk_index)
    )
  `;
  await sql`delete from core.data_restore_uploads where created_at<now()-interval '2 hours'`;
}

async function receiveRestoreChunk(request: VercelRequest, response: VercelResponse, user: SessionUser) {
  await ensureRestoreUploadTable();
  const body = parseBody(request);
  const uploadId = clean(body.uploadId) || randomUUID();
  const index = Number(body.index);
  const total = Number(body.total);
  const data = clean(body.data);
  if (!/^[0-9a-f-]{36}$/i.test(uploadId) || !Number.isInteger(index) || index < 0 || !Number.isInteger(total) || total < 1 || total > 100 || index >= total || !data) {
    return response.status(400).json({ ok: false, error: "بيانات جزء النسخة الاحتياطية غير صحيحة" });
  }
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.length > 1200 * 1024) return response.status(413).json({ ok: false, error: "حجم الجزء غير مسموح" });
  const sql = getSql();
  await sql`
    insert into core.data_restore_uploads(upload_id,chunk_index,total_chunks,data,created_by)
    values(${uploadId}::uuid,${index},${total},${bytes},${user.id}::uuid)
    on conflict(upload_id,chunk_index) do update set data=excluded.data,total_chunks=excluded.total_chunks,created_by=excluded.created_by,created_at=now()
  `;
  return response.status(200).json({ ok: true, uploadId, received: index + 1, total });
}

async function commitRestoreUpload(request: VercelRequest, response: VercelResponse, user: SessionUser) {
  await ensureRestoreUploadTable();
  const uploadId = clean(parseBody(request).uploadId);
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) return response.status(400).json({ ok: false, error: "رقم رفع النسخة الاحتياطية غير صحيح" });
  const sql = getSql();
  const chunks = await sql<{ data: Buffer; total_chunks: number }[]>`
    select data,total_chunks from core.data_restore_uploads
    where upload_id=${uploadId}::uuid and created_by=${user.id}::uuid order by chunk_index
  `;
  const expected = Number(chunks[0]?.total_chunks || 0);
  if (!expected || chunks.length !== expected) return response.status(400).json({ ok: false, error: `لم تكتمل أجزاء النسخة الاحتياطية (${chunks.length}/${expected || "—"})` });
  const compressed = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.data)));
  try {
    return await restoreBackupBuffer(compressed, response, user);
  } finally {
    await sql`delete from core.data_restore_uploads where upload_id=${uploadId}::uuid and created_by=${user.id}::uuid`.catch(() => undefined);
  }
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireAdmin(request, response);
  if (!user) return;
  response.setHeader("Cache-Control", "no-store");
  const action = clean(request.query.action || parseBody(request).action);
  const department = clean(request.query.department || parseBody(request).department) as DepartmentKey;

  if (request.method === "GET" && action === "export_customers") {
    if (!(["cash", "finance", "service"] as string[]).includes(department)) return response.status(400).json({ ok: false, error: "القسم غير صحيح" });
    return exportCustomers(response, department);
  }
  if (request.method === "GET" && action === "backup") return createBackup(response, user);
  if (request.method === "POST" && action === "import_customers") {
    if (!(["cash", "finance", "service"] as string[]).includes(department)) return response.status(400).json({ ok: false, error: "القسم غير صحيح" });
    return importCustomers(request, response, user, department);
  }
  if (request.method === "POST" && action === "reset_test_data") return resetTestData(response, user, clean(parseBody(request).confirmation));
  if (request.method === "POST" && action === "restore_backup") return restoreBackupBuffer(backupBuffer(request), response, user);
  if (request.method === "POST" && action === "restore_chunk") return receiveRestoreChunk(request, response, user);
  if (request.method === "POST" && action === "restore_commit") return commitRestoreUpload(request, response, user);
  return response.status(405).json({ ok: false, error: "الإجراء غير مدعوم" });
}
