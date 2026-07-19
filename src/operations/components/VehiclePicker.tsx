import { useMemo, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import type { OperationsVehicle } from "../types";

export function VehiclePicker({
  vehicles,
  selectedIds,
  onChange,
  maxHeight = 330,
}: {
  vehicles: OperationsVehicle[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  maxHeight?: number;
}) {
  const [search, setSearch] = useState("");
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return vehicles;
    return vehicles.filter((vehicle) => [vehicle.vin, vehicle.car_name, vehicle.statement, vehicle.model_year, vehicle.location_name]
      .some((value) => String(value || "").toLowerCase().includes(term)));
  }, [search, vehicles]);

  function toggle(id: string) {
    onChange(selected.has(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
  }

  return (
    <div className="ops-vehicle-picker">
      <label className="ops-search"><MagnifyingGlass size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث داخل السيارات..." /></label>
      <div className="ops-picker-head"><span>السيارات المتاحة: {visible.length.toLocaleString("ar-SA")}</span><strong>المحدد: {selectedIds.length.toLocaleString("ar-SA")}</strong></div>
      <div className="ops-picker-list" style={{ maxHeight }}>
        {visible.map((vehicle) => (
          <label key={vehicle.id} className={selected.has(vehicle.id) ? "selected" : ""}>
            <input type="checkbox" checked={selected.has(vehicle.id)} onChange={() => toggle(vehicle.id)} />
            <span className="ops-picker-main"><strong>{vehicle.vin}</strong><small>{vehicle.car_name || "—"} • {vehicle.statement || "—"} • {vehicle.model_year || "—"}</small></span>
            <span className="ops-picker-location">{vehicle.location_name || "—"}</span>
          </label>
        ))}
        {!visible.length ? <div className="ops-empty-inline">لا توجد سيارات مطابقة.</div> : null}
      </div>
    </div>
  );
}
