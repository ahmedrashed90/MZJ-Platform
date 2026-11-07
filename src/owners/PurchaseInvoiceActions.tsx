import { useState } from "react";
import { DownloadSimple } from "@phosphor-icons/react";
import { ownersAdminGet, ownersPublicGet } from "./api";

type Props = {
  salesOrder?: string | null;
  mode: "public" | "admin";
  memberId?: string;
};

function formatInvoiceDate(value: unknown) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium" }).format(new Date(String(value)));
  } catch {
    return String(value);
  }
}

export function PurchaseInvoiceActions({ salesOrder, mode, memberId = "" }: Props) {
  const order = String(salesOrder || "").trim();
  const [busy, setBusy] = useState(false);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  if (!order) return null;

  function invoiceUrl(invoiceName: string) {
    const params = new URLSearchParams({ salesOrder: order, invoice: invoiceName });
    if (mode === "public") {
      params.set("action", "invoice_pdf");
      return `/api/owners/public?${params.toString()}`;
    }
    params.set("scope", "invoice_pdf");
    params.set("memberId", memberId);
    return `/api/owners?${params.toString()}`;
  }

  function download(invoiceName: string) {
    const anchor = document.createElement("a");
    anchor.href = invoiceUrl(invoiceName);
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  async function loadInvoices() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    setInvoices([]);
    try {
      const result = mode === "public"
        ? await ownersPublicGet("purchase_invoices", { salesOrder: order })
        : await ownersAdminGet("purchase_invoices", { memberId, salesOrder: order });
      const rows = Array.isArray(result?.invoices) ? result.invoices : [];
      if (!rows.length) {
        setMessage("الفاتورة غير متاحة بعد");
      } else if (rows.length === 1) {
        download(String(rows[0].name || ""));
      } else {
        setInvoices(rows);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تحميل الفاتورة");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="owners-purchase-invoice-actions" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="owners-invoice-download" disabled={busy} onClick={() => void loadInvoices()}>
        <DownloadSimple size={15} /> {busy ? "جاري البحث..." : "تحميل الفاتورة"}
      </button>
      {message ? <small className="owners-invoice-message">{message}</small> : null}
      {invoices.length > 1 ? (
        <div className="owners-invoice-list">
          {invoices.map((invoice: any) => (
            <button type="button" key={invoice.name} onClick={() => download(String(invoice.name || ""))}>
              <DownloadSimple size={14} />
              <span>{invoice.name}</span>
              {invoice.postingDate ? <small>{formatInvoiceDate(invoice.postingDate)}</small> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
