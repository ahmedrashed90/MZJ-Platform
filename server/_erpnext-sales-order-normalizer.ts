import { normalizePhone } from "./_phone-utils.js";
import { clean, numberValue } from "./_tracking-utils.js";

type JsonRecord = Record<string, any>;

export class ErpNextSalesOrderError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type ErpNextVehiclePayload = JsonRecord & {
  orderNo: string;
  customerName?: string;
  customerPhone?: string;
  customerVat?: string;
  branch?: string;
  orderDate?: string;
  deliveryDate?: string;
  salesPerson?: string;
  erpUserId?: string;
  erpStatus?: string;
  erpEvent?: string;
  erpCreatedAt?: string;
  sourceInstanceKey?: string;
  isCancellation?: boolean;
  accountingCustomerName?: string;
  actualCustomerName?: string;
  actualCustomerPhone?: string;
  sourceItemIdentity?: string;
  item?: JsonRecord;
  totals?: JsonRecord;
};

export type NormalizedErpNextSalesOrder = {
  orderNo: string;
  erpStatus: string;
  erpEvent: string;
  erpCreatedAt: string;
  sourceInstanceKey: string;
  isCancellation: boolean;
  erpSalesPerson: string;
  erpUserId: string;
  erpBranch: string;
  accountingCustomerName: string;
  actualCustomerName: string;
  actualCustomerPhone: string;
  actualCustomerPhoneNormalized: string;
  customerVat: string;
  orderDate: string;
  deliveryDate: string;
  payloads: ErpNextVehiclePayload[];
  registrationFeeRows: number;
  warnings: Array<{ itemNo?: string; missing?: string[]; receivedFields?: string[]; code?: string; message?: string }>;
  rawBody: JsonRecord;
};


function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g, "").replace(/^custom/, "");
}

function fieldMap(source: JsonRecord) {
  const map = new Map<string, unknown>();
  for (const [key, value] of Object.entries(source)) {
    map.set(normalizeKey(key), value);
  }
  return map;
}

function hasUsefulValue(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return false;
    return !["none", "null", "undefined", "nan"].includes(text.toLowerCase());
  }
  return true;
}

function pick(source: JsonRecord, aliases: string[]) {
  const map = fieldMap(source);
  for (const alias of aliases) {
    const direct = source[alias];
    if (hasUsefulValue(direct)) return direct;
    const normalized = map.get(normalizeKey(alias));
    if (hasUsefulValue(normalized)) return normalized;
  }
  return undefined;
}

function pickText(source: JsonRecord, aliases: string[]) {
  return clean(pick(source, aliases));
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const raw = value.trim();
  if (!raw || !["[", "{"].includes(raw[0])) return value;
  try {
    return JSON.parse(raw);
  } catch {
    return value;
  }
}

function asArray(value: unknown): JsonRecord[] {
  const parsed = parseMaybeJson(value);
  if (Array.isArray(parsed)) return parsed.filter(isRecord);
  if (isRecord(parsed)) return [parsed];
  return [];
}

function firstRecord(...values: unknown[]) {
  for (const value of values) {
    const parsed = parseMaybeJson(value);
    if (isRecord(parsed)) return parsed;
  }
  return {} as JsonRecord;
}

function percentRate(value: unknown): number {
  const parsed = parseMaybeJson(value);
  if (isRecord(parsed)) {
    for (const nestedValue of Object.values(parsed)) {
      const nestedRate = percentRate(nestedValue);
      if (nestedRate > 0) return nestedRate;
    }
    return 0;
  }
  if (Array.isArray(parsed)) {
    for (const nestedValue of parsed) {
      const nestedRate = percentRate(nestedValue);
      if (nestedRate > 0) return nestedRate;
    }
    return 0;
  }
  const rate = numberValue(parsed);
  if (rate > 0 && rate <= 1) return rate * 100;
  return rate;
}

function includesRegistrationFee(value: unknown) {
  const text = clean(value).toLowerCase();
  return text.includes("رسوم التسجيل")
    || text.includes("رسم التسجيل")
    || text.includes("registration fee")
    || text.includes("registration fees")
    || text.includes("vehicle registration");
}

