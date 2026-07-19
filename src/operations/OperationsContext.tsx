import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { operationsFetch } from "./api";
import type { OperationsMeta } from "./types";

type OperationsContextValue = {
  meta: OperationsMeta | null;
  loading: boolean;
  error: string;
  refreshMeta: () => Promise<void>;
  can: (permission: string) => boolean;
};

const OperationsContext = createContext<OperationsContextValue | null>(null);

export function OperationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [meta, setMeta] = useState<OperationsMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshMeta = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setMeta(await operationsFetch<OperationsMeta>("/api/operations/meta"));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل إعدادات العمليات");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refreshMeta(); }, [refreshMeta]);

  const can = useCallback((permission: string) => {
    if (user?.roleCodes.includes("admin")) return true;
    return Boolean(user?.permissionCodes?.includes(permission) || meta?.permissions?.includes(permission));
  }, [meta?.permissions, user?.permissionCodes, user?.roleCodes]);

  const value = useMemo(() => ({ meta, loading, error, refreshMeta, can }), [meta, loading, error, refreshMeta, can]);
  return <OperationsContext.Provider value={value}>{children}</OperationsContext.Provider>;
}

export function useOperations() {
  const context = useContext(OperationsContext);
  if (!context) throw new Error("useOperations must be used inside OperationsProvider");
  return context;
}
