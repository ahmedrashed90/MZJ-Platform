import { useState } from "react";
import { Calculator, CarProfile } from "@phosphor-icons/react";

type WebsiteCar = {
  vehicleId?: string;
  title?: string;
  priceBeforeTax?: number;
};

type OwnersDiscountCalculatorProps = {
  websiteCars: WebsiteCar[];
  referralCode?: string;
};

export function OwnersDiscountCalculator({ websiteCars, referralCode }: OwnersDiscountCalculatorProps) {
  const [vehicleId, setVehicleId] = useState("");
  const selectedCar = websiteCars.find((car) => String(car.vehicleId || "") === vehicleId) || null;
  const rawDiscount = selectedCar ? Number(selectedCar.priceBeforeTax || 0) * 0.01 : 0;
  const discount = rawDiscount > 0 ? Math.ceil(rawDiscount / 100) * 100 : 0;

  return (
    <section className="owners-public-section owners-code-calculator">
      <div className="owners-calculator-head"><Calculator size={26} /><div><h2>احسب خصمك</h2></div></div>
      <label className="owners-calculator-select">
        <span>اختر السيارة</span>
        <div>
          <CarProfile size={20} />
          <select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
            <option value="">اختر السيارة</option>
            {websiteCars.map((car) => (
              <option key={`${car.vehicleId}-${car.title}`} value={car.vehicleId}>
                {car.title} · {car.vehicleId}
              </option>
            ))}
          </select>
        </div>
      </label>
      {selectedCar ? (
        <div className="owners-calculator-result">
          <div className="highlight"><span>الخصم</span><strong>{discount.toLocaleString("ar-SA-u-nu-latn")} ر.س</strong></div>
          <div><span>كودك الشخصي</span><strong dir="ltr">{referralCode || "—"}</strong></div>
        </div>
      ) : null}
      {!websiteCars.length ? <p className="owners-calculator-empty">تعذر تحميل سيارات الموقع حاليًا. حاول مرة أخرى لاحقًا.</p> : null}
    </section>
  );
}
