import { useEffect, useMemo, useState } from "react";
import { MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import { operationsFetch, operationsQuery } from "../api";
import type { OperationsVehicle } from "../types";

type Props = {
  selected: OperationsVehicle[];
  onChange: (vehicles: OperationsVehicle[]) => void;
  multiple?: boolean;
  placeholder?: string;
};

export function VehiclePicker({ selected, onChange, multiple = false, placeholder = "ابحث بجزء من رقم الهيكل أو اسم السيارة" }: Props) {
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<OperationsVehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const selectedIds = useMemo(() => new Set(selected.map((item) => item.id)), [selected]);

  useEffect(() => {
    if (search.trim().length < 2) { setSuggestions([]); return; }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const payload = await operationsFetch<{ ok: true; vehicles: OperationsVehicle[] }>(
          `/api/operations/vehicles${operationsQuery({ mode: "suggest", search, limit: 12 })}`,
        );
        setSuggestions(payload.vehicles.filter((item) => !selectedIds.has(item.id)));
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 260);
    return () => window.clearTimeout(timer);
  }, [search, selectedIds]);

  function choose(vehicle: OperationsVehicle) {
    onChange(multiple ? [...selected, vehicle] : [vehicle]);
    setSearch("");
    setSuggestions([]);
  }

  return (
    <div className="operations-vehicle-picker">
      <label className="operations-search"><MagnifyingGlass size={19} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={placeholder} /></label>
      {search.trim().length >= 2 ? (
        <div className="operations-suggestions">
          {loading ? <span>جاري البحث...</span> : suggestions.length ? suggestions.map((vehicle) => (
            <button key={vehicle.id} type="button" onClick={() => choose(vehicle)}>
              <div><strong>{vehicle.vin}</strong><small>{vehicle.car_name || "—"} · {vehicle.statement || "—"}</small></div>
              <div><span>{vehicle.location_name || "—"}</span><span>{vehicle.status_name || vehicle.status_code}</span></div>
              <Plus size={17} />
            </button>
          )) : <span>لا توجد نتائج مطابقة</span>}
        </div>
      ) : null}
      {selected.length ? <div className="operations-selected-vehicles">{selected.map((vehicle) => (
        <article key={vehicle.id}>
          <div><strong>{vehicle.vin}</strong><span>{vehicle.car_name || "—"} · {vehicle.statement || "—"} · {vehicle.model_year || "—"}</span></div>
          <div><small>المكان الحالي</small><strong>{vehicle.location_name || "—"}</strong></div>
          <div><small>الحالة</small><strong>{vehicle.status_name || vehicle.status_code}</strong></div>
          <button type="button" onClick={() => onChange(selected.filter((item) => item.id !== vehicle.id))} aria-label="حذف السيارة"><X size={18} /></button>
        </article>
      ))}</div> : null}
    </div>
  );
}
