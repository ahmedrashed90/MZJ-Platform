import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { operationsFetch } from "../api";
import type { OperationsMeta } from "../types";

type Value = { meta: OperationsMeta | null; loading: boolean; error: string; reload: () => Promise<void> };
const Context = createContext<Value | null>(null);

export function OperationsProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<OperationsMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function reload() {
    setLoading(true);
    setError("");
    try {
      const response = await operationsFetch<{ ok: true } & OperationsMeta>("/api/operations?resource=meta");
      setMeta(response);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل إعدادات العمليات");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void reload(); }, []);
  const value = useMemo(() => ({ meta, loading, error, reload }), [meta, loading, error]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useOperations() {
  const value = useContext(Context);
  if (!value) throw new Error("useOperations must be used inside OperationsProvider");
  return value;
}
