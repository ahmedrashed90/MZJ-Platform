import { useMemo, useState } from "react";
import { Calculator, CarProfile, MagnifyingGlass } from "@phosphor-icons/react";

type WebsiteCar = {
  vehicleId?: string;
  title?: string;
  priceBeforeTax?: number;
};

type DiscountConfig = {
  firstPurchasePercent?: number;
  repeatPurchasePercent?: number;
  friendGiftPercent?: number;
  priceBasis?: string;
  roundingMode?: string;
  roundingUnit?: number;
};

type OwnersDiscountCalculatorProps = {
  websiteCars: WebsiteCar[];
  referralCode?: string;
  profileKind?: "legacy" | "member";
  discountConfig?: DiscountConfig;
};

function normalizeVehicleSearch(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u064b-\u065f\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function percent(value: unknown, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(0, parsed));
}

function discountAmount(priceBeforeTax: unknown, ratePercent: unknown, roundingUnit: unknown) {
  const price = Math.max(0, Number(priceBeforeTax || 0));
  const rate = percent(ratePercent, 1);
  const unitRaw = Math.trunc(Number(roundingUnit || 100));
  const unit = Number.isFinite(unitRaw) && unitRaw > 0 ? unitRaw : 100;
  if (!(price > 0) || !(rate > 0)) return 0;
  const raw = price * (rate / 100);
  return Math.min(price, Math.floor((raw + 1e-9) / unit) * unit);
}

export function OwnersDiscountCalculator({ websiteCars, referralCode, profileKind = "legacy", discountConfig }: OwnersDiscountCalculatorProps) {
  const [vehicleId, setVehicleId] = useState("");
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const selectedCar = websiteCars.find((car) => String(car.vehicleId || "") === vehicleId) || null;
  const normalizedQuery = normalizeVehicleSearch(query);
  const filteredCars = useMemo(() => {
    if (!normalizedQuery) return websiteCars;
    const terms = normalizedQuery.split(/\s+/).filter(Boolean);
    return websiteCars.filter((car) => {
      const haystack = normalizeVehicleSearch(`${car.title || ""} ${car.vehicleId || ""}`);
      return terms.every((term) => haystack.includes(term));
    });
  }, [websiteCars, normalizedQuery]);

  const personalRate = profileKind === "member"
    ? percent(discountConfig?.repeatPurchasePercent, 1)
    : percent(discountConfig?.firstPurchasePercent, 1);
  const friendGiftRate = percent(discountConfig?.friendGiftPercent, 1);
  const unit = discountConfig?.roundingUnit ?? 100;
  const personalDiscount = selectedCar ? discountAmount(selectedCar.priceBeforeTax, personalRate, unit) : 0;
  const friendGiftDiscount = selectedCar ? discountAmount(selectedCar.priceBeforeTax, friendGiftRate, unit) : 0;

  const chooseCar = (car: WebsiteCar) => {
    setVehicleId(String(car.vehicleId || ""));
    setQuery(String(car.title || ""));
    setIsOpen(false);
    setActiveIndex(-1);
  };

  return (
    <section className="owners-public-section owners-code-calculator owners-club-main-section">
      <div className="owners-calculator-head"><Calculator size={26} /><div><h2>اعرف خصمك</h2></div></div>
      <div className="owners-calculator-combobox-label">
        <span>اختر السيارة</span>
        <div
          className="owners-calculator-combobox"
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null;
            if (!next || !event.currentTarget.contains(next)) setIsOpen(false);
          }}
        >
          <div className="owners-calculator-combobox-input">
            <CarProfile size={20} />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setVehicleId("");
                setIsOpen(true);
                setActiveIndex(-1);
              }}
              onFocus={() => setIsOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setIsOpen(true);
                  setActiveIndex((index) => Math.min(index + 1, filteredCars.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setIsOpen(true);
                  setActiveIndex((index) => Math.max(index - 1, 0));
                } else if (event.key === "Enter" && isOpen && filteredCars[activeIndex]) {
                  event.preventDefault();
                  chooseCar(filteredCars[activeIndex]);
                } else if (event.key === "Escape") {
                  setIsOpen(false);
                }
              }}
              placeholder="اكتب اسم السيارة، مثال: اكسنت"
              aria-label="ابحث عن السيارة"
              aria-autocomplete="list"
              aria-expanded={isOpen}
              aria-controls="owners-vehicle-options"
              role="combobox"
              autoComplete="off"
            />
            <MagnifyingGlass size={20} />
          </div>
          {isOpen ? (
            <div className="owners-calculator-options" id="owners-vehicle-options" role="listbox">
              {filteredCars.length ? filteredCars.map((car, index) => (
                <button
                  key={`${car.vehicleId}-${car.title}`}
                  type="button"
                  role="option"
                  aria-selected={String(car.vehicleId || "") === vehicleId}
                  className={index === activeIndex ? "active" : ""}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseCar(car)}
                >
                  {car.title || "سيارة بدون اسم"}
                </button>
              )) : (
                <div className="owners-calculator-no-options">لا توجد سيارة مطابقة لما كتبته.</div>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <div className="owners-calculator-result">
        <div><span>كود العميل</span><strong dir="ltr">{referralCode || "—"}</strong></div>
        <div className="highlight"><span>الخصم الشخصي</span><strong>{selectedCar ? `${personalDiscount.toLocaleString("ar-SA-u-nu-latn")} ر.س` : "—"}</strong></div>
        <div className="highlight friend"><span>خصم إهداء لصديق</span><strong>{selectedCar ? `${friendGiftDiscount.toLocaleString("ar-SA-u-nu-latn")} ر.س` : "—"}</strong></div>
      </div>
      {!websiteCars.length ? <p className="owners-calculator-empty">تعذر تحميل سيارات الموقع حاليًا. حاول مرة أخرى لاحقًا.</p> : null}
    </section>
  );
}
