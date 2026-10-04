import { clean } from "./_crm-utils.js";

export type OwnerSalesInvoice = {
  name: string;
  postingDate: string | null;
  grandTotal: number;
  status: string;
};

class NextErpInvoiceError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function nextErpConfig() {
  const baseUrl = clean(
    process.env.NEXT_ERP_URL
      || process.env.ERPNEXT_URL
      || process.env.NEXT_ERP_BASE_URL
      || "https://mzj2.newworldinfosys.com",
  ).replace(/\/+$/, "");
  const apiKey = clean(process.env.NEXT_API_KEY || process.env.ERPNEXT_API_KEY);
  const apiSecret = clean(process.env.NEXT_API_SECRET || process.env.ERPNEXT_API_SECRET);
  if (!baseUrl || !apiKey || !apiSecret) {
    throw new NextErpInvoiceError(503, "ربط فواتير NEXT ERP غير مكتمل في إعدادات المنصة");
  }
  return { baseUrl, apiKey, apiSecret };
}

async function nextErpFetch(path: string, init: RequestInit = {}) {
  const config = nextErpConfig();
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `token ${config.apiKey}:${config.apiSecret}`,
      ...(init.headers || {}),
    },
    redirect: "follow",
  });
  return response;
}

async function readJson(response: Response) {
  const text = await response.text();
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const serverMessage = clean(
      payload?.exception
      || payload?._server_messages
      || payload?.message
      || payload?.exc_type
      || text,
    ).slice(0, 500);
    throw new NextErpInvoiceError(response.status, serverMessage || `NEXT ERP HTTP ${response.status}`);
  }
  return payload;
}

function linkedInvoiceNames(payload: any): string[] {
  const message = payload?.message && typeof payload.message === "object" ? payload.message : {};
  const bucket = message?.["Sales Invoice"];
  const docs = Array.isArray(bucket?.docs)
    ? bucket.docs
    : Array.isArray(bucket)
      ? bucket
      : [];

  const names = docs
    .map((doc: any) => clean(typeof doc === "string" ? doc : doc?.name))
    .filter((name: string): name is string => Boolean(name));

  return [...new Set<string>(names)];
}

/**
 * Resolve the same Sales Invoice links shown by Frappe's Connections tab.
 *
 * Important: do not call /api/resource/Sales Invoice Item directly. Child-table
 * DocTypes can raise frappe.exceptions.PermissionError through the generic REST
 * resource API even when the token user is allowed to read Sales Invoice. The
 * official linked_with endpoint resolves child-table references server-side and
 * then applies permissions to the parent documents, which matches the ERP UI.
 */
async function invoiceNamesFromSalesOrderConnections(salesOrder: string): Promise<string[]> {
  const params = new URLSearchParams({
    doctype: "Sales Order",
    docname: salesOrder,
  });
  const path = `/api/method/frappe.desk.form.linked_with.get?${params.toString()}`;
  const payload = await readJson(await nextErpFetch(path));
  return linkedInvoiceNames(payload);
}

async function getSalesInvoice(name: string) {
  const payload = await readJson(
    await nextErpFetch(`/api/resource/${encodeURIComponent("Sales Invoice")}/${encodeURIComponent(name)}`),
  );
  return payload?.data || null;
}

export async function listNextErpSalesInvoices(salesOrderValue: unknown): Promise<OwnerSalesInvoice[]> {
  const salesOrder = clean(salesOrderValue);
  if (!salesOrder) return [];

  const names = await invoiceNamesFromSalesOrderConnections(salesOrder);
  const invoices: OwnerSalesInvoice[] = [];

  for (const name of names.slice(0, 20)) {
    try {
      const doc = await getSalesInvoice(name);
      if (!doc || Number(doc.docstatus || 0) !== 1) continue;
      if (clean(doc.status).toLowerCase() === "cancelled") continue;

      // Defense in depth: the Connections endpoint already found the relation,
      // but when item rows are present in the parent document, verify that this
      // invoice still references the requested Sales Order before exposing it.
      const items: any[] = Array.isArray(doc.items) ? doc.items : [];
      if (items.length && !items.some((item: any) => clean(item?.sales_order) === salesOrder)) continue;

      invoices.push({
        name: clean(doc.name || name),
        postingDate: clean(doc.posting_date) || null,
        grandTotal: Number(doc.grand_total || 0),
        status: clean(doc.status) || "Submitted",
      });
    } catch (error) {
      if (error instanceof NextErpInvoiceError && error.status === 404) continue;
      throw error;
    }
  }

  invoices.sort(
    (left, right) =>
      String(right.postingDate || "").localeCompare(String(left.postingDate || ""))
      || right.name.localeCompare(left.name),
  );
  return invoices;
}

export async function downloadNextErpSalesInvoicePdf(invoiceValue: unknown) {
  const invoice = clean(invoiceValue);
  if (!invoice) throw new NextErpInvoiceError(400, "رقم الفاتورة غير محدد");
  const format = clean(
    process.env.NEXT_ERP_SALES_INVOICE_PRINT_FORMAT
      || process.env.ERPNEXT_SALES_INVOICE_PRINT_FORMAT
      || "Standard",
  );
  const params = new URLSearchParams({
    doctype: "Sales Invoice",
    name: invoice,
    format,
    no_letterhead: "0",
  });
  const response = await nextErpFetch(`/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`, {
    headers: { Accept: "application/pdf,*/*" },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new NextErpInvoiceError(
      response.status,
      clean(text).slice(0, 500) || "تعذر تحميل PDF الفاتورة من NEXT ERP",
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new NextErpInvoiceError(502, "NEXT ERP أعاد ملف فاتورة فارغ");
  const signature = new TextDecoder().decode(bytes.slice(0, 5));
  if (signature !== "%PDF-") {
    throw new NextErpInvoiceError(502, "NEXT ERP لم يعد ملف PDF صالح للفاتورة");
  }
  return bytes;
}

export function ownerInvoiceError(error: unknown) {
  if (error instanceof NextErpInvoiceError) return { status: error.status, message: error.message };
  return {
    status: 502,
    message: error instanceof Error ? error.message : "تعذر الاتصال بفواتير NEXT ERP",
  };
}
