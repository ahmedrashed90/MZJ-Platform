import { useEffect, useMemo, useState } from "react";
import {
  ArrowsClockwise,
  CheckCircle,
  ImageSquare,
  MagnifyingGlass,
  UploadSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import { uploadWebsiteVehicleImages, websiteImagesGet, websiteImageUploadTicket } from "./api";

type ImageRef = {
  id: number;
  url: string;
  thumbUrl: string;
  alt: string;
};

type ColorRow = {
  name: string;
  qty: number;
  images: ImageRef[];
};

type ImageCar = {
  postId: number;
  vehicleId: string;
  title: string;
  stock: number;
  mainImage: ImageRef | null;
  exteriorColors: ColorRow[];
  interiorColors: ColorRow[];
  missingMain: boolean;
  missingExteriorCount: number;
  missingInteriorCount: number;
  complete: boolean;
  modifiedGmt: string;
};

type PendingFiles = {
  main: File[];
  exterior: Record<string, File[]>;
  interior: Record<string, File[]>;
};

type FilterMode = "all" | "incomplete" | "complete";

function emptyPending(): PendingFiles {
  return { main: [], exterior: {}, interior: {} };
}

function fileKey(kind: "exterior" | "interior", color: string) {
  return `${kind}:${color}`;
}

function fileCount(pending: PendingFiles) {
  return pending.main.length
    + Object.values(pending.exterior).reduce((sum, files) => sum + files.length, 0)
    + Object.values(pending.interior).reduce((sum, files) => sum + files.length, 0);
}

function formatBytes(value: number) {
  if (!value) return "";
  const mb = value / (1024 * 1024);
  return `${mb.toLocaleString("ar-SA-u-nu-latn", { maximumFractionDigits: 0 })} MB`;
}

function ExistingImages({ images }: { images: ImageRef[] }) {
  if (!images.length) return <span className="website-images-no-photo">لا توجد صور محفوظة</span>;
  return (
    <div className="website-images-thumbs" aria-label="الصور المحفوظة حاليًا">
      {images.slice(0, 8).map((image) => <img key={image.id} src={image.thumbUrl || image.url} alt={image.alt || "صورة السيارة"} loading="lazy" />)}
      {images.length > 8 ? <span>+{images.length - 8}</span> : null}
    </div>
  );
}

function LocalImagePreview({ file, fallback, alt }: { file?: File; fallback?: string; alt: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file) { setUrl(""); return; }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  const source = url || fallback || "";
  return source ? <img src={source} alt={alt} /> : <div><ImageSquare size={44} weight="duotone" /><span>لا توجد صورة رئيسية</span></div>;
}

function PendingNames({ files }: { files: File[] }) {
  if (!files.length) return null;
  return <div className="website-images-selected-files">{files.map((file) => <span key={`${file.name}-${file.lastModified}`}>{file.name}</span>)}</div>;
}

export function WebsiteImagesPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingFiles>(emptyPending());
  const [progress, setProgress] = useState("");

  async function load(refresh = false, keepPostId?: number | null) {
    setLoading(true);
    setMessage("");
    try {
      const result = await websiteImagesGet(refresh);
      setData(result);
      const cars: ImageCar[] = Array.isArray(result?.cars) ? result.cars : [];
      const wanted = keepPostId ?? selectedPostId;
      setSelectedPostId(wanted && cars.some((car) => car.postId === wanted) ? wanted : (cars[0]?.postId ?? null));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تحميل إدارة صور السيارات");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(false, null); }, []);

  const cars: ImageCar[] = Array.isArray(data?.cars) ? data.cars : [];
  const filteredCars = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cars.filter((car) => {
      if (filter === "complete" && !car.complete) return false;
      if (filter === "incomplete" && car.complete) return false;
      if (!needle) return true;
      return `${car.vehicleId} ${car.title}`.toLowerCase().includes(needle);
    });
  }, [cars, filter, query]);

  const selected = cars.find((car) => car.postId === selectedPostId) || null;
  const pendingCount = fileCount(pending);
  const completeCount = cars.filter((car) => car.complete).length;
  const missingMainCount = cars.filter((car) => car.missingMain).length;
  const missingColorsCount = cars.filter((car) => car.missingExteriorCount > 0 || car.missingInteriorCount > 0).length;

  function chooseCar(postId: number) {
    if (postId === selectedPostId) return;
    if (pendingCount && !window.confirm("لديك صور مختارة لم تُحفظ. هل تريد الانتقال لسيارة أخرى وإلغاء الاختيارات؟")) return;
    setPending(emptyPending());
    setProgress("");
    setSelectedPostId(postId);
  }

  function setSlotFiles(kind: "main" | "exterior" | "interior", color: string, files: File[]) {
    setProgress("");
    setPending((current) => {
      if (kind === "main") return { ...current, main: files.slice(0, 1) };
      return { ...current, [kind]: { ...current[kind], [color]: files } };
    });
  }

  async function save() {
    if (!selected || !pendingCount || saving) return;
    setSaving(true);
    setMessage("");
    setProgress("جاري تجهيز الرفع الآمن إلى WordPress...");
    try {
      const ticket = await websiteImageUploadTicket(selected.postId);
      const slots: Array<{ kind: "main" | "exterior" | "interior"; color?: string; files: File[] }> = [];
      if (pending.main.length) slots.push({ kind: "main", files: pending.main });
      Object.entries(pending.exterior).forEach(([color, files]) => { if (files.length) slots.push({ kind: "exterior", color, files }); });
      Object.entries(pending.interior).forEach(([color, files]) => { if (files.length) slots.push({ kind: "interior", color, files }); });

      for (let index = 0; index < slots.length; index += 1) {
        const slot = slots[index];
        const label = slot.kind === "main" ? "الصورة الرئيسية" : `${slot.kind === "exterior" ? "الخارجي" : "الداخلي"} - ${slot.color}`;
        setProgress(`جاري رفع ${label} (${index + 1}/${slots.length}) مباشرة إلى WordPress...`);
        await uploadWebsiteVehicleImages({
          uploadUrl: String(ticket.uploadUrl || data?.uploadUrl || ""),
          ticket: String(ticket.ticket || ""),
          postId: selected.postId,
          kind: slot.kind,
          color: slot.color,
          files: slot.files,
        });
      }

      setPending(emptyPending());
      setProgress("تم حفظ الصور وربطها بالسيارة داخل WordPress بنجاح.");
      await load(false, selected.postId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر حفظ صور السيارة");
      setProgress("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="module-page website-images-page" dir="rtl">
      <header className="website-images-head">
        <div>
          <h2>إدارة صور السيارات</h2>
          <p>اختيار الصور من الجهاز والحفظ النهائي داخل WordPress فقط. الألوان تقرأ من الاستوك الحالي.</p>
        </div>
        <button type="button" className="crm-secondary-button" disabled={loading || saving} onClick={() => void load(true, selectedPostId)}>
          <ArrowsClockwise size={18} /> تحديث من الاستوك
        </button>
      </header>

      {message ? <div className="owners-notice">{message}</div> : null}
      {data?.warning ? <div className="website-stock-warning">{data.warning}</div> : null}

      <section className="website-images-kpis">
        <div><span>كل السيارات</span><strong>{cars.length.toLocaleString("ar-SA-u-nu-latn")}</strong></div>
        <div><span>مكتملة الصور</span><strong>{completeCount.toLocaleString("ar-SA-u-nu-latn")}</strong></div>
        <div><span>ناقص صورة رئيسية</span><strong>{missingMainCount.toLocaleString("ar-SA-u-nu-latn")}</strong></div>
        <div><span>ناقص صور ألوان</span><strong>{missingColorsCount.toLocaleString("ar-SA-u-nu-latn")}</strong></div>
      </section>

      <section className="website-images-toolbar">
        <label className="website-stock-search"><MagnifyingGlass size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث باسم السيارة أو Vehicle ID" /></label>
        <div className="website-images-filters" role="group" aria-label="فلترة حالة الصور">
          <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>الكل</button>
          <button type="button" className={filter === "incomplete" ? "active" : ""} onClick={() => setFilter("incomplete")}>ناقص صور</button>
          <button type="button" className={filter === "complete" ? "active" : ""} onClick={() => setFilter("complete")}>مكتمل</button>
        </div>
      </section>

      <div className="website-images-workspace">
        <aside className="website-images-cars" aria-label="قائمة السيارات">
          {loading && !cars.length ? <div className="website-images-empty">جاري تحميل السيارات...</div> : null}
          {!loading && !filteredCars.length ? <div className="website-images-empty">لا توجد سيارات مطابقة.</div> : null}
          {filteredCars.map((car) => (
            <button key={car.postId} type="button" className={`website-images-car-card ${selectedPostId === car.postId ? "active" : ""}`} onClick={() => chooseCar(car.postId)}>
              <div className="website-images-card-photo">
                {car.mainImage ? <img src={car.mainImage.thumbUrl || car.mainImage.url} alt={car.mainImage.alt || car.title} loading="lazy" /> : <ImageSquare size={26} weight="duotone" />}
              </div>
              <div className="website-images-card-copy">
                <code dir="ltr">{car.vehicleId}</code>
                <strong>{car.title}</strong>
                <small>الاستوك {car.stock.toLocaleString("ar-SA-u-nu-latn")}</small>
              </div>
              <span className={`website-images-card-state ${car.complete ? "ok" : "bad"}`} title={car.complete ? "الصور مكتملة" : "السيارة تحتاج صور"}>
                {car.complete ? <CheckCircle size={20} weight="fill" /> : <WarningCircle size={20} weight="fill" />}
              </span>
            </button>
          ))}
        </aside>

        <section className="website-images-editor">
          {!selected ? <div className="website-images-empty">اختر سيارة لإدارة صورها.</div> : (
            <>
              <div className="website-images-editor-title">
                <div><code dir="ltr">{selected.vehicleId}</code><h3>{selected.title}</h3></div>
                <span>الاستوك {selected.stock.toLocaleString("ar-SA-u-nu-latn")} سيارة</span>
              </div>

              <div className="website-images-main-slot">
                <div className="website-images-main-preview">
                  <LocalImagePreview
                    file={pending.main[0]}
                    fallback={selected.mainImage?.url}
                    alt={pending.main[0] ? "معاينة الصورة الرئيسية الجديدة" : (selected.mainImage?.alt || selected.title)}
                  />
                </div>
                <div className="website-images-slot-copy">
                  <h4>الصورة الرئيسية</h4>
                  <p>الصورة المختارة ستصبح <code>main_img</code> و Featured Image للسيارة.</p>
                  <label className="website-images-file-button">
                    <UploadSimple size={18} /> اختيار صورة من الجهاز
                    <input type="file" accept="image/*" disabled={saving} onChange={(event) => setSlotFiles("main", "", Array.from(event.target.files || []))} />
                  </label>
                  <PendingNames files={pending.main} />
                </div>
              </div>

              <div className="website-images-section-head"><div><h4>الألوان الخارجية</h4><p>نفس الألوان المتاحة حاليًا في Matrix الاستوك. اختيار صور جديدة يستبدل صور هذا اللون فقط.</p></div><span>{selected.exteriorColors.length.toLocaleString("ar-SA-u-nu-latn")} لون</span></div>
              <div className="website-images-color-grid">
                {selected.exteriorColors.length ? selected.exteriorColors.map((color) => {
                  const files = pending.exterior[color.name] || [];
                  return (
                    <article key={fileKey("exterior", color.name)} className={`website-images-color-card ${!color.images.length ? "missing" : ""}`}>
                      <div className="website-images-color-title"><strong>{color.name}</strong><span>{color.qty.toLocaleString("ar-SA-u-nu-latn")} سيارة</span></div>
                      <ExistingImages images={color.images} />
                      <label className="website-images-file-button compact"><UploadSimple size={17} /> اختيار الصور من الجهاز<input type="file" accept="image/*" multiple disabled={saving} onChange={(event) => setSlotFiles("exterior", color.name, Array.from(event.target.files || []))} /></label>
                      <PendingNames files={files} />
                    </article>
                  );
                }) : <div className="website-images-empty">لا توجد ألوان خارجية متاحة في الاستوك الحالي.</div>}
              </div>

              <div className="website-images-section-head"><div><h4>الألوان الداخلية</h4><p>تظهر فقط الألوان الداخلية الموجودة في تركيبات الاستوك الحالية، والصور تحفظ داخل WordPress مع السيارة.</p></div><span>{selected.interiorColors.length.toLocaleString("ar-SA-u-nu-latn")} لون</span></div>
              <div className="website-images-color-grid">
                {selected.interiorColors.length ? selected.interiorColors.map((color) => {
                  const files = pending.interior[color.name] || [];
                  return (
                    <article key={fileKey("interior", color.name)} className={`website-images-color-card ${!color.images.length ? "missing" : ""}`}>
                      <div className="website-images-color-title"><strong>{color.name}</strong><span>{color.qty.toLocaleString("ar-SA-u-nu-latn")} سيارة</span></div>
                      <ExistingImages images={color.images} />
                      <label className="website-images-file-button compact"><UploadSimple size={17} /> اختيار الصور من الجهاز<input type="file" accept="image/*" multiple disabled={saving} onChange={(event) => setSlotFiles("interior", color.name, Array.from(event.target.files || []))} /></label>
                      <PendingNames files={files} />
                    </article>
                  );
                }) : <div className="website-images-empty">لا توجد ألوان داخلية متاحة في الاستوك الحالي.</div>}
              </div>

              <div className="website-images-savebar">
                <div>
                  <strong>{pendingCount ? `${pendingCount.toLocaleString("ar-SA-u-nu-latn")} ملف مختار للحفظ` : "لم يتم اختيار صور جديدة"}</strong>
                  <span>{progress || (data?.uploadMaxBytes ? `الحد الأقصى للملف حسب WordPress: ${formatBytes(Number(data.uploadMaxBytes))}` : "الصور ترفع مباشرة إلى WordPress ولا تحفظ في المنصة.")}</span>
                </div>
                <div className="website-images-save-actions">
                  <button type="button" className="crm-secondary-button" disabled={saving || !pendingCount} onClick={() => { setPending(emptyPending()); setProgress(""); }}>إلغاء الاختيارات</button>
                  <button type="button" className="crm-primary-button" disabled={saving || !pendingCount} onClick={() => void save()}><UploadSimple size={18} /> {saving ? "جاري الحفظ..." : "حفظ الصور في WordPress"}</button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
