import { getSql } from "./_db.js";

export type CustomerFieldOption = { value: string; label: string };

export type CustomerFieldDefinition = {
  id: string;
  field_key: string;
  label: string;
  field_type: string;
  sort_order: number;
  department_keys: string[];
  is_active: boolean;
  is_required: boolean;
  include_in_completion: boolean;
  options: CustomerFieldOption[];
  is_system: boolean;
  is_locked: boolean;
};

const FALLBACK_COMPLETION_KEYS = [
  "customer_name",
  "phone",
  "source_code",
  "status_label",
  "department_code",
  "age",
  "salary",
  "obligation",
  "salary_bank",
  "location",
  "car_type",
  "car_category",
  "car_model",
  "color",
];

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function filled(value: unknown) {
  const text = clean(value);
  return Boolean(text && text !== "-" && text !== "0" && text.toLowerCase() !== "null" && text.toLowerCase() !== "undefined");
}

export function customerDepartmentKey(lead: Record<string, any>) {
  const raw = clean(lead.serviceKey ?? lead.service_key ?? lead.departmentCode ?? lead.department_code).toLowerCase();
  if (raw.includes("finance") || raw.includes("تمويل") || raw.includes("call_center") || raw.includes("كول")) return "finance";
  if (raw.includes("service") || raw.includes("خدم")) return "service";
  return "cash";
}

export function normalizeCustomerFieldOptions(value: unknown): CustomerFieldOption[] {
  if (!Array.isArray(value)) return [];
  const rows: CustomerFieldOption[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const valueText = typeof item === "string"
      ? clean(item)
      : item && typeof item === "object"
        ? clean((item as any).value ?? (item as any).key ?? (item as any).label)
        : "";
    if (!valueText || seen.has(valueText)) continue;
    const labelText = typeof item === "string"
      ? valueText
      : clean((item as any).label ?? (item as any).name ?? valueText) || valueText;
    rows.push({ value: valueText, label: labelText });
    seen.add(valueText);
  }
  return rows;
}

export async function getCustomerFieldDefinitions(includeInactive = false): Promise<CustomerFieldDefinition[]> {
  const sql = getSql();
  const rows = await sql<any[]>`
    select id::text,field_key,label,field_type,sort_order,department_keys,is_active,is_required,
      include_in_completion,options,is_system,is_locked
    from crm.customer_field_definitions
    where (${includeInactive}::boolean or is_active=true)
    order by sort_order,label
  `;
  return rows.map((row) => ({
    ...row,
    sort_order: Number(row.sort_order || 0),
    department_keys: Array.isArray(row.department_keys) ? row.department_keys : [],
    options: normalizeCustomerFieldOptions(row.options),
  }));
}

export function customerFieldValue(lead: Record<string, any>, fieldKey: string) {
  const extraData = lead.extraData ?? lead.extra_data ?? {};
  const keyMap: Record<string, unknown> = {
    customer_name: lead.customerName ?? lead.customer_name,
    phone: lead.phone ?? lead.phone_normalized,
    source_code: lead.sourceCode ?? lead.source_code ?? lead.sourceName ?? lead.source_name,
    status_label: lead.statusLabel ?? lead.status_label,
    department_code: lead.serviceKey ?? lead.service_key ?? lead.departmentCode ?? lead.department_code,
    follow_up_at: lead.followUpAt ?? lead.follow_up_at,
    age: lead.age,
    salary: lead.salary,
    obligation: lead.obligation,
    salary_bank: lead.salaryBank ?? lead.salary_bank,
    location: lead.location,
    car_type: lead.carType ?? lead.car_type ?? lead.carName ?? lead.car_name,
    car_category: lead.carCategory ?? lead.car_category,
    car_model: lead.carModel ?? lead.car_model,
    color: lead.color,
    finance_type: lead.financeType ?? lead.finance_type,
    notes: lead.notes,
  };
  if (Object.prototype.hasOwnProperty.call(keyMap, fieldKey)) return keyMap[fieldKey];
  if (extraData && typeof extraData === "object") return (extraData as Record<string, unknown>)[fieldKey];
  return undefined;
}

export function calculateLeadCompletion(lead: Record<string, any>, definitions?: CustomerFieldDefinition[]) {
  const department = customerDepartmentKey(lead);
  const configured = (definitions || []).filter((field) => {
    if (!field.is_active || !field.include_in_completion) return false;
    return !field.department_keys.length || field.department_keys.includes(department);
  });
  const keys = configured.length ? configured.map((field) => field.field_key) : FALLBACK_COMPLETION_KEYS;
  const completed = keys.filter((fieldKey) => filled(customerFieldValue(lead, fieldKey))).length;
  return Math.max(0, Math.min(100, Math.round((completed / Math.max(1, keys.length)) * 100)));
}

export function missingRequiredCustomerFields(lead: Record<string, any>, definitions: CustomerFieldDefinition[]) {
  const department = customerDepartmentKey(lead);
  return definitions.filter((field) => {
    if (!field.is_active || !field.is_required || field.field_key === "department_transfer") return false;
    if (field.department_keys.length && !field.department_keys.includes(department)) return false;
    return !filled(customerFieldValue(lead, field.field_key));
  });
}

export function sanitizeCustomFieldValues(value: unknown, definitions: CustomerFieldDefinition[]) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const allowed = new Set(definitions.filter((field) => !field.is_system).map((field) => field.field_key));
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(source)) {
    if (!allowed.has(key)) continue;
    if (raw == null) result[key] = null;
    else if (typeof raw === "number" || typeof raw === "boolean") result[key] = raw;
    else result[key] = clean(raw);
  }
  return result;
}
