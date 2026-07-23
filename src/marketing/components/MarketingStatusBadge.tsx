import { statusLabel, statusTone } from "../domain/status";

export function MarketingStatusBadge({ status }: { status?: string | null }) {
  return <span className={`marketing-status-badge ${statusTone(status)}`}>{statusLabel(status)}</span>;
}