function isRegistrationFeeItem(item: JsonRecord) {
  const explicit = pick(item, ["is_registration_fee", "registration_fee_item"]);
  if (explicit === true || clean(explicit).toLowerCase() === "true" || clean(explicit) === "1") return true;
  return [
    pick(item, ["item_code", "code"]),
    pick(item, ["item_name", "name"]),
    pick(item, ["item_type", "type"]),
    pick(item, ["description"]),
  ].some(includesRegistrationFee);
}

function itemAmount(item: JsonRecord) {
  const qty = numberValue(pick(item, ["qty", "quantity", "stock_qty"])) || 1;
  const amount = numberValue(pick(item, ["net_amount", "amount", "base_net_amount", "base_amount", "item_value", "value"]));
  if (amount) return amount;
  return qty * numberValue(pick(item, ["net_rate", "rate", "base_net_rate", "base_rate", "price_list_rate", "unit_price"]));
}

function directTaxAmount(item: JsonRecord) {
  return numberValue(pick(item, ["tax_amount", "item_tax_amount", "tax_value", "vat_value", "custom_tax_value"]));
}

function resolveDocument(body: JsonRecord) {
  return firstRecord(body.doc, body.document, body.salesOrder, body.sales_order, body.data, body);
}

function resolveTaxMetadata(doc: JsonRecord, body: JsonRecord) {
  const taxes = asArray(pick(doc, ["taxes", "sales_taxes_and_charges"]) || pick(body, ["taxes"]));
  const preferred = taxes.find((row) => {
    const text = [pickText(row, ["description"]), pickText(row, ["account_head"]), pickText(row, ["charge_type"])].join(" ");
    return text.includes("ضريبة") || text.toLowerCase().includes("vat");
  }) || taxes.find((row) => percentRate(pick(row, ["rate", "tax_rate"])) > 0) || {};

  let rate = percentRate(pick(preferred, ["rate", "tax_rate"]));
  if (!rate) rate = percentRate(pick(doc, ["tax_rate", "vat_rate", "item_tax_rate"]));
  if (!rate) {
    const netTotal = numberValue(pick(doc, ["net_total", "base_net_total", "subtotal_excl_vat"]));
    const totalTax = numberValue(pick(doc, ["total_taxes_and_charges", "base_total_taxes_and_charges", "tax_value"]));
    if (netTotal > 0 && totalTax > 0) rate = (totalTax / netTotal) * 100;
  }

  return {
    rate: rate || 15,
    code: pickText(preferred, ["tax_code", "account_head", "name"]),
    name: pickText(preferred, ["tax_name", "description", "account_head"]) || "ضريبة القيمة المضافة",
  };
}

function resolveSalesPerson(doc: JsonRecord, body: JsonRecord) {
  const direct = pickText(doc, ["sales_person", "sales_person_name", "custom_sales_person", "salesperson"])
    || pickText(body, ["SalesPerson", "salesPerson"]);
  if (direct) return direct;
  const salesTeam = asArray(pick(doc, ["sales_team", "salesTeam"]));
  return salesTeam.map((row) => pickText(row, ["sales_person", "sales_person_name", "employee_name"])).find(Boolean) || "";
}

function resolveErpUserId(doc: JsonRecord, _body: JsonRecord, _items: JsonRecord[]) {
  const salesTeam = asArray(pick(doc, ["sales_team", "salesTeam"]));
  const candidates = salesTeam
    .map((row, index) => ({
      index,
      erpUserId: pickText(row, ["sales_person", "sales_person_name", "employee_name"]),
      contribution: numberValue(pick(row, [
        "allocated_percentage", "contribution_percentage", "contribution", "percentage",
      ])),
    }))
    .filter((candidate) => Boolean(candidate.erpUserId));

  candidates.sort((left, right) => (right.contribution - left.contribution) || (left.index - right.index));
  return candidates[0]?.erpUserId || "";
}

