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

async function invoiceParentsFromChildRows(salesOrder: string) {
  const fields = JSON.stringify(["parent", "sales_order"]);
  const filters = JSON.stringify([["sales_order", "=", salesOrder]]);
  const path = `/api/resource/${encodeURIComponent("Sales Invoice Item")}?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&limit_page_length=100`;
  const payload = await readJson(await nextErpFetch(path));
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return [...new Set(rows.map((row: any) => clean(row?.parent)).filter(Boolean))];
}

async function invoiceParentsFromParentFilter(salesOrder: string) {
  const fields = JSON.stringify(["name", "posting_date", "grand_total", "status", "docstatus"]);
  const filters = JSON.stringify([
    ["Sales Invoice Item", "sales_order", "=", salesOrder],
    ["Sales Invoice", "docstatus", "=", 1],
  ]);
  const path = `/api/resource/${encodeURIComponent("Sales Invoice")}?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&order_by=${encodeURIComponent("posting_date desc,creation desc")}&limit_page_length=20`;
  const payload = await readJson(await nextErpFetch(path));
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.map((row: any) => clean(row?.name)).filter(Boolean);
}

async function getSalesInvoice(name: string) {
  const payload = await readJson(await nextErpFetch(`/api/resource/${encodeURIComponent("Sales Invoice")}/${encodeURIComponent(name)}`));
  return payload?.data || null;
}

export async function listNextErpSalesInvoices(salesOrderValue: unknown): Promise<OwnerSalesInvoice[]> {
  const salesOrder = clean(salesOrderValue);
  if (!salesOrder) return [];
  let parents: string[] = [];
  try {
    parents = await invoiceParentsFromChildRows(salesOrder);
  } catch (firstError) {
    try {
      parents = await invoiceParentsFromParentFilter(salesOrder);
    } catch {
      throw firstError;
    }
  }

  const invoices: OwnerSalesInvoice[] = [];
  for (const name of [...new Set(parents)].slice(0, 20)) {
    try {
      const doc = await getSalesInvoice(name);
      if (!doc || Number(doc.docstatus || 0) !== 1) continue;
      if (clean(doc.status).toLowerCase() === "cancelled") continue;
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

  invoices.sort((left, right) => String(right.postingDate || "").localeCompare(String(left.postingDate || "")) || right.name.localeCompare(left.name));
  return invoices;
}

export async function downloadNextErpSalesInvoicePdf(invoiceValue: unknown) {
  const invoice = clean(invoiceValue);
  if (!invoice) throw new NextErpInvoiceError(400, "رقم الفاتورة غير محدد");
  const format = clean(process.env.NEXT_ERP_SALES_INVOICE_PRINT_FORMAT || process.env.ERPNEXT_SALES_INVOICE_PRINT_FORMAT || "Standard");
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
    throw new NextErpInvoiceError(response.status, clean(text).slice(0, 500) || "تعذر تحميل PDF الفاتورة من NEXT ERP");
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
  return { status: 502, message: error instanceof Error ? error.message : "تعذر الاتصال بفواتير NEXT ERP" };
}
