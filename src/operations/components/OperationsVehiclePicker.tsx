import { MagnifyingGlass, Plus } from "@phosphor-icons/react";
import type { VehicleRow } from "../types";

type Props = {
  search: string;
  results: VehicleRow[];
  placeholder: string;
  onSearchChange: (value: string) => void;
  onSelect: (row: VehicleRow) => void;
};

export function OperationsVehiclePicker({ search, results, placeholder, onSearchChange, onSelect }: Props) {
  return (
    <div className="operations-vehicle-picker">
      <label className="operations-search operations-vehicle-picker-input">
        <MagnifyingGlass size={18} />
        <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={placeholder} autoComplete="off" />
      </label>
      {results.length ? (
        <div className="operations-vehicle-picker-results" role="listbox" aria-label="نتائج البحث عن السيارات">
          <div className="operations-vehicle-picker-head" aria-hidden="true">
            <span>رقم الهيكل</span><span>السيارة والبيان</span><span>المكان والحالة</span><span>الموافقات</span><span />
          </div>
          {results.map((row) => (
            <button key={row.id} type="button" role="option" onClick={() => onSelect(row)}>
              <strong dir="ltr">{row.vin}</strong>
              <span className="operations-picker-car"><b>{row.car_name || "—"}</b><small>{row.statement || "لا يوجد بيان"}</small></span>
              <span className="operations-picker-location"><b>{row.location_name || "بدون مكان"}</b><small>{row.status_name || row.status_code}</small></span>
              <span className={row.financial_approved && row.administrative_approved ? "operations-picker-approvals complete" : "operations-picker-approvals"}>
                <small>{row.financial_approved ? "مالي ✓" : "مالي —"}</small>
                <small>{row.administrative_approved ? "إداري ✓" : "إداري —"}</small>
              </span>
              <span className="operations-picker-add"><Plus size={17} /></span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
