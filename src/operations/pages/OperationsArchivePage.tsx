import { useEffect, useState } from "react";
import { Archive, DownloadSimple, WarningCircle } from "@phosphor-icons/react";
import { downloadCsv, formatOperationsDate, operationsFetch } from "../api";

type ArchivedVehicle = {
  id: string; vin: string; car_name: string | null; statement: string | null; model_year: string | null; plate_no: string | null;
  branch_code: string | null; location_name: string | null; status_name: string | null; archived_at: string; archive_reason: string | null;
  archived_by_name: string | null; tracking_snapshot: Record<string, unknown> | null; approval_snapshot: Record<string, unknown> | null;
};

export function OperationsArchivePage() {
  const [vehicles, setVehicles] = useState<ArchivedVehicle[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    operationsFetch<{ ok: true; vehicles: ArchivedVehicle[] }>("/api/operations/archive")
      .then((payload) => setVehicles(payload.vehicles))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "تعذر تحميل الأرشيف"));
  }, []);

  return (
    <div className="module-page operations-page">
      <header className="module-page-head"><div><h1>أرشيف السيارات</h1><p>الأرشفة منطقية ولا تحذف السيارة أو الحركات أو الموافقات أو طلبات التراكينج.</p></div><button type="button" className="operations-secondary" onClick={() => downloadCsv("operations-archive.csv", vehicles)}><DownloadSimple size={18} />تصدير الأرشيف</button></header>
      {error ? <div className="connection-banner"><WarningCircle size={20} weight="fill" /><span>{error}</span></div> : null}
      <section className="operations-archive-grid">
        {vehicles.length === 0 ? <div className="panel operations-empty">لا توجد سيارات مؤرشفة.</div> : vehicles.map((vehicle) => <article className="panel operations-archive-card" key={vehicle.id}>
          <header><Archive size={25} weight="duotone" /><div><strong>{vehicle.vin}</strong><span>{vehicle.car_name || "—"} · {vehicle.statement || "—"} · {vehicle.model_year || "—"}</span></div></header>
          <dl><div><dt>المكان</dt><dd>{vehicle.location_name || "—"}</dd></div><div><dt>الحالة وقت الأرشفة</dt><dd>{vehicle.status_name || "—"}</dd></div><div><dt>منفذ الأرشفة</dt><dd>{vehicle.archived_by_name || "—"}</dd></div><div><dt>التاريخ</dt><dd>{formatOperationsDate(vehicle.archived_at)}</dd></div></dl>
          <p><strong>سبب الأرشفة:</strong> {vehicle.archive_reason || "—"}</p>
          <div className="operations-snapshot"><span>الموافقات محفوظة</span><span>التراكينج محفوظ</span><span>الحركات محفوظة</span></div>
        </article>)}
      </section>
    </div>
  );
}
