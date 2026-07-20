import type { VercelRequest, VercelResponse } from "@vercel/node";
import { safeSecretEquals } from "../_auth.js";
import { clean, numberValue } from "../_tracking-utils.js";
import { ingestTrackingOrder, TrackingIngestError } from "./tracking-orders.js";

type JsonRecord = Record<string, any>;

type NormalizedSalesOrder = {
  orderNo: string;
  payloads: JsonRecord[];
  registrationFeeRows: number;
  warnings: Array<{ itemNo: string; missing: string[]; receivedFields: string[] }>;
};

function requestBody(request: VercelRequest) {
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  return request.body || {};
}

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
  if (typeof value === "string") return value.trim() !== "";
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

export function normalizeErpNextSalesOrder(input: unknown): NormalizedSalesOrder {
  if (!isRecord(input)) throw new TrackingIngestError(400, "بيانات ERPNext يجب أن تكون JSON Object");
  const body = input;
  const doc = resolveDocument(body);
  const orderNo = pickText(doc, ["orderNo", "OrderNo", "salesOrderNo", "sales_order_no", "order_no", "name"])
    || pickText(body, ["orderNo", "OrderNo", "salesOrderNo", "sales_order_no"]);
  if (!orderNo) {
    throw new TrackingIngestError(400, `رقم طلب البيع غير موجود. الحقول المستلمة: ${Object.keys(doc).join(", ") || "لا توجد حقول"}`);
  }

  const rawItems = resolveItems(doc, body);
  if (!rawItems.length) {
    throw new TrackingIngestError(400, `لم يتم العثور على جدول Items في طلب ${orderNo}`);
  }

  const feeItems = rawItems.filter(isRegistrationFeeItem);
  const vehicleItems = rawItems.filter((item) => !isRegistrationFeeItem(item));
  if (!vehicleItems.length) {
    throw new TrackingIngestError(400, `لم يتم العثور على صف سيارة داخل طلب ${orderNo}`);
  }

  const taxMeta = resolveTaxMetadata(doc, body);
  const directRegistrationFee = numberValue(pick(doc, ["registration_fee", "custom_registration_fee", "RegistrationFee"]));
  const registrationFee = directRegistrationFee || feeItems.reduce((sum, item) => sum + itemAmount(item), 0);

  const customerName = pickText(doc, ["customer_name", "customer", "party_name", "CustomerName", "user_name", "username"])
    || pickText(body, ["CustomerName", "customerName"]);
  const customerVat = pickText(doc, ["tax_id", "customer_vat", "vat_number", "tax_number", "CustomerVAT"])
    || pickText(body, ["CustomerVAT", "customerVat"]);
  const customerPhone = pickText(doc, ["contact_mobile", "customer_phone", "mobile_no", "mobile", "phone", "mobile_number", "CustomerPhone"])
    || pickText(body, ["CustomerPhone", "customerPhone"]);
  const branch = pickText(doc, ["branch", "branch_name", "custom_branch", "Branch"])
    || pickText(body, ["Branch", "branch"]);
  const orderDate = pickText(doc, ["transaction_date", "order_date", "posting_date", "OrderDate"])
    || pickText(body, ["OrderDate", "orderDate"]);
  const deliveryDate = pickText(doc, ["delivery_date", "expected_delivery_date", "DeliveryDate"])
    || pickText(body, ["DeliveryDate", "deliveryDate"]);
  const salesPerson = resolveSalesPerson(doc, body);
  const createdAt = pickText(doc, ["creation", "created_at", "createdAt", "Timestamp"])
    || pickText(body, ["Timestamp", "createdAt"]);

  const totalVehicleSubtotal = vehicleItems.reduce((sum, item) => sum + itemAmount(item), 0);
  const explicitGrandTotal = numberValue(pick(doc, ["grand_total", "rounded_total", "base_grand_total", "GrandTotal"]));
  const payloads: JsonRecord[] = [];
  const warnings: NormalizedSalesOrder["warnings"] = [];

  vehicleItems.forEach((rawItem, index) => {
    const itemNo = pickText(rawItem, ["item_no", "ItemNo", "idx", "row_no", "no", "name", "item_code"]) || String(index + 1);
    const itemType = pickText(rawItem, ["item_type", "ItemType", "vehicle_type", "type", "item_name", "item_code"]);
    const itemCategory = pickText(rawItem, ["item_category", "ItemCategory", "vehicle_category", "category", "item_group"]);
    const itemModel = pickText(rawItem, ["item_model", "ItemModel", "vehicle_model", "model", "model_year", "year"]);
    const vin = pickText(rawItem, [
      "vin", "VIN", "vehicle_identification_number", "serial_no", "serial_number", "chassis_no", "chassis_number", "vehicle_vin",
    ]);
    const interiorColor = pickText(rawItem, ["interior_color", "InteriorColor", "inside_color", "int_color", "vehicle_interior_color"]);
    const exteriorColor = pickText(rawItem, ["exterior_color", "ExteriorColor", "outside_color", "ext_color", "color", "vehicle_exterior_color"]);
    const dealer = pickText(rawItem, ["dealer", "Dealer", "dealer_name", "supplier", "supplier_name"]);
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
      customerName,
      customerVat,
      customerPhone,
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
      sourceOriginalId: orderNo,
      sourceIdentity: `next-erp:sales-order:${orderNo}`,
      sourceItemIdentity: `next-erp:sales-order:${orderNo}:item:${identityPart}`,
      sourceDocument: {
        event: pickText(body, ["event", "eventType"]),
        name: orderNo,
        modified: pickText(doc, ["modified", "updated_at"]),
        status: pickText(doc, ["status"]),
        docstatus: pick(doc, ["docstatus"]),
      },
      rawItem,
    });
  });

  return { orderNo, payloads, registrationFeeRows: feeItems.length, warnings };
}