function resolveAlternateCustomer(doc: JsonRecord, body: JsonRecord) {
  const name = pickText(doc, [
    "user_name", "username", "custom_user_name", "custom_username", "actual_customer_name",
    "custom_actual_customer_name", "beneficiary_name", "اسم المستخدم",
  ]) || pickText(body, ["UserName", "userName", "ActualCustomerName", "actualCustomerName", "اسم المستخدم"]);
  const phone = pickText(doc, [
    "user_phone", "user_mobile", "custom_user_phone", "custom_user_mobile", "custom_mobile_number",
    "actual_customer_phone", "custom_actual_customer_phone", "beneficiary_phone", "رقم الجوال",
  ]) || pickText(body, ["UserPhone", "userPhone", "ActualCustomerPhone", "actualCustomerPhone", "رقم الجوال"]);
  return { name, phone };
}

function resolveItems(doc: JsonRecord, body: JsonRecord) {
  const candidates = [
    pick(doc, ["items", "vehicles", "order_items"]),
    pick(body, ["items", "vehicles", "order_items"]),
    pick(body, ["item"]),
  ];
  for (const candidate of candidates) {
    const rows = asArray(candidate);
    if (rows.length) return rows;
  }

  const hasFlatItem = Boolean(pick(doc, [
    "VIN", "vin", "ItemNo", "item_no", "item_code", "ItemType", "item_type", "ItemCategory", "item_category",
  ]));
  return hasFlatItem ? [doc] : [];
}

function normalizedInstanceTimestamp(value: unknown) {
  const text = clean(value);
  if (!text) return "legacy";
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text.replace(/\s+/g, "_") : parsed.toISOString();
}

function cancellationEvent(event: unknown, status: unknown, docstatus: unknown) {
  const eventText = clean(event).toLowerCase().replace(/[\s._-]+/g, "");
  const statusText = clean(status).toLowerCase().replace(/[\s._-]+/g, "");
  return eventText.includes("cancel") || statusText === "cancelled" || statusText === "canceled" || Number(docstatus) === 2;
}

