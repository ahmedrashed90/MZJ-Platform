import { useEffect, useMemo, useState } from "react";
import { ArrowsClockwise, FilePdf, FileXls, MagnifyingGlass } from "@phosphor-icons/react";
import { downloadXlsx } from "../crm/xlsx";
import { websiteStockGet } from "./api";

type StockCar = {
  postId: number;
  vehicleId: string;
  title: string;
  price: number;
  priceBeforeTax: number;
  stock: number | null;
  hasImages: boolean;
  hasCompareKey: boolean;
  compareKey: string | null;
  imageUrl: string | null;
  url: string;
};

function money(value: unknown) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function WebsiteStockPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [stockFrom, setStockFrom] = useState("");
  const [stockTo, setStockTo] = useState("");

  async function load(refresh = false) {
    setLoading(true);
    setMessage("");
    try {
      setData(await websiteStockGet(refresh));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تحميل استوك الموقع الإلكتروني");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(false); }, []);

  const cars: StockCar[] = Array.isArray(data?.cars) ? data.cars : [];
  const filteredCars = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rawFrom = stockFrom.trim();
    const rawTo = stockTo.trim();
    const parsedFrom = rawFrom === "" ? null : Number(rawFrom);
    const parsedTo = rawTo === "" ? null : Number(rawTo);
    const from = parsedFrom !== null && Number.isFinite(parsedFrom) && parsedFrom >= 0 ? parsedFrom : null;
    const to = parsedTo !== null && Number.isFinite(parsedTo) && parsedTo >= 0 ? parsedTo : null;
    return cars.filter((car) => {
      if (needle && !`${car.vehicleId} ${car.title}`.toLowerCase().includes(needle)) return false;
      if ((from !== null || to !== null) && car.stock == null) return false;
      const stock = Number(car.stock);
      if (from !== null && stock < from) return false;
      if (to !== null && stock > to) return false;
      return true;
    });
  }, [cars, query, stockFrom, stockTo]);

  const totalCars = cars.length;
  const totalStock = useMemo(
    () => cars.reduce((sum, car) => sum + (car.stock == null ? 0 : Math.max(0, Number(car.stock) || 0)), 0),
    [cars],
  );

  function exportExcel() {
    downloadXlsx(
      `MZJ-Website-Stock-${new Date().toISOString().slice(0, 10)}.xlsx`,
      filteredCars.map((car, index) => ({
        "مسلسل": index + 1,
        "Vehicle ID": car.vehicleId,
        "السيارة": car.title,
        "السعر": car.price,
        "الاستوك": car.stock == null ? "—" : car.stock,
        "الصور": car.hasImages ? "مكتملة" : "ناقص صور",
        "CompareKey": car.hasCompareKey ? "موجود" : "ناقص CompareKey",
      })),
      "الاستوك في الموقع",
      ["مسلسل", "Vehicle ID", "السيارة", "السعر", "الاستوك", "الصور", "CompareKey"],
    );
  }

  function exportPdf() {
    const popup = window.open("", "_blank", "width=1200,height=820");
    if (!popup) {
      setMessage("تعذر فتح نافذة تصدير PDF");
      return;
    }

    const rows = filteredCars.map((car, index) => `<tr>
      <td>${index + 1}</td>
      <td dir="ltr">${escapeHtml(car.vehicleId)}</td>
      <td>${escapeHtml(car.title)}</td>
      <td>${escapeHtml(money(car.price))}</td>
      <td>${car.stock == null ? "—" : escapeHtml(Number(car.stock).toLocaleString("ar-SA-u-nu-latn"))}</td>
      <td>${car.hasImages ? "مكتملة" : "ناقص صور"}</td>
      <td>${car.hasCompareKey ? "موجود" : "ناقص CompareKey"}</td>
    </tr>`).join("");

    popup.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>الاستوك في الموقع</title><style>
      @page{size:A4 landscape;margin:10mm}
      *{box-sizing:border-box}
      body{font-family:Tajawal,Arial,sans-serif;color:#34231d;margin:0;background:#fff;font-size:11px}
      header{display:flex;align-items:end;justify-content:space-between;gap:20px;border-bottom:2px solid #7f3528;padding-bottom:10px;margin-bottom:14px}
      h1{font-size:22px;margin:0;font-weight:900}
      .meta{color:#6b554b;font-weight:700}
      table{width:100%;border-collapse:collapse;table-layout:fixed}
      th,td{border:1px solid #dfcfc7;padding:7px 8px;text-align:right;vertical-align:middle;overflow-wrap:anywhere}
      th{background:#f7eee9;color:#5b3a31;font-weight:900}
      th:nth-child(1),td:nth-child(1){width:5%;text-align:center}
      th:nth-child(2),td:nth-child(2){width:12%}
      th:nth-child(3),td:nth-child(3){width:31%}
      th:nth-child(4),td:nth-child(4){width:12%}
      th:nth-child(5),td:nth-child(5){width:9%;text-align:center}
      th:nth-child(6),td:nth-child(6){width:13%;text-align:center}
      th:nth-child(7),td:nth-child(7){width:18%;text-align:center}
      tbody tr:nth-child(even){background:#fcfaf9}
      @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body><header><div><h1>الاستوك في الموقع</h1><div class="meta">عدد السيارات: ${filteredCars.length.toLocaleString("ar-SA-u-nu-latn")}</div></div><div class="meta">${escapeHtml(new Date().toLocaleDateString("ar-SA-u-nu-latn"))}</div></header><table><thead><tr><th>مسلسل</th><th>Vehicle ID</th><th>السيارة</th><th>السعر</th><th>الاستوك</th><th>الصور</th><th>CompareKey</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>setTimeout(()=>window.print(),200)<\/script></body></html>`);
    popup.document.close();
  }

  return (
    <div className="module-page website-stock-page" dir="rtl">
      <header className="website-stock-head">
        <div className="website-stock-actions">
          <button type="button" className="crm-secondary-button" disabled={loading} onClick={() => void load(true)}><ArrowsClockwise size={18} /> تحديث</button>
          <button type="button" className="crm-secondary-button" disabled={!filteredCars.length} onClick={exportPdf}><FilePdf size={18} /> تصدير PDF</button>
          <button type="button" className="crm-primary-button" disabled={!filteredCars.length} onClick={exportExcel}><FileXls size={18} /> تصدير Excel</button>
        </div>
      </header>

      {message ? <div className="owners-notice">{message}</div> : null}
      {data?.warning ? <div className="website-stock-warning">تم تحميل السيارات من المصدر البديل للموقع. {data.warning}</div> : null}

      <section className="website-stock-toolbar">
        <label className="website-stock-search"><MagnifyingGlass size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث باسم السيارة أو Vehicle ID" /></label>
        <div className="website-stock-range">
          <label><span>من</span><input type="number" min="0" step="1" inputMode="numeric" value={stockFrom} onChange={(event) => setStockFrom(event.target.value)} placeholder="0" /></label>
          <label><span>إلى</span><input type="number" min="0" step="1" inputMode="numeric" value={stockTo} onChange={(event) => setStockTo(event.target.value)} placeholder="0" /></label>
        </div>
        <div className="website-stock-count-box">عدد السيارات {totalCars.toLocaleString("ar-SA-u-nu-latn")} سيارة</div>
        <span>عدد الاستوك {totalStock.toLocaleString("ar-SA-u-nu-latn")} سيارة</span>
      </section>

      <section className="website-stock-table-card">
        <div className="website-stock-table-wrap">
          <table>
            <thead><tr><th>مسلسل</th><th>Vehicle ID</th><th>السيارة</th><th>السعر</th><th>الاستوك</th><th>الصور</th><th>CompareKey</th></tr></thead>
            <tbody>
              {loading && !cars.length ? <tr><td colSpan={7} className="website-stock-empty">جاري تحميل استوك الموقع...</td></tr> : null}
              {!loading && !filteredCars.length ? <tr><td colSpan={7} className="website-stock-empty">لا توجد سيارات مطابقة.</td></tr> : null}
              {filteredCars.map((car, index) => (
                <tr key={`${car.postId}-${car.vehicleId}`} className={!car.hasImages || !car.hasCompareKey ? "needs-attention" : ""}>
                  <td>{(index + 1).toLocaleString("ar-SA-u-nu-latn")}</td>
                  <td><code dir="ltr">{car.vehicleId}</code></td>
                  <td><strong>{car.title}</strong></td>
                  <td>{money(car.price)}</td>
                  <td>{car.stock == null ? "—" : Number(car.stock).toLocaleString("ar-SA-u-nu-latn")}</td>
                  <td><span className={`website-stock-state ${car.hasImages ? "ok" : "bad"}`}>{car.hasImages ? "مكتملة" : "ناقص صور"}</span></td>
                  <td><span className={`website-stock-state ${car.hasCompareKey ? "ok" : "bad"}`}>{car.hasCompareKey ? "موجود" : "ناقص CompareKey"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