function requestKey(request: VercelRequest) {
  return clean(
    request.headers["x-mzj-erpnext-key"]
      || request.headers["x-mzj-tracking-key"]
      || request.query.key,
  );
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });

  const configuredKey = clean(process.env.ERPNEXT_WEBHOOK_KEY || process.env.TRACKING_INGEST_KEY);
  if (!configuredKey) {
    return response.status(503).json({ ok: false, error: "يجب ضبط ERPNEXT_WEBHOOK_KEY في Vercel قبل تفعيل الربط" });
  }
  if (!safeSecretEquals(requestKey(request), configuredKey)) {
    return response.status(401).json({ ok: false, error: "مفتاح ERPNext Webhook غير صحيح" });
  }

  let body: unknown;
  try {
    body = requestBody(request);
  } catch {
    return response.status(400).json({ ok: false, error: "صيغة JSON القادمة من ERPNext غير صحيحة" });
  }

  try {
    const normalized = normalizeErpNextSalesOrder(body);
    const results = [];
    for (const payload of normalized.payloads) {
      results.push(await ingestTrackingOrder(payload));
    }

    return response.status(200).json({
      ok: true,
      message: `تم استلام طلب ${normalized.orderNo} من ERPNext وإدخال ${results.length} سيارة إلى التراكينج`,
      orderNo: normalized.orderNo,
      importedVehicles: results.length,
      registrationFeeRowsIgnoredAsVehicles: normalized.registrationFeeRows,
      orderId: results.find((result) => result.orderId)?.orderId || null,
      vehicleIds: results.map((result) => result.vehicleId).filter(Boolean),
      warnings: normalized.warnings,
      results,
    });
  } catch (error) {
    if (error instanceof TrackingIngestError) {
      return response.status(error.status).json({ ok: false, error: error.message });
    }
    console.error("ERPNext sales order webhook failed", { error });
    return response.status(500).json({ ok: false, error: "تعذر إدخال طلب ERPNext إلى التراكينج" });
  }
}