export function normalizeErpNextSalesOrder(input: unknown): NormalizedErpNextSalesOrder {
  if (!isRecord(input)) throw new ErpNextSalesOrderError(400, "بيانات ERPNext يجب أن تكون JSON Object");
  const body = input;
  const doc = resolveDocument(body);
  const orderNo = pickText(doc, ["orderNo", "OrderNo", "salesOrderNo", "sales_order_no", "order_no", "name"])
    || pickText(body, ["orderNo", "OrderNo", "salesOrderNo", "sales_order_no"]);
  if (!orderNo) {
    throw new ErpNextSalesOrderError(400, `رقم طلب البيع غير موجود. الحقول المستلمة: ${Object.keys(doc).join(", ") || "لا توجد حقول"}`);
  }

  const rawItems = resolveItems(doc, body);
  if (!rawItems.length) {
    throw new ErpNextSalesOrderError(400, `لم يتم العثور على جدول Items في طلب ${orderNo}`);
  }

  const feeItems = rawItems.filter(isRegistrationFeeItem);
  const vehicleItems = rawItems.filter((item) => !isRegistrationFeeItem(item));
  if (!vehicleItems.length) {
    throw new ErpNextSalesOrderError(400, `لم يتم العثور على صف سيارة داخل طلب ${orderNo}`);
  }

  const taxMeta = resolveTaxMetadata(doc, body);
  const directRegistrationFee = numberValue(pick(doc, ["registration_fee", "custom_registration_fee", "RegistrationFee"]));
  const registrationFee = directRegistrationFee || feeItems.reduce((sum, item) => sum + itemAmount(item), 0);

  const accountingCustomerName = pickText(doc, ["customer_name", "customer", "party_name", "CustomerName"])
    || pickText(body, ["CustomerName", "customerName"]);
  const customerVat = pickText(doc, ["tax_id", "customer_vat", "vat_number", "tax_number", "CustomerVAT"])
    || pickText(body, ["CustomerVAT", "customerVat"]);
  const accountingCustomerPhone = pickText(doc, [
    "contact_mobile", "customer_phone", "customer_mobile", "mobile_no", "mobile", "phone", "mobile_number", "CustomerPhone",
  ]) || pickText(body, ["CustomerPhone", "customerPhone", "customerMobile"]);
  const alternateCustomer = resolveAlternateCustomer(doc, body);
  const actualCustomerName = alternateCustomer.name || accountingCustomerName;
  const actualCustomerPhone = alternateCustomer.name ? alternateCustomer.phone : (accountingCustomerPhone || alternateCustomer.phone);
  const actualCustomerPhoneNormalized = normalizePhone(actualCustomerPhone);
  const branch = pickText(doc, ["branch", "branch_name", "custom_branch", "Branch"])
    || pickText(body, ["Branch", "branch"]);
  const orderDate = pickText(doc, ["transaction_date", "order_date", "posting_date", "OrderDate"])
    || pickText(body, ["OrderDate", "orderDate"]);
  const deliveryDate = pickText(doc, ["delivery_date", "expected_delivery_date", "DeliveryDate"])
    || pickText(body, ["DeliveryDate", "deliveryDate"]);
  const erpUserId = resolveErpUserId(doc, body, vehicleItems);
  const salesPerson = resolveSalesPerson(doc, body) || erpUserId;
  const erpStatus = pickText(doc, ["status", "order_status", "workflow_state"]) || pickText(body, ["status", "orderStatus"]);
  const erpEvent = pickText(body, ["event", "eventType"]) || "sales_order.submitted";
  const createdAt = pickText(doc, ["creation", "created_at", "createdAt", "Timestamp"])
    || pickText(body, ["Timestamp", "createdAt"]);
  const erpCreatedAt = normalizedInstanceTimestamp(createdAt);
  const sourceInstanceKey = `next-erp:sales-order:${orderNo}:created:${erpCreatedAt}`;
  const isCancellation = cancellationEvent(erpEvent, erpStatus, pick(doc, ["docstatus"]));

  const totalVehicleSubtotal = vehicleItems.reduce((sum, item) => sum + itemAmount(item), 0);
  const explicitGrandTotal = numberValue(pick(doc, ["grand_total", "rounded_total", "base_grand_total", "GrandTotal"]));
  const payloads: NormalizedErpNextSalesOrder["payloads"] = [];
  const warnings: NormalizedErpNextSalesOrder["warnings"] = [];

  vehicleItems.forEach((rawItem, index) => {
    const itemNo = pickText(rawItem, ["item_no", "ItemNo", "idx", "row_no", "no", "name", "item_code"]) || String(index + 1);
    const itemType = pickText(rawItem, ["item_type", "ItemType", "vehicle_type", "type", "item_name", "item_code"]);
    const itemCategory = pickText(rawItem, [
      "item_category", "ItemCategory", "vehicle_category", "category", "class", "vehicle_class", "item_group",
    ]);
    const itemModel = pickText(rawItem, ["item_model", "ItemModel", "vehicle_model", "model", "model_year", "year"]);
    const vin = pickText(rawItem, [
      "vin", "VIN", "vehicle_identification_number", "serial_no", "serial_number", "chassis_no", "chassis_number", "vehicle_vin",
    ]);
    const interiorColor = pickText(rawItem, [
      "interior_color", "InteriorColor", "internal_color", "custom_internal_color", "inside_color", "int_color", "vehicle_interior_color",
    ]);
    const exteriorColor = pickText(rawItem, [
      "exterior_color", "ExteriorColor", "external_color", "custom_external_color", "outside_color", "ext_color", "color", "vehicle_exterior_color",
    ]);
    const dealer = pickText(rawItem, ["dealer", "Dealer", "dealer_name", "agent", "agent_name", "supplier", "supplier_name"]);
    const qty = numberValue(pick(rawItem, ["qty", "Qty", "quantity", "stock_qty"])) || 1;
    const unitPrice = numberValue(pick(rawItem, ["unit_price", "UnitPrice", "net_rate", "rate", "base_net_rate", "base_rate", "price_list_rate"]));
    const itemValue = numberValue(pick(rawItem, ["item_value", "ItemValue", "net_amount", "amount", "base_net_amount", "base_amount", "value"])) || (qty * unitPrice);
    const subtotal = itemValue || (qty * unitPrice);
    const itemRate = percentRate(pick(rawItem, ["tax_rate", "TaxRate", "item_tax_rate", "vat_rate"])) || taxMeta.rate;
    const explicitTax = directTaxAmount(rawItem);
    const taxValue = explicitTax || Number((subtotal * itemRate / 100).toFixed(2));
    const totalInclVat = numberValue(pick(rawItem, ["total_incl_vat", "TotalInclVAT", "gross_amount", "total_with_tax"]))
      || Number((subtotal + taxValue).toFixed(2));
    const feeForThisRow = index === 0 ? Number(registrationFee.toFixed(2)) : 0;
    const identityPart = vin || itemNo || String(index + 1);

    const missing = [
      ["VIN", vin],
      ["ItemType", itemType],
      ["ItemCategory", itemCategory],
      ["ItemModel", itemModel],
      ["InteriorColor", interiorColor],
      ["ExteriorColor", exteriorColor],
      ["Dealer", dealer],
    ].filter(([, value]) => !value).map(([label]) => label);
    if (missing.length) {
      warnings.push({ itemNo, missing, receivedFields: Object.keys(rawItem).sort() });
    }

    payloads.push({
      orderNo,
      branch,
      customerName: actualCustomerName,
      customerVat,
      customerPhone: actualCustomerPhone,
      accountingCustomerName,
      actualCustomerName,
      actualCustomerPhone,
      erpUserId,
      erpStatus,
      erpEvent,
      erpCreatedAt,
      sourceInstanceKey,
      isCancellation,
      orderDate,
      deliveryDate,
      salesPerson,
      item: {
        no: itemNo,
        type: itemType,
        category: itemCategory,
        model: itemModel,
        vin,
        interiorColor,
        exteriorColor,
        dealer,
        qty,
        unitPrice,
        value: itemValue,
      },
      totals: {
        carSubtotalExclVAT: subtotal,
        carTaxValue: taxValue,
        carTotalInclVAT: totalInclVat,
        registrationFee: feeForThisRow,
        subtotalBeforeTax: Number((totalVehicleSubtotal + registrationFee).toFixed(2)),
        grandTotal: explicitGrandTotal || Number((totalVehicleSubtotal + registrationFee + vehicleItems.reduce((sum, current) => {
          const currentSubtotal = itemAmount(current);
          const currentRate = percentRate(pick(current, ["tax_rate", "TaxRate", "item_tax_rate", "vat_rate"])) || taxMeta.rate;
          return sum + (directTaxAmount(current) || currentSubtotal * currentRate / 100);
        }, 0)).toFixed(2)),
        taxCode: taxMeta.code,
        taxName: taxMeta.name,
        taxRate: itemRate,
      },
      createdAt,
      originalCreatedAt: createdAt,
      integrationSource: "erpnext-webhook",
      sourceOriginalId: sourceInstanceKey,
      sourceIdentity: sourceInstanceKey,
      sourceItemIdentity: `${sourceInstanceKey}:item:${identityPart}`,
      sourceDocument: {
        event: erpEvent,
        name: orderNo,
        modified: pickText(doc, ["modified", "updated_at"]),
        status: erpStatus,
        docstatus: pick(doc, ["docstatus"]),
      },
      rawItem,
    });
  });

  if (!actualCustomerName) warnings.push({ code: "CUSTOMER_NAME_MISSING", message: "اسم العميل الحقيقي غير موجود في طلب البيع" });
  if (!actualCustomerPhoneNormalized) warnings.push({ code: "CUSTOMER_PHONE_MISSING", message: "رقم جوال العميل الحقيقي غير موجود أو غير صالح" });
  if (!erpUserId) warnings.push({ code: "ERP_USER_ID_MISSING", message: "إيميل مستخدم NEXT ERP غير موجود في طلب البيع" });

  return {
    orderNo,
    erpStatus,
    erpEvent,
    erpCreatedAt,
    sourceInstanceKey,
    isCancellation,
    erpSalesPerson: salesPerson,
    erpUserId,
    erpBranch: branch,
    accountingCustomerName,
    actualCustomerName,
    actualCustomerPhone,
    actualCustomerPhoneNormalized,
    customerVat,
    orderDate,
    deliveryDate,
    payloads,
    registrationFeeRows: feeItems.length,
    warnings,
    rawBody: body,
  };
}

