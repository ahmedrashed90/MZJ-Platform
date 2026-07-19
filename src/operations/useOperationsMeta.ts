import { useEffect, useState } from "react";
import { operationsFetch } from "./api";
import type { OperationsMeta } from "./types";

let cachedMeta: OperationsMeta | null = null;
let pending: Promise<OperationsMeta> | null = null;

export function loadOperationsMeta(force = false) {
  if (!force && cachedMeta) return Promise.resolve(cachedMeta);
  if (!force && pending) return pending;
  pending = operationsFetch<{ok:boolean} & OperationsMeta>("/api/operations?resource=meta")
    .then((payload) => {
      cachedMeta = { locations: payload.locations, statuses: payload.statuses, permissions: payload.permissions, checkItems: payload.checkItems };
      return cachedMeta;
    })
    .finally(() => { pending = null; });
  return pending;
}

export function useOperationsMeta() {
  const [meta, setMeta] = useState<OperationsMeta | null>(cachedMeta);
  const [loading, setLoading] = useState(!cachedMeta);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    loadOperationsMeta().then((value) => { if (active) setMeta(value); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "تعذر تحميل إعدادات العمليات"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return { meta, loading, error, refresh: async () => { const value = await loadOperationsMeta(true); setMeta(value); return value; } };
}
