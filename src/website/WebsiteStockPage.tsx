import { useEffect, useMemo, useState } from "react";
import { ArrowsClockwise, FileXls, MagnifyingGlass } from "@phosphor-icons/react";
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

type StatusFilter = "all" | "needs_attention" | "missing_images" | "missing_compare" | "complete";

function money(value: unknown) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function WebsiteStockPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

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
    return cars.filter((car) => {
      const matchesQuery = !needle || `${car.vehicleId} ${car.title}`.toLowerCase().includes(needle);
      if (!matchesQuery) return false;
      if (status === "needs_attention") return !car.hasImages || !car.hasCompareKey;
      if (status === "missing_images") return !car.hasImages;
      if (status === "missing_compare") return !car.hasCompareKey;
      if (status === "complete") return car.hasImages && car.hasCompareKey;
      return true;
    });
  }, [cars, query, status]);

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

  return (
    <div className="module-page website-stock-page" dir="rtl">
      <header className="website-stock-head">
        <div><h1>الاستوك في الموقع</h1><p>كل السيارات المنشورة في الموقع الإلكتروني، مع حالة الصور و CompareKey.</p></div>
        <div className="website-stock-actions">
          <button type="button" className="crm-secondary-button" disabled={loading} onClick={() => void load(true)}><ArrowsClockwise size={18} /> تحديث</button>
          <button type="button" className="crm-primary-button" disabled={!filteredCars.length} onClick={exportExcel}><FileXls size={18} /> تصدير Excel</button>
        </div>
      </header>

      {message ? <div className="owners-notice">{message}</div> : null}
      {data?.warning ? <div className="website-stock-warning">تم تحميل السيارات من المصدر البديل للموقع. {data.warning}</div> : null}

      <section className="website-stock-toolbar">
        <label className="website-stock-search"><MagnifyingGlass size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث باسم السيارة أو Vehicle ID" /></label>
        <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
          <option value="all">كل السيارات</option>
          <option value="needs_attention">ناقص بيانات</option>
          <option value="missing_images">ناقص صور</option>
          <option value="missing_compare">ناقص CompareKey</option>
          <option value="complete">مكتملة</option>
        </select>
        <span>{filteredCars.length.toLocaleString("ar-SA-u-nu-latn")} سيارة</span>
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
