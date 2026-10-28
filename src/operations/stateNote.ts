import type { VehicleRow } from "./types";

export function displayOperationsStateNote(row: Pick<VehicleRow, "state_note" | "archived_at">) {
  const note = String(row.state_note || "").trim();
  if (!row.archived_at || !note) return note;
  return note.replace(/^مباع\s+تحت\s+التسليم\s*[—-]\s*/u, "").trim();
}
