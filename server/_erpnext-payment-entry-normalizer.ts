import { clean, numberValue } from "./_tracking-utils.js";

type JsonRecord = Record<string, any>;

export class ErpNextPaymentEntryError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type ErpNextPaymentEntrySalesOrder = {
  orderNo: string;
  grandTotal: number;
  advancePaid: number;
  modified: string;
  allocatedAmount: number;
  totalAmount: number;
  outstandingAmount: number;
};

export type NormalizedErpNextPaymentEntry = {
  entryNo: string;
  erpEvent: string;
  isCancellation: boolean;
  postingDate: string;
  paymentType: string;
  partyType: string;
  party: string;
  paidAmount: number;
  receivedAmount: number;
  salesOrders: ErpNextPaymentEntrySalesOrder[];
  rawBody: JsonRecord;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeEvent(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function resolveDocument(body: JsonRecord) {
  return isRecord(body.doc) ? body.doc : body;
}

function arrayRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function referenceDoctype(reference: JsonRecord) {
  return clean(reference.reference_doctype || reference.referenceDoctype || reference.doctype);
}

function referenceName(reference: JsonRecord) {
  return clean(
    reference.reference_name
      || reference.referenceName
      || reference.sales_order_no
      || reference.salesOrderNo
      || reference.order_no
      || reference.orderNo
      || reference.name,
  );
}

export function isErpNextPaymentEntryEvent(input: unknown) {
  if (!isRecord(input)) return false;
  const body = input;
  const doc = resolveDocument(body);
  const event = normalizeEvent(body.event || body.eventType || doc.event || doc.event_type);
  const doctype = normalizeEvent(doc.doctype || body.doctype);
  return event.startsWith("paymententry") || doctype === "paymententry";
}

export function normalizeErpNextPaymentEntry(input: unknown): NormalizedErpNextPaymentEntry {
  if (!isRecord(input)) {
    throw new ErpNextPaymentEntryError(400, "بيانات Payment Entry يجب أن تكون JSON Object");
  }

  const body = input;
  const doc = resolveDocument(body);
  const erpEvent = clean(body.event || body.eventType || doc.event || doc.event_type || "payment_entry.submitted");
  const eventKey = normalizeEvent(erpEvent);
  if (!eventKey.startsWith("paymententry")) {
    throw new ErpNextPaymentEntryError(400, "نوع حدث Payment Entry غير صحيح");
  }

  const entryNo = clean(doc.name || body.name || doc.payment_entry || body.payment_entry);
  if (!entryNo) {
    throw new ErpNextPaymentEntryError(400, "رقم Payment Entry غير موجود في بيانات Webhook");
  }

  const rawReferences = [
    ...arrayRecords(body.sales_orders),
    ...arrayRecords(body.references),
    ...arrayRecords(doc.references),
  ];
  const salesOrdersByNumber = new Map<string, ErpNextPaymentEntrySalesOrder>();

  for (const reference of rawReferences) {
    const doctype = referenceDoctype(reference);
    if (doctype && doctype.toLowerCase() !== "sales order") continue;
    const orderNo = referenceName(reference);
    if (!orderNo) continue;

    salesOrdersByNumber.set(orderNo, {
      orderNo,
      grandTotal: numberValue(reference.grand_total ?? reference.grandTotal),
      advancePaid: numberValue(reference.advance_paid ?? reference.advancePaid),
      modified: clean(reference.modified || reference.sales_order_modified || reference.salesOrderModified),
      allocatedAmount: numberValue(reference.allocated_amount ?? reference.allocatedAmount),
      totalAmount: numberValue(reference.total_amount ?? reference.totalAmount),
      outstandingAmount: numberValue(reference.outstanding_amount ?? reference.outstandingAmount),
    });
  }

  return {
    entryNo,
    erpEvent,
    isCancellation: eventKey.includes("cancel") || Number(doc.docstatus) === 2,
    postingDate: clean(doc.posting_date || doc.postingDate),
    paymentType: clean(doc.payment_type || doc.paymentType),
    partyType: clean(doc.party_type || doc.partyType),
    party: clean(doc.party || doc.party_name || doc.partyName),
    paidAmount: numberValue(doc.paid_amount ?? doc.paidAmount),
    receivedAmount: numberValue(doc.received_amount ?? doc.receivedAmount),
    salesOrders: [...salesOrdersByNumber.values()],
    rawBody: body,
  };
}
