import { useEffect, useState } from "react";
import { operationsFetch } from "./api";
import type { OperationsMeta } from "./types";

let cached: OperationsMeta | null = null;

export function useOperationsMeta() {
  const [meta, setMeta] = useState<OperationsMeta | null>(cached);
  const [error, setError] = useState("");
  useEffect(() => {
    if (cached) return;
    operationsFetch<OperationsMeta>("/api/operations/meta")
      .then((payload) => { cached = payload; setMeta(payload); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "تعذر تحميل إعدادات العمليات"));
  }, []);
  return { meta, error };
}

export function invalidateOperationsMeta() { cached = null; }
